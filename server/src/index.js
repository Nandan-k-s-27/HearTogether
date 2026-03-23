require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const {
  createRoom,
  createRoomWithId,
  getRoom,
  deleteRoom,
  addListener,
  removeListener,
  setListenerReaction,
  getRoomByCode,
  getAllRooms,
} = require('./rooms');
const { createToken, verifyToken, authMiddleware, getOrCreateUser } = require('./auth');

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
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
};

const io = new Server(server, { cors: corsOptions });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Initialize Passport authentication middleware
app.use(passport.initialize());

// Configure Passport Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/auth/google/callback',
    },
    (accessToken, refreshToken, profile, done) => {
      try {
        const user = getOrCreateUser(profile);
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

function getFrontendRedirectUrl() {
  const raw = process.env.FRONTEND_URL || 'http://localhost:5173';
  // FRONTEND_URL may be comma-separated for CORS; use the first entry for redirects.
  return raw.split(',').map((s) => s.trim()).filter(Boolean)[0] || 'http://localhost:5173';
}

const createRoomLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many rooms created. Please try again later.' },
});

const roomLookupLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many room lookups. Please try again later.' },
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

// Root route - confirms server is live
app.get('/', (_req, res) => {
  res.json({ service: 'HearTogether API', status: 'ok' });
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// AUTH ROUTES

// Start Google OAuth flow
app.get('/auth/google', (req, res, next) => {
  const prompt = req.query.prompt === 'select_account' ? 'select_account' : undefined;
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    prompt,
  })(req, res, next);
});

// Google OAuth callback
app.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/failed', session: false }),
  (req, res) => {
    // User authenticated successfully
    if (req.user) {
      const token = createToken(req.user);
      // Redirect to frontend with token in query (frontend will store in cookie)
      const frontendUrl = getFrontendRedirectUrl();
      res.redirect(`${frontendUrl}?auth_token=${token}`);
    } else {
      res.redirect(`${getFrontendRedirectUrl()}?auth_error=failed`);
    }
  }
);

// Authentication failed redirect
app.get('/auth/failed', (_req, res) => {
  res.status(401).json({ error: 'Authentication failed' });
});

// Get current user profile
app.get('/auth/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

// Check if user is authenticated
app.get('/auth/status', (req, res) => {
  const token = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.json({ authenticated: false });

  const user = verifyToken(token);
  if (user) {
    res.json({ authenticated: true, user });
  } else {
    res.json({ authenticated: false });
  }
});

// Logout
app.post('/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ ok: true });
});

// REST: create room (requires authentication)
app.post('/api/rooms', authMiddleware, createRoomLimiter, (_req, res) => {
  const room = createRoom();
  res.status(201).json(room);
});

// TURN configuration (ExpressTurn recommended).
// Supports both new provider-specific names and legacy TURN_* names.
const TURN_URLS = process.env.EXPRESSTURN_URLS || process.env.TURN_URLS;
const TURN_USERNAME = process.env.EXPRESSTURN_USERNAME || process.env.TURN_USERNAME;
const TURN_CREDENTIAL = process.env.EXPRESSTURN_CREDENTIAL || process.env.TURN_CREDENTIAL;
const TURN_PROVIDER = process.env.TURN_PROVIDER || 'ExpressTurn';

const hasTurn = Boolean(TURN_URLS && TURN_USERNAME && TURN_CREDENTIAL);

if (!hasTurn) {
  console.warn('');
  console.warn('WARNING: No TURN relay configured - audio will NOT work on mobile/cellular.');
  console.warn('  Configure ExpressTurn (or any TURN provider) in environment variables.');
  console.warn('    Preferred: EXPRESSTURN_URLS, EXPRESSTURN_USERNAME, EXPRESSTURN_CREDENTIAL');
  console.warn('    Legacy:    TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL');
  console.warn('');
}

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
];

function normalizeTurnUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return null;
  // Accept valid ICE schemes as-is.
  if (/^(turn|turns|stun|stuns):/i.test(url)) return url;
  // Common misconfiguration from providers: host:port without scheme.
  return `turn:${url}`;
}

// Returns STUN + TURN servers to clients.
app.get('/api/ice-servers', (_req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=300');

  const iceServers = [...STUN_SERVERS];

  if (hasTurn) {
    const parsedUrls = TURN_URLS
      .split(',')
      .map((u) => normalizeTurnUrl(u))
      .filter(Boolean);
    console.log(`[ice-servers] adding ${parsedUrls.length} TURN URLs with auth`);
    parsedUrls.forEach((url) => {
      iceServers.push({ urls: url, username: TURN_USERNAME, credential: TURN_CREDENTIAL });
    });
  } else {
    console.warn(`[ice-servers] WARN: no TURN configured, clients will use STUN only`);
  }

  console.log(`[ice-servers] returning ${iceServers.length} total servers (${STUN_SERVERS.length} STUN, ${iceServers.length - STUN_SERVERS.length} TURN)`);
  res.json({ iceServers });
});

// REST: get room info
app.get('/api/rooms/:code', roomLookupLimiter, (req, res) => {
  const code = req.params.code.replace(/[^A-Za-z0-9]/g, '').slice(0, 20).toUpperCase();
  const room = getRoomByCode(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ id: room.id, code: room.code, hostConnected: room.hostConnected, listenerCount: room.listeners.size });
});

