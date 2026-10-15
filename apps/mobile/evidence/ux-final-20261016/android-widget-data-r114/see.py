#!/usr/bin/env python3
"""把当前界面的无障碍树打成人类可读的一行一枚节点（r114 设备腿的探查器）。

用法：python3 see.py [保存到文件名.xml]
不带参数就只打印，不落盘。
"""
import subprocess
import sys
import xml.etree.ElementTree as ET

SERIAL = "emulator-5554"


def adb(*args: str) -> str:
    return subprocess.run(["adb", "-s", SERIAL, *args], capture_output=True, text=True).stdout


def main() -> int:
    adb("shell", "uiautomator", "dump", "/sdcard/r114.xml")
    xml = adb("exec-out", "cat", "/sdcard/r114.xml")
    out = sys.argv[1] if len(sys.argv) > 1 else None
    if out:
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(xml)
    root = ET.fromstring(xml)
    for node in root.iter():
        a = node.attrib
        text = (a.get("text") or "").strip()
        desc = (a.get("content-desc") or "").strip()
        rid = a.get("resource-id") or ""
        if not (text or desc or rid):
            continue
        if a.get("bounds") == "[0,0][1080,2400]":
            continue
        cls = (a.get("class") or "").split(".")[-1]
        print(f"{cls:<10} rid={rid:<26} clk={a.get('clickable'):<5} {a.get('bounds'):>25} "
              f"text={text[:40]!r} desc={desc[:28]!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
