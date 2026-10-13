"""Tiny sequencer + every original composition in the video.

A `Track` is a mono buffer at a fixed tempo.  Compositions add chords, bass,
drums, melody instruments and sung vocals.  Every song returns
(music_audio, vocal_events, lyric_lines) so the story builder can place the
vocals on the voice bus (for ducking / lip-sync) and write subtitles.
"""
from functools import lru_cache

import numpy as np

from . import synth, tts
from .config import SR

CHORDS = {
    "C": [60, 64, 67], "Dm": [62, 65, 69], "Em": [64, 67, 71], "F": [65, 69, 72],
    "G": [67, 71, 74], "G7": [67, 71, 74, 77], "Am": [69, 72, 76], "E": [64, 68, 71],
    "Bb": [70, 74, 77], "D": [62, 66, 69], "A7": [69, 73, 76, 79], "C7": [60, 64, 67, 70],
}
ROOT = {k: v[0] for k, v in CHORDS.items()}
SCALE = [0, 2, 4, 5, 7, 9, 11]


@lru_cache(maxsize=4096)
def _note(inst, midi, dur):
    return synth.INSTRUMENTS[inst](float(synth.midi_hz(midi)), dur).astype(np.float32)


@lru_cache(maxsize=64)
def _drum(name):
    return synth.DRUMS[name]().astype(np.float32)


