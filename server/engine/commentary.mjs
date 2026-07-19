// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE commentary engine · the broadcast booth
//
// Two deterministic voices, zero API keys, no model call in the event path:
//
//   PLAY-BY-PLAY  reacts to moments the instant the counter moves
//   THE MARKET    a colour analyst who narrates what the world's sharpest
//                 viewers think — TxLINE's consensus odds — during the action
//                 and in the quiet spells between it
//
// Deliberately not an LLM in the event path: match facts map directly to a
// stable semantic phrase. Every line carries a heat rating that drives the TTS
// voice (rate/pitch) and the UI treatment.
// ─────────────────────────────────────────────────────────────────────────────

const V = {
  GOAL: [
    "GOOOOAL! {team} strike! It's {score}!",
    "IT'S IN! {team} have scored — {score}!",
    "GOAL — {team}! The net bulges and this place ERUPTS. {score}!",
    "They've done it! {team} find the breakthrough. {score}!",
    "{team} score! Off the counter it goes in — {score} and bedlam!",
  ],
  GOAL_EQUALISER: [
    "GOOOAL! {team} level it! {score} — we have a match again!",
    "IT'S ALL SQUARE! {team} drag themselves level at {score}!",
    "The equaliser! {team} refuse to die — {score}!",
  ],
  GOAL_LATE_WINNER: [
    "OH MY WORD — {min}' and {team} might have just won it! {score}!",
    "SCENES! A goal in the {min}th minute — {team} lead {score} this late!",
    "{team} SCORE IN THE {min}TH! Limbs everywhere. {score}!",
  ],
  GOAL_REVOKED: [
    "HOLD ON — the goal is CHALKED OFF! {team}'s celebration dies in their throats. Back to {score}.",
    "NO GOAL! The board wipes it away — VAR has spoken and we're back to {score}.",
    "It's been taken off them! {team} are furious — the score reverts to {score}.",
  ],
  PEN_SCORED: [
    "Scored! {team} convert from the spot — shoot-out score {pens}.",
    "Cool as you like. {team} bury the penalty. {pens}.",
    "No mistake from {team}! {pens} in the shoot-out.",
  ],
  PENALTY_AWARDED: [
    "PENALTY! The referee points to the spot — {team} have a huge chance here!",
    "It's given! A penalty to {team} — the stadium holds its breath.",
  ],
  RED_CARD: [
    "RED CARD! {team} are down to ten — that changes EVERYTHING.",
    "He's off! A straight red for {team} and the whole match tilts.",
    "The referee reaches for his top pocket... it's RED. Disaster for {team}.",
  ],
  CARD_REVOKED: [
    "The red card is rescinded! {team} breathe again — back to a full eleven.",
  ],
  YELLOW: [
    "A booking for {team} — that's one to be careful with.",
    "Yellow card, {team}. The referee draws a line.",
    "Cynical, and the referee agrees — {team} go in the book.",
  ],
  CORNER: [
    "Corner to {team} — bodies loading into the box...",
    "{team} win a corner. Set-piece coming in...",
    "Another corner for {team} — the pressure keeps coming.",
  ],
  WOODWORK: [
    "OFF THE POST! Centimetres from a goal for {team} — you can hear the ping from here!",
    "THE CROSSBAR SAVES THEM! {team} so, so close!",
  ],
  SHOT_ON_TARGET: [
    "Big save! {team} test the keeper — he's equal to it.",
    "{team} let fly — turned away! The keeper stands tall.",
    "Effort on target from {team}... kept out!",
  ],
  SHOT_BLOCKED: [
    "Thrown at goal by {team} — blocked! Bodies on the line.",
    "{team} shoot... straight into traffic.",
  ],
  SHOT_OFF: [
    "{team} have a go from range — wide of the mark.",
    "Over the bar. {team} winding up from distance now.",
  ],
  DANGER_FK: [
    "Free kick to {team} in a dangerous spot — this is shooting territory.",
    "{team} stand over a free kick the keeper will NOT enjoy...",
  ],
  OFFSIDE: [
    "The flag's up — {team} caught offside.",
    "Offside. {team} timed the run a half-step early.",
  ],
  VAR_CHECK: [
    "VAR CHECK. The referee has his finger to his ear... nobody in this stadium is breathing.",
    "Hold everything — the VAR is looking at this. The big screen says CHECK IN PROGRESS.",
  ],
  VAR_RESULT_STANDS: ["The decision STANDS. Play on!"],
  VAR_RESULT_OVERTURNED: ["OVERTURNED! The VAR flips the call — chaos here!"],
  SUBSTITUTION: [
    "A change for {team} — fresh legs into the fight.",
    "{team} roll the dice from the bench.",
  ],
  WATER_BREAK: ["A pause for water — catch your breath, we all need it."],
  KICKOFF: [
    "And we are UNDERWAY! {home} against {away} — the world is watching.",
    "The whistle goes — {home} versus {away} is LIVE!",
  ],
  HALFTIME: [
    "That's half-time. {score} at the break — time to breathe.",
    "The referee calls it for the half. {score}.",
  ],
  SECOND_HALF: [
    "Back underway for the second half — {score} as it stands.",
    "We go again! Forty-five minutes to settle this.",
  ],
  FULLTIME: [
    "THE FINAL WHISTLE! It finishes {home} {score} {away}. What a watch that was.",
    "It's all over! Full-time: {home} {score} {away}.",
  ],
  EXTRA_TIME: [
    "We cannot be separated — EXTRA TIME it is. Thirty more minutes of this!",
  ],
  PENALTIES: [
    "PENALTIES. It all comes down to twelve yards. No hiding place now.",
  ],
  INTERRUPTED: ["Play has been interrupted — we'll bring you every update the moment it restarts."],
  FINALISED: ["The result is now official. In the record books it goes."],
  MARKET_SURGE_UP: [
    "Listen to this: the market has SURGED on {team} — up {swing} points in moments. The sharpest money in the world just moved.",
    "Huge shift — the global market now makes {team} {pct} to win this, a {swing}-point jump. Something changed out there.",
    "The odds are sprinting: {team} up {swing} points to {pct}. The market saw something it loved.",
  ],
  MARKET_SURGE_DOWN: [
    "The market is BAILING on {team} — down {swing} points. Confidence draining by the second.",
    "A cold gust: {team} slide {swing} points to {pct} win chance. The money smells trouble.",
  ],
};

