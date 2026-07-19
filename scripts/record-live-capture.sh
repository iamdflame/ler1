#!/usr/bin/env bash
# ROARLINE own-capture recorder for a live fixture.
# Records: (1) the broadcast SSE stream, (2) periodic /api/debug/raw snapshots,
# each line prefixed with an ISO-8601 wall timestamp; finishes with SHA-256s.
# Usage: scripts/record-live-capture.sh <fixtureId> [origin] [outDir]
set -euo pipefail
FIXTURE="${1:?usage: record-live-capture.sh <fixtureId> [origin] [outDir]}"
ORIGIN="${2:-http://localhost:8090}"
OUT="${3:-capture/live-$FIXTURE-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT"
echo "recording fixture $FIXTURE from $ORIGIN into $OUT"

ts() { while IFS= read -r line; do printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" "$line"; done; }

# 1 · broadcast SSE stream (auto-reconnect until killed)
(
  while true; do
    curl -sN --max-time 14400 "$ORIGIN/api/rooms/$FIXTURE/stream" | ts >> "$OUT/stream.sse.log" || true
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [recorder] stream disconnected; retrying in 5s" >> "$OUT/stream.sse.log"
    sleep 5
  done
) &
STREAM_PID=$!

# 2 · raw TxLINE feed ring, snapshotted every 20s (dedup happens at analysis time)
(
  while true; do
    curl -s "$ORIGIN/api/debug/raw" | ts >> "$OUT/debug-raw.snapshots.log" || true
    sleep 20
  done
) &
RAW_PID=$!

echo "$STREAM_PID $RAW_PID" > "$OUT/pids"
trap 'kill $STREAM_PID $RAW_PID 2>/dev/null; sha256sum "$OUT"/*.log | tee "$OUT/SHA256SUMS"; echo "capture sealed: $OUT"' EXIT
echo "recording — Ctrl+C to stop and seal hashes"
wait
