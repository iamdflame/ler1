# ROARLINE — 5-minute demo video script

> Record the default authentic replay, not a simulation and not a hoped-for live moment. Its timing is deterministic, so the goal, second goal, correction and final frame can be captured in one take. Keep total ≤ 5:00.

## 0:00 – 0:25 · The problem

> "Three billion people follow this World Cup. Right now, most of them can't watch it — they're at work, on a bus, somewhere without rights or bandwidth. This is what the world gives them…" *(show a bare `1–0` push notification)* "…a spreadsheet cell. For the most emotional event on Earth."

> "This is ROARLINE — the broadcast rebuilt from pure data."

## 0:25 – 0:45 · Establish authenticity

- Open the deployed URL on the hero card: **France 0–2 Spain · authentic TxLINE capture**.
- Point briefly to the package SHA-256 below the card.
- > "No signup, wallet, app store, or TxLINE credentials. This is a public France–Spain capture pinned by source commit and two raw-file hashes, reduced reproducibly into one 90-second package."
- Tap **FEEL 90s**.

## 0:45 – 2:15 · Let the authentic sequence play

- Tap 🔊. Crowd fades in. Let a booth line speak via TTS.
- > "The crowd you hear doesn't exist — WebAudio synthesizes it from match fever. The booth is deterministic, and TxLINE's de-margined consensus market becomes a character in the story."
- Point out the **win-probability river** moving; the **fever** number; arrows on the market bars.
- At ~20s of replay: let Spain's move to **0–2** land without voice-over.
- At ~36s: let the captured **0–3** goal land.
- At ~68s: let the authoritative counter fall back to **0–2** and the "NO GOAL" call finish.
- At ~86s: show the finalised 0–2 frame.
- > "That was not a scripted score simulation. Every state and consensus-odds movement came from the pinned public capture."

## 2:15 – 2:55 · Correction-aware proof

- Tap **CARD** on the 0–3 goal, then on the correction.
- > "The correction does not erase the first package. Both have deterministic SHA-256 identities, and the correction links back with `supersedes`. The drawer opens a commit-pinned external proof-log record for the matching fixture, sequence, stat key and value."
- Point to **ARCHIVED PROOF-LOG RECORD · CURRENT DEVNET RPC UNAVAILABLE**.
- > "That wording matters. The archived log preserves the reported signature, but current devnet RPC cannot retrieve it. A fetched live bundle and our custom receipt are separate claims. The Anchor program builds and tests but is not deployed, so ROARLINE never calls this confirmed."

## 2:55 – 3:35 · Accessibility and low data

- Switch EN → ES → FR → PT on one existing booth line.
- Switch to **Audio description**, then **Silent + haptics**, then **Low data**.
- > "Language changes presentation, never match facts. Audio description narrates sustained pressure; silent mode prioritizes captions and event-specific haptics; low-data mode removes decorative commentary and sends one in ten signal frames. The byte totals are measured from actual serialization."

## 3:35 – 4:00 · Publisher distribution

- Open `/publisher-demo`.
- Change the element's `language`, `mode`, `team`, `sponsor`, and `theme` attributes in DevTools or with the prepared controls.
- > "Publishers need two tags. This walletless Web Component keeps credentials server-side and works without a framework. This page is a reproducible integration demonstration—not a claim of a third-party pilot."

## 4:00 – 4:40 · Evidence and implementation

- Open `/evidence`: show process-local p50/p95 samples, standard/low bytes, ledger head, expected director-cut gaps, package hashes and correction links.
- > "No seeded vanity metrics. The corrected full run measured 41.8 percent fewer serialized bytes in low-data mode. Browser handler-to-animation-frame callback was 1.3 milliseconds p50 and 2.8 p95—not visual paint. Server write to the matching frame acknowledgment was 208 and 413.3 milliseconds; that includes both forwarded transport legs. Every sample requires an active SSE token and a package actually written to that client."
- Terminal: flash `npm test`, `cargo test -p roarline-receipts`, and the successful identity-checked `npm run build:receipt` artifact (265,656 bytes; `3ac6bac37a00dc09eb1d5756587fe99e9105512bc77154ba417022e1e779dd63`).
- > "A SHA-256 ledger precedes every mutation. Counter diffs are source truth. Duplicate and stale updates are rejected. The custom program atomically validates the exact TxLINE fixture, stat key and value before writing a package-addressed receipt. Sequence, timestamps and hashes are broadcaster metadata with explicit on-chain constraints; corrections match the supplied prior hash to the prior receipt."

## 4:40 – 5:00 · Close (b-roll: phone in pocket, earphones)

> "Prediction markets serve the fan who wants action. ROARLINE serves everyone else — the fan on a night shift in Lagos, the commuter in Jakarta, the kid with no TV. TxLINE made operator-grade data free for builders this month. We used it to build the thing fans actually lose when they can't watch: **the feeling**. ROARLINE — the match, felt."

---

### Recording checklist
- [ ] Fresh `node server/index.mjs`; click the authentic hero once and record the complete 90-second sequence
- [ ] Browser at 390×844 (iPhone frame) for app shots; system audio captured (crowd + TTS!)
- [ ] Uninterrupted 0–2 → 0–3 → correction to 0–2 sequence on camera
- [ ] Proof drawer wording visibly distinguishes archived records, fetched bundles, current RPC verification and custom receipt status
- [ ] ES/FR/PT, audio-description, silent+haptics and low-data controls shown
- [ ] `/publisher-demo` caveat and `/evidence` measurements shown
- [ ] Terminal shots: `npm test`, Rust tests, SBF artifact hash
- [ ] Upload unlisted YouTube/Loom · link in SUBMISSION.md + Superteam form
