#!/usr/bin/env bash
# Cuts raw/waypoint-recording.mp4 (recorded 2026-10-18, the real live app) into the
# clips Root.tsx expects. Timestamps found by extracting a frame every 10s with ffmpeg
# and visually locating each clean segment; two live agent runs failed mid-recording
# (Groq rate limit) so those windows are skipped entirely, not cut around.
# name  source-start  source-end  speed
set -euo pipefail
cd "$(dirname "$0")/.."
FF="video/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe"
IN="video/raw/waypoint-recording.mp4"
mkdir -p video/public/clips
cut() { "$FF" -v error -y -ss "$2" -to "$3" -i "$IN" -an -vf "scale=2360:1328" \
  -r 30 -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p "video/public/clips/$1.mp4"; }
cut c1_signin        0.0    9.5   1    # signed-in cockpit, "Graph connected", read-only badge
cut c2_sources       15.0   29.5  1    # Sources panel: DeepMehta06/Archlens connected, partial sync note
cut c3_ask           39.5   53.0  1    # ask Archlens overview -> Tool: resolve -> graph path lights up live
cut c4_investigation 239.0  251.5 1    # investigation detail: title, stored evidence, recovery export
cut c5_evidence       263.5 279.5 1    # scrolled run trace: real tool_call JSON (resolve), source URLs, evidence IDs

# Blur any visible secret before publishing (email, keys, tokens). None were visible in
# review of these five windows, but if a redo ever shows one, use this pattern:
# "$FF" -v error -y -i video/public/clips/c1_signin.mp4 -filter_complex \
#   "[0:v]split[a][b];[b]crop=W:H:X:Y,boxblur=24:3[bl];[a][bl]overlay=X:Y:enable='between(t,T0,T1)'" \
#   -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p video/public/clips/c1_signin.tmp.mp4
# mv video/public/clips/c1_signin.tmp.mp4 video/public/clips/c1_signin.mp4
