# Tic-Tac-Toe Multiplayer

A real-time, server-authoritative multiplayer Tic-Tac-Toe game built with **Nakama** backend and **React** frontend.

---

## Features

- **Real-time multiplayer** — two players matched and play live via WebSocket
- **Server-authoritative logic** — all moves, turn enforcement, win/draw detection run on the server
- **Matchmaking** — automatic pairing via Nakama's built-in matchmaker
- **Two game modes** — Classic (no timer) and Timed (30 seconds per turn)
- **Leaderboard** — persistent win counts tracked per player
- **Nickname & persistent identity** — device-based auth with a chosen display name
- **Play Again / Back to Menu** — rematch or leave without reloading
- **Disconnect handling** — match ends cleanly if a player leaves

---

## Architecture

```
┌─────────────────────┐        WebSocket        ┌──────────────────────────┐
│   React Frontend    │ ◄─────────────────────► │   Nakama Server (Go)     │
│  (Vite + nakama-js) │                          │  Authoritative Match     │
└─────────────────────┘                          │  Matchmaker              │
                                                 │  Leaderboard             │
                                                 └────────────┬─────────────┘
                                                              │
                                                 ┌────────────▼─────────────┐
                                                 │      PostgreSQL 12        │
                                                 └──────────────────────────┘
```

### Backend (`backend/main.go`)
- Written in Go as a Nakama plugin (`.so` shared library)
- Implements all Nakama authoritative match interface methods:
  - `MatchInit` — initializes board, assigns game mode from matchmaker properties
  - `MatchJoinAttempt` — validates player join (max 2 players)
  - `MatchJoin` — assigns X/O symbols to each player
  - `MatchLeave` — ends the match when a player disconnects
  - `MatchLoop` — processes moves (opCode 1), resets (opCode 2), and timer forfeits
  - `MatchTerminate` / `MatchSignal` — lifecycle stubs
- `RegisterMatchmakerMatched` — pairs players with the same mode (Classic=0, Timed=1); rejects cross-mode pairings
- `LeaderboardCreate` — creates a persistent "wins" leaderboard on startup

### Frontend (`frontend/src/`)
- **`App.jsx`** — main component with three screens: Nickname → Matchmaking → Playing
- **`nakama.js`** — Nakama client configuration (host, port, server key)
- Uses `@heroiclabs/nakama-js` v2.8.0 for all server communication
- Device ID stored in `localStorage` for persistent identity across sessions

