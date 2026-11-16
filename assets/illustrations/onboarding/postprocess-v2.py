#!/usr/bin/env python3
"""把 gpt-image-2 出的 1024x1536 漫画稿做成 9:16 整屏背景。

为什么需要这一步（而不是让模型直接出 9:16）：
`gpt-image-2` 的 size 只接受固定几档，传 1024x1792 也会回 1024x1536。
而 `WelcomeScreen` 是全屏背景 —— 直接铺会在 iPhone 上被裁掉上下两端
（漫画分格被切，第三格整个消失）。

做法：**向下扩展而不是裁切** —— 下面补纸色，并在原图底部做一段
「内容淡出到纸色」的渐隐，让第 3 格自然收进留白里，同时给
标题、圆点与两个按钮留出可读的地面。

可复现：同一个输入 + 同一个脚本，输出逐字节一致（PIL 的 LANCZOS 是确定性的）。
"""
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
PAPER = (250, 247, 241)          # #FAF7F1，与提示词里的纸色一致
TARGET_W, TARGET_H = 1024, 1820  # 9:16
FADE = 210                       # 原图底部多少像素内淡出到纸色
FINAL_W = 900                    # 与旧素材同宽（506→900 一档），控制体积
JPEG_Q = 72

def build(src: Path, dst: Path) -> None:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    assert w == TARGET_W, f"{src.name}: 期望宽度 {TARGET_W}，实际 {w}"

    canvas = Image.new("RGB", (TARGET_W, TARGET_H), PAPER)
    canvas.paste(im, (0, 0))

    # 原图底部 FADE 像素：逐行把它与纸色混合，权重从 0 → 1
    px = im.load()
    cp = canvas.load()
    start = h - FADE
    for y in range(start, h):
        t = (y - start) / (FADE - 1)
        # 缓出，避免线性渐变在纸色上出现分段
        w_ = t * t * (3 - 2 * t)
        for x in range(w):
            r, g, b = px[x, y]
            cp[x, y] = (
                round(r + (PAPER[0] - r) * w_),
                round(g + (PAPER[1] - g) * w_),
                round(b + (PAPER[2] - b) * w_),
            )

    out = canvas.resize((FINAL_W, round(TARGET_H * FINAL_W / TARGET_W)), Image.LANCZOS)
    out.save(dst, "JPEG", quality=JPEG_Q, optimize=True, progressive=True)
    print(f"{dst.name}: {out.size[0]}x{out.size[1]} · {dst.stat().st_size // 1024} KB")

if __name__ == "__main__":
    for name in ("tasks", "calendar", "focus", "stats"):
        src = HERE / f"bg-{name}-v2.png"
        dst = HERE.parent / f"bg-{name}.jpg"
        build(src, dst)
