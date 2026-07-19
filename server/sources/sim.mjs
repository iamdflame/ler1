// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE sim source · the offline demo tournament
//
// A deterministic match-script generator so ROARLINE runs, in full, on a bare
// `node server/index.mjs` — no credentials, no network, no npm install. Every
// surface (state, moments, odds narrative, proofs UX) exercises the exact same
// pipeline the real TxLINE sources feed. The UI labels this mode DEMO DATA
// everywhere; nothing pretends to be real.
//
// Scripts are seeded and pre-planned: goals, cards, VAR drama, shots, corners,
// and an odds path that *reacts* to the events like a real market would —
// drifting with pressure, gapping on goals, collapsing on red cards.
// ─────────────────────────────────────────────────────────────────────────────
import { STAT } from "../engine/state.mjs";

// Mulberry32 — tiny seeded PRNG, deterministic per fixture.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SIM_TEAMS = [
  { name: "Argentina", code: "ARG" }, { name: "France", code: "FRA" },
  { name: "Brazil", code: "BRA" }, { name: "England", code: "ENG" },
  { name: "Spain", code: "ESP" }, { name: "Germany", code: "GER" },
  { name: "Portugal", code: "POR" }, { name: "Netherlands", code: "NED" },
  { name: "Morocco", code: "MAR" }, { name: "Japan", code: "JPN" },
  { name: "USA", code: "USA" }, { name: "Mexico", code: "MEX" },
  { name: "Croatia", code: "CRO" }, { name: "Uruguay", code: "URU" },
  { name: "Senegal", code: "SEN" }, { name: "Korea Republic", code: "KOR" },
];

const VENUES = ["Estadio Azteca, Mexico City", "MetLife Stadium, New York", "SoFi Stadium, Los Angeles", "AT&T Stadium, Dallas", "BC Place, Vancouver", "Hard Rock Stadium, Miami"];
const STAGES = ["Group stage", "Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Final"];

/** Build the timed event script for one simulated match. */
export function buildScript(seed, strengthH = 0.5) {
  const r = rng(seed);
  const ev = []; // {atMin (match minute, float), type, team?, data?}
  const goalsH = weighted(r, [0.24, 0.34, 0.26, 0.12, 0.04]); // 0..4
  const goalsA = weighted(r, [0.3, 0.36, 0.22, 0.09, 0.03]);
  const goalMinutes = [];
  for (let i = 0; i < goalsH; i++) goalMinutes.push({ team: "home", min: 4 + r() * 86 });
  for (let i = 0; i < goalsA; i++) goalMinutes.push({ team: "away", min: 4 + r() * 86 });
  goalMinutes.sort((a, b) => a.min - b.min);
  for (const g of goalMinutes) {
    if (r() < 0.18) { // VAR drama around a goal
      ev.push({ atMin: g.min, type: "goal", team: g.team });
      ev.push({ atMin: g.min + 0.6, type: "var", team: g.team, data: { Type: "Goal" } });
      const overturned = r() < 0.45;
      ev.push({ atMin: g.min + 1.8, type: "var_end", data: { Outcome: overturned ? "Overturned" : "Stands" } });
      if (overturned) ev.push({ atMin: g.min + 1.85, type: "goal_revoked", team: g.team });
    } else {
      ev.push({ atMin: g.min, type: "goal", team: g.team });
    }
  }
  const nYel = 1 + Math.floor(r() * 5);
  for (let i = 0; i < nYel; i++) ev.push({ atMin: 8 + r() * 80, type: "yellow", team: r() < 0.5 ? "home" : "away" });
  if (r() < 0.16) ev.push({ atMin: 30 + r() * 55, type: "red", team: r() < 0.5 ? "home" : "away" });
  const nCor = 6 + Math.floor(r() * 8);
  for (let i = 0; i < nCor; i++) ev.push({ atMin: 2 + r() * 88, type: "corner", team: r() < strengthH ? "home" : "away" });
  const nShots = 14 + Math.floor(r() * 12);
  for (let i = 0; i < nShots; i++) {
    const q = r();
    ev.push({
      atMin: 2 + r() * 88, type: "shot", team: r() < strengthH ? "home" : "away",
      data: { Outcome: q < 0.3 ? "OnTarget" : q < 0.42 ? "Blocked" : q < 0.47 ? "Woodwork" : "OffTarget" },
    });
  }
  for (let i = 0; i < 3; i++) ev.push({ atMin: 55 + r() * 33, type: "substitution", team: r() < 0.5 ? "home" : "away" });
  if (r() < 0.3) ev.push({ atMin: 25 + r() * 10, type: "free_kick", team: r() < 0.5 ? "home" : "away", data: { FreeKickType: "HighDanger" } });
  ev.sort((a, b) => a.atMin - b.atMin);
  return ev;
}

