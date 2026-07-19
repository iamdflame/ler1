#!/usr/bin/env node
// Reproduce the published receipt-program artifact without a deployment keypair.
// `anchor build` is intentionally not used here: its deployment workflow creates
// or synchronizes an ignored program keypair. The program identity is instead
// fixed by `declare_id!`, while cargo-build-sbf produces the key-independent ELF.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROGRAM_ID = "6d1Se4dj5yw11sDeT2Uss7iNVxuecHRMazZ1wgB32HFy";
const EXPECTED_SIZE = 265_656;
const EXPECTED_SHA256 = "3ac6bac37a00dc09eb1d5756587fe99e9105512bc77154ba417022e1e779dd63";
const manifest = join(ROOT, "programs", "roarline-receipts", "Cargo.toml");
const binary = join(ROOT, "target", "deploy", "roarline_receipts.so");
const idl = join(ROOT, "idl", "roarline_receipts.json");
const runtimeIdl = join(ROOT, "target", "idl", "roarline_receipts.json");

const version = capture("cargo-build-sbf", ["--version"]);
if (!version.includes("solana-cargo-build-sbf 2.1.0") || !version.includes("platform-tools v1.43")) {
  throw new Error(`expected Agave cargo-build-sbf 2.1.0 / platform-tools v1.43; got:\n${version.trim()}`);
}
if (!capture("anchor", ["--version"]).includes("anchor-cli 0.31.1")) {
  throw new Error("expected Anchor CLI 0.31.1");
}

mkdirSync(dirname(binary), { recursive: true });
const sbfOutput = mkdtempSync(join(tmpdir(), "roarline-sbf-"));
try {
  // Agave creates a random `<program>-keypair.json` whenever that path is
  // absent. A directory sentinel satisfies its existence check but contains no
  // key material; only the resulting ELF is copied into the workspace.
  mkdirSync(join(sbfOutput, "roarline_receipts-keypair.json"));
  run("cargo-build-sbf", ["--manifest-path", manifest, "--sbf-out-dir", sbfOutput]);
  copyFileSync(join(sbfOutput, "roarline_receipts.so"), binary);
} finally {
  rmSync(sbfOutput, { recursive: true, force: true });
}
run("anchor", ["idl", "build", "-o", idl]);

const parsedIdl = JSON.parse(readFileSync(idl, "utf8"));
if (parsedIdl.address !== PROGRAM_ID) {
  throw new Error(`IDL program address changed: ${parsedIdl.address}`);
}
mkdirSync(dirname(runtimeIdl), { recursive: true });
copyFileSync(idl, runtimeIdl);

const size = statSync(binary).size;
const digest = createHash("sha256").update(readFileSync(binary)).digest("hex");
if (size !== EXPECTED_SIZE || digest !== EXPECTED_SHA256) {
  throw new Error(`SBF identity changed: ${size} bytes · ${digest}`);
}
console.log(`verified ${binary}`);
console.log(`  ${size} bytes · sha256 ${digest}`);
console.log(`  program ${PROGRAM_ID} · IDL copies synchronized`);

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}):\n${result.stderr || result.stdout}`);
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}
