// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE app · lobby + broadcast room orchestration (no framework, no build)
// ─────────────────────────────────────────────────────────────────────────────
import { Pitch } from "/js/pitch.js";
import { River } from "/js/river.js";
import { Crowd, BoothVoice } from "/js/audio.js";
import { drawMomentCard, shareCard, downloadCard } from "/js/cards.js";
import { LOCALES, describePressure, localizeLine } from "/js/i18n.js";

const $ = (id) => document.getElementById(id);
const lobbyEl = $("lobby"), roomEl = $("room");

// distinct, broadcast-friendly team palette — picked by code hash, de-collided
const PALETTE = ["#4dc3ff", "#ff7a45", "#ffd23f", "#7bff9e", "#ff5da2", "#b18bff", "#4dffdf", "#ff8f6b", "#9bd1ff", "#ffe08a"];
function teamColors(homeCode, awayCode) {
  const idx = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length;
  let h = idx(homeCode), a = idx(awayCode);
  if (h === a) a = (a + 3) % PALETTE.length;
  return { home: PALETTE[h], away: PALETTE[a] };
}

const CARDABLE = new Set(["GOAL", "GOAL_REVOKED", "RED_CARD", "PEN_SCORED", "PENALTY_AWARDED", "WOODWORK", "FULLTIME", "MARKET_SURGE", "PENALTIES", "EXTRA_TIME"]);
const BIG_TEXT = { GOAL: "GOAL!", GOAL_REVOKED: "NO GOAL", RED_CARD: "RED CARD", PENALTY_AWARDED: "PENALTY!", PENALTIES: "PENALTIES", EXTRA_TIME: "EXTRA TIME", FULLTIME: "FULL-TIME", WOODWORK: "OFF THE POST!" };

// ── router ───────────────────────────────────────────────────────────────────
let active = null; // current room session
function navigate(path, push = true) {
  if (push) history.pushState({}, "", path);
  route();
}
window.addEventListener("popstate", () => route());

function route() {
  const m = location.pathname.match(/^\/m\/(\d+)/);
  active?.destroy();
  active = null;
  if (m) {
    lobbyEl.hidden = true;
    roomEl.hidden = false;
    active = new RoomSession(m[1], new URLSearchParams(location.search).get("speed"));
  } else {
    roomEl.hidden = true;
    lobbyEl.hidden = false;
    startLobby();
  }
}

// ── lobby ────────────────────────────────────────────────────────────────────
let lobbyTimer = null;
async function startLobby() {
  clearInterval(lobbyTimer);
  await renderLobby();
  lobbyTimer = setInterval(renderLobby, 15000);
}

async function renderLobby() {
  if (lobbyEl.hidden) return clearInterval(lobbyTimer);
  let data;
  try { data = await (await fetch("/api/lobby")).json(); } catch { return; }
  $("mode-banner").hidden = data.mode !== "simulation-lab";

  const featured = data.featured?.[0];
  $("featured-section").hidden = !featured;
  if (featured) {
    $("featured-list").innerHTML = `<button class="hero-play" data-id="${featured.fixtureId}">
      <span>
        <span class="hero-match">${esc(featured.home.name)} <b>${featured.score.home}–${featured.score.away}</b> ${esc(featured.away.name)}</span>
        <span class="hero-meta">World Cup semi-final · authentic scores + consensus odds · goal → market move → VAR correction → final</span>
      </span>
      <span class="hero-cta">▶ FEEL 90s</span>
    </button>`;
    $("hero-hash").textContent = `broadcast source package · sha256:${featured.packageHash}`;
    $("featured-list").querySelector("button").onclick = () => navigate(`/m/${featured.fixtureId}`);
  }
  $("live-section").hidden = data.live.length === 0;

  const card = (f, cta, live = false) => {
    const kickoff = f.startTime ? new Date(f.startTime).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
    const score = live || f.finished ? `<span class="mc-score">${f.score.home}–${f.score.away}</span>` : "";
    return `<button class="match-card ${live ? "live" : ""}" data-id="${f.fixtureId}" data-mode="${cta.mode}">
      <div class="mc-stage">${esc(f.competition)}${f.stage ? " · " + esc(f.stage) : ""}</div>
      <div class="mc-teams"><span>${esc(f.home.code)}</span>${score || '<span style="color:var(--dim)">v</span>'}<span>${esc(f.away.code)}</span></div>
      <div class="mc-meta">
        <span>${esc(f.home.name)} v ${esc(f.away.name)}</span>
        ${live ? `<span>${f.clockMin}′ · ${esc(f.phaseLabel)}</span>` : kickoff ? `<span>${kickoff}</span>` : ""}
        ${f.listeners ? `<span>👂 ${f.listeners}</span>` : ""}
      </div>
      <div class="mc-cta ${cta.dim ? "dim" : ""}">${cta.label}</div>
    </button>`;
  };

  $("live-list").innerHTML = data.live.map((f) => card(f, { label: "▶ FEEL IT LIVE", mode: "live" }, true)).join("");
  $("live-empty").hidden = data.live.length > 0;
  $("upcoming-list").innerHTML = data.upcoming.map((f) => card(f,
    data.mode === "simulation-lab"
      ? { label: "kicks off after the current demo match", mode: "none", dim: true }
      : { label: "OPEN PRE-MATCH — the market is already talking", mode: "live" },
  )).join("") || `<div class="empty-note">Schedule updates automatically from the feed.</div>`;
  $("archive-list").innerHTML = data.archive.map((f) =>
    card(f, f.replayable ? { label: "↻ RE-BROADCAST 8× · hold for 64×", mode: "replay" } : { label: "outside the feed's replay window", mode: "none", dim: true }, false),
  ).join("") || `<div class="empty-note">Finished matches appear here while the configured source can replay them.</div>`;

  for (const el of document.querySelectorAll(".match-card")) {
    const mode = el.dataset.mode;
    if (mode === "none") continue;
    let holdTimer = null, held = false;
    const go = (speed) => navigate(`/m/${el.dataset.id}${mode === "replay" ? `?speed=${speed}` : ""}`);
    el.addEventListener("pointerdown", () => { held = false; if (mode === "replay") holdTimer = setTimeout(() => { held = true; go(64); }, 550); });
    el.addEventListener("pointerup", () => { clearTimeout(holdTimer); if (!held) go(8); });
    el.addEventListener("pointerleave", () => clearTimeout(holdTimer));
    el.addEventListener("click", (event) => { if (event.detail === 0) go(8); });
  }
}

