"""Make a labelled contact sheet from rendered stills: python tools/contact.py build/stills out.jpg"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

files = sorted(Path(sys.argv[1]).glob("still_*.jpg"))
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 2
ims = [Image.open(f) for f in files]
w, h = ims[0].size
sheet = Image.new("RGB", (w * cols, h * ((len(ims) + cols - 1) // cols)), "white")
for i, (f, im) in enumerate(zip(files, ims)):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im, (x, y))
    t = float(f.stem.split("_")[1])
    ImageDraw.Draw(sheet).text((x + 8, y + 6), f"{int(t // 60)}:{t % 60:05.2f}", fill="red")
sheet.save(sys.argv[2], quality=88)
