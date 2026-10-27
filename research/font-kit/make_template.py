"""生成「手写字格模板」A4 三页 + 机读 manifest。

设计要点（决定后续能否无损矢量化）：
  1. 三页共用同一套格子尺寸（26×30mm），手写尺度才一致 —— 尺度不一致，
     矢量化后合进同一套 UPM 会立刻错位。
  2. 参考线按真实字体比例摆放（asc 1.0 / cap 0.72 / xheight 0.52 / desc -0.27），
     归一化只需线性映射一次，不必逐字猜基线。
  3. 格子顶部留一条独立标签带，字符标签永远不压到 ascender 线。
  4. manifest.json 记录每格 mm 坐标，裁切不靠肉眼数格子。
"""
import json, string

A4_W, A4_H = 210.0, 297.0
CELL_W, CELL_H = 26.0, 30.0
COLS = 6
GRID_TOP = 48.0
LEFT = (A4_W - COLS * CELL_W) / 2

# 垂直比例：descender=0 … ascender=1（真实字体典型值）
G = {"ascender": 1.0, "cap": 0.72, "xheight": 0.52, "baseline": 0.27, "descender": 0.0}
BAND_TOP_PAD = 6.5     # 标签带高度
BAND_BOT_PAD = 2.0
BAND_X_PAD = 1.6

UPPER, LOWER, DIGITS = list(string.ascii_uppercase), list(string.ascii_lowercase), list(string.digits)
PUNCT = (list(".,:;!?'\"")          # 标点
         + list("()[]{}<>")              # 括号
         + list("-_/\\|+=*")            # 线、运算
         + list("%&@#$^~`")             # 修饰
         + ["°", "©"])                  # 单位、版权

PAGES = [
    ("大写与数字", UPPER + DIGITS, "数字请按等宽思路写 —— 后面要做 tabular figures，宽度不一致计时器会跳。"),
    ("小写", LOWER, "中间那条实线是 x-height：所有小写的腰必须落在它上面，写歪整套字会上下跳。"),
    ("标点与符号", PUNCT, "标点不必写满格宽，居中偏左即可；字宽我后面按用途统一。"),
]

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

pages_svg, cells, idx = [], [], 0

