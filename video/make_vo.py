"""English voice-over for the Waypoint demo via Gemini TTS, one clip per scene -> video/out/vo/NN.wav + timing.json.

  ../.venv/Scripts/python make_vo.py            # all lines
  ../.venv/Scripts/python make_vo.py 7 8        # only re-generate lines 7 and 8

Each line has the scene start (seconds on the video timeline, matching Root.tsx) and the
max length it may take. English only per this project's VO-language decision.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import wave
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

HERE = Path(__file__).resolve().parent
load_dotenv(HERE.parent / ".env")
OUT = HERE / "out" / "vo"
# No system ffmpeg on this machine; reuse the one Remotion already bundles. It's a
# filter-stripped build (no silenceremove/ffprobe companion), so trim_and_fit below
# works around that instead of assuming a full ffmpeg install.
FFMPEG = HERE / "node_modules" / "@remotion" / "compositor-win32-x64-msvc" / "ffmpeg.exe"
MODEL = os.getenv("VO_MODEL", "gemini-3.8-flash-tts")
VOICE = os.getenv("VO_VOICE", "Fenrir")
STYLE = os.getenv("VO_STYLE", "")

# (start_seconds, max_seconds, text) — start/max must stay inside each scene's slot in Root.tsx.
LINES: list[tuple[float, float, str]] = [
    (0.3, 5.3, "Every team's engineering context is scattered — across repos, tickets, and tribal knowledge."),
    (6.2, 3.8, "Introducing Waypoint."),
    (10.8, 7.3, "Not a chatbot — a graph the agent can actually walk, with every answer traced back to its source."),
    (18.8, 6.2, "One workspace, one authenticated session — the agent only sees what you're scoped to."),
    (25.8, 9.2, "Connect a real GitHub repository through a least-privilege GitHub App. Partial sync failures are reported, never hidden."),
    (35.8, 12.2, "Ask a question, and the agent resolves the exact entity, then traces it — real, bounded graph queries, lighting up live."),
    (48.8, 11.2, "Every question becomes a saved investigation — evidence, a recovery export, and tasks that survive the session."),
    (60.8, 13.2, "This is the actual trace, not a summary — real tool calls, real GitHub source IDs. Two live runs hit a provider rate limit while we recorded this; the evidence underneath is still real."),
    (74.8, 11.2, "Under the hood, FalkorDB is the reasoning engine: real node and edge types, and a bounded graph traversal."),
    (86.8, 11.2, "Agents propose, a human approves. Execution is scoped and reversible, and it never auto-merges — this flow is illustrated, not today's live run."),
    (98.8, 9.2, "Eighteen authenticated tools. Twenty-seven contract tests passing. Numbers pulled straight from the terminal."),
    (108.8, 8.2, "Waypoint. Less context switching. More forward."),
]


def tts(client: genai.Client, text: str) -> bytes:
    cfg = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=VOICE))),
    )
    for attempt in range(4):
        try:
            r = client.models.generate_content(model=MODEL, contents=STYLE + text, config=cfg)
            return r.candidates[0].content.parts[0].inline_data.data
        except Exception as e:  # noqa: BLE001 (rate limits / transient errors: back off and retry)
            print(f"   retry {attempt + 1}: {type(e).__name__}: {str(e)[:120]}")
            time.sleep(6 * (attempt + 1))
    raise SystemExit(f"TTS failed for: {text[:60]}")


def write_wav(path: Path, pcm: bytes) -> float:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm)
    return len(pcm) / 2 / 24000


def _trim_silence_pcm(pcm: bytes, threshold: int = 400) -> bytes:
    """Pure-Python silence trim (no ffmpeg silenceremove filter available): drop leading/
    trailing 16-bit samples below an amplitude threshold, in 10ms chunks."""
    import array
    samples = array.array("h", pcm)
    chunk = 240  # 10ms @ 24kHz
    n = len(samples)

    def loud(i: int) -> bool:
        seg = samples[i : i + chunk]
        return any(abs(s) > threshold for s in seg)

    start = 0
    while start < n and not loud(start):
        start += chunk
    end = n
    while end > start and not loud(max(start, end - chunk)):
        end -= chunk
    return samples[start:end].tobytes()


def trim_and_fit(src: Path, dst: Path, max_s: float) -> float:
    """Trim silence at both ends (pure Python); speed up (<= 1.25x) via the Remotion-bundled
    ffmpeg's atempo filter only if the line would overrun its scene — this machine has no
    standalone ffmpeg/ffprobe, and that bundled build has no silenceremove filter."""
    pcm = _trim_silence_pcm(src.read_bytes())
    dur = len(pcm) / 2 / 24000
    tempo = max(1.0, dur / max_s)
    if tempo > 1.25:
        print(f"   WARNING {dst.name}: {dur:.1f}s for a {max_s}s slot, even 1.25x overruns; shorten the text")
        tempo = 1.25
    trimmed = dst.with_suffix(".trimmed.wav")
    write_wav(trimmed, pcm)
    if abs(tempo - 1.0) < 1e-3:
        subprocess.run([str(FFMPEG), "-v", "error", "-y", "-i", str(trimmed), "-ar", "44100", str(dst)], check=True)
    else:
        subprocess.run([str(FFMPEG), "-v", "error", "-y", "-i", str(trimmed), "-af", f"atempo={tempo:.3f}", "-ar", "44100", str(dst)], check=True)
    trimmed.unlink()
    return dur / tempo


def main(only: set[int]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    timing_path = OUT / "timing.json"
    timing = json.loads(timing_path.read_text()) if timing_path.exists() else {}
    for i, (start, max_s, text) in enumerate(LINES, 1):
        if only and i not in only:
            continue
        raw = OUT / f"{i:02d}.raw.wav"
        final = OUT / f"{i:02d}.wav"
        print(f"{i:02d} @ {start:6.1f}s  {text[:70]}")
        write_wav(raw, tts(client, text))
        dur = trim_and_fit(raw, final, max_s)
        raw.unlink()
        timing[f"{i:02d}"] = {"start": start, "dur": round(dur, 2), "max": max_s}
        print(f"   -> {dur:.1f}s (slot {max_s}s)")
        timing_path.write_text(json.dumps(timing, indent=1))  # persist after each line: TTS quota can cut the run short


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main({int(a) for a in sys.argv[1:]})
