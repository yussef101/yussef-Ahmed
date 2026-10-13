"""The script.  Builds the complete 30:00 timeline.

Output of `build()` is a `Timeline` holding
  * beats      - named story beats per section (drive the 3D director)
  * speech     - who talks when (lip-sync + subtitles)
  * sounds     - animal / foley sounds and which character makes them
  * overlays   - big on-screen words (titles, colours, numbers, names)
  * audio      - every audio clip on its bus, for the mixer
All times are absolute seconds.  Each section is laid out with a cursor and
then re-laid with its flexible travel beats stretched so it fills its window
exactly.
"""
import numpy as np

from . import music, synth, tts
from .config import DANCE_LENGTH, PAUSE_FOR_ANSWER, SECTIONS, SR

KIDS = ("kid1", "kid2", "kid3")

FAMILIES = [
    dict(id="elephant", name="Elephant", station="Flower Meadow", theme="meadow", color="red",
         number=1, ono="Pa-woo", sfx="elephant", baby_sfx="baby_elephant", baby_voice="baby",
         mommy_voice="mommy",
         friends=[dict(id="horse", name="Horse", ono="Neigh", sfx="horse", voice="friend_m"),
                  dict(id="mouse", name="Mouse", ono="Squeak, squeak", sfx="mouse", voice="friend_small")],
         desc="Baby Elephant has big floppy ears and a long trunk."),
    dict(id="zebra", name="Zebra", station="Sunny Savanna", theme="savanna", color="yellow",
         number=2, ono="Kwa-ha", sfx="zebra", baby_sfx="baby_zebra", baby_voice="baby2",
         mommy_voice="mommy2",
         desc="Baby Zebra has black and white stripes.",
         friends=[dict(id="goat", name="Goat", ono="Maa", sfx="goat", voice="friend_f"),
                  dict(id="monkey", name="Monkey", ono="Ooh ooh, aah aah", sfx="monkey", voice="friend_f2")]),
    dict(id="panda", name="Panda", station="Bamboo Forest", theme="bamboo", color="green",
         number=3, ono="Mwaa", sfx="panda", baby_sfx="baby_panda", baby_voice="baby",
         mommy_voice="mommy",
         desc="Baby Panda is black and white and fluffy.",
         friends=[dict(id="bird", name="Bird", ono="Tweet, tweet", sfx="bird", voice="friend_small"),
                  dict(id="tiger", name="Tiger", ono="Grrr, roar", sfx="tiger", voice="friend_big")]),
    dict(id="giraffe", name="Giraffe", station="Sunny Grassland", theme="grassland", color="orange",
         number=4, ono="Hmmm", sfx="giraffe", baby_sfx="baby_giraffe", baby_voice="baby2",
         mommy_voice="mommy2",
         desc="Baby Giraffe has a long, long neck.",
         friends=[dict(id="sheep", name="Sheep", ono="Baa", sfx="sheep", voice="friend_f"),
                  dict(id="lion_male", name="Lion", ono="Roar", sfx="lion_male", voice="friend_big")]),
    dict(id="lion", name="Lion", station="Jungle Junction", theme="jungle", color="purple",
         number=5, ono="Roar", sfx="lion", baby_sfx="baby_lion", baby_voice="baby",
         mommy_voice="mommy",
         desc="Baby Lion has soft, golden fur.",
         friends=[dict(id="dog", name="Dog", ono="Woof, woof", sfx="dog", voice="friend_f2"),
                  dict(id="donkey", name="Donkey", ono="Hee-haw", sfx="donkey", voice="friend_m")]),
    dict(id="penguin", name="Penguin", station="Snowy Village", theme="snow", color="blue",
         number=6, ono="Squawk", sfx="penguin", baby_sfx="baby_penguin", baby_voice="baby2",
         mommy_voice="mommy2",
         desc="Baby Penguin has little flippers and a fluffy coat.",
         friends=[dict(id="seal", name="Seal", ono="Ow, ow, ow", sfx="seal", voice="friend_f"),
                  dict(id="seagull", name="Seagull", ono="Kee-ow", sfx="seagull", voice="friend_f2")]),
]
FAM = {f["id"]: f for f in FAMILIES}

COLOR_HEX = {"red": "E53935", "yellow": "FDD835", "green": "43A047", "orange": "FB8C00",
             "purple": "8E24AA", "blue": "1E88E5", "pink": "EC407A"}