// ── broadcast room ───────────────────────────────────────────────────────────
class RoomSession {
  constructor(fixtureId, speed) {
    this.fixtureId = fixtureId;
    this.colors = { home: "#4dc3ff", away: "#ff7a45" };
    this.state = null;
    this.mode = "live";
    this.proofs = new Map();     // package hash → proof
    this.cardables = new Map();  // package hash → {moment, state snapshot}
    this.prevProb = null;
    this.speed = speed;
    this.language = localStorage.getItem("roarline-language") || "en";
    this.access = localStorage.getItem("roarline-access") || "stadium";
    this.soundOn = false;
    this.receivedBytes = 0;
    this.lastRenderMs = null;
    this.pitch = new Pitch($("pitch"), this.colors);
    this.river = new River($("river"), this.colors);
    this.crowd = new Crowd();
    this.voice = new BoothVoice();
    this.pitch.start();
    this.river.start();
    this._wireChrome();
    this._applyAccess(this.access, false);
    this._connect();
  }

  _connect() {
    this.es?.close();
    const profile = this.access === "low" ? "low" : "standard";
    const q = new URLSearchParams({ profile });
    if (this.speed) q.set("speed", this.speed);
    this.es = new EventSource(`/api/rooms/${this.fixtureId}/stream?${q}`);
    const on = (event, handler) => this.es.addEventListener(event, (e) => {
      this.receivedBytes += new TextEncoder().encode(e.data).byteLength;
      $("bytes-live").textContent = `${(this.receivedBytes / 1024).toFixed(1)} KB`;
      handler(JSON.parse(e.data));
    });
    on("hello", (data) => this._hello(data));
    on("state", (data) => this._state(data));
    on("signal", (data) => this._signal(data));
    on("moment", (data) => this._moment(data));
    on("commentary", (data) => this._commentary(data));
    on("proof", (data) => this._proof(data));
    on("done", (data) => this._done(data));
  }

  destroy() {
    this.es?.close();
    this.pitch.stop();
    this.river.stop();
    this.crowd.disable();
    this.voice.disable();
    $("feed").innerHTML = "";
    $("card-overlay").hidden = true;
  }

