#!/usr/bin/env python3
"""触控目标审计（读 uiautomator dump）

## 为什么要有它

2026-11-14 一轮对照里，**同一个错在四个不同的屏上各犯了一次**：

| 屏 | 元素 | 实测 | 应为 |
|---|---|---|---|
| 新建面板 | 「收集箱」落点胶囊 | 84px = **28dp** | 44 |
| 任务详情 | 空备注占位行 | 84px = **28dp** | 44 |
| 日历 | 月/周/日/年 切换 tab | 105px = **35dp** 宽 | 44 |
| 通行密钥 | 五个 chip 当按钮 | （已按语义改） | — |

四处的写法各不相同（有的漏 `minHeight`、有的写了高度没写宽度、有的用了"标签胶囊"
那一档 28px），所以**静态扫源码抓不全**。但它们有一个共同的、可测的表现：
**无障碍树里那个可点节点的 bounds 小于 44dp**。

所以判据放在运行时：拿 `uiautomator dump` 的 xml，逐个 `clickable="true"` 的节点量
宽高，低于 `--min-dp` 的报红。

## 口径（写死，别改）

- density 480 ⇒ **÷3 = dp**（本机固定；换机器用 `--density` 覆盖）。
- 只看 `clickable="true"` 的节点。文字节点不算目标（点它不触发任何东西）。
- 排除三类**不是本应用控件**的：状态栏/通知栏（y<100）、底部系统手势条（y>2450）、
  以及整屏遮罩（宽高都 ≈ 屏宽，那是关闭层，点哪儿都行）。
- 宽度与高度**都要** ≥ 下限：横向排列的 tab 最容易只写高度漏宽度。

## 用法

    scripts/audit-tap-targets.py apps/mobile/evidence/ux-parity-20261114/*.xml
    scripts/audit-tap-targets.py --min-dp 48 some.xml

退出码：有违规 ⇒ 1（可接进门禁）；全过 ⇒ 0。
"""

from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET

DEFAULT_MIN_DP = 44

# 🔴 已知用 `hitSlop` 补偿的可点行（dump 的 bounds **不含** hitSlop，所以静态看会偏小）。
# 每次加一条都要写清"为什么这样补是够的"，不许只写个名字了事 ——
# 否则这个集合会变成"看到红就加进来"的豁免名单。
# 现在为空：`SettingsValueRow` 已改成直接给 44dp（撤掉了 hitSlop 补偿），
# 那一族四条（已达成成就 / 系统通知授权 / 精确闹钟 / 提醒不受省电限制）不再需要豁免。
# 按**形状**豁免，不按标签：`packages/ui/src/settings/Settings.tsx` 的
# `SettingsInfoTip` 渲染出来就是"整行宽（353dp）× 16dp 高"的一枚 ? 图标按钮，
# 它用 `hitSlop(space.4=16dp)` 把命中区补到 46dp。按标签写白名单会漏
#（第一版只写了「投诉与举报」，订阅页的「更多说明」就没覆盖到）。
# 紧跟在标签后面的那一种仍然保持这形状 —— 撑到 44dp 会把同一行右侧的值挤开。
HIT_SLOP_ROW_MIN_WIDTH_DP = 300
HIT_SLOP_ROW_MAX_HEIGHT_DP = 20
# 第二种形状：行内紧跟标签的那一枚「?」，16×16dp，同样是 hitSlop 补偿到 48dp。
# 它与整行宽那种是同一个组件（`SettingsInfoTip`），只是宿主给的宽度不同。
ICON_TIP_MAX_DP = 20
DEFAULT_DENSITY = 3  # 1156x2510 / density 480 ⇒ 3px per dp

# 不是本应用控件的区域（px，未除 density）
STATUS_BAR_BOTTOM = 100
SYSTEM_GESTURE_TOP = 2450
SCREEN_WIDTH = 1156
SCREEN_HEIGHT = 2510
# 底部标签栏的顶边。内容滚到底时，最后一行会被它遮住一半 —— dump 记的仍是
# **可见**高度（实测「功能与 AI」321×22dp，底边正好 2258）。那不是控件太小，
# 是它没滚进视口，跳过。写死的道理与 SCREEN_HEIGHT 一样：本机分辨率固定。
TAB_BAR_TOP = 2258


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="扫 uiautomator dump 里的可点目标是否够大")
    p.add_argument("files", nargs="+", help="uiautomator dump 出来的 xml")
    p.add_argument("--min-dp", type=int, default=DEFAULT_MIN_DP)
    p.add_argument("--density", type=int, default=DEFAULT_DENSITY, help="px per dp")
    return p.parse_args()


