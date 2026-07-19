// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE room · one fixture, one broadcast
//
// A Room wires a data source (live TxLINE stream, TxLINE historical replay, or
// the offline sim) into the engine chain — state → moments → drama →
// commentary — and fans the result out to every connected listener over SSE.
//
// It also keeps the full broadcast TIMELINE in memory, so a viewer joining late
// gets the story so far in one frame and an available archived match replays
// through the exact same pipeline the live match used. No second code path.
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { newMatchState, applyScoreUpdate, applyOddsUpdate, snapshot } from "./state.mjs";
import { DramaEngine } from "./drama.mjs";
import { Commentator } from "./commentary.mjs";
import { EventLedger, sha256, stableStringify } from "../ledger.mjs";
import { EvidenceMeter } from "../evidence.mjs";

export class Room {
  /**
   * @param {object} meta   fixture metadata {fixtureId, home, away, ...}
   * @param {object} opts   { mode: "live"|"replay"|"sim", proofs?: fn }
   */
  constructor(meta, opts = {}) {
    this.id = String(meta.fixtureId);
    this.meta = meta;
    this.mode = opts.mode || "live";
    this.proofs = opts.proofs || null; // async (fixtureId, seq, statKey) → proof | null
    this.state = newMatchState(meta);
    this.drama = new DramaEngine(this.state);
    this.voice = new Commentator(this.state);
    this.ledger = new EventLedger(meta.fixtureId);
    this.evidence = new EvidenceMeter(meta.fixtureId, this.mode);
    this.clients = new Map(); // http.ServerResponse → { profile: standard|low }
    this.timeline = [];       // [{kind:"moment"|"commentary", ...}]
    this.signals = [];        // ring buffer of recent signal frames (for the river)
    this.activeMajorMoments = new Map(); // goal:home / goal:away / red:* → active entry stack
    this.receipts = new Map();
    this._renderSamples = new Set();
    this._packageSentAt = new Map(); // telemetry token + package → server monotonic SSE write time
    this._signalCount = 0;
    this._ticker = null;
    this._source = null;
    this._proofTimers = new Set();
    this._proofFrozen = false;
    this.onEmpty = null;      // set by the hub for replay-room GC
    this._emptySince = null;
  }

  start(source) {
    this._source = source;
    source.onScore = (u) => this._ingestScore(u);
    source.onOdds = (u) => this._ingestOdds(u);
    source.onDone = () => {
      clearInterval(this._ticker);
      this._ticker = null;
      this._proofFrozen = true;
      for (const timer of this._proofTimers) clearTimeout(timer);
      this._proofTimers.clear();
      this.evidence.finish();
      this._broadcast("done", { finished: true, evidence: this.evidence.snapshot() });
      for (const res of this.clients.keys()) { try { res.end(); } catch { /* client gone */ } }
      this.clients.clear();
      this._packageSentAt.clear();
      this._emptySince = Date.now();
    };
    source.start();
    if (!this.evidence.finishedAt) {
      this._ticker = setInterval(() => this._tick(), 1000);
      this._tick();
    }
  }

  stop() {
    clearInterval(this._ticker);
    this._ticker = null;
    for (const timer of this._proofTimers) clearTimeout(timer);
    this._proofTimers.clear();
    try { this._source?.stop?.(); } catch { /* source already gone */ }
    for (const res of this.clients.keys()) { try { res.end(); } catch { /* client gone */ } }
    this.clients.clear();
    this._packageSentAt.clear();
  }

  _ingestScore(u) {
    const sourceEntry = this.ledger.append("score", u);
    if (sourceEntry.rejected) return;
    const moments = applyScoreUpdate(this.state, u);
    for (const m of moments) this._emitMoment(m, sourceEntry);
    this._broadcast("state", snapshot(this.state));
  }

  _ingestOdds(u) {
    const sourceEntry = this.ledger.append("odds", u);
    if (sourceEntry.rejected) return;
    const moments = applyOddsUpdate(this.state, u);
    if (this.state.odds) this.drama.onOdds(this.state.odds);
    for (const m of moments) this._emitMoment(m, sourceEntry);
  }

