require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const {
  createRoom,
  createRoomWithId,
  getRoom,
  deleteRoom,
  touchRoom,
  setMaxListeners,
  getMaxListeners,
  addListener,
  removeListener,
  setListenerReaction,
  getRoomByCode,
  getAllRooms,
  addMessage,
  getMessages,
} = require('./rooms');
const { createToken, verifyToken, authMiddleware, getOrCreateUser } = require('./auth');
const { initRedis, closeRedis, isRedisReady } = require('./redis/client');
const { createSessionMiddleware } = require('./redis/session');
const { createRedisRateLimiter } = require('./redis/rateLimit');
const { buildCacheKey, getOrSetJSON, deleteKey } = require('./redis/cache');
const { publishEvent, subscribeEvent } = require('./redis/pubsub');
const {
  addActiveUser,
  removeActiveUser,
  getActiveUserCount,
  enqueueSignal,
  getRecentSignals,
} = require('./redis/realtime');

const redisInitPromise = initRedis().catch((err) => {
  console.warn('[redis] startup initialization failed, continuing without Redis', err?.message || err);
});

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
app.use(createSessionMiddleware());

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

const createRoomLimiter = createRedisRateLimiter({
  keyPrefix: 'rate:create-room',
  windowSeconds: 10 * 60,
  maxRequests: 30,
  message: 'Too many rooms created. Please try again later.',
});

const roomLookupLimiter = createRedisRateLimiter({
  keyPrefix: 'rate:room-lookup',
  windowSeconds: 5 * 60,
  maxRequests: 120,
  message: 'Too many room lookups. Please try again later.',
});

function roomLookupCacheKey(code) {
  return buildCacheKey('cache', 'room-lookup', code);
}

async function invalidateRoomLookupCache(code) {
  const normalized = String(code || '').toUpperCase();
  if (!normalized) return;
  await deleteKey(roomLookupCacheKey(normalized));
}

// Room lifecycle configuration
const SIX_HOURS = 6 * 60 * 60 * 1000;
const MAX_TTL_MS = parseInt(process.env.ROOM_TTL_MS || String(60 * 60 * 1000), 10); // default 60 min
const MAX_LISTENERS_PER_ROOM = parseInt(process.env.MAX_LISTENERS || '30', 10);

setMaxListeners(MAX_LISTENERS_PER_ROOM);

if (process.env.MAX_LISTENERS) {
  console.log(`[config] max listeners per room: ${MAX_LISTENERS_PER_ROOM}`);
}
console.log(`[config] room TTL (inactivity): ${MAX_TTL_MS / 1000 / 60} minutes`);

