"""Procedural audio: instruments, drums, train effects and animal voices.

Everything is synthesised from scratch with numpy/scipy so the soundtrack is
100% original and needs no sample libraries.  All functions return mono
float32 arrays at config.SR.
"""
import numpy as np
from scipy import signal

from .config import SR

RNG = np.random.default_rng(7)


# --------------------------------------------------------------------------- basics
def t_axis(dur):
    return np.arange(int(round(dur * SR))) / SR


def midi_hz(m):
    return 440.0 * 2 ** ((np.asarray(m, dtype=float) - 69) / 12)


def adsr(n, a=0.01, d=0.1, s=0.7, r=0.1):
    """Linear ADSR envelope of n samples (release is inside n)."""
    env = np.full(n, s, dtype=np.float32)
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n)
    env[:na] = np.linspace(0, 1, na, endpoint=False)
    nd = min(nd, max(0, n - na))
    env[na:na + nd] = np.linspace(1, s, nd, endpoint=False)
    nr = min(nr, n)
    if nr:
        env[n - nr:] *= np.linspace(1, 0, nr)
    return env


def fade(x, fin=0.005, fout=0.02):
    x = x.copy()
    a, b = min(len(x), int(fin * SR)), min(len(x), int(fout * SR))
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)
    return x


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) if len(x) else 0
    return (x / m * peak).astype(np.float32) if m > 0 else x.astype(np.float32)


def lowpass(x, fc, order=2):
    b, a = signal.butter(order, min(fc, SR * 0.45) / (SR / 2), "low")
    return signal.lfilter(b, a, x)


def highpass(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), "high")
    return signal.lfilter(b, a, x)


def bandpass(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), min(hi, SR * 0.45) / (SR / 2)], "band")
    return signal.lfilter(b, a, x)


def phase_from_freq(f):
    return 2 * np.pi * np.cumsum(f) / SR


def contour(points, n):
    """Piecewise-linear contour through (time_fraction, value) points."""
    xs = np.array([p[0] for p in points]) * (n - 1)
    ys = np.array([p[1] for p in points], dtype=float)
    return np.interp(np.arange(n), xs, ys)


def noise(n):
    return RNG.standard_normal(n).astype(np.float32)


# ---------------------------------------------------------------- source / filter
def glottal(f0, bright=0.6, jitter=0.0, shimmer=0.0):
    """Band-limited-ish glottal source following an f0 contour (array, Hz)."""
    n = len(f0)
    f = f0 * (1 + jitter * lowpass(noise(n), 40) * 3)
    ph = phase_from_freq(f)
    out = np.zeros(n)
    nyq = SR / 2
    for k in range(1, 40):
        amp = 1.0 / k ** (2.2 - 1.4 * bright)
        mask = (f * k) < nyq * 0.9
        out += amp * np.sin(k * ph) * mask
    if shimmer:
        out *= 1 + shimmer * lowpass(noise(n), 60) * 3
    return out


def resonator(x, freq, bw):
    """Time-varying 2-pole resonator; freq/bw may be arrays (processed in blocks)."""
    freq = np.broadcast_to(np.asarray(freq, float), x.shape)
    bw = np.broadcast_to(np.asarray(bw, float), x.shape)
    y = np.zeros_like(x)
    blk = 256
    zi = np.zeros(2)
    for i in range(0, len(x), blk):
        fc, b = freq[i], bw[i]
        r = np.exp(-np.pi * b / SR)
        th = 2 * np.pi * fc / SR
        a = [1, -2 * r * np.cos(th), r * r]
        g = (1 - r) * np.sqrt(1 - 2 * r * np.cos(2 * th) + r * r)
        seg, zi = signal.lfilter([g], a, x[i:i + blk], zi=zi)
        y[i:i + blk] = seg
    return y


def formants(src, fs, bws, gains=None):
    gains = gains or [1.0] * len(fs)
    return sum(g * resonator(src, f, b) for f, b, g in zip(fs, bws, gains))


