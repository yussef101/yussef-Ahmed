#!/usr/bin/env bash
# Downloads the open-source Piper TTS voices (MIT-licensed engine, public-domain / CC
# datasets) used for speech and singing. ~270 MB total.
set -euo pipefail
DEST="$(cd "$(dirname "$0")/.." && pwd)/assets/voices"
mkdir -p "$DEST"
cd "$DEST"
for v in lessac-medium ryan-medium libritts-high; do
  if [ ! -f "en-us-$v.onnx" ]; then
    curl -fsSL -o "$v.tgz" "https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-en-us-$v.tar.gz"
    tar xzf "$v.tgz" && rm "$v.tgz"
  fi
done
ls -la "$DEST"
