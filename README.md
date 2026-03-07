# HearTogether

Real-time audio sharing over the web. One device broadcasts, everyone listens through their own headphones — no Bluetooth pairing, no extra hardware.

## Quick Start

### 1. Configure environment variables

```bash
# Server
cp server/.env.example server/.env

# Client (optional — defaults to localhost:3001)
cp client/.env.example client/.env
```

### 2. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
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

The frontend runs at `http://localhost:5173` and proxies API/WebSocket calls to the backend on port `3001`.

### Production build

```bash
cd client
npm run build   # outputs to client/dist/
```

Serve `client/dist/` with any static host (Vercel, Netlify, Nginx). Point `FRONTEND_URL` on the server to the deployed frontend origin.

## How It Works

1. **Host** opens the app and clicks **Create Room**.
2. A unique room code and QR code are generated.
3. **Listeners** scan the QR code or enter the room code to join.
4. The host starts broadcasting audio (browser tab, screen, or microphone).
5. Audio is streamed peer-to-peer to all listeners via **WebRTC**.
6. A timestamp-based sync system keeps playback aligned across devices.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, TailwindCSS 3 |
| UI Components | ShimmerButton, GlowCard (spotlight-card), DockBar theme switcher |
| Backend | Node.js, Express, Socket.io 4 |
| Streaming | WebRTC, Web Audio API |
| QR Code | qrcode.react |
| Routing | React Router v6 |
| Security | helmet, express-rate-limit |

## Project Structure

```
HearTogether/
├── client/                    # React + Vite frontend
│   ├── src/
│   │   ├── components/ui/     # shimmer-button, spotlight-card, docks
│   │   ├── lib/utils.js       # cn() — clsx + tailwind-merge
│   │   ├── pages/             # LandingPage, HostRoom, ListenerRoom, JoinPage
│   │   ├── hooks/             # useHostWebRTC, useListenerWebRTC
│   │   ├── services/          # socket.js, api.js
│   │   └── App.jsx
│   ├── .env.example
│   └── package.json
├── server/                    # Node.js + Express backend
│   ├── src/
│   │   ├── index.js           # Express + Socket.io server
│   │   └── rooms.js           # In-memory room management
│   ├── .env.example
│   └── package.json
├── .gitignore
└── README.md
```

## Features

- **Room creation** with unique 7-character code & QR code
- **3 audio capture modes**: browser tab, screen share, microphone
- **Real-time WebRTC** peer-to-peer audio to all listeners
- **Room controls**: pause, resume, stop, remove individual listeners
- **Listener view**: volume control, connection quality indicator, sync offset display
- **Light / System / Dark** theme switcher with OS-preference sync and localStorage persistence
- **No account required** — join by QR scan or room code
- **Security hardened**: HTTP security headers (helmet), rate-limiting on room creation, input sanitisation, stale-room cleanup
- **Responsive** TailwindCSS UI

