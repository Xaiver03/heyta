#!/usr/bin/env python3
"""Does the hardened tap/scroll guard fire on the geometry that produced tonight's false red?

One measured case: font_scale 1.3 on the Profile screen, where the countdown row is clipped below
the fold and its reported centre (y=2210) sits inside the bottom tab band (2169-2337).

The predicate is re-implemented here (the journey script runs its whole body at import, so it
cannot be imported), which is why this harness also greps the shipped source for the exact
expression and reports whether they match — a drift between the two shows up as
`predicate_matches_source: false` instead of passing silently.

The device font scale is restored before exit.
"""
import json, re, subprocess, sys, time
from pathlib import Path
from xml.etree import ElementTree as ET

SERIAL = "emulator-5554"
OUT = Path(__file__).resolve().parent
_repo = next(a for a in Path(__file__).resolve().parents if (a / "scripts" / "qa").is_dir())
QA = _repo / "scripts" / "qa" / "profile-settings-android.py"
PREDICATE = "y2<=y1 or (band_top is not None and (y1+y2)//2>=band_top)"
TABS = ("任务", "日历", "专注", "分类", "我的")


def adb(*args):
    return subprocess.run(["adb", "-s", SERIAL, *args], capture_output=True, timeout=60, check=True).stdout


def tree():
    for _ in range(4):
        r = subprocess.run(["adb", "-s", SERIAL, "shell", "uiautomator", "dump", "/sdcard/heyta-guard.xml"],
                           capture_output=True, timeout=60)
        if r.returncode == 0:
            return ET.fromstring(adb("exec-out", "cat", "/sdcard/heyta-guard.xml"))
        time.sleep(1)
    raise RuntimeError("uiautomator dump failed")


def box(node):
    x1, y1, x2, y2 = (int(v) for v in re.findall(r"-?\d+", node.get("bounds")))
    return x1, y1, x2, y2


def main():
    source = QA.read_text()
    baseline = adb("shell", "settings", "get", "system", "font_scale").decode().strip()
    try:
        adb("shell", "settings", "put", "system", "font_scale", "1.3")
        adb("shell", "am", "force-stop", "com.heyta")
        time.sleep(1.5)
        adb("shell", "am", "start", "-W", "-n", "com.heyta/com.heytamobile.MainActivity")
        root = None
        deadline = time.monotonic() + 40
        tapped_profile_tab = False
        while time.monotonic() < deadline:
            candidate = tree()
            rows = [n for n in candidate.iter("node")
                    if n.get("resource-id", "").endswith("profile-entry-countdown")]
            if rows:
                root = candidate
                break
            if not tapped_profile_tab:
                # A cold start resumes on whichever tab was last open; only 我的 carries the row.
                tab = next((n for n in candidate.iter("node")
                            if n.get("clickable") == "true" and (n.get("content-desc") or "") == "我的"), None)
                if tab is not None:
                    x1, y1, x2, y2 = box(tab)
                    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
                    tapped_profile_tab = True
            time.sleep(1)
        if root is None:
            print(json.dumps({"error": "countdown row never appeared"}))
            return 2
        band_top = min(box(n)[1] for n in root.iter("node")
                       if n.get("clickable") == "true" and (n.get("content-desc") or "").split(",")[0] in TABS)
        target = next(n for n in root.iter("node") if n.get("resource-id", "").endswith("profile-entry-countdown"))
        x1, y1, x2, y2 = box(target)
        center = (y1 + y2) // 2
        verdict = {
            "fontScale": "1.3", "baselineFontScale": baseline,
            "tabBandTop": band_top, "targetBounds": [x1, y1, x2, y2], "targetCenterY": center,
            "predicate_matches_source": PREDICATE in source,
            "guardRejectsTarget": bool(y2 <= y1 or (band_top is not None and center >= band_top)),
            # This is exactly why the old scroll_to returned on the first dump: it only asked
            # "is the label in the tree", and a clipped row still carries its content-desc.
            "labelPresentInTreeWhileClipped": bool((target.get("content-desc") or "").startswith("倒数纪念日")),
        }
        (OUT / "tap-guard.json").write_text(json.dumps(verdict, ensure_ascii=False, indent=1))
        print(json.dumps(verdict, ensure_ascii=False))
        return 0 if (verdict["guardRejectsTarget"] and verdict["predicate_matches_source"]) else 1
    finally:
        adb("shell", "settings", "put", "system", "font_scale", baseline)
        print("RESTORED=" + adb("shell", "settings", "get", "system", "font_scale").decode().strip())


if __name__ == "__main__":
    sys.exit(main())
