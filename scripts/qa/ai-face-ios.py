#!/usr/bin/env python3
"""iOS **AI 面**装机态旅程：「我的」→「AI 助手」对话面，以及设置里的「AI 与集成」段。

为什么单独一枚脚本：`profile-settings-ios.py` 那一族走的是设置面五屏，射程里**没有** AI 面；
iOS 侧此前没有任何一条旅程走到过助手屏（Android 有 `ai-assistant-atomic-android.py`，iOS 没有对等物）。

三条纪律：
  * 定位符只取**移动端代码真的读走的键**的词值 —— 现量方法写在下面 `ASSISTANT_*` 那几行旁边。
    按屏上"看着像"的词猜会被 `check:locator-labels` 判红（本枚脚本第一版就是这么被抓住的：
    `mobile.ai.section.mode`「快捷开始」/ `mobile.ai.task.none` / `mobile.ai.notConfigured.title`
    三枚键**目录里有、移动端一处都不读**，写进定位符就是两种语态都打不中）。
  * 每一屏都落图 + 落 `labels`（读数与图同批，AGENTS §6.2 规定一）。
  * **只读**：不发送对话、不勾工具、不改档位 —— 那会改这台共享机的持久设置。
    「配置 AI」按下去只是跳进设置段，看一眼就返回。
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
SPEC = importlib.util.spec_from_file_location(
    "heyta_profile_settings_ios", ROOT / "scripts" / "qa" / "profile-settings-ios.py")
PS = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules["heyta_profile_settings_ios"] = PS
SPEC.loader.exec_module(PS)

Probe, T, any_of = PS.Probe, PS.T, PS.any_of
present, labels, JourneyError = PS.present, PS.labels, PS.JourneyError

PROFILE_ROWS = ("设置, 个人资料、偏好、同步与安全", "设置", "Settings")
ASSISTANT_ENTRY = T("AI 助手", "AI assistant")          # mobile.ai.entry / mobile.ai.title
AI_GROUP = T("AI 与集成", "AI and integrations")        # mobile.settings.section.ai
BACK = T("返回", "Back")                                # mobile.ai.back
CLOSE = T("关闭", "Close")                              # 设置面板（模态）自己的退出键
SETUP_AI = T("配置 AI", "Set up AI")                    # mobile.ai.goSettings
ENABLE_AI = T("启用 AI 功能", "Enable AI features")     # web.ai.settings.enabled.label（移动端复用）
AI_SETTINGS_TITLE = T("AI 设置", "AI settings")
ENDPOINTS_TITLE = T("端点", "Endpoints")
GREETING = T("今天想先完成什么？", "What would you like to finish today?")   # web.ai.chat.greeting
NOT_CONFIGURED = T("可以直接查询本机任务。配置 AI 后，还能整理想法和安排计划。",
                   "Ask about local tasks now. Set up AI to organize ideas and plan ahead.")
PRIVACY_BLOCKED = T("当前只使用本机", "This device is offline")
HOST_FAILED = T("读不到这台设备上的数据", "Could not read the data on this device")

# iOS 的「帮助面」= 设置 › 常规 › 帮助与反馈 这一节（台账那句"…/帮助"指的就是它）。
# 🔴 它**不叫**"帮助"，而且整节在常规的折叠线以下 —— 第一版按 `apps/mobile/src` 里
# grep 不到 "help|帮助" 就判"iOS 没有帮助面"，是因为这些词全在 i18n 目录里，
# 壳代码只读键（#473 的同一族：字面量不在场 ≠ 功能不在场）。
GENERAL_GROUP = T("常规", "General")                                # mobile.settings.section.general
HELP_SECTION = T("帮助与反馈", "Help and feedback")                  # mobile.settings.feedback.section
FEEDBACK_ROW = T("投诉与举报", "Complaints and reports")             # common.feedback.label

# 助手屏同一时刻只会渲染一枚状态卡 ⇒ 到达判据是这四枚的 OR。
ASSISTANT_MARKS = any_of(GREETING, NOT_CONFIGURED, PRIVACY_BLOCKED, HOST_FAILED)
AI_SETTINGS_MARKS = any_of(ENABLE_AI, AI_SETTINGS_TITLE, ENDPOINTS_TITLE)
TABS = ["任务", "日历", "专注", "分类", "我的", "Tasks", "Calendar", "Focus", "Lists", "Me"]


def tab_top(nodes):
    """tab 栏顶边，**从树里现量**；这一屏**没有** tab 栏就返回 `None`。
    ⚠️ 只收下半屏那些节点 —— 首屏顶栏标题也叫「任务」，直接取 min 会把顶栏当 tab 栏（#474 ⑵）。
    ⚠️ 不要给默认值：设置面里那些**模态**（常规 / AI 与集成）根本没有 tab 栏，
    写死 776 会把"最后一行明明整枚在屏上"判成看不见 —— 本枚脚本实测踩过。"""
    ys = [PS.AX.frame_of(n)[1] for n in nodes
          if (PS.AX.label_of(n) or "") in TABS and PS.AX.frame_of(n) and PS.AX.frame_of(n)[1] > 400]
    return int(min(ys)) if ys else None


def viewport_bottom(nodes) -> int:
    """这一屏"整枚看得见"的下界：有 tab 栏 ⇒ 它顶边 − 4；没有 ⇒ 屏幕底边 − 8。
    屏幕高度也**从树里现量**，量不到就抛 —— 猜一个会把"点得到 vs 点不到"整条判据弄哑。"""
    bar = tab_top(nodes)
    if bar is not None:
        return bar - 4
    _w, h = PS.AX.screen_size(nodes)
    if h is None:
        raise JourneyError("no Application node in the tree, cannot size the viewport")
    return int(h) - 8


def _find_row(nodes, wanted):
    return next((n for n in nodes
                 if any(c in (PS.AX.label_of(n) or "") for c in wanted)
                 and (PS.AX.frame_of(n) or [0, 0, 0, 0])[3] > 0), None)


def settle_in_viewport(probe: Probe, candidates, *, max_swipes: int = 8):
    """滚到**整枚行底边 ≤ 视口下界**且**画面已经停稳**，返回那一帧 `(x, y, w, h)`；滚不出来返回 `None`。
    两半各挡一种失效（都是环境陷阱 #474 这一族，本枚脚本第一版被咬的就是第二种）：
      * 只判"在不在树里" ⇒ 按下去开的是**上面那一行**（AX 的 frame 是滚动内容坐标）；
      * 判了视口但**惯性滚动还没停** ⇒ 校验用的 frame 与真正按下去时的 frame 不是同一帧，
        照样按错行 —— 所以这里连读两遍、frame 相近才交回。"""
    wanted = tuple(candidates)
    last_y = None
    for _ in range(max_swipes + 1):
        nodes = probe.tree()
        limit = viewport_bottom(nodes)
        node = _find_row(nodes, wanted)
        if node is not None:
            x, y, w, h = PS.AX.frame_of(node)
            if y > 0 and (y + h) <= limit:
                time.sleep(1.2)
                settled = _find_row(probe.tree(), wanted)
                # 停稳判据用**容差**不用相等：现量到惯性滚完之后画面还会自己挪 7pt
                # （`y=450` → `y=443`），要求逐位相等会永远进不去那一支。
                if settled is not None:
                    sx, sy, _sw, sh = PS.AX.frame_of(settled)
                    if abs(sx - x) <= 12 and abs(sy - y) <= 12 and sh == h:
                        return (sx, sy, _sw, sh)
                continue
        PS.AX.idb_swipe(probe.idb, probe.companion, probe.udid, 200, 620, 200, 430, 0.3)
        time.sleep(1.4)
        nodes = probe.tree()
        stuck = _find_row(nodes, wanted)
        frame = PS.AX.frame_of(stuck) if stuck is not None else None
        if frame is not None and last_y is not None and abs(frame[1] - last_y) <= 1:
            # 已经滚到容器末尾，位置不再动 —— 再滚下去只会白烧时间。
            return None
        last_y = frame[1] if frame is not None else None
    return None


def tap_in_viewport(probe: Probe, name: str, candidates, then, *, absent=(), max_swipes: int = 8) -> None:
    wanted = tuple(candidates)
    if settle_in_viewport(probe, wanted, max_swipes=max_swipes) is None:
        raise JourneyError(f"{name}: {wanted!r} never became fully visible above the viewport bottom")
    probe.tap(name, wanted, then, absent=absent)


def reveal_in_viewport(probe: Probe, name: str, candidates, *, max_swipes: int = 8):
    """只要**看得见**，不按。用于"这一节在装机态到底长什么样"那一类取证步。
    ⚠️ 不用 `Probe.scroll_to`：它瞄准的是 `scroll_into_view` 能认出的元素，实测对
    「投诉与举报」这种**整句无障碍名**的行会回 `found: True / visible: False / swipes: 10`
    （位置一动不动，因为画面本来就已经在末尾）—— 那是 #473 那一族换了一个消费者。"""
    wanted = tuple(candidates)
    frame = settle_in_viewport(probe, wanted, max_swipes=max_swipes)
    if frame is None:
        raise JourneyError(f"{name}: {wanted!r} never became fully visible above the viewport bottom")
    probe.record(name, "passed", target=list(wanted), frame=[int(v) for v in frame])
    return frame


