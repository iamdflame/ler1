// ─────────────────────────────────────────────────────────────────────────────
// ROARLINE moment cards · a moment you can hold
//
// Eligible big moments render into a 1080×1350 share-ready poster: the call, the
// score, the market's exact reaction — and the moment's PROOF COORDINATES
// (fixtureId · seq · statKey), the address of the Merkle leaf TxLINE anchors
// under its daily root on Solana. Real broadcasts show the anchored root PDA;
// demo broadcasts say DEMO, honestly.
// ─────────────────────────────────────────────────────────────────────────────
const TITLE = {
  GOAL: "GOOOAL!", GOAL_REVOKED: "NO GOAL — VAR", RED_CARD: "RED CARD",
  PEN_SCORED: "PENALTY SCORED", PENALTY_AWARDED: "PENALTY!", WOODWORK: "OFF THE WOODWORK",
  FULLTIME: "FULL-TIME", PENALTIES: "PENALTY SHOOT-OUT", EXTRA_TIME: "EXTRA TIME",
  MARKET_SURGE: "MARKET QUAKE", VAR_CHECK: "VAR CHECK",
};

export function drawMomentCard(canvas, { moment, state, colors, proof, mode }) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  // backdrop
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0b1310");
  bg.addColorStop(1, "#05070a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // pitch ghost lines
  ctx.strokeStyle = "rgba(190,235,205,0.09)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(W / 2, H * 0.46, 260, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, H * 0.46); ctx.lineTo(W, H * 0.46); ctx.stroke();

  const accent = moment.team ? colors[moment.team] : "#c8ff2e";
  const hot = ["GOAL_REVOKED", "RED_CARD"].includes(moment.type);

  // halo
  const halo = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, 620);
  halo.addColorStop(0, hexA(hot ? "#ff4d5a" : accent, 0.26));
  halo.addColorStop(1, "transparent");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  // header
  ctx.textAlign = "left";
  ctx.font = "900 44px Archivo, sans-serif";
  ctx.fillStyle = "#e8f0ee";
  ctx.fillText("ROAR", 64, 96);
  const roarW = ctx.measureText("ROAR").width;
  ctx.fillStyle = "#c8ff2e";
  ctx.fillText("LINE", 64 + roarW, 96);
  ctx.font = "600 24px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "#7d8f8c";
  ctx.textAlign = "right";
  ctx.fillText(`${moment.minute}′ · ${state.phaseLabel}`, W - 64, 92);

  // the call
  ctx.textAlign = "center";
  ctx.fillStyle = hot ? "#ff4d5a" : "#c8ff2e";
  ctx.font = "900 118px Archivo, sans-serif";
  wrapText(ctx, TITLE[moment.type] || moment.type.replaceAll("_", " "), W / 2, H * 0.30, W - 140, 118);

  // teams + score
  ctx.font = "900 190px Archivo, sans-serif";
  ctx.fillStyle = "#e8f0ee";
  ctx.fillText(`${state.score.home}–${state.score.away}`, W / 2, H * 0.545);
  ctx.font = "900 64px Archivo, sans-serif";
  ctx.fillStyle = colors.home;
  ctx.textAlign = "right";
  ctx.fillText(state.home.code, W / 2 - 240, H * 0.545);
  ctx.fillStyle = colors.away;
  ctx.textAlign = "left";
  ctx.fillText(state.away.code, W / 2 + 240, H * 0.545);
  ctx.textAlign = "center";
  ctx.font = "500 30px Archivo, sans-serif";
  ctx.fillStyle = "#7d8f8c";
  ctx.fillText(`${state.home.name}  v  ${state.away.name}`, W / 2, H * 0.60);

  // market reaction
  if (state.odds) {
    const y = H * 0.685;
    ctx.font = "600 26px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "#7d8f8c";
    ctx.fillText("THE MARKET, THIS SECOND", W / 2, y - 52);
    const cells = [
      [state.home.code, state.odds.pHome, colors.home],
      ["DRAW", state.odds.pDraw, "#8fa39e"],
      [state.away.code, state.odds.pAway, colors.away],
    ];
    cells.forEach(([label, p, color], i) => {
      const cx = W / 2 + (i - 1) * 300;
      ctx.fillStyle = color;
      ctx.font = "900 68px Archivo, sans-serif";
      ctx.fillText(`${Math.round(p * 100)}%`, cx, y + 16);
      ctx.fillStyle = "#55625f";
      ctx.font = "600 24px 'IBM Plex Mono', monospace";
      ctx.fillText(label, cx, y + 54);
    });
  }

  // proof footer
  const py = H - 150;
  ctx.strokeStyle = "rgba(232,240,238,0.12)";
  ctx.beginPath(); ctx.moveTo(64, py - 46); ctx.lineTo(W - 64, py - 46); ctx.stroke();
  ctx.font = "600 25px 'IBM Plex Mono', monospace";
  if (proof?.demo || mode === "demo") {
    ctx.fillStyle = "#ffc933";
    ctx.fillText("DEMO DATA — illustrative broadcast, not a real match", W / 2, py);
    ctx.fillStyle = "#55625f";
    ctx.fillText("live broadcasts can attach TxLINE proof bundles and confirmed receipts", W / 2, py + 40);
  } else if (proof) {
    ctx.fillStyle = "#8fb52a";
    const verifiedLabel = proof.receiptStatus === "confirmed"
      ? "BROADCAST RECEIPT CONFIRMED ON SOLANA"
      : proof.proofBundleFetched
        ? "TXLINE PROOF BUNDLE FETCHED · NOT CHAIN-CONFIRMED"
        : "ARCHIVED PROOF-LOG RECORD · DEVNET RPC UNAVAILABLE";
    ctx.fillText(`${verifiedLabel} · fixture ${proof.fixtureId} · seq ${proof.seq} · stat ${proof.statKey}`, W / 2, py);
    ctx.fillStyle = "#55625f";
    ctx.fillText(`reported epoch day ${proof.epochDay} · Solana ${proof.network} · status explicitly qualified`, W / 2, py + 40);
  } else {
    ctx.fillStyle = "#8fb52a";
    const d = moment.detail || {};
    ctx.fillText(`PROOF COORDS · fixture ${state.fixtureId} · seq ${d.seq ?? "—"} · stat ${d.statKey ?? "—"}`, W / 2, py);
    ctx.fillStyle = "#55625f";
    ctx.fillText("no proof bundle or custom receipt is attached to this package yet", W / 2, py + 40);
  }
  ctx.fillStyle = "#3f4f4b";
  ctx.font = "600 22px 'IBM Plex Mono', monospace";
  ctx.fillText("the match, felt · roarline", W / 2, H - 52);
}

export async function shareCard(canvas, moment, state) {
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  const file = new File([blob], `roarline-${moment.type.toLowerCase()}-${state.score.home}-${state.score.away}.png`, { type: "image/png" });
  const text = `${TITLE[moment.type] || moment.type} — ${state.home.name} ${state.score.home}–${state.score.away} ${state.away.name} (${moment.minute}′) · felt live on ROARLINE`;
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return; } catch { /* user cancelled */ }
  }
  downloadCard(canvas, moment, state);
}

export function downloadCard(canvas, moment, state) {
  const a = document.createElement("a");
  a.download = `roarline-${moment.type.toLowerCase()}-${state.score.home}-${state.score.away}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(" ");
  let line = "", yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lineH;
    } else line = test;
  }
  ctx.fillText(line, x, yy);
}

function hexA(hex, a) {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
