#!/usr/bin/env node
// Build the primary judge replay from an authentic, public TxLINE capture.
//
// Source: LightCreator1007/steamline, pinned commit b3bd417…
// Match: France 0–2 Spain, fixture 18237038, World Cup semi-final.
// The selected segment contains sustained pressure, Spain's second goal,
// another goal initially recorded as 0–3, the VAR review, the counter rollback
// to 0–2, and real in-running 1X2 consensus movement. A finalisation frame is
// appended as the epilogue. The output is reduced, not fabricated: every event
// retains its original TxLINE timestamp and sequence/message id.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = "b3bd417c1e28089c885a5454f654b1caadbde942";
const PROOF_COMMIT = "2f10829f4a4e95c571a72b43eada1088c63642bd";
const PROOF_LOG_SHA256 = "6810cad65784e3a1c79b642a33bb6642ca655e88ab4483fc2aca828bf0f1ff46";
const PROOF_LOG_PATH = "mint/proof-log.ndjson";
const EXPECTED_PACKAGE_HASH = "83cc7c4266f44a2272f80deb4bcecbc97be997939ac8bc9041b233728df3c25c";
const BASE = `https://raw.githubusercontent.com/LightCreator1007/steamline/${COMMIT}/fixtures/live-18237038/18237038`;
const EXPECTED = {
  scores: "ae639893e9a2ee0a3d23d0e18f86fbf3d4ee2e378307f62bd3adf68864261f44",
  odds: "1020eb7d8094fca5b0ec88898496d142c0899bb885f34951b0d2c7b2f3256ab5",
};
const WINDOW_START = 1784060350000;
const WINDOW_END = 1784060850000;
const COMPRESSION = 6.25; // 500 source seconds → 80 director seconds

const sha = (s) => createHash("sha256").update(s).digest("hex");
async function read(name) {
  const url = `${BASE}/${name}.jsonl`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = await res.text();
  const digest = sha(text);
  if (digest !== EXPECTED[name]) throw new Error(`${name} provenance hash mismatch: ${digest}`);
  return { text, url, digest };
}

