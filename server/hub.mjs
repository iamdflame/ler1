// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE hub · the station controller
//
// Owns the lobby (what's on air, what's next, what's in the archive) and the
// lifecycle of every Room. Three source personalities:
//
//   hero    serves the authentic, hash-pinned France–Spain director cut and
//           creates a fresh 90-second room when a listener presses play.
//
//   txline  polls /api/fixtures/snapshot, PERSISTS every fixture it has ever
//           seen (the snapshot only lists upcoming matches — finished ones
//           vanish from it, so the archive is our own ledger), auto-opens live
//           rooms around kick-off, and serves replays through TxLINE's
//           historical endpoint for any fixture in its availability window.
//
//   sim     an endless demo channel: one simulated match always on air (a new
//           one kicks off shortly after the last ends) plus a replayable
//           archive for explicit synthetic engine testing.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG, IS_HERO, IS_SIM, ROOT } from "./config.mjs";
import { Room } from "./engine/room.mjs";
import { momentProof } from "./proofs.mjs";
import { SimSource, simFixtures } from "./sources/sim.mjs";

const DATA_DIR = join(ROOT, "data");
const FIXTURES_FILE = join(DATA_DIR, "fixtures.json");

export class Hub {
  constructor() {
    this.rooms = new Map();      // fixtureId(string) → Room
    this.fixtures = new Map();   // fixtureId(string) → fixture meta (ledger)
    this.sim = null;             // sim lobby handle
    this._simLiveId = null;
    this._roomCreations = new Map();
  }

  async start() {
    if (IS_HERO) await this._startHero();
    else if (IS_SIM) this._startSim();
    else await this._startTxline();
  }

  async _startHero() {
    // The primary no-credential experience is an authentic, hash-pinned
    // TxLINE capture—not a simulation. A room starts only when a listener
    // presses play, so every judge gets the complete 90-second director cut.
    const { loadHeroPackage } = await import("./sources/hero.mjs");
    const pkg = loadHeroPackage();
    const fixture = {
      ...pkg.fixture,
      authentic: true,
      featured: true,
      replayable: true,
      packageHash: pkg.packageHash,
      provenance: pkg.provenance,
      startTime: pkg.fixture.startTime,
    };
    this.fixtures.set(String(fixture.fixtureId), fixture);
    console.log(`[hub] AUTHENTIC HERO ready — ${fixture.home.name} v ${fixture.away.name} · package ${pkg.packageHash.slice(0, 12)}…`);
  }

  // ── sim channel ────────────────────────────────────────────────────────────
  _startSim() {
    this.sim = simFixtures();
    for (const f of [this.sim.live, this.sim.next, ...this.sim.archive]) {
      this.fixtures.set(String(f.fixtureId), f);
    }
    this._openSimLive(this.sim.live);
    console.log(`[hub] DEMO channel on air — ${this.sim.live.home.name} v ${this.sim.live.away.name}`);
  }

  _openSimLive(f) {
    const room = new Room(f, { mode: "live", proofs: momentProof });
    const source = new SimSource({ fixtureId: f.fixtureId, seed: f.seed, strengthH: f.strengthH, speed: 12 });
    this.rooms.set(String(f.fixtureId), room);
    this._simLiveId = String(f.fixtureId);
    room.start(source);
    // room.start installed its own onDone (broadcasts "done"); chain the
    // channel rotation behind it so a new demo match kicks off automatically.
    const roomDone = source.onDone;
    source.onDone = () => { roomDone?.(); setTimeout(() => this._rotateSimLive(), 45000); };
  }

  _rotateSimLive() {
    // Finished match becomes archive; the "next" fixture kicks off.
    const finished = this.rooms.get(this._simLiveId);
    if (finished) { finished.mode = "archive-live"; }
    const f = this.sim.next;
    const fresh = simFixtures(); // roll a new "next"
    this.sim.live = f;
    this.sim.next = { ...fresh.next, fixtureId: f.fixtureId + 1000, startTime: Date.now() + 35 * 60000 };
    this.fixtures.set(String(this.sim.next.fixtureId), this.sim.next);
    this._openSimLive(f);
    console.log(`[hub] DEMO rotation — now on air: ${f.home.name} v ${f.away.name}`);
  }

  // ── txline channel ─────────────────────────────────────────────────────────
  async _startTxline() {
    mkdirSync(DATA_DIR, { recursive: true });
    try {
      const saved = JSON.parse(readFileSync(FIXTURES_FILE, "utf8"));
      for (const f of saved) this.fixtures.set(String(f.fixtureId), f);
      console.log(`[hub] fixture ledger loaded — ${this.fixtures.size} matches remembered`);
    } catch { /* first boot */ }

    const { mapFixture } = await import("./txline/normalize.mjs");
    const { txline } = await import("./txline/client.mjs");

    const poll = async () => {
      try {
        const raw = await txline().fixturesSnapshot();
        let added = 0;
        for (const r of Array.isArray(raw) ? raw : []) {
          const f = mapFixture(r);
          if (!f) continue;
          const key = String(f.fixtureId);
          if (!this.fixtures.has(key)) added++;
          this.fixtures.set(key, { ...this.fixtures.get(key), ...f });
        }
        if (added) console.log(`[hub] fixtures snapshot — ${added} new, ledger now ${this.fixtures.size}`);
        writeFileSync(FIXTURES_FILE, JSON.stringify([...this.fixtures.values()], null, 1));
        this._autoOpenLiveRooms();
      } catch (err) {
        console.warn(`[hub] fixtures poll failed: ${err.message}`);
      }
    };
    await poll();
    setInterval(poll, 5 * 60000);
    setInterval(() => this._autoOpenLiveRooms(), 60000);
  }

