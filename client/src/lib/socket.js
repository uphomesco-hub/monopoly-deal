import Peer from 'peerjs';
import {
  createRoom as createGameRoom,
  joinRoom as joinGameRoom,
  reconnectRoom as reconnectGameRoom,
  disconnectPlayer,
  leaveRoom as leaveGameRoom,
  startGame as startGameRoom,
  handleCommand,
  tickRoom,
  serializeRoomForPlayer,
  getPromptForPlayer,
  getTimerState,
} from '../game/engine';

const SIGNALING_ERROR_MESSAGE =
  'Could not reach the room host. The host tab may be offline or the room code may be wrong.';
const HOST_LEFT_MESSAGE = 'The host left the room. In peer-hosted mode the room closes with the host.';

class PeerSocket {
  constructor() {
    this.listeners = new Map();
    this.peer = null;
    this.hostConnection = null;
    this.connections = new Map();
    this.peerIndex = new Map();
    this.mode = 'idle';
    this.room = null;
    this.localPlayerId = '';
    this.localPlayerToken = '';
    this.awaitingJoin = false;
    this.joinTimeout = null;
    this.tickHandle = null;
    this.heartbeatHandle = null;
    this.hostHistoryId = null;
    this.pendingOutboundCommand = null;
    this.outboundQueue = [];
    this.commandAckTimeout = null;
    this.recentCommands = new Map();
    this.lastPongAt = 0;
    this.tearingDown = false;
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ];
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
  }

  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event, payload = {}) {
    switch (event) {
      case 'create_room':
        this.createRoom(payload.username);
        return;
      case 'join_room':
        this.joinRoom(payload.roomId, payload.username);
        return;
      case 'reconnect_room':
        this.reconnectRoom(payload.roomId, payload.playerToken);
        return;
      case 'start_game':
        this.startGame(payload.roomId, payload.playerToken);
        return;
      case 'leave_room':
        this.leaveRoom(payload.roomId, payload.playerToken);
        return;
      case 'game_command':
        this.gameCommand(payload);
        return;
      default:
        this.dispatch(event, payload);
    }
  }

  dispatch(event, payload) {
    for (const handler of this.listeners.get(event) || []) {
      handler(payload);
    }
  }

  async createRoom(username) {
    try {
      await this.resetTransport();
      const roomId = this.generateRoomCode();
      const peer = await this.openPeer(roomId);

      this.mode = 'host';
      this.peer = peer;
      this.setupHostPeer();

      const { room, player } = createGameRoom(peer.id, username, roomId);
      room.lastBroadcastHistoryId = null;
      this.room = room;
      this.localPlayerId = player.id;
      this.localPlayerToken = player.token;
      this.hostHistoryId = null;
      this.startTickLoop();
      this.dispatchTransportStatus({ state: 'hosting', label: 'Hosting room on this browser' });

      this.dispatch('room_created', {
        roomId: room.id,
        playerToken: player.token,
        room: serializeRoomForPlayer(room, player.id),
      });
    } catch (error) {
      this.dispatch('connect_error', { message: getSocketErrorMessage(error) });
    }
  }

  async joinRoom(roomId, username) {
    await this.connectToHost(roomId, {
      type: 'join_room',
      payload: {
        roomId,
        username,
      },
    });
  }

  async reconnectRoom(roomId, playerToken) {
    if (this.mode === 'host' && this.room?.id === roomId) {
      const player = this.room.players.find((entry) => entry.token === playerToken);
      if (!player) {
        this.dispatch('game_error', { message: 'Reconnect token is invalid for this room.' });
        return;
      }

      player.connected = true;
      player.socketId = this.peer?.id || this.room.id;
      this.localPlayerId = player.id;
      this.localPlayerToken = player.token;
      this.dispatch('room_reconnected', {
        roomId,
        playerToken: player.token,
        room: serializeRoomForPlayer(this.room, player.id),
      });
      this.broadcastRoom({ emitHistory: false });
      return;
    }

    await this.connectToHost(roomId, {
      type: 'reconnect_room',
      payload: {
        roomId,
        playerToken,
      },
    });
  }

  startGame(roomId, playerToken) {
    if (this.mode === 'host' && this.room?.id === roomId) {
      const result = startGameRoom(this.room, this.localPlayerId);
      if (result.error) {
        this.dispatch('game_error', { message: result.error });
        return;
      }
      this.broadcastRoom();
      return;
    }

    this.sendToHost('start_game', { roomId, playerToken });
  }

  leaveRoom(roomId, playerToken) {
    if (this.mode === 'host' && this.room?.id === roomId) {
      this.closeHostedRoom(HOST_LEFT_MESSAGE);
      return;
    }

    if (this.mode === 'guest') {
      this.sendToHost('leave_room', { roomId, playerToken });
      window.setTimeout(() => {
        this.resetTransport();
      }, 80);
    }
  }

  gameCommand(payload) {
    if (this.mode === 'host' && this.room?.id === payload.roomId) {
      if (payload.clientActionId) {
        this.dispatch('command_status', {
          clientActionId: payload.clientActionId,
          status: 'processing',
        });
      }
      const result = handleCommand(this.room, this.localPlayerId, payload.type, payload.payload || {});
      if (result.error) {
        if (payload.clientActionId) {
          this.dispatch('command_status', {
            clientActionId: payload.clientActionId,
            status: 'error',
            message: result.error,
          });
        }
        this.dispatch('game_error', { message: result.error });
        return;
      }
      this.broadcastRoom();
      if (payload.clientActionId) {
        this.dispatch('command_status', {
          clientActionId: payload.clientActionId,
          status: 'applied',
        });
      }
      return;
    }

    this.enqueueGuestCommand(payload);
  }

  async connectToHost(roomId, joinMessage) {
    try {
      if (this.mode === 'host' && this.room?.id !== roomId) {
        this.closeHostedRoom('The room host started another room.');
      }

      if (this.mode !== 'host') {
        await this.resetTransport();
      }

      const peerId = this.generatePeerId();
      const peer = await this.openPeer(peerId);
      this.mode = 'guest';
      this.peer = peer;
      this.awaitingJoin = true;
      this.localPlayerId = '';
      this.currentRoomId = roomId;
      this.dispatchTransportStatus({ state: 'connecting', label: 'Connecting to room host...' });

      this.peer.on('error', (error) => {
        if (this.tearingDown) {
          return;
        }
        this.dispatch('connect_error', { message: getSocketErrorMessage(error) });
      });

      const connection = peer.connect(roomId, {
        reliable: true,
        serialization: 'json',
      });
      this.hostConnection = connection;

      connection.on('open', () => {
        this.clearJoinTimeout();
        this.dispatchTransportStatus({ state: 'connecting', label: 'Joining room...' });
        this.joinTimeout = window.setTimeout(() => {
          this.dispatch('connect_error', { message: SIGNALING_ERROR_MESSAGE });
        }, 8000);

        connection.send({
          kind: 'command',
          type: joinMessage.type,
          payload: joinMessage.payload,
        });
      });

      connection.on('data', (message) => {
        this.handleGuestMessage(message);
      });

      connection.on('close', () => {
        this.stopGuestHeartbeat();
        this.dispatchTransportStatus({ state: 'disconnected', label: 'Host connection closed' });
        if (!this.tearingDown) {
          this.dispatch('connect_error', { message: HOST_LEFT_MESSAGE });
        }
      });

      connection.on('error', (error) => {
        this.dispatchTransportStatus({ state: 'disconnected', label: 'Host connection failed' });
        this.dispatch('connect_error', { message: getSocketErrorMessage(error) });
      });
    } catch (error) {
      this.dispatch('connect_error', { message: getSocketErrorMessage(error) });
    }
  }

  setupHostPeer() {
    this.peer.on('connection', (connection) => {
      connection.on('open', () => {
        this.connections.set(connection.peer, connection);
      });

      connection.on('data', (message) => {
        this.handleHostMessage(connection.peer, message);
      });

      connection.on('close', () => {
        this.connections.delete(connection.peer);
        const playerId = this.peerIndex.get(connection.peer);
        if (!playerId || !this.room) {
          return;
        }
        this.peerIndex.delete(connection.peer);
        disconnectPlayer(this.room, playerId);
        this.broadcastRoom();
      });

      connection.on('error', () => {
        this.connections.delete(connection.peer);
      });
    });

    this.peer.on('disconnected', () => {
      if (!this.tearingDown) {
        this.peer?.reconnect();
      }
    });

    this.peer.on('error', (error) => {
      if (!this.tearingDown) {
        this.dispatch('connect_error', { message: getSocketErrorMessage(error) });
      }
    });
  }

  handleHostMessage(peerId, message) {
    if (!this.room || message?.kind !== 'command') {
      return;
    }

    switch (message.type) {
      case 'join_room':
        this.handleHostJoin(peerId, message.payload);
        return;
      case 'reconnect_room':
        this.handleHostReconnect(peerId, message.payload);
        return;
      case 'start_game':
        this.handleHostStart(peerId, message.payload);
        return;
      case 'leave_room':
        this.handleHostLeave(peerId, message.payload);
        return;
      case 'game_command':
        this.handleHostCommand(peerId, message.payload);
        return;
      case 'ping':
        this.sendEventToPeer(peerId, 'transport_status', {
          state: 'connected',
          latencyMs: typeof message.payload?.sentAt === 'number' ? Math.max(0, Date.now() - message.payload.sentAt) : undefined,
          label: 'Connected to host',
        });
        return;
      default:
        this.sendEventToPeer(peerId, 'game_error', { message: 'Unknown room command.' });
    }
  }

  handleHostJoin(peerId, payload) {
    const result = joinGameRoom(this.room, peerId, payload.username);
    if (result.error) {
      this.sendEventToPeer(peerId, 'game_error', { message: result.error });
      return;
    }

    this.peerIndex.set(peerId, result.player.id);
    this.sendEventToPeer(peerId, 'room_joined', {
      roomId: this.room.id,
      playerToken: result.player.token,
      room: serializeRoomForPlayer(this.room, result.player.id),
    });
    this.broadcastRoom();
  }

  handleHostReconnect(peerId, payload) {
    const existingPlayer = this.room.players.find((entry) => entry.token === payload.playerToken);
    if (existingPlayer?.socketId && existingPlayer.socketId !== peerId) {
      this.connections.get(existingPlayer.socketId)?.close();
      this.connections.delete(existingPlayer.socketId);
      this.peerIndex.delete(existingPlayer.socketId);
    }

    const result = reconnectGameRoom(this.room, peerId, payload.playerToken);
    if (result.error) {
      this.sendEventToPeer(peerId, 'game_error', { message: result.error });
      return;
    }

    this.peerIndex.set(peerId, result.player.id);
    this.sendEventToPeer(peerId, 'room_reconnected', {
      roomId: this.room.id,
      playerToken: result.player.token,
      room: serializeRoomForPlayer(this.room, result.player.id),
    });
    this.broadcastRoom();
  }

  handleHostStart(peerId, payload) {
    const playerId = this.resolvePlayerId(peerId, payload.playerToken);
    if (!playerId) {
      this.sendEventToPeer(peerId, 'game_error', { message: 'Player session not found.' });
      return;
    }

    const result = startGameRoom(this.room, playerId);
    if (result.error) {
      this.sendEventToPeer(peerId, 'game_error', { message: result.error });
      return;
    }
    this.broadcastRoom();
  }

  handleHostLeave(peerId, payload) {
    const playerId = this.resolvePlayerId(peerId, payload.playerToken);
    if (!playerId) {
      this.sendEventToPeer(peerId, 'game_error', { message: 'Player session not found.' });
      return;
    }

    const result = leaveGameRoom(this.room, playerId);
    this.peerIndex.delete(peerId);
    this.connections.get(peerId)?.close();
    this.connections.delete(peerId);

    if (result.deleted) {
      this.closeHostedRoom(HOST_LEFT_MESSAGE);
      return;
    }

    this.broadcastRoom();
  }

  handleHostCommand(peerId, payload) {
    const playerId = this.resolvePlayerId(peerId, payload.playerToken);
    if (!playerId) {
      if (payload?.clientActionId) {
        this.sendEventToPeer(peerId, 'command_status', {
          clientActionId: payload.clientActionId,
          status: 'error',
          message: 'Player session not found.',
        });
      }
      this.sendEventToPeer(peerId, 'game_error', { message: 'Player session not found.' });
      return;
    }

    const actionId = payload.clientActionId || '';
    if (actionId) {
      this.cleanupRecentCommands();
      const previous = this.recentCommands.get(actionId);
      if (previous) {
        this.sendEventToPeer(peerId, 'command_status', previous);
        if (previous.status === 'applied') {
          const roomState = serializeRoomForPlayer(this.room, playerId);
          this.sendEventToPeer(peerId, 'room_state', roomState);
          this.sendEventToPeer(peerId, 'prompt_state', getPromptForPlayer(this.room, playerId));
          this.sendEventToPeer(peerId, 'timer_state', getTimerState(this.room));
        }
        return;
      }
      const receivedStatus = { clientActionId: actionId, status: 'received' };
      this.recentCommands.set(actionId, { ...receivedStatus, timestamp: Date.now() });
      this.sendEventToPeer(peerId, 'command_status', receivedStatus);
    }

    const result = handleCommand(this.room, playerId, payload.type, payload.payload || {});
    if (result.error) {
      if (actionId) {
        this.recentCommands.set(actionId, {
          clientActionId: actionId,
          status: 'error',
          message: result.error,
          timestamp: Date.now(),
        });
        this.sendEventToPeer(peerId, 'command_status', {
          clientActionId: actionId,
          status: 'error',
          message: result.error,
        });
      }
      this.sendEventToPeer(peerId, 'game_error', { message: result.error });
      return;
    }
    this.broadcastRoom();
    if (actionId) {
      const appliedStatus = { clientActionId: actionId, status: 'applied', timestamp: Date.now() };
      this.recentCommands.set(actionId, appliedStatus);
      this.sendEventToPeer(peerId, 'command_status', appliedStatus);
    }
  }

  handleGuestMessage(message) {
    if (message?.kind !== 'event') {
      return;
    }

    if (message.event === 'room_joined' || message.event === 'room_reconnected') {
      this.awaitingJoin = false;
      this.clearJoinTimeout();
      this.localPlayerToken = message.payload.playerToken;
      this.localPlayerId = message.payload.room?.you?.playerId || this.localPlayerId;
      this.lastPongAt = Date.now();
      this.startGuestHeartbeat();
      this.dispatchTransportStatus({ state: 'connected', label: 'Connected to host' });
    }

    if (message.event === 'command_status') {
      this.handleGuestCommandStatus(message.payload);
      return;
    }

    if (message.event === 'transport_status') {
      this.lastPongAt = Date.now();
      this.dispatchTransportStatus(message.payload || { state: 'connected', label: 'Connected to host' });
      return;
    }

    this.dispatch(message.event, message.payload);
  }

  broadcastRoom({ emitHistory = true } = {}) {
    if (!this.room) {
      return;
    }

    for (const player of this.room.players) {
      const roomState = serializeRoomForPlayer(this.room, player.id);
      const promptState = getPromptForPlayer(this.room, player.id);
      const timerState = getTimerState(this.room);

      if (player.id === this.localPlayerId) {
        this.dispatch('room_state', roomState);
        this.dispatch('prompt_state', promptState);
        this.dispatch('timer_state', timerState);
        continue;
      }

      if (!player.connected || !player.socketId) {
        continue;
      }

      this.sendEventToPeer(player.socketId, 'room_state', roomState);
      this.sendEventToPeer(player.socketId, 'prompt_state', promptState);
      this.sendEventToPeer(player.socketId, 'timer_state', timerState);
    }

    if (!emitHistory || !this.room.history.length) {
      return;
    }

    const latest = this.room.history[this.room.history.length - 1];
    if (!latest || latest.id === this.hostHistoryId) {
      return;
    }

    this.hostHistoryId = latest.id;
    this.dispatch('game_event', latest);
    for (const player of this.room.players) {
      if (player.id === this.localPlayerId || !player.connected || !player.socketId) {
        continue;
      }
      this.sendEventToPeer(player.socketId, 'game_event', latest);
    }
  }

  sendToHost(type, payload) {
    if (!this.hostConnection?.open) {
      this.dispatchTransportStatus({ state: 'disconnected', label: 'Host is offline' });
      this.dispatch('connect_error', { message: SIGNALING_ERROR_MESSAGE });
      return;
    }

    this.hostConnection.send({
      kind: 'command',
      type,
      payload,
    });
  }

  sendEventToPeer(peerId, event, payload) {
    const connection = this.connections.get(peerId);
    if (!connection?.open) {
      return;
    }

    connection.send({
      kind: 'event',
      event,
      payload,
    });
  }

  resolvePlayerId(peerId, playerToken) {
    if (peerId === this.peer?.id) {
      return this.localPlayerId;
    }

    const indexed = this.peerIndex.get(peerId);
    if (indexed) {
      return indexed;
    }

    const player = this.room?.players.find((entry) => entry.token === playerToken);
    if (!player) {
      return '';
    }

    this.peerIndex.set(peerId, player.id);
    player.socketId = peerId;
    player.connected = true;
    return player.id;
  }

  closeHostedRoom(reason) {
    if (this.room) {
      for (const player of this.room.players) {
        if (player.id === this.localPlayerId || !player.socketId) {
          continue;
        }
        this.sendEventToPeer(player.socketId, 'connect_error', { message: reason });
      }
    }
    window.setTimeout(() => {
      this.resetTransport();
    }, 120);
  }

  startTickLoop() {
    this.stopTickLoop();
    this.tickHandle = window.setInterval(() => {
      if (!this.room) {
        return;
      }

      this.cleanupRecentCommands();
      const changed = tickRoom(this.room);
      if (changed || this.room.phase === 'playing') {
        this.broadcastRoom({ emitHistory: changed });
      }
    }, 1000);
  }

  stopTickLoop() {
    if (this.tickHandle) {
      window.clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  clearJoinTimeout() {
    if (this.joinTimeout) {
      window.clearTimeout(this.joinTimeout);
      this.joinTimeout = null;
    }
  }

  clearCommandAckTimeout() {
    if (this.commandAckTimeout) {
      window.clearTimeout(this.commandAckTimeout);
      this.commandAckTimeout = null;
    }
  }

  dispatchTransportStatus(payload) {
    this.dispatch('transport_status', payload);
  }

  enqueueGuestCommand(payload) {
    const entry = {
      payload,
      attempts: 0,
      acked: false,
    };
    this.outboundQueue.push(entry);
    this.dispatch('command_status', {
      clientActionId: payload.clientActionId,
      status: this.pendingOutboundCommand ? 'queued' : 'sending',
    });
    this.flushGuestCommandQueue();
  }

  flushGuestCommandQueue() {
    if (this.mode !== 'guest' || this.pendingOutboundCommand || !this.outboundQueue.length) {
      return;
    }

    const next = this.outboundQueue.shift();
    this.pendingOutboundCommand = next;
    this.sendGuestCommand(next, false);
  }

  sendGuestCommand(entry, isRetry) {
    if (!this.hostConnection?.open) {
      this.pendingOutboundCommand = null;
      this.dispatchTransportStatus({ state: 'disconnected', label: 'Host is offline' });
      this.dispatch('command_status', {
        clientActionId: entry.payload.clientActionId,
        status: 'error',
        message: SIGNALING_ERROR_MESSAGE,
      });
      return;
    }

    entry.attempts += 1;
    this.dispatch('command_status', {
      clientActionId: entry.payload.clientActionId,
      status: isRetry ? 'retrying' : (entry.acked ? 'processing' : 'sending'),
      attempt: entry.attempts,
    });
    this.hostConnection.send({
      kind: 'command',
      type: 'game_command',
      payload: entry.payload,
    });

    this.clearCommandAckTimeout();
    this.commandAckTimeout = window.setTimeout(() => {
      if (this.pendingOutboundCommand !== entry || entry.acked) {
        return;
      }

      if (entry.attempts < 3) {
        this.dispatchTransportStatus({ state: 'degraded', label: 'Waiting for host confirmation...' });
        this.sendGuestCommand(entry, true);
        return;
      }

      this.dispatch('command_status', {
        clientActionId: entry.payload.clientActionId,
        status: 'error',
        message: 'Host did not confirm the move. Please try again.',
      });
      this.pendingOutboundCommand = null;
      this.dispatchTransportStatus({ state: 'degraded', label: 'Host response is slow' });
      this.flushGuestCommandQueue();
    }, 2200);
  }

  handleGuestCommandStatus(payload) {
    if (!payload?.clientActionId) {
      this.dispatch('command_status', payload);
      return;
    }

    const pending = this.pendingOutboundCommand;
    if (!pending || pending.payload.clientActionId !== payload.clientActionId) {
      this.dispatch('command_status', payload);
      return;
    }

    if (payload.status === 'received') {
      pending.acked = true;
      this.clearCommandAckTimeout();
      this.dispatchTransportStatus({ state: 'connected', label: 'Host confirmed the move' });
      this.dispatch('command_status', {
        clientActionId: payload.clientActionId,
        status: 'processing',
      });
      return;
    }

    this.clearCommandAckTimeout();
    this.dispatch('command_status', payload);
    this.pendingOutboundCommand = null;
    if (payload.status === 'applied') {
      this.dispatchTransportStatus({ state: 'connected', label: 'Connected to host' });
    }
    this.flushGuestCommandQueue();
  }

  startGuestHeartbeat() {
    if (this.mode !== 'guest') {
      return;
    }
    this.stopGuestHeartbeat();
    this.lastPongAt = Date.now();
    this.heartbeatHandle = window.setInterval(() => {
      if (this.mode !== 'guest') {
        return;
      }
      if (Date.now() - this.lastPongAt > 12000) {
        this.dispatchTransportStatus({ state: 'degraded', label: 'Connection to host looks unstable' });
      }
      this.sendToHost('ping', { sentAt: Date.now() });
    }, 5000);
  }

  stopGuestHeartbeat() {
    if (this.heartbeatHandle) {
      window.clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
  }

  cleanupRecentCommands() {
    const cutoff = Date.now() - 60_000;
    for (const [actionId, entry] of this.recentCommands.entries()) {
      if ((entry.timestamp || 0) < cutoff) {
        this.recentCommands.delete(actionId);
      }
    }
  }

  async resetTransport() {
    this.tearingDown = true;
    this.clearJoinTimeout();
    this.clearCommandAckTimeout();
    this.stopTickLoop();
    this.stopGuestHeartbeat();

    for (const connection of this.connections.values()) {
      try {
        connection.close();
      } catch {
        // no-op
      }
    }

    try {
      this.hostConnection?.close();
    } catch {
      // no-op
    }

    try {
      this.peer?.destroy();
    } catch {
      // no-op
    }

    this.connections.clear();
    this.peerIndex.clear();
    this.peer = null;
    this.hostConnection = null;
    this.mode = 'idle';
    this.room = null;
    this.localPlayerId = '';
    this.localPlayerToken = '';
    this.awaitingJoin = false;
    this.hostHistoryId = null;
    this.currentRoomId = '';
    this.pendingOutboundCommand = null;
    this.outboundQueue = [];
    this.recentCommands.clear();
    this.lastPongAt = 0;

    await Promise.resolve();
    this.tearingDown = false;
  }

  openPeer(peerId) {
    return new Promise((resolve, reject) => {
      const peerOptions = {
        debug: 1,
        config: {
          iceServers: this.iceServers,
        },
      };
      const customPeerHost = import.meta.env.VITE_PEER_HOST;
      const customPeerPort = import.meta.env.VITE_PEER_PORT;
      const customPeerPath = import.meta.env.VITE_PEER_PATH;
      const customPeerSecure = import.meta.env.VITE_PEER_SECURE;

      if (customPeerHost) {
        peerOptions.host = customPeerHost;
        if (customPeerPort) {
          peerOptions.port = Number(customPeerPort);
        }
        peerOptions.path = customPeerPath || '/';
        peerOptions.secure = customPeerSecure === 'true';
      }
      const peer = new Peer(peerId, peerOptions);

      const timeout = window.setTimeout(() => {
        cleanup();
        try {
          peer.destroy();
        } catch {
          // no-op
        }
        reject(new Error(SIGNALING_ERROR_MESSAGE));
      }, 10000);

      const cleanup = () => {
        window.clearTimeout(timeout);
        peer.off('open', handleOpen);
        peer.off('error', handleError);
      };

      const handleOpen = () => {
        cleanup();
        resolve(peer);
      };

      const handleError = (error) => {
        cleanup();
        try {
          peer.destroy();
        } catch {
          // no-op
        }
        reject(error);
      };

      peer.on('open', handleOpen);
      peer.on('error', handleError);
    });
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let index = 0; index < 6; index += 1) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  generatePeerId() {
    return `player_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export const socket = new PeerSocket();

export function emitGameCommand(roomId, playerToken, type, payload = {}) {
  const clientActionId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  socket.emit('game_command', {
    roomId,
    playerToken,
    type,
    payload,
    clientActionId,
  });

  return clientActionId;
}

export function getSocketErrorMessage(error) {
  const baseMessage = String(error?.message || error?.type || '');
  if (!baseMessage) {
    return SIGNALING_ERROR_MESSAGE;
  }

  if (baseMessage.includes('peer-unavailable') || baseMessage.includes('Could not connect')) {
    return SIGNALING_ERROR_MESSAGE;
  }

  if (baseMessage.includes('unavailable-id')) {
    return 'That room code is already in use. Please try creating the room again.';
  }

  if (baseMessage.includes('network') || baseMessage.includes('Lost connection')) {
    return 'Peer connection dropped. Make sure the host tab stays open and both players are online.';
  }

  return baseMessage;
}
