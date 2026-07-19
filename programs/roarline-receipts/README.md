# ROARLINE Proof of Broadcast

An Anchor program that atomically:

1. receives a real TxLINE `stat-validation` Merkle bundle;
2. owner-pins the daily root account and CPI target to TxLINE;
3. invokes `txoracle::validate_stat` with an exact-equality predicate;
4. refuses to write unless TxLINE returns `true`;
5. creates a `MomentReceipt` PDA binding the CPI-verified source fact to a broadcaster-supplied broadcast-package SHA-256 and clock-bounded reaction timestamp.

Corrections use `record_correction`: the prior receipt is mutated only to set `superseded_by`; it is never deleted. The new receipt stores `previous_receipt`, producing an explicit on-chain correction chain.

The same binary accepts only the documented TxLINE mainnet/devnet program IDs and requires the supplied root account to be owned by that exact CPI program.

The receipt PDA is `['moment', broadcaster, package_hash]`. This makes replay submission idempotent and binds the account address to the supplied digest. The program does not receive or recompute the off-chain package bytes. Originals must prove a positive stat value. Corrections additionally require `previous_package_hash` to match the prior receipt, target the matching original event type, advance the stored source sequence/time, and prove a non-negative value strictly below the original.

The program also derives the expected `daily_scores_roots` PDA itself from the proof batch timestamp, verifies the supplied TxLINE program is executable, and accepts only the exact one-byte `true` CPI return value.

## Proof boundary

The TxLINE CPI proves the fixture identifier, participant-oriented stat key, and exact stat value against the supplied daily root. ROARLINE constrains the event/participant classification to the matching goal or red-card stat family. Display-home/display-away orientation is not substituted for TxLINE participant coordinates.

The broadcaster supplies `seq`, `source_ts`, `reaction_ts`, `package_hash`, and `source_entry_hash`. On chain, `source_ts` must fall inside the proven batch, `reaction_ts` must follow it and be near the Solana Clock, correction metadata must advance monotonically, and the package digest addresses the receipt PDA. Those checks bind and sanity-check the metadata; they do not prove an exact source sequence, independently measure browser presentation, or recompute either off-chain hash.

When a package-addressed account already exists, the submitter verifies its stored CPI-bound values and commitments and reuses its recorded `reaction_ts`; a process restart does not require a newly generated wall-clock timestamp to equal the immutable account.

## Build status

- `npm run build:receipt` uses Anchor CLI 0.31.1 plus Agave 2.1.0/platform-tools v1.43 to build the key-independent ELF and source-derived IDL without a deployment keypair.
- The script synchronizes `idl/roarline_receipts.json` with `target/idl/roarline_receipts.json` and verifies the 265,656-byte SBF SHA-256 `3ac6bac37a00dc09eb1d5756587fe99e9105512bc77154ba417022e1e779dd63`.
- Rust unit tests pass.
- The program is **deployed on devnet** as [`6d1Se4dj5yw11sDeT2Uss7iNVxuecHRMazZ1wgB32HFy`](https://explorer.solana.com/address/6d1Se4dj5yw11sDeT2Uss7iNVxuecHRMazZ1wgB32HFy?cluster=devnet) (deploy tx `4yHwNHLeDXPLRYUsERvSpiYKmDnEBU1gRmSGdtrxVBkiNP5PMBh2QsYucSVNiC7QoHrhrFveowwNvibHcM38AbWL`) and has four confirmed MomentReceipts; the transaction table lives in the repository [README](../../README.md). Source proofs and custom receipts remain separately labelled in the UI.

## Deployment boundary

Artifact reproduction and deployment are separate workflows. `npm run build:receipt` needs no private key and must be used for the published artifact. Deployment-oriented Anchor commands require the private key matching `6d1Se4dj5yw11sDeT2Uss7iNVxuecHRMazZ1wgB32HFy`; that secret is not generated, stored, or distributed by this repository.
