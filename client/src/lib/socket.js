import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export const socket = io(SERVER_URL, {
  autoConnect: true,
});

export function emitGameCommand(roomId, playerToken, type, payload = {}) {
  socket.emit('game_command', {
    roomId,
    playerToken,
    type,
    payload,
    clientActionId: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
}
