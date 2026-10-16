#!/usr/bin/env python3
"""「点一下空白卡 ⇒ 组件回来了」这条因果的**对照臂**：不点，只等。
run4 只观察到「0 行 → 点 → 6s 后 2 行」，没有"同样等 6s 但不点"的那一格，
所以这句话现在只是**一次相关**，不是证明。这里补 A/B/A：
杀 → 读 → 等 10s 不点 → 读 → 再等 10s 不点 → 读 → 点 → 等 6s → 读。
"""
import re
import subprocess
import sys
import time

SERIAL = sys.argv[1] if len(sys.argv) > 1 else "emulator-5554"
PREFIX = "L115"
POINT = (371, 599)


def adb(*args):
    return subprocess.run(["adb", "-s", SERIAL] + list(args),
                          capture_output=True, text=True).stdout


def rows(tag):
    # 🔴 这两枚都要走 `shell`：漏掉它 adb 报的是 "adb: unknown command uiautomator"，
    # 里面既没有 "ERROR" 也没有 "<node" ⇒ 每一格都读成 None，整条对照臂静默作废
    # （本文件第一趟就是这么跑的 —— 探针自己的失法，不是被测物的）。
    out = adb("shell", "uiautomator", "dump", f"/sdcard/{tag}.xml")
    if "ERROR" in out:
        return None
    xml = adb("shell", "cat", f"/sdcard/{tag}.xml")
    if "<node" not in xml:
        return None
    open(f"{tag}.xml", "w", encoding="utf-8").write(xml)
    return [m.group(1) for m in
            re.finditer(r'text="([^"]*%s[^"]*)"' % PREFIX, xml)]


def ps():
    return "com.heyta" in adb("shell", "ps", "-A")


def step(msg):
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


adb("shell", "input", "keyevent", "KEYCODE_HOME")
time.sleep(2)
adb("shell", "am", "force-stop", "com.heyta")
time.sleep(3)
step(f"杀完：进程在={ps()} 读到={rows('ctl-0')}")
for i in (1, 2):
    time.sleep(10)
    step(f"不点、只等第 {i} 次（+{i * 10}s）：进程在={ps()} 读到={rows(f'ctl-wait-{i}')}")
adb("shell", "input", "tap", *map(str, POINT))
step(f"点了 {POINT}")
time.sleep(6)
step(f"点完 +6s：进程在={ps()} 读到={rows('ctl-tap')}")
subprocess.run(["adb", "-s", SERIAL, "exec-out", "screencap", "-p"], stdout=open("ctl-final.png", "wb"))
step("截图 ctl-final.png 已落盘")