def voice(dur, f0pts, f1pts, f2pts, f3=2600, bright=0.6, breath=0.15, jitter=0.01,
          shimmer=0.05, amp=None, trem=(0, 0), vib=(0, 0), nasal=0.0):
    """Generic animal/vocal sound: glottal source + moving formants."""
    n = int(dur * SR)
    f0 = contour(f0pts, n)
    t = np.arange(n) / SR
    if vib[1]:
        f0 = f0 * (1 + vib[1] * np.sin(2 * np.pi * vib[0] * t))
    src = glottal(f0, bright, jitter, shimmer)
    src += breath * highpass(noise(n), 800) * 0.6
    F1, F2 = contour(f1pts, n), contour(f2pts, n)
    y = formants(src, [F1, F2, np.full(n, f3)], [F1 * 0.15 + 60, F2 * 0.1 + 80, 200],
                 [1.0, 0.7, 0.3])
    if nasal:
        y += nasal * resonator(src, 260, 60)
    env = contour(amp, n) if amp else adsr(n, 0.03, 0.1, 0.8, 0.12)
    if trem[1]:
        env = env * (1 - trem[1] * (0.5 + 0.5 * np.sin(2 * np.pi * trem[0] * t)))
    return norm(fade(y * env))


def concat(parts, gaps=None):
    out = []
    for i, p in enumerate(parts):
        out.append(p)
        if gaps:
            out.append(np.zeros(int(gaps[min(i, len(gaps) - 1)] * SR), np.float32))
    return np.concatenate(out).astype(np.float32)


def silence(d):
    return np.zeros(int(d * SR), np.float32)


# --------------------------------------------------------------------- animals
def elephant(baby=False):
    def blast(d, lo, hi):
        n = int(d * SR)
        f0 = contour([(0, lo), (0.25, hi), (0.8, hi * 1.04), (1, hi * 0.9)], n)
        t = np.arange(n) / SR
        f0 *= 1 + 0.02 * np.sin(2 * np.pi * 9 * t)
        src = glottal(f0, bright=0.95, jitter=0.02, shimmer=0.1)
        src = np.tanh(src * 2.5)
        src += 0.35 * bandpass(noise(n), 1500, 6000)
        y = formants(src, [np.full(n, 900), np.full(n, 1900), np.full(n, 3200)],
                     [250, 350, 500], [1, 0.9, 0.5])
        env = contour([(0, 0), (0.08, 1), (0.85, 0.9), (1, 0)], n)
        return y * env
    if baby:
        return norm(concat([blast(0.45, 520, 820), blast(0.6, 560, 880)], [0.12]))
    return norm(concat([blast(0.4, 300, 470), blast(1.15, 320, 520)], [0.1]))


def horse():
    n = int(1.7 * SR)
    t = np.arange(n) / SR
    f0 = contour([(0, 650), (0.12, 1050), (0.45, 820), (0.75, 520), (1, 300)], n)
    f0 *= 1 + 0.07 * np.sin(2 * np.pi * contour([(0, 9), (1, 16)], n) * t)
    src = glottal(f0, 0.8, 0.02, 0.2)
    src += 0.4 * highpass(noise(n), 1500)
    F1 = contour([(0, 500), (0.4, 750), (1, 600)], n)
    y = formants(src, [F1, np.full(n, 1700), np.full(n, 2900)], [120, 200, 300])
    env = contour([(0, 0), (0.05, 1), (0.6, 0.85), (1, 0)], n)
    env *= 1 - 0.45 * (0.5 + 0.5 * np.sin(2 * np.pi * 14 * t)) * contour([(0, 0), (0.3, 1), (1, 1)], n)
    snort = bandpass(noise(int(0.35 * SR)), 300, 2500) * adsr(int(0.35 * SR), 0.01, 0.1, 0.4, 0.2)
    return norm(concat([y * env, snort * 0.4], [0.05]))


def mouse():
    parts = []
    for i in range(3):
        n = int(0.16 * SR)
        f = contour([(0, 5200), (0.4, 6800), (1, 5600)], n)
        t = np.arange(n) / SR
        f *= 1 + 0.03 * np.sin(2 * np.pi * 45 * t)
        parts.append(np.sin(phase_from_freq(f)) * adsr(n, 0.01, 0.05, 0.7, 0.05))
    return norm(concat(parts, [0.09]))


