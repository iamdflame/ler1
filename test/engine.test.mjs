// ROARLINE engine tests — the parts that must never lie:
// counter-diff moment detection, VAR reversals, phase transitions, odds
// narration, and the defensive TxLINE payload normalizer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newMatchState, applyScoreUpdate, applyOddsUpdate, STAT } from "../server/engine/state.mjs";
import { mapScore, mapOdds, mapFixture } from "../server/txline/normalize.mjs";
import { DramaEngine } from "../server/engine/drama.mjs";
import { Commentator } from "../server/engine/commentary.mjs";
import { localizeLine } from "../web/js/i18n.js";
import { LiveSource } from "../server/sources/live.mjs";

const META = { fixtureId: 1, home: { name: "Spain", code: "ESP" }, away: { name: "Japan", code: "JPN" } };
const t0 = 1_700_000_000_000;

function play(state, updates) {
  const all = [];
  for (const u of updates) all.push(...applyScoreUpdate(state, u));
  return all;
}

test("goal detected from counter diff, score follows", () => {
  const s = newMatchState(META);
  const moments = play(s, [
    { seq: 1, ts: t0, phase: 2, stats: { [STAT.GOALS_H]: 0, [STAT.GOALS_A]: 0 } },
    { seq: 2, ts: t0 + 60_000, phase: 2, stats: { [STAT.GOALS_H]: 1, [STAT.GOALS_A]: 0 } },
  ]);
  assert.equal(s.score.home, 1);
  const goal = moments.find((m) => m.type === "GOAL");
  assert.ok(goal, "GOAL moment emitted");
  assert.equal(goal.team, "home");
  assert.equal(goal.detail.statKey, STAT.GOALS_H);
  assert.equal(goal.detail.seq, 2);
  assert.equal(goal.detail.statValue, 1);
});

test("VAR reversal: counter decrement revokes the goal", () => {
  const s = newMatchState(META);
  const moments = play(s, [
    { seq: 1, ts: t0, phase: 2, stats: { [STAT.GOALS_A]: 1 } },
    { seq: 2, ts: t0 + 90_000, phase: 2, stats: { [STAT.GOALS_A]: 0 } },
  ]);
  assert.equal(s.score.away, 0);
  assert.ok(moments.some((m) => m.type === "GOAL_REVOKED" && m.team === "away"));
});

test("gap in feed (0→2) yields two goal moments", () => {
  const s = newMatchState(META);
  const moments = play(s, [
    { seq: 1, ts: t0, phase: 2, stats: { [STAT.GOALS_H]: 0 } },
    { seq: 5, ts: t0 + 300_000, phase: 2, stats: { [STAT.GOALS_H]: 2 } },
  ]);
  assert.equal(moments.filter((m) => m.type === "GOAL").length, 2);
  assert.ok(moments.filter((m) => m.type === "GOAL").every((m) => m.detail.statValue === 2));
  assert.equal(s.score.home, 2);
});

test("stale sequence is ignored", () => {
  const s = newMatchState(META);
  play(s, [{ seq: 5, ts: t0, phase: 2, stats: { [STAT.GOALS_H]: 1 } }]);
  const late = play(s, [{ seq: 3, ts: t0 - 10_000, phase: 2, stats: { [STAT.GOALS_H]: 0 } }]);
  assert.equal(late.length, 0);
  assert.equal(s.score.home, 1);
});

test("phase walk NS→H1→HT→H2→FT emits the broadcast beats", () => {
  const s = newMatchState(META);
  const moments = play(s, [
    { seq: 1, ts: t0, phase: 1, stats: {} },
    { seq: 2, ts: t0 + 1000, phase: 2, stats: {} },
    { seq: 3, ts: t0 + 2000, phase: 3, stats: {} },
    { seq: 4, ts: t0 + 3000, phase: 4, stats: {} },
    { seq: 5, ts: t0 + 4000, phase: 5, stats: {} },
  ]);
  const types = moments.map((m) => m.type);
  assert.deepEqual(types, ["KICKOFF", "HALFTIME", "SECOND_HALF", "FULLTIME"]);
  assert.equal(s.finished, true);
  assert.equal(s.live, false);
});

