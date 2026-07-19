// <roarline-match> — walletless, embeddable Proof-of-Broadcast player.
//
// Publisher integration:
//   <script type="module" src="https://host/embed/roarline-match.js"></script>
//   <roarline-match fixture="18237038" language="es" mode="silent"
//     team="ESP" sponsor="Supporters Radio" theme="#c8ff2e"></roarline-match>
//
// Attributes are observed and can change live. TxLINE/API credentials remain on
// the ROARLINE server; listeners need no wallet or account.
import { localizeLine } from "../js/i18n.js";

const scriptUrl = new URL(import.meta.url);
const DEFAULT_ORIGIN = scriptUrl.origin;
const PACKS = {
  es: { GOAL: "¡GOL! {team}. {score}.", GOAL_REVOKED: "Gol anulado. VAR corrige el marcador a {score}.", RED_CARD: "Tarjeta roja para {team}.", FULLTIME: "Final. {home} {score} {away}.", VAR_RESULT_OVERTURNED: "Decisión corregida por el VAR." },
  fr: { GOAL: "BUT ! {team}. {score}.", GOAL_REVOKED: "But annulé. La VAR ramène le score à {score}.", RED_CARD: "Carton rouge pour {team}.", FULLTIME: "Terminé. {home} {score} {away}.", VAR_RESULT_OVERTURNED: "Décision inversée par la VAR." },
  pt: { GOAL: "GOOOL! {team}. {score}.", GOAL_REVOKED: "Gol anulado. O VAR corrige o placar para {score}.", RED_CARD: "Cartão vermelho para {team}.", FULLTIME: "Fim de jogo. {home} {score} {away}.", VAR_RESULT_OVERTURNED: "Decisão alterada pelo VAR." },
};

