// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE drama engine · continuous emotional signals
//
// Turns discrete match data into the three signals every surface of the app
// breathes with, ticked once a second:
//
//   fever    0..1  how alive the match is right now (crowd volume, UI glow)
//   pressure -1..1 which goal the danger is flowing towards (-1 home goal
//                  under siege … +1 away goal under siege)
//   winProb  {home,draw,away} the market's live read, de-margined
//
// Moments inject energy which decays exponentially; the market's volatility
// and the game situation (score gap, minute, phase) shape the floor. This is
// what makes an 89th-minute one-goal game FEEL different from a 3-0 stroll —
// without a single pixel of video.
// ─────────────────────────────────────────────────────────────────────────────

const MOMENT_ENERGY = {
  GOAL: 1.0, GOAL_REVOKED: 0.95, PENALTIES: 0.9, PEN_SCORED: 0.85, PENALTY_AWARDED: 0.9,
  RED_CARD: 0.8, WOODWORK: 0.7, VAR_CHECK: 0.65, VAR_RESULT: 0.6, MARKET_SURGE: 0.6,
  EXTRA_TIME: 0.6, FULLTIME: 0.7, KICKOFF: 0.5, SECOND_HALF: 0.45, SHOT_ON_TARGET: 0.45,
  DANGER_FK: 0.4, CORNER: 0.3, SHOT_BLOCKED: 0.3, YELLOW: 0.3, SHOT_OFF: 0.25,
  PRESSURE: 0.12,
  CARD_REVOKED: 0.4, HALFTIME: 0.2, SUBSTITUTION: 0.15, OFFSIDE: 0.15, WATER_BREAK: 0.1,
  INTERRUPTED: 0.3, FINALISED: 0.2,
};

const PRESSURE_PUSH = { // + pushes towards AWAY goal (home attacking)
  GOAL: 0.9, PEN_SCORED: 0.7, PENALTY_AWARDED: 0.8, WOODWORK: 0.8, SHOT_ON_TARGET: 0.55,
  DANGER_FK: 0.45, CORNER: 0.4, SHOT_BLOCKED: 0.35, SHOT_OFF: 0.3, MARKET_SURGE: 0.35,
  PRESSURE: 0.22,
};

export class DramaEngine {
  constructor(state) {
    this.state = state;
    this.energy = 0;        // decaying moment energy
    this.pressure = 0;      // -1..1, home end ←→ away end
    this.volatility = 0;    // odds movement EMA
    this._lastOdds = null;
    // Clock-space agnostic: live rooms tick in wall time, replays tick in the
    // original match's time space. First tick establishes the baseline.
    this._lastTick = null;
  }

  onMoment(m) {
    const e = MOMENT_ENERGY[m.type] ?? 0.2;
    this.energy = Math.min(1.35, this.energy + e * (0.6 + 0.4 * (m.intensity ?? 0.5)));
    const push = PRESSURE_PUSH[m.type];
    if (push && m.team) {
      const dir = m.team === "home" ? +1 : -1; // home attacks the away goal → +
      this.pressure = clamp(this.pressure + dir * push, -1, 1);
    }
    if (m.type === "GOAL" || m.type === "GOAL_REVOKED") this.pressure *= 0.2; // reset after the release
  }

  onOdds(o) {
    if (this._lastOdds) {
      const move = Math.abs(o.pHome - this._lastOdds.pHome) + Math.abs(o.pAway - this._lastOdds.pAway);
      this.volatility = this.volatility * 0.7 + move * 6;
    }
    this._lastOdds = o;
  }

  /** One-second heartbeat → the `signal` frame streamed to every client. */
  tick(now = Date.now()) {
    const dt = this._lastTick === null ? 1 : Math.min(5, Math.max(0, (now - this._lastTick) / 1000));
    this._lastTick = now;
    const s = this.state;

    this.energy *= Math.pow(0.5, dt / 18);      // 18s half-life: goals echo, then settle
    this.pressure *= Math.pow(0.5, dt / 25);    // pressure bleeds back to midfield

    // Situation floor: tight scoreline late in a live game keeps the place humming.
    let floor = 0.06;
    if (s.live) {
      const gap = Math.abs(s.score.home - s.score.away);
      const closeness = gap === 0 ? 1 : gap === 1 ? 0.75 : gap === 2 ? 0.35 : 0.15;
      const lateness = clamp((s.clockMin - 60) / 35, 0, 1); // ramps 60' → 95'
      const phaseBoost = s.phase === "PE" ? 0.55 : s.phase.startsWith("ET") ? 0.35 : 0;
      floor = 0.18 + 0.28 * closeness * (0.35 + 0.65 * lateness) + phaseBoost;
    } else if (s.finished) floor = 0.1;

    const fever = clamp(Math.max(floor, floor + this.energy * 0.85 + clamp(this.volatility, 0, 0.25)), 0, 1);

    return {
      t: now,
      fever: round3(fever),
      pressure: round3(clamp(this.pressure, -1, 1)),
      winProb: s.odds ? { home: round3(s.odds.pHome), draw: round3(s.odds.pDraw), away: round3(s.odds.pAway) } : null,
      clockMin: s.clockMin,
      phase: s.phase,
      live: s.live,
    };
  }
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const round3 = (x) => Math.round(x * 1000) / 1000;