class Track:
    def __init__(self, bpm, bars=None, seconds=None, beats_per_bar=4):
        self.bpm, self.bpb = bpm, beats_per_bar
        self.spb = 60.0 / bpm
        dur = seconds if seconds is not None else bars * beats_per_bar * self.spb
        self.dur = dur
        self.buf = np.zeros(int(dur * SR) + SR * 2, np.float32)
        self.vocals = []      # dicts: start, audio, who, word
        self.lyrics = []      # dicts: start, end, text, who

    def t(self, beat):
        return beat * self.spb

    def add(self, audio, sec, gain=1.0):
        s = int(sec * SR)
        if s >= len(self.buf) or s < 0:
            return
        e = min(len(self.buf), s + len(audio))
        self.buf[s:e] += audio[:e - s] * gain

    def note(self, inst, midi, beat, beats, gain=1.0):
        self.add(_note(inst, int(midi), round(beats * self.spb, 3)), self.t(beat), gain)

    def drum(self, name, beat, gain=1.0):
        self.add(_drum(name), self.t(beat), gain)

    # ----------------------------------------------------------- arrangement
    def chords(self, prog, start_bar=0, style="bounce", gain=1.0, transpose=0):
        """prog: list of chord names, one per bar."""
        for i, ch in enumerate(prog):
            b0 = (start_bar + i) * self.bpb
            notes = [n + transpose for n in CHORDS[ch]]
            root = ROOT[ch] + transpose - 24
            if style == "bounce":
                for k in range(self.bpb):
                    self.note("bass", root + (7 if k % 2 else 0), b0 + k, 0.9, 0.55 * gain)
                for k in (1, 3):
                    for j, n in enumerate(notes[:3]):
                        self.note("uke", n, b0 + k + j * 0.02, 0.8, 0.22 * gain)
                for k in (0, 2):
                    self.note("uke", notes[0] - 12, b0 + k, 0.4, 0.12 * gain)
            elif style == "dance":
                for k in range(self.bpb * 2):
                    self.note("bass", root + (12 if k % 2 else 0), b0 + k * 0.5, 0.45, 0.5 * gain)
                for k in range(self.bpb):
                    for j, n in enumerate(notes[:3]):
                        self.note("pluck", n, b0 + k + 0.5 + j * 0.015, 0.4, 0.14 * gain)
            elif style == "bed":
                arp = notes[:3] + [notes[0] + 12]
                for k in range(self.bpb * 2):
                    self.note("marimba", arp[k % 4], b0 + k * 0.5, 0.5, 0.18 * gain)
                self.note("bass", root, b0, self.bpb * 0.9, 0.3 * gain)
            elif style == "travel":
                for k in range(self.bpb):
                    self.note("tuba", root + (7 if k % 2 else 0), b0 + k, 0.7, 0.35 * gain)
                for k in range(self.bpb):
                    for j, n in enumerate(notes[:3]):
                        self.note("uke", n, b0 + k + 0.5 + j * 0.02, 0.4, 0.16 * gain)
            elif style == "lullaby":
                arp = [notes[0], notes[1], notes[2], notes[1] + 12, notes[2], notes[1]]
                for k in range(6):
                    self.note("glock", arp[k] + 12, b0 + k * self.bpb / 6, 1.0, 0.1 * gain)
                self.add(synth.pad([synth.midi_hz(n) for n in notes], self.bpb * self.spb * 1.05),
                         self.t(b0), 0.5 * gain)
                self.note("bass", root + 12, b0, self.bpb * 0.95, 0.2 * gain)
            elif style == "sad":
                for k in range(self.bpb):
                    self.note("epiano", notes[k % 3], b0 + k, 1.2, 0.18 * gain)
                self.note("bass", root, b0, self.bpb * 0.9, 0.25 * gain)
            elif style == "pad":
                self.add(synth.pad([synth.midi_hz(n) for n in notes], self.bpb * self.spb * 1.05),
                         self.t(b0), 0.6 * gain)

    def drums(self, pattern, start_bar, bars, gain=1.0):
        """pattern: string of 8th-note steps per bar, e.g. 'k.h.s.h.' (spaces ignored).
        Multiple voices may be stacked with '|' e.g. 'k...k...|..s...s.|xxxxxxxx'."""
        layers = pattern.split("|")
        for bar in range(bars):
            for layer in layers:
                steps = layer.replace(" ", "")
                for i, ch in enumerate(steps):
                    if ch != ".":
                        self.drum(ch, (start_bar + bar) * self.bpb + i * self.bpb / len(steps), gain)

    def melody(self, inst, tokens, start_beat, gain=0.3, transpose=0, octave=0):
        for midi, beat, beats, _ in tokens:
            if midi:
                self.note(inst, midi + transpose + 12 * octave, start_beat + beat, beats, gain)

    def sing(self, tokens, start_beat, who=("train",), transpose=0, line_text=None, gain=1.0):
        """Render sung words.  tokens: parsed (midi, beat_offset, beats, word_or_None)."""
        words = _group_words(tokens)
        for wi, (word, notes, b0) in enumerate(words):
            for vi, v in enumerate(who):
                notes_s = [(m + transpose, d * self.spb) for m, d in notes]
                audio = tts.sing_word(word, notes_s, v)
                off = 0.012 * vi
                self.vocals.append(dict(start=self.t(start_beat + b0) + off, audio=audio,
                                        who=v, word=word, gain=gain / (1 + 0.35 * (len(who) - 1))))
        if words:
            end_beat = max(b + d for _, b, d, w in tokens if w is not None)
            text = line_text or " ".join(w for w, _, _ in words)
            self.lyrics.append(dict(start=self.t(start_beat + words[0][2]) - 0.15,
                                    end=self.t(start_beat + end_beat) + 0.1, text=text, who=who[0]))

    def mixdown(self, peak=0.8):
        y = self.buf[: int(self.dur * SR)]
        m = np.abs(y).max()
        return (y / m * peak).astype(np.float32) if m > 0 else y


# --------------------------------------------------------------- melody parsing
def parse(spec):
    """'Choo/67/1 choo/67/1 learning/71/1 +/69/1 _/0/1' -> list of (midi, beat, beats, word)
    '+' adds another note to the previous word, '_' is a rest."""
    out, beat = [], 0.0
    for tok in spec.split():
        w, m, d = tok.rsplit("/", 2)
        m, d = int(m), float(d)
        if w == "_":
            out.append((0, beat, d, None))
        elif w == "+":
            out.append((m, beat, d, "+"))
        else:
            out.append((m, beat, d, w))
        beat += d
    return out


def _group_words(tokens):
    words = []
    for m, b, d, w in tokens:
        if w is None:
            continue
        if w == "+" and words:
            words[-1][1].append((m, d))
        else:
            words.append([w, [(m, d)], b])
    return [(w, n, b) for w, n, b in words]