def bounds(raw: str) -> tuple[int, int, int, int] | None:
    m = list(map(int, re.findall(r"-?\d+", raw or "")))
    return (m[0], m[1], m[2], m[3]) if len(m) == 4 else None


def audit(path: str, min_dp: int, density: int) -> list[str]:
    try:
        root = ET.parse(path).getroot()
    except Exception as exc:  # noqa: BLE001 - 报出来比吞掉好
        return [f"{path}: 解析失败：{exc}"]

    hits: list[str] = []
    for node in root.iter():
        if node.get("clickable") != "true":
            continue
        box = bounds(node.get("bounds", ""))
        if box is None:
            continue
        x0, y0, x1, y1 = box
        w, h = x1 - x0, y1 - y0
        if w <= 0 or h <= 0:
            continue
        # 排除状态栏 / 系统手势条 / 整屏遮罩
        if y1 <= STATUS_BAR_BOTTOM:
            continue
        if y0 >= SYSTEM_GESTURE_TOP:
            continue
        if w >= SCREEN_WIDTH - 8:
            continue
        # 🔴 被屏幕边缘**裁切**的节点不算违规：dump 记的是可见部分，不是真实高度。
        # 第一版没这条，于是「AI 设置」页底部两个预设 Chip（真实 44dp、一半在屏外）
        # 被误报成 29dp —— 一条会误报的尺会被下一个人直接关掉，比没有更糟。
        if y1 >= SCREEN_HEIGHT - 2 or y0 <= 2:
            continue
        # 被底部标签栏裁掉的行同理：可见部分矮，不代表控件矮。
        if abs(y1 - TAB_BAR_TOP) <= 3:
            continue

        wdp, hdp = w / density, h / density
        if wdp + 0.01 < min_dp or hdp + 0.01 < min_dp:
            label = (node.get("text") or node.get("content-desc") or "").strip()
            if (
                hdp <= HIT_SLOP_ROW_MAX_HEIGHT_DP
                and wdp >= HIT_SLOP_ROW_MIN_WIDTH_DP
            ):
                print(f"  （整行宽的 hitSlop 按钮，跳过）{label[:20] or '<无文字>'} {wdp:.0f}×{hdp:.0f}dp")
                continue
            if hdp <= ICON_TIP_MAX_DP and wdp <= ICON_TIP_MAX_DP:
                print(
                    f"  （行内图标 + hitSlop，跳过）{label[:20] or '<无文字>'} {wdp:.0f}×{hdp:.0f}dp"
                    " —— SettingsInfoTip，命中区 16+16×2=48dp"
                )
                continue
            cls = (node.get("class") or "").split(".")[-1]
            short = "宽" if wdp < min_dp else ""
            short += "高" if hdp < min_dp else ""
            hits.append(
                f"  {label[:26] or '<无文字>':<28} {cls:<12} "
                f"{wdp:.0f}×{hdp:.0f}dp  ← 低于 {min_dp}dp（{short}不足）  {node.get('bounds')}"
            )
    return hits


def main() -> int:
    args = parse_args()
    total = 0
    for path in args.files:
        hits = audit(path, args.min_dp, args.density)
        if hits:
            print(f"\n{path.rsplit('/', 1)[-1]}:")
            for line in hits:
                print(line)
            total += len(hits)

    if total == 0:
        print(f"✅ 触控目标：{len(args.files)} 个界面，没有低于 {args.min_dp}dp 的可点目标。")
        return 0

    print(f"\n🔴 触控目标：{len(args.files)} 个界面里共 {total} 处低于 {args.min_dp}dp。")
    print("   修法：给那个 Pressable 加 minHeight（横向排列的还要 minWidth），")
    print("   取值用 tokens['touch-target.min']，不要用 size.chip-height（那是标签胶囊的 28px）。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
