// Proof-of-Broadcast submitter. Disabled by default until the Anchor program is
// deployed; in that state the product reports only the fetched TxLINE proof
// bundle and a pending broadcast receipt. Once ROARLINE_RECEIPTS=1, this executes the
// atomic custom-program → TxLINE validate_stat CPI → MomentReceipt path.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG, ROOT } from "./config.mjs";

const EVENT_TYPE = { GOAL: 1, GOAL_REVOKED: 2, RED_CARD: 3, CARD_REVOKED: 4 };
const TEAM = { home: 1, away: 2 };
const ZERO_HASH_BYTES = new Array(32).fill(0);
const submissionByPackage = new Map();
let runtimePromise = null;

export function submitMomentReceipt(rawProof, context) {
  if (!CONFIG.receipts.enabled) {
    return Promise.resolve({ receiptStatus: "pending", retryable: false, reason: "receipt program not enabled" });
  }
  if (!EVENT_TYPE[context.eventType]) {
    return Promise.resolve({ receiptStatus: "unsupported", retryable: false });
  }
  if (!isHash(context.packageHash)) {
    return Promise.resolve({ receiptStatus: "pending", retryable: false, reason: "invalid package hash" });
  }
  const existing = submissionByPackage.get(context.packageHash);
  if (existing) return existing;
  const submission = submit(rawProof, context);
  submissionByPackage.set(context.packageHash, submission);
  submission.then((result) => {
    if (result.receiptStatus !== "confirmed") submissionByPackage.delete(context.packageHash);
  }, () => submissionByPackage.delete(context.packageHash));
  return submission;
}

async function submit(rawProof, context) {
  try {
    const rt = await runtime();
    const { ComputeBudgetProgram, PublicKey, SystemProgram } = rt.web3;
    const eventType = EVENT_TYPE[context.eventType];
    const team = [1, 2].includes(Number(context.sourceParticipant))
      ? Number(context.sourceParticipant)
      : TEAM[context.eventTeam];
    if (!team) throw new Error("receipt event is missing a valid team");
    const fixtureId = integer("fixtureId", context.fixtureId, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const seq = integer("seq", context.seq, 0, 0xffffffff);
    const statKey = integer("statKey", context.statKey, 0, 0xffffffff);
    const eventValue = integer("eventValue", context.eventValue, -0x80000000, 0x7fffffff);
    const sourceTs = integer("sourceTs", context.sourceTs, 0, Number.MAX_SAFE_INTEGER);
    const reactionTs = integer("reactionTs", context.reactionTs, sourceTs, Number.MAX_SAFE_INTEGER);
    const proofMinTs = integer("proof minimum timestamp", rawProof?.summary?.updateStats?.minTimestamp, 0, Number.MAX_SAFE_INTEGER);
    const proofMaxTs = integer("proof maximum timestamp", rawProof?.summary?.updateStats?.maxTimestamp, proofMinTs, Number.MAX_SAFE_INTEGER);
    if (sourceTs < proofMinTs || sourceTs > proofMaxTs) throw new Error("moment source timestamp is outside the proof batch");
    if (Number(rawProof?.summary?.fixtureId) !== fixtureId) throw new Error("proof fixture does not match moment");
    if (Number(rawProof?.statToProve?.key) !== statKey) throw new Error("proof stat key does not match moment");
    if (Number(rawProof?.statToProve?.value) !== eventValue) throw new Error("proof value does not match moment");
    const receipt = deriveReceiptPda(PublicKey, rt.program.programId, rt.payer.publicKey, context.packageHash);
    const existing = await existingReceipt(rt, receipt, {
      ...context, fixtureId, seq, statKey, eventValue, eventType, team, sourceTs, reactionTs,
    });
    if (existing) return existing;
    const proofTs = Number(rawProof.summary.updateStats.minTimestamp);
    const dailyRoots = dailyRootsPda(PublicKey, rt.oracle, proofTs);
    const args = {
      fixtureId: new rt.BN(fixtureId),
      seq,
      eventType,
      team,
      statKey,
      eventValue,
      sourceTs: new rt.BN(sourceTs),
      reactionTs: new rt.BN(reactionTs),
      packageHash: bytes32(context.packageHash),
      sourceEntryHash: bytes32(context.sourceEntryHash),
      previousPackageHash: context.previousPackageHash ? bytes32(context.previousPackageHash) : ZERO_HASH_BYTES,
    };
    const proof = mapTxlineProof(rawProof, rt.BN);
    let call;
    if (eventType === 2 || eventType === 4) {
      if (!isHash(context.previousPackageHash)) throw new Error("correction is missing its previous package hash");
      const pendingPrevious = submissionByPackage.get(context.previousPackageHash);
      if (pendingPrevious) {
        const result = await pendingPrevious;
        if (result.receiptStatus !== "confirmed") {
          return { receiptStatus: "pending", retryable: true, reason: "previous receipt not confirmed" };
        }
      }
      const previous = deriveReceiptPda(
        PublicKey,
        rt.program.programId,
        rt.payer.publicKey,
        context.previousPackageHash,
      );
      call = rt.program.methods.recordCorrection(args, proof).accounts({
        broadcaster: rt.payer.publicKey, previousReceipt: previous, receipt,
        dailyScoresMerkleRoots: dailyRoots, txoracleProgram: rt.oracle, systemProgram: SystemProgram.programId,
      });
    } else {
      call = rt.program.methods.recordMoment(args, proof).accounts({
        broadcaster: rt.payer.publicKey, receipt,
        dailyScoresMerkleRoots: dailyRoots, txoracleProgram: rt.oracle, systemProgram: SystemProgram.programId,
      });
    }
    call = call.preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })]);
    const txSignature = await call.rpc();
    const network = CONFIG.txline.rpc.includes("devnet") ? "devnet" : "mainnet";
    return {
      receiptStatus: "confirmed",
      retryable: false,
      receiptAddress: receipt.toBase58(),
      receiptTx: txSignature,
      receiptExplorer: `https://explorer.solana.com/tx/${txSignature}${network === "devnet" ? "?cluster=devnet" : ""}`,
      receiptExplorerKind: "transaction",
      receiptProgramId: rt.program.programId.toBase58(),
      broadcasterReportedReactionTs: reactionTs,
      broadcasterReportedReactionDeltaMs: reactionTs - sourceTs,
    };
  } catch (error) {
    console.warn(`[receipt] ${context.eventType} ${context.fixtureId}/${context.seq}: ${String(error.message || error).slice(0, 180)}`);
    return { receiptStatus: "pending", retryable: true, reason: "submission failed; retryable" };
  }
}

