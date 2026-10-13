"""Post-production text: ASS subtitles (burned in) + SRT (soft track).

Dialogue sits at the bottom, colour-coded by speaker.  Educational overlays
(titles, colour words, numbers, animal names and the "?" answer prompt) pop in
with a little bounce."""
from .config import HEIGHT, WIDTH

FONT = "Fredoka Light"

# &HAABBGGRR
STYLES = {
    #        primary      outline     size  outline shadow
    "Train":   ("&H00FFFFFF", "&H00A0501E", 54, 5, 2),
    "Baby":    ("&H0066F2FF", "&H00523A1A", 54, 5, 2),
    "Mommy":   ("&H00D9B3FF", "&H00552A6B", 54, 5, 2),
    "Friend":  ("&H00B4FFC8", "&H00284E1E", 54, 5, 2),
    "Kids":    ("&H0047C2FF", "&H00103C80", 58, 5, 2),
    "Sound":   ("&H00FFFFFF", "&H00505050", 50, 4, 2),
    "Song":    ("&H00FFFFFF", "&H00B0447A", 56, 5, 2),
    "Lullaby": ("&H00E8F4FF", "&H006A3C8A", 54, 5, 2),
    "Pause":   ("&H0000E1FF", "&H00703010", 56, 5, 2),
}


def _ts(t):
    t = max(0.0, t)
    h = int(t // 3600)
    m = int(t % 3600 // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _srt_ts(t):
    t = max(0.0, t)
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def _hex_to_ass(h):
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H00{b}{g}{r}".upper()


def write_ass(tl, path):
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {WIDTH}", f"PlayResY: {HEIGHT}",
        "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ]
    for name, (pc, oc, size, ol, sh) in STYLES.items():
        lines.append(f"Style: {name},{FONT},{size},{pc},&H000000FF,{oc},&H64000000,-1,0,0,0,100,100,1,0,1,"
                     f"{ol},{sh},2,160,160,48,1")
    lines.append(f"Style: Overlay,{FONT},150,&H00FFFFFF,&H000000FF,&H00A0501E,&H64000000,-1,0,0,0,100,100,2,0,1,"
                 f"9,4,8,60,60,60,1")
    lines += ["", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]

    pop = r"\fscx40\fscy40\t(0,180,\fscx115\fscy115)\t(180,320,\fscx100\fscy100)"
    for sub in sorted(tl.subs, key=lambda s: s["start"]):
        text = sub["text"].replace("\n", r"\N")
        lines.append(f"Dialogue: 0,{_ts(sub['start'])},{_ts(sub['end'])},{sub['style']},,0,0,0,,{text}")
    for ov in tl.overlays:
        a, b = ov["start"], ov["end"]
        k = ov["kind"]
        if k == "title":
            sub = ov.get("sub")
            body = rf"{{\fad(300,400){pop}\fs110\c&H0047C2FF&\3c&H00A0501E&\bord10}}{ov['text']}"
            if sub:
                body += rf"\N{{\fs64\c&H00FFFFFF&\3c&H00287A2E&\bord7}}{sub}"
            lines.append(f"Dialogue: 2,{_ts(a)},{_ts(b)},Overlay,,0,0,0,,{{\\an8\\pos({WIDTH // 2},70)}}{body}")
        elif k == "word":
            lines.append(f"Dialogue: 2,{_ts(a)},{_ts(b)},Overlay,,0,0,0,,{{\\an8\\pos({WIDTH // 2},90)"
                         rf"\fad(150,250){pop}\fs140\c&H00FFFFFF&\3c&H00C0602A&}}{ov['text']}")
        elif k == "color":
            c = _hex_to_ass(ov["color"])
            lines.append(f"Dialogue: 2,{_ts(a)},{_ts(b)},Overlay,,0,0,0,,{{\\an8\\pos({WIDTH // 2},80)"
                         rf"\fad(150,250){pop}\fs170\c{c}&\3c&H00FFFFFF&\bord12\4c&H40000000&}}{ov['text']}")
        elif k == "number":
            c = _hex_to_ass(ov["color"])
            lines.append(f"Dialogue: 2,{_ts(a)},{_ts(b)},Overlay,,0,0,0,,{{\\an8\\pos({WIDTH // 2},50)"
                         rf"\fad(100,200){pop}\fs230\c{c}&\3c&H00FFFFFF&\bord14}}{ov['text']}")
        elif k == "pause":
            lines.append(f"Dialogue: 2,{_ts(a)},{_ts(b)},Overlay,,0,0,0,,{{\\an5\\pos({WIDTH // 2},230)"
                         rf"\fad(120,150){pop}\fs220\c&H0000D7FF&\3c&H00A0501E&\bord12"
                         rf"\t(320,1000,\frz-8)\t(1000,1800,\frz8)}}?")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_srt(tl, path):
    out = []
    for i, sub in enumerate(sorted(tl.subs, key=lambda s: s["start"]), 1):
        out += [str(i), f"{_srt_ts(sub['start'])} --> {_srt_ts(sub['end'])}", sub["text"], ""]
    path.write_text("\n".join(out), encoding="utf-8")
