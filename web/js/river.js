// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE probability river · the market's emotions, drawn
//
// A streaming stacked-band chart of the TxLINE consensus win probabilities:
// home rises from the floor, away falls from the ceiling, the draw breathes
// between them. Big moments leave markers. This is the single most honest
// picture of a football match that exists — and fans never get to see it.
// ─────────────────────────────────────────────────────────────────────────────
export class River {
  constructor(canvas, colors) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.colors = colors;
    this.frames = [];   // {t, home, away, clockMin}
    this.marks = [];    // {t, type, team}
    this.windowMs = 14 * 60000; // rolling view (scaled by replay compression naturally)
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

  push(signal) {
    if (!signal.winProb) return;
    this.frames.push({ t: signal.t, home: signal.winProb.home, away: signal.winProb.away, clockMin: signal.clockMin });
    if (this.frames.length > 2400) this.frames.splice(0, this.frames.length - 2400);
  }

  seed(signals) { for (const s of signals) this.push(s); }

  mark(moment) {
    if (!["GOAL", "GOAL_REVOKED", "RED_CARD", "PEN_SCORED", "MARKET_SURGE"].includes(moment.type)) return;
    this.marks.push({ t: moment.ts, type: moment.type, team: moment.team });
    if (this.marks.length > 60) this.marks.shift();
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
    ctx.clearRect(0, 0, W, H);
    if (this.frames.length < 2) {
      ctx.fillStyle = "#3f4f4b";
      ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
      ctx.textAlign = "center";
      ctx.fillText("waiting for the market…", W / 2, H / 2 + 3 * dpr);
      return;
    }

    const tEnd = this.frames[this.frames.length - 1].t;
    const span = Math.max(60000, Math.min(this.windowMs, tEnd - this.frames[0].t));
    const tStart = tEnd - span;
    const xOf = (t) => ((t - tStart) / span) * (W - 6 * dpr) + 2 * dpr;
    const pts = this.frames.filter((f) => f.t >= tStart - 5000);
    if (pts.length < 2) return;

    // home band (bottom)
    ctx.beginPath();
    ctx.moveTo(xOf(pts[0].t), H);
    for (const f of pts) ctx.lineTo(xOf(f.t), H - f.home * H);
    ctx.lineTo(xOf(pts[pts.length - 1].t), H);
    ctx.closePath();
    ctx.fillStyle = hexA(this.colors.home, 0.32);
    ctx.fill();
    // home line
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = xOf(pts[i].t), y = H - pts[i].home * H;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = this.colors.home;
    ctx.lineWidth = 1.6 * dpr;
    ctx.stroke();

    // away band (top)
    ctx.beginPath();
    ctx.moveTo(xOf(pts[0].t), 0);
    for (const f of pts) ctx.lineTo(xOf(f.t), f.away * H);
    ctx.lineTo(xOf(pts[pts.length - 1].t), 0);
    ctx.closePath();
    ctx.fillStyle = hexA(this.colors.away, 0.32);
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = xOf(pts[i].t), y = pts[i].away * H;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = this.colors.away;
    ctx.lineWidth = 1.6 * dpr;
    ctx.stroke();

    // 50% line
    ctx.strokeStyle = "rgba(232,240,238,0.08)";
    ctx.setLineDash([3 * dpr, 5 * dpr]);
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.setLineDash([]);

    // moment markers
    for (const mk of this.marks) {
      if (mk.t < tStart || mk.t > tEnd) continue;
      const x = xOf(mk.t);
      const color = mk.type === "RED_CARD" ? "#ff4d5a"
        : mk.type === "MARKET_SURGE" ? "#c8ff2e"
        : mk.team ? this.colors[mk.team] : "#ffffff";
      ctx.strokeStyle = hexA(color, 0.5);
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      if (mk.type === "GOAL" || mk.type === "PEN_SCORED") {
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(x, 6 * dpr, 3 * dpr, 0, Math.PI * 2); ctx.fill();
      } else if (mk.type === "GOAL_REVOKED") {
        ctx.strokeStyle = "#fff";
        ctx.beginPath(); ctx.arc(x, 6 * dpr, 3 * dpr, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // leading edge glow
    const last = pts[pts.length - 1];
    const lx = xOf(last.t);
    for (const [p, color] of [[H - last.home * H, this.colors.home], [last.away * H, this.colors.away]]) {
      const g = ctx.createRadialGradient(lx, p, 0, lx, p, 9 * dpr);
      g.addColorStop(0, hexA(color, 0.9));
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(lx, p, 9 * dpr, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function hexA(hex, a) {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
