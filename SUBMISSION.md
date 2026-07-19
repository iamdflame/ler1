# ROARLINE — Submission (TxODDS × Solana World Cup Hackathon)

**Track:** Consumer & Fan Experiences
**One-liner:** The World Cup broadcast built from pure data — a living pitch, a synthesized crowd, TTS commentary, and the global market as narrator, for the billions of fans who can't watch the match they care about.

- **Live app:** *deploy URL goes here* (single container — `Dockerfile` included; Fly/Railway/Render in minutes)
- **Repo:** this repository
- **Demo video:** *link goes here* (see [DEMO-SCRIPT.md](DEMO-SCRIPT.md))

---

## 1 · The idea

Every other product built on sports data assumes the fan can already see the match and wants to *bet, collect, or predict on top of it*. ROARLINE serves the opposite — and much larger — audience: the fan **without the pictures**. At work, commuting, no broadcast rights, no bandwidth.

For them, ROARLINE reconstructs the *feeling* of the match from TxLINE's feed alone:

1. **See it** — a living pitch: a pressure orb drifting toward the goal under siege, goal-mouth glow, particle eruptions on goals, interpolated from 1Hz engine signals at the browser's available display cadence.
2. **Hear it** — a WebAudio-synthesized stadium (crowd bed tracks the *fever* signal; roars, gasps, whistles are moment-triggered) plus a deterministic TTS booth. EN/ES/FR/PT presentation changes instantly without changing match truth.
3. **Keep it** — big moments render share-ready **moment cards** stamped with their proof coordinates (`fixtureId · seq · statKey`). The drawer separates archived proof-log records, fetched TxLINE bundles, current RPC verification and confirmed custom Proof-of-Broadcast receipts.
4. **Relive it** — live, historical, pinned-capture and explicit simulation sources all traverse the same normalizer and engine. The default judge route is a 90-second authentic France–Spain sequence reconstructed from source files pinned by commit and SHA-256.
5. **Distribute it** — a framework-free `<roarline-match>` Web Component provides a walletless publisher player with fixture, language, accessibility mode, preferred team, sponsor, theme and origin attributes.

## 2 · How TxLINE powers it (endpoints)

| Surface | Endpoint | Use |
|---|---|---|
| Auth | `POST /auth/guest/start` | guest JWT; auto-renewed on any 401 |
| Auth (Solana) | on-chain `txoracle.subscribe(SL, 4w)` → `POST /api/token/activate` | the signup **is** a Solana transaction; activation message `"{txSig}::{jwt}"` signed by the same wallet (`scripts/activate.mjs`, IDL fetched from chain) |
| Lobby | `GET /api/fixtures/snapshot` | fixture discovery; persisted to a local ledger because finished fixtures leave the snapshot |
| Live | `GET /api/scores/stream`, `GET /api/odds/stream` (SSE) | ONE shared connection per stream, multiplexed to every open broadcast room by fixture id |
| Late join | `GET /api/scores/snapshot/{id}`, `GET /api/odds/snapshot/{id}` | rooms seed whole, not empty |
| Archive | `GET /api/scores/historical/{id}` + `GET /api/odds/updates/{epochDay}/{hour}/{interval}` | full re-broadcasts with the market's original emotions |
| Receipts | `GET /api/scores/stat-validation?fixtureId&seq&statKey` | Merkle-proof bundle per big moment; `daily_scores_roots` PDA derived per epoch day (u16 LE seed) |

### Primary judge evidence

