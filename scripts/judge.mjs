#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE · judge — one command, zero credentials, watch the product work
//
//   node scripts/judge.mjs                     (against local server)
//   ROARLINE_URL=https://your-deploy node scripts/judge.mjs
//
// It probes the running instance, tunes into the current broadcast through its
// seconds, and prints the live transcript: state frames, drama signals,
// booth commentary, moments — the whole engine, visible in a terminal.
// Pure Node stdlib; works against authentic replay, simulation, and live modes.
// ─────────────────────────────────────────────────────────────────────────────
const BASE = (process.env.ROARLINE_URL || "http://localhost:8080").replace(/\/$/, "");
const C = { g: "\x1b[92m", y: "\x1b[93m", r: "\x1b[91m", c: "\x1b[96m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };
const ok = (s) => console.log(`${C.g}✓${C.x} ${s}`);
const bad = (s) => { console.log(`${C.r}✗ ${s}${C.x}`); process.exitCode = 1; };

console.log(`\n${C.b}⚡ ROARLINE judge${C.x} ${C.d}· ${BASE}${C.x}\n`);

// 1 · health
let health;
try {
  health = await (await fetch(`${BASE}/api/health`)).json();
  ok(`server up — mode ${C.b}${health.mode}${C.x} · ${health.rooms} room(s) · ${health.fixturesKnown} fixtures known`);
} catch (e) {
  bad(`server unreachable (${e.message}) — start it: node server/index.mjs`);
  process.exit(1);
}

// 2 · lobby
const lobby = await (await fetch(`${BASE}/api/lobby`)).json();
ok(`lobby — ${lobby.live.length} on air · ${lobby.upcoming.length} upcoming · ${lobby.archive.length} in the archive`);
const target = health.mode === "authentic-replay"
  ? lobby.featured?.[0]
  : lobby.live[0] || lobby.featured?.[0] || lobby.archive.find((a) => a.replayable);
if (!target) { bad("nothing on air and nothing replayable"); process.exit(1); }
const label = `${target.home.name} v ${target.away.name}`;
const targetKind = lobby.live[0] === target ? "live" : lobby.featured?.[0] === target ? "authentic replay" : "archive re-broadcast";
ok(`tuning into ${C.b}${label}${C.x} (fixture ${target.fixtureId}) — ${targetKind}`);

// 3 · listen to the broadcast
const speed = targetKind === "archive re-broadcast" ? "?speed=64" : "";
const res = await fetch(`${BASE}/api/rooms/${target.fixtureId}/stream${speed}`, { headers: { Accept: "text/event-stream" } });
if (!res.ok || !res.body) { bad(`stream → HTTP ${res.status}`); process.exit(1); }
const authentic = health.mode === "authentic-replay";
const maxDurationMs = authentic ? 110_000 : 45_000;
ok(`SSE broadcast open — transcribing ${authentic ? "the complete authentic replay" : "45 seconds"}\n${C.d}──────────────────────────────────────────────────${C.x}`);

const counts = { state: 0, signal: 0, moment: 0, commentary: 0, proof: 0 };
let lastFever = 0, lastProb = null;
let lastState = null, sawCorrection = false, sawDone = false;
const archivedProofs = new Set();
const started = Date.now();
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

const stamp = () => `${C.d}${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s${C.x}`;

outer: while (Date.now() - started < maxDurationMs) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let sep;
  while ((sep = buffer.match(/\r?\n\r?\n/))) {
    const block = buffer.slice(0, sep.index);
    buffer = buffer.slice(sep.index + sep[0].length);
    const ev = /^event: (.+)$/m.exec(block)?.[1];
    const dataRaw = [...block.matchAll(/^data: (.*)$/gm)].map((m) => m[1]).join("\n");
    if (!ev || !dataRaw) continue;
    let data;
    try { data = JSON.parse(dataRaw); } catch { continue; }
    counts[ev] = (counts[ev] ?? 0) + 1;
    if (ev === "state") lastState = data;

    if (ev === "hello") {
      console.log(`${stamp()} ${C.c}HELLO${C.x} ${data.state.home.code} ${data.state.score.home}–${data.state.score.away} ${data.state.away.code} · ${data.state.phaseLabel} · timeline ${data.timeline.length} entries · mode ${data.mode}`);
    } else if (ev === "commentary") {
      const heat = data.heat >= 0.9 ? C.y + C.b : data.heat >= 0.6 ? C.b : data.voice === "market" ? C.d : "";
      console.log(`${stamp()} ${C.c}BOOTH${C.x} ${heat}${data.minute}′ ${data.text}${C.x}`);
    } else if (ev === "moment") {
      if (data.type === "GOAL_REVOKED" || data.type === "CARD_REVOKED") sawCorrection = true;
      console.log(`${stamp()} ${C.y}MOMENT${C.x} ${data.type}${data.team ? ` (${data.team})` : ""} · intensity ${data.intensity}`);
    } else if (ev === "signal") {
      lastFever = data.fever;
      lastProb = data.winProb;
      if (counts.signal % 10 === 1) console.log(`${stamp()} ${C.d}SIGNAL fever ${data.fever} · pressure ${data.pressure} · ${data.clockMin}′${data.winProb ? ` · ${Math.round(data.winProb.home * 100)}/${Math.round(data.winProb.draw * 100)}/${Math.round(data.winProb.away * 100)}` : ""}${C.x}`);
    } else if (ev === "proof") {
      if (data.archivedProofRecord && data.txSig) archivedProofs.add(data.txSig);
      const status = data.demo
        ? "demo"
        : data.receiptStatus === "confirmed"
          ? "custom receipt confirmed"
          : data.proofBundleFetched
            ? "TxLINE bundle fetched; receipt unconfirmed"
            : data.archivedProofRecord
              ? "archived proof-log record; current RPC unavailable"
              : "unconfirmed proof reference";
      console.log(`${stamp()} ${C.g}PROOF${C.x} fixture ${data.fixtureId} seq ${data.seq} stat ${data.statKey} · ${status}`);
    } else if (ev === "done") {
      sawDone = true;
      break outer;
    }
  }
}
try { reader.cancel(); } catch { /* closed */ }

