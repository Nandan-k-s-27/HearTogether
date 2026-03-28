# HearTogether

HearTogether is a production-ready, real-time web audio streaming application. One authenticated user (host) captures and broadcast system audio or microphone input to multiple listeners who join via room code or QR code. All audio transmission happens peer-to-peer over WebRTC with Socket.IO signaling, optimized for low-latency, low-bandwidth scenarios including mobile networks.

**Live demo**: https://hear-together-ten.vercel.app (frontend) + https://heartogether.onrender.com (backend)
## Screen Shots
<img width="1920" height="1080" alt="Screenshot (391)" src="https://github.com/user-attachments/assets/a5a1c511-300c-4aca-93c1-1f2365dd3e20" />
<img width="1920" height="1080" alt="Screenshot (390)" src="https://github.com/user-attachments/assets/839bbc54-8129-43e2-b43a-92b769c73c56" />
<img width="1920" height="1080" alt="Screenshot (392)" src="https://github.com/user-attachments/assets/84e7a84a-d15b-4e0d-b573-9a124c65eda3" />

## Core Features

### Authentication & Session Management
- **Google Sign-In integration** with OAuth 2.0, timeout-aware backend warm-up (150 seconds), and dual endpoint validation (health + auth status)
- **JWT + HTTP-only cookies**: Secure token storage; session can persist across browser restarts via Redis
- **Graceful auth failure**: If backend unavailable during sign-in, user sees error instead of blank page
- **Post-login deep-link**: Listeners return directly to their intended room after OAuth, no manual navigation needed
- **Account identity**: Signed-in users see their email/name and quick logout/switch-account actions
- **Auth history sanitization**: OAuth callback params cleared on boot to prevent mobile back-button replay attacks

### Audio Streaming (WebRTC)
- **Dual capture modes**:
  - **System Audio**: Tab/Window/Screen (desktop only; requires user permission for each source)
  - **Microphone**: Live microphone input for voice broadcasting or announcements
- **Opus codec optimization** (hardcoded preferences):
  - FEC (Forward Error Correction) enabled for packet loss recovery
  - DTX (Discontinuous Transmission) to reduce bandwidth during silence
  - Bitrate adaptation: 20-64 kbps based on detected network type (2G/3G/4G/LTE)
  - Min packet time: 10ms for lower latency
  - Stereo: disabled (mono for bandwidth efficiency)
- **ICE candidate pooling**: Pre-gathers 4 candidates before offer to eliminate cold-start delay
- **Bundle policy**: Forces all tracks onto single 5-tuple (fewer UDP flows, less overhead)
- **Transport policy**: "all" mode tries STUN, reflexive, and TURN relay candidates (better success on firewalled networks)
- **Automatic relay selection**: 4 Google STUN servers (fallback) + configured TURN servers (production)

### Room Management
- **Create room** (auth required, rate-limited 30 req/10 min): Host generates unique 6-char alphanumeric code
- **Join room** (public code lookup, rate-limited 120 req/5 min): Listeners preview room without joining; public endpoint with cache-aside (15 sec TTL, HIT/MISS headers)
- **Room lifecycle**:
  - Max listeners: 30 per room (configurable; prevents WebRTC CPU exhaustion on free tier)
  - Auto-expire inactive: 60 minutes (configurable ROOM_TTL_MS)
  - Auto-cleanup stale: 6 hours without host connection
  - Hourly background sweep removes expired rooms

### Listener Engagement
- **Emoji reactions** (quick feedback):
  - Quick reactions: ❤️ 👍 👎 😭 😍 (for instant engagement)
  - Extra reactions: 👏 🔥 🎉 😮 🙏 😂 🤯 💯 (+ button reveals more options)
  - Each reaction is sent to host with listener email/name and total count
  - Reactions appear in host's listener list (replacing previous reaction)
- **Text chat** (engagement + moderation):
  - **Limit: 50 characters per message** (hardcoded `slice(0, 50)`; UI shows live counter `/50`)
  - Messages indexed by room; host can see full history on room join (`listener:request-messages`)
  - Each message includes timestamp, listener email, and extracted display name (email prefix)
  - Messages sent only to host (not broadcast to other listeners)
  - All chat persists in-memory per room (cleared when room expires)

### Host Dashboard
- **Stream controls**:
  - **Start**: Capture system audio or mic; display list of available STUN/TURN servers
  - **Pause/Resume**: Toggle audio without disconnecting listeners (Socket.IO emits `host:paused`/`host:resumed`)
  - **Stop**: Close all peer connections, delete room, invalidate cache
- **Audience management**:
  - Real-time listener list with email/name, connection state (new/connecting/connected/failed), and reaction
  - Per-listener remove button: kicks listener, deletes room state, sends `host:removed` event
  - Automatic reconciliation: Periodically polls `/api/rooms/:roomId/listeners` and heals missed join/leave events
- **Room info**:
  - Display room code + auto-generate QR code (for easy mobile sharing)
  - Session duration timer (counts up; human-readable MM:SS format)
  - Connection state per listener (helps diagnose trouble)
