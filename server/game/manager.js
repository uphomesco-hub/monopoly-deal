const {
    createRoom,
    joinRoom,
    reconnectRoom,
    disconnectPlayer,
    leaveRoom,
    startGame,
    handleCommand,
    tickRoom,
    serializeRoomForPlayer,
    getPromptForPlayer,
    getTimerState
} = require('./engine');

class GameManager {
    constructor(io) {
        this.io = io;
        this.rooms = new Map();
        this.socketIndex = new Map();
        this.tickHandle = setInterval(() => this.tick(), 1000);
        if (typeof this.tickHandle.unref === 'function') {
            this.tickHandle.unref();
        }
    }

    createRoom(socket, username) {
        const { room, player } = createRoom(socket.id, username);
        room.lastBroadcastHistoryId = null;
        this.rooms.set(room.id, room);
        this.socketIndex.set(socket.id, {
            roomId: room.id,
            playerId: player.id
        });
        socket.join(room.id);
        socket.emit('room_created', {
            roomId: room.id,
            playerToken: player.token,
            room: serializeRoomForPlayer(room, player.id)
        });
        this.broadcastRoom(room);
    }

    joinRoom(socket, roomId, username) {
        const room = this.rooms.get(roomId);
        if (!room) {
            socket.emit('game_error', { message: 'Room not found.' });
            return;
        }

        const result = joinRoom(room, socket.id, username);
        if (result.error) {
            socket.emit('game_error', { message: result.error });
            return;
        }

        this.socketIndex.set(socket.id, {
            roomId: room.id,
            playerId: result.player.id
        });
        socket.join(room.id);
        socket.emit('room_joined', {
            roomId: room.id,
            playerToken: result.player.token,
            room: serializeRoomForPlayer(room, result.player.id)
        });
        this.broadcastRoom(room);
    }

    reconnectRoom(socket, roomId, playerToken) {
        const room = this.rooms.get(roomId);
        if (!room) {
            socket.emit('game_error', { message: 'Room not found.' });
            return;
        }

        const result = reconnectRoom(room, socket.id, playerToken);
        if (result.error) {
            socket.emit('game_error', { message: result.error });
            return;
        }

        this.socketIndex.set(socket.id, {
            roomId: room.id,
            playerId: result.player.id
        });
        socket.join(room.id);
        socket.emit('room_reconnected', {
            roomId: room.id,
            playerToken: result.player.token,
            room: serializeRoomForPlayer(room, result.player.id)
        });
        this.broadcastRoom(room);
    }

    startGame(socket, payload) {
        const resolved = this.resolvePlayerFromSocketOrToken(socket.id, payload.roomId, payload.playerToken);
        if (!resolved) {
            socket.emit('game_error', { message: 'Player session not found.' });
            return;
        }

        const result = startGame(resolved.room, resolved.playerId);
        if (result.error) {
            socket.emit('game_error', { message: result.error });
            return;
        }

        this.broadcastRoom(resolved.room);
    }

    leaveRoom(socket, payload) {
        const resolved = this.resolvePlayerFromSocketOrToken(socket.id, payload.roomId, payload.playerToken);
        if (!resolved) {
            socket.emit('game_error', { message: 'Player session not found.' });
            return;
        }

        const result = leaveRoom(resolved.room, resolved.playerId);
        this.socketIndex.delete(socket.id);
        socket.leave(resolved.room.id);
        if (result.deleted) {
            this.rooms.delete(resolved.room.id);
            return;
        }
        this.broadcastRoom(resolved.room);
    }

    handleGameCommand(socket, payload) {
        const resolved = this.resolvePlayerFromSocketOrToken(socket.id, payload.roomId, payload.playerToken);
        if (!resolved) {
            socket.emit('game_error', { message: 'Player session not found.' });
            return;
        }

        const result = handleCommand(resolved.room, resolved.playerId, payload.type, payload.payload || {});
        if (result.error) {
            socket.emit('game_error', { message: result.error });
            return;
        }

        this.broadcastRoom(resolved.room);
    }

    handleDisconnect(socketId) {
        const lookup = this.socketIndex.get(socketId);
        if (!lookup) {
            return;
        }

        this.socketIndex.delete(socketId);
        const room = this.rooms.get(lookup.roomId);
        if (!room) {
            return;
        }

        disconnectPlayer(room, lookup.playerId);
        this.broadcastRoom(room);
    }

    tick() {
        for (const room of this.rooms.values()) {
            const changed = tickRoom(room);
            if (changed || room.phase === 'playing') {
                this.broadcastRoom(room, { emitHistory: changed });
            }
        }
    }

    broadcastRoom(room, { emitHistory = true } = {}) {
        for (const player of room.players) {
            if (!player.socketId || !player.connected) {
                continue;
            }

            const socket = this.io.sockets.sockets.get(player.socketId);
            if (!socket) {
                continue;
            }

            socket.emit('room_state', serializeRoomForPlayer(room, player.id));
            socket.emit('prompt_state', getPromptForPlayer(room, player.id));
            socket.emit('timer_state', getTimerState(room));
        }

        if (!emitHistory || !room.history.length) {
            return;
        }

        const latest = room.history[room.history.length - 1];
        if (!latest || latest.id === room.lastBroadcastHistoryId) {
            return;
        }

        room.lastBroadcastHistoryId = latest.id;
        this.io.to(room.id).emit('game_event', latest);
    }

    resolvePlayerFromSocketOrToken(socketId, roomId, playerToken) {
        const indexed = this.socketIndex.get(socketId);
        if (indexed && indexed.roomId === roomId) {
            const room = this.rooms.get(indexed.roomId);
            if (!room) {
                return null;
            }
            return {
                room,
                playerId: indexed.playerId
            };
        }

        const room = this.rooms.get(roomId);
        if (!room || !playerToken) {
            return null;
        }

        const player = room.players.find((entry) => entry.token === playerToken);
        if (!player) {
            return null;
        }

        this.socketIndex.set(socketId, {
            roomId,
            playerId: player.id
        });

        return {
            room,
            playerId: player.id
        };
    }
}

module.exports = {
    GameManager
};
