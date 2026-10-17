#!/usr/bin/env python3
"""r124 第三枚探针：把旅程第 12 步的前置条件复现出来，分开两种解释。

现量已经排掉两档：这台载体**会**弹软键盘（composer `keyboard_top=545`），而"开详情 ⇒ 直接
点标题字段"这条最短路径也弹（`keyboard_top=519`，详情仍在）。旅程那一步红在
`timed out waiting for iOS keyboard`，唯一没复现的差别是它前面还做了**展开排期 → 收起排期**
（`recover_detail_title` 的 docstring 就写着这一动会把详情面往下滚），以及 `tap_node` 在点之前
先走了一趟 `AX.scroll_into_view`（那是**用滑动去找元素**的通用探针）。

所以本探针把两件事各自量一遍：
  ① 收起排期之后，标题字段的 frame 还在不在可视区（不点任何东西，只读）；
  ② 对同一枚标签调 `scroll_into_view` 它回什么 —— 回 `visible != True` 就是 `tap_node`
     会抛"不在可点视口"，回 `True` 却点不出键盘，就是这趟滑动自己把详情面滚走/关掉了。
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
open_label = f"打开任务：{sys.argv[2]}"
expand, collapse, field_label = sys.argv[3], sys.argv[4], sys.argv[5]


def tap(label: str, *, field: bool = False) -> None:
    nodes = AX.dump_nodes(IDB, COMPANION, udid, attempts=3)
    node = AX.find(nodes, label, not field, field, None, False, 0)
    if node is None:
        print(f"!! {label!r} not found")
        sys.exit(5)
    x, y = AX.center(node)
    subprocess.run([IDB, *AX.companion_args(COMPANION), "ui", "tap", str(x), str(y), "--udid", udid], capture_output=True, text=True)
    time.sleep(2.0)


subprocess.run(["xcrun", "simctl", "launch", "--terminate-running-process", udid, "com.heyta"], capture_output=True, text=True)
time.sleep(9)
tap(open_label)
print("detail open:", AX.find(AX.dump_nodes(IDB, COMPANION, udid, attempts=3), "任务详情", False, False, None, False, 0) is not None)
tap(expand)
tap(collapse)

nodes = AX.dump_nodes(IDB, COMPANION, udid, attempts=3)
width, height = AX.screen_size(nodes)
field = AX.find(nodes, field_label, False, True, None, False, 0)
print("screen:", width, height)
print("① 收起排期后 field frame:", None if field is None else AX.frame_of(field), "center:", None if field is None else AX.center(field))
print("   detail still open:", AX.find(nodes, "任务详情", False, False, None, False, 0) is not None)
visible = AX.scroll_into_view(IDB, COMPANION, udid, field_label, False, True, None)
print("② scroll_into_view 回:", visible)
after = AX.dump_nodes(IDB, COMPANION, udid, attempts=3)
print("   滑完之后 detail still open:", AX.find(after, "任务详情", False, False, None, False, 0) is not None,
      "field frame:", None if AX.find(after, field_label, False, True, None, False, 0) is None
      else AX.frame_of(AX.find(after, field_label, False, True, None, False, 0)))
refreshed = AX.find(after, field_label, False, True, None, False, 0)
if refreshed is not None:
    x, y = AX.center(refreshed)
    subprocess.run([IDB, *AX.companion_args(COMPANION), "ui", "tap", str(x), str(y), "--udid", udid], capture_output=True, text=True)
    time.sleep(3.0)
    third = AX.dump_nodes(IDB, COMPANION, udid, attempts=3)
    print("③ 直接点这一枚 (tap 走 scroll_into_view 之后重读的那枚):", (x, y),
          "keyboard_top=", AX.keyboard_top(third),
          "detail still open:", AX.find(third, "任务详情", False, False, None, False, 0) is not None)