for pi, (title, chars, note) in enumerate(PAGES, start=1):
    rows = -(-len(chars) // COLS)
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{A4_W}mm" height="{A4_H}mm" '
         f'viewBox="0 0 {A4_W} {A4_H}" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">',
         f'<rect width="{A4_W}" height="{A4_H}" fill="#ffffff"/>']
    o.append(f'<text x="{LEFT}" y="19" font-size="5.6" font-weight="700" fill="#111111">手写字格模板 · 第 {pi} 页 / 共 3 页 · {esc(title)}</text>')
    o.append(f'<text x="{LEFT}" y="27" font-size="3.0" fill="#4a5058">{esc(note)}</text>')
    o.append(f'<text x="{LEFT}" y="32.5" font-size="3.0" fill="#4a5058">写法：0.6–0.8mm 黑笔 · 单笔画不连笔 · 一格一字 · 慢写写匀 · 笔画别超出格子</text>')
    # 图例：把五条线的位置关系说清，比纯文字可靠
    o.append(f'<text x="{LEFT}" y="38" font-size="3.0" fill="#4a5058">每条线自上而下：'
             f'<tspan fill="#9fb0c6">ascender</tspan> · <tspan fill="#9fb0c6">cap</tspan> · '
             f'<tspan fill="#5f87b8">x-height</tspan> · <tspan fill="#2f5f9e">baseline</tspan> · '
             f'<tspan fill="#c2cbd8">descender</tspan>（ascender 与 descender 就是书写区的上下边界）</text>')

    for k, ch in enumerate(chars):
        r, c = divmod(k, COLS)
        x, y = LEFT + c * CELL_W, GRID_TOP + r * CELL_H
        idx += 1
        # 格子外框
        o.append(f'<rect x="{x}" y="{y}" width="{CELL_W}" height="{CELL_H}" fill="none" stroke="#c9d1dc" stroke-width="0.3"/>')
        # 标签带
        o.append(f'<rect x="{x}" y="{y}" width="{CELL_W}" height="{BAND_TOP_PAD}" fill="#f4f6f9"/>')
        o.append(f'<line x1="{x}" y1="{y+BAND_TOP_PAD}" x2="{x+CELL_W}" y2="{y+BAND_TOP_PAD}" stroke="#c9d1dc" stroke-width="0.25"/>')
        o.append(f'<text x="{x+1.8}" y="{y+4.6}" font-size="4.6" fill="#2b3038">{esc(ch)}</text>')
        o.append(f'<text x="{x+CELL_W-1.8}" y="{y+4.2}" font-size="2.2" fill="#aab2bf" text-anchor="end">{idx}</text>')

        top = y + BAND_TOP_PAD
        bot = y + CELL_H - BAND_BOT_PAD
        H = bot - top
        x1, x2 = x + BAND_X_PAD, x + CELL_W - BAND_X_PAD
        # 书写区边界（ascender / descender）
        o.append(f'<line x1="{x1}" y1="{top:.3f}" x2="{x2}" y2="{top:.3f}" stroke="#a8b8cd" stroke-width="0.35"/>')
        o.append(f'<line x1="{x1}" y1="{bot:.3f}" x2="{x2}" y2="{bot:.3f}" stroke="#ccd4e0" stroke-width="0.3"/>')
        for name, col, wid, dash in (
            ("cap",      "#b9c6d9", 0.22, "0.7 0.9"),
            ("xheight",  "#5f87b8", 0.45, "none"),
            ("baseline", "#2f5f9e", 0.7,  "none"),
        ):
            gy = bot - G[name] * H
            d = f' stroke-dasharray="{dash}"' if dash != "none" else ""
            o.append(f'<line x1="{x1}" y1="{gy:.3f}" x2="{x2}" y2="{gy:.3f}" stroke="{col}" stroke-width="{wid}"{d}/>')
        cells.append({"index": idx, "page": pi, "char": ch, "row": r, "col": c,
                      "x_mm": round(x, 3), "y_mm": round(y, 3), "w_mm": CELL_W, "h_mm": CELL_H,
                      "band": {"x_mm": round(x1, 3), "y_mm": round(top, 3),
                               "w_mm": round(x2 - x1, 3), "h_mm": round(bot - top, 3)},
                      "guide_y_mm": {n: round(bot - f * H, 3) for n, f in G.items()}})

    o.append(f'<text x="{LEFT}" y="{A4_H-12}" font-size="2.7" fill="#8a93a3">扫描：600dpi · 灰度 · 整页不裁不转 · 一页存一页。格子坐标已记在 manifest.json，不用你对齐。</text>')
    o.append(f'<text x="{A4_W-LEFT}" y="{A4_H-12}" font-size="2.7" fill="#8a93a3" text-anchor="end">{pi} / 3</text>')
    o.append('</svg>')
    pages_svg.append("\n".join(o))

html = """<!doctype html><meta charset="utf-8"><title>handwriting grid</title>
<style>
  @page { size: A4; margin: 0; }
  html,body { margin:0; padding:0; background:#fff; }
  .p { width:210mm; height:297mm; page-break-after:always; break-after:page; overflow:hidden; }
  .p:last-child { page-break-after:auto; break-after:auto; }
  svg { display:block; }
</style>
""" + "\n".join(f'<div class="p">{s}</div>' for s in pages_svg)
open("template.html", "w").write(html)

json.dump({"units": "mm", "cell": {"w": CELL_W, "h": CELL_H}, "page": {"w": A4_W, "h": A4_H},
           "guides_ratio": G, "count": len(cells), "cells": cells},
          open("manifest.json", "w"), ensure_ascii=False, indent=1)
print(f"pages=3 cells={len(cells)}")
assert len(cells) == 36 + 26 + 34
