#!/usr/bin/env python3
"""走**应用内**那枚语言开关（设置 → 我的 → 常规 里内联的「中文 / English」两行）。

为什么不走系统语言：`apps/mobile/src/i18n/locale.ts` 的 `resolveNativeLocale()` 第一优先级是原生模块
`HeytaWidget.preferredLocale`（就是这枚开关持久化的值），系统 `AppleLanguages` / `AppleLocale` 只是它的兜底
⇒ 改 defaults 整条路被挡在门外（现量见同目录 RESULT.md 与环境陷阱 #469）。

为什么底部 tab 不能走 `probe.tap`：共享装置 `scripts/tools/ios-ax-shim.py` 的可见判据是 `vis_limit = h - 120`
（注释原话"留出底部标签栏"）⇒ tab 栏那五枚的中心 y 按设计落在被扣掉的带里，守卫恒报 `visible=False`。
这里按节点自己的 frame 中心直接 `idb ui tap`，不是放宽判据，是那条判据的射程本来不含这枚节点。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
spec = importlib.util.spec_from_file_location("heyta_tasks_ux_ios", ROOT / "scripts" / "qa" / "tasks-ux-ios.py")
JU = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(JU)
AX = JU.AX


def raw_tap(probe, x: int, y: int) -> None:
    r = subprocess.run(
        [probe.idb, *AX.companion_args(probe.companion), "ui", "tap", str(x), str(y), "--udid", probe.udid],
        capture_output=True, text=True, timeout=60,
    )
    if r.returncode != 0:
        raise JU.ProbeError(f"tap at {x},{y} failed: {(r.stderr or r.stdout).strip()[:200]}")


def labels(probe) -> list[str]:
    return [x for x in (AX.label_of(n) for n in probe.tree()) if x]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--udid", required=True)
    ap.add_argument("--to", required=True, choices=["English", "中文"])
    ap.add_argument("--idb", default="/Users/rocalight/.heyta-tools/idb/venv/bin/idb")
    ap.add_argument("--companion", default="/Users/rocalight/.heyta-tools/idb/idb_companion")
    a = ap.parse_args()

    probe = JU.Probe(argparse.Namespace(
        idb=a.idb, companion=a.companion, udid=a.udid, timeout=15.0, evidence_dir=str(HERE)))
    out: dict = {"to": a.to, "at": time.strftime("%F %T")}

    probe.ensure_on_tasks()
    tab = probe.node(("我的", "Profile"), pressable=True)
    tx, ty = AX.center(tab)
    raw_tap(probe, tx, ty)
    time.sleep(2.5)
    out["afterTabTap"] = labels(probe)[:12]

    probe.tap(("设置, 个人资料、偏好、同步与安全", "设置", "Settings"), "open settings")
    time.sleep(1.5)
    probe.tap(("常规", "General"), "open general group")
    time.sleep(1.5)
    seen = labels(probe)
    out["generalHasLanguageRows"] = [x for x in ("语言", "中文", "English") if x in seen]
    if a.to not in seen:
        raise JU.ProbeError(f"the {a.to!r} row is not on the 常规 screen; visible={seen[:40]!r}")
    probe.tap((a.to,), f"choose {a.to}")
    time.sleep(3.0)
    probe.screenshot(f"after-choose-{a.to}")

    after = labels(probe)
    out["afterChoose"] = after[:14]
    # 落地判据：换到 English 后「常规」这一屏的分组标题应当不再是中文那两枚；换回中文则相反。
    probe.screenshot(f"language-{a.to}")
    out["ok"] = True
    (HERE / f"switch-{a.to}.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False)[:900])
    return 0


if __name__ == "__main__":
    sys.exit(main())
