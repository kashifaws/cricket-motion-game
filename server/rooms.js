/**
 * rooms.js — Map-based room store for the cricket motion relay server.
 *
 * Shape of each entry:
 *   roomId -> { desktop: socketId, mobile: socketId | null, createdAt: Date }
 */

const ROOM_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** @type {Map<string, { desktop: string, mobile: string|null, createdAt: Date }>} */
const rooms = new Map();

/**
 * Create a new room keyed by roomId, initially with no mobile client.
 * @param {string} roomId - UUID for the room.
 * @param {string} desktopId - Socket ID of the desktop client.
 */
export function createRoom(roomId, desktopId) {
  rooms.set(roomId, { desktop: desktopId, mobile: null, createdAt: new Date() });
}

/**
 * Assign a mobile socket to an existing room.
 * @param {string} roomId
 * @param {string} mobileId - Socket ID of the mobile client.
 * @returns {boolean} True if the room existed and was updated.
 */
export function joinRoom(roomId, mobileId) {
  const room = rooms.get(roomId);
  if (!room) return false;
  room.mobile = mobileId;
  return true;
}

/**
 * Retrieve a room by ID.
 * @param {string} roomId
 * @returns {{ desktop: string, mobile: string|null, createdAt: Date } | undefined}
 */
export function getRoom(roomId) {
  return rooms.get(roomId);
}

/**
 * Find the room that contains a given socket ID (either role).
 * @param {string} socketId
 * @returns {{ roomId: string, room: { desktop: string, mobile: string|null, createdAt: Date } } | null}
 */
export function findRoomBySocket(socketId) {
  for (const [roomId, room] of rooms) {
    if (room.desktop === socketId || room.mobile === socketId) {
      return { roomId, room };
    }
  }
  return null;
}

/**
 * Delete a room by ID.
 * @param {string} roomId
 */
export function deleteRoom(roomId) {
  rooms.delete(roomId);
}

// Purge rooms older than ROOM_TTL_MS every minute.
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (now - room.createdAt.getTime() > ROOM_TTL_MS) {
      rooms.delete(roomId);
    }
  }
}, 60_000);
