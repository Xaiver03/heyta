#!/usr/bin/env python3
"""Is the Profile countdown entry reachable at large font, or permanently occluded?

The journey probe's own nudge cannot answer this: it swipes from the entry's
reported centre, and at font_scale 1.3 that centre (y=2210) is inside the bottom
tab band (2169-2337), so the gesture is handed to the tab bar, not to the scroll
view.  This probe swipes from a point that is unambiguously in the content
column and stops when the entry stops moving, which is what distinguishes
"already at scroll end" from "the probe never scrolled".

Reads are printed as JSON; the device font scale is restored before exit.
"""
import json, os, re, subprocess, sys, time
from pathlib import Path
from xml.etree import ElementTree as ET

SERIAL = "emulator-5554"
OUT = Path(__file__).resolve().parent
FONT = os.environ.get("PROBE_FONT", "1.3")
TABS = ("任务", "日历", "专注", "分类", "我的")


def adb(*args):
    return subprocess.run(["adb", "-s", SERIAL, *args], capture_output=True,
                          timeout=60, check=True).stdout


def tree():
    for _ in range(4):
        r = subprocess.run(["adb", "-s", SERIAL, "shell", "uiautomator", "dump",
                            "/sdcard/heyta-scroll.xml"], capture_output=True, timeout=60)
        if r.returncode == 0:
            return ET.fromstring(adb("exec-out", "cat", "/sdcard/heyta-scroll.xml"))
        time.sleep(1)
    raise RuntimeError("uiautomator dump failed")


def bounds(node):
    x1, y1, x2, y2 = (int(v) for v in re.findall(r"-?\d+", node.get("bounds")))
    return {"left": x1, "top": y1, "right": x2, "bottom": y2}


def heyta(root):
    return [n for n in root.iter("node") if n.get("package") == "com.heyta"]


def entry_node(root):
    for n in heyta(root):
        if n.get("resource-id", "").split("/")[-1] == "profile-entry-countdown":
            return n
    return None


def tab_band(root):
    tops, bottoms = [], []
    for n in heyta(root):
        desc = (n.get("content-desc") or n.get("text") or "").split(",")[0]
        if desc in TABS and n.get("clickable") == "true":
            b = bounds(n)
            tops.append(b["top"])
            bottoms.append(b["bottom"])
    return (min(tops), max(bottoms)) if tops else (None, None)


def swipe(x1, y1, x2, y2):
    adb("shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), "500")
    time.sleep(0.8)


def wait_entry():
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        r = tree()
        if entry_node(r) is not None:
            return r
        # A cold start can resume on any tab; only 我的 carries the countdown entry.
        for n in heyta(r):
            if (n.get("content-desc") or "") == "我的" and n.get("clickable") == "true":
                b = bounds(n)
                adb("shell", "input", "tap", str((b["left"] + b["right"]) // 2),
                    str((b["top"] + b["bottom"]) // 2))
                break
        time.sleep(1)
    return None


def main():
    baseline = adb("shell", "settings", "get", "system", "font_scale").decode().strip()
    adb("shell", "settings", "put", "system", "font_scale", FONT)
    try:
        return run(baseline)
    finally:
        adb("shell", "settings", "put", "system", "font_scale", baseline)
        print("RESTORED=" + adb("shell", "settings", "get", "system", "font_scale").decode().strip())


def run(baseline):
    adb("shell", "am", "force-stop", "com.heyta")
    time.sleep(1.5)
    adb("shell", "am", "start", "-W", "-n", "com.heyta/com.heytamobile.MainActivity")
    root = wait_entry()
    if root is None:
        print(json.dumps({"error": "profile countdown entry never appeared after cold start"}))
        return 2

    tab_top, tab_bottom = tab_band(root)
    rounds = []
    previous = None
    stable = 0
    for i in range(8):
        node = entry_node(root)
        b = bounds(node)
        below = sorted({bounds(n)["bottom"] for n in heyta(root)
                        if n.get("text") or n.get("content-desc")} - {b["bottom"]})
        rounds.append({"round": i, "entry": b, "tabTop": tab_top,
                       "strictlyAbove": b["bottom"] < tab_top,
                       "contentBottomsBelowEntry": [v for v in below if v > b["bottom"]][-3:]})
        (OUT / f"scroll-{FONT.replace(chr(46), chr(95))}-{i}.png").write_bytes(adb("exec-out", "screencap", "-p"))
        if previous == (b["top"], b["bottom"]):
            stable += 1
            if stable >= 2:
                break
        else:
            stable = 0
        previous = (b["top"], b["bottom"])
        # Start well inside the content column, above the tab band.
        swipe(540, tab_top - 260, 540, 520)
        root = tree()
        tab_top, tab_bottom = tab_band(root)

    final = entry_node(root)
    result = {"fontScaleSet": FONT, "fontScaleBaseline": baseline,
              "tabBand": [tab_top, tab_bottom], "rounds": rounds,
              "finalEntry": bounds(final) if final is not None else None,
              "finalStrictlyAbove": bool(final is not None and bounds(final)["bottom"] < tab_top),
              "reachableByScrolling": any(r["strictlyAbove"] for r in rounds)}
    (OUT / f"scroll-probe-{FONT.replace(chr(46), chr(95))}.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