const COLOR = [
  // quiet-spell analyst lines; conditions gate what's eligible
  {
    key: "COLOR_MARKET_LIVE",
    when: (s) => s.odds && s.live,
    args: (s, n) => ({ home: n.home, away: n.away, pHome: pc(s.odds.pHome), pDraw: pc(s.odds.pDraw), pAway: pc(s.odds.pAway) }),
    mk: (s, n) => `The market's live read: ${n.home} ${pc(s.odds.pHome)}, draw ${pc(s.odds.pDraw)}, ${n.away} ${pc(s.odds.pAway)}. That's the world's sharpest crowd talking.`,
  },
  {
    key: "COLOR_CORNERS",
    when: (s) => s.live && s.stats.cornersH + s.stats.cornersA > 0,
    args: (s, n) => ({ corners: `${s.stats.cornersH}–${s.stats.cornersA}`, leader: s.stats.cornersH > s.stats.cornersA ? n.home : s.stats.cornersH < s.stats.cornersA ? n.away : "Neither side" }),
    mk: (s, n) => `Corners ${s.stats.cornersH}–${s.stats.cornersA}. ${s.stats.cornersH > s.stats.cornersA ? n.home : s.stats.cornersH < s.stats.cornersA ? n.away : "Neither side"} shading the territory battle.`,
  },
  {
    key: "COLOR_LEVEL",
    when: (s) => s.live && s.score.home === s.score.away,
    args: (s) => ({ score: `${s.score.home}–${s.score.away}` }),
    mk: (s) => `Still ${s.score.home}–${s.score.away}. One moment of quality — or madness — decides games like this.`,
  },
  {
    key: "COLOR_CHASING",
    when: (s) => s.live && Math.abs(s.score.home - s.score.away) === 1 && s.clockMin >= 70,
    args: (s, n) => ({ team: s.score.home > s.score.away ? n.away : n.home, minutes: Math.max(1, 90 - s.clockMin) }),
    mk: (s, n) => `${s.score.home > s.score.away ? n.away : n.home} chasing it with ${Math.max(1, 90 - s.clockMin)} minutes of normal time left. Every touch matters now.`,
  },
  {
    key: "COLOR_BOOKINGS",
    when: (s) => s.live && (s.stats.yellowH + s.stats.yellowA) >= 4,
    args: (s) => ({ bookings: s.stats.yellowH + s.stats.yellowA }),
    mk: (s) => `${s.stats.yellowH + s.stats.yellowA} bookings already — the referee is earning every penny tonight.`,
  },
  {
    key: "COLOR_MARKET_CALLED",
    when: (s) => s.live && s.odds && Math.max(s.odds.pHome, s.odds.pAway) > 0.8,
    args: (s, n) => ({ team: s.odds.pHome > s.odds.pAway ? n.home : n.away, pct: pc(Math.max(s.odds.pHome, s.odds.pAway)) }),
    mk: (s, n) => `The market has all but called it: ${s.odds.pHome > s.odds.pAway ? n.home : n.away} ${pc(Math.max(s.odds.pHome, s.odds.pAway))} to win. Football, though, has never read the odds.`,
  },
  { key: "COLOR_LATE", when: (s) => s.live && s.clockMin >= 85, args: () => ({}), mk: () => `We are deep, deep into this now. Legs heavy, minds racing, one mistake from history.` },
  {
    key: "COLOR_HALFTIME",
    when: (s) => s.phase === "HT",
    args: (s, n) => ({ home: n.home, away: n.away, score: `${s.score.home}–${s.score.away}`, market: s.odds ? `${pc(s.odds.pHome)} / ${pc(s.odds.pDraw)} / ${pc(s.odds.pAway)}` : "—" }),
    mk: (s, n) => `Half-time reading: ${n.home} ${s.score.home}–${s.score.away} ${n.away}. ${s.odds ? `The market makes it ${pc(s.odds.pHome)} / ${pc(s.odds.pDraw)} / ${pc(s.odds.pAway)} from here.` : ""}`,
  },
  {
    key: "COLOR_PREMATCH",
    when: (s) => s.phase === "NS",
    args: (s, n) => ({ home: n.home, away: n.away, market: s.odds ? `${pc(s.odds.pHome)} / ${pc(s.odds.pDraw)} / ${pc(s.odds.pAway)}` : "—" }),
    mk: (s, n) => `We're moments from kick-off. ${s.odds ? `The world's market opens at ${n.home} ${pc(s.odds.pHome)}, draw ${pc(s.odds.pDraw)}, ${n.away} ${pc(s.odds.pAway)}.` : `${n.home} against ${n.away} — settle in.`}`,
  },
];