- **ICE diagnostics**:
  - Log all ICE candidate types (host/srflx/relay) to browser console for troubleshooting
  - Warning if TURN not configured (relay candidates won't appear)

### Listener Room (Audio Reception)
- **Connection state machine**:
  - Status: connecting → listening → paused → ended (or error)
  - WebRTC state: new → connecting → connected → disconnected/failed/closed
- **Audio setup**:
  - Fetch TURN servers FIRST, then join room (prevents STUN-only offer race condition)
  - Automatic audio element lifecycle: reset on disconnect, auto-play on track arrival
  - Volume meter + basic playback controls (pause/resume via host, not listener-direct)
- **Engagement UI**:
  - Reaction button + drawer with quick + extra emoji options
  - Chat input (50 char limit, live counter, send on Enter)
  - Message history not shown to listeners (only host sees chat)
- **Error handling**:
  - Graceful reconnection on network change (iOS/Android network switch)
  - Recovery timer prevents spam; logs disconnect/reconnect attempts
  - User-friendly error messages (network problem vs. room full vs. host unavailable)

### Backend Architecture
- **Express.js API**:
  - RESTful endpoints for room CRUD, listener snapshots, ICE servers, auth, and pub/sub
  - Socket.IO for real-time signaling (WebRTC offers/answers/ICE candidates)
  - Built-in CORS allowlist (comma-separated FRONTEND_URL support for multi-domain deploy)
  - Helmet.js for security headers (CSP disabled for frontend flexibility)
- **Session storage**:
  - Redis-backed sessions (on Render/production)
  - Ephemeral in-memory fallback (when Redis unavailable/disabled)
  - 24-hour session TTL; user identity persists across requests
- **Distributed features** (Redis Pub/Sub + adapters):
  - **Session store**: `express-session` → Redis (`heartogether.sid` cookies)
  - **Room state cache**: `GET /api/rooms/:code` uses cache-aside (Redis Strings); 15-second TTL
  - **Rate limiting**: Distributed counters (Redis INCR) for abuse prevention
  - **Realtime state**: Active user sets (Redis Sets) + signaling queues (Redis Lists) per room
  - **Event propagation**: Pub/Sub channel `room-events` for multi-instance deployments
- **Graceful degradation**:
  - If Redis down: app continues; sessions ephemeral, rate-limiting fail-open, state non-persisted
  - Health check always returns 200 OK immediately (Redis init runs async)
  - No startup 503 window on cold deploy (HTTP port opens before Redis ready)

### Security & Rate Limiting
- **Authentication**: Google OAuth 2.0 + JWT validation on protected endpoints
- **Authorization**:
  - Only room host can pause/resume/stop (checked via socket.data)
  - Only room host can view listener list (verified by user email/id match)
  - Listeners cannot send arbitrary messages (role check: `socket.data.role === 'listener'`)
- **Rate limiting** (per-IP):
  - Room creation (`POST /api/rooms`): 30 requests / 10-minute window
  - Room lookup (`GET /api/rooms/:code`): 120 requests / 5-minute window
  - Fail-open: Rate limiter skipped if Redis unavailable (prevents lockout)
- **Input validation**:
  - Room code sanitized: alphanumeric only, uppercase, max 20 chars
  - Chat & reaction text trimmed + sliced to 50 chars
  - ICE URL normalization: rejects invalid schemes, auto-adds `turn:` prefix if needed

### Deployment Ready
- **Vercel (frontend)**:
  - Zero-config Vite build
  - Environment: `VITE_BACKEND_URL`, `VITE_GOOGLE_CLIENT_ID`
  - Automatic HTTPS + CDN
- **Render (backend)**:
  - Background Redis init prevents startup 503 window
  - Automatic restart on crash
  - Environment: All `REDIS_*`, `GOOGLE_*`, `TURN_*`, `PORT`, `JWT_SECRET`, etc.
  - Custom health endpoint (`/api/health`) for Render health checks
- **Local development**:
  - Dual dev servers: `npm run dev` in server/ and client/ (separate terminals)
  - Default ports: 5000 (backend), 5173 (frontend)
  - Redis optional; app works without it (in-memory fallback)

## Tech Stack & Architecture

### Frontend
- **React 18**: Modern hooks API for state management and lifecycle
- **Vite 5**: Lightning-fast dev server + production build (< 12s build time)
- **TailwindCSS 3**: Utility-first styling with dark mode support
- **Socket.IO Client**: Real-time signaling for WebRTC offers/answers/ICE candidates
- **Axios**: HTTP client for REST API calls (room CRUD, ICE servers, auth)
- **WebRTC API**: Peer-to-peer audio streaming (native browser API, no polyfills needed)
- **localStorage**: Stores auth tokens + persists user preferences

### Backend
- **Node.js** (LTS): Runtime environment
- **Express 4.x**: HTTP server for REST APIs
- **Socket.IO 4.x**: WebRTC signaling transport (events: offer, answer, ice-candidate, etc.)
- **Passport.js**: Google OAuth 2.0 authentication (passport-google-oauth20)
- **JWT (jsonwebtoken)**: Stateless token generation + verification
- **Redis 6+** (optional, production): Session store, pub/sub, rate limiting, caching
  - Providers: Upstash, Redis Cloud, AWS ElastiCache, Azure Cache for Redis
  - Auto-detects TLS; falls back gracefully if unavailable
- **Helmet.js**: Security headers (CSP, X-Frame-Options, etc.)
- **CORS**: Access control for cross-origin requests
- **Cookie-parser**: HTTP-only cookie handling for auth tokens

### WebRTC & Networking
- **Opus codec**: Industry-standard audio compression; hardcoded for optimal quality/bitrate tradeoff
- **STUN servers**: 4 Google public servers (free) for NAT traversal
- **TURN relay**: ExpressTurn (or any TURN provider) for firewall bypass
- **ICE candidate gathering**: Pre-fetched (pool size=4) before peer creation
- **Adaptive bitrate**: Network-aware bitrate tuning (2G→20k, 3G→28k, 4G→64k bps)

### Deployment Platforms
- **Vercel** (frontend): Automatic Git deploys, zero-config Vite, global CDN
- **Render** (backend): Docker-based service, managed PostgreSQL/Redis integration, custom health checks

## Core API Endpoints

### Authentication
| Method | Endpoint | Auth | Rate Limit | Description |
|--------|----------|------|-----------|-------------|
| GET | `/auth/google` | - | - | Initiate Google OAuth flow |
| GET | `/auth/google/callback` | - | - | Google OAuth callback (redirects to frontend with token) |
| GET | `/auth/status` | - | - | Check if user authenticated (uses cookie or Bearer token) |
| GET | `/auth/me` | ✓ | - | Retrieve current user profile |
| POST | `/auth/logout` | ✓ | - | Clear session + cookie; emit logout |

### Rooms
| Method | Endpoint | Auth | Rate Limit | Description |
|--------|----------|------|-----------|-------------|
| POST | `/api/rooms` | ✓ | 30/10min | Create new room (returns `{id, code, createdAt}`) |
| GET | `/api/rooms/:code` | - | 120/5min | Public room lookup (returns `{id, code, hostConnected, listenerCount, isFull, fetchedAt}`); **cache: 15s** |
| GET | `/api/rooms/:roomId/listeners` | ✓ | - | Canonical listener snapshot for host only (returns array of listeners with socket ID, email, reaction, etc.) |
| GET | `/api/rooms/:roomId/realtime` | ✓ | - | Redis diagnostics (active users, recent signals, Redis connection status) |

### System & Config
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | - | Server liveness check (always `200 OK`) |
| GET | `/api/system/redis` | - | Redis connectivity status + URL (redacted password) |
| GET | `/api/ice-servers` | - | STUN + TURN configuration (cached 5 minutes) |
| POST | `/api/events/publish` | ✓ | Publish to Redis Pub/Sub channel (payload: `{channel, payload}`) |

## Socket.IO Events

### Host (Broadcasting)
| Event | Sent By | Payload | Description |
|-------|---------|---------|-------------|
| `host:create` | Frontend | `{roomId}` | Host joins room to start streaming |
| `host:listener-joined` | Backend | `{listenerId, email, name, joinedAt}` | Listener connected to peer |
| `host:listener-left` | Backend | `{listenerId}` | Listener disconnected |
| `host:paused` | Listener | - | Host paused audio (broadcast to room) |
| `host:resumed` | Listener | - | Host resumed audio (broadcast to room) |
| `host:stopped` | Listener | - | Host stopped broadcasting (delete room) |
| `listener:reaction` | Backend | `{listenerId, reaction, listenerEmail, listenerName, listenerCount}` | Listener sent reaction emoji |
| `listener:message` | Backend | `{listenerId, text, timestamp, listenerEmail, listenerName}` | Listener sent chat message |
| `room:listener-count` | Backend | `{roomId, listenerCount}` | Real-time count update (on join/leave/remove) |
| `signal:offer` | Listener | `{from, to, offer}` | WebRTC offer from host to listener |
| `signal:answer` | Listener | `{from, to, answer}` | WebRTC answer from listener to host |
| `signal:ice-candidate` | Listener | `{from, to, candidate}` | ICE candidate exchange |

### Listener (Receiving)
| Event | Sent By | Description |
|-------|---------|-------------|
| `listener:join` | Frontend | Listener requests to join room |
| `listener:reaction` | Frontend | Send emoji reaction (payload: `reaction`) |
| `listener:send-message` | Frontend | Send chat (payload: `{text}`) |
| `listener:request-messages` | Frontend | Fetch chat history on room join |
| `host:paused` | Backend | Host paused audio |
| `host:resumed` | Backend | Host resumed audio |
| `host:stopped` | Backend | Host stopped; room is closing |
| `host:removed` | Backend | Listener was removed by host |
| `signal:offer` | Backend | Receive WebRTC offer from host |
| `signal:answer` | Backend | Not used (only host sends answer) |
| `signal:ice-candidate` | Backend | Receive ICE candidate from host |

## Environment Variables (Detailed)

### Backend (`server/.env`)

```env
# Server Configuration
NODE_ENV=development                              # or production
PORT=5000                                         # HTTP listen port
FRONTEND_URL=http://localhost:5173                # CORS origin(s), comma-separated for multi-domain

# Google OAuth 2.0
GOOGLE_CLIENT_ID=your_google_client_id            # From Google Cloud Console
GOOGLE_CLIENT_SECRET=your_google_client_secret    # From Google Cloud Console
GOOGLE_CALLBACK_URL=http://localhost:5000/auth/google/callback  # Must match OAuth redirect URI in Google Cloud

# Authentication & Tokens
JWT_SECRET=your_long_random_secret_min_32_chars   # Used for JWT signing; minimum 32 chars recommended
AUTH_WARM_UP_TIMEOUT_MS=150000                    # 2.5 min timeout for backend health probes before OAuth
AUTH_COOKIE_TIMEOUT=86400                         # 24 hours; session cookie expiration (seconds)

# Redis Configuration (Optional; defaults to in-memory if disabled)
REDIS_ENABLED=false                               # Set true in production with managed Redis
REDIS_URL=redis://localhost:6379                  # Local dev: redis://<host>:<port>; Production: rediss://<user>:<pass>@<host>:<port>
REDIS_CONNECT_TIMEOUT_MS=4000                     # Per-connection timeout (milliseconds)
REDIS_TLS=                                        # Leave blank for auto-detect from rediss:// URL scheme; set true/false to override
REDIS_TLS_REJECT_UNAUTHORIZED=true                # Set false if managed provider has certificate issues

# Session Store Configuration (only used when REDIS_ENABLED=true)
SESSION_SECRET=your_long_random_secret            # Separate from JWT_SECRET for independent rotation
SESSION_COOKIE_SECURE=false                       # Set true in production with HTTPS
SESSION_TTL_SECONDS=86400                         # 24 hours; how long sessions persist
SESSION_TTL_MS=86400000                           # 24 hours in milliseconds
SESSION_COOKIE_NAME=heartogether.sid              # Cookie name (visible in browser dev tools)

# Room Lifecycle Configuration
MAX_LISTENERS=30                                  # Maximum concurrent listeners per room (prevents WebRTC CPU exhaustion)
ROOM_TTL_MS=3600000                               # 60 minutes (milliseconds); rooms auto-expire after inactivity

# TURN Relay Configuration (Optional; required for mobile/cellular audio)
TURN_PROVIDER=ExpressTurn                         # Relay provider name (for docs; not parsed by code)
EXPRESSTURN_URLS=turn:relay:3478,turn:relay:3478?transport=tcp,turns:relay:5349  # CSV of TURN URLs
EXPRESSTURN_USERNAME=your_turn_username           # TURN auth username
EXPRESSTURN_CREDENTIAL=your_turn_credential       # TURN auth credential (password)
# Legacy support (don't mix with EXPRESSTURN_* vars):
# TURN_URLS=...
# TURN_USERNAME=...
# TURN_CREDENTIAL=...

# Rate Limiting (Distributed if Redis enabled)
RATE_LIMIT_REQUESTS=30                            # Max room creations per window
RATE_LIMIT_WINDOW_MS=600000                       # 10 minutes per window (milliseconds)
RATE_LIMIT_LOOKUP_REQUESTS=120                    # Max room lookups per window
RATE_LIMIT_LOOKUP_WINDOW_MS=300000                # 5 minutes per window (milliseconds)
```

### Frontend (`client/.env`)

```env
VITE_BACKEND_URL=http://localhost:5000            # Backend API base URL (must match FRONTEND_URL on backend)
VITE_GOOGLE_CLIENT_ID=your_google_client_id       # Must match GOOGLE_CLIENT_ID on backend
VITE_ENABLE_DEBUG_LOGS=false                      # Set true for verbose console logs (React, WebRTC, Socket.IO)
```

## Project Structure

```
HearTogether/
├── README.md                          # This file (comprehensive project documentation)
├── LICENSE                            # MIT license
│
├── client/                            # React + Vite frontend
│   ├── src/
│   │   ├── main.jsx                  # App entry point
│   │   ├── App.jsx                   # Root component + routing
│   │   ├── index.css                 # Global styles (TailwindCSS imports)
│   │   ├── context/
│   │   │   └── AuthContext.jsx       # Google OAuth flow + backend warm-up logic
│   │   ├── pages/
│   │   │   ├── LandingPage.jsx       # Homepage: create/join room UI
│   │   │   ├── JoinPage.jsx          # Room preview page (public, before join)
│   │   │   ├── HostRoom.jsx          # Host dashboard + streaming controls
│   │   │   ├── ListenerRoom.jsx      # Listener receiver + engagement UI
│   │   │   └── LoginPage.jsx         # Dedicated sign-in page
│   │   ├── components/
│   │   │   ├── AuthBootOverlay.jsx   # Spinner overlay during OAuth warm-up
│   │   │   ├── InteractiveWavesBackground.jsx  # Animated canvas waves
│   │   │   ├── UserProfile.jsx       # User menu (profile/logout)
│   │   │   └── ui/
│   │   │       ├── docks.jsx         # Theme toggle dock
│   │   │       ├── shimmer-button.jsx # Animated button with shimmer effect
│   │   │       ├── spotlight-card.jsx # Card with spotlight hover effect
│   │   │       ├── skeleton.jsx      # Loading skeleton UI
│   │   │       ├── theme-toggle.jsx  # Dark/light mode toggle
│   │   │       └── toast.jsx         # Toast notifications (info/error/warning)
│   │   ├── hooks/
│   │   │   ├── useMobile.js          # Mobile device detection
│   │   │   └── useWebRTC.js          # WebRTC peer connection hooks (host + listener)
│   │   ├── services/
│   │   │   ├── api.js                # Axios instance + REST API functions
│   │   │   └── socket.js             # Socket.IO client connection
│   │   └── lib/
│   │       ├── config.js             # Frontend constants/config
│   │       ├── logger.js             # debugLog/warnLog/errorLog wrappers
│   │       └── utils.js              # Utility functions
│   │
│   ├── public/
│   │   ├── manifest.webmanifest      # PWA manifest (optional)
│   │   ├── sw.js                     # Service worker (minimal; no caching yet)
│   │   └── manual/                   # Additional assets
│   │
│   ├── package.json                  # Node dependencies
│   ├── vite.config.js                # Vite build config
│   ├── tailwind.config.js            # TailwindCSS theme customization
│   ├── postcss.config.js             # PostCSS plugins (TailwindCSS)
│   ├── vercel.json                   # Vercel deployment config
│   └── .env.example                  # Example environment variables
│
├── server/                           # Express + Socket.IO backend
│   ├── src/
│   │   ├── index.js                  # Main server file (Express app, Socket.IO, API endpoints)
│   │   ├── auth.js                   # JWT creation/verification + auth middleware
│   │   ├── rooms.js                  # In-memory room state management (CRUD operations)
│   │   └── redis/
│   │       ├── client.js             # Redis connection lifecycle (TLS-aware auto-detect)
│   │       ├── session.js            # Redis session store middleware
│   │       ├── cache.js              # Cache-aside helpers (TTL, cache invalidation)
│   │       ├── rateLimit.js          # Distributed rate limiting middleware
│   │       ├── pubsub.js             # Pub/Sub event bus helpers
│   │       └── realtime.js           # Active user sets + signal queues (Redis Lists/Sets)
│   │
│   ├── package.json                  # Node dependencies
│   ├── .env.example                  # Example environment variables
│   └── .eslintrc.json                # ESLint config for code quality
│
└── .git/                             # Git repository (GitHub origin)
```

## Runtime Execution Flow

### Startup Sequence
1. **Backend boot** (`npm run dev` or `npm start`):
   - Parse `.env` files
   - Initialize Redis connection in **background** (does NOT block HTTP port binding)
   - Bind HTTP server to `PORT` immediately (`/api/health` returns 200 OK)
   - Load session middleware (uses Redis store if connected, else ephemeral)
   - Initialize Socket.IO with CORS allowlist
   - Schedule hourly room cleanup task
   - Log: `[express] Server listening on port 5000`

2. **Frontend boot** (`npm run dev`):
   - Load `.env` variables
   - Initialize Vite dev server on port 5173
   - Render LandingPage component

3. **Frontend connect** (user opens http://localhost:5173):
   - AuthContext starts OAuth warm-up probe (dual endpoint validation)
   - If backend ready: user can create/join rooms
   - If backend not ready (503): show auth error overlay

### User Flow: Host Broadcasting
1. **Frontend**: Click "Create Room" → authenticated POST `/api/rooms` → redirects to `/host/{roomId}`
2. **HostRoom component**:
   - Fetch ICE servers (STUN + TURN)
   - Prompt user: System Audio or Microphone capture
   - Create WebRTC PeerConnection (+ Opus codec preferences)
   - Emit `host:create` socket event
3. **Backend**:
   - Create room data structure
   - Register host socket in room
   - Wait for first listener offer
4. **Host** adds listener (when listener joins):
   - Create new PeerConnection for that listener
   - Create offer (ICE candidates pre-gathered)
   - Emit `signal:offer` to listener
5. **Listener**:
   - Receives `signal:offer`
   - Create PeerConnection
   - Create answer
   - Emit `signal:answer` back through backend
6. **Host**:
   - Receives `signal:answer`
   - Set remote description
   - Candidates exchanged bidirectionally
   - Once ICE connected: `connectionState: connected`
   - Remote track received → `ontrack` fires → audio element plays

### User Flow: Listener Joining
1. **Frontend**: Join by code → preview room → click "Join"
2. **ListenerRoom component**:
   - Fetch ICE servers
   - Wait for `iceReady=true`
   - Emit `listener:join` socket event
3. **Backend**:
   - Validate room exists + not full
   - Add listener to room
   - Emit `host:listener-joined` event to host
   - Emit `room:listener-count` to room
4. **Host** creates offer for new listener (see flow above)
5. **Listener** sends chat/reactions (emitted to host only)

## Running Locally

### Prerequisites
- **Node.js** 16+ (run `node -v`)
- **Redis** (optional for local dev; app works without it)
  - macOS: `brew install redis && brew services start redis`
  - Linux: `sudo apt install redis-server && sudo systemctl start redis`
  - Windows: `docker run -dp 6379:6379 redis:7`

### Setup Steps

1. **Clone & install**:
   ```bash
   git clone https://github.com/Nandan-k-s-27/HearTogether.git
   cd HearTogether
   
   # Backend
   cd server
   npm install
   
   # Frontend  
   cd ../client
   npm install
   cd ..
   ```

2. **Create `.env` files**:
   ```bash
   # Backend
   cp server/.env.example server/.env
   # Edit server/.env with your Google OAuth credentials
   
   # Frontend
   cp client/.env.example client/.env
   # Edit client/.env with matching BACKEND_URL + GOOGLE_CLIENT_ID
   ```

3. **Configure Google OAuth**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create OAuth 2.0 credentials (Web application)
   - Add authorized redirect URIs:
     - `http://localhost:5000/auth/google/callback` (local dev)
     - `https://your-backend.onrender.com/auth/google/callback` (production)
   - Add authorized JavaScript origins:
     - `http://localhost:5173` (local dev)
     - `https://your-frontend.vercel.app` (production)
   - Copy Client ID + Secret to `.env` files

4. **Run dev servers** (open 2 terminals):
   ```bash
   # Terminal 1: Backend
   cd server
   npm run dev
   # Logs: [express] Server listening on port 5000
   
   # Terminal 2: Frontend
   cd client
   npm run dev
   # Logs: Local: http://localhost:5173/
   ```

5. **Test**:
   - Open http://localhost:5173 in browser
   - Sign in with Google
   - Create room → Share code with another browser/device
   - Start streaming → Click "Join" on listener
   - Send reactions + chat messages

## Redis Integration & Caching

### What Redis provides
- **In-memory data store**: Sub-millisecond reads/writes for realtime features
- **Data structures**:
  - **Strings**: Cache entries (room lookup), rate-limit counters
  - **Sets**: Active user IDs per room (join/leave operations)
  - **Lists**: Recent signaling events per room (diagnostics)
  - **Hashes/Sorted Sets**: Available for future leaderboards/telemetry

### HearTogether Redis features
1. **Cache-aside room lookup** (`GET /api/rooms/:code`):
   - First request fetches from memory, stores in Redis (15 sec TTL)
   - Subsequent requests hit Redis cache (marked `X-Cache: HIT`)
   - Cache invalidated on room creation/deletion
   - Fallback: If Redis down, always fetch from memory (fail-open)

2. **Session persistence** (optional, production only):
   - Express-session middleware backed by Redis
   - User identity persists across server restart
   - 24-hour TTL (`SESSION_TTL_SECONDS`)
   - Fallback: Ephemeral in-memory sessions if Redis unavailable

3. **Distributed rate limiting**: Shared state across multiple instances
   - Room creation: 30 requests per 10-minute window (per IP)
   - Room lookup: 120 requests per 5-minute window (per IP)
   - Redis `INCR` counters with expiration
   - Fail-open: If Redis down, rate limiter skipped (prevents lockout)

4. **Pub/Sub event propagation** (multi-instance deployments):
   - Channel: `room-events` (listener reactions, messages, host state changes)
   - Enables real-time updates across multiple backend instances
   - Optional; app works without it (local events only)

5. **Realtime diagnostics** (`GET /api/rooms/:roomId/realtime`):
   - Active user count per room (from Redis SET)
   - Recent signaling events (from Redis LIST, max 30)
   - Redis connection status (for health monitoring)

### Redis setup & deployment

**Local development** (Redis optional; app auto-disables):
```bash
# macOS (homebrew)
brew install redis
brew services start redis

# Linux (systemd)
sudo apt-get install redis-server
sudo systemctl start redis-server

# Windows (Docker)
docker run -d --name heartogether-redis -p 6379:6379 redis:7
```

**Production configuration**:
Set these environment variables on your deployment platform (Render, etc.):

```env
# Enable Redis for production
REDIS_ENABLED=true

# Connection string (auto-detects TLS from rediss:// scheme)
REDIS_URL=rediss://default:<password>@<host>:<port>

# Optional: Override TLS detection
REDIS_TLS=true                          # Force TLS on/off (auto-detect if blank)
REDIS_TLS_REJECT_UNAUTHORIZED=true      # Set false only for self-signed certs

# Connection timeout
REDIS_CONNECT_TIMEOUT_MS=4000           # 4 seconds per attempt
```

**Managed Redis providers** (recommended):
- **Upstash**: Free tier (10K commands/day); uses `rediss://` URLs with auto-TLS
- **Redis Cloud**: Free tier (30 MB); flexible scaling
- **AWS ElastiCache**: VPC-isolated; auto-TLS via `rediss://` URLs
- **Azure Cache for Redis**: Azure-managed; TLS required

All support TLS auto-detection via `rediss://` scheme. The app normalizes URLs and socket options automatically.

**Initialization & graceful degradation**:
- Redis init starts immediately on backend boot (background; doesn't block HTTP port)
- HTTP health check returns 200 OK regardless of Redis status
- If Redis connects: session/cache/rate-limiting/pub-sub all active
- If Redis unavailable: app continues with in-memory fallback (no data persistence)
- Idempotent double-init prevented by promise caching (safe for multi-instance)

## Project Structure

```
HearTogether/
├── client/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── context/AuthContext.jsx
│   │   ├── pages/
│   │   │   ├── LandingPage.jsx
│   │   │   ├── JoinPage.jsx
│   │   │   ├── HostRoom.jsx
│   │   │   ├── ListenerRoom.jsx
│   │   │   └── LoginPage.jsx
│   │   ├── services/
│   │   │   ├── api.js
│   │   │   └── socket.js
│   │   └── components/
│   └── package.json
├── server/
│   ├── src/
│   │   ├── index.js
│   │   ├── auth.js
│   │   └── rooms.js
│   └── package.json
└── README.md
```

## Component Architecture & Rendering

### Frontend Routes
| Route | Component | Access | Description |
|-------|-----------|--------|-------------|
| `/` | LandingPage | Public | Homepage: room creation + join UI |
| `/room/:code` | JoinPage | Public | Room preview: wait for host OR join if connected |
| `/listen/:code` | ListenerRoom | Protected | Listener receiving room (audio + chat + reactions) |
| `/host/:roomId` | HostRoom | Protected | Host dashboard (stream controls + listener list) |
| `/login` | LoginPage | Public | Dedicated OAuth sign-in page |

### Key Components
- **AuthContext**: Manages Google OAuth flow, JWT tokens, session persistence, warm-up probes
- **HostRoom**: Streaming controls (start/pause/resume/stop), listener list + removal, QR code generation
- **ListenerRoom**: Audio player, reaction emoji drawer, chat input (50 char limit), connection state UI
- **useWebRTC hooks**: Encapsulate WebRTC PeerConnection lifecycle (host creates offers; listener creates answers)
- **Toast notifications**: Errors, warnings, info messages (auto-dismiss in 5 seconds)

### UI Library Components
- **ShimmerButton**: Animated button with shimmer effect (primary actions)
- **GlowCard**: Card container with spotlight hover effect (room info, listener cards)
- **SkeletonBox**: Loading placeholder (while fetching data)
- **DockBar**: Horizontal menu dock (theme toggle, etc.)
- **ThemeToggle**: Dark/light mode switcher (persisted to localStorage)

## Production Deployment

### Vercel (Frontend)

1. **Connect Git repository** at https://vercel.com
2. **Configure**:
   - **Root Directory**: `client`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Environment Variables**:
     ```env
     VITE_BACKEND_URL=https://your-backend.onrender.com
     VITE_GOOGLE_CLIENT_ID=your_google_client_id
     ```

3. **Deploy**: Push to `main` branch → auto-deploy (zero-config)

4. **Logs**: View build/deployment logs in Vercel dashboard

### Render (Backend)

1. **Create service** at https://render.com
2. **Configure**:
   - **Runtime**: Node.js (auto-detected)
   - **Build Command**: `npm install && npm run build` (or skip if no build)
   - **Start Command**: `npm start` or `npm run dev` (not recommended for production)
   - **Region**: Choose closest to your users
   - **Plan**: Free tier (with inactivity sleep) or paid tier (always running)

3. **Environment Variables** (set in Render dashboard):
   ```env
   NODE_ENV=production
   PORT=10000
   FRONTEND_URL=https://your-frontend.vercel.app
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   GOOGLE_CALLBACK_URL=https://your-backend.onrender.com/auth/google/callback
   JWT_SECRET=your_long_random_secret_min_32_chars
   REDIS_ENABLED=true
   REDIS_URL=rediss://...
   TURN_PROVIDER=ExpressTurn
   EXPRESSTURN_URLS=turn:your-relay:3478
   EXPRESSTURN_USERNAME=...
   EXPRESSTURN_CREDENTIAL=...
   ```

4. **Deploy**: Push to GitHub → Render auto-detects and deploys

5. **Health checks**:
   - Render pings `/api/health` every 30 seconds
   - If 503 for > 5 min → service marked down
   - Our code ensures HTTP port opens immediately (even if Redis still initializing)

### Environment Variables (Detail)

See **Environment Variables (Detailed)** section above for complete `.env` documentation.

## Backend Module Reference

### Redis Modules (`server/src/redis/`)
- **client.js** (148 lines):
  - `initRedis()`: Connect with TLS auto-detect, idempotent promise caching
  - `closeRedis()`: Graceful shutdown
  - `isRedisReady()`: Check connection status
  - `getRedisClient()`, `getRedisPublisher()`, `getRedisSubscriber()`: Get connection instances
  - `getRedisSocketOptions()`: Auto-detect TLS from URL or production environment flag

- **session.js** (60 lines):
  - `createSessionMiddleware()`: Express-session with RedisStore or ephemeral fallback
  - Auto-selects store based on `REDIS_ENABLED` + connection status

- **cache.js** (80 lines):
  - `buildCacheKey()`: Namespaced key generation
  - `getOrSetJSON()`: Cache-aside pattern with TTL (returns `{data, cacheHit}`)
  - `deleteKey()`: Cache invalidation

- **rateLimit.js** (100 lines):
  - `createRedisRateLimiter()`: Express middleware for distributed rate limiting
  - Per-IP counters with sliding window (Redis INCR + expiration)
  - Fails gracefully if Redis unavailable

- **pubsub.js** (50 lines):
  - `publishEvent()`: Send message to Redis channel
  - `subscribeEvent()`: Listen to channel messages

- **realtime.js** (100 lines):
  - `addActiveUser()`, `removeActiveUser()`: User presence tracking (Redis Sets)
  - `getActiveUserCount()`: Real-time listener count per room
  - `enqueueSignal()`, `getRecentSignals()`: Signal history (Redis Lists, max 30)

### Core Modules
- **index.js** (770 lines): Express server, Socket.IO, API endpoints, auth routes, room management
- **auth.js** (80 lines): JWT creation/verification, Passport Google OAuth, authMiddleware
- **rooms.js** (300 lines): In-memory room CRUD (Map-based storage, no persistence)

## Technical Reference & Implementation Details

### WebRTC Codec Configuration
- **Opus codec** (only choice in `setCodecPreferences`):
  - Sample rate: 48 kHz (optimal for speech + music)
  - Channels: Mono (stereo=0) for bandwidth efficiency
  - Forward Error Correction: Enabled (useinbandfec=1)
  - Discontinuous Transmission: Enabled (usedtx=1) — pauses transmission during silence
  - Min packet time: 10ms (minptime=10) for lower latency
  - Max average bitrate: 42 kbps (maxaveragebitrate) as upper bound
  - Network-aware bitrate adaptation:
    - 2G/slow-2g: 20 kbps (narrowband; sacrifices quality for reliability)
    - 3G: 28 kbps
    - 4G (< 2.5 Mbps): 42 kbps
    - 4G (≥ 2.5 Mbps): 64 kbps (default high quality)
  - *Note*: UDP transport (RTP/UDOP); UDP is preferred for low-latency unreliable delivery

### ICE Negotiation Strategy
- **Candidate pre-gathering**: Pool size = 4 (gathered before offer/answer exchange)
- **Bundle policy**: `max-bundle` (all tracks in single 5-tuple → single UDP flow)
- **ICE transport policy**: `all` (allows STUN, srflx reflexive, and TURN relay candidates)
- **STUN servers**: 4 Google public STUN servers (always available, fallback if no TURN)
- **TURN servers**: Configured via environment variables; required for mobile/NAT traversal

### Session & Cookie Handling
- **Token storage**: HTTP-only cookies (not accessible via JavaScript; immune to XSS)
- **Fallback**: Authorization header (Bearer token) for API clients
- **SSO behavior**: Both cookie + bearer token accepted; session cookie persists across restarts if Redis enabled
- **CSRF protection**: Not implemented (single-origin API for MVP; can be added with csrf middleware)

### Browser Compatibility
- **WebRTC**: Chrome/Edge 50+, Firefox 22+, Safari 11+ (iOS 11+)
- **Display Media**: Not available on Firefox mobile (system audio capture desktop-only)
- **Features with graceful degradation**:
  - Microphone capture: All browsers
  - Opus codec preferences: Chrome/Firefox (fallback to provider default in Safari)
  - Audio processing (bitrate shaping): Most modern browsers
  - Orientation Lock API: iOS Safari only (Android auto-handled)
  - Screen WakeLock API: Chrome/Edge (prevents screen sleep during streaming)

### Performance Optimizations
- **Lazy code-splitting**: React Router loads components on demand
- **CSS-in-JS**: TailwindCSS generated at build time (no runtime overhead)
- **Build output**: ~352 kB JS (Vite production build), ~31 kB CSS
- **Tree-shaking**: Unused Socket.IO plugins removed in build
- **Caching**: Browser cache for static assets (index.html, JS, CSS)

### Scalability Limitations & Solutions
- **Single-server bottleneck**: Room state in-memory (doesn't scale beyond 1 process)
  - **Solution**: Distribute room state to Redis (coming soon; structure ready)
  - **Workaround**: Deploy multiple backends + load balance by room code hash
- **Listener limit per room**: 30 (default) to prevent CPU exhaustion on free tier
  - **Solution**: Increase `MAX_LISTENERS` for powerful servers (100+ listeners possible)
- **TURN relay capacity**: Shared relay (single provider)
  - **Solution**: Add multiple TURN URLs for geographic failover
- **Firebase/Auth0 dependency**: Google OAuth tied to single client ID
  - **Solution**: Add custom auth backend (email/password) as alternative

### Security Considerations
- **No CSRF token**: Cross-site requests use `SameSite=Lax` cookies (default)
- **No rate limiting on WebRTC**: Offers/answers not rate-limited (flood risk)
- **No message encryption**: Chat/reactions transmitted in plaintext (Socket.IO TLS recommended)
- **TURN credential leakage**: Credentials sent to all clients (consider time-limited tokens)
- **Google OAuth redirect**: No state parameter to prevent CSRF (low risk for SPA; can be added)

### Browser Console Warnings (Expected)
- **"Self-XSS"**: Security pedagogy from Google Chrome (not a real vulnerability)
- **Service Worker notice**: Our minimalist SW doesn't intercept fetches (placeholder for future)
- **Console statements**: `debugLog` wrappers logged in development (optimized out in production if minified)

## Troubleshooting

### OAuth Sign-In Not Redirecting to Google

**Symptom**: "Waking audio engine" overlay appears → timeout or redirect to error page instead of Google OAuth.

**Diagnosis**:
1. Open browser DevTools (F12) → Console tab
2. Look for: `[AuthContext] Probing /api/health` and `[AuthContext] Probing /auth/status`
3. Check if either returns 503 or times out

**Solutions**:

**Issue #1: Backend not responding (503 Service Unavailable)**
- **Cause**: Backend crashed, restarting, or network unreachable
- **Check**:
  ```bash
  # Test backend health
  curl https://your-backend.onrender.com/api/health
  # Expected: {"status": "ok"} (200 OK)
  ```
- **Fix**:
  - If Render → Wait 30-60 seconds (cold start); check deployment logs
  - If local → Ensure backend running: `cd server && npm run dev`
  - Check backend `.env` has `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`

**Issue #2: Backend ready but `/auth/status` fails (401/403)**
- **Cause**: Google OAuth not configured or callback URL doesn't match
- **Check**:
  - In [Google Cloud Console](https://console.cloud.google.com/), verify:
    - Client ID + Secret are correct and not disabled
    - Authorized redirect URIs include `https://your-backend.onrender.com/auth/google/callback`
    - Authorized JavaScript origins include your frontend domain
- **Fix**: Update Google Cloud Console OR update backend env vars

**Issue #3: Backend warm-up timeout exceeded (> 150 seconds)**
- **Cause**: Backend taking too long to initialize (rare)
- **Check**: Render deployment logs for slow startup
- **Fix**:
  - Increase `AUTH_WARM_UP_TIMEOUT_MS` in frontend `.env` (if deployed)
  - OR check Render free tier restarting (check "Activity" tab)

**Issue #4: CORS error (Access-Control-Allow-Origin missing)**
- **Cause**: `FRONTEND_URL` backend env var doesn't match your frontend domain
- **Check**: Backend logs: `[cors] allowed origins: [your origin]`
- **Fix**:
  ```env
  # Backend .env
  FRONTEND_URL=https://your-frontend.vercel.app  # exact domain with https
  ```

### Listener Can't Receive Audio (Stuck on "Connecting")

**Symptom**: Listener connects to host room but no audio arrives; console shows "connectionState: connecting" indefinitely.

**Diagnosis** (check browser DevTools):
1. **Host console**:
   - Look for: `[WebRTC] stream exists, creating offer for <listener-id>`
   - Look for: `[WebRTC] adding X audio tracks to peer connection`
   - If `adding 0 audio tracks` → host didn't capture audio

2. **Listener console**:
   - Look for: `[ListenerRoom] received offer from <host-id>`
   - Look for: `[ICE listener←<host-id>] type=relay` (good) or only `type=host` (bad)
   - Look for: `[WebRTC] listener←<host-id> connectionState: connected` (never appears if bugs)

3. **Server Render logs**:
   - Look for: `[signal] offer from <host-id> → <listener-id>`
   - If missing → host didn't send offer (host-side bug)

**Solutions**:

**Issue #1: Host didn't capture audio**
- **Check**: Did host click "System Audio" or "Microphone"? Did browser show permission prompt?
- **Fix**:
  - Refresh host page, click "Start", select audio source again
  - Grant microphone/screen share permissions when browser asks
  - Verify audio device works: System Settings → Sound → Test output

**Issue #2: ICE candidates not arriving (no relay candidates)**
- **Check**: Listener console shows only `type=host`, no `type=relay`
- **Cause**: TURN server not configured or unreachable
- **Fix**:
  - Render backend env vars must have:
    ```env
    EXPRESSTURN_URLS=turn:relay:3478,turns:relay:5349
    EXPRESSTURN_USERNAME=...
    EXPRESSTURN_CREDENTIAL=...
    ```
  - Verify TURN server is reachable: `telnet your-relay 3478` (or use TURN test tool)
  - Suggest listener switch to WiFi (if on mobile hotspot)

**Issue #3: ICE candidates arriving but P2P negotiation failing**
- **Check**: Listener sees relay candidates but `connectionState` never reaches "connected"
- **Cause**: Firewall blocking TURN relay, or wrong TURN credentials
- **Fix**:
  - Confirm TURN server URL syntax: `turn:host:port` or `turns:host:port`
  - Test TURN manually: `turnutils_uclient -v -u user:credential -p XXXX your-relay`
  - Try different port (3478/tcp, 443/tcp, 5349/tcp)

**Issue #4: WebRTC connection fails without errors (state: failed)**
- **Check**: Listener console shows `connectionState: failed` (not connecting → failed)
- **Cause**: Both STUN + TURN failed; network severely restricted
- **Fix**:
  - Listener should switch networks (1G → WiFi, hotspot → WiFi)
  - Open port forwarding on home router (if behind restrictive NAT)
  - Suggest IPv6 connectivity test: http://test-ipv6.com

### Chat Messages Not Appearing (or Appearing as Blank)

**Symptom**: Listener sends message from 50-char input, nothing appears on host dashboard.

**Diagnosis**:
1. Listener console: `[ListenerRoom] sending message: "your text"`
2. Host console: `[HostRoom] received message from <listener-id>: "your text"`
3. Render backend logs: `[message] from <listener-id>: "your text"`

**Solutions**:

**Issue #1: Message exceeds 50 character limit**
- **Check**: Frontend input field shows `/50` counter
- **Expected**: If you type 51+ chars, input silently truncates to 50
- **Fix**: Delete characters, re-send

**Issue #2: Message not sending (send button disabled)**
- **Check**: Is `chatMessage` empty or only whitespace?
- **Fix**: Type message and clear whitespace around text

**Issue #3: Host not subscribed to room (host socket disconnected)**
- **Check**: Render logs → is host socket still active? Look for `[socket] disconnected`
- **Fix**: Host should refresh page, room, and chat history loads

### Emoji Reactions Not Updating

**Symptom**: Listener clicks emoji but host doesn't see reaction appear.

**Diagnosis**:
1. Listener console: `[ListenerRoom] sending reaction: 👍`
2. Host console: `[HostRoom] listener reaction: <id> 👍`
3. Check host listener card for emoji

**Solutions**:

**Issue #1: Reaction is empty/null**
- **Check**: Frontend allows 13 reactions total (5 quick + 8 extra)
- **Fix**: Click a visible emoji button (not already selected)

**Issue #2: Host listener list not updating**
- **Check**: Render logs → listener object in room state
- **Fix**: Host may need to manually refresh listener list (periodic sync runs every 5 sec)

### Redis Connection Failures (Backend still works but logging errors)

**Symptom**: Render logs show `[redis] connection failed` or `Socket closed unexpectedly` but app still runs.

**Diagnosis**:
1. Check Render dashboard → your backend service → logs
2. Look for: `[redis] connected` (success) or `Socket closed unexpectedly` (TLS fail)
3. Check: `GET /api/system/redis` returns `{connected: true/false, url: "..."}` (password redacted)

**Solutions**:

**Issue #1: Redis disabled intentionally**
```env
REDIS_ENABLED=false  # OK for dev; set true for production session persistence
```
- **Fix**: No action needed in development; set `REDIS_ENABLED=true` in production

**Issue #2: Redis URL wrong or outdated**
- **Check**: Is `REDIS_URL` a valid managed provider connection string?
  - Upstash: `rediss://default:<password>@<host>.<region>.upstash.io:6379`
  - Redis Cloud: `rediss://:password@host:port`
- **Fix**: Copy-paste connection string from provider dashboard

**Issue #3: TLS/certificate error (Socket closed unexpectedly)**
- **Check**: Provider requires TLS but app using `redis://` scheme (no TLS)
- **Fix**:
  - Use `rediss://` in connection string (double-s for TLS), OR
  - Set `REDIS_TLS=true` explicitly in `.env`
  - If provider has cert issues: `REDIS_TLS_REJECT_UNAUTHORIZED=false` (last resort)

**Issue #4: Network/firewall blocking Redis port**
- **Check**: Is Render backend allowed to reach Redis host + port?
- **Fix**:
  - For Upstash/Redis Cloud: They handle auth + whitelist automatically
  - For AWS/self-hosted: Add Render's outbound IP to security group

**Result**: If Redis fails, app continues with in-memory fallback:
- Sessions not persistent (lose login on server restart)
- Rate limiting skipped (DoS risk but app usable)
- Cache misses all lookups (slight latency)
- **No data loss** because critical data (rooms, chats) stay in memory

### Backend Startup 503 (Render Deployment Only)

**Symptom**: First request after deploy returns 503 Service Unavailable for 30-60 seconds.

**Cause**: Render health check runs before backend fully initializes (old behavior; fixed in current code).

**Current behavior** (HTTP port opens immediately):
- Health check (`/api/health`) returns 200 OK in < 100ms
- Redis init runs in background (not blocking port binding)
- Frontend OAuth warm-up succeeds immediately

**If you still see 503**:
- Check: Is your backend code from before commit `995b646`?
- Update code: Pull latest from GitHub
- Render auto-deploys from main branch → trigger redeploy

### Local Development Issues

**Issue: "Cannot find module" errors after git pull**
```
Error: Cannot find module 'socket.io'
```
- **Fix**: `npm install` in both `client/` and `server/` directories

**Issue: Port already in use (EADDRINUSE)**
```
Error: listen EADDRINUSE :::5000
```
- **Fix**: 
  - Kill existing process: `lsof -i :5000` → `kill -9 <PID>`
  - Or change port: `PORT=5001 npm run dev`

**Issue: ".env file not loaded"**
- **Fix**: Ensure file exists:
  - `server/.env` (backend)
  - `client/.env` (frontend)
  - Restart dev server after creating `.env`

**Issue: Google OAuth popup blocked**
- **Fix**: Popup blocker disabled for localhost:5173 in browser settings
- Or: Use incognito window (no extensions)

### Performance Issues

**Issue: Browser WebRTC tab uses 100% CPU**
- **Cause**: Too many listeners (exceeds WebRTC CPU limits)
- **Fix**:
  - Host: Reduce number of listeners (ask some to leave)
  - Admin: Increase `MAX_LISTENERS` if server powerful
  - User: Upgrade device or use dedicated hardware

**Issue: Audio stuttering/breaks on listener**
- **Cause**: Low bandwidth, high latency, or packet loss
- **Check**:
  - Network speed test: https://www.speedtest.net
  - Latency: Check DevTools → Network → latency to endpoint
  - Switch to WiFi (if on 4G)
- **Fix**:
  - Host: Stop other apps using internet
  - Infrastructure: Add TURN relay if none configured

**Issue: Build/dev server very slow**
- **Cause**: `npm install` dependencies or source file watch
- **Fix**:
  - Clear node_modules cache: `rm -rf node_modules/*/.cache`
  - Restart dev server: `Ctrl+C` → `npm run dev`
  - Check disk space: `df -h`

## Contributing & Future Roadmap

### Known Limitations
- **Single-server room state**: Doesn't scale beyond 1 backend instance (in-memory storage)
- **No message history**: Chat messages lost on room deletion
- **No room recording**: Audio/video not recorded
- **Mobile audio input**: Microphone capture works; system audio capture not available
- **IPv6**: Limited ICE candidate generation for IPv6-only networks

### Potential Enhancements
- Persistent room state (Redis)
- Message history database (PostgreSQL)
- Audio/video recording (MediaRecorder API)
- Multi-room broadcasting (stream to multiple rooms)
- Viewer-only mode (no microphone, reactions only)
- Custom STUN/TURN provider failover
- Metrics + observability (Prometheus, Grafana)
- Automated load testing (Artillery, Locust)

## License

MIT License — See LICENSE file

## Support

- **Issues**: [GitHub Issues](https://github.com/Nandan-k-s-27/HearTogether/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Nandan-k-s-27/HearTogether/discussions)
- **Demo**: https://hear-together-ten.vercel.app