// Socket.IO signaling - with authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.cookie?.split('auth_token=')[1]?.split(';')[0];
  if (!token) {
    return next(new Error('No authentication token'));
  }
  
  const user = verifyToken(token);
  if (!user) {
    return next(new Error('Invalid or expired token'));
  }

  socket.user = user;
  next();
});

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id} (user: ${socket.user.email})`);

  function getAuthorizedHostRoom() {
    const { roomId, role } = socket.data;
    if (role !== 'host' || !roomId) return null;
    const room = getRoom(roomId);
    if (!room || room.hostSocketId !== socket.id) return null;
    return room;
  }

  // Host joins room
  socket.on('host:join', ({ roomId }, cb) => {
    let room = getRoom(roomId);
    if (!room) {
      // Room not in memory - server most likely restarted (Render free-tier
      // spin-up wipes in-memory state). Recreate the room with the same ID
      // so the host's existing URL stays valid and listeners can still join.
      const created = createRoomWithId(roomId);
      room = getRoom(created.id);
      console.log(`[room ${room.code}] recreated after server restart (id=${roomId})`);
    }
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
      listenerEmail: socket.user?.email || null,
      listenerName: socket.user?.email ? socket.user.email.split('@')[0] : (socket.user?.name || null),
      listenerCount: room.listeners.size,
    });

    console.log(`[room ${room.code}] listener ${socket.id} joined (${room.listeners.size} total)`);
  });

  // WebRTC signaling
  socket.on('signal:offer', ({ to, offer }) => {
    console.log(`[signal] offer from ${socket.id} → ${to}`);
    if (!offer) {
      console.warn(`[signal] WARN: offer is empty or null from ${socket.id}`);
      return;
    }
    const targetSocket = io.sockets.sockets.get(to);
    if (!targetSocket) {
      console.warn(`[signal] WARN: target socket ${to} not found for offer from ${socket.id}`);
      return;
    }
    io.to(to).emit('signal:offer', { from: socket.id, offer });
    console.log(`[signal] offer delivered to ${to}`);
  });

  socket.on('signal:answer', ({ to, answer }) => {
    console.log(`[signal] answer from ${socket.id} → ${to}`);
    if (!answer) {
      console.warn(`[signal] WARN: answer is empty or null from ${socket.id}`);
      return;
    }
    io.to(to).emit('signal:answer', { from: socket.id, answer });
    console.log(`[signal] answer delivered to ${to}`);
  });

  socket.on('signal:ice-candidate', ({ to, candidate }) => {
    if (!candidate) {
      console.warn(`[signal] WARN: ice-candidate is empty or null from ${socket.id}`);
      return;
    }
    const type = candidate.type || '?';
    console.log(`[signal] ice-candidate (${type}) from ${socket.id} → ${to}`);
    io.to(to).emit('signal:ice-candidate', { from: socket.id, candidate });
  });

  // Listener can request host to resend an SDP offer if initial signaling
  // was missed due to timing during room join.
  socket.on('listener:request-offer', ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room || !room.hostSocketId) return;
    if (socket.data.role !== 'listener' || socket.data.roomId !== roomId) return;
    if (!room.listeners.has(socket.id)) return;
    console.log(`[signal] listener ${socket.id} requested offer resend in room ${roomId}`);
    io.to(room.hostSocketId).emit('listener:request-offer', { listenerId: socket.id });
  });

  socket.on('listener:reaction', ({ reaction }) => {
    const { role, roomId } = socket.data;
    if (role !== 'listener' || !roomId) return;

    const room = getRoom(roomId);
    if (!room || !room.hostSocketId) return;
    if (!room.listeners.has(socket.id)) return;

    const normalizedReaction = String(reaction || '').trim().slice(0, 4);
    if (!normalizedReaction) return;

    const updated = setListenerReaction(roomId, socket.id, normalizedReaction);
    if (!updated) return;

    io.to(room.hostSocketId).emit('listener:reaction', {
      listenerId: socket.id,
      reaction: normalizedReaction,
      listenerEmail: socket.user?.email || null,
      listenerName: socket.user?.email
        ? socket.user.email.split('@')[0]
        : (socket.user?.name || null),
      listenerCount: room.listeners.size,
    });
  });

  // Host controls
  socket.on('host:pause', () => {
    const room = getAuthorizedHostRoom();
    if (!room) return;
    socket.to(room.id).emit('host:paused');
  });

  socket.on('host:resume', () => {
    const room = getAuthorizedHostRoom();
    if (!room) return;
    socket.to(room.id).emit('host:resumed');
  });

  socket.on('host:stop', () => {
    const room = getAuthorizedHostRoom();
    if (!room) return;
    socket.to(room.id).emit('host:stopped');
    deleteRoom(room.id);
  });

  socket.on('host:remove-listener', ({ listenerId }) => {
    const room = getAuthorizedHostRoom();
    if (!room) return;
    if (!room.listeners.has(listenerId)) return;

    removeListener(room.id, listenerId);
    io.to(listenerId).emit('host:removed');
    const listenerSocket = io.sockets.sockets.get(listenerId);
    if (listenerSocket) listenerSocket.leave(room.id);
  });

  // Sync: host broadcasts its timestamp periodically
  socket.on('sync:timestamp', ({ timestamp }) => {
    const { roomId } = socket.data;
    if (roomId) socket.to(roomId).emit('sync:timestamp', { timestamp, serverTime: Date.now() });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const { role, roomId } = socket.data;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return;

    if (role === 'host') {
      io.to(roomId).emit('host:stopped');
      deleteRoom(roomId);
      console.log(`[room ${room.code}] host disconnected - room closed`);
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
  if (hasTurn) console.log(`[TURN] provider: ${TURN_PROVIDER} OK`);
  else console.log('[TURN] WARNING: no relay configured - mobile audio will fail');
});