const pc = (p) => `${Math.round(p * 100)}%`;

export class Commentator {
  constructor(state) {
    this.state = state;
    this._used = new Map(); // corpus key → last index (avoid immediate repeats)
    this._lastColorAt = 0;
    this._colorIdx = -1;
  }

  _pickFrom(key, moment = {}) {
    const pool = V[key];
    if (!pool) return null;
    // Stable across live capture and every replay: the same fixture/sequence
    // always produces the same phrase and therefore the same package hash.
    const seed = `${this.state.fixtureId}:${moment.detail?.seq ?? moment.ts ?? 0}:${key}`;
    let hash = 2166136261;
    for (let n = 0; n < seed.length; n++) hash = Math.imul(hash ^ seed.charCodeAt(n), 16777619);
    const i = (hash >>> 0) % pool.length;
    this._used.set(key, i);
    return pool[i];
  }

  /** A moment → a spoken line { text, heat 0..1, voice } or null. */
  callMoment(m) {
    const s = this.state;
    const names = { home: s.home.name, away: s.away.name };
    const team = m.team ? names[m.team] : "";
    const other = m.team ? names[m.team === "home" ? "away" : "home"] : "";
    const score = `${s.score.home}–${s.score.away}`;
    const pens = `${s.pens.home}–${s.pens.away}`;

    let key = m.type, heat = m.intensity ?? 0.5, voice = "play";
    if (m.type === "GOAL") {
      if (s.score.home === s.score.away) key = "GOAL_EQUALISER";
      else if (m.minute >= 85 && Math.abs(s.score.home - s.score.away) === 1) key = "GOAL_LATE_WINNER";
    } else if (m.type === "VAR_RESULT") {
      key = m.detail?.outcome === "Overturned" ? "VAR_RESULT_OVERTURNED" : "VAR_RESULT_STANDS";
      heat = m.detail?.outcome === "Overturned" ? 0.85 : 0.45;
    } else if (m.type === "MARKET_SURGE") {
      key = m.detail?.dir === "up" ? "MARKET_SURGE_UP" : "MARKET_SURGE_DOWN";
      voice = "market";
    }

    const tpl = this._pickFrom(key, m);
    if (!tpl) return null;
    const pctFor = m.team && s.odds ? pc(m.team === "home" ? s.odds.pHome : s.odds.pAway) : "";
    const text = tpl
      .replaceAll("{team}", team).replaceAll("{other}", other)
      .replaceAll("{home}", names.home).replaceAll("{away}", names.away)
      .replaceAll("{score}", score).replaceAll("{pens}", pens)
      .replaceAll("{min}", String(m.minute))
      .replaceAll("{swing}", String(m.detail?.swing ?? ""))
      .replaceAll("{pct}", pctFor);
    return {
      text,
      semanticKey: key,
      args: { team, other, home: names.home, away: names.away, score, pens, min: String(m.minute), swing: String(m.detail?.swing ?? ""), pct: pctFor },
      heat,
      voice,
      minute: m.minute,
      ts: m.ts,
      type: m.type,
      team: m.team ?? null,
    };
  }

  /** Called every tick; returns an analyst colour line during lulls, or null. */
  colorLine(now = Date.now(), fever = 0) {
    // Speak roughly every 35–75s, sooner when the match is hot.
    const gap = 75000 - fever * 40000;
    if (now - this._lastColorAt < gap) return null;
    const s = this.state;
    const names = { home: s.home.name, away: s.away.name };
    const eligible = COLOR.filter((c) => c.when(s));
    if (!eligible.length) return null;
    this._colorIdx = (this._colorIdx + 1) % eligible.length;
    const selected = eligible[this._colorIdx];
    const text = selected.mk(s, names).trim();
    if (!text) return null;
    this._lastColorAt = now;
    return {
      text,
      semanticKey: selected.key,
      args: selected.args(s, names),
      heat: 0.25,
      voice: "market",
      minute: s.clockMin,
      ts: now,
      type: "COLOR",
      team: null,
    };
  }
}
