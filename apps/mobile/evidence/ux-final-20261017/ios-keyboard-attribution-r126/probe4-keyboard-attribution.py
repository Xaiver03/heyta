#!/usr/bin/env python3
"""r126 探针：把旅程第 13 枚键盘步剩下的两种解释分开（一次只改一处）。

现量已经排掉四档（见 bilingual-locators-ios-r124/RESULT.md §5）：载体会弹键盘、中文臂同形红、
双语改动无关、"详情标题字段单次点得到"。剩下没分开的只有两处：

  A. 这一步之前还做过 **展开排期 → 收起排期**（`recover_detail_title` 的 docstring 就写着这一动会把详情面往下滚）；
  B. 详情是从**时间线行**开的（最短路径那枚探针是从清单行开的）。

所以本探针跑 2×2 的三格（`无 toggle + 清单行` 那一格已由上一轮证绿，不重复占设备时间）：

  | 臂 | 来源 | toggle | 期望 |
  |---|---|---|---|
  | 1 | 清单行 | 无 | 绿（复现上一枚探针） |
  | 2 | 清单行 | 有 | ? ← 只改 A |
  | 3 | 时间线行 | 无 | ? ← 只改 B |
  | 4 | 时间线行 | 有 | ? ← 旅程原形 |

读法：**哪一格先红，原因就是那一格带进来的那一处**；只有臂 4 红才是"两处合取"，
那也是一种可点名的结论。每臂各用一枚自己新建的任务，避免排期折叠态跨臂串味。
每臂都 dump：两枚「标题」的 frame、字段中心、`scroll_into_view` 的原话、点完之后 `keyboard_top`
与详情是否仍在场，并留一张图 —— 归因要能只读 JSON 复核，不靠当场肉眼。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
# .../apps/mobile/evidence/ux-final-20261017/<这一趟> ⇒ 仓库根在 parents[4]
ROOT = HERE.parents[4]
JOURNEY = ROOT / "scripts" / "qa" / "tasks-ux-ios.py"

spec = importlib.util.spec_from_file_location("heyta_tasks_ux_ios", JOURNEY)
JU = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(JU)

AX = JU.AX
ProbeError = JU.ProbeError
OUT = HERE


def dump_field(nodes, label: str):
    """Both 「标题」 nodes plus the field's own geometry — the ambiguity is part of the reading."""
    width, height = AX.screen_size(nodes)
    rows = []
    for occurrence in range(3):
        node = AX.find(nodes, label, False, False, None, False, occurrence)
        if node is None:
            break
        x, y, w, h = AX.frame_of(node)
        rows.append({
            "occurrence": occurrence,
            "isField": AX.is_field(node),
            "pressable": bool(node.get("traits") and "Button" in str(node.get("traits"))),
            "frame": [x, y, w, h],
            "center": AX.center(node),
            "insideViewport": bool(x >= 0 and y >= 0 and x + w <= (width or 0) and y + h <= (height or 0)),
        })
    return {"screen": [width, height], "titleNodes": rows}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--udid", required=True)
    parser.add_argument("--idb", default=str(Path.home() / ".heyta-tools/idb/venv/bin/idb"))
    parser.add_argument("--companion", default=str(Path.home() / ".heyta-tools/idb/idb_companion"))
    parser.add_argument("--timeout", type=float, default=12.0)
    parser.add_argument("--arms", default="1,2,3,4")
    # 复跑某几臂时不必再造任务（4 枚任务名按臂序号位定，缺位会串臂）⇒ 整串传进来并跳过创建。
    parser.add_argument("--titles", default="", help="comma-separated 4 titles; skips task creation when given")
    args = parser.parse_args()

    probe = JU.Probe(argparse.Namespace(
        idb=args.idb, companion=args.companion, udid=args.udid,
        timeout=args.timeout, evidence_dir=str(OUT),
    ))
    T = JU.T
    # 复跑单臂时不许把上一批读数顶掉 ⇒ 落点名带臂号
    result_path = OUT / f"probe4-{'-'.join(args.arms.split(','))}.json"
    result: dict = {"startedAt": time.time(), "udid": args.udid, "arms": []}
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    def save() -> None:
        result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    stamp = str(int(time.time()))
    titles = [f"KbProbe{i}{stamp}" for i in range(1, 5)]

    probe.ensure_on_tasks()
    result["uiLocale"] = probe.ui_locale
    save()
    if args.titles:
        titles = args.titles.split(",")
        result["reused"] = titles
    else:
        for title in titles:
            probe.create_task(title)
        result["created"] = titles
    save()

    detail_label = T("任务详情", "Task details")
    close_label = T("关闭任务详情", "Close task details")
    expand_label = T("展开排期", "Show scheduling")
    collapse_label = T("收起排期", "Hide scheduling")
    title_field_label = T("标题", "Title")
    quadrant = T("四象限", "Quadrants")
    timeline = T("时间线", "Timeline")

    def current_view() -> str:
        """🔴 视图名**不许写死**：`视图选项：{view}` 是状态化的标签，r126 臂 3/4 就是被我硬写成的
        「四象限」卡在换视图那一步（这台载体当时的当前视图是「列表」）。
        🔴 也**不许只读一次快照**：臂 4 在上一臂刚关完详情 0.8s 后起跑，那一枚标签还没落进树 ⇒
        单次读直接判"未知"。这是同一枚坑（空树/过渡态）在本探针里的第二次命中，改成有界轮询。"""
        prefix = T("视图选项：", "View options:")

        def read(nodes):
            for node in nodes:
                label = AX.label_of(node) or ""
                if label.startswith(prefix):
                    return label.split(prefix, 1)[1].strip()
            return None

        return probe.wait(read, f"{prefix}… label (current view)")

    def timeline_group_marker() -> str:
        """🔴 「已经在时间线视图」这件事**不许拿"行标题在树里"当判据** —— 列表视图里同一枚标题也在树里。
        r126 第一批臂 3/4 就是这么假绿过去的：`wait_labels((title,))` 在列表视图同样成立，
        于是那两臂其实测的是"列表行 ± toggle"，B 那一档**根本没被作用**。

        第二枚坑：旅程自己那枚 `timeline_group_label(n)`（「时间线：共 N 条任务」）是 **web 的 aria 键**
        `web.timeline.aria.group`，iOS 这一侧的分组表头走的是 `web.board.unscheduledLane`（「未排期（N）」）
        ⇒ 拿它当 iOS 上的时间线证据也永远不会成立（现量：这一趟 `visible` 里有「未排期（4）」、无「时间线：共」）。
        ⇒ 用移动端那一枚独有表头。"""
        prefixes = (T("未排期（", "Unscheduled ("), T("时间线：共 ", "Timeline: "))

        def read(nodes):
            for node in nodes:
                label = AX.label_of(node) or ""
                for prefix in prefixes:
                    if label.startswith(prefix):
                        return label
            return None

        return probe.wait(read, f"timeline lane header {prefixes!r} (proves the timeline view is on screen)")

    for arm_id in [int(a) for a in args.arms.split(",")]:
        from_timeline = arm_id in (3, 4)
        with_toggle = arm_id in (2, 4)
        title = titles[arm_id - 1]
        reading: dict = {"arm": arm_id, "source": "timeline-row" if from_timeline else "list-row",
                         "scheduleToggle": with_toggle, "task": title}
        started = time.monotonic()
        try:
            reading["viewBeforeArm"] = current_view()
            if from_timeline:
                # 已经在目标视图时不再走一遍选择器：当前视图那枚 chip 可能压根不在（或点了不关面板）
                if reading["viewBeforeArm"] != timeline:
                    probe.choose_view(reading["viewBeforeArm"], timeline)
                reading["viewAfterSwitch"] = current_view()
                reading["timelineMarker"] = timeline_group_marker()
                probe.wait_labels((title,), "timeline row present")
                probe.tap_node(probe.node((title,), pressable=False), "open timeline task row")
            else:
                if reading["viewBeforeArm"] != quadrant:
                    probe.choose_view(reading["viewBeforeArm"], quadrant)
                reading["viewAfterSwitch"] = current_view()
                reading["listRowLabelPresent"] = True
                probe.wait_labels((JU.open_task_label(title),), "list row present")
                probe.tap((JU.open_task_label(title),), "open list task row")
            probe.wait_labels((detail_label,), "detail sheet")
            reading["detailOpened"] = True

            nodes = probe.tree()
            reading["geometryAtOpen"] = dump_field(nodes, title_field_label)
            reading["expandVisibleAtOpen"] = AX.find(nodes, expand_label, True, False, None, False, 0) is not None

            if with_toggle:
                probe.wait_labels((expand_label,), "schedule collapsed by default")
                probe.tap((expand_label,), "expand schedule")
                probe.wait_labels((collapse_label,), "schedule expanded")
                probe.tap((collapse_label,), "collapse schedule")
                probe.wait_labels((expand_label,), "schedule collapsed again")
                reading["toggled"] = True
                nodes = probe.tree()
                reading["geometryAfterToggle"] = dump_field(nodes, title_field_label)

            field = probe.recover_detail_title(title_field_label)
            reading["recoverReturnedFrame"] = list(AX.frame_of(field))
            reading["recoverReturnedCenter"] = list(AX.center(field))
            reading["scrollIntoView"] = AX.scroll_into_view(
                probe.idb, probe.companion, probe.udid, title_field_label, False, True, None)
            probe.tap_node(field, "focus task title field")

            deadline = time.monotonic() + probe.timeout
            keyboard = None
            while time.monotonic() < deadline:
                keyboard = AX.keyboard_top(probe.tree())
                if keyboard is not None:
                    break
                time.sleep(0.35)
            after = probe.tree()
            reading["keyboardTop"] = keyboard
            reading["detailStillOpen"] = AX.find(after, detail_label, False, False, None, False, 0) is not None
            reading["geometryAfterTap"] = dump_field(after, title_field_label)
            reading["focusedLabel"] = next(
                (n.get("label") for n in after if n.get("focused") or n.get("isFocused")), None)
            probe.screenshot(f"arm{arm_id}-after-tap")
            reading["outcome"] = "keyboard" if keyboard is not None else "NO-KEYBOARD"
        except (ProbeError, Exception) as error:  # noqa: BLE001 - one arm must not kill the sweep
            reading["outcome"] = "error"
            reading["error"] = f"{type(error).__name__}: {error}"
            reading["traceback"] = traceback.format_exc(limit=3)
            try:
                probe.screenshot(f"arm{arm_id}-error")
            except Exception:  # noqa: BLE001
                pass
        reading["seconds"] = round(time.monotonic() - started, 1)
        result["arms"].append(reading)
        save()
        # leave the detail sheet closed for the next arm
        try:
            live = probe.tree()
            if AX.find(live, close_label, True, False, None, False, 0) is not None:
                if AX.keyboard_top(live) is not None:
                    AX.dismiss_keyboard(probe.idb, probe.companion, probe.udid)
                probe.tap((close_label,), "close task detail")
                probe.wait_absent((detail_label,), "detail closed between arms")
        except Exception as error:  # noqa: BLE001
            result.setdefault("cleanupErrors", []).append(f"arm {arm_id}: {error}")
            save()
            try:
                probe.ensure_on_tasks()
            except Exception:  # noqa: BLE001
                pass

    result["finishedAt"] = time.time()
    save()
    print(json.dumps({a["arm"]: (a.get("outcome"), a.get("keyboardTop"), a.get("error"))
                      for a in result["arms"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
