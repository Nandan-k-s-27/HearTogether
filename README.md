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
- `/listen/:roomId` -> protected listener room
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

# Optional TURN relay
# TURN_URLS=turn:relay.metered.ca:80
# TURN_USERNAME=your_username
# TURN_CREDENTIAL=your_credential
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
```

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

