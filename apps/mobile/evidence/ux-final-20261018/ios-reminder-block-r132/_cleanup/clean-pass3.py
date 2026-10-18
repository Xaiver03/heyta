#!/usr/bin/env python3
"""第三趟：只剩 Rem1321792325211 —— 前两趟按"中心点在屏内"就下按，可这一行的中心点
落在**滚动视口之外**（列表底部被裁在 tab 栏上方，屏高 874 但列表可视底约 736）。
本趟的可见判据换成「**整行底边 ≤ tab 栏顶**」，tab 栏顶从树里现量，不写死数字。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("r132_probe", HERE.parent / "probe-reminder-block.py")
PR = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(PR)
JU, AX, T = PR.JU, PR.AX, PR.T
TABS = ["任务", "日历", "专注", "分类", "我的", "Tasks", "Calendar", "Focus", "Lists", "Me"]


def tab_top(nodes) -> int | None:
    """tab 栏顶边。⚠️ 不能对 TABS 直接取 min —— 首屏标题也叫「任务」(y=80)，
    取 min 会把顶栏当成 tab 栏，于是"整行在 tab 栏之上"永远只在行滚出屏幕顶部时才成立。
    只收**下半屏**的那些节点。"""
    ys = [AX.frame_of(n)[1] for n in nodes
          if (AX.label_of(n) or "") in TABS and AX.frame_of(n) and AX.frame_of(n)[1] > 400]
    return int(min(ys)) if ys else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--udid", required=True)
    ap.add_argument("--titles", nargs="+", required=True)
    ap.add_argument("--idb", default=str(Path.home() / ".heyta-tools/idb/venv/bin/idb"))
    ap.add_argument("--companion", default=str(Path.home() / ".heyta-tools/idb/idb_companion"))
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    probe = JU.Probe(argparse.Namespace(idb=a.idb, companion=a.companion, udid=a.udid,
                                        timeout=12.0, evidence_dir=str(out)))
    report = {"tabBarTopSource": "AX 节点 " + "/".join(TABS[:5]) + " 的 frame.y", "tasks": []}

    for title in a.titles:
        one = {"title": title, "log": []}
        probe.ensure_on_tasks(); time.sleep(2.0)
        opened = False
        for i in range(10):
            nodes = probe.tree()
            bar = tab_top(nodes)
            node = next((n for n in nodes if (AX.label_of(n) or "") == JU.open_task_label(title)), None)
            if node is None:
                one["log"].append({"step": i, "found": False, "tabBarTop": bar})
            else:
                x, y, w, h = AX.frame_of(node)
                fits = bar is not None and (y + h) <= bar - 4
                one["log"].append({"step": i, "frame": [x, y, w, h], "tabBarTop": bar, "fullyAboveTabBar": fits})
                if fits:
                    PR.raw_tap(probe, x + w // 2, y + h // 2)
                    time.sleep(2.0)
                    after = probe.tree()
                    labels = {AX.label_of(n) or "" for n in after}
                    if {T("关闭任务详情", "Close task detail"), T("关闭", "Close")} & labels:
                        opened = True
                        break
            AX.idb_swipe(a.idb, a.companion, a.udid, 200, 620, 200, 430, 0.3)
            time.sleep(1.0)
        if not opened:
            one["verdict"] = "detail-still-did-not-open"
            report["tasks"].append(one)
            continue
        PR.scroll_into_view(probe, (PR.REMINDER_TITLE,))
        one["before"] = PR.rows_for(probe, [PR.EMPTY, PR.SCHEDULED, PR.SNOOZE, PR.DISMISS, PR.REMOVE])
        had = [r for r in one["before"] if r.get("present") and r["label"] != PR.EMPTY]
        one["hadReminder"] = bool(had)
        if had:
            one["taps"] = [PR.tap_label(probe, (PR.REMOVE,), f"remove on {title}")]
            time.sleep(1.5)
            one["after"] = PR.rows_for(probe, [PR.EMPTY, PR.SCHEDULED, PR.REMOVE])
            one["backToEmpty"] = any(r.get("present") and r["label"] == PR.EMPTY for r in one["after"])
        probe.screenshot(f"cleanup-pass3-{title}")
        one["verdict"] = "cleaned" if had else "no-reminder"
        report["tasks"].append(one)

    (out / "cleanup-pass3.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2)[:5000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
