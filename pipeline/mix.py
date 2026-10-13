"""Bus mixer: places every clip, ducks music under speech and animal sounds,
adds a little stereo width, and masters to a clean, safe level for small ears."""
import numpy as np
from scipy import signal

from .config import DURATION, SR

BUS_GAIN = {"speech": 1.0, "vocals": 0.85, "music": 0.42, "sfx": 0.75, "foley": 0.55, "amb": 0.5}
BUS_PAN = {"speech": 0.0, "vocals": 0.0, "music": 0.0, "sfx": 0.0, "foley": 0.0, "amb": 0.0}


def _env(x, attack=0.03, release=0.35):
    """Fast peak-follower envelope (vectorised, block-wise)."""
    blk = 441
    n = len(x) // blk
    pk = np.abs(x[: n * blk]).reshape(n, blk).max(axis=1)
    out = np.zeros(n)
    a = np.exp(-1 / (attack * SR / blk))
    r = np.exp(-1 / (release * SR / blk))
    v = 0.0
    for i in range(n):
        c = a if pk[i] > v else r
        v = c * v + (1 - c) * pk[i]
        out[i] = v
    return np.repeat(out, blk)[: len(x)], out


def reverb(x, mix_amt=0.18, decay=1.4, seed=3):
    """Small, smooth room reverb: decaying-noise impulse response convolved via FFT."""
    rng = np.random.default_rng(seed)
    n = int(decay * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t * 6.9 / decay)
    ir = signal.lfilter(*signal.butter(1, 5000 / (SR / 2), "low"), ir)
    ir[: int(0.012 * SR)] = 0                       # pre-delay
    ir /= np.sqrt(np.sum(ir ** 2))
    wet = signal.oaconvolve(x, ir.astype(np.float32), mode="full")[: len(x)]
    return (x + mix_amt * wet).astype(np.float32)


def mix(tl):
    n = int(DURATION * SR)
    bus = {k: np.zeros(n, np.float32) for k in BUS_GAIN}
    for name, start, arr, gain in tl.audio:
        s = int(round(start * SR))
        if s >= n:
            continue
        a = arr[: n - s] if s >= 0 else arr[-s: n - s]
        s = max(s, 0)
        bus[name][s:s + len(a)] += a.astype(np.float32) * gain

    bus["vocals"] = reverb(bus["vocals"], 0.32, 1.6)
    bus["speech"] = reverb(bus["speech"], 0.08, 0.6, seed=5)
    bus["music"] = reverb(bus["music"], 0.12, 1.2, seed=7)

    # sidechain ducking of music/foley/ambience under speech + animal sounds
    key = np.abs(bus["speech"]) + 0.8 * np.abs(bus["sfx"])
    env, _ = _env(key, 0.04, 0.45)
    duck = 1.0 - 0.6 * np.clip(env / 0.25, 0, 1)              # up to ~ -8 dB
    for k in ("music", "foley", "amb"):
        bus[k] *= duck.astype(np.float32)

    left = np.zeros(n, np.float32)
    right = np.zeros(n, np.float32)
    for k, g in BUS_GAIN.items():
        x = bus[k] * g
        if k in ("music", "amb"):
            d = int(0.012 * SR)                                 # Haas width
            left += x
            right[d:] += x[:-d]
        else:
            left += x
            right += x
    st = np.stack([left, right], axis=1)
    b, a = signal.butter(2, 35 / (SR / 2), "high")
    st = signal.lfilter(b, a, st, axis=0).astype(np.float32)
    # loudness: target ~ -17 dBFS RMS on active parts, then a soft limiter
    act = np.abs(st[:, 0]) > 1e-4
    rms = np.sqrt(np.mean(st[act] ** 2)) if act.any() else 1.0
    st *= (10 ** (-17 / 20)) / max(rms, 1e-6)
    st = np.tanh(st * 1.1) / np.tanh(1.1) * 0.95
    st = np.clip(st, -0.98, 0.98)
    # 1.5 s fade-out at the very end
    f = int(1.5 * SR)
    st[-f:] *= np.linspace(1, 0, f)[:, None]
    return st


def mouth_envelopes(tl, fps):
    """Per-character 0-9 mouth-open strings at video frame rate."""
    nfr = int(DURATION * fps)
    chans = {}
    hop = SR // fps
    for who, start, arr in tl.mouth:
        ch = chans.setdefault(who, np.zeros(nfr, np.float32))
        k = len(arr) // hop
        if k == 0:
            continue
        rms = np.sqrt(np.mean(arr[: k * hop].reshape(k, hop) ** 2, axis=1))
        rms = rms / (rms.max() + 1e-9)
        f0 = int(round(start * fps))
        e = min(nfr, f0 + k)
        if e > f0 >= 0:
            ch[f0:e] = np.maximum(ch[f0:e], rms[: e - f0])
    return {w: "".join(str(int(v)) for v in np.clip(np.round(np.sqrt(c) * 9), 0, 9)) for w, c in chans.items()}
