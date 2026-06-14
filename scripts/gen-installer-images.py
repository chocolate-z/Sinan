"""生成 NSIS 安装器品牌图(可复现)。
产出:
  apps/desktop/src-tauri/installer/sidebar.bmp  164x314  欢迎/完成页左侧大图(深色紫·主视觉)
  apps/desktop/src-tauri/installer/header.bmp   150x57   内页右上头图(浅色·融入 MUI 头部)
跑法:.venv/Scripts/python scripts/gen-installer-images.py
依赖:Pillow + 系统中文字体(微软雅黑 msyh)。
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apps", "desktop", "src-tauri", "installer")
os.makedirs(OUT, exist_ok=True)

# 品牌色:四色花朵(与 Logo.vue 一致)+ accent 紫。
GREEN, BLUE, YELLOW, PINK = (82, 209, 124), (15, 175, 255), (255, 205, 15), (242, 74, 157)
ACCENT = (124, 92, 255)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    for p in (f"C:/Windows/Fonts/{name}", name):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def flower(size: int) -> Image.Image:
    """四色花朵标记(简化:圆 + 圆角方 + 圆角方 + 三角,Fluent 多色风)。"""
    s = size * 4  # 4x 超采样后缩小,边缘更顺
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    u = s / 16
    d.rounded_rectangle([9 * u, 1 * u, 15 * u, 7 * u], radius=1.5 * u, fill=YELLOW)  # 右上 圆角方
    d.ellipse([1 * u, 9 * u, 7 * u, 15 * u], fill=BLUE)  # 左下 圆
    d.rounded_rectangle([9 * u, 9 * u, 15 * u, 15 * u], radius=2.4 * u, fill=GREEN)  # 右下 圆角方
    d.polygon([(1 * u, 7 * u), (7 * u, 7 * u), (4 * u, 1 * u)], fill=PINK)  # 左上 三角
    return im.resize((size, size), Image.LANCZOS)


def sidebar() -> None:
    W, H = 164, 314
    im = Image.new("RGB", (W, H), (12, 10, 20))
    px = im.load()
    for y in range(H):  # 竖向渐变:上深紫 → 下近黑
        t = y / H
        r = int(27 * (1 - t) + 11 * t)
        g = int(21 * (1 - t) + 9 * t)
        b = int(48 * (1 - t) + 18 * t)
        for x in range(W):
            px[x, y] = (r, g, b)
    # 极光辉光(上部柔和紫斑)
    glow = Image.new("RGB", (W, H), (12, 10, 20))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W // 2 - 90, -60, W // 2 + 90, 120], fill=(70, 50, 140))
    glow = glow.filter(ImageFilter.GaussianBlur(40))
    im = Image.blend(im, glow, 0.5)
    d = ImageDraw.Draw(im)
    # 花朵
    fl = flower(54)
    im.paste(fl, (W // 2 - 27, 52), fl)
    # 标题
    f_cn = font("msyhbd.ttc", 34)
    f_en = font("msyh.ttc", 17)
    f_tag = font("msyh.ttc", 10)

    def center(text, fnt, y, fill):
        w = d.textbbox((0, 0), text, font=fnt)[2]
        d.text(((W - w) / 2, y), text, font=fnt, fill=fill)

    center("司南", f_cn, 124, (245, 245, 250))
    center("Sinan", f_en, 168, (170, 150, 255))
    d.line([34, 210, W - 34, 210], fill=(70, 64, 96), width=1)
    center("诚实 · 纪律 · 可解释", f_tag, 224, (150, 145, 170))
    center("本地量化研究工具", f_tag, 242, (120, 116, 140))
    im.save(os.path.join(OUT, "sidebar.bmp"))
    print("✓ sidebar.bmp 164x314")


def header() -> None:
    W, H = 150, 57
    im = Image.new("RGB", (W, H), (248, 248, 251))  # 浅色融入 MUI 头部
    d = ImageDraw.Draw(im)
    fl = flower(30)
    im.paste(fl, (12, (H - 30) // 2), fl)
    f_cn = font("msyhbd.ttc", 17)
    f_en = font("msyh.ttc", 11)
    d.text((50, 12), "司南", font=f_cn, fill=(30, 26, 44))
    d.text((50, 33), "Sinan", font=f_en, fill=(124, 92, 255))
    im.save(os.path.join(OUT, "header.bmp"))
    print("✓ header.bmp 150x57")


if __name__ == "__main__":
    sidebar()
    header()
    print("done →", OUT)
