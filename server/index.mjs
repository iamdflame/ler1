// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE server · pure Node 20 stdlib — no framework, no build step
//
//   node server/index.mjs            → authentic pinned replay, zero credentials
//   npm run activate && npm run live → real TxLINE World Cup broadcasts
//
// Routes
//   GET /                         the app
//   GET /api/lobby                on air / upcoming / archive
//   GET /api/rooms/:id/stream     the broadcast (SSE) · ?speed=N for replays
//   GET /api/rooms/:id/timeline   full story so far (moments + commentary)
//   GET /api/health               status probe
//   GET /api/debug/raw            last raw TxLINE messages (live mode)
// ─────────────────────────────────────────────────────────────────────────────
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { CONFIG, IS_HERO, IS_SIM, ROOT } from "./config.mjs";
import { Hub } from "./hub.mjs";

const WEB = join(ROOT, "web");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const hub = new Hub();
await hub.start();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;

  try {
    // ── API ────────────────────────────────────────────────────────────────
    if (path === "/api/lobby") return json(res, hub.lobby());

    if (path === "/api/health") {
      return json(res, {
        ok: true,
        product: "ROARLINE",
        mode: IS_HERO ? "authentic-replay" : IS_SIM ? "simulation-lab" : "txline-live",
        rooms: hub.rooms.size, fixturesKnown: hub.fixtures.size, now: Date.now(),
      });
    }

    if (path === "/api/evidence") {
      return json(res, {
        measured: true,
        generatedAt: Date.now(),
        rooms: [...hub.rooms.values()].map((room) => room.evidenceSnapshot()),
      });
    }

    const evidenceMatch = path.match(/^\/api\/evidence\/(\d+)$/);
    if (evidenceMatch) {
      const room = hub.rooms.get(evidenceMatch[1]);
      if (!room) return json(res, { error: "broadcast has not started" }, 404);
      return json(res, room.evidenceSnapshot());
    }

    const receiptsMatch = path.match(/^\/api\/receipts\/(\d+)$/);
    if (receiptsMatch) {
      const room = hub.rooms.get(receiptsMatch[1]);
      if (!room) return json(res, { fixtureId: Number(receiptsMatch[1]), receipts: [] });
      return json(res, { fixtureId: Number(receiptsMatch[1]), receipts: room.evidenceSnapshot().receipts });
    }

    if ((path === "/api/telemetry/frame-ack" || path === "/api/telemetry/render") && req.method === "POST") {
      const body = await readJson(req);
      const room = hub.rooms.get(String(body.fixtureId || ""));
      const frameCallbackMs = Number(body.frameCallbackMs ?? body.renderMs);
      const accepted = room?.recordFrameAck(String(body.telemetryToken || ""), String(body.packageHash || ""), frameCallbackMs) || false;
      return json(res, { ok: accepted }, accepted ? 200 : 422);
    }

    const streamMatch = path.match(/^\/api\/rooms\/(\d+)\/stream$/);
    if (streamMatch) {
      const room = await hub.roomFor(streamMatch[1], { speed: url.searchParams.get("speed") });
      if (!room) return json(res, { error: "unknown fixture" }, 404);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(": roarline broadcast\n\n");
      const heartbeat = setInterval(() => { try { res.write(": hb\n\n"); } catch { /* gone */ } }, 20000);
      res.on("close", () => clearInterval(heartbeat));
      room.addClient(res, url.searchParams.get("profile") || "standard");
      return;
    }

    const timelineMatch = path.match(/^\/api\/rooms\/(\d+)\/timeline$/);
    if (timelineMatch) {
      const room = await hub.roomFor(timelineMatch[1], {});
      if (!room) return json(res, { error: "unknown fixture" }, 404);
      return json(res, { fixtureId: room.meta.fixtureId, timeline: room.timeline });
    }

    if (path === "/api/debug/raw") {
      if (IS_SIM) return json(res, { mode: "demo", note: "raw feed inspection is a live-mode tool", ring: [] });
      const { liveFeed } = await import("./sources/live.mjs");
      return json(res, { mode: "live", ring: liveFeed().rawRing.slice(-40) });
    }

    // ── static app ─────────────────────────────────────────────────────────
    let file = path === "/evidence" ? "/evidence.html"
      : path === "/publisher-demo" ? "/publisher-demo.html"
        : path === "/" || path.startsWith("/m/") ? "/index.html" : normalize(path);
    if (file.includes("..")) return json(res, { error: "no" }, 400);
    try {
      const body = await readFile(join(WEB, file));
      res.writeHead(200, {
        "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(body);
    } catch {
      const body = await readFile(join(WEB, "index.html"));
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
      return res.end(body);
    }
  } catch (err) {
    console.error(`[server] ${req.method} ${path} →`, err);
    return json(res, { error: err.statusCode === 413 ? "request body too large" : "internal" }, err.statusCode || 500);
  }
});

function json(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

async function readJson(req, limit = 16 * 1024) {
  if (Number(req.headers["content-length"]) > limit) {
    req.resume();
    throw Object.assign(new Error("request body too large"), { statusCode: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw Object.assign(new Error("request body too large"), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

server.listen(CONFIG.port, () => {
  const mode = IS_HERO
    ? "AUTHENTIC REPLAY — France v Spain, pinned TxLINE capture + proof evidence"
    : IS_SIM
      ? "SIMULATION LAB (explicit mode; never the primary judge experience)"
    : `LIVE — TxLINE ${CONFIG.txline.origin}`;
  console.log(`\n  ⚡ ROARLINE on http://localhost:${CONFIG.port}\n     ${mode}\n`);
});
