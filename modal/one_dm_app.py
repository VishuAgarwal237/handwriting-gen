"""
Modal deployment for One-DM (https://github.com/dailenson/One-DM).

Endpoint matches `lib/handwritingProvider.ts`:
    POST /generate
    body: { "style_image_b64": "<png/jpg base64>", "words": ["foo","bar"] }
    resp: { "images_b64": ["<png b64>", ...], "sizes": [{"w":int,"h":int}, ...] }

──────────────────────────────────────────────────────────────────────────────
ONE-TIME DEPLOY (run these on your Mac)
──────────────────────────────────────────────────────────────────────────────

1) Install Modal + login (free credits cover plenty of test runs):
     pip install modal
     modal token new

2) Download the One-DM artifacts:
   • English_data.zip   from https://drive.google.com/drive/folders/108TB-z2ytAZSIEzND94dyufybjpqVyn6
     → unzip; you need the file `data/unifont.pickle`
   • One-DM-ckpt.pt     from https://drive.google.com/drive/folders/10KOQ05HeN2kaR2_OCZNl9D_Kh1p8BDaa
   • vae_HTR138.pth     (same folder)
   • RN18_class_10400.pth (same folder)

3) Create the Modal volume and upload everything:
     modal volume create one-dm-weights
     modal volume put one-dm-weights ./One-DM-ckpt.pt          /weights/One-DM-ckpt.pt
     modal volume put one-dm-weights ./vae_HTR138.pth          /weights/vae_HTR138.pth
     modal volume put one-dm-weights ./RN18_class_10400.pth    /weights/RN18_class_10400.pth
     modal volume put one-dm-weights ./unifont.pickle          /weights/unifont.pickle

4) Deploy:
     modal deploy modal/one_dm_app.py

5) Modal prints a URL like https://yourname--inkwell-one-dm-web.modal.run
   Put it in vienna/.env.local:
     HANDWRITING_SERVICE_URL=https://yourname--inkwell-one-dm-web.modal.run
   …then restart `npm run dev`. The Next.js side picks it up automatically.

──────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import base64
import io
import os
import sys
from typing import List

import modal

ONE_DM_REF = "5b69de8"  # pin to a known-good commit; bump as needed

image = (
    modal.Image.debian_slim(python_version="3.8")
    .apt_install("git", "libgl1", "libglib2.0-0", "libsm6", "libxext6")
    .pip_install(
        "torch==1.13.1",
        "torchvision==0.14.1",
        "diffusers==0.18.2",
        "huggingface_hub==0.16.4",
        "transformers==4.30.2",
        "accelerate==0.20.3",
        "numpy==1.23.5",
        "opencv-python-headless==4.5.5.64",
        "pillow",
        "einops==0.6.1",
        "fastapi[standard]",
        "ema-pytorch==0.2.3",
        "lmdb==1.4.1",
        "easydict==1.10",
        "omegaconf==2.3.0",
        "scikit-image==0.21.0",
        extra_index_url="https://download.pytorch.org/whl/cu117",
    )
    .run_commands(
        f"git clone https://github.com/dailenson/One-DM /opt/One-DM && "
        f"cd /opt/One-DM && git checkout {ONE_DM_REF} || true",
        # The repo expects a /data dir for unifont.pickle relative to its own root.
        "mkdir -p /opt/One-DM/data",
    )
    .env({"PYTHONPATH": "/opt/One-DM"})
)

app = modal.App("inkwell-one-dm")
weights = modal.Volume.from_name("one-dm-weights", create_if_missing=True)

WEIGHTS_DIR = "/weights"
HF_CACHE = "/root/.cache/huggingface"


# ─────────────────────────────────────────────────────────────────────────────
# Style preprocessing — turn ONE user photo into the (style, laplace) tensors
# One-DM expects. Their training data is 64-pixel-tall word crops; we crop the
# largest text region we find, scale it to 64px tall, and produce a Laplacian
# edge map alongside it.
# ─────────────────────────────────────────────────────────────────────────────

def preprocess_style_image(png_bytes: bytes):
    """Return (style[1,1,64,W], laplace[1,1,64,W]) tensors in [0,1]."""
    import cv2
    import numpy as np
    import torch

    arr = np.frombuffer(png_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("could not decode style image")

    # Light denoise + contrast normalize so phone shadows don't dominate.
    img = cv2.bilateralFilter(img, 5, 50, 50)
    img = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX)

    # Find the bounding box of ink: invert, threshold, dilate, then take the
    # largest contour. This isolates the writing from page margins.
    inv = 255 - img
    _, bw = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    bw = cv2.dilate(bw, cv2.getStructuringElement(cv2.MORPH_RECT, (15, 5)), iterations=2)
    contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        x, y, w, h = cv2.boundingRect(max(contours, key=cv2.contourArea))
        pad = 8
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(img.shape[1], x + w + pad), min(img.shape[0], y + h + pad)
        crop = img[y0:y1, x0:x1]
    else:
        crop = img

    # Resize to 64 tall, preserving aspect. Clamp width so we don't blow up VRAM.
    target_h = 64
    scale = target_h / crop.shape[0]
    new_w = max(128, min(352, int(crop.shape[1] * scale)))
    crop64 = cv2.resize(crop, (new_w, target_h), interpolation=cv2.INTER_AREA)

    # Laplacian highlights the high-frequency strokes One-DM relies on.
    lap = cv2.Laplacian(crop64, cv2.CV_64F, ksize=3)
    lap = np.absolute(lap)
    lap = cv2.normalize(lap, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

    style_t = torch.from_numpy(crop64 / 255.0).to(torch.float32).unsqueeze(0).unsqueeze(0)
    lap_t = torch.from_numpy(lap / 255.0).to(torch.float32).unsqueeze(0).unsqueeze(0)
    return style_t, lap_t


# ─────────────────────────────────────────────────────────────────────────────
# One-DM letter set. Anything outside this is dropped before rendering
# (the model literally has no embedding for unsupported chars).
# ─────────────────────────────────────────────────────────────────────────────

ONE_DM_LETTERS = '_Only thewigsofrcvdampbkuq.A-210xT5\'MDL,RYHJ"ISPWENj&BC93VGFKz();#:!7U64Q8?+*ZX/%'


def sanitize_word(w: str) -> str:
    """Drop chars One-DM can't embed. Keep length ≤ 12 (model was trained at 9)."""
    out = "".join(c for c in w if c in ONE_DM_LETTERS)
    return out[:12]


