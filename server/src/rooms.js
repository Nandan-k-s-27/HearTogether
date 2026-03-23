const { nanoid } = require('nanoid');

// In-memory room store
const rooms = new Map();

function generateCode() {
  return nanoid(7).toUpperCase();
}

function createRoom() {
  const id = nanoid();
  const code = generateCode();
  const room = {
    id,
    code,
    hostSocketId: null,
    hostConnected: false,
    listeners: new Map(), // socketId -> { joinedAt }
    createdAt: Date.now(),
  };
  rooms.set(id, room);
  return { id, code };
}

// Recreate a room with an existing ID (used when the server restarts and the
// host reconnects with its old roomId still in the URL).
function createRoomWithId(id) {
  const code = generateCode();
  const room = {
    id,
    code,
    hostSocketId: null,
    hostConnected: false,
    listeners: new Map(),
    createdAt: Date.now(),
  };
  rooms.set(id, room);
  return { id, code };
}

function getRoom(id) {
  return rooms.get(id) || null;
}

function getRoomByCode(code) {
  for (const room of rooms.values()) {
    if (room.code === code.toUpperCase()) return room;
  }
  return null;
}

function deleteRoom(id) {
  rooms.delete(id);
}

function addListener(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.listeners.set(socketId, { joinedAt: Date.now(), reaction: null, reactedAt: null });
}

function removeListener(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.listeners.delete(socketId);
}

function setListenerReaction(roomId, socketId, reaction) {
  const room = rooms.get(roomId);
  if (!room) return false;
  const listener = room.listeners.get(socketId);
  if (!listener) return false;
  room.listeners.set(socketId, {
    ...listener,
    reaction,
    reactedAt: Date.now(),
  });
  return true;
}

function getAllRooms() {
  return Array.from(rooms.values());
}

module.exports = {
  createRoom,
  createRoomWithId,
  getRoom,
  getRoomByCode,
  deleteRoom,
  addListener,
  removeListener,
  setListenerReaction,
  getAllRooms,
};
