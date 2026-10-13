# Choo Choo Learning Train

An original, fully procedural **30-minute 3D nursery-rhyme video for toddlers** (1920×1080, 16:9, 24 fps).

Choo-Choo, a friendly blue, red and yellow toy train with a big smiling face, rides through a sunny
storybook countryside helping six baby animals find their mommies. In each episode the children hear
three hidden animal sounds, get a two-second "your turn!" pause to guess, and then see the answer.
Every reunion ends with a cheer, a 20-second train dance and a sing-along ride to the next station.

Everything is made from scratch by code: the 3D models, animation, camera work, music, songs,
animal sounds, voices and subtitles. There are no logos, brands, samples or copyrighted characters.

## Running order (exactly 30:00)

| Time | Section | Content |
|---|---|---|
| 0:00–1:30 | Opening | Choo-Choo wakes up at Sunshine Station, says hello, sings "Choo Choo Learning Train" |
| 1:30–5:00 | Baby Elephant | Flower Meadow · horse neigh, mouse squeak, mommy elephant trumpet |
| 5:00–8:30 | Baby Zebra | Sunny Savanna · goat bleat, monkey chatter, mommy zebra bark |
| 8:30–12:00 | Baby Panda | Bamboo Forest · bird chirp, tiger roar, mommy panda bleat |
| 12:00–15:30 | Baby Giraffe | Sunny Grassland · sheep baa, lion roar, mommy giraffe hum |
| 15:30–19:00 | Baby Lion | Jungle Junction · dog bark, donkey bray, mommy lion roar, jungle dance |
| 19:00–22:30 | Baby Penguin | Snowy Village · seal bark, seagull call, mommy penguin bray |
| 22:30–26:00 | Learning Station | Colours (six train cars), counting balloons 1–10, animal names and sounds, with call-and-response pauses |
| 26:00–29:00 | Grand recap song | All six families ride through every landscape; names, sounds, colours and numbers |
| 29:00–30:00 | Goodbye | Sunset at Sunshine Station, everyone waves, lullaby farewell |

Each episode follows the same beat sheet: arrival → baby introduced and crying → baby's sound →
"hop on board" → three guesses (travel chant, bush shakes, sound plays twice, question, 2 s pause,
reveal) → reunion with hearts → cheer → 20 s dance with called moves → all aboard → transition ride.
`build/timing_report.md` lists every beat with its exact time.

## How it is built

```
pipeline/   Python: script, timeline, voices, singing, music, SFX, mix, subtitles
render/     Three.js scene + headless Chromium frame renderer
tools/      voice download, section renderer, final assembly, contact sheets
```

1. **Script → timeline** (`pipeline/story.py`). Every line, song, sound and pause is laid out with a
   cursor; each section is then stretched so it fills its window exactly.
2. **Voices** (`pipeline/tts.py`). Open-source Piper TTS voices. Character voices are re-pitched with
   the WORLD vocoder (higher pitch + formant shift for babies and the kids' chorus).
3. **Singing** (`pipeline/tts.py`, `pipeline/music.py`). Each sung word is synthesised separately,
   its pitch replaced with the melody note and its vowel stretched to the note length, so the songs
   are on key and on the beat.
4. **Music and sounds** (`pipeline/music.py`, `pipeline/synth.py`). A small sequencer with
   synthesised ukulele, marimba, glockenspiel, bass, tuba, pads and drums. All animal sounds, the
   steam whistle, chugging and effects are synthesised (source + formant filter models).
5. **Mix** (`pipeline/mix.py`). Buses with reverb, music ducking under speech and animal sounds,
   and gentle limiting.
6. **Picture** (`render/`). The director (`render/js/director.js`) reads the same timeline and poses
   the train, the 18 animal species, the world and the camera for any time `t`, so picture and
   sound stay locked. `render/render.mjs` captures frames with headless Chromium and pipes them to
   ffmpeg.
7. **Post-production** (`tools/assemble.sh`). Sections are joined, the soundtrack added, and
   subtitles plus learning overlays (titles, colour words, numbers, animal names, "?" prompts)
   burned in from `build/subtitles.ass`; an SRT track is attached as well.

## Build it yourself

Requirements: Python 3.11+ (`pip install -r requirements.txt`), Node 18+, ffmpeg with libass and
libx264, and Chromium (set `CHROME_PATH` if it is not at the Playwright default location).

```bash
tools/fetch_voices.sh                 # ~270 MB of Piper voices
npm install
python3 -m pipeline.build             # timeline.json, soundtrack.wav, subtitles (≈5 min first run)
tools/render_sections.sh opening elephant zebra panda giraffe lion penguin learning recap goodbye
tools/assemble.sh                     # -> out/choo_choo_learning_train_1080p.mp4
```

Software (SwiftShader) rendering runs at roughly 0.7 s per 1080p frame, about 8–9 hours for the
whole film on 4 CPU cores. Render sections in parallel shells to use more machines, or pass
`WIDTH=1280` for a faster preview.

Useful while editing:

```bash
node render/render.mjs --stills 98,150,262 --out build/stills --w 960   # stills at given seconds
node render/render.mjs --stills 3 --lineup adults --out build/lineup     # cast line-up
python3 tools/contact.py build/stills sheet.jpg 3                        # contact sheet
```

Open `render/index.html?play=1&t=90` through any local web server at the repo root for a live preview.

## Credits

Fredoka font (SIL Open Font License, `assets/fonts/OFL-LICENSE.txt`). Piper TTS voices (downloaded at
build time). three.js (MIT). Everything else in this repository is original.