NUMBER_WORDS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"]


def clean(text):
    return text.replace("Pa-woo", "Pawoo").replace("Kwa-ha", "Kwaha")


class Timeline:
    def __init__(self):
        self.beats, self.speech, self.sounds, self.overlays, self.subs = [], [], [], [], []
        self.audio = []          # (bus, start, array, gain)
        self.sections = []
        self.events = []         # misc keyed events for the director
        self.mouth = []          # (who, start, array) -> lip-sync envelopes

    def add_audio(self, bus, start, arr, gain=1.0):
        self.audio.append((bus, float(start), arr, float(gain)))


class Sec:
    """Cursor-based layout of one section."""

    def __init__(self, tl, sid, start, end, flex=0.0):
        self.tl, self.id, self.t0, self.t1 = tl, sid, start, end
        self.cur = start
        self.flex = flex
        self.nflex = 0
        self.beat_open = None

    # --- beats
    def beat(self, name, **data):
        self._close()
        self.beat_open = dict(sec=self.id, name=name, start=round(self.cur, 3), **data)

    def _close(self):
        if self.beat_open:
            self.beat_open["end"] = round(self.cur, 3)
            self.tl.beats.append(self.beat_open)
            self.beat_open = None

    def finish(self):
        self._close()
        return self.cur

    # --- time
    def wait(self, d):
        self.cur += d

    def flexwait(self, base, weight=1.0):
        self.nflex += weight
        self.cur += base + self.flex * weight

    def until(self, abs_t):
        self.cur = max(self.cur, abs_t)

    # --- content
    def say(self, who, text, voice=None, gap=0.3, sub=True, style=None, at=None):
        voice = voice or {"train": "train"}.get(who, who)
        t = self.cur if at is None else at
        if voice == "kids":
            arrs = [tts.speak(clean(text), v) for v in KIDS]
            n = max(len(a) for a in arrs)
            arr = np.zeros(n + int(0.05 * SR), np.float32)
            for i, a in enumerate(arrs):
                o = int(0.018 * i * SR)
                arr[o:o + len(a)] += a * 0.55
        else:
            arr = tts.speak(clean(text), voice)
        dur = len(arr) / SR
        self.tl.add_audio("speech", t, arr)
        self.tl.mouth.append((who, t, arr))
        self.tl.speech.append(dict(who=who, start=round(t, 3), end=round(t + dur, 3), text=text))
        if sub:
            self.tl.subs.append(dict(start=t, end=t + dur + 0.25, text=text, style=style or _style(who)))
        if at is None:
            self.cur = t + dur + gap
        return t, dur

    def sfx(self, name, who=None, gain=1.0, gap=0.2, at=None, bus="sfx", advance=True, sub=None):
        t = self.cur if at is None else at
        arr = (synth.ANIMAL_SFX.get(name) or synth.FOLEY[name])()
        dur = len(arr) / SR
        self.tl.add_audio(bus, t, arr, gain)
        if who:
            self.tl.mouth.append((who, t, arr))
            self.tl.sounds.append(dict(who=who, name=name, start=round(t, 3), end=round(t + dur, 3)))
        if sub:
            self.tl.subs.append(dict(start=t, end=t + dur + 0.2, text=sub, style="Sound"))
        if at is None and advance:
            self.cur = t + dur + gap
        return t, dur

    def music(self, arr, gain=1.0, at=None, bus="music"):
        t = self.cur if at is None else at
        self.tl.add_audio(bus, t, arr, gain)
        return len(arr) / SR

    def song(self, track, gain=1.0, at=None, singer_map=None, lyric_style="Song"):
        """Place a music.Track (instrumental + sung vocals)."""
        t = self.cur if at is None else at
        self.tl.add_audio("music", t, track.mixdown(0.75), gain)
        for v in track.vocals:
            self.tl.add_audio("vocals", t + v["start"], v["audio"], v["gain"] * 0.9)
        singers = {}
        for v in track.vocals:
            who = (singer_map or {}).get(v["who"], "kids" if v["who"].startswith("kid") else v["who"])
            singers.setdefault(who, []).append((t + v["start"], t + v["start"] + len(v["audio"]) / SR))
        for v in track.vocals:
            who = (singer_map or {}).get(v["who"], "kids" if v["who"].startswith("kid") else v["who"])
            self.tl.mouth.append((who, t + v["start"], v["audio"]))
        for who, spans in singers.items():
            for a, b in spans:
                self.tl.speech.append(dict(who=who, start=round(a, 3), end=round(b, 3), text="", sung=True))
        for ly in track.lyrics:
            self.tl.subs.append(dict(start=t + ly["start"], end=t + ly["end"], text="♪ " + ly["text"] + " ♪",
                                     style=lyric_style))
        return track.dur

    def overlay(self, kind, text, start, end, **kw):
        self.tl.overlays.append(dict(kind=kind, text=text, start=round(start, 3), end=round(end, 3), **kw))


