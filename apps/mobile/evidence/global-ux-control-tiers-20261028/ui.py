#!/usr/bin/env python3
"""adb + UIAutomator 的最小驱动：按无障碍标签点、把屏幕文字读回来、截图。

P4 那三处外观变化只有看图才能判，但"图从哪一屏来"得先能可重现地走到那一屏，
所以这枚装置只做导航与取证，不做产品断言（断言在 kit 的语义测里）。
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ATTR = re.compile(r'([\w-]+)="([^"]*)"')
BOUNDS = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")


class Dead(RuntimeError):
    pass


def adb(serial: str, *args: str, binary: bool = False) -> bytes | str:
    r = subprocess.run(["adb", "-s", serial, *args], capture_output=True)
    if r.returncode != 0:
        raise Dead(f"adb {' '.join(args)} rc={r.returncode}: {r.stderr.decode(errors='replace')[:300]}")
    return r.stdout if binary else r.stdout.decode(errors="replace")


def nodes(xml: str) -> list[dict[str, str]]:
    return [dict(ATTR.findall(m.group(0))) for m in re.finditer(r"<node\b[^>]*?>", xml)]


def dump(serial: str) -> list[dict[str, str]]:
    for _ in range(6):
        xml = adb(serial, "exec-out", "uiautomator", "dump", "/dev/stdout")
        if "<node" in xml:
            return nodes(xml)
        time.sleep(1)
    raise Dead("uiautomator 连续读到空树（界面还在动或设备没醒）")


def label_of(n: dict[str, str]) -> str:
    return n.get("content-desc") or n.get("text") or ""


def find(serial: str, wanted: str, sub: bool = False) -> list[dict[str, str]]:
    return [n for n in dump(serial) if (wanted in label_of(n) if sub else label_of(n) == wanted)]


def center(n: dict[str, str]) -> tuple[int, int]:
    x1, y1, x2, y2 = map(int, BOUNDS.match(n["bounds"]).groups())
    return (x1 + x2) // 2, (y1 + y2) // 2


def tap(serial: str, wanted: str, sub: bool = False, nth: int = 0) -> None:
    hits = find(serial, wanted, sub)
    if len(hits) <= nth:
        raise Dead(f"找不到 {wanted!r}（命中 {len(hits)}）；当前屏：{[label_of(n) for n in dump(serial)][:60]}")
    x, y = center(hits[nth])
    adb(serial, "shell", "input", "tap", str(x), str(y))
    print(f"TAP {wanted} @ {x},{y} hits={len(hits)}")


def shot(serial: str, out: Path) -> None:
    png = adb(serial, "exec-out", "screencap", "-p", binary=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png)
    print(f"SHOT {out} {len(png)} B")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--serial", default=os.environ.get("ANDROID_SERIAL", "emulator-5556"))
    sub = p.add_subparsers(dest="op", required=True)
    sub.add_parser("texts")
    t = sub.add_parser("tap")
    t.add_argument("label")
    t.add_argument("--sub", action="store_true")
    t.add_argument("--nth", type=int, default=0)
    s = sub.add_parser("shot")
    s.add_argument("path", type=Path)
    a = p.parse_args()
    if a.op == "texts":
        print("\n".join(filter(None, (label_of(n) for n in dump(a.serial)))))
    elif a.op == "tap":
        tap(a.serial, a.label, a.sub, a.nth)
    else:
        shot(a.serial, a.path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
