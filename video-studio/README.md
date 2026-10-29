# Video Studio

Chaîne de production vidéo par le code : **HyperFrames** (HTML + GSAP → MP4), **Remotion** (React → MP4) et **FFmpeg** (montage, audio, sous-titres, encodage).

## Installation

```bash
./setup.sh    # dépendances système, Chrome headless, paquets npm, TTS Kokoro, puis vérification
./verify.sh   # rend une démo par moteur et les assemble avec FFmpeg → out/pipeline-test.mp4
```

## HyperFrames — `hyperframes/`

```bash
cd hyperframes
npx hyperframes init mon-film --example blank --non-interactive
cd mon-film
npx hyperframes preview        # studio dans le navigateur
npx hyperframes check          # lint + validation runtime
npx hyperframes render -o out/film.mp4 -q delivery   # aussi : --format webm|mov|gif|png-sequence
npx hyperframes tts "Texte" --voice ff_siwis -o voix.wav   # voix off française locale
npx hyperframes transcribe voix.wav -m small -l fr --to srt -o sous-titres.srt
```

Les modèles HyperFrames chargent GSAP depuis jsDelivr. Si le réseau bloque le CDN, copiez `node_modules/gsap/dist/gsap.min.js` dans le projet et référencez-le en local (comme dans `hyperframes/demo`).

## Remotion — `remotion/`

```bash
cd remotion
npm run studio      # éditeur interactif
npm run render      # Demo → out/demo.mp4
npm run still       # image fixe
```

`remotion.config.ts` réutilise le Chrome Headless Shell installé par HyperFrames quand Remotion ne peut pas télécharger le sien (surcharge possible avec `REMOTION_BROWSER_EXECUTABLE`).

## FFmpeg

`verify.sh` montre un montage type : fondu enchaîné (`xfade`), sous-titres incrustés (`subtitles`), voix off décalée et normalisée à -16 LUFS (`loudnorm`), encodage H.264/AAC en `faststart`. Encodeurs disponibles : libx264, libx265, libsvtav1, libvpx-vp9, prores_ks, aac, libopus.
