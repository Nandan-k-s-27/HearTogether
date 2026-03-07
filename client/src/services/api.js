const API_BASE = import.meta.env.VITE_API_URL || '/api';

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