  _wireChrome() {
    $("back-btn").onclick = () => navigate("/");
    $("evidence-link").href = `/api/evidence/${this.fixtureId}`;
    $("evidence-link").target = "_blank";
    const language = $("language-select");
    language.value = this.language;
    language.onchange = () => {
      this.language = language.value;
      localStorage.setItem("roarline-language", this.language);
      this.voice.setLanguage(LOCALES[this.language]);
      this._refreshLanguage();
    };
    this.voice.setLanguage(LOCALES[this.language]);

    const access = $("access-select");
    access.value = this.access;
    access.onchange = () => this._applyAccess(access.value, true);

    const soundBtn = $("sound-btn");
    soundBtn.setAttribute("aria-pressed", "false");
    soundBtn.textContent = "🔇";
    soundBtn.onclick = () => {
      const on = soundBtn.getAttribute("aria-pressed") !== "true";
      this.soundOn = on;
      soundBtn.setAttribute("aria-pressed", String(on));
      soundBtn.textContent = on ? "🔊" : "🔇";
      if (on) { this.crowd.enable(); this.voice.enable(); }
      else { this.crowd.disable(); this.voice.disable(); }
    };
    $("card-close").onclick = () => ($("card-overlay").hidden = true);
    $("card-overlay").onclick = (e) => { if (e.target === $("card-overlay")) $("card-overlay").hidden = true; };
  }

  _applyAccess(mode, reconnect) {
    const oldProfile = this.access === "low" ? "low" : "standard";
    this.access = ["stadium", "audio", "silent", "low"].includes(mode) ? mode : "stadium";
    localStorage.setItem("roarline-access", this.access);
    roomEl.dataset.access = this.access;
    $("access-select").value = this.access;
    $("profile-live").textContent = this.access === "low" ? "LOW DATA" : this.access === "audio" ? "AUDIO DESCRIPTION" : this.access.toUpperCase();
    this.crowd.setMode(this.access);
    if (this.access === "audio") {
      // A select change is a user gesture; restoring the stored mode at page
      // load is not, so leave sound off until the listener explicitly acts.
      if (reconnect) {
        this.crowd.enable();
        this.voice.enable();
        this.soundOn = true;
      } else {
        this.crowd.disable();
        this.voice.disable();
        this.soundOn = false;
      }
    } else if (this.access === "silent" || this.access === "low") {
      this.crowd.disable();
      this.voice.disable();
      this.soundOn = false;
    }
    $("sound-btn").setAttribute("aria-pressed", String(this.soundOn));
    $("sound-btn").textContent = this.soundOn ? "🔊" : "🔇";
    const newProfile = this.access === "low" ? "low" : "standard";
    if (reconnect && oldProfile !== newProfile) this._connect();
  }

  _refreshLanguage() {
    for (const row of $("feed").querySelectorAll(".feed-line")) {
      if (row._line && row._textEl) row._textEl.textContent = localizeLine(row._line, this.language);
    }
  }

  _hello(h) {
    this.mode = h.mode;
    this.telemetryToken = h.telemetryToken;
    this._state(h.state);
    const chip = $("room-mode");
    const demo = (h.state.competition || "").includes("DEMO");
    const authentic = h.mode === "authentic-replay";
    chip.className = `mode-chip ${demo ? "demo" : authentic || h.mode === "replay" ? "replay" : "live"}`;
    chip.textContent = demo ? (h.mode === "replay" ? "SIM LAB REPLAY" : "SIM LAB") : authentic ? "AUTHENTIC REPLAY" : h.mode === "replay" ? "RE-BROADCAST" : "LIVE";
    $("profile-live").textContent = h.profile === "low" ? "LOW DATA" : this.access.toUpperCase();
    if (h.ledger?.head) $("evidence-link").title = `event ledger ${h.ledger.head}`;

    const c = teamColors(h.state.home.code, h.state.away.code);
    Object.assign(this.colors, c);
    roomEl.style.setProperty("--home", c.home);
    roomEl.style.setProperty("--away", c.away);
    this.pitch.codes = { home: h.state.home.code, away: h.state.away.code };
    $("prob-home-code").textContent = h.state.home.code;
    $("prob-away-code").textContent = h.state.away.code;

    this.river.seed(h.signals || []);
    $("feed").innerHTML = "";
    this.proofs.clear();
    this.cardables.clear();
    for (const entry of h.timeline || []) {
      if (entry.kind === "commentary") this._commentary(entry, false);
      else if (entry.kind === "moment") {
        this.river.mark(entry);
        if (entry.proof) this.proofs.set(entry.packageHash, { momentTs: entry.ts, packageHash: entry.packageHash, ...entry.proof });
        if (CARDABLE.has(entry.type)) {
          this.cardables.set(entry.packageHash, { moment: entry, state: this._stateAtMoment(entry) });
        }
      }
    }
  }

