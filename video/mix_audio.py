"""Mixes out/music.wav + out/vo/*.wav (placed by timing.json, music ducked under the voice)
onto the silent render, done in Python/numpy -- the only ffmpeg on this machine is Remotion's
filter-stripped bundled build, which has no sidechaincompress/loudnorm-grade chain available.
Muxing the final WAV onto the silent video still goes through that bundled ffmpeg (plain
mux, no filters needed for that step).

  ../.venv/Scripts/python mix_audio.py   -> out/waypoint-demo.mp4
"""
import json
import subprocess
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
FFMPEG = HERE / "node_modules" / "@remotion" / "compositor-win32-x64-msvc" / "ffmpeg.exe"
SR = 44100


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        assert w.getframerate() == SR, f"{path} is not {SR}Hz"
        raw = w.readframes(w.getnframes())
        data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        if w.getnchannels() == 2:
            data = data.reshape(-1, 2).mean(axis=1)
        return data


def write_wav(path: Path, sig: np.ndarray) -> None:
    pcm = np.clip(sig, -1.0, 1.0)
    pcm = (pcm * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def envelope(sig: np.ndarray, attack_ms: float = 15, release_ms: float = 450) -> np.ndarray:
    a = np.exp(-1.0 / (SR * attack_ms / 1000))
    r = np.exp(-1.0 / (SR * release_ms / 1000))
    env = np.empty_like(sig)
    prev = 0.0
    abs_sig = np.abs(sig)
    for i in range(sig.shape[0]):
        x = abs_sig[i]
        coef = a if x > prev else r
        prev = coef * prev + (1 - coef) * x
        env[i] = prev
    return env


def main() -> None:
    timing = json.loads((OUT / "vo" / "timing.json").read_text())
    music = read_wav(OUT / "music.wav")
    total = music.shape[0]

    vo_track = np.zeros(total, dtype=np.float32)
    for key in sorted(timing):
        vo = read_wav(OUT / "vo" / f"{key}.wav") * 1.6
        start = int(round(timing[key]["start"] * SR))
        end = min(total, start + vo.shape[0])
        if start >= total:
            continue
        vo_track[start:end] += vo[: end - start]

    vo_track = np.clip(vo_track, -0.95, 0.95)
    duck_env = envelope(vo_track, attack_ms=15, release_ms=450)
    duck_env = np.minimum(1.0, duck_env * 10)  # 0 (no voice) .. 1 (voice present)
    music_ducked = music * 0.55 * (1.0 - 0.75 * duck_env)

    mixed = music_ducked + vo_track
    peak = np.max(np.abs(mixed)) or 1.0
    target = 0.9
    if peak > target:
        mixed *= target / peak

    out_wav = OUT / "mixed.wav"
    write_wav(out_wav, mixed)

    args = [
        str(FFMPEG), "-v", "error", "-y",
        "-i", str(OUT / "waypoint-demo-silent.mp4"),
        "-i", str(out_wav),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest", str(OUT / "waypoint-demo.mp4"),
    ]
    subprocess.run(args, check=True)
    print("wrote", OUT / "waypoint-demo.mp4")


if __name__ == "__main__":
    main()