  _emitMoment(m, sourceEntry) {
    const reactionTs = Date.now();
    this.evidence.reaction({
      sourceTs: Number(m.ts),
      receivedAt: sourceEntry.receivedAt,
      reactionAt: reactionTs,
    });
    this.drama.onMoment(m);
    const correctionKey = m.team ? `${m.type === "RED_CARD" || m.type === "CARD_REVOKED" ? "red" : "goal"}:${m.team}` : null;
    const isCorrection = m.type === "GOAL_REVOKED" || m.type === "CARD_REVOKED";
    const activeStack = correctionKey ? (this.activeMajorMoments.get(correctionKey) || []) : [];
    const previous = isCorrection ? activeStack.at(-1) || null : null;
    const line = this.voice.callMoment(m);
    const packageBody = {
      v: 1,
      fixtureId: Number(this.meta.fixtureId),
      sourceEntryHash: sourceEntry.hash,
      type: m.type,
      team: m.team || null,
      minute: m.minute,
      sourceTs: Number(m.ts),
      score: { ...this.state.score },
      pens: { ...this.state.pens },
      stats: { ...this.state.stats },
      phase: this.state.phase,
      phaseLabel: this.state.phaseLabel,
      clockMin: this.state.clockMin,
      odds: this.state.odds ? { ...this.state.odds } : null,
      detail: m.detail || null,
      supersedes: previous?.packageHash || null,
      commentary: line ? { semanticKey: line.semanticKey, args: line.args } : null,
    };
    const packageHash = sha256(stableStringify(packageBody));
    const entry = {
      kind: "moment",
      ...m,
      sourceEntryHash: sourceEntry.hash,
      sourceTs: Number(m.ts),
      reactionTs,
      packageHash,
      supersedes: previous?.packageHash || null,
      supersededBy: null,
      receiptStatus: "pending",
      stateSnapshot: {
        score: { ...this.state.score },
        pens: { ...this.state.pens },
        stats: { ...this.state.stats },
        phase: this.state.phase,
        phaseLabel: this.state.phaseLabel,
        clockMin: this.state.clockMin,
        live: this.state.live,
        finished: this.state.finished,
        odds: this.state.odds ? { ...this.state.odds } : null,
      },
    };
    if (previous) previous.supersededBy = packageHash;
    if (correctionKey && ["GOAL", "RED_CARD"].includes(m.type)) {
      activeStack.push(entry);
      this.activeMajorMoments.set(correctionKey, activeStack);
    }
    if (isCorrection && correctionKey && previous) {
      activeStack.pop();
      if (activeStack.length) this.activeMajorMoments.set(correctionKey, activeStack);
      else this.activeMajorMoments.delete(correctionKey);
    }
    this.timeline.push(entry);
    this._broadcast("moment", entry);

    if (line) {
      const c = { kind: "commentary", momentPackageHash: packageHash, ...line };
      this.timeline.push(c);
      this._broadcast("commentary", c);
    }

    // Verifiable moments: attach the TxLINE Merkle-proof coordinates, and (in
    // live mode) fetch the real stat-validation bundle in the background.
    if (["GOAL", "GOAL_REVOKED", "RED_CARD", "CARD_REVOKED"].includes(m.type) && m.detail?.seq && this.proofs) {
      const sourceStatKey = m.detail.sourceStatKey ?? m.detail.statKey;
      const sourceParticipant = m.detail.sourceParticipant
        ?? (sourceStatKey % 1000 % 2 ? 1 : 2);
      this._requestProof({ ...m, detail: { ...m.detail, statKey: sourceStatKey } }, entry, {
        eventType: m.type,
        eventTeam: m.team,
        sourceParticipant,
        eventValue: m.detail.statValue,
        sourceTs: Number(m.ts),
        reactionTs,
        packageHash,
        sourceEntryHash: sourceEntry.hash,
        previousPackageHash: entry.supersedes,
      });
    }
  }

