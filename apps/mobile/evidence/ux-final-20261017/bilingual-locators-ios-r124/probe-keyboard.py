#!/usr/bin/env python3
"""一枚有界的只读探针：这台模拟器上软键盘到底出不出来。

问的不是产品，是**载体**：`keyboard_top` 返回 None 与返回一个数是两种完全不同的事实
（shim 自己那条注释写明了）。r124 英文臂与中文臂都红在 `timed out waiting for iOS keyboard`，
而两枚臂的界面标签都各自点得中 ⇒ 要先排掉"这台新建的模拟器根本不弹软键盘"这一档，
否则会把载体属性登记成产品缺陷。

跑法：打开 composer（它的标题字段会自动聚焦），读一次 AX 树，打印 keyboard_top 与
带 KeyboardKey 特质的节点数。不改任何状态。
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
KEYBOARD_TRAIT = "KeyboardKey"

spec = importlib.util.spec_from_file_location("heyta_ios_ax_shim", SHIM)
AX = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(AX)

udid = sys.argv[1]
new_task = sys.argv[2]
subprocess.run(["xcrun", "simctl", "launch", "--terminate-running-process", udid, "com.heyta"], capture_output=True, text=True)
time.sleep(9)
nodes = AX.dump_nodes(IDB, COMPANION, udid, attempts=3)
fab = AX.find(nodes, new_task, True, False, None, True, 0)
print("composer control found:", fab is not None, AX.label_of(fab) if fab else None)
if fab is not None:
    x, y = AX.center(fab)
    subprocess.run([IDB, *AX.companion_args(COMPANION), "ui", "tap", str(x), str(y), "--udid", udid], capture_output=True, text=True)
    time.sleep(4)
after = AX.dump_nodes(IDB, COMPANION, udid, attempts=3)
keys = [n for n in after if KEYBOARD_TRAIT in AX.traits_of(n)] if hasattr(AX, "traits_of") else []
print("nodes:", len(after), "keyboard_top:", AX.keyboard_top(after), "keyboard-key nodes:", len(keys))
print("labels:", [AX.label_of(n) for n in after][:14])
