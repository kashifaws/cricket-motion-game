/**
 * BatLoader.js — Loads the cricket_batsports.glb bat model and attaches it
 * to a hand bone / grip group, replacing all primitive bat geometry.
 *
 * Pivot convention after configureBat(): the group origin sits at the TOP of
 * the handle (where the hands grip), so rotating the parent swings the bat
 * naturally around the grip.
 */

import { Box3, MathUtils } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import batUrl from '../assets/cricket_batsports.glb?url';

const REGULATION_BAT_LENGTH_M = 0.96;

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

    if (isRightHanded) {
      batModel.position.set(0.02, -0.08, 0.04);
      batModel.rotation.set(
        MathUtils.degToRad(-8),   // slight forward lean (natural stance)
        MathUtils.degToRad(0),    // face the bowler
        MathUtils.degToRad(10),   // lean toward off-side
      );
    } else {
      batModel.position.set(-0.02, -0.08, 0.04);
      batModel.rotation.set(
        MathUtils.degToRad(-8),
        MathUtils.degToRad(0),
        MathUtils.degToRad(-10),
      );
    }
  }

  /**
   * Mirror live phone orientation onto the bat between deliveries.
   * Phone front face = bat face, phone long axis = bat length axis.
   *
   * @param {import('three').Object3D} batModel
   * @param {number} relAlpha  yaw (deg, relative to calibration)
   * @param {number} relBeta   pitch (deg)
   * @param {number} relGamma  roll (deg)
   * @param {boolean} isRightHanded
   */
  mirrorPhoneOrientation(batModel, relAlpha, relBeta, relGamma, isRightHanded) {
    const sign = isRightHanded ? 1 : -1;

    const alphaRad = MathUtils.degToRad((relAlpha ?? 0) * sign);
    const betaRad  = MathUtils.degToRad(relBeta ?? 0);
    const gammaRad = MathUtils.degToRad((relGamma ?? 0) * sign);

    // Clamp to prevent the bat clipping through the body
    const clampedAlpha = MathUtils.clamp(alphaRad, -Math.PI * 0.7, Math.PI * 0.7);
    const clampedBeta  = MathUtils.clamp(betaRad,  -Math.PI * 0.6, Math.PI * 0.6);
    const clampedGamma = MathUtils.clamp(gammaRad, -Math.PI * 0.5, Math.PI * 0.5);

    batModel.rotation.x = MathUtils.lerp(batModel.rotation.x, clampedBeta,  0.25);
    batModel.rotation.y = MathUtils.lerp(batModel.rotation.y, clampedAlpha, 0.25);
    batModel.rotation.z = MathUtils.lerp(batModel.rotation.z, clampedGamma, 0.25);
  }
}

export default BatLoader;
