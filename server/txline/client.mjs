// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE TxLINE client · auth, REST, SSE
//
// Credential model (server-side only — nothing TxLINE-related ever reaches the
// browser):
//   · API token   long-lived, bound to our wallet's on-chain `subscribe` tx,
//                 produced once by `npm run activate` → TXLINE_API_TOKEN
//   · guest JWT   short-lived; fetched at boot from POST /auth/guest/start and
//                 auto-renewed whenever a request answers 401
//
// Every data call sends BOTH:  Authorization: Bearer <jwt> · X-Api-Token: <api>
// ─────────────────────────────────────────────────────────────────────────────
import { CONFIG } from "../config.mjs";

export class TxlineClient {
  constructor() {
    this.origin = CONFIG.txline.origin.replace(/\/$/, "");
    this.apiToken = CONFIG.txline.apiToken;
    this.jwt = "";
    this._jwtPromise = null;
  }

  async _renewJwt() {
    this._jwtPromise ??= (async () => {
      const res = await fetch(`${this.origin}/auth/guest/start`, { method: "POST" });
      if (!res.ok) throw new Error(`guest/start → HTTP ${res.status}`);
      const body = await res.json();
      this.jwt = body.token || body;
      return this.jwt;
    })();
    try {
      return await this._jwtPromise;
    } finally {
      this._jwtPromise = null;
    }
  }

  _headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.jwt}`,
      "X-Api-Token": this.apiToken,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  /** GET with automatic one-shot JWT renewal on 401. */
  async get(path, { retry = true } = {}) {
    if (!this.jwt) await this._renewJwt();
    const res = await fetch(`${this.origin}${path}`, { headers: this._headers() });
    if (res.status === 401 && retry) {
      await this._renewJwt();
      return this.get(path, { retry: false });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GET ${path} → HTTP ${res.status} ${text.slice(0, 160)}`);
    }
    return res.json();
  }

  // ── data endpoints ─────────────────────────────────────────────────────────
  fixturesSnapshot(competitionId) {
    return this.get(`/api/fixtures/snapshot${competitionId ? `?competitionId=${competitionId}` : ""}`);
  }
  oddsSnapshot(fixtureId) { return this.get(`/api/odds/snapshot/${fixtureId}`); }
  oddsUpdates(epochDay, hour, interval) { return this.get(`/api/odds/updates/${epochDay}/${hour}/${interval}`); }
  scoresSnapshot(fixtureId) { return this.get(`/api/scores/snapshot/${fixtureId}?asOf=${Date.now()}`); }
  scoresHistorical(fixtureId) { return this.get(`/api/scores/historical/${fixtureId}`); }
  statValidation(fixtureId, seq, statKey) {
    return this.get(`/api/scores/stat-validation?fixtureId=${fixtureId}&seq=${seq}&statKey=${statKey}`);
  }

  /**
   * Consume an SSE stream (`/api/scores/stream` or `/api/odds/stream`) with
   * exponential-backoff reconnect and 401→JWT renewal. Calls onMessage(json)
   * per data line; returns a stop() function.
   */
  stream(path, onMessage, { label = path } = {}) {
    let stopped = false;
    let controller = null;
    let backoff = 1000;

    const loop = async () => {
      while (!stopped) {
        try {
          if (!this.jwt) await this._renewJwt();
          controller = new AbortController();
          const res = await fetch(`${this.origin}${path}`, {
            headers: this._headers({ Accept: "text/event-stream", "Cache-Control": "no-cache" }),
            signal: controller.signal,
          });
          if (res.status === 401) { await this._renewJwt(); continue; }
          if (!res.ok || !res.body) throw new Error(`stream ${label} → HTTP ${res.status}`);
          console.log(`[txline] ${label} connected`);
          backoff = 1000;

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let sep;
            while ((sep = buffer.match(/\r?\n\r?\n/))) {
              const block = buffer.slice(0, sep.index);
              buffer = buffer.slice(sep.index + sep[0].length);
              let data = "";
              for (const line of block.split(/\r?\n/)) {
                if (line.startsWith("data:")) data += line.slice(5).replace(/^ /, "") + "\n";
              }
              data = data.trim();
              if (!data) continue;
              try { onMessage(JSON.parse(data)); } catch { /* heartbeat / non-JSON */ }
            }
          }
          throw new Error("stream ended");
        } catch (err) {
          if (stopped) return;
          console.warn(`[txline] ${label} dropped (${err.message}) — reconnecting in ${backoff}ms`);
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(30000, backoff * 2);
        }
      }
    };
    loop();
    return () => { stopped = true; try { controller?.abort(); } catch { /* already closed */ } };
  }
}

let singleton = null;
export function txline() {
  singleton ??= new TxlineClient();
  return singleton;
}
