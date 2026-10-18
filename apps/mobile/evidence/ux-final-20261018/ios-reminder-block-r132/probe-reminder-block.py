#!/usr/bin/env python3
"""r132 探针：iOS **任务详情里的提醒块**（共享 `ReminderList`）在装机态的深浅两档配对。

为什么是这一格：目标里点名"提醒状态"，而 iOS 这一侧**从来没有一条提醒的设备腿**
（`grep -l 提醒 scripts/qa/*.py` 零命中，现量见 RESULT.md 第一节）。web 那两档早有读数，
装机态这一档缺。本探针不判行为对错，只做三件事：

  1. 空态 → 加一条 → 删掉，各留一张图（**加完必删**：留下的提醒会在 +1h 真的发一条本地通知）；
  2. 把徽标与三枚动作按钮的 frame 逐枚记下来 —— 与批量条那一格同一形状的行为判据，
     两档对比时看的是数，不是"看图觉得一样"；
  3. 落点由 --out 给（light/ 与 dark/ 各一），**不在同一目录里覆盖**（环境陷阱 #472）。

两处装置事实（都是本趟现量出来的，写下来免得下一位重踩）：
  * 「添加」那一枚**有两个形状**，取决于任务有没有截止时间（ReminderList 的 hasDueDate）：
    有截止 → reminder.add「添加提醒」；没截止 → 只剩 reminder.absolute.1h「1 小时后提醒」+ 一行解释。
  * 详情面板是一整条长滚动内容，提醒块在**未滚动时落在 y≈1846**（屏高 874）——
    probe.tap 那条可见守卫会自己滑 10 下仍判不可点（它滑不动这一层），所以这里**自己滚、自己按中心点**，
    与 #469 底部 tab 那一族同一处置：不是放宽判据，是那条守卫的射程不含这一层滚动容器。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
JOURNEY = ROOT / "scripts" / "qa" / "tasks-ux-ios.py"

spec = importlib.util.spec_from_file_location("heyta_tasks_ux_ios", JOURNEY)
JU = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(JU)
AX = JU.AX
T = JU.T

REMINDER_TITLE = T("提醒", "Reminders")
EMPTY = T("还没有提醒", "No reminders yet")
ADD_CANDS = (T("添加提醒", "Add reminder"), T("1 小时后提醒", "Remind me in 1 hour"))
SCHEDULED = T("待触发", "Scheduled")
REMOVE = T("删除提醒", "Delete reminder")
SNOOZE = T("稍后提醒", "Snooze")
DISMISS = T("关闭提醒", "Dismiss")
NO_DUE = T("这个任务没有截止时间，只能按绝对时刻提醒",
           "This task has no due date, so it can only remind at an absolute time")


def raw_tap(probe, x: int, y: int) -> None:
    r = subprocess.run(
        [probe.idb, *AX.companion_args(probe.companion), "ui", "tap", str(x), str(y), "--udid", probe.udid],
        capture_output=True, text=True, timeout=60,
    )
    if r.returncode != 0:
        raise JU.ProbeError(f"tap at {x},{y} failed: {(r.stderr or r.stdout).strip()[:200]}")


def swipe_up(probe) -> None:
    AX.idb_swipe(probe.idb, probe.companion, probe.udid, 200, 620, 200, 280, 0.3)
    time.sleep(1.0)


def find(probe, wanted: tuple[str, ...]):
    nodes = probe.tree()
    for label in wanted:
        node, _how = pick(nodes, label)
        if node is not None:
            return node, AX.screen_size(nodes)
    return None, AX.screen_size(nodes)


def scroll_into_view(probe, wanted: tuple[str, ...], max_swipes: int = 10):
    """滚到那一枚的**中心点落进视口**为止 —— 只看"在不在树里"不够，长面板里它在屏外。"""
    for _ in range(max_swipes + 1):
        node, (w, h) = find(probe, wanted)
        if node is not None:
            cx, cy = AX.center(node)
            if 0 < cx < (w or 0) and 0 < cy < (h or 0) - 40:
                return node, [w, h], True
        swipe_up(probe)
    node, (w, h) = find(probe, wanted)
    if node is None:
        return None, [w, h], False
    cx, cy = AX.center(node)
    return node, [w, h], bool(0 < cx < (w or 0) and 0 < cy < (h or 0) - 40)


def has_any(label: str, *alts: str) -> bool:
    return any(a in label for a in alts)


# 🔴 三枚动作按钮**不是**按屏上那三个字定位的 —— 本趟现量到它们的 AX 标签是整句、带时刻：
#   「把 10-18 21:23 的提醒推迟 10 分钟」/「关闭 10-18 21:23 的提醒」/「删除 10-18 21:23 的提醒」
#   （`reminder.a11y.snooze|dismiss|remove`，en 侧同形）。
# 先按精确串扫 ⇒ 三枚全报 present=false，看着完全像"这三枚没有无障碍标签"（那会被登记成一条 a11y 缺陷）；
# 退到子串「删除提醒」也还是假 absent —— **词序不是"删除提醒…"，是"删除 {时刻} 的提醒"**。
# 所以这里按"动词 + 提到提醒"两把 together 匹配，并把真正命中的整句记进读数（matchedLabel）。
MATCHERS = {
    SCHEDULED: lambda l: l == SCHEDULED,
    SNOOZE: lambda l: has_any(l, "推迟", "Snooze") and has_any(l, "提醒", "reminder"),
    DISMISS: lambda l: has_any(l, "关闭", "Dismiss") and has_any(l, "提醒", "reminder"),
    REMOVE: lambda l: has_any(l, "删除", "Delete the reminder") and has_any(l, "提醒", "reminder"),
}


def pick(nodes, label: str):
    matcher = MATCHERS.get(label, lambda l: l == label)
    for n in nodes:
        l = AX.label_of(n) or ""
        if l == label:
            return n, "exact"
    for n in nodes:
        if matcher(AX.label_of(n) or ""):
            return n, "matcher"
    return None, "absent"


def rows_for(probe, wanted: list[str]) -> list[dict]:
    """把 wanted 里每枚标签的 frame / 是否在视口内逐枚抄下来（两档对比用的数）。"""
    nodes = probe.tree()
    width, height = AX.screen_size(nodes)
    out = []
    for label in wanted:
        node, how = pick(nodes, label)
        if node is None:
            out.append({"label": label, "present": False})
            continue
        x, y, w, h = AX.frame_of(node)
        out.append({
            "label": label,
            "matchedLabel": AX.label_of(node),
            "match": how,
            "present": True,
            "frame": [x, y, w, h],
            "right": x + w,
            "bottom": y + h,
            "insideViewport": bool(x >= 0 and y >= 0 and x + w <= (width or 0) and y + h <= (height or 0)),
        })
    return out


def tap_label(probe, wanted: tuple[str, ...], description: str) -> dict:
    node, screen, ok = scroll_into_view(probe, wanted)
    if node is None:
        raise JU.ProbeError(f"{description}: label {wanted!r} not in tree at all")
    cx, cy = AX.center(node)
    rec = {"description": description, "label": AX.label_of(node), "frame": list(AX.frame_of(node)),
           "tappedAt": [cx, cy], "screen": screen, "scrolledIntoView": ok}
    if not ok:
        raise JU.ProbeError(f"{description} still off-screen after scrolling: {rec}")
    raw_tap(probe, cx, cy)
    return rec


NOTIFY_DENY = (T("不允许", "Don\'t Allow"), "不允许", "Don\'t Allow")
NOTIFY_TITLE = "\"heyta\"想给你发送通知"


def reset_notify_privacy(udid: str) -> str:
    """把通知授权退回"未决定"—— iOS 的授权弹窗是一次性的，不复位第二档就照不到它。

    ⚠️ 这条会终止正在跑的 app（`simctl privacy` 自己写的），所以只在 ensure_on_tasks 之前调用。
    收尾也要再复位一次 ⇒ 把这台验收机还回"没被问过"的那一面（接手时就是这个态）。
    """
    r = subprocess.run(["xcrun", "simctl", "privacy", udid, "reset", "notifications", "com.heyta"],
                       capture_output=True, text=True, timeout=60)
    return f"rc={r.returncode} {(r.stderr or r.stdout).strip()[:120]}"


def handle_notify_prompt(probe, out: Path, res: dict) -> None:
    """加完第一条提醒时，装机态会**真的弹系统授权框**（本趟第一次照到）。
    只点「不允许」—— 授权是设备级状态，替这台共享机点「允许」会改掉别人的态。"""
    time.sleep(2.0)
    nodes = probe.tree()
    labels = [AX.label_of(n) or "" for n in nodes]
    deny = next((n for n in nodes if (AX.label_of(n) or "") in NOTIFY_DENY), None)
    if deny is None:
        res["notifyPrompt"] = {"present": False, "labels": [l for l in labels if l][:12]}
        return
    title = next((n for n in nodes if (AX.label_of(n) or "") == NOTIFY_TITLE), None)
    res["notifyPrompt"] = {
        "present": True,
        "title": NOTIFY_TITLE if title is not None else None,
        "titleFrame": list(AX.frame_of(title)) if title is not None else None,
        "denyFrame": list(AX.frame_of(deny)),
        "body": next((l for l in labels if "通知权限" in l), None),
    }
    probe.screenshot("01b-notify-prompt")
    res["shots"].append("01b-notify-prompt")
    dump(res, out)
    cx, cy = AX.center(deny)
    raw_tap(probe, cx, cy)
    time.sleep(1.5)


def dump(res: dict, out: Path) -> None:
    """每步都增量落一次盘 —— 中途抛错时，已经取到的读数不许丢（#467 那一族同形）。"""
    (out / "reminder-block.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--udid", required=True)
    ap.add_argument("--out", required=True, help="这一档的落点目录（light/ 或 dark/）")
    ap.add_argument("--idb", default=str(Path.home() / ".heyta-tools/idb/venv/bin/idb"))
    ap.add_argument("--companion", default=str(Path.home() / ".heyta-tools/idb/idb_companion"))
    ap.add_argument("--timeout", type=float, default=12.0)
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    a_udid = a.udid
    probe = JU.Probe(argparse.Namespace(
        idb=a.idb, companion=a.companion, udid=a.udid, timeout=a.timeout, evidence_dir=str(out)))

    title = f"Rem132{int(time.time())}"
    res: dict = {"startedAt": time.time(), "taskTitle": title, "uiLocale": None,
                 "appearance": subprocess.run(["xcrun", "simctl", "ui", a.udid, "appearance"],
                                              capture_output=True, text=True).stdout.strip(),
                 "taps": [], "shots": []}

    res["privacyResetBefore"] = reset_notify_privacy(a_udid)
    probe.ensure_on_tasks()
    probe.create_task(title)
    probe.tap((JU.open_task_label(title),), "open task detail")
    res["uiLocale"] = probe.ui_locale

    node, screen, ok = scroll_into_view(probe, (REMINDER_TITLE,))
    res["reminderSectionFound"] = node is not None
    res["reminderSectionScrolledIntoView"] = ok
    res["emptyState"] = rows_for(probe, [REMINDER_TITLE, EMPTY, *ADD_CANDS, NO_DUE])
    probe.screenshot("01-reminder-empty")
    res["shots"].append("01-reminder-empty")
    dump(res, out)

    res["taps"].append(tap_label(probe, ADD_CANDS, "add reminder"))
    handle_notify_prompt(probe, out, res)
    time.sleep(1.5)
    res["afterAdd"] = rows_for(probe, [SCHEDULED, SNOOZE, DISMISS, REMOVE])
    probe.screenshot("02-reminder-added")
    res["shots"].append("02-reminder-added")
    dump(res, out)

    # 加完必删 —— 不删的话这条 +1h 的提醒会在真机上发一条本地通知。
    deleted = False
    if any(r.get("present") for r in rows_for(probe, [REMOVE])):
        res["taps"].append(tap_label(probe, (REMOVE,), "remove reminder"))
        time.sleep(1.5)
        deleted = any(r.get("present") for r in rows_for(probe, [EMPTY]))
    res["removedBackToEmpty"] = deleted
    probe.screenshot("03-reminder-removed")
    res["shots"].append("03-reminder-removed")

    # 收尾那一枚关闭按钮**不许把整趟带走**：三张图与逐枚 frame 在本步之前已经落盘了，
    # 关不上面板只是这台验收机多开着一层，登记成一条读数就够（现量：这一趟它回 "not in tree at all"）。
    try:
        res["taps"].append(tap_label(probe, (T("关闭任务详情", "Close task detail"), T("关闭", "Close")), "close detail"))
    except JU.ProbeError as exc:
        res["closeDetailError"] = str(exc)[:300]
    res["privacyResetAfter"] = reset_notify_privacy(a_udid)
    res["finishedAt"] = time.time()
    (out / "reminder-block.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "appearance": res["appearance"],
        "uiLocale": res["uiLocale"],
        "sectionFound": res["reminderSectionFound"],
        "emptyState": res["emptyState"],
        "afterAdd": res["afterAdd"],
        "removedBackToEmpty": deleted,
        "taps": res["taps"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
