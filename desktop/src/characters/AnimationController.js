/**
 * AnimationController.js — Manual delta-based keyframe animation.
 *
 * Drives all character animations without Three.js AnimationMixer so that
 * swing timing can be tied precisely to mobile input events.
 *
 * Tween format: { target, property, from, to, elapsed, delay, duration, easing, onComplete, completed }
 *   from = undefined → lazy-captured at the moment the tween first becomes active.
 *   to   must always be a finite number.
 */

import { Clock } from 'three';

export class AnimationController {
  /** @param {import('./StickFigure.js').StickFigure} figure */
  constructor(figure) {
    this.figure            = figure;
    this.clock             = new Clock();
    this.activeAnimations  = [];
    this.idleTime          = 0;
    this._walkState        = null;
  }

  // ── Easing ────────────────────────────────────────────────────────────────

  easeOut(t)   { return 1 - Math.pow(1 - t, 3); }
  easeIn(t)    { return t * t * t; }
  easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  linear(t)    { return t; }

  #easingFn(name) {
    if (typeof name === 'function') return name;
    const fn = this[name];
    return fn ? fn.bind(this) : this.linear.bind(this);
  }

  // ── Tween core ────────────────────────────────────────────────────────────

  /**
   * Public API — spec signature.
   * @param {object} target
   * @param {string} property
   * @param {number|null} from   null = capture current value at first tick
   * @param {number} to
   * @param {number} duration    milliseconds
   * @param {string|Function} easing
   * @param {Function|null} [onComplete]
   */
  tween(target, property, from, to, duration, easing, onComplete = null) {
    this.#push(target, property, from, to, duration, easing, 0, onComplete);
  }

  // Internal tween builder — adds delay support needed for phased animations.
  #push(target, property, from, to, duration, easing, delay = 0, onComplete = null) {
    this.activeAnimations.push({
      target,
      property,
      from:      (from !== null && from !== undefined) ? from : undefined,
      to,
      elapsed:   0,
      delay:     delay ?? 0,
      duration,
      easing:    this.#easingFn(easing),
      onComplete,
      completed: false,
    });
  }

  /**
   * Tween several rotation (or any numeric) axes in parallel.
   * Fires onComplete once ALL named axes have finished.
   * @param {object} obj          — e.g. figure.rightUpperArm.rotation
   * @param {Record<string,number>} axes  — e.g. { x: -2.4, z: -0.8 }
   * @param {number} duration
   * @param {string|Function} easing
   * @param {number} [delay]
   * @param {Function|null} [onComplete]
   */
  #rot(obj, axes, duration, easing, delay = 0, onComplete = null) {
    const keys = Object.keys(axes);
    let done   = 0;
    const check = onComplete
      ? () => { if (++done === keys.length) onComplete(); }
      : null;
    for (const axis of keys) {
      this.#push(obj, axis, null, axes[axis], duration, easing, delay, check);
    }
  }

  /** Stop all running tweens and reset walk state. */
  clearAll() {
    this.activeAnimations = [];
    this._walkState       = null;
  }

  // ── Main update ───────────────────────────────────────────────────────────

  /**
   * Advance all tweens. Call this once per frame with the frame delta in seconds.
   * @param {number} delta — seconds since last frame (from Three.js Clock or engine loop)
   */
  update(delta) {
    const ms = delta * 1000;
    this.idleTime += delta;

    const next = [];
    for (const tw of this.activeAnimations) {
      if (tw.completed) continue;

      tw.elapsed += ms;

      const active = tw.elapsed - tw.delay;
      if (active <= 0) { next.push(tw); continue; }

      // Lazy-capture from value on first active tick
      if (tw.from === undefined) tw.from = tw.target[tw.property];

      const raw = Math.min(active / tw.duration, 1);
      tw.target[tw.property] = tw.from + (tw.to - tw.from) * tw.easing(raw);

      if (raw >= 1) {
        tw.completed = true;
        tw.onComplete?.();
      } else {
        next.push(tw);
      }
    }
    this.activeAnimations = next;

    if (this._walkState) this.#stepWalk(delta);

    if (this.activeAnimations.length === 0 && !this._walkState) {
      this.#idleSway();
    }
  }

  // ── Bat swing animations ──────────────────────────────────────────────────

  /** @param {number} power 0–100 */
  animateDrive(power) {
    this.clearAll();
    this.idleTime = 0;
    const f  = this.figure;
    const s  = 0.6 + (power / 100) * 0.8;  // speedMult
    const si = 1 / s;                        // inverse → scale durations

    // Absolute delay offsets per phase
    const d1 = 0;
    const d2 = 140 * si;
    const d3 = d2 + 80 * si;
    const d4 = d3 + 220 * si;

    // Phase 1 — backswing: bat raised behind shoulder
    this.#rot(f.rightUpperArm.rotation, { x: -2.4, z: -0.8 }, 140 * si, 'easeOut',  d1);
    this.#rot(f.leftUpperArm.rotation,  { x: -0.8, z:  0.6 }, 140 * si, 'easeOut',  d1);
    this.#push(f.torso.rotation,    'y', null,  0.35, 140 * si, 'easeOut',  d1);
    this.#push(f.leftThigh.rotation,'x', null,  0.20, 140 * si, 'easeOut',  d1);

    // Phase 2 — downswing: fast easeIn through the ball
    this.#rot(f.rightUpperArm.rotation, { x:  0.4, z: -0.3 }, 80 * si,  'easeIn',   d2);
    this.#rot(f.leftUpperArm.rotation,  { x:  0.3, z:  0.2 }, 80 * si,  'easeIn',   d2);
    this.#push(f.torso.rotation,    'y', null, -0.10, 80 * si,  'easeIn',   d2);
    this.#push(f.leftThigh.rotation,'x', null, -0.05, 80 * si,  'easeIn',   d2);

    // Phase 3 — follow-through: bat finishes high on off side
    this.#rot(f.rightUpperArm.rotation, { x: -1.8, z:  0.6 }, 220 * si, 'easeOut',  d3);
    this.#push(f.torso.rotation,    'y', null, -0.30, 220 * si, 'easeOut',  d3);

    // Phase 4 — return to batting stance
    this.#returnToBatting(d4, 350);
  }

  /** @param {number} power */
  animateSweep(power) {
    this.clearAll();
    this.idleTime = 0;
    const f  = this.figure;
    const s  = 0.6 + (power / 100) * 0.8;
    const si = 1 / s;

    // Capture current values for relative offsets
    const lThighX0 = f.leftThigh.rotation.x;
    const rThighX0 = f.rightThigh.rotation.x;
    const torsoY0  = f.torso.position.y;

    const d1 = 0;
    const d2 = 100 * si;
    const d3 = d2 + 90 * si;

    // Phase 1 — crouch: bend legs, dip torso
    this.#push(f.leftThigh.rotation,  'x', lThighX0, lThighX0 + 0.5, 100 * si, 'easeOut',  d1);
    this.#push(f.rightThigh.rotation, 'x', rThighX0, rThighX0 + 0.3, 100 * si, 'easeOut',  d1);
    this.#push(f.torso.position,      'y', torsoY0,  torsoY0 - 0.15, 100 * si, 'easeOut',  d1);
    this.#rot(f.rightUpperArm.rotation, { x: -0.2, z: -0.5 },        100 * si, 'easeOut',  d1);

    // Phase 2 — sweep: bat sweeps horizontal from leg to off
    this.#push(f.rightUpperArm.rotation, 'y', -0.8,  1.4,  90 * si, 'easeIn',   d2);
    this.#push(f.rightUpperArm.rotation, 'x', null,  0.2,  90 * si, 'easeIn',   d2);
    this.#rot(f.leftUpperArm.rotation,  { x: -0.4, y:  0.8 },        90 * si, 'easeIn',   d2);

    // Phase 3 — return
    this.#push(f.torso.position, 'y', null, torsoY0, 200, 'easeInOut', d3);
    this.#returnToBatting(d3, 200);
  }

  /** @param {number} power */
  animateHook(power) {
    this.clearAll();
    this.idleTime = 0;
    const f  = this.figure;
    const s  = 0.6 + (power / 100) * 0.8;
    const si = 1 / s;

    const d1 = 0;
    const d2 = 80 * si;
    const d3 = d2 + 70 * si;

    // Phase 1 — bat rises to head height
    this.#rot(f.rightUpperArm.rotation, { x: -2.6, z: -0.5 }, 80 * si,  'easeOut', d1);
    this.#rot(f.leftUpperArm.rotation,  { x: -1.2, z:  0.4 }, 80 * si,  'easeOut', d1);
    this.#push(f.torso.rotation, 'y', null,  0.25, 80 * si,  'easeOut', d1);

    // Phase 2 — rapid horizontal arc at head level
    this.#push(f.rightUpperArm.rotation, 'y', -1.2,  1.6,  70 * si, 'easeIn',  d2);
    this.#push(f.rightUpperArm.rotation, 'x', null, -1.2,  70 * si, 'easeIn',  d2);
    this.#push(f.torso.rotation,         'y', null, -0.35, 70 * si, 'easeIn',  d2);

    // Phase 3 — return
    this.#returnToBatting(d3, 220);
  }

  /** @param {number} power */
  animatePull(power) {
    this.clearAll();
    this.idleTime = 0;
    const f  = this.figure;
    const s  = 0.6 + (power / 100) * 0.8;
    const si = 1 / s;

    const lThighX0 = f.leftThigh.rotation.x;

    const d1 = 0;
    const d2 = 90 * si;
    const d3 = d2 + 80 * si;

    // Phase 1 — weight back, bat at 45° blend of X/Y
    this.#rot(f.rightUpperArm.rotation, { x: -2.0, y:  0.4, z: -0.5 }, 90 * si, 'easeOut', d1);
    this.#rot(f.leftUpperArm.rotation,  { x: -0.8, z:  0.3 },          90 * si, 'easeOut', d1);
    this.#push(f.torso.rotation,        'y', null,  0.30, 90 * si, 'easeOut', d1);
    this.#push(f.leftThigh.rotation,    'x', lThighX0, lThighX0 + 0.25, 90 * si, 'easeOut', d1);

    // Phase 2 — pull through: X and Y blend gives 45° plane
    this.#rot(f.rightUpperArm.rotation, { x:  0.0, y: -1.2, z:  0.2 }, 80 * si, 'easeIn',  d2);
    this.#push(f.torso.rotation,        'y', null, -0.30, 80 * si, 'easeIn',  d2);
    this.#push(f.leftThigh.rotation,    'x', null, -0.10, 80 * si, 'easeIn',  d2);

    // Phase 3 — return
    this.#returnToBatting(d3, 220);
  }

  /** @param {number} power */
  animateCut(power) {
    this.clearAll();
    this.idleTime = 0;
    const f  = this.figure;
    const s  = 0.6 + (power / 100) * 0.8;
    const si = 1 / s;

    const rThighX0 = f.rightThigh.rotation.x;

    const d1 = 0;
    const d2 = 110 * si;
    const d3 = d2 + 80 * si;

    // Phase 1 — weight back, torso leans, bat raised to off side
    this.#rot(f.rightUpperArm.rotation, { x: -1.6, y:  0.6 },        110 * si, 'easeOut', d1);
    this.#rot(f.leftUpperArm.rotation,  { x: -0.4, z:  0.2 },        110 * si, 'easeOut', d1);
    this.#push(f.torso.rotation,        'y', null,  0.40,             110 * si, 'easeOut', d1);
    this.#push(f.rightThigh.rotation,   'x', rThighX0, rThighX0 + 0.2, 110 * si, 'easeOut', d1);

    // Phase 2 — cut down and across to off side
    this.#rot(f.rightUpperArm.rotation, { x: -0.3, y: -0.6 },         80 * si, 'easeIn',  d2);
    this.#push(f.rightForearm.rotation, 'x', null, -0.5,               80 * si, 'easeIn',  d2);
    this.#push(f.torso.rotation,        'y', null, -0.20,               80 * si, 'easeIn',  d2);

    // Phase 3 — return
    this.#returnToBatting(d3, 220);
  }

  /** Deliberate block — always the same speed regardless of power. */
  animateDefensive(_power) {
    this.clearAll();
    this.idleTime = 0;
    const f  = this.figure;

    // Short backswing
    this.#rot(f.rightUpperArm.rotation, { x: -0.6, z: -0.3 }, 200, 'easeOut',   0);
    this.#push(f.rightForearm.rotation, 'x', null, -0.8,        200, 'easeOut',   0);
    this.#rot(f.leftUpperArm.rotation,  { x: -0.2, z:  0.4 }, 200, 'easeOut',   0);

    // Gentle push through — bat meets ball close to pad
    this.#rot(f.rightUpperArm.rotation, { x:  0.3, z: -0.2 }, 200, 'easeInOut', 200);
    this.#push(f.rightForearm.rotation, 'x', null, -0.3,        200, 'easeInOut', 200);

    // Return — total always ~400ms
    this.#returnToBatting(400, 350);
  }

  /** Small flinch for a missed delivery — no bat swing. */
  animateMiss() {
    this.clearAll();
    this.idleTime = 0;
    const f      = this.figure;
    const startZ = f.group.position.z;

    // Flinch: head turns, slight shuffle back
    this.#push(f.head.rotation,  'y', null,  -0.30, 120, 'easeOut', 0);
    this.#push(f.torso.rotation, 'y', null,   0.10, 120, 'easeOut', 0);
    this.#push(f.group.position, 'z', startZ, startZ + 0.12, 180, 'easeOut', 0);

    // Recover
    this.#push(f.head.rotation,  'y', null, 0, 200, 'easeInOut', 280);
    this.#push(f.torso.rotation, 'y', null, f.role === 'batsman' ? 0.15 : 0, 200, 'easeInOut', 280);
    this.#push(f.group.position, 'z', null, startZ, 220, 'easeInOut', 300);
  }

  // ── Bowler animations ─────────────────────────────────────────────────────

  /**
   * Three-stride run-up → jump release → walk back.
   * @param {Function} [onReleaseCallback] — called the instant the ball is released
   */
  animateRunUp(onReleaseCallback) {
    this.clearAll();
    this.idleTime = 0;
    const f      = this.figure;
    const g      = f.group;
    const startZ = g.position.z;

    // ── Stride 1 (0–200ms): legs alternate in place ──────────────────────
    this.#rot(f.leftThigh.rotation,  { x:  0.6 }, 100, 'easeInOut',   0);
    this.#rot(f.rightThigh.rotation, { x: -0.6 }, 100, 'easeInOut',   0);
    this.#rot(f.leftThigh.rotation,  { x: -0.3 }, 100, 'easeInOut', 100);
    this.#rot(f.rightThigh.rotation, { x:  0.3 }, 100, 'easeInOut', 100);

    // ── Stride 2 (200–380ms): first step forward +1.5 units ──────────────
    this.#rot(f.leftThigh.rotation,  { x: -0.6 },  90, 'easeInOut', 200);
    this.#rot(f.rightThigh.rotation, { x:  0.6 },  90, 'easeInOut', 200);
    this.#push(g.position, 'z', startZ, startZ + 1.5, 180, 'linear', 200);
    this.#rot(f.leftThigh.rotation,  { x:  0.3 },  90, 'easeInOut', 290);
    this.#rot(f.rightThigh.rotation, { x: -0.3 },  90, 'easeInOut', 290);

    // ── Stride 3 (380–540ms): second step forward another +1.5 ───────────
    this.#rot(f.leftThigh.rotation,  { x:  0.5 },  80, 'easeInOut', 380);
    this.#rot(f.rightThigh.rotation, { x: -0.5 },  80, 'easeInOut', 380);
    this.#push(g.position, 'z', startZ + 1.5, startZ + 3.0, 160, 'linear', 380);

    // ── Jump + arm over (540–690ms) ───────────────────────────────────────
    this.#push(g.position, 'y', 0, 0.3, 150, 'easeOut', 540);
    this.#rot(f.rightUpperArm.rotation, { x:  2.4, z:  0.0 }, 150, 'easeIn', 540);
    this.#rot(f.leftUpperArm.rotation,  { x: -0.8, z:  0.4 }, 150, 'easeIn', 540);

    // ── Release (690–790ms): arm continues, ball leaves hand ─────────────
    this.#push(g.position, 'y', 0.3, 0, 100, 'easeIn', 690, () => {
      onReleaseCallback?.();
    });
    this.#rot(f.rightUpperArm.rotation, { x: 0.6, z: -0.2 }, 100, 'easeIn', 690);

    // ── Walk back to start (790–1390ms) ──────────────────────────────────
    this.#push(g.position, 'z', startZ + 3.0, startZ, 600, 'easeInOut', 790);
    this.#rot(f.leftThigh.rotation,  { x:  0.05 }, 600, 'easeInOut', 790);
    this.#rot(f.rightThigh.rotation, { x:  0.05 }, 600, 'easeInOut', 790);
    this.#rot(f.rightUpperArm.rotation, { x: -2.2, z: 0.0 }, 600, 'easeInOut', 790);
    this.#rot(f.leftUpperArm.rotation,  { x:  0.5, z: 0.3 }, 600, 'easeInOut', 790);
  }

  // ── Fielder animations ────────────────────────────────────────────────────

  /**
   * Dive toward the ball's landing position, then stand back up.
   * @param {number} targetX
   * @param {number} targetZ
   * @param {Function} [onArrive] — called when fielder reaches the ball
   */
  animateFielderDive(targetX, targetZ, onArrive) {
    this.clearAll();
    this.idleTime = 0;
    const f  = this.figure;
    const g  = f.group;

    // Face the ball
    const angle = Math.atan2(targetX - g.position.x, targetZ - g.position.z);
    this.#push(g.rotation, 'y', null, angle, 100, 'easeOut', 0);

    // Lunge forward (400ms)
    this.#push(g.position, 'x', null, targetX, 400, 'easeIn', 0);
    this.#push(g.position, 'z', null, targetZ, 400, 'easeIn', 0, () => {
      onArrive?.();
    });

    // At 60% (240ms) tip body forward into dive
    this.#push(g.rotation, 'x', 0, Math.PI * 0.25, 160, 'easeIn', 240);

    // Arms reach out for the ball
    this.#rot(f.rightUpperArm.rotation, { x: -1.8, z: -0.3 }, 200, 'easeIn', 100);
    this.#rot(f.leftUpperArm.rotation,  { x: -1.8, z:  0.3 }, 200, 'easeIn', 100);

    // Stand back up (400ms after arrival)
    this.#push(g.rotation, 'x', null, 0, 400, 'easeOut', 400);
    this.#rot(f.rightUpperArm.rotation, { x: -0.5, z: -0.5 }, 400, 'easeOut', 400);
    this.#rot(f.leftUpperArm.rotation,  { x: -0.5, z:  0.5 }, 400, 'easeOut', 400);
  }

  /**
   * Wind-up and throw.
   * @param {Function} [onRelease] — called at the moment the ball should leave
   */
  animateFielderThrow(onRelease) {
    this.clearAll();
    this.idleTime = 0;
    const f = this.figure;

    // Wind-up: arm sweeps back
    this.#rot(f.rightUpperArm.rotation, { x: -2.2, z:  0.2 }, 200, 'easeOut',   0);
    this.#rot(f.leftUpperArm.rotation,  { x: -0.4, z:  0.4 }, 200, 'easeOut',   0);
    this.#push(f.torso.rotation, 'y', null, 0.4, 200, 'easeOut', 0);

    // Throw: arm comes forward fast, release at peak
    this.#rot(f.rightUpperArm.rotation, { x: 1.8, z: -0.4 }, 140, 'easeIn', 200, () => {
      onRelease?.();
    });
    this.#push(f.rightForearm.rotation, 'x', null,  0.6, 140, 'easeIn',   200);
    this.#push(f.torso.rotation,        'y', null, -0.2, 140, 'easeIn',   200);

    // Follow-through and recover
    this.#rot(f.rightUpperArm.rotation, { x:  0.4, z: -0.2 }, 200, 'easeOut',   340);
    this.#rot(f.leftUpperArm.rotation,  { x: -0.5, z:  0.5 }, 250, 'easeInOut', 340);
    this.#push(f.torso.rotation,        'y', null, 0,           250, 'easeInOut', 340);
  }

  /**
   * Walk fielder to a target world position.
   * @param {number} targetX
   * @param {number} targetZ
   * @param {number} speed    units per second
   * @param {Function} [onArrive]
   */
  animateFielderWalk(targetX, targetZ, speed, onArrive) {
    this.clearAll();
    this.idleTime = 0;
    const f   = this.figure;
    const g   = f.group;
    const dx  = targetX - g.position.x;
    const dz  = targetZ - g.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.01) { onArrive?.(); return; }

    // Face direction of travel
    this.#push(g.rotation, 'y', null, Math.atan2(dx, dz), 100, 'easeOut', 0);

    // Hand off to the procedural walk stepper
    this._walkState = {
      startX:   g.position.x,
      startZ:   g.position.z,
      targetX,
      targetZ,
      elapsed:  0,
      duration: (dist / Math.max(speed, 0.01)) * 1000,
      onArrive,
    };
  }

  // ── Idle ──────────────────────────────────────────────────────────────────

  /** Called from update() every frame when nothing else is running. */
  #idleSway() {
    const t = this.clock.getElapsedTime();
    const f = this.figure;
    if (f.torso) f.torso.rotation.z = Math.sin(t * 0.8) * 0.02;
    if (f.head)  f.head.rotation.y  = Math.sin(t * 0.6) * 0.05;
  }

  // ── Umpire signals ────────────────────────────────────────────────────────

  /** Right arm raised straight up — OUT. Hold 1.5 s then lower. */
  animateUmpireOut() {
    this.clearAll();
    const f = this.figure;
    if (!f.rightUpperArm) return;

    // Raise: x = -π (arm flips from hanging-down to pointing up), z = 0
    this.#rot(f.rightUpperArm.rotation, { x: -Math.PI, z: 0 }, 300, 'easeOut',   0);
    // Lower after hold
    this.#rot(f.rightUpperArm.rotation, { x: 0, z:  0.4 },     350, 'easeInOut', 300 + 1500);
  }

  /** Both arms extend horizontally (T-pose) — NO BALL. Hold 1 s then lower. */
  animateUmpireNoBall() {
    this.clearAll();
    const f = this.figure;
    if (!f.rightUpperArm) return;

    // Signal: right arm points right (z = -π/2), left arm points left (z = +π/2)
    this.#rot(f.rightUpperArm.rotation, { x: 0, z: -Math.PI * 0.5 }, 280, 'easeOut',   0);
    this.#rot(f.leftUpperArm.rotation,  { x: 0, z:  Math.PI * 0.5 }, 280, 'easeOut',   0);
    // Lower after 1 s hold
    this.#rot(f.rightUpperArm.rotation, { x: 0, z:  0.4 }, 300, 'easeInOut', 280 + 1000);
    this.#rot(f.leftUpperArm.rotation,  { x: 0, z: -0.4 }, 300, 'easeInOut', 280 + 1000);
  }

  /** Both arms extend sideways (T-pose) — WIDE. Hold 1 s then lower. */
  animateUmpireWide() {
    this.clearAll();
    const f = this.figure;
    if (!f.rightUpperArm) return;

    this.#rot(f.rightUpperArm.rotation, { x: 0, z: -Math.PI * 0.5 }, 280, 'easeOut',   0);
    this.#rot(f.leftUpperArm.rotation,  { x: 0, z:  Math.PI * 0.5 }, 280, 'easeOut',   0);
    this.#rot(f.rightUpperArm.rotation, { x: 0, z:  0.4 }, 300, 'easeInOut', 280 + 1000);
    this.#rot(f.leftUpperArm.rotation,  { x: 0, z: -0.4 }, 300, 'easeInOut', 280 + 1000);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Schedule a return to batting stance.
   * Only called when figure.role === 'batsman'.
   * @param {number} delay      ms offset from animation start
   * @param {number} duration
   */
  #returnToBatting(delay, duration) {
    const f = this.figure;
    if (f.role !== 'batsman') return;

    this.#rot(f.rightUpperArm.rotation, { x: -0.8, z: -0.6 }, duration, 'easeInOut', delay);
    this.#push(f.rightForearm.rotation, 'x', null, -0.4,       duration, 'easeInOut', delay);
    this.#rot(f.leftUpperArm.rotation,  { x: -0.3, z:  0.5 }, duration, 'easeInOut', delay);
    this.#push(f.torso.rotation,        'y', null,  0.15,      duration, 'easeInOut', delay);
    this.#push(f.leftThigh.rotation,    'x', null,  0.15,      duration, 'easeInOut', delay);
    this.#push(f.rightThigh.rotation,   'x', null, -0.10,      duration, 'easeInOut', delay);
    // Restore torso Y if sweep moved it (1.22 = buildBody default)
    this.#push(f.torso.position,        'y', null,  1.22,      duration, 'easeInOut', delay);
  }

  /** Procedural leg-alternation during a fielder walk. Called from update(). */
  #stepWalk(delta) {
    const w  = this._walkState;
    const f  = this.figure;
    const g  = f.group;

    w.elapsed += delta * 1000;
    const prog = Math.min(w.elapsed / w.duration, 1);

    g.position.x = w.startX + (w.targetX - w.startX) * prog;
    g.position.z = w.startZ + (w.targetZ - w.startZ) * prog;

    // Leg oscillation at ~2.5 strides/second
    const phi = (w.elapsed * 0.0025) * Math.PI * 2;
    f.leftThigh.rotation.x  =  Math.sin(phi) * 0.40;
    f.rightThigh.rotation.x = -Math.sin(phi) * 0.40;
    f.leftShin.rotation.x   =  Math.max(0, Math.sin(phi + 0.5))               * 0.30;
    f.rightShin.rotation.x  =  Math.max(0, Math.sin(phi + 0.5 + Math.PI))     * 0.30;

    if (prog >= 1) {
      this._walkState = null;
      w.onArrive?.();
    }
  }
}

export default AnimationController;
