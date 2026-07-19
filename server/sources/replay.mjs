// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE replay source · any finished match, re-broadcast from real data
//
// Fetches the complete score-update sequence from TxLINE's historical endpoint
// (available for fixtures that kicked off between two weeks and six hours ago)
// plus the odds updates for the match window, merges them on their ORIGINAL
// timestamps, and replays them through the same engine the live broadcast
// uses. The room's clock runs in the match's original time space, compressed
// by `speed` — so judges can feel a quarter-final exactly as it streamed.
// ─────────────────────────────────────────────────────────────────────────────
import { txline } from "../txline/client.mjs";
import { mapScore, mapOdds } from "../txline/normalize.mjs";
import { pick } from "../engine/state.mjs";

export class ReplaySource {
  constructor({ fixtureId, homeIsP1 = true, speed = 8 }) {
    this.fixtureId = Number(fixtureId);
    this.homeIsP1 = homeIsP1;
    this.speed = Math.max(1, Number(speed) || 8);
    this.onScore = null;
    this.onOdds = null;
    this.onDone = null;
    this._timers = [];
    this._t0 = null;       // original-time start
    this._real0 = null;    // wall-clock start
    this._stopped = false;
  }

  /** Virtual clock in the match's original time space. */
  now() {
    if (this._t0 === null) return Date.now();
    return this._t0 + (Date.now() - this._real0) * this.speed;
  }

  async start() {
    const tx = txline();
    let scoreEvents = [];
    try {
      const hist = await tx.scoresHistorical(this.fixtureId);
      scoreEvents = (Array.isArray(hist) ? hist : [])
        .map((raw) => ({ kind: "score", u: mapScore(raw, this.homeIsP1) }))
        .filter((e) => e.u);
    } catch (err) {
      console.warn(`[replay ${this.fixtureId}] historical scores: ${err.message}`);
    }
    if (!scoreEvents.length) { this.onDone?.(); return; }

    scoreEvents.sort((a, b) => a.u.ts - b.u.ts || (a.u.seq ?? 0) - (b.u.seq ?? 0));
    const startTs = scoreEvents[0].u.ts;
    const endTs = scoreEvents[scoreEvents.length - 1].u.ts;

    // Odds for the window: walk the 5-minute interval buckets, filter by fixture.
    const oddsEvents = await this._fetchOddsWindow(startTs, endTs);
    const all = [...scoreEvents, ...oddsEvents].sort((a, b) => a.u.ts - b.u.ts);

    this._t0 = startTs;
    this._real0 = Date.now();
    for (const e of all) {
      const delay = (e.u.ts - startTs) / this.speed;
      this._timers.push(setTimeout(() => {
        if (this._stopped) return;
        const delivered = { ...e.u, receivedAt: Date.now(), source: "txline-historical" };
        if (e.kind === "score") this.onScore?.(delivered);
        else this.onOdds?.(delivered);
      }, Math.max(0, delay)));
    }
    this._timers.push(setTimeout(() => this.onDone?.(), Math.max(0, (endTs - startTs) / this.speed + 2000)));
    console.log(`[replay ${this.fixtureId}] ${scoreEvents.length} score updates · ${oddsEvents.length} odds updates · ${Math.round((endTs - startTs) / 60000)}min at ${this.speed}x`);
  }

  async _fetchOddsWindow(startTs, endTs) {
    const tx = txline();
    const out = [];
    const buckets = [];
    for (let t = startTs; t <= endTs + 300000; t += 300000) {
      buckets.push({
        epochDay: Math.floor(t / 86400000),
        hour: new Date(t).getUTCHours(),
        interval: Math.floor(new Date(t).getUTCMinutes() / 5),
      });
    }
    // Fetch buckets with modest parallelism; odds are enrichment, not critical.
    const chunk = 6;
    for (let i = 0; i < buckets.length; i += chunk) {
      const results = await Promise.allSettled(
        buckets.slice(i, i + chunk).map((b) => tx.oddsUpdates(b.epochDay, b.hour, b.interval)),
      );
      for (const r of results) {
        if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
        for (const raw of r.value) {
          const fid = Number(pick(raw ?? {}, "FixtureId", "fixtureId"));
          if (fid && fid !== this.fixtureId) continue;
          const u = mapOdds(raw, this.homeIsP1);
          if (u) out.push({ kind: "odds", u });
        }
      }
    }
    return out;
  }

  stop() {
    this._stopped = true;
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
  }
}
