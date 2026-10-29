#!/usr/bin/env bash
# Rend une démo avec chaque moteur puis les assemble avec FFmpeg (fondu + voix + sous-titres).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out

ffmpeg -version | head -1
(cd hyperframes && npx hyperframes doctor | grep -E '✓|✗' || true)

(cd hyperframes/demo && npx hyperframes lint && npx hyperframes render -o out/demo.mp4)
(cd remotion && npx tsc --noEmit && npx remotion render Demo out/demo.mp4)

[ -f out/voix-fr.wav ] || (cd hyperframes && npx hyperframes tts "Bonjour, votre studio vidéo est prêt." --voice ff_siwis -o ../out/voix-fr.wav)

ffmpeg -v error -y -i hyperframes/demo/out/demo.mp4 -i remotion/out/demo.mp4 -i out/voix-fr.wav \
  -filter_complex "[0:v]fps=30,settb=AVTB,format=yuv420p[a0];[1:v]fps=30,settb=AVTB,format=yuv420p[b0];\
[a0][b0]xfade=transition=fade:duration=0.5:offset=4.5,subtitles=test.srt:force_style='FontName=Noto Sans,FontSize=24'[v];\
[2:a]adelay=1000|1000,apad,loudnorm=I=-16:TP=-1.5[a]" \
  -map "[v]" -map "[a]" -t 9.5 -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart \
  out/pipeline-test.mp4

ffprobe -v error -show_entries stream=codec_name,width,height:format=duration -of compact out/pipeline-test.mp4
echo "OK — vidéo finale : out/pipeline-test.mp4"
