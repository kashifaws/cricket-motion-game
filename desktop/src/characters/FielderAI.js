/**
 * FielderAI.js — Smart fielder response: nearest fielder chases the ball,
 * dives if close, throws back otherwise. Also repositions the field between
 * overs via named presets.
 *
 * Each fielder entry: { figure: StickFigure, position: {x, z}, name }
 */

export class FielderAI {
  /** @param {Array<{figure: object, position: {x:number,z:number}, name?: string}>} fielderFigures */
  constructor(fielderFigures) {
    this.fielders = fielderFigures;
    this.fieldPreset = 'standard';
  }

  /**
   * After a shot, find the nearest fielder to the ball's landing point and
   * animate the chase. Calls onFielded(true) if the ball is cut off,
   * onFielded(false) if it beats the field.
   */
  respondToShot(trajectory, ballLandingX, ballLandingZ, onFielded) {
    const nearest = this.findNearest(ballLandingX, ballLandingZ);
    if (!nearest) { onFielded?.(false); return; }

    const dist = Math.sqrt(
      (nearest.position.x - ballLandingX) ** 2 +
      (nearest.position.z - ballLandingZ) ** 2,
    );

    const reachable = dist < 12;  // within 12m of landing

    if (reachable) {
      const travelTime = Math.max(250, dist * 200);  // ms proportional to distance
      this.animateFielderMove(nearest, ballLandingX, ballLandingZ, travelTime, () => {
        if (dist < 3) {
          this.animateDive(nearest, () => onFielded?.(true));
        } else {
          this.animateThrow(nearest, () => onFielded?.(true));
        }
      });
    } else {
      // Ball beats the field — boundary
      onFielded?.(false);
    }
  }

  findNearest(x, z) {
    let nearest = null;
    let minDist = Infinity;
    this.fielders.forEach((f) => {
      const d = Math.sqrt((f.position.x - x) ** 2 + (f.position.z - z) ** 2);
      if (d < minDist) { minDist = d; nearest = f; }
    });
    return nearest;
  }

  animateFielderMove(fielder, targetX, targetZ, duration, onArrive) {
    const g = fielder.figure.group;
    const startX = g.position.x;
    const startZ = g.position.z;
    const start = performance.now();

    let legPhase = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      g.position.x = startX + (targetX - startX) * ease;
      g.position.z = startZ + (targetZ - startZ) * ease;

      // Face movement direction
      const angle = Math.atan2(targetX - startX, targetZ - startZ);
      g.rotation.y = angle;

      // Leg oscillation while running
      legPhase += 0.15;
      if (fielder.figure.leftThigh) {
        fielder.figure.leftThigh.rotation.x  = Math.sin(legPhase) * 0.5;
        fielder.figure.rightThigh.rotation.x = Math.sin(legPhase + Math.PI) * 0.5;
      }

      if (t < 1) requestAnimationFrame(tick);
      else {
        if (fielder.figure.leftThigh) {
          fielder.figure.leftThigh.rotation.x = 0;
          fielder.figure.rightThigh.rotation.x = 0;
        }
        fielder.position = { x: targetX, z: targetZ };
        onArrive?.();
      }
    };
    requestAnimationFrame(tick);
  }

  animateDive(fielder, onComplete) {
    const fig = fielder.figure;
    const start = performance.now();
    const duration = 500;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // Body rotates to horizontal (dive)
      fig.group.rotation.z = t < 0.5
        ? t * 2 * Math.PI * 0.5     // fall sideways
        : Math.PI * 0.5;            // hold horizontal
      fig.group.position.y = t < 0.5 ? 0 : (t - 0.5) * 2 * (-0.3);  // drop to ground
      if (t < 1) requestAnimationFrame(tick);
      else {
        setTimeout(() => {
          fig.group.rotation.z = 0;
          fig.group.position.y = 0;
          onComplete?.();
        }, 600);
      }
    };
    requestAnimationFrame(tick);
  }

  animateThrow(fielder, onComplete) {
    const arm = fielder.figure.rightUpperArm;
    if (!arm) { onComplete?.(); return; }

    const t1 = performance.now();
    const windUp = (now) => {
      const t = Math.min(1, (now - t1) / 300);
      arm.rotation.x = -Math.PI * 0.8 * t;  // wind up back
      if (t < 1) requestAnimationFrame(windUp);
      else {
        const t2 = performance.now();
        const release = (now2) => {
          const t3 = Math.min(1, (now2 - t2) / 200);
          arm.rotation.x = -Math.PI * 0.8 + Math.PI * 1.2 * t3;  // throw forward
          if (t3 < 1) requestAnimationFrame(release);
          else { arm.rotation.x = 0; onComplete?.(); }
        };
        requestAnimationFrame(release);
      }
    };
    requestAnimationFrame(windUp);
  }

  /** Change field positions between overs or based on game situation. */
  setFieldPreset(preset, _teams) {
    const presets = {
      standard: [
        { x: 0,    z: 5.5  },  // WK
        { x: 1.5,  z: 5.8  },  // 1st slip
        { x: 2.8,  z: 6.0  },  // 2nd slip
        { x: 4.5,  z: 4.0  },  // gully
        { x: 10,   z: 0    },  // point
        { x: 9,    z: -6   },  // cover
        { x: 5,    z: -11  },  // mid-off
        { x: -5,   z: -11  },  // mid-on
        { x: -10,  z: 0    },  // square leg
        { x: -5,   z: 6    },  // fine leg
      ],
      aggressive: [
        { x: 0,   z: 5.5 },
        { x: 1.5, z: 5.8 }, { x: 2.8, z: 6.0 }, { x: 4.0, z: 6.2 },  // 3 slips
        { x: 5.5, z: 4.5 },   // gully
        { x: 1.5, z: 2.5 },   // silly point
        { x: -1.5, z: 2.5 },  // silly mid-on
        { x: 8,   z: -4  },   // cover
        { x: 5,   z: -11 },   // mid-off
        { x: -10, z: 0   },   // square leg
      ],
      defensive: [
        { x: 0,    z: 5.5 },
        { x: 12,   z: 0   }, { x: 11,  z: -8  }, { x: 0,  z: -20 },
        { x: -11,  z: -8  }, { x: -12, z: 0   }, { x: -8, z: 12  },
        { x: 8,    z: 12  }, { x: 4,   z: -15 }, { x: -4, z: -15 },
      ],
    };

    this.fieldPreset = presets[preset] ? preset : 'standard';
    const positions = presets[this.fieldPreset];
    positions.forEach((pos, i) => {
      if (this.fielders[i]) {
        this.animateFielderMove(this.fielders[i], pos.x, pos.z, 1500, () => {});
      }
    });
  }
}

export default FielderAI;
