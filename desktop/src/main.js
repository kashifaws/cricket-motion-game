/**
 * main.js — Desktop entry point.
 *
 * Match flow state machine:
 *   SETUP          — QR overlay, format / overs / difficulty / hand selectors
 *   TOSS           — coin flip, winner chooses bat/bowl
 *   INNINGS_HUMAN  — the phone player bats (motion-controlled)
 *   BREAK          — innings break screen with target
 *   INNINGS_AI     — AIBatting simulates the other side
 *   RESULT         — match result + scorecards
 *
 * Swing pipeline (human batting):
 *   'swing' socket event → ShotClassifier.classify → CricketRules outcome
 *   → engine.playClassifiedShot (visual matches score) → processEvents.
 */

import { io } from 'socket.io-client';
import { GameEngine }       from './engine.js';
import { Scorecard }        from './scorecard.js';
import { BowlerAI }         from './ai.js';
import { ShotClassifier }   from './game/ShotClassifier.js';
import { CricketRules }     from './game/CricketRules.js';
import { AIBatting }        from './game/AIBatting.js';
import { UmpireController } from './characters/UmpireController.js';
import { FielderAI }        from './characters/FielderAI.js';
import './style.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// Visual timings mirrored from engine.js (bowler run-up + ball flight)
const BOWLER_RUN_MS = 1700;
const DELIVERY_MS   = { pace: 880, spin: 1380, yorker: 680 };

// ── DOM refs ──────────────────────────────────────────────────────────────────

const canvas    = /** @type {HTMLCanvasElement} */ (document.getElementById('game-canvas'));
const qrOverlay = /** @type {HTMLElement} */       (document.getElementById('qr-overlay'));
const qrImg     = /** @type {HTMLImageElement} */  (document.getElementById('qr-img'));
const roomIdEl  = /** @type {HTMLElement} */       (document.getElementById('qr-room-id'));
const statusEl  = /** @type {HTMLElement} */       (document.getElementById('qr-status'));

// ── Camera badge ──────────────────────────────────────────────────────────────

const cameraBadge = (() => {
  const el = document.createElement('div');
  el.id = 'camera-badge';
  document.body.appendChild(el);
  return el;
})();

let _badgeTimer = null;
function showCameraBadge(name) {
  cameraBadge.textContent = `📷 ${name}`;
  cameraBadge.classList.add('visible');
  clearTimeout(_badgeTimer);
  _badgeTimer = setTimeout(() => cameraBadge.classList.remove('visible'), 1800);
}

// ── Pre-game selectors (format / overs / difficulty / hand) ──────────────────

let selectedOvers      = 6;
let selectedFormat     = 'T20';
let selectedDifficulty = 'medium';
let selectedHand       = 'right';

document.querySelectorAll('.format-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.over-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedFormat = btn.dataset.format;
    selectedOvers  = parseInt(btn.dataset.overs, 10);
  });
});

document.querySelectorAll('.over-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.over-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedOvers = parseInt(btn.dataset.overs, 10);
  });
});

document.querySelectorAll('.difficulty-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDifficulty = btn.dataset.difficulty;
  });
});

document.querySelectorAll('.hand-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.hand-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyHandedness(btn.dataset.hand);
  });
});