class RoarlineMatch extends HTMLElement {
  static observedAttributes = ["fixture", "language", "mode", "team", "sponsor", "theme", "origin"];

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.mount = document.createElement("div");
    this.announcer = document.createElement("span");
    this.announcer.id = "announcer";
    this.announcer.setAttribute("aria-live", "assertive");
    this.announcer.setAttribute("aria-atomic", "true");
    this.shadowRoot.append(this.mount, this.announcer);
    this.state = null;
    this.lastLine = "Connecting to the broadcast…";
    this.prob = null;
    this.bytes = 0;
    this.connectionState = "connecting";
    this.broadcastMode = null;
    this.render();
  }

  connectedCallback() { this.connect(); }
  disconnectedCallback() { this.es?.close(); clearTimeout(this.pulseTimer); }
  attributeChangedCallback(name, previous, next) {
    if (!this.isConnected || previous === next) return;
    if (name === "language" && this.lastCommentary) this.lastLine = this.localize(this.lastCommentary);
    this.render();
    if (["fixture", "mode", "origin"].includes(name)) this.connect();
  }

  get origin() { return (this.getAttribute("origin") || DEFAULT_ORIGIN).replace(/\/+$/, ""); }
  get fixture() { return this.getAttribute("fixture") || "18237038"; }
  get language() { return this.getAttribute("language") || "en"; }
  get mode() { return this.getAttribute("mode") || "stadium"; }
  get accent() {
    const value = this.getAttribute("theme") || "#c8ff2e";
    return globalThis.CSS?.supports?.("color", value) ? value : "#c8ff2e";
  }

  connect() {
    this.es?.close();
    this.state = null;
    this.prob = null;
    this.proof = null;
    this.lastCommentary = null;
    this.lastLine = "Connecting to the broadcast…";
    this.bytes = 0;
    this.connectionState = "connecting";
    this.broadcastMode = null;
    this.render();
    const profile = this.mode === "low" ? "low" : "standard";
    const stream = new EventSource(`${this.origin}/api/rooms/${encodeURIComponent(this.fixture)}/stream?profile=${profile}`);
    this.es = stream;
    const on = (name, fn) => stream.addEventListener(name, (event) => {
      if (this.es !== stream) return;
      this.bytes += new TextEncoder().encode(event.data).byteLength;
      fn(JSON.parse(event.data));
      this.render();
    });
    on("hello", (x) => {
      this.connectionState = x.state.finished ? "complete" : "active";
      this.broadcastMode = x.mode;
      this.state = x.state;
      this.prob = x.signals.at(-1)?.winProb || null;
      const commentary = [...(x.timeline || [])].reverse().find((entry) => entry.kind === "commentary");
      if (commentary) { this.lastCommentary = commentary; this.lastLine = this.localize(commentary); }
      const proven = [...(x.timeline || [])].reverse().find((entry) => entry.kind === "moment" && entry.proof);
      this.proof = proven?.proof || null;
    });
    on("state", (x) => { this.state = x; if (x.finished) this.connectionState = "complete"; });
    on("signal", (x) => { this.prob = x.winProb; this.fever = x.fever; });
    on("commentary", (x) => {
      this.lastCommentary = x;
      this.lastLine = this.localize(x);
      this.announce(this.lastLine, true);
    });
    on("moment", (x) => {
      if (x.type === "GOAL_REVOKED") {
        this.lastLine = this.localMoment(x, "GOAL_REVOKED");
        this.announce(this.lastLine, true);
      }
      if (x.type === "GOAL" || x.type === "RED_CARD") this.pulse(x.type);
    });
    on("proof", (x) => { this.proof = x; });
    on("done", () => {
      this.connectionState = "complete";
      stream.close();
      if (this.es === stream) this.es = null;
    });
    stream.addEventListener("error", () => {
      if (this.es !== stream || this.connectionState === "complete") return;
      this.connectionState = "reconnecting";
      this.render();
    });
  }

  localize(line) {
    return localizeLine(line, this.language);
  }

  localMoment(moment, key) {
    if (!this.state) return key;
    const team = moment.team === "home" ? this.state.home.name : this.state.away.name;
    const score = moment.detail?.score || this.state.score;
    return fill(PACKS[this.language]?.[key] || "Correction: {team}, score {score}.", {
      team, score: `${score.home}–${score.away}`,
    });
  }

  pulse(type) {
    this.setAttribute("data-pulse", type.toLowerCase());
    if (this.mode === "silent" && navigator.vibrate) navigator.vibrate(type === "GOAL" ? [80, 40, 180] : [180, 80, 180]);
    clearTimeout(this.pulseTimer);
    this.pulseTimer = setTimeout(() => this.removeAttribute("data-pulse"), 900);
  }

  announce(text, speak = false) {
    if (this.announcer.textContent !== text) this.announcer.textContent = text;
    if (!speak || this.mode !== "audio" || !globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = { en: "en-GB", es: "es-ES", fr: "fr-FR", pt: "pt-BR" }[this.language] || "en-GB";
    utterance.rate = 0.96;
    speechSynthesis.speak(utterance);
  }

  render() {
    const s = this.state;
    const sponsor = this.getAttribute("sponsor") || "ROARLINE NETWORK";
    const preferred = (this.getAttribute("team") || "").toUpperCase();
    const homePreferred = preferred && preferred === s?.home?.code;
    const awayPreferred = preferred && preferred === s?.away?.code;
    const p = this.prob;
    const isDemo = this.proof?.demo || (s?.competition || "").includes("DEMO");
    const proofLabel = this.proof?.receiptStatus === "confirmed"
      ? "RECEIPT CONFIRMED"
      : this.proof?.proofBundleFetched ? "TXLINE BUNDLE FETCHED"
        : this.proof?.archivedProofRecord ? "ARCHIVED PROOF RECORD"
          : this.proof ? "UNCONFIRMED PROOF REFERENCE"
          : isDemo ? "DEMO DATA"
            : this.connectionState === "connecting" ? "CONNECTING"
              : this.connectionState === "reconnecting" ? "RECONNECTING"
                : this.broadcastMode === "authentic-replay" ? "AUTHENTIC REPLAY"
                  : this.broadcastMode === "replay" ? "REPLAY"
                    : this.broadcastMode === "live" ? "LIVE FEED" : "FEED";
    const proofShort = this.proof?.receiptStatus === "confirmed"
      ? "ON-CHAIN RECEIPT"
      : isDemo ? "DEMO"
        : this.proof?.proofBundleFetched ? "BUNDLE FETCHED"
          : this.proof?.archivedProofRecord ? "ARCHIVED RECORD"
            : this.proof ? "UNCONFIRMED"
              : this.connectionState === "connecting" ? "CONNECTING"
                : this.connectionState === "reconnecting" ? "RECONNECTING"
                  : this.connectionState === "complete" ? "NO PROOF ATTACHED"
                    : this.broadcastMode === "authentic-replay" ? "ARCHIVE RECORD PENDING"
                      : ["live", "replay"].includes(this.broadcastMode) ? "PROOF PENDING" : "NO RECEIPT";
    this.mount.innerHTML = `
      <style>
        :host { --accent:${this.accent}; display:block; color:#e8f0ee; font-family:Arial,sans-serif; min-width:260px; }
        .player { border:1px solid #263238; border-radius:16px; overflow:hidden; background:radial-gradient(circle at 80% 0, color-mix(in srgb,var(--accent) 12%,transparent),transparent 44%),#090d0f; box-shadow:0 12px 38px #0005; }
        .top { display:flex; justify-content:space-between; gap:8px; padding:10px 13px; border-bottom:1px solid #1b2529; font:700 9px ui-monospace,monospace; letter-spacing:1px; color:#788a86; }
        .verified { color:var(--accent); }
        .score { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; padding:20px 16px 12px; text-align:center; }
        .team { font-size:clamp(23px,7vw,38px); font-weight:900; color:#8fa29d; }
        .team.pref { color:var(--accent); text-shadow:0 0 18px color-mix(in srgb,var(--accent) 40%,transparent); }
        .nums { font-size:clamp(36px,10vw,58px); font-weight:900; padding:0 12px; }
        .clock { text-align:center; color:var(--accent); font:600 11px ui-monospace,monospace; }
        .bars { display:grid; grid-template-columns:${p ? `${p.home || 0}fr ${p.draw || 0}fr ${p.away || 0}fr` : "1fr 1fr 1fr"}; height:5px; margin:15px 14px 0; background:#1a2427; overflow:hidden; border-radius:9px; }
        .bars i:nth-child(1){background:#55c7ff}.bars i:nth-child(2){background:#667570}.bars i:nth-child(3){background:#ff784d}
        .caption { min-height:58px; display:flex; align-items:center; justify-content:center; text-align:center; margin:10px 14px 14px; padding:11px; border-radius:10px; background:#101719; color:#d9e2df; font-size:${this.mode === "silent" ? "16px" : "13px"}; font-weight:${this.mode === "silent" ? 800 : 600}; line-height:1.4; }
        .foot { display:flex; justify-content:space-between; gap:8px; padding:8px 12px; border-top:1px solid #1b2529; color:#5f706c; font:9px ui-monospace,monospace; }
        .proof { color:${this.proof ? "var(--accent)" : "#786f45"}; }
        #announcer { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }
        :host([data-pulse="goal"]) .player { animation:goal .9s ease; }
        :host([data-pulse="red_card"]) .player { animation:red .9s ease; }
        @keyframes goal { 30%{box-shadow:0 0 60px var(--accent);transform:scale(1.012)} }
        @keyframes red { 30%{box-shadow:0 0 60px #ff4d5a} }
      </style>
      <div class="player" role="region" aria-label="ROARLINE football broadcast">
        <div class="top"><span>${escapeHtml(sponsor)}</span><span class="verified">● ${proofLabel}</span></div>
        <div class="score">
          <span class="team ${homePreferred ? "pref" : ""}">${escapeHtml(s?.home?.code || "—")}</span>
          <span class="nums">${s ? `${s.score.home}–${s.score.away}` : "–"}</span>
          <span class="team ${awayPreferred ? "pref" : ""}">${escapeHtml(s?.away?.code || "—")}</span>
        </div>
        <div class="clock">${s ? `${s.clockMin}′ · ${escapeHtml(s.phaseLabel)}` : "CONNECTING"}</div>
        <div class="bars"><i></i><i></i><i></i></div>
        <div class="caption">${escapeHtml(this.lastLine)}</div>
        <div class="foot"><span>${escapeHtml(this.language.toUpperCase())} · ${escapeHtml(this.mode.toUpperCase())}</span><span>${(this.bytes/1024).toFixed(1)} KB</span><span class="proof">${proofShort}</span></div>
      </div>`;
  }
}

const fill = (t, a) => t.replace(/\{(\w+)\}/g, (_, k) => a[k] ?? "");
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
if (!customElements.get("roarline-match")) customElements.define("roarline-match", RoarlineMatch);
