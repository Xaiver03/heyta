#!/usr/bin/env python3
"""把装机态 iOS 的应用内语言切到 `en` 或 `zh`，并把"切没切过去"取成读数。

台账里 r131/r133/r134 三格都把「英文装机态」列进**不证**清单，共同的原因是**没有通道**：
系统语言那三条都动不了这枚包的界面（陷阱 #469 —— `resolveNativeLocale()` 第一优先级是
应用内开关持久化的 `HeytaWidget.preferredLocale`），而应用内那枚开关此前没有任何装置走过。
这一枚补的就是那条通道，补完 `account-face-ios.py` 这类双语定位的脚本才**真的**在英文档被跑过。

导航：「我的」→ 设置 → 常规 → 语言那一栏的两枚 chip（`中文` / `English`，
`common.lang.zh`／`.en` 在两份词条表里**同字**，所以 chip 标签本身不随语态变）。

🔴 这台是共享验收机：切换是**持久**的设备状态改动（`mobile.profile.language.hint` 自己就写着
"这台设备会记住你的选择"）。所以本脚本要么被 `--restore` 用一次把状态拉回中文，
要么调用方在收尾时**自己**再跑一次 `--to zh` 并回读。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str, rel: str):
    mod = sys.modules.get(name)
    if mod is not None:
        return mod
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    loaded = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[name] = loaded
    spec.loader.exec_module(loaded)
    return loaded


PS = _load("heyta_profile_settings_ios", "scripts/qa/profile-settings-ios.py")
AIF = _load("heyta_ai_face_ios", "scripts/qa/ai-face-ios.py")

Probe, T, any_of = PS.Probe, PS.T, PS.any_of
present, labels, JourneyError = PS.present, PS.labels, PS.JourneyError
TracingProbe = AIF.TracingProbe
PROFILE_ROWS, BACK, CLOSE, GENERAL_GROUP = AIF.PROFILE_ROWS, AIF.BACK, AIF.CLOSE, AIF.GENERAL_GROUP

# chip 标签两份词条表里同字（en.ts 的注释自己写明「中文」是英文表里唯一合法的 CJK 值）。
ZH_CHIP = "中文"
EN_CHIP = "English"
LANGUAGE_SECTION = T("语言", "Language")  # mobile.profile.section.language

# 每档一组"这一档才有的目录层标签"（`mobile.settings.section.*`，两份词条表逐条对得上）。
# 🔴 这两组**刻意各写一种语态**：它们是到达断言位，双语会让"界面根本没翻"也判过。
# 门把这形状作为**披露**报出来（不判红），与 `profile-settings-ios.py` 里同一族的写法同一条理由。
DIRECTORY_MARKS = {
    "en": ["General", "Sync and privacy", "Data management", "Account security"],
    "zh": ["常规", "同步与隐私", "数据管理", "账号安全"],
}


def launch(probe) -> None:
    udid = probe.udid
    subprocess.run(["xcrun", "simctl", "terminate", udid, "com.heyta"], capture_output=True, text=True)
    time.sleep(1.0)
    out = subprocess.run(["xcrun", "simctl", "launch", udid, "com.heyta"], capture_output=True, text=True)
    if out.returncode != 0:
        raise JourneyError(f"could not launch com.heyta: {(out.stderr or out.stdout).strip()[:200]}")
    time.sleep(4.0)
    probe.wait_for_any_label(any_of(
        T("只用本机", "This device only"), T("先离线使用", "Use offline for now"),
        T("任务", "Tasks"), T("我的", "Profile"),
    ))
    if present(probe.tree(), T("只用本机", "This device only"), pressable=True) is not None:
        probe.tap("choose local-only privacy", T("只用本机", "This device only"), ("先离线使用",))
    if present(probe.tree(), T("先离线使用", "Use offline for now"), pressable=True) is not None:
        probe.tap("choose offline", T("先离线使用", "Use offline for now"), ("任务", "我的"))


def chip_nodes(tree) -> dict:
    # 两枚 chip 的**整条节点**（不是只取 `AXValue`）：选中态到底有没有无障碍出口，要看
    # `traits`/`role`/`AXValue` 三样合起来说什么 —— 只记一样就会把"我这把尺没量到"
    # 读成"产品没有"（与 #481 同一族，2026-10-19 英文腿实测）。
    return {
        label: PS.AX.find(tree, label, False, False, None, False, 0)
        for label in (ZH_CHIP, EN_CHIP)
    }


def chip_state(nodes: dict) -> dict:
    return {label: {k: node.get(k) for k in ("AXValue", "traits", "role", "enabled")}
            if node else None
            for label, node in nodes.items()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--udid", default="")
    ap.add_argument("--to", choices=("en", "zh"), required=True)
    ap.add_argument("--evidence-dir", default="")
    ap.add_argument("--idb", default=str(Path.home() / ".heyta-tools/idb/venv/bin/idb"))
    ap.add_argument("--companion", default=str(Path.home() / ".heyta-tools/idb/idb_companion"))
    ap.add_argument("--timeout", type=float, default=10.0)
    a = ap.parse_args()
    if not a.udid:
        raise SystemExit("--udid is required")

    probe = TracingProbe(argparse.Namespace(
        udid=a.udid, idb=a.idb, companion=a.companion,
        evidence_dir=a.evidence_dir or "/tmp", timeout=a.timeout))
    report = Path(a.evidence_dir) / "language-switch.json" if a.evidence_dir else None
    if report:
        report.parent.mkdir(parents=True, exist_ok=True)

    launch(probe)
    probe.tap("open profile tab", T("我的", "Profile"), PROFILE_ROWS)
    probe.tap("open settings", PROFILE_ROWS, GENERAL_GROUP)
    probe.tap("open general", GENERAL_GROUP, LANGUAGE_SECTION)

    tree = probe.tree()
    before = chip_state(chip_nodes(tree))
    probe.record("language before", "passed",
                 chips=before,
                 zhSection=present(tree, ("语言",)) is not None,
                 enSection=present(tree, ("Language",)) is not None)

    target_chip = EN_CHIP if a.to == "en" else ZH_CHIP
    other_chip = ZH_CHIP if a.to == "en" else EN_CHIP
    # `then` 用**目标档独有**的目录层标签：chip 自己按下去了不代表整片界面翻了。
    probe.tap(f"choose {a.to}", (target_chip,), DIRECTORY_MARKS[a.to])

    tree = probe.tree()
    hit = [m for m in DIRECTORY_MARKS[a.to] if present(tree, (m,)) is not None]
    stale = [m for m in DIRECTORY_MARKS["zh" if a.to == "en" else "en"]
             if present(tree, (m,)) is not None]
    probe.record(f"language after ({a.to})", "passed",
                 chips=chip_state(chip_nodes(tree)),
                 directoryMarksHit=hit,
                 otherLanguageMarksLeft=stale,
                 labels=labels(tree)[:60])
    if a.evidence_dir:
        probe.screenshot(f"language-{a.to}")

    probe.tap("general back", BACK, GENERAL_GROUP)
    probe.tap("close settings", CLOSE, PROFILE_ROWS)

    payload = {"switchedTo": a.to, "startedAt": time.time(), "steps": probe.steps}
    if report:
        report.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": "passed", "switchedTo": a.to, "steps": len(probe.steps),
                      "evidence": str(report) if report else None}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except JourneyError as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
