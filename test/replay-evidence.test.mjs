import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { Room } from "../server/engine/room.mjs";
import { EventLedger } from "../server/ledger.mjs";
import { Hub } from "../server/hub.mjs";

const RECEIPT_PROGRAM_ID = "6d1Se4dj5yw11sDeT2Uss7iNVxuecHRMazZ1wgB32HFy";

test("receipt program identity is consistent across committed surfaces", async () => {
  const [source, anchor, config, publicIdl, targetIdl] = await Promise.all([
    readFile(new URL("../programs/roarline-receipts/src/lib.rs", import.meta.url), "utf8"),
    readFile(new URL("../Anchor.toml", import.meta.url), "utf8"),
    readFile(new URL("../server/config.mjs", import.meta.url), "utf8"),
    readFile(new URL("../idl/roarline_receipts.json", import.meta.url), "utf8"),
    readFile(new URL("../target/idl/roarline_receipts.json", import.meta.url), "utf8"),
  ]);

  assert.match(source, new RegExp(`declare_id!\\(\"${RECEIPT_PROGRAM_ID}\"\\)`));
  assert.match(anchor, new RegExp(`roarline_receipts = \"${RECEIPT_PROGRAM_ID}\"`));
  assert.match(config, new RegExp(`programId: env\\(\"ROARLINE_RECEIPT_PROGRAM_ID\", \"${RECEIPT_PROGRAM_ID}\"\\)`));
  assert.deepEqual(JSON.parse(publicIdl), JSON.parse(targetIdl));
  assert.equal(JSON.parse(publicIdl).address, RECEIPT_PROGRAM_ID);
});
import { momentProof } from "../server/proofs.mjs";
import { loadHeroPackage } from "../server/sources/hero.mjs";
import { LiveSource } from "../server/sources/live.mjs";
import { TxlineClient } from "../server/txline/client.mjs";
import { mapOdds, mapScore } from "../server/txline/normalize.mjs";

function ingestHero() {
  const pkg = loadHeroPackage();
  const room = new Room(pkg.fixture, { mode: "authentic-replay" });
  for (const event of pkg.events) {
    const common = {
      receivedAt: 1_800_000_000_000 + event.atMs,
      source: "txline-authentic-capture",
      sourcePackageHash: pkg.packageHash,
      directorAtMs: event.atMs,
    };
    if (event.kind === "score") {
      const update = mapScore(event.payload, true);
      room._ingestScore({
        ...update,
        ...common,
        directorCut: Boolean(event.directorCut),
        baseline: Boolean(event.baseline),
      });
    } else {
      const update = mapOdds(event.payload, true);
      room._ingestOdds({ ...update, ...common, messageId: event.payload.MessageId });
    }
  }
  return room;
}

test("authentic replay is deterministic across ledger and package hashes", () => {
  const first = ingestHero();
  const second = ingestHero();
  assert.equal(first.ledger.entries.length, loadHeroPackage().events.length);
  assert.ok(first.state.odds, "authentic consensus odds reach the runtime state");
  assert.equal(first.ledger.head, second.ledger.head);
  assert.deepEqual(
    first.timeline.filter((entry) => entry.kind === "moment").map((entry) => entry.packageHash),
    second.timeline.filter((entry) => entry.kind === "moment").map((entry) => entry.packageHash),
  );
});

test("checked-in reference evidence matches the deterministic replay on disk", () => {
  const reference = JSON.parse(readFileSync(new URL("../evidence/reference-run-2026-07-19.json", import.meta.url), "utf8"));
  const room = ingestHero();
  assert.equal(loadHeroPackage().packageHash, reference.sourcePackageSha256);
  assert.equal(room.ledger.head, reference.ledger.head);
  assert.deepEqual(
    room.timeline.filter((entry) => entry.kind === "moment").map((entry) => entry.packageHash),
    reference.momentPackageHashes,
  );
});

test("concurrent room requests share one replay room", async () => {
  const pkg = loadHeroPackage();
  const hub = new Hub();
  hub.fixtures.set(String(pkg.fixture.fixtureId), pkg.fixture);
  const [first, second] = await Promise.all([
    hub.roomFor(pkg.fixture.fixtureId, {}),
    hub.roomFor(pkg.fixture.fixtureId, {}),
  ]);
  assert.equal(first, second);
  assert.equal(hub.rooms.size, 1);
  first.stop();
});

