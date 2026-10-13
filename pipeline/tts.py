"""Speech and singing built on Piper TTS + the WORLD vocoder.

* `speak(text, who)`   -> spoken line in a character voice.
* `sing_line(...)`     -> each word is synthesised separately, then its pitch is
  replaced by the melody note(s) and its vowel is stretched to the note length,
  which turns plain TTS into on-key, on-beat singing.

Results are cached on disk (build/cache/tts) keyed by a hash of all inputs.
"""
import hashlib
import json
import re

import numpy as np
import pyworld as pw
import soundfile as sf
from scipy import signal

from .config import CACHE, SR, VOICE_FILES, VOICES

TTS_SR = 22050
FP = 5.0  # WORLD frame period (ms)

# name -> (model, speaker id, length_scale, pitch ratio, formant ratio)
PROFILES = {
    "train":     ("lessac", None, 1.08, 1.06, 1.0),
    "narrator":  ("lessac", None, 1.08, 1.0, 1.0),
    "baby":      ("libritts", 60, 1.12, 1.38, 1.12),
    "baby2":     ("libritts", 18, 1.12, 1.40, 1.12),
    "mommy":     ("libritts", 564, 1.08, 1.0, 1.0),
    "mommy2":    ("libritts", 12, 1.08, 1.0, 1.0),
    "kid1":      ("libritts", 396, 1.0, 1.32, 1.12),
    "kid2":      ("libritts", 408, 1.0, 1.30, 1.13),
    "kid3":      ("libritts", 444, 1.0, 1.34, 1.11),
    "kid4":      ("libritts", 18, 1.0, 1.28, 1.12),
    "friend_f":  ("libritts", 582, 1.05, 1.05, 1.02),
    "friend_f2": ("libritts", 624, 1.05, 1.1, 1.04),
    "friend_m":  ("ryan", None, 1.05, 1.0, 1.0),
    "friend_big": ("ryan", None, 1.1, 0.85, 0.93),
    "friend_small": ("libritts", 486, 1.0, 1.45, 1.15),
}

_voices = {}


def _voice(model):
    if model not in _voices:
        from piper import PiperVoice
        _voices[model] = PiperVoice.load(str(VOICES / VOICE_FILES[model]))
    return _voices[model]


def _key(*parts):
    return hashlib.sha1(json.dumps(parts, sort_keys=True).encode()).hexdigest()[:16]


def _cache(name):
    d = CACHE / "tts"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{name}.wav"


def _raw(text, model, spk, length):
    from piper import SynthesisConfig
    cfg = SynthesisConfig(speaker_id=spk, length_scale=length, noise_scale=0.6, noise_w_scale=0.7)
    chunks = list(_voice(model).synthesize(text, cfg))
    return np.concatenate([c.audio_float_array for c in chunks]).astype(np.float64)


def _trim(x, thr=0.02, pad=0.03):
    env = np.abs(x)
    idx = np.where(env > thr * env.max())[0]
    if not len(idx):
        return x
    p = int(pad * TTS_SR)
    return x[max(0, idx[0] - p): idx[-1] + p]


def _world(x):
    f0, t = pw.dio(x, TTS_SR, frame_period=FP, f0_floor=60, f0_ceil=900)
    f0 = pw.stonemask(x, f0, t, TTS_SR)
    sp = pw.cheaptrick(x, f0, t, TTS_SR)
    ap = pw.d4c(x, f0, t, TTS_SR)
    return f0, sp, ap


def _warp_formant(sp, ratio):
    if abs(ratio - 1) < 1e-3:
        return sp
    n = sp.shape[1]
    src = np.arange(n) / ratio
    out = np.empty_like(sp)
    for i in range(sp.shape[0]):
        out[i] = np.interp(src, np.arange(n), sp[i], right=sp[i, -1])
    return out


def _upsample(x):
    # 22050 -> 44100 is exactly x2
    return signal.resample_poly(x, 2, 1).astype(np.float32)


def speak(text, who="train"):
    model, spk, length, pitch, formant = PROFILES[who]
    path = _cache("say_" + _key(text, PROFILES[who], 3))
    if path.exists():
        y, _ = sf.read(path, dtype="float32")
        return y
    x = _trim(_raw(text, model, spk, length))
    if abs(pitch - 1) > 1e-3 or abs(formant - 1) > 1e-3:
        f0, sp, ap = _world(x)
        x = pw.synthesize(f0 * pitch, _warp_formant(sp, formant), ap, TTS_SR, FP)
    y = _upsample(x)
    y = (y / (np.abs(y).max() + 1e-9) * 0.85).astype(np.float32)
    sf.write(path, y, SR)
    return y