### OpCodes
| Code | Direction | Payload | Description |
|------|-----------|---------|-------------|
| 1 | Client → Server | `{ index: 0–8 }` | Make a move |
| 2 | Client → Server | `{}` | Request Play Again (reset board) |
| — | Server → Client | `StateMsg` JSON | Full game state broadcast every tick |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for Nakama + Postgres)
- [Node.js 18+](https://nodejs.org/) (for the frontend)

---

## Local Setup & Running

### 1. Build the backend plugin

```bash
# macOS / Linux
docker run --rm \
  -v "${PWD}/backend:/backend" \
  -w /backend \
  --entrypoint sh \
  heroiclabs/nakama-pluginbuilder:3.38.0 \
  -c "go build -buildmode=plugin -trimpath -o ./backend.so ."

# Windows (PowerShell)
docker run --rm -v "${PWD}/backend:/backend" -w /backend --entrypoint sh heroiclabs/nakama-pluginbuilder:3.38.0 -c "go build -buildmode=plugin -trimpath -o ./backend.so ."
```

### 2. Start Nakama + Postgres

```bash
docker compose up
```

- Nakama API: http://localhost:7350  
- Nakama Console: http://localhost:7351

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: **http://localhost:5173**

---

## Testing Multiplayer

1. Open **http://localhost:5173** in a normal browser tab
2. Open **http://localhost:5173** in an **incognito / private window** (requires a different device ID)
3. Enter a nickname and select the same game mode in both tabs
4. Click **Find Match** in both — they will be paired automatically within seconds
5. Play the game; the winner is saved to the leaderboard

> **Important:** Both players must select the **same game mode** (Classic or Timed) to be paired together.

---

## Project Structure

```
tic-tac-toe-multiplayer/
├── docker-compose.yml          # Nakama + Postgres services
├── backend/
│   ├── go.mod                  # Go module (nakama-common v1.45.0)
│   ├── main.go                 # Full game logic as Nakama Go plugin
│   └── backend.so              # Compiled plugin (generated — not committed)
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx            # React entry point
        ├── App.jsx             # Main game component
        ├── App.css             # Dark theme styles
        ├── index.css           # Global reset
        └── nakama.js           # Nakama client config
```

---

## Deployment

Nakama server is deployed on **Render** (free tier) and the React frontend on **Vercel** (free tier).

### Prerequisites
- [GitHub](https://github.com) account
- [Render](https://render.com) account (free)
- [Vercel](https://vercel.com) account (free)

---

### Step 1 — Deploy Nakama on Render

1. Go to [render.com](https://render.com) → **New** → **Blueprint**
2. Connect your GitHub repo (`tic-tac-toe-multiplayer`)
3. Render will detect `render.yaml` automatically and create:
   - A **PostgreSQL** database (`nakama-db`)
   - A **Web Service** (`nakama-server`) built from the `Dockerfile`
4. Click **Apply** — the build takes ~5 minutes (compiles the Go plugin inside Docker)
5. Once deployed, your Nakama URL will be:  
   `https://nakama-server.onrender.com`

> **Note:** Free tier services sleep after 15 minutes of inactivity. The first request after sleep takes ~30 seconds to wake up.

---

### Step 2 — Deploy Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project** → Import your GitHub repo
2. Set **Root Directory** to `frontend`
3. Under **Environment Variables**, add:
   ```
   VITE_NAKAMA_HOST=nakama-server.onrender.com
   VITE_NAKAMA_PORT=443
   VITE_NAKAMA_SSL=true
   ```
   > Replace `nakama-server` with your actual Render service name if different.
4. Click **Deploy** — your frontend will be live at `https://your-project.vercel.app`

---

### API / Server Configuration

| Setting | Local | Production (Render) |
|---------|-------|---------------------|
| Nakama Host | `127.0.0.1` | `nakama-server.onrender.com` |
| Nakama Port | `7350` | `443` |
| SSL | `false` | `true` |
| Server Key | `defaultkey` | `defaultkey` |
| Database | Docker Postgres | Render Postgres (auto-configured) |

Environment variables used by the frontend (set in Vercel):

| Variable | Description |
|----------|-------------|
| `VITE_NAKAMA_HOST` | Nakama server hostname (no `https://`) |
| `VITE_NAKAMA_PORT` | `443` for Render (HTTPS) |
| `VITE_NAKAMA_SSL` | `"true"` to enable WSS/HTTPS |

---

### Deployment Diagram

```
Browser → https://your-project.vercel.app   (Vercel — React frontend)
              │
              │ WSS :443 (WebSocket Secure)
              ▼
    https://nakama-server.onrender.com       (Render — Nakama Docker service)
              │
              │ TCP
              ▼
         Render PostgreSQL                   (persistent player data + leaderboard)
```

---

## Design Decisions

- **Server-authoritative**: the client never determines win/loss — only the server broadcasts results, preventing cheating
- **Numeric matchmaker properties**: Nakama's matchmaker query language works reliably with numeric properties (`mode: 0` / `mode: 1`) for mode separation; string properties were inconsistent
- **Server-side rejection for cross-mode pairs**: `RegisterMatchmakerMatched` returns `""` if players have different modes, keeping them in the queue until a same-mode partner joins
- **Unconditional state broadcast every tick**: ensures newly joined clients always receive the current game state without depending on a state-change event
- **Device ID auth**: uses a `localStorage` UUID so the same player always gets the same Nakama user ID across sessions without requiring a password
