# 🎬 ROARLINE — Edit Your Demo Video (Super Simple Guide)

You already recorded the clips. Now follow this exactly, step by step.
Do not skip steps. Do not add extra effects. Simple = professional.

---

## 0 · What you should have before editing

**Your screen recordings (from before):**

| Clip | What it shows | About how long |
|---|---|---|
| Clip A | Landing page + scroll to VERIFIED ON SOLANA | 25 sec |
| Clip B | Full FEEL 90s replay (goal → 0–3 → VAR back to 0–2) | ~100 sec |
| Clip C | The 2 Solana Explorer transactions | 40 sec |
| Clip D | Language EN→ES→FR→PT + the 4 modes | 30 sec |
| Clip E | /evidence page scroll | 25 sec |
| Clip F | /publisher-demo + back to landing page | 20 sec |

**Your 8 ElevenLabs voice files:** `01-problem.mp3` … `08-close.mp3`

**AI clips (optional but nice):** 2 Veo clips for the opening (prompts at the bottom of this file).

If a clip is missing → re-record just that one at https://roarline-production.up.railway.app

---

## 1 · Make the project (2 minutes)

1. Open **CapCut** (desktop).
2. Click the big blue **New project** button.
3. In the top-left click **Import** → select ALL your files (all clips + all mp3s + Veo clips + thumbnail image). They appear as little cards in the Media panel.
4. Look at the right side → **Ratio** → pick **16:9**.
5. Top-right corner → click **Export settings** later, not now. First we build.

💡 Save constantly: `Ctrl+S` (CapCut also autosaves, but still).

---

## 2 · Build the video track (drag things in this exact order)

Drag clips from the Media panel DOWN onto the timeline, left to right, touching each other (no gaps):

```
[Veo 1][Veo 2][ Clip A ][ Clip B (the long one) ][ Clip C ][ Clip D ][ Clip E ][ Clip F ]
```

If you did NOT make Veo clips, just start with Clip A.

**Trim the fat:** every clip has junk at the start/end (you moving the mouse to hit record).
1. Click a clip on the timeline.
2. Hover the LEFT edge until you see the arrow ↔.
3. Drag right until the junk is gone.
4. Do the same at the RIGHT edge.

Rule: each clip should start exactly where something interesting is on screen.

---

## 3 · Add the voice (one mp3 at a time)

Drag each mp3 to the track UNDER the video. Line them up like this:

| Voice file | Put it under… | Starts when… |
|---|---|---|
| `01-problem.mp3` | Veo clips (or start of Clip A) | the very first frame, 0:00 |
| `02-solution.mp3` | Clip A | right when the landing page appears |
| `03-replay.mp3` | Clip B | ~2 sec after you click FEEL 90s |
| `04-correction.mp3` | Clip B | when the score goes 0–3 (the goal that gets revoked) |
| `05-solana.mp3` | Clip C | first frame of the Explorer page |
| `06-accessibility.mp3` | Clip D | first frame |
| `07-evidence.mp3` | Clip E | first frame |
| `08-close.mp3` | Clip F | first frame |

**The golden gap:** between `03` and `04` there must be **15–20 seconds with NO voice** — just the app's crowd + commentary. That silence is what makes it feel real. Do not fill it.

If a voice file is longer than its clip → drag the RIGHT edge of the video clip to make the video longer is impossible — instead SLOW the scroll section: right-click the video clip → **Speed** → set `0.8x`. Or trim the voice pause instead. Never cut the voice mid-sentence.

---

## 4 · Fix the sound levels (most important step!)

The app has its own audio (crowd, TTS commentary) inside Clips B and D. The voiceover must sit ON TOP of it.

1. Click **Clip B** on the timeline.
2. On the right panel find **Audio** → **Volume**.
3. Set volume to about **–14 dB** (or drag to ~20%) — do this for every part where a voice mp3 is playing.
4. Where there is NO voice (the golden gap), raise Clip B back to about **–6 dB** (~50%).
   - Easy way: right-click Clip B → **Split** (`Ctrl+B`) at the start and end of the golden gap → now it's 3 pieces → set the middle piece louder.