console.log(`${C.d}──────────────────────────────────────────────────${C.x}`);
ok(`stream verdict — ${counts.signal} signal frames · ${counts.moment} moments · ${counts.commentary} booth lines · ${counts.state} state frames${counts.proof ? ` · ${counts.proof} proofs` : ""}`);
if (counts.signal >= 30) ok(`continuous signal cadence confirmed — ${counts.signal} frames observed`);
else bad("signal cadence below expectation");
if (counts.commentary >= 1 && counts.state >= 1) ok("engine chain (state → moments → booth) confirmed");
if (lastProb) ok(`market narration live — closing read ${Math.round(lastProb.home * 100)}% / ${Math.round(lastProb.draw * 100)}% / ${Math.round(lastProb.away * 100)}% · fever ${lastFever}`);
if (authentic) {
  if (sawDone) ok("authentic replay completed"); else bad("authentic replay did not emit done");
  if (sawCorrection) ok("correction sequence observed"); else bad("authentic correction was not observed");
  if (lastState?.score?.home === 0 && lastState?.score?.away === 2 && lastState?.finished) ok("final state confirmed — France 0–2 Spain");
  else bad(`unexpected final state — ${lastState?.score?.home ?? "?"}–${lastState?.score?.away ?? "?"}`);
  if (archivedProofs.size === 3) ok("three distinct archived proof-log records observed");
  else bad(`expected three archived proof-log records, observed ${archivedProofs.size}`);
}
if (health.mode === "simulation-lab") {
  console.log(`\n${C.d}This instance runs the labelled DEMO channel. With TXLINE_API_TOKEN set (npm run activate),`);
  console.log(`the exact same pipeline is fed by TxLINE's live scores + odds streams and historical replays.${C.x}`);
} else if (health.mode === "authentic-replay") {
  console.log(`\n${C.d}This instance runs the provenance-pinned public TxLINE capture; simulation is not active.${C.x}`);
}
console.log("");
