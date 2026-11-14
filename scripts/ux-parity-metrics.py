#!/usr/bin/env python3
"""UX 对照读数表：把归档的 uiautomator dump 汇总成一张可复验的表

## 为什么要有它

`docs/plans/ux-parity-checklist.md` 里每一格读数都是我从 dump 里手算的。
手算的东西**没法复验** —— 半年后没人知道那个"44dp"是量的哪个节点。

这个脚本只做一件事：对每个 `heyta-*.xml` / `ticktick-*.xml` 输出四项读数，
**口径写死**，谁跑都是同一张表：

| 列 | 口径 |
|---|---|
| 可点行高 | `clickable=true` 且高 ≥60px 的节点，去重后升序（px 与 dp 并排） |
| 相邻行距 | 相邻两个可点行的 y 差，落在 [60,400] px 内才计（排除分组跳变） |
| 文字左缘 | 所有带文字节点的 x 去重后计数（**对齐轴的条数**） |
| 最小触控 | 可点节点里最小的那一个（宽,高）—— 排除被屏幕/底栏裁切的 |

用法：
    scripts/ux-parity-metrics.py                     # 全部
    scripts/ux-parity-metrics.py --side heyta        # 只看一端
    scripts/ux-parity-metrics.py --md                # 输出 Markdown 表
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import sys
import xml.etree.ElementTree as ET

DENSITY = 3          # 1156x2510 / density 480
SCREEN_HEIGHT = 2510
TAB_BAR_TOP = 2258
STATUS_BAR_BOTTOM = 100


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--dir", default="apps/mobile/evidence/ux-parity-20261114")
    p.add_argument("--side", choices=["heyta", "ticktick", "both"], default="both")
    p.add_argument("--md", action="store_true", help="输出 Markdown 表")
    return p.parse_args()


def clip_excluded(y0: int, y1: int) -> bool:
    if y1 <= STATUS_BAR_BOTTOM or y0 >= SCREEN_HEIGHT - 2:
        return True
    if abs(y1 - TAB_BAR_TOP) <= 3 or abs(y0 - TAB_BAR_TOP) <= 3:
        return True
    return False


def analyse(path: str) -> dict:
    root = ET.parse(path).getroot()
    clickable: list[tuple[int, int, int]] = []   # (y, h, w)
    lefts: set[int] = set()
    min_w = None
    min_h = None

    for node in root.iter():
        box = list(map(int, re.findall(r"\d+", node.get("bounds") or "")))
        if len(box) != 4:
            continue
        x0, y0, x1, y1 = box
        w, h = x1 - x0, y1 - y0
        if w <= 0 or h <= 0:
            continue
        text = (node.get("text") or node.get("content-desc") or "").strip()
        if text:
            lefts.add(x0)
        if node.get("clickable") != "true" or clip_excluded(y0, y1):
            continue
        # 整屏宽的节点是 Modal 的关闭遮罩（点哪儿都关），不是"行"。
        if w >= 1156 - 8:
            continue
        clickable.append((y0, h, w))
        if min_w is None or w < min_w:
            min_w = w
        if min_h is None or h < min_h:
            min_h = h

    clickable.sort()
    heights = sorted({h for _, h, _ in clickable if h >= 60})
    steps: list[int] = []
    prev = None  # (y, h)
    for y, h, _ in clickable:
        if prev is not None:
            # 🔴 量的是**间隙**（y 差 − 前一行的高度），不是"行起点差"。
            # 第一版直接记 `y - prevY`，于是 52dp 里含了 44dp 行高 ——
            # 读出来的"大间距 52/57/66"其实是"行高 + 间距"的组合，
            # 按它去收敛会把行高当成间距调。口径错了，后面全错。
            gap = y - (prev[0] + prev[1])
            if 0 <= gap <= 400:
                steps.append(gap)
        prev = (y, h)

    # ── 排版读数（2026-11-14 加）────────────────────────────────────
    # 这三条是因为"组标题比内容还小、还更靠右"那一类错**一条结构判据都抓不到**。
    # 口径：只看带文字节点（clickable 与否无关），按 y 排。
    texts = []
    root2 = ET.parse(path).getroot()
    for node in root2.iter():
        text = (node.get("text") or node.get("content-desc") or "").strip()
        box = list(map(int, re.findall(r"\d+", node.get("bounds") or "")))
        if not text or len(box) != 4:
            continue
        x0, y0, x1, y1 = box
        if y1 - y0 <= 0 or clip_excluded(y0, y1):
            continue
        texts.append((y0, x0, y1 - y0, text, x1, y1))
    texts.sort()
    # 🔴 **排除被别的节点包含的节点**：uiautomator 的树里一个"行"常同时出现
    # 三层（容器 / 可点行 / 里面的文字），三层 y 各不相同，于是"相邻间隙"
    # 里混进了嵌套差（task-detail 的 19/20/24 就是这么来的）。
    # 口径：如果一个节点的 bounds 完全被另一个**更晚出现**的节点包含，就只留后者。
    outer = []
    for t in texts:
        y0, x0, h, txt, x1, y1 = t
        contained = any(
            o[0] <= y0 and o[1] <= x0 and o[4] >= x1 and o[5] >= y1
            for o in texts
            if o is not t and (o[5] - o[0]) > (y1 - y0)
        )
        if not contained:
            outer.append(t)
    texts = [(t[0], t[1], t[2], t[3]) for t in outer]
    texts.sort()

    # ① 「小标题 + 紧跟一串更大的同 x 文本」= 组标题（高度比 < 1 是层级的硬伤）
    heading_ratios = []
    for i, (y, x, h, _t) in enumerate(texts[:-1]):
        nxt = texts[i + 1]
        if nxt[1] != x:
            continue
        # 组标题比紧随其后的那一条明显小（< 0.9 倍高度）
        if h / max(nxt[2], 1) < 0.9 and nxt[0] - y <= 120:
            heading_ratios.append((round(h / max(nxt[2], 1), 2), y, x))

    # ② 组间/块间间距的**档位**（> 16dp，且差 ≤4dp 视为同一档）
    #
    # 🔴 ±6dp 聚类不是放宽，是**测量分辨率的诚实**：
    # `task-detail` 实测出的三档是 19 / 20 / 24dp —— 对应原始 57 / 60 / 72px。
    # 57 与 60 只差 3px，是同一个设计值在**不同行高取整**下的差（16px 正文的
    # lineHeight 28 与 30 差 2px，加 1px 分隔线就是 3px）。把它们读成两个档位，
    # 会逼着人去改本来正确的代码。60 与 72 差 12px（4dp）才是真的不同档。
    # 容差取 6：跨过 5dp 的取整噪声，仍在 12px 的真实差之下。
    raw_big = sorted({s // DENSITY for s in steps if s // DENSITY > 16})
    big_steps = []
    for v in raw_big:
        if not big_steps or v - big_steps[-1] > 6:
            big_steps.append(v)

    return {
        "clickable": len(clickable),
        "heights": heights,
        "steps": sorted(set(steps)),
        "lefts": len(lefts),
        "min_target": (min_w, min_h),
        "heading_ratios": heading_ratios,
        "big_steps": big_steps,
    }


def fmt_px(v: int) -> str:
    return f"{v}({v // DENSITY})"


def main() -> int:
    args = parse_args()
    pattern = os.path.join(args.dir, "*.xml")
    files = sorted(glob.glob(pattern))
    if args.side != "both":
        files = [f for f in files if os.path.basename(f).startswith(args.side)]

    if not files:
        print(f"没有找到 xml（{pattern}）", file=sys.stderr)
        return 2

    if args.md:
        print("| 界面 | 可点行 | 行高档位 (px=dp) | 相邻行距 (px=dp) | 文字左缘 | 大间距种数 | 组标题高度比 |")
        print("|---|---|---|---|---|---|---|")
        for f in files:
            name = os.path.basename(f)[:-4]
            m = analyse(f)
            hs = " / ".join(fmt_px(h) for h in m["heights"][:5]) or "—"
            ss = " / ".join(fmt_px(s) for s in m["steps"][:5]) or "—"
            hr = m["heading_ratios"]
            hr_s = " / ".join(f"{r[0]}@y{r[1]}" for r in hr[:3]) if hr else "—"
            print(
                f"| `{name}` | {m['clickable']} | {hs} | {ss} | {m['lefts']} "
                f"| {len(m['big_steps'])} | {hr_s} |"
            )
        return 0

    for f in files:
        name = os.path.basename(f)[:-4]
        m = analyse(f)
        hs = " ".join(fmt_px(h) for h in m["heights"][:6]) or "—"
        ss = " ".join(fmt_px(s) for s in m["steps"][:6]) or "—"
        mw, mh = m["min_target"] if m["min_target"] else (0, 0)
        print(f"{name}")
        print(f"  可点行 {m['clickable']} ｜ 行高 {hs} ｜ 行距 {ss}")
        print(f"  文字左缘 {m['lefts']} 条 ｜ 最小触控 {mw}×{mh}px = {mw // DENSITY}×{mh // DENSITY}dp")
    return 0


if __name__ == "__main__":
    sys.exit(main())
