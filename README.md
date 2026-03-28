# HearTogether

HearTogether is a real-time web audio sharing app. One user hosts audio, listeners join from a room link or QR code, and everyone hears the same stream through WebRTC.

## Current Highlights

- **Production-hardened authentication**: Google Sign-In with timeout-aware warm-up and automatic backend readiness checks before OAuth redirect
- Public landing and room preview pages; sign-in is requested only on action
- Post-login deep-link resume: listeners return directly to their intended room after OAuth
- Host dashboard with pause/resume/stop, per-listener remove, and listener identity (email-based)
- **Listener engagement**: Simple emoji reactions + text chat (up to 500 chars per message) enable real-time interaction with the host
- System audio capture (tab/window/screen) and microphone capture options
- Stable account controls: signed-in users always see account identity and direct Switch/Logout actions
- **Hardened backend**: CORS allowlist, helmet headers, rate limiting, stale-room cleanup, and production-safe session handling
- **Redis integration**: Managed Redis support with automatic TLS detection, session storage, pub/sub, and cache-aside patterns
- **Scalability**: Configurable listener limit (default 30; realistic for Render free tier) prevents WebRTC degradation
- **Realtime resilience**: Listener dedupe on reconnect avoids duplicate participants in host view
- **Accurate dynamic counts**: Server emits `room:listener-count` updates on join/leave/remove, and listeners update count live
- **Host reconciliation fallback**: Host periodically reconciles listener list against server canonical state to heal missed/out-of-order events
- **Low-network tuning**: WebRTC transport includes Opus tuning (FEC/DTX/bitrate shaping), ICE candidate pre-gathering, and improved socket reconnect behavior
- **Mobile-optimized**: Orientation lock, screen WakeLock API, and cross-browser compatibility for mobile audio streams

## Tech Stack

- Frontend: React 18, Vite 5, TailwindCSS 3, Socket.IO client, Axios
- Backend: Node.js, Express, Socket.IO, Passport Google OAuth 2.0, JWT, Redis
- Transport: WebRTC audio + Socket.IO signaling
- Deployment: Vercel (frontend) + Render (backend)

## Redis Integration

### What Redis is and why it is used

- Redis is an in-memory key-value data store. Because reads/writes happen in memory, operations are extremely fast (sub-millisecond in many cases).
- Redis supports multiple data structures used in this project:
	- Strings: cache entries and rate-limit counters
	- Sets: active users per room (`SADD`, `SREM`, `SCARD`)
	- Lists: recent signaling queue per room (`RPUSH`, `LRANGE`, `LTRIM`)
	- Hashes / Sorted Sets: available for advanced leaderboards/timestamps if needed later
- In system design, Redis is commonly used for caching, session storage, pub/sub messaging, short-lived realtime state, and distributed rate limiting.

### Implemented Redis features in HearTogether

- Cache-aside room lookup for `GET /api/rooms/:code` with TTL and cache hit headers (`X-Cache: HIT|MISS`)
- Redis-backed session store for auth session state (`heartogether.sid`)
- Redis Pub/Sub event bus (`room-events`) for cross-service realtime event propagation
- Realtime dynamic state:
	- active users per room in Redis Sets
	- recent signaling events in Redis Lists
- Redis-backed rate limiting for room creation and room lookup endpoints

### Redis setup

**Local development:**

```bash
# macOS (homebrew)
brew install redis
brew services start redis

# Linux
sudo apt-get install redis-server
sudo systemctl start redis

# Windows (Docker)
docker run -d --name heartogether-redis -p 6379:6379 redis:7
```

**Production (Managed Redis):**

The app supports managed Redis providers with automatic TLS detection:

- **Upstash, Redis Cloud, AWS ElastiCache, Azure Cache for Redis**
- Auto-detects TLS from `rediss://` URL scheme
- Falls back to TLS for non-local production endpoints
- Gracefully disables when Redis is unavailable (in-memory fallback for dev/testing)

