"""
إزالة الخلفية الخشبية من aura.jpeg — الإبقاء على مربع الأيقونة كاملاً (شفاف خارجها).
تشغيل: python scripts/process-aura-icon.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "aura.jpeg"
OUT_PNG = ROOT / "aura.png"


def corner_wood_reference(rgb: np.ndarray, margin: int) -> np.ndarray:
    h, w = rgb.shape[:2]
    m = max(8, min(margin, h // 8, w // 8))
    patches = [
        rgb[0:m, 0:m],
        rgb[0:m, w - m : w],
        rgb[h - m : h, 0:m],
        rgb[h - m : h, w - m : w],
    ]
    samples = np.concatenate([p.reshape(-1, 3) for p in patches], axis=0)
    return np.median(samples, axis=0)


def build_alpha(rgb: np.ndarray, wood_ref: np.ndarray) -> np.ndarray:
    h, w = rgb.shape[:2]
    diff = np.linalg.norm(rgb.astype(np.float32) - wood_ref.astype(np.float32), axis=2)

    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    maxc = np.maximum(np.maximum(r, g), b).astype(np.float32)
    minc = np.minimum(np.minimum(r, g), b).astype(np.float32)
    sat = (maxc - minc) / (maxc + 1.0)

    # خشب: قريب من لون الزوايا
    wood_like = diff < 52

    # محتوى الأيقونة: مربع داكن، حلقات ملونة، نص أبيض، ظل خفيف تحت الأيقونة
    dark_icon = luma < 118
    bright_glow = luma > 175
    white_text = (r > 175) & (g > 175) & (b > 175)
    colorful = sat > 0.18
    shadow_under = (luma >= 40) & (luma < 118) & (diff > 28) & (diff < 85)

    keep = dark_icon | bright_glow | white_text | colorful | shadow_under
    alpha = np.where(wood_like & ~keep, 0, 255).astype(np.uint8)

    # توسيع بسيط لحافة الأيقونة حتى لا تُقصّ الحواف الداكنة
    pil_a = Image.fromarray(alpha, mode="L")
    pil_a = pil_a.filter(ImageFilter.MaxFilter(3))
    return np.array(pil_a)


def crop_to_alpha(img: Image.Image, alpha: np.ndarray, pad: int = 2) -> tuple[Image.Image, np.ndarray]:
    ys, xs = np.where(alpha > 12)
    if ys.size == 0:
        return img, alpha
    y0, y1 = max(0, ys.min() - pad), min(img.height, ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(img.width, xs.max() + pad + 1)
    cropped = img.crop((x0, y0, x1, y1))
    cropped_a = alpha[y0:y1, x0:x1]
    return cropped, cropped_a


def crop_square_to_icon_edges_INDEX2(img: Image.Image, alpha_threshold: int = 160) -> Image.Image:
    """قص محكم على حدود الأيقونة المربعة (إزالة الهامش الشفاف الزائد)."""
    im = img.convert("RGBA")
    arr = np.array(im)
    a = arr[:, :, 3]
    mask = a > alpha_threshold
    if not mask.any():
        return im
    ys, xs = np.where(mask)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    cw, ch = x1 - x0, y1 - y0
    side = min(cw, ch)
    cx = (x0 + x1) // 2
    cy = (y0 + y1) // 2
    half = side // 2
    sq = im.crop((cx - half, cy - half, cx - half + side, cy - half + side))
    arr2 = np.array(sq)
    a2 = arr2[:, :, 3]
    m2 = a2 > alpha_threshold
    ys2, xs2 = np.where(m2)
    if not ys2.size:
        return sq
    return sq.crop((int(xs2.min()), int(ys2.min()), int(xs2.max()) + 1, int(ys2.max()) + 1))


def main() -> int:
    if not SRC.exists() and not OUT_PNG.exists():
        print("[aura] لم يُعثر على", SRC, "أو", OUT_PNG, file=sys.stderr)
        return 1

    if OUT_PNG.exists() and SRC.exists():
        img = Image.open(OUT_PNG).convert("RGBA")
    elif OUT_PNG.exists():
        img = Image.open(OUT_PNG).convert("RGBA")
    else:
        base = Image.open(SRC).convert("RGB")
        rgb = np.array(base)
        wood_ref = corner_wood_reference(rgb, margin=24)
        alpha = build_alpha(rgb, wood_ref)
        rgba = np.dstack([rgb, alpha])
        img = Image.fromarray(rgba)
        img, alpha = crop_to_alpha(img, alpha, pad=4)
        img.putalpha(Image.fromarray(alpha))

    img = crop_square_to_icon_edges_INDEX2(img)

    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT_PNG, format="PNG", optimize=True)
    print("[aura] تم الحفظ:", OUT_PNG, "—", img.size[0], "x", img.size[1])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
