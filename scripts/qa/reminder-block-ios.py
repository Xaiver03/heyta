#!/usr/bin/env python3
"""iOS **任务详情里的提醒块**（共享 `ReminderList`）装机态设备腿。

前身是 r132 落在取证目录里的一次性探针（`apps/mobile/evidence/…/ios-reminder-block-r132/probe-reminder-block.py`）。
搬到 `scripts/qa/` 是因为目标里点名"提醒状态"，而这一格此前只有那一趟读数，且它拿的是旧件；
一次性探针没有"下一位怎么重跑"的位置。

🔴 这一趟（r141）在**当前源码件**上重跑那枚旧探针时，那一下"加提醒"打空了
   （`01-reminder-empty.png` 与 `02-reminder-added.png` 同一张画面、加完四条读数全 `present:false`）。
   现量到的是**两重**失效，各挡一种：
   ① **射程不含底部 tab 栏**：旧守卫是 `0 < cy < 屏高 - 40`（874pt 屏 ⇒ 834），而那枚按钮中心在 796pt ——
      屏内、tab 栏底下（tab 栏顶边实测 776）。详情面板开着的时候 **tab 栏那几枚节点根本不在 AX 树里**
      （`AIF.tab_top(nodes)` 回 None ⇒ `viewport_bottom` 自己退到屏高-8=866），所以光换 `viewport_bottom()` 不够，
      必须在**列表面**先把 tab 栏顶边量下来当上界用。r132 那趟只是恰好滚到 y=360 才躲开 ⇒ 不是产品改了。
   ② **惯性没停就按**：守卫读到 `提醒` 在 y=720，紧接着的截图里它在 ~553 —— 中间画面又自己上滚了 167pt，
      于是"校验用的 frame"与"按下去时的 frame"不是同一帧（环境陷阱 #474 的第二种失效，
      `ai-face-ios.settle_in_viewport` 的注释里写的就是这一条）。⇒ 这一枚连读两遍、frame 相近才交回。
   并把"加完看不到那四条 / 删完回不到空态"写成**红**，不再让打空只留下一条读数被读成"通过"。

射程：空态 → 加一条 → **推迟** → **关闭** → 删回空态 → **删掉自己建的那条任务**（旧探针建完任务不管，
所以 r132 那趟之后要另跑一枚 `_cleanup/clean-own-tasks.py` 手工收 17 条）。
只按**本次建的这一条标题**删，标题对不上就不删。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str, rel: str):
    mod = sys.modules.get(name)
    if mod is not None:
        return mod
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {rel}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# tasks-ux-ios 提供 Probe / create_task / ensure_on_tasks / AX / T；ai-face 提供视口与外观那两枚尺。
# 两枚都在导入时载（ai-face 自己会载 profile-settings，走同一个 sys.modules 键所以不会执行两遍）。
JU = _load("heyta_tasks_ux_ios", "scripts/qa/tasks-ux-ios.py")
AIF = _load("heyta_ai_face_ios", "scripts/qa/ai-face-ios.py")

AX, T, ProbeError = JU.AX, JU.T, JU.ProbeError

# 🔴 一枚标签都不许在**模块顶层**求值：`JU.ENGLISH` 是探针读到第一帧树之后才翻的那一枚旗，
#    顶层常量会把英文态永远锁成中文（同族在 r140 那一趟就是靠"函数内求值"躲过这一发的）。
#    所以下面两张表存的是**词条的两列**，取哪一列由 `T()` 在调用那一刻决定。
LABELS = {
    "section": ("提醒", "Reminders"),
    "empty": ("还没有提醒", "No reminders yet"),
    "add": ("添加提醒", "Add reminder"),
    "absolute1h": ("1 小时后提醒", "Remind me in 1 hour"),
    "scheduled": ("待触发", "Scheduled"),
    "snoozed": ("已推迟", "Snoozed"),
    "dismissed": ("已关闭", "Dismissed"),
    "snooze": ("稍后提醒", "Snooze"),
    "dismiss": ("关闭提醒", "Dismiss"),
    "remove": ("删除提醒", "Delete reminder"),
    "noDue": ("这个任务没有截止时间，只能按绝对时刻提醒",
              "This task has no due date, so only an absolute time can be set"),
    "closeDetail": ("关闭任务详情", "Close task details"),
}

# 🔴 三枚动作按钮**不是**按屏上那三个字定位的：它们的可及名称是整句、带时刻
#   （「删除 10-18 21:23 的提醒」/「关闭 …」/「把 … 的提醒推迟 10 分钟」）。
#   精确串打不中，退到"删除提醒…"那样的子串也打不中（词序不是那个形状）⇒ 三枚全报 present=false，
#   看着完全像"这三枚没有无障碍标签"那样一条假 a11y 缺陷（#473）。
#   这里拿**词条模板**当唯一真源、只把 `{when}` 那一段通配 —— 而不是在探针里自己拼一个动词词表，
#   那样英文那一侧就成了没人守的抄件（`check:locator-labels` 会把这条判红）。
A11Y = {
    "reminder.a11y.snooze": ("把 {when} 的提醒推迟 10 分钟", "Snooze the reminder at {when} by 10 minutes"),
    "reminder.a11y.dismiss": ("关闭 {when} 的提醒", "Dismiss the reminder at {when}"),
    "reminder.a11y.remove": ("删除 {when} 的提醒", "Delete the reminder at {when}"),
}
SNOOZE = "reminder.a11y.snooze"
DISMISS = "reminder.a11y.dismiss"
REMOVE = "reminder.a11y.remove"
AFTER_ADD = ["scheduled", SNOOZE, DISMISS, REMOVE]
AFTER_SNOOZE = ["snoozed", "scheduled", SNOOZE, DISMISS, REMOVE]
AFTER_DISMISS = ["dismissed", "scheduled", "snoozed", REMOVE]


def label(key: str) -> str:
    zh, en = LABELS[key]
    return T(zh, en)


def a11y_pattern(key: str) -> re.Pattern[str]:
    zh, en = A11Y[key]
    template = T(zh, en)
    return re.compile(".*".join(re.escape(part) for part in re.split(r"\{[^}]+\}", template)))


def raw_tap(probe, x: int, y: int) -> None:
    r = subprocess.run(
        [probe.idb, *AX.companion_args(probe.companion), "ui", "tap", str(x), str(y), "--udid", probe.udid],
        capture_output=True, text=True, timeout=60,
    )
    if r.returncode != 0:
        raise ProbeError(f"tap at {x},{y} failed: {(r.stderr or r.stdout).strip()[:200]}")


def swipe_up(probe) -> None:
    AX.idb_swipe(probe.idb, probe.companion, probe.udid, 200, 620, 200, 280, 0.3)
    time.sleep(1.0)


# `want` 是一枚 `LABELS`/`A11Y` 键，或者一枚**已经格式化好**的整串标签（行上那枚删除动作）。
def pick(nodes, want: str):
    if want in A11Y:
        pattern = a11y_pattern(want)
        for n in nodes:
            if pattern.fullmatch(AX.label_of(n) or ""):
                return n, "a11y-template"
        return None, "absent"
    exact = label(want) if want in LABELS else want
    for n in nodes:
        if (AX.label_of(n) or "") == exact:
            return n, "exact"
    return None, "absent"


def tab_bar_top(probe) -> int | None:
    """底部 tab 栏顶边 —— **只能在列表面上量**：详情面板开着时那几枚节点不在 AX 树里（见文件头①）。
    量不到就返回 None，调用方退到 `viewport_bottom` 自己的那条腿 —— 写死一个数会把判据弄哑。"""
    return AIF.tab_top(probe.tree())


def visible_bottom(nodes, clamp: int | None) -> int:
    """这一屏"整枚点得到"的下界：`viewport_bottom`（树里有 tab 栏 ⇒ 它顶边 − 4，没有 ⇒ 屏高 − 8）
    再与列表面量来的那枚上界取**小**的。量不到屏高时 `viewport_bottom` 自己抛（#474）。"""
    bottom = int(AIF.viewport_bottom(nodes))
    return bottom if clamp is None else min(bottom, clamp)


