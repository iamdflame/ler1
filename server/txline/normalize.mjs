// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE TxLINE normalizer · raw feed → engine shape
//
// EVERY assumption about TxLINE payload field names lives in this one file, so
// adapting to feed nuances is a one-file change. The docs themselves note the
// casing varies by surface ("the payload field may appear as `Seq` or `seq`"),
// so every accessor is case-tolerant. If a payload doesn't parse, we return
// null and the raw message is kept on the debug ring (`/api/debug/raw`) for
// inspection instead of crashing a broadcast.
// ─────────────────────────────────────────────────────────────────────────────
import { pick, PHASE } from "../engine/state.mjs";

/** Fixture snapshot entry → lobby metadata. */
export function mapFixture(raw) {
  const fixtureId = Number(pick(raw, "FixtureId", "fixtureId", "Id", "id"));
  if (!Number.isFinite(fixtureId)) return null;
  const p1 = pick(raw, "Participant1", "participant1") ?? "Home";
  const p2 = pick(raw, "Participant2", "participant2") ?? "Away";
  const p1Home = pick(raw, "Participant1IsHome", "participant1IsHome");
  const homeName = p1Home === false ? p2 : p1;
  const awayName = p1Home === false ? p1 : p2;
  return {
    fixtureId,
    home: { name: String(homeName), code: codeOf(homeName) },
    away: { name: String(awayName), code: codeOf(awayName) },
    participant1IsHome: p1Home !== false,
    competition: String(pick(raw, "Competition", "competition", "CompetitionName", "League", "league") ?? "FIFA World Cup 2026"),
    stage: String(pick(raw, "Round", "round", "Stage", "stage") ?? ""),
    venue: String(pick(raw, "Venue", "venue") ?? ""),
    startTime: toMs(pick(raw, "StartTime", "startTime")),
    gameState: Number(pick(raw, "GameState", "gameState")) || 1,
  };
}

/**
 * Scores message (stream / historical / updates) → normalized ScoreUpdate.
 * Stats arrive as a map of stat-key → count; keys may be strings. If the
 * message carries no phase we leave it undefined so the state machine keeps
 * its current phase (partial updates are normal on the feed).
 */
export function mapScore(raw, homeIsP1 = true) {
  const fixtureId = Number(pick(raw, "FixtureId", "fixtureId"));
  if (!Number.isFinite(fixtureId)) return null;
  const seq = Number(pick(raw, "Seq", "seq"));
  const ts = toMs(pick(raw, "Ts", "ts", "Timestamp", "timestamp")) ?? Date.now();

  let phase = Number(pick(raw, "StatusId", "statusId", "GameState", "gameState", "Period", "period"));
  if (!PHASE[phase]) phase = undefined;
  const action = pick(raw, "Action", "action");
  if (String(action).toLowerCase() === "game_finalised") phase = 100;

  let stats;
  let sourceStats;
  const rawStats = pick(raw, "Stats", "stats");
  if (rawStats && typeof rawStats === "object") {
    stats = {};
    sourceStats = {};
    for (const [k, v] of Object.entries(rawStats)) {
      const key = Number(k);
      const val = Number(typeof v === "object" ? pick(v, "Value", "value") : v);
      if (Number.isFinite(key) && Number.isFinite(val)) {
        sourceStats[key] = val;
        // If the feed lists Participant2 as home, mirror paired keys so the
        // engine's "home" is always the actual home side.
        stats[homeIsP1 ? key : mirrorKey(key)] = val;
      }
    }
  }

  const clock = pick(raw, "Clock", "clock");
  const minuteRaw = pick(raw, "MatchTime", "matchTime", "Minute", "minute");
  const secondsRaw = pick(clock, "Seconds", "seconds");
  const clockMin = minuteRaw !== undefined
    ? clockFrom(minuteRaw)
    : Number.isFinite(Number(secondsRaw)) ? Math.max(0, Math.round(Number(secondsRaw) / 60)) : undefined;
  const sourceParticipant = Number(pick(raw, "Participant", "participant"));

  return {
    fixtureId, seq: Number.isFinite(seq) ? seq : undefined, ts, phase, stats, sourceStats,
    participant1IsHome: homeIsP1,
    sourceParticipant: sourceParticipant === 1 || sourceParticipant === 2 ? sourceParticipant : undefined,
    action: action ? String(action) : undefined,
    // Participant/Possession live beside Data on the soccer feed. Merge them
    // into the action envelope so the deterministic engine can attribute
    // pressure without retaining a second raw-feed shape downstream.
    actionData: {
      ...(pick(raw, "Data", "data") || {}),
      Participant: sourceParticipant === 1 || sourceParticipant === 2
        ? (homeIsP1 ? sourceParticipant : 3 - sourceParticipant)
        : pick(raw, "Participant", "participant"),
      Possession: pick(raw, "Possession", "possession"),
      PossessionType: pick(raw, "PossessionType", "possessionType"),
    },
    clockMin,
  };
}

/**
 * Odds payload → {pHome,pDraw,pAway} implied probabilities.
 * TxLINE's StablePrice entries carry de-margined implied percentages (`Pct`).
 * We hunt for a 1X2 / match-winner shape across several plausible layouts:
 *   a) entry with Outcomes/Prices array of {Name|Outcome, Pct|Price}
 *   b) flat {Pct: [h, d, a]} or {PctP1, PctX, PctP2}
 * Returns null if nothing matches — callers skip quietly.
 */
