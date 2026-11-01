# FLUX.2 Studio

A simple web app for making images from text with **FLUX.2 [klein] 4B** by Black Forest Labs.

- Type a prompt, pick an aspect ratio, press **Generate**
- Optionally add up to **4 reference images** to edit or combine them ("put the sofa from image 2 into the room in image 1")
- Every result is saved to a **gallery** with its prompt, settings and seed
- One-click **templates**: photoreal exterior, interior render, isometric 3D floor plan, top-down colored floor plan
- Runs in **API mode** (Black Forest Labs' cloud, no graphics card needed) or **local mode** (your own NVIDIA GPU)

The app runs on your computer and opens in your web browser. Your images are saved in the `outputs` folder.

---

## Setup (no programming experience needed)

You only do steps 1–3 once.

### 1. Install Python

1. Go to <https://www.python.org/downloads/> and download the latest Python 3 for your system.
2. Run the installer.
   - **Windows:** on the first screen, tick **"Add python.exe to PATH"** before clicking Install. This step matters.
   - **Mac:** just click through the installer.

### 2. Get a Black Forest Labs API key

1. Go to <https://dashboard.bfl.ai> and create an account.
2. Add some credits (billing section). FLUX.2 [klein] is the cheapest FLUX.2 model; you pay a small amount per image (see current pricing on the dashboard).
3. Open **API Keys**, create a key, and copy it. It is a long string of letters and numbers. Keep it private, like a password.

### 3. Download this folder

If you received this as a zip file, unzip it somewhere easy to find, such as your Desktop.
(If you use GitHub: on the repository page click **Code → Download ZIP**, unzip it, and open the `flux2-studio` folder.)

### 4. Start the app

**Windows**

1. Open the `flux2-studio` folder and double-click **`start.bat`**.
   If Windows shows "Windows protected your PC", click **More info → Run anyway**.
2. The first time, it installs what it needs (about a minute), then opens a file called `.env` in Notepad.
3. Paste your API key right after `BFL_API_KEY=` so the line looks like
   `BFL_API_KEY=abc123yourkeyhere` (no spaces, no quotes). Save and close Notepad.
4. Double-click **`start.bat`** again. Your browser opens the app.

**Mac**

1. Open the **Terminal** app (press ⌘ + Space, type "Terminal", press Enter).
2. Type `cd ` (with a space after it), drag the `flux2-studio` folder into the Terminal window, then press Enter.
3. Type `./start.sh` and press Enter. The first time, it installs what it needs and creates a `.env` file.
4. Open `.env` in TextEdit: in Terminal type `open -e .env` and press Enter.
   Paste your key after `BFL_API_KEY=`, then save and close.
5. Back in Terminal, type `./start.sh` again. Your browser opens the app.

If the browser doesn't open by itself, go to **<http://localhost:7860>**.

**To stop the app:** close the black/Terminal window, or press **Ctrl + C** in it.
**To start it again later:** repeat step 4 (double-click `start.bat` or run `./start.sh`). Setup is not repeated.

> If you see "Mac can't verify the developer" or "permission denied" on `./start.sh`, run `chmod +x start.sh` once, or use `bash start.sh` instead.

---

## Using the app

1. **Pick a template** (optional). It fills in a prompt and a matching aspect ratio, and highlights the first part in `[square brackets]` so you can type over it. Replace every bracketed part with your own details.
2. **Write or edit the prompt.** Describe what you want: subject, materials, lighting, camera angle, style. Press **Ctrl + Enter** to generate quickly.
3. **Choose an aspect ratio.** For example, 16:9 for wide renders or 1:1 for floor plans.
4. **Add reference images** (optional). Drag them in, click to browse, or paste one. They are numbered *image 1*, *image 2*, and so on, and you can refer to them by number in your prompt:
   - "Turn image 1 into a photoreal exterior at dusk with warm interior lights"
   - "Render the floor plan in image 1 as an isometric 3D cutaway"
   - "Use the materials and color palette from image 2 for the living room in image 1"
5. **Press Generate.** An image usually takes a few seconds in API mode.
6. **Gallery.** Click any image to see its full prompt and settings. From there you can:
   - **Reuse prompt:** loads its prompt, aspect ratio and seed so you can tweak and regenerate
   - **Use as reference:** feeds the result back in for another round of edits
   - **Download** or **Delete** it

**Seeds** (under *Advanced*): the same prompt with the same seed gives a very similar image. Leave it blank for a new variation each time.

All images are saved as PNG files in `flux2-studio/outputs/`. The list of prompts is in `outputs/gallery.json`. Back up this folder if you want to keep your work.

---

## Settings (`.env` file)

| Setting | What it does |
|---|---|
| `FLUX_MODE` | `api` (cloud, default) or `local` (your GPU) |
| `BFL_API_KEY` | Your Black Forest Labs key (API mode) |
| `BFL_MODEL` | Cloud model. Default `flux-2-klein-4b`. Others such as `flux-2-pro` also work but cost more |
| `LOCAL_MODEL_ID` | Hugging Face model for local mode (default `black-forest-labs/FLUX.2-klein-4B`) |
| `LOCAL_STEPS`, `LOCAL_GUIDANCE` | Local quality settings (4 steps and 1.0 suit the fast "distilled" klein model) |
| `LOCAL_CPU_OFFLOAD` | Set to `1` if your GPU has less than about 16 GB of memory |
| `PORT` | Web address port (default 7860) |

Restart the app after you change anything.

---

## Switching to local GPU mode (optional, advanced)

You need an **NVIDIA graphics card with about 12–16 GB+ of video memory** (for example RTX 3090, 4080 or 4090), and about **20 GB of free disk space** for the model download.

1. Install PyTorch with CUDA support by following <https://pytorch.org/get-started/locally/>. Pick your OS, "Pip" and a CUDA version, then run the command it shows inside this folder's environment:
   - Windows: `.venv\Scripts\activate` then paste the command
   - Mac/Linux: `source .venv/bin/activate` then paste the command
2. In `.env`, change `FLUX_MODE=api` to `FLUX_MODE=local`.
3. Start the app as usual. `start.bat` / `start.sh` installs the extra packages from `requirements-local.txt` automatically.
4. Your **first** image takes several minutes because the model downloads from Hugging Face (about 16 GB). After that it's fast.
   - If the download says you must accept the license or log in, open the model page on huggingface.co, accept its terms, then run `huggingface-cli login` in the activated environment.

The badge at the top of the app shows which mode is active ("BFL API" or "Local GPU"). If something is wrong, for example no GPU or a missing key, a yellow banner explains what to fix.

**Technical note:** in diffusers, FLUX.2 **[klein]** loads with `Flux2KleinPipeline`, which pairs it with a Qwen3 text encoder. `Flux2Pipeline` is the class for the larger FLUX.2 [dev]. The app picks the right class from the model name automatically.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "python is not recognized" (Windows) | Reinstall Python and tick **Add python.exe to PATH** |
| Yellow banner: "BFL_API_KEY is empty" | Paste your key into `.env` and restart the app |
| "rejected your API key" | Make sure the key was copied completely, with no spaces or quotes |
| "out of credits" | Add credits at dashboard.bfl.ai |
| "blocked by content filter" | Reword the prompt |
| Browser says "can't connect" | The app window was closed. Start it again |
| Port already in use | Change `PORT=7860` to, for example, `PORT=7861` in `.env` |

---

## For developers

```
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # add BFL_API_KEY
python app.py
```

- `app.py`: FastAPI server, gallery storage and REST endpoints (`/api/config`, `/api/generate`, `/api/gallery`)
- `backends.py`: `BFLBackend` (async submit, then poll the `polling_url`; references go in `input_image`, `input_image_2`, …) and `LocalBackend` (diffusers)
- `presets.py`: prompt templates. Add your own here
- `static/`: the browser UI (plain HTML/CSS/JS, no build step)