  _state(s) {
    this.state = s;
    $("home-code").textContent = s.home.code;
    $("away-code").textContent = s.away.code;
    $("home-name").textContent = s.home.name;
    $("away-name").textContent = s.away.name;
    $("score").innerHTML = `${s.score.home}<span class="score-dash">–</span>${s.score.away}`;
    const pens = $("pens");
    if (s.pens.home + s.pens.away > 0) { pens.hidden = false; pens.textContent = `pens ${s.pens.home}–${s.pens.away}`; }
    $("phase").textContent = s.phaseLabel;
    $("clock").textContent = `${s.clockMin}′`;
    $("stats-strip").innerHTML = [
      `<div class="stat-pill">corners <b>${s.stats.cornersH}–${s.stats.cornersA}</b></div>`,
      `<div class="stat-pill">yellows <b>${s.stats.yellowH}–${s.stats.yellowA}</b></div>`,
      s.stats.redH + s.stats.redA > 0 ? `<div class="stat-pill" style="color:var(--hot)">reds <b>${s.stats.redH}–${s.stats.redA}</b></div>` : "",
      `<div class="stat-pill">${esc(s.venue || s.competition)}</div>`,
    ].join("");
  }

  _signal(sig) {
    this.pitch.setSignal(sig);
    this.river.push(sig);
    this.crowd.setFever(sig.fever);
    $("fever-val").textContent = `${Math.round(sig.fever * 100)}`;
    $("clock").textContent = `${sig.clockMin}′`;
    if (sig.winProb) {
      const p = sig.winProb;
      for (const [key, val] of [["home", p.home], ["draw", p.draw], ["away", p.away]]) {
        $(`bar-${key}`).style.width = `${val * 100}%`;
        $(`prob-${key}`).textContent = `${Math.round(val * 100)}%`;
        const arrow = $(`arrow-${key}`);
        if (this.prevProb) {
          const d = val - this.prevProb[key];
          arrow.textContent = d > 0.004 ? "▲" : d < -0.004 ? "▼" : "";
          arrow.className = `arrow ${d > 0.004 ? "up" : d < -0.004 ? "down" : ""}`;
        }
      }
      this.prevProb = p;
    }
  }