def spec_beats(spec):
    return sum(d for _, _, d, _ in parse(spec))


def auto_line(text, contour, last_chord="C", beats=8, key=60):
    """Generate a singable melody for a lyric line.

    text uses '-' between syllables of one word: 'Num-ber one, the el-e-phants'.
    contour: scale degrees (0=tonic) sampled across the syllables."""
    words = text.replace(",", "").replace("!", "").replace(".", "").replace("?", "").split()
    syl = []                           # (word or '+', display)
    for w in words:
        parts = w.split("-")
        syl.append(parts[0] if len(parts) == 1 else w.replace("-", ""))
        syl += ["+"] * (len(parts) - 1)
    n = len(syl)
    avail = beats - 1                  # last beat is a breath
    m = n - 1
    final = 2.0
    if m > 0:
        body = avail - final
        if m > body * 2:
            final = 1.0
            body = avail - final
        assert m <= body * 2, f"too many syllables: {text}"
        if m <= body:
            durs = [1.0] * m
            extra = body - m
        else:
            # h eighth notes + q quarter notes so that h + q = m and h/2 + q <= body
            h = int(np.ceil(2 * (m - body)))
            q = m - h
            durs = [0.5] * h + [1.0] * q
            # interleave halves in pairs for a bouncy feel
            durs = _interleave(durs)
            extra = body - sum(durs)
        final += extra
    else:
        durs, final = [], avail
    durs.append(final)
    degs = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(contour)), contour)
    notes = []
    for i, dgr in enumerate(degs):
        d = int(round(dgr))
        octv, idx = divmod(d, 7)
        notes.append(key + 12 * octv + SCALE[idx])
    tones = [x % 12 for x in CHORDS[last_chord]]
    while notes[-1] % 12 not in tones:
        notes[-1] -= 1
    spec = []
    for s, mn, d in zip(syl, notes, durs):
        spec.append(f"{s}/{mn}/{d}")
    rest = beats - sum(durs)
    if rest > 0:
        spec.append(f"_/0/{rest}")
    return " ".join(spec)


def _interleave(durs):
    halves = [d for d in durs if d == 0.5]
    quarters = [d for d in durs if d == 1.0]
    out = []
    while halves or quarters:
        if len(halves) >= 2:
            out += [halves.pop(), halves.pop()]
        elif halves:
            out.append(halves.pop())
        if quarters:
            out.append(quarters.pop())
    return out


# ================================================================ compositions
OPENING_VERSE1 = [
    ("Choo choo, here I come!", "Choo/67/1 choo/67/1 here/64/1 I/65/1 come/67/2 _/0/2"),
    ("Rolling down the track for fun!", "Rolling/65/0.5 +/65/0.5 down/64/1 the/62/1 track/64/1 for/65/1 fun/67/2 _/0/1"),
    ("Blue and red and yellow too,", "Blue/69/1 and/69/0.5 red/67/1.5 and/65/0.5 yellow/64/0.5 +/65/1 too/67/2 _/0/1"),
    ("I'm the train that sings with you!", "I'm/65/1 the/64/0.5 train/62/1.5 that/64/0.5 sings/62/0.5 with/59/1 you/60/2 _/0/1"),
]
OPENING_VERSE2 = [
    ("Wheels go round and round and round,", "Wheels/67/1 go/67/1 round/64/1 and/65/0.5 round/67/1.5 and/69/0.5 round/67/1.5 _/0/1"),
    ("Listen to the happy sound!", "listen/65/1 +/65/0.5 to/64/0.5 the/62/1 happy/64/1 +/65/1 sound/67/2 _/0/1"),
    ("Animal friends are waiting there,", "animal/69/0.5 +/69/0.5 +/67/1 friends/65/1 are/64/1 waiting/67/0.5 +/65/0.5 there/64/2 _/0/1"),
    ("Let's go helping everywhere!", "Let's/65/1 go/64/0.5 helping/64/1 +/62/0.5 everywhere/59/1 +/62/1 +/60/2 _/0/1"),
]
CHORUS = [
    ("Choo choo, Learning Train!", "Choo/72/1 choo/72/1 learning/71/1 +/69/1 train/67/3 _/0/1"),
    ("Through the sunshine, through the rain,", "through/69/0.5 the/69/0.5 sunshine/69/1 +/67/1 through/65/0.5 the/65/0.5 rain/64/3 _/0/1"),
    ("Hills and flowers, friends we meet,", "Hills/65/1 and/65/0.5 flowers/67/1 +/69/0.5 friends/67/1 we/65/1 meet/64/2 _/0/1"),
    ("Clap your hands and stamp your feet!", "Clap/67/1 your/67/0.5 hands/67/1.5 and/65/0.5 stamp/64/0.5 your/62/1 feet/60/2 _/0/1"),
]
VERSE_CH = ["C", "C", "F", "G", "F", "C", "G", "C"]
CHORUS_CH = ["C", "G", "F", "C", "F", "C", "G", "C"]

