const STORAGE_KEY = 'monopoly-deal-player-tokens';

export function getStoredToken(roomId) {
  const tokens = readTokens();
  return tokens[roomId] || '';
}

export function setStoredToken(roomId, playerToken) {
  const tokens = readTokens();
  tokens[roomId] = playerToken;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export function clearStoredToken(roomId) {
  const tokens = readTokens();
  delete tokens[roomId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

function readTokens() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
