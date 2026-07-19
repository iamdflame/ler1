#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Full-fixture evidence run — the COMPLETE pinned France–Spain capture, not
// the 90-second director cut.
//
// Two measurements, both from the production pipeline, nothing modeled:
//
//   A. Ledger determinism over the whole capture: every one of the captured
//      score+odds messages is ingested through EventLedger twice; the runs
//      must produce byte-identical heads. Gap/duplicate/stale counts come
//      from the ledger itself.
//
//   B. Broadcast byte measurement: the complete contiguous match block
//      (team news → game_finalised) replays through a real Room at a declared
//      speed with one standard and one low-data SSE client attached. Bytes
//      are counted by the same EvidenceMeter and client-write path production
//      uses. Signal frames tick once per wall-clock second, so their count
//      depends on the replay speed; event-driven bytes do not. Both are
//      reported separately — no extrapolation is presented as measurement.
//
// Output: evidence/full-fixture-run-<date>.json plus a console summary.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Room } from "../server/engine/room.mjs";
import { EventLedger } from "../server/ledger.mjs";
import { mapScore, mapOdds } from "../server/txline/normalize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = "b3bd417c1e28089c885a5454f654b1caadbde942";
const BASE = `https://raw.githubusercontent.com/LightCreator1007/steamline/${COMMIT}/fixtures/live-18237038/18237038`;
const EXPECTED = {
  scores: "ae639893e9a2ee0a3d23d0e18f86fbf3d4ee2e378307f62bd3adf68864261f44",
  odds: "1020eb7d8094fca5b0ec88898496d142c0899bb885f34951b0d2c7b2f3256ab5",
};
const SPEED = Number(process.env.SPEED || 32);
const FIXTURE_ID = 18237038;

const sha = (s) => createHash("sha256").update(s).digest("hex");
async function read(name) {
  const url = `${BASE}/${name}.jsonl`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = await res.text();
  const digest = sha(text);
  if (digest !== EXPECTED[name]) throw new Error(`${name} provenance hash mismatch: ${digest}`);
  return { url, digest, lines: text.split("\n").filter(Boolean).map(JSON.parse) };
}

console.log(`⏱ full-fixture evidence · fixture ${FIXTURE_ID} · speed ${SPEED}x`);
const [scoresSrc, oddsSrc] = await Promise.all([read("scores"), read("odds")]);
const events = [
  ...scoresSrc.lines.map((raw) => ({ kind: "score", raw })),
  ...oddsSrc.lines.map((raw) => ({ kind: "odds", raw })),
].sort((a, b) => Number(a.raw.Ts) - Number(b.raw.Ts));
console.log(`✓ capture verified — ${scoresSrc.lines.length} score + ${oddsSrc.lines.length} odds = ${events.length} source events`);

// ── A · whole-capture ledger determinism ─────────────────────────────────────
function ledgerRun() {
  const ledger = new EventLedger(FIXTURE_ID);
  let unmapped = 0;
  for (const e of events) {
    const u = e.kind === "score" ? mapScore(e.raw, true) : mapOdds(e.raw, true);
    if (!u || Number(u.fixtureId) !== FIXTURE_ID) { unmapped++; continue; }
    ledger.append(e.kind, { ...u, source: "txline-authentic-capture" });
  }
  return { summary: ledger.summary(), unmapped };
}
const runA1 = ledgerRun();
const runA2 = ledgerRun();
const deterministic = runA1.summary.head === runA2.summary.head
  && runA1.summary.entries === runA2.summary.entries;
if (!deterministic) throw new Error("ledger replay was NOT deterministic");
const missingSeqs = runA1.summary.gaps.reduce((n, g) => n + g.missing, 0);
console.log(`✓ ledger determinism — ${runA1.summary.entries} entries, head ${runA1.summary.head.slice(0, 16)}… identical across two runs`);
console.log(`  gaps in captured seq range: ${runA1.summary.gaps.length} (missing ${missingSeqs}) · duplicates ${runA1.summary.duplicatesRejected} · stale ${runA1.summary.staleRejected} · unmapped ${runA1.unmapped}`);

// ── B · complete match block through a production Room ──────────────────────
const MATCH_START = Date.parse("2026-07-14T00:00:00Z");
const block = events.filter((e) => Number(e.raw.Ts) >= MATCH_START);
const blockTs = block.map((e) => Number(e.raw.Ts));
const t0 = Math.min(...blockTs), t1 = Math.max(...blockTs);
console.log(`→ match block: ${block.length} events · ${new Date(t0).toISOString()} → ${new Date(t1).toISOString()} (${((t1 - t0) / 60000).toFixed(1)} min original) · ~${Math.ceil((t1 - t0) / SPEED / 60000)} min at ${SPEED}x`);

class CaptureSource {
  constructor() { this.onScore = null; this.onOdds = null; this.onDone = null; this._timers = []; this._real0 = null; }
  now() { return this._real0 === null ? Date.now() : t0 + (Date.now() - this._real0) * SPEED; }
  start() {
    this._real0 = Date.now();
    for (const e of block) {
      const delay = (Number(e.raw.Ts) - t0) / SPEED;
      this._timers.push(setTimeout(() => {
        const u = e.kind === "score" ? mapScore(e.raw, true) : mapOdds(e.raw, true);
        if (!u || Number(u.fixtureId) !== FIXTURE_ID) return;
        const delivered = { ...u, receivedAt: Date.now(), source: "txline-authentic-capture" };
        if (e.kind === "score") this.onScore?.(delivered);
        else this.onOdds?.(delivered);
      }, delay));
    }
    this._timers.push(setTimeout(() => this.onDone?.(), (t1 - t0) / SPEED + 1500));
  }
  stop() { for (const t of this._timers) clearTimeout(t); this._timers = []; }
}