async function existingReceipt(rt, address, context) {
  const account = await rt.program.account.momentReceipt.fetchNullable(address);
  if (!account) return null;
  const expectedPrevious = context.previousPackageHash
    ? deriveReceiptPda(rt.web3.PublicKey, rt.program.programId, rt.payer.publicKey, context.previousPackageHash)
    : new rt.web3.PublicKey(new Uint8Array(32));
  const recordedReactionTs = validateExistingReceiptAccount(account, {
    ...context,
    broadcaster: rt.payer.publicKey,
    expectedPrevious,
  });
  const network = CONFIG.txline.rpc.includes("devnet") ? "devnet" : "mainnet";
  return {
    receiptStatus: "confirmed",
    retryable: false,
    receiptAddress: address.toBase58(),
    receiptTx: null,
    receiptExplorer: `https://explorer.solana.com/address/${address.toBase58()}${network === "devnet" ? "?cluster=devnet" : ""}`,
    receiptExplorerKind: "account",
    receiptProgramId: rt.program.programId.toBase58(),
    broadcasterReportedReactionTs: recordedReactionTs,
    broadcasterReportedReactionDeltaMs: recordedReactionTs - context.sourceTs,
  };
}

export function validateExistingReceiptAccount(account, context) {
  const field = (camel, snake = camel) => account[camel] ?? account[snake];
  const checks = [
    field("verified") === true,
    field("broadcaster")?.equals(context.broadcaster),
    numberField(field("fixtureId", "fixture_id")) === context.fixtureId,
    numberField(field("seq")) === context.seq,
    numberField(field("eventType", "event_type")) === context.eventType,
    numberField(field("team")) === context.team,
    numberField(field("statKey", "stat_key")) === context.statKey,
    numberField(field("eventValue", "event_value")) === context.eventValue,
    numberField(field("sourceTs", "source_ts")) === context.sourceTs,
    equalBytes(field("packageHash", "package_hash"), bytes32(context.packageHash)),
    equalBytes(field("sourceEntryHash", "source_entry_hash"), bytes32(context.sourceEntryHash)),
    field("previousReceipt", "previous_receipt")?.equals(context.expectedPrevious),
  ];
  if (!checks.every(Boolean)) throw new Error("existing receipt PDA does not match this broadcast package");
  const recordedReactionTs = numberField(field("reactionTs", "reaction_ts"));
  if (!Number.isSafeInteger(recordedReactionTs)) throw new Error("existing receipt has an invalid reaction timestamp");
  return recordedReactionTs;
}

