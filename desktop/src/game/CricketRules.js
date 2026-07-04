/**
 * CricketRules.js — Full match rules engine (Laws of Cricket, simplified).
 *
 * Tracks two innings, per-batsman stats, extras, overs, free hits, target
 * chasing and the final match result. Pure state machine — no rendering.
 */

export class CricketRules {
  constructor(config = {}) {
    this.format = config.format || 'T20';   // 'T20' | 'ODI' | 'TEST'
    this.totalOvers = config.overs || 20;
    this.playersPerSide = 11;

    // Innings state
    this.innings = [
      this.createInningsState(),  // Team A bats
      this.createInningsState(),  // Team B bats
    ];
    this.currentInnings = 0;
    this.target = null;            // set after 1st innings
    this.matchResult = null;       // null until match over

    // Over rules
    this.maxOversPerBowler = Math.max(1, Math.floor(this.totalOvers / 5));
    this.powerplayOvers = this.format === 'T20' ? 6 : 10;

    // Free hit — true while the NEXT delivery is a free hit
    this.freeHitNext = false;

    // Teams
    this.teams = config.teams || ['ALL STARS', 'WORLD XI'];
    this.currentBattingTeam = 0;
  }

  createInningsState() {
    return {
      runs: 0,
      wickets: 0,
      overs: 0,
      balls: 0,          // balls in current over (0–5)
      extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
      batsmen: [
        { index: 0, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, how: null },
        { index: 1, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, how: null },
      ],
      allBatsmen: [],     // completed + current batting cards, in order
      striker: 0,         // index into batsmen array (0 or 1)
      nextBatsmanIndex: 2,
      bowlers: [],
      currentBowlerIndex: 0,
      overHistory: [],    // array of completed overs (ball-by-ball)
      thisOver: [],       // current over ball results
    };
  }

  // ─── PROCESS A DELIVERY ────────────────────────────────────────
  /**
   * @param {{ runs?: number, extra?: string, howOut?: string|null,
   *           isWide?: boolean, isNoBall?: boolean }} deliveryResult
   * @returns {{ events: Array<object>, state: object }}
   */
  processDelivery(deliveryResult) {
    const inn = this.innings[this.currentInnings];
    const events = [];

    if (this.matchResult) {
      return { events, state: this.getState() };
    }

    // Whether THIS delivery is a free hit (previous ball was a no-ball)
    const isFreeHitDelivery = this.freeHitNext;

    // ── No Ball ────────────────────────────────────────────────
    if (deliveryResult.isNoBall) {
      inn.extras.noBalls++;
      inn.runs++;
      events.push({ type: 'no_ball' });
      // No-ball: does NOT count as a ball faced; free hit follows.
    }

    // ── Wide ───────────────────────────────────────────────────
    if (deliveryResult.isWide) {
      inn.extras.wides++;
      inn.runs++;
      events.push({ type: 'wide' });
      this.#checkTargetChased(inn, events);
      // Wide does NOT count as a ball faced — free hit carries over.
      return { events, state: this.getState() };
    }

    // ── Legal delivery — count ball ────────────────────────────
    let overCompleted = false;
    if (!deliveryResult.isNoBall) {
      inn.balls++;
      inn.batsmen[inn.striker].balls++;
      if (inn.balls >= 6) overCompleted = true;
    }

    // ── Runs ───────────────────────────────────────────────────
    const runs = deliveryResult.runs || 0;
    inn.runs += runs;
    inn.batsmen[inn.striker].runs += runs;
    if (runs === 4) { inn.batsmen[inn.striker].fours++; events.push({ type: 'four' }); }
    if (runs === 6) { inn.batsmen[inn.striker].sixes++; events.push({ type: 'six' }); }

    // Odd runs = swap striker
    if (runs % 2 !== 0) {
      inn.striker = inn.striker === 0 ? 1 : 0;
      events.push({ type: 'ran_between_wickets', runs });
    }

    inn.thisOver.push({
      runs,
      extra: deliveryResult.extra || (deliveryResult.isNoBall ? 'nb' : null),
      out: !!deliveryResult.howOut,
    });

    // ── Wicket ─────────────────────────────────────────────────
    const dismissalBlocked =
      (deliveryResult.isNoBall || isFreeHitDelivery) &&
      ['bowled', 'lbw', 'caught', 'stumped'].includes(deliveryResult.howOut);

    if (deliveryResult.howOut && !dismissalBlocked) {
      inn.wickets++;
      const outBatsman = inn.batsmen[inn.striker];
      outBatsman.out = true;
      outBatsman.how = deliveryResult.howOut;
      inn.allBatsmen.push(outBatsman);
      events.push({ type: 'wicket', how: deliveryResult.howOut, player: outBatsman });

      if (inn.wickets >= 10) {
        events.push({ type: 'all_out' });
        this.#closeInnings(events);
        return { events, state: this.getState() };
      }

      // New batsman comes in
      const newIndex = inn.nextBatsmanIndex++;
      inn.batsmen[inn.striker] = {
        index: newIndex, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, how: null,
      };
      events.push({ type: 'new_batsman', playerIndex: newIndex });
    }

    // ── Target chased? ─────────────────────────────────────────
    if (this.#checkTargetChased(inn, events)) {
      return { events, state: this.getState() };
    }

    // ── End of over ────────────────────────────────────────────
    if (overCompleted) {
      inn.balls = 0;
      inn.overs++;
      inn.overHistory.push([...inn.thisOver]);
      inn.thisOver = [];
      events.push({ type: 'end_of_over', overNumber: inn.overs });

      // Swap striker/non-striker + rotate bowler
      inn.striker = inn.striker === 0 ? 1 : 0;
      events.push({ type: 'change_ends' });
      events.push({ type: 'new_bowler' });
    }

    // ── Over limit reached? ────────────────────────────────────
    if (inn.overs >= this.totalOvers) {
      events.push({ type: 'innings_over' });
      this.#closeInnings(events);
      return { events, state: this.getState() };
    }

    // Free hit for the NEXT ball only after a no-ball
    this.freeHitNext = !!deliveryResult.isNoBall;

    return { events, state: this.getState() };
  }

