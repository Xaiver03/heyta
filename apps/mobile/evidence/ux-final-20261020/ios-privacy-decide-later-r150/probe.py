#!/usr/bin/env python3
"""r150：首屏隐私卡右上角那枚 ✕（AX 名 `Decide later` / 词条 `common.privacy.consent.close`）走的是哪条路。

台账那一格（"顺带照出两条新的"第 ② 条）登记的是：**两端脚本的任何候选里都没有这枚 ✕**
⇒ "稍后再决定"这条路从来没有设备腿读数。本探针就是补那一格，跑在**自建的一次性模拟器**上
（全新安装态才会有那张卡；⚠️ 不许在共享那台 `heyta-iphone-17pro` 上 uninstall 造这个态）。

它量四件事，逐件写进 `probe.json`：
1. 首屏那张卡上**实际在场**的标签与那枚 ✕ 的 AX 名 / frame（语言由树回读，不按系统域推 —— 陷阱 #488）；
2. 点掉它之后屏幕上剩下什么（是首页？还是仍然停在卡上？）；
3. **杀掉再开**之后那张卡回不回来 —— 这一件才是产品问题：没做过决定的设备重启后应该重新问一次；
4. 那三趟之间 `device_pref` 里 `privacy.consent` 那枚键**有没有被写进一行**
   （没决定 ≠ 决定"不同意"：写行了就是替用户做了一个他没做过的决定）。

用法：
    xcrun simctl create heyta-r150-privacy-later <devicetype> <runtime>
    xcrun simctl boot $U && xcrun simctl install $U apps/mobile/ios/build/.../Heyta.app
    python3 probe.py --udid $U --out .
"""
from __future__ import annotations

import argparse
import glob
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
SHIM = ROOT / "scripts" / "tools" / "ios-ax-shim.py"
BUNDLE = ROOT / "apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app"
SPEC = importlib.util.spec_from_file_location("heyta_ios_ax_shim_r150", SHIM)
assert SPEC and SPEC.loader
AX = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AX)

IDB = Path.home() / ".heyta-tools/idb/venv/bin/idb"
COMPANION = Path.home() / ".heyta-tools/idb/idb_companion"
CLOSE_CANDIDATES = ("Decide later", "以后再说")
SHEET_ANCHORS = ("Agree and connect", "同意并联网", "This device only", "只用本机")


def simctl(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["xcrun", "simctl", *args], capture_output=True, text=True, timeout=120)


def tree(udid: str) -> list[dict[str, Any]]:
    return AX.dump_nodes(str(IDB), str(COMPANION), udid, attempts=4)


def labels(nodes: list[dict[str, Any]]) -> list[str]:
    return [v for n in nodes if (v := AX.label_of(n))]


def shot(udid: str, out: Path, name: str) -> str | None:
    path = out / f"{name}.png"
    r = subprocess.run(["xcrun", "simctl", "io", udid, "screenshot", str(path)],
                       capture_output=True, text=True, timeout=120)
    return f"{path}:{path.stat().st_size}" if r.returncode == 0 and path.exists() and path.stat().st_size else None


