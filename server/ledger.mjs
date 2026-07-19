// ROARLINE event ledger — deterministic, hash-chained, replay-safe.
//
// Every normalized TxLINE update enters here before it can affect state. The
// chain gives live ingestion, historical replay and the curated hero package a
// common independently recomputable identity. Wall-clock receipt timestamps
// are metadata only; they never enter the hash, so replaying the same source
// produces the identical head.
import { createHash } from "node:crypto";

export const ZERO_HASH = "0".repeat(64);

export function stableStringify(value) {
  return JSON.stringify(canonical(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonical(value[key]);
    }
    return out;
  }
  return value;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export class EventLedger {
  constructor(fixtureId) {
    this.fixtureId = Number(fixtureId);
    this.entries = [];
    this.seen = new Set();
    this.head = ZERO_HASH;
    this.lastScoreSeq = null;
    this.gaps = [];
    this.duplicates = 0;
    this.stale = 0;
  }

  append(kind, update) {
    const identity = kind === "score"
      ? `score:${update.seq ?? sha256(stableStringify(sourcePayload(kind, update)))}`
      : `odds:${update.messageId ?? update.ts}:${update.pHome}:${update.pDraw}:${update.pAway}`;
    if (this.seen.has(identity)) {
      this.duplicates++;
      return { duplicate: true, rejected: true, identity };
    }

    if (kind === "score" && Number.isInteger(update.seq)) {
      if (this.lastScoreSeq !== null && update.seq < this.lastScoreSeq) {
        this.stale++;
        return { stale: true, rejected: true, identity };
      }
      if (this.lastScoreSeq !== null && update.seq > this.lastScoreSeq + 1) {
        this.gaps.push({ after: this.lastScoreSeq, before: update.seq, missing: update.seq - this.lastScoreSeq - 1 });
      }
      this.lastScoreSeq = Math.max(this.lastScoreSeq ?? update.seq, update.seq);
    }
    this.seen.add(identity);

    const body = {
      v: 1,
      fixtureId: this.fixtureId,
      index: this.entries.length,
      kind,
      source: update.source || "txline-live",
      sourcePackageHash: update.sourcePackageHash || null,
      payload: sourcePayload(kind, update),
    };
    const canonicalBody = stableStringify(body);
    const hash = sha256(`${this.head}:${canonicalBody}`);
    const entry = {
      ...body,
      prevHash: this.head,
      hash,
      payloadHash: sha256(stableStringify(body.payload)),
      receivedAt: update.receivedAt || Date.now(),
    };
    this.head = hash;
    this.entries.push(entry);
    return entry;
  }

  summary() {
    return {
      fixtureId: this.fixtureId,
      entries: this.entries.length,
      head: this.head,
      duplicatesRejected: this.duplicates,
      staleRejected: this.stale,
      gaps: this.gaps,
      deterministic: true,
    };
  }
}

function sourcePayload(kind, u) {
  if (kind === "score") {
    return {
      fixtureId: Number(u.fixtureId),
      seq: u.seq ?? null,
      ts: Number(u.ts),
      phase: u.phase ?? null,
      clockMin: u.clockMin ?? null,
      stats: u.stats || null,
        sourceStats: u.participant1IsHome === false ? u.sourceStats || null : undefined,
        sourceParticipant: u.participant1IsHome === false ? u.sourceParticipant ?? null : undefined,
        participant1IsHome: u.participant1IsHome === false ? false : undefined,
      action: u.action || null,
      actionData: u.actionData || null,
      directorAtMs: u.directorAtMs ?? null,
      directorCut: Boolean(u.directorCut),
      baseline: Boolean(u.baseline),
    };
  }
  return {
    fixtureId: Number(u.fixtureId),
    messageId: u.messageId || null,
    ts: Number(u.ts),
    pHome: Number(u.pHome),
    pDraw: Number(u.pDraw),
    pAway: Number(u.pAway),
    inRunning: Boolean(u.inRunning),
    directorAtMs: u.directorAtMs ?? null,
  };
}
