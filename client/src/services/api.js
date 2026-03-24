import axios from 'axios';
import { BACKEND_URL } from '../lib/config';
import { debugLog } from '../lib/logger';

const API_BASE = `${BACKEND_URL}/api`;

// Log in development
if (import.meta.env.DEV) {
  debugLog('[API] BACKEND_URL:', BACKEND_URL);
}

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // Include cookies with requests
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
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
  } catch {
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
