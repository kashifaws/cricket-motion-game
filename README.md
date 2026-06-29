# Cricket Motion Game

A motion-controlled cricket game where your smartphone becomes a bat. Swing your phone to play shots; the desktop shows the Three.js match view with a live scorecard.

```
[Phone]  ──WebSocket──▶  [Relay Server]  ──WebSocket──▶  [Desktop Browser]
 mobile controller          Node/Socket.io          Three.js game engine
 (localhost:5174)           (localhost:3001)         (localhost:5173)
```

---

## Prerequisites

- **Node.js 18+** — check with `node -v`
- A **smartphone on the same Wi-Fi network** as your development machine
- A modern mobile browser (Safari iOS 13+ for DeviceMotion permission; Chrome Android)

---

## Setup

Install dependencies in each package (one-time):

```bash
cd server  && npm install && cd ..
cd mobile  && npm install && cd ..
cd desktop && npm install && cd ..
```

Copy the server environment file and adjust if needed:

```bash
cp server/.env.example server/.env
```

---

## Run

From the repo root, start all three processes together:

```bash
npm run dev
```

This runs concurrently:
| Process | URL | Script |
|---------|-----|--------|
| Relay server | `http://localhost:3001` | `server/index.js` via nodemon |
| Mobile controller | `http://localhost:5174` | Vite dev server |
| Desktop game | `http://localhost:5173` | Vite dev server |

Individual processes can be started separately:

```bash
npm run dev:server
npm run dev:mobile
npm run dev:desktop
```

---

## Playing

1. Open `http://localhost:5173` in a desktop browser — a QR code appears.
2. **Scan the QR code** with your phone. The mobile controller loads automatically.
3. On your phone, tap **Calibrate** while holding the phone naturally (as you'd hold a bat), then tap it again.
4. Wait for the first delivery — then **swing your phone** to play a shot.

### Scoring

| Shot | Condition |
|------|-----------|
| Six  | Lofted swing (phone angled down), power ≥ 72% |
| Four | Power ≥ 55% |
| Single | Power ≥ 20% |
| Dot | Weak contact (power < 20%) |
| Wicket | No swing during window, or power < 8% |

Timing matters: swing early → leg side; swing late → off side; on-time → straight.

---

## Testing motion on a real phone over Wi-Fi

Vite prints your local network IP in the terminal output, e.g.:

```
➜  Local:   http://localhost:5174/
➜  Network: http://192.168.1.42:5174/
```

The relay server hardcodes `localhost` in the QR URL. To test over Wi-Fi, replace `localhost` in the QR link with your machine's LAN IP before scanning:

```
http://192.168.1.42:5174?room=<ROOM_ID>
```

You can find `<ROOM_ID>` displayed under the QR code on the desktop.

> **iOS note**: Safari will prompt for motion permission the first time. Tap **Allow** when the browser asks.

---

## Dev keyboard shortcuts (no phone needed)

| Key | Action |
|-----|--------|
| `S` | Simulate a medium-power (55%) straight drive — fires during any active delivery |

The `S` key injects a synthetic swing event with perfect timing (timingOffset = 0), so the outcome is a **four** hit straight back down the ground. Useful for testing the full delivery → shot → scorecard cycle without a phone.

---

## Project structure

```
cricket-motion-game/
├── server/          # Socket.io relay (Node.js, ES modules)
│   ├── index.js     # Express + Socket.io, room lifecycle, QR generation
│   ├── rooms.js     # Map-based room store with 30-min TTL
│   └── .env.example
├── mobile/          # Phone controller (Vite, vanilla JS)
│   └── src/
│       ├── main.js    # Socket.io connection, pairing flow
│       ├── motion.js  # DeviceMotion capture, calibration, swing detection
│       └── ui.js      # Status text, power bar, haptic helpers
├── desktop/         # Three.js game (Vite, vanilla JS)
│   └── src/
│       ├── main.js      # Socket.io connection, orchestration, 'S' key
│       ├── engine.js    # Three.js scene, delivery animation, shot physics
│       ├── scorecard.js # HTML overlay scoreboard
│       └── ai.js        # BowlerAI — adapts line and type from shot history
└── package.json     # Root — concurrently dev script
```