async function readProofLog() {
  const url = `https://raw.githubusercontent.com/danySSG/moment-mints/${PROOF_COMMIT}/${PROOF_LOG_PATH}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = await res.text();
  const digest = sha(text);
  if (digest !== PROOF_LOG_SHA256) throw new Error(`proof-log provenance hash mismatch: ${digest}`);
  return { text, url, digest };
}

const [scoreSource, oddsSource, proofSource] = await Promise.all([read("scores"), read("odds"), readProofLog()]);
const parseLines = (text) => text.split("\n").filter(Boolean).map(JSON.parse);
const scores = parseLines(scoreSource.text);
const odds = parseLines(oddsSource.text);

const baselineRaw = scores
  .filter((x) => Number(x.Ts) < WINDOW_START && x.Stats)
  .sort((a, b) => Number(b.Ts) - Number(a.Ts))[0];
if (!baselineRaw) throw new Error("authentic capture has no pre-window baseline");
const baselineEvent = {
  kind: "score",
  atMs: 0,
  baseline: true,
  payload: {
    FixtureId: Number(baselineRaw.FixtureId), Seq: Number(baselineRaw.Seq), Ts: Number(baselineRaw.Ts),
    StatusId: baselineRaw.StatusId, Action: null, Clock: baselineRaw.Clock,
    Stats: Object.fromEntries(Object.entries(baselineRaw.Stats).filter(([k]) => Number(k) <= 8)),
  },
};

const reducedScores = scores
  .filter((x) => Number(x.Ts) >= WINDOW_START && Number(x.Ts) <= WINDOW_END)
  .sort((a, b) => Number(a.Ts) - Number(b.Ts) || Number(a.Seq) - Number(b.Seq))
  .map((x) => ({
    kind: "score",
    atMs: Math.round((Number(x.Ts) - WINDOW_START) / COMPRESSION),
    payload: {
      FixtureId: Number(x.FixtureId), Seq: Number(x.Seq), Ts: Number(x.Ts),
      StatusId: x.StatusId, Action: x.Action, Clock: x.Clock,
      Stats: x.Stats ? Object.fromEntries(Object.entries(x.Stats).filter(([k]) => Number(k) <= 8)) : undefined,
      Data: x.Data, Participant: x.Participant, Possession: x.Possession,
      PossessionType: x.PossessionType,
    },
  }));

// The probability river only needs the full-game 1X2 consensus row. Keep every
// authentic point in the selected window, including message ids for audit.
const reducedOdds = odds
  .filter((x) => Number(x.Ts) >= WINDOW_START && Number(x.Ts) <= WINDOW_END)
  .filter((x) => x.SuperOddsType === "1X2_PARTICIPANT_RESULT" && !x.MarketPeriod)
  .sort((a, b) => Number(a.Ts) - Number(b.Ts))
  .map((x) => ({
    kind: "odds",
    atMs: Math.round((Number(x.Ts) - WINDOW_START) / COMPRESSION),
    payload: {
      FixtureId: Number(x.FixtureId), MessageId: x.MessageId, Ts: Number(x.Ts),
      InRunning: x.InRunning, SuperOddsType: x.SuperOddsType,
      PriceNames: x.PriceNames, Pct: x.Pct,
    },
  }));

const finalRaw = scores
  .filter((x) => x.Action === "game_finalised")
  .sort((a, b) => Number(b.Ts) - Number(a.Ts))[0];
if (!finalRaw) throw new Error("authentic capture has no game_finalised frame");
const finalEvent = {
  kind: "score", atMs: 86_000, directorCut: true,
  payload: {
    FixtureId: Number(finalRaw.FixtureId), Seq: Number(finalRaw.Seq), Ts: Number(finalRaw.Ts),
    StatusId: 100, Action: "game_finalised", Clock: finalRaw.Clock,
    Stats: Object.fromEntries(Object.entries(finalRaw.Stats || {}).filter(([k]) => Number(k) <= 8)),
    Data: finalRaw.Data, Participant: finalRaw.Participant,
  },
};

const proofRows = parseLines(proofSource.text);
const proofRequirements = [
  { seq: 618, observedSeq: 619, statKey: 2, value: 2, event: "GOAL", txSig: "25GkSpdG4zciFc9z4cLUtWmowh9fYrH6YgzTb5GF8eDxZarXbLeDofvQPTK58MuHffE2HFiuAURhAj8zXefFZsKD" },
  { seq: 641, observedSeq: 641, statKey: 2, value: 3, event: "GOAL", txSig: "34ZXkqc9F44UfeLqqzWhCfshJugDCJsuWTU6SMVduKBh5LBvMdNo3XmvTchrfBZSswCPRXwJyH7XkkpzgyjQVxr" },
  { seq: 682, observedSeq: 683, statKey: 2, value: 2, event: "GOAL_REVOKED", supersedesSeq: 641, txSig: "4EVqXiQztFnDjDPTLyFtfeHRjazNYts9ZYGzHz1cQ8enisUpxPZsdhAVfRsdN2dFfGPe7jaJ2Z6dAaDFvGo1hdWh" },
];
const proofEvidence = proofRequirements.map((requirement) => {
  const archived = proofRows.find((row) => Number(row.fixtureId) === 18237038
    && Number(row.seq) === requirement.seq
    && Number(row.statKey) === requirement.statKey
    && Number(row.value) === requirement.value
    && row.txSig === requirement.txSig);
  if (!archived?.ok) throw new Error(`proof-log record missing for sequence ${requirement.seq}`);
  return {
    ...requirement,
    network: "devnet",
    epochDay: Number(archived.epochDay),
    recordStatus: "archived-proof-log-record",
    explorer: archived.explorer,
  };
});

const events = [baselineEvent, ...reducedScores, ...reducedOdds, finalEvent]
  .sort((a, b) => a.atMs - b.atMs || (a.kind === "score" ? -1 : 1));
if (events.length !== 56 || events.filter((event) => event.kind === "score").length !== 48 || reducedOdds.length !== 8) {
  throw new Error("unexpected authentic replay event counts");
}
if (events.filter((event) => event.baseline).length !== 1 || events.filter((event) => event.directorCut).length !== 1) {
  throw new Error("authentic replay requires exactly one baseline and one director cut");
}
const packageWithoutHash = {
  version: 1,
  authentic: true,
  fixture: {
    fixtureId: 18237038,
    home: { name: "France", code: "FRA" },
    away: { name: "Spain", code: "ESP" },
    participant1IsHome: true,
    competition: "FIFA World Cup 2026",
    stage: "Semi-final",
    venue: "",
    startTime: 1784055600000,
    finalScore: { home: 0, away: 2 },
  },
  director: {
    title: "The goal that happened twice",
    durationMs: 90_000,
    sourceWindow: { fromTs: WINDOW_START, toTs: WINDOW_END, compression: COMPRESSION },
    finalCutAtMs: 86_000,
  },
  provenance: {
    captureRepo: "LightCreator1007/steamline",
    captureCommit: COMMIT,
    capturePaths: ["fixtures/live-18237038/18237038/scores.jsonl", "fixtures/live-18237038/18237038/odds.jsonl"],
    scoreSha256: scoreSource.digest,
    oddsSha256: oddsSource.digest,
    scoreUrl: scoreSource.url,
    oddsUrl: oddsSource.url,
    proofRepo: "danySSG/moment-mints",
    proofCommit: PROOF_COMMIT,
    proofLogPath: PROOF_LOG_PATH,
    proofLogSha256: PROOF_LOG_SHA256,
    proofLogUrl: `https://github.com/danySSG/moment-mints/blob/${PROOF_COMMIT}/${PROOF_LOG_PATH}`,
    note: "Public TxLINE capture, reduced deterministically. Proof signatures are commit-pinned archived proof-log records; they are not presented as currently retrievable or chain-verified. Adjacent proof/observed sequences come from independent public captures.",
  },
  proofEvidence,
  events,
};
const canonical = JSON.stringify(packageWithoutHash);
const output = { ...packageWithoutHash, packageHash: sha(canonical) };
if (output.packageHash !== EXPECTED_PACKAGE_HASH) throw new Error(`package hash changed: ${output.packageHash}`);
const dir = join(ROOT, "fixtures", "authentic");
mkdirSync(dir, { recursive: true });
const out = join(dir, "france-spain-18237038.json");
writeFileSync(out, JSON.stringify(output));
console.log(`wrote ${out}`);
console.log(`  ${events.length} authentic events · ${reducedScores.length} scores · ${reducedOdds.length} 1X2 points`);
console.log(`  package sha256 ${output.packageHash}`);