function applyHandedness(hand) {
  selectedHand = hand === 'left' ? 'left' : 'right';
  engine?.setHandedness(selectedHand);
  shotClassifier.setHandedness(selectedHand === 'right');
  document.querySelectorAll('.hand-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.hand === selectedHand));
}

// ── Sound engine ──────────────────────────────────────────────────────────────

/**
 * Procedural sound effects using the Web Audio API.
 * AudioContext is created lazily on first sound call so the browser's
 * autoplay policy is never triggered before a user gesture (swing).
 */
class SoundEngine {
  #ctx = null;

  #ac() {
    if (!this.#ctx) {
      this.#ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.#ctx.state === 'suspended') this.#ctx.resume();
    return this.#ctx;
  }

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

  _briefEl.classList.remove('pop-enter', 'pop-exit');
  void _briefEl.offsetWidth;
  _briefEl.classList.add('pop-enter');

  clearTimeout(_briefTimer);
  _briefTimer = setTimeout(() => {
    _briefEl.classList.remove('pop-enter');
    _briefEl.classList.add('pop-exit');
  }, durationMs);
}

// ── Free hit banner ───────────────────────────────────────────────────────────

const freeHitBanner = (() => {
  const el = document.createElement('div');
  el.id = 'free-hit-banner';
  el.textContent = 'FREE HIT';
  document.body.appendChild(el);
  return el;
})();

function setFreeHitVisible(visible) {
  freeHitBanner.classList.toggle('visible', visible);
}

// ── Match overlay helper (toss / break / result screens) ────────────────────

const matchOverlay = (() => {
  const el = document.createElement('div');
  el.className = 'match-overlay hidden';
  el.innerHTML = '<div class="match-card" id="match-card"></div>';
  document.body.appendChild(el);
  return el;
})();
const matchCard = matchOverlay.querySelector('#match-card');

function showMatchCard(html) {
  matchCard.innerHTML = html;
  matchOverlay.classList.remove('hidden');
}
function hideMatchCard() {
  matchOverlay.classList.add('hidden');
}

function inningsSummaryTable(title, summary) {
  const rows = summary.batsmen.map(b => `
    <tr>
      <td>Player ${b.index + 1}</td>
      <td>${b.out ? (b.how ?? 'out') : 'not out'}</td>
      <td>${b.runs} (${b.balls})</td>
    </tr>`).join('');
  return `
    <table class="mini-card">
      <caption>${title} — ${summary.runs}/${summary.wickets} (${summary.overs} ov)</caption>
      <tr><th>Batsman</th><th>Dismissal</th><th>Runs</th></tr>
      ${rows}
    </table>`;
}

// ── Game objects ──────────────────────────────────────────────────────────────

const scorecard      = new Scorecard();
const bowlerAI       = new BowlerAI();
const sounds         = new SoundEngine();
const shotClassifier = new ShotClassifier(true);

/** @type {GameEngine|null} */
let engine = null;

/** @type {CricketRules|null} */
let rules = null;

/** @type {AIBatting|null} */
let aiBatting = null;

/** @type {UmpireController|null} */
let umpire = null;

/** @type {FielderAI|null} */
let fielderAI = null;

// SETUP | TOSS | INNINGS_HUMAN | BREAK | INNINGS_AI | RESULT
let matchPhase = 'SETUP';

/** @type {Array<'human'|'ai'>} */
let battingOrder = ['human', 'ai'];

let gameRunning = false;
let currentDeliveryType = 'pace';
let nextDeliveryTimer = null;

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
  qrImg.classList.remove('hidden');
  roomIdEl.textContent = roomId.slice(0, 8).toUpperCase();
  statusEl.textContent = 'Scan with your phone to start playing';

  try {
    engine = new GameEngine(canvas, handleEngineResult);
    engine.start();
    engine.loadBatModel();   // async — GLB replaces primitive bats when ready
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
  engine?.setHandedness(selectedHand);
  socket.emit('handedness', { hand: selectedHand });
  showCameraBadge('Batsman POV');
  showTossScreen();
});

// Mobile handedness selection (Screen 2 buttons) — overrides desktop choice.
socket.on('set_handedness', ({ isRightHanded }) => {
  applyHandedness(isRightHanded ? 'right' : 'left');
  console.log('[main] handedness from mobile:', isRightHanded ? 'right' : 'left');
});

/** Legacy raw ArrayBuffer path — kept for older mobile builds. */
socket.on('motion', (data) => {
  engine?.processMotionPacket(data);
});

/**
 * Structured swing event from the mobile motion state machine.
 * Runs the classified-shot pipeline when the human is batting.
 */
socket.on('swing', (data) => {
  handleSwing({
    alpha:         data.alpha ?? 0,
    beta:          data.beta ?? 0,
    gamma:         data.gamma ?? 0,
    peakMag:       data.peakMag ?? 0,
    power:         data.power ?? 0,
    rotMag:        data.rotMag ?? 0,
    swingDuration: data.swingDuration ?? 120,
  }, data.shotType ?? 'DRIVE');
});