def _style(who):
    if who == "train":
        return "Train"
    if who.startswith("baby"):
        return "Baby"
    if who.startswith("mommy"):
        return "Mommy"
    if who == "kids":
        return "Kids"
    return "Friend"


# ===================================================================== sections
def opening(tl, start, end, flex=0.0):
    s = Sec(tl, "opening", start, end, flex)
    song = music.opening_song(132)
    song_start = end - song.dur - 0.6
    s.music(synth.birdsong_ambience(song_start - start + 2, 0.6, 3), 0.5, bus="amb")
    s.music(music.bed(song_start - start, "lullaby", ("C", "F", "C", "G"), bpm=80, gain=0.8), 0.45)
    s.beat("sleep")
    s.sfx("hiss", gain=0.3, advance=False, at=start + 0.5)
    s.say("train", "Zzz... zzz...", gap=0.8, sub=True)
    s.beat("wake")
    s.sfx("sparkle", gain=0.6, gap=0.1)
    s.say("train", "Yaaawn! Good morning, sunshine!", gap=0.3)
    s.sfx("whistle", who="train", gain=0.7, gap=0.3)
    s.beat("hello")
    s.say("train", "Hello, friends! I'm Choo-Choo, the Learning Train!", gap=0.4)
    s.say("train", "Today, we will help baby animals find their mommies!", gap=0.4)
    s.say("train", "Are you ready? Let's sing!", gap=0.2)
    assert s.cur <= song_start + 0.01, f"opening dialogue too long ({s.cur - start:.1f}s)"
    s.until(song_start)
    s.beat("song", bpm=132)
    s.song(song, 1.0)
    s.cur = end
    s.overlay("title", "Choo Choo Learning Train", start + 1.0, start + 7.0)
    return s.finish(), s.nflex