KIDS = ("kid1", "kid2", "kid3")


def _sing_block(tr, lines, start_bar, who, inst="glock", inst_gain=0.12, transpose=0):
    for i, (text, spec) in enumerate(lines):
        toks = parse(spec)
        b = (start_bar + 2 * i) * tr.bpb
        tr.sing(toks, b, who=who, transpose=transpose, line_text=text)
        tr.melody(inst, toks, b, gain=inst_gain, transpose=transpose, octave=1 if inst == "glock" else 0)


def opening_song(bpm=128):
    """Intro(2) V1(8) C(8) V2(8) C(8) tag(2) = 36 bars."""
    tr = Track(bpm, bars=36)
    tr.chords(["C", "G"], 0, "bounce", 0.8)
    tr.drums("w...w...|....b.b.", 0, 2, 0.8)
    tr.chords(VERSE_CH, 2, "bounce")
    tr.chords(CHORUS_CH, 10, "bounce")
    tr.chords(VERSE_CH, 18, "bounce")
    tr.chords(CHORUS_CH, 26, "bounce")
    tr.chords(["G", "C"], 34, "bounce")
    tr.drums("k...s...|..h...h.|xxxxxxxx", 2, 32, 0.7)
    tr.drums("k.c.k.c.", 34, 1, 0.8)
    _sing_block(tr, OPENING_VERSE1, 2, ("train",))
    _sing_block(tr, CHORUS, 10, ("train",) + KIDS)
    _sing_block(tr, OPENING_VERSE2, 18, ("train",))
    _sing_block(tr, CHORUS, 26, ("train",) + KIDS)
    tag = parse("Choo/72/1 choo/72/1 _/0/2")
    tr.sing(tag, 34 * 4, who=("train",) + KIDS, line_text="Choo choo!")
    tr.add(synth.whistle(0.6, 2), tr.t(35 * 4), 0.5)
    return tr


def depart_song(next_name, bpm=128):
    """8 bars of 'Off we go' sung by the train + kids, ends with a whistle."""
    lines = [
        ("Choo choo, off we go!", "Choo/67/1 choo/67/1 off/69/1 we/71/1 go/72/2 _/0/2"),
        ("Down the track, so nice and slow,", "Down/72/1 the/71/0.5 track/69/1.5 so/67/0.5 nice/65/0.5 and/64/1 slow/62/2 _/0/1"),
        ("Over the hills and round the bend,", "over/64/0.5 +/65/0.5 the/67/1 hills/69/1 and/67/1 round/65/1 the/64/1 bend/62/1 _/0/1"),
        ("Off to find another friend!", "Off/67/1 to/67/0.5 find/69/1.5 another/67/0.5 +/65/0.5 +/62/1 friend/60/2 _/0/1"),
    ]
    tr = Track(bpm, bars=9)
    tr.chords(["C", "G", "G", "C", "F", "G", "G", "C", "C"], 0, "travel")
    tr.drums("w.b.w.b.|xxxxxxxx", 0, 8, 0.6)
    _sing_block(tr, lines, 0, ("train",) + KIDS[:2])
    tr.add(synth.whistle(0.7, 2), tr.t(8 * 4), 0.55)
    return tr


