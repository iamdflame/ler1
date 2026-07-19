// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE living pitch · the match as a creature
//
// No video, no player dots pretending to be tracking data — an honest,
// beautiful abstraction: a pressure orb that drifts towards the goal under
// siege, a pitch that glows with the crowd's fever, particles that erupt when
// the net bulges. Driven by 1Hz signal frames and interpolated at display cadence.
// ─────────────────────────────────────────────────────────────────────────────
export class Pitch {
  constructor(canvas, colors) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.colors = colors; // {home, away}
    this.codes = { home: "HOM", away: "AWY" };
    this.target = { pressure: 0, fever: 0.06 };
    this.cur = { pressure: 0, fever: 0.06 };
    this.particles = [];
    this.shock = 0;         // full-pitch shockwave on goals
    this.live = false;
    this._t = 0;
    this._raf = null;
    this._resize = () => this._fit();
    window.addEventListener("resize", this._resize);
    this._fit();
  }

  _fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(2, Math.round(r.width * dpr));
    this.canvas.height = Math.max(2, Math.round(r.height * dpr));
    this.dpr = dpr;
  }

  setSignal(s) {
    this.target.pressure = s.pressure ?? 0;
    this.target.fever = s.fever ?? 0.06;
    this.live = !!s.live;
  }

  /** Visual punctuation for a moment. */
  hit(moment) {
    const { type, team } = moment;
    const side = team === "home" ? 1 : team === "away" ? -1 : 0; // attacking direction
    if (type === "GOAL" || type === "PEN_SCORED") {
      this.shock = 1;
      this._burst(side, this.colors[team] ?? "#ffffff", 130, 7);
    } else if (type === "GOAL_REVOKED") {
      this.shock = 0.7;
      this._burst(side, "#ff4d5a", 80, 5);
    } else if (type === "RED_CARD") this._burst(side, "#ff4d5a", 46, 4);
    else if (type === "YELLOW") this._burst(side, "#ffc933", 26, 3);
    else if (type === "WOODWORK" || type === "SHOT_ON_TARGET") this._burst(side, "#e8f0ee", 30, 4.5);
    else if (type === "CORNER") this._burst(side, this.colors[team] ?? "#e8f0ee", 18, 2.5);
    else if (type === "VAR_CHECK") this._burst(0, "#c8ff2e", 36, 2);
  }

  _burst(side, color, n, speed) {
    const W = this.canvas.width, H = this.canvas.height;
    const x = side === 0 ? W / 2 : W / 2 + side * W * 0.36;
    const y = H / 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.4 + Math.random()) * speed * this.dpr;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, life: 1, color, r: (1 + Math.random() * 2.4) * this.dpr });
    }
    if (this.particles.length > 480) this.particles.splice(0, this.particles.length - 480);
  }

  start() {
    const loop = () => { this._draw(); this._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
  }
  stop() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._resize);
  }

  _draw() {
    const { ctx } = this;
    const W = this.canvas.width, H = this.canvas.height, dpr = this.dpr;
    this._t += 1 / 60;

    // ease current → target
    this.cur.pressure += (this.target.pressure - this.cur.pressure) * 0.035;
    this.cur.fever += (this.target.fever - this.cur.fever) * 0.05;
    this.shock *= 0.94;
    const fever = this.cur.fever;

    // ── turf ──
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.62);
    g.addColorStop(0, `rgba(14,${26 + Math.round(fever * 22)},20,1)`);
    g.addColorStop(1, "#05080a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // mow stripes
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 12; i++) {
      if (i % 2) continue;
      ctx.fillStyle = "#9adf9a";
      ctx.fillRect((W / 12) * i, 0, W / 12, H);
    }
    ctx.globalAlpha = 1;

    // ── markings ──
    const m = 0.055; // margin
    const x0 = W * m, y0 = H * m * 1.5, x1 = W * (1 - m), y1 = H * (1 - m * 1.5);
    ctx.strokeStyle = `rgba(190,235,205,${0.16 + fever * 0.22})`;
    ctx.lineWidth = Math.max(1, 1.3 * dpr);
    ctx.shadowColor = "rgba(200,255,46,0.4)";
    ctx.shadowBlur = 6 * fever * dpr;
    const rr = 12 * dpr;
    ctx.beginPath();
    ctx.roundRect(x0, y0, x1 - x0, y1 - y0, rr);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2, y0); ctx.lineTo(W / 2, y1); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, H * 0.16, 0, Math.PI * 2); ctx.stroke();
    const boxH = H * 0.42, boxW = W * 0.115;
    ctx.strokeRect(x0, H / 2 - boxH / 2, boxW, boxH);
    ctx.strokeRect(x1 - boxW, H / 2 - boxH / 2, boxW, boxH);
    ctx.shadowBlur = 0;

    // goal glows — the goal UNDER SIEGE burns hotter
    const siege = this.cur.pressure; // + = away goal (right) under siege
    for (const [gx, side] of [[x0, -1], [x1, +1]]) {
      const heat = Math.max(0, side === 1 ? siege : -siege);
      const color = side === 1 ? this.colors.home : this.colors.away; // attacker's color
      const gg = ctx.createRadialGradient(gx, H / 2, 0, gx, H / 2, H * (0.2 + heat * 0.35));
      gg.addColorStop(0, hexA(color, 0.10 + heat * 0.38));
      gg.addColorStop(1, "transparent");
      ctx.fillStyle = gg;
      ctx.fillRect(0, 0, W, H);
    }

    // end labels — left goal is defended by HOME, right goal by AWAY
    ctx.font = `800 ${11 * dpr}px Archivo, sans-serif`;
    ctx.fillStyle = hexA(this.colors.home, 0.6);
    ctx.textAlign = "left";
    ctx.fillText(this.codes.home, x0 + 6 * dpr, y0 - 5 * dpr);
    ctx.fillStyle = hexA(this.colors.away, 0.6);
    ctx.textAlign = "right";
    ctx.fillText(this.codes.away, x1 - 6 * dpr, y0 - 5 * dpr);

    // ── shockwave ──
    if (this.shock > 0.02) {
      ctx.strokeStyle = `rgba(255,255,255,${this.shock * 0.5})`;
      ctx.lineWidth = 3 * dpr * this.shock;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, (1 - this.shock) * W * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── the pressure orb ──
    const wanderY = Math.sin(this._t * 0.9) * H * 0.14 + Math.sin(this._t * 2.3) * H * 0.05;
    const wanderX = Math.sin(this._t * 1.7) * W * 0.02;
    const ox = W / 2 + siege * W * 0.33 + wanderX;
    const oy = H / 2 + wanderY * (0.4 + fever);
    const orbR = (7 + fever * 15) * dpr;
    const pulse = 1 + Math.sin(this._t * (2 + fever * 8)) * 0.12;

    const attacking = siege > 0.06 ? this.colors.home : siege < -0.06 ? this.colors.away : "#c8ff2e";
    const og = ctx.createRadialGradient(ox, oy, 0, ox, oy, orbR * 4 * pulse);
    og.addColorStop(0, hexA("#ffffff", 0.9));
    og.addColorStop(0.18, hexA(attacking, 0.85));
    og.addColorStop(1, "transparent");
    ctx.fillStyle = og;
    ctx.beginPath();
    ctx.arc(ox, oy, orbR * 4 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // orb trail particles when live
    if (this.live && Math.random() < 0.35 + fever * 0.5) {
      this.particles.push({ x: ox, y: oy, vx: (Math.random() - 0.5) * dpr, vy: (Math.random() - 0.5) * dpr, life: 0.7, color: attacking, r: (0.8 + Math.random() * 1.4) * dpr });
    }

    // ── particles ──
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.985; p.vy *= 0.985; p.life -= 0.012;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, p.life) * 0.85;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // fever vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
    vg.addColorStop(0, "transparent");
    vg.addColorStop(1, `rgba(200,255,46,${fever * 0.07})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }
}

function hexA(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