def episode(tl, fam, nxt, start, end, flex=0.0):
    sid = fam["id"]
    name = fam["name"]
    f1, f2 = fam["friends"]
    s = Sec(tl, sid, start, end, flex)
    baby, mommy = "baby", "mommy"
    bv, mv = fam["baby_voice"], fam["mommy_voice"]

    # ---- arrival -------------------------------------------------------------
    s.beat("arrive", station=fam["station"])
    s.music(music.bed(9.0, "travel", ("C", "G"), bpm=128, gain=0.9,
                      drums="w.b.w.b.|xxxxxxxx"), 0.55)
    s.music(synth.chug_loop(7.5, 128, 0.35), 0.6, bus="foley")
    s.sfx("whistle", who="train", gain=0.6, at=start + 0.4, advance=False)
    s.flexwait(5.0, 0.25)
    s.sfx("hiss", gain=0.35, advance=False)
    s.sfx("bell", gain=0.35, at=s.cur + 0.3, advance=False)
    s.say("train", f"Toot toot! Welcome to {fam['station']}!", gap=0.6)
    s.overlay("title", f"Baby {name}", start + 0.8, start + 6.5, sub=fam["station"])

    # ---- introduction + baby sound ---------------------------------------------
    s.beat("intro")
    amb = synth.birdsong_ambience(30, 0.25, hash(sid) % 100) if fam["theme"] != "snow" else synth.wind(30, 0.12)
    s.music(amb, 0.35, bus="amb")
    s.say("train", f"Oh! Who is this? It's Baby {name}!", gap=0.4)
    s.say("train", fam["desc"], gap=0.5)
    s.beat("babysound")
    sad_len = 14.0
    s.music(music.bed(sad_len, "sad", ("Am", "Dm", "E", "Am"), bpm=84, gain=0.9), 0.4)
    s.sfx(fam["baby_sfx"], who=baby, gain=0.9, gap=0.3, sub=f"(Baby {name} cries)")
    s.say(baby, "Boo-hoo! I can't find my mommy!", voice=bv, gap=0.4)
    s.say("train", f"Oh no! Baby {name} is sad.", gap=0.5)

    # ---- invitation ---------------------------------------------------------
    s.beat("ask")
    s.say("train", f"Don't cry, Baby {name}. Hop on board! We will help you!", gap=0.2)
    s.sfx("boing", who=None, gain=0.6, gap=0.4)
    s.say("train", "Friends, let's play a guessing game!", gap=0.3)
    s.say("train", "Listen to each sound. Which one is Mommy?", gap=0.3)

    # ---- three guesses ------------------------------------------------------
    go_lines = ["Choo choo! Here we go!", "Let's keep looking!", "One more try! Choo choo!"]
    hide_lines = ["Listen! Who is behind the bush?", "Shh... listen carefully!", "Listen! What sound is this?"]
    guests = [dict(f1, slot="friend1"), dict(f2, slot="friend2"),
              dict(id=sid, name=f"Mommy {name}", ono=fam["ono"], sfx=fam["sfx"], voice=mv, slot="mommy")]
    for k, g in enumerate(guests):
        s.beat(f"go{k}")
        travel = 11.0
        s.music(synth.chug_loop(travel + flex, 128, 0.35), 0.55, bus="foley")
        s.wait(0.4)
        s.say("train", go_lines[k], gap=0.2)
        chant = music.travel_chant()
        s.song(chant, 0.9)
        s.wait(chant.dur + 0.3)
        if k == 0:
            s.say("train", "Can you say choo choo?", gap=0.2)
            s.say("kids", "Choo choo!", voice="kids", gap=0.4)
        elif k == 1:
            s.say("train", "Clap with me! Clap, clap, clap!", gap=0.1)
            for i in range(3):
                s.sfx("clap", gain=0.6, at=s.cur + i * 0.45, advance=False)
            s.wait(1.6)
        else:
            s.say("train", "Let's whistle together! Toot toot!", gap=0.1)
            s.sfx("whistle", who="train", gain=0.5, gap=0.2)
            s.say("kids", "Toot toot!", voice="kids", gap=0.4)
        s.music(music.bed(flex + 2.5, "travel", ("C", "F", "G", "C"), bpm=128, gain=0.8,
                          drums="w.b.w.b.|xxxxxxxx"), 0.4)
        s.flexwait(0.5)
        s.beat(f"hide{k}", guest=g["slot"])
        s.sfx("hiss", gain=0.25, advance=False)
        s.say("train", hide_lines[k], gap=0.4)
        s.beat(f"sound{k}", guest=g["slot"])
        s.sfx(g["sfx"], who=g["slot"], gap=0.4, sub="( Listen... )")
        s.sfx(g["sfx"], who=g["slot"], gap=0.4, sub="( Listen... )")
        s.beat(f"question{k}", guest=g["slot"])
        s.say("train", f"Is this Mommy {name}?" if k != 1 else f"Is it Mommy {name}'s sound?", gap=0.15)
        s.beat(f"pause{k}", guest=g["slot"])
        p0 = s.cur
        s.sfx("think", gain=0.8, advance=False)
        s.overlay("pause", "?", p0, p0 + PAUSE_FOR_ANSWER)
        tl.subs.append(dict(start=p0, end=p0 + PAUSE_FOR_ANSWER, text="( Your turn! What do you think? )",
                            style="Pause"))
        s.wait(PAUSE_FOR_ANSWER)
        s.beat(f"reveal{k}", guest=g["slot"], correct=(k == 2))
        s.sfx("pop", gain=0.7, advance=False)
        if k < 2:
            s.music(music.wrong_sting(), 0.6)
            s.wait(0.2)
            s.say("train", f"No! It's {g['name']}!", gap=0.3)
            s.overlay("word", g["name"].upper(), s.cur - 1.6, s.cur + 3.0)
            s.say("train", f"{g['name']} says {g['ono']}!", gap=0.2)
            s.say("kids", f"{g['ono']}!", voice="kids", gap=0.3)
            s.sfx(g["sfx"], who=g["slot"], gain=0.8, gap=0.3, sub=f"( {g['ono']}! )")
            s.say(baby, "That's not my mommy!", voice=bv, gap=0.3)
            s.say(g["slot"], f"Good luck, Baby {name}!", voice=g["voice"], gap=0.5)
        else:
            s.music(music.reveal_sting(), 0.7)
            s.sfx("sparkle", gain=0.6, advance=False)
            s.wait(0.3)
            s.say("train", f"Yes! It's Mommy {name}!", gap=0.2)
            s.overlay("word", f"MOMMY {name.upper()}", s.cur - 1.8, s.cur + 3.0)
            s.sfx(g["sfx"], who="mommy", gain=0.9, gap=0.3, sub=f"( {g['ono']}! )")
            s.say("kids", "Hooray!", voice="kids", gap=0.3)

    # ---- reunion ------------------------------------------------------------
    s.beat("reunion")
    s.music(music.bed(12, "lullaby", ("F", "C", "G", "C"), bpm=96, gain=0.8), 0.45)
    s.say(baby, "Mommy!", voice=bv, gap=0.3)
    s.sfx("heart", gain=0.6, advance=False)
    s.wait(0.6)
    s.say(mommy, "My baby! I love you so much!", voice=mv, gap=0.3)
    s.sfx("heart", gain=0.5, advance=False)
    s.say("train", f"Baby {name} found Mommy!", gap=0.4)
    s.say(mommy, "Thank you, Choo-Choo! Thank you, friends!", voice=mv, gap=0.3)

    # ---- cheer --------------------------------------------------------------
    s.beat("cheer")
    for i in range(6):
        s.sfx("clap", gain=0.5, at=s.cur + 0.1 + i * 0.22, advance=False)
    s.say("kids", "Hooray!", voice="kids", gap=0.3)
    s.say("train", f"Mommy {name} says {fam['ono']}!", gap=0.2)
    s.sfx(fam["sfx"], who=mommy, gain=0.9, gap=0.3)
    s.say("train", "Let's do the train dance!", gap=0.3)

    # ---- dance (exactly 20 s) -----------------------------------------------
    s.beat("dance", calls=music.DANCE_CALLS[sid])
    d0 = s.cur
    tr = music.dance_track(sid, DANCE_LENGTH, 126)
    s.music(tr.mixdown(0.8), 0.75)
    step = DANCE_LENGTH / 5
    for i, call in enumerate(music.DANCE_CALLS[sid]):
        s.say("train", call, at=d0 + i * step + 0.1, gap=0)
    s.cur = d0 + DANCE_LENGTH

    # ---- board + transition ride ------------------------------------------
    s.beat("board", next=nxt)
    s.sfx("bell", gain=0.4, advance=False)
    s.say("train", f"All aboard! Next stop: {nxt}!", gap=0.2)
    s.sfx("boing", gain=0.4, gap=0.1)
    s.sfx("boing", gain=0.4, gap=0.3)
    s.beat("depart", next=nxt)
    song = music.depart_song(nxt)
    s.song(song, 0.95)
    s.music(synth.chug_loop(song.dur + flex + 2, 128, 0.35), 0.5, bus="foley")
    s.wait(song.dur)
    s.flexwait(1.0, 0.5)
    s.sfx("whoosh", gain=0.5, at=s.cur - 1.0, advance=False)
    return s.finish(), s.nflex


