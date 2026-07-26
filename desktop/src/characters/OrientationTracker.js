/**
 * OrientationTracker.js — composes a fixed "grip" rest pose with a live,
 * SLERP-smoothed relative quaternion coming from the phone.
 *
 * Two objects need this (the first-person HUD bat and the third-person
 * batsman's bat), each with its own rest pose, so this is a small reusable
 * unit rather than logic duplicated in engine.js twice.
 *
 * World rotation = restPose * (relative rotation since calibration).
 * The relative half is SLERPed frame-to-frame — never smoothed as Euler
 * angles, which doesn't compose correctly for combined rotations.
 */

import { Quaternion } from 'three';

export class OrientationTracker {
  constructor() {
    this.base     = new Quaternion(); // fixed grip/rest pose
    this.target   = new Quaternion(); // latest relative quaternion from the phone
    this.smoothed = new Quaternion(); // SLERP-smoothed relative quaternion
  }

  /** Set the fixed rest pose (e.g. the natural batting-grip lean). */
  setBaseFromEuler(euler) {
    this.base.setFromEuler(euler);
  }

  /** Latest relative-to-calibration quaternion, as [x, y, z, w]. */
  setTarget(x, y, z, w) {
    this.target.set(x, y, z, w);
  }

  /** Snap back to the rest pose — call on calibration/handedness changes. */
  reset() {
    this.target.identity();
    this.smoothed.identity();
  }

  /**
   * SLERP toward the target (frame-rate independent) and write
   * base * smoothed into `object3D.quaternion`.
   * @param {import('three').Object3D} object3D
   * @param {number} deltaTime  seconds since last frame
   * @param {number} [responsiveness] smaller = snappier; tune to taste.
   */
  apply(object3D, deltaTime, responsiveness = 0.001) {
    const slerpFactor = 1 - Math.pow(responsiveness, deltaTime);
    this.smoothed.slerp(this.target, slerpFactor);
    object3D.quaternion.copy(this.base).multiply(this.smoothed);
  }
}

export default OrientationTracker;
