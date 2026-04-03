import { io } from 'socket.io-client';

function resolveServerUrl() {
  const configuredUrl = import.meta.env.VITE_SERVER_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(host)) {
      return 'http://localhost:3001';
    }
  }

  return '';
}

export const SERVER_URL = resolveServerUrl();
export const BACKEND_CONFIGURED = Boolean(SERVER_URL);
export const BACKEND_CONFIG_MESSAGE =
  'This deployment does not have a live game server yet. GitHub Pages only hosts the client. Deploy the Express + Socket.IO server and set VITE_SERVER_URL to that backend URL.';

export const socket = io(SERVER_URL || undefined, {
  autoConnect: BACKEND_CONFIGURED,
  reconnection: BACKEND_CONFIGURED,
  timeout: 5000,
});

export function emitGameCommand(roomId, playerToken, type, payload = {}) {
  if (!BACKEND_CONFIGURED) {
    return false;
  }

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
  if (!BACKEND_CONFIGURED) {
    return BACKEND_CONFIG_MESSAGE;
  }

  const baseMessage = error?.message || '';
  if (baseMessage === 'xhr poll error' || baseMessage === 'websocket error') {
    return `Cannot reach the live game server at ${SERVER_URL}. Make sure the backend is deployed and accessible from this site.`;
  }

  return baseMessage || 'Could not connect to the game server.';
}
