const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createRoom, getRoom, deleteRoom, addListener, removeListener, getRoomByCode, getAllRooms } = require('./rooms');

const app = express();
const server = http.createServer(app);

// Support comma-separated origins e.g. "https://foo.vercel.app,https://www.foo.com"
const rawOrigins = process.env.FRONTEND_URL || 'http://localhost:5173';
const ALLOWED_ORIGINS = rawOrigins.split(',').map((o) => o.trim());
console.log('[cors] allowed origins:', ALLOWED_ORIGINS);

const corsOptions = {
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, health checks)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST'],
};

const io = new Server(server, { cors: corsOptions });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));

const createRoomLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many rooms created. Please try again later.' },
});

// Stale room cleanup: remove rooms older than 6 h with no active host
const SIX_HOURS = 6 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const room of getAllRooms()) {
    if (!room.hostConnected && now - room.createdAt > SIX_HOURS) {
      deleteRoom(room.id);
      console.log(`[cleanup] stale room ${room.code} removed`);
    }
  }
}, 60 * 60 * 1000); // run every hour

// Root route – confirms server is live
app.get('/', (_req, res) => {
  res.json({ service: 'HearTogether API', status: 'ok' });
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// REST: create room
app.post('/api/rooms', createRoomLimiter, (_req, res) => {
  const room = createRoom();
  res.status(201).json(room);
});

// ICE server configuration (STUN + optional TURN for NAT traversal)
app.get('/api/ice-servers', (_req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const turnUrl = process.env.TURN_URL;
  const turnUser = process.env.TURN_USERNAME;
  const turnCred = process.env.TURN_CREDENTIAL;

  if (turnUrl && turnUser && turnCred) {
    // Support comma-separated TURN URLs for multiple endpoints
    turnUrl.split(',').map((u) => u.trim()).forEach((url) => {
      servers.push({ urls: url, username: turnUser, credential: turnCred });
    });
  } else {
    // Open Relay public TURN — suitable for development and small-scale use.
    // For production replace with TURN_URL / TURN_USERNAME / TURN_CREDENTIAL env vars.
    const openRelay = [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:80?transport=tcp',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ];
    openRelay.forEach((url) => {
      servers.push({ urls: url, username: 'openrelayproject', credential: 'openrelayproject' });
    });
  }

  res.json({ iceServers: servers });
});

// REST: get room info
app.get('/api/rooms/:code', (req, res) => {
  const code = req.params.code.replace(/[^A-Za-z0-9]/g, '').slice(0, 20).toUpperCase();
  const room = getRoomByCode(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ id: room.id, code: room.code, hostConnected: room.hostConnected, listenerCount: room.listeners.size });
});

// ─── Socket.IO signaling ───────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  // Host joins room
  socket.on('host:join', ({ roomId }, cb) => {
    const room = getRoom(roomId);
    if (!room) return cb?.({ error: 'Room not found' });
    room.hostSocketId = socket.id;
    room.hostConnected = true;
    socket.join(roomId);
    socket.data.role = 'host';
    socket.data.roomId = roomId;
    cb?.({ ok: true, code: room.code });
    console.log(`[room ${room.code}] host joined`);
  });

  // Listener joins room
  socket.on('listener:join', ({ roomCode }, cb) => {
    const room = getRoomByCode(roomCode);
    if (!room) return cb?.({ error: 'Room not found' });
    if (!room.hostConnected) return cb?.({ error: 'Host not connected' });

    addListener(room.id, socket.id);
    socket.join(room.id);
    socket.data.role = 'listener';
    socket.data.roomId = room.id;

    cb?.({ ok: true, roomId: room.id });

    // Notify host about new listener
    io.to(room.hostSocketId).emit('listener:joined', {
      listenerId: socket.id,
      listenerCount: room.listeners.size,
    });

    console.log(`[room ${room.code}] listener ${socket.id} joined (${room.listeners.size} total)`);
  });

  // ─── WebRTC signaling ─────────────────────────────────────────
  socket.on('signal:offer', ({ to, offer }) => {
    io.to(to).emit('signal:offer', { from: socket.id, offer });
  });

  socket.on('signal:answer', ({ to, answer }) => {
    io.to(to).emit('signal:answer', { from: socket.id, answer });
  });

  socket.on('signal:ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('signal:ice-candidate', { from: socket.id, candidate });
  });

  // ─── Host controls ────────────────────────────────────────────
  socket.on('host:pause', () => {
    const { roomId } = socket.data;
    if (roomId) socket.to(roomId).emit('host:paused');
  });

  socket.on('host:resume', () => {
    const { roomId } = socket.data;
    if (roomId) socket.to(roomId).emit('host:resumed');
  });

  socket.on('host:stop', () => {
    const { roomId } = socket.data;
    if (roomId) {
      socket.to(roomId).emit('host:stopped');
      deleteRoom(roomId);
    }
  });

  socket.on('host:remove-listener', ({ listenerId }) => {
    const { roomId } = socket.data;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (room) removeListener(room.id, listenerId);
    io.to(listenerId).emit('host:removed');
    const listenerSocket = io.sockets.sockets.get(listenerId);
    if (listenerSocket) listenerSocket.leave(roomId);
  });

  // ─── Sync: host broadcasts its timestamp periodically ─────────
  socket.on('sync:timestamp', ({ timestamp }) => {
    const { roomId } = socket.data;
    if (roomId) socket.to(roomId).emit('sync:timestamp', { timestamp, serverTime: Date.now() });
  });

  // ─── Disconnect ───────────────────────────────────────────────
  socket.on('disconnect', () => {
    const { role, roomId } = socket.data;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return;

    if (role === 'host') {
      io.to(roomId).emit('host:stopped');
      deleteRoom(roomId);
      console.log(`[room ${room.code}] host disconnected – room closed`);
    } else if (role === 'listener') {
      removeListener(room.id, socket.id);
      if (room.hostSocketId) {
        io.to(room.hostSocketId).emit('listener:left', {
          listenerId: socket.id,
          listenerCount: room.listeners.size,
        });
      }
      console.log(`[room ${room.code}] listener ${socket.id} left (${room.listeners.size} remaining)`);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`HearTogether server listening on port ${PORT}`);
});