  _requestProof(moment, entry, context, attempt = 0) {
    if (this._proofFrozen) return;
    Promise.resolve()
      .then(() => this.proofs(this.meta.fixtureId, moment.detail.seq, moment.detail.statKey, context))
      .then((proof) => {
        if (this._proofFrozen) return;
        if (!proof) return this._retryProof(moment, entry, context, attempt);
        entry.receiptStatus = proof.receiptStatus || (proof.demo ? "demo" : "proof-reference");
        entry.proof = proof;
        this.receipts.set(entry.packageHash, { packageHash: entry.packageHash, moment: entry, proof });
        this._broadcast("proof", { momentTs: moment.ts, packageHash: entry.packageHash, ...proof });
        if (proof.retryable) this._retryProof(moment, entry, context, attempt);
      })
      .catch(() => this._retryProof(moment, entry, context, attempt));
  }

  _retryProof(moment, entry, context, attempt) {
    if (this._proofFrozen || attempt >= 13) return;
    const delay = Math.min(30_000, 5_000 * (2 ** Math.min(attempt, 3)));
    const timer = setTimeout(() => {
      this._proofTimers.delete(timer);
      this._requestProof(moment, entry, context, attempt + 1);
    }, delay);
    timer.unref?.();
    this._proofTimers.add(timer);
  }

  _tick() {
    const now = this._source?.now?.() ?? Date.now();
    const frame = this.drama.tick(now);
    this._signalCount++;
    this.signals.push(frame);
    if (this.signals.length > 900) this.signals.splice(0, this.signals.length - 900);
    this._broadcast("signal", frame);

    const color = this.voice.colorLine(now, frame.fever);
    if (color) {
      const c = { kind: "commentary", ...color };
      this.timeline.push(c);
      this._broadcast("commentary", c);
    }

    // Replay rooms with no listeners shut themselves down.
    if (this.clients.size === 0) {
      this._emptySince ??= Date.now();
      if (this.mode === "replay" && Date.now() - this._emptySince > 60000) this.onEmpty?.(this);
    } else this._emptySince = null;
  }

  /** Attach an SSE client; sends a full hello frame so late joiners are whole. */
  addClient(res, profile = "standard") {
    const normalizedProfile = profile === "low" ? "low" : "standard";
    const telemetryToken = randomUUID();
    this.clients.set(res, { profile: normalizedProfile, telemetryToken });
    this.evidence.connected(this.clients.size);
    res.on("close", () => this._removeClient(res));
    const low = normalizedProfile === "low";
    this._send(res, "hello", {
      mode: this.mode,
      state: snapshot(this.state),
      profile: normalizedProfile,
      telemetryToken,
      ledger: this.ledger.summary(),
      timeline: low ? this.timeline.filter(isEssentialTimelineEntry).slice(-40) : this.timeline.slice(-160),
      signals: low ? this.signals.filter((_, i) => i % 10 === 0).slice(-30) : this.signals.slice(-240),
    });
    if (this.evidence.finishedAt) {
      this._send(res, "done", { finished: true, evidence: this.evidence.snapshot() });
    }
  }