async function runtime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const anchor = await import("@coral-xyz/anchor");
      const web3mod = await import("@solana/web3.js");
      const { AnchorProvider, BN, Program, Wallet } = anchor.default ?? anchor;
      const { Connection, Keypair, PublicKey } = web3mod;
      const idlPath = [
        join(ROOT, "idl", "roarline_receipts.json"),
        join(ROOT, "target", "idl", "roarline_receipts.json"),
      ].find(existsSync);
      if (!idlPath) throw new Error("run `anchor idl build` first; receipt IDL missing");
      if (!existsSync(CONFIG.txline.walletPath)) throw new Error("broadcaster wallet missing");
      const payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(CONFIG.txline.walletPath, "utf8"))));
      const provider = new AnchorProvider(new Connection(CONFIG.txline.rpc, "confirmed"), new Wallet(payer), { commitment: "confirmed" });
      const idl = JSON.parse(readFileSync(idlPath, "utf8"));
      idl.address = CONFIG.receipts.programId;
      const program = new Program(idl, provider);
      return { program, payer, oracle: new PublicKey(CONFIG.txline.programId), BN, web3: web3mod };
    })();
  }
  try {
    return await runtimePromise;
  } catch (error) {
    runtimePromise = null;
    throw error;
  }
}

export function mapTxlineProof(v, BN) {
  const node = (n) => ({ hash: to32(n?.hash), isRightSibling: Boolean(n?.isRightSibling) });
  const summary = v?.summary;
  const updates = summary?.updateStats;
  const stat = v?.statToProve;
  if (!summary || !updates || !stat) throw new Error("incomplete TxLINE proof bundle");
  return {
    proofTs: new BN(integer("proof timestamp", updates.minTimestamp, 0, Number.MAX_SAFE_INTEGER)),
    fixtureSummary: {
      fixtureId: new BN(integer("proof fixture", summary.fixtureId, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)),
      updateStats: {
        updateCount: integer("proof update count", updates.updateCount, -0x80000000, 0x7fffffff),
        minTimestamp: new BN(integer("proof minimum timestamp", updates.minTimestamp, 0, Number.MAX_SAFE_INTEGER)),
        maxTimestamp: new BN(integer("proof maximum timestamp", updates.maxTimestamp, 0, Number.MAX_SAFE_INTEGER)),
      },
      eventsSubTreeRoot: to32(summary.eventStatsSubTreeRoot),
    },
    fixtureProof: (v.subTreeProof || []).map(node),
    mainTreeProof: (v.mainTreeProof || []).map(node),
    statA: {
      statToProve: {
        key: integer("proof stat key", stat.key, 0, 0xffffffff),
        value: integer("proof stat value", stat.value, -0x80000000, 0x7fffffff),
        period: integer("proof stat period", stat.period, -0x80000000, 0x7fffffff),
      },
      eventStatRoot: to32(v.eventStatRoot),
      statProof: (v.statProof || []).map(node),
    },
  };
}

export function epochDayFromTimestamp(ts) {
  const timestamp = integer("proof timestamp", ts, 0, Number.MAX_SAFE_INTEGER);
  const epochDay = Math.floor(timestamp / 86_400_000);
  if (epochDay > 0xffff) throw new Error("proof timestamp is outside the u16 epoch-day range");
  return epochDay;
}

export function dailyRootsPda(PublicKey, oracle, ts) {
  const epochDay = epochDayFromTimestamp(ts);
  const day = Buffer.alloc(2); day.writeUInt16LE(epochDay);
  return PublicKey.findProgramAddressSync([Buffer.from("daily_scores_roots"), day], oracle)[0];
}

export function deriveReceiptPda(PublicKey, programId, broadcaster, packageHash) {
  return PublicKey.findProgramAddressSync([
    Buffer.from("moment"),
    broadcaster.toBuffer(),
    Buffer.from(bytes32(packageHash)),
  ], programId)[0];
}

function to32(value) {
  const source = value?.type === "Buffer" && Array.isArray(value.data) ? value.data : value;
  const b = Array.isArray(source) || ArrayBuffer.isView(source)
    ? Buffer.from(source)
    : typeof source === "string" && /^(?:0x)?[0-9a-f]{64}$/i.test(source)
      ? Buffer.from(source.replace(/^0x/i, ""), "hex")
      : typeof source === "string" ? Buffer.from(source, "base64") : Buffer.alloc(0);
  if (b.length !== 32) throw new Error(`expected 32-byte proof node, got ${b.length}`);
  return [...b];
}
function bytes32(hex) {
  if (!isHash(hex)) throw new Error("expected a 32-byte SHA-256 hex digest");
  return [...Buffer.from(hex, "hex")];
}
function isHash(value) { return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value); }
function numberField(value) { return typeof value?.toNumber === "function" ? value.toNumber() : Number(value); }
function equalBytes(left, right) { return left != null && Buffer.from(left).equals(Buffer.from(right)); }
function integer(name, value, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name} is out of range`);
  return number;
}