def zebra(baby=False):
    k = 1.5 if baby else 1.0
    parts = []
    for i in range(4 if not baby else 3):
        inh = voice(0.22, [(0, 900 * k), (1, 1150 * k)], [(0, 350), (1, 400)],
                    [(0, 2200), (1, 2400)], bright=0.8, breath=0.5, jitter=0.03)
        exh = voice(0.28, [(0, 520 * k), (0.4, 600 * k), (1, 380 * k)], [(0, 750), (1, 650)],
                    [(0, 1250), (1, 1100)], bright=0.9, breath=0.3, jitter=0.04, shimmer=0.2)
        parts += [inh * 0.6, exh]
    return norm(concat(parts, [0.02, 0.07]))


def goat():
    parts = []
    for d in (0.75, 0.95):
        parts.append(voice(d, [(0, 520), (0.2, 600), (1, 470)], [(0, 300), (0.25, 820), (1, 760)],
                           [(0, 1500), (0.25, 1350), (1, 1300)], bright=0.8, breath=0.2,
                           jitter=0.03, trem=(11, 0.7), vib=(11, 0.06), nasal=0.6))
    return norm(concat(parts, [0.18]))


def sheep():
    parts = []
    for d in (0.85, 1.0):
        parts.append(voice(d, [(0, 300), (0.15, 330), (1, 280)], [(0, 300), (0.15, 750), (1, 720)],
                           [(0, 900), (0.15, 1150), (1, 1100)], bright=0.6, breath=0.15,
                           jitter=0.02, trem=(7, 0.55), vib=(7, 0.04)))
    return norm(concat(parts, [0.2]))


def monkey():
    parts = []
    seq = [("oo", 520, 760), ("oo", 560, 820), ("oo", 600, 880), ("ah", 820, 1200), ("ah", 860, 1300),
           ("ah", 900, 1350)]
    for v, lo, hi in seq:
        f1, f2 = ((330, 330), (800, 900)) if v == "oo" else ((650, 900), (1250, 1500))
        parts.append(voice(0.2 if v == "oo" else 0.24, [(0, lo), (0.5, hi), (1, lo * 1.1)],
                           [(0, f1[0]), (1, f1[1])], [(0, f2[0]), (1, f2[1])], bright=0.85,
                           breath=0.25, jitter=0.03))
    return norm(concat(parts, [0.04]))


def bird():
    parts = []
    for i in range(5):
        n = int(0.11 * SR)
        f = contour([(0, 3200), (0.5, 5200 + 300 * (i % 2)), (1, 3800)], n)
        t = np.arange(n) / SR
        f *= 1 + 0.05 * np.sin(2 * np.pi * 70 * t)
        parts.append(np.sin(phase_from_freq(f)) * adsr(n, 0.005, 0.03, 0.6, 0.04))
    trill_n = int(0.45 * SR)
    t = np.arange(trill_n) / SR
    f = 4300 + 900 * np.sin(2 * np.pi * 28 * t)
    trill = np.sin(phase_from_freq(f)) * adsr(trill_n, 0.01, 0.1, 0.7, 0.1)
    return norm(concat(parts + [trill], [0.05, 0.05, 0.12, 0.05, 0.12]))


def big_cat(base=95, length=1.8, rasp=0.8, bright=0.7):
    n = int(length * SR)
    t = np.arange(n) / SR
    f0 = contour([(0, base * 1.2), (0.2, base * 1.6), (0.6, base * 1.3), (1, base * 0.8)], n)
    src = glottal(f0, bright, 0.06, 0.4)
    src = src * (1 + 0.6 * np.sin(2 * np.pi * 28 * t))                   # growl flutter
    src += 0.25 * glottal(f0 / 2, 0.5)                                   # sub-harmonic
    src = np.tanh(src * 2)
    src += rasp * lowpass(noise(n), 3000)
    F1 = contour([(0, 380), (0.25, 700), (1, 520)], n)
    F2 = contour([(0, 800), (0.25, 1100), (1, 900)], n)
    y = formants(src, [F1, F2, np.full(n, 2400)], [150, 200, 300], [1, 0.8, 0.25])
    env = contour([(0, 0), (0.15, 0.8), (0.3, 1), (0.8, 0.7), (1, 0)], n)
    return norm(y * env)


def tiger():
    return big_cat(110, 1.6, 0.9, 0.75)


