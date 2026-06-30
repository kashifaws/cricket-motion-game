/**
 * StickFigure.js — Reusable low-poly cricket player.
 *
 * Every player on the field (batsman, bowler, fielder, umpire) is built
 * from this one class with different `role`/colour/pose options.
 *
 * Hierarchy (groups marked with *, meshes are leaves):
 *   group
 *     ├ head, helmet, visor   (static — not parented to torso)
 *     ├ torso, hips           (static meshes, can still be rotated)
 *     ├ leftUpperArm *  → leftForearm *  → (batHandle * → batBlade → batEdges, if hasBat)
 *     ├ rightUpperArm * → rightForearm * → (bat, if hasBat)
 *     ├ leftThigh *     → leftShin *     → leftShoe
 *     ├ rightThigh *    → rightShin *    → rightShoe
 *     └ leftPad, rightPad     (batsman only)
 */

import {
  Group, Mesh,
  SphereGeometry, CylinderGeometry, CapsuleGeometry, BoxGeometry, EdgesGeometry,
  MeshLambertMaterial, LineBasicMaterial, LineSegments,
} from 'three';

export class StickFigure {
  /**
   * @param {object} [options]
   * @param {'batsman'|'bowler'|'fielder'|'umpire'} [options.role]
   * @param {string} [options.teamColor]   - body colour, e.g. '#CC2200'
   * @param {string} [options.kitColor]    - trouser colour
   * @param {string} [options.helmetColor] - darker shade of teamColor
   * @param {boolean} [options.hasBat]     - only honoured when role === 'batsman'
   * @param {string} [options.name]
   * @param {number} [options.scale]
   */
  constructor(options = {}) {
    const {
      role        = 'fielder',
      teamColor   = '#CC2200',
      kitColor    = '#ffffff',
      helmetColor = '#990000',
      hasBat      = false,
      name        = '',
      scale       = 1.0,
    } = options;

    this.role        = role;
    this.teamColor    = role === 'umpire' ? '#ffffff' : teamColor;
    this.kitColor     = role === 'umpire' ? '#888888' : kitColor;
    this.helmetColor  = helmetColor;
    this.hasBat       = role === 'batsman' && hasBat;
    this.playerName   = name;

    this.group = new Group();
    this.group.scale.setScalar(scale);

    this.buildBody();

    switch (role) {
      case 'batsman': this.setBattingStance(); break;
      case 'bowler':  this.setBowlingStance(); break;
      case 'fielder': this.setFieldingStance(0, 0); break;
      case 'umpire':  this.group.position.set(1.5, 0, 1); break;
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  buildBody() {
    const isUmpire   = this.role === 'umpire';
    const isBatsman  = this.role === 'batsman';

    const teamMat   = new MeshLambertMaterial({ color: this.teamColor });
    const kitMat    = new MeshLambertMaterial({ color: this.kitColor });
    const helmetMat = new MeshLambertMaterial({ color: this.helmetColor });
    const shoeMat   = new MeshLambertMaterial({ color: 0xeeeeee });
    const padMat    = new MeshLambertMaterial({ color: 0xf0f0f0 });
    const handleMat = new MeshLambertMaterial({ color: 0x8B4513 });
    const bladeMat  = new MeshLambertMaterial({ color: 0xDEB887 });
    const edgeMat   = new LineBasicMaterial({ color: 0x8B6343 });

    teamMat.userData.isTeamColor = true;

    const shadow = m => { m.castShadow = true; return m; };

    // ── Head / helmet ──────────────────────────────────────────────────────
    this.head = shadow(new Mesh(new SphereGeometry(0.18, 8, 6), teamMat));
    this.head.position.set(0, 1.72, 0);
    this.group.add(this.head);

    if (!isUmpire) {
      this.helmet = shadow(new Mesh(
        new SphereGeometry(0.20, 8, 6, 0, Math.PI),
        helmetMat,
      ));
      this.helmet.position.set(0, 1.76, 0);
      this.group.add(this.helmet);

      this.visor = shadow(new Mesh(new BoxGeometry(0.28, 0.04, 0.12), helmetMat));
      this.visor.position.set(0, 1.66, 0.14);
      this.group.add(this.visor);
    }

    // ── Torso / hips ────────────────────────────────────────────────────────
    this.torso = shadow(new Mesh(new CapsuleGeometry(0.13, 0.30, 4, 8), teamMat));
    this.torso.position.set(0, 1.22, 0);
    this.group.add(this.torso);

    this.hips = shadow(new Mesh(new CylinderGeometry(0.11, 0.09, 0.18, 8), kitMat));
    this.hips.position.set(0, 0.88, 0);
    this.group.add(this.hips);

    // ── Arms ───────────────────────────────────────────────────────────────
    const buildArm = (sign) => {
      const upperArm = new Group();
      upperArm.position.set(0.22 * sign, 1.42, 0);
      upperArm.rotation.z = 0.4 * sign;

      const upperArmMesh = shadow(new Mesh(new CylinderGeometry(0.055, 0.05, 0.30, 6), teamMat));
      upperArmMesh.position.set(0, -0.15, 0);
      upperArm.add(upperArmMesh);

      const forearm = new Group();
      forearm.position.set(0, -0.28, 0);
      const forearmMesh = shadow(new Mesh(new CylinderGeometry(0.048, 0.044, 0.26, 6), teamMat));
      forearmMesh.position.set(0, -0.13, 0);
      forearm.add(forearmMesh);
      upperArm.add(forearm);

      this.group.add(upperArm);
      return { upperArm, forearm };
    };

    const left  = buildArm(-1);
    const right = buildArm(1);
    this.leftUpperArm  = left.upperArm;
    this.leftForearm   = left.forearm;
    this.rightUpperArm = right.upperArm;
    this.rightForearm  = right.forearm;

    // ── Legs ───────────────────────────────────────────────────────────────
    const buildLeg = (sign) => {
      const thigh = new Group();
      thigh.position.set(0.10 * sign, 0.82, 0);
      thigh.rotation.x = 0.05;

      const thighMesh = shadow(new Mesh(new CylinderGeometry(0.07, 0.065, 0.34, 6), kitMat));
      thighMesh.position.set(0, -0.17, 0);
      thigh.add(thighMesh);

      const shin = new Group();
      shin.position.set(0, -0.34, 0);
      const shinMesh = shadow(new Mesh(new CylinderGeometry(0.060, 0.055, 0.30, 6), kitMat));
      shinMesh.position.set(0, -0.15, 0);
      shin.add(shinMesh);
      thigh.add(shin);

      const shoe = shadow(new Mesh(new SphereGeometry(0.09, 6, 4), shoeMat));
      shoe.scale.set(1.6, 0.7, 1.2);
      shoe.position.set(0, -0.30, 0.04);
      shin.add(shoe);

      this.group.add(thigh);
      return { thigh, shin, shoe };
    };

    const lLeg = buildLeg(-1);
    const rLeg = buildLeg(1);
    this.leftThigh  = lLeg.thigh;
    this.leftShin   = lLeg.shin;
    this.leftShoe   = lLeg.shoe;
    this.rightThigh = rLeg.thigh;
    this.rightShin  = rLeg.shin;
    this.rightShoe  = rLeg.shoe;

    // ── Pads (batsman only) ─────────────────────────────────────────────────
    if (isBatsman) {
      this.leftPad = shadow(new Mesh(new BoxGeometry(0.10, 0.38, 0.09), padMat));
      this.leftPad.position.set(-0.10, 0.60, 0.06);
      this.group.add(this.leftPad);

      this.rightPad = shadow(new Mesh(new BoxGeometry(0.10, 0.38, 0.09), padMat));
      this.rightPad.position.set(0.10, 0.60, 0.06);
      this.group.add(this.rightPad);
    }

    // ── Bat (only if hasBat) ─────────────────────────────────────────────────
    if (this.hasBat) {
      this.batHandle = shadow(new Mesh(new CylinderGeometry(0.022, 0.022, 0.36, 6), handleMat));
      this.batHandle.position.set(0, -0.18, 0);
      this.batHandle.rotation.z = 0.15;
      this.rightForearm.add(this.batHandle);

      this.batBlade = shadow(new Mesh(new BoxGeometry(0.105, 0.52, 0.038), bladeMat));
      this.batBlade.position.set(0, -0.44, 0);
      this.batHandle.add(this.batBlade);

      this.batEdges = new LineSegments(
        new EdgesGeometry(new BoxGeometry(0.105, 0.52, 0.038)),
        edgeMat,
      );
      this.batEdges.position.copy(this.batBlade.position);
      this.batEdges.renderOrder = 1;
      this.batHandle.add(this.batEdges);
    }
  }

  // ── Stances ───────────────────────────────────────────────────────────────

  /** Batsman ready stance at the batting crease (z = 3). */
  setBattingStance() {
    this.rightUpperArm.rotation.set(-0.8, 0, -0.6);
    this.rightForearm.rotation.x = -0.4;
    this.leftUpperArm.rotation.set(-0.3, 0, 0.5);
    this.leftThigh.rotation.x  = 0.15;
    this.rightThigh.rotation.x = -0.1;
    this.torso.rotation.y = 0.15;
    this.group.position.set(0, 0, 3);
  }

  /** Bowler delivery-stride stance at the bowling end (z = -10). */
  setBowlingStance() {
    this.group.position.set(0, 0, -10);
    this.group.rotation.y = Math.PI;
    this.rightUpperArm.rotation.x = -2.2;
    this.leftUpperArm.rotation.set(0.5, 0, 0.3);
  }

  /**
   * Fielder ready stance at a given field position.
   * @param {number} x
   * @param {number} z
   */
  setFieldingStance(x, z) {
    this.rightUpperArm.rotation.x = -0.5;
    this.leftUpperArm.rotation.x  = -0.5;
    this.rightForearm.rotation.x  = -0.3;
    this.leftForearm.rotation.x   = -0.3;
    this.group.position.set(x, 0, z);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Recolour every team-coloured part (head, torso, arms). */
  setPrimaryColor(hexColor) {
    this.group.traverse((obj) => {
      if (obj.isMesh && obj.material?.userData?.isTeamColor) {
        obj.material.color.set(hexColor);
      }
    });
    this.teamColor = hexColor;
  }

  setName(name) {
    this.playerName = name;
  }

  getGroup() {
    return this.group;
  }
}

export default StickFigure;