class TracingProbe(Probe):
    # 每记一步就往 stderr 打一行 —— 红在哪一步不该只靠异常文本反推。
    # ⚠️ 写成注释而不是单行 docstring：`check-locator-labels` 只跳过**含换行**的字符串
    # （它按"多行=说明"判），单行 docstring 会被当成一枚界面标签 ⇒ 整道门红。

    def record(self, name: str, status: str, **details) -> None:
        super().record(name, status, **details)
        print(f"[step] {name}: {status}", file=sys.stderr, flush=True)


ACTIVE: list[tuple] = []


def require_appearance(udid: str, evidence_dir: str) -> str:
    """#472 的第二半：`--evidence-dir` 末级目录名是 `light`/`dark` 时，
    先拿设备的当前外观档比对，**不符就拒写**。
    本线实测踩过 —— 暗档跑完没还原就重跑"亮档"，两趟失败读数都落进了 `light/`，
    而 JSON 里那枚 `appearance` 一直诚实地写着 `dark`，只是没人拿它跟目录名比。
    返回读到的档名，调用方可以直接存进读数里。"""
    claimed = Path(evidence_dir).resolve().name
    actual = subprocess.run(["xcrun", "simctl", "ui", udid, "appearance"],
                            capture_output=True, text=True).stdout.strip()
    if claimed in ("light", "dark") and actual != claimed:
        raise SystemExit(
            f"refusing to write: evidence dir says '{claimed}' but the device is '{actual}' "
            f"(switch it with: xcrun simctl ui {udid} appearance {claimed}; "
            f"after 'dark' a shutdown+boot is required — trap #471)")
    return actual


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--udid", default="")
    ap.add_argument("--evidence-dir", default="")
    ap.add_argument("--idb", default=str(Path.home() / ".heyta-tools/idb/venv/bin/idb"))
    ap.add_argument("--companion", default=str(Path.home() / ".heyta-tools/idb/idb_companion"))
    ap.add_argument("--timeout", type=float, default=10.0)
    a = ap.parse_args()
    if not a.udid or not a.evidence_dir:
        # 落点必须按档分开目录，否则后一趟静默吃掉前一档证据（环境陷阱 #472）。
        raise SystemExit("both --udid and --evidence-dir are required (one directory per appearance mode)")

    # 🔴 #472 的第二半：目录名说的档要和设备现在的档对上才让写（详见 `require_appearance`）。
    appearance = require_appearance(a.udid, a.evidence_dir)
    # `startedAt` 早先写在收笔那一行里，量到的是**收笔时刻**（比所有 `step.at` 都晚）。
    # 起跳点要在起跳之前取。
    started_at = time.time()

    probe = TracingProbe(argparse.Namespace(
        idb=a.idb, companion=a.companion, udid=a.udid, timeout=a.timeout, evidence_dir=a.evidence_dir))
    ACTIVE.append((probe, Path(a.evidence_dir) / "ai-face-journey.json", a.udid))

    # 🔴 起手必须**重启这枚 app**，不能假设它停在哪个屏：「我的」那一栈是带历史的，
    # 上一趟留在设置目录时，点 tab 只是回到栈顶（设置目录），于是「AI 助手」那一行根本不在场 ——
    # 本枚脚本第一版就是这么红的（现量：`visible labels` 回的是 常规/同步与隐私/AI 与集成/… 那一屏）。
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
    probe.screenshot("profile")

    # 「AI 助手」那一行在「我的」这一屏的哪一段是内容决定的，所以先滚到它**整枚在 tab 栏之上**再按。
    tap_in_viewport(probe, "open assistant", ASSISTANT_ENTRY, ASSISTANT_MARKS, absent=PROFILE_ROWS)
    tree = probe.tree()
    probe.record("assistant state", "passed",
                 marks={mark: present(tree, (mark,)) is not None for mark in ASSISTANT_MARKS},
                 setupAi=present(tree, SETUP_AI, pressable=True) is not None,
                 labels=labels(tree)[:140])
    probe.screenshot("assistant")

    if present(probe.tree(), SETUP_AI, pressable=True) is not None:
        probe.tap("assistant -> ai settings", SETUP_AI, AI_SETTINGS_MARKS)
        probe.screenshot("ai-settings-via-assistant")
        # 那一枚开的是**设置面板（模态）**，它自己的退出键是「关闭」不是「返回」——
        # 第一版按「返回」退，等回来照到的还是面板那一屏（现量：`visible labels` 回的是
        # 常规/同步与隐私/AI 与集成/… 那一组，而不是助手那四枚状态卡）。
        probe.tap("close ai settings sheet", CLOSE, ASSISTANT_MARKS, absent=ENABLE_AI)
    else:
        probe.record("assistant -> ai settings", "entry-absent",
                     note="this state card has no setup button (configured or blocked state)")

    probe.tap("assistant back to profile", BACK, PROFILE_ROWS)
    probe.tap("open settings", PROFILE_ROWS, AI_GROUP)
    # ── 先走「常规 › 帮助与反馈」（iOS 的帮助面），再走 AI 段 —— 两者都在同一份目录里，
    #    一次进入目录取两屏，省一次重启。
    #    到达判据用「帮助与反馈」：目录里**没有**这个词，所以它在树里出现就等于已经进了段。
    #    （#474：段内折叠线以下的行也在树里 ⇒ 到达判据不要求它在视口内，视口的事交给 scroll_to。）
    tap_in_viewport(probe, "open general group", GENERAL_GROUP, HELP_SECTION)
    # ⚠️ `scroll_to` 滚的是**可交互元素**：给它节标题「帮助与反馈」会回
    # `found: False / scrollRc: element-left-tree / swipes: 0` —— 那枚标题在树里（到达判据
    # 就是它，刚 passed），但它不是 `scroll_into_view` 能瞄准的对象。瞄准节里那行**可点**的。
    reveal_in_viewport(probe, "scroll to help section", FEEDBACK_ROW)
    tree = probe.tree()
    probe.record("help section", "passed",
                 helpSection=present(tree, HELP_SECTION) is not None,
                 feedbackRow=present(tree, FEEDBACK_ROW, pressable=True) is not None,
                 labels=labels(tree)[:140])
    probe.screenshot("help-feedback")
    probe.tap("general back", BACK, GENERAL_GROUP, absent=HELP_SECTION)
    # 到达判据只用 `启用 AI 功能` 这一枚**段内独有**的开关行，不用三枚标题的 OR。
    # ⚠️ 这条不是"抓到假通过"：本枚脚本第一次红其实死在**最后一步**（目录层的退出键是「关闭」，
    # 见下面 `settings back` 那条注释）。这里收窄成单枚只是把判据写准，别把它读成一条实测到的假绿。
    tap_in_viewport(probe, "open ai group", AI_GROUP, (ENABLE_AI[0], ENABLE_AI[1]))
    tree = probe.tree()
    probe.record("ai settings group", "passed", labels=labels(tree)[:140])
    probe.screenshot("ai-settings-group")
    # `then` 用目录里那一行、`absent` 用段里独有的标题：只等「AI 与集成」会在**段内**就判到，
    # 因为段内也渲染这个词 —— 少了 absent 这一半，返回这一步等于没判。
    probe.tap("ai group back", BACK, AI_GROUP, absent=ENABLE_AI)
    # 目录那一层的退出键是「关闭」（它是模态的根），「返回」只在**段内**才有 ——
    # 现量：整条旅程前 14 步全 passed，只有这一步等「返回」等不到，回的是目录那一屏。
    probe.tap("settings back", CLOSE, ASSISTANT_ENTRY, absent=AI_GROUP)

    out = Path(a.evidence_dir) / "ai-face-journey.json"
    out.write_text(json.dumps({
        "startedAt": started_at,
        "finishedAt": time.time(),
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
        # 红的那一步也要留下**已经取到的读数**（环境陷阱 #467 那一族：中途抛错把整趟读数带走）。
        if ACTIVE:
            probe, out, udid = ACTIVE[-1]
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps({
                "status": "failed", "error": str(exc)[:600], "steps": probe.steps,
                "appearance": subprocess.run(["xcrun", "simctl", "ui", udid, "appearance"],
                                             capture_output=True, text=True).stdout.strip(),
            }, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"status": "failed", "error": str(exc)[:600]}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