def lion(kind="male"):
    if kind == "cub":
        a = voice(0.5, [(0, 420), (0.3, 520), (1, 360)], [(0, 400), (0.4, 800), (1, 700)],
                  [(0, 1300), (1, 1100)], bright=0.7, breath=0.35, jitter=0.05, shimmer=0.3)
        b = voice(0.65, [(0, 450), (0.3, 560), (1, 340)], [(0, 400), (0.4, 820), (1, 650)],
                  [(0, 1300), (1, 1000)], bright=0.75, breath=0.45, jitter=0.06, shimmer=0.3)
        return norm(concat([a, b], [0.15]))
    if kind == "female":
        return big_cat(120, 1.7, 0.75, 0.75)
    return big_cat(85, 2.1, 0.9, 0.7)


def dog():
    parts = []
    for i in range(2):
        parts.append(voice(0.17, [(0, 480), (0.3, 560), (1, 380)], [(0, 450), (0.3, 750), (1, 550)],
                           [(0, 1000), (0.3, 1450), (1, 1100)], bright=0.85, breath=0.35,
                           jitter=0.04, shimmer=0.3,
                           amp=[(0, 0), (0.08, 1), (0.6, 0.6), (1, 0)]))
    return norm(concat(parts * 2, [0.16, 0.38, 0.16]))


def donkey():
    parts = []
    for i in range(3):
        hee = voice(0.42, [(0, 820), (0.5, 980), (1, 900)], [(0, 300), (1, 320)], [(0, 2200), (1, 2300)],
                    bright=0.95, breath=0.45, jitter=0.04, shimmer=0.2)
        haw = voice(0.55, [(0, 300), (0.3, 340), (1, 230)], [(0, 700), (1, 620)], [(0, 1000), (1, 900)],
                    bright=0.9, breath=0.3, jitter=0.05, shimmer=0.35)
        parts += [hee * 0.75, haw]
    return norm(concat(parts, [0.04, 0.08]))


def seal():
    parts = []
    for i in range(3):
        parts.append(voice(0.28, [(0, 330), (0.3, 400), (1, 260)], [(0, 500), (0.35, 800), (1, 600)],
                           [(0, 900), (0.35, 1200), (1, 950)], bright=0.9, breath=0.55, jitter=0.07,
                           shimmer=0.4, amp=[(0, 0), (0.12, 1), (0.6, 0.7), (1, 0)]))
    return norm(concat(parts, [0.17]))


def seagull():
    parts = []
    long = voice(0.6, [(0, 1500), (0.25, 1900), (1, 1100)], [(0, 400), (0.3, 700), (1, 600)],
                 [(0, 2500), (0.3, 1600), (1, 1300)], bright=0.95, breath=0.2, jitter=0.03, nasal=0.4)
    parts.append(long)
    for i in range(4):
        parts.append(voice(0.15, [(0, 1600), (1, 1350)], [(0, 650), (1, 600)], [(0, 1500), (1, 1400)],
                           bright=0.95, breath=0.25, jitter=0.03, nasal=0.4) * 0.85)
    return norm(concat(parts, [0.12, 0.06]))


def penguin(baby=False):
    if baby:
        parts = []
        for i in range(4):
            n = int(0.13 * SR)
            f = contour([(0, 2400), (0.5, 3100), (1, 2600)], n)
            parts.append(np.sin(phase_from_freq(f)) * adsr(n, 0.01, 0.03, 0.7, 0.05)
                         + 0.3 * np.sin(2 * phase_from_freq(f)) * adsr(n, 0.01, 0.03, 0.5, 0.05))
        return norm(concat(parts, [0.1]))
    parts = []
    for i in range(3):
        parts.append(voice(0.2, [(0, 520), (1, 560)], [(0, 600), (1, 650)], [(0, 1100), (1, 1150)],
                           bright=0.85, breath=0.3, jitter=0.04, shimmer=0.2) * 0.7)
    parts.append(voice(0.95, [(0, 480), (0.3, 620), (1, 450)], [(0, 650), (0.5, 760), (1, 600)],
                       [(0, 1100), (1, 1000)], bright=0.9, breath=0.3, jitter=0.05, shimmer=0.3,
                       trem=(9, 0.3)))
    return norm(concat(parts, [0.1]))


