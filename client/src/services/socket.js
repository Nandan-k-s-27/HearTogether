import { io } from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

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