def learning(tl, start, end, flex=0.0):
    s = Sec(tl, "learning", start, end, flex)
    s.music(music.bed(end - start, "bed", ("C", "Am", "F", "G"), bpm=104, gain=0.8,
                      drums="....w...|x.x.x.x."), 0.38)
    s.beat("intro")
    s.sfx("whistle", who="train", gain=0.5, gap=0.3)
    s.say("train", "Welcome to the Learning Station!", gap=0.3)
    s.overlay("title", "Learning Station", s.cur - 2.0, s.cur + 3.0)
    s.say("train", "Let's learn with all our animal friends!", gap=0.5)
    s.flexwait(0.5, 0.3)

    # ---- colours: each family rides a coloured car -------------------------
    s.beat("colors_intro")
    s.say("train", "First, colors! Look at my train cars.", gap=0.6)
    items = []
    for fam in FAMILIES:
        c = fam["color"]
        q0 = s.cur
        s.say("train", "What color is this car?", gap=0.15)
        p0 = s.cur
        s.sfx("think", gain=0.7, advance=False)
        s.overlay("pause", "?", p0, p0 + PAUSE_FOR_ANSWER)
        tl.subs.append(dict(start=p0, end=p0 + PAUSE_FOR_ANSWER, text="( Your turn! )", style="Pause"))
        s.wait(PAUSE_FOR_ANSWER)
        s.sfx("pop", gain=0.5, advance=False)
        a0 = s.cur
        s.say("train", f"{c.capitalize()}! The {fam['name'].lower()}s ride in the {c} car.", gap=0.15)
        s.say("kids", f"{c.capitalize()}!", voice="kids", gap=0.5)
        s.overlay("color", c.upper(), a0, s.cur, color=COLOR_HEX[c])
        items.append(dict(color=c, family=fam["id"], q=round(q0, 3), a=round(a0, 3), end=round(s.cur, 3)))
        s.flexwait(0.2, 0.25)
    s.beat("colors_recap")
    s.say("train", "Let's say all the colors together!", gap=0.3)
    rec = []
    for fam in FAMILIES:
        c = fam["color"]
        a0 = s.cur
        s.say("kids", f"{c.capitalize()}!", voice="kids", gap=0.25)
        s.overlay("color", c.upper(), a0, s.cur - 0.1, color=COLOR_HEX[c])
        rec.append(dict(color=c, t=round(a0, 3)))
    s.say("train", "Wonderful!", gap=0.4)
    tl.events.append(dict(kind="colors", items=items, recap=rec))
    s.beat("colors", items=items)

    # ---- counting 1 to 10 ----------------------------------------------------
    s.beat("count_intro")
    s.sfx("sparkle", gain=0.5, gap=0.1)
    s.say("train", "Now let's count balloons, from one to ten! Count with me!", gap=0.6)
    s.beat("counting")
    nums = []
    for i, w in enumerate(NUMBER_WORDS):
        s.sfx("pop", gain=0.5, advance=False)
        n0 = s.cur
        s.say("train", f"{w}!", gap=0.12)
        s.say("kids", f"{w}!", voice="kids", gap=0.3)
        s.overlay("number", str(i + 1), n0, s.cur, color=list(COLOR_HEX.values())[i % 7])
        nums.append(dict(n=i + 1, t=round(n0, 3)))
    tl.events.append(dict(kind="count", items=nums))
    s.beat("count_quiz")
    s.say("train", "How many balloons are there?", gap=0.15)
    p0 = s.cur
    s.sfx("think", gain=0.7, advance=False)
    s.overlay("pause", "?", p0, p0 + PAUSE_FOR_ANSWER)
    tl.subs.append(dict(start=p0, end=p0 + PAUSE_FOR_ANSWER, text="( Your turn! )", style="Pause"))
    s.wait(PAUSE_FOR_ANSWER)
    a0 = s.cur
    s.say("train", "Ten! Ten balloons!", gap=0.15)
    s.say("kids", "Ten!", voice="kids", gap=0.4)
    s.overlay("number", "10", a0, s.cur, color=COLOR_HEX["purple"])
    s.say("train", "What comes after three?", gap=0.15)
    p0 = s.cur
    s.sfx("think", gain=0.7, advance=False)
    s.overlay("pause", "?", p0, p0 + PAUSE_FOR_ANSWER)
    tl.subs.append(dict(start=p0, end=p0 + PAUSE_FOR_ANSWER, text="( Your turn! )", style="Pause"))
    s.wait(PAUSE_FOR_ANSWER)
    a0 = s.cur
    s.say("train", "Four! One, two, three, four!", gap=0.15)
    s.overlay("number", "4", a0, s.cur, color=COLOR_HEX["orange"])
    s.say("kids", "Four!", voice="kids", gap=0.4)
    s.say("train", "What comes after seven?", gap=0.15)
    p0 = s.cur
    s.sfx("think", gain=0.7, advance=False)
    s.overlay("pause", "?", p0, p0 + PAUSE_FOR_ANSWER)
    tl.subs.append(dict(start=p0, end=p0 + PAUSE_FOR_ANSWER, text="( Your turn! )", style="Pause"))
    s.wait(PAUSE_FOR_ANSWER)
    a0 = s.cur
    s.say("train", "Eight! Seven, eight!", gap=0.15)
    s.overlay("number", "8", a0, s.cur, color=COLOR_HEX["green"])
    s.say("kids", "Eight!", voice="kids", gap=0.5)
    s.beat("count_fast")
    s.say("train", "Now let's count all together, super fast!", gap=0.3)
    fast = []
    for i, w in enumerate(NUMBER_WORDS):
        n0 = s.cur
        s.say("kids", w, voice="kids", gap=0.05, sub=False)
        s.overlay("number", str(i + 1), n0, s.cur, color=list(COLOR_HEX.values())[i % 7])
        fast.append(dict(n=i + 1, t=round(n0, 3)))
    tl.subs.append(dict(start=fast[0]["t"], end=s.cur, text="One, two, three, four, five, six, seven, eight, nine, ten!",
                        style="Kids"))
    s.say("train", "Hooray! Ten balloons!", gap=0.4)
    tl.events.append(dict(kind="count_fast", items=fast))
    s.flexwait(0.3, 0.3)

    # ---- animal names + sounds ----------------------------------------------
    s.beat("animals_intro")
    s.say("train", "Now, animal names! Who is this?", gap=0.2)
    animals = []
    for i, fam in enumerate(FAMILIES):
        q0 = s.cur
        if i:
            s.say("train", "Who is this?", gap=0.15)
        p0 = s.cur
        s.sfx("think", gain=0.7, advance=False)
        s.overlay("pause", "?", p0, p0 + PAUSE_FOR_ANSWER)
        tl.subs.append(dict(start=p0, end=p0 + PAUSE_FOR_ANSWER, text="( Your turn! )", style="Pause"))
        s.wait(PAUSE_FOR_ANSWER)
        a0 = s.cur
        s.say("train", f"{fam['name']}!", gap=0.12)
        s.say("kids", f"{fam['name']}!", voice="kids", gap=0.3)
        s.overlay("word", fam["name"].upper(), a0, s.cur + 0.5)
        s.say("train", f"What does the {fam['name'].lower()} say?", gap=0.15)
        p1 = s.cur
        s.overlay("pause", "?", p1, p1 + PAUSE_FOR_ANSWER)
        tl.subs.append(dict(start=p1, end=p1 + PAUSE_FOR_ANSWER, text="( Your turn! )", style="Pause"))
        s.wait(PAUSE_FOR_ANSWER)
        snd0 = s.cur
        s.sfx(fam["sfx"], who="mommy_" + fam["id"], gain=0.9, gap=0.15)
        s.say("kids", f"{fam['ono']}!", voice="kids", gap=0.4)
        animals.append(dict(family=fam["id"], q=round(q0, 3), a=round(a0, 3), snd=round(snd0, 3),
                            end=round(s.cur, 3)))
        s.flexwait(0.1, 0.25)
    tl.events.append(dict(kind="animals", items=animals))
    s.beat("animals", items=animals)

    s.beat("outro")
    s.sfx("sparkle", gain=0.5, gap=0.1)
    s.say("train", "Great job, friends! You are so smart!", gap=0.3)
    s.say("train", "Now, everybody, all aboard for our big song!", gap=0.3)
    s.flexwait(0.5, 0.3)
    return s.finish(), s.nflex


