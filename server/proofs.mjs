// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE proofs · evidence for eligible major moments
//
// Each GOAL / reversal / RED CARD carries proof coordinates
// (fixtureId · seq · statKey). Live mode may fetch a TxLINE Merkle bundle and,
// when separately enabled, submit the custom CPI-backed receipt. Hero mode has
// only commit-pinned external proof-log records whose signatures are currently
// unavailable from devnet RPC. These are deliberately separate statuses.
// ─────────────────────────────────────────────────────────────────────────────
import { CONFIG, IS_HERO, IS_SIM } from "./config.mjs";
import { txline } from "./txline/client.mjs";
import { loadHeroPackage } from "./sources/hero.mjs";
import { epochDayFromTimestamp, submitMomentReceipt } from "./receipts.mjs";

const PROOF_REFERENCE_COMMIT = "2f10829f4a4e95c571a72b43eada1088c63642bd";
const PROOF_REFERENCE_PATH = "mint/proof-log.ndjson";
const PROOF_REFERENCE_SHA256 = "6810cad65784e3a1c79b642a33bb6642ca655e88ab4483fc2aca828bf0f1ff46";
const proofBundleCache = new Map(); // "fixture:seq:key" → Promise<raw proof>

export async function momentProof(fixtureId, seq, statKey, context = {}) {
  if (IS_HERO) return heroProof(fixtureId, seq, statKey, context);
  if (IS_SIM) return demoProof(fixtureId, seq, statKey);
  const cacheKey = `${fixtureId}:${seq}:${statKey}`;
  let pendingBundle = proofBundleCache.get(cacheKey);
  if (!pendingBundle) {
    pendingBundle = txline().statValidation(fixtureId, seq, statKey);
    proofBundleCache.set(cacheKey, pendingBundle);
  }
  let v;
  try {
    v = await pendingBundle;
  } catch (error) {
    proofBundleCache.delete(cacheKey);
    throw error;
  }
  if (!v?.summary?.updateStats) {
    proofBundleCache.delete(cacheKey);
    return null; // not anchored yet — the room retries later
  }

  const minTs = Number(v.summary.updateStats.minTimestamp);
  const epochDay = epochDayFromTimestamp(minTs);
  const shaped = {
    demo: false,
    proofBundleFetched: true,
    currentRpcVerified: false,
    fixtureId, seq, statKey,
    statValue: v.statToProve?.value ?? null,
    statPeriod: v.statToProve?.period ?? null,
    epochDay,
    anchorTs: minTs,
    pathDepth: (v.statProof?.length ?? 0) + (v.subTreeProof?.length ?? 0) + (v.mainTreeProof?.length ?? 0),
    programId: CONFIG.txline.programId,
    rootsPda: await deriveRootsPda(epochDay),
    network: CONFIG.txline.rpc.includes("devnet") ? "devnet" : "mainnet",
  };
  const receipt = await submitMomentReceipt(v, {
    ...context,
    fixtureId: Number(fixtureId),
    seq: Number(seq),
    statKey: Number(statKey),
    eventValue: Number(context.eventValue ?? v.statToProve?.value),
  });
  return { ...shaped, ...receipt, currentRpcVerified: receipt.receiptStatus === "confirmed" };
}

function heroProof(fixtureId, seq, statKey, context) {
  const pkg = loadHeroPackage();
  if (Number(fixtureId) !== Number(pkg.fixture.fixtureId)) return null;
  const evidence = pkg.proofEvidence.find((p) =>
    Number(p.observedSeq) === Number(seq)
      && Number(p.statKey) === Number(statKey)
      && p.event === context.eventType
      && Number(p.value) === Number(context.eventValue),
  );
  if (!evidence) return null;
  return {
    demo: false,
    authenticCapture: true,
    archivedProofRecord: true,
    currentRpcVerified: false,
    rpcAvailable: false,
    receiptStatus: "archived-proof-log-record",
    fixtureId: Number(fixtureId),
    seq: Number(evidence.seq),
    observedSeq: Number(evidence.observedSeq),
    statKey: Number(statKey),
    statValue: Number(evidence.value),
    epochDay: evidence.epochDay,
    anchorTs: Number(context.sourceTs),
    programId: CONFIG.txline.programId,
    network: evidence.network,
    txSig: evidence.txSig,
    explorer: evidence.explorer,
    proofReferenceCommit: PROOF_REFERENCE_COMMIT,
    proofReferencePath: PROOF_REFERENCE_PATH,
    proofReferenceSha256: PROOF_REFERENCE_SHA256,
    proofReferenceUrl: `https://github.com/danySSG/moment-mints/blob/${PROOF_REFERENCE_COMMIT}/${PROOF_REFERENCE_PATH}`,
    packageHash: context.packageHash,
    supersedesPackageHash: context.previousPackageHash || null,
    provenance: pkg.provenance,
  };
}

/** daily_scores_roots PDA — ["daily_scores_roots", u16 LE epochDay]. */
async function deriveRootsPda(epochDay) {
  try {
    const { PublicKey } = await import("@solana/web3.js"); // present in live installs
    const seed = Buffer.alloc(2);
    seed.writeUInt16LE(epochDay);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("daily_scores_roots"), seed],
      new PublicKey(CONFIG.txline.programId),
    );
    return pda.toBase58();
  } catch {
    return null; // dependency-free installs still show proof coordinates
  }
}

/** Demo mode: same UX, honestly labelled — never pretends to be an anchor. */
function demoProof(fixtureId, seq, statKey) {
  return Promise.resolve({
    demo: true,
    fixtureId, seq, statKey,
    statValue: null,
    epochDay: Math.floor(Date.now() / 86400000),
    anchorTs: Date.now(),
    pathDepth: 9,
    programId: CONFIG.txline.programId,
    rootsPda: null,
    network: "demo",
  });
}