def frame_of(node) -> list[int]:
    x, y, w, h = AX.frame_of(node)
    return [round(x), round(y), round(w), round(h)]


def settle(probe, wanted: tuple[str, ...], clamp: int | None, max_swipes: int = 12):
    """滚到那一枚**整枚落在下界之上**、**且画面已经停稳**才交回 `(node, frame)`。

    停稳 = 隔 1.2s 连读两遍、frame 相近（容差 12pt，不是逐位相等 —— 惯性滚完画面还会自己挪几 pt）。
    这一半挡的是文件头②：只判"在不在视口里" ⇒ 校验用的 frame 与按下去时的 frame 不是同一帧。
    滚满还不行 ⇒ 回 (None, 最后一次读数)，由调用方判红。"""
    last: dict = {}
    for _ in range(max_swipes + 1):
        nodes = probe.tree()
        bottom = visible_bottom(nodes, clamp)
        for want in wanted:
            node, how = pick(nodes, want)
            if node is None:
                continue
            x, y, w, h = frame_of(node)
            if y >= 0 and (y + h) <= bottom:
                time.sleep(1.2)
                again, _ = pick(probe.tree(), want)
                if again is not None:
                    sx, sy, sw, sh = frame_of(again)
                    if abs(sx - x) <= 12 and abs(sy - y) <= 12 and sh == h:
                        return again, {"want": want, "match": how, "frame": [sx, sy, sw, sh],
                                       "visibleBottom": bottom, "tabBarTopFromListScreen": clamp}
                    x, y, w, h = [sx, sy, sw, sh]
                node = again
            last = {"want": want, "match": how, "frame": [x, y, w, h],
                    "visibleBottom": bottom, "tabBarTopFromListScreen": clamp}
        swipe_up(probe)
    return None, last