test("game_finalised (statusId 100) marks broadcast final", () => {
  const s = newMatchState(META);
  play(s, [{ seq: 1, ts: t0, phase: 100, stats: {} }]);
  assert.equal(s.phase, "FINAL");
  assert.equal(s.finished, true);
});

test("odds swing ≥8pts emits MARKET_SURGE with direction", () => {
  const s = newMatchState(META);
  applyOddsUpdate(s, { ts: t0, pHome: 0.4, pDraw: 0.3, pAway: 0.3 });
  const m = applyOddsUpdate(s, { ts: t0 + 5000, pHome: 0.55, pDraw: 0.25, pAway: 0.2 });
  assert.equal(m[0]?.type, "MARKET_SURGE");
  assert.equal(m[0].team, "home");
  assert.equal(m[0].detail.dir, "up");
  const quiet = applyOddsUpdate(s, { ts: t0 + 9000, pHome: 0.56, pDraw: 0.245, pAway: 0.195 });
  assert.equal(quiet.length, 0, "small drift is not narrated");
});

test("commentator calls a goal with the right score and team", () => {
  const s = newMatchState(META);
  const voice = new Commentator(s);
  const moments = play(s, [
    { seq: 1, ts: t0, phase: 2, stats: { [STAT.GOALS_H]: 1 } },
  ]);
  const goal = moments.find((m) => m.type === "GOAL");
  const line = voice.callMoment(goal);
  assert.ok(line.text.includes("1–0"));
  assert.ok(line.text.includes("Spain"));
  assert.ok(line.heat >= 0.9);
});

test("quiet-spell commentary carries deterministic multilingual semantics", () => {
  const s = newMatchState(META);
  s.live = true;
  s.phase = "H2";
  s.stats.cornersH = 3;
  s.stats.cornersA = 1;
  const line = new Commentator(s).colorLine(t0, 0.2);
  assert.equal(line.semanticKey, "COLOR_CORNERS");
  assert.equal(line.args.leader, "Spain");
  assert.match(localizeLine(line, "es"), /Córners 3–1.*Spain/);
  assert.match(localizeLine(line, "fr"), /Corners 3–1.*Spain/);
  assert.match(localizeLine(line, "pt"), /Escanteios 3–1.*Spain/);
});

test("drama: goal spikes fever, then decays", () => {
  const s = newMatchState(META);
  s.live = true;
  const d = new DramaEngine(s);
  const calm = d.tick(t0).fever;
  d.onMoment({ type: "GOAL", team: "home", intensity: 1 });
  const spike = d.tick(t0 + 1000).fever;
  assert.ok(spike > calm + 0.3, `spike ${spike} should clear calm ${calm}`);
  let later = spike;
  for (let i = 2; i < 90; i++) later = d.tick(t0 + i * 1000).fever;
  assert.ok(later < spike - 0.2, "fever decays");
});

// ── normalizer ────────────────────────────────────────────────────────────────
test("mapScore tolerates PascalCase and camelCase", () => {
  const a = mapScore({ FixtureId: 7, Seq: 3, Ts: t0, StatusId: 2, Stats: { 1: 1, 2: 0 }, Action: "goal" });
  assert.deepEqual([a.fixtureId, a.seq, a.phase, a.stats[1]], [7, 3, 2, 1]);
  const b = mapScore({ fixtureId: 7, seq: 4, ts: String(t0), statusId: 4, stats: { 2: { Value: 2 } } });
  assert.deepEqual([b.fixtureId, b.seq, b.phase, b.stats[2]], [7, 4, 4, 2]);
});

test("live snapshot delivery is explicitly baseline hydration", () => {
  const source = new LiveSource({ fixtureId: 7 });
  let delivered;
  source.onScore = (update) => { delivered = update; };
  source._deliver("score", {
    FixtureId: 7,
    Seq: 99,
    Ts: t0,
    StatusId: 4,
    Stats: { 1: 2, 2: 1, 3: 4, 4: 2 },
  }, { baseline: true });
  assert.equal(delivered.baseline, true);
  const state = newMatchState({ ...META, fixtureId: 7 });
  assert.deepEqual(applyScoreUpdate(state, delivered), []);
  assert.deepEqual(state.score, { home: 2, away: 1 });
});