test("automatic live opening and API room creation converge on one room", async () => {
  const pkg = loadHeroPackage();
  const originalStart = LiveSource.prototype.start;
  LiveSource.prototype.start = function startWithoutNetwork() {};
  try {
    for (const autoFirst of [true, false]) {
      const hub = new Hub();
      const fixture = { ...pkg.fixture, startTime: Date.now() };
      const key = String(fixture.fixtureId);
      hub.fixtures.set(key, fixture);

      let automaticCreation;
      const openLive = hub._openLive.bind(hub);
      hub._openLive = (candidate) => {
        const pending = openLive(candidate);
        automaticCreation ??= pending;
        return pending;
      };

      let apiCreation;
      if (autoFirst) {
        hub._autoOpenLiveRooms();
        apiCreation = hub.roomFor(key, {});
      } else {
        apiCreation = hub.roomFor(key, {});
        hub._autoOpenLiveRooms();
      }

      assert.ok(automaticCreation, "automatic live opening started");
      const [automaticRoom, apiRoom] = await Promise.all([automaticCreation, apiCreation]);
      assert.equal(automaticRoom, apiRoom, `${autoFirst ? "automatic" : "API"} creation won without replacement`);
      assert.equal(hub.rooms.get(key), apiRoom);
      assert.equal(hub.rooms.size, 1);
      apiRoom.stop();
    }
  } finally {
    LiveSource.prototype.start = originalStart;
  }
});

test("failed JWT renewal does not poison later renewal attempts", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1
    ? new Response("unavailable", { status: 503 })
    : Response.json({ token: "recovered" });
  try {
    const client = new TxlineClient();
    await assert.rejects(client._renewJwt(), /HTTP 503/);
    assert.equal(await client._renewJwt(), "recovered");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hero proof evidence is an archived record, not current chain verification", async () => {
  const pkg = loadHeroPackage();
  assert.equal(pkg.provenance.proofCommit, "2f10829f4a4e95c571a72b43eada1088c63642bd");
  assert.equal(pkg.provenance.proofLogSha256, "6810cad65784e3a1c79b642a33bb6642ca655e88ab4483fc2aca828bf0f1ff46");
  const proof = await momentProof(pkg.fixture.fixtureId, 619, 2, {
    sourceTs: 1,
    packageHash: "a".repeat(64),
    eventType: "GOAL",
    eventValue: 2,
  });
  assert.equal(proof.archivedProofRecord, true);
  assert.equal(proof.currentRpcVerified, false);
  assert.equal(proof.rpcAvailable, false);
  assert.equal(proof.receiptStatus, "archived-proof-log-record");
  assert.equal("sourceVerified" in proof, false);
  assert.match(proof.proofReferenceUrl, new RegExp(pkg.provenance.proofCommit));
});

test("authentic baseline hydrates 0–1 without emitting a goal", () => {
  const pkg = loadHeroPackage();
  const baseline = pkg.events[0];
  const room = new Room(pkg.fixture, { mode: "authentic-replay" });
  room._ingestScore({
    ...mapScore(baseline.payload, true),
    source: "txline-authentic-capture",
    sourcePackageHash: pkg.packageHash,
    directorAtMs: baseline.atMs,
    baseline: true,
  });
  assert.deepEqual(room.state.score, { home: 0, away: 1 });
  assert.equal(room.timeline.length, 0);
});

test("0–3 goal is hash-linked to the later 0–2 correction", () => {
  const room = ingestHero();
  const goal = room.timeline.find((entry) => entry.type === "GOAL" && entry.detail?.seq === 641);
  const correction = room.timeline.find((entry) => entry.type === "GOAL_REVOKED" && entry.detail?.seq === 683);
  assert.ok(goal && correction);
  assert.equal(goal.detail.statValue, 3);
  assert.equal(correction.detail.statValue, 2);
  assert.equal(correction.supersedes, goal.packageHash);
  assert.equal(goal.supersededBy, correction.packageHash);
});

test("multi-delta reversals link active goal packages in LIFO order", () => {
  const room = new Room({
    fixtureId: 77,
    home: { name: "Home", code: "HOM" },
    away: { name: "Away", code: "AWY" },
  }, { mode: "replay" });
  const score = (seq, away, baseline = false) => room._ingestScore({
    fixtureId: 77,
    seq,
    ts: 1_700_000_000_000 + seq,
    phase: 4,
    stats: { 1: 0, 2: away },
    source: "test",
    baseline,
  });
  score(1, 0, true);
  score(2, 2);
  score(3, 1);
  score(4, 0);
  const goals = room.timeline.filter((entry) => entry.kind === "moment" && entry.type === "GOAL");
  const corrections = room.timeline.filter((entry) => entry.kind === "moment" && entry.type === "GOAL_REVOKED");
  assert.equal(goals.length, 2);
  assert.equal(corrections[0].supersedes, goals[1].packageHash);
  assert.equal(corrections[1].supersedes, goals[0].packageHash);
  assert.equal(goals[1].supersededBy, corrections[0].packageHash);
  assert.equal(goals[0].supersededBy, corrections[1].packageHash);
});