- Fixture `18237038`, France 0–2 Spain, from public `LightCreator1007/steamline` capture commit `b3bd417c1e28089c885a5454f654b1caadbde942`.
- Both raw source files and the external proof log are verified before reduction. The package-body JSON SHA-256 is `83cc7c4266f44a2272f80deb4bcecbc97be997939ac8bc9041b233728df3c25c`: the exact generated JSON bytes with the top-level `packageHash` field omitted.
- The sequence preserves the source's 0–3 state and later 0–2 correction. The correction links to the prior deterministic package; no history is rewritten.
- Three matching signatures and proof coordinates are preserved in the commit-pinned external proof log (`danySSG/moment-mints` commit `2f10829f4a4e95c571a72b43eada1088c63642bd`; proof-log SHA-256 `6810cad65784e3a1c79b642a33bb6642ca655e88ab4483fc2aca828bf0f1ff46`). Current devnet RPC cannot retrieve them, so they are explicitly labelled archived records—not current chain verification.
- `/evidence` exposes running-process telemetry and the proof/correction chain. It does not turn historical match age into a latency claim.
- A corrected 90.001-second run with one standard and one low-data connection measured ingest→package p50/p95 **0/1 ms**, browser handler→animation-frame callback **1.3/2.8 ms**, server SSE-write→matching-frame-ack **208/413.3 ms** (26 samples each), and **76,450 / 44,504 serialized bytes**—a measured **41.8% reduction**. The server acknowledgment includes both transport legs through the forwarded test browser and is not a paint claim. The 56-entry ledger (48 score + 8 odds) ended at `9b9bed363aab3a98e9bcaf94a0bbe16f6d21c7be7c8c2201db77d023f06f7e16`; the full record is [evidence/reference-run-2026-07-19.json](evidence/reference-run-2026-07-19.json).

**Engineering notes judges may care about**
- *Counter diffs are the source of truth.* Goals/cards/corners are detected by diffing the stat map between updates (keys 1–8 + period prefixes), never by trusting `action` labels — so VAR reversals (a counter going *down*) are first-class moments: "the goal is CHALKED OFF!"
- *One normalizer file.* Every feed field-name assumption is isolated in `server/txline/normalize.mjs`, case- and shape-tolerant (`Seq`/`seq`, `Stats` as map of numbers or `{Value}` objects, three odds layouts, `Participant1IsHome=false` mirroring of paired stat keys). `/api/debug/raw` exposes the raw ring buffer for instant diagnosis.
- *Replays run in original time space.* The room clock is the source's virtual `now()`, so drama decay, colour-commentary pacing and the river's x-axis are correct at any speed.
- *Every normalized source event enters a SHA-256 hash chain.* Package hashes exclude wall-clock receipt metadata, so replaying the same capture produces the same ledger head and moment hashes. Duplicate and stale source updates are rejected before mutation.
- *Corrections are additive facts.* A reversal receives its own package and optional on-chain receipt, with `supersedes`/`supersededBy` links to the original.
- *Zero-dependency core.* The server and demo need only Node 20 stdlib; npm installs are required solely for the Solana onboarding + proof PDA derivation. No framework, no build, no DB.

## 3 · Judging criteria, addressed

- **Fan Accessibility & UX** — open URL → you're in the match. No wallet or account. Phone-first controls add synchronized captions, audio description, silent+haptics, low-data delivery, and EN/ES/FR/PT commentary.
- **Real-Time Responsiveness** — 1Hz signal frames drive pitch/crowd/river continuously; event packages interrupt immediately after normalized counter movement. `/evidence` publishes measured p50/p95 samples from the current process rather than a prewritten estimate.
- **Originality** — the field builds *markets, bots and dashboards on top of the match*. ROARLINE builds **the match itself** — a data-native broadcast; the market becomes a character in the story rather than a price table.
- **Commercial path** — B2B white-label second-screen for operators/airlines/radio in rights-restricted contexts; B2C premium voices/languages; moment cards as viral acquisition. TxLINE's per-seat data licensing is the native cost model.
- **Completeness** — lobby → authentic room → moments → cards → correction graph → evidence dashboard; live/historical source support; Solana onboarding; low-data SSE; publisher Web Component; deterministic Node/Rust tests; explicit simulation labelling.

## 4 · Running it

```bash
node server/index.mjs      # authentic pinned replay — zero credentials
npm run judge              # terminal transcript of the live broadcast (works on the deployed URL too)

npm install                # required for the full test suite and Solana tooling
npm test                   # engine + replay + proof + telemetry tests
npm run activate           # on-chain subscribe (wallet.json) → .env token
npm run live               # real TxLINE broadcasts + archive replays
```

