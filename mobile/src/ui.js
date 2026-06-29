// ui.js — Full-screen 4-screen mobile UI for the cricket motion bat.

// ── Design tokens (supplement the global style.css) ──────────────────────────

const STYLES = `
  /* ── Screen host ─────────────────────────────────────────────────────────── */
  #screens {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .screen {
    display: none;
    position: absolute;
    inset: 0;
    flex-direction: column;
    overflow: hidden;
  }

  .screen.active { display: flex; }

  /* ── Screen 1: Welcome ───────────────────────────────────────────────────── */
  .s1 {
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: 40px 32px;
    background: var(--bg);
  }

  .s1-bat { width: 88px; height: 140px; }

  .s1 h1 {
    font-size: 1.9rem;
    font-weight: 800;
    color: var(--accent);
    text-align: center;
    letter-spacing: -0.01em;
  }

  .s1-subtitle {
    font-size: 1rem;
    color: var(--text-muted);
    text-align: center;
    line-height: 1.5;
    max-width: 260px;
  }

  .s1-status-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
  }

  .s1-dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--accent);
    animation: dot-pulse 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  .s1-dot.connected    { background: var(--accent);  animation: none; }
  .s1-dot.disconnected { background: #f44336;         animation: none; }

  @keyframes dot-pulse {
    0%, 100% { opacity: 1;   transform: scale(1);   }
    50%       { opacity: 0.3; transform: scale(0.65); }
  }

  .s1-status-text { font-size: 0.9rem; color: var(--text-muted); }

  /* ── Screen 2: Grip Guide ────────────────────────────────────────────────── */
  .s2 {
    background: var(--bg);
    padding: 28px 20px 24px;
    gap: 18px;
  }

  .s2 h2 {
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--accent);
    text-align: center;
    flex-shrink: 0;
  }

  .grip-cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
    min-height: 0;
  }

  .grip-card {
    display: flex;
    align-items: center;
    gap: 16px;
    flex: 1;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
    min-height: 0;
  }

  .grip-card-icon { flex-shrink: 0; }

  .grip-card p {
    font-size: 0.875rem;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .btn-ready {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 56px;
    background: var(--accent-dim);
    color: #fff;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    border: 2px solid var(--accent);
    border-radius: 12px;
    cursor: pointer;
    -webkit-appearance: none;
    flex-shrink: 0;
    transition: background 0.12s, transform 0.07s;
  }
  .btn-ready:active { background: var(--accent); transform: scale(0.97); }

  /* ── Screen 3: Calibration ───────────────────────────────────────────────── */
  .s3 {
    background: var(--bg);
    align-items: center;
    justify-content: center;
    gap: 28px;
    padding: 32px 28px;
  }

  .cal-instruction {
    font-size: 1.05rem;
    color: var(--text-muted);
    text-align: center;
    line-height: 1.55;
  }

  .phone-rock-wrap {
    animation: rock 2.2s ease-in-out infinite;
  }

  @keyframes rock {
    0%, 100% { transform: rotate(-9deg); }
    50%       { transform: rotate(9deg);  }
  }

  .btn-calibrate {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 56px;
    background: #2e7d32;
    color: #fff;
    font-size: 1.25rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    -webkit-appearance: none;
    transition: background 0.1s, transform 0.07s;
  }
  .btn-calibrate:active    { background: #4caf50; transform: scale(0.97); }
  .btn-calibrate:disabled  { opacity: 0.45; cursor: not-allowed; transform: none; }

  .cal-countdown {
    display: none;
    font-size: 5.5rem;
    font-weight: 900;
    color: var(--accent);
    line-height: 1;
  }
  .cal-countdown.visible { display: block; }

  .cal-success {
    display: none;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--accent);
    text-align: center;
  }
  .cal-success.visible { display: block; }

  /* ── Debug overlay ───────────────────────────────────────────────────────── */
  .debug-bar {
    position: absolute;
    top: 0; left: 0; right: 0;
    background: rgba(0,0,0,0.82);
    padding: 6px 12px;
    font-size: 0.72rem;
    font-family: monospace;
    color: #4caf50;
    z-index: 100;
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
  }
  .debug-bar span { white-space: nowrap; }
  .debug-state-IDLE         { color: #888; }
  .debug-state-LOADING      { color: #ff9800; }
  .debug-state-SWINGING     { color: #f44336; }
  .debug-state-FOLLOWTHROUGH{ color: #4caf50; }

  /* ── Screen 4: Live HUD ──────────────────────────────────────────────────── */
  .s4 { background: #060f06; }

  .hud-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    background: rgba(0,0,0,0.35);
    flex-shrink: 0;
  }

  .hud-shot-label {
    font-size: 1rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: #fff;
  }

  .hud-conn-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
  }
  .hud-conn-dot.off { background: #f44336; box-shadow: none; }

  .hud-center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }

  .power-gauge-wrap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .power-gauge-wrap canvas { display: block; }

  .power-center-label {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
  }

  .power-num {
    font-size: 3.6rem;
    font-weight: 900;
    color: #fff;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .power-unit {
    font-size: 0.7rem;
    letter-spacing: 0.18em;
    color: rgba(255,255,255,0.4);
    margin-top: 5px;
  }

  .swing-history-wrap {
    padding: 0 20px 10px;
    flex-shrink: 0;
  }

  .history-label {
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    color: rgba(255,255,255,0.35);
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  .history-bars {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 44px;
  }

  .history-bar {
    flex: 1;
    border-radius: 3px;
    background: #1c3d1c;
    transition: height 0.25s ease, background-color 0.25s ease;
    min-height: 4px;
    height: 4px;
  }

  .shot-pills-row {
    display: flex;
    gap: 6px;
    padding: 6px 16px;
    flex-shrink: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .shot-pills-row::-webkit-scrollbar { display: none; }

  .shot-pill {
    flex-shrink: 0;
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.09em;
    border: 1px solid var(--border);
    min-height: 36px;
    display: inline-flex;
    align-items: center;
    transition: background 0.18s, color 0.18s, border-color 0.18s, box-shadow 0.18s;
  }

  .shot-pill.active {
    background: var(--accent-dim);
    color: #fff;
    border-color: var(--accent);
    border-width: 2px;
    box-shadow: 0 0 10px rgba(76, 175, 80, 0.45);
  }

  .hud-bottombar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 20px;
    padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    background: rgba(0,0,0,0.25);
    flex-shrink: 0;
  }

  .btn-recal {
    padding: 8px 14px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 0.8rem;
    cursor: pointer;
    -webkit-appearance: none;
    transition: background 0.1s;
  }
  .btn-recal:active { background: var(--surface); }

  /* ── Tap-to-swing fallback button ───────────────────────────────────────── */
  .tap-swing-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 6px;
    width: calc(100% - 40px);
    margin: 0 20px 12px;
    padding: 18px;
    background: rgba(76,175,80,0.12);
    border: 2px dashed rgba(76,175,80,0.5);
    border-radius: 16px;
    color: #4caf50;
    font-size: 1.1rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    -webkit-appearance: none;
    flex-shrink: 0;
    transition: background 0.08s, border-color 0.08s;
    user-select: none;
    -webkit-user-select: none;
  }
  .tap-swing-btn:active {
    background: rgba(76,175,80,0.32);
    border-color: #4caf50;
  }
  .tap-swing-btn small {
    font-size: 0.68rem;
    font-weight: 400;
    letter-spacing: 0.05em;
    color: rgba(76,175,80,0.6);
    text-transform: none;
  }

  .shot-counter {
    font-size: 0.82rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* Quality badge — appears below POWER label inside gauge */
  .quality-badge {
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.16em;
    padding: 3px 11px;
    border-radius: 999px;
    margin-top: 10px;
    text-transform: uppercase;
    opacity: 0;
    transition: opacity 0.25s ease;
    border: 1px solid currentColor;
    background: rgba(0, 0, 0, 0.35);
  }
  .quality-badge.visible  { opacity: 1; }
  .quality-badge.perfect  { color: #ffeb3b; }
  .quality-badge.good     { color: #4caf50; }
  .quality-badge.mistimed { color: #ff9800; }
  .quality-badge.edged    { color: #f44336; }

  /* ── Swing flash overlay ─────────────────────────────────────────────────── */
  .swing-flash {
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: 0;
    opacity: 0;
    transition: opacity 0.05s ease-in;
    z-index: 50;
  }
  .swing-flash.fire {
    opacity: 0.38;
    transition: opacity 0.05s ease-in;
  }
`;