def travel_chant(bpm=128):
    """4-bar call while riding to the next bush: 'Where is Mommy?'"""
    lines = [
        ("Where is Mommy? Where is Mommy?", "Where/67/1 is/64/1 Mommy/67/1 +/64/1 Where/67/1 is/64/1 Mommy/67/1 +/64/1"),
        ("Choo choo choo, we'll find her soon!", "Choo/65/1 choo/65/1 choo/65/1 we'll/64/0.5 find/62/0.5 her/64/1 soon/60/2 _/0/1"),
    ]
    tr = Track(bpm, bars=4)
    tr.chords(["C", "C", "G", "C"], 0, "travel")
    tr.drums("w.b.w.b.|xxxxxxxx", 0, 4, 0.6)
    _sing_block(tr, lines, 0, ("train",) + KIDS[:2])
    return tr


DANCE_CALLS = {
    "elephant": ["Swing your trunk!", "Stomp, stomp, stomp!", "Clap your hands!", "Spin around!", "Choo choo!"],
    "zebra": ["Gallop, gallop!", "Shake your stripes!", "Clap your hands!", "Jump up high!", "Choo choo!"],
    "panda": ["Wiggle, wiggle!", "Roll around!", "Clap your hands!", "Big panda hug!", "Choo choo!"],
    "giraffe": ["Stretch up high!", "Sway side to side!", "Clap your hands!", "Spin around!", "Choo choo!"],
    "lion": ["Jungle jump!", "Shake your mane!", "Roar and clap!", "Spin around!", "Choo choo!"],
    "penguin": ["Waddle, waddle!", "Flap your wings!", "Clap your hands!", "Slide, slide, slide!", "Choo choo!"],
}

DANCE_PROGS = {
    "elephant": ["C", "F", "G", "C"], "zebra": ["F", "Bb", "C", "F"], "panda": ["G", "C", "D", "G"],
    "giraffe": ["C", "Am", "F", "G"], "lion": ["Am", "F", "G", "Am"], "penguin": ["D", "G", "A7", "D"],
}


def dance_track(kind, seconds=20.0, bpm=126):
    """Upbeat 20-second dance groove with five spoken dance calls (every 2 bars)."""
    tr = Track(bpm, seconds=seconds)
    bars = int(seconds / (4 * tr.spb))
    prog = (DANCE_PROGS[kind] * 4)[:bars + 1]
    tr.chords(prog, 0, "dance")
    tr.drums("k...k...k...k...|....s.......s...|..h...h...h...h.|....c.......c...", 0, bars, 0.9)
    tr.drums("k.k.s.s.", bars, 1, 0.9)
    top = CHORDS[prog[0]][2] + 12
    for bar in range(0, bars, 2):
        for k, step in enumerate([0, 0.5, 1.5, 2.5, 3]):
            tr.note("marimba", top + (2 if k == 3 else 0), bar * 4 + step, 0.5, 0.2)
    return tr


def recap_song(verses, bpm=120):
    """Intro 2 + Chorus 8 + 6 x (verse 8 + hook 4) + Chorus 8 = 90 bars (180 s @ 120 bpm).

    verses: list of dicts(lines=[4 lyric lines], hook="Elephant says pa-woo!", sfx=..)."""
    tr = Track(bpm, bars=90)
    tr.chords(["C", "G"], 0, "bounce", 0.8)
    tr.add(synth.whistle(0.8, 2), tr.t(0), 0.5)
    tr.chords(CHORUS_CH, 2, "bounce")
    tr.drums("k...s...|..h...h.|xxxxxxxx", 2, 8, 0.7)
    _sing_block(tr, CHORUS, 2, ("train",) + KIDS)
    contours = [[0, 2, 4, 4, 5, 4], [5, 4, 3, 2, 1, 2], [4, 5, 7, 7, 5, 4], [4, 3, 2, 1, 1, 0]]
    chords_v = VERSE_CH
    last_chords = ["C", "G", "C", "C"]
    hooks = []
    bar = 10
    for vi, v in enumerate(verses):
        tr.chords(chords_v, bar, "bounce")
        tr.chords(["F", "G", "G7", "C"], bar + 8, "bounce", 0.9)
        tr.drums("k...s...|..h...h.|xxxxxxxx", bar, 8, 0.7)
        tr.drums("k.......|xxxxxxxx", bar + 8, 4, 0.5)
        lines = [(l.replace("-", ""), auto_line(l, contours[i], last_chords[i])) for i, l in enumerate(v["lines"])]
        _sing_block(tr, lines, bar, ("train",) + KIDS[:2])
        hook_spec = auto_line(v["hook"], [4, 4, 5, 4, 2, 0], "C", beats=6)
        hook_spec += " _/0/2"
        tr.sing(parse(hook_spec), (bar + 8) * 4, who=("train",) + KIDS, line_text=v["hook"].replace("-", ""))
        hooks.append(dict(name=v["sfx"], start=tr.t((bar + 10) * 4), family=v["family"],
                          verse_start=tr.t(bar * 4), verse_end=tr.t((bar + 12) * 4)))
        bar += 12
    tr.chords(CHORUS_CH, bar, "bounce")
    tr.drums("k...s...|..h...h.|xxxxxxxx", bar, 8, 0.75)
    _sing_block(tr, CHORUS, bar, ("train",) + KIDS)
    tr.add(synth.whistle(0.9, 3), tr.t((bar + 7) * 4 + 2), 0.5)
    return tr, hooks


