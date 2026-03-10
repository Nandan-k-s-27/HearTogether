# HearTogether

Real-time audio sharing over the web. One device broadcasts, everyone listens through their own headphones — no Bluetooth pairing, no extra hardware required.

---

## Features

- **Instant room creation** — unique 7-character code and QR code generated on demand
- **Two audio capture modes** — Browser Tab Audio (`getDisplayMedia`) or Microphone (`getUserMedia`)
- **WebRTC peer-to-peer audio** — low-latency streaming direct to every listener
- **Host controls** — pause, resume, stop broadcast, and remove individual listeners
- **Listener experience** — tap-to-play (browser autoplay compliant), live volume slider, color-coded WebRTC connection state badge
- **QR code & copy link** — share the room instantly from the host dashboard
- **Dark / Light theme** — toggle with `localStorage` persistence, defaults to dark
- **No account required** — join by scanning a QR code or entering the room code
- **Security hardened** — `helmet` security headers, CORS restriction, rate-limiting on room creation, input sanitisation, stale-room cleanup every hour
- **Resilient reconnect** — host and listener automatically re-join their room after a socket reconnection or server restart
- **Keep-alive pings** — prevents free-tier server spin-down (Render, Railway, etc.)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 5, TailwindCSS 3 |
| Routing | React Router v6 |
| Real-time | Socket.IO 4 (signaling), WebRTC (audio transport) |
| Audio capture | Web Audio API (`getDisplayMedia` / `getUserMedia`) |
| UI components | `ShimmerButton`, `GlowCard` (spotlight), `InteractiveWavesBackground`, `ThemeToggle` |
| QR code | `qrcode.react` |
| CSS utilities | `clsx` + `tailwind-merge` |
| Backend | Node.js, Express 4 |
| Security | `helmet`, `cors`, `express-rate-limit` |
| ID generation | `nanoid` |
| TURN relay | Metered.ca (optional, via environment variables) |
| Deployment | Vercel (frontend) + Render / Railway / Fly.io (backend) |

---

## Project Structure

```
HearTogether/
├── client/                         # React + Vite frontend
│   ├── public/
│   ├── src/
│   │   ├── App.jsx                 # Routes: /, /host/:roomId, /room/:code, /listen/:roomId
│   │   ├── pages/
│   │   │   ├── LandingPage.jsx     # Hero, create room, join by code
│   │   │   ├── HostRoom.jsx        # Host dashboard — broadcast controls, QR, listener list
│   │   │   ├── JoinPage.jsx        # Pre-join confirmation screen
│   │   │   └── ListenerRoom.jsx    # Audio receiver — tap to play, volume, connection state
│   │   ├── components/
│   │   │   ├── InteractiveWavesBackground.jsx  # Full-page Perlin noise canvas
│   │   │   └── ui/
│   │   │       ├── shimmer-button.jsx  # Animated shimmer CTA button
│   │   │       ├── spotlight-card.jsx  # Pointer-tracked glow card
│   │   │       ├── docks.jsx           # DockBar wrapper (exports ThemeToggle)
│   │   │       └── theme-toggle.jsx    # Dark / light toggle (localStorage)
│   │   ├── hooks/
│   │   │   └── useWebRTC.js        # useHostWebRTC + useListenerWebRTC
│   │   ├── services/
│   │   │   ├── api.js              # createRoom, getRoomInfo, getIceServers, pingServer
│   │   │   └── socket.js           # Singleton Socket.IO client
│   │   ├── lib/
│   │   │   └── utils.js            # cn() — clsx + tailwind-merge
│   │   └── index.css               # Tailwind directives, GlowCard CSS, pulse-ring animation
│   ├── index.html
│   ├── vite.config.js              # Path alias @→src, dev proxy → localhost:3001
│   ├── tailwind.config.js          # Custom brand palette, shimmer keyframes
│   ├── vercel.json                 # SPA rewrite: /* → /index.html
│   └── package.json
├── server/                         # Node.js + Express backend
│   ├── src/
│   │   ├── index.js                # Express REST API + Socket.IO event handlers
│   │   └── rooms.js                # In-memory room store (Map-based)
│   └── package.json
├── LICENSE
└── README.md
```

