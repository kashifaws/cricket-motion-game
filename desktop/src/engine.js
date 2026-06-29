/**
 * engine.js — Three.js cricket game engine.
 *
 * Coordinate system
 *   Y = up
 *   Z = along pitch: negative → bowler's end, positive → batsman's end
 *   X = across pitch: positive = off side (from batsman's view)
 *
 * Scene layout (approximate metres → Three.js units 1:1)
 *   Pitch strip   : 3 × 20, centred at origin
 *   Bowling crease: Z = -3
 *   Batting crease: Z = +3
 *   Bowler run-up : Z -18 → Z -4
 *   Ball release  : Z ≈ -5.5, Y ≈ 2.0
 *   Ball arrival  : Z ≈ +3.8, Y ≈ 0.75
 *   Camera        : mid-off elevated angle (14, 12, 22) → target (0, 2, 0)
 *
 * Batsman is at (0, 0, 3), facing world -Z (toward bowler).
 * batsmanGroup.rotation.y = Math.PI so its local +Z maps to world -Z.
 */

import {
  Scene, PerspectiveCamera, WebGLRenderer,
  AmbientLight, DirectionalLight,
  PlaneGeometry, BoxGeometry, SphereGeometry, CapsuleGeometry,
  CylinderGeometry, EdgesGeometry, TorusGeometry,
  MeshLambertMaterial, LineBasicMaterial,
  Mesh, LineSegments, Group,
  SpriteMaterial, Sprite, CanvasTexture,
  Color, Vector3, CatmullRomCurve3, MathUtils,
} from 'three';

// ── Constants ─────────────────────────────────────────────────────────────────

const PITCH_WIDTH    = 3;
const PITCH_LENGTH   = 20;
const BOWLER_START_Z = -18;
const BOWLER_END_Z   = -4;
const BOWLER_RUN_MS  = 1700;
const HIT_WINDOW_MS  = 400;
const SWING_STAGE1_G = 2.5;
const SWING_STAGE2_G = 1.2;
const TIMING_EARLY   = -80;
const TIMING_LATE    =  80;
const LOFT_BETA_DEG  = -15;
const BOUNDARY_DIST  = 30;
const FIELDER_RADIUS =  3.0;

const DELIVERY = {
  pace:   { speedMs:  880 },
  spin:   { speedMs: 1380 },
  yorker: { speedMs:  680 },
};

/** Approximate T20 field positions in world (X, Z) coordinates. */
const FIELDER_POSITIONS = [
  { x:  18, z: -12 },  // mid-off
  { x: -18, z: -12 },  // mid-on
  { x:  28, z:   2 },  // cover point
  { x: -28, z:   2 },  // mid-wicket
  { x:  18, z:  18 },  // third man
  { x: -18, z:  18 },  // fine leg
  { x:   8, z: -30 },  // long off
  { x:  -8, z: -30 },  // long on
];

// ── TweenManager ──────────────────────────────────────────────────────────────

/**
 * Lightweight tween queue — no GSAP dependency.
 * `from` is captured lazily when the tween first becomes active,
 * so chained phases automatically pick up where the previous one left off.
 */
class TweenManager {
  #q = [];