# ---------------------------------------------------------------------- singing
def _word_world(word, who):
    model, spk, length, _, _ = PROFILES[who]
    clean = re.sub(r"[^A-Za-z' ]", "", word) or word
    x = _trim(_raw(clean, model, spk, length), thr=0.04, pad=0.01)
    return _world(x)


def sing_word(word, notes, who):
    """notes: list of (midi, seconds). Returns float32 at SR."""
    path = _cache("sing_" + _key(word, notes, PROFILES[who], 4))
    if path.exists():
        y, _ = sf.read(path, dtype="float32")
        return y
    _, _, _, _, formant = PROFILES[who]
    f0, sp, ap = _word_world(word, who)
    voiced = np.where(f0 > 0)[0]
    total = sum(d for _, d in notes)
    nframes_total = max(4, int(total * 1000 / FP))
    if len(voiced) < 2:
        on, core, off = np.arange(len(f0)), np.array([], int), np.array([], int)
    else:
        on = np.arange(0, voiced[0])
        off = np.arange(voiced[-1] + 1, len(f0))
        core = np.arange(voiced[0], voiced[-1] + 1)
    max_on, max_off = int(0.12 * 1000 / FP), int(0.16 * 1000 / FP)
    on_idx = np.linspace(0, len(on) - 1, min(len(on), max_on)).astype(int) if len(on) else on
    on_idx = on[on_idx] if len(on) else on
    off_idx = off[np.linspace(0, len(off) - 1, min(len(off), max_off)).astype(int)] if len(off) else off
    n_core = nframes_total - len(on_idx) - len(off_idx)
    if len(core) and n_core < 6:
        # very short note: compress the consonants too
        scale = nframes_total / (len(on_idx) + len(off_idx) + 6)
        on_idx = on_idx[np.linspace(0, len(on_idx) - 1, max(1, int(len(on_idx) * scale))).astype(int)] if len(on_idx) else on_idx
        off_idx = off_idx[np.linspace(0, len(off_idx) - 1, max(1, int(len(off_idx) * scale))).astype(int)] if len(off_idx) else off_idx
        n_core = max(6, nframes_total - len(on_idx) - len(off_idx))
    if len(core):
        core_idx = core[np.clip(np.round(np.linspace(0, len(core) - 1, n_core)).astype(int), 0, len(core) - 1)]
    else:
        core_idx = np.array([], int)
    idx = np.concatenate([on_idx, core_idx, off_idx]).astype(int)
    nf0 = f0[idx].copy()
    nsp = sp[idx].copy()
    nap = ap[idx].copy()
    # melody pitch over the core, split proportionally between notes
    c0, c1 = len(on_idx), len(on_idx) + len(core_idx)
    if c1 > c0:
        target = np.zeros(c1 - c0)
        cum = 0
        ncore = c1 - c0
        bounds = []
        for m, d in notes:
            a = int(round(cum / total * ncore))
            cum += d
            b = int(round(cum / total * ncore))
            target[a:b] = 440 * 2 ** ((m - 69) / 12)
            bounds.append((a, b))
        # 30 ms portamento between notes
        k = max(1, int(30 / FP))
        target = np.convolve(np.pad(target, k, mode="edge"), np.ones(2 * k + 1) / (2 * k + 1), "same")[k:-k]
        tt = np.arange(ncore) * FP / 1000
        vib = 1 + 0.012 * np.sin(2 * np.pi * 5.5 * tt) * np.clip((tt - 0.22) * 4, 0, 1)
        target = target * vib
        seg = nf0[c0:c1]
        seg[seg > 0] = target[seg > 0]
        # fill small unvoiced gaps inside the vowel for a legato line
        seg[seg == 0] = target[seg == 0] * (nap[c0:c1][seg == 0].mean(axis=1) < 0.5)
        nf0[c0:c1] = seg
    nsp = _warp_formant(nsp, formant)
    x = pw.synthesize(nf0, np.ascontiguousarray(nsp), np.ascontiguousarray(nap), TTS_SR, FP)
    y = _upsample(x)
    y = (y / (np.abs(y).max() + 1e-9) * 0.8).astype(np.float32)
    n = int(total * SR)
    if len(y) > n:
        y = y[:n]
    r = min(len(y), int(0.02 * SR))
    if r:
        y[-r:] *= np.linspace(1, 0, r)
    sf.write(path, y, SR)
    return y