RECAP_VERSES = [
    dict(family="elephant", sfx="elephant",
         lines=["Num-ber one, the el-e-phants are here,", "In the red car, give a cheer!",
                "Big gray ears and a long, long nose,", "Pa-woo, pa-woo, off they go!"],
         hook="El-e-phant says pa-woo!"),
    dict(family="zebra", sfx="zebra",
         lines=["Num-ber two, the ze-bras ride,", "In the yel-low car, side by side,",
                "Black and white with stripes so neat,", "Clip-clop, clip-clop, hap-py feet!"],
         hook="Ze-bra says kwa-ha!"),
    dict(family="panda", sfx="panda",
         lines=["Num-ber three, the pan-das play,", "In the green car, munch all day,",
                "Black and white and soft and round,", "Mwaa, mwaa, what a sound!"],
         hook="Pan-da says mwaa, mwaa!"),
    dict(family="giraffe", sfx="giraffe",
         lines=["Num-ber four, gi-raffes so tall,", "In the or-ange car, they see it all,",
                "Long, long necks up to the sky,", "Hmm, hmm, hmm, they wave hi!"],
         hook="Gi-raffe says hmm, hmm!"),
    dict(family="lion", sfx="lion",
         lines=["Num-ber five, the li-ons roar,", "In the pur-ple car, roar some more!",
                "Fluf-fy mane and gold-en fur,", "Roar, roar, roar, and purr, purr, purr!"],
         hook="Li-on says roar, roar!"),
    dict(family="penguin", sfx="penguin",
         lines=["Num-ber six, the pen-guins slide,", "In the blue car, take a ride!",
                "Wad-dle, wad-dle, flap and play,", "Squawk, squawk, hip hoo-ray!"],
         hook="Pen-guin says squawk, squawk!"),
]


