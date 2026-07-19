// Resubmit MomentReceipts for moments whose original submission failed
// transiently (e.g. devnet clock skew). Reuses the production submitter so the
// on-chain receipt is identical to what the room would have recorded: same
// packageHash, sourceEntryHash and the original reaction timestamp.
//
// Usage: node scripts/resubmit-receipts.mjs <moments.jsonl>
// Each line: {type, team, seq, statKey, statValue, sourceTs, reactionTs,
//             packageHash, sourceEntryHash, supersedes}
import { readFileSync } from "node:fs";

process.env.ROARLINE_SOURCE ??= "txline";
process.env.ROARLINE_RECEIPTS ??= "1";
process.env.TXLINE_ORIGIN ??= "https://txline-dev.txodds.com";
process.env.TXLINE_PROGRAM_ID ??= "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
process.env.SOLANA_RPC ??= "https://api.devnet.solana.com";
process.env.TXLINE_SERVICE_LEVEL ??= "1";

const FIXTURE_ID = Number(process.env.FIXTURE_ID ?? 18237038);
const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/resubmit-receipts.mjs <moments.jsonl>");
  process.exit(1);
}

const { txline } = await import("../server/txline/client.mjs");
const { submitMomentReceipt } = await import("../server/receipts.mjs");

const moments = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
// Corrections last: their previous receipt must confirm first.
moments.sort((a, b) => (a.supersedes ? 1 : 0) - (b.supersedes ? 1 : 0) || a.seq - b.seq);

let failures = 0;
for (const m of moments) {
  const label = `${m.type} seq=${m.seq}`;
  try {
    const raw = await txline().statValidation(FIXTURE_ID, m.seq, m.statKey);
    const result = await submitMomentReceipt(raw, {
      eventType: m.type,
      eventTeam: m.team,
      sourceParticipant: m.sourceParticipant ?? ((m.statKey % 1000) % 2 ? 1 : 2),
      fixtureId: FIXTURE_ID,
      seq: m.seq,
      statKey: m.statKey,
      eventValue: m.statValue,
      sourceTs: m.sourceTs,
      reactionTs: m.reactionTs,
      packageHash: m.packageHash,
      sourceEntryHash: m.sourceEntryHash,
      previousPackageHash: m.supersedes || null,
    });
    console.log(label, JSON.stringify(result, null, 2));
    if (result.receiptStatus !== "confirmed") failures++;
  } catch (error) {
    failures++;
    console.error(label, "FAILED:", error.message || error);
    if (error.logs) console.error(error.logs.join("\n"));
  }
}
process.exit(failures ? 1 : 0);
