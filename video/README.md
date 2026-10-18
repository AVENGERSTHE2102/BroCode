# Waypoint demo video

Remotion project for the ~2-minute GraphHacks submission video. English voice-over.
Structure and tooling reused from the `plan-bana` Remotion template; all content, copy,
colors, and scenes are Waypoint's own.

## Status (2026-10-18) — final

`out/waypoint-demo.mp4` is rendered: 1:57.5, 1920x1080, real voice-over + music. The final
deliverables are also copied to `video/dist/` (`waypoint-demo.mp4`, `thumbnail.png`,
`waypoint-demo.gif`) — unlike `video/out/`, `video/dist/` is **not** gitignored, so the
repo's own README can link straight to the committed file. Re-copy after any re-render:
`cp out/waypoint-demo.mp4 out/thumbnail.png out/waypoint-demo.gif dist/`.

- **Real, screen-recorded footage** (`video/raw/waypoint-recording.mp4`, cut by
  `cut_clips.sh`): signed-in cockpit, the connected `DeepMehta06/Archlens` GitHub repo
  with its partial-sync note, a live agent run tracing `resolve_entity` → `trace_entity`
  with the graph path lighting up, the investigation detail page with recovery export,
  and a scroll through a real `tool_call` trace (actual GitHub source IDs, URLs, evidence
  IDs). Two live agent runs hit a Groq free-tier rate limit mid-recording — that failure
  is real and is acknowledged in the Evidence scene's caption and voice-over rather than
  cut around or hidden.
- **Illustrative, clearly labeled, not footage**: the graph-model diagram
  (`GraphModelScene`) and the proposal-approval-draft-PR sequence (`ApprovalScene`, both
  in `src/outro.tsx`). The write-enabled agent run that would draft a GitHub PR
  (`propose_action`) returned a reproducible 502 when tested live — a real app bug, not a
  rate limit (a direct call to the configured Groq endpoint with the real key succeeds,
  so the break is in the app's write-run code path). `ApprovalScene` carries an on-screen
  "ILLUSTRATIVE — NOT LIVE FOOTAGE" badge and the voice-over says so explicitly. Don't
  remove that label or cut live footage into that scene unless the bug is actually fixed
  and a real approved-proposal-to-draft-PR run is captured.

## Environment quirks hit while building this (read before re-running)

This machine has **no standalone ffmpeg/ffprobe** and no prior Python TTS setup. Rather
than install a full ffmpeg, the scripts below were adapted to use the ffmpeg binary
Remotion already bundles at `node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe`
— but that build is compiled with most filters stripped out (no `fps`, `setpts`,
`silenceremove`, `lavfi`/`aevalsrc`, `lowpass`, `afade`, `sidechaincompress`). Concretely:

- `cut_clips.sh` uses only `scale` (enabled) and output `-r 30` instead of a `fps` filter.
- `make_vo.py`'s silence-trim is pure Python (amplitude-threshold scan over raw PCM, see
  `_trim_silence_pcm`), not ffmpeg's `silenceremove`; only the speed-up step (`atempo`)
  goes through the bundled ffmpeg, and only when actually needed.
- `make_music.py` (not `.sh`) synthesizes the beat directly in NumPy — the original
  `make_music.sh` needs `-f lavfi -i aevalsrc=...` plus `lowpass`/`afade`, none of which
  this ffmpeg build has. `make_music.sh` is kept for reference / a machine with full
  ffmpeg, but isn't what actually ran here.
- `mix_audio.py` does the VO-placement, ducking (envelope follower), and mix entirely in
  NumPy/wave, then uses the bundled ffmpeg only for the final plain mux (video copy + AAC
  audio) — the original sidechain-compress-based approach needs a filter this build
  doesn't have.
- Gemini TTS (`gemini-3.8-flash-tts`) has a **10-requests/day free-tier cap** — we hit it
  after line 8 of 12. Lines 11-12 were generated with `VO_MODEL=gemini-2.5-flash-preview-tts`
  instead (a different model, separate quota pool, same `GEMINI_API_KEY` — no new key
  needed). If re-running `make_vo.py` on a fresh day, the default model should still work
  for all 12 lines.