const room = new Room({
  fixtureId: FIXTURE_ID,
  home: { name: "France", code: "FRA" },
  away: { name: "Spain", code: "ESP" },
  competition: "FIFA World Cup 2026", stage: "Semi-final",
}, { mode: "replay" });

// Per-event-type byte accounting: wrap the production meter (script-local).
const perEvent = {};
const meterProduced = room.evidence.produced.bind(room.evidence);
room.evidence.produced = (event, bytes, lowIncluded) => {
  const slot = (perEvent[event] ??= { count: 0, bytes: 0, lowBytes: 0 });
  slot.count++; slot.bytes += bytes; if (lowIncluded) slot.lowBytes += bytes;
  meterProduced(event, bytes, lowIncluded);
};

const fakeClient = () => {
  const sink = { bytes: 0, write(p) { sink.bytes += Buffer.byteLength(p); return true; }, on() {}, end() {} };
  return sink;
};
const standardClient = fakeClient();
const lowClient = fakeClient();

const done = new Promise((resolve) => {
  const source = new CaptureSource();
  const prevDone = () => resolve();
  room.start(source);
  const chained = source.onDone; source.onDone = () => { chained?.(); prevDone(); };
  room.addClient(standardClient, "standard");
  room.addClient(lowClient, "low");
});
await done;

const snap = room.evidence.snapshot();
const ledgerFinal = room.ledger.summary();
const finalScore = { ...room.state.score };
const evidence = {
  generatedAt: new Date().toISOString(),
  fixtureId: FIXTURE_ID,
  scope: "complete recorded fixture (not the 90-second director cut)",
  capture: {
    commit: COMMIT,
    files: [
      { name: "scores.jsonl", url: scoresSrc.url, sha256: scoresSrc.digest, events: scoresSrc.lines.length },
      { name: "odds.jsonl", url: oddsSrc.url, sha256: oddsSrc.digest, events: oddsSrc.lines.length },
    ],
    totalSourceEvents: events.length,
  },
  wholeCaptureLedger: {
    entries: runA1.summary.entries,
    head: runA1.summary.head,
    gaps: runA1.summary.gaps.length,
    missingSequenceNumbers: missingSeqs,
    capturedSeqRange: [0, 1026],
    duplicatesRejected: runA1.summary.duplicatesRejected,
    staleRejected: runA1.summary.staleRejected,
    unmappedMessages: runA1.unmapped,
    deterministicAcrossTwoRuns: deterministic,
  },
  matchBlockBroadcast: {
    note: "complete contiguous match block replayed through the production Room; signal frames tick once per wall-clock second, so signal bytes depend on replay speed — event-driven bytes do not",
    replaySpeed: SPEED,
    originalWindow: { fromTs: t0, toTs: t1, minutes: Math.round((t1 - t0) / 6000) / 10 },
    sourceEventsInBlock: block.length,
    finalScore,
    ledger: { entries: ledgerFinal.entries, head: ledgerFinal.head, gaps: ledgerFinal.gaps.length, duplicatesRejected: ledgerFinal.duplicatesRejected, staleRejected: ledgerFinal.staleRejected },
    producedBytes: { standard: snap.bandwidth.standardBytesProduced, lowData: snap.bandwidth.lowDataBytesProduced, reductionPct: Math.round((1 - snap.bandwidth.lowDataBytesProduced / snap.bandwidth.standardBytesProduced) * 1000) / 10 },
    clientWrittenBytes: { standard: standardClient.bytes, lowData: lowClient.bytes, reductionPct: Math.round((1 - lowClient.bytes / standardClient.bytes) * 1000) / 10 },
    perEvent,
    eventDrivenBytes: (() => {
      const keys = Object.keys(perEvent).filter((k) => k !== "signal");
      const std = keys.reduce((n, k) => n + perEvent[k].bytes, 0);
      const low = keys.reduce((n, k) => n + perEvent[k].lowBytes, 0);
      return { standard: std, lowData: low, reductionPct: Math.round((1 - low / std) * 1000) / 10, speedIndependent: true };
    })(),
  },
};

mkdirSync(join(ROOT, "evidence"), { recursive: true });
const outPath = join(ROOT, "evidence", "full-fixture-run-2026-07-19.json");
writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n");
console.log(`\n✓ complete-fixture run finished — France ${finalScore.home}–${finalScore.away} Spain`);
console.log(`  room ledger: ${ledgerFinal.entries} entries · head ${ledgerFinal.head}`);
console.log(`  produced bytes: standard ${snap.bandwidth.standardBytesProduced} · low-data ${snap.bandwidth.lowDataBytesProduced} (${evidence.matchBlockBroadcast.producedBytes.reductionPct}% fewer)`);
console.log(`  client-written: standard ${standardClient.bytes} · low-data ${lowClient.bytes} (${evidence.matchBlockBroadcast.clientWrittenBytes.reductionPct}% fewer)`);
console.log(`  event-driven (speed-independent): ${evidence.matchBlockBroadcast.eventDrivenBytes.standard} → ${evidence.matchBlockBroadcast.eventDrivenBytes.lowData} (${evidence.matchBlockBroadcast.eventDrivenBytes.reductionPct}% fewer)`);
console.log(`  written: ${outPath}`);
process.exit(0);