// ── Inline SVGs ──────────────────────────────────────────────────────────────

const BAT_SVG = `
<svg class="s1-bat" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 112">
  <!-- Handle -->
  <rect x="17" y="2" width="10" height="38" rx="5" fill="#a5d6a7"/>
  <rect x="17" y="6"  width="10" height="2" rx="1" fill="#388e3c"/>
  <rect x="17" y="11" width="10" height="2" rx="1" fill="#388e3c"/>
  <rect x="17" y="16" width="10" height="2" rx="1" fill="#388e3c"/>
  <rect x="17" y="21" width="10" height="2" rx="1" fill="#388e3c"/>
  <rect x="17" y="26" width="10" height="2" rx="1" fill="#388e3c"/>
  <rect x="17" y="31" width="10" height="2" rx="1" fill="#388e3c"/>
  <!-- Shoulder -->
  <path d="M14 40 Q14 38 17 38 L27 38 Q30 38 30 40 L32 48 L12 48 Z" fill="#4caf50"/>
  <!-- Blade -->
  <rect x="10" y="47" width="24" height="58" rx="5" fill="#4caf50"/>
  <!-- Ridge -->
  <rect x="19" y="49" width="6" height="52" rx="3" fill="#388e3c"/>
</svg>`;

// Card 1: phone upright with two hands
const CARD1_SVG = `
<svg class="grip-card-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 88" width="48" height="75">
  <rect x="12" y="2" width="32" height="60" rx="5" fill="#122912" stroke="#4caf50" stroke-width="2"/>
  <rect x="16" y="8"  width="24" height="38" rx="2" fill="#1c3d1c"/>
  <circle cx="28" cy="56" r="3" fill="#2d5a2d"/>
  <!-- left hand -->
  <rect x="2"  y="22" width="10" height="22" rx="5" fill="none" stroke="#81c784" stroke-width="1.5"/>
  <line x1="5"  y1="22" x2="5"  y2="18" stroke="#81c784" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="8"  y1="22" x2="8"  y2="16" stroke="#81c784" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="11" y1="22" x2="11" y2="18" stroke="#81c784" stroke-width="1.5" stroke-linecap="round"/>
  <!-- right hand -->
  <rect x="44" y="38" width="10" height="22" rx="5" fill="none" stroke="#81c784" stroke-width="1.5"/>
  <line x1="47" y1="38" x2="47" y2="34" stroke="#81c784" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="50" y1="38" x2="50" y2="32" stroke="#81c784" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="53" y1="38" x2="53" y2="34" stroke="#81c784" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

// Card 2: phone tilted forward with lean arrow
const CARD2_SVG = `
<svg class="grip-card-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60">
  <g transform="rotate(-18,36,36)">
    <rect x="22" y="6" width="28" height="50" rx="5" fill="#122912" stroke="#4caf50" stroke-width="2"/>
    <rect x="26" y="12" width="20" height="32" rx="2" fill="#1c3d1c"/>
    <circle cx="36" cy="52" r="3" fill="#2d5a2d"/>
  </g>
  <!-- forward lean arrow -->
  <path d="M 58 20 L 68 36 L 58 52" fill="none" stroke="#4caf50" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// Card 3: phone with swing-arc