/** Pre-match 1X2 probabilities from a strength dial, lightly de-margined look. */
function openingOdds(r, strengthH) {
  const edge = (strengthH - 0.5) * 0.5;
  let pH = 0.38 + edge + (r() - 0.5) * 0.06;
  let pA = 0.34 - edge + (r() - 0.5) * 0.06;
  let pD = 1 - pH - pA;
  return normalizeP(pH, pD, pA);
}

function normalizeP(h, d, a) {
  h = Math.max(0.02, h); d = Math.max(0.02, d); a = Math.max(0.02, a);
  const s = h + d + a;
  return { h: h / s, d: d / s, a: a / s };
}

function weighted(r, table) {
  const x = r(); let acc = 0;
  for (let i = 0; i < table.length; i++) { acc += table[i]; if (x < acc) return i; }
  return table.length - 1;
}

/**
 * Plays one scripted match into a Room. Emits normalized updates with a
 * virtual clock; `speed` compresses match time (12 → a half in ~4 minutes).
 */
export class SimSource {
  constructor({ fixtureId, seed, strengthH = 0.5, speed = 12, startPhase = "prematch" }) {
    this.fixtureId = fixtureId;
    this.seed = seed;
    this.speed = speed;
    this.script = buildScript(seed, strengthH);
    this.strengthH = strengthH;
    this.onScore = null;
    this.onOdds = null;
    this.onDone = null;
    this._timers = [];
    this._seq = 0;
    this._counters = { [STAT.GOALS_H]: 0, [STAT.GOALS_A]: 0, [STAT.YEL_H]: 0, [STAT.YEL_A]: 0, [STAT.RED_H]: 0, [STAT.RED_A]: 0, [STAT.COR_H]: 0, [STAT.COR_A]: 0 };
    this._r = rng(seed ^ 0x5eed);
    this._odds = openingOdds(this._r, strengthH);
    this._kickoffReal = null;
    this._preMs = startPhase === "prematch" ? 12000 : 0;
    this._stopped = false;
  }

  /** Virtual "now" in the room's time space (wall clock — sim runs live). */
  now() { return Date.now(); }

  _matchMinToReal(min) {
    // 45' + 3' stoppage per half; 10s half-time in demo pacing
    const perMin = 60000 / this.speed;
    if (min <= 48) return this._preMs + min * perMin;
    return this._preMs + 48 * perMin + 10000 + (min - 48) * perMin;
  }

  start() {
    this._kickoffReal = Date.now();
    const at = (ms, fn) => { if (!this._stopped) this._timers.push(setTimeout(fn, Math.max(0, ms))); };
    const perMin = 60000 / this.speed;

    // Pre-match: opening odds and a not-started frame.
    this._score({ phase: 1, clockMin: 0 });
    this._pushOdds(0);
    at(this._preMs, () => { this._score({ phase: 2, clockMin: 0 }); this._pushOdds(0.4); });

    // Scheduled script events.
    for (const e of this.script) {
      const minute = e.atMin <= 48 ? e.atMin : e.atMin; // one continuous script 0..93
      at(this._matchMinToReal(e.atMin), () => this._fire(e, Math.min(93, Math.round(minute))));
    }

    // Half-time / second half / full-time built around a 48' + 45' shape.
    at(this._matchMinToReal(48), () => this._score({ phase: 3, clockMin: 45 }));
    at(this._matchMinToReal(48) + 10000, () => this._score({ phase: 4, clockMin: 45 }));
    at(this._matchMinToReal(93.5), () => { this._score({ phase: 5, clockMin: 93 }); this._pushOdds(93); this.onDone?.(); });

    // Ambient odds drift every ~20 match-seconds.
    const drift = () => {
      if (this._stopped) return;
      const elapsed = Date.now() - this._kickoffReal;
      const min = this._realToMatchMin(elapsed);
      if (min > 0 && min < 93) this._pushOdds(min, true);
      this._timers.push(setTimeout(drift, (20000 / this.speed) * (0.7 + this._r() * 0.6)));
    };
    drift();
  }

  _realToMatchMin(ms) {
    const perMin = 60000 / this.speed;
    if (ms < this._preMs) return 0;
    const inPlay = ms - this._preMs;
    if (inPlay <= 48 * perMin) return inPlay / perMin;
    if (inPlay <= 48 * perMin + 10000) return 45;
    return 48 + (inPlay - 48 * perMin - 10000) / perMin;
  }

  stop() {
    this._stopped = true;
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
  }

