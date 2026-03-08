// Derive API base from the same VITE_SERVER_URL used for socket.io.
// In dev, Vite proxies '/api' → localhost:3001, so empty string works fine.
// In production, VITE_SERVER_URL must be set to the deployed backend URL.
const SERVER = import.meta.env.VITE_SERVER_URL || '';
const API_BASE = SERVER ? `${SERVER}/api` : '/api';

export async function createRoom() {
  const res = await fetch(`${API_BASE}/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to create room');
  return res.json();
}

export async function getRoomInfo(code) {
  const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(code)}`);
  if (!res.ok) throw new Error('Room not found');
  return res.json();
}

export async function getIceServers() {
  try {
    const res = await fetch(`${API_BASE}/ice-servers`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
