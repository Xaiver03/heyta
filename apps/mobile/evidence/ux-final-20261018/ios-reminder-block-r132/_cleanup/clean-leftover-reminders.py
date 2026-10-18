#!/usr/bin/env python3
"""把 r132 前三趟（探针有缺陷的那几趟）留在验收机上的提醒清掉。

为什么必须清：探针当时按精确串「删除提醒」找删除键，**没找到就静默走完** ⇒ 那条
「+1 小时」的提醒还挂在任务上，到点会真的发一条本地通知。
只扫 `Rem132*`（本会话自己建的任务标题前缀），不碰别人的任务。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROBE = HERE.parent / "probe-reminder-block.py"
ROOT = HERE.parents[5]

spec = importlib.util.spec_from_file_location("r132_probe", PROBE)
PR = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(PR)
JU = PR.JU
AX = PR.AX
T = PR.T


def sheet_is_open(probe) -> bool:
    """详情面板开没开，用**它独有的**那枚关闭键判，不用"树里节点变多了"当代理。"""
    nodes = probe.tree()
    labels = {AX.label_of(n) or "" for n in nodes}
    return any(l in {T("关闭任务详情", "Close task detail"), T("关闭", "Close")} for l in labels)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--udid", required=True)
    ap.add_argument("--prefix", default="Rem132")
    ap.add_argument("--idb", default=str(Path.home() / ".heyta-tools/idb/venv/bin/idb"))
    ap.add_argument("--companion", default=str(Path.home() / ".heyta-tools/idb/idb_companion"))
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    probe = JU.Probe(argparse.Namespace(
        idb=a.idb, companion=a.companion, udid=a.udid, timeout=12.0, evidence_dir=str(out)))
    probe.ensure_on_tasks()

    # 列表一屏装不下 ⇒ 先边滚边**累计**，别只扫首屏（漏一枚就等于没清）。
    # ⚠️ 行标签不是裸标题，是「打开任务：Rem132…」这种整句 —— 上一版按 startswith 扫，
    # 收了 0 枚然后打印得像"没有残留"，其实一条都没匹配上（absent ≠ 不存在）。
    OPEN = T("打开任务：{title}", "Open task: {title}")
    titles: set[str] = set()
    for i in range(6):
        nodes = probe.tree()
        before = len(titles)
        for n in nodes:
            l = AX.label_of(n) or ""
            if a.prefix not in l:
                continue
            t = l.split(a.prefix, 1)[-1].strip()
            for cand in (t, a.prefix + t if not t.startswith(a.prefix) else t):
                if cand.startswith(a.prefix):
                    titles.add(cand)
                    break
        if i and len(titles) == before:
            break
        AX.idb_swipe(a.idb, a.companion, a.udid, 200, 620, 200, 300, 0.3)
        time.sleep(0.8)
    probe.ensure_on_tasks()
    ordered = sorted(titles)
    report = {"prefix": a.prefix, "openLabelShape": OPEN, "titlesCollected": ordered, "tasks": []}

    for title in ordered:
        one = {"title": title}
        try:
            probe.tap((JU.open_task_label(title),), f"open {title}")
        except JU.ProbeError as exc:
            one["verdict"] = f"row-not-tappable: {str(exc)[:160]}"
            report["tasks"].append(one)
            probe.ensure_on_tasks()
            continue
        one["sheetOpen"] = sheet_is_open(probe)
        if not one["sheetOpen"]:
            one["verdict"] = "sheet-did-not-open"
            report["tasks"].append(one)
            continue
        node, screen, ok = PR.scroll_into_view(probe, (PR.REMINDER_TITLE,))
        one["reminderSectionFound"] = node is not None
        one["scrolledIntoView"] = ok
        one["before"] = PR.rows_for(probe, [PR.EMPTY, PR.SCHEDULED, PR.REMOVE])
        had = [r for r in one["before"] if r.get("present") and r["label"] != PR.EMPTY]
        one["hadReminder"] = bool(had)
        if had:
            one["taps"] = [PR.tap_label(probe, (PR.REMOVE,), f"remove on {title}")]
            time.sleep(1.5)
            one["after"] = PR.rows_for(probe, [PR.EMPTY, PR.SCHEDULED, PR.REMOVE])
            one["backToEmpty"] = any(r.get("present") for r in one["after"] if r["label"] == PR.EMPTY)
        try:
            probe.tap((T("关闭任务详情", "Close task detail"), T("关闭", "Close")), f"close {title}")
        except JU.ProbeError as exc:
            one["closeError"] = str(exc)[:200]
            probe.ensure_on_tasks()
        report["tasks"].append(one)

    (out / "cleanup.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