const CARD3_SVG = `
<svg class="grip-card-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="60" height="60">
  <!-- phone at rest -->
  <rect x="26" y="4" width="20" height="36" rx="4" fill="#122912" stroke="#4caf50" stroke-width="2"/>
  <rect x="29" y="8" width="14" height="24" rx="2" fill="#1c3d1c"/>
  <!-- swing arc -->
  <path d="M 10 62 Q 36 20 62 62" fill="none" stroke="#4caf50" stroke-width="2.5"
        stroke-linecap="round" stroke-dasharray="5 4"/>
  <!-- arrowhead -->
  <polygon points="62,62 54,56 68,54" fill="#4caf50"/>
</svg>`;

// Phone rocking for calibration screen
const CAL_PHONE_SVG = `
<svg class="phone-rock-wrap" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 100" width="56" height="100">
  <rect x="4" y="2" width="48" height="90" rx="8" fill="#122912" stroke="#4caf50" stroke-width="2.5"/>
  <rect x="18" y="6" width="20" height="4" rx="2" fill="#2d5a2d"/>
  <rect x="8"  y="14" width="40" height="62" rx="3" fill="#1c3d1c"/>
  <circle cx="28" cy="84" r="4" fill="#2d5a2d"/>
  <!-- stick figure in batting stance -->
  <circle cx="28" cy="28" r="5" fill="#4caf50"/>
  <line x1="28" y1="33" x2="28" y2="54" stroke="#4caf50" stroke-width="2" stroke-linecap="round"/>
  <line x1="28" y1="40" x2="18" y2="48" stroke="#4caf50" stroke-width="2" stroke-linecap="round"/>
  <line x1="28" y1="40" x2="38" y2="44" stroke="#4caf50" stroke-width="2" stroke-linecap="round"/>
  <line x1="28" y1="54" x2="20" y2="68" stroke="#4caf50" stroke-width="2" stroke-linecap="round"/>
  <line x1="28" y1="54" x2="35" y2="68" stroke="#4caf50" stroke-width="2" stroke-linecap="round"/>
</svg>`;

