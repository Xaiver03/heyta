#!/usr/bin/env python3
"""第二趟：只处理第一趟没验到的三枚（底部那行落在 #469 那一族的视口禁区，面板也没开成）。

与第一趟的差别只有两处，都不是放宽判据：
  * 打开任务**自己滚到行中心落进安全带再按中心点**（probe.tap 那条守卫滑不动这一层列表）；
  * "面板开没开"改扫**详情独有**的节点集合，并在按完后等 2 秒（第一趟按完立刻读树，会把开成功的也读成 False）。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]
spec = importlib.util.spec_from_file_location("r132_probe", HERE.parent / "probe-reminder-block.py")
PR = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(PR)
JU, AX, T = PR.JU, PR.AX, PR.T


def detail_markers(probe):
    nodes = probe.tree()
    labels = [AX.label_of(n) or "" for n in nodes]
    return {
        "nodes": len(nodes),
        "close": [l for l in labels if l in {T("关闭任务详情", "Close task detail"), T("关闭", "Close")}],
        "due": [l for l in labels if any(k in l for k in ("截止", "Due", "添加提醒", "Add reminder"))],
    }


def open_row(probe, title: str, max_swipes: int = 8):
    label = JU.open_task_label(title)
    log = []
    for i in range(max_swipes):
        nodes = probe.tree()
        w, h = AX.screen_size(nodes)
        node = next((n for n in nodes if (AX.label_of(n) or "") == label), None)
        if node is None:
            # 不在当前视口的行**根本不进 AX 树** ⇒ "这一轮没找到"要继续滚，不能当成"没有这一行"。
            log.append({"swipe": i, "found": False, "screen": [w, h]})
            AX.idb_swipe(PR_probe_idb, PR_probe_companion, probe.udid, 200, 600, 200, 380, 0.3)
            time.sleep(0.9)
            continue
        cx, cy = AX.center(node)
        inside = 0 < cx < (w or 0) and 0 < cy < (h or 0) - 120
        log.append({"swipe": i, "center": [cx, cy], "screen": [w, h], "insideSafeBand": inside})
        if inside:
            PR.raw_tap(probe, cx, cy)
            return {"found": True, "swipes": i, "tappedAt": [cx, cy], "log": log}
        AX.idb_swipe(PR_probe_idb, PR_probe_companion, probe.udid, 200, 600, 200, 380, 0.3)
        time.sleep(0.9)
    return {"found": True, "swipes": max_swipes, "tappedAt": None, "log": log}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--udid", required=True)
    ap.add_argument("--titles", nargs="+", required=True)
    ap.add_argument("--idb", default=str(Path.home() / ".heyta-tools/idb/venv/bin/idb"))
    ap.add_argument("--companion", default=str(Path.home() / ".heyta-tools/idb/idb_companion"))
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    global PR_probe_idb, PR_probe_companion
    PR_probe_idb, PR_probe_companion = a.idb, a.companion
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    probe = JU.Probe(argparse.Namespace(idb=a.idb, companion=a.companion, udid=a.udid,
                                        timeout=12.0, evidence_dir=str(out)))
    probe.ensure_on_tasks()

    report = {"tasks": []}
    for title in a.titles:
        one = {"title": title}
        one["beforeNodes"] = detail_markers(probe)
        # 一次没开成 ≠ 这一行开不了：列表刚 ensure_on_tasks 起来还在动，读到 y 立刻按下去可能按在别的行上。
        # 重试时先重读树（滚回顶部），最多 3 次。
        for attempt in range(3):
            if attempt:
                probe.ensure_on_tasks()
                time.sleep(2.0)
            one["open"] = open_row(probe, title)
            if not one["open"].get("tappedAt"):
                one["open"]["attempt"] = attempt
                continue
            time.sleep(2.0)
            one["afterTap"] = detail_markers(probe)
            one["open"]["attempt"] = attempt
            if one["afterTap"]["close"] or one["afterTap"]["due"]:
                break
        if not (one.get("afterTap") and (one["afterTap"]["close"] or one["afterTap"]["due"])):
            one["verdict"] = "detail-did-not-open-after-3-tries"
            report["tasks"].append(one)
            probe.ensure_on_tasks()
            continue
        node, screen, ok = PR.scroll_into_view(probe, (PR.REMINDER_TITLE,))
        one["reminderSectionFound"] = node is not None
        one["before"] = PR.rows_for(probe, [PR.EMPTY, PR.SCHEDULED, PR.SNOOZE, PR.DISMISS, PR.REMOVE])
        had = [r for r in one["before"] if r.get("present") and r["label"] != PR.EMPTY]
        one["hadReminder"] = bool(had)
        if had:
            one["taps"] = [PR.tap_label(probe, (PR.REMOVE,), f"remove on {title}")]
            time.sleep(1.5)
            one["after"] = PR.rows_for(probe, [PR.EMPTY, PR.SCHEDULED, PR.REMOVE])
            one["backToEmpty"] = any(r.get("present") and r["label"] == PR.EMPTY for r in one["after"])
        probe.screenshot(f"cleanup-{title}")
        one["shots"] = [f"cleanup-{title}"]
        try:
            probe.tap((T("关闭任务详情", "Close task detail"), T("关闭", "Close")), f"close {title}")
        except JU.ProbeError as exc:
            one["closeError"] = str(exc)[:200]
            probe.ensure_on_tasks()
        one["verdict"] = "cleaned" if had else "no-reminder"
        report["tasks"].append(one)

    (out / "cleanup-pass2.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2)[:6000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
