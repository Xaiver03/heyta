#!/usr/bin/env python3
"""用产品自己的语言开关把已安装的 Heyta 切到 en / zh，并取证。

形状跟着 `scripts/qa/profile-settings-android.py` 那一支（我的 → 设置 → 常规 → 语言 →
English/中文），这里只借它的**导航路径与那两枚语言名**，不跑整条旅程，
因为旅程末尾会自己把语言改回中文（那正是本趟要先破的假设）。
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import time
from pathlib import Path
from xml.etree import ElementTree as ET

PKG = "com.heyta"
ACTIVITY = "com.heytamobile.MainActivity"
PATHS = {
    "en": ["我的", "设置", "常规", "语言", "English"],
    "zh": ["Profile", "Settings", "General", "Language", "中文"],
}
PROOF = {"en": ("Tasks", "New task"), "zh": ("任务", "新建任务")}


def adb(serial: str, *args: str, check: bool = True) -> str:
    r = subprocess.run(["adb", "-s", serial, *args], capture_output=True, text=True, timeout=45)
    if check and r.returncode != 0:
        raise SystemExit(f"adb {' '.join(args)} failed: {(r.stderr or r.stdout).strip()[:300]}")
    return r.stdout


def tree(serial: str, out: Path) -> ET.ElementTree:
    raw = adb(serial, "exec-out", "uiautomator", "dump", "/sdcard/ui.xml")
    if "UI hierarchy" not in raw:
        time.sleep(1.0)
    data = subprocess.run(
        ["adb", "-s", serial, "exec-out", "cat", "/sdcard/ui.xml"],
        capture_output=True, timeout=45,
    ).stdout
    out.write_bytes(data)
    return ET.fromstring(data.decode("utf-8", "replace"))


def parse_bounds(raw: str) -> tuple[int, int, int, int] | None:
    nums = [int(v) for v in re.findall(r"-?\d+", raw)]
    return tuple(nums) if len(nums) == 4 else None  # type: ignore[return-value]


def find(root, wanted: str):
    for node in root.iter("node"):
        if wanted in (node.get("text") or "", node.get("content-desc") or ""):
            b = node.get("bounds", "")
            if not b:
                continue
            rect = parse_bounds(b)
            if rect is None:
                continue
            if node.get("visible-to-user") == "false":
                continue
            return node, rect
    return None


def tap(serial: str, label: str, out: Path, *, scrolls: int = 3) -> None:
    for _ in range(scrolls + 1):
        root = tree(serial, out)
        hit = find(root, label)
        if hit is not None:
            _, (x1, y1, x2, y2) = hit
            adb(serial, "shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
            time.sleep(1.2)
            return
        # 列表面板可能还没把那一行滚进可视区
        rect = parse_bounds(list(root.iter("node"))[0].get("bounds", ""))
        if rect is None:
            raise SystemExit("root node has no usable bounds")
        x1, _y1, x2, y2 = rect
        cx = (x1 + x2) // 2
        adb(serial, "shell", "input", "swipe", str(cx), str(int(y2 * 0.7)), str(cx), str(int(y2 * 0.35)), "450")
        time.sleep(1.0)
    raise SystemExit(f"label not reachable: {label!r}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("target", choices=["en", "zh"])
    ap.add_argument("--serial", default="emulator-5554")
    ap.add_argument("--evidence", type=Path, required=True)
    args = ap.parse_args()
    args.evidence.mkdir(parents=True, exist_ok=True)
    xml = args.evidence / f"language-{args.target}.xml"

    adb(args.serial, "shell", "am", "force-stop", PKG)
    adb(args.serial, "shell", "am", "start", "-W", "-n", f"{PKG}/{ACTIVITY}")
    time.sleep(2.5)
    for step in PATHS[args.target]:
        tap(args.serial, step, xml)
        print(f"tapped {step!r}", flush=True)
    # 开关会持久，所以切完要冷启一次再验渲染
    adb(args.serial, "shell", "am", "force-stop", PKG)
    adb(args.serial, "shell", "am", "start", "-W", "-n", f"{PKG}/{ACTIVITY}")
    time.sleep(3.0)
    root = tree(args.serial, xml)
    texts = " ".join(
        (n.get("text") or "") + " " + (n.get("content-desc") or "") for n in root.iter("node")
    )
    expected = PROOF[args.target]
    missing = [needle for needle in expected if needle not in texts]
    print(f"after cold start: missing={missing}")
    if missing:
        return 1
    print(f"VERDICT: 界面已按产品开关切到 {args.target} 并冷启验证")
    return 0


if __name__ == "__main__":
    sys.exit(main())