/** Raw 30 Hz orientation stream — mirrors phone tilt onto the bat. */
socket.on('orientation', ({ beta, gamma }) => {
  engine?.updateBatAngle(beta, gamma);
});

socket.on('peer-disconnected', () => {
  stopMatch();
  statusEl.textContent = 'Phone disconnected — please reload and scan again.';
  qrImg.src = '';
  qrImg.classList.add('hidden');
  hideMatchCard();
  qrOverlay.classList.remove('hidden');
});

socket.on('disconnect', () => {
  stopMatch();
});

function stopMatch() {
  gameRunning = false;
  aiBatting?.stop();
  clearTimeout(nextDeliveryTimer);
}

// ── Toss ──────────────────────────────────────────────────────────────────────

function showTossScreen() {
  matchPhase = 'TOSS';
  showMatchCard(`
    <h2>THE TOSS</h2>
    <div class="toss-coin" id="toss-coin">🪙</div>
    <p class="match-sub">${selectedFormat} · ${selectedOvers} overs · AI: ${selectedDifficulty.toUpperCase()}</p>
    <p class="match-sub">Call it!</p>
    <div class="match-btn-row">
      <button class="match-btn" id="toss-heads">HEADS</button>
      <button class="match-btn" id="toss-tails">TAILS</button>
    </div>
  `);

  const flip = (call) => {
    const coin = matchCard.querySelector('#toss-coin');
    coin.classList.add('flipping');
    matchCard.querySelectorAll('.match-btn').forEach(b => (b.disabled = true));

    setTimeout(() => {
      const result  = Math.random() < 0.5 ? 'heads' : 'tails';
      const userWon = call === result;
      coin.textContent = result === 'heads' ? 'H' : 'T';
      coin.classList.remove('flipping');

      if (userWon) {
        showMatchCard(`
          <h2>YOU WON THE TOSS</h2>
          <p class="match-sub">It's ${result.toUpperCase()}. What will you do?</p>
          <div class="match-btn-row">
            <button class="match-btn" id="choose-bat">BAT FIRST</button>
            <button class="match-btn" id="choose-bowl">BOWL FIRST</button>
          </div>
        `);
        matchCard.querySelector('#choose-bat').addEventListener('click', () => startMatch(true));
        matchCard.querySelector('#choose-bowl').addEventListener('click', () => startMatch(false));
      } else {
        const aiBats = Math.random() < 0.6;   // AI usually prefers to bat
        showMatchCard(`
          <h2>AI WON THE TOSS</h2>
          <p class="match-sub">It's ${result.toUpperCase()}. AI chose to ${aiBats ? 'BAT' : 'BOWL'} first.</p>
          <div class="match-btn-row">
            <button class="match-btn" id="toss-continue">CONTINUE</button>
          </div>
        `);
        matchCard.querySelector('#toss-continue').addEventListener('click', () => startMatch(!aiBats));
      }
    }, 1300);
  };

  matchCard.querySelector('#toss-heads').addEventListener('click', () => flip('heads'));
  matchCard.querySelector('#toss-tails').addEventListener('click', () => flip('tails'));
}

// ── Match setup / innings flow ────────────────────────────────────────────────

function startMatch(humanBatsFirst) {
  battingOrder = humanBatsFirst ? ['human', 'ai'] : ['ai', 'human'];
  const teams  = humanBatsFirst ? ['YOU', 'AI XI'] : ['AI XI', 'YOU'];

  rules = new CricketRules({ format: selectedFormat, overs: selectedOvers, teams });
  aiBatting = new AIBatting(rules, selectedDifficulty);
  umpire    = new UmpireController(engine.umpireFigure);
  fielderAI = new FielderAI(engine.fielderRefs);

  shotClassifier.setHandedness(selectedHand === 'right');
  scorecard.setTotalOvers(selectedOvers);
  scorecard.setBatsman(teams[0] === 'YOU' ? 'You' : 'AI');

  hideMatchCard();
  beginInnings();
}

