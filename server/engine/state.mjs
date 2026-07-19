// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE match engine · state machine + moment detector
//
// Everything downstream (commentary, crowd audio, the living pitch, moment
// cards) is driven by ONE normalized update shape. The two real TxLINE sources
// (live SSE, historical replay) and the offline sim all emit this shape:
//
//   ScoreUpdate { fixtureId, seq, ts, phase, stats: {statKey:number → count},
//                 action?, actionData?, clockMin? }
//   OddsUpdate  { fixtureId, ts, pHome, pDraw, pAway, inRunning }
//
// TxLINE encodes soccer stats with fixed keys (goals 1/2, yellows 3/4, reds
// 5/6, corners 7/8; +1000·period prefixes) and the feed's `action` labels are
// best-effort — so, like every serious integrator, we treat COUNTER DIFFS as
// the source of truth for moments and use actions as flavour only.
// ─────────────────────────────────────────────────────────────────────────────

export const PHASE = {
  1: "NS", 2: "H1", 3: "HT", 4: "H2", 5: "FT", 6: "WET", 7: "ET1", 8: "HTET",
  9: "ET2", 10: "FET", 11: "WPE", 12: "PE", 13: "FPE", 14: "INT", 15: "ABD",
  16: "CAN", 17: "TXCC", 18: "TXCS", 19: "PP", 100: "FINAL",
};

export const PHASE_LABEL = {
  NS: "Kick-off soon", H1: "First half", HT: "Half-time", H2: "Second half",
  FT: "Full-time", WET: "Extra time next", ET1: "Extra time · 1st",
  HTET: "ET break", ET2: "Extra time · 2nd", FET: "After extra time",
  WPE: "Penalties next", PE: "Penalty shoot-out", FPE: "Decided on penalties",
  INT: "Interrupted", ABD: "Abandoned", CAN: "Cancelled", PP: "Postponed",
  FINAL: "Final", TXCC: "Coverage off", TXCS: "Coverage paused",
};

const LIVE_PHASES = new Set(["H1", "H2", "ET1", "ET2", "PE"]);
const DONE_PHASES = new Set(["FT", "FET", "FPE", "FINAL", "ABD", "CAN"]);

/** TxLINE soccer stat keys (full-game scope). */
export const STAT = { GOALS_H: 1, GOALS_A: 2, YEL_H: 3, YEL_A: 4, RED_H: 5, RED_A: 6, COR_H: 7, COR_A: 8 };

/** Tolerant field access — TxLINE payloads appear both PascalCase and camelCase. */
export const pick = (o, ...keys) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

export function newMatchState(meta) {
  return {
    fixtureId: meta.fixtureId,
    competition: meta.competition || "FIFA World Cup 2026",
    stage: meta.stage || "",
    venue: meta.venue || "",
    home: meta.home, // {name, code}
    away: meta.away,
    startTime: meta.startTime || null,
    phase: "NS",
    phaseLabel: PHASE_LABEL.NS,
    live: false,
    finished: false,
    clockMin: 0,
    score: { home: 0, away: 0 },
    pens: { home: 0, away: 0 },
    stats: { yellowH: 0, yellowA: 0, redH: 0, redA: 0, cornersH: 0, cornersA: 0 },
    odds: null, // {pHome,pDraw,pAway,ts}
    seq: 0,
    lastTs: 0,
    _phaseStartTs: 0,
    _phaseBaseMin: 0,
    participant1IsHome: meta.participant1IsHome !== false,
    _counters: {}, // raw statKey → count, for diffing
  };
}

/** Estimated match clock from phase transitions (used when feed carries none). */
function estimateClock(state, ts) {
  const base = state._phaseBaseMin;
  if (!LIVE_PHASES.has(state.phase) || !state._phaseStartTs) return base;
  const elapsed = Math.max(0, (ts - state._phaseStartTs) / 60000);
  const caps = { H1: 45 + 14, H2: 45 + 14, ET1: 15 + 6, ET2: 15 + 6, PE: 0 };
  return Math.round(base + Math.min(elapsed, caps[state.phase] ?? elapsed));
}

const PHASE_BASE_MIN = { NS: 0, H1: 0, HT: 45, H2: 45, FT: 90, WET: 90, ET1: 90, HTET: 105, ET2: 105, FET: 120, WPE: 120, PE: 120, FPE: 120, FINAL: 0 };