def rows_for(probe, wanted: list[str], clamp: int | None) -> list[dict]:
    nodes = probe.tree()
    bottom = visible_bottom(nodes, clamp)
    out = []
    for want in wanted:
        node, how = pick(nodes, want)
        shown = label(want) if want in LABELS else want
        if node is None:
            out.append({"want": want, "label": shown, "present": False, "visibleBottom": bottom})
            continue
        x, y, w, h = frame_of(node)
        out.append({"want": want, "label": shown, "matchedLabel": AX.label_of(node), "match": how,
                    "present": True, "frame": [x, y, w, h], "bottom": y + h, "visibleBottom": bottom,
                    "tappableAboveTabBar": (y + h) <= bottom})
    return out


# 界面上的时刻长这样：`10-19 18:44`（`MM-DD HH:MM`，中英两语态同一个格式）。
STAMP = re.compile(r"\b(\d{1,2})-(\d{2})\s+(\d{1,2}):(\d{2})\b")


def stamp_of(label: str | None) -> datetime | None:
    """把一行可及名称里那个 `MM-DD HH:MM` 读成 datetime。

    词条没写年份，所以按"离此刻最近"补 —— 跨年的那一格不会因此翻掉比较的符号。
    """
    if not label:
        return None
    match = STAMP.search(label)
    if match is None:
        return None
    month, day, hour, minute = (int(group) for group in match.groups())
    now = datetime.now()
    best: datetime | None = None
    for year in (now.year - 1, now.year, now.year + 1):
        try:
            candidate = datetime(year, month, day, hour, minute)
        except ValueError:
            continue
        if best is None or abs((candidate - now).total_seconds()) < abs((best - now).total_seconds()):
            best = candidate
    return best