---

## Quick Start

### 1. Install dependencies

```bash
# Backend
cd server
npm install

# Frontend
cd ../client
npm install
```

### 2. Configure environment variables

**Server** — create `server/.env`:

```env
PORT=3001
FRONTEND_URL=http://localhost:5173

# Optional — TURN relay (Metered.ca)
# TURN_URLS=turn:relay.metered.ca:80
# TURN_USERNAME=your_username
# TURN_CREDENTIAL=your_credential
```

**Client** — create `client/.env` (only needed for production; dev uses the Vite proxy):

```env
VITE_SERVER_URL=https://your-server.onrender.com
```

### 3. Run the development servers

**Terminal 1 — Backend:**
```bash
cd server
npm run dev
```

**Terminal 2 — Frontend:**
```bash
cd client
npm run dev
```

The frontend runs at `http://localhost:5173` and automatically proxies `/api` and `/socket.io` requests to the backend on port `3001`.

### 4. Production build

```bash
cd client
npm run build   # output → client/dist/
```

---

## Deployment

### Frontend — Vercel

1. Set the **Root Directory** to `client/` in your Vercel project settings.
2. Add the environment variable:
   ```
   VITE_SERVER_URL=https://your-server.onrender.com
   ```
3. The included `client/vercel.json` handles SPA rewrites so QR code deep links resolve correctly.

### Backend — Render / Railway / Fly.io

1. Deploy the `server/` directory as a Node.js service.
2. Set the environment variables:
   ```
   FRONTEND_URL=https://your-heartogether.vercel.app
   PORT=<assigned by host>
   ```

---

## How It Works

1. **Host** clicks **Create Room** — the server generates a unique room ID and 7-character code.
2. Host shares the QR code or room code with listeners.
3. **Listeners** scan or enter the code — a confirmation screen shows the room is live.
4. Host selects an audio source (Browser Tab or Microphone) and starts broadcasting.
5. For each listener that joins, the host creates a WebRTC offer; the listener answers. Audio flows peer-to-peer.
6. Signaling (offers, answers, ICE candidates) is relayed through Socket.IO — no audio ever touches the server.
7. Host can pause, resume, stop the broadcast, or remove individual listeners at any time.

---

## Environment Variables Reference

### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP / WebSocket server port |
| `FRONTEND_URL` | `http://localhost:5173` | Allowed CORS origin(s), comma-separated |
| `TURN_URLS` | — | Comma-separated TURN server URLs |
| `TURN_USERNAME` | — | TURN username |
| `TURN_CREDENTIAL` | — | TURN password |

### Client

| Variable | Default | Description |
|---|---|---|
| `VITE_SERVER_URL` | `''` (empty) | Backend base URL in production |

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/rooms` | Create a new room; rate-limited to 30 requests / 10 min per IP |
| `GET` | `/api/rooms/:code` | Get room info (`id`, `code`, `hostConnected`, `listenerCount`) |
| `GET` | `/api/ice-servers` | Returns STUN + optional TURN server config |
| `GET` | `/api/health` | Keep-alive ping |

---

## Troubleshooting

### "Room not found or has ended"
- Confirm the host has not stopped the room.
- Room codes are case-insensitive — double-check the code.
- If following a direct link, make sure it uses the format `/room/CODE`.

### No audio in the listener view
- The host must choose an audio source (Tab or Mic) and click **Start Broadcasting**.
- Browsers require a user gesture before playing audio — tap the **Tap to Hear** button.
- Check that the browser has been granted screen/microphone permissions if you are the host.

### Host's "Stop sharing" button ends the session
- This is intentional. When the browser's native stop-sharing button is clicked, HearTogether detects the stream ending and cleanly closes the room.
- To pause without ending the room, use the **Pause** button inside HearTogether instead.