def panda(baby=False):
    if baby:
        parts = [voice(0.28, [(0, 900), (0.4, 1150), (1, 950)], [(0, 380), (1, 420)], [(0, 2300), (1, 2200)],
                       bright=0.7, breath=0.2, jitter=0.02) for _ in range(3)]
        return norm(concat(parts, [0.1]))
    parts = []
    for d in (0.55, 0.7):
        parts.append(voice(d, [(0, 380), (0.3, 430), (1, 360)], [(0, 280), (0.3, 620), (1, 560)],
                           [(0, 1000), (0.3, 1200), (1, 1100)], bright=0.55, breath=0.2, jitter=0.02,
                           trem=(5, 0.25), nasal=0.9))
    huff = bandpass(noise(int(0.25 * SR)), 200, 1800) * adsr(int(0.25 * SR), 0.02, 0.1, 0.4, 0.1)
    return norm(concat(parts + [huff * 0.5], [0.15, 0.1]))


def giraffe(baby=False):
    base = 150 if baby else 92
    n = int((1.2 if baby else 2.0) * SR)
    t = np.arange(n) / SR
    f0 = base * (1 + 0.04 * np.sin(2 * np.pi * 0.9 * t) + 0.012 * np.sin(2 * np.pi * 5 * t))
    src = glottal(f0, 0.35, 0.01, 0.05)
    y = resonator(src, 260, 60) + 0.4 * resonator(src, 900, 150) + 0.15 * resonator(src, 2200, 300)
    env = contour([(0, 0), (0.2, 1), (0.45, 0.75), (0.5, 0.95), (0.85, 0.85), (1, 0)], n)
    return norm(y * env)


ANIMAL_SFX = {
    "elephant": lambda: elephant(False), "baby_elephant": lambda: elephant(True),
    "horse": horse, "mouse": mouse,
    "zebra": lambda: zebra(False), "baby_zebra": lambda: zebra(True),
    "goat": goat, "monkey": monkey,
    "panda": lambda: panda(False), "baby_panda": lambda: panda(True),
    "bird": bird, "tiger": tiger,
    "giraffe": lambda: giraffe(False), "baby_giraffe": lambda: giraffe(True),
    "sheep": sheep, "lion_male": lambda: lion("male"),
    "lion": lambda: lion("female"), "baby_lion": lambda: lion("cub"),
    "dog": dog, "donkey": donkey,
    "penguin": lambda: penguin(False), "baby_penguin": lambda: penguin(True),
    "seal": seal, "seagull": seagull,
}


# ------------------------------------------------------------------ train / foley
def whistle(dur=0.9, toots=2):
    parts = []
    for i in range(toots):
        d = dur if i == toots - 1 else dur * 0.45
        n = int(d * SR)
        t = np.arange(n) / SR
        y = np.zeros(n)
        for f in (587.3, 740.0, 880.0):     # D major chord, like a steam whistle
            fm = f * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * t))
            y += np.sin(phase_from_freq(fm)) + 0.25 * np.sin(2 * phase_from_freq(fm))
        y += 0.6 * bandpass(noise(n), 600, 4000)
        env = contour([(0, 0), (0.06, 1), (0.85, 0.9), (1, 0)], n)
        parts.append(y * env)
    return norm(concat(parts, [0.1]), 0.8)


def chuff(intensity=1.0):
    n = int(0.16 * SR)
    y = bandpass(noise(n), 250, 2200) * adsr(n, 0.004, 0.05, 0.25, 0.08)
    return (y * intensity).astype(np.float32)


def chug_loop(dur, bpm=120, intensity=0.5):
    """Steady chuff-chuff on eighth notes (accent on beats)."""
    out = np.zeros(int(dur * SR), np.float32)
    step = 60 / bpm / 2
    i = 0
    c = norm(chuff(), 1.0)
    while i * step < dur:
        s = int(i * step * SR)
        seg = c * (1.0 if i % 2 == 0 else 0.55) * intensity
        e = min(len(out), s + len(seg))
        out[s:e] += seg[:e - s]
        i += 1
    clack_n = int(0.05 * SR)
    clack = highpass(noise(clack_n), 2000) * adsr(clack_n, 0.001, 0.02, 0.2, 0.02)
    j = 0
    while j * step * 4 < dur:
        for off in (0, 0.12):
            s = int((j * step * 4 + off) * SR)
            e = min(len(out), s + clack_n)
            if s < len(out):
                out[s:e] += (clack[:e - s] * 0.25 * intensity).astype(np.float32)
        j += 1
    return out


def bell_ding():
    n = int(1.2 * SR)
    t = np.arange(n) / SR
    y = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, a, d in
            [(1320, 1, 3), (3180, 0.5, 5), (5100, 0.25, 8), (1980, 0.3, 4)])
    return norm(y, 0.6)


