// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE crowd · a stadium synthesized from thin air
//
// No samples, no copyright, no downloads — the entire soundscape is generated
// live by WebAudio: a filtered-noise crowd bed that breathes with the fever
// signal, roars that erupt on goals, gasps for near-misses, whistles for the
// referee's moments. The crowd IS the data.
// ─────────────────────────────────────────────────────────────────────────────
export class Crowd {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.fever = 0.06;
    this.level = 1;
  }

  /** Must be called from a user gesture. */
  enable() {
    if (!this.ctx) this._build();
    this.ctx.resume();
    this.enabled = true;
    this.master.gain.setTargetAtTime(1, this.ctx.currentTime, 0.4);
  }

  disable() {
    this.enabled = false;
    if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  setMode(mode) {
    this.level = mode === "audio" ? 0.28 : 1;
    if (this.ctx && this.enabled) this.setFever(this.fever);
  }

  _build() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // 4s noise loop, shared by every voice
    const len = 4 * ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown-ish
      data[i] = last * 3.2;
    }
    this.noiseBuf = buf;

    // crowd bed: low rumble + mid "chatter"
    this.bed = this._noiseVoice({ type: "lowpass", freq: 320, q: 0.6, gain: 0.06 });
    this.chatter = this._noiseVoice({ type: "bandpass", freq: 1050, q: 0.85, gain: 0.015 });

    // slow communal sway so the bed never sounds static
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(this.bed.gain.gain);
    lfo.start();
  }

  _noiseVoice({ type, freq, q, gain }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    return { src, filter, gain: g };
  }

  /** Called once per signal frame — the crowd tracks the fever. */
  setFever(fever) {
    this.fever = fever;
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this.bed.gain.gain.setTargetAtTime((0.04 + fever * 0.22) * this.level, t, 0.8);
    this.chatter.gain.gain.setTargetAtTime((0.008 + fever * 0.07) * this.level, t, 0.8);
    this.chatter.filter.frequency.setTargetAtTime(900 + fever * 900, t, 1.2);
  }

  /** Momentary reactions. */
  hit(moment) {
    if (!this.ctx || !this.enabled) return;
    switch (moment.type) {
      case "GOAL": case "PEN_SCORED": return this._roar(1.0, 3.2);
      case "GOAL_REVOKED": return this._gasp(0.9), this._boos(1.6);
      case "RED_CARD": return this._gasp(0.7), this._boos(1.2);
      case "WOODWORK": return this._gasp(1.0);
      case "SHOT_ON_TARGET": return this._gasp(0.55);
      case "PENALTY_AWARDED": case "VAR_CHECK": return this._gasp(0.65);
      case "KICKOFF": case "SECOND_HALF": return this._whistle([0.35]), this._roar(0.5, 1.6);
      case "HALFTIME": return this._whistle([0.3, 0.3]);
      case "FULLTIME": case "PENALTIES": return this._whistle([0.28, 0.28, 0.7]), this._roar(0.8, 2.8);
      case "CORNER": return this._gasp(0.3);
      case "MARKET_SURGE": return this._gasp(0.4);
    }
  }

  _swellVoice({ freq, q, peak, up, down, curveFreq }) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq, t);
    if (curveFreq) f.frequency.exponentialRampToValueAtTime(curveFreq, t + up + down);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + up);
    g.gain.exponentialRampToValueAtTime(0.0001, t + up + down);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + up + down + 0.1);
  }

  _roar(intensity, secs) {
    this._swellVoice({ freq: 500, q: 0.5, peak: 0.5 * intensity, up: 0.18, down: secs, curveFreq: 950 });
    this._swellVoice({ freq: 1400, q: 1.2, peak: 0.18 * intensity, up: 0.14, down: secs * 0.8, curveFreq: 2100 });
  }

  _gasp(intensity) {
    this._swellVoice({ freq: 650, q: 1.4, peak: 0.22 * intensity, up: 0.35, down: 1.1 });
  }

  _boos(secs) {
    this._swellVoice({ freq: 230, q: 2.2, peak: 0.2, up: 0.4, down: secs });
  }

  _whistle(pattern) {
    const t0 = this.ctx.currentTime;
    let t = t0;
    for (const dur of pattern) {
      const osc = this.ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(2650, t);
      osc.frequency.setValueAtTime(2820, t + dur * 0.5);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.045, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = 0.2; osc.connect(g).connect(pan).connect(this.master); }
      else osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      t += dur + 0.16;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The booth voice · browser TTS, tuned by line heat. Zero keys, zero latency.
// ─────────────────────────────────────────────────────────────────────────────
export class BoothVoice {
  constructor() {
    this.enabled = false;
    this._voice = null;
    this.locale = "en-GB";
    if ("speechSynthesis" in window) {
      const pickVoice = () => {
        const vs = speechSynthesis.getVoices();
        this._voice =
          vs.find((v) => v.lang.toLowerCase() === this.locale.toLowerCase()) ||
          vs.find((v) => v.lang.toLowerCase().startsWith(this.locale.slice(0, 2).toLowerCase())) ||
          vs.find((v) => /^en/i.test(v.lang)) || null;
      };
      pickVoice();
      speechSynthesis.onvoiceschanged = pickVoice;
    }
  }

  enable() { this.enabled = true; }
  setLanguage(locale) {
    this.locale = locale || "en-GB";
    const voices = "speechSynthesis" in window ? speechSynthesis.getVoices() : [];
    this._voice = voices.find((v) => v.lang.toLowerCase() === this.locale.toLowerCase())
      || voices.find((v) => v.lang.toLowerCase().startsWith(this.locale.slice(0, 2).toLowerCase()))
      || voices.find((v) => /^en/i.test(v.lang)) || null;
  }
  disable() {
    this.enabled = false;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  say(line) {
    if (!this.enabled || !("speechSynthesis" in window)) return;
    const heat = line.heat ?? 0.3;
    // Big calls interrupt; colour lines wait their turn and never queue-pile.
    if (heat >= 0.75) speechSynthesis.cancel();
    else if (speechSynthesis.speaking || speechSynthesis.pending) {
      if (heat < 0.45) return; // drop chatter rather than lag the match
    }
    const u = new SpeechSynthesisUtterance(line.text.replace(/GOOO+AL/gi, "GOAL").replace(/[⚽️🟥🟨]/g, ""));
    if (this._voice) u.voice = this._voice;
    u.lang = this.locale;
    u.rate = 0.98 + heat * 0.3;
    u.pitch = 0.95 + heat * 0.3;
    u.volume = 0.85 + heat * 0.15;
    speechSynthesis.speak(u);
  }
}