  _broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const bytes = Buffer.byteLength(payload);
    const lowIncluded = event === "signal"
      ? this._signalCount % 10 === 0
      : event === "moment" || event === "commentary"
        ? isEssentialTimelineEntry(data)
        : true;
    this.evidence.produced(event, bytes, lowIncluded);
    if (!this.clients.size) return;
    const sentAt = event === "moment" && data?.packageHash ? performance.now() : null;
    if (sentAt !== null) {
      for (const [key, value] of this._packageSentAt) {
        if (sentAt - value >= 120_000) this._packageSentAt.delete(key);
      }
    }
    for (const [res, client] of this.clients) {
      if (client.profile === "low" && !lowIncluded) continue;
      try {
        res.write(payload);
        this.evidence.written(client.profile, bytes);
        if (sentAt !== null) this._packageSentAt.set(`${client.telemetryToken}:${data.packageHash}`, sentAt);
      } catch { this._removeClient(res); }
    }
  }

  _removeClient(res) {
    const token = this.clients.get(res)?.telemetryToken;
    this.clients.delete(res);
    if (!token) return;
    for (const key of this._packageSentAt.keys()) {
      if (key.startsWith(`${token}:`)) this._packageSentAt.delete(key);
    }
  }

  _send(res, event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    try {
      res.write(payload);
      this.evidence.written(this.clients.get(res)?.profile, Buffer.byteLength(payload));
    } catch { /* client gone */ }
  }

  recordFrameAck(token, packageHash, frameCallbackMs) {
    if (this.evidence.finishedAt || !Number.isFinite(frameCallbackMs) || frameCallbackMs < 0 || frameCallbackMs >= 120_000) return false;
    const active = [...this.clients.values()].some((client) => client.telemetryToken === token);
    const packageExists = this.timeline.some((entry) => entry.kind === "moment" && entry.packageHash === packageHash);
    const sampleKey = `${token}:${packageHash}`;
    const sentAt = this._packageSentAt.get(sampleKey);
    const ackMs = sentAt === undefined ? null : performance.now() - sentAt;
    if (!active || !packageExists || this._renderSamples.has(sampleKey) || !Number.isFinite(ackMs) || ackMs < 0 || ackMs >= 120_000) return false;
    this._renderSamples.add(sampleKey);
    this._packageSentAt.delete(sampleKey);
    this.evidence.rendered(frameCallbackMs, ackMs);
    return true;
  }

  evidenceSnapshot() {
    const ledger = this.ledger.summary();
    if (this.mode === "authentic-replay") {
      ledger.gapPolicy = "expected-director-cut-omissions";
      ledger.gapExplanation = "This provenance-pinned director cut intentionally omits source frames between selected match beats; sequence gaps are disclosed source omissions, not measured packet loss.";
    }
    return {
      ...this.evidence.snapshot(),
      ledger,
      packageHashes: this.timeline.filter((e) => e.kind === "moment" && e.packageHash).map((e) => e.packageHash),
      receipts: [...this.receipts.values()].map(({ packageHash, moment, proof }) => ({
        packageHash,
        type: moment.type,
        supersedes: moment.supersedes,
        supersededBy: moment.supersededBy,
        status: moment.receiptStatus,
        proofKind: proof.receiptStatus === "confirmed"
          ? "receipt-confirmed"
          : proof.proofBundleFetched
            ? "live-bundle-fetched"
            : proof.archivedProofRecord ? "archived-proof-log-record" : "unconfirmed",
        currentRpcVerified: proof.currentRpcVerified === true,
        rpcAvailable: proof.rpcAvailable ?? null,
        txSignature: proof.receiptTx || proof.txSig || null,
        explorer: proof.receiptExplorer || proof.explorer || null,
        proofReferenceUrl: proof.proofReferenceUrl || null,
      })),
    };
  }

  publicInfo() {
    const s = this.state;
    return {
      fixtureId: this.meta.fixtureId,
      home: s.home, away: s.away,
      competition: s.competition, stage: s.stage, venue: s.venue,
      startTime: s.startTime,
      phase: s.phase, phaseLabel: s.phaseLabel,
      live: s.live, finished: s.finished,
      score: s.score, clockMin: s.clockMin,
      listeners: this.clients.size,
      mode: this.mode,
    };
  }
}

const ESSENTIAL_TYPES = new Set(["GOAL", "GOAL_REVOKED", "RED_CARD", "CARD_REVOKED", "FULLTIME", "FINALISED", "VAR_CHECK", "VAR_RESULT", "MARKET_SURGE"]);
function isEssentialTimelineEntry(entry) {
  return entry.kind === "moment" ? ESSENTIAL_TYPES.has(entry.type) : ESSENTIAL_TYPES.has(entry.type) || entry.heat >= 0.6;
}
