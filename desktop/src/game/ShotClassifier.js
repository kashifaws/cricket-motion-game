/**
 * ShotClassifier.js — Exact shot detection from the Engineering Specification.
 *
 * Convention: phone front = bat face, phone long axis = bat length.
 * All angles are RELATIVE to the calibration baseline (captured in the
 * player's natural stance). Right-handed default; left-handed players have
 * every direction angle mirrored via handSign.
 */

import { MathUtils } from 'three';

export class ShotClassifier {
  constructor(isRightHanded = true) {
    this.isRightHanded = isRightHanded;
    this.handSign = isRightHanded ? 1 : -1;
  }

  setHandedness(isRightHanded) {
    this.isRightHanded = isRightHanded;
    this.handSign = isRightHanded ? 1 : -1;
  }

  // ─── MAIN CLASSIFIER ───────────────────────────────────────────
  // Input: snapshot of sensor data at peak acceleration moment.
  // Returns: { shot, direction, launchAngle, power, confidence }
  classify(swingData) {
    const {
      alpha,    // yaw  — which direction bat swings (relative to calibration)
      beta,     // pitch — bat angle vertical/horizontal
      gamma,    // roll  — bat face open/closed
      peakMag,  // G-force peak
      power,    // 0–100 normalized
    } = swingData;

    // Mirror all direction angles for left-handed players
    const a = (alpha ?? 0) * this.handSign;
    const b = beta ?? 0;
    const g = (gamma ?? 0) * this.handSign;
    const mag = peakMag ?? 0;

    // ─── GATE 1: Is this a real swing? ─────────────────────────
    if (mag < 1.5) {
      return this.result('none', 0, 0, power, 0.0);
    }

    // ─── GATE 2: Defensive block ────────────────────────────────
    // Low velocity, forward tilt, dead straight
    if (mag < 2.0 && Math.abs(a) < 10 && b > 8 && b < 22) {
      return this.result('defensive', 0, -5, power, 0.9);
    }

    // ─── GATE 3: Scoop / Ramp / Dilscoop ───────────────────────
    // Bat tilted backward (negative beta), aimed behind (alpha ~180)
    if (b < -35 && Math.abs(Math.abs(a) - 180) < 20) {
      return this.result('scoop', a, 55, power, 0.88);
    }

    // ─── GATE 4: Reverse Sweep ──────────────────────────────────
    // Bat face fully inverted via gamma
    if (g < -85) {
      const direction = this.isRightHanded ? -130 : 130;  // backward point
      return this.result('reverse_sweep', direction, 5, power, 0.85);
    }

    // ─── GATE 5: Helicopter Shot ────────────────────────────────
    // High power, mid-on direction, extremely high rotationRate (wrist snap)
    const rotMag = swingData.rotMag || 0;  // total gyro magnitude
    if (rotMag > 8 && a > 25 && a < 65 && b > 60 && mag > 5.5) {
      return this.result('helicopter', a, 35, power, 0.82);
    }

    // ─── GATE 6: Hook Shot ──────────────────────────────────────
    // High alpha (leg side behind square), high beta (horizontal bat, above shoulder)
    if (a > 88 && a <= 140 && b > 72 && b <= 90) {
      const launch = 30 + (power * 0.2);
      return this.result('hook', a, launch, power, 0.90);
    }

    // ─── GATE 7: Pull Shot ──────────────────────────────────────
    // Mid-wicket to square leg, horizontal bat, waist height
    if (a > 43 && a <= 92 && b > 70 && b <= 92) {
      const launch = 12 + (power * 0.15);
      return this.result('pull', a, launch, power, 0.88);
    }

    // ─── GATE 8: Slog Sweep ─────────────────────────────────────
    // High G-force sweep, lofted toward mid-wicket boundary
    if (a > 58 && a <= 92 && b > 88 && mag > 5.8) {
      return this.result('slog_sweep', a, 38, power, 0.86);
    }

    // ─── GATE 9: Sweep Shot (grounded) ──────────────────────────
    if (a > 58 && a <= 92 && b > 88) {
      return this.result('sweep', a, 2, power, 0.87);
    }

    // ─── GATE 10: Square Cut ────────────────────────────────────
    // Hard off-side, perpendicular to pitch
    if (a < -72 && a >= -108 && b > 60) {
      return this.result('square_cut', a, -5, power, 0.88);
    }

    // ─── GATE 11: Late Cut ──────────────────────────────────────
    // Behind square on off-side, delicate wrist flick
    if (a < -118 && a >= -152 && b <= 70) {
      return this.result('late_cut', a, 8, power, 0.80);
    }

    // ─── GATE 12: Upper Cut ─────────────────────────────────────
    if (a < -108 && a >= -142 && b > 70) {
      return this.result('upper_cut', a, 22, power, 0.78);
    }

    // ─── GATE 13: Cover Drive ───────────────────────────────────
    if (a < -33 && a >= -57 && b < 25) {
      return this.result('cover_drive', a, 3, power, 0.91);
    }

    // ─── GATE 14: Off Drive ─────────────────────────────────────
    if (a < -13 && a >= -32 && b < 25) {
      return this.result('off_drive', a, 2, power, 0.89);
    }

    // ─── GATE 15: On Drive ──────────────────────────────────────
    if (a > 13 && a <= 37 && b < 25) {
      return this.result('on_drive', a, 4, power, 0.88);
    }

    // ─── GATE 16: Straight Drive (default vertical swing) ───────
    if (Math.abs(a) <= 13 && b < 30) {
      const launch = power > 70 ? 18 : 2;  // loft if big hit
      return this.result('straight_drive', a, launch, power, 0.85);
    }

    // ─── FALLBACK ───────────────────────────────────────────────
    return this.result('straight_drive', a, 0, power, 0.50);
  }

  result(shot, direction, launchAngle, power, confidence) {
    return { shot, direction, launchAngle, power, confidence };
  }

  /**
   * Convert a shot result to a ball trajectory vector for Three.js.
   * World frame: -Z = toward bowler, +X = off side (right-handed batsman).
   * direction 0° = straight, positive = leg side, negative = off side.
   */
  shotToTrajectory(shotResult) {
    const { shot, direction, launchAngle, power } = shotResult;
    const speed = 8 + ((power ?? 0) / 100) * 22;  // 8–30 m/s range

    const dirRad    = MathUtils.degToRad(direction);
    const launchRad = MathUtils.degToRad(launchAngle);

    return {
      vx: Math.sin(dirRad) * Math.cos(launchRad) * speed,
      vy: Math.sin(launchRad) * speed,
      vz: -Math.cos(dirRad) * Math.cos(launchRad) * speed,
      speed,
      shot,
    };
  }

  /** Display name for HUD. */
  shotDisplayName(shot) {
    const names = {
      defensive:      'DEFENSIVE',
      straight_drive: 'STRAIGHT DRIVE',
      cover_drive:    'COVER DRIVE',
      off_drive:      'OFF DRIVE',
      on_drive:       'ON DRIVE',
      square_cut:     'SQUARE CUT',
      late_cut:       'LATE CUT',
      upper_cut:      'UPPER CUT',
      pull:           'PULL SHOT',
      hook:           'HOOK SHOT',
      sweep:          'SWEEP',
      slog_sweep:     'SLOG SWEEP',
      scoop:          'SCOOP',
      reverse_sweep:  'REVERSE SWEEP',
      helicopter:     'HELICOPTER',
      none:           '',
    };
    return names[shot] ?? shot.toUpperCase().replace(/_/g, ' ');
  }
}

export default ShotClassifier;
