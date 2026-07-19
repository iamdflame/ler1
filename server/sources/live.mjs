// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE live source · one shared TxLINE stream, many broadcasts
//
// The scores and odds SSE streams cover every fixture on the subscription, so
// the server opens each stream exactly ONCE and routes messages to rooms by
// fixture id. Each room additionally seeds itself from the snapshot endpoints
// so a broadcast joined mid-match starts whole, not empty.
// ─────────────────────────────────────────────────────────────────────────────
import { txline } from "../txline/client.mjs";
import { mapScore, mapOdds } from "../txline/normalize.mjs";
import { pick } from "../engine/state.mjs";

class LiveFeed {
  constructor() {
    this.rooms = new Map(); // fixtureId → Set<LiveSource>
    this.rawRing = [];      // last raw messages for /api/debug/raw
    this._stops = [];
    this._started = false;
  }

  ensureStarted() {
    if (this._started) return;
    this._started = true;
    const tx = txline();
    this._stops.push(tx.stream("/api/scores/stream", (msg) => this._route("score", msg), { label: "scores/stream" }));
    this._stops.push(tx.stream("/api/odds/stream", (msg) => this._route("odds", msg), { label: "odds/stream" }));
  }

  _route(kind, msg) {
    this.rawRing.push({ kind, at: Date.now(), msg });
    if (this.rawRing.length > 200) this.rawRing.splice(0, this.rawRing.length - 200);
    const items = Array.isArray(msg) ? msg : [msg];
    for (const item of items) {
      const fixtureId = Number(pick(item ?? {}, "FixtureId", "fixtureId"));
      if (!Number.isFinite(fixtureId)) continue;
      const set = this.rooms.get(fixtureId);
      if (!set) continue;
      for (const src of set) src._deliver(kind, item);
    }
  }

  register(src) {
    this.ensureStarted();
    let set = this.rooms.get(src.fixtureId);
    if (!set) this.rooms.set(src.fixtureId, (set = new Set()));
    set.add(src);
  }

  unregister(src) {
    const set = this.rooms.get(src.fixtureId);
    if (set) { set.delete(src); if (!set.size) this.rooms.delete(src.fixtureId); }
  }
}

let feed = null;
export function liveFeed() {
  feed ??= new LiveFeed();
  return feed;
}

export class LiveSource {
  constructor({ fixtureId, homeIsP1 = true }) {
    this.fixtureId = Number(fixtureId);
    this.homeIsP1 = homeIsP1;
    this.onScore = null;
    this.onOdds = null;
    this.onDone = null;
    this._hydrating = false;
    this._pending = [];
    this._baselineScoreSeq = null;
    this._baselineScoreTs = null;
  }

  now() { return Date.now(); }

  async start() {
    this._hydrating = true;
    liveFeed().register(this);
    // Seed from snapshots so late-created rooms have score + odds instantly.
    const tx = txline();
    try {
      const snap = await tx.scoresSnapshot(this.fixtureId);
      const items = (Array.isArray(snap) ? snap : [snap]).filter(Boolean);
      items.sort((a, b) => (Number(pick(a, "Seq", "seq")) || 0) - (Number(pick(b, "Seq", "seq")) || 0));
      const latest = items.at(-1);
      if (latest) this._deliver("score", latest, { baseline: true });
    } catch (err) { console.warn(`[live ${this.fixtureId}] scores snapshot: ${err.message}`); }
    try {
      const odds = await tx.oddsSnapshot(this.fixtureId);
      this._deliver("odds", odds);
    } catch (err) { console.warn(`[live ${this.fixtureId}] odds snapshot: ${err.message}`); }
    this._finishHydration();
  }

  _finishHydration() {
    this._hydrating = false;
    const pending = this._pending.splice(0).filter(({ kind, raw }) => {
      if (kind !== "score") return true;
      const seq = Number(pick(raw, "Seq", "seq"));
      if (Number.isFinite(seq) && this._baselineScoreSeq !== null) return seq > this._baselineScoreSeq;
      const ts = Number(pick(raw, "Ts", "ts", "Timestamp", "timestamp"));
      if (Number.isFinite(ts) && this._baselineScoreTs !== null) return ts > this._baselineScoreTs;
      return true;
    }).sort((a, b) => {
      if (a.kind !== b.kind) return a.at - b.at;
      return (Number(pick(a.raw, "Seq", "seq")) || 0) - (Number(pick(b.raw, "Seq", "seq")) || 0);
    });
    for (const item of pending) this._deliver(item.kind, item.raw);
  }

  stop() {
    this._pending = [];
    liveFeed().unregister(this);
  }

  _deliver(kind, raw, { baseline = false } = {}) {
    if (this._hydrating && !baseline) {
      this._pending.push({ kind, raw, at: Date.now() });
      return;
    }
    if (kind === "score") {
      const u = mapScore(raw, this.homeIsP1);
      if (u && u.fixtureId === this.fixtureId) {
        if (baseline) {
          this._baselineScoreSeq = Number.isFinite(u.seq) ? u.seq : null;
          this._baselineScoreTs = Number(u.ts);
        }
        this.onScore?.({ ...u, receivedAt: Date.now(), source: "txline-live", baseline });
        if (u.phase === 100) this.onDone?.();
      }
    } else {
      const u = mapOdds(raw, this.homeIsP1);
      if (u && (!u.fixtureId || u.fixtureId === this.fixtureId)) {
        this.onOdds?.({
          ...u,
          receivedAt: Date.now(),
          source: "txline-live",
          messageId: pick(raw ?? {}, "MessageId", "messageId"),
        });
      }
    }
  }
}
