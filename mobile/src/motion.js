// motion.js — Device motion capture, state-machine swing detection, and socket relay.
//
// Orientation is tracked end-to-end as quaternions (see orientation.js). Raw
// alpha/beta/gamma numbers are only ever read out of a quaternion at the
// moment they're needed (calibration snapshot, swing-peak snapshot) — never
// diffed or interpolated as independent Euler numbers, since that doesn't
// compose correctly for combined rotations.

import { Quaternion, Euler, MathUtils } from 'three';
import { deviceOrientationToQuaternion, getScreenOrientationAngle } from './orientation.js';

const G = 9.81;

// ── Quaternion orientation state ────────────────────────────────────────────

// Live device quaternion, updated on every 'deviceorientation' event.
const _liveQuaternion = new Quaternion();
// Inverse of the device quaternion captured at calibration ("ready stance").
const _referenceQuaternion = new Quaternion();
// referenceQuaternion * liveQuaternion — how far the phone has moved from stance.
const _relativeQuaternion = new Quaternion();
const _decomposeEuler = new Euler();

let _calibrated = false;
let _handedness  = 'right'; // 'right' | 'left'
let _listening   = false;
let _socket      = null;
let _debugCb     = null;   // (mag, state, sent, calls) → void
let _callCount   = 0;
let _streamTimer = null;

// ── State machine ────────────────────────────────────────────────────────────

const S = { IDLE: 'IDLE', LOADING: 'LOADING', SWINGING: 'SWINGING', FOLLOWTHROUGH: 'FOLLOWTHROUGH' };
let _state = S.IDLE;
let _swingFrames = [];
let _peakMag = 0;          // peak accelerometer G-force (drives power)
let _peakAngSpeed = 0;      // peak gyroscope angular speed (drives swing-peak instant)
let _peakAngFrame = null;   // frame captured at peak angular speed
let _peakMagFrame = null;   // frame captured at peak accel — fallback if no gyro
let _consecutiveHigh = 0;

// ── Public API ───────────────────────────────────────────────────────────────

/** Register a callback that receives live { mag, state, sent, calls } for the debug bar. */
export function setDebugCallback(cb) { _debugCb = cb; }

/**
 * Set batting handedness. Received from desktop on pairing.
 * @param {'right'|'left'} hand
 */
export function setHandedness(hand) {
  _handedness = hand === 'left' ? 'left' : 'right';
  console.log('[motion] handedness →', _handedness);
}

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

/**
 * Snapshot the current live device quaternion as the calibration baseline
 * ("ready stance"). Everything downstream is expressed relative to this.
 */
export function captureBaseline() {
  _referenceQuaternion.copy(_liveQuaternion).invert();
  _calibrated = true;
  console.log('[motion] captureBaseline — reference quaternion set');
}

/**
 * Request iOS 13+ motion/orientation permission. MUST be called from within
 * a user gesture handler (e.g. a button tap), not on page load, or iOS
 * Safari silently rejects it.
 * @returns {Promise<boolean>} true if granted (or not required, e.g. Android).
 */
export async function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    const result = await DeviceOrientationEvent.requestPermission();
    return result === 'granted';
  }
  return true; // Android / non-iOS — no permission gate exists.
}

/**
 * Extract linear-acceleration + gyroscope readings from a DeviceMotionEvent,
 * plus a snapshot of the current relative orientation quaternion.
 * @param {DeviceMotionEvent} event
 */
