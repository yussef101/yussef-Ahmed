#!/usr/bin/env bash
# Waits for every rendered section, checks its length against the timeline,
# then assembles the final film and a lighter 720p copy.
#   setsid nohup tools/finalize.sh > build/logs/finalize.log 2>&1 &
set -euo pipefail
cd "$(dirname "$0")/.."
SECS=(opening elephant zebra panda giraffe lion penguin learning recap goodbye)
while true; do
  missing=0
  for s in "${SECS[@]}"; do [ -f "build/sections/$s.mp4" ] || missing=$((missing + 1)); done
  [ "$missing" -eq 0 ] && break
  echo "$(date +%T) waiting for $missing section(s)"
  sleep 300
done
echo "$(date +%T) all sections rendered; checking durations"
python3 - <<'EOF'
import json, subprocess
tl = json.load(open("build/timeline.json"))
bad = []
for s in tl["sections"]:
    d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                       "-of", "csv=p=0", f"build/sections/{s['id']}.mp4"]).decode())
    want = s["end"] - s["start"]
    print(f"  {s['id']:9s} {d:8.3f}s (want {want:.3f})")
    if abs(d - want) > 0.1:
        bad.append(s["id"])
if bad:
    raise SystemExit(f"section length mismatch: {bad}")
EOF
tools/assemble.sh
ffmpeg -y -loglevel error -i out/choo_choo_learning_train_1080p.mp4 -map 0:v -map 0:a -map 0:s? \
  -vf scale=1280:720:flags=lanczos -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k -c:s copy \
  -movflags +faststart out/choo_choo_learning_train_720p.mp4
cp build/subtitles.srt out/choo_choo_learning_train.srt
ls -la out/
echo "$(date +%T) FINISHED"
touch out/.done
