/**
 * BatLoader.js — Loads the cricket_batsports.glb bat model and attaches it
 * to a hand bone / grip group, replacing all primitive bat geometry.
 *
 * Pivot convention after configureBat(): the group origin sits at the TOP of
 * the handle (where the hands grip), so rotating the parent swings the bat
 * naturally around the grip.
 */

import { Box3, Euler, MathUtils } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import batUrl from '../assets/cricket_batsports.glb?url';

const REGULATION_BAT_LENGTH_M = 0.96;

// Natural grip rest pose (Euler, default 'XYZ' order): slight forward lean,
// facing the bowler, with a small lean toward the off side. Right-handed
// values; left-handed mirrors the Z (off-side lean) component.
const REST_LEAN_X = MathUtils.degToRad(-8);
const REST_LEAN_Y = MathUtils.degToRad(0);
const REST_LEAN_Z = MathUtils.degToRad(10);

export class BatLoader {
  constructor() {
    this.loader = new GLTFLoader();
    this.batModel = null;
  }

  /**
   * Load and normalize the GLB. Resolves with the configured scene group.
   * @returns {Promise<import('three').Group>}
   */
  async load() {
    return new Promise((resolve, reject) => {
      this.loader.load(
        batUrl,
        (gltf) => {
          this.batModel = gltf.scene;
          this.configureBat(this.batModel);
          resolve(this.batModel);
        },
        undefined,
        reject,
      );
    });
  }

  /** Normalize scale to a regulation bat and move the pivot to the handle top. */
  configureBat(bat) {
    bat.scale.setScalar(1.0);
    bat.updateMatrixWorld(true);

    const box = new Box3().setFromObject(bat);
    const height = box.max.y - box.min.y;
    if (height > 0.0001) {
      bat.scale.setScalar(REGULATION_BAT_LENGTH_M / height);
    }

    bat.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = false;
        if (child.material) {
          child.material.roughness = child.material.roughness ?? 0.6;
          child.material.needsUpdate = true;
        }
      }
    });

    // Pivot correction: shift geometry down so the group origin = handle top.
    bat.updateMatrixWorld(true);
    const bbox = new Box3().setFromObject(bat);
    const handleTopY = bbox.max.y;
    bat.children.forEach((child) => {
      child.position.y -= handleTopY / bat.scale.y;
    });
  }

  /**
   * Attach the bat to a hand bone/group with a natural cricket grip:
   * face toward the bowler, hanging down with a slight off-side lean.
   *
   * @param {import('three').Group}  batModel
   * @param {import('three').Object3D} handBone
   * @param {boolean} [isRightHanded]
   */
  attachToHand(batModel, handBone, isRightHanded = true) {
    batModel.removeFromParent?.();
    handBone.add(batModel);

    const restEuler = this.getRestEuler(isRightHanded);
    batModel.position.set(isRightHanded ? 0.02 : -0.02, -0.08, 0.04);
    batModel.rotation.copy(restEuler);
  }

  /**
   * The bat's natural grip rest pose. Live orientation tracking (see
   * OrientationTracker) composes this with the phone's relative rotation —
   * it is never overwritten directly once live tracking is active.
   * @param {boolean} isRightHanded
   * @returns {import('three').Euler}
   */
  getRestEuler(isRightHanded = true) {
    return new Euler(REST_LEAN_X, REST_LEAN_Y, isRightHanded ? REST_LEAN_Z : -REST_LEAN_Z);
  }
}

export default BatLoader;