  _fire(e, minute) {
    const c = this._counters;
    const phase = minute <= 45 ? 2 : 4;
    switch (e.type) {
      case "goal":
        c[e.team === "home" ? STAT.GOALS_H : STAT.GOALS_A] += 1;
        this._score({ phase, clockMin: minute });
        this._marketShock(e.team, +0.16 + this._r() * 0.1, minute);
        break;
      case "goal_revoked":
        c[e.team === "home" ? STAT.GOALS_H : STAT.GOALS_A] -= 1;
        this._score({ phase, clockMin: minute });
        this._marketShock(e.team, -(0.14 + this._r() * 0.08), minute);
        break;
      case "yellow":
        c[e.team === "home" ? STAT.YEL_H : STAT.YEL_A] += 1;
        this._score({ phase, clockMin: minute });
        break;
      case "red":
        c[e.team === "home" ? STAT.RED_H : STAT.RED_A] += 1;
        this._score({ phase, clockMin: minute });
        this._marketShock(e.team, -(0.12 + this._r() * 0.08), minute);
        break;
      case "corner":
        c[e.team === "home" ? STAT.COR_H : STAT.COR_A] += 1;
        this._score({ phase, clockMin: minute });
        break;
      default:
        // flavour actions ride on a score frame without counter changes
        this._score({ phase, clockMin: minute, action: e.type, actionData: { ...e.data, Participant: e.team === "home" ? 1 : 2 } });
    }
  }

  _score({ phase, clockMin, action, actionData }) {
    this._seq += 1;
    this.onScore?.({
      fixtureId: this.fixtureId, seq: this._seq, ts: Date.now(), phase,
      clockMin, stats: { ...this._counters }, action, actionData,
      receivedAt: Date.now(), source: "simulation",
    });
  }

  _marketShock(team, delta, minute) {
    const o = this._odds;
    const lead = this._counters[STAT.GOALS_H] - this._counters[STAT.GOALS_A];
    const levelled = delta > 0 && lead === 0; // an equaliser revives the draw
    const dDraw = levelled ? +Math.abs(delta) * 0.55 : -delta * 0.45;
    const shocked = team === "home"
      ? normalizeP(o.h + delta * (levelled ? 0.4 : 1), o.d + dDraw, o.a - delta * 0.55)
      : normalizeP(o.h - delta * 0.55, o.d + dDraw, o.a + delta * (levelled ? 0.4 : 1));
    this._odds = shocked;
    this._pushOdds(minute);
  }

  _pushOdds(minute, drift = false) {
    if (drift) {
      // time-decay towards the leader + noise, like a real in-running market
      const lead = this._counters[STAT.GOALS_H] - this._counters[STAT.GOALS_A];
      const pull = 0.0035 + minute / 40000;
      const o = this._odds;
      const n = (this._r() - 0.5) * 0.012;
      this._odds = lead > 0 ? normalizeP(o.h + pull + n, o.d - pull * 0.6, o.a - pull * 0.4 - n)
        : lead < 0 ? normalizeP(o.h - pull * 0.4 - n, o.d - pull * 0.6, o.a + pull + n)
        : normalizeP(o.h + n, o.d + pull * 0.5, o.a - n);
    }
    this.onOdds?.({ fixtureId: this.fixtureId, ts: Date.now(), pHome: this._odds.h, pDraw: this._odds.d, pAway: this._odds.a, inRunning: minute > 0, receivedAt: Date.now(), source: "simulation" });
  }
}

/** The demo lobby: one live match now, one up next, and a replayable archive. */
export function simFixtures() {
  const day = Math.floor(Date.now() / 86400000);
  const mk = (i, stage, offsetMin) => {
    const h = SIM_TEAMS[(day * 3 + i * 2) % SIM_TEAMS.length];
    let a = SIM_TEAMS[(day * 5 + i * 2 + 7) % SIM_TEAMS.length];
    if (a.code === h.code) a = SIM_TEAMS[(day * 5 + i * 2 + 8) % SIM_TEAMS.length];
    return {
      fixtureId: 90000000 + day * 100 + i,
      home: h, away: a,
      competition: "FIFA World Cup 2026 · DEMO DATA",
      stage, venue: VENUES[i % VENUES.length],
      startTime: Date.now() + offsetMin * 60000,
      seed: day * 1000 + i * 17,
      strengthH: 0.42 + ((i * 37) % 20) / 100,
    };
  };
  const live = mk(1, "Semi-final", 0);
  const next = mk(2, "Semi-final", 35);
  const archive = [];
  for (let i = 3; i < 15; i++) archive.push(mk(i, STAGES[i % 4], -(i * 240)));
  return { live, next, archive };
}