  _moment(m) {
    const receivedAt = performance.now();
    const telemetryToken = this.telemetryToken;
    this.pitch.hit(m);
    this.crowd.hit(m);
    this.river.mark(m);
    if (CARDABLE.has(m.type)) {
      this.cardables.set(m.packageHash, { moment: m, state: this._stateAtMoment(m) });
    }
    if (m.type === "GOAL" || m.type === "PEN_SCORED") {
      const f = $("flash");
      f.classList.remove("on"); void f.offsetWidth; f.classList.add("on");
    }
    if (BIG_TEXT[m.type] && (m.intensity ?? 0) >= 0.6) {
      const big = $("big-moment");
      big.textContent = BIG_TEXT[m.type];
      big.className = `big-moment ${["GOAL_REVOKED", "RED_CARD"].includes(m.type) ? "hot" : ""} show`;
      big.hidden = false;
      setTimeout(() => { big.hidden = true; big.className = "big-moment"; }, 2600);
    }
    if (this.access === "audio" && m.type === "PRESSURE" && m.intensity >= 0.3) {
      this.voice.say({ text: describePressure(m, this.state, this.language), heat: m.intensity });
    }
    if (navigator.vibrate && (this.access === "silent" || (m.intensity ?? 0) >= 0.85)) {
      const patterns = {
        GOAL: [70, 35, 130, 35, 260], GOAL_REVOKED: [260, 90, 70],
        RED_CARD: [180, 80, 180], VAR_CHECK: [45, 90, 45], FULLTIME: [90, 50, 90],
      };
      navigator.vibrate(patterns[m.type] || [(m.intensity ?? 0.3) * 100]);
    }
    requestAnimationFrame(() => {
      const renderMs = Math.max(0, performance.now() - receivedAt);
      this.lastRenderMs = renderMs;
      $("latency-live").textContent = `${Math.round(renderMs * 10) / 10} ms`;
      fetch("/api/telemetry/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixtureId: this.fixtureId, telemetryToken, packageHash: m.packageHash, renderMs }),
        keepalive: true,
      }).catch(() => {});
    });
  }

  _commentary(line, speak = true) {
    const feed = $("feed");
    const div = document.createElement("div");
    const heatClass = line.heat >= 0.9 ? "heat-max" : line.heat >= 0.6 ? "heat-high" : "";
    div.className = `feed-line ${heatClass} ${line.voice === "market" ? "market" : ""}`;
    const minute = document.createElement("span");
    minute.className = "feed-min";
    minute.textContent = `${line.minute}′`;
    const text = document.createElement("span");
    text.className = "feed-text";
    const localized = localizeLine(line, this.language);
    text.textContent = localized;
    div.append(minute, text);
    div._line = line;
    div._textEl = text;
    const cardKey = line.momentPackageHash || line.ts;
    if (CARDABLE.has(line.type) && this.cardables.has(cardKey)) {
      const btn = document.createElement("button");
      btn.className = "feed-card-btn";
      btn.textContent = "CARD";
      btn.onclick = () => this._openCard(cardKey);
      div.appendChild(btn);
    }
    feed.prepend(div);
    while (feed.children.length > 220) feed.lastChild.remove();
    if (line.type !== "COLOR" || this.access !== "silent") $("live-caption").textContent = localized;
    if (speak) this.voice.say({ ...line, text: localized });
  }

  _proof(p) {
    this.proofs.set(p.packageHash, p);
    if (!$("card-overlay").hidden && this._openPackage === p.packageHash) this._renderProofNote(p);
  }

  _openCard(packageHash) {
    const entry = this.cardables.get(packageHash);
    if (!entry) return;
    this._openPackage = packageHash;
    const proof = this.proofs.get(packageHash) || null;
    drawMomentCard($("card-canvas"), {
      moment: entry.moment, state: entry.state || this.state,
      colors: this.colors, proof, mode: (this.state.competition || "").includes("DEMO") ? "demo" : this.mode,
    });
    this._renderProofNote(proof, entry.moment);
    $("card-share").onclick = () => shareCard($("card-canvas"), entry.moment, entry.state || this.state);
    $("card-save").onclick = () => downloadCard($("card-canvas"), entry.moment, entry.state || this.state);
    $("card-overlay").hidden = false;
  }

  _stateAtMoment(moment) {
    const state = structuredClone(this.state);
    if (moment.stateSnapshot) Object.assign(state, structuredClone(moment.stateSnapshot));
    else if (moment.detail?.score) state.score = { ...moment.detail.score };
    return state;
  }

  _renderProofNote(proof, moment) {
    const el = $("card-proof");
    if (proof && !proof.demo) {
      const confirmed = proof.receiptStatus === "confirmed";
      const liveValidated = proof.sourceVerified === true;
      const heading = confirmed
        ? "✓ PROOF OF BROADCAST CONFIRMED"
        : liveValidated
          ? "✓ TXLINE STAT VALIDATED · BROADCAST RECEIPT PENDING"
          : proof.proofBundleFetched
            ? "TXLINE PROOF BUNDLE FETCHED · BROADCAST RECEIPT PENDING"
            : "CAPTURED TXLINE PROOF REFERENCE · RPC UNAVAILABLE";
      el.innerHTML = `<b>${heading}</b><br>
        Merkle leaf fixture ${proof.fixtureId} · proof seq ${proof.seq}${proof.observedSeq && proof.observedSeq !== proof.seq ? ` · observed seq ${proof.observedSeq}` : ""} · stat ${proof.statKey} = ${proof.statValue}<br>
        ${proof.explorer ? `<a href="${proof.explorer}" target="_blank" rel="noopener">open captured transaction reference ↗</a>` : ""}
        ${proof.proofReferenceUrl ? `<br><a href="${proof.proofReferenceUrl}" target="_blank" rel="noopener">open commit-pinned proof reference ↗</a>` : ""}
        ${proof.receiptExplorer ? `<br><a href="${proof.receiptExplorer}" target="_blank" rel="noopener">open MomentReceipt ${proof.receiptExplorerKind === "account" ? "account" : "transaction"} ↗</a>` : ""}
        ${proof.supersedesPackageHash ? `<br>correction supersedes package <b>${proof.supersedesPackageHash}</b>` : ""}`;
    } else if (proof?.demo) {
      el.innerHTML = `<span class="demo-tag">DEMO broadcast</span> — in live mode this drawer shows the real
        TxLINE Merkle-proof bundle for this moment (fixture · seq · statKey), verifiable against the
        <b>daily_scores_roots</b> the TxODDS oracle anchors on Solana.`;
    } else {
      const d = moment?.detail || {};
      el.innerHTML = `proof coordinates <b>fixture ${this.state.fixtureId} · seq ${d.seq ?? "—"} · stat ${d.statKey ?? "—"}</b><br>
        no source proof or custom broadcast receipt has been confirmed for this package yet.`;
    }
  }

  _done(data = {}) {
    this.es?.close();
    $("phase").textContent = this.state?.phaseLabel || "Ended";
    if (data.evidence?.bandwidth) {
      const b = this.access === "low" ? data.evidence.bandwidth.lowDataKiB : data.evidence.bandwidth.standardKiB;
      $("bytes-live").textContent = `${b} KB package`;
    }
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

route();