**Configuration:**

```env
# Enable Redis
REDIS_ENABLED=true

# Connection string (auto-detects TLS for rediss://...)
REDIS_URL=rediss://<user>:<password>@<host>:<port>

# Optional TLS override
REDIS_TLS=true                          # force TLS on/off (auto-detect if not set)
REDIS_TLS_REJECT_UNAUTHORIZED=true      # set false only if cert-chain issues occur

# Connection timing
REDIS_CONNECT_TIMEOUT_MS=4000           # per-connection timeout (default 4s)
```

**Initialization behavior:**

- Redis init starts **immediately during server boot** (before HTTP port binding completes)
- Early initialization allows session middleware to bind to Redis store when configured
- HTTP port opens immediately regardless of Redis status (fast startup on Render, etc.)
- Background features (pub/sub, adapter) run after HTTP binding
- If Redis unavailable: app continues with in-memory/ephemeral fallback

**Network access:**

- Use managed Redis (Redis Cloud, Upstash, AWS ElastiCache)
- Enable authentication and TLS where supported
- Restrict network access to backend service only
- Use `rediss://` URLs (TLS-protected) for production

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

## Routing

- `/` -> public landing page
- `/room/:code` -> public room preview page
- `/listen/:code` -> protected listener room
- `/host/:roomId` -> protected host dashboard
- `/login` -> optional dedicated sign-in page

## Local Development

### 1) Install dependencies

```bash
cd server
npm install

cd ../client
npm install
```

### 2) Environment variables

**Backend (`server/.env`):**

```env
# Server configuration
NODE_ENV=development                    # or production
PORT=5000
FRONTEND_URL=http://localhost:5173

# Google OAuth 2.0
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:5000/auth/google/callback

# Authentication
JWT_SECRET=replace_with_a_long_random_secret (minimum 32 characters)
AUTH_WARM_UP_TIMEOUT_MS=150000          # 2.5 min timeout for backend readiness probe
AUTH_COOKIE_TIMEOUT=86400               # 24 hours

# Redis configuration
REDIS_ENABLED=false                     # set to true in production with managed Redis
REDIS_URL=redis://localhost:6379        # or rediss://user:pass@host:port for TLS
REDIS_CONNECT_TIMEOUT_MS=4000           # per-connection timeout
REDIS_TLS=                              # auto-detect if unset; set true/false to override
REDIS_TLS_REJECT_UNAUTHORIZED=true      # false only for self-signed certs

# Session store (used when Redis enabled)
SESSION_SECRET=replace_with_a_long_random_secret
SESSION_COOKIE_SECURE=false             # set true in production with HTTPS
SESSION_TTL_SECONDS=86400               # 24 hours
SESSION_COOKIE_NAME=heartogether.sid

# Room lifecycle configuration
MAX_LISTENERS=30                        # max concurrent listeners per room (realistic for Render free tier)
ROOM_TTL_MS=3600000                     # 60 min; rooms auto-expire after inactivity

# TURN relay (optional; recommended for mobile)
TURN_PROVIDER=ExpressTurn               # or leave empty to use default ICE candidates
EXPRESSTURN_URLS=turn:relay:3478,turn:relay:3478?transport=tcp,turns:relay:5349
EXPRESSTURN_USERNAME=your_username
EXPRESSTURN_CREDENTIAL=your_credential

# Rate limiting
RATE_LIMIT_REQUESTS=30                  # room creation limit
RATE_LIMIT_WINDOW_MS=600000             # 10 minutes
RATE_LIMIT_LOOKUP_REQUESTS=120          # room lookup limit
RATE_LIMIT_LOOKUP_WINDOW_MS=300000      # 5 minutes
```

**Frontend (`client/.env`):**

```env
VITE_BACKEND_URL=http://localhost:5000  # or your production backend URL
VITE_GOOGLE_CLIENT_ID=your_google_client_id
VITE_ENABLE_DEBUG_LOGS=false            # set to true for verbose WebRTC debug logs
```

