/**
 * UmpireController.js — Animated ICC umpire signals.
 *
 * Drives the arm groups of a StickFigure umpire with lightweight rAF tweens.
 * Signal types: six, four, out, wide, no_ball, dead_ball, free_hit, bye.
 */

export class UmpireController {
  /**
   * @param {import('./StickFigure.js').StickFigure} umpireFigure
   * @param {import('./AnimationController.js').AnimationController} [animController]
   */
  constructor(umpireFigure, animController = null) {
    this.figure = umpireFigure;
    this.anim = animController;
    this.isSignalling = false;
  }

  /**
   * @param {'six'|'four'|'out'|'wide'|'no_ball'|'dead_ball'|'free_hit'|'bye'} eventType
   */
  signal(eventType) {
    if (this.isSignalling) return;
    this.isSignalling = true;
    setTimeout(() => { this.isSignalling = false; }, 2500);

    // Suspend any AnimationController tweens (e.g. idle sway) during a signal
    this.anim?.clearAll?.();

    switch (eventType) {
      case 'six':       this.animBothArmsUp(2000);        break;  // both arms above head
      case 'four':      this.animWaveAcrossBody(2000);    break;  // wave arm across body
      case 'out':       this.animOneFingerUp(2500);       break;  // index finger raised
      case 'wide':      this.animBothArmsHorizontal(1500); break; // T-pose
      case 'no_ball':   this.animOneArmOut(1500);         break;  // one arm horizontal
      case 'free_hit':  this.animCircularArm(2000);       break;  // circular arm motion
      case 'bye':       this.animOneHandRaise(1000);      break;  // open hand raised
      case 'dead_ball': this.animCrossedArms(1500);       break;  // arms crossed
    }
  }

  animBothArmsUp(duration) {
    const left = this.figure.leftUpperArm;
    const right = this.figure.rightUpperArm;

    this.tween(left.rotation, 'x', left.rotation.x, -Math.PI, 300);
    this.tween(right.rotation, 'x', right.rotation.x, -Math.PI, 300);
    setTimeout(() => {
      this.tween(left.rotation, 'x', -Math.PI, 0, 400);
      this.tween(right.rotation, 'x', -Math.PI, 0, 400);
    }, duration - 400);
  }

  animWaveAcrossBody(_duration) {
    const arm = this.figure.rightUpperArm;
    const swings = [0.4, -0.8, 0.4, -0.8, 0.4, 0];
    swings.forEach((val, i) => {
      setTimeout(() => {
        this.tween(arm.rotation, 'z', arm.rotation.z, val, 250);
      }, i * 300);
    });
    // Keep the arm forward while waving
    this.tween(arm.rotation, 'x', arm.rotation.x, -Math.PI * 0.45, 250);
    setTimeout(() => {
      this.tween(arm.rotation, 'x', -Math.PI * 0.45, 0, 300);
    }, swings.length * 300);
  }

  animOneFingerUp(duration) {
    const arm = this.figure.rightUpperArm;
    this.tween(arm.rotation, 'x', arm.rotation.x, -Math.PI * 0.85, 300);
    setTimeout(() => {
      this.tween(arm.rotation, 'x', -Math.PI * 0.85, 0, 400);
    }, duration - 400);
  }

  animBothArmsHorizontal(duration) {
    const left = this.figure.leftUpperArm;
    const right = this.figure.rightUpperArm;
    this.tween(left.rotation, 'z', left.rotation.z, Math.PI * 0.5, 250);
    this.tween(right.rotation, 'z', right.rotation.z, -Math.PI * 0.5, 250);
    setTimeout(() => {
      this.tween(left.rotation, 'z', Math.PI * 0.5, -0.4, 300);
      this.tween(right.rotation, 'z', -Math.PI * 0.5, 0.4, 300);
    }, duration - 300);
  }

  animOneArmOut(duration) {
    const arm = this.figure.rightUpperArm;
    this.tween(arm.rotation, 'z', arm.rotation.z, -Math.PI * 0.5, 250);
    setTimeout(() => {
      this.tween(arm.rotation, 'z', -Math.PI * 0.5, 0.4, 300);
    }, duration - 300);
  }

  animCircularArm(duration) {
    const arm = this.figure.rightUpperArm;
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 16;
      arm.rotation.y = Math.sin(elapsed * 0.01) * 0.8;
      arm.rotation.x = -Math.PI * 0.4 + Math.cos(elapsed * 0.01) * 0.4;
      if (elapsed >= duration) {
        clearInterval(interval);
        this.tween(arm.rotation, 'x', arm.rotation.x, 0, 300);
        this.tween(arm.rotation, 'y', arm.rotation.y, 0, 300);
      }
    }, 16);
  }

  animOneHandRaise(duration) {
    const arm = this.figure.rightUpperArm;
    this.tween(arm.rotation, 'x', arm.rotation.x, -Math.PI * 0.5, 200);
    setTimeout(() => {
      this.tween(arm.rotation, 'x', -Math.PI * 0.5, 0, 300);
    }, duration - 300);
  }

  animCrossedArms(duration) {
    const left = this.figure.leftUpperArm;
    const right = this.figure.rightUpperArm;
    this.tween(left.rotation, 'z', left.rotation.z, -0.5, 300);
    this.tween(right.rotation, 'z', right.rotation.z, 0.5, 300);
    setTimeout(() => {
      this.tween(left.rotation, 'z', -0.5, 0.4, 300);
      this.tween(right.rotation, 'z', 0.5, -0.4, 300);
    }, duration - 300);
  }

  /** Cubic ease-out tween on a single numeric property via rAF. */
  tween(obj, prop, from, to, duration) {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      obj[prop] = from + (to - from) * ease;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

export default UmpireController;
