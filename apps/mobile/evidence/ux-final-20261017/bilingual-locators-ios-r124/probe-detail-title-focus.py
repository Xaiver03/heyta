#!/usr/bin/env python3
"""r124 第二枚有界探针：详情面的标题字段点下去，键盘到底出不出来。

为什么要它：`probe-keyboard.py` 已经证了这台载体**会**弹软键盘（composer 的标题字段自动
聚焦时 `keyboard_top=545`，与旧载体 FE195661 上那两枚 passed 读数同一个数），所以旅程
红在 `12-detail-keyboard-visible-and-unobstructed` 不是载体不弹键盘。剩下两种可能：
  A. 产品：详情面（不是 composer）的标题字段现在拿不到焦点 —— 那是真回归，要登记；
  B. 探针：旅程那一步的 `tap_node` 打在了别的节点上（同一枚标签在树里出现两次）。
本探针只做这一件事：开一条任务的详情，按旅程同样的方式定位标题字段并点它，然后读
`keyboard_top`，同时把**命中的那一枚的 frame/role/label** 与树里所有叫这个名字的节点
一起打出来 —— 是 A 还是 B 由这两组读数分开。
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
SHIM = ROOT / "scripts" / "tools" / "ios-ax-shim.py"
IDB = str(Path.home() / ".heyta-tools/idb/venv/bin/idb")
COMPANION = str(Path.home() / ".heyta-tools/idb/idb_companion")

spec = importlib.util.spec_from_file_location("heyta_ios_ax_shim", SHIM)
AX = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(AX)

udid = sys.argv[1]
title = sys.argv[2]
open_label = f"打开任务：{title}"
field_label = sys.argv[3] if len(sys.argv) > 3 else "标题"

subprocess.run(["xcrun", "simctl", "launch", "--terminate-running-process", udid, "com.heyta"], capture_output=True, text=True)
time.sleep(9)
nodes = AX.dump_nodes(IDB, COMPANION, udid, attempts=3)
row = AX.find(nodes, open_label, True, False, None, False, 0)
print("row found:", row is not None)
if row is None:
    sys.exit(3)
x, y = AX.center(row)
subprocess.run([IDB, *AX.companion_args(COMPANION), "ui", "tap", str(x), str(y), "--udid", udid], capture_output=True, text=True)
time.sleep(4)
nodes = AX.dump_nodes(IDB, COMPANION, udid, attempts=3)
print("detail open:", AX.find(nodes, "任务详情", False, False, None, False, 0) is not None)
same = [n for n in nodes if AX.label_of(n) == field_label]
print(f"nodes labelled {field_label!r}: {len(same)}")
for n in same:
    print("   frame=", AX.frame_of(n), "center=", AX.center(n), "pressable=", AX.is_pressable(n), "field=", AX.is_field(n))
field = AX.find(nodes, field_label, False, True, None, False, 0)
if field is None:
    print("locator (want_field=True) hit nothing")
    sys.exit(4)
fx, fy = AX.center(field)
print("tapping", (fx, fy))
subprocess.run([IDB, *AX.companion_args(COMPANION), "ui", "tap", str(fx), str(fy), "--udid", udid], capture_output=True, text=True)
for wait in (1.5, 3.0, 5.0):
    time.sleep(wait if wait == 1.5 else 1.5)
    after = AX.dump_nodes(IDB, COMPANION, udid, attempts=3)
    print(f"after ~{wait}s: keyboard_top=", AX.keyboard_top(after), "detail still open:",
          AX.find(after, "任务详情", False, False, None, False, 0) is not None, "nodes=", len(after))
