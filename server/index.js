import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { networkInterfaces } from 'os';
import { createRoom, joinRoom, getRoom, findRoomBySocket, deleteRoom } from './rooms.js';

const PORT = process.env.PORT || 3001;

/**
 * Collect all routable LAN IPv4 addresses across every adapter.
 *
 * Excluded (never usable from a phone):
 *   - Loopback (127.x.x.x)
 *   - Link-local / APIPA (169.254.x.x)
 *   - Known pure-virtual adapters: Docker, VMware, VirtualBox, WSL, vethernet
 *
 * NOT excluded (must stay to support hotspot / Wi-Fi Direct):
 *   - "virtual" by itself — Windows Hotspot is "Microsoft Wi-Fi Direct Virtual
 *     Adapter" and is a real physical hotspot, NOT a fake adapter.
 *
 * Selection priority for QR code URL:
 *   1. Hotspot subnet: 192.168.137.x  (Windows built-in mobile hotspot)
 *   2. Preferred adapter name: wi-fi / wlan / ethernet / "local area connection"
 *   3. First remaining candidate
 *   4. 'localhost' fallback
 *
 * @returns {{ selected: string, all: string[] }}
 */
function getLanIps() {
  const EXCLUDE   = /vethernet|vmware|docker|wsl|vbox/i;
  const PREFERRED = /wi.?fi|wlan|ethernet|local.?area.?connection/i;
  const HOTSPOT   = /^192\.168\.137\./;

  const candidates = [];

  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (EXCLUDE.test(name)) continue;
    for (const net of addrs) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('169.254.')) continue;
      candidates.push({ name, address: net.address });
    }
  }

  const all = candidates.map(c => c.address);

  // Priority 1: Windows built-in hotspot subnet
  const hotspot   = candidates.find(c => HOTSPOT.test(c.address));
  // Priority 2: well-named Wi-Fi / Ethernet adapter
  const preferred = candidates.find(c => PREFERRED.test(c.name));

  const selected = (hotspot ?? preferred ?? candidates[0])?.address ?? 'localhost';
  return { selected, all };
}

const { selected: LAN_IP, all: ALL_IPS } = getLanIps();

// Production: set MOBILE_URL=https://your-mobile.vercel.app
const MOBILE_BASE_URL = process.env.MOBILE_URL || `http://${LAN_IP}:5174`;

// Production: set ALLOWED_ORIGINS=https://your-desktop.vercel.app,https://your-mobile.vercel.app
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [
      'http://localhost:5173',
      'http://localhost:5174',
      ...ALL_IPS.flatMap(ip => [
        `http://${ip}:5173`,
        `http://${ip}:5174`,
      ]),
    ];

console.log(`[server] Detected LAN IPs: ${ALL_IPS.join(', ') || 'none'}`);
console.log(`[server] Selected IP for QR: ${LAN_IP}`);
console.log(`[server] CORS allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);

const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.get('/health', (_req, res) => res.json({ ok: true, origin: _req.headers.origin, allowedOrigins: ALLOWED_ORIGINS }));

/**
 * Generate a QR code data-URL for a given room ID.
 * @param {string} roomId
 * @returns {Promise<string>} Data-URL string (image/png, base64).
 */
async function buildQrUrl(roomId) {
  const target = `${MOBILE_BASE_URL}?room=${roomId}`;
  return QRCode.toDataURL(target);
}

/**
 * Handle a new desktop client connection.
 * Creates a room, generates a QR code, and emits the pairing info.
 * @param {import('socket.io').Socket} socket
 */
async function onDesktopConnect(socket) {
  const roomId = uuidv4();
  createRoom(roomId, socket.id);

  let qrUrl;
  try {
    qrUrl = await buildQrUrl(roomId);
  } catch (err) {
    console.error('[server] QR generation failed:', err);
    socket.emit('error', { message: 'Failed to generate QR code' });
    return;
  }

  socket.join(roomId);
  socket.emit('room-created', { roomId, qrUrl });
  console.log(`[server] Desktop ${socket.id} created room ${roomId}`);
}

/**
 * Handle a mobile client joining an existing room.
 * Emits 'paired' to the desktop when the room is found.
 * @param {import('socket.io').Socket} socket
 * @param {string} roomId
 */
function onMobileJoin(socket, roomId) {
  const room = getRoom(roomId);
  if (!room) {
    socket.emit('error', { message: `Room ${roomId} not found` });
    return;
  }
  if (room.mobile) {
    socket.emit('error', { message: `Room ${roomId} already has a mobile client` });
    return;
  }

  joinRoom(roomId, socket.id);
  socket.join(roomId);

  // Notify desktop
  io.to(room.desktop).emit('paired', { roomId });
  socket.emit('paired', { roomId });
  console.log(`[server] Mobile ${socket.id} joined room ${roomId}`);
}

/**
 * Generic relay: mobile → desktop or desktop → mobile.
 * @param {import('socket.io').Socket} socket
 * @param {string} event
 * @param {unknown} data
 */
function onRelay(socket, event, data) {
  const result = findRoomBySocket(socket.id);
  if (!result) return;

  const { room } = result;

  // Mobile sends game data to desktop
  if (socket.id === room.mobile && room.desktop) {
    io.to(room.desktop).emit(event, data);
    return;
  }
  // Desktop sends game-event feedback to mobile
  if (socket.id === room.desktop && room.mobile) {
    io.to(room.mobile).emit(event, data);
  }
}

/**
 * Clean up when any socket disconnects.
 * Notifies the remaining paired client and removes the room.
 * @param {import('socket.io').Socket} socket
 */
function onDisconnect(socket) {
  const result = findRoomBySocket(socket.id);
  if (!result) return;

  const { roomId, room } = result;
  const isDesktop = socket.id === room.desktop;
  const peerId = isDesktop ? room.mobile : room.desktop;

  if (peerId) {
    io.to(peerId).emit('peer-disconnected', { role: isDesktop ? 'desktop' : 'mobile' });
  }

  deleteRoom(roomId);
  console.log(`[server] ${isDesktop ? 'Desktop' : 'Mobile'} ${socket.id} left — room ${roomId} deleted`);
}

io.on('connection', (socket) => {
  const { role, room: roomId } = socket.handshake.query;

  if (role === 'desktop') {
    onDesktopConnect(socket);
  } else if (role === 'mobile' && roomId) {
    onMobileJoin(socket, roomId);
  } else {
    socket.emit('error', { message: 'Provide ?role=desktop or ?role=mobile&room=ROOMID' });
    socket.disconnect(true);
    return;
  }

  // Mobile → desktop
  socket.on('motion',        (data) => onRelay(socket, 'motion',        data));
  socket.on('swing',         (data) => onRelay(socket, 'swing',         data));
  socket.on('swing-binary',  (data) => onRelay(socket, 'swing-binary',  data));
  socket.on('orientation',   (data) => onRelay(socket, 'orientation',   data));
  // Desktop → mobile
  socket.on('game-event',    (data) => onRelay(socket, 'game-event',    data));
  socket.on('disconnect', () => onDisconnect(socket));
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Relay server listening on http://0.0.0.0:${PORT}`);
  console.log(`[server] QR codes will point to: ${MOBILE_BASE_URL}`);
});
