#!/usr/bin/env bash
# Installe la chaîne vidéo : FFmpeg + outils système, HyperFrames, Remotion, TTS Kokoro, whisper.cpp.
set -euo pipefail
cd "$(dirname "$0")"

if command -v apt-get >/dev/null; then
  SUDO=$([ "$(id -u)" = 0 ] && echo "" || echo sudo)
  $SUDO apt-get update -qq
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq \
    ffmpeg cmake build-essential imagemagick sox libsndfile1 python3-pip \
    fonts-noto-core fonts-noto-color-emoji fonts-liberation fonts-dejavu
fi

(cd hyperframes && npm ci && npx hyperframes telemetry disable && npx hyperframes browser ensure)
mkdir -p hyperframes/demo/vendor && cp hyperframes/node_modules/gsap/dist/gsap.min.js hyperframes/demo/vendor/
(cd remotion && npm ci)

# Optionnel : voix off locale (Kokoro). La transcription (whisper.cpp) s'installe au premier `hyperframes transcribe`.
pip install -q --break-system-packages kokoro-onnx soundfile 2>/dev/null || pip install -q kokoro-onnx soundfile || true

./verify.sh