**Render deployment:**

Set environment variables in the Render dashboard:
1. Copy all values from `server/.env`
2. For production: set `REDIS_ENABLED=true` and provide `REDIS_URL=rediss://...` (managed Redis)
3. Update `FRONTEND_URL` to your Vercel frontend URL (e.g., `https://hear-together-ten.vercel.app`)
4. Update `GOOGLE_CALLBACK_URL` to your production backend (e.g., `https://heartogether.onrender.com/auth/google/callback`)
5. Use strong `JWT_SECRET` (minimum 32 characters; use a random generator)
6. Set `SESSION_COOKIE_SECURE=true` in production
7. Ensure TURN server credentials are valid for production load

### 3) Run

```bash
# terminal 1
cd server
npm run dev

# terminal 2
cd client
npm run dev
```

## Production Configuration

### Vercel (frontend)

- Root directory: `client`
- Environment variables:

```env
VITE_BACKEND_URL=https://your-backend.onrender.com
```

### Render (backend)

- Service root: `server`
- Environment variables:

```env
FRONTEND_URL=https://your-frontend.vercel.app
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=https://your-backend.onrender.com/auth/google/callback
JWT_SECRET=replace_with_a_long_random_secret
PORT=3001

# Listener capacity & room lifecycle (optional; important for Render free tier)
MAX_LISTENERS=30 (default; realistic max concurrent listeners per room to prevent WebRTC CPU exhaustion)
ROOM_TTL_MS=3600000 (room inactivity timeout; default 60 minutes; auto-expire stale rooms)

# Optional TURN relay for reliable mobile/cellular audio
TURN_PROVIDER=ExpressTurn
EXPRESSTURN_URLS=turn:your-relay:3478,turn:your-relay:3478?transport=tcp,turns:your-relay:5349
EXPRESSTURN_USERNAME=...
EXPRESSTURN_CREDENTIAL=...
```

### Server Restarts and Room State

- Rooms are kept in server memory, so a backend restart clears active rooms.
- Host URLs still work: when a host reconnects to an old room id, the server recreates the room id automatically.
- Listener links may temporarily show room not found until the host rejoins.
- On Render free tier, inactivity can trigger restarts. A periodic health ping or active session helps keep the service warm.

### Google Cloud OAuth setup

In your OAuth 2.0 client, add authorized redirect URIs:

- `https://your-backend.onrender.com/auth/google/callback`
- `http://localhost:3001/auth/google/callback`

## API Endpoints

Auth:

- `GET /auth/google`
- `GET /auth/google/callback`
- `GET /auth/status`
- `GET /auth/me`
- `POST /auth/logout`

Rooms:

- `POST /api/rooms` (auth required)
- `GET /api/rooms/:code`
- `GET /api/rooms/:roomId/listeners` (auth required; host-only canonical listener snapshot)
- `GET /api/rooms/:roomId/realtime` (auth required; Redis realtime diagnostics)
- `GET /api/ice-servers`
- `GET /api/health`

Redis/system:

- `GET /api/system/redis` (Redis connectivity status)
- `POST /api/events/publish` (auth required; publish custom pub/sub event)

## Redis Modules (Server)

- `server/src/redis/client.js`: connection lifecycle, retry strategy, pub/sub clients
- `server/src/redis/cache.js`: cache-aside helpers and TTL cache utilities
- `server/src/redis/session.js`: Redis session store middleware
- `server/src/redis/rateLimit.js`: distributed rate-limit middleware
- `server/src/redis/realtime.js`: active-user sets and recent signal queues
- `server/src/redis/pubsub.js`: publish/subscribe helpers for service events

## Scalability Notes and Trade-offs

- Redis improves scale by offloading frequent reads, centralizing short-lived state, and enabling multi-instance event propagation.
- For larger deployments:
	- Enable replication for read scaling/failover
	- Use Sentinel/managed HA for automatic failover
	- Use Redis Cluster for horizontal partitioning