def consent_rows(udid: str) -> dict[str, Any]:
    """读 `device_pref` 表里 privacy 那几枚键。找不到库就报 `db-not-found`，不许当成"没有行"。"""
    data = Path(os.environ["HOME"]) / "Library/Developer/CoreSimulator/Devices" / udid / "data"
    # iOS 那枚库住在 `Library/`，Android 那枚在 `databases/`（r117 装置事实 4 说的是后者）——
    # 只按 Android 的形状找会回 `not-found`，而 `not-found` **不等于**"没有那一行"。
    patterns = ("Containers/Data/Application/*/Library/*device-prefs*",
                "Containers/Data/Application/*/databases/*device-prefs*")
    hits = [p for pat in patterns for p in glob.glob(str(data / pat)) if not p.endswith(("-wal", "-shm"))]
    if not hits:
        return {"db": "not-found", "rows": []}
    db = max(hits, key=lambda p: Path(p).stat().st_mtime)
    try:
        # 只读 + immutable：应用此刻是 terminate 状态，不复制副本就不留一份带用户数据的库在盘上。
        con = sqlite3.connect(f"file:{db}?mode=ro&immutable=1", uri=True)
        rows = con.execute("select key, value from device_pref").fetchall()
        con.close()
    except sqlite3.Error as exc:  # 读不出来必须响亮，不能空集
        return {"db": str(db), "error": str(exc), "rows": []}
    return {"db": str(db), "rows": [{"key": k, "value": (v or "")[:160]} for k, v in rows]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--udid", required=True)
    ap.add_argument("--out", default=str(HERE))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    res: dict[str, Any] = {
        "udid": args.udid,
        "artifact": {"bundle": str(BUNDLE),
                     "jsbundleSha256": subprocess.run(["shasum", "-a", "256", str(BUNDLE / "main.jsbundle")],
                                                      capture_output=True, text=True).stdout.split()[0]},
        "steps": [],
    }

    simctl("terminate", args.udid, "com.heyta")
    time.sleep(1.0)
    launched = simctl("launch", args.udid, "com.heyta")
    res["launch"] = {"rc": launched.returncode, "stderr": launched.stderr.strip()[:200]}
    if launched.returncode != 0:
        (out / "probe.json").write_text(json.dumps(res, ensure_ascii=False, indent=2))
        return 1
    time.sleep(5.0)

    nodes = tree(args.udid)
    sheet = [a for a in SHEET_ANCHORS if any(a in l for l in labels(nodes))]
    close_node = next((AX.find(nodes, c, True, False, None, False, 0) for c in CLOSE_CANDIDATES
                       if AX.find(nodes, c, True, False, None, False, 0) is not None), None)
    res["steps"].append({
        "step": "first-launch",
        "sheetAnchorsPresent": sheet,
        "closeNode": None if close_node is None else {
            "label": AX.label_of(close_node), "frame": list(AX.frame_of(close_node)),
            "pressable": AX.is_pressable(close_node), "enabled": AX.is_enabled(close_node)},
        "labels": labels(nodes)[:60],
        "shot": shot(args.udid, out, "01-first-launch"),
    })
    res["consent"] = {"before": consent_rows(args.udid)}
    if close_node is None:
        res["verdict"] = "close-button-not-found —— 这张卡上没有那枚 ✕（或它不叫这两个名字），本趟不证任何事"
        (out / "probe.json").write_text(json.dumps(res, ensure_ascii=False, indent=2))
        return 1

    x, y = AX.center(close_node)
    tapped = subprocess.run([str(IDB), *AX.companion_args(str(COMPANION)), "ui", "tap", str(x), str(y),
                             "--udid", args.udid], capture_output=True, text=True, timeout=60)
    time.sleep(2.5)
    after = tree(args.udid)
    after_labels = labels(after)
    res["steps"].append({
        "step": "after-tap-close", "tapRc": tapped.returncode,
        "sheetStillPresent": [a for a in SHEET_ANCHORS if any(a in l for l in after_labels)],
        "closeStillPresent": [c for c in CLOSE_CANDIDATES if any(c in l for l in after_labels)],
        "labels": after_labels[:60],
        "shot": shot(args.udid, out, "02-after-tap-close"),
    })
    res["consent"]["afterTap"] = consent_rows(args.udid)

    simctl("terminate", args.udid, "com.heyta")
    time.sleep(1.5)
    simctl("launch", args.udid, "com.heyta")
    time.sleep(5.0)
    relaunched = tree(args.udid)
    relabels = labels(relaunched)
    res["steps"].append({
        "step": "after-relaunch",
        "sheetBack": [a for a in SHEET_ANCHORS if any(a in l for l in relabels)],
        "labels": relabels[:60],
        "shot": shot(args.udid, out, "03-after-relaunch"),
    })
    res["consent"]["afterRelaunch"] = consent_rows(args.udid)

    (out / "probe.json").write_text(json.dumps(res, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "done", "probe": str(out / "probe.json"),
                      "closeLabel": res["steps"][0]["closeNode"],
                      "sheetAfterTap": res["steps"][1]["sheetStillPresent"],
                      "sheetBackOnRelaunch": res["steps"][2]["sheetBack"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