function beginInnings() {
  const batter = battingOrder[rules.currentInnings];
  scorecard.setBatsman(batter === 'human' ? 'You' : 'AI');
  scorecard.syncState(rules.getState());
  hideMatchCard();

  if (batter === 'human') {
    matchPhase  = 'INNINGS_HUMAN';
    gameRunning = true;
    const target = rules.target;
    showBrief(target ? `CHASE ${target} TO WIN!` : "YOU'RE BATTING!", '#4caf50', 2400);
    nextDeliveryTimer = setTimeout(startNextDelivery, 2000);
  } else {
    matchPhase  = 'INNINGS_AI';
    gameRunning = true;
    const target = rules.target;
    showBrief(target ? `AI NEEDS ${target} TO WIN` : 'AI IS BATTING', '#ffab40', 2400);
    setTimeout(() => runAIInnings(), 1500);
  }
}

// ── Human batting ─────────────────────────────────────────────────────────────

function startNextDelivery() {
  if (!gameRunning || !engine || matchPhase !== 'INNINGS_HUMAN') return;
  currentDeliveryType = bowlerAI.nextDeliveryType();
  engine.deliveryStart(currentDeliveryType, bowlerAI.lineOffset);
  setFreeHitVisible(rules?.getState().isFreeHit ?? false);
}

/**
 * Full classified-swing pipeline. Also used by the 'S' keyboard shortcut.
 * @param {object} swingData  { alpha, beta, gamma, peakMag, power, rotMag, swingDuration }
 * @param {string} legacyShotType  mobile's coarse label, for the bat animation
 */
function handleSwing(swingData, legacyShotType) {
  if (!engine) return;

  // 1. Immediate feedback: bat animation + whoosh + power popup
  engine.animateSwing(legacyShotType, swingData.power, swingData.alpha, swingData.beta, swingData.gamma);
  sounds.whoosh();

  if (matchPhase !== 'INNINGS_HUMAN' || !gameRunning) {
    if (!engine.inPlay) {
      showBrief(`Practice swing — ${swingData.power} power`, '#a8c8a8', 1400, true);
    }
    return;
  }

  // 2. Hit window check (desktop clock)
  const timing = engine.consumeHitWindow();
  if (timing === null) {
    if (!engine.inPlay) {
      showBrief(`Practice swing — ${swingData.power} power`, '#a8c8a8', 1400, true);
    }
    // Ball in play but outside window → engine's ball-travel loop resolves the miss.
    return;
  }

  // 3. Classify the shot from phone orientation + acceleration
  const shotResult = shotClassifier.classify(swingData);
  const displayName = shotClassifier.shotDisplayName(shotResult.shot);
  if (displayName) scorecard.showPower(shotResult.power, displayName);

  // 4. Rules decide the outcome (with a 5% no-ball roll)
  const outcome = rules.calculateDeliveryOutcome(shotResult, currentDeliveryType, timing);
  outcome.isNoBall = !rules.isLegalDelivery({ type: currentDeliveryType });

  // 5. Visual ball flight matches the scored outcome
  const traj = shotClassifier.shotToTrajectory(shotResult);
  const landed = engine.playClassifiedShot({
    dirX:   -traj.vx / Math.max(0.001, traj.speed),   // classifier +dir = leg side = world -X
    dirZ:    traj.vz / Math.max(0.001, traj.speed),
    runs:    outcome.runs ?? 0,
    lofted:  shotResult.launchAngle > 15,
    caught:  outcome.howOut === 'caught',
    power:   shotResult.power,
  });

  if (shotResult.shot !== 'none') sounds.crack(swingData.power);

  // Mirror the phone's exact orientation onto the GLB bat during follow-through
  if (engine.batsmanBatModel) {
    engine.batLoader.mirrorPhoneOrientation(
      engine.batsmanBatModel,
      swingData.alpha, swingData.beta, swingData.gamma,
      selectedHand === 'right',
    );
  }

  // 6. Process the delivery through the rules engine
  const { events, state } = rules.processDelivery(outcome);

  bowlerAI.recordShot(landed && landed.landingX > 1.5 ? 'off' : landed && landed.landingX < -1.5 ? 'leg' : 'straight');

  processEvents(events, landed);
  scorecard.syncState(state);
  setFreeHitVisible(state.isFreeHit);

  // 7. Next delivery, unless the innings/match ended
  scheduleNextAfterEvents(events);
}