// Cleanup: remove stale rooms (no host for 6h) and inactive rooms (no activity for TTL)
setInterval(() => {
  const now = Date.now();
  for (const room of getAllRooms()) {
    // Stale (host disconnected for 6+ hours)
    if (!room.hostConnected && now - room.createdAt > SIX_HOURS) {
      deleteRoom(room.id);
      console.log(`[cleanup] stale room ${room.code} (no host for 6h) removed`);
    }
    // Inactive (no activity for TTL, room still exists)
    else if (now - room.lastActivity > MAX_TTL_MS) {
      deleteRoom(room.id);
      console.log(`[cleanup] inactive room ${room.code} (TTL exceeded) removed`);
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

app.get('/api/system/redis', (_req, res) => {
  res.json({
    enabled: String(process.env.REDIS_ENABLED || 'true').toLowerCase() !== 'false',
    connected: isRedisReady(),
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  });
});

app.post('/api/events/publish', authMiddleware, async (req, res) => {
  const channel = String(req.body?.channel || 'room-events').trim();
  const payload = req.body?.payload;
  if (!channel || !payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'channel and payload(object) are required' });
  }

  await publishEvent(channel, {
    ...payload,
    publishedBy: req.user?.id || req.user?.email || 'unknown',
  });

  res.json({ ok: true, channel });
});

app.get('/api/rooms/:roomId/realtime', authMiddleware, async (req, res) => {
  const roomId = String(req.params.roomId || '').trim();
  if (!roomId) return res.status(400).json({ error: 'roomId is required' });

  const activeUsers = await getActiveUserCount(roomId);
  const recentSignals = await getRecentSignals(roomId, 30);

  res.json({
    roomId,
    redisConnected: isRedisReady(),
    activeUsers,
    recentSignals,
  });
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
  async (req, res) => {
    // User authenticated successfully
    if (req.user) {
      req.session.user = {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
      };
      req.session.lastSeenAt = Date.now();
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
  if (!token && !req.session?.user) return res.json({ authenticated: false });

  if (req.session?.user) {
    req.session.lastSeenAt = Date.now();
    return res.json({ authenticated: true, user: req.session.user, source: 'session' });
  }

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
  req.session?.destroy?.(() => {
    res.json({ ok: true });
  });
});

// REST: create room (requires authentication)
app.post('/api/rooms', authMiddleware, createRoomLimiter, (_req, res) => {
  const room = createRoom();
  invalidateRoomLookupCache(room.code).catch(() => {});
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
  const cacheKey = roomLookupCacheKey(code);
  const maxListeners = getMaxListeners();

  getOrSetJSON(cacheKey, 15, async () => {
    const room = getRoomByCode(code);
    if (!room) return null;
    return {
      id: room.id,
      code: room.code,
      hostConnected: room.hostConnected,
      listenerCount: room.listeners.size,
      maxListeners,
      isFull: room.listeners.size >= maxListeners,
      fetchedAt: Date.now(),
    };
  })
    .then(({ data, cacheHit }) => {
      if (!data) return res.status(404).json({ error: 'Room not found' });
      res.setHeader('X-Cache', cacheHit ? 'HIT' : 'MISS');
      res.json(data);
    })
    .catch((err) => {
      console.error('[cache-aside] room lookup failed', err?.message || err);
      res.status(500).json({ error: 'Room lookup failed' });
    });
});

// Socket.IO signaling - with authentication middleware
function getTokenFromCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  const entries = String(cookieHeader)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const [key, ...rest] = entry.split('=');
    if (key !== 'auth_token') continue;
    const raw = rest.join('=');
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  return null;
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || getTokenFromCookieHeader(socket.handshake.headers?.cookie);
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
    addActiveUser(room.id, socket.id).catch(() => {});
    invalidateRoomLookupCache(room.code).catch(() => {});
    cb?.({
      ok: true,
      code: room.code,
      listenerCount: room.listeners.size,
      maxListeners: getMaxListeners(),
      sessionLimitMs: MAX_TTL_MS,
    });
    console.log(`[room ${room.code}] host joined`);
  });

  // Listener joins room
  socket.on('listener:join', ({ roomCode }, cb) => {
    const room = getRoomByCode(roomCode);
    if (!room) return cb?.({ error: 'Room not found' });
    if (!room.hostConnected) return cb?.({ error: 'Host not connected' });

    // Check listener limit
    const maxListeners = getMaxListeners();
    if (room.listeners.size >= maxListeners) {
      return cb?.({ error: `Room is full (${maxListeners} listeners max)` });
    }

    addListener(room.id, socket.id);
    socket.join(room.id);
    socket.data.role = 'listener';
    socket.data.roomId = room.id;
    addActiveUser(room.id, socket.id).catch(() => {});
    invalidateRoomLookupCache(room.code).catch(() => {});

    cb?.({
      ok: true,
      roomId: room.id,
      listenerCount: room.listeners.size,
      maxListeners,
    });

    // Notify host about new listener
    io.to(room.hostSocketId).emit('listener:joined', {
      listenerId: socket.id,
      listenerEmail: socket.user?.email || null,
      listenerName: socket.user?.email ? socket.user.email.split('@')[0] : (socket.user?.name || null),
      listenerCount: room.listeners.size,
    });

    console.log(`[room ${room.code}] listener ${socket.id} joined (${room.listeners.size}/${maxListeners} total)`);
  });

  // WebRTC signaling
  socket.on('signal:offer', ({ to, offer }) => {
    const { roomId } = socket.data;
    if (roomId) touchRoom(roomId);
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
    if (roomId) enqueueSignal(roomId, { type: 'offer', from: socket.id, to }).catch(() => {});
    console.log(`[signal] offer delivered to ${to}`);
  });

  socket.on('signal:answer', ({ to, answer }) => {
    const { roomId } = socket.data;
    if (roomId) touchRoom(roomId);
    console.log(`[signal] answer from ${socket.id} → ${to}`);
    if (!answer) {
      console.warn(`[signal] WARN: answer is empty or null from ${socket.id}`);
      return;
    }
    io.to(to).emit('signal:answer', { from: socket.id, answer });
    if (roomId) enqueueSignal(roomId, { type: 'answer', from: socket.id, to }).catch(() => {});
    console.log(`[signal] answer delivered to ${to}`);
  });

  socket.on('signal:ice-candidate', ({ to, candidate }) => {
    const { roomId } = socket.data;
    if (roomId) touchRoom(roomId);
    if (!candidate) {
      console.warn(`[signal] WARN: ice-candidate is empty or null from ${socket.id}`);
      return;
    }
    const type = candidate.type || '?';
    console.log(`[signal] ice-candidate (${type}) from ${socket.id} → ${to}`);
    io.to(to).emit('signal:ice-candidate', { from: socket.id, candidate });
    if (roomId) enqueueSignal(roomId, { type: 'ice-candidate', from: socket.id, to, candidateType: type }).catch(() => {});
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

    publishEvent('room-events', {
      type: 'listener:reaction',
      roomId,
      listenerId: socket.id,
      reaction: normalizedReaction,
    }).catch(() => {});
  });

  // Listener sends a text message (chat)
  socket.on('listener:send-message', ({ text }) => {
    const { role, roomId } = socket.data;
    if (role !== 'listener' || !roomId) return;

    const room = getRoom(roomId);
    if (!room || !room.hostSocketId) return;
    if (!room.listeners.has(socket.id)) return;

    const normalizedText = String(text || '').trim().slice(0, 50);
    if (!normalizedText) return;

    const message = addMessage(
      roomId,
      socket.id,
      socket.user?.email || null,
      socket.user?.email ? socket.user.email.split('@')[0] : (socket.user?.name || null),
      normalizedText
    );
    if (!message) return;

    // Send message to host
    io.to(room.hostSocketId).emit('listener:message', {
      listenerId: socket.id,
      listenerEmail: message.listenerEmail,
      listenerName: message.listenerName,
      text: message.text,
      timestamp: message.timestamp,
    });

    console.log(`[message] from ${socket.id}: "${normalizedText}"`);

    publishEvent('room-events', {
      type: 'listener:message',
      roomId,
      listenerId: socket.id,
      text: normalizedText,
    }).catch(() => {});
  });

  // Host requests message history when joining
  socket.on('listener:request-messages', ({ roomId }, cb) => {
    const room = getRoom(roomId);
    if (!room || room.hostSocketId !== socket.id) return cb?.({ error: 'unauthorized' });
    const messages = getMessages(roomId);
    cb?.({ ok: true, messages });
  });
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
    publishEvent('room-events', { type: 'host:stop', roomId: room.id, hostId: socket.id }).catch(() => {});
    invalidateRoomLookupCache(room.code).catch(() => {});
    deleteRoom(room.id);
  });

  socket.on('host:remove-listener', ({ listenerId }) => {
    const room = getAuthorizedHostRoom();
    if (!room) return;
    if (!room.listeners.has(listenerId)) return;

    removeListener(room.id, listenerId);
    removeActiveUser(room.id, listenerId).catch(() => {});
    invalidateRoomLookupCache(room.code).catch(() => {});
    io.to(listenerId).emit('host:removed');
    const listenerSocket = io.sockets.sockets.get(listenerId);
    if (listenerSocket) listenerSocket.leave(room.id);
  });

  // Sync: host broadcasts its timestamp periodically
  socket.on('sync:timestamp', ({ timestamp }) => {
    const { roomId } = socket.data;
    if (roomId) {
      touchRoom(roomId);
      socket.to(roomId).emit('sync:timestamp', { timestamp, serverTime: Date.now() });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const { role, roomId } = socket.data;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return;

    if (role === 'host') {
      io.to(roomId).emit('host:stopped');
      removeActiveUser(room.id, socket.id).catch(() => {});
      invalidateRoomLookupCache(room.code).catch(() => {});
      deleteRoom(roomId);
      console.log(`[room ${room.code}] host disconnected - room closed`);
    } else if (role === 'listener') {
      removeListener(room.id, socket.id);
      removeActiveUser(room.id, socket.id).catch(() => {});
      invalidateRoomLookupCache(room.code).catch(() => {});
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

async function bootstrap() {
  try {
    await redisInitPromise;

    if (isRedisReady()) {
      await subscribeEvent('room-events', async (event) => {
        if (!event?.type) return;
        if (event.roomId) {
          const activeCount = await getActiveUserCount(event.roomId);
          if (activeCount !== null) {
            console.log(`[pubsub] ${event.type} room=${event.roomId} activeUsers=${activeCount}`);
          }
        }
      });
    }

    server.listen(PORT, () => {
      console.log(`HearTogether server listening on port ${PORT}`);
      if (hasTurn) console.log(`[TURN] provider: ${TURN_PROVIDER} OK`);
      else console.log('[TURN] WARNING: no relay configured - mobile audio will fail');
      console.log(`[lifecycle] max ${MAX_LISTENERS_PER_ROOM} listeners/room, ${MAX_TTL_MS / 1000 / 60} min inactivity TTL`);
      console.log(`[redis] status: ${isRedisReady() ? 'connected' : 'disabled/unavailable'}`);
    });
  } catch (err) {
    console.error('[bootstrap] failed to initialize backend', err?.message || err);
    process.exit(1);
  }
}

bootstrap();

process.on('SIGINT', async () => {
  await closeRedis();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeRedis();
  process.exit(0);
});