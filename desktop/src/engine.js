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
  BoxGeometry, SphereGeometry, CylinderGeometry, EdgesGeometry,
  MeshLambertMaterial, LineBasicMaterial,
  Mesh, LineSegments, Group,
  SpriteMaterial, Sprite, CanvasTexture,
  Color, Vector3, CatmullRomCurve3, MathUtils,
} from 'three';
import Stadium      from './scene/Stadium.js';
import { StickFigure }  from './characters/StickFigure.js';
import AnimationController from './characters/AnimationController.js';

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

  // Stadium (ground, pitch, stumps, crowd, sky, boards)
  #stadium = null;

  // Characters — StickFigure instances
  #bowlerFigure   = null;
  #fielderFigures = [];
  #umpireFigure   = null;
  #umpireAnim     = null;   // AnimationController for umpire signals

  // Ball mesh
  #ballMesh;

  // First-person bat HUD (parented to camera)
  #batHUD;

  // Batsman (hidden in FP view)
  #batsmanGroup;
  #batGroup;
  #rightArmGroup;
  #leftArmGroup;
  #torso;

  // Camera views
  #cameraViews = [];
  #currentView = 0;

  // Frame-to-frame delta tracking (seconds) for stadium / umpireAnim updates
  #lastNow = 0;

  // Handedness — affects dirX mirroring in #calcDirection
  #handedness = 'right';

  // Pending delivery-reset timer (cancel if new delivery starts before it fires)
  #resetTimer = null;

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
    this.#buildStadium();
    this.#buildBowlerFigure();
    this.#buildBall();
    this.#buildBatsman();
    this.#buildBatHUD();
    this.#buildFielderFigures();
    this.#buildUmpireFigure();
    this.#initCameraViews();
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
    this.#camera = new PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.04, 300);
    this.#camera.position.set(0, 1.55, 4.5);
    this.#camera.lookAt(0, 0.85, -12);
    this.#scene.add(this.#camera);
  }

  #initCameraViews() {
    this.#cameraViews = [
      { name: 'Batsman POV',  pos: [0, 1.55, 4.5],    look: [0, 0.85, -12], batHUD: true  },
      { name: 'Side On',      pos: [-20, 4, 2],        look: [0, 1.0,   2],  batHUD: false },
      { name: 'Behind',       pos: [0, 5, 11],         look: [0, 1.0,  -8],  batHUD: false },
      { name: 'Broadcast',    pos: [14, 10, 22],       look: [0, 2,     0],  batHUD: false },
    ];
  }

  /** Cycle to next camera view. Returns the view name. */
  cycleView() {
    this.#currentView = (this.#currentView + 1) % this.#cameraViews.length;
    const v = this.#cameraViews[this.#currentView];
    this.#camera.position.set(...v.pos);
    this.#camera.lookAt(...v.look);
    this.#batHUD.visible = v.batHUD;
    return v.name;
  }

  // ── Scene construction ────────────────────────────────────────────────────

  #buildStadium() {
    this.#stadium = new Stadium(this.#scene, this.#renderer);
  }

  #buildBowlerFigure() {
    this.#bowlerFigure = new StickFigure({
      role:        'bowler',
      teamColor:   '#2244AA',
      helmetColor: '#112266',
    });
    this.#bowlerFigure.setBowlingStance();
    this.#bowlerFigure.group.position.z = BOWLER_START_Z;
    this.#scene.add(this.#bowlerFigure.group);
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
   * First-person bat HUD — curved blade with ridge, aligned toward stumps.
   * Parented to camera so it stays in view regardless of camera shake.
   */
  #buildBatHUD() {
    const gripMat   = new MeshLambertMaterial({ color: 0x1a1a1a, depthTest: false });
    const tapeMat   = new MeshLambertMaterial({ color: 0x5a3e2b, depthTest: false });
    const handleMat = new MeshLambertMaterial({ color: 0x9B5523, depthTest: false });
    const bladeMat  = new MeshLambertMaterial({ color: 0xD4A96A, depthTest: false });
    const ridgeMat  = new MeshLambertMaterial({ color: 0xB8904A, depthTest: false });
    const edgeMat   = new LineBasicMaterial  ({ color: 0x7A5030, depthTest: false });

    this.#batHUD = new Group();
    this.#batHUD.renderOrder = 999;
    const RO = 999;

    // Rubber grip
    const grip = new Mesh(new CylinderGeometry(0.032, 0.030, 0.28, 10), gripMat);
    grip.renderOrder = RO;
    this.#batHUD.add(grip);

    // Grip tape rings — give it texture
    for (let i = 0; i < 4; i++) {
      const tape = new Mesh(new CylinderGeometry(0.034, 0.034, 0.022, 10), tapeMat);
      tape.position.y = -0.02 - i * 0.07;
      tape.renderOrder = RO;
      this.#batHUD.add(tape);
    }

    // Wooden handle — tapers slightly toward blade shoulder
    const handle = new Mesh(new CylinderGeometry(0.022, 0.028, 0.40, 10), handleMat);
    handle.position.y = -0.38;
    handle.renderOrder = RO;
    this.#batHUD.add(handle);

    // ── Blade in 3 curved sections ──────────────────────────────────────────
    // Shoulder (narrows toward handle, slight backward lean)
    const shoulder = new Mesh(new BoxGeometry(0.142, 0.24, 0.046), bladeMat);
    shoulder.position.set(0, -0.72, -0.004);
    shoulder.rotation.x =  0.035;
    shoulder.renderOrder = RO;
    this.#batHUD.add(shoulder);

    // Swell (widest, thickest — the bow of the bat)
    const swell = new Mesh(new BoxGeometry(0.155, 0.32, 0.058), bladeMat);
    swell.position.set(0, -0.99, 0.004);
    swell.renderOrder = RO;
    this.#batHUD.add(swell);

    // Toe (tapers toward bottom, slight forward lean)
    const toe = new Mesh(new BoxGeometry(0.142, 0.22, 0.044), bladeMat);
    toe.position.set(0, -1.24, -0.003);
    toe.rotation.x = -0.030;
    toe.renderOrder = RO;
    this.#batHUD.add(toe);

    // Spine ridge on back face — defines the bow
    const ridge = new Mesh(new BoxGeometry(0.058, 0.66, 0.020), ridgeMat);
    ridge.position.set(0, -0.99, 0.044);
    ridge.renderOrder = RO;
    this.#batHUD.add(ridge);

    // Edge outlines around full blade extent
    const bladeEdges = new LineSegments(
      new EdgesGeometry(new BoxGeometry(0.155, 0.78, 0.058)),
      edgeMat,
    );
    bladeEdges.position.set(0, -0.99, 0);
    bladeEdges.renderOrder = 1000;
    this.#batHUD.add(bladeEdges);

    // Guard position — bat angled forward toward stumps, right of screen
    // rotation.x forward-lean shows the blade face; rotation.z gives grip angle
    this.#batHUD.position.set(0.40, -0.30, -1.80);
    this.#batHUD.rotation.set(0.20, 0.02, -0.14);
    this.#batHUD.scale.setScalar(0.75);

    this.#camera.add(this.#batHUD);
  }

  #buildFielderFigures() {
    for (const fp of FIELDER_POSITIONS) {
      const fig = new StickFigure({ role: 'fielder', teamColor: '#2244AA' });
      fig.setFieldingStance(fp.x, fp.z);
      this.#scene.add(fig.group);
      this.#fielderFigures.push(fig);
    }
  }

  #buildUmpireFigure() {
    this.#umpireFigure = new StickFigure({ role: 'umpire' });
    this.#umpireFigure.group.position.set(-3.5, 0, 1.5);
    this.#umpireFigure.group.rotation.y = Math.PI * 0.5;
    this.#scene.add(this.#umpireFigure.group);
    this.#umpireAnim = new AnimationController(this.#umpireFigure);
  }

  /**
   * Briefly animate the umpire's signal arm then return to rest.
   * @param {'six'|'four'|'out'|'wide'|'noball'} signal
   */
  signalUmpire(signal) {
    if (!this.#umpireAnim) return;
    switch (signal) {
      case 'out':    this.#umpireAnim.animateUmpireOut();    break;
      case 'wide':   this.#umpireAnim.animateUmpireWide();   break;
      case 'noball': this.#umpireAnim.animateUmpireNoBall(); break;
      case 'six':    this.#umpireAnim.animateUmpireOut();    break;  // arm raised high
      case 'four':   this.#umpireAnim.animateUmpireWide();   break;  // arm extended sideways
    }
  }

  // ── Delivery ──────────────────────────────────────────────────────────────

  /** @param {'right'|'left'} hand */
  setHandedness(hand) {
    this.#handedness = hand;
  }

  deliveryStart(type = 'pace', lineOffset = 0) {
    // Force-resolve any in-flight shot — prevents state getting stuck when the
    // next-delivery timer fires before the shot animation finishes.
    if (this.#state === 'SHOT_PLAYING') {
      this.#ballMesh.visible = false;
      this.#state = 'IDLE';
    }
    clearTimeout(this.#resetTimer);
    if (this.#state !== 'IDLE') return;

    this.#pendingType       = type;
    this.#pendingLineOffset = lineOffset;
    this.#swingDetected     = false;
    this.#swingActive       = false;
    this.#hitWindow.open    = false;
    clearTimeout(this.#windowTimer);

    const bg = this.#bowlerFigure.group;
    bg.position.set(lineOffset * 0.5, 0, BOWLER_START_Z);
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
    // Cap at 1400 ms so the next delivery timer (2000 ms) always fires after reset
    this.#shotDurationMs = Math.min(1400, Math.max(400, 700 + distance * 28 - power * 2));
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

    // Timing → lateral direction: early = leg side, late = off side (for RH batsman)
    let dirX = MathUtils.clamp(timingOffset / TIMING_LATE, -1, 1);

    // Phone gamma fine-tunes: tilt right = off side for RH
    const gammaAdj = MathUtils.clamp((gamma ?? 0) / 40, -0.4, 0.4);
    dirX = MathUtils.clamp(dirX + gammaAdj * 0.25, -1, 1);

    // Left-handers: mirror lateral axis (their off-side is world-negative X)
    if (this.#handedness === 'left') dirX = -dirX;

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
    const rx0 = 0.20, ry0 = 0.02, rz0 = -0.14;
    const px0 = 0.40, py0 = -0.30, pz0 = -1.80;

    switch (shotType) {

      case 'DRIVE': {
        // Straight bat: lift back over shoulder → drive down the pitch → high follow-through
        const b1 = 120*s, b2 = 60*s, b3 = 180*s, ret = 380;
        const p2 = b1, p3 = b1+b2, p4 = b1+b2+b3;
        // Wind-up: bat lifts to shoulder height, face opens slightly
        tm.to(R,'x',-0.70,b1,0).to(R,'y', 0.08,b1,0).to(R,'z',-0.05,b1,0);
        tm.to(P,'x', 0.55,b1,0).to(P,'y', 0.05,b1,0).to(P,'z',-1.55,b1,0);
        // Contact: drive through the line, bat face meets ball
        tm.to(R,'x', 1.60,b2,p2).to(R,'z',-0.28,b2,p2).to(R,'y', 0.00,b2,p2);
        tm.to(P,'x', 0.32,b2,p2).to(P,'z',-2.10,b2,p2).to(P,'y',-0.45,b2,p2);
        // Follow-through: bat sweeps high and around
        tm.to(R,'x', 2.80,b3,p3).to(R,'y',-0.20,b3,p3).to(R,'z',-0.20,b3,p3);
        tm.to(P,'y',-0.10,b3,p3).to(P,'x', 0.22,b3,p3).to(P,'z',-1.90,b3,p3);
        tm.to(R,'x',rx0,ret,p4).to(R,'y',ry0,ret,p4).to(R,'z',rz0,ret,p4);
        tm.to(P,'x',px0,ret,p4).to(P,'y',py0,ret,p4).to(P,'z',pz0,ret,p4);
        break;
      }

      case 'SWEEP':
      case 'REVERSE SWEEP': {
        // Bat goes horizontal: drop low, sweep around the body
        const sign = shotType === 'REVERSE SWEEP' ? -1 : 1;
        const b1 = 110*s, b2 = 85*s, b3 = 190*s, ret = 380;
        const p2 = b1, p3 = b1+b2, p4 = b1+b2+b3;
        // Drop bat to knee height
        tm.to(P,'y',-0.72,b1,0).to(R,'x', 1.55,b1,0).to(R,'z', sign*0.30,b1,0);
        tm.to(P,'x', px0+sign*0.15,b1,0);
        // Sweep through horizontal
        tm.to(R,'x', 1.57,b2,p2).to(R,'y', sign*1.80,b2,p2).to(R,'z', sign*0.10,b2,p2);
        tm.to(P,'x', px0-sign*0.20,b2,p2).to(P,'y',-0.55,b2,p2);
        // Follow-through
        tm.to(R,'y', sign*2.50,b3,p3).to(P,'y',py0+0.10,b3,p3);
        tm.to(R,'x',rx0,ret,p4).to(R,'y',ry0,ret,p4).to(R,'z',rz0,ret,p4);
        tm.to(P,'x',px0,ret,p4).to(P,'y',py0,ret,p4).to(P,'z',pz0,ret,p4);
        break;
      }

      case 'HOOK': {
        // Short ball rising — bat comes up and sweeps across to leg side
        const b1 = 85*s, b2 = 68*s, b3 = 170*s, ret = 380;
        const p2 = b1, p3 = b1+b2, p4 = b1+b2+b3;
        // Bat rises high (face to leg side)
        tm.to(R,'x', 2.40,b1,0).to(R,'y', 0.30,b1,0).to(P,'y', 0.10,b1,0);
        tm.to(P,'x', 0.30,b1,0).to(P,'z',-1.65,b1,0);
        // Horizontal hit to leg
        tm.to(R,'x', 1.70,b2,p2).to(R,'y',-1.30,b2,p2).to(R,'z',-0.30,b2,p2);
        tm.to(P,'x', 0.18,b2,p2);
        // Follow-through wraps around
        tm.to(R,'x', 0.90,b3,p3).to(R,'y',-2.00,b3,p3);
        tm.to(R,'x',rx0,ret,p4).to(R,'y',ry0,ret,p4).to(R,'z',rz0,ret,p4);
        tm.to(P,'x',px0,ret,p4).to(P,'y',py0,ret,p4).to(P,'z',pz0,ret,p4);
        break;
      }

      case 'PULL': {
        // Short ball — horizontal pull to leg side at waist height
        const b1 = 95*s, b2 = 72*s, b3 = 175*s, ret = 380;
        const p2 = b1, p3 = b1+b2, p4 = b1+b2+b3;
        tm.to(R,'x', 1.90,b1,0).to(R,'y', 0.15,b1,0).to(P,'y',-0.18,b1,0);
        tm.to(P,'x', 0.55,b1,0).to(P,'z',-1.62,b1,0);
        // Pull through — bat horizontal, hit to leg
        tm.to(R,'x', 0.85,b2,p2).to(R,'y',-0.90,b2,p2).to(R,'z',-0.22,b2,p2);
        tm.to(P,'x', 0.25,b2,p2).to(P,'z',-1.95,b2,p2);
        // Wrap around body
        tm.to(R,'x', 0.40,b3,p3).to(R,'y',-1.60,b3,p3);
        tm.to(R,'x',rx0,ret,p4).to(R,'y',ry0,ret,p4).to(R,'z',rz0,ret,p4);
        tm.to(P,'x',px0,ret,p4).to(P,'y',py0,ret,p4).to(P,'z',pz0,ret,p4);
        break;
      }

      case 'CUT': {
        // Short wide ball — horizontal cut to off side
        const b1 = 95*s, b2 = 80*s, b3 = 185*s, ret = 380;
        const p2 = b1, p3 = b1+b2, p4 = b1+b2+b3;
        // Lift and open to off side
        tm.to(R,'x', 1.20,b1,0).to(R,'y', 0.65,b1,0).to(P,'x', 0.72,b1,0);
        tm.to(P,'z',-1.60,b1,0).to(P,'y',-0.22,b1,0);
        // Cut through — bat horizontal, hit to off
        tm.to(R,'x',-0.30,b2,p2).to(R,'y',-0.70,b2,p2).to(R,'z', 0.25,b2,p2);
        tm.to(P,'x', 0.28,b2,p2).to(P,'z',-2.05,b2,p2);
        // Follow-through
        tm.to(R,'x',-0.75,b3,p3).to(R,'y',-0.38,b3,p3);
        tm.to(R,'x',rx0,ret,p4).to(R,'y',ry0,ret,p4).to(R,'z',rz0,ret,p4);
        tm.to(P,'x',px0,ret,p4).to(P,'y',py0,ret,p4).to(P,'z',pz0,ret,p4);
        break;
      }

      case 'DEFENSIVE':
      default: {
        // Straight bat, minimal movement — block the ball
        const b1 = 140*s, b2 = 130*s, ret = 420;
        const p2 = b1, p3 = b1+b2;
        tm.to(R,'x', 0.55,b1,0).to(R,'z',-0.10,b1,0).to(R,'y', 0.04,b1,0);
        tm.to(P,'z',-2.05,b1,0).to(P,'y',-0.38,b1,0);
        tm.to(R,'x', 0.32,b2,p2).to(R,'z', rz0,b2,p2);
        tm.to(P,'z',pz0,b2,p2).to(P,'y',py0,b2,p2);
        tm.to(R,'x',rx0,ret,p3).to(R,'y',ry0,ret,p3).to(R,'z',rz0,ret,p3);
        break;
      }
    }
  }

  // ── Bat angle mirror ──────────────────────────────────────────────────────

  updateBatAngle(rBeta, rGamma) {
    if (this.#tweens.busy) return;
    const DEG = MathUtils.DEG2RAD;
    this.#batHUD.rotation.x = 0.20 + MathUtils.clamp(rBeta  * DEG * 0.7, -Math.PI / 3, Math.PI / 3);
    this.#batHUD.rotation.z = -0.14 + MathUtils.clamp(rGamma * DEG * 0.5, -Math.PI / 4, Math.PI / 4);
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
    const delta = this.#lastNow > 0 ? (now - this.#lastNow) / 1000 : 0.016;
    this.#lastNow = now;

    this.#tweens.tick(now);
    this.#stepShake();
    this.#stadium?.update(delta);
    this.#umpireAnim?.update(delta);

    switch (this.#state) {
      case 'BOWLER_RUNNING': this.#stepBowler(now); break;
      case 'BALL_TRAVELING': this.#stepBall(now);   break;
      case 'SHOT_PLAYING':   this.#stepShot(now);   break;
    }
  }

  #stepShake() {
    if (this.#shakeFrames <= 0) return;
    const m = this.#shakeMag;
    this.#batHUD.position.x = 0.40 + (Math.random() - 0.5) * m * 1.2;
    this.#batHUD.position.y = -0.30 + (Math.random() - 0.5) * m * 0.9;
    this.#shakeMag    *= 0.78;
    this.#shakeFrames -= 1;
    if (this.#shakeFrames === 0) {
      this.#batHUD.position.set(0.40, -0.30, -1.80);
    }
  }

  #stepBowler(now) {
    const t  = Math.min((now - this.#bowlerStartMs) / BOWLER_RUN_MS, 1);
    const g  = this.#bowlerFigure.group;
    const f  = this.#bowlerFigure;
    g.position.z = BOWLER_START_Z + (BOWLER_END_Z - BOWLER_START_Z) * t;
    g.position.y = Math.abs(Math.sin(t * Math.PI * 10)) * 0.12;

    // Procedural run-up limb animation
    const phase = t * Math.PI * 16;
    f.leftThigh.rotation.x   =  Math.sin(phase) * 0.55;
    f.rightThigh.rotation.x  = -Math.sin(phase) * 0.55;
    f.leftShin.rotation.x    =  Math.max(0, Math.sin(phase + 0.5)) * 0.35;
    f.rightShin.rotation.x   =  Math.max(0, Math.sin(phase + 0.5 + Math.PI)) * 0.35;
    f.leftUpperArm.rotation.x  = -Math.sin(phase) * 0.45;
    // Right arm sweeps up into delivery position near the end
    f.rightUpperArm.rotation.x = t < 0.80
      ? Math.sin(phase) * 0.45
      : -2.2 * ((t - 0.80) / 0.20);

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
          this.#stadium?.stumpsExplode('batting');
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
    clearTimeout(this.#resetTimer);
    this.#resetTimer = setTimeout(() => {
      this.#ballMesh.visible = false;
      this.#bowlerFigure.setBowlingStance();
      this.#bowlerFigure.group.position.z = BOWLER_START_Z;
    }, 300);
  }
}
