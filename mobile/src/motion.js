// motion.js — Device motion capture, state-machine swing detection, and socket relay.

const G = 9.81;

// Raw orientation kept current by deviceorientation listener
const _raw = { alpha: 0, beta: 0, gamma: 0 };

// Calibration baseline
const _baseline = { alpha: 0, beta: 0, gamma: 0 };
let _calibrated = true;   // start calibrated (baseline=0); user can recalibrate for better shot classification
let _listening = false;
let _socket = null;
let _debugCb  = null;   // (mag, state, sent, calls) → void
let _callCount = 0;

// ── State machine ────────────────────────────────────────────────────────────

const S = { IDLE: 'IDLE', LOADING: 'LOADING', SWINGING: 'SWINGING', FOLLOWTHROUGH: 'FOLLOWTHROUGH' };
let _state = S.IDLE;
let _swingFrames = [];
let _peakMag = 0;
let _peakFrame = null;
let _consecutiveHigh = 0;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Snapshot the current raw orientation as the calibration baseline.
 * Call this while the user is standing in their batting stance.
 */
/** Register a callback that receives live { mag, state, sent, calls } for the debug bar. */
export function setDebugCallback(cb) { _debugCb = cb; }

/**
 * Fire a synthetic swing (swipe fallback or tap button).
 * @param {number} power 0–100
 * @param {string} shotType
 */
export function emitSwing(power = 65, shotType = 'DRIVE') {
  if (!_socket) return;
  const quality      = power > 70 ? 80 : power > 50 ? 60 : 40;
  const qualityLabel = power > 70 ? 'GOOD' : power > 50 ? 'MISTIMED' : 'EDGED';
  const payload = {
    power, shotType, quality, qualityLabel,
    peakMag: power / 10, swingDuration: 180,
    alpha: 0, beta: -10, gamma: 5,
    ax: 0, ay: 0, az: 0,
    timestamp: Date.now(),
  };
  _socket.emit('swing', payload);
  _debugCb?.({ mag: payload.peakMag, state: 'FOLLOWTHROUGH', sent: true, calls: _callCount });
  navigator.vibrate?.([60]);
  window.dispatchEvent(new CustomEvent('swing-detected', { detail: payload }));
}

export function captureBaseline() {
  _baseline.alpha = _raw.alpha;
  _baseline.beta  = _raw.beta;
  _baseline.gamma = _raw.gamma;
  _calibrated = true;
  console.log('[motion] captureBaseline →', _baseline);
}

/**
 * Extract relative axes from a DeviceMotionEvent against the stored baseline.
 * @param {DeviceMotionEvent} event
 * @returns {{ rAlpha, rBeta, rGamma, ax, ay, az, gx, gy, gz }}
 */
export function getRelative(event) {
  const a = event.accelerationIncludingGravity ?? event.acceleration ?? {};
  const r = event.rotationRate ?? {};

  const ax = (a.x ?? 0) / G;
  const ay = (a.y ?? 0) / G;
  const az = (a.z ?? 0) / G;
  const gx = r.alpha ?? 0;
  const gy = r.beta  ?? 0;
  const gz = r.gamma ?? 0;

  const rAlpha = _raw.alpha - _baseline.alpha;
  const rBeta  = _raw.beta  - _baseline.beta;
  const rGamma = _raw.gamma - _baseline.gamma;

  return { rAlpha, rBeta, rGamma, ax, ay, az, gx, gy, gz };
}

/**
 * Map peak G-force (2.0–10.0) to a 0–100 power value.
 * @param {number} peakMagnitude
 * @returns {number} integer 0–100
 */
export function calculatePower(peakMagnitude) {
  return Math.max(0, Math.min(100, Math.round(((peakMagnitude - 2.0) / 8.0) * 100)));
}

/**
 * Classify shot type from relative orientation angles and power.
 * @param {number} rAlpha
 * @param {number} rGamma
 * @param {number} rBeta
 * @param {number} power
 * @returns {string}
 */
