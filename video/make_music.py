"""Synthesizes out/music.wav directly in Python (numpy), mirroring make_music.sh's design
(120-BPM-feel beat, riser before the drop, fade out) -- this machine has no full ffmpeg
with lavfi/aevalsrc/lowpass/afade available, only Remotion's filter-stripped bundled build.

  ../.venv/Scripts/python make_music.py [duration_seconds]
"""
import sys
import wave
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent / "out"
SR = 44100


def synth(duration: float) -> np.ndarray:
    t = np.arange(int(duration * SR)) / SR
    k = np.mod(t, 0.5)
    bar = np.mod(t, 8.0)
    root = np.where(bar < 2, 49.0, np.where(bar < 4, 41.2, np.where(bar < 6, 55.0, 43.65)))
    pump = 0.3 + 0.7 * np.minimum(1.0, k * 4)

    kick = 0.9 * np.sin(2 * np.pi * 50 * k + 7 * (1 - np.exp(-k * 38))) * np.exp(-k * 9)

    rng = np.random.default_rng(0)
    hat_noise = 2 * rng.random(t.shape[0]) - 1
    hat = 0.10 * hat_noise * np.exp(-np.mod(t + 0.25, 0.5) * 80)

    snare_t = np.mod(t - 0.5, 1.0)
    snare_noise = 2 * rng.random(t.shape[0]) - 1
    snare = (0.22 * snare_noise + 0.12 * np.sin(2 * np.pi * 185 * snare_t)) * np.exp(-snare_t * 22) * (t >= 0.5)

    bass = 0.30 * np.sin(2 * np.pi * root * t) * pump
    pad = 0.07 * (np.sin(2 * np.pi * root * 4 * t) + 0.6 * np.sin(2 * np.pi * root * 6 * t)
                  + 0.5 * np.sin(2 * np.pi * root * 5.04 * t)) * pump

    riser_noise = 2 * rng.random(t.shape[0]) - 1
    riser = (0.10 * riser_noise + 0.06 * np.sin(2 * np.pi * (90 + 45 * t) * t)) * (t / 6)

    main = kick + hat + snare + bass + pad
    sig = np.where(t < 6, riser, main) * 0.5

    # one-pole lowpass (~9kHz feel) to soften noise bursts
    alpha = 0.35
    filtered = np.empty_like(sig)
    prev = 0.0
    for i in range(sig.shape[0]):
        prev = prev + alpha * (sig[i] - prev)
        filtered[i] = prev

    fade_in = np.minimum(1.0, t / 0.5)
    fade_out = np.minimum(1.0, np.maximum(0.0, (duration - t) / 4.0))
    filtered *= fade_in * fade_out

    peak = np.max(np.abs(filtered)) or 1.0
    if peak > 0.8:
        filtered *= 0.8 / peak
    return filtered


def main(duration: float) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sig = synth(duration)
    pcm = (sig * 32767).astype(np.int16)
    with wave.open(str(OUT / "music.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print("wrote", OUT / "music.wav", f"({duration:.1f}s)")


if __name__ == "__main__":
    main(float(sys.argv[1]) if len(sys.argv) > 1 else 117.5)
