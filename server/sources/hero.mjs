// Authentic 90-second judge replay, generated from the pinned public TxLINE
// France–Spain capture in fixtures/authentic. No synthetic score/odds values:
// the director only compresses time and cuts to the finalisation frame.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../config.mjs";
import { mapScore, mapOdds } from "../txline/normalize.mjs";

const PACKAGE_PATH = join(ROOT, "fixtures", "authentic", "france-spain-18237038.json");
const EXPECTED_PACKAGE_HASH = "83cc7c4266f44a2272f80deb4bcecbc97be997939ac8bc9041b233728df3c25c";
const EXPECTED_PROOF_COMMIT = "2f10829f4a4e95c571a72b43eada1088c63642bd";
const EXPECTED_PROOF_LOG_HASH = "6810cad65784e3a1c79b642a33bb6642ca655e88ab4483fc2aca828bf0f1ff46";
let cachedPackage;

export function loadHeroPackage() {
  if (cachedPackage) return cachedPackage;
  const parsed = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"));
  const { packageHash, ...body } = parsed;
  const actual = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  if (packageHash !== EXPECTED_PACKAGE_HASH || actual !== EXPECTED_PACKAGE_HASH) {
    throw new Error(`authentic replay package hash mismatch: expected ${EXPECTED_PACKAGE_HASH}, declared ${packageHash}, got ${actual}`);
  }
  if (!parsed.authentic || Number(parsed.fixture?.fixtureId) !== 18237038) throw new Error("invalid authentic replay identity");
  if (parsed.provenance?.proofCommit !== EXPECTED_PROOF_COMMIT || parsed.provenance?.proofLogSha256 !== EXPECTED_PROOF_LOG_HASH) {
    throw new Error("authentic replay proof-log provenance mismatch");
  }
  const scores = parsed.events.filter((event) => event.kind === "score");
  const odds = parsed.events.filter((event) => event.kind === "odds");
  if (parsed.events.length !== 56 || scores.length !== 48 || odds.length !== 8) throw new Error("authentic replay event-count mismatch");
  if (scores.filter((event) => event.baseline).length !== 1 || scores.filter((event) => event.directorCut).length !== 1) {
    throw new Error("authentic replay must contain exactly one baseline and one director cut");
  }
  for (const event of parsed.events) {
    const normalized = event.kind === "score" ? mapScore(event.payload, true) : mapOdds(event.payload, true);
    if (!normalized || Number(normalized.fixtureId) !== 18237038) {
      throw new Error(`authentic replay ${event.kind} event at ${event.atMs}ms cannot normalize`);
    }
  }
  cachedPackage = parsed;
  return cachedPackage;
}

export class HeroSource {
  constructor({ loop = false } = {}) {
    this.package = loadHeroPackage();
    this.fixtureId = this.package.fixture.fixtureId;
    this.loop = loop;
    this.onScore = null;
    this.onOdds = null;
    this.onDone = null;
    this._timers = [];
    this._stopped = false;
    this._startedAt = 0;
    this._virtualNow = this.package.director.sourceWindow.fromTs;
  }

  now() {
    return this._virtualNow;
  }

  start() {
    this._stopped = false;
    this._startedAt = Date.now();
    for (const event of this.package.events) {
      if (event.atMs === 0) this._emit(event);
      else this._timers.push(setTimeout(() => this._emit(event), event.atMs));
    }
    const duration = this.package.director.durationMs;
    this._timers.push(setTimeout(() => {
      this.onDone?.();
      if (this.loop && !this._stopped) {
        this._timers.push(setTimeout(() => {
          this.stop();
          this._stopped = false;
          this.start();
        }, 12_000));
      }
    }, duration));
  }

  stop() {
    this._stopped = true;
    for (const timer of this._timers) clearTimeout(timer);
    this._timers = [];
  }

  _emit(event) {
    if (this._stopped) return;
    this._virtualNow = Number(event.payload.Ts) || this._virtualNow;
    const receivedAt = Date.now();
    if (event.kind === "score") {
      const update = mapScore(event.payload, true);
      if (update) this.onScore?.({
        ...update,
        receivedAt,
        source: "txline-authentic-capture",
        sourcePackageHash: this.package.packageHash,
        directorAtMs: event.atMs,
        directorCut: Boolean(event.directorCut),
        baseline: Boolean(event.baseline),
      });
    } else {
      const update = mapOdds(event.payload, true);
      if (update) this.onOdds?.({
        ...update,
        receivedAt,
        source: "txline-authentic-capture",
        sourcePackageHash: this.package.packageHash,
        messageId: event.payload.MessageId,
        directorAtMs: event.atMs,
      });
    }
  }
}
