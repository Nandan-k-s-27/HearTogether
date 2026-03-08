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

### Deploying to Vercel + a Node host (e.g., Render / Railway)

**Frontend (Vercel):**
1. Set the **Root Directory** to `client/` in your Vercel project settings.
2. Add the environment variable `VITE_SERVER_URL=https://your-server.onrender.com` (no trailing slash).
3. The included `client/vercel.json` already configures the SPA rewrites so deep links (QR codes, room links) work correctly.

**Backend (Render / Railway / Fly.io …):**
1. Deploy the `server/` directory.
2. Set `FRONTEND_URL=https://your-heartogether.vercel.app` (no trailing slash) in the server's environment variables.
3. Set `PORT` to whatever the host assigns (or leave it to the host to inject).

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
- **Automatic Sync**: Real-time synchronization between host and listeners
- **Session Security**: Rate limiting for room creation and CORS protection

## Troubleshooting

### "Room not found or has ended"
- Ensure the Host has not closed the room.
- Check if you entered the code correctly. Codes are case-insensitive.
- If using a link, ensure it follows the format `/room/CODE`.

### "No audio heard as a Listener"
- The host must select an audio source (Tab, Screen, or Mic) and click "Start".
- Ensure you have granted microphone/screen permissions if you are the host.
- Some browsers require a user interaction (like clicking "Start Listening") before playing audio.

### "Screen sharing doesn't stop"
- If the host stops sharing via the browser's "Stop sharing" button, the room will now correctly detect this and end the session.
- You can also click the "Stop" button within the HearTogether interface.
- **Light / System / Dark** theme switcher with OS-preference sync and localStorage persistence
- **No account required** — join by QR scan or room code
- **Security hardened**: HTTP security headers (helmet), rate-limiting on room creation, input sanitisation, stale-room cleanup
- **Responsive** TailwindCSS UI

