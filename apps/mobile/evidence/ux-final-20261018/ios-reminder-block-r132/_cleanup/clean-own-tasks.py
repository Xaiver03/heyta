#!/usr/bin/env python3
"""第四趟收尾：把本会话在这台共享验收机上建出来的 17 条测试任务删掉，还回接手时的空列表。

只删**白名单标题**（Rem132* / BulkA* / BulkB*，全是本会话探针建的），且删前先逐枚核对
"树里出现的 打开任务：* 全集 ⊆ 白名单" —— 有外来任务就整批不动，只登记。
可见判据用「整枚按钮底边 ≤ tab 栏顶」，tab 栏顶从树里现量（第三趟那枚 min 撞上顶栏「任务」的教训）。
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
PREFIXES = ("Rem132", "BulkA", "BulkB")
TABS = ["任务", "日历", "专注", "分类", "我的", "Tasks", "Calendar", "Focus", "Lists", "Me"]


def tab_top(nodes):
    ys = [AX.frame_of(n)[1] for n in nodes
          if (AX.label_of(n) or "") in TABS and AX.frame_of(n) and AX.frame_of(n)[1] > 400]
    return int(min(ys)) if ys else None


def row_titles(nodes):
    lab = T("打开任务：{title}", "Open task: {title}")
    out = []
    for n in nodes:
        l = AX.label_of(n) or ""
        if l.startswith(lab.split("{title}")[0]):
            out.append(l.split("：", 1)[-1])
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--udid", required=True)
    ap.add_argument("--idb", default=str(Path.home() / ".heyta-tools/idb/venv/bin/idb"))
    ap.add_argument("--companion", default=str(Path.home() / ".heyta-tools/idb/idb_companion"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--apply", action="store_true", help="不加就只报告白名单命中情况，不删")
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    probe = JU.Probe(argparse.Namespace(idb=a.idb, companion=a.companion, udid=a.udid,
                                        timeout=12.0, evidence_dir=str(out)))
    probe.ensure_on_tasks(); time.sleep(2.0)
    nodes = probe.tree()
    all_titles = row_titles(nodes)
    mine = [t for t in all_titles if t.startswith(PREFIXES)]
    foreign = [t for t in all_titles if not t.startswith(PREFIXES)]
    report = {"titlesInTree": all_titles, "mine": mine, "foreign": foreign, "applied": a.apply, "deletes": []}
    if foreign:
        report["verdict"] = "foreign-tasks-present -> nothing deleted"
        (out / "cleanup-pass4.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    if not a.apply:
        report["verdict"] = "dry-run"
        (out / "cleanup-pass4.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    for title in mine:
        want = T("删除任务：{title}", "Delete task: {title}").format(title=title)
        rec = {"title": title}
        done = False
        for i in range(12):
            nodes = probe.tree()
            bar = tab_top(nodes)
            node = next((n for n in nodes if (AX.label_of(n) or "") == want), None)
            if node is None:
                rec.setdefault("notes", []).append({"step": i, "found": False})
            else:
                x, y, w, h = [round(v) for v in AX.frame_of(node)]
                fits = bar is not None and y > 0 and (y + h) <= bar - 4
                rec.setdefault("notes", []).append({"step": i, "frame": [x, y, w, h], "tabBarTop": bar, "fits": fits})
                if fits:
                    PR.raw_tap(probe, x + w // 2, y + h // 2)
                    time.sleep(1.6)
                    after = row_titles(probe.tree())
                    rec["gone"] = title not in after
                    done = rec["gone"]
                    break
            AX.idb_swipe(a.idb, a.companion, a.udid, 200, 620, 200, 430, 0.3)
            time.sleep(0.9)
        if not done:
            rec["gone"] = title not in row_titles(probe.tree())
        report["deletes"].append(rec)

    probe.ensure_on_tasks(); time.sleep(1.5)
    rest = row_titles(probe.tree())
    report["remainingAfter"] = rest
    report["verdict"] = "empty" if not rest else "rows-still-present"
    probe.screenshot("cleanup-pass4-after")
    (out / "cleanup-pass4.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("mine", "foreign", "verdict", "remainingAfter")},
                     ensure_ascii=False, indent=2))
    print("deletes:", json.dumps([{"t": d["title"], "gone": d.get("gone")} for d in report["deletes"]],
                                 ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
