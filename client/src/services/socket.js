import { io } from 'socket.io-client';
import { BACKEND_URL } from '../lib/config';

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
