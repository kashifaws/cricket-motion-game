/**
 * main.js — Desktop entry point.
 *
 * Boot sequence:
 *   1. Connect to relay server as 'desktop'.
 *   2. On 'room-created': show QR overlay; init engine.
 *   3. On 'paired': hide overlay, start match.
 *   4. On 'swing': animate batsman, evaluate hit, update score.
 *   5. On 'orientation': mirror phone tilt onto bat.
 */

import { io } from 'socket.io-client';
import { GameEngine }  from './engine.js';
import { Scorecard }   from './scorecard.js';
import { BowlerAI }    from './ai.js';
import './style.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const canvas    = /** @type {HTMLCanvasElement} */ (document.getElementById('game-canvas'));
const qrOverlay = /** @type {HTMLElement} */       (document.getElementById('qr-overlay'));
const qrImg     = /** @type {HTMLImageElement} */  (document.getElementById('qr-img'));
const roomIdEl  = /** @type {HTMLElement} */       (document.getElementById('qr-room-id'));
const statusEl  = /** @type {HTMLElement} */       (document.getElementById('qr-status'));

// ── Sound engine ──────────────────────────────────────────────────────────────

/**
 * Procedural sound effects using the Web Audio API.
 * AudioContext is created lazily on first sound call so the browser's
 * autoplay policy is never triggered before a user gesture (swing).
 */
class SoundEngine {
  #ctx = null;

  /** Ensure AudioContext exists and is running. */
  #ac() {
    if (!this.#ctx) {
      this.#ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.#ctx.state === 'suspended') this.#ctx.resume();
    return this.#ctx;
  }

  /** Create a short noise buffer and return a connected BufferSource node. */
  #noiseSource(ctx, durationS) {
    const sr  = ctx.sampleRate;
    const buf = ctx.createBuffer(1, Math.ceil(sr * durationS), sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  /** Sawtooth sweep — bat cutting through air. */
  whoosh() {
    const ctx = this.#ac();
    const now = ctx.currentTime;

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.08);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.start(now);
    osc.stop(now + 0.10);
  }

  /** White-noise crack — bat on ball. Pitch rises with power. */
  crack(power = 55) {
    const ctx = this.#ac();
    const now = ctx.currentTime;

    const src  = this.#noiseSource(ctx, 0.06);
    const filt = ctx.createBiquadFilter();
    filt.type            = 'bandpass';
    filt.frequency.value = 1800 + power * 22;
    filt.Q.value         = 0.7;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.75, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    src.connect(filt);
    filt.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
  }

  /** Two-second crowd roar for a SIX. */
  six() {
    const ctx = this.#ac();
    const now = ctx.currentTime;
    const dur = 2.0;

    // Crowd cheer — low-passed noise
    const cheer = this.#noiseSource(ctx, dur);
    const lp    = ctx.createBiquadFilter();
    lp.type            = 'lowpass';
    lp.frequency.value = 650;

    const cheerGain = ctx.createGain();
    cheerGain.gain.setValueAtTime(0, now);
    cheerGain.gain.linearRampToValueAtTime(0.55, now + 0.35);
    cheerGain.gain.setValueAtTime(0.55, now + 1.5);
    cheerGain.gain.linearRampToValueAtTime(0, now + dur);

    cheer.connect(lp);
    lp.connect(cheerGain);
    cheerGain.connect(ctx.destination);
    cheer.start(now);

    // Low rumble oscillator
    const osc  = ctx.createOscillator();
    const rGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 75;
    osc.connect(rGain);
    rGain.connect(ctx.destination);
    rGain.gain.setValueAtTime(0, now);
    rGain.gain.linearRampToValueAtTime(0.16, now + 0.25);
    rGain.gain.setValueAtTime(0.16, now + 1.6);
    rGain.gain.linearRampToValueAtTime(0, now + dur);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  }

  /** Two quick rattles — stumps hit the ground. */
  stumps() {
    const ctx = this.#ac();
    const now = ctx.currentTime;

    [0, 0.08].forEach(offset => {
      const src = this.#noiseSource(ctx, 0.22);
      const bp  = ctx.createBiquadFilter();
      bp.type            = 'bandpass';
      bp.frequency.value = 1350;
      bp.Q.value         = 1.4;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.55, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.22);

      src.connect(bp);
      bp.connect(gain);
      gain.connect(ctx.destination);
      src.start(now + offset);
    });
  }
}

// ── Brief overlay ─────────────────────────────────────────────────────────────

/** Singleton brief-text overlay — styled by #game-brief in style.css. */
let _briefEl = null;
let _briefTimer = null;

function showBrief(text, color = '#ffffff', durationMs = 2000, isPractice = false) {
  if (!_briefEl) {
    _briefEl = document.createElement('div');
    _briefEl.id = 'game-brief';
    document.body.appendChild(_briefEl);
  }
  _briefEl.textContent = text;
  _briefEl.style.color = color;
  _briefEl.classList.toggle('practice', isPractice);

  // Force reflow so removing + re-adding the class restarts the animation.
  _briefEl.classList.remove('pop-enter', 'pop-exit');
  void _briefEl.offsetWidth;
  _briefEl.classList.add('pop-enter');

  clearTimeout(_briefTimer);
  _briefTimer = setTimeout(() => {
    _briefEl.classList.remove('pop-enter');
    _briefEl.classList.add('pop-exit');
  }, durationMs);
}

// ── Game objects ──────────────────────────────────────────────────────────────

const scorecard  = new Scorecard();
const bowlerAI   = new BowlerAI();
const sounds     = new SoundEngine();

/** @type {GameEngine|null} */
let engine = null;

let gameRunning = false;