export function classifyShot(rAlpha, rGamma, rBeta, power) {
  if (rGamma < -30 && rBeta < -20)                      return 'SWEEP';
  if (rGamma > 30  && rBeta < -20)                      return 'REVERSE SWEEP';
  if (rBeta < -40)                                       return 'HOOK';
  if (rBeta < -20 && power > 60)                        return 'PULL';
  if (rGamma >= -20 && rGamma <= 20 && power > 50)      return 'DRIVE';
  if (rGamma >= -20 && rGamma <= 20 && power <= 50)     return 'DEFENSIVE';
  if (rGamma > 20)                                       return 'CUT';
  return 'DRIVE';
}

/**
 * Run the 4-state swing detector against a DeviceMotionEvent.
 * Emits via socket and fires a DOM CustomEvent on completion.
 * @param {DeviceMotionEvent} motionEvent
 */
export function detectSwing(motionEvent) {
  if (!_calibrated) return;

  const { rAlpha, rBeta, rGamma, ax, ay, az, gx, gy, gz } = getRelative(motionEvent);
  const mag = Math.sqrt(ax * ax + ay * ay + az * az);
  const ts  = Date.now();

  _callCount++;
  _debugCb?.({ mag, state: _state, sent: false, calls: _callCount });

  switch (_state) {

    case S.IDLE:
      if (mag > 1.8) {
        _consecutiveHigh++;
        if (_consecutiveHigh >= 2) {
          _state = S.LOADING;
          _swingFrames = [];
          _peakMag = 0;
          _peakFrame = null;
          _consecutiveHigh = 0;
          console.log('[motion] IDLE → LOADING');
        }
      } else {
        _consecutiveHigh = 0;
      }
      break;

    case S.LOADING:
      if (mag > 1.5) {
        _state = S.SWINGING;
        console.log('[motion] LOADING → SWINGING');
      } else if (mag < 1.1) {
        _state = S.IDLE;
        _consecutiveHigh = 0;
        console.log('[motion] LOADING → IDLE (false start)');
      }
      break;

    case S.SWINGING: {
      const frame = { mag, ax, ay, az, gx, gy, gz, rAlpha, rBeta, rGamma, ts };
      _swingFrames.push(frame);
      if (mag > _peakMag) {
        _peakMag  = mag;
        _peakFrame = frame;
      }
      if (mag < 1.1) {
        _state = S.FOLLOWTHROUGH;
        console.log('[motion] SWINGING → FOLLOWTHROUGH, peakMag=', _peakMag.toFixed(2));
      }
      break;
    }

    case S.FOLLOWTHROUGH: {
      const peak = _peakFrame ?? _swingFrames[0] ?? {};
      const power    = calculatePower(_peakMag);
      const shotType = classifyShot(
        peak.rAlpha ?? 0,
        peak.rGamma ?? 0,
        peak.rBeta  ?? 0,
        power
      );
      const swingDuration = _swingFrames.length > 1
        ? _swingFrames[_swingFrames.length - 1].ts - _swingFrames[0].ts
        : 0;

      // ── Swing quality rating ──────────────────────────────────────────────
      // timing: decisiveness of the peak — clean swings have a high peak/avg ratio.
      const frameCount = _swingFrames.length;
      const avgMag = frameCount > 0
        ? _swingFrames.reduce((sum, f) => sum + f.mag, 0) / frameCount
        : _peakMag;
      const timingScore = Math.min(100, Math.max(0,
        Math.round((_peakMag / Math.max(avgMag, 0.5) - 1) * 90)
      ));
      const quality = Math.round(power * 0.5 + timingScore * 0.5);
      const qualityLabel =
        quality > 80 ? 'PERFECT' :
        quality > 60 ? 'GOOD'    :
        quality > 40 ? 'MISTIMED': 'EDGED';

      const payload = {
        power,
        shotType,
        quality,
        qualityLabel,
        peakMag: _peakMag,
        swingDuration,
        alpha: peak.rAlpha ?? 0,
        beta:  peak.rBeta  ?? 0,
        gamma: peak.rGamma ?? 0,
        ax: peak.ax ?? 0,
        ay: peak.ay ?? 0,
        az: peak.az ?? 0,
        timestamp: ts,
      };

      // Emit binary Float32Array for minimal bandwidth
      const bin = new Float32Array([
        payload.power, payload.peakMag, payload.swingDuration,
        payload.alpha, payload.beta,   payload.gamma,
        payload.ax,   payload.ay,      payload.az,
      ]);
      _socket?.emit('swing-binary', bin.buffer);
      _socket?.emit('swing', payload);

      _debugCb?.({ mag, state: 'FOLLOWTHROUGH', sent: true, calls: _callCount });

      // Haptic feedback so user knows the swing was registered
      navigator.vibrate?.([power > 70 ? 120 : 60]);

      // Notify the UI via DOM event (decoupled from socket)
      window.dispatchEvent(new CustomEvent('swing-detected', { detail: payload }));

      console.log('[motion] FOLLOWTHROUGH → IDLE  shot=%s  power=%d', shotType, power);

      _state = S.IDLE;
      _swingFrames = [];
      _peakMag = 0;
      _peakFrame = null;
      _consecutiveHigh = 0;
      break;
    }
  }
}