# 按下去之后等那一枚**出现** —— 不等 = 把"这条没加上"读成"这一格通过了"。
def wait_present(probe, want: str, seconds: float = 8.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        node, _ = pick(probe.tree(), want)
        if node is not None:
            return node
        time.sleep(0.4)
    return None


# 🔴 iOS 的系统弹窗（加第一条提醒时那枚"想给你发送通知"）**整片顶掉 app 自己的 AX 树**：
#    r141 实测那一棵树只有 5 枚节点（Application + 两行正文 + 两枚按钮），app 那一族标签全读成 absent
#    ⇒ 看着完全像"那一下没生效"。弹窗文案不在本仓词条里（英文那一侧还带弯引号 `Don’t Allow`），
#    按字符串匹配会把这枚装置钉死在一种系统语言上 ⇒ 认**形状**：树很小、里面有两枚按钮。
#    默认动作在右边那一枚是 Apple 的排版契约（现量：「不允许」x=57、「允许」x=205），不是写死坐标。
PROMPT_MAX_NODES = 12


# 有系统弹窗就按掉它（取右边那枚 = 默认动作），并把整棵树的标签记进读数。没弹窗回 False。
def resolve_system_prompt(probe) -> dict | None:
    nodes = probe.tree()
    buttons = [n for n in nodes if n.get("type") == "Button"]
    if len(nodes) > PROMPT_MAX_NODES or len(buttons) < 2:
        return None
    default = max(buttons, key=lambda n: AX.frame_of(n)[0])
    x, y, w, h = frame_of(default)
    record = {"nodes": len(nodes),
              "labels": [AX.label_of(n) for n in nodes if AX.label_of(n)],
              "tapped": AX.label_of(default), "frame": [x, y, w, h]}
    raw_tap(probe, x + w // 2, y + h // 2)
    time.sleep(1.6)
    return record


def row_titles(nodes) -> list[str]:
    prefix = JU.open_task_label("")
    return [(AX.label_of(n) or "")[len(prefix):]
            for n in nodes if (AX.label_of(n) or "").startswith(prefix)]


# 每步增量落盘 —— 中途抛错时已取到的读数不许丢（#467 那一族同形）。
def dump(res: dict, out: Path) -> None:
    (out / "reminder-block.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")


# 只删**本次建的这一条**：行上的动作标签是「删除任务：X」，逐字对上才按；对不上就整块不动。
def delete_own_task(probe, title: str, res: dict, clamp: int | None) -> None:
    want = T("删除任务：{title}", "Delete task: {title}").format(title=title)
    probe.ensure_on_tasks()
    time.sleep(1.5)
    node, guard = settle(probe, (want,), clamp)
    if node is None:
        res["taskDeleted"] = {"title": title, "gone": False, "guard": guard}
        return
    rx, ry, rw, rh = guard["frame"]
    raw_tap(probe, rx + rw // 2, ry + rh // 2)
    time.sleep(1.6)
    res["taskDeleted"] = {"title": title, "frame": [rx, ry, rw, rh],
                          "gone": title not in row_titles(probe.tree())}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--udid", required=True)
    ap.add_argument("--evidence-dir", required=True,
                    help="one directory per cell, later runs must not overwrite earlier ones")
    ap.add_argument("--idb", default=str(Path.home() / ".heyta-tools/idb/venv/bin/idb"))
    ap.add_argument("--companion", default=str(Path.home() / ".heyta-tools/idb/idb_companion"))
    ap.add_argument("--timeout", type=float, default=12.0)
    ap.add_argument("--keep-task", action="store_true",
                    help="keep the task this run created instead of deleting it at the end")
    a = ap.parse_args()

    out = Path(a.evidence_dir)
    appearance = AIF.require_appearance(a.udid, str(out))     # 档名不符就拒写，一行旅程都不走
    out.mkdir(parents=True, exist_ok=True)
    # 起跳点自己造：这一枚上一趟死在详情面板里时，手就留在那一屏（同族教训见 #492）。
    subprocess.run(["xcrun", "simctl", "terminate", a.udid, "com.heyta"], capture_output=True, text=True)
    time.sleep(1.0)
    launched = subprocess.run(["xcrun", "simctl", "launch", a.udid, "com.heyta"], capture_output=True, text=True)
    if launched.returncode != 0:
        raise ProbeError(f"could not launch com.heyta: {(launched.stderr or launched.stdout).strip()[:200]}")
    time.sleep(4.0)
    # 🔴 那一枚授权弹窗**活得过 app 自己**（r141 实测：terminate + 重新 launch 之后它还在，
    #    于是 `ensure_on_tasks()` 读到的还是那 5 枚节点 ⇒ "workspace did not open after onboarding"）。
    #    所以起跳点要把在场的弹窗先按掉，并把它们逐枚记进读数 —— 不是静默吞掉。
    probe = JU.Probe(argparse.Namespace(idb=a.idb, companion=a.companion, udid=a.udid,
                                        timeout=a.timeout, evidence_dir=str(out)))
    title = f"Rem141{int(time.time())}"
    res: dict = {"startedAt": time.time(), "taskTitle": title, "appearance": appearance,
                 "uiLocale": None, "taps": [], "shots": []}
    dump(res, out)

    prompts_at_start = []
    for _ in range(3):
        record = resolve_system_prompt(probe)
        if record is None:
            break
        prompts_at_start.append(record)
    res["systemPromptsAtStart"] = prompts_at_start
    dump(res, out)

    probe.ensure_on_tasks()
    # 🔴 底部 tab 栏的顶边**只在这一个时刻量得到**：详情面板一开，那几枚节点就不在 AX 树里了，
    #    而它仍然画在屏上（r141 实测 776pt）⇒ 之后每一枚"看得见"的判定都拿这个数当下界。
    bar_top = tab_bar_top(probe)
    clamp = None if bar_top is None else bar_top - 4
    res["tabBarTopOnListScreen"] = bar_top
    res["viewportBottomClamp"] = clamp
    dump(res, out)

    probe.create_task(title)

    def fail(message: str) -> ProbeError:
        """抛错前先把**本次建的这条**收掉。

        🔴 「加完必删」对失败支同样成立：r145 新加的「推迟不许提前」那枚断言会在旅程半途红，
        不清的话每条红的一趟都在设备上留一条会真的发通知的任务（这一枚装置跑过一次红的，
        就留过一条 `Rem141…`）。收尾自己炸了也只登记原因，不掩盖真正那条红。
        """
        if not a.keep_task:
            try:
                rm, rm_guard = settle(probe, (REMOVE,), clamp)
                if rm is not None:
                    x, y, w, h = rm_guard["frame"]
                    raw_tap(probe, x + w // 2, y + h // 2)
                    wait_present(probe, "empty", 6.0)
                delete_own_task(probe, title, res, clamp)
            except Exception as e:
                res["cleanupAfterFailure"] = f"{type(e).__name__}: {e}"
        res["abortedWith"] = message
        dump(res, out)
        return ProbeError(message)

    probe.tap((JU.open_task_label(title),), "open task detail")
    res["uiLocale"] = probe.ui_locale

    node, guard = settle(probe, ("section",), clamp)
    if node is None:
        raise fail(f"reminder section never settled fully above the tab bar: {guard}")
    res["reminderSection"] = guard
    res["emptyState"] = rows_for(probe, ["section", "empty", "add", "absolute1h", "noDue"], clamp)
    probe.screenshot("01-reminder-empty")
    res["shots"].append("01-reminder-empty")
    dump(res, out)

    add_node, add_guard = settle(probe, ("add", "absolute1h"), clamp)
    if add_node is None:
        raise fail(f"no add-reminder control ever settled fully above the tab bar: {add_guard}")
    ax, ay, aw, ah = add_guard["frame"]
    raw_tap(probe, ax + aw // 2, ay + ah // 2)
    res["taps"].append({"description": "add reminder", "label": AX.label_of(add_node), **add_guard})
    added = wait_present(probe, "scheduled") is not None
    if not added:
        res["promptOnAdd"] = resolve_system_prompt(probe)
        if res["promptOnAdd"] is not None:
            added = wait_present(probe, "scheduled") is not None
    if not added:
        # 🔴 这一支就是 r141 那一趟走进的形状：那一下打空了，旧探针却把整格当"取到读数"交回去。
        res["afterAdd"] = rows_for(probe, AFTER_ADD, clamp)
        probe.screenshot("02-add-did-not-land")
        res["shots"].append("02-add-did-not-land")
        dump(res, out)
        raise fail(f"adding a reminder changed nothing on screen (tap landed at "
                         f"{ax + aw // 2},{ay + ah // 2}, bound {add_guard.get('visibleBottom')}): "
                         f"{res['afterAdd']}")
    res["afterAdd"] = rows_for(probe, AFTER_ADD, clamp)
    probe.screenshot("02-reminder-added")
    res["shots"].append("02-reminder-added")
    dump(res, out)

    # 🔴 「推迟」「关闭」这两步是**断言**，不是"看得见就按、看不见就跳"：跳过去就等于把
    #    "设备上的已推迟 / 已关闭两态长什么样"这一格又留成没有读数（红一次是有读数的红）。
    for want, phase, reading, shot in ((SNOOZE, "snoozed", AFTER_SNOOZE, "03-reminder-snoozed"),
                                       (DISMISS, "dismissed", AFTER_DISMISS, "04-reminder-dismissed")):
        node, guard = settle(probe, (want,), clamp)
        if node is None:
            dump(res, out)
            raise fail(f"the {want} action never settled fully above the tab bar: {guard}")
        bx, by, bw, bh = guard["frame"]
        tapped_label = AX.label_of(node)
        raw_tap(probe, bx + bw // 2, by + bh // 2)
        res["taps"].append({"description": f"reminder action {want}", "label": tapped_label, **guard})
        key = "afterSnooze" if phase == "snoozed" else "afterDismiss"
        if wait_present(probe, phase) is None:
            res[key] = rows_for(probe, reading, clamp)
            probe.screenshot(f"{shot}-not-reached")
            res["shots"].append(f"{shot}-not-reached")
            dump(res, out)
            raise fail(f"tapping {AX.label_of(node)!r} did not move the block into phase "
                             f"{phase!r}: {res[key]}")
        res[key] = rows_for(probe, reading, clamp)
        if want == SNOOZE:
            # 🔴 「推迟 10 分钟」不许把提醒往**过去**挪。按钮自己念出的时刻就是基准
            #    （`把 10-19 18:44 的提醒推迟 10 分钟`），按完之后那一行念的时刻必须更晚。
            #    r142 装机态四档实测的是**提前 50 分钟** —— 那时实现按墙钟算（台账 r142 那格）。
            before = stamp_of(tapped_label)
            after = next((stamp_of(row.get("matchedLabel")) for row in res[key]
                          if row.get("present") and stamp_of(row.get("matchedLabel")) is not None), None)
            res["snoozeMove"] = {"before": None if before is None else before.isoformat(),
                                 "after": None if after is None else after.isoformat(),
                                 "movedLater": None if (before is None or after is None) else after > before}
            if before is None or after is None:
                probe.screenshot(f"{shot}-time-unreadable")
                res["shots"].append(f"{shot}-time-unreadable")
                dump(res, out)
                raise fail(f"cannot read the reminder's own time across the snooze tap "
                                 f"(before {tapped_label!r}, after rows {res[key]}) — 这条判据没有读数")
            if after <= before:
                probe.screenshot("03-snooze-moved-earlier")
                res["shots"].append("03-snooze-moved-earlier")
                dump(res, out)
                raise fail(f"「推迟」 moved the reminder EARLIER: {before.isoformat()} -> "
                                 f"{after.isoformat()}（装机态那条仍在按墙钟算推迟）")
        probe.screenshot(shot)
        res["shots"].append(shot)
        dump(res, out)

    # 加完必删 —— 不删的话这条 +1h 的提醒会真的发一条本地通知。
    rm_node, rm_guard = settle(probe, (REMOVE,), clamp)
    if rm_node is None:
        res["removeReminderGuard"] = rm_guard
        dump(res, out)
        raise fail(f"the delete-reminder action never settled fully above the tab bar: {rm_guard}")
    rx, ry, rw, rh = rm_guard["frame"]
    raw_tap(probe, rx + rw // 2, ry + rh // 2)
    res["taps"].append({"description": "remove reminder", "label": AX.label_of(rm_node), **rm_guard})
    removed = wait_present(probe, "empty") is not None
    if not removed:
        res["promptOnRemove"] = resolve_system_prompt(probe)
        if res["promptOnRemove"] is not None:
            removed = wait_present(probe, "empty") is not None
    res["removedBackToEmpty"] = removed
    res["afterRemove"] = rows_for(probe, ["scheduled", "empty"], clamp)
    probe.screenshot("05-reminder-removed")
    res["shots"].append("05-reminder-removed")
    dump(res, out)
    if not removed:
        raise fail(f"deleting the reminder did not bring the block back to its empty state: "
                         f"{res['afterRemove']}")

    try:
        close_node, _ = settle(probe, ("closeDetail",), clamp, max_swipes=4)
        if close_node is not None:
            cx, cy = AX.center(close_node)
            raw_tap(probe, cx, cy)
            res["taps"].append({"description": "close detail", "label": AX.label_of(close_node)})
    except ProbeError as exc:
        res["closeDetailError"] = str(exc)[:300]

    if a.keep_task:
        res["taskDeleted"] = {"skipped": "--keep-task"}
    else:
        delete_own_task(probe, title, res, clamp)

    res["finishedAt"] = time.time()
    dump(res, out)
    print(json.dumps({"status": "passed", "appearance": appearance, "uiLocale": res["uiLocale"],
                      "tabBarTopOnListScreen": bar_top, "reminderSection": res["reminderSection"],
                      "emptyState": res["emptyState"], "afterAdd": res["afterAdd"],
                      "afterSnooze": res.get("afterSnooze"), "afterDismiss": res.get("afterDismiss"),
                      "snoozeMove": res.get("snoozeMove"),
                      "removedBackToEmpty": removed, "taskDeleted": res.get("taskDeleted"),
                      "report": str(out / "reminder-block.json")}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