export function mapOdds(raw, homeIsP1 = true) {
  const entries = Array.isArray(raw) ? raw : [raw];
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const fixtureId = Number(pick(e, "FixtureId", "fixtureId"));
    const ts = toMs(pick(e, "Ts", "ts", "Timestamp", "timestamp")) ?? Date.now();
    const inRunning = Boolean(pick(e, "InRunning", "inRunning"));

    // (b) flat percentage fields
    const flat = pick(e, "Pct", "pct");
    if (Array.isArray(flat) && flat.length >= 3) {
      return finish(flat[0], flat[1], flat[2]);
    }
    const pH = num(pick(e, "PctP1", "pctP1", "PctHome", "pctHome"));
    const pX = num(pick(e, "PctX", "pctX", "PctDraw", "pctDraw"));
    const pA = num(pick(e, "PctP2", "pctP2", "PctAway", "pctAway"));
    if (pH !== null && pX !== null && pA !== null) return finish(pH, pX, pA);

    // (a) outcome arrays, possibly nested under a market
    const containers = [e, ...(asArray(pick(e, "Markets", "markets"))), ...(asArray(pick(e, "Odds", "odds")))];
    for (const c of containers) {
      const outs = asArray(pick(c, "Outcomes", "outcomes", "Prices", "prices", "Selections", "selections"));
      if (outs.length < 3) continue;
      let h = null, d = null, a = null;
      for (const o of outs) {
        const label = String(pick(o, "Name", "name", "Outcome", "outcome", "Type", "type") ?? "").toLowerCase();
        const val = num(pick(o, "Pct", "pct", "Probability", "probability", "ImpliedPct", "impliedPct"));
        if (val === null) continue;
        if (label === "1" || label.includes("home") || label.includes("p1") || label.includes("participant1")) h = val;
        else if (label === "x" || label.includes("draw")) d = val;
        else if (label === "2" || label.includes("away") || label.includes("p2") || label.includes("participant2")) a = val;
      }
      if (h !== null && d !== null && a !== null) return finish(h, d, a);
    }

    function finish(h, d, a) {
      [h, d, a] = [h, d, a].map(Number);
      if (![h, d, a].every(Number.isFinite)) return null;
      // accept 0..1 or 0..100 scales
      const scale = h + d + a > 3 ? 100 : 1;
      let ph = h / scale, pd = d / scale, pa = a / scale;
      if (!homeIsP1) [ph, pa] = [pa, ph];
      const s = ph + pd + pa;
      if (!(s > 0.5 && s < 1.5)) return null; // not a sane probability triple
      return { fixtureId, ts, pHome: ph / s, pDraw: pd / s, pAway: pa / s, inRunning };
    }
  }
  return null;
}

// mirror paired soccer stat keys (1↔2, 3↔4, …) preserving period prefixes
function mirrorKey(key) {
  const base = key % 1000, prefix = key - base;
  if (base >= 1 && base <= 8) return prefix + (base % 2 === 1 ? base + 1 : base - 1);
  return key;
}

const asArray = (x) => (Array.isArray(x) ? x : []);
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const toMs = (t) => {
  if (t === undefined || t === null) return null;
  if (Number.isFinite(Number(t))) {
    const n = Number(t);
    return n > 1e12 ? n : n > 1e9 ? n * 1000 : null;
  }
  const parsed = Date.parse(t);
  return Number.isFinite(parsed) ? parsed : null;
};

function clockFrom(v) {
  if (v === undefined || v === null) return undefined;
  if (Number.isFinite(Number(v))) {
    return Math.max(0, Math.round(Number(v)));
  }
  const m = String(v).match(/^(\d+)(?::(\d+))?/);
  return m ? Number(m[1]) : undefined;
}

/** 3-letter display code from a team name (best-effort). */
export function codeOf(name) {
  const KNOWN = {
    argentina: "ARG", france: "FRA", brazil: "BRA", england: "ENG", spain: "ESP",
    germany: "GER", portugal: "POR", netherlands: "NED", morocco: "MAR", japan: "JPN",
    "united states": "USA", usa: "USA", mexico: "MEX", croatia: "CRO", uruguay: "URU",
    senegal: "SEN", "korea republic": "KOR", canada: "CAN", italy: "ITA", belgium: "BEL",
    switzerland: "SUI", colombia: "COL", ecuador: "ECU", australia: "AUS", ghana: "GHA",
    nigeria: "NGA", egypt: "EGY", "saudi arabia": "KSA", qatar: "QAT", poland: "POL",
    denmark: "DEN", sweden: "SWE", norway: "NOR", austria: "AUT", scotland: "SCO",
    wales: "WAL", serbia: "SRB", turkey: "TUR", "türkiye": "TUR", iran: "IRN",
    "costa rica": "CRC", panama: "PAN", peru: "PER", chile: "CHI", paraguay: "PAR",
    "new zealand": "NZL", "south africa": "RSA", tunisia: "TUN", algeria: "ALG",
    "cote d'ivoire": "CIV", "ivory coast": "CIV", cameroon: "CMR", uzbekistan: "UZB", jordan: "JOR",
  };
  const k = String(name).toLowerCase().trim();
  return KNOWN[k] || String(name).replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "TBD";
}