def steam_hiss(dur=1.2):
    n = int(dur * SR)
    return norm(highpass(noise(n), 3000) * contour([(0, 0), (0.1, 1), (0.6, 0.5), (1, 0)], n), 0.35)


def pop():
    n = int(0.15 * SR)
    f = contour([(0, 300), (1, 1300)], n)
    return norm(np.sin(phase_from_freq(f)) * adsr(n, 0.002, 0.04, 0.3, 0.06), 0.6)


def boing():
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 220 * (1 + 0.6 * np.exp(-t * 6) * np.sin(2 * np.pi * 14 * t)) * contour([(0, 1), (1, 1.6)], n)
    return norm(np.sin(phase_from_freq(f)) * np.exp(-t * 5), 0.5)


def sparkle():
    out = silence(1.3)
    for i, m in enumerate([84, 88, 91, 96, 100, 103]):
        n = int(0.6 * SR)
        t = np.arange(n) / SR
        y = np.sin(2 * np.pi * midi_hz(m) * t) * np.exp(-t * 7)
        s = int(i * 0.07 * SR)
        out[s:s + n] += y * 0.5
    return norm(out, 0.45)


def whoosh(dur=1.0):
    n = int(dur * SR)
    x = noise(n)
    fc = contour([(0, 300), (0.6, 3500), (1, 600)], n)
    y = resonator(x, fc, fc * 0.6)
    return norm(y * contour([(0, 0), (0.55, 1), (1, 0)], n), 0.5)


def clap():
    n = int(0.12 * SR)
    y = np.zeros(n)
    for off in (0, 0.01, 0.02):
        s = int(off * SR)
        m = n - s
        y[s:] += bandpass(noise(m), 900, 5000) * np.exp(-np.arange(m) / SR * 40)
    return norm(y, 0.6)


def heart_pop():
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * 784 * t) * np.exp(-t * 8) + 0.6 * np.sin(2 * np.pi * 1175 * t) * np.exp(-t * 9)
    return norm(y, 0.45)


def tick():
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    return norm(np.sin(2 * np.pi * 2000 * t) * np.exp(-t * 80), 0.25)


def thinking_twinkle(dur=2.0):
    """Very soft music-box arpeggio that fills the answer pause without speech."""
    out = silence(dur)
    notes = [79, 83, 86, 83, 79, 83, 86, 91]
    step = dur / len(notes)
    for i, m in enumerate(notes):
        n = int(0.5 * SR)
        t = np.arange(n) / SR
        y = np.sin(2 * np.pi * midi_hz(m) * t) * np.exp(-t * 6)
        s = int(i * step * SR)
        e = min(len(out), s + n)
        out[s:e] += y[:e - s]
    return norm(out, 0.22)


def birdsong_ambience(dur, density=0.4, seed=1):
    rng = np.random.default_rng(seed)
    out = silence(dur)
    tt = rng.uniform(0, 2)
    while tt < dur - 0.5:
        n = int(rng.uniform(0.06, 0.12) * SR)
        base = rng.uniform(2800, 4500)
        f = contour([(0, base), (0.5, base * rng.uniform(1.1, 1.4)), (1, base * 0.95)], n)
        y = np.sin(phase_from_freq(f)) * adsr(n, 0.005, 0.02, 0.6, 0.03)
        s = int(tt * SR)
        out[s:s + n] += y * rng.uniform(0.3, 0.6)
        tt += rng.exponential(1 / density) if rng.random() < 0.6 else rng.uniform(0.1, 0.2)
    return lowpass(out, 7000).astype(np.float32) * 0.5


def wind(dur, level=0.15):
    n = int(dur * SR)
    x = lowpass(noise(n), 600) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.1 * np.arange(n) / SR))
    return norm(x, level)


FOLEY = {
    "whistle": lambda: whistle(0.9, 2), "whistle_long": lambda: whistle(1.4, 1),
    "whistle3": lambda: whistle(0.8, 3), "bell": bell_ding, "hiss": steam_hiss,
    "pop": pop, "boing": boing, "sparkle": sparkle, "whoosh": whoosh, "clap": clap,
    "heart": heart_pop, "tick": tick, "think": thinking_twinkle,
}


