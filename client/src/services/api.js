import axios from 'axios';

// Derive API base from the same VITE_BACKEND_URL used for socket.io.
// In dev, requests go directly to localhost:3001
// In production, VITE_BACKEND_URL must be set to the deployed backend URL.
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const API_BASE = `${BACKEND_URL}/api`;

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // Include cookies with requests
});

export async function createRoom() {
  try {
    const res = await api.post('/rooms');
    return res.data;
  } catch (err) {
    if (err.response?.status === 401) {
      throw new Error('Not authenticated. Please sign in.');
    }
    throw new Error('Failed to create room');
  }
}

export async function getRoomInfo(code) {
  try {
    const res = await api.get(`/rooms/${encodeURIComponent(code)}`);
    return res.data;
  } catch (err) {
    throw new Error('Room not found');
  }
}

export async function getIceServers() {
  try {
    const res = await api.get('/ice-servers');
    return res.data;
  } catch {
    return null;
  }
}

// Keeps the Render free-tier server awake by sending a periodic HTTP request.
// Render spins down after 15 min of no HTTP traffic; a ping every 8 min prevents that.
export function pingServer() {
  api.get('/health').catch(() => {});
}
