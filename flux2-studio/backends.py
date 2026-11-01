"""Image generation backends.

Two interchangeable backends with the same `generate()` signature:

* BFLBackend   - calls the Black Forest Labs cloud API (no GPU needed)
* LocalBackend - runs FLUX.2 [klein] 4B on your own GPU with Hugging Face diffusers

Which one is used is chosen by FLUX_MODE in the .env file.
"""

from __future__ import annotations

import base64
import io
import os
import threading
import time

import httpx
from PIL import Image

# Width/height for each aspect ratio. All are multiples of 16 and about 1 megapixel.
ASPECT_RATIOS = {
    "1:1": (1024, 1024),
    "4:3": (1152, 864),
    "3:4": (864, 1152),
    "3:2": (1248, 832),
    "2:3": (832, 1248),
    "16:9": (1360, 768),
    "9:16": (768, 1360),
    "21:9": (1568, 672),
}

MAX_REFERENCES = 4  # FLUX.2 [klein] supports up to 4 reference images


class GenerationError(Exception):
    """An error with a message that is safe and useful to show in the UI."""


def _shrink(img: Image.Image, max_side: int = 1536) -> Image.Image:
    """Downscale large uploads so requests stay small and fast."""
    img = img.convert("RGB")
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    return img


class BFLBackend:
    name = "api"

    def __init__(self) -> None:
        self.api_key = os.getenv("BFL_API_KEY", "").strip()
        self.model = os.getenv("BFL_MODEL", "flux-2-klein-4b").strip()
        self.base = os.getenv("BFL_API_BASE", "https://api.bfl.ai/v1").rstrip("/")
        self.timeout_s = int(os.getenv("BFL_TIMEOUT", "180"))

    def describe(self) -> str:
        return f"BFL API · {self.model}"

    def check(self) -> str | None:
        if not self.api_key:
            return "BFL_API_KEY is empty. Add your key to the .env file and restart the app."
        return None

    def generate(self, prompt, width, height, references, seed=None) -> Image.Image:
        problem = self.check()
        if problem:
            raise GenerationError(problem)

        body = {
            "prompt": prompt,
            "width": width,
            "height": height,
            "output_format": "png",
        }
        if seed is not None:
            body["seed"] = seed
        # References go in input_image, input_image_2, input_image_3, ...
        for i, ref in enumerate(references[:MAX_REFERENCES]):
            buf = io.BytesIO()
            _shrink(ref).save(buf, format="JPEG", quality=92)
            key = "input_image" if i == 0 else f"input_image_{i + 1}"
            body[key] = base64.b64encode(buf.getvalue()).decode()

        headers = {"x-key": self.api_key, "accept": "application/json"}
        with httpx.Client(timeout=60) as client:
            r = client.post(f"{self.base}/{self.model}", json=body, headers=headers)
            if r.status_code in (401, 403):
                raise GenerationError("The BFL API rejected your API key. Check BFL_API_KEY in .env.")
            if r.status_code == 402:
                raise GenerationError("Your BFL account is out of credits. Top up at dashboard.bfl.ai.")
            if r.status_code == 429:
                raise GenerationError("Too many requests at once. Wait a moment and try again.")
            if r.status_code >= 400:
                raise GenerationError(f"BFL API error {r.status_code}: {r.text[:300]}")
            job = r.json()
            polling_url = job.get("polling_url") or f"{self.base}/get_result?id={job['id']}"

            # The API is asynchronous: poll until the image is ready.
            deadline = time.time() + self.timeout_s
            while time.time() < deadline:
                time.sleep(0.75)
                p = client.get(polling_url, headers=headers)
                if p.status_code >= 400:
                    raise GenerationError(f"BFL polling error {p.status_code}: {p.text[:300]}")
                data = p.json()
                status = data.get("status")
                if status == "Ready":
                    img_url = data["result"]["sample"]
                    img = client.get(img_url, timeout=60)  # signed URL, expires in ~10 min
                    img.raise_for_status()
                    return Image.open(io.BytesIO(img.content)).convert("RGB")
                if status in ("Pending", "Queued", "Processing"):
                    continue
                if status in ("Content Moderated", "Request Moderated"):
                    raise GenerationError(
                        "The request was blocked by BFL's content filter. Try rewording the prompt."
                    )
                raise GenerationError(f"Generation failed (status: {status}).")
        raise GenerationError("Timed out waiting for the BFL API. Try again.")


class LocalBackend:
    name = "local"

    def __init__(self) -> None:
        self.model_id = os.getenv("LOCAL_MODEL_ID", "black-forest-labs/FLUX.2-klein-4B")
        self.steps = int(os.getenv("LOCAL_STEPS", "4"))
        self.guidance = float(os.getenv("LOCAL_GUIDANCE", "1.0"))
        self.offload = os.getenv("LOCAL_CPU_OFFLOAD", "0") == "1"
        self._pipe = None
        self._lock = threading.Lock()  # one generation at a time on the GPU

    def describe(self) -> str:
        return f"Local GPU · {self.model_id}"

    def check(self) -> str | None:
        try:
            import torch  # noqa: F401
            import diffusers  # noqa: F401
        except ImportError:
            return (
                "Local mode needs extra packages. Run: "
                "pip install -r requirements-local.txt (or set FLUX_MODE=api)."
            )
        import torch

        if not torch.cuda.is_available():
            return "No NVIDIA GPU was detected. Set FLUX_MODE=api in .env to use the cloud instead."
        return None

    def _load(self):
        if self._pipe is not None:
            return self._pipe
        import torch
        import diffusers

        # FLUX.2 [klein] uses Flux2KleinPipeline (Qwen3 text encoder);
        # FLUX.2 [dev] uses Flux2Pipeline. Fall back to auto-detection if needed.
        cls = (
            getattr(diffusers, "Flux2KleinPipeline", None)
            if "klein" in self.model_id.lower()
            else getattr(diffusers, "Flux2Pipeline", None)
        ) or diffusers.DiffusionPipeline
        pipe = cls.from_pretrained(self.model_id, torch_dtype=torch.bfloat16)
        if self.offload:
            pipe.enable_model_cpu_offload()
        else:
            pipe.to("cuda")
        self._pipe = pipe
        return pipe

    def generate(self, prompt, width, height, references, seed=None) -> Image.Image:
        problem = self.check()
        if problem:
            raise GenerationError(problem)
        import torch

        with self._lock:
            pipe = self._load()
            kwargs = dict(
                prompt=prompt,
                width=width,
                height=height,
                num_inference_steps=self.steps,
                guidance_scale=self.guidance,
            )
            if seed is not None:
                kwargs["generator"] = torch.Generator("cuda").manual_seed(seed)
            if references:
                refs = [_shrink(r, 1024) for r in references[:MAX_REFERENCES]]
                kwargs["image"] = refs if len(refs) > 1 else refs[0]
            return pipe(**kwargs).images[0]


def make_backend():
    mode = os.getenv("FLUX_MODE", "api").strip().lower()
    if mode == "local":
        return LocalBackend()
    return BFLBackend()
