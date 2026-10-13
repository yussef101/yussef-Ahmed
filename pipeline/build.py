"""Stage 1: script -> timeline.json + soundtrack + subtitles.

    python -m pipeline.build
"""
import json
import time

import soundfile as sf

from . import mix, story, subtitles
from .config import BUILD, DURATION, FPS, HEIGHT, SECTIONS, SR, WIDTH


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    print("Laying out the story ...")
    tl = story.build()
    print(f"  {len(tl.beats)} beats, {len(tl.speech)} speech cues, {len(tl.sounds)} sounds "
          f"({time.time() - t0:.0f}s)")

    print("Mixing soundtrack ...")
    master = mix.mix(tl)
    sf.write(BUILD / "soundtrack.wav", master, SR, subtype="PCM_16")

    print("Writing subtitles ...")
    subtitles.write_ass(tl, BUILD / "subtitles.ass")
    subtitles.write_srt(tl, BUILD / "subtitles.srt")

    print("Writing timeline.json ...")
    data = dict(
        fps=FPS, width=WIDTH, height=HEIGHT, duration=DURATION,
        sections=tl.sections, beats=tl.beats,
        speech=[dict(who=s["who"], start=s["start"], end=s["end"]) for s in tl.speech],
        sounds=tl.sounds, overlays=tl.overlays, events=tl.events,
        families=[dict(id=f["id"], name=f["name"], station=f["station"], theme=f["theme"], color=f["color"],
                       friends=[x["id"] for x in f["friends"]]) for f in story.FAMILIES],
        mouth=mix.mouth_envelopes(tl, FPS),
    )
    (BUILD / "timeline.json").write_text(json.dumps(data, separators=(",", ":")))
    _report(tl)
    print(f"Done in {time.time() - t0:.0f}s")


def _report(tl):
    lines = ["# Episode timing report", ""]
    for sid, a, b in SECTIONS:
        lines.append(f"## {sid}  ({_mmss(a)} - {_mmss(b)})")
        for bt in tl.beats:
            if bt["sec"] == sid:
                lines.append(f"- {_mmss(bt['start'])}-{_mmss(bt['end'])}  {bt['name']}")
        lines.append("")
    (BUILD / "timing_report.md").write_text("\n".join(lines))


def _mmss(t):
    return f"{int(t // 60):02d}:{t % 60:05.2f}"


if __name__ == "__main__":
    main()
