#!/usr/bin/env bash
# Final post-production: join the rendered sections, add the soundtrack, burn
# in the subtitles/overlays (ASS) and attach a soft SRT track.
#   tools/assemble.sh  ->  out/choo_choo_learning_train_1080p.mp4
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p out
SECS=(opening elephant zebra panda giraffe lion penguin learning recap goodbye)
LIST=build/sections/concat.txt
: > "$LIST"
for s in "${SECS[@]}"; do
  [ -f "build/sections/$s.mp4" ] || { echo "missing build/sections/$s.mp4"; exit 1; }
  echo "file '$PWD/build/sections/$s.mp4'" >> "$LIST"
done
ffmpeg -y -loglevel error -f concat -safe 0 -i "$LIST" -c copy build/picture.mp4
OUT=out/choo_choo_learning_train_1080p.mp4
ffmpeg -y -loglevel error -stats -i build/picture.mp4 -i build/soundtrack.wav -i build/subtitles.srt \
  -filter_complex "[0:v]subtitles=build/subtitles.ass:fontsdir=assets/fonts[v]" \
  -map "[v]" -map 1:a -map 2:s \
  -c:v libx264 -preset "${PRESET:-medium}" -crf "${CRF:-19}" -pix_fmt yuv420p -r 24 \
  -c:a aac -b:a 192k -ar 44100 \
  -c:s mov_text -metadata:s:s:0 language=eng -disposition:s:0 0 \
  -t 1800 -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of compact "$OUT"
echo "wrote $OUT"
