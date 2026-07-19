import test from "node:test";
import assert from "node:assert/strict";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  dailyRootsPda,
  deriveReceiptPda,
  epochDayFromTimestamp,
  mapTxlineProof,
  validateExistingReceiptAccount,
} from "../server/receipts.mjs";

const ORACLE = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const PROGRAM = new PublicKey("6d1Se4dj5yw11sDeT2Uss7iNVxuecHRMazZ1wgB32HFy");
const BROADCASTER = new PublicKey("7v91N7iZQtwU4u6KUi8Se8zDNcG7QxH7MNCnNu9Q2t4N");
const TS = 1_784_060_350_000;
const hex = (byte) => Buffer.alloc(32, byte).toString("hex");

function proofBundle() {
  return {
    summary: {
      fixtureId: 18_237_038,
      updateStats: { updateCount: 17, minTimestamp: TS, maxTimestamp: TS + 299_999 },
      eventStatsSubTreeRoot: Buffer.alloc(32, 1).toString("base64"),
    },
    subTreeProof: [{ hash: `0x${hex(2)}`, isRightSibling: true }],
    mainTreeProof: [{ hash: [...Buffer.alloc(32, 3)], isRightSibling: false }],
    statToProve: { key: 2, value: 3, period: 0 },
    eventStatRoot: { type: "Buffer", data: [...Buffer.alloc(32, 4)] },
    statProof: [{ hash: Buffer.alloc(32, 5).toString("base64"), isRightSibling: true }],
  };
}

test("TxLINE proof bundle maps exactly to the Anchor argument shape", () => {
  const mapped = mapTxlineProof(proofBundle(), BN);
  assert.equal(mapped.proofTs.toString(), String(TS));
  assert.equal(mapped.fixtureSummary.fixtureId.toString(), "18237038");
  assert.equal(mapped.fixtureSummary.updateStats.updateCount, 17);
  assert.deepEqual(mapped.fixtureSummary.eventsSubTreeRoot, [...Buffer.alloc(32, 1)]);
  assert.deepEqual(mapped.fixtureProof[0], { hash: [...Buffer.alloc(32, 2)], isRightSibling: true });
  assert.deepEqual(mapped.mainTreeProof[0], { hash: [...Buffer.alloc(32, 3)], isRightSibling: false });
  assert.deepEqual(mapped.statA.statToProve, { key: 2, value: 3, period: 0 });
  assert.deepEqual(mapped.statA.eventStatRoot, [...Buffer.alloc(32, 4)]);
  assert.deepEqual(mapped.statA.statProof[0].hash, [...Buffer.alloc(32, 5)]);
});

test("proof mapper rejects malformed hashes and unsafe numeric fields", () => {
  const badHash = proofBundle();
  badHash.eventStatRoot = "AA==";
  assert.throws(() => mapTxlineProof(badHash, BN), /expected 32-byte proof node/);

  const unsafe = proofBundle();
  unsafe.summary.fixtureId = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => mapTxlineProof(unsafe, BN), /proof fixture is out of range/);
});

test("daily roots PDA uses the exact u16 little-endian epoch day", () => {
  const day = epochDayFromTimestamp(TS);
  const seed = Buffer.alloc(2);
  seed.writeUInt16LE(day);
  const expected = PublicKey.findProgramAddressSync([Buffer.from("daily_scores_roots"), seed], ORACLE)[0];
  assert.ok(dailyRootsPda(PublicKey, ORACLE, TS).equals(expected));
  assert.throws(() => epochDayFromTimestamp(65_536 * 86_400_000), /u16 epoch-day range/);
});

test("receipt PDA is deterministic and package-addressed", () => {
  const first = deriveReceiptPda(PublicKey, PROGRAM, BROADCASTER, hex(9));
  const repeat = deriveReceiptPda(PublicKey, PROGRAM, BROADCASTER, hex(9));
  const other = deriveReceiptPda(PublicKey, PROGRAM, BROADCASTER, hex(10));
  assert.ok(first.equals(repeat));
  assert.ok(!first.equals(other));
});

test("existing package receipt reuses its recorded reaction timestamp after restart", () => {
  const zero = new PublicKey(new Uint8Array(32));
  const packageHash = hex(9);
  const sourceEntryHash = hex(8);
  const recordedReactionTs = TS + 250;
  const account = {
    verified: true,
    broadcaster: BROADCASTER,
    fixtureId: new BN(18_237_038),
    seq: 641,
    eventType: 1,
    team: 2,
    statKey: 2,
    eventValue: 3,
    sourceTs: new BN(TS),
    reactionTs: new BN(recordedReactionTs),
    packageHash: [...Buffer.from(packageHash, "hex")],
    sourceEntryHash: [...Buffer.from(sourceEntryHash, "hex")],
    previousReceipt: zero,
  };
  const matchedReactionTs = validateExistingReceiptAccount(account, {
    broadcaster: BROADCASTER,
    expectedPrevious: zero,
    fixtureId: 18_237_038,
    seq: 641,
    eventType: 1,
    team: 2,
    statKey: 2,
    eventValue: 3,
    sourceTs: TS,
    reactionTs: TS + 60_000,
    packageHash,
    sourceEntryHash,
  });
  assert.equal(matchedReactionTs, recordedReactionTs);
});
