/**
 * scorecard.js — Absolute-positioned HTML overlay showing live match data.
 *
 * Mounted directly onto document.body so it floats above the Three.js canvas.
 */

const LABELS = { dot: '•', single: '1', four: 'FOUR!', six: 'SIX!', wicket: 'BOWLED!' };

export class Scorecard {
  #runs        = 0;
  #wickets     = 0;
  #balls       = 0;
  #batRuns     = 0;
  #batBalls    = 0;
  #totalOvers  = 6;
  #batsmanName = 'Batsman';
  #eventTimer  = null;

  // DOM refs
  #elTotal;
  #elOver;
  #elBatsmanName;
  #elBatsmanScore;
  #elEvent;
  #elShotType;
  #elPower;

  constructor() {
    this.#mount();
  }

  #mount() {
    const el = document.createElement('div');
    el.id = 'scorecard';
    el.innerHTML = `
      <div class="sc-row">
        <span class="sc-label">Score</span>
        <span class="sc-value" id="sc-total">0/0</span>
      </div>
      <div class="sc-row">
        <span class="sc-label">Over</span>
        <span class="sc-value" id="sc-over">0.0</span>
      </div>
      <div class="sc-row">
        <span class="sc-label" id="sc-bat-name">Batsman</span>
        <span class="sc-value" id="sc-bat-score">0 (0)</span>
      </div>
      <div class="sc-row">
        <span class="sc-label">Shot</span>
        <span class="sc-value sc-shot" id="sc-shot">—</span>
      </div>
      <div class="sc-row">
        <span class="sc-label">Power</span>
        <span class="sc-value sc-power" id="sc-power">—</span>
      </div>
      <div id="sc-event" class="sc-event"></div>
    `;
    document.body.appendChild(el);

    this.#elTotal        = el.querySelector('#sc-total');
    this.#elOver         = el.querySelector('#sc-over');
    this.#elBatsmanName  = el.querySelector('#sc-bat-name');
    this.#elBatsmanScore = el.querySelector('#sc-bat-score');
    this.#elEvent        = el.querySelector('#sc-event');
    this.#elShotType     = el.querySelector('#sc-shot');
    this.#elPower        = el.querySelector('#sc-power');
  }

  /**
   * Set the batsman's display name.
   * @param {string} name
   */
  setBatsman(name) {
    this.#batsmanName = name;
    this.#elBatsmanName.textContent = name;
  }

  /**
   * Set the total number of overs for the match.
   * @param {number} overs
   */
  setTotalOvers(overs) {
    this.#totalOvers = overs;
    this.#elOver.textContent = `0.0 / ${overs}`;
  }

  /** True when all balls for the match have been bowled. */
  get matchOver() {
    return this.#balls >= this.#totalOvers * 6;
  }

  /**
   * Record a delivery result and refresh all counters.
   * @param {'dot'|'single'|'four'|'six'|'wicket'} event
   */
  update(event) {
    this.#balls++;
    this.#batBalls++;

    switch (event) {
      case 'single':  this.#runs += 1; this.#batRuns += 1; break;
      case 'four':    this.#runs += 4; this.#batRuns += 4; break;
      case 'six':     this.#runs += 6; this.#batRuns += 6; break;
      case 'wicket':  this.#wickets++;                      break;
    }

    const overs  = Math.floor(this.#balls / 6);
    const rem    = this.#balls % 6;

    this.#elTotal.textContent        = `${this.#runs}/${this.#wickets}`;
    this.#elOver.textContent         = `${overs}.${rem} / ${this.#totalOvers}`;
    this.#elBatsmanScore.textContent = `${this.#batRuns} (${this.#batBalls})`;

    this.#flash(LABELS[event] ?? event, event);
  }

  /**
   * Update the Shot / Power rows in the scorecard HUD immediately after a swing.
   * The colour mirrors the in-scene sprite: green < 40, amber 40–70, red > 70.
   * @param {number} power    - 0-100
   * @param {string} shotType - e.g. "DRIVE"
   */
  showPower(power, shotType) {
    const color = power >= 71 ? '#ff5252' : power >= 41 ? '#ffab40' : '#69f0ae';
    this.#elShotType.textContent = shotType;
    this.#elPower.textContent    = String(power);
    this.#elPower.style.color    = color;
  }

  /**
   * Briefly display a large outcome label, then fade it out.
   * @param {string} text
   * @param {string} cls - CSS modifier class for colour theming.
   */
  #flash(text, cls) {
    this.#elEvent.textContent = text;
    this.#elEvent.className   = `sc-event sc-event--${cls} visible`;
    clearTimeout(this.#eventTimer);
    this.#eventTimer = setTimeout(() => {
      this.#elEvent.classList.remove('visible');
    }, 1800);
  }
}
