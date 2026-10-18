#!/usr/bin/env python3
"""走到应用内「设置 → 常规 → 语言」那一屏，把可见标签与截图落盘（不点选项）。"""
from __future__ import annotations
import argparse, importlib.util, json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
spec = importlib.util.spec_from_file_location("heyta_tasks_ux_ios", ROOT / "scripts" / "qa" / "tasks-ux-ios.py")
JU = importlib.util.module_from_spec(spec); spec.loader.exec_module(JU)
AX = JU.AX

p = argparse.ArgumentParser()
p.add_argument("--udid", required=True)
p.add_argument("--idb", default="/Users/rocalight/.heyta-tools/idb/venv/bin/idb")
p.add_argument("--companion", default="/Users/rocalight/.heyta-tools/idb/idb_companion")
p.add_argument("--choose", default=None, help="要点的选项标签；不给就只 dump")
a = p.parse_args()
probe = JU.Probe(argparse.Namespace(idb=a.idb, companion=a.companion, udid=a.udid, timeout=15.0, evidence_dir=str(HERE)))
probe.ensure_on_tasks()
# 🔴 底部 tab 不能走 probe.tap：共享装置 `ios-ax-shim.py` 的可见判据是 `vis_limit = h - 120`
# （注释原话"留出底部标签栏"）⇒ tab 栏那五枚的中心 y 按设计落在被扣掉的带里，守卫恒报 visible=False。
# 绕开它不是放宽判据：那条判据的射程本来不含这枚节点。落点仍取节点自己的 frame 中心。
tab = probe.node(("我的", "Profile"), pressable=True)
tx, ty = AX.center(tab)
AX.idb_tap(probe.idb, probe.companion, probe.udid, tx, ty) if hasattr(AX, "idb_tap") else __import__("subprocess").run(
    [probe.idb, *AX.companion_args(probe.companion), "ui", "tap", str(tx), str(ty), "--udid", probe.udid],
    capture_output=True, text=True, timeout=60)
print("tapped tab at", tx, ty)
import time as _t; _t.sleep(2.5)
probe.tap(("设置, 个人资料、偏好、同步与安全", "设置", "Settings"), "open settings")
probe.tap(("常规", "General"), "open general group")
probe.tap(("语言", "Language"), "open language screen")
nodes = probe.tree()
labels = [AX.label_of(n) for n in nodes]
labels = [x for x in labels if x]
out = {"uiLocale": probe.ui_locale, "labels": labels}
(HERE / "language-screen.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
probe.screenshot("language-screen")
print(json.dumps(out, ensure_ascii=False)[:1200])
if a.choose:
    probe.tap((a.choose,), f"choose {a.choose}")
    import time; time.sleep(2.5)
    probe.screenshot(f"after-choose-{a.choose.replace(' ', '-')}")
    print("CHOSEN:", a.choose)
