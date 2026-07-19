#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE · TxLINE activation — the "sign up through Solana" step
//
// One command performs the full TxLINE onboarding, exactly as documented:
//
//   1. guest JWT            POST {origin}/auth/guest/start
//   2. on-chain subscribe   txoracle.subscribe(serviceLevel, 4 weeks) signed by
//                           YOUR wallet — a real Solana transaction (free World
//                           Cup tiers cost no TxL; the tx needs SOL for fees)
//   3. signed activation    wallet-sign "«txSig»::«jwt»" (detached ed25519)
//   4. token                POST {origin}/api/token/activate → TXLINE_API_TOKEN
//
// Usage:
//   node scripts/activate.mjs                    (uses .env / defaults)
//   TXLINE_SERVICE_LEVEL=12 node scripts/activate.mjs   (mainnet real-time)
//
// The wallet: ./wallet.json (solana-keygen format). Create one with
//   solana-keygen new -o wallet.json     and fund it with a little SOL
//   (devnet: `solana airdrop 2 -k wallet.json -u devnet`).
//
// The program IDL is fetched FROM THE CHAIN (anchor's on-chain IDL account) so
// this repo ships no stale copies. If the cluster has no IDL published, drop
// the official one from github.com/txodds/tx-on-chain at ./idl/txoracle.json.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../server/config.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const anchor = await import("@coral-xyz/anchor").catch(() => {
  console.error("✗ dependencies missing — run `npm install` first (the authentic replay needs none; activation does).");
  process.exit(1);
});
const { AnchorProvider, Program, Wallet, web3 } = anchor.default ?? anchor;
const { Connection, Keypair, PublicKey, SystemProgram } = web3;
const splToken = await import("@solana/spl-token");
const { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = splToken;
const nacl = (await import("tweetnacl")).default;

const { origin, programId: PROGRAM_ID, rpc, walletPath, serviceLevel } = CONFIG.txline;
const TXL_MINT = {
  "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA": "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
  "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J": "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
}[PROGRAM_ID];

console.log(`\n⚡ ROARLINE × TxLINE activation`);
console.log(`   origin   ${origin}`);
console.log(`   program  ${PROGRAM_ID}`);
console.log(`   rpc      ${rpc}`);
console.log(`   tier     service level ${serviceLevel} (free World Cup tier) · 4 weeks\n`);

// ── wallet ───────────────────────────────────────────────────────────────────
if (!existsSync(walletPath)) {
  console.error(`✗ wallet not found at ${walletPath}\n  create: solana-keygen new -o wallet.json  (then fund with a little SOL)`);
  process.exit(1);
}
const payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(walletPath, "utf8"))));
const connection = new Connection(rpc, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
console.log(`→ wallet ${payer.publicKey.toBase58()}`);
const balance = await connection.getBalance(payer.publicKey);
console.log(`  balance ${(balance / 1e9).toFixed(4)} SOL`);
if (balance < 0.01e9) {
  console.error("✗ wallet needs a little SOL for the subscribe transaction fees/rent.");
  process.exit(1);
}

// ── 1 · guest JWT ────────────────────────────────────────────────────────────
const authRes = await fetch(`${origin}/auth/guest/start`, { method: "POST" });
if (!authRes.ok) { console.error(`✗ guest/start → HTTP ${authRes.status}`); process.exit(1); }
const jwt = (await authRes.json()).token;
console.log(`✓ 1/4 guest JWT issued`);

// ── 2 · on-chain subscribe ───────────────────────────────────────────────────
const programPk = new PublicKey(PROGRAM_ID);
let idl = await Program.fetchIdl(programPk, provider);
if (!idl) {
  const local = join(ROOT, "idl", "txoracle.json");
  if (existsSync(local)) idl = JSON.parse(readFileSync(local, "utf8"));
  else {
    console.error("✗ no on-chain IDL found and ./idl/txoracle.json missing.\n  Grab the official IDL from github.com/txodds/tx-on-chain and place it there.");
    process.exit(1);
  }
}
const program = new Program(idl, provider);

const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], programPk);
const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], programPk);
const txlMint = new PublicKey(TXL_MINT);
const tokenTreasuryVault = getAssociatedTokenAddressSync(txlMint, tokenTreasuryPda, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const userTokenAccount = getAssociatedTokenAddressSync(txlMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

const DURATION_WEEKS = 4;
const SELECTED_LEAGUES = []; // standard free bundle
// A brand-new wallet has no TxL associated token account yet; the program
// requires it to exist even for free tiers, so create it idempotently first.
const { createAssociatedTokenAccountIdempotentInstruction } = splToken;
const ataIx = createAssociatedTokenAccountIdempotentInstruction(
  payer.publicKey, userTokenAccount, payer.publicKey, txlMint,
  TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
);
console.log(`→ 2/4 sending on-chain subscribe(serviceLevel=${serviceLevel}, weeks=${DURATION_WEEKS}) …`);
const txSig = await program.methods
  .subscribe(serviceLevel, DURATION_WEEKS)
  .preInstructions([ataIx])
  .accounts({
    user: payer.publicKey,
    pricingMatrix: pricingMatrixPda,
    tokenMint: txlMint,
    userTokenAccount,
    tokenTreasuryVault,
    tokenTreasuryPda,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
console.log(`✓ 2/4 subscribed on-chain — tx ${txSig}`);
const cluster = rpc.includes("devnet") ? "?cluster=devnet" : "";
console.log(`      https://explorer.solana.com/tx/${txSig}${cluster}`);

// ── 3 · wallet-signed activation message ────────────────────────────────────
// For the standard bundle the exact preimage is "«txSig»::«jwt»" (two colons).
const message = new TextEncoder().encode(`${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`);
const walletSignature = Buffer.from(nacl.sign.detached(message, payer.secretKey)).toString("base64");
console.log(`✓ 3/4 activation message signed by the subscribing wallet`);

// ── 4 · activate ─────────────────────────────────────────────────────────────
const actRes = await fetch(`${origin}/api/token/activate`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ txSig, walletSignature, leagues: SELECTED_LEAGUES }),
});
if (!actRes.ok) {
  console.error(`✗ token/activate → HTTP ${actRes.status} ${await actRes.text().catch(() => "")}`);
  console.error("  checklist: same network for origin+program+rpc · same wallet that sent subscribe · fresh JWT from the same host");
  process.exit(1);
}
const actRaw = await actRes.text();
let actBody = null;
try { actBody = JSON.parse(actRaw); } catch { actBody = actRaw.trim(); }
const apiToken = typeof actBody === "string"
  ? actBody
  : actBody?.token ?? actBody?.apiToken ?? actBody?.api_token ?? actBody?.data?.token ?? null;
if (!apiToken || typeof apiToken !== "string" || apiToken === "null") {
  console.error(`✗ activation succeeded but no token found in response: ${actRaw.slice(0, 400)}`);
  process.exit(1);
}
console.log(`✓ 4/4 API token activated\n`);

// persist into .env
const envPath = join(ROOT, ".env");
let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : readFileSync(join(ROOT, ".env.example"), "utf8");
env = env.match(/^TXLINE_API_TOKEN=/m)
  ? env.replace(/^TXLINE_API_TOKEN=.*$/m, `TXLINE_API_TOKEN=${apiToken}`)
  : env + `\nTXLINE_API_TOKEN=${apiToken}\n`;
env = env.match(/^ROARLINE_SOURCE=/m)
  ? env.replace(/^ROARLINE_SOURCE=.*$/m, "ROARLINE_SOURCE=txline")
  : env + "ROARLINE_SOURCE=txline\n";
writeFileSync(envPath, env);
console.log(`   token written to .env — start the real broadcast:\n\n     npm run live\n`);
