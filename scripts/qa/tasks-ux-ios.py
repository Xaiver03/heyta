#!/usr/bin/env python3
"""Real iOS task UX acceptance through the shared idb AX shim.

The journey is intentionally accessibility-tree driven. It creates disposable
tasks, verifies long-press selection, quadrant move/undo, timeline row entry,
and keyboard geometry, then chains the existing Profile/Settings journey.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
SHIM_PATH = ROOT / "scripts" / "tools" / "ios-ax-shim.py"
DEFAULT_UDID = "FE195661-B021-4A71-AAD1-1F2F7AE3A102"
DEFAULT_EVIDENCE = ROOT / "apps" / "mobile" / "evidence" / "settings-finish-release" / "ios"


def load_shim():
    spec = importlib.util.spec_from_file_location("heyta_ios_ax_shim", SHIM_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load AX shim: {SHIM_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


AX = load_shim()


class ProbeError(RuntimeError):
    pass


def labels(nodes: Iterable[dict[str, Any]]) -> list[str]:
    return [value for node in nodes if (value := AX.label_of(node))]


class Probe:
    def __init__(self, args: argparse.Namespace) -> None:
        self.idb = args.idb
        self.companion = args.companion
        self.udid = args.udid
        self.timeout = args.timeout
        self.out = Path(args.evidence_dir)
        self.out.mkdir(parents=True, exist_ok=True)
        self.steps: list[dict[str, Any]] = []

    def tree(self) -> list[dict[str, Any]]:
        return AX.dump_nodes(self.idb, self.companion, self.udid, attempts=3)

    def wait(self, predicate, description: str):
        deadline = time.monotonic() + self.timeout
        last: list[dict[str, Any]] = []
        while time.monotonic() < deadline:
            last = self.tree()
            result = predicate(last)
            if result:
                return result
            time.sleep(0.35)
        raise ProbeError(f"timed out waiting for {description}; visible={labels(last)[:100]!r}")

    def node(self, candidates: Iterable[str], *, pressable: bool = False, field: bool = False):
        wanted = tuple(candidates)

        def find_one(nodes):
            for item in wanted:
                found = AX.find(nodes, item, pressable, field, None, False, 0)
                if found is not None:
                    return found
            return None

        return self.wait(find_one, f"labels {wanted!r}")

    def tap_node(self, node: dict[str, Any], description: str, *, allow_view_sheet: bool = False) -> None:
        label = AX.label_of(node)
        want_field = AX.is_field(node)
        if label:
            visible = AX.scroll_into_view(self.idb, self.companion, self.udid, label, False, want_field, None)
            if visible.get("visible") != "True":
                # The shared shim reserves the bottom 120px for the tab bar.
                # A view-options sheet overlays that area, so its chips can be
                # genuinely tappable even though the generic viewport probe
                # reports them below the fold. Re-read the live AX tree and
                # accept only an enabled node fully inside the app frame while
                # the sheet's close control is present.
                if not allow_view_sheet:
                    raise ProbeError(f"{description} is not in the tappable viewport: {visible}")
                nodes = self.tree()
                close = AX.find(nodes, "关闭视图选项", True, False, None, False, 0)
                refreshed = AX.find(nodes, label, True, want_field, None, False, 0)
                width, height = AX.screen_size(nodes)
                if close is None or refreshed is None or width is None or height is None:
                    raise ProbeError(f"{description} is not in the tappable viewport: {visible}")
                x, y, w, h = AX.frame_of(refreshed)
                cx, cy = AX.center(refreshed)
                if (not AX.is_enabled(refreshed) or x < 0 or y < 0 or x + w > width or
                        y + h > height or not (0 <= cx < width and 0 <= cy < height)):
                    raise ProbeError(f"{description} is not in the tappable viewport: {visible}")
                node = refreshed
            else:
                node = self.node((label,), field=want_field)
        x, y = AX.center(node)
        result = subprocess.run(
            [self.idb, *AX.companion_args(self.companion), "ui", "tap", str(x), str(y), "--udid", self.udid],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            raise ProbeError(f"tap {description!r} failed: {(result.stderr or result.stdout).strip()[:300]}")

    def tap(self, candidates: Iterable[str], description: str) -> None:
        self.tap_node(self.node(candidates, pressable=True), description)

    def tap_view_sheet(self, candidates: Iterable[str], description: str) -> None:
        self.tap_node(self.node(candidates, pressable=True), description, allow_view_sheet=True)

    def open_view_options(self, view: str) -> None:
        """Open the task view menu through its stateful accessibility label."""
        self.tap((f"视图选项：{view}",), f"open view options for {view}")
        self.wait_labels(("视图选项",), "view options sheet")

    def choose_view(self, current_view: str, target_view: str) -> None:
        """Choose a view from the menu; selecting a chip closes the sheet."""
        self.open_view_options(current_view)
        self.tap_view_sheet((target_view,), f"choose {target_view} view")
        self.wait_absent(("视图选项",), "view options sheet closed")

    def wait_labels(self, candidates: Iterable[str], description: str) -> list[dict[str, Any]]:
        wanted = tuple(candidates)

        def found(nodes):
            return nodes if any(AX.find(nodes, item, False, False, None, False, 0) is not None for item in wanted) else None

        return self.wait(found, description)

    def wait_absent(self, candidates: Iterable[str], description: str) -> None:
        wanted = tuple(candidates)
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            nodes = self.tree()
            if all(AX.find(nodes, item, False, False, None, False, 0) is None for item in wanted):
                return
            time.sleep(0.35)
        raise ProbeError(f"labels stayed visible for {description}: {wanted!r}")

    def screenshot(self, name: str) -> None:
        path = self.out / f"{name}.png"
        result = subprocess.run(
            [self.idb, *AX.companion_args(self.companion), "screenshot", "--udid", self.udid, str(path)],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0 or not path.exists() or path.stat().st_size == 0:
            fallback = subprocess.run(["xcrun", "simctl", "io", self.udid, "screenshot", str(path)], capture_output=True, text=True, timeout=60)
            if fallback.returncode != 0 or not path.exists() or path.stat().st_size == 0:
                raise ProbeError(f"could not capture {name}: {(result.stderr or fallback.stderr)[:300]}")

    def record(self, name: str, **details: Any) -> None:
        self.steps.append({"name": name, "status": "passed", "at": time.time(), **details})
        self.screenshot(name)

    def type_text(self, field_label: str, value: str) -> None:
        # Ordinary RN fields use the repository's AX set-value path. HID text
        # can enter IME composition spaces; secure fields have a separate helper.
        last = None
        for _ in range(4):
            result = subprocess.run(
                ["python3", str(SHIM_PATH), field_label, "--udid", self.udid,
                 "--idb", self.idb, "--companion", self.companion,
                 "--field", "--set", value, "--json"],
                capture_output=True, text=True, timeout=90,
            )
            try:
                last = json.loads(result.stdout)
            except json.JSONDecodeError:
                last = {"detail": result.stderr[-300:]}
            if last.get("detail") == value:
                return
        raise ProbeError(f"real text entry failed for {field_label!r}: {last}")

    def recover_detail_title(self, field_label: str) -> dict[str, Any]:
        """Bring the detail title back after the schedule section was toggled.

        Expanding and collapsing the schedule intentionally scrolls the detail
        sheet down. The shared shim's edge-safe dead-zone chooser can select
        x=2 on this sheet, outside its scroll container, so its downward
        recovery swipe is accepted by idb but has no effect. Use the interior
        of the sheet for this one reverse scroll and re-read AX after each
        gesture.
        """
        for _ in range(4):
            nodes = self.tree()
            field = AX.find(nodes, field_label, False, True, None, False, 0)
            width, height = AX.screen_size(nodes)
            if field is None or width is None or height is None:
                time.sleep(0.5)
                continue
            _x, y, _w, field_height = AX.frame_of(field)
            if y >= 0 and y + field_height <= height:
                return field
            if y >= 0:
                return field
            start_y = max(200, min(300, height - 300))
            end_y = min(height - 120, start_y + 400)
            rc, detail = AX.idb_swipe(
                self.idb, self.companion, self.udid,
                width // 2, start_y, width // 2, end_y, 1.0,
            )
            if rc != 0:
                raise ProbeError(f"detail title recovery swipe failed: {detail}")
            time.sleep(1.0)
        raise ProbeError(f"{field_label} did not return to the detail viewport after schedule toggle")

    def create_task(self, title: str) -> None:
        self.tap(("新建任务",), "open composer")
        self.node(("新任务标题",), pressable=False)
        self.type_text("新任务标题", title)
        add = self.node(("添加",), pressable=True)
        keyboard_top = AX.keyboard_top(self.tree())
        if keyboard_top is not None and AX.center(add)[1] >= keyboard_top:
            # KeyboardAvoidingView should keep the CTA above the IME. If a
            # runtime reports stale geometry, close the IME and re-read the
            # button before tapping; never tap a covered coordinate.
            AX.dismiss_keyboard(self.idb, self.companion, self.udid)
            if AX.find(self.tree(), title, False, False, None, False, 0) is not None:
                return
            add = self.node(("添加",), pressable=True)
        self.tap_node(add, "submit task")
        self.wait_labels((title,), f"created task {title}")

    def ensure_on_tasks(self) -> None:
        subprocess.run(["xcrun", "simctl", "terminate", self.udid, "com.heyta"], capture_output=True, text=True, timeout=30)
        launch = subprocess.run(["xcrun", "simctl", "launch", self.udid, "com.heyta"], capture_output=True, text=True, timeout=45)
        if launch.returncode != 0:
            raise ProbeError(f"could not launch com.heyta: {(launch.stderr or launch.stdout).strip()[:300]}")
        # Welcome copy also contains “任务”; wait for an actual workspace control.
        # Privacy and welcome screens arrive in separate native render passes.
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            state = self.tree()
            if AX.find(state, "新建任务", True, False, None, True, 0) is not None:
                return
            for label in ("只用本机", "先离线使用"):
                node = AX.find(state, label, True, False, None, True, 0)
                if node is not None:
                    self.tap_node(node, "complete onboarding")
                    break
            time.sleep(0.35)
        raise ProbeError("workspace did not open after onboarding")

    def run(self, skip_profile: bool) -> None:
        self.ensure_on_tasks()
        stamp = str(int(time.time()))
        task_a = f"UxTaskA{stamp}"
        task_b = f"UxTaskB{stamp}"
        self.create_task(task_a)
        self.record("01-created-task-a", title=task_a)
        self.create_task(task_b)
        self.record("02-created-task-b", title=task_b)

        task_open_a = f"打开任务：{task_a}"
        task_open_b = f"打开任务：{task_b}"
        width, height = AX.screen_size(self.tree())
        if width is None or height is None:
            raise ProbeError("missing native screen geometry")
        rc, detail = AX.idb_swipe(self.idb, self.companion, self.udid, int(width / 2), int(height * 0.7), int(width / 2), int(height * 0.4), 0.35)
        if rc != 0:
            raise ProbeError(f"list scroll transport failed: {detail}")
        scrolled = AX.scroll_into_view(self.idb, self.companion, self.udid, task_open_a, True, False, None)
        if scrolled.get("visible") != "True":
            raise ProbeError(f"task row did not scroll into a tappable viewport: {scrolled}")
        self.wait_labels((task_open_a,), "task row after list scroll")
        self.record("03-list-scroll")

        first = self.node((task_open_a,), pressable=True)
        x, y = AX.center(first)
        rc, detail = AX.idb_swipe(self.idb, self.companion, self.udid, x, y, x, y, 1.2)
        if rc != 0:
            raise ProbeError(f"long press transport failed: {detail}")
        self.wait_labels(("退出选择",), "long-press selection mode")
        self.record("04-long-press-enters-selection")

        select_b = f"选择：{task_b}"
        self.tap((select_b, task_open_b), "select second task")
        self.wait_labels(("已选 2 项",), "two selected tasks")
        self.record("05-multi-select-second-task")
        self.tap(("退出选择",), "exit selection")
        self.wait_absent(("退出选择",), "selection mode exit")
        self.record("06-exit-selection")

        self.tap(("选择任务",), "start explicit selection")
        self.tap((f"选择：{task_a}", task_open_a), "select task before changing view")
        self.choose_view("列表", "时间线")
        self.wait_absent(("退出选择", "已选 1 项"), "timeline clears hidden bulk selection")
        self.record("06b-timeline-clears-selection")
        self.choose_view("时间线", "列表")

        # The current view is the single entry point for date and sort
        # preferences. Keep this assertion explicit so the old always-on row
        # of controls cannot quietly return to the first screen.
        self.open_view_options("列表")
        self.wait_labels(("日期显示",), "date display options")
        self.wait_labels(("选择排序方式",), "sort options heading")
        for sort_label in ("默认（按截止时间）", "按添加时间", "按优先级"):
            self.wait_labels((sort_label,), f"sort option {sort_label}")
        self.tap_view_sheet(("按优先级",), "choose priority sort")
        self.wait_absent(("视图选项",), "view options after sort selection")
        self.open_view_options("列表")
        self.tap_view_sheet(("倒计时",), "choose countdown date display")
        self.wait_labels(("视图选项",), "view options remains open after date selection")
        self.tap(("关闭视图选项",), "close view options")
        self.wait_absent(("视图选项",), "view options closed")
        self.record("07-view-options-sort-and-date")

        self.choose_view("列表", "四象限")
        self.wait_labels((task_open_a, task_open_b), "quadrant task rows")
        AX.scroll_into_view(self.idb, self.companion, self.udid, f"移动「{task_a}」到其他象限", True, False, None)
        more = self.node((f"移动「{task_a}」到其他象限", f"移动「{task_b}」到其他象限"), pressable=True)
        self.tap_node(more, "open quadrant move sheet")
        self.wait_labels((f"移动「{task_a}」到其他象限", f"移动「{task_b}」到其他象限"), "quadrant move sheet")
        destinations = ("马上做", "计划做", "交给别人", "先不做")
        destination_node = self.wait(
            lambda nodes: next((n for label in destinations for n in [AX.find(nodes, label, True, False, None, False, 0)] if n is not None and AX.is_enabled(n)), None),
            "enabled quadrant destination",
        )
        destination = AX.label_of(destination_node)
        self.tap_node(destination_node, "choose quadrant destination")
        self.wait_labels(("撤销移动",), "quadrant move feedback")
        self.record("08-quadrant-move-feedback", destination=destination)
        self.tap(("撤销移动",), "undo quadrant move")
        self.wait_absent(("撤销移动",), "quadrant undo")
        self.record("09-quadrant-undo")

        self.choose_view("四象限", "时间线")
        self.wait_labels((task_a, task_b, "时间线：共 2 条任务"), "timeline view")
        self.open_view_options("时间线")
        self.wait_absent(("日期显示",), "timeline hides date display options")
        self.wait_absent(("选择排序方式",), "timeline hides sort options")
        self.tap(("关闭视图选项",), "close timeline view options")
        self.wait_absent(("视图选项",), "timeline view options closed")
        self.record("10-timeline-view-options")
        timeline_task = self.node((task_a, task_b), pressable=False)
        self.tap_node(timeline_task, "open timeline task row")
        self.wait_labels(("任务详情",), "timeline row detail")
        self.wait_labels(("展开排期",), "schedule collapsed by default")
        self.tap(("展开排期",), "expand schedule")
        self.wait_labels(("收起排期",), "schedule expanded")
        self.tap(("收起排期",), "collapse schedule")
        self.wait_labels(("展开排期",), "schedule collapsed again")
        self.record("11-timeline-row-opens-detail")

        title_field = self.recover_detail_title("标题")
        self.tap_node(title_field, "focus task title field")
        keyboard = self.wait(lambda nodes: AX.keyboard_top(nodes), "iOS keyboard")
        title_now = self.node(("标题",), field=True)
        close_now = self.node(("关闭任务详情",), pressable=True)
        keyboard_top = int(keyboard)
        if AX.center(title_now)[1] >= keyboard_top:
            raise ProbeError(f"title field is covered by keyboard: center={AX.center(title_now)}, top={keyboard_top}")
        if AX.center(close_now)[1] >= keyboard_top:
            raise ProbeError(f"detail close action is covered by keyboard: center={AX.center(close_now)}, top={keyboard_top}")
        self.record("12-detail-keyboard-visible-and-unobstructed", keyboardTop=keyboard_top)
        AX.dismiss_keyboard(self.idb, self.companion, self.udid)
        self.wait_labels(("任务详情",), "detail after keyboard dismiss")
        self.tap(("关闭任务详情",), "close task detail")
        self.wait_absent(("任务详情",), "task detail closed")
        self.record("13-detail-recovers-after-keyboard")

        if not skip_profile:
            profile = ROOT / "scripts" / "qa" / "profile-settings-ios.py"
            profile_out = self.out / "profile"
            result = subprocess.run(
                ["python3", str(profile), "--udid", self.udid, "--idb", self.idb, "--companion", self.companion, "--evidence-dir", str(profile_out)],
                capture_output=True,
                text=True,
                timeout=240,
            )
            if result.returncode != 0:
                raise ProbeError(f"profile/settings chain failed: {(result.stderr or result.stdout)[-600:]}")
            self.steps.append({"name": "14-profile-settings-chain", "status": "passed", "profileEvidence": str(profile_out)})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--udid", default=os.environ.get("IOS_UDID", DEFAULT_UDID))
    parser.add_argument("--idb", default=os.environ.get("IDB_BIN", str(Path.home() / ".heyta-tools/idb/venv/bin/idb")))
    parser.add_argument("--companion", default=os.environ.get("IDB_COMPANION", str(Path.home() / ".heyta-tools/idb/idb_companion")))
    parser.add_argument("--timeout", type=float, default=12.0)
    parser.add_argument("--evidence-dir", default=os.environ.get("HEYTA_TASK_UX_IOS_EVIDENCE", str(DEFAULT_EVIDENCE)))
    parser.add_argument("--skip-profile", action="store_true", help="do not chain profile-settings-ios.py")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    probe = Probe(args)
    report = Path(args.evidence_dir) / "tasks-ux-journey.json"
    try:
        probe.run(args.skip_profile)
        report.write_text(json.dumps({"status": "passed", "udid": args.udid, "steps": probe.steps}, ensure_ascii=False, indent=2))
        print(json.dumps({"status": "passed", "report": str(report)}, ensure_ascii=False))
        return 0
    except Exception as error:
        try:
            probe.screenshot("failure")
        except Exception:
            pass
        report.write_text(json.dumps({"status": "failed", "udid": args.udid, "error": str(error), "steps": probe.steps}, ensure_ascii=False, indent=2))
        print(json.dumps({"status": "failed", "report": str(report), "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
