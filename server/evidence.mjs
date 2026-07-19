// Measured evidence only. No seeded vanity counters: every latency sample and
// byte shown by /api/evidence came from this process actually ingesting,
// serializing or rendering a broadcast event.
export class EvidenceMeter {
  constructor(fixtureId, mode) {
    this.fixtureId = Number(fixtureId);
    this.mode = mode;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.events = {};
    this.standardBytes = 0;
    this.lowDataBytes = 0;
    this.clientBytes = { standard: 0, low: 0 };
    this.serverReactionMs = [];
    this.clientFrameCallbackMs = [];
    this.serverFrameAckMs = [];
    this.sourceDelayMs = [];
    this.connections = 0;
    this.peakListeners = 0;
  }

  produced(event, standardBytes, lowDataIncluded) {
    if (this.finishedAt) return;
    this.events[event] = (this.events[event] || 0) + 1;
    this.standardBytes += standardBytes;
    if (lowDataIncluded) this.lowDataBytes += standardBytes;
  }

  connected(current) {
    if (this.finishedAt) return;
    this.connections++;
    this.peakListeners = Math.max(this.peakListeners, current);
  }

  written(profile, bytes) {
    if (this.finishedAt) return;
    const key = profile === "low" ? "low" : "standard";
    this.clientBytes[key] += bytes;
  }

  reaction({ sourceTs, receivedAt, reactionAt }) {
    if (this.finishedAt) return;
    if (Number.isFinite(reactionAt - receivedAt)) this.serverReactionMs.push(Math.max(0, reactionAt - receivedAt));
    // Source timestamp → ingest is a network/feed metric only for a live
    // stream. In a historical director cut it is the age of the match, not
    // latency, and reporting it as performance would be misleading.
    if (this.mode === "live" && Number.isFinite(receivedAt - sourceTs)) {
      this.sourceDelayMs.push(Math.max(0, receivedAt - sourceTs));
    }
  }

  rendered(frameCallbackMs, frameAckMs) {
    if (this.finishedAt) return;
    if (Number.isFinite(frameCallbackMs) && frameCallbackMs >= 0 && frameCallbackMs < 120_000) {
      this.clientFrameCallbackMs.push(frameCallbackMs);
    }
    if (Number.isFinite(frameAckMs) && frameAckMs >= 0 && frameAckMs < 120_000) {
      this.serverFrameAckMs.push(frameAckMs);
    }
  }

  finish() {
    this.finishedAt ??= Date.now();
  }

  snapshot() {
    const elapsedMs = Math.max(1, (this.finishedAt || Date.now()) - this.startedAt);
    return {
      fixtureId: this.fixtureId,
      mode: this.mode,
      measured: true,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      elapsedMs,
      events: this.events,
      listeners: { connections: this.connections, peakConcurrent: this.peakListeners },
      latencyMs: {
        feedIngestToPackage: stats(this.serverReactionMs),
        browserEventToAnimationFrame: stats(this.clientFrameCallbackMs),
        serverWriteToFrameAck: stats(this.serverFrameAckMs),
        sourceTimestampToIngest: stats(this.sourceDelayMs),
      },
      bandwidth: {
        standardBytesProduced: this.standardBytes,
        lowDataBytesProduced: this.lowDataBytes,
        standardKiB: round(this.standardBytes / 1024),
        lowDataKiB: round(this.lowDataBytes / 1024),
        measuredClientBytes: this.clientBytes,
        projectedStandardMiBPer90: project(this.standardBytes, elapsedMs),
        projectedLowDataMiBPer90: project(this.lowDataBytes, elapsedMs),
      },
    };
  }
}

function stats(values) {
  if (!values.length) return { samples: 0, p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: percentile(sorted, 0.50),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}
const percentile = (a, p) => Math.round(a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] * 10) / 10;
const round = (n) => Math.round(n * 100) / 100;
const project = (bytes, elapsedMs) => round((bytes * (90 * 60_000 / elapsedMs)) / 1048576);