function sampleMotion(event) {
  const a = event.accelerationIncludingGravity ?? event.acceleration ?? {};
  const r = event.rotationRate ?? {};

  const ax = (a.x ?? 0) / G;
  const ay = (a.y ?? 0) / G;
  const az = (a.z ?? 0) / G;
  const gx = r.alpha ?? 0;
  const gy = r.beta  ?? 0;
  const gz = r.gamma ?? 0;

  const mag      = Math.sqrt(ax * ax + ay * ay + az * az);
  const angSpeed = Math.sqrt(gx * gx + gy * gy + gz * gz);

  return { ax, ay, az, gx, gy, gz, mag, angSpeed };
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
 * Classify shot type from the TRAJECTORY of the swing, not just static orientation.
 *
 * Physics of how the player holds the phone:
 *   Portrait, screen toward body, held like a bat handle.
 *   ax: positive = phone moves RIGHT  (off side for right-hander)
 *   ay: positive = phone moves UP     (hook/pull territory)
 *   az: negative = phone moves FORWARD toward screen (into the ball)
 *   rGamma: positive = phone tilted to the RIGHT from calibration pose
 *   rBeta:  negative = phone tilted FORWARD (bent-knee sweep position)
 *
 * rGamma/rBeta are read out of the relative orientation quaternion at the
 * detected swing-peak instant (see detectSwing) — never accumulated or
 * interpolated as raw Euler numbers.
 *
 * @param {number} rGamma  — relative roll (°) from calibration, at swing peak
 * @param {number} rBeta   — relative pitch (°) from calibration, at swing peak
 * @param {number} ax      — peak-frame x acceleration (G units)
 * @param {number} ay      — peak-frame y acceleration (G units)
 * @param {number} az      — peak-frame z acceleration (G units)
 * @param {number} power   — 0–100
 * @param {'right'|'left'} handedness
 * @returns {string}
 */
export function classifyShot(rGamma, rBeta, ax, ay, az, power, handedness = 'right') {
  // For left-hander: off side is to the left of the phone (negative x)
  const sign = handedness === 'left' ? -1 : 1;

  // Lateral direction from acceleration (most reliable: captures actual swing path)
  const latAcc   = ax * sign;   // >0 = off side, <0 = leg side
  const vertAcc  = ay;           // >0 = upward swing, <0 = downward
  // Orientation at rest position (static indicators of stance/shot setup)
  const gammaOff = rGamma * sign; // >0 = tilted toward off side

  // ── HOOK: bat rises to meet short rising ball, sweeps to leg ──────────────
  // Signature: strong upward acceleration, leg-side lateral
  if (vertAcc > 0.40 && latAcc < -0.15)  return 'HOOK';
  if (vertAcc > 0.55)                     return 'HOOK';  // almost purely upward

  // ── PULL: horizontal pull to leg side at waist height ─────────────────────
  // Like hook but less vertical; bat comes across body
  if (vertAcc > 0.18 && latAcc < -0.28 && power > 40)  return 'PULL';

  // ── SWEEP: bent-knee position, bat goes low across to leg ─────────────────
  // Signature: significant forward body lean (negative rBeta) + leg-side movement
  if (rBeta < -22 && latAcc < -0.18)   return 'SWEEP';
  if (rBeta < -38)                       return 'SWEEP';  // very bent knee
  // Leg-side gamma tilt also indicates sweep setup
  if (gammaOff < -28 && rBeta < -15)   return 'SWEEP';

  // ── REVERSE SWEEP: same low position but to off side ──────────────────────
  if (rBeta < -22 && latAcc > 0.22)    return 'REVERSE SWEEP';
  if (gammaOff > 35 && rBeta < -15)    return 'REVERSE SWEEP';

  // ── CUT: short wide ball, horizontal slash to off side ────────────────────
  // Signature: strong off-side lateral acceleration, not particularly upward
  if (latAcc > 0.32 && Math.abs(vertAcc) < 0.35)  return 'CUT';
  if (gammaOff > 30 && vertAcc < 0.20)             return 'CUT';

  // ── DRIVE: straight bat through the line ──────────────────────────────────
  if (power > 45)  return 'DRIVE';

  // ── DEFENSIVE: low-power straight bat ─────────────────────────────────────
  return 'DEFENSIVE';
}

/**
 * Run the 4-state swing detector against a DeviceMotionEvent.
 * The swing lifecycle (IDLE→LOADING→SWINGING→FOLLOWTHROUGH) is still driven
 * by accelerometer magnitude, but the orientation SAMPLE used for shot
 * classification is taken at the peak of gyroscope angular speed — the
 * actual swing/impact instant — rather than at the peak of acceleration or
 * some arbitrary later moment.
 * @param {DeviceMotionEvent} motionEvent
 */
export function detectSwing(motionEvent) {
  if (!_calibrated) return;

  const { ax, ay, az, gx, gy, gz, mag, angSpeed } = sampleMotion(motionEvent);
  const ts = Date.now();

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
          _peakAngSpeed = 0;
          _peakAngFrame = null;
          _peakMagFrame = null;
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
      const frame = { mag, angSpeed, ax, ay, az, quaternion: _relativeQuaternion.clone(), ts };
      _swingFrames.push(frame);
      if (mag > _peakMag) {
        _peakMag = mag;
        _peakMagFrame = frame;
      }
      if (angSpeed > _peakAngSpeed) {
        _peakAngSpeed = angSpeed;
        _peakAngFrame = frame;
      }
      if (mag < 1.1) {
        _state = S.FOLLOWTHROUGH;
        console.log('[motion] SWINGING → FOLLOWTHROUGH, peakMag=%s peakAngSpeed=%s',
          _peakMag.toFixed(2), _peakAngSpeed.toFixed(1));
      }
      break;
    }

    case S.FOLLOWTHROUGH: {
      // Prefer the gyroscope-peak instant (the actual swing/impact moment);
      // fall back to the accel-peak frame on devices with no rotationRate.
      const peak = _peakAngFrame ?? _peakMagFrame ?? _swingFrames[0] ?? {};
      const peakQuaternion = peak.quaternion ?? _relativeQuaternion;

      _decomposeEuler.setFromQuaternion(peakQuaternion, 'YXZ');
      const relAlpha = MathUtils.radToDeg(_decomposeEuler.y);  // yaw
      const relBeta  = MathUtils.radToDeg(_decomposeEuler.x);  // pitch
      const relGamma = MathUtils.radToDeg(_decomposeEuler.z);  // roll

      const power    = calculatePower(_peakMag);
      const shotType = classifyShot(
        relGamma, relBeta,
        peak.ax ?? 0, peak.ay ?? 0, peak.az ?? 0,
        power,
        _handedness,
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
        rotMag: _peakAngSpeed, // total gyro magnitude at the swing peak — feeds desktop's helicopter gate
        swingDuration,
        alpha: relAlpha,
        beta:  relBeta,
        gamma: relGamma,
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
      _peakAngSpeed = 0;
      _peakAngFrame = null;
      _peakMagFrame = null;
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

  // For left-hander: mirror horizontal axis so swipe-right = leg side
  const sign    = _handedness === 'left' ? -1 : 1;
  const offDx   = dx * sign;   // positive = swipe toward off side
  const legDx   = -offDx;      // positive = swipe toward leg side

  let shotType;
  if (dy < -50)                      shotType = 'HOOK';          // swipe UP
  else if (dy > 40 && legDx > 40)   shotType = 'SWEEP';         // swipe DOWN+leg
  else if (dy > 40 && offDx > 40)   shotType = 'PULL';          // swipe DOWN+off
  else if (offDx > 60)               shotType = 'CUT';           // swipe to off side
  else if (legDx > 60)               shotType = 'SWEEP';         // swipe to leg side
  else if (dy > 30)                  shotType = 'DRIVE';         // swipe down
  else                               shotType = power > 50 ? 'DRIVE' : 'DEFENSIVE';

  emitSwing(power, shotType);
}

/**
 * Request motion permissions (iOS gate), attach listeners, and start sending
 * the relative orientation quaternion to the desktop at 30 Hz.
 *
 * Must be invoked from within a user-gesture handler on iOS — this is always
 * called from the "I'm ready" tap in main.js, so that requirement is met.
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

  // ── DeviceOrientation / DeviceMotion — need explicit iOS permission ───────
  // Both permissions are requested and checked explicitly — a silent
  // rejection here must not be swallowed, or the game falls back to
  // swipe-only mode with no explanation, which looks like a hang.
  let orientationGranted = false;
  let motionGranted = false;

  try {
    orientationGranted = await requestOrientationPermission();

    if (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'
    ) {
      const state = await DeviceMotionEvent.requestPermission();
      motionGranted = state === 'granted';
    } else if (typeof DeviceMotionEvent !== 'undefined') {
      motionGranted = true; // Android/desktop — no permission gate exists.
    }

    if (!orientationGranted) {
      throw new Error('Device orientation permission denied — enable Motion & Orientation Access in Settings.');
    }

    window.addEventListener('deviceorientation', (e) => {
      if (e.alpha === null) return; // some browsers fire null events before real data
      deviceOrientationToQuaternion(
        e.alpha, e.beta, e.gamma,
        getScreenOrientationAngle(),
        _liveQuaternion,
      );
      _relativeQuaternion.copy(_referenceQuaternion).multiply(_liveQuaternion);
    }, { passive: true });

    if (motionGranted) {
      window.addEventListener('devicemotion', detectSwing, { passive: true });
    } else {
      console.warn('[motion] DeviceMotion permission denied — swing detection falls back to swipe.');
    }

    setTimeout(() => { if (!_calibrated) captureBaseline(); }, 600);

    // Stream the relative orientation quaternion to the desktop at 30 Hz —
    // drives the live bat mirror between deliveries. [x, y, z, w].
    _streamTimer = setInterval(() => {
      if (!_calibrated) return;
      socket.emit('bat_motion', { q: _relativeQuaternion.toArray() });
    }, 1000 / 30);
  } catch (err) {
    console.warn('[motion] Orientation/motion unavailable, swipe-only mode:', err.message);
    throw err;
  }

  _listening = true;
  console.log('[motion] startListening — swipe=%s orientation=%s motion=%s roomId=%s',
    true, orientationGranted, motionGranted, roomId);

  return { orientationGranted, motionGranted };
}
