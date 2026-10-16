#!/usr/bin/env python3
"""意图队列那一档的**设备腿**：`am kill`（系统回收的代理）而不是 `am force-stop`。

为什么必须换这一把：force-stop 会把包放进 stopped 态，**广播根本进不来**，
所以 run4/run6 那一趟量不到"队列留不留得住"——那一屏连 `○` 都没有渲染。
`am kill` 只杀进程、不设 stopped 标记 ⇒ 这才是"进程没了但点击意图还能送达 receiver"
那一档的真实形状。

量的四格：
 1) 杀进程之后组件还渲不渲染行（对照 force-stop 的空白卡）；
 2) 进程死了点 `○` —— 广播会不会把进程带起来、卡上多久变 `✓`；
 3) 应用**没有**被打开的情况下，卡上会不会自己回写（`drainIntentQueue` 只在 RN 起来时跑）；
 4) 把应用叫起来之后，那一次点击才生效吗（=队列确实留着等排空）。
"""
import re
import subprocess
import sys
import time

SERIAL = sys.argv[1] if len(sys.argv) > 1 else "emulator-5554"
PREFIX = "L115"


def adb(*args):
    return subprocess.run(["adb", "-s", SERIAL, "shell"] + list(args),
                          capture_output=True, text=True).stdout


def rows(tag):
    out = adb("uiautomator", "dump", f"/sdcard/{tag}.xml")
    if "ERROR" in out:
        return None
    xml = adb("cat", f"/sdcard/{tag}.xml")
    if "<node" not in xml:
        return None
    open(f"{tag}.xml", "w", encoding="utf-8").write(xml)
    # ⚠️ bounds 的字面形状是 `[346,454][981,500]` —— **逗号后没有空格**。
    # 本文件第一版按 `[x, y]` 写，于是每一格都读成 []，看着像"组件空了"（现量 diag-now.png 里两行都在）。
    hits = re.findall(r'text="((?:[✓○]) [^"]*%s[^"]*)"[^>]*bounds="\[(\d+),\s*(\d+)\]\[(\d+),\s*(\d+)\]"' % PREFIX, xml)
    return [(h[0], tuple(int(x) for x in h[1:])) for h in hits]


def pid():
    m = re.search(r"^\S+\s+(\d+)\s+\S+.*\bcom\.heyta$", adb("ps -A"), re.M)
    return m.group(1) if m else None


def step(msg):
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def tap_at(b, label):
    x, y = b[0] + 25, (b[1] + b[3]) // 2
    adb("input", "tap", str(x), str(y))
    step(f"  点 {label} 的符号位 ({x},{y}) ← {b}")


def wake():
    adb("am", "start", "-n", "com.heyta/com.heytamobile.MainActivity")
    time.sleep(6)
    adb("input", "keyevent", "KEYCODE_HOME")
    time.sleep(3)


adb("input", "keyevent", "KEYCODE_HOME")
time.sleep(2)
if not rows("q-0"):
    wake()
cur = rows("q-1") or []
step(f"起点：pid={pid()} 读到={cur}")
# 需要至少一行未完成：两行都已 ✓ 就点一次 ✓ 把它翻回未完成（目标状态是幂等的翻转）
if cur and not any(t.startswith("○") for t, _ in cur):
    t0, b0 = cur[0]
    tap_at(b0, f"（先取消）{t0}")
    time.sleep(6)
    cur = rows("q-2") or []
    step(f"  取消之后：{cur}")
pend = next(((t, b) for t, b in cur if t.startswith("○")), None)
if not pend:
    raise SystemExit(f"没有未完成的那一行，这一趟没有对象：{cur}")

out = adb("am", "kill", "com.heyta")
time.sleep(2)
step(f"am kill 之后：pid={pid()} 组件读到={rows('q-3')}（out={out.strip()!r}）")
before = rows("q-4") or []
hit = next(((t, b) for t, b in before if t == pend[0]), None)
if not hit:
    raise SystemExit(f"杀进程后那一行不在了：{before}")
tap_at(hit[1], hit[0])
for i in (3, 6, 12):
    time.sleep(3)
    step(f"  点完约 {i}s：pid={pid()} 读到={rows(f'q-tap-{i}')}")
subprocess.run(["adb", "-s", SERIAL, "exec-out", "screencap", "-p"], stdout=open("q-before-wake.png", "wb"))
step("截图 q-before-wake.png（应用仍未打开）")

adb("am", "start", "-n", "com.heyta/com.heytamobile.MainActivity")
time.sleep(8)
adb("input", "keyevent", "KEYCODE_HOME")
time.sleep(3)
step(f"把应用叫起来之后：pid={pid()} 读到={rows('q-woken')}")
subprocess.run(["adb", "-s", SERIAL, "exec-out", "screencap", "-p"], stdout=open("q-after-wake.png", "wb"))
step("截图 q-after-wake.png")