  /** Open a live room for any fixture inside its match window. */
  _autoOpenLiveRooms() {
    const now = Date.now();
    for (const f of this.fixtures.values()) {
      if (!f.startTime) continue;
      const key = String(f.fixtureId);
      const inWindow = now >= f.startTime - 30 * 60000 && now <= f.startTime + 3.5 * 3600000;
      if (inWindow && !this.rooms.has(key)) this._openLive(f).catch((error) => console.warn(`[hub] live open ${key}: ${error.message}`));
    }
  }

  async _openLive(f) {
    const key = String(f.fixtureId);
    const existing = this.rooms.get(key);
    if (existing) return existing;
    const { LiveSource } = await import("./sources/live.mjs");
    const openedWhileLoading = this.rooms.get(key);
    if (openedWhileLoading) return openedWhileLoading;
    const room = new Room(f, { mode: "live", proofs: momentProof });
    this.rooms.set(key, room);
    room.start(new LiveSource({ fixtureId: f.fixtureId, homeIsP1: f.participant1IsHome !== false }));
    console.log(`[hub] ON AIR — ${f.home.name} v ${f.away.name} (${f.fixtureId})`);
    return room;
  }

  // ── room access (both modes) ───────────────────────────────────────────────
  async roomFor(fixtureId, { speed } = {}) {
    const key = String(fixtureId);
    const existing = this.rooms.get(key);
    if (existing) {
      const replayFinished = ["authentic-replay", "replay"].includes(existing.mode) && existing.evidence.finishedAt;
      if (replayFinished && existing.clients.size === 0) {
        existing.stop();
        this.rooms.delete(key);
      } else return existing;
    }

    const inFlight = this._roomCreations.get(key);
    if (inFlight) return inFlight;
    const creation = this._createRoom(key, speed);
    this._roomCreations.set(key, creation);
    try {
      return await creation;
    } finally {
      if (this._roomCreations.get(key) === creation) this._roomCreations.delete(key);
    }
  }

  async _createRoom(key, speed) {
    const f = this.fixtures.get(key);
    if (!f) return null;

    if (IS_HERO) {
      const { HeroSource } = await import("./sources/hero.mjs");
      if (this.rooms.has(key)) return this.rooms.get(key);
      const room = new Room(f, { mode: "authentic-replay", proofs: momentProof });
      this._wireReplay(room, new HeroSource(), key);
      return room;
    }

    if (IS_SIM) {
      // Archived demo match → compressed sim replay through the same pipeline.
      const room = new Room(f, { mode: "replay", proofs: momentProof });
      const source = new SimSource({ fixtureId: f.fixtureId, seed: f.seed ?? f.fixtureId, strengthH: f.strengthH ?? 0.5, speed: Number(speed) || 48, startPhase: "kickoff" });
      this._wireReplay(room, source, key);
      return room;
    }

    const now = Date.now();
    if (f.startTime && now < f.startTime - 30 * 60000) {
      // Pre-match: open a live room early — the market talks before kick-off.
      await this._openLive(f);
      return this.rooms.get(key);
    }
    const { ReplaySource } = await import("./sources/replay.mjs");
    if (this.rooms.has(key)) return this.rooms.get(key);
    const room = new Room(f, { mode: "replay", proofs: momentProof });
    const source = new ReplaySource({
      fixtureId: f.fixtureId,
      homeIsP1: f.participant1IsHome !== false,
      speed: Number(speed) || CONFIG.replaySpeed,
    });
    this._wireReplay(room, source, key);
    return room;
  }

  _wireReplay(room, source, key) {
    room.onEmpty = () => { room.stop(); if (this.rooms.get(key) === room) this.rooms.delete(key); };
    this.rooms.set(key, room);
    room.start(source);
  }

  /** Lobby payload: what's on air, what's coming, what's re-watchable. */
  lobby() {
    const now = Date.now();
    const featured = [], live = [], upcoming = [], archive = [];
    for (const f of this.fixtures.values()) {
      const room = this.rooms.get(String(f.fixtureId));
      const info = room ? room.publicInfo() : {
        fixtureId: f.fixtureId, home: f.home, away: f.away,
        competition: f.competition, stage: f.stage, venue: f.venue,
        startTime: f.startTime, phase: "NS", phaseLabel: "Scheduled",
        live: false, finished: Boolean(f.finalScore), score: f.finalScore || { home: 0, away: 0 }, clockMin: 0,
        listeners: 0, mode: "idle",
      };
      if (f.featured) featured.push({
        ...info,
        authentic: true,
        replayable: true,
        packageHash: f.packageHash,
        provenance: f.provenance,
        finalScore: f.finalScore,
        directorDurationMs: 90000,
      });
      else if (room && (room.state.live || (room.mode === "live" && !room.state.finished))) live.push(info);
      else if (room?.state.finished || (f.startTime && f.startTime < now - 3 * 3600000)) {
        const ageH = f.startTime ? (now - f.startTime) / 3600000 : 999;
        archive.push({ ...info, replayable: IS_SIM || (ageH >= 6 && ageH <= 14 * 24) });
      } else upcoming.push(info);
    }
    const byStart = (a, b) => (a.startTime ?? 0) - (b.startTime ?? 0);
    live.sort(byStart); upcoming.sort(byStart);
    archive.sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
    return {
      mode: IS_HERO ? "authentic-replay" : IS_SIM ? "simulation-lab" : "live",
      generatedAt: now,
      featured,
      live,
      upcoming: upcoming.slice(0, 12),
      archive: archive.slice(0, 60),
    };
  }
}
