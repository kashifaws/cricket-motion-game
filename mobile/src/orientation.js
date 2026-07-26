// orientation.js — device-orientation → quaternion conversion.
//
// This is the standard alpha/beta/gamma → quaternion mapping that used to
// live in Three.js's DeviceOrientationControls. Raw Euler angles cannot be
// interpolated or diffed axis-by-axis (they don't compose for combined
// rotations), so every consumer of device orientation in this app works with
// the quaternion this produces, never with alpha/beta/gamma directly.

import * as THREE from 'three';

const zee   = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0    = new THREE.Quaternion();
const q1    = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around X

/**
 * Convert a raw DeviceOrientationEvent reading into a quaternion, accounting
 * for the current screen orientation (portrait/landscape/upside-down).
 *
 * @param {number} alpha  deg, compass heading
 * @param {number} beta   deg, front-back tilt
 * @param {number} gamma  deg, left-right tilt
 * @param {number} screenOrientationAngle  deg, from screen.orientation.angle
 * @param {THREE.Quaternion} targetQuaternion  written in place
 * @returns {THREE.Quaternion} targetQuaternion
 */
export function deviceOrientationToQuaternion(alpha, beta, gamma, screenOrientationAngle, targetQuaternion) {
  const alphaRad = THREE.MathUtils.degToRad(alpha);
  const betaRad  = THREE.MathUtils.degToRad(beta);
  const gammaRad = THREE.MathUtils.degToRad(gamma);
  const orientRad = THREE.MathUtils.degToRad(screenOrientationAngle);

  euler.set(betaRad, alphaRad, -gammaRad, 'YXZ');
  targetQuaternion.setFromEuler(euler);
  targetQuaternion.multiply(q1); // align top face of device to camera
  targetQuaternion.multiply(q0.setFromAxisAngle(zee, -orientRad)); // adjust for screen orientation
  return targetQuaternion;
}

/**
 * Current screen orientation angle in degrees.
 * Falls back to window.orientation for older Safari, then 0.
 * Must be called fresh each time — the angle changes on rotation.
 * @returns {number}
 */
export function getScreenOrientationAngle() {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
    return screen.orientation.angle;
  }
  if (typeof window !== 'undefined' && typeof window.orientation === 'number') {
    return window.orientation;
  }
  return 0;
}