/** Miss / no-swing resolution from the engine's ball-travel loop. */
function handleEngineResult({ type }) {
  if (matchPhase === 'INNINGS_AI') {
    // AI innings: rules already processed — engine visuals only.
    if (type === 'wicket') sounds.stumps();
    return;
  }
  if (matchPhase !== 'INNINGS_HUMAN' || !gameRunning || !rules) return;

  const outcome = type === 'wicket'
    ? { runs: 0, howOut: 'bowled', isNoBall: false, isWide: false }
    : { runs: 0, isNoBall: false, isWide: false };

  if (type === 'wicket') sounds.stumps();

  const { events, state } = rules.processDelivery(outcome);
  processEvents(events, null);
  scorecard.syncState(state);
  setFreeHitVisible(state.isFreeHit);
  scheduleNextAfterEvents(events);
}

function scheduleNextAfterEvents(events) {
  const terminal = events.some(e =>
    ['innings_break', 'match_over', 'match_won', 'all_out', 'innings_over'].includes(e.type));
  if (terminal) return;

  const hadWicket = events.some(e => e.type === 'wicket');
  clearTimeout(nextDeliveryTimer);
  nextDeliveryTimer = setTimeout(startNextDelivery, hadWicket ? 3200 : 2200);
}

// ── AI batting (chase simulation with live visuals) ──────────────────────────

function runAIInnings() {
  if (matchPhase !== 'INNINGS_AI' || !rules) return;

  aiBatting.start(
    (result) => {
      // Visuals: bowl the delivery, then either play the shot or hit the stumps
      const type = bowlerAI.nextDeliveryType();
      const wicketEvt = result.events?.find(e => e.type === 'wicket');
      const isBowledType = wicketEvt && ['bowled', 'lbw', 'stumped'].includes(wicketEvt.how);

      // Bowled-type wickets: straight line so the ball hits the stumps.
      // Other wickets (caught/run out): wide line so the miss reads as a dot.
      engine.deliveryStart(type, wicketEvt ? (isBowledType ? 0 : 0.8) : 0.2);

      if (!wicketEvt) {
        // Direction from the AI's chosen shot (classifier angle convention)
        const shotAngles = {
          straight_drive: 0, cover_drive: -45, on_drive: 25,
          pull: 65, sweep: 75, hook: 110, defensive: 0,
        };
        const deg = (shotAngles[result.aiShot] ?? 0) * (Math.PI / 180);
        engine.queueAIShot({
          dirX: -Math.sin(deg),
          dirZ: -Math.cos(deg),
          runs: result.aiRuns ?? 0,
          lofted: (result.aiRuns ?? 0) >= 6,
          power: result.aiPower ?? 50,
        });
      }

      // Sync HUD + events once the ball flight resolves on screen
      const visualDelay = BOWLER_RUN_MS + (DELIVERY_MS[type] ?? 900) + 300;
      setTimeout(() => {
        if (matchPhase !== 'INNINGS_AI') return;
        if (result.aiRuns > 0 || wicketEvt) sounds.crack(result.aiPower ?? 50);
        processEvents(result.events ?? [], null);
        scorecard.syncState(rules.getState());
      }, visualDelay);
    },
    (matchResult) => {
      setTimeout(() => showMatchResultScreen(matchResult), 2800);
    },
  );
}

// ── Event processing (umpire, overlays, fielders, cameras) ───────────────────

function getFieldPreset(state) {
  if (state.requiredRuns && state.requiredRuns < 24 && state.overs > state.totalOvers - 3) return 'aggressive';
  if (state.wickets < 3 && state.isPowerplay) return 'aggressive';
  if (state.wickets >= 7) return 'defensive';
  return 'standard';
}

