"""Global constants shared by every stage of the pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
CACHE = BUILD / "cache"
VOICES = ROOT / "assets" / "voices"
OUT = ROOT / "out"

FPS = 24
WIDTH = 1920
HEIGHT = 1080
SR = 44100                     # final audio sample rate
DURATION = 30 * 60.0           # exactly 30 minutes

# Section windows (seconds) -- these are fixed by the brief.
SECTIONS = [
    ("opening",  0.0,    90.0),
    ("elephant", 90.0,   300.0),
    ("zebra",    300.0,  510.0),
    ("panda",    510.0,  720.0),
    ("giraffe",  720.0,  930.0),
    ("lion",     930.0,  1140.0),
    ("penguin",  1140.0, 1350.0),
    ("learning", 1350.0, 1560.0),
    ("recap",    1560.0, 1740.0),
    ("goodbye",  1740.0, 1800.0),
]

PAUSE_FOR_ANSWER = 2.0         # silent "your turn!" gap after every question
DANCE_LENGTH = 20.0

# Piper voices (downloaded by tools/fetch_voices.sh)
VOICE_FILES = {
    "lessac": "en-us-lessac-medium.onnx",
    "ryan": "en-us-ryan-medium.onnx",
    "libritts": "en-us-libritts-high.onnx",
}