test("director-cut finalisation hydrates omitted counters without false events", () => {
  const room = ingestHero();
  const finalMoments = room.timeline.filter((entry) => entry.sourceTs === 1784063054751 && entry.kind === "moment");
  assert.deepEqual(finalMoments.map((entry) => entry.type), ["FINALISED"]);
  assert.deepEqual(room.state.score, { home: 0, away: 2 });
  assert.equal(room.state.clockMin, 90);
  assert.equal(room.state.stats.yellowH, 2);
  assert.equal(room.state.stats.cornersH, 7);
});

test("ledger rejects duplicate and stale source updates before mutation", () => {
  const ledger = new EventLedger(99);
  assert.equal(ledger.append("score", { fixtureId: 99, seq: 10, ts: 10 }).rejected, undefined);
  assert.equal(ledger.append("score", { fixtureId: 99, seq: 10, ts: 10 }).duplicate, true);
  assert.equal(ledger.append("score", { fixtureId: 99, seq: 9, ts: 9 }).stale, true);
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.summary().duplicatesRejected, 1);
  assert.equal(ledger.summary().staleRejected, 1);
});

test("measured low-data serialization is smaller than standard", () => {
  const room = ingestHero();
  const snapshot = room.evidenceSnapshot();
  const bandwidth = snapshot.bandwidth;
  assert.ok(bandwidth.standardBytesProduced > 0);
  assert.ok(bandwidth.lowDataBytesProduced > 0);
  assert.ok(bandwidth.lowDataBytesProduced < bandwidth.standardBytesProduced);
  assert.ok(Number.isFinite(snapshot.startedAt));
  assert.equal(snapshot.finishedAt, null);
  assert.equal(snapshot.ledger.gapPolicy, "expected-director-cut-omissions");
  assert.match(snapshot.ledger.gapExplanation, /director cut/);
});

test("render telemetry is bound to an active client and emitted package", () => {
  const room = ingestHero();
  const moment = room.timeline.find((entry) => entry.kind === "moment");
  const packageHash = moment?.packageHash;
  const response = { write() {} };
  room.clients.set(response, { profile: "standard", telemetryToken: "active-token" });
  room._broadcast("moment", moment);
  assert.equal(room.recordFrameAck("wrong-token", packageHash, 12), false);
  assert.equal(room.recordFrameAck("active-token", "0".repeat(64), 12), false);
  assert.equal(room.recordFrameAck("active-token", packageHash, Number.NaN), false);
  assert.equal(room.recordFrameAck("active-token", packageHash, -1), false);
  assert.equal(room.recordFrameAck("active-token", packageHash, 120_000), false);
  assert.equal(room.recordFrameAck("active-token", packageHash, 12), true);
  assert.equal(room.recordFrameAck("active-token", packageHash, 1), false, "duplicate package sample rejected");
  const latency = room.evidence.snapshot().latencyMs;
  assert.equal(latency.browserEventToAnimationFrame.samples, 1);
  assert.equal(latency.serverWriteToFrameAck.samples, 1);
});

test("completed evidence does not accumulate post-replay server output", () => {
  const room = ingestHero();
  room.evidence.finish();
  const before = room.evidence.snapshot();
  room._broadcast("signal", { fixtureId: room.meta.fixtureId, clockMin: 65 });
  room.evidence.connected(99);
  room.evidence.written("standard", 999);
  room.evidence.rendered(12);
  assert.equal(room.recordFrameAck("unused", "0".repeat(64), 12), false);
  const after = room.evidence.snapshot();
  assert.deepEqual(after.events, before.events);
  assert.deepEqual(after.bandwidth, before.bandwidth);
  assert.deepEqual(after.listeners, before.listeners);
});

test("completed replay evidence remains available until a future replay replaces it", () => {
  const room = new Room({
    fixtureId: 88,
    home: { name: "Home", code: "HOM" },
    away: { name: "Away", code: "AWY" },
  }, { mode: "replay" });
  let removed = false;
  room.onEmpty = () => { removed = true; };
  room.start({
    start() { this.onDone(); },
    stop() {},
  });
  assert.equal(room.evidence.finishedAt !== null, true);
  assert.equal(removed, false);
  assert.equal(room.evidenceSnapshot().finishedAt, room.evidence.finishedAt);
});
