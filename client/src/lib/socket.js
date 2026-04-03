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
    this.hostHistoryId = null;
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

      const { room, player } = createGameRoom(peer.id, username);
      room.lastBroadcastHistoryId = null;
      this.room = room;
      this.localPlayerId = player.id;
      this.localPlayerToken = player.token;
      this.hostHistoryId = null;
      this.startTickLoop();

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
      const result = handleCommand(this.room, this.localPlayerId, payload.type, payload.payload || {});
      if (result.error) {
        this.dispatch('game_error', { message: result.error });
        return;
      }
      this.broadcastRoom();
      return;
    }

    this.sendToHost('game_command', payload);
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
        if (!this.tearingDown) {
          this.dispatch('connect_error', { message: HOST_LEFT_MESSAGE });
        }
      });

      connection.on('error', (error) => {
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
      this.sendEventToPeer(peerId, 'game_error', { message: 'Player session not found.' });
      return;
    }

    const result = handleCommand(this.room, playerId, payload.type, payload.payload || {});
    if (result.error) {
      this.sendEventToPeer(peerId, 'game_error', { message: result.error });
      return;
    }
    this.broadcastRoom();
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

  async resetTransport() {
    this.tearingDown = true;
    this.clearJoinTimeout();
    this.stopTickLoop();

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

    await Promise.resolve();
    this.tearingDown = false;
  }

  openPeer(peerId) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerId, {
        debug: 1,
        config: {
          iceServers: this.iceServers,
        },
      });

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
  socket.emit('game_command', {
    roomId,
    playerToken,
    type,
    payload,
    clientActionId: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });

  return true;
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
