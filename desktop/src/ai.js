/**
 * ai.js — BowlerAI: adapts delivery type and bowling line based on batting history.
 *
 * Strategy:
 *   - Tracks the direction of the last 6 shots.
 *   - If the batsman keeps hitting to leg, bowl outside off stump to draw an edge.
 *   - If the batsman keeps hitting to off, bowl around the wicket.
 *   - Vary delivery type to keep the batsman guessing.
 */

const TYPES = /** @type {const} */ (['pace', 'spin', 'yorker']);

export class BowlerAI {
  /** @type {Array<'leg'|'straight'|'off'>} */
  #history = [];

  /**
   * Current lateral line offset in world units.
   * Positive = outside off stump, negative = outside leg.
   * Clamped to [-2, +2].
   * @type {number}
   */
  lineOffset = 0;

  /**
   * Record the direction of the most recent shot and adapt strategy.
   * @param {'leg'|'straight'|'off'} direction
   */
  recordShot(direction) {
    this.#history.push(direction);
    if (this.#history.length > 6) this.#history.shift();
    this.#adapt();
  }

  /**
   * Pick the next delivery type, weighted by recent scoring patterns.
   * @returns {'pace'|'spin'|'yorker'}
   */
  nextDeliveryType() {
    const straightCount = this.#history.filter(d => d === 'straight').length;

    // If batsman is dominating straight deliveries, surprise with a yorker.
    if (straightCount >= 4) return 'yorker';

    // Weighted random: pace 55%, spin 28%, yorker 17%.
    const r = Math.random();
    if (r < 0.55) return 'pace';
    if (r < 0.83) return 'spin';
    return 'yorker';
  }

  /**
   * Adjust the bowling line based on the dominant shot direction.
   * @private
   */
  #adapt() {
    const n        = this.#history.length;
    const legCount = this.#history.filter(d => d === 'leg').length;
    const offCount = this.#history.filter(d => d === 'off').length;

    if (n >= 3 && legCount > n * 0.6) {
      // Persistent leg-side hitting → drag line toward off stump
      this.lineOffset = Math.min(this.lineOffset + 0.35, 2);
    } else if (n >= 3 && offCount > n * 0.6) {
      // Persistent off-side hitting → bowl into the body / leg stump
      this.lineOffset = Math.max(this.lineOffset - 0.35, -2);
    } else {
      // No dominant pattern — creep back toward straight
      this.lineOffset *= 0.75;
      if (Math.abs(this.lineOffset) < 0.05) this.lineOffset = 0;
    }
  }
}