// ── Helpers ───────────────────────────────────────────────────────────────────

const SHOTS = ['DRIVE', 'SWEEP', 'HOOK', 'PULL', 'CUT', 'DEFENSIVE'];
const PILL_LABELS = { DRIVE: 'DRIVE', SWEEP: 'SWEEP', HOOK: 'HOOK', PULL: 'PULL', CUT: 'CUT', DEFENSIVE: 'DEF' };

function powerColor(p) {
  if (p >= 71) return '#f44336';
  if (p >= 41) return '#ff9800';
  return '#4caf50';
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Inject the full 4-screen UI into #app and return a controller object.
 *
 * @returns {{
 *   goToScreen(n: number): void,
 *   setStatus(text: string): void,
 *   setConnected(connected: boolean): void,
 *   onReady(cb: () => void): void,
 *   onCalibrate(cb: () => void): void,
 *   onRecalibrate(cb: () => void): void,
 *   updateHUD(data: { power: number, shotType: string }): void,
 * }}
 */
export function mountUI() {
  // Inject styles once
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);

  // Prevent long-press context menu (e.g. iOS "Copy Link" on tap-hold)
  document.addEventListener('contextmenu', e => e.preventDefault());

  // Landscape rotation warning overlay — shown via CSS @media (orientation: landscape)
  const rotWarn = document.createElement('div');
  rotWarn.className = 'rotation-warning';
  rotWarn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none"
         stroke="#4caf50" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2"/>
      <path d="M12 18h.01"/>
    </svg>
    <p>Please rotate your device<br>to portrait mode</p>
  `;
  document.body.appendChild(rotWarn);

  const root = document.getElementById('app');

  root.innerHTML = `
    <div id="screens">

      <!-- ── Screen 1: Welcome / Connection ── -->
      <div class="screen s1 active" id="screen-1">
        ${BAT_SVG}
        <h1>Cricket Motion Bat</h1>
        <p class="s1-subtitle">Turn your phone into a real cricket bat</p>
        <div class="s1-status-row">
          <div class="s1-dot" id="s1-dot"></div>
          <span class="s1-status-text" id="s1-status">Connecting to game...</span>
        </div>
      </div>

      <!-- ── Screen 2: Grip Guide ── -->
      <div class="screen s2" id="screen-2">
        <h2>Use your phone as a bat</h2>
        <div class="grip-cards">
          <div class="grip-card">
            ${CARD1_SVG}
            <p><strong style="color:#a5d6a7">Hold upright</strong> — grip the phone like a bat handle, screen facing you, both hands wrapped around it</p>
          </div>
          <div class="grip-card">
            ${CARD2_SVG}
            <p><strong style="color:#a5d6a7">Lean forward</strong> — adopt your normal batting stance, weight on front foot</p>
          </div>
          <div class="grip-card">
            ${CARD3_SVG}
            <p><strong style="color:#a5d6a7">Swing!</strong> — when the ball comes, swing the phone like a real shot. Speed = power. Tap "I'm ready" to start</p>
          </div>
        </div>
        <button class="btn-ready" id="btn-ready">I'm ready — start playing</button>
      </div>

      <!-- ── Screen 3: Calibration ── -->
      <div class="screen s3" id="screen-3">
        <p class="cal-instruction">Stand in your batting stance<br>and tap Calibrate</p>
        ${CAL_PHONE_SVG}
        <button class="btn-calibrate" id="btn-calibrate">Calibrate</button>
        <div class="cal-countdown" id="cal-countdown">3</div>
        <div class="cal-success"   id="cal-success">✓ Bat calibrated! Start playing.</div>
      </div>

      <!-- ── Screen 4: Live Batting HUD ── -->
      <div class="screen s4" id="screen-4">

        <div class="swing-flash" id="swing-flash"></div>

        <!-- debug overlay — shows live G-force and state machine state -->
        <div class="debug-bar" id="debug-bar">
          <span id="dbg-mag">G: 0.00</span>
          <span id="dbg-state" class="debug-state-IDLE">IDLE</span>
          <span id="dbg-calls">calls: 0</span>
          <span id="dbg-sent">sent: 0</span>
        </div>

        <div class="hud-topbar">
          <span class="hud-shot-label" id="hud-shot-label">DRIVE</span>
          <div class="hud-conn-dot" id="hud-conn-dot"></div>
        </div>

        <div class="hud-center">
          <div class="power-gauge-wrap">
            <canvas id="power-canvas" width="280" height="280"></canvas>
            <div class="power-center-label">
              <span class="power-num"  id="power-num">0</span>
              <span class="power-unit">POWER</span>
              <span class="quality-badge" id="quality-badge"></span>
            </div>
          </div>
        </div>

        <div class="swing-history-wrap">
          <div class="history-label">Last 6 shots</div>
          <div class="history-bars" id="history-bars">
            ${Array.from({ length: 6 }, () => '<div class="history-bar"></div>').join('')}
          </div>
        </div>

        <div class="shot-pills-row">
          ${SHOTS.map(s => `<span class="shot-pill" data-shot="${s}">${PILL_LABELS[s]}</span>`).join('')}
        </div>

        <!-- swipe/tap fallback — works when DeviceMotion is blocked (HTTP non-localhost) -->
        <button class="tap-swing-btn" id="btn-tap-swing">
          SWIPE DOWN OR TAP TO PLAY SHOT
          <small>Swipe fast = more power · direction = shot type</small>
        </button>

        <div class="hud-bottombar">
          <button class="btn-recal" id="btn-recal">Re-calibrate</button>
          <span class="shot-counter" id="shot-counter">0 shots played</span>
        </div>

      </div>

    </div>
  `;

  // ── DOM refs ─────────────────────────────────────────────────────────────

  const getEl = id => root.querySelector(`#${id}`);

  const s1Dot       = getEl('s1-dot');
  const s1Status    = getEl('s1-status');
  const btnReady    = getEl('btn-ready');
  const btnCalibrate = getEl('btn-calibrate');
  const calCountdown = getEl('cal-countdown');
  const calSuccess   = getEl('cal-success');
  const hudShotLabel = getEl('hud-shot-label');
  const hudConnDot   = getEl('hud-conn-dot');
  const powerCanvas  = getEl('power-canvas');
  const powerNum     = getEl('power-num');
  const historyBarsEl = getEl('history-bars');
  const btnRecal     = getEl('btn-recal');
  const shotCounter  = getEl('shot-counter');
  const shotPills    = root.querySelectorAll('.shot-pill');
  const qualityBadge = getEl('quality-badge');
  const swingFlash   = getEl('swing-flash');
  const dbgMag       = getEl('dbg-mag');
  const dbgState     = getEl('dbg-state');
  const dbgCalls     = getEl('dbg-calls');
  const dbgSent      = getEl('dbg-sent');
  const btnTapSwing  = getEl('btn-tap-swing');
  let _dbgSentCount  = 0;

  const screens = {
    1: getEl('screen-1'),
    2: getEl('screen-2'),
    3: getEl('screen-3'),
    4: getEl('screen-4'),
  };

  // ── Power gauge ───────────────────────────────────────────────────────────

  const ctx      = powerCanvas.getContext('2d');
  const CX = 140, CY = 140, R = 116, LW = 18;   // 280×280 canvas
  const START = 135 * Math.PI / 180;
  const END   = 405 * Math.PI / 180;
  const SWEEP = 270 * Math.PI / 180;

  let _animId = null;

  function drawGauge(power) {
    ctx.clearRect(0, 0, 280, 280);

    // Background track
    ctx.beginPath();
    ctx.arc(CX, CY, R, START, END);
    ctx.strokeStyle = '#1a3a1a';
    ctx.lineWidth   = LW;
    ctx.lineCap     = 'round';
    ctx.stroke();

    // Filled arc
    if (power > 0.5) {
      const fillEnd = START + (power / 100) * SWEEP;
      ctx.beginPath();
      ctx.arc(CX, CY, R, START, fillEnd);
      ctx.strokeStyle = powerColor(power);
      ctx.lineWidth   = LW;
      ctx.lineCap     = 'round';
      ctx.stroke();
    }

    powerNum.textContent = Math.round(power);
  }

  function drainFrom(startPower, startTime) {
    const elapsed = Date.now() - startTime;
    const val = Math.max(0, startPower * (1 - elapsed / 1000));
    drawGauge(val);
    if (val > 0.5) {
      _animId = requestAnimationFrame(() => drainFrom(startPower, startTime));
    } else {
      drawGauge(0);
    }
  }

  function spikeAndDrain(power) {
    if (_animId) cancelAnimationFrame(_animId);
    drawGauge(power);
    // Hold peak briefly then drain back to zero
    setTimeout(() => {
      const t0 = Date.now();
      _animId = requestAnimationFrame(() => drainFrom(power, t0));
    }, 250);
  }

  drawGauge(0);

  // ── Swing history ─────────────────────────────────────────────────────────

  const _history = [];

  function refreshHistoryBars() {
    const bars = historyBarsEl.querySelectorAll('.history-bar');
    bars.forEach((bar, i) => {
      const entry = _history[i];
      if (entry) {
        bar.style.height          = `${Math.max(4, (entry.power / 100) * 44)}px`;
        bar.style.backgroundColor = powerColor(entry.power);
      } else {
        bar.style.height          = '4px';
        bar.style.backgroundColor = '#1c3d1c';
      }
    });
  }

  // ── Shot pills ────────────────────────────────────────────────────────────

  function activatePill(shotType) {
    // REVERSE SWEEP → highlight SWEEP pill
    const target = shotType === 'REVERSE SWEEP' ? 'SWEEP' : shotType;
    shotPills.forEach(p => p.classList.toggle('active', p.dataset.shot === target));
  }

  // ── Screen transitions ────────────────────────────────────────────────────

  let _currentScreen = 1;

  function goToScreen(n) {
    screens[_currentScreen]?.classList.remove('active');
    screens[n]?.classList.add('active');
    _currentScreen = n;
  }

  // ── Calibration countdown (internal) ─────────────────────────────────────

  function runCalibrationCountdown(onDone) {
    let count = 3;
    calCountdown.textContent = count;
    calCountdown.classList.add('visible');
    navigator.vibrate?.([100]);

    const iv = setInterval(() => {
      count--;
      if (count > 0) {
        calCountdown.textContent = count;
        navigator.vibrate?.([100]);
      } else {
        clearInterval(iv);
        navigator.vibrate?.([200]);
        calCountdown.classList.remove('visible');
        calSuccess.classList.add('visible');
        setTimeout(onDone, 900);
      }
    }, 1000);
  }

  // ── Callbacks ─────────────────────────────────────────────────────────────

  let _onReady = null;
  let _onCalibrate = null;
  let _onRecalibrate = null;

  btnReady.addEventListener('click', () => _onReady?.());

  btnCalibrate.addEventListener('click', () => {
    btnCalibrate.disabled = true;
    _onCalibrate?.();
    runCalibrationCountdown(() => goToScreen(4));
  });

  btnRecal.addEventListener('click', () => {
    _onRecalibrate?.();
    // Reset calibration screen state before returning to it
    calCountdown.classList.remove('visible');
    calSuccess.classList.remove('visible');
    btnCalibrate.disabled = false;
    goToScreen(3);
  });

  // ── Shot counter ──────────────────────────────────────────────────────────

  let _shotCount = 0;

  // ── Return public API ─────────────────────────────────────────────────────

  return {
    /** Navigate to a numbered screen (1–4). */
    goToScreen,

    /** Update the status text on Screen 1. */
    setStatus(text) {
      s1Status.textContent = text;
    },

    /** Reflect socket connection state on both Screen 1 dot and HUD dot. */
    setConnected(connected) {
      const cls = connected ? 'connected' : 'disconnected';
      s1Dot.className     = `s1-dot ${cls}`;
      s1Status.textContent = connected ? 'Connected!' : 'Disconnected…';
      hudConnDot.className = connected ? 'hud-conn-dot' : 'hud-conn-dot off';
    },

    /** Register "I'm ready" callback (Screen 2). */
    onReady(cb) { _onReady = cb; },

    /** Register calibrate callback (called immediately when user taps Calibrate on Screen 3). */
    onCalibrate(cb) { _onCalibrate = cb; },

    /** Register re-calibrate callback (called when user taps Re-calibrate from HUD). */
    onRecalibrate(cb) { _onRecalibrate = cb; },

    /** Update the live debug bar. */
    updateDebug({ mag, state, sent, calls }) {
      dbgMag.textContent    = `G: ${mag.toFixed(2)}`;
      dbgState.textContent  = state;
      dbgState.className    = `debug-state-${state}`;
      dbgCalls.textContent  = `calls: ${calls}`;
      if (sent) {
        _dbgSentCount++;
        dbgSent.textContent = `sent: ${_dbgSentCount}`;
      }
    },

    /** Register tap-swing callback. */
    onTapSwing(cb) { btnTapSwing.addEventListener('click', cb); },

    /**
     * Update the live HUD after a swing is detected.
     * @param {{ power: number, shotType: string, qualityLabel?: string }} data
     */
    updateHUD({ power, shotType, qualityLabel }) {
      _shotCount++;
      shotCounter.textContent  = `${_shotCount} shot${_shotCount !== 1 ? 's' : ''} played`;
      hudShotLabel.textContent = shotType;

      // Visual flash so the user instantly knows their swing was detected
      swingFlash.style.background = power > 70 ? '#ff9800' : '#4caf50';
      swingFlash.classList.add('fire');
      clearTimeout(swingFlash._timer);
      swingFlash._timer = setTimeout(() => swingFlash.classList.remove('fire'), 180);

      spikeAndDrain(power);
      activatePill(shotType);

      _history.push({ power, shotType });
      if (_history.length > 6) _history.shift();
      refreshHistoryBars();

      // Quality badge
      if (qualityLabel) {
        const cls = qualityLabel.toLowerCase();  // 'perfect'|'good'|'mistimed'|'edged'
        qualityBadge.textContent = qualityLabel;
        qualityBadge.className   = `quality-badge visible ${cls}`;
        clearTimeout(qualityBadge._timer);
        qualityBadge._timer = setTimeout(() => {
          qualityBadge.classList.remove('visible');
        }, 1600);
      }
    },
  };
}