test("live hydration buffers stream events and flushes only updates newer than baseline", () => {
  const source = new LiveSource({ fixtureId: 7 });
  const delivered = [];
  source.onScore = (update) => delivered.push(update);
  source._hydrating = true;
  source._deliver("score", { FixtureId: 7, Seq: 100, Ts: t0 + 1000, Stats: { 1: 2 } });
  source._deliver("score", { FixtureId: 7, Seq: 98, Ts: t0 - 1000, Stats: { 1: 0 } });
  source._deliver("score", { FixtureId: 7, Seq: 99, Ts: t0, Stats: { 1: 1 } }, { baseline: true });
  assert.deepEqual(delivered.map((update) => update.seq), [99]);
  source._finishHydration();
  assert.deepEqual(delivered.map((update) => update.seq), [99, 100]);
});

test("mapScore parses Clock.Seconds separately from minute fields", () => {
  assert.equal(mapScore({ FixtureId: 7, Clock: { Seconds: 2700 } }).clockMin, 45);
  assert.equal(mapScore({ FixtureId: 7, Minute: 300, Clock: { Seconds: 60 } }).clockMin, 300);
});

test("mapScore mirrors paired keys when Participant2 is the home side", () => {
  const u = mapScore({ FixtureId: 7, Seq: 1, Ts: t0, Stats: { 1: 3, 2: 1, 1001: 2 } }, /*homeIsP1*/ false);
  assert.equal(u.stats[2], 3, "P1 goals become away→home mirrored");
  assert.equal(u.stats[1], 1);
  assert.equal(u.stats[1002], 2, "period prefix preserved in mirror");
});

test("display teams retain participant-oriented receipt coordinates", () => {
  const state = newMatchState({ ...META, participant1IsHome: false });
  const update = mapScore({ FixtureId: 1, Seq: 1, Ts: t0, Stats: { 1: 1, 2: 0 } }, false);
  const goal = applyScoreUpdate(state, update).find((moment) => moment.type === "GOAL");
  assert.equal(goal.team, "away", "Participant1 is display-away");
  assert.equal(goal.detail.statKey, STAT.GOALS_A, "engine coordinate remains display-oriented");
  assert.equal(goal.detail.sourceStatKey, 1, "proof coordinate remains participant-oriented");
  assert.equal(goal.detail.sourceParticipant, 1);
});

test("mapOdds finds a 1X2 triple across shapes and normalizes", () => {
  const flat = mapOdds({ FixtureId: 9, Ts: t0, PctP1: 52, PctX: 26, PctP2: 22, InRunning: true });
  assert.ok(Math.abs(flat.pHome - 0.52) < 0.001 && flat.inRunning);
  const nested = mapOdds({
    fixtureId: 9, ts: t0,
    Outcomes: [{ Name: "1", Pct: 0.41 }, { Name: "X", Pct: 0.31 }, { Name: "2", Pct: 0.28 }],
  });
  assert.ok(Math.abs(nested.pHome + nested.pDraw + nested.pAway - 1) < 1e-9);
  assert.equal(mapOdds({ FixtureId: 9, SomethingElse: 1 }), null, "unknown shapes are skipped, not crashed");
});

test("mapOdds accepts TxLINE percentage strings from the authentic capture", () => {
  const odds = mapOdds({
    FixtureId: 18237038,
    Ts: t0,
    Pct: ["14.231", "28.058", "57.703"],
  });
  assert.ok(odds);
  assert.equal(odds.fixtureId, 18237038);
  assert.ok(Math.abs(odds.pHome + odds.pDraw + odds.pAway - 1) < 1e-12);
  assert.ok(odds.pAway > odds.pDraw && odds.pDraw > odds.pHome);
});

test("mapFixture honours Participant1IsHome=false", () => {
  const f = mapFixture({ FixtureId: 5, Participant1: "Japan", Participant2: "Spain", Participant1IsHome: false, StartTime: t0 });
  assert.equal(f.home.name, "Spain");
  assert.equal(f.away.name, "Japan");
  assert.equal(f.participant1IsHome, false);
});
