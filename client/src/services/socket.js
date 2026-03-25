import { io } from 'socket.io-client';
import { BACKEND_URL } from '../lib/config';
import { debugLog } from '../lib/logger';

// Log in development
if (import.meta.env.DEV) {
  debugLog('[Socket] BACKEND_URL:', BACKEND_URL);
}

const socket = io(BACKEND_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  timeout: 20000,
  reconnection: true,
  reconnectionDelay: 800,
  reconnectionDelayMax: 20000,
  randomizationFactor: 0.5,
  reconnectionAttempts: Infinity,
});

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (!socket.connected) {
      debugLog('[Socket] Browser is back online, reconnecting socket');
      socket.connect();
    }
  });
}

/**
 * Set authentication token for Socket.IO connection.
 * Must be called before connecting.
 */
export function setSocketAuth(token) {
  socket.auth = { token };
}

export default socket;