// ── Swipe-based swing detection (fallback when DeviceMotion is blocked) ───────

let _swipeStart = null;

function _onTouchStart(e) {
  const t = e.touches[0];
  _swipeStart = { x: t.clientX, y: t.clientY, ts: Date.now() };
}

function _onTouchEnd(e) {
  if (!_swipeStart) return;
  const t  = e.changedTouches[0];
  const dx = t.clientX - _swipeStart.x;
  const dy = t.clientY - _swipeStart.y;
  const dt = Date.now() - _swipeStart.ts;
  _swipeStart = null;

  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 55 || dt > 700) return;   // too slow or too short — ignore taps

  const velocity = dist / dt;   // px / ms
  const power    = Math.min(100, Math.max(10, Math.round(velocity * 130)));

  // Shot type from swipe direction
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;   // -180..180
  let shotType = 'DRIVE';
  if (angle > -30  && angle < 30)   shotType = 'CUT';           // swipe right
  else if (angle > 150 || angle < -150) shotType = 'DEFENSIVE'; // swipe left
  else if (dy > 0) {                                             // downward swipes
    if (dx < -40)      shotType = 'SWEEP';
    else if (dx > 40)  shotType = 'PULL';
    else               shotType = 'DRIVE';
  } else {
    shotType = 'HOOK';    // upward swipe
  }

  emitSwing(power, shotType);
}

/**
 * Request motion permissions (iOS gate), attach listeners, and start sending
 * raw orientation to the desktop at 30 Hz.
 *
 * @param {import('socket.io-client').Socket} socket
 * @param {string} roomId
 * @returns {Promise<void>}  Rejects if permission is denied.
 */
export async function startListening(socket, roomId) {
  if (_listening) return;
  _socket = socket;

  // ── Swipe detection — always enabled, works without HTTPS ────────────────
  window.addEventListener('touchstart', _onTouchStart, { passive: true });
  window.addEventListener('touchend',   _onTouchEnd,   { passive: true });

  // ── DeviceMotion — only works on HTTPS non-localhost or iOS with permission ─
  let motionGranted = false;
  try {
    if (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'
    ) {
      const state = await DeviceMotionEvent.requestPermission();
      motionGranted = state === 'granted';
    } else if (typeof DeviceMotionEvent !== 'undefined') {
      // Android/desktop — try attaching; if events never fire the swipe path handles it.
      motionGranted = true;
    }

    if (motionGranted) {
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        await DeviceOrientationEvent.requestPermission().catch(() => {});
      }

      window.addEventListener('deviceorientation', (e) => {
        _raw.alpha = e.alpha ?? 0;
        _raw.beta  = e.beta  ?? 0;
        _raw.gamma = e.gamma ?? 0;
      }, { passive: true });

      window.addEventListener('devicemotion', detectSwing, { passive: true });

      setTimeout(() => { if (!_calibrated) captureBaseline(); }, 600);

      // Stream bat-angle to desktop at 30 Hz.
      setInterval(() => {
        socket.emit('orientation', {
          alpha: _raw.alpha - _baseline.alpha,
          beta:  _raw.beta  - _baseline.beta,
          gamma: _raw.gamma - _baseline.gamma,
        });
      }, 1000 / 30);
    }
  } catch (err) {
    console.warn('[motion] DeviceMotion unavailable, swipe-only mode:', err.message);
  }

  _listening = true;
  console.log('[motion] startListening — swipe=%s motion=%s roomId=%s', true, motionGranted, roomId);
}