// ── Socket.io ─────────────────────────────────────────────────────────────────

const socket = io(SERVER_URL, {
  query:      { role: 'desktop' },
  transports: ['polling', 'websocket'],
});

socket.on('connect', () => {
  statusEl.textContent = 'Connected — generating room…';
});

socket.on('connect_error', (err) => {
  statusEl.textContent = `Cannot reach server: ${err.message}`;
});

socket.on('room-created', ({ roomId, qrUrl }) => {
  qrImg.src            = qrUrl;
  qrImg.alt            = `QR code for room ${roomId}`;
  qrImg.classList.remove('hidden');          // reveal QR image now that it has a src
  roomIdEl.textContent = roomId.slice(0, 8).toUpperCase();
  statusEl.textContent = 'Scan with your phone to start playing';

  try {
    engine = new GameEngine(canvas, handleShotResult);
    engine.start();
    console.log('[main] GameEngine started');
  } catch (err) {
    console.error('[main] GameEngine failed to start:', err);
    statusEl.textContent = `Engine error: ${err.message}`;
    qrImg.classList.add('hidden');
    qrOverlay.classList.remove('hidden');
  }
});

socket.on('paired', () => {
  qrOverlay.classList.add('hidden');
  scorecard.setBatsman('Player 1');
  gameRunning = true;
  setTimeout(startNextDelivery, 1200);
});

/**
 * Raw ArrayBuffer from mobile — legacy path, kept for backward compatibility
 * with older mobile builds that haven't been updated to emit 'swing'.
 */
socket.on('motion', (data) => {
  engine?.processMotionPacket(data);
});

/**
 * Structured swing event from the mobile motion.js state machine.
 *
 * Flow:
 *   1. Always: animate batsman + show power popup + play whoosh.
 *   2a. If ball is in hit window: evaluate hit → update score → play sounds.
 *   2b. If no ball in play: show brief practice-swing message.
 */
socket.on('swing', (data) => {
  if (!engine) return;

  // 1. Visual: bat animation + in-scene power sprite
  engine.animateSwing(data.shotType, data.power, data.alpha, data.beta, data.gamma);
  scorecard.showPower(data.power, data.shotType);

  // 2. Audio: whoosh on every swing
  sounds.whoosh();

  // 3. Physics evaluation.
  // Use desktop performance.now() as timestamp — both hitWindow.arrivalTime
  // and the timing comparison must be on the same clock (desktop).
  const result = engine.evaluateHit({
    timestamp:  performance.now(),
    power:      data.power,
    alpha:      data.alpha,
    beta:       data.beta,
    gamma:      data.gamma,
    shotType:   data.shotType,
  });

  if (result) {
    // Ball was in play and bat connected — handle the outcome immediately
    sounds.crack(data.power);
    if (result.type === 'six')  sounds.six();
    handleShotResult(result);
  } else if (!engine.inPlay) {
    // No ball in flight — this was a practice swing
    showBrief(`Practice swing — ${data.power} power`, '#a8c8a8', 1400, true);
  }
  // else: ball was in play but swing arrived outside hit window — miss is
  // handled automatically by the engine's ball-travel loop (#stepBall).
});

/**
 * Raw 30 Hz orientation stream — mirrors phone tilt onto the on-screen bat
 * while no swing tween is running.
 */
socket.on('orientation', ({ beta, gamma }) => {
  engine?.updateBatAngle(beta, gamma);
});

socket.on('peer-disconnected', () => {
  gameRunning = false;
  statusEl.textContent = 'Phone disconnected — please reload and scan again.';
  qrImg.src = '';
  qrImg.classList.add('hidden');
  qrOverlay.classList.remove('hidden');
});

socket.on('disconnect', () => {
  gameRunning = false;
});

// ── Game flow ─────────────────────────────────────────────────────────────────

/**
 * Resolve a delivery and schedule the next one.
 * Called both from the swing handler (for hits) and from the engine callback
 * (for misses detected by ball-travel expiry).
 *
 * @param {{ type: string, direction: string }} result
 */
function handleShotResult({ type, direction }) {
  scorecard.update(/** @type {any} */ (type));

  if (direction) bowlerAI.recordShot(/** @type {any} */ (direction));

  if (type === 'wicket') {
    sounds.stumps();
    showBrief('BOWLED!', '#ff5252', 2200);
    socket.emit('game-event', { type: 'wicket' });
  } else if (type === 'six') {
    socket.emit('game-event', { type: 'six' });
  } else if (type === 'four') {
    showBrief('FOUR!', '#ffab40', 1600);
  }

  if (!gameRunning) return;
  const delay = type === 'wicket' ? 3000 : 1800;
  setTimeout(startNextDelivery, delay);
}

function startNextDelivery() {
  if (!gameRunning || !engine) return;
  engine.deliveryStart(bowlerAI.nextDeliveryType(), bowlerAI.lineOffset);
}

// ── Dev keyboard shortcuts ────────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  if (e.key === 's' || e.key === 'S') {
    // Simulate a medium-power straight drive
    if (engine) {
      const fakePower = 55;
      engine.animateSwing('DRIVE', fakePower, 0, -5, 0);
      sounds.whoosh();
      const result = engine.evaluateHit({
        timestamp: performance.now(),  // desktop clock, matches hitWindow.arrivalTime
        power: fakePower,
        alpha: 0, beta: -5, gamma: 0,
        shotType: 'DRIVE',
      });
      if (result) {
        sounds.crack(fakePower);
        if (result.type === 'six') sounds.six();
        handleShotResult(result);
      } else {
        engine.simulateSwing(fakePower, -5);
      }
    }
  }
});
