"""FLUX.2 Studio - a small web app for FLUX.2 [klein] text-to-image generation.

Run:  python app.py   then open http://localhost:7860
"""

from __future__ import annotations

import io
import json
import os
import random
import threading
import uuid
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from PIL import Image, UnidentifiedImageError  # noqa: E402

from backends import ASPECT_RATIOS, MAX_REFERENCES, GenerationError, make_backend  # noqa: E402
from presets import PRESETS  # noqa: E402

OUTPUTS = Path(os.getenv("OUTPUT_DIR", ROOT / "outputs"))
REFS = OUTPUTS / "refs"
GALLERY_FILE = OUTPUTS / "gallery.json"
REFS.mkdir(parents=True, exist_ok=True)

backend = make_backend()
_gallery_lock = threading.Lock()

app = FastAPI(title="FLUX.2 Studio")


def load_gallery() -> list[dict]:
    if not GALLERY_FILE.exists():
        return []
    try:
        return json.loads(GALLERY_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def save_gallery(items: list[dict]) -> None:
    tmp = GALLERY_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(GALLERY_FILE)


@app.get("/api/config")
def config():
    return {
        "mode": backend.name,
        "backend": backend.describe(),
        "problem": backend.check(),
        "aspect_ratios": {k: {"width": w, "height": h} for k, (w, h) in ASPECT_RATIOS.items()},
        "max_references": MAX_REFERENCES,
        "presets": PRESETS,
    }


@app.get("/api/gallery")
def gallery():
    return load_gallery()


@app.post("/api/generate")
def generate(
    prompt: str = Form(...),
    aspect: str = Form("1:1"),
    seed: str = Form(""),
    references: list[UploadFile] = File(default=[]),
):
    # Plain `def` (not async): FastAPI runs it in a worker thread so slow
    # generations do not freeze the rest of the app.
    prompt = prompt.strip()
    if not prompt:
        raise HTTPException(400, "Please enter a prompt.")
    if aspect not in ASPECT_RATIOS:
        raise HTTPException(400, f"Unknown aspect ratio: {aspect}")
    width, height = ASPECT_RATIOS[aspect]

    seed_val = int(seed) if seed.strip().lstrip("-").isdigit() else random.randint(0, 2**31 - 1)

    refs = [r for r in references if r.filename]
    if len(refs) > MAX_REFERENCES:
        raise HTTPException(400, f"At most {MAX_REFERENCES} reference images are supported.")
    ref_images = []
    for up in refs:
        try:
            ref_images.append(Image.open(io.BytesIO(up.file.read())).convert("RGB"))
        except UnidentifiedImageError:
            raise HTTPException(400, f"'{up.filename}' is not an image file.")

    try:
        image = backend.generate(prompt, width, height, ref_images, seed=seed_val)
    except GenerationError as e:
        raise HTTPException(502, str(e))
    except Exception as e:  # network errors, GPU out of memory, ...
        raise HTTPException(500, f"Unexpected error: {type(e).__name__}: {e}")

    item_id = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    filename = f"{item_id}.png"
    image.save(OUTPUTS / filename)

    ref_files = []
    for i, ref in enumerate(ref_images):
        name = f"{item_id}-ref{i + 1}.jpg"
        thumb = ref.copy()
        thumb.thumbnail((1024, 1024))
        thumb.save(REFS / name, quality=90)
        ref_files.append(f"refs/{name}")

    item = {
        "id": item_id,
        "file": filename,
        "prompt": prompt,
        "aspect": aspect,
        "width": image.width,
        "height": image.height,
        "seed": seed_val,
        "backend": backend.describe(),
        "references": ref_files,
        "created": datetime.now().isoformat(timespec="seconds"),
    }
    with _gallery_lock:
        items = load_gallery()
        items.insert(0, item)
        save_gallery(items)
    return item


@app.delete("/api/gallery/{item_id}")
def delete_item(item_id: str):
    with _gallery_lock:
        items = load_gallery()
        keep = [i for i in items if i["id"] != item_id]
        if len(keep) == len(items):
            raise HTTPException(404, "Not found")
        for gone in (i for i in items if i["id"] == item_id):
            for rel in [gone["file"], *gone.get("references", [])]:
                (OUTPUTS / rel).unlink(missing_ok=True)
        save_gallery(keep)
    return JSONResponse({"ok": True})


app.mount("/outputs", StaticFiles(directory=OUTPUTS), name="outputs")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "7860"))
    print(f"\n  FLUX.2 Studio running in {backend.name.upper()} mode ({backend.describe()})")
    if backend.check():
        print(f"  ! {backend.check()}")
    print(f"  Open http://localhost:{port} in your browser. Press Ctrl+C to stop.\n")
    if os.getenv("OPEN_BROWSER", "1") == "1":
        import webbrowser

        threading.Timer(1.5, lambda: webbrowser.open(f"http://localhost:{port}")).start()
    uvicorn.run(app, host="127.0.0.1", port=port)
