#!/usr/bin/env python3
"""r153：装机态复验「以后再说」这条出口**在屏幕上有没有那句话**。

r150 在这台形状上量到的是：可及名称一直是「以后再说」/ `Decide later`，屏幕上却只有一枚 ✕
（`closeNode` 的 frame `[322, 232, 44, 44]` = 一枚图标按钮的方块）。本趟是改过之后的复验。

🔴 判据不许按 role 过滤（`ios-ax-shim.py` 第 163 行那条：AX 的 role 不稳定，
按它过滤的症状是"找不到按钮"）。所以这里量的是三件能数的东西：
1. 这张卡上**带着那几个字**的节点有哪几枚（label / frame / pressable）——
   改前只有 1 枚且是 44×44 的方块；文字真渲染出来时那枚触控区必然变宽，或多出一枚不带 pressable 的文本节点；
2. 点掉之后卡收没收、屏幕上剩下什么（行为没被这次改动碰坏）；
3. 杀掉再开卡回不回 + `device_pref` 里有没有被写行（这两件是 r150 的正面结论，复验它们没被改坏）。

外加一张人眼要看的图：`01-first-launch.png` —— 这句话看得见与否，最终以图为准，
AX 那三件只是让这台装置下次能自己红。

用法（一次性载体，别在共享那台上 uninstall）：
    U=$(xcrun simctl create heyta-r153-privacy-label <devicetype> <runtime>)
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
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
SHIM = ROOT / "scripts" / "tools" / "ios-ax-shim.py"
BUNDLE = ROOT / "apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app"
SPEC = importlib.util.spec_from_file_location("heyta_ios_ax_shim_r153", SHIM)
assert SPEC and SPEC.loader
AX = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AX)

IDB = Path.home() / ".heyta-tools/idb/venv/bin/idb"
COMPANION = Path.home() / ".heyta-tools/idb/idb_companion"
CLOSE_CANDIDATES = ("Decide later", "以后再说")
SHEET_ANCHORS = ("Agree and connect", "同意并联网", "This device only", "只用本机")
# 改前那枚方块实测 44×44（r150 读数）。宽过这个数就说明触控区里装了文字而不只是一枚图标。
ICON_SQUARE = 44.0


def simctl(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["xcrun", "simctl", *args], capture_output=True, text=True, timeout=120)


def tree(udid: str) -> list[dict[str, Any]]:
    return AX.dump_nodes(str(IDB), str(COMPANION), udid, attempts=4)


def labels(nodes: list[dict[str, Any]]) -> list[str]:
    return [v for n in nodes if (v := AX.label_of(n))]


def word_nodes(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """卡上所有带着「以后再说」/ `Decide later` 的节点，逐枚记 label / frame / pressable。"""
    out: list[dict[str, Any]] = []
    for n in nodes:
        label = AX.label_of(n)
        if not label or not any(c in label for c in CLOSE_CANDIDATES):
            continue
        try:
            frame = list(AX.frame_of(n))
        except Exception:  # 取不到 frame 的节点也要留在读数里，不能被 except 吞成"没有这枚"
            frame = []
        out.append({"label": label, "frame": frame, "pressable": AX.is_pressable(n)})
    return out


def verdict(words: list[dict[str, Any]]) -> str:
    if not words:
        return "no-node-carries-the-words —— 树上找不到那句话，本趟不证任何事"
    wider = [w for w in words if len(w["frame"]) == 4 and w["frame"][2] > ICON_SQUARE]
    if wider:
        return f"visible-text（触控区宽 {max(w['frame'][2] for w in wider):.0f} pt > 图标方块 {ICON_SQUARE:.0f} pt）"
    if len(words) > 1:
        return f"visible-text（{len(words)} 枚节点带着那句话，不只一枚图标按钮）"
    return "icon-only（还是只有一枚 44×44 的节点带那句话 ⇒ 屏幕上没有文字）"


def shot(udid: str, out: Path, name: str) -> str | None:
    path = out / f"{name}.png"
    r = subprocess.run(["xcrun", "simctl", "io", udid, "screenshot", str(path)],
                       capture_output=True, text=True, timeout=120)
    return f"{path}:{path.stat().st_size}" if r.returncode == 0 and path.exists() and path.stat().st_size else None


def consent_rows(udid: str) -> dict[str, Any]:
    """读 `device_pref` 里 privacy 那几枚键。找不到库报 `db-not-found`，不许当成"没有行"。"""
    data = Path(os.environ["HOME"]) / "Library/Developer/CoreSimulator/Devices" / udid / "data"
    patterns = ("Containers/Data/Application/*/Library/*device-prefs*",
                "Containers/Data/Application/*/databases/*device-prefs*")
    hits = [p for pat in patterns for p in glob.glob(str(data / pat)) if not p.endswith(("-wal", "-shm"))]
    if not hits:
        return {"db": "not-found", "rows": []}
    db = max(hits, key=lambda p: Path(p).stat().st_mtime)
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro&immutable=1", uri=True)
        rows = con.execute("select key, value from device_pref").fetchall()
        con.close()
    except sqlite3.Error as exc:
        return {"db": str(db), "error": str(exc), "rows": []}
    return {"db": str(db), "rows": [{"key": k, "value": (v or "")[:160]} for k, v in rows]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--udid", required=True)
    ap.add_argument("--out", default=str(HERE))
    ap.add_argument("--dismiss-only", action="store_true",
                    help="只读到卡、取一次读数、按掉那句话就退出（英文档那一腿要先把卡收掉才走得到设置面）")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    res: dict[str, Any] = {
        "udid": args.udid,
        "artifact": {"bundle": str(BUNDLE),
                     "jsbundleSha256": subprocess.run(["shasum", "-a", "256", str(BUNDLE / "main.jsbundle")],
                                                      capture_output=True, text=True).stdout.split()[0]},
        "iconSquarePt": ICON_SQUARE,
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
    words = word_nodes(nodes)
    close_node = next((AX.find(nodes, c, True, False, None, False, 0) for c in CLOSE_CANDIDATES
                       if AX.find(nodes, c, True, False, None, False, 0) is not None), None)
    res["steps"].append({
        "step": "first-launch",
        "sheetAnchorsPresent": sheet,
        "wordNodes": words,
        "visibleLabel": verdict(words),
        "closeNode": None if close_node is None else {
            "label": AX.label_of(close_node), "frame": list(AX.frame_of(close_node)),
            "pressable": AX.is_pressable(close_node), "enabled": AX.is_enabled(close_node)},
        "shot": shot(args.udid, out, "01-first-launch"),
    })
    res["consent"] = {"before": consent_rows(args.udid)}
    if close_node is None:
        res["verdict"] = "close-button-not-found —— 这张卡上没有那句话（或它不叫这两个名字），本趟不证任何事"
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
        "labels": after_labels[:40],
        "shot": shot(args.udid, out, "02-after-tap-close"),
    })
    res["consent"]["afterTap"] = consent_rows(args.udid)

    if args.dismiss_only:
        # 英文档那一腿：卡必须先收掉才走得到设置面（切语言），但**不许**在这一步判收尾
        # —— 收尾（重启看卡回不回）由后面那次完整跑做，这里只交"按掉了"这一件。
        (out / "probe-dismiss.json").write_text(json.dumps(res, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"status": "dismissed", "visibleLabel": res["steps"][0]["visibleLabel"],
                          "sheetAfterTap": res["steps"][1]["sheetStillPresent"]}, ensure_ascii=False))
        return 0

    simctl("terminate", args.udid, "com.heyta")
    time.sleep(1.5)
    simctl("launch", args.udid, "com.heyta")
    time.sleep(5.0)
    relaunched = tree(args.udid)
    relabels = labels(relaunched)
    res["steps"].append({
        "step": "after-relaunch",
        "sheetBack": [a for a in SHEET_ANCHORS if any(a in l for l in relabels)],
        "wordNodesBack": word_nodes(relaunched),
        "shot": shot(args.udid, out, "03-after-relaunch"),
    })
    res["consent"]["afterRelaunch"] = consent_rows(args.udid)

    (out / "probe.json").write_text(json.dumps(res, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "done", "probe": str(out / "probe.json"),
                      "visibleLabel": res["steps"][0]["visibleLabel"],
                      "wordNodes": res["steps"][0]["wordNodes"],
                      "sheetAfterTap": res["steps"][1]["sheetStillPresent"],
                      "sheetBackOnRelaunch": res["steps"][2]["sheetBack"],
                      "consentRows": [len(v["rows"]) for v in res["consent"].values()]},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