- Trade-offs:
	- Memory-first model can be expensive at very high cardinality
	- Persistence modes (RDB/AOF) add durability but can impact throughput depending on settings
	- Redis is best for ephemeral/hot data, not as primary long-term database

## Notes

- The browser warning about "Self-XSS" in console is expected and unrelated to app security defects.
- Listener identity shown to the host uses authenticated user email for easier moderation.
- Listener room currently focuses on connection/reaction/chat state and does not include direct audio playback controls.
- **Service worker optimization**: The app includes a minimal service worker with no-op fetch handler (preserves boot performance). Custom caching strategies can be added as needed.
- **Startup sequence**: Backend HTTP port opens immediately on deploy (fast health checks); Redis initialization runs asynchronously in background to avoid startup delays on platforms like Render.
- **Redis idempotent initialization**: Multiple simultaneous init calls are coalesced via promise caching to prevent connection race conditions (safe for multi-instance deployments).
- **OAuth warm-up**: The client probes both `/api/health` and `/auth/status` endpoints in parallel with timeout-bounded retries (6s per probe, 150s total) before redirecting to Google Sign-In. This prevents infinite waits if backend is stalled or unavailable.
- **Distributed Redis features**: Session store, pub/sub event bus, rate limiting, and realtime state are all optional and degrade gracefully if Redis is unavailable. When Redis is disabled, the app uses ephemeral in-memory fallbacks.

## Security Notes

- Dependency audits are run for both client and server as part of maintenance; current status is **0 vulnerabilities** (all critical issues resolved).
- Socket.IO parser is pinned to a patched version via npm overrides.
- Express session store in production uses Redis-backed session storage; in-memory fallback (ephemeral) is used only when Redis is unavailable to avoid MemoryStore memory-leak warnings.
- **OAuth security**: Auth history is sanitized on app boot to prevent stale OAuth callback params from causing replay attacks via mobile back-button scenarios.
- Client currently has no blocking vulnerabilities. Vite/esbuild advisories are non-critical for production builds.
- Mitigation: do not expose the Vite dev server publicly. Keep local development on localhost/private network and deploy only the production build.

## Operational Safeguards

- Auth history guard is enabled on app boot to sanitize OAuth callback query params and reduce stale back-button states on mobile/webview browsers.
- Room APIs are rate limited on the backend to reduce abuse:
	- `POST /api/rooms`: 30 requests per 10 minutes per IP
	- `GET /api/rooms/:code`: 120 requests per 5 minutes per IP
- Stale rooms are cleaned up automatically by the backend (hourly pass for disconnected rooms older than 6 hours).

## Troubleshooting

### Listener stuck in reconnecting/connecting state

If listener or host is stuck in reconnect loops, check these in order:

#### 1. **Check TURN Configuration**

Open browser DevTools (F12) on the **Listener** tab and look for:
- `[ListenerRoom] ICE servers loaded:` should show both STUN and TURN servers
- `STUN=X, TURN=Y` should show `TURN > 0`
- If `TURN=0`, TURN is not configured on the **backend** (Render)

**Fix:** Add TURN env vars on Render:
```env
TURN_PROVIDER=ExpressTurn
EXPRESSTURN_URLS=turn:your-relay:3478,turn:your-relay:3478?transport=tcp,turns:your-relay:5349
EXPRESSTURN_USERNAME=...
EXPRESSTURN_CREDENTIAL=...
```

#### 2. **Check Signaling Delivery**

In **Host** browser console (F12), look for:
- `[HostRoom] listener joined: <id>` (listener connected to host)
- `[HostRoom] stream exists, creating offer for <id>` (offer is being created)
- `[WebRTC] offer created for <id>` (offer created successfully)
- `[signal] offer from <host-id> → <listener-id>` (server received offer)

In **Listener** console (F12), look for:
- `[ListenerRoom] received offer from <id>` (offer arrived)