5. Every voice mp3: volume **0 dB** (100%). Don't touch it.
6. Click each mp3 → **Audio** panel → turn ON **Fade in 0.15s** and **Fade out 0.15s**.

**No background music. None.** The synthesized crowd IS the music.

---

## 5 · Captions (5 minutes)

1. Top menu → **Text** → **Auto captions**.
2. Language: **English** → click **Generate**.
3. It makes caption boxes on a new track. Play the video and fix these words when they come up wrong:
   - **ROARLINE** (it may write "roar line")
   - **TxLINE** ("T X line" → make it TxLINE)
   - **TxODDS**
   - **Solana**
   - **Anchor**
   - **MomentReceipt**
   - **Merkle**
   - **devnet**
4. Click one caption → **Text style**: font **bold**, color **white**, background **black at ~60% opacity**, position **bottom center**.
5. Click **Apply to all**.
6. On Clip C (the Explorer transactions): drag the captions UP a little so they don't cover the program logs.

---

## 6 · Tiny polish (only these 4 things, nothing more)

1. **Fade in from black** at 0:00 → Transitions? No — click the first clip → **Animation** → **In** → **Fade in** (0.5s).
2. **Fade out to black** on the last clip → **Animation** → **Out** → **Fade out** (0.8s).
3. Between clips: NO transitions. A hard cut is what pros use. (If you truly hate one cut, use **Mix/Dissolve** at 0.3s max.)
4. On Clip C, when "Evaluate predicate to: true" is on screen → **Text** → add a plain white text box: `TxLINE oracle verdict — on-chain` → show it for 3 seconds. That's the money shot.

---

## 7 · Watch it once, fully

Press spacebar and watch beginning to end. Checklist:

- [ ] Total length is **under 5:00** (aim 4:00–4:30). Look at the timecode on the right end of the timeline.
- [ ] You can hear the voice clearly EVERYWHERE.
- [ ] The golden gap exists (crowd only, no voice).
- [ ] Goal → 0–3 → VAR back to 0–2 is all on screen.
- [ ] Explorer shows **Status: Success** and the `Evaluate predicate to: true` log line readable.
- [ ] No password, no wallet file, no terminal with secrets, no personal bookmarks visible.

Too long? Trim the scrolling parts of Clip A / E / F. NEVER trim Clip B's replay or Clip C's logs.

---

## 8 · Export

1. Top-right orange **Export** button.
2. Name: `ROARLINE-FINAL-DEMO`
3. Resolution: **1080p**
4. Frame rate: **30fps**
5. Bitrate/Quality: **Recommended/High** (or ~16 Mbps if it asks)
6. Format: **MP4**
7. Click **Export** and wait.
8. Watch the exported file ONE more time in a normal video player.

---

## 9 · Upload to YouTube

1. Go to **youtube.com** → click the camera icon → **Upload video**.
2. Select `ROARLINE-FINAL-DEMO.mp4`.
3. Title: `ROARLINE — The World Cup Match Rebuilt From Pure Data (TxODDS × Solana Hackathon)`
4. Description — paste this:

   > ROARLINE is an audio-first, low-bandwidth live sports broadcast built from TxLINE data. A living pitch, a synthesized crowd, a multilingual booth, a market probability river — and decisive moments receipted on Solana by an Anchor program that CPI-verifies each goal against the TxLINE oracle before writing the receipt.
   >
   > Live app: https://roarline-production.up.railway.app
   > Source: https://github.com/iamdflame/ler1
   > Receipt tx: https://explorer.solana.com/tx/3mogoKDhXKUrK7tCTZhcDHSau71SLo55SDX4KonpX5zHarKCPqmRhpgJzAKG2WRnKBGA6EVxptvFZiTFWNhNk9mb?cluster=devnet

5. Kids question: **No, it's not made for kids**.
6. Visibility: **Unlisted** → **Save**.
7. Upload the thumbnail (below) as custom thumbnail.
8. **Copy the video link and send it to me** → I'll put it in README + SUBMISSION and push.