- Python commands were run via the project's conda `base` env
  (`C:\Users\Deep\anaconda3\shell\condabin\conda-hook.ps1 ; conda activate base`), with
  `google-genai` installed into that env.

If this gets rebuilt on a machine with a real ffmpeg install, the original `.sh`/filter
approach (still present, unmodified in intent) will work more simply — these workarounds
exist only because of this specific machine's missing ffmpeg.

## Shot list (what was actually recorded, for reference)

Real timestamps used, found by extracting a frame every 10s from the raw recording and
narrowing around each boundary (see `cut_clips.sh` for exact in/out points):

| # | Scene | Raw window | What it shows |
|---|---|---|---|
| 1 | `c1_signin` | 0.0–9.5s | Signed-in cockpit: workspace, owner badge, "Graph connected". |
| 2 | `c2_sources` | 15.0–29.5s | Sources panel: `DeepMehta06/Archlens` connected, Dependabot partial-sync note. |
| 3 | `c3_ask` | 39.5–53.0s | Live agent run: "Tool: resolve", graph path lighting up (stops before the rate-limit failure that followed). |
| 4 | `c4_investigation` | 239.0–251.5s | Investigation detail page: title, stored evidence, recovery export buttons. |
| 5 | `c5_evidence` | 263.5–279.5s | Scrolled run-trace log: real `tool_call` JSON for `resolve_entity`, GitHub source IDs/URLs/evidence IDs. |

The 55–239s window (two failed live runs, a dev-server chunk-load error and restart, a
second failed run) was deliberately skipped, not cut around — see the Status section above.

Before recording again, re-check `.env` isn't visible on screen. Blur anything sensitive
that slips through with the commented block at the bottom of `cut_clips.sh`.

## Rebuild commands

```bash
# 1. Cut the raw recording into clips (edit timestamps in cut_clips.sh if re-recording)
bash cut_clips.sh

# 2. Install deps and render the silent video
cd video
bun install
bunx remotion render src/index.ts Waypoint out/waypoint-demo-silent.mp4
bunx remotion still src/index.ts Thumbnail out/thumbnail.png

# 3. Generate the beat (NumPy synth, see "Environment quirks" above)
#    conda activate base first
python make_music.py 117.5

# 4. Generate English voice-over (needs GEMINI_API_KEY in ../.env)
python make_vo.py
# if you hit a daily quota 429 partway through, retry just the missing lines:
#   python make_vo.py 11 12
# or switch model for a separate quota pool:
#   $env:VO_MODEL="gemini-2.5-flash-preview-tts"; python make_vo.py 11 12

# 5. Mix music + VO onto the silent render
python mix_audio.py
# -> out/waypoint-demo.mp4

# 6. Preview GIF for the README (12s from the Ask scene)
FF="node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe"
"$FF" -ss 36 -t 12 -i out/waypoint-demo.mp4 -r 15 -vf "scale=640:-1" out/waypoint-demo.gif
```

## Notes

- Total runtime: 117.5s across 12 scenes defined in `src/Root.tsx`.
- Accent color is Waypoint's own sage green (`#5c7053` / `#42634e`, the site's
  `--purple`/accent token) against a near-black base — not the ivory the live site
  uses, because it reads better on a dark video background. Fonts: Bricolage Grotesque
  (display) and JetBrains Mono (code/data), both via `@remotion/google-fonts`.
- `thumbnail.tsx` uses two real screenshots from the 2026-10-18 verification session
  (`public/thumb/graph.jpg`, `public/thumb/citations.jpg`), not mockups.
- `youtube.md` has the title, description, chapters, and the required AI-assisted
  development disclosure (hackathon rule 11).
- Keep `video/raw/`, `video/public/clips/`, `video/tools/` (an incomplete ffmpeg.zip
  download, unused — safe to delete), and `video/out/` out of git (already in the repo
  root `.gitignore`).
