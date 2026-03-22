import { io } from 'socket.io-client';

// Derive socket server URL from VITE_BACKEND_URL
// In production: VITE_BACKEND_URL should be set in Vercel env vars
// In dev: falls back to localhost only if running on localhost
const BACKEND_URL = (() => {
  const url = import.meta.env.VITE_BACKEND_URL;
  if (!url && (typeof window !== 'undefined' && window.location.hostname === 'localhost')) {
    return 'http://localhost:3001';
  }
  return url || 'https://heartogether.onrender.com';
})();

// Log in development
if (import.meta.env.DEV) {
  console.log('[Socket] BACKEND_URL:', BACKEND_URL);
}

const socket = io(BACKEND_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
});

/**
 * Set authentication token for Socket.IO connection.
 * Must be called before connecting.
 */
export function setSocketAuth(token) {
  socket.auth = { token };
}

export default socket;