# ─────────────────────────────────────────────────────────────────────────────
# Inference class. @modal.enter() runs once per container — we load weights
# there so warm requests don't pay the model-load cost.
# ─────────────────────────────────────────────────────────────────────────────

@app.cls(
    image=image,
    gpu="T4",
    volumes={WEIGHTS_DIR: weights},
    scaledown_window=300,
    timeout=600,
)
class OneDM:
    @modal.enter()
    def load(self):
        import shutil
        import pickle

        import torch

        sys.path.insert(0, "/opt/One-DM")

        # Stage unifont.pickle into the place the loader expects.
        src = os.path.join(WEIGHTS_DIR, "unifont.pickle")
        dst = "/opt/One-DM/data/unifont.pickle"
        if not os.path.exists(dst):
            shutil.copyfile(src, dst)

        os.chdir("/opt/One-DM")  # parse_config + ContentData expect repo-relative paths

        from parse_config import cfg, cfg_from_file, assert_and_infer_cfg
        from models.unet import UNetModel
        from models.diffusion import Diffusion
        from data_loader.loader import ContentData, letters
        from diffusers import AutoencoderKL

        cfg_from_file("configs/IAM64.yml")
        assert_and_infer_cfg()

        self.cfg = cfg
        self.device = torch.device("cuda")
        self.letters = letters
        self.letter2index = {label: n for n, label in enumerate(letters)}

        # Build UNet and load One-DM weights.
        unet = UNetModel(
            in_channels=cfg.MODEL.IN_CHANNELS,
            model_channels=cfg.MODEL.EMB_DIM,
            out_channels=cfg.MODEL.OUT_CHANNELS,
            num_res_blocks=cfg.MODEL.NUM_RES_BLOCKS,
            attention_resolutions=(1, 1),
            channel_mult=(1, 1),
            num_heads=cfg.MODEL.NUM_HEADS,
            context_dim=cfg.MODEL.EMB_DIM,
        ).to(self.device)
        state = torch.load(os.path.join(WEIGHTS_DIR, "One-DM-ckpt.pt"), map_location="cpu")
        # Some checkpoints wrap weights under "model" — handle both shapes.
        if isinstance(state, dict) and "model" in state and not any(k.startswith("input_blocks") for k in state):
            state = state["model"]
        unet.load_state_dict(state, strict=False)
        unet.eval()
        self.unet = unet

        # VAE comes from Stable Diffusion v1.5 (auto-cached to /root/.cache/huggingface).
        vae = AutoencoderKL.from_pretrained("runwayml/stable-diffusion-v1-5", subfolder="vae")
        vae = vae.to(self.device)
        vae.requires_grad_(False)
        self.vae = vae

        self.diffusion = Diffusion(device=self.device)
        self.content_loader = ContentData()

        self._ready = True
        print("[one-dm] model loaded")

    @modal.method()
    def generate(self, style_image_b64: str, words: List[str], steps: int = 50) -> dict:
        import numpy as np
        import torch
        import torchvision

        style_bytes = base64.b64decode(style_image_b64)
        style_t, lap_t = preprocess_style_image(style_bytes)
        style_t = style_t.to(self.device)
        lap_t = lap_t.to(self.device)

        images_b64: list[str] = []
        sizes: list[dict] = []

        for raw_word in words:
            word = sanitize_word(raw_word)
            if not word:
                # Emit a 1×64 transparent stub so the JS side keeps index alignment.
                empty = _png_b64_blank(width=8, height=64)
                images_b64.append(empty)
                sizes.append({"w": 8, "h": 64})
                continue

            # Content tensor: [1, len(word), 16, 16]
            text_ref = self.content_loader.get_content(word).to(self.device)
            # The model expects content batched along the writer dim (B=1 here).

            # Latent noise — height = style_h / 8 = 8, width = len(word) * 4.
            latent_h = style_t.shape[2] // 8
            latent_w = (text_ref.shape[1] * 32) // 8
            x = torch.randn((1, 4, latent_h, latent_w), device=self.device)

            with torch.no_grad():
                samples = self.diffusion.ddim_sample(
                    self.unet, self.vae, 1,
                    x, style_t, lap_t, text_ref,
                    steps, 0.0,
                )

            img = torchvision.transforms.ToPILImage()(samples[0]).convert("L")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            images_b64.append(base64.b64encode(buf.getvalue()).decode())
            sizes.append({"w": img.width, "h": img.height})

        return {"images_b64": images_b64, "sizes": sizes}


def _png_b64_blank(width: int, height: int) -> str:
    from PIL import Image
    im = Image.new("L", (width, height), color=255)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


# ─────────────────────────────────────────────────────────────────────────────
# HTTP entrypoint
# ─────────────────────────────────────────────────────────────────────────────

@app.function(image=image, timeout=600)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel

    api = FastAPI(title="inkwell-one-dm")
    runner = OneDM()

    class GenReq(BaseModel):
        style_image_b64: str
        words: List[str]
        steps: int = 50

    @api.post("/generate")
    def generate(req: GenReq):
        if not req.style_image_b64 or not req.words:
            raise HTTPException(400, "style_image_b64 and words are required")
        try:
            return runner.generate.remote(req.style_image_b64, req.words, req.steps)
        except Exception as e:
            raise HTTPException(500, str(e))

    @api.get("/health")
    def health():
        return {"ok": True}

    return api
