// ROARLINE server configuration. Reads .env if present (no dotenv dependency —
// the server core must run on a bare Node 20 install), then the environment.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv() {
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env — the pinned authentic replay works without one */
  }
}
loadDotEnv();

const env = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);

export const CONFIG = {
  port: Number(env("PORT", 8080)),
  /** "hero" = authentic pinned replay, "txline" = live API, "sim" = synthetic lab only. */
  source: env("ROARLINE_SOURCE", "hero"),
  txline: {
    origin: env("TXLINE_ORIGIN", "https://txline.txodds.com"),
    programId: env("TXLINE_PROGRAM_ID", "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"),
    rpc: env("SOLANA_RPC", "https://api.mainnet-beta.solana.com"),
    apiToken: env("TXLINE_API_TOKEN", ""),
    walletPath: env("ROARLINE_WALLET", join(ROOT, "wallet.json")),
    serviceLevel: Number(env("TXLINE_SERVICE_LEVEL", 12)),
  },
  receipts: {
    programId: env("ROARLINE_RECEIPT_PROGRAM_ID", "6d1Se4dj5yw11sDeT2Uss7iNVxuecHRMazZ1wgB32HFy"),
    enabled: env("ROARLINE_RECEIPTS", "0") === "1",
  },
  replaySpeed: Number(env("ROARLINE_REPLAY_SPEED", 8)),
};

export const IS_SIM = CONFIG.source === "sim";
export const IS_HERO = CONFIG.source === "hero";