Optional custom receipts use [programs/roarline-receipts/src/lib.rs](programs/roarline-receipts/src/lib.rs). With Anchor 0.31.1 and Agave 2.1.0/platform-tools v1.43, `npm run build:receipt` reproduces the 265,656-byte SBF binary and verifies artifact SHA-256 `3ac6bac37a00dc09eb1d5756587fe99e9105512bc77154ba417022e1e779dd63`; it does not require the ignored deployment keypair. The CPI proves fixture/stat/value; participant-oriented stat coordinates are preserved, originals must be positive, and corrections must prove a non-negative lower value. Sequence, source/reaction timing, and off-chain hash commitments are broadcaster-supplied metadata with on-chain batch, clock, mapping, and ordering constraints. The program is **not claimed as deployed**: `ROARLINE_RECEIPTS=0` remains the truthful default. The UI separately labels `ARCHIVED PROOF-LOG RECORD`, `TXLINE PROOF BUNDLE FETCHED`, and `PROOF OF BROADCAST CONFIRMED`; only the last requires a confirmed custom receipt.

## 5 · TxLINE API feedback (what we hit, honestly)

**Loved**
- The **on-chain subscribe → signed activation** flow is genuinely elegant: auth that is itself a verifiable Solana artifact. Once understood, it's ~60 lines end-to-end.
- **SSE everywhere** made a broadcast product natural — no polling gymnastics; heartbeats behave; reconnect semantics are sane.
- `stat-validation` returning a complete, self-contained Merkle bundle (summary/subtree/main-tree/stat proof) is a superb primitive: we could attach receipts to *consumer* moments without running settlement infrastructure.
- The stat-key encoding (1–8 + period multipliers) is compact and predictable once discovered.

**Friction**
1. **Finished fixtures vanish from `/api/fixtures/snapshot`** with no "recent/finished" listing. Any replay/archive product must have been recording fixture ids in advance; we built a persistent ledger to survive restarts. A `?includeFinished=true` or `/api/fixtures/recent` would remove a whole class of data loss.
2. **Historical availability window (start between 2 weeks and 6 hours ago)** is documented but easy to trip on around the edges; an explicit `availableFrom/availableTo` in fixture metadata would let UIs grey out replays precisely.
3. **Field-name casing varies across surfaces** (`Seq`/`seq`, `Ts`/`ts`). The docs acknowledge it; a single canonical casing (or a documented per-endpoint table) would delete the most defensive code in every integration, ours included.
4. **Odds payload shape for the 1X2 consensus** took experimentation — we ship a three-layout tolerant mapper. A one-page "this is exactly what one odds message looks like, field by field" example would have saved the afternoon.
5. **Historical odds require walking 5-minute interval buckets** (`/api/odds/updates/{d}/{h}/{i}`) and client-side fixture filtering — ~25–30 calls per match replay. A `?fixtureId=` filter (or `/api/odds/historical/{fixtureId}`) would make replay-heavy consumer products dramatically cheaper for both sides.
6. Small one: guest JWT expiry isn't stated in the response; we renew reactively on 401, which works, but an `expiresAt` would allow proactive renewal.

None of these blocked the build; all of them cost time a first-week integrator could keep.

## 6 · Honesty ledger

- The default no-credential experience is an authentic public capture, not a simulation. Simulation remains available only through `ROARLINE_SOURCE=sim` and is labelled as such.
- The pinned hero package is a deterministic director cut, so sequence gaps are expected and exposed in the ledger; they are omitted source frames, not hidden packet loss.
- In TxLINE live/historical mode, match state and odds come from TxLINE. Proof cards state whether a bundle was fetched; they do not call that a current chain confirmation or proof of footage.
- Archived proof-log records, fetched live bundles, current RPC verification, and confirmed custom MomentReceipts are four distinct statuses. Only `confirmed` is presented as a successful custom receipt transaction, and none is currently claimed for the judge replay.
- The publisher page is an integration demonstration, not evidence of a real external pilot.
- Telemetry is process-local: serialized bytes and server timings are measured internally; render samples must name a real package and carry an active SSE connection token.
- Team identity display is name/code only; no FIFA marks.
