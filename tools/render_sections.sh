#!/usr/bin/env bash
# Render named sections of the timeline to build/sections/<id>.mp4 (one after another).
#   tools/render_sections.sh elephant zebra ...
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/sections
for id in "$@"; do
  read -r a b < <(python3 -c "import json,sys; s=[x for x in json.load(open('build/timeline.json'))['sections'] if x['id']=='$id'][0]; print(s['start'], s['end'])")
  if [ -f "build/sections/$id.mp4" ]; then echo "skip $id"; continue; fi
  echo "=== $id  $a -> $b  $(date +%T)"
  node render/render.mjs --from "$a" --to "$b" --out "build/sections/$id.part.mp4" --w "${WIDTH:-1920}" --preset fast --crf 17
  mv "build/sections/$id.part.mp4" "build/sections/$id.mp4"
done
echo "done $(date +%T)"
