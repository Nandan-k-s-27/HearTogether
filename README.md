# HearTogether

HearTogether is a real-time web audio sharing app. One user hosts audio, listeners join from a room link or QR code, and everyone hears the same stream through WebRTC.

## Current Highlights

- Google Sign-In authentication for room actions (create/join listening session).
- Public landing and room preview pages; sign-in is requested only on action.
- Post-login deep-link resume: listeners return directly to their intended room after OAuth.
- Host dashboard with pause/resume/stop, per-listener remove, and listener identity (email-based).
- System audio capture (tab/window/screen) and microphone capture options.
- Mobile-friendly top controls (sign-in/theme/switch/logout) with responsive wrapping.
- Hardened backend with CORS allowlist, helmet headers, rate limiting, and stale-room cleanup.

## Tech Stack

- Frontend: React 18, Vite 5, TailwindCSS 3, Socket.IO client, Axios
- Backend: Node.js, Express, Socket.IO, Passport Google OAuth 2.0, JWT
- Transport: WebRTC audio + Socket.IO signaling
- Deployment: Vercel (frontend) + Render (backend)

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

Server (`server/.env`):

```env
PORT=3001
FRONTEND_URL=http://localhost:5173

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback

JWT_SECRET=replace_with_a_long_random_secret

# Optional TURN relay (recommended: ExpressTurn)
# TURN_PROVIDER=ExpressTurn
# EXPRESSTURN_URLS=turn:your-relay:3478,turn:your-relay:3478?transport=tcp,turns:your-relay:5349
# EXPRESSTURN_USERNAME=your_username
# EXPRESSTURN_CREDENTIAL=your_credential
# (Legacy names also supported: TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL)
```

Client (`client/.env`):

```env
VITE_BACKEND_URL=http://localhost:3001
```

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
- `GET /api/ice-servers`
- `GET /api/health`

## Notes

- The browser warning about "Self-XSS" in console is expected and unrelated to app security defects.
- Listener identity shown to the host uses authenticated user email for easier moderation.

## Troubleshooting

### "Waiting for Stream" — Listener stuck connecting

If listeners are stuck on "Waiting for stream…" or "Connecting audio path…", check these in order:

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

#### 2. **Check Offer Delivery**

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

#### 4. **Check WebRTC Connection State**

Look for state transitions:
```
[WebRTC] listener←<host-id> connectionState: new
[WebRTC] listener←<host-id> connectionState: connecting
[WebRTC] listener←<host-id> iceCatheringState: gathering
[WebRTC] listener←<host-id> connectionState: connected
[WebRTC] received ontrack event from <host-id>
[ListenerRoom] calling onTrackReady callback
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

#### 6. **Test Locally First**

Verify it works locally before deploying:
1. Run backend: `npm run dev` in `server/`
2. Run frontend: `npm run dev` in `client/`
3. Open `http://localhost:5173` in two browser windows
4. One as host, one as listener
5. Start streaming and check console logs in both

If it works locally but not on Render/Vercel, it's likely environment (TURN, CORS, deploy).