---

---

# 🎥 Veo 3.1 prompts — the opening "problem" (2 clips, 8s each)

Generate both, put them at the very start (before Clip A), in this order, under `01-problem.mp3`.

## Veo clip 1 — the fan who can't watch

> Cinematic handheld documentary shot, 8 seconds, 16:9. A young warehouse worker on a night shift in a dim industrial aisle, wearing a hi-vis vest and one discreet earphone, sneaks a glance at the phone hidden by his side. The phone screen shows only a plain, boring push notification with an abstract score "0 – 1" and nothing else. He exhales, disappointed, slides the phone into his pocket and keeps working. Moody sodium-lamp lighting, shallow depth of field, realistic skin texture, muted colors, quiet ambient warehouse hum, no music, no dialogue. No brand logos, no team crests, no broadcaster marks, no readable text except the abstract "0 – 1" notification.

## Veo clip 2 — the whole world in the same situation

> Cinematic montage feel in a single 8-second shot, 16:9. A crowded evening commuter bus in a large city, rain streaks on the windows, warm city lights outside. Several passengers of different ages and ethnicities each glance at their phones; every screen shows the same minimal abstract score notification "0 – 1" — no video, no highlights. A slow push-in on one woman's face: she closes her eyes, imagining the stadium. Subtle rumble of the bus, distant city sounds, no music, no dialogue. Photorealistic, shallow depth of field, muted teal-and-amber grade. No brand logos, no team crests, no readable UI text except the abstract "0 – 1".

**How to use them:** Veo 1 at 0:00–0:08, Veo 2 at 0:08–0:16, then cut to Clip A while `01-problem.mp3` says "…a spreadsheet cell, for one of the most emotional events on Earth." That cut — from gray commute to the electric-lime landing page — is your best moment in the first 20 seconds.

(Optional Veo clip 3 for the ending, under `08-close.mp3`: same bus, but now the woman has earphones in, eyes closed, smiling slightly, phone in pocket — feeling the match instead of watching it. Same rules: 8s, no logos, no text.)

---

# 🖼 Nano Banana Pro prompts

## Thumbnail (generate at 16:9)

> Premium cinematic YouTube thumbnail background, 16:9, 3840 by 2160. A dark, near-black football pitch seen from a low dramatic angle, rendered entirely from glowing data: thousands of tiny luminous points and thin traces form the field lines, an electric lime shockwave of pressure erupting toward one goal mouth, a translucent win-probability ribbon in cyan and warm orange flowing across the midfield like a river, faint audio-waveform arcs rising like a stadium roar made visible. High-end sports-broadcast design language, deep contrast, crisp geometry, subtle purple accents near the goal suggesting blockchain verification. Large clean negative space in the upper left for a title. No players, no crowds of real people, no team crests, no FIFA marks, no existing logos, no text of any kind.

Then in CapCut (or any editor) put big bold white text on the empty upper-left area:
**THE MATCH, FELT** and smaller under it: `zero video · pure data · receipts on Solana`.

## Backup opening image (if Veo fails, use this still instead)

> Cinematic documentary photograph, 16:9, 3840 by 2160. A young woman on a crowded night bus in a rainy city, resting her head against the window, holding a phone that shows only a minimal, boring abstract score notification "0 – 1" on an otherwise empty dark screen. Her expression is quiet longing — she is missing the biggest match of the year. Warm street light bokeh through wet glass, realistic skin texture, muted colors, premium advertising photography, shallow depth of field. No brand logos, no team crests, no readable text anywhere except the abstract "0 – 1" notification.

Put it on screen for 6–8 seconds at 0:00 with a very slow zoom-in: click the image in CapCut → **Animation** → **In** → **Zoom in** (or keyframe Scale 100%→108%).

---

## Final send-back list

1. YouTube link → send to me → I update README/SUBMISSION and push.
2. That's it. Everything else (site, Railway, receipts, evidence) is already live.
