/**
 * AIBatting.js — Simulates the AI's batting innings (the chase).
 *
 * Difficulty profiles control shot success / boundary / wicket rates, and the
 * AI adapts aggression to the required run rate.
 */

export class AIBatting {
  /**
   * @param {import('./CricketRules.js').CricketRules} rules
   * @param {'easy'|'medium'|'hard'|'legend'} [difficulty]
   */
  constructor(rules, difficulty = 'medium') {
    this.rules = rules;
    this.difficulty = difficulty;

    this.profiles = {
      easy:   { shotSuccess: 0.45, boundaryRate: 0.08, wicketRate: 0.12 },
      medium: { shotSuccess: 0.62, boundaryRate: 0.18, wicketRate: 0.07 },
      hard:   { shotSuccess: 0.78, boundaryRate: 0.28, wicketRate: 0.04 },
      legend: { shotSuccess: 0.90, boundaryRate: 0.40, wicketRate: 0.02 },
    };

    this.deliveryInterval = null;
    this.isRunning = false;
  }

  setDifficulty(difficulty) {
    if (this.profiles[difficulty]) this.difficulty = difficulty;
  }

  /**
   * @param {(result: object) => void} onDelivery  called with each simulated delivery
   * @param {(result: object) => void} onComplete  called with the match result
   */
  start(onDelivery, onComplete) {
    this.isRunning = true;
    this.onDelivery = onDelivery;
    this.onComplete = onComplete;
    this.inningsIndex = this.rules.currentInnings;
    this.scheduleNextDelivery();
  }

  stop() {
    this.isRunning = false;
    if (this.deliveryInterval) clearTimeout(this.deliveryInterval);
  }

  scheduleNextDelivery() {
    // AI batting pace: 2.5–4s per delivery (feels natural)
    const delay = 2500 + Math.random() * 1500;
    this.deliveryInterval = setTimeout(() => {
      if (!this.isRunning) return;
      const result = this.simulateDelivery();
      this.onDelivery?.(result);

      const state = this.rules.getState();
      if (state.matchResult) {
        this.isRunning = false;
        this.onComplete?.(state.matchResult);
        return;
      }
      // Innings ended (all out / overs done) without deciding the match —
      // stop batting so the next innings isn't corrupted.
      if (this.rules.currentInnings !== this.inningsIndex) {
        this.isRunning = false;
        return;
      }
      this.scheduleNextDelivery();
    }, delay);
  }

  simulateDelivery() {
    const profile = this.profiles[this.difficulty];
    const state = this.rules.getState();

    // Chase logic — adjust aggression based on run rate needed
    const requiredRR = parseFloat(state.requiredRunRate) || 6;
    const currentRR = state.runs / Math.max(0.1, state.overs + state.balls / 6);
    const isUnderPressure = requiredRR > currentRR + 2;
    const isCoasting = requiredRR < currentRR - 3;

    let r = Math.random();
    let runs = 0;
    let howOut = null;

    // Wicket check first
    const wicketChance = isUnderPressure
      ? profile.wicketRate * 1.6   // more reckless when needing runs
      : isCoasting
        ? profile.wicketRate * 0.5 // conservative when ahead
        : profile.wicketRate;

    if (r < wicketChance) {
      const dismissals = ['bowled', 'caught', 'lbw', 'run_out', 'stumped'];
      howOut = dismissals[Math.floor(Math.random() * dismissals.length)];
      return {
        ...this.rules.processDelivery({ runs: 0, howOut, isNoBall: false, isWide: false }),
        aiShot: 'defensive',
        aiPower: 20 + Math.random() * 30,
        aiOut: howOut,
      };
    }

    // Runs
    r = Math.random();
    const boundaryChance = isUnderPressure
      ? profile.boundaryRate * 1.8
      : profile.boundaryRate;

    if (r < boundaryChance * 0.35) runs = 6;
    else if (r < boundaryChance) runs = 4;
    else if (r < profile.shotSuccess) runs = Math.floor(Math.random() * 3) + 1;
    else runs = 0;

    // Pick a shot name for animation (visual only for AI)
    const shots = ['straight_drive', 'cover_drive', 'pull', 'sweep', 'on_drive', 'hook', 'defensive'];
    const aiShot = runs === 0
      ? 'defensive'
      : shots[Math.floor(Math.random() * shots.length)];

    return {
      ...this.rules.processDelivery({ runs, isNoBall: false, isWide: false }),
      aiShot,
      aiPower: 40 + Math.random() * 60,
      aiRuns: runs,
    };
  }
}

export default AIBatting;