**If offer is not arriving:** Check server logs on Render for `[signal] offer from <host-id>` — if it's missing, the host didn't send it.

**If host not sending offers:** The stream may not have audio tracks. In host console, look for:
- `[WebRTC] adding X audio tracks to peer connection`
- If `adding 0 audio tracks`, ensure you selected system audio or microphone

#### 3. **Check ICE Candidate Exchange**

Look for in both consoles:
- `[ICE host→<id>] type=relay` (relay candidate found, good sign)
- `[ICE host→<id>] type=srflx` (reflexive candidate from firewall)
- `[ICE host→<id>] type=host` (local IP, won't work on mobile over 4G)

If **no relay candidates**, TURN config is wrong or not reaching the client. Verify EXPRESSTURN_* vars are set correctly on Render.

#### 4. **Check WebRTC Connection State and Recovery**

Look for state transitions:
```
[WebRTC] listener←<host-id> connectionState: new
[WebRTC] listener←<host-id> connectionState: connecting
[WebRTC] listener←<host-id> iceGatheringState: gathering
[WebRTC] listener←<host-id> connectionState: connected
[WebRTC] host→<listener-id> ICE restart #1
```

**If stuck on "connecting":** ICE couldn't establish a path. Common causes:
- Network blocked TURN port (check EXPRESSTURN_URLS uses accessible ports)
- TURN credentials are wrong (typo in EXPRESSTURN_USERNAME/CREDENTIAL)
- TURN URL syntax is wrong (should be `turn:host:port` or `turns:host:port`)

**If never reaches "connected":** P2P negotiation failed.

#### 5. **Check Server Logs (Render)**

SSH into Render and tail logs for signaling issues:
```
[socket] connected: <socket-id> (user: example@gmail.com)
[room ABC123] host joined
[room ABC123] listener <socket-id> joined (1 total)
[signal] offer from <host-socket-id> → <listener-socket-id>
[signal] answer from <listener-socket-id> → <host-socket-id>
```

**Common issues in server logs:**
- `WARN: offer is empty or null` — host sent malformed offer
- `WARN: target socket X not found` — routing failed, listener socket disconnected
- No `[ice-servers]` logs — backend didn't process the API call

### Listener count mismatch recovery

The app now includes automatic correction:

- Server emits `room:listener-count` to room members whenever listener membership changes.
- Host periodically reconciles listener list from `GET /api/rooms/:roomId/listeners`.

If counts still look wrong:

1. Ensure host socket is authenticated and joined as host.
2. Verify `GET /api/rooms/:roomId/listeners` returns expected listener objects.
3. Check browser console for reconciliation logs:
	- `[HostRoom] reconcile diff: -X +Y ~Z`
	- `[HostRoom] reconcile removed stale listeners: ...`

#### 6. **Test Locally First**

Verify it works locally before deploying:
1. Run backend: `npm run dev` in `server/`
2. Run frontend: `npm run dev` in `client/`
3. Open `http://localhost:5173` in two browser windows
4. One as host, one as listener
5. Start streaming and check console logs in both

If it works locally but not on Render/Vercel, it's likely environment (TURN, CORS, deploy).

### OAuth Sign-In Not Redirecting to Google

**Symptom:** "Waking audio engine" overlay appears, then sign-in fails or page redirects to error instead of Google OAuth.

**Root causes and fixes:**

1. **Backend warm-up timeout exceeded**
   - The app waits up to 2.5 minutes (`AUTH_WARM_UP_TIMEOUT_MS=150000`) for backend to be ready
   - If backend doesn't respond within this window, sign-in shows error instead of redirecting
   - Check browser console for: `[AuthContext] Backend health check timeout exceeded` or `Backend auth status not ready`

   **Fix:** 
   - Verify backend is running: `curl https://your-backend.onrender.com/api/health` should return `200 OK`
   - On Render free tier, cold start can take 30-60 seconds; be patient
   - Increase `AUTH_WARM_UP_TIMEOUT_MS` in backend `.env` if needed (but 150s is usually sufficient)

2. **Backend not fully initialized**
   - The app probes two endpoints: `/api/health` (general readiness) AND `/auth/status` (OAuth readiness)
   - If either fails, sign-in is blocked
   - Check browser console: `[AuthContext] Probing /api/health` and `[AuthContext] Probing /auth/status`

   **Fix:**
   - Backend logs on Render should show: `[express] Server listening on port 5000`
   - If you see `Error: getaddrinfo ENOTFOUND` or `ECONNREFUSED`, backend isn't bound yet
   - Wait longer or restart the Render service

3. **CORS or fetch error**
   - If browser console shows: `[AuthContext] Auth probe failed` with CORS error
   - Verify `FRONTEND_URL` is correctly set on backend (should match your Vercel domain)

   **Fix:**
   ```env
   FRONTEND_URL=https://your-vercel-app.vercel.app
   ```

### Redis Connection Failures

**Symptoms:**
- Backend logs show `[redis] connection failed` or `Socket closed unexpectedly`
- App continues to work but Redis features (session store, rate limiting) disabled
- Render logs may show `ECONNREFUSED` or `Error: getaddrinfo ENOTFOUND`

**Common issues:**

1. **Redis is disabled or not configured**
   ```env
   REDIS_ENABLED=false   # explicitly disabled in dev
   ```
   This is intentional and safe for development. In production, set `REDIS_ENABLED=true` and provide `REDIS_URL`.

2. **Wrong connection string**
   - Verify `REDIS_URL` format:
     ```
     redis://localhost:6379                               # local dev
     rediss://user:password@redis-host.cloud:6379         # managed Redis with TLS
     ```
   - Test locally: `redis-cli -u "$REDIS_URL" ping` should return `PONG`

3. **TLS handshake failed** (for managed Redis)
   - Error in logs: `Socket closed unexpectedly` after repeated retries
   - Managed Redis (Upstash, Redis Cloud, etc.) requires TLS
   - Verify app auto-detects TLS correctly:
     ```env
     REDIS_URL=rediss://...                 # rediss:// scheme auto-enables TLS
     REDIS_TLS=true                         # or explicitly set to true
     ```

   **Fix:**
   - If using `redis://` URL with managed provider, explicitly enable TLS:
     ```env
     REDIS_URL=redis://...
     REDIS_TLS=true
     ```
   - If certificate validation fails:
     ```env
     REDIS_TLS_REJECT_UNAUTHORIZED=false    # only if cert-chain issues occur
     ```

4. **Connection timeout**
   - Redis takes >4 seconds to connect
   - Increase timeout in `.env`:
     ```env
     REDIS_CONNECT_TIMEOUT_MS=8000          # 8 seconds instead of default 4s
     ```

5. **Network/firewall blocking Redis port**
   - Render can't reach your Redis host
   - Verify:
     - Redis host is publicly accessible (or in same VPC as Render)
     - Port is correct (usually 6379 for standard, 6380 for TLS)
     - IP whitelist includes Render's outbound IPs (if applicable)

   **Temporary workaround:** Run production without Redis by setting `REDIS_ENABLED=false`
   - This disables distributed features but app still works (in-memory fallback)
   - Not recommended for multi-instance deployments

### Backend Startup 503 Errors

**Symptom:** Render shows `503 Service Unavailable` for first 30-60 seconds after deploy.

**Root cause:** Render's health check runs immediately but backend is still initializing Redis and loading routes.

**Fixes (already applied in current code):**

1. **Background Redis initialization** (`server/src/index.js`)
   - HTTP server opens on `PORT` immediately
   - Redis setup runs asynchronously in background
   - Health check returns `200 OK` even if Redis not ready yet
   - This eliminates the startup 503 window

2. **Manual restart if needed**
   - Go to Render dashboard → your service → Manual Redeploy
   - Or trigger via GitHub push in case of stuck state

