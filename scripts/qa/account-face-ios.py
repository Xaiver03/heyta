#!/usr/bin/env python3
"""iOS 账号面（注册 / 登录）装机态深浅两档旅程 —— **只读**。

台账那句「个人资料/账号/AI/帮助的剩余交互回归」里，**账号**这一面此前只有浏览器读数，
装机态一次都没有（个人资料 r131、AI 与帮助 r133 已各自补上）。这一枚补账号面：

    「我的」→ 注册 / 登录 → 登录表单 → 展开「或者用别的方式」→ 收起 → 返回「我的」

🔴 **只读纪律**（这台是共享验收机，未登录态是别人也要用的基线）：
  * **不往邮箱框里打一个字**、不勾条款；
  * **不按**「用邮箱和密码登录」/「验证并登录」（会真发请求）；
  * **不按**「用邮件链接登录」（会真发一封邮件到真邮箱）；
  * **不按**「用通行密钥登录」（会唤起系统通行密钥面板 = 跳出本 app 的状态改动）；
  * 只按两枚纯 UI 的：「或者用别的方式」这一枚展开/收起开关，和顶栏的「返回」。

装置复用 `scripts/qa/ai-face-ios.py` 已经量好的那一套视口判据（`tap_in_viewport` /
`reveal_in_viewport` / `require_appearance`），**不重抄一份** —— 那两枚各自踩过一次红，
抄一遍等于把坑复制一遍。
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


# 先载 profile-settings-ios（ai-face 自己也载它，走同一个 sys.modules 键就不会执行两遍）
PS = _load("heyta_profile_settings_ios", "scripts/qa/profile-settings-ios.py")
AIF = _load("heyta_ai_face_ios", "scripts/qa/ai-face-ios.py")

Probe, T, any_of = PS.Probe, PS.T, PS.any_of
present, labels, JourneyError = PS.present, PS.labels, PS.JourneyError
TracingProbe, require_appearance = AIF.TracingProbe, AIF.require_appearance
tap_in_viewport, reveal_in_viewport = AIF.tap_in_viewport, AIF.reveal_in_viewport
PROFILE_ROWS, BACK = AIF.PROFILE_ROWS, AIF.BACK

SIGNIN_CTA = T("注册 / 登录", "Sign in or register")        # 面板入口（「我的」那一枚主按钮）
AUTH_TITLE = T("注册 / 登录", "Sign in or register")        # ⚠️ 与上面**同字**，所以不能当到达判据
PASSWORD_LOGIN = T("用邮箱和密码登录", "Sign in with email and password")
OTHER_WAYS = T("或者用别的方式", "Or use another way")       # Pressable 的 accessibilityLabel，展开后不变
OTHER_WAYS_OPEN = T("其他登录方式", "Other ways to sign in")
OTHER_WAYS_CLOSE = T("收起其他登录方式", "Hide other ways to sign in")
MAGIC_LINK = T("用邮件链接登录", "Sign in with an email link")
PASSKEY = T("用通行密钥登录", "Sign in with a passkey")
EMAIL_LABEL = T("邮箱", "Email")
EMAIL_PLACEHOLDER = T("你的邮箱地址", "Your email address")
TERMS = T("我同意服务条款与隐私政策，并允许本机联网",
          "I agree to the terms and privacy policy, and allow this device to connect")

# 展开之后才会出现的两枚 ⇒ 到达判据用它们的 OR。
EXPANDED_MARKS = any_of(MAGIC_LINK, PASSKEY)


def toggle_node(tree):
    # 把「或者用别的方式」这枚开关的**整条 AX 节点**记进读数：`SectionHeader` 的标题
    # （其他登录方式 / 收起其他登录方式）在装机态读不到，要判断这是"整棵树上没有"还是
    # "被父节点的 accessibilityLabel 合成掉了"，就得看这枚节点自己带不带状态/值。
    return PS.AX.find(tree, OTHER_WAYS[0], False, False, None, False, 0)


ACTIVE: list[tuple] = []


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--udid", default="")
    ap.add_argument("--evidence-dir", default="")
    ap.add_argument("--idb", default=str(Path.home() / ".heyta-tools/idb/venv/bin/idb"))
    ap.add_argument("--companion", default=str(Path.home() / ".heyta-tools/idb/idb_companion"))
    ap.add_argument("--timeout", type=float, default=10.0)
    a = ap.parse_args()
    if not a.udid or not a.evidence_dir:
        raise SystemExit("both --udid and --evidence-dir are required (one directory per appearance mode)")

    appearance = require_appearance(a.udid, a.evidence_dir)
    probe = TracingProbe(argparse.Namespace(
        udid=a.udid, idb=a.idb, companion=a.companion, evidence_dir=a.evidence_dir, timeout=a.timeout))
    ACTIVE.append((probe, Path(a.evidence_dir) / "account-face-journey.json", a.udid))

    subprocess.run(["xcrun", "simctl", "terminate", a.udid, "com.heyta"], capture_output=True, text=True)
    time.sleep(1.0)
    launched = subprocess.run(["xcrun", "simctl", "launch", a.udid, "com.heyta"],
                              capture_output=True, text=True)
    if launched.returncode != 0:
        raise JourneyError(f"could not launch com.heyta: {(launched.stderr or launched.stdout).strip()[:200]}")
    time.sleep(4.0)

    tree = probe.wait_for_any_label(any_of(
        T("只用本机", "This device only"),
        T("先离线使用", "Use offline for now"),
        T("任务", "Tasks"),
        T("我的", "Profile"),
    ))
    if present(tree, T("只用本机", "This device only"), pressable=True) is not None:
        probe.tap("choose local-only privacy", T("只用本机", "This device only"), ("先离线使用",))
    if present(probe.tree(), T("先离线使用", "Use offline for now"), pressable=True) is not None:
        probe.tap("choose offline", T("先离线使用", "Use offline for now"), ("任务", "我的"))

    probe.tap("open profile tab", T("我的", "Profile"), PROFILE_ROWS)

    # 「我的」那一屏的 CTA 在首屏内，但**标签与登录页标题同字** —— 所以到达判据不能用标题，
    # 用段内独有的那枚主按钮，并配 `absent=PROFILE_ROWS`（少了这一半，"还停在「我的」"也能判过）。
    tap_in_viewport(probe, "open sign-in", SIGNIN_CTA, PASSWORD_LOGIN, absent=PROFILE_ROWS)
    tree = probe.tree()
    probe.record("auth form state", "passed",
                 marks={m: present(tree, (m,), pressable=True) is not None
                        for pair in (PASSWORD_LOGIN, MAGIC_LINK, PASSKEY, TERMS) for m in pair},
                 emailField=present(tree, EMAIL_LABEL) is not None or present(tree, EMAIL_PLACEHOLDER) is not None,
                 collapsedToggle=present(tree, OTHER_WAYS, pressable=True) is not None,
                 toggleNode=toggle_node(tree),
                 labels=labels(tree)[:140])
    probe.screenshot("auth-sign-in")

    reveal_in_viewport(probe, "reveal other-ways toggle", OTHER_WAYS)
    probe.tap("expand other ways", OTHER_WAYS, EXPANDED_MARKS)
    tree = probe.tree()
    probe.record("expanded state", "passed",
                 headerNow=[m for m in (OTHER_WAYS_OPEN[0], OTHER_WAYS_OPEN[1],
                                        OTHER_WAYS_CLOSE[0], OTHER_WAYS_CLOSE[1])
                            if present(tree, (m,)) is not None],
                 magicLink=present(tree, MAGIC_LINK, pressable=True) is not None,
                 passkey=present(tree, PASSKEY, pressable=True) is not None,
                 toggleNode=toggle_node(tree),
                 labels=labels(tree)[:140])
    probe.screenshot("auth-other-ways-expanded")

    # 同一枚 Pressable（`accessibilityLabel` 始终是「或者用别的方式」），再按一次收起。
    # 到达判据反过来：展开那两枚**消失**才算收回去。
    probe.tap("collapse other ways", OTHER_WAYS, PASSWORD_LOGIN, absent=EXPANDED_MARKS)
    probe.record("collapsed again", "passed",
                 expandedGone=present(probe.tree(), MAGIC_LINK, pressable=True) is None)

    probe.tap("auth back to profile", BACK, PROFILE_ROWS, absent=PASSWORD_LOGIN)

    out = Path(a.evidence_dir) / "account-face-journey.json"
    out.write_text(json.dumps({
        "startedAt": time.time(),
        "appearance": appearance,
        "steps": probe.steps,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": "passed", "steps": len(probe.steps), "evidence": str(out)},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except JourneyError as exc:
        if ACTIVE:
            probe, out, udid = ACTIVE[-1]
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps({"status": "failed", "error": str(exc),
                                       "appearance": subprocess.run(
                                           ["xcrun", "simctl", "ui", udid, "appearance"],
                                           capture_output=True, text=True).stdout.strip(),
                                       "steps": probe.steps},
                                      ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