def recap(tl, start, end, flex=0.0):
    s = Sec(tl, "recap", start, end, flex)
    track, hooks = music.recap_song(RECAP_VERSES, 120)
    s.beat("song", verses=[dict(family=h["family"], start=round(start + h["verse_start"], 3),
                                end=round(start + h["verse_end"], 3), hook=round(start + h["start"], 3))
                           for h in hooks])
    s.song(track, 1.0)
    for h in hooks:
        s.sfx(h["name"], who="mommy_" + h["family"], gain=0.8, at=start + h["start"], advance=False)
    s.music(synth.chug_loop(end - start, 120, 0.25), 0.4, bus="foley")
    s.cur = end
    return s.finish(), 0


def goodbye(tl, start, end, flex=0.0):
    s = Sec(tl, "goodbye", start, end, flex)
    s.beat("home")
    s.music(synth.birdsong_ambience(end - start, 0.15, 99), 0.25, bus="amb")
    s.sfx("whistle_long", who="train", gain=0.4, gap=0.3)
    s.say("train", "What a wonderful day! Every baby found Mommy!", gap=0.3)
    s.say("train", "Thank you for helping, friends!", gap=0.4)
    s.music(music.bed(s.cur - start + 1.5, "lullaby", ("C", "F", "C", "G"), bpm=72, gain=0.8), 0.4, at=start)
    s.beat("lullaby")
    tr = music.lullaby(72)
    lull_start = s.cur
    s.song(tr, 0.9, lyric_style="Lullaby")
    bye_t = lull_start + tr.t(10 * 4) + 0.3
    s.say("train", "Goodbye, friends! See you next time!", at=bye_t, gap=0)
    s.say("kids", "Bye-bye!", voice="kids", at=bye_t + 3.4, gap=0)
    s.cur = lull_start + tr.dur
    assert s.cur <= end, f"goodbye too long by {s.cur - end:.1f}s"
    s.beat("fade")
    tail = end - s.cur
    if tail > 0.5:
        s.music(music.bed(tail + 1.0, "lullaby", ("F", "C", "G", "C"), bpm=72, gain=0.8), 0.45)
        s.sfx("whistle_long", who="train", gain=0.12, at=s.cur + 0.5, advance=False)
    s.cur = end
    return s.finish(), 0