/**
 * Apply one normalized ScoreUpdate. Mutates `state` and returns the list of
 * detected Moment objects: { type, ts, minute, team?, detail?, intensity }.
 * intensity ∈ [0,1] drives crowd audio, pitch flare and TTS urgency.
 */
export function applyScoreUpdate(state, u) {
  const moments = [];
  const ts = u.ts || Date.now();
  if (u.seq && u.seq <= state.seq) return moments; // stale or duplicate

  // A room opened mid-match must hydrate the latest known state without
  // announcing every already-scored goal as new. Sources mark exactly one
  // explicit baseline; all subsequent counter movement is moment-producing.
  if (u.baseline) {
    if (u.seq) state.seq = u.seq;
    state.lastTs = ts;
    const phase = PHASE[u.phase];
    if (phase) {
      state.phase = phase;
      state.phaseLabel = PHASE_LABEL[phase] || phase;
      state.live = LIVE_PHASES.has(phase);
      state.finished = DONE_PHASES.has(phase);
    }
    if (Number.isFinite(u.clockMin)) {
      state.clockMin = u.clockMin;
      state._phaseBaseMin = u.clockMin;
      state._phaseStartTs = ts;
    } else if (LIVE_PHASES.has(state.phase)) {
      state._phaseStartTs = ts;
      state._phaseBaseMin = PHASE_BASE_MIN[state.phase] ?? state.clockMin;
      state.clockMin = state._phaseBaseMin;
    }
    if (u.stats) {
      state._counters = { ...u.stats };
      state.score.home = Number(u.stats[STAT.GOALS_H] || 0);
      state.score.away = Number(u.stats[STAT.GOALS_A] || 0);
      state.stats.yellowH = Number(u.stats[STAT.YEL_H] || 0);
      state.stats.yellowA = Number(u.stats[STAT.YEL_A] || 0);
      state.stats.redH = Number(u.stats[STAT.RED_H] || 0);
      state.stats.redA = Number(u.stats[STAT.RED_A] || 0);
      state.stats.cornersH = Number(u.stats[STAT.COR_H] || 0);
      state.stats.cornersA = Number(u.stats[STAT.COR_A] || 0);
    }
    return moments;
  }
  if (u.seq) state.seq = u.seq;
  state.lastTs = ts;

  // ── phase transitions ──────────────────────────────────────────────────────
  const nextPhase = PHASE[u.phase] || state.phase;
  if (nextPhase !== state.phase) {
    const prev = state.phase;
    state.phase = nextPhase;
    state.phaseLabel = PHASE_LABEL[nextPhase] || nextPhase;
    state._phaseStartTs = ts;
    if (PHASE_BASE_MIN[nextPhase] !== undefined && nextPhase !== "FINAL") state._phaseBaseMin = PHASE_BASE_MIN[nextPhase];
    state.live = LIVE_PHASES.has(nextPhase);
    state.finished = DONE_PHASES.has(nextPhase);
    const minute = estimateClock(state, ts);
    const t = (type, intensity, detail) => moments.push({ type, ts, minute, intensity, detail });
    if (nextPhase === "H1" && prev === "NS") t("KICKOFF", 0.6);
    else if (nextPhase === "HT") t("HALFTIME", 0.35);
    else if (nextPhase === "H2") t("SECOND_HALF", 0.5);
    else if (nextPhase === "FT" || nextPhase === "FET" || nextPhase === "FPE") t("FULLTIME", 0.85);
    else if (nextPhase === "ET1" || nextPhase === "WET") t("EXTRA_TIME", 0.75);
    else if (nextPhase === "PE" || nextPhase === "WPE") t("PENALTIES", 0.95);
    else if (nextPhase === "INT" || nextPhase === "TXCS") t("INTERRUPTED", 0.4);
    else if (nextPhase === "FINAL") t("FINALISED", 0.3);
  }

  if (typeof u.clockMin === "number") {
    state.clockMin = u.clockMin;
    // trust the feed's clock as the new baseline for estimation
    state._phaseBaseMin = u.clockMin;
    state._phaseStartTs = ts;
  } else {
    state.clockMin = estimateClock(state, ts);
  }

  // A director cut can jump across hundreds of omitted source updates to an
  // authentic terminal frame. Hydrate that frame's counters without turning
  // changes that happened outside the cut into new on-screen events. The
  // phase transition above (for example FINALISED) remains observable.
  if (u.directorCut && u.stats) {
    state._counters = { ...u.stats };
    state.score.home = Number(u.stats[STAT.GOALS_H] || 0);
    state.score.away = Number(u.stats[STAT.GOALS_A] || 0);
    state.stats.yellowH = Number(u.stats[STAT.YEL_H] || 0);
    state.stats.yellowA = Number(u.stats[STAT.YEL_A] || 0);
    state.stats.redH = Number(u.stats[STAT.RED_H] || 0);
    state.stats.redA = Number(u.stats[STAT.RED_A] || 0);
    state.stats.cornersH = Number(u.stats[STAT.COR_H] || 0);
    state.stats.cornersA = Number(u.stats[STAT.COR_A] || 0);
    if (nextPhase === "FINAL") state.clockMin = Math.max(90, state.clockMin);
    return moments;
  }

  // ── counter diffs → moments (the source of truth) ─────────────────────────
  if (u.stats) {
    const c = state._counters;
    const diff = (key) => {
      const now = Number(u.stats[key]);
      if (!Number.isFinite(now)) return 0;
      const before = Number.isFinite(c[key]) ? c[key] : 0;
      c[key] = now;
      return now - before;
    };
    const minute = state.clockMin;
    const emit = (type, team, intensity, detail) => moments.push({ type, ts, minute, team, intensity, detail });

    for (const [key, team] of [[STAT.GOALS_H, "home"], [STAT.GOALS_A, "away"]]) {
      const d = diff(key);
      for (let i = 0; i < d; i++) {
        state.score[team] += 1;
        emit("GOAL", team, 1.0, {
          score: { ...state.score }, seq: state.seq, ...proofCoordinates(u, key),
          statValue: Number(u.stats[key]), deltaIndex: i + 1, deltaTotal: d,
        });
      }
      for (let i = 0; i < -d; i++) {
        state.score[team] = Math.max(0, state.score[team] - 1);
        emit("GOAL_REVOKED", team, 0.9, {
          score: { ...state.score }, seq: state.seq, ...proofCoordinates(u, key),
          statValue: Number(u.stats[key]), deltaIndex: i + 1, deltaTotal: -d,
        });
      }
    }
    for (const [key, team, field] of [[STAT.RED_H, "home", "redH"], [STAT.RED_A, "away", "redA"]]) {
      const d = diff(key);
      if (d > 0) {
        state.stats[field] += d;
        emit("RED_CARD", team, 0.85, { seq: state.seq, ...proofCoordinates(u, key), statValue: Number(u.stats[key]) });
      } else if (d < 0) {
        state.stats[field] = Math.max(0, state.stats[field] + d);
        emit("CARD_REVOKED", team, 0.6, { seq: state.seq, ...proofCoordinates(u, key), statValue: Number(u.stats[key]) });
      }
    }
    for (const [key, team, field] of [[STAT.YEL_H, "home", "yellowH"], [STAT.YEL_A, "away", "yellowA"]]) {
      const d = diff(key);
      if (d > 0) { state.stats[field] += d; emit("YELLOW", team, 0.35, { seq: state.seq, statKey: key }); }
    }
    for (const [key, team, field] of [[STAT.COR_H, "home", "cornersH"], [STAT.COR_A, "away", "cornersA"]]) {
      const d = diff(key);
      if (d > 0) { state.stats[field] += d; emit("CORNER", team, 0.3, { seq: state.seq, statKey: key }); }
    }
    // penalty shoot-out goals (period prefix 6000)
    for (const [key, team] of [[6001, "home"], [6002, "away"]]) {
      const d = diff(key);
      if (d > 0) { state.pens[team] += d; emit("PEN_SCORED", team, 0.9, { pens: { ...state.pens }, seq: state.seq, statKey: key }); }
    }
  }

  // ── flavour actions (never authoritative, only colour) ────────────────────
  if (u.action) {
    const a = String(u.action).toLowerCase();
    const minute = state.clockMin;
    const data = u.actionData || {};
    if (a === "shot") {
      const outcome = pick(data, "Outcome", "outcome");
      const team = teamOf(state, data);
      if (outcome === "Woodwork") moments.push({ type: "WOODWORK", ts, minute, team, intensity: 0.8, detail: {} });
      else if (outcome === "OnTarget") moments.push({ type: "SHOT_ON_TARGET", ts, minute, team, intensity: 0.55, detail: {} });
      else if (outcome === "Blocked") moments.push({ type: "SHOT_BLOCKED", ts, minute, team, intensity: 0.4, detail: {} });
      else if (outcome === "OffTarget") moments.push({ type: "SHOT_OFF", ts, minute, team, intensity: 0.35, detail: {} });
    } else if (a === "var") {
      moments.push({ type: "VAR_CHECK", ts, minute, team: teamOf(state, data), intensity: 0.75, detail: { kind: pick(data, "Type", "type") } });
    } else if (a === "var_end") {
      moments.push({ type: "VAR_RESULT", ts, minute, intensity: 0.7, detail: { outcome: pick(data, "Outcome", "outcome") } });
    } else if (a === "penalty_awarded" || a === "penalty") {
      moments.push({ type: "PENALTY_AWARDED", ts, minute, team: teamOf(state, data), intensity: 0.92, detail: {} });
    } else if (a === "free_kick") {
      const kind = pick(data, "FreeKickType", "freeKickType");
      if (kind === "Offside") moments.push({ type: "OFFSIDE", ts, minute, team: teamOf(state, data), intensity: 0.25, detail: {} });
      else if (kind === "HighDanger" || kind === "Danger") moments.push({ type: "DANGER_FK", ts, minute, team: teamOf(state, data), intensity: 0.5, detail: { kind } });
    } else if (a === "substitution") {
      moments.push({ type: "SUBSTITUTION", ts, minute, team: teamOf(state, data), intensity: 0.2, detail: {} });
    } else if (a === "comment" && /water/i.test(pick(data, "Text", "text") || "")) {
      moments.push({ type: "WATER_BREAK", ts, minute, intensity: 0.15, detail: {} });
    } else if (["attack_possession", "danger_possession", "high_danger_possession"].includes(a)) {
      const level = a === "high_danger_possession" ? "high" : a === "danger_possession" ? "danger" : "attack";
      moments.push({
        type: "PRESSURE",
        ts,
        minute,
        team: teamOf(state, data),
        intensity: level === "high" ? 0.46 : level === "danger" ? 0.32 : 0.16,
        detail: { level },
      });
    }
  }

  return moments;
}

