#!/usr/bin/env python3
"""強制ダウンロード ガードのアイコンを生成する（依存: Pillow）"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
os.makedirs(OUT, exist_ok=True)

SS = 8  # スーパーサンプリング倍率


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def make(size):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # --- 背景（角丸のグラデーション） ---
    c1, c2 = (30, 58, 138), (37, 99, 235)
    bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bgd = ImageDraw.Draw(bg)
    for y in range(S):
        bgd.line([(0, y), (S, y)], fill=lerp(c1, c2, y / max(S - 1, 1)) + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    img.paste(bg, (0, 0), mask)

    # --- シールド（白） ---
    def sc(pts):
        return [(x / 128 * S, y / 128 * S) for x, y in pts]

    shield = sc([(30, 18), (98, 18), (98, 58), (64, 110), (30, 58)])
    d.polygon(shield, fill=(255, 255, 255, 255))

    # --- シールド内のダウンロード矢印（青） ---
    arrow = sc([(58, 34), (70, 34), (70, 62), (82, 62), (64, 84), (46, 62), (58, 62)])
    d.polygon(arrow, fill=(30, 58, 138, 255))

    # --- 「禁止」マーク（赤い円＋白い斜線） ---
    cx, cy = sc([(92, 94)])[0]
    r = 24 / 128 * S
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(220, 38, 38, 255))
    w = 7 / 128 * S
    d.line([(cx - r * 0.62, cy + r * 0.62), (cx + r * 0.62, cy - r * 0.62)],
           fill=(255, 255, 255, 255), width=int(w))

    return img.resize((size, size), Image.LANCZOS)


for s in (16, 48, 128):
    path = os.path.join(OUT, f"icon{s}.png")
    make(s).save(path)
    print("wrote", path)