  /** @returns {boolean} true if the match just ended on a successful chase */
  #checkTargetChased(inn, events) {
    if (this.target !== null && this.currentInnings === 1 && inn.runs >= this.target && !this.matchResult) {
      this.matchResult = {
        winner: this.teams[this.currentBattingTeam],
        how: 'chased',
        margin: 10 - inn.wickets,
      };
      events.push({ type: 'match_won', result: this.matchResult });
      events.push({ type: 'match_over', result: this.matchResult });
      return true;
    }
    return false;
  }

  #closeInnings(events) {
    this.freeHitNext = false;
    if (this.currentInnings === 0) {
      this.target = this.innings[0].runs + 1;
      this.currentInnings = 1;
      this.currentBattingTeam = this.currentBattingTeam === 0 ? 1 : 0;
      events.push({ type: 'innings_break', target: this.target });
    } else {
      const [inn1, inn2] = this.innings;
      const firstTeam  = this.currentBattingTeam === 0 ? 1 : 0;
      if (inn2.runs > inn1.runs) {
        this.matchResult = { winner: this.teams[this.currentBattingTeam], how: 'chased', margin: 10 - inn2.wickets };
      } else if (inn1.runs > inn2.runs) {
        this.matchResult = { winner: this.teams[firstTeam], how: 'defended', margin: inn1.runs - inn2.runs };
      } else {
        this.matchResult = { winner: null, how: 'tie' };
      }
      events.push({ type: 'match_over', result: this.matchResult });
    }
  }

  // ─── DELIVERY OUTCOME CALCULATOR ───────────────────────────────
  /**
   * Called by the game engine after a shot is played.
   * @param {{ shot: string, power: number, confidence: number }} shotResult
   * @param {string} deliveryType  'pace' | 'spin' | 'yorker'
   * @param {number} timing        ms offset: negative = early, positive = late
   */
  calculateDeliveryOutcome(shotResult, deliveryType, timing) {
    const { shot, power, confidence } = shotResult;

    const timingAbs = Math.abs(timing);
    const isPerfect = timingAbs < 60;
    const isGood    = timingAbs < 130;
    const isMiss    = timingAbs > 200 || confidence < 0.3 || shot === 'none';

    // Miss = wicket risk
    if (isMiss) {
      const wicketRoll = Math.random();
      if (wicketRoll < 0.25) return { runs: 0, howOut: 'bowled', isNoBall: false, isWide: false };
      if (wicketRoll < 0.35) return { runs: 0, howOut: 'lbw', isNoBall: false, isWide: false };
      return { runs: 0, isNoBall: false, isWide: false };  // dot ball
    }

    // Defensive shot
    if (shot === 'defensive') {
      return { runs: Math.random() < 0.3 ? 1 : 0, isNoBall: false, isWide: false };
    }

    // Edged shots — risk of catch
    if (!isPerfect && !isGood &&
        ['cover_drive', 'off_drive', 'square_cut', 'late_cut', 'upper_cut'].includes(shot)) {
      if (Math.random() < 0.2) return { runs: 0, howOut: 'caught', isNoBall: false, isWide: false };
    }

    // Calculate runs from shot + power + timing
    let baseRuns = 0;
    const r = Math.random();

    if (isPerfect && power > 75) {
      // High chance of boundary
      if (shot === 'scoop' || shot === 'slog_sweep' || shot === 'helicopter') {
        baseRuns = r < 0.65 ? 6 : r < 0.85 ? 4 : 2;
      } else if (['hook', 'pull', 'cover_drive'].includes(shot)) {
        baseRuns = r < 0.40 ? 6 : r < 0.70 ? 4 : r < 0.88 ? 2 : 1;
      } else {
        baseRuns = r < 0.20 ? 6 : r < 0.55 ? 4 : r < 0.78 ? 2 : 1;
      }
    } else if (isGood && power > 50) {
      baseRuns = r < 0.05 ? 6 : r < 0.30 ? 4 : r < 0.60 ? 2 : r < 0.85 ? 1 : 0;
    } else {
      baseRuns = r < 0.50 ? 1 : r < 0.75 ? 2 : 0;
    }

    return { runs: baseRuns, isNoBall: false, isWide: false };
  }

  getState() {
    const inn = this.innings[this.currentInnings];
    const ballsRemaining = (this.totalOvers - inn.overs) * 6 - inn.balls;
    return {
      runs: inn.runs,
      wickets: inn.wickets,
      overs: inn.overs,
      balls: inn.balls,
      totalOvers: this.totalOvers,
      target: this.target,
      striker: inn.batsmen[inn.striker],
      nonStriker: inn.batsmen[inn.striker === 0 ? 1 : 0],
      thisOver: inn.thisOver,
      matchResult: this.matchResult,
      inningsNumber: this.currentInnings + 1,
      battingTeam: this.teams[this.currentBattingTeam],
      requiredRuns: this.target !== null ? Math.max(0, this.target - inn.runs) : null,
      requiredRunRate: this.target !== null
        ? ((this.target - inn.runs) / Math.max(0.1, ballsRemaining / 6)).toFixed(2)
        : null,
      isPowerplay: inn.overs < this.powerplayOvers,
      isFreeHit: this.freeHitNext,
      extras: inn.extras,
    };
  }

  /** Full scorecard for one innings (for break / result screens). */
  getInningsSummary(index) {
    const inn = this.innings[index];
    const current = inn.batsmen.filter(b => !inn.allBatsmen.includes(b));
    return {
      runs: inn.runs,
      wickets: inn.wickets,
      overs: `${inn.overs}.${inn.balls}`,
      extras: inn.extras,
      batsmen: [...inn.allBatsmen, ...current],
    };
  }

  /**
   * Front-foot no-ball check — simplified: 5% random no-ball by the bowler.
   */
  isLegalDelivery(_deliveryData) {
    return Math.random() > 0.05;
  }

  isWide(_deliveryPath) {
    return false;  // controlled by AI bowler
  }
}

export default CricketRules;