function teamOf(state, data) {
  const p = pick(data, "Participant", "participant", "Team", "team");
  if (p === 1 || p === "1" || p === state.home?.name) return "home";
  if (p === 2 || p === "2" || p === state.away?.name) return "away";
  return undefined;
}

function proofCoordinates(update, displayStatKey) {
  if (update.participant1IsHome !== false) return { statKey: displayStatKey };
  const sourceStatKey = update.participant1IsHome === false ? mirrorStatKey(displayStatKey) : displayStatKey;
  const base = sourceStatKey % 1000;
  return {
    statKey: displayStatKey,
    sourceStatKey,
    sourceParticipant: base >= 1 && base <= 8 ? (base % 2 ? 1 : 2) : undefined,
  };
}

function mirrorStatKey(key) {
  const base = key % 1000;
  if (base < 1 || base > 8) return key;
  return key - base + (base % 2 ? base + 1 : base - 1);
}

/** Apply a normalized OddsUpdate; returns a MARKET_SURGE moment on big swings. */
export function applyOddsUpdate(state, u) {
  const prev = state.odds;
  const next = { pHome: clamp01(u.pHome), pDraw: clamp01(u.pDraw), pAway: clamp01(u.pAway), ts: u.ts || Date.now() };
  if (![next.pHome, next.pDraw, next.pAway].every(Number.isFinite)) return [];
  state.odds = next;
  if (!prev) return [];
  const dH = next.pHome - prev.pHome;
  const dA = next.pAway - prev.pAway;
  const swing = Math.max(Math.abs(dH), Math.abs(dA));
  // Only narrate the market when it moves on its own (goals narrate themselves)
  if (swing >= 0.08) {
    const team = Math.abs(dH) >= Math.abs(dA) ? (dH > 0 ? "home" : "away") : (dA > 0 ? "away" : "home");
    const dir = (team === "home" ? dH : dA) > 0 ? "up" : "down";
    return [{
      type: "MARKET_SURGE", ts: next.ts, minute: state.clockMin, team,
      intensity: Math.min(1, 0.45 + swing * 2),
      detail: { swing: Math.round(swing * 100), dir, pHome: next.pHome, pAway: next.pAway, pDraw: next.pDraw },
    }];
  }
  return [];
}

const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : NaN);

/** Public snapshot sent to clients (drops private fields). */
export function snapshot(state) {
  const { _counters, _phaseStartTs, _phaseBaseMin, participant1IsHome, ...pub } = state;
  return pub;
}