# ====================================================================== build
def _fit(fn, tl_factory, start, end, *args):
    """Lay out once, then stretch flexible beats so the section ends exactly at `end`."""
    probe = tl_factory()
    used, nflex = fn(probe, *args, start, end, 0.0)
    slack = end - used
    if slack < -1e-6:
        raise ValueError(f"{fn.__name__}{args[:1]} overruns by {-slack:.2f}s")
    flex = slack / nflex if nflex else 0.0
    return flex


def build():
    tl = Timeline()
    order = [s[0] for s in SECTIONS]
    win = {s[0]: (s[1], s[2]) for s in SECTIONS}
    for sid, a, b in SECTIONS:
        tl.sections.append(dict(id=sid, start=a, end=b))
    station_names = [f["station"] for f in FAMILIES] + ["the Learning Station"]

    def run(fn, sid, *args):
        a, b = win[sid]
        flex = _fit(fn, Timeline, a, b, *args)
        end, _ = fn(tl, *args, a, b, flex)
        assert abs(end - b) < 0.05 or end <= b, (sid, end, b)
        print(f"  {sid:9s} {a:7.1f}-{b:7.1f}  flex/beat={flex:5.2f}s")

    run(opening, "opening")
    for i, fam in enumerate(FAMILIES):
        run(episode, fam["id"], fam, station_names[i + 1])
    run(learning, "learning")
    run(recap, "recap")
    run(goodbye, "goodbye")
    tl.beats.sort(key=lambda b: b["start"])
    return tl
