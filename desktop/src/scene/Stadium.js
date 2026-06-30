/**
 * Stadium.js — Full 3D cricket stadium, Stick Cricket flat-shaded aesthetic.
 *
 * Bright, colourful, MeshLambertMaterial throughout — no shadows, no PBR.
 * Coordinate conventions match engine.js:
 *   Y = up, Z along pitch (−Z = bowling end), X across (off side = +X).
 */

import {
  HemisphereLight, DirectionalLight,
  CircleGeometry, RingGeometry, BoxGeometry, SphereGeometry, CylinderGeometry,
  ShapeGeometry, Shape,
  MeshLambertMaterial, MeshBasicMaterial,
  Mesh, Group, InstancedMesh, Object3D,
  Color, CanvasTexture,
  BackSide,
} from 'three';

// ── Module-level easing helpers ────────────────────────────────────────────
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn  = t => t * t * t;

const CROWD_PALETTE = [0xCC2200, 0xffffff, 0xEF9F27, 0x1D9E75, 0x378ADD, 0xD4537E, 0x7F77DD];

// ── Stadium ────────────────────────────────────────────────────────────────

export class Stadium {
  // Private tween queue for stumps explode + reset
  #tweens    = [];
  #clouds    = [];
  // 'batting' | 'bowling' → { group, stumpMeshes, bailMeshes, restPos[], restRot[] }
  #stumpData = new Map();

  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} _renderer — accepted for API symmetry; not used
   */
  constructor(scene, _renderer) {
    this.scene = scene;

    // ── Lights (no shadows anywhere in stadium) ───────────────────────────
    scene.add(new HemisphereLight(0x87CEEB, 0x2d7a2d, 0.8));
    const sun = new DirectionalLight(0xfff8e7, 1.2);
    sun.position.set(10, 20, 5);
    scene.add(sun);

    // ── Build order matters: ground → sky → markings → crowd ─────────────
    this.buildGround();
    this.buildSky();
    this.buildPitchSurrounds();
    this.buildPitch();
    this.#buildCreases();
    this.buildStumps( 3.0);
    this.buildStumps(-3.0);
    this.buildPitchMarkings();
    this.buildStands();
    this.buildAdBoards();
    this.buildScoreboard();
  }

  // ── Ground ────────────────────────────────────────────────────────────────

  buildGround() {
    // Outer slab covers ground under stands (r=55 fills to stand edges at r≈47)
    const outer = new Mesh(
      new CircleGeometry(55, 64),
      new MeshLambertMaterial({ color: 0x1e6b1e }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.01;
    this.scene.add(outer);

    // Brighter inner oval (playing surface visible to camera)
    const outfield = new Mesh(
      new CircleGeometry(28, 64),
      new MeshLambertMaterial({ color: 0x2d8a2d }),
    );
    outfield.rotation.x = -Math.PI / 2;
    this.scene.add(outfield);

    // White boundary rope ring
    const rope = new Mesh(
      new RingGeometry(27.5, 28.2, 64),
      new MeshLambertMaterial({ color: 0xffffff }),
    );
    rope.rotation.x = -Math.PI / 2;
    rope.position.y = 0.005;
    this.scene.add(rope);
  }

  // ── Pitch strip ───────────────────────────────────────────────────────────

  buildPitch() {
    const pitch = new Mesh(
      new BoxGeometry(3.05, 0.02, 20),
      new MeshLambertMaterial({ color: 0xC4A35A }),
    );
    pitch.position.y = 0.01;
    this.scene.add(pitch);
  }

  // White crease lines — all as thin BoxGeometry planes.
  #buildCreases() {
    const mat = new MeshLambertMaterial({ color: 0xffffff });
    const Y   = 0.022;

    const line = (w, d, x, z) => {
      const m = new Mesh(new BoxGeometry(w, 0.015, d), mat);
      m.position.set(x, Y, z);
      this.scene.add(m);
    };

    // Main creases
    line(3.6, 0.055, 0,      3.0);   // batting crease
    line(3.6, 0.055, 0,     -3.0);   // bowling crease
    line(3.6, 0.040, 0,      2.8);   // popping crease (batting end)
    line(3.6, 0.040, 0,     -2.8);   // popping crease (bowling end)

    // Return creases — short perpendicular stubs at each outer edge
    for (const z of [3.0, -3.0]) {
      const inner = z > 0 ? -0.28 : 0.28;
      for (const x of [-1.52, 1.52]) {
        line(0.04, 0.60, x, z + inner);
      }
    }
  }

  // ── Stumps — called twice (batting z=3, bowling z=−3) ─────────────────────

  /**
   * @param {number} zPosition  3.0 or −3.0
   */
  buildStumps(zPosition) {
    const mat   = new MeshLambertMaterial({ color: 0xF5F5DC });
    const group = new Group();
    group.position.set(0, 0, zPosition);

    const stumpMeshes = [];
    for (const x of [-0.115, 0, 0.115]) {
      const s = new Mesh(new CylinderGeometry(0.025, 0.025, 0.72, 6), mat);
      s.position.set(x, 0.36, 0);    // bottom at y=0, top at y=0.72
      group.add(s);
      stumpMeshes.push(s);
    }

    const bailMeshes = [];
    for (const x of [-0.055, 0.055]) {
      const b = new Mesh(new CylinderGeometry(0.012, 0.012, 0.135, 6), mat);
      b.rotation.z = Math.PI / 2;    // lay horizontal across stumps
      b.position.set(x, 0.73, 0);
      group.add(b);
      bailMeshes.push(b);
    }

    this.scene.add(group);

    const end = zPosition > 0 ? 'batting' : 'bowling';
    this.#stumpData.set(end, {
      group,
      stumpMeshes,
      bailMeshes,
      stumpRestPos: stumpMeshes.map(m => m.position.clone()),
      stumpRestRot: stumpMeshes.map(m => m.rotation.clone()),
      bailRestPos:  bailMeshes.map(b => b.position.clone()),
      bailRestRot:  bailMeshes.map(b => b.rotation.clone()),
    });
  }

  // ── Pitch surrounds — darker inner oval ────────────────────────────────────

  buildPitchSurrounds() {
    const shape = new Shape();
    shape.absellipse(0, 0, 15, 12, 0, Math.PI * 2, false, 0);
    const oval = new Mesh(
      new ShapeGeometry(shape, 48),
      new MeshLambertMaterial({ color: 0x259425 }),
    );
    oval.rotation.x = -Math.PI / 2;
    oval.position.y = 0.005;
    this.scene.add(oval);
  }

  // ── Pitch markings ────────────────────────────────────────────────────────

  buildPitchMarkings() {
    const Y    = 0.022;
    const edge = new MeshLambertMaterial({ color: 0xB89050 });
    const seam = new MeshLambertMaterial({ color: 0xCC3300 });

    const strip = (mat, w, d, x, z) => {
      const m = new Mesh(new BoxGeometry(w, 0.008, d), mat);
      m.position.set(x, Y, z);
      this.scene.add(m);
    };

    // Pitch perimeter outline
    strip(edge, 0.05, 20.10, -1.525, 0);   // left edge
    strip(edge, 0.05, 20.10,  1.525, 0);   // right edge
    strip(edge, 3.05, 0.05,   0,    -10);  // far end
    strip(edge, 3.05, 0.05,   0,     10);  // near end

    // Seam line — thin red strip along centre
    strip(seam, 0.03, 18, 0, 0);

    // End circles (landing zones at each crease)
    for (const z of [3.0, -3.0]) {
      const shape = new Shape();
      shape.absellipse(0, 0, 0.60, 0.18, 0, Math.PI * 2);
      const ring = new Mesh(
        new ShapeGeometry(shape, 24),
        new MeshLambertMaterial({ color: 0xD4AA60 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(0, Y + 0.001, z);
      this.scene.add(ring);
    }
  }

  // ── Stands + crowd ────────────────────────────────────────────────────────

  buildStands() {
    const wallMat = new MeshLambertMaterial({ color: 0xCC2200 });
    const roofMat = new MeshLambertMaterial({ color: 0x222222 });

    // 4 stand blocks — position, roof offset toward pitch, stand width
    const stands = [
      { wx:  0,  wz: -47, rx:  0,   rz: -41, ry:   0,             w: 68 },  // North
      { wx:  0,  wz:  47, rx:  0,   rz:  41, ry:   Math.PI,       w: 68 },  // South
      { wx:  47, wz:  0,  rx:  41,  rz:   0, ry:  -Math.PI / 2,   w: 60 },  // East
      { wx: -47, wz:  0,  rx: -41,  rz:   0, ry:   Math.PI / 2,   w: 60 },  // West
    ];

    for (const s of stands) {
      const wall = new Mesh(new BoxGeometry(s.w, 16, 4), wallMat);
      wall.position.set(s.wx, 8, s.wz);
      wall.rotation.y = s.ry;
      this.scene.add(wall);

      const roof = new Mesh(new BoxGeometry(s.w, 0.6, 12), roofMat);
      roof.position.set(s.rx, 16.4, s.rz);
      roof.rotation.y = s.ry;
      this.scene.add(roof);
    }

    // ── Crowd — one InstancedMesh (1500 heads total) ──────────────────────
    const crowdGeo  = new SphereGeometry(0.15, 4, 3);
    const crowdMat  = new MeshLambertMaterial();
    const crowd     = new InstancedMesh(crowdGeo, crowdMat, 1500);
    const dummy     = new Object3D();
    const col       = new Color();
    let   idx       = 0;

    // 4 arc sections × 8 rows × ~47 seats ≈ 1504 (close enough to 1500)
    const sections = [
      [-Math.PI * 0.2,  Math.PI * 0.2],   // East  (off side)
      [ Math.PI * 0.3,  Math.PI * 0.7],   // South (behind batting end)
      [ Math.PI * 0.8,  Math.PI * 1.2],   // West  (leg side)
      [-Math.PI * 0.7, -Math.PI * 0.3],   // North (behind bowling end)
    ];

    this.#createCrowdSections(sections, crowd, dummy, col, idx);
    this.scene.add(crowd);
  }

  /**
   * Distribute crowd instances across arc sections.
   * x = r·cos(angle), z = r·sin(angle)  (matches Three.js coordinate system)
   */
  #createCrowdSections(sections, crowd, dummy, col, startIdx) {
    const ROWS         = 8;
    const SEATS_PER_ROW = 47;
    let idx = startIdx;

    for (const [startA, endA] of sections) {
      for (let row = 0; row < ROWS; row++) {
        const r = 30 + row * 2.2;        // radius grows outward
        const y =  0.8 + row * 1.3;      // height grows per row
        for (let s = 0; s < SEATS_PER_ROW && idx < 1500; s++) {
          const a = startA + (s / (SEATS_PER_ROW - 1)) * (endA - startA);
          dummy.position.set(r * Math.cos(a), y, r * Math.sin(a));
          dummy.updateMatrix();
          crowd.setMatrixAt(idx, dummy.matrix);
          col.setHex(CROWD_PALETTE[Math.floor(Math.random() * CROWD_PALETTE.length)]);
          crowd.setColorAt(idx, col);
          idx++;
        }
      }
    }

    crowd.instanceMatrix.needsUpdate = true;
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  }

  // ── Sky ───────────────────────────────────────────────────────────────────

  buildSky() {
    // Two-hemisphere gradient: upper darker blue, lower lighter sky
    this.scene.add(new Mesh(
      new SphereGeometry(190, 16, 8, 0, Math.PI * 2, 0,          Math.PI / 2),
      new MeshBasicMaterial({ color: 0x5BA3D9, side: BackSide }),
    ));
    this.scene.add(new Mesh(
      new SphereGeometry(190, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new MeshBasicMaterial({ color: 0x87CEEB, side: BackSide }),
    ));

    // Clouds — flat white ellipsoids, drift in update()
    const cloudMat  = new MeshLambertMaterial({ color: 0xffffff });
    const cloudSpots = [
      [-20, 26,  10], [ 15, 28, -25], [ 30, 24,  20], [-35, 25, -15],
      [  5, 30, -40], [-10, 27,  35], [ 40, 26,   5], [-45, 28, -30],
    ];
    for (const [cx, cy, cz] of cloudSpots) {
      const cloud = new Mesh(new SphereGeometry(3, 7, 4), cloudMat);
      cloud.scale.set(2.5, 0.4, 1.5);
      cloud.position.set(cx, cy, cz);
      this.scene.add(cloud);
      this.#clouds.push(cloud);
    }
  }

  // ── Advertising boards ────────────────────────────────────────────────────

  buildAdBoards() {
    const configs = [
      { bg: '#CC2200', fg: '#ffffff' },
      { bg: '#ffffff', fg: '#000000' },
      { bg: '#0033AA', fg: '#ffffff' },
    ];
    const r = 26.5;

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const cfg   = configs[i % configs.length];

      const cvs = document.createElement('canvas');
      cvs.width  = 256;
      cvs.height =  96;
      const ctx  = cvs.getContext('2d');

      ctx.fillStyle = cfg.bg;
      ctx.fillRect(0, 0, 256, 96);

      ctx.fillStyle    = cfg.fg;
      ctx.font         = 'bold 26px Arial, sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CRICKET GAME', 128, 48);

      const mat   = new MeshLambertMaterial({ map: new CanvasTexture(cvs) });
      const board = new Mesh(new BoxGeometry(3.5, 1.2, 0.1), mat);
      board.position.set(r * Math.cos(angle), 0.6, r * Math.sin(angle));
      board.rotation.y = -angle + Math.PI;   // face inward toward pitch
      this.scene.add(board);
    }
  }

  // ── Scoreboard ────────────────────────────────────────────────────────────

  buildScoreboard() {
    const frameMat = new MeshLambertMaterial({ color: 0xCC2200 });
    const panelMat = new MeshLambertMaterial({ color: 0x111111 });

    // Red outer frame
    const frame = new Mesh(new BoxGeometry(8.6, 5.6, 0.35), frameMat);
    frame.position.set(0, 5.8, -42);
    this.scene.add(frame);

    // Black display face
    const panel = new Mesh(new BoxGeometry(8.0, 5.0, 0.1), panelMat);
    panel.position.set(0, 5.8, -41.85);
    this.scene.add(panel);

    // Support columns
    for (const x of [-3.8, 3.8]) {
      const col = new Mesh(new BoxGeometry(0.5, 5.0, 0.5), frameMat);
      col.position.set(x, 2.5, -42);
      this.scene.add(col);
    }
  }

  // ── Stumps explode animation ──────────────────────────────────────────────

  /**
   * Blow the stumps at the given end outward, then smoothly reset after 2 s.
   * @param {'batting'|'bowling'} end
   */
  stumpsExplode(end) {
    const data = this.#stumpData.get(end);
    if (!data) return;

    const { stumpMeshes, bailMeshes, stumpRestPos, stumpRestRot, bailRestPos } = data;

    // Remove any queued stump tweens so we don't fight a previous call
    this.#tweens = this.#tweens.filter(tw => !tw.stump);

    const push = (target, prop, from, to, duration, delay, ease) => {
      this.#tweens.push({ target, prop, from, to, elapsed: 0, delay, duration, ease, stump: true });
    };

    // ── Explode (300ms) ────────────────────────────────────────────────────
    stumpMeshes.forEach((m, i) => {
      const xDir = (i - 1) * 1.2 + (Math.random() - 0.5) * 0.4;
      const zDir = (Math.random() - 0.5) * 0.6;
      push(m.position, 'x', m.position.x, m.position.x + xDir * 0.55, 300, 0, easeOut);
      push(m.position, 'z', m.position.z, m.position.z + zDir,         300, 0, easeOut);
      push(m.position, 'y', m.position.y, 0.08,                        300, 0, easeOut);
      push(m.rotation, 'z', m.rotation.z, (i - 1) * Math.PI * 0.45 + (Math.random() - 0.5) * 0.4, 300, 0, easeOut);
      push(m.rotation, 'x', m.rotation.x, (Math.random() - 0.5) * 0.5, 300, 0, easeOut);
    });

    bailMeshes.forEach((b, i) => {
      const sign = i === 0 ? -1 : 1;
      const xDir = sign * (0.8 + Math.random() * 0.5);
      const yUp  = 1.4 + Math.random() * 0.7;
      const fromY = b.position.y;

      // Phase 1: bail launches up (200ms)
      push(b.position, 'x', b.position.x, b.position.x + xDir * 0.5, 200, 0,   easeIn);
      push(b.position, 'y', fromY,         fromY + yUp,                200, 0,   easeOut);
      push(b.rotation, 'x', b.rotation.x,  b.rotation.x + Math.PI * (3 + Math.random() * 2), 500, 0, easeOut);
      // Phase 2: bail falls back down (400ms, starts after phase 1)
      push(b.position, 'y', fromY + yUp,   0.08,                       400, 200, easeIn);
    });

    // ── Reset (after 2 s hold) ─────────────────────────────────────────────
    const RESET_DELAY = 2000;

    stumpMeshes.forEach((m, i) => {
      const rp = stumpRestPos[i];
      const rr = stumpRestRot[i];
      push(m.position, 'x', null, rp.x, 280, RESET_DELAY, easeOut);
      push(m.position, 'y', null, rp.y, 280, RESET_DELAY, easeOut);
      push(m.position, 'z', null, rp.z, 280, RESET_DELAY, easeOut);
      push(m.rotation, 'x', null, rr.x, 280, RESET_DELAY, easeOut);
      push(m.rotation, 'z', null, rr.z, 280, RESET_DELAY, easeOut);
    });

    bailMeshes.forEach((b, i) => {
      const rp = bailRestPos[i];
      push(b.position, 'x', null, rp.x, 280, RESET_DELAY, easeOut);
      push(b.position, 'y', null, rp.y, 280, RESET_DELAY, easeOut);
      push(b.rotation, 'x', null, 0,    280, RESET_DELAY, easeOut);
    });
  }

  // ── Per-frame update ──────────────────────────────────────────────────────

  /**
   * Call once per frame from the game loop.
   * @param {number} delta — seconds since last frame
   */
  update(delta) {
    // Cloud drift — wrap around when too far
    for (const cloud of this.#clouds) {
      cloud.position.x += 0.002;
      if (cloud.position.x > 50) cloud.position.x = -50;
    }

    // Advance tween queue
    const ms = delta * 1000;
    this.#tweens = this.#tweens.filter(tw => {
      tw.elapsed += ms;
      const active = tw.elapsed - tw.delay;
      if (active <= 0) return true;                             // still waiting

      if (tw.from === null || tw.from === undefined) {          // lazy-capture
        tw.from = tw.target[tw.prop];
      }

      const t = Math.min(active / tw.duration, 1);
      tw.target[tw.prop] = tw.from + (tw.to - tw.from) * tw.ease(t);
      return t < 1;
    });
  }
}

// Named export of stumpsExplode as a standalone wrapper for callers that
// only have a stadium reference and want direct function access.
export function stumpsExplode(stadium, end) {
  stadium.stumpsExplode(end);
}

export default Stadium;
