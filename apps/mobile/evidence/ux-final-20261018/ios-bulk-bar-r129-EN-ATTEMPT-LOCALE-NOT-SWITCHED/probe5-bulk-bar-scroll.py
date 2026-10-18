#!/usr/bin/env python3
"""r127 探针：iOS 批量操作条那枚"被右边缘切掉的第三枚按钮"到底是**可滚**还是**真溢出**。

r124 只留下两张图（两种语态都把第三枚画到视口外），图上分不出这两件事 ——
台账 375 设置导航那一格立过口径：**先读容器的可滚形状，再判图上位置**。iOS 这一侧没有 CSS 可读，
所以换成**行为判据**：在操作条那一条 y 带里做一次向左的滑动，再读同一批按钮的 frame ——

  * x 位移了 ⇒ 它是横向可滚的容器，图上位置只是"滚到当前项"，**不是缺陷**（与 375 那一格同形）；
  * x 一动没动、而仍有一枚的 `x + width > 屏宽` ⇒ 内容画到视口外且滚不到，**是真溢出**。

两种结论都要留原话读数（每枚按钮的 label / frame / 是否在视口内 / 滑动前后差值）与两张图。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
JOURNEY = ROOT / "scripts" / "qa" / "tasks-ux-ios.py"

spec = importlib.util.spec_from_file_location("heyta_tasks_ux_ios", JOURNEY)
JU = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(JU)
AX = JU.AX
T = JU.T


def band_nodes(probe, anchor_label: str, pad: int = 70):
    """读操作条那一横带里的所有带标签节点（含锚点本身所在的行）。"""
    nodes = probe.tree()
    width, height = AX.screen_size(nodes)
    anchor = None
    for node in nodes:
        if (AX.label_of(node) or "") == anchor_label:
            anchor = node
            break
    if anchor is None:
        return width, height, None, []
    ax, ay, _aw, ah = AX.frame_of(anchor)
    lo, hi = ay - pad, ay + ah + pad
    rows = []
    for node in nodes:
        label = AX.label_of(node) or ""
        if not label:
            continue
        x, y, w, h = AX.frame_of(node)
        if lo <= y <= hi:
            rows.append({
                "label": label,
                "frame": [x, y, w, h],
                "x": x,
                "right": x + w,
                "pressable": AX.is_pressable(node) if hasattr(AX, "is_pressable") else bool(node.get("traits")),
                "insideViewport": bool(x >= 0 and x + w <= (width or 0)),
            })
    return width, height, [ax, ay], rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--udid", required=True)
    parser.add_argument("--idb", default=str(Path.home() / ".heyta-tools/idb/venv/bin/idb"))
    parser.add_argument("--companion", default=str(Path.home() / ".heyta-tools/idb/idb_companion"))
    parser.add_argument("--timeout", type=float, default=12.0)
    args = parser.parse_args()

    probe = JU.Probe(argparse.Namespace(
        idb=args.idb, companion=args.companion, udid=args.udid,
        timeout=args.timeout, evidence_dir=str(HERE),
    ))
    out: dict = {"startedAt": time.time(), "udid": args.udid}
    (HERE / "probe5-bulk-bar.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    def save() -> None:
        (HERE / "probe5-bulk-bar.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    stamp = str(int(time.time()))
    task_a, task_b = f"BulkA{stamp}", f"BulkB{stamp}"
    probe.ensure_on_tasks()
    out["uiLocale"] = probe.ui_locale
    save()
    probe.create_task(task_a)
    probe.create_task(task_b)
    save()

    open_a = JU.open_task_label(task_a)
    probe.wait_labels((open_a,), "task row present")
    first = probe.node((open_a,), pressable=True)
    x, y = AX.center(first)
    rc, detail = AX.idb_swipe(probe.idb, probe.companion, probe.udid, x, y, x, y, 1.2)
    if rc != 0:
        raise JU.ProbeError(f"long press transport failed: {detail}")
    probe.wait_labels((T("退出选择", "Exit selection"),), "selection mode")
    probe.tap_list_target((JU.select_task_label(task_b), open_a), "select second task")
    anchor = JU.selected_label(2)
    probe.wait_labels((anchor,), "two selected")
    out["selectionMode"] = True
    save()

    width, height, anchor_xy, before = band_nodes(probe, anchor)
    out["screen"] = [width, height]
    out["anchorXY"] = anchor_xy
    out["before"] = before
    out["clippedBefore"] = [r["label"] for r in before if r["right"] > (width or 0)]
    probe.screenshot("01-before-swipe")
    save()

    # 🔴 滑动必须打在**按钮那一行**上。第一版拿锚点「已选 N 项」的 y 当操作条 y，
    # 而锚点在上一条（计数行），三枚按钮在下一条 —— 那一滑根本没碰到可滚容器，
    # 于是"一动没动"被读成了"真溢出"（读数留档在 probe5-bulk-bar-run2-SWIPE-MISSED-THE-ROW.json）。
    clipped_rows = [r for r in before if r["right"] > (width or 0)] or before
    swipe_row = max(clipped_rows, key=lambda r: r["frame"][1])
    bar_y = swipe_row["frame"][1] + swipe_row["frame"][3] // 2
    out["swipeY"] = {
        "y": bar_y,
        "row": swipe_row["label"],
        "anchorY": anchor_xy[1] if anchor_xy else None,
    }
    rc, detail = AX.idb_swipe(probe.idb, probe.companion, probe.udid,
                              (width or 400) - 40, bar_y, 40, bar_y, 0.6)
    out["swipe"] = {"rc": rc, "detail": str(detail)[:200]}
    time.sleep(1.2)
    _w2, _h2, _a2, after = band_nodes(probe, anchor)
    out["after"] = after
    probe.screenshot("02-after-swipe")

    by_label: dict[str, list[int]] = {}
    for row in before:
        by_label.setdefault(row["label"], []).append(row["x"])
    shifts = []
    for row in after:
        origins = by_label.get(row["label"]) or []
        if origins:
            shifts.append({"label": row["label"], "dx": row["x"] - origins[0]})
    out["shifts"] = shifts
    moved = any(abs(s["dx"]) > 4 for s in shifts)
    still_clipped = [r["label"] for r in after if r["right"] > (out["screen"][0] or 0)]
    out["verdict"] = ("可滚（滑动后 x 位移，图上位置只是滚到当前项）" if moved else
                      ("真溢出：滑动后 x 一动没动，且仍有按钮画到视口外 " + "、".join(still_clipped))
                      if still_clipped else
                      "既没位移也没有画到视口外的按钮 —— 这一趟没复现出裁切")
    out["clippedAfter"] = still_clipped
    out["finishedAt"] = time.time()
    save()
    print(json.dumps({"verdict": out["verdict"], "clippedBefore": out["clippedBefore"],
                      "clippedAfter": still_clipped, "shifts": shifts[:8]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
