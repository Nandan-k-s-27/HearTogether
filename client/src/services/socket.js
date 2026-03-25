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
  // CRITICAL: Android Chrome suspends WebSockets when the tab is backgrounded
  // or the screen is locked.  The previous limit of 5 attempts meant the socket
  // died permanently after ~30 seconds in the background.  When the server saw
  // the disconnect it emitted `host:stopped` / `listener:left` and tore down
  // the room.  Infinite retries let the socket recover when the user returns.
  reconnectionDelayMax: 30000,
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