def lullaby(bpm=72):
    """Gentle farewell: 2 bars intro, 4 sung lines (8 bars), 4 bars outro = 14 bars ~ 46.7 s."""
    tr = Track(bpm, bars=14)
    prog = ["C", "Am", "F", "G", "C", "Am", "F", "C", "F", "G", "Em", "Am", "F", "C"]
    tr.chords(prog, 0, "lullaby")
    lines = [
        ("Good night, good night, the sun says bye,", "Good/67/1 night/64/1 good/67/1 night/64/1 the/65/0.5 sun/67/0.5 says/69/0.5 bye/67/1.5 _/0/1"),
        ("Pink and orange in the sky,", "Pink/65/1 and/64/0.5 orange/62/1 +/64/0.5 in/65/1 the/64/1 sky/60/2 _/0/1"),
        ("Wave goodbye to all our friends,", "Wave/64/1 goodbye/65/0.5 +/67/1.5 to/69/1 all/71/1 our/72/1 friends/69/1 _/0/1"),
        ("Choo choo, see you soon again!", "Choo/67/1 choo/67/1 see/65/0.5 you/64/0.5 soon/62/1 again/64/1 +/60/1 _/0/1"),
    ]
    for i, (text, spec) in enumerate(lines):
        toks = parse(spec)
        b = (2 + 2 * i) * 4
        tr.sing(toks, b, who=("train", "kid1"), line_text=text, gain=0.9)
        tr.melody("glock", toks, b, gain=0.06, octave=1)
    return tr


def bed(seconds, style="bed", prog=("C", "Am", "F", "G"), bpm=100, gain=1.0, drums=None):
    tr = Track(bpm, seconds=seconds)
    bars = int(np.ceil(seconds / (4 * tr.spb)))
    tr.chords([prog[i % len(prog)] for i in range(bars)], 0, style, gain)
    if drums:
        tr.drums(drums, 0, bars, 0.5 * gain)
    y = tr.buf[: int(seconds * SR)]
    return synth.fade(y, 0.3, 1.5)


def reveal_sting():
    tr = Track(140, bars=2)
    for i, m in enumerate([72, 76, 79, 84]):
        tr.note("glock", m, i * 0.5, 1.5, 0.5)
        tr.note("marimba", m - 12, i * 0.5, 1.5, 0.4)
    tr.note("uke", 72, 2, 2, 0.4)
    tr.note("uke", 76, 2.02, 2, 0.4)
    tr.note("uke", 79, 2.04, 2, 0.4)
    tr.drum("c", 2, 0.7)
    return tr.buf[: int(tr.t(5) * SR)]


def wrong_sting():
    tr = Track(120, bars=1)
    tr.note("marimba", 67, 0, 0.5, 0.5)
    tr.note("marimba", 64, 0.5, 0.5, 0.5)
    tr.note("marimba", 67, 1, 1, 0.4)
    return tr.buf[: int(tr.t(2.5) * SR)]