# ---------------------------------------------------------------- instruments
def ks_pluck(freq, dur, bright=0.5, decay=0.996):
    """Karplus-Strong plucked string via lfilter (fast, vectorised)."""
    n = int(dur * SR)
    p = max(2, int(round(SR / freq)))
    exc = np.zeros(n)
    burst = RNG.uniform(-1, 1, p)
    burst = lowpass(burst, 1500 + 6000 * bright)
    exc[:p] = burst
    a = np.zeros(p + 2)
    a[0] = 1
    a[p] = -decay * 0.5
    a[p + 1] = -decay * 0.5
    y = signal.lfilter([1.0], a, exc)
    return fade(y, 0.001, 0.05)


def marimba(freq, dur):
    n = int(max(dur, 0.6) * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * freq * t) * np.exp(-t * 4) + 0.35 * np.sin(2 * np.pi * freq * 4 * t) * np.exp(-t * 14)
    return fade(y * 0.9, 0.002, 0.03)


def glock(freq, dur):
    n = int(max(dur, 0.9) * SR)
    t = np.arange(n) / SR
    y = (np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t * 6)
         + 0.2 * np.sin(2 * np.pi * freq * 5.4 * t) * np.exp(-t * 12)) * np.exp(-t * 3)
    return fade(y * 0.6, 0.001, 0.05)


def epiano(freq, dur):
    n = int((dur + 0.3) * SR)
    t = np.arange(n) / SR
    mod = np.sin(2 * np.pi * freq * t) * 1.2 * np.exp(-t * 3)
    y = np.sin(2 * np.pi * freq * t + mod) * np.exp(-t * 1.5)
    env = np.ones(n)
    r = int(0.3 * SR)
    env[-r:] = np.linspace(1, 0, r)
    return fade(y * env * 0.7, 0.003, 0.02)


def bass(freq, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * freq * t
    y = np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    return fade(y * adsr(n, 0.005, 0.15, 0.6, 0.06) * 0.9, 0.002, 0.02)


def tuba(freq, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    src = glottal(np.full(n, freq), 0.55)
    y = lowpass(src, 900) * adsr(n, 0.03, 0.1, 0.8, 0.08)
    return norm(y, 0.9)


def flute(freq, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5 * t) * np.clip(t * 3, 0, 1)
    ph = phase_from_freq(freq * vib)
    y = np.sin(ph) + 0.12 * np.sin(2 * ph) + 0.05 * bandpass(noise(n), freq, freq * 3)
    return fade(y * adsr(n, 0.05, 0.1, 0.85, 0.08) * 0.6)


def pad(freqs, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for f in freqs:
        for det in (-0.004, 0.004):
            y += signal.sawtooth(2 * np.pi * f * (1 + det) * t) * 0.3
    y = lowpass(y, 1400)
    return fade(y * adsr(n, 0.4, 0.3, 0.8, 0.5) * 0.25, 0.05, 0.3)


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 50 + 120 * np.exp(-t * 30)
    return norm(np.sin(phase_from_freq(f)) * np.exp(-t * 9), 0.9)


def snare():
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    y = 0.6 * bandpass(noise(n), 1500, 8000) * np.exp(-t * 18) + 0.5 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25)
    return norm(y, 0.6)


def hat(open_=False):
    n = int((0.25 if open_ else 0.06) * SR)
    t = np.arange(n) / SR
    return norm(highpass(noise(n), 7000) * np.exp(-t * (12 if open_ else 60)), 0.25)


def shaker():
    n = int(0.09 * SR)
    return norm(bandpass(noise(n), 4000, 10000) * contour([(0, 0), (0.3, 1), (1, 0)], n), 0.18)


def woodblock(hi=True):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    f = 1250 if hi else 900
    return norm(np.sin(2 * np.pi * f * t) * np.exp(-t * 45), 0.35)


INSTRUMENTS = {
    "pluck": lambda f, d: ks_pluck(f, d + 0.4, 0.5, 0.995),
    "uke": lambda f, d: ks_pluck(f, d + 0.3, 0.35, 0.993),
    "marimba": marimba, "glock": glock, "epiano": epiano, "bass": bass,
    "tuba": tuba, "flute": flute,
}
DRUMS = {"k": kick, "s": snare, "h": hat, "o": lambda: hat(True), "x": shaker,
         "c": clap, "w": woodblock, "b": lambda: woodblock(False)}