  to(obj, prop, to, ms, delay = 0) {
    this.#q.push({
      obj, prop,
      from: null,
      to,
      t0: performance.now() + delay,
      ms,
    });
    return this;
  }

  tick(now) {
    this.#q = this.#q.filter(tw => {
      if (now < tw.t0) return true;
      if (tw.from === null) tw.from = tw.obj[tw.prop];
      const raw = Math.min((now - tw.t0) / tw.ms, 1);
      const t = raw < 0.5 ? 2 * raw * raw : -1 + (4 - 2 * raw) * raw;
      tw.obj[tw.prop] = tw.from + (tw.to - tw.from) * t;
      return raw < 1;
    });
  }

  killAll() { this.#q = []; }
  get busy() { return this.#q.length > 0; }
}

// ── Batsman builder ───────────────────────────────────────────────────────────

/**
 * Build a Three.js batsman from primitives.
 * Sub-group handles are attached to root.userData:
 *   batGroup, rightArmGroup, leftArmGroup, torso
 *
 * @returns {THREE.Group}
 */
export function createBatsman() {
  const root = new Group();

  const kitMat    = new MeshLambertMaterial({ color: 0xf5f5f5 });
  const skinMat   = new MeshLambertMaterial({ color: 0xFDBCB4 });
  const helmetMat = new MeshLambertMaterial({ color: 0x1a237e });
  const padMat    = new MeshLambertMaterial({ color: 0xeeeeee });
  const shoeMat   = new MeshLambertMaterial({ color: 0x263238 });
  const handleMat = new MeshLambertMaterial({ color: 0x8B4513 });
  const bladeMat  = new MeshLambertMaterial({ color: 0xDEB887 });
  const edgeMat   = new LineBasicMaterial({ color: 0x8B4513 });

  const shadow = m => { m.castShadow = true; return m; };

  // Torso
  const torso = shadow(new Mesh(new BoxGeometry(0.4, 0.6, 0.25), kitMat));
  torso.position.set(0, 1.0, 0);
  torso.rotation.x = -10 * MathUtils.DEG2RAD;
  root.add(torso);

  // Head + helmet + visor
  const headMesh = shadow(new Mesh(new SphereGeometry(0.15, 12, 8), skinMat));
  headMesh.position.set(0, 1.55, 0);
  root.add(headMesh);
  const helmetMesh = shadow(new Mesh(new CylinderGeometry(0.17, 0.17, 0.12, 14), helmetMat));
  helmetMesh.position.set(0, 1.64, 0);
  root.add(helmetMesh);
  const visor = shadow(new Mesh(new BoxGeometry(0.3, 0.05, 0.15), helmetMat));
  visor.position.set(0, 1.59, 0.12);
  root.add(visor);

  // Arms: helper creates shoulder-pivot group with upper arm + forearm
  function makeArm(sX, sY, uaRz, faX, faZ, faRz, faRx) {
    const g = new Group();
    g.position.set(sX, sY, 0);
    const ua = shadow(new Mesh(new CylinderGeometry(0.07, 0.07, 0.3, 8), kitMat));
    ua.position.set(0, -0.15, 0);
    ua.rotation.z = uaRz;
    g.add(ua);
    const fa = shadow(new Mesh(new CylinderGeometry(0.06, 0.06, 0.28, 8), kitMat));
    fa.position.set(faX, -0.42, faZ);
    fa.rotation.z = faRz;
    fa.rotation.x = faRx;
    g.add(fa);
    return g;
  }

  const leftArmGroup  = makeArm(-0.23, 1.28,  0.65,  0.12, 0.04,  0.50, 0.12);
  const rightArmGroup = makeArm( 0.23, 1.28, -0.08,  0.02, 0.05, -0.06, 0.10);
  root.add(leftArmGroup);
  root.add(rightArmGroup);

  // Pads
  const lPad = shadow(new Mesh(new BoxGeometry(0.12, 0.45, 0.10), padMat));
  lPad.position.set(-0.14, 0.47, 0.04);
  root.add(lPad);
  const rPad = shadow(new Mesh(new BoxGeometry(0.12, 0.45, 0.10), padMat));
  rPad.position.set(0.14, 0.47, -0.04);
  root.add(rPad);

  // Shoes (front foot forward in local +Z = toward bowler)
  const lShoe = shadow(new Mesh(new BoxGeometry(0.13, 0.08, 0.22), shoeMat));
  lShoe.position.set(-0.16, 0.04, 0.07);
  root.add(lShoe);
  const rShoe = shadow(new Mesh(new BoxGeometry(0.13, 0.08, 0.22), shoeMat));
  rShoe.position.set(0.16, 0.04, -0.07);
  root.add(rShoe);

  // Bat — pivot at top of handle (hand grip)
  const batGroup = new Group();
  batGroup.position.set(0.25, 0.68, 0.06);
  batGroup.rotation.z = 0.22;
  root.add(batGroup);

  const handle = shadow(new Mesh(new CylinderGeometry(0.02, 0.02, 0.4, 8), handleMat));
  handle.position.set(0, -0.20, 0);
  batGroup.add(handle);

  const blade = shadow(new Mesh(new BoxGeometry(0.10, 0.55, 0.04), bladeMat));
  blade.position.set(0, -0.675, 0);
  batGroup.add(blade);

  const bladeEdges = new LineSegments(
    new EdgesGeometry(new BoxGeometry(0.10, 0.55, 0.04)),
    edgeMat,
  );
  bladeEdges.position.copy(blade.position);
  bladeEdges.renderOrder = 1;
  batGroup.add(bladeEdges);

  root.userData.batGroup      = batGroup;
  root.userData.rightArmGroup = rightArmGroup;
  root.userData.leftArmGroup  = leftArmGroup;
  root.userData.torso         = torso;

  return root;
}

// ── GameEngine ────────────────────────────────────────────────────────────────

export class GameEngine {
  // Three.js core
  #scene;
  #camera;
  #renderer;

  // Scene meshes
  #bowlerMesh;
  #ballMesh;

  // First-person bat HUD (parented to camera)
  #batHUD;

  // Batsman (hidden in FP view, kept for stump references)
  #batsmanGroup;
  #batGroup;
  #rightArmGroup;
  #leftArmGroup;
  #torso;

  // Stump & bail animation — batting crease (z=3) only
  #battingStumps    = [];   // 3 stump Mesh objects
  #battingBails     = [];   // 2 bail Mesh objects
  #battingStumpRest = [];   // rest positions for stumps
  #battingBailRest  = [];   // rest positions for bails

  // Field
  #fielderMeshes = [];

  // Animation
  #tweens = new TweenManager();

  // Camera shake
  #shakeFrames = 0;
  #shakeMag    = 0;

  // State machine: IDLE | BOWLER_RUNNING | BALL_TRAVELING | SHOT_PLAYING
  #state = 'IDLE';

  // Bowler animation
  #bowlerStartMs = 0;

  // Ball delivery animation
  #deliveryCurve  = null;
  #ballStartMs    = 0;
  #ballDurationMs = 0;

  // Shot animation
  #shotCurve      = null;
  #shotStartMs    = 0;
  #shotDurationMs = 1200;

  // Hit window
  #hitWindow = { open: false, openAt: 0, closeAt: 0, arrivalTime: 0 };
  #windowTimer = null;

  // Legacy desktop-side swing detection (processMotionPacket path)
  #swingActive   = false;
  #swingStartMs  = 0;
  #swingPeakMag  = 0;
  #swingDetected = false;

  // Current delivery params
  #pendingType       = 'pace';
  #pendingLineOffset = 0;

  // Callback fired after each delivery is resolved (misses only in new path)
  #onShotResult = null;

  // RAF handle
  #rafId = null;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {(result: { type: string, direction: string }) => void} onShotResult
   */
  constructor(canvas, onShotResult) {
    this.#onShotResult = onShotResult;
    this.#initRenderer(canvas);
    this.#initScene();
    this.#initCamera();
    this.#initLights();
    this.#buildWorld();
    this.#buildBoundaryRope();
    this.#buildCrowdStands();
    this.#buildBowler();
    this.#buildBall();
    this.#buildBatsman();
    this.#buildBatHUD();
    this.#buildFielders();
  }

  // ── Initialistion ─────────────────────────────────────────────────────────

  #initRenderer(canvas) {
    this.#renderer = new WebGLRenderer({ canvas, antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.setSize(window.innerWidth, window.innerHeight);
    this.#renderer.shadowMap.enabled = true;

    window.addEventListener('resize', () => {
      this.#renderer.setSize(window.innerWidth, window.innerHeight);
      this.#camera.aspect = window.innerWidth / window.innerHeight;
      this.#camera.updateProjectionMatrix();
    });
  }

  #initScene() {
    this.#scene = new Scene();
    this.#scene.background = new Color(0x87ceeb);
  }

  #initCamera() {
    this.#camera = new PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.04, 300);
    // First-person: eye level at batting crease, looking down the pitch
    this.#camera.position.set(0, 1.55, 4.5);
    this.#camera.lookAt(0, 0.85, -12);
    // Must be added to scene so we can parent the bat HUD to it
    this.#scene.add(this.#camera);
  }

  #initLights() {
    this.#scene.add(new AmbientLight(0xffffff, 0.55));

    const sun = new DirectionalLight(0xfff5e0, 1.3);
    sun.position.set(12, 25, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.width  = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.left   = -45;
    sun.shadow.camera.right  =  45;
    sun.shadow.camera.top    =  45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.camera.far    =  120;
    this.#scene.add(sun);

    const fill = new DirectionalLight(0xc8e8ff, 0.35);
    fill.position.set(-10, 8, -5);
    this.#scene.add(fill);
  }

  // ── Scene construction ────────────────────────────────────────────────────

  #buildWorld() {
    const outfield = new Mesh(
      new PlaneGeometry(100, 100),
      new MeshLambertMaterial({ color: 0x2e7d2e }),
    );
    outfield.rotation.x = -Math.PI / 2;
    outfield.receiveShadow = true;
    this.#scene.add(outfield);

    const pitchStrip = new Mesh(
      new PlaneGeometry(PITCH_WIDTH, PITCH_LENGTH),
      new MeshLambertMaterial({ color: 0xc4a96a }),
    );
    pitchStrip.rotation.x = -Math.PI / 2;
    pitchStrip.position.y  = 0.005;
    pitchStrip.receiveShadow = true;
    this.#scene.add(pitchStrip);

    // Popping crease + bowling crease white lines
    this.#addCreaseLine( 3);
    this.#addCreaseLine(-3);
    // Return crease marks (short perpendicular lines at each end of popping crease)
    for (const z of [3, -3]) {
      for (const x of [-1.32, 1.32]) {
        const tick = new Mesh(
          new BoxGeometry(0.05, 0.004, 0.55),
          new MeshLambertMaterial({ color: 0xffffff }),
        );
        tick.position.set(x, 0.011, z + (z > 0 ? -0.27 : 0.27));
        this.#scene.add(tick);
      }
    }

    this.#addStumps( 3);   // batting crease — refs saved for animation
    this.#addStumps(-3);   // bowling crease

    // Crowd stands and boundary rope are added from the constructor
    // after #buildWorld(), #buildBoundaryRope(), #buildCrowdStands().
  }

  #addCreaseLine(z) {
    const line = new Mesh(
      new BoxGeometry(PITCH_WIDTH + 0.6, 0.004, 0.06),
      new MeshLambertMaterial({ color: 0xffffff }),
    );
    line.position.set(0, 0.01, z);
    this.#scene.add(line);
  }

  #addWall(x, y, z, w, h, d, colour = 0x4a7c4a) {
    const wall = new Mesh(
      new BoxGeometry(w, h, d),
      new MeshLambertMaterial({ color: colour }),
    );
    wall.position.set(x, y, z);
    wall.castShadow = wall.receiveShadow = true;
    this.#scene.add(wall);
  }

  /**
   * Three cylinder stumps + two bail boxes at crease Z.
   * If z > 0 (batting crease), refs are stored for BOWLED animation.
   */
  #addStumps(z) {
    const mat    = new MeshLambertMaterial({ color: 0xf5deb3 });
    const stumps = [];
    const bails  = [];

    for (const x of [-0.115, 0, 0.115]) {
      const stump = new Mesh(new CylinderGeometry(0.02, 0.02, 0.7, 8), mat);
      stump.position.set(x, 0.35, z);
      stump.castShadow = true;
      this.#scene.add(stump);
      stumps.push(stump);
    }
    for (const x of [-0.057, 0.057]) {
      const bail = new Mesh(new BoxGeometry(0.08, 0.02, 0.02), mat);
      bail.position.set(x, 0.72, z);
      this.#scene.add(bail);
      bails.push(bail);
    }

    if (z > 0) {
      this.#battingStumps    = stumps;
      this.#battingBails     = bails;
      this.#battingStumpRest = stumps.map(s => ({ pos: s.position.clone() }));
      this.#battingBailRest  = bails.map(b => ({ pos: b.position.clone() }));
    }
  }

  #buildBowler() {
    this.#bowlerMesh = new Mesh(
      new CapsuleGeometry(0.28, 0.88, 4, 8),
      new MeshLambertMaterial({ color: 0xf5f5f5 }),
    );
    this.#bowlerMesh.position.set(0, 1.02, BOWLER_START_Z);
    this.#bowlerMesh.castShadow = true;
    this.#scene.add(this.#bowlerMesh);

    const head = new Mesh(
      new SphereGeometry(0.22, 10, 7),
      new MeshLambertMaterial({ color: 0xd4956a }),
    );
    head.position.y = 0.88;
    head.castShadow = true;
    this.#bowlerMesh.add(head);
  }

  #buildBall() {
    this.#ballMesh = new Mesh(
      new SphereGeometry(0.115, 14, 9),
      new MeshLambertMaterial({ color: 0xc0392b }),
    );
    this.#ballMesh.castShadow = true;
    this.#ballMesh.visible    = false;
    this.#scene.add(this.#ballMesh);
  }

  #buildBatsman() {
    const group = createBatsman();
    group.position.set(0, 0, 3);
    group.rotation.y = Math.PI;
    group.visible = false;   // hidden — first-person view uses #batHUD instead
    this.#scene.add(group);

    this.#batsmanGroup  = group;
    this.#batGroup      = group.userData.batGroup;
    this.#rightArmGroup = group.userData.rightArmGroup;
    this.#leftArmGroup  = group.userData.leftArmGroup;
    this.#torso         = group.userData.torso;
  }

  /**
   * Build the first-person bat-in-hand HUD, parented to the camera so it
   * stays fixed in the bottom-right of the viewport regardless of camera shake.
   */
  #buildBatHUD() {
    const gripMat   = new MeshLambertMaterial({ color: 0x111111, depthTest: false });
    const handleMat = new MeshLambertMaterial({ color: 0x8B4513, depthTest: false });
    const bladeMat  = new MeshLambertMaterial({ color: 0xDEB887, depthTest: false });
    const edgeMat   = new LineBasicMaterial ({ color: 0x6B3410, depthTest: false });

    this.#batHUD = new Group();
    this.#batHUD.renderOrder = 999;

    // Grip wrap (top of handle)
    const grip = new Mesh(new CylinderGeometry(0.03, 0.03, 0.36, 8), gripMat);
    grip.renderOrder = 999;
    this.#batHUD.add(grip);

    // Wooden handle below grip
    const handle = new Mesh(new CylinderGeometry(0.024, 0.027, 0.38, 8), handleMat);
    handle.position.y = -0.37;
    handle.renderOrder = 999;
    this.#batHUD.add(handle);

    // Blade
    const blade = new Mesh(new BoxGeometry(0.155, 0.74, 0.055), bladeMat);
    blade.position.y = -1.01;
    blade.renderOrder = 999;
    this.#batHUD.add(blade);

    const bladeEdges = new LineSegments(
      new EdgesGeometry(new BoxGeometry(0.155, 0.74, 0.055)),
      edgeMat,
    );
    bladeEdges.position.copy(blade.position);
    bladeEdges.renderOrder = 1000;
    this.#batHUD.add(bladeEdges);

    // Position bottom-right — z=-2.0 gives enough frustum height to show
    // grip + handle + most of blade (frustum ±1.45 in Y at this depth)
    this.#batHUD.position.set(0.52, -0.44, -2.0);
    this.#batHUD.rotation.set(0.05, 0.18, -0.10);
    this.#batHUD.scale.setScalar(0.72);

    this.#camera.add(this.#batHUD);
  }

  /** Place 8 simple fielder figures at the standard T20 positions. */
  #buildFielders() {
    const bodyMat = new MeshLambertMaterial({ color: 0xf5f5f5 });
    const headMat = new MeshLambertMaterial({ color: 0xd4956a });

    for (const fp of FIELDER_POSITIONS) {
      const body = new Mesh(new CylinderGeometry(0.20, 0.20, 1.5, 6), bodyMat);
      body.position.set(fp.x, 0.75, fp.z);
      body.castShadow = true;
      this.#scene.add(body);

      const head = new Mesh(new SphereGeometry(0.17, 6, 6), headMat);
      head.position.y = 0.9;
      body.add(head);

      this.#fielderMeshes.push(body);
    }
  }

  // ── Environment: boundary rope + crowd stands ─────────────────────────────

  /** White torus rope lying flat at the boundary radius. */
  #buildBoundaryRope() {
    const rope = new Mesh(
      new TorusGeometry(BOUNDARY_DIST, 0.09, 8, 96),
      new MeshLambertMaterial({ color: 0xffffff }),
    );
    rope.rotation.x = Math.PI / 2;
    rope.position.y = 0.06;
    this.#scene.add(rope);
  }

  /**
   * Four crowd-stand blocks, one per boundary side, textured with a
   * randomised coloured-pixel crowd canvas.
   */
  #buildCrowdStands() {
    // Build a shared crowd texture — coloured pixels in tier rows
    const cvs = document.createElement('canvas');
    cvs.width = 128; cvs.height = 48;
    const c2  = cvs.getContext('2d');
    const pal = [
      '#c62828', '#283593', '#1b5e20', '#f9a825',
      '#6a1b9a', '#00695c', '#bf360c', '#e0e0e0',
    ];
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 128; x++) {
        // Horizontal tier dividers every 6 rows
        c2.fillStyle = y % 6 < 1 ? '#080808' : pal[(Math.random() * pal.length) | 0];
        c2.fillRect(x, y, 1, 1);
      }
    }
    const tex = new CanvasTexture(cvs);
    const mat = new MeshLambertMaterial({ map: tex });

    const stands = [
      { x:   0, z: -46, ry: 0,              w: 84 },
      { x:   0, z:  46, ry: Math.PI,        w: 84 },
      { x: -44, z:   0, ry:  Math.PI / 2,   w: 84 },
      { x:  44, z:   0, ry: -Math.PI / 2,   w: 84 },
    ];
    for (const s of stands) {
      const stand = new Mesh(new BoxGeometry(s.w, 14, 5), mat);
      stand.position.set(s.x, 6.5, s.z);
      stand.rotation.y = s.ry;
      this.#scene.add(stand);

      // Grassy bank in front of each stand
      const bank = new Mesh(
        new BoxGeometry(s.w, 2, 4),
        new MeshLambertMaterial({ color: 0x2a4a2a }),
      );
      bank.position.set(s.x, 1.0, s.z + (s.ry === 0 ? 4.5 : s.ry === Math.PI ? -4.5 : 0));
      if (s.ry === Math.PI / 2)  bank.position.set(s.x + 4.5, 1.0, 0);
      if (s.ry === -Math.PI / 2) bank.position.set(s.x - 4.5, 1.0, 0);
      bank.rotation.y = s.ry;
      this.#scene.add(bank);
    }
  }

  // ── Delivery ──────────────────────────────────────────────────────────────

  deliveryStart(type = 'pace', lineOffset = 0) {
    if (this.#state !== 'IDLE') return;

    this.#pendingType       = type;
    this.#pendingLineOffset = lineOffset;
    this.#swingDetected     = false;
    this.#swingActive       = false;
    this.#hitWindow.open    = false;
    clearTimeout(this.#windowTimer);

    this.#bowlerMesh.position.set(lineOffset * 0.5, 1.02, BOWLER_START_Z);
    this.#ballMesh.visible = false;

    this.#state         = 'BOWLER_RUNNING';
    this.#bowlerStartMs = performance.now();
  }

  #buildDeliveryPath(type, lo) {
    const release = new Vector3(lo, 2.0, -5.5);
    const arrival = new Vector3(0, 0.75, 3.8);

    switch (type) {
      case 'pace':
        return new CatmullRomCurve3([
          release,
          new Vector3(lo * 0.6, 2.55, -2.5),
          new Vector3(lo * 0.3, 0.12,  0.5),
          new Vector3(lo * 0.1, 1.05,  2.5),
          arrival,
        ]);
      case 'spin':
        return new CatmullRomCurve3([
          release,
          new Vector3(lo * 1.0, 3.20, -2.0),
          new Vector3(lo * 1.3, 0.12,  0.9),
          new Vector3(lo * 0.6, 1.30,  2.5),
          arrival,
        ]);
      case 'yorker':
        return new CatmullRomCurve3([
          release,
          new Vector3(lo * 0.2, 1.75, -1.8),
          new Vector3(0,        0.05,  3.1),
          new Vector3(0,        0.18,  3.5),
          new Vector3(0,        0.10,  4.1),
        ]);
    }
  }

  openHitWindow(ballArrivalTime) {
    const half = HIT_WINDOW_MS / 2;
    this.#hitWindow = {
      open:        true,
      openAt:      ballArrivalTime - half,
      closeAt:     ballArrivalTime + half,
      arrivalTime: ballArrivalTime,
    };
  }

  // ── Public: new swing / hit API ───────────────────────────────────────────

  /**
   * Check whether the swing event connects with the ball.
   *
   * If the ball is in the hit window:
   *   - Calculates direction from timing offset and phone orientation.
   *   - Calls launchBall() to animate the shot.
   *   - Returns { type, direction } for the scorecard.
   *
   * If no ball is in play (practice swing):
   *   - Returns null.  Caller can check engine.inPlay to distinguish from
   *     a swing outside the hit window.
   *
   * @param {{ timestamp: number, power: number, alpha: number, beta: number, gamma: number, shotType: string }} swingData
   * @returns {{ type: string, direction: string } | null}
   */
  evaluateHit(swingData) {
    const { timestamp, power, alpha, beta, gamma, shotType } = swingData;

    if (!this.#hitWindow.open || this.#swingDetected) return null;
    const now = performance.now();
    if (now < this.#hitWindow.openAt || now > this.#hitWindow.closeAt) return null;

    this.#swingDetected  = true;
    this.#hitWindow.open = false;
    clearTimeout(this.#windowTimer);

    const direction = this.#calcDirection(timestamp, alpha, gamma, shotType);
    const lofted    = (beta ?? 0) < LOFT_BETA_DEG;

    return this.launchBall(direction, power, shotType, lofted);
  }

  /**
   * Launch the ball along a shot-type-specific arc.
   * Safe to call directly for dev/testing (bypasses hit-window check).
   *
   * @param {{ x: number, z: number }} direction  — x: -1 (leg) to +1 (off), z: 0-1 (forward weight)
   * @param {number} power      — 0-100
   * @param {string} shotType   — e.g. 'DRIVE'
   * @param {boolean} [lofted]
   * @returns {{ type: string, direction: string } | null}
   */
  launchBall(direction, power, shotType, lofted = false) {
    if (!this.#ballMesh.visible) return null;   // no ball in flight

    // Arc height by shot type / power
    const isLoft = lofted || (power > 80 && (shotType === 'DRIVE' || shotType === 'CUT'));
    let arcMax;
    if (shotType === 'SWEEP' || shotType === 'REVERSE SWEEP') {
      arcMax = 0.10;
    } else if (shotType === 'HOOK' || shotType === 'PULL') {
      arcMax = 3.0 + power * 0.05;
    } else if (isLoft) {
      arcMax = 4.0;
    } else {
      arcMax = 0.5 + (power / 100) * 0.5;   // 0.5–1.0 for drives / cuts
    }

    // Ball speed: 5 + power * 0.15 units/s (approximately)
    const distance = 6 + (power / 100) * 44;
    const startPos = this.#ballMesh.position.clone();
    const endX  = direction.x * distance * 0.55;
    const endZ  = startPos.z + direction.z * distance;

    // Fielder interception
    const fielder = this.#findFielder(endX, endZ);
    const finalX  = fielder ? fielder.x : endX;
    const finalZ  = fielder ? fielder.z : endZ;

    const mid1 = new Vector3(
      finalX * 0.3,
      arcMax * 0.7,
      startPos.z + (finalZ - startPos.z) * 0.3,
    );
    const mid2 = new Vector3(
      finalX * 0.7,
      arcMax * 0.3,
      startPos.z + (finalZ - startPos.z) * 0.65,
    );
    const end = new Vector3(finalX, fielder ? 0.5 : 0.04, finalZ);

    this.#shotCurve      = new CatmullRomCurve3([startPos, mid1, mid2, end]);
    this.#shotStartMs    = performance.now();
    this.#shotDurationMs = Math.max(400, 700 + distance * 28 - power * 2);
    this.#state          = 'SHOT_PLAYING';

    return this.#scoreShot(finalX, finalZ, arcMax, isLoft, !!fielder, power);
  }

  // ── Private: hit helpers ──────────────────────────────────────────────────

  /**
   * Derive shot direction vector from timing offset and phone orientation.
   * @returns {{ x: number, z: number }}
   */
  #calcDirection(timestamp, alpha, gamma, shotType) {
    const timingOffset = timestamp - this.#hitWindow.arrivalTime;

    // Timing → lateral direction: early = leg side, late = off side
    let dirX = MathUtils.clamp(timingOffset / TIMING_LATE, -1, 1);

    // Phone gamma fine-tunes: tilt left = leg, tilt right = off
    const gammaAdj = MathUtils.clamp((gamma ?? 0) / 40, -0.4, 0.4);
    dirX = MathUtils.clamp(dirX + gammaAdj * 0.25, -1, 1);

    // Z (forward weight) depends on shot type
    let dirZ;
    switch (shotType) {
      case 'HOOK':
      case 'PULL':           dirZ = 0.40; break;
      case 'SWEEP':
      case 'REVERSE SWEEP':  dirZ = 0.50; break;
      case 'CUT':            dirZ = 0.55; break;
      default:               dirZ = 0.92; break; // drives strongly forward
    }

    return { x: dirX, z: dirZ };
  }

  /** Return the first fielder within FIELDER_RADIUS of the ball's projected landing. */
  #findFielder(endX, endZ) {
    for (const fp of FIELDER_POSITIONS) {
      const dx = endX - fp.x;
      const dz = endZ - fp.z;
      if (dx * dx + dz * dz < FIELDER_RADIUS * FIELDER_RADIUS) return fp;
    }
    return null;
  }

  /** Determine scoring outcome from ball landing zone and arc. */
  #scoreShot(endX, endZ, arcMax, isLoft, stoppedByFielder, power) {
    const bDist    = Math.max(Math.abs(endX), Math.abs(endZ));
    const dirLabel = endX < -1.5 ? 'leg' : endX > 1.5 ? 'off' : 'straight';

    // Boundary
    if (bDist >= BOUNDARY_DIST) {
      const type = (isLoft && arcMax > 2.0) ? 'six' : 'four';
      return { type, direction: dirLabel };
    }

    // Fielder intercept
    if (stoppedByFielder) {
      const dist = Math.sqrt(endX * endX + endZ * endZ);
      return { type: dist < 12 ? 'dot' : 'single', direction: dirLabel };
    }

    // Ball dies in outfield
    if (power < 15) return { type: 'dot',    direction: dirLabel };
    return             { type: 'single', direction: dirLabel };
  }

  // ── BOWLED: stump fly animation ───────────────────────────────────────────

  #animateBowledStumps() {
    const tm = this.#tweens;

    // Stumps: topple outward and lean to ground (0=leg, 1=middle, 2=off side)
    this.#battingStumps.forEach((s, i) => {
      const xDir = (i - 1) * 1.5;  // -1.5, 0, +1.5
      const zDir = (Math.random() - 0.5) * 0.8;
      tm.to(s.position, 'x', s.position.x + xDir * 0.55, 480, 0);
      tm.to(s.position, 'z', s.position.z + zDir,          480, 0);
      tm.to(s.position, 'y', 0.12,                          480, 0);
      tm.to(s.rotation, 'z', (i - 1) * Math.PI * 0.5 + (Math.random() - 0.5) * 0.5, 420, 0);
      tm.to(s.rotation, 'x', (Math.random() - 0.5) * 0.6,  420, 0);
    });

    // Bails: launch upward (two-phase: ascent then gravity drop)
    this.#battingBails.forEach((b, i) => {
      const xDir = (i === 0 ? -1 : 1) * (0.9 + Math.random() * 0.6);
      const zDir = (Math.random() - 0.5) * 1.8;
      const yUp  = 2.0 + Math.random() * 1.0;

      // Phase 1: upward launch (fast)
      tm.to(b.position, 'x', b.position.x + xDir * 0.6, 200, 0);
      tm.to(b.position, 'z', b.position.z + zDir * 0.4,  200, 0);
      tm.to(b.position, 'y', b.position.y + yUp,          200, 0);
      // Tumble throughout
      tm.to(b.rotation, 'z', (Math.random() - 0.5) * Math.PI * 5, 680, 0);
      tm.to(b.rotation, 'x', (Math.random() - 0.5) * Math.PI * 4, 680, 0);
      // Phase 2: gravity drop (starts exactly when phase 1 ends)
      tm.to(b.position, 'x', b.position.x + xDir * 1.4, 500, 200);
      tm.to(b.position, 'z', b.position.z + zDir,         500, 200);
      tm.to(b.position, 'y', 0.04,                         500, 200);
    });
  }

  #resetStumps() {
    this.#battingStumps.forEach((s, i) => {
      const r = this.#battingStumpRest[i];
      if (r) { s.position.copy(r.pos); s.rotation.set(0, 0, 0); }
    });
    this.#battingBails.forEach((b, i) => {
      const r = this.#battingBailRest[i];
      if (r) { b.position.copy(r.pos); b.rotation.set(0, 0, 0); }
    });
  }

  // ── Legacy swing path (processMotionPacket → onSwingReceived) ─────────────

  /** Called internally by the legacy motion-packet path. */
  onSwingReceived(swingEvent) {
    if (!this.#hitWindow.open || this.#swingDetected) return;
    const now = performance.now();
    if (now < this.#hitWindow.openAt || now > this.#hitWindow.closeAt) return;

    this.#swingDetected  = true;
    this.#hitWindow.open = false;
    this.#legacyCalculateShot(swingEvent, this.#hitWindow.arrivalTime);
  }

  #legacyCalculateShot(swingEvent, ballArrivalTime) {
    const timingOffset = swingEvent.timestamp - ballArrivalTime;

    let dir;
    if      (timingOffset < TIMING_EARLY) dir = -1;
    else if (timingOffset > TIMING_LATE)  dir =  1;
    else                                  dir = timingOffset / TIMING_LATE;

    const lofted = (swingEvent.beta ?? 0) < LOFT_BETA_DEG;
    const power  = swingEvent.power ?? 0;

    let type;
    if      (power < 8)             type = 'wicket';
    else if (lofted && power >= 72) type = 'six';
    else if (power >= 55)           type = 'four';
    else if (power >= 20)           type = 'single';
    else                            type = 'dot';

    const dirLabel = dir < -0.33 ? 'leg' : dir > 0.33 ? 'off' : 'straight';

    this.#shotCurve = this.#legacyBuildShotPath(dir, lofted, power);
    this.#shotStartMs    = performance.now();
    this.#shotDurationMs = 800 + power * 9;
    this.#state          = 'SHOT_PLAYING';

    // Notify main.js via callback (legacy path only — new path returns synchronously)
    setTimeout(() => this.#onShotResult?.({ type, direction: dirLabel }), 400);
  }

  #legacyBuildShotPath(direction, lofted, power) {
    const start    = this.#ballMesh.position.clone();
    const distance = 6 + (power / 100) * 44;
    const endX     = direction * distance * 0.55;
    const endZ     = start.z + distance * 0.85;

    if (lofted) {
      const apex = Math.min(distance * 0.30, 18);
      return new CatmullRomCurve3([
        start,
        new Vector3(endX * 0.25, apex,        start.z + distance * 0.25),
        new Vector3(endX * 0.65, apex * 0.55, start.z + distance * 0.58),
        new Vector3(endX, 0.25, endZ),
      ]);
    }
    return new CatmullRomCurve3([
      start,
      new Vector3(endX * 0.30, 0.32, start.z + distance * 0.28),
      new Vector3(endX * 0.72, 0.12, start.z + distance * 0.62),
      new Vector3(endX, 0.04, endZ),
    ]);
  }

  // ── Bat swing animation ───────────────────────────────────────────────────

  /**
   * Animate the first-person bat HUD for the given shot type.
   * Rest position: rotation (0.10, 0.22, -0.14), position (0.30, -0.58, -0.92).
   * Phase durations scale so harder shots swing faster.
   */
  animateSwing(shotType, power, alpha, beta, gamma) {
    const tm = this.#tweens;
    tm.killAll();

    this.#showSwingFeedback(power, shotType);

    if (power > 65) {
      this.#shakeFrames = 8;
      this.#shakeMag    = 0.03 + ((power - 65) / 35) * 0.06;
    }

    const R  = this.#batHUD.rotation;
    const P  = this.#batHUD.position;
    const s  = 1 - power / 200;   // 1.0 at power=0 → 0.5 at power=100

    // Rest values — must match #buildBatHUD position/rotation
    const rx0 = 0.05, ry0 = 0.18, rz0 = -0.10;
    const px0 = 0.52, py0 = -0.44, pz0 = -2.00;

    switch (shotType) {

      case 'DRIVE': {
        const b1 = 130*s, b2 = 65*s, b3 = 190*s, ret = 380;
        const p2 = b1, p3 = b1+b2, p4 = b1+b2+b3;
        tm.to(R,'x',-0.85,b1,0).to(R,'z', 0.05,b1,0).to(R,'y', 0.10,b1,0);
        tm.to(P,'x', 0.70,b1,0).to(P,'z',-1.72,b1,0);
        tm.to(R,'x', 1.90,b2,p2).to(R,'z',-0.40,b2,p2);
        tm.to(P,'x', 0.28,b2,p2).to(P,'z',-2.20,b2,p2).to(P,'y',-0.62,b2,p2);
        tm.to(R,'x', 2.90,b3,p3).to(R,'y',-0.28,b3,p3).to(R,'z',-0.25,b3,p3);
        tm.to(P,'y',-0.30,b3,p3).to(P,'x', 0.18,b3,p3);
        tm.to(R,'x',rx0,ret,p4).to(R,'y',ry0,ret,p4).to(R,'z',rz0,ret,p4);
        tm.to(P,'x',px0,ret,p4).to(P,'y',py0,ret,p4).to(P,'z',pz0,ret,p4);
        break;
      }

      case 'SWEEP':
      case 'REVERSE SWEEP': {
        const sign = shotType === 'REVERSE SWEEP' ? -1 : 1;
        const b1 = 100*s, b2 = 90*s, b3 = 200*s, ret = 380;
        const p2 = b1, p3 = b1+b2, p4 = b1+b2+b3;
        tm.to(P,'y',-0.80,b1,0).to(R,'x', 0.30,b1,0).to(R,'z', sign*0.45,b1,0);
        tm.to(R,'x', 0.12,b2,p2).to(R,'y', sign*1.75,b2,p2).to(P,'x', px0+sign*0.30,b2,p2);
        tm.to(P,'y',py0,b3,p3).to(R,'y',ry0,b3,p3);
        tm.to(R,'x',rx0,ret,p4).to(R,'z',rz0,ret,p4).to(P,'x',px0,ret,p4);
        break;
      }

      case 'HOOK': {
        const b1 = 90*s, b2 = 72*s, b3 = 180*s, ret = 380;
        const p2 = b1, p3 = b1+b2, p4 = b1+b2+b3;
        tm.to(R,'x', 2.60,b1,0).to(P,'y',-0.22,b1,0).to(P,'x', 0.28,b1,0);
        tm.to(R,'x', 1.80,b2,p2).to(R,'y',-1.45,b2,p2).to(R,'z',-0.38,b2,p2);
        tm.to(R,'x', 0.85,b3,p3).to(R,'y',-2.10,b3,p3);
        tm.to(R,'x',rx0,ret,p4).to(R,'y',ry0,ret,p4).to(R,'z',rz0,ret,p4);
        tm.to(P,'x',px0,ret,p4).to(P,'y',py0,ret,p4);
        break;
      }

      case 'PULL': {
        const b1 = 100*s, b2 = 78*s, b3 = 185*s, ret = 380;
        const p2 = b1, p3 = b1+b2, p4 = b1+b2+b3;
        tm.to(R,'x', 2.10,b1,0).to(P,'y',-0.24,b1,0);
        tm.to(R,'x', 0.78,b2,p2).to(R,'y',-1.05,b2,p2).to(R,'z',-0.28,b2,p2);
        tm.to(R,'x', 0.35,b3,p3).to(R,'y',-1.70,b3,p3);
        tm.to(R,'x',rx0,ret,p4).to(R,'y',ry0,ret,p4).to(R,'z',rz0,ret,p4);
        tm.to(P,'y',py0,ret,p4);
        break;
      }

      case 'CUT': {
        const b1 = 100*s, b2 = 85*s, b3 = 195*s, ret = 380;
        const p2 = b1, p3 = b1+b2, p4 = b1+b2+b3;
        tm.to(R,'x', 1.40,b1,0).to(R,'y', 0.58,b1,0).to(P,'x', 0.80,b1,0);
        tm.to(R,'x',-0.45,b2,p2).to(R,'y',-0.82,b2,p2).to(R,'z', 0.32,b2,p2);
        tm.to(P,'x', 0.22,b2,p2);
        tm.to(R,'x',-0.90,b3,p3).to(R,'y',-0.48,b3,p3);
        tm.to(R,'x',rx0,ret,p4).to(R,'y',ry0,ret,p4).to(R,'z',rz0,ret,p4);
        tm.to(P,'x',px0,ret,p4);
        break;
      }

      case 'DEFENSIVE':
      default: {
        const b1 = 155*s, b2 = 145*s, ret = 400;
        const p2 = b1, p3 = b1+b2;
        tm.to(R,'x', 0.75,b1,0).to(R,'z',-0.02,b1,0);
        tm.to(P,'z',-2.18,b1,0);
        tm.to(R,'x', 0.28,b2,p2).to(R,'z',-0.06,b2,p2);
        tm.to(P,'z',pz0,b2,p2);
        tm.to(R,'x',rx0,ret,p3).to(R,'z',rz0,ret,p3);
        break;
      }
    }
  }

  // ── Bat angle mirror ──────────────────────────────────────────────────────

  updateBatAngle(rBeta, rGamma) {
    if (this.#tweens.busy) return;
    const DEG = MathUtils.DEG2RAD;
    this.#batHUD.rotation.x = 0.05 + MathUtils.clamp(rBeta  * DEG * 0.7, -Math.PI / 3, Math.PI / 3);
    this.#batHUD.rotation.z = -0.10 + MathUtils.clamp(rGamma * DEG * 0.5, -Math.PI / 4, Math.PI / 4);
  }

  // ── Power popup sprite ────────────────────────────────────────────────────

  #showSwingFeedback(power, shotType) {
    const cvs = document.createElement('canvas');
    cvs.width = 320; cvs.height = 144;
    const ctx = cvs.getContext('2d');

    const color = power >= 71 ? '#ff5252' : power >= 41 ? '#ffab40' : '#69f0ae';
    ctx.font = 'bold 52px Arial, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(shotType, 160, 62);

    ctx.font = 'bold 38px Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`POWER: ${power}`, 160, 112);

    const tex = new CanvasTexture(cvs);
    const mat = new SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new Sprite(mat);

    // Above mid-pitch — visible from first-person camera at z=4.5 looking toward z=-12
    sprite.position.set(0, 3.8, -1);
    const sc = 1.4 + (power / 100) * 1.4;
    sprite.scale.set(sc * 3.0, sc * 1.3, 1);
    this.#scene.add(sprite);

    const t0 = performance.now();
    const fade = () => {
      const t = (performance.now() - t0) / 1500;
      if (t >= 1) { this.#scene.remove(sprite); tex.dispose(); mat.dispose(); return; }
      mat.opacity       = 1 - t;
      sprite.position.y = 3.4 + t * 1.8;
      requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  /** True while a ball is in flight or the shot animation is playing. */
  get inPlay() {
    return this.#state === 'BALL_TRAVELING' || this.#state === 'SHOT_PLAYING';
  }

  // ── Dev helpers ───────────────────────────────────────────────────────────

  simulateSwing(power = 55, beta = -5) {
    if (this.#state !== 'BALL_TRAVELING' || this.#swingDetected) return;
    this.#swingDetected  = true;
    this.#hitWindow.open = false;
    clearTimeout(this.#windowTimer);
    const t = performance.now();
    this.#legacyCalculateShot({ power, beta, timestamp: t, durationMs: 140 }, t);
    this.animateSwing('DRIVE', power, 0, beta, 0);
  }

  // ── Legacy motion packet input ────────────────────────────────────────────

  processMotionPacket(buffer) {
    if (buffer.byteLength < 36) return;
    const p    = new Float32Array(buffer);
    const ax   = p[0], ay = p[1], az = p[2];
    const beta = p[7];

    if (!this.#hitWindow.open && this.#state !== 'BALL_TRAVELING') return;

    const mag = Math.sqrt(ax * ax + ay * ay + az * az);
    const now = performance.now();

    if (!this.#swingActive && mag > SWING_STAGE1_G) {
      this.#swingActive  = true;
      this.#swingStartMs = now;
      this.#swingPeakMag = mag;
    } else if (this.#swingActive) {
      if (mag > this.#swingPeakMag) this.#swingPeakMag = mag;
      if (mag < SWING_STAGE2_G) {
        this.#swingActive = false;
        const power = Math.min(100, Math.round((this.#swingPeakMag / 6) * 100));
        this.onSwingReceived({ power, beta, timestamp: now, durationMs: now - this.#swingStartMs });
        this.#swingPeakMag = 0;
      }
    }
  }

  // ── Game loop ─────────────────────────────────────────────────────────────

  start() {
    const tick = (now) => {
      this.#rafId = requestAnimationFrame(tick);
      this.#update(now);
      this.#renderer.render(this.#scene, this.#camera);
    };
    this.#rafId = requestAnimationFrame(tick);
  }

  stop() {
    if (this.#rafId !== null) cancelAnimationFrame(this.#rafId);
    this.#rafId = null;
  }

  #update(now) {
    this.#tweens.tick(now);
    this.#stepShake();

    switch (this.#state) {
      case 'BOWLER_RUNNING': this.#stepBowler(now); break;
      case 'BALL_TRAVELING': this.#stepBall(now);   break;
      case 'SHOT_PLAYING':   this.#stepShot(now);   break;
    }
  }

  #stepShake() {
    if (this.#shakeFrames <= 0) return;
    const m = this.#shakeMag;
    this.#batHUD.position.x = 0.52 + (Math.random() - 0.5) * m * 1.2;
    this.#batHUD.position.y = -0.44 + (Math.random() - 0.5) * m * 0.9;
    this.#shakeMag    *= 0.78;
    this.#shakeFrames -= 1;
    if (this.#shakeFrames === 0) {
      this.#batHUD.position.set(0.52, -0.44, -2.0);
    }
  }

  #stepBowler(now) {
    const t = Math.min((now - this.#bowlerStartMs) / BOWLER_RUN_MS, 1);
    this.#bowlerMesh.position.z = BOWLER_START_Z + (BOWLER_END_Z - BOWLER_START_Z) * t;
    this.#bowlerMesh.position.y = 1.02 + Math.abs(Math.sin(t * Math.PI * 10)) * 0.12;
    if (t >= 1) this.#releaseBall();
  }

  #releaseBall() {
    const type = this.#pendingType;
    const lo   = this.#pendingLineOffset * 0.4;

    this.#deliveryCurve  = this.#buildDeliveryPath(type, lo);
    this.#ballDurationMs = DELIVERY[type].speedMs;
    this.#ballStartMs    = performance.now();

    this.#ballMesh.position.copy(this.#deliveryCurve.getPoint(0));
    this.#ballMesh.visible = true;
    this.#state = 'BALL_TRAVELING';

    const windowDelay = this.#ballDurationMs * 0.75;
    const arrivalTime = this.#ballStartMs + this.#ballDurationMs;
    clearTimeout(this.#windowTimer);
    this.#windowTimer = setTimeout(() => this.openHitWindow(arrivalTime), windowDelay);
  }

  #stepBall(now) {
    const t = Math.min((now - this.#ballStartMs) / this.#ballDurationMs, 1);
    this.#ballMesh.position.copy(this.#deliveryCurve.getPoint(t));
    this.#ballMesh.rotation.x += 0.18;

    if (t >= 1) {
      this.#hitWindow.open = false;
      if (!this.#swingDetected) {
        const onLine = Math.abs(this.#pendingLineOffset) < 0.5;
        if (onLine) {
          // Ball hit the stumps — fly animation, then notify
          this.#animateBowledStumps();
          this.#onShotResult?.({ type: 'wicket', direction: 'straight' });
        } else {
          this.#onShotResult?.({ type: 'dot', direction: 'straight' });
        }
      }
      this.#resetDelivery();
    }
  }

  #stepShot(now) {
    const t = Math.min((now - this.#shotStartMs) / this.#shotDurationMs, 1);
    this.#ballMesh.position.copy(this.#shotCurve.getPoint(t));
    if (t >= 1) this.#resetDelivery();
  }

  #resetDelivery() {
    this.#state          = 'IDLE';
    this.#swingActive    = false;
    this.#swingDetected  = false;
    this.#hitWindow.open = false;
    clearTimeout(this.#windowTimer);
    setTimeout(() => {
      this.#ballMesh.visible = false;
      this.#bowlerMesh.position.set(0, 1.02, BOWLER_START_Z);
      this.#resetStumps();
    }, 300);
  }
}
