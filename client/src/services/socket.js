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
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 20000,
  reconnectionAttempts: Infinity,
});

/**
 * Set authentication token for Socket.IO connection.
 * Must be called before connecting.
 */
export function setSocketAuth(token) {
  socket.auth = { token };
}

export default socket;