function processEvents(events, landed) {
  events.forEach(evt => {
    switch (evt.type) {
      case 'six':
        umpire?.signal('six');
        showBrief('SIX!', '#ffeb3b', 2200);
        sounds.six();
        engine?.flashReplayView(2200);
        socket.emit('game-event', { type: 'six' });
        break;

      case 'four':
        umpire?.signal('four');
        showBrief('FOUR!', '#ffab40', 1600);
        if (landed) fielderAI?.respondToShot(null, landed.landingX, landed.landingZ, () => {});
        break;

      case 'wicket': {
        umpire?.signal('out');
        const how = (evt.how ?? 'out').replace('_', ' ').toUpperCase();
        showBrief(`OUT — ${how}!`, '#ff5252', 2400);
        if (evt.how === 'bowled') {
          engine?.stadiumRef?.stumpsExplode?.('batting');
          sounds.stumps();
        }
        engine?.flashReplayView(2200);
        socket.emit('game-event', { type: 'wicket' });
        break;
      }

      case 'wide':
        umpire?.signal('wide');
        showBrief('WIDE', '#90caf9', 1400);
        break;

      case 'no_ball':
        umpire?.signal('no_ball');
        showBrief('NO BALL — FREE HIT!', '#ff9800', 2000);
        setTimeout(() => umpire?.signal('free_hit'), 2600);
        break;

      case 'ran_between_wickets':
        scorecard.flashEvent(String(evt.runs), evt.runs === 1 ? 'single' : 'dot');
        break;

      case 'end_of_over':
        showBrief(`END OF OVER ${evt.overNumber}`, '#a5d6a7', 1600);
        fielderAI?.setFieldPreset(getFieldPreset(rules.getState()));
        break;

      case 'new_batsman':
        showBrief(`NEW BATSMAN — PLAYER ${evt.playerIndex + 1}`, '#e8f5e9', 2000);
        break;

      case 'innings_break':
        gameRunning = false;
        aiBatting?.stop();
        clearTimeout(nextDeliveryTimer);
        setTimeout(() => showInningsBreakScreen(evt.target), 2200);
        break;

      case 'match_over':
      case 'match_won':
        gameRunning = false;
        aiBatting?.stop();
        clearTimeout(nextDeliveryTimer);
        if (evt.type === 'match_over') {
          setTimeout(() => showMatchResultScreen(evt.result), 2400);
        }
        break;
    }
  });
}

// ── Break / result screens ────────────────────────────────────────────────────

function showInningsBreakScreen(target) {
  matchPhase = 'BREAK';
  const summary = rules.getInningsSummary(0);
  showMatchCard(`
    <h2>INNINGS BREAK</h2>
    <div class="match-big">Target: ${target}</div>
    ${inningsSummaryTable(`1st innings — ${rules.teams[0]}`, summary)}
    <div class="match-btn-row">
      <button class="match-btn" id="btn-innings2">START 2ND INNINGS</button>
    </div>
  `);
  matchCard.querySelector('#btn-innings2').addEventListener('click', beginInnings);
}

function showMatchResultScreen(result) {
  matchPhase = 'RESULT';
  gameRunning = false;
  setFreeHitVisible(false);

  let headline, sub;
  if (!result || result.winner === null) {
    headline = 'MATCH TIED!';
    sub = 'Unbelievable scenes — scores are level.';
  } else {
    headline = `${result.winner} WIN!`;
    sub = result.how === 'chased'
      ? `Won by ${result.margin} wicket${result.margin !== 1 ? 's' : ''}`
      : result.how === 'defended'
        ? `Won by ${result.margin} run${result.margin !== 1 ? 's' : ''}`
        : '';
  }

  const s1 = rules.getInningsSummary(0);
  const s2 = rules.getInningsSummary(1);

  showMatchCard(`
    <h2>${headline}</h2>
    <p class="match-sub">${sub}</p>
    ${inningsSummaryTable('1st innings', s1)}
    ${inningsSummaryTable('2nd innings', s2)}
    <div class="match-btn-row">
      <button class="match-btn" id="btn-again">PLAY AGAIN</button>
    </div>
  `);
  matchCard.querySelector('#btn-again').addEventListener('click', () => window.location.reload());
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  // V — cycle camera view
  if (e.key === 'v' || e.key === 'V') {
    if (engine) showCameraBadge(engine.cycleView());
  }

  // S — simulate a medium-power straight drive through the full pipeline
  if (e.key === 's' || e.key === 'S') {
    handleSwing({
      alpha: 0, beta: 10, gamma: 0,
      peakMag: 4.2, power: 55, rotMag: 2, swingDuration: 140,
    }, 'DRIVE');
  }
});
