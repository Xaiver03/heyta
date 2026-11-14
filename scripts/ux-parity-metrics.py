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
    prev = None
    for y, _, _ in clickable:
        if prev is not None and 60 <= y - prev <= 400:
            steps.append(y - prev)
        prev = y

    return {
        "clickable": len(clickable),
        "heights": heights,
        "steps": sorted(set(steps)),
        "lefts": len(lefts),
        "min_target": (min_w, min_h),
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
        print("| 界面 | 可点行 | 行高档位 (px=dp) | 相邻行距 (px=dp) | 文字左缘 | 最小触控 (px) |")
        print("|---|---|---|---|---|---|")
        for f in files:
            name = os.path.basename(f)[:-4]
            m = analyse(f)
            hs = " / ".join(fmt_px(h) for h in m["heights"][:5]) or "—"
            ss = " / ".join(fmt_px(s) for s in m["steps"][:5]) or "—"
            mw, mh = m["min_target"] if m["min_target"] else (0, 0)
            print(f"| `{name}` | {m['clickable']} | {hs} | {ss} | {m['lefts']} | {mw}×{mh} |")
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
