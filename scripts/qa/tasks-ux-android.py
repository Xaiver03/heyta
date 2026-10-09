#!/usr/bin/env python3
"""Real Android task UX acceptance for the current Heyta installation.

This probe exercises the product surface through UIAutomator and adb only:
task creation, list scrolling, long-press multi-select, quadrant move/undo,
timeline row entry, and keyboard visibility in the task detail sheet.  A
successful adb/idb command is never treated as a product assertion; every
action is followed by a fresh accessibility-tree assertion.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Callable
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EVIDENCE = ROOT / "apps" / "mobile" / "evidence" / "settings-finish-release" / "android"


class ProbeError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default=os.environ.get("ANDROID_SERIAL", "emulator-5554"))
    parser.add_argument("--timeout", type=float, default=12.0)
    parser.add_argument("--evidence-dir", type=Path, default=Path(os.environ.get("HEYTA_TASK_UX_ANDROID_EVIDENCE", DEFAULT_EVIDENCE)))
    parser.add_argument("--skip-profile", action="store_true", help="do not chain profile-settings-android.py")
    return parser.parse_args()


class AndroidProbe:
    def __init__(self, args: argparse.Namespace) -> None:
        self.serial = args.serial
        self.timeout = args.timeout
        self.out = args.evidence_dir
        self.out.mkdir(parents=True, exist_ok=True)
        self.steps: list[dict[str, Any]] = []
        self.screenshot_index = 0

    def adb(self, *args: str, check: bool = True) -> str:
        result = subprocess.run(
            ["adb", "-s", self.serial, *args],
            capture_output=True,
            text=True,
            timeout=45,
        )
        if check and result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()[:400]
            raise ProbeError(f"adb {' '.join(args)} failed ({result.returncode}): {detail}")
        return result.stdout

    def tree(self) -> ET.Element:
        last = ""
        for _ in range(4):
            result = subprocess.run(
                ["adb", "-s", self.serial, "shell", "uiautomator", "dump", "/sdcard/heyta-task-ux.xml"],
                capture_output=True,
                text=True,
                timeout=30,
            )
            last = result.stderr or result.stdout
            if result.returncode == 0:
                xml = self.adb("exec-out", "cat", "/sdcard/heyta-task-ux.xml")
                try:
                    return ET.fromstring(xml)
                except ET.ParseError:
                    pass
            time.sleep(0.6)
        raise ProbeError(f"uiautomator tree failed: {last.strip()[:400]}")

    @staticmethod
    def label(node: ET.Element) -> str:
        return node.get("content-desc") or node.get("text") or ""

    @staticmethod
    def is_visible(node: ET.Element) -> bool:
        """Ignore off-screen/hidden AX nodes exposed by UIAutomator."""
        return node.get("visible-to-user", "true") == "true"

    @staticmethod
    def bounds(node: ET.Element) -> tuple[int, int, int, int]:
        values = [int(value) for value in re.findall(r"\d+", node.get("bounds", ""))]
        if len(values) != 4:
            raise ProbeError(f"node has no usable bounds: {node.attrib}")
        return tuple(values)  # type: ignore[return-value]

    def nodes(self) -> list[ET.Element]:
        return list(self.tree().iter("node"))

    def find(
        self,
        nodes: list[ET.Element],
        *,
        label: str | None = None,
        resource_prefix: str | None = None,
        clickable: bool = False,
        enabled: bool | None = None,
    ) -> list[ET.Element]:
        found: list[ET.Element] = []
        for node in nodes:
            if not self.is_visible(node):
                continue
            if label is not None and self.label(node) != label:
                continue
            resource = node.get("resource-id", "")
            if resource_prefix is not None and not resource.endswith(resource_prefix) and resource_prefix not in resource:
                continue
            if clickable and node.get("clickable") != "true":
                continue
            if enabled is not None and (node.get("enabled") == "true") != enabled:
                continue
            found.append(node)
        return found

    def wait(self, predicate: Callable[[list[ET.Element]], Any], description: str) -> Any:
        deadline = time.monotonic() + self.timeout
        last: list[ET.Element] = []
        while time.monotonic() < deadline:
            last = self.nodes()
            value = predicate([node for node in last if self.is_visible(node)])
            if isinstance(value, ET.Element) or value:
                return value
            time.sleep(0.35)
        visible = [self.label(node) for node in last if self.is_visible(node) and self.label(node)]
        raise ProbeError(f"timed out waiting for {description}; visible={visible[:100]!r}")

    def scroll_find(self, predicate, description: str) -> ET.Element:
        for _ in range(8):
            nodes = self.nodes()
            result = predicate([node for node in nodes if self.is_visible(node)])
            if result is not None:
                return result
            left, top, right, bottom = self.bounds(nodes[0])
            self.adb("shell", "input", "swipe", str((left + right) // 2), str(int(bottom * .75)),
                     str((left + right) // 2), str(int(bottom * .3)), "450")
        raise ProbeError(f"cannot reach {description} by scrolling")

    def scroll_to_top(self, label: str, *, clickable: bool = True) -> None:
        """Reveal a content control after a previous downward content scroll."""
        root = self.tree()
        left, top, right, bottom = self.bounds(next(root.iter("node")))
        for _ in range(8):
            if self.find(self.nodes(), label=label, clickable=clickable):
                return
            self.adb(
                "shell",
                "input",
                "swipe",
                str((left + right) // 2),
                str(int(top + (bottom - top) * 0.3)),
                str((left + right) // 2),
                str(int(top + (bottom - top) * 0.8)),
                "450",
            )
        raise ProbeError(f"cannot reveal {label!r} after scrolling to top")

    def wait_label(self, label: str, *, clickable: bool = False) -> ET.Element:
        return self.wait(lambda nodes: next(iter(self.find(nodes, label=label, clickable=clickable)), None), f"label {label!r}")

    def wait_resource(self, prefix: str, *, clickable: bool = False) -> ET.Element:
        return self.wait(lambda nodes: next(iter(self.find(nodes, resource_prefix=prefix, clickable=clickable)), None), f"resource {prefix!r}")

    def tap_node(self, node: ET.Element) -> None:
        left, top, right, bottom = self.bounds(node)
        self.adb("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))

    def tap_label(self, label: str) -> None:
        node = self.wait_label(label, clickable=True)
        self.tap_node(node)

    def open_view_options(self, view: str) -> None:
        """Open the task view menu through its stateful AX label."""
        self.tap_label(f"视图选项：{view}")
        self.wait_label("视图选项")

    def choose_view(self, current_view: str, target_view: str) -> None:
        """Choose a view from the menu; the native chip closes it after selection."""
        self.scroll_to_top(f"视图选项：{current_view}")
        self.open_view_options(current_view)
        self.tap_label(target_view)
        self.wait_no_label("视图选项")

    def screenshot(self, name: str) -> None:
        path = self.out / f"{name}.png"
        result = subprocess.run(
            ["adb", "-s", self.serial, "exec-out", "screencap", "-p"],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0 or not result.stdout:
            raise ProbeError(f"could not capture screenshot {name}: {result.stderr!r}")
        path.write_bytes(result.stdout)
        self.screenshot_index += 1

    def record(self, name: str, **details: Any) -> None:
        self.steps.append({"name": name, "status": "passed", "at": time.time(), **details})
        self.screenshot(name)

    def wait_no_label(self, label: str) -> None:
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            if not self.find(self.nodes(), label=label):
                return
            time.sleep(0.3)
        raise ProbeError(f"label remained visible: {label!r}")

    def ensure_on_tasks(self) -> None:
        self.adb("shell", "am", "force-stop", "com.heyta")
        self.adb("shell", "am", "start", "-W", "-n", "com.heyta/com.heytamobile.MainActivity")
        time.sleep(2)
        nodes = self.nodes()
        if self.find(nodes, label="只用本机", clickable=True):
            self.tap_label("只用本机")
            self.wait_label("先离线使用", clickable=True)
        if self.find(self.nodes(), label="先离线使用", clickable=True):
            self.tap_label("先离线使用")
        self.wait_label("任务", clickable=True)

    def create_task(self, title: str) -> None:
        self.tap_label("新建任务")
        field = self.wait_resource("capture-input")
        self.tap_node(field)
        self.adb("shell", "input", "text", title)
        add = self.wait_label("添加", clickable=True)
        if add.get("enabled") != "true":
            raise ProbeError("capture submit stayed disabled after real text input")
        self.tap_node(add)
        self.wait_label(title)

    def first_task_row(self) -> ET.Element:
        return self.wait_resource("task-row-", clickable=True)

    def first_task_id(self, prefix: str = "task-row-") -> str:
        node = self.first_task_row()
        resource = node.get("resource-id", "")
        index = resource.rfind(prefix)
        if index < 0:
            raise ProbeError(f"could not derive task id from {resource!r}")
        return resource[index + len(prefix) :]

    def task_row_for_title(self, title: str) -> ET.Element:
        expected = f"打开任务：{title}"
        return self.wait(
            lambda nodes: next(
                (
                    node
                    for node in nodes
                    if node.get("resource-id", "").find("task-row-") >= 0
                    and self.label(node) == expected
                ),
                None,
            ),
            f"task row {title!r}",
        )

    def task_id_for_title(self, title: str) -> str:
        resource = self.task_row_for_title(title).get("resource-id", "")
        marker = "task-row-"
        index = resource.rfind(marker)
        if index < 0:
            raise ProbeError(f"could not derive task id from {resource!r}")
        return resource[index + len(marker) :]

    def long_press(self, node: ET.Element) -> None:
        left, top, right, bottom = self.bounds(node)
        x = (left + right) // 2
        y = (top + bottom) // 2
        self.adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), "900")

    def keyboard_visible(self) -> bool:
        # `dumpsys input_method` keeps the IME view state alive after a back
        # press on some emulator images, even though the keyboard surface has
        # already gone away.  Window Insets is the rendered-state source of
        # truth: the IME source has a non-zero frame and `visible=true` while
        # the keyboard is actually on screen.
        window = self.adb("shell", "dumpsys", "window", check=False)
        ime_visibility = re.findall(
            r"InsetsSource id=\S+ type=ime\b[^\n]*\bvisible=(true|false)\b",
            window,
        )
        if ime_visibility:
            return any(value == "true" for value in ime_visibility)

        # Older Android images may omit InsetsSource from `dumpsys window`.
        # Keep the legacy flags as a fallback for those devices.
        text = self.adb("shell", "dumpsys", "input_method", check=False)
        return "mInputShown=true" in text or "mIsInputViewShown=true" in text

    def task_quadrant(self, nodes: list[ET.Element], title: str) -> str | None:
        """Return the quadrant cell containing a task row from one AX snapshot."""
        row = next(
            (
                node
                for node in nodes
                if node.get("resource-id", "").startswith("task-row-")
                and self.label(node) == f"打开任务：{title}"
            ),
            None,
        )
        if row is None:
            return None
        left, top, right, bottom = self.bounds(row)
        center_x, center_y = (left + right) // 2, (top + bottom) // 2
        for cell in nodes:
            resource = cell.get("resource-id", "")
            if not resource.startswith("quadrant-cell-"):
                continue
            cell_left, cell_top, cell_right, cell_bottom = self.bounds(cell)
            if cell_left <= center_x <= cell_right and cell_top <= center_y <= cell_bottom:
                return resource
        return None

    def run(self, skip_profile: bool) -> None:
        self.ensure_on_tasks()
        stamp = str(int(time.time()))
        task_a = f"UxTaskA{stamp}"
        task_b = f"UxTaskB{stamp}"
        self.create_task(task_a)
        self.record("01-created-task-a", title=task_a)
        task_a_id = self.task_id_for_title(task_a)
        self.create_task(task_b)
        self.record("02-created-task-b", title=task_b)

        rows_before = self.find(self.nodes(), resource_prefix="task-row-", clickable=True)
        if len(rows_before) < 2:
            raise ProbeError(f"expected two task rows, found {len(rows_before)}")
        root = self.tree()
        root_bounds = self.bounds(next(root.iter("node")))
        width, height = root_bounds[2], root_bounds[3]
        self.adb("shell", "input", "swipe", str(width // 2), str(height * 3 // 4), str(width // 2), str(height // 3), "350")
        time.sleep(0.7)
        self.wait_resource("task-row-")
        self.record("03-list-scroll", rowCount=len(self.find(self.nodes(), resource_prefix="task-row-")))

        first = self.task_row_for_title(task_a)
        self.long_press(first)
        self.wait_label("退出选择", clickable=True)
        self.record("04-long-press-enters-selection")
        second = self.scroll_find(
            lambda nodes: next(
                (
                    node
                    for node in nodes
                    if node.get("resource-id", "").find("task-row-") >= 0
                    and self.label(node) == f"打开任务：{task_b}"
                ),
                None,
            ),
            f"second test task row {task_b!r}",
        )
        self.tap_node(second)
        selected = self.wait_label("已选 2 项")
        if selected is None:
            raise ProbeError("second task was not added to multi-select")
        self.record("05-multi-select-second-task")
        self.tap_label("退出选择")
        self.wait_no_label("退出选择")
        self.record("06-exit-selection")

        self.tap_label("选择任务")
        self.tap_node(self.scroll_find(
            lambda nodes: next(
                (
                    node
                    for node in nodes
                    if node.get("resource-id", "").find("task-row-") >= 0
                    and self.label(node) == f"打开任务：{task_a}"
                ),
                None,
            ),
            f"timeline selection task row {task_a!r}",
        ))
        self.choose_view("列表", "时间线")
        self.wait_no_label("退出选择")
        self.wait_no_label("已选 1 项")
        self.record("06b-timeline-clears-selection")
        self.choose_view("时间线", "列表")

        # View, date and sort controls are intentionally behind one explicit
        # entry point.  Exercise the list menu before changing views so a
        # regression cannot silently restore the old row of always-visible
        # controls.
        self.open_view_options("列表")
        self.wait_label("日期显示")
        self.wait_label("选择排序方式")
        for sort_label in ("默认（按截止时间）", "按添加时间", "按优先级"):
            self.wait_label(sort_label, clickable=True)
        self.tap_label("按优先级")
        self.wait_no_label("视图选项")
        self.open_view_options("列表")
        self.tap_label("倒计时")
        # Date chips keep the panel open for a second choice; Android Back is
        # the documented dismissal path and is itself part of the UX contract.
        self.wait_label("视图选项")
        self.adb("shell", "input", "keyevent", "4")
        self.wait_no_label("视图选项")
        self.record("07-view-options-sort-and-date")

        self.choose_view("列表", "四象限")
        self.wait_resource("quadrant-board")
        more = self.scroll_find(
            lambda nodes: next(
                (
                    n
                    for n in nodes
                    if n.get("clickable") == "true"
                    and (n.get("content-desc") or "") == f"移动「{task_a}」到其他象限"
                ),
                None,
            ),
            f"quadrant more action for {task_a!r}",
        )
        move_label = more.get("content-desc", "")
        match = re.fullmatch(r"移动「(.+)」到其他象限", move_label)
        if match is None:
            raise ProbeError(f"could not derive task title from quadrant move action: {move_label!r}")
        moved_title = match.group(1)
        # The move sheet is a modal AX surface and hides the background task rows,
        # so capture the source quadrant before opening it.
        source_quadrant = self.task_quadrant(self.nodes(), moved_title)
        if source_quadrant is None:
            raise ProbeError(f"could not locate source quadrant for {moved_title!r}")
        self.tap_node(more)
        self.wait(lambda nodes: next((n for n in nodes if "移动「" in self.label(n) and n.get("clickable") != "true"), None), "quadrant move sheet title")
        self.record("08-open-quadrant-move-sheet")
        quadrant_names = ("马上做", "计划做", "交给别人", "先不做")
        options = [n for n in self.nodes() if self.is_visible(n) and self.label(n) in quadrant_names and n.get("clickable") == "true" and n.get("enabled") == "true"]
        options = [
            node
            for node in options
            if f"quadrant-cell-{quadrant_names.index(self.label(node)) + 1}" != source_quadrant
        ]
        if not options:
            raise ProbeError("quadrant move sheet has no enabled destination outside the source quadrant")
        target_quadrant = f"quadrant-cell-{quadrant_names.index(self.label(options[0])) + 1}"
        self.tap_node(options[0])
        def feedback_and_undo(nodes: list[ET.Element]) -> tuple[ET.Element, ET.Element] | None:
            feedback = next((node for node in nodes if "任务已移动到" in self.label(node)), None)
            undo = next((node for node in nodes if self.label(node) == "撤销移动" and node.get("clickable") == "true"), None)
            return None if feedback is None or undo is None else (feedback, undo)

        feedback, undo = self.wait(feedback_and_undo, "quadrant move feedback and undo action")
        undo_bounds = self.bounds(undo)
        self.steps.append({
            "name": "09-quadrant-move-feedback",
            "status": "passed",
            "at": time.time(),
            "sourceQuadrant": source_quadrant,
            "targetQuadrant": target_quadrant,
            "feedback": self.label(feedback),
            "undoBounds": list(undo_bounds),
        })
        # Keep the first AX node: the feedback surface self-dismisses after 5s.
        self.tap_node(undo)
        self.wait(
            lambda nodes: self.task_quadrant(nodes, moved_title) == source_quadrant,
            "task returns to source quadrant after undo",
        )
        self.record("10-quadrant-undo", sourceQuadrant=source_quadrant)

        self.choose_view("四象限", "时间线")
        self.wait_resource("timeline-view")
        # Timeline has its own geometry, so date display and list sorting do
        # not belong in its menu.
        self.open_view_options("时间线")
        self.wait_no_label("日期显示")
        self.wait_no_label("选择排序方式")
        self.adb("shell", "input", "keyevent", "4")
        self.wait_no_label("视图选项")
        self.record("11-timeline-view-options")
        timeline_row = self.wait(
            lambda nodes: next(
                (
                    node
                    for node in nodes
                    if node.get("clickable") == "true"
                    and (
                        f"timeline-open-task-{task_a_id}" in node.get("resource-id", "")
                        or f"timeline-lane-item-{task_a_id}" in node.get("resource-id", "")
                    )
                ),
                None,
            ),
            f"timeline task row {task_a!r}",
        )
        self.tap_node(timeline_row)
        self.wait_label("任务详情")
        self.tap_node(self.scroll_find(
            lambda nodes: next(
                (node for node in nodes if self.label(node) == "展开排期" and node.get("clickable") == "true"),
                None,
            ),
            "expand schedule control",
        ))
        self.wait_label("收起排期", clickable=True)
        self.tap_label("收起排期")
        self.wait_label("展开排期", clickable=True)
        self.scroll_to_top("标题", clickable=False)
        self.record("12-timeline-row-opens-detail")
        title_field = self.wait(
            lambda nodes: next(
                (n for n in nodes if n.get("class", "").endswith("EditText") and self.label(n) == "标题"),
                None,
            ),
            "editable task title field",
        )
        self.tap_node(title_field)
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline and not self.keyboard_visible():
            time.sleep(0.3)
        if not self.keyboard_visible():
            raise ProbeError("task detail title field did not open the Android keyboard")
        self.record("13-detail-keyboard-visible")
        self.adb("shell", "input", "keyevent", "4")
        self.wait(
            lambda nodes: (
                next((node for node in nodes if self.label(node) == "任务详情"), None)
                if not self.keyboard_visible()
                else None
            ),
            "keyboard hidden while task detail remains open",
        )
        self.record("14-detail-keyboard-dismissed")
        self.adb("shell", "input", "keyevent", "4")
        self.wait_no_label("任务详情")
        self.wait_resource("timeline-view")
        self.record("15-detail-closes-after-second-back")

        if not skip_profile:
            profile = ROOT / "scripts" / "qa" / "profile-settings-android.py"
            profile_out = self.out / "profile"
            result = subprocess.run(
                ["python3", str(profile), "--serial", self.serial, "--timeout", str(self.timeout), "--evidence-dir", str(profile_out)],
                capture_output=True,
                text=True,
                timeout=180,
            )
            if result.returncode != 0:
                raise ProbeError(f"profile/settings chain failed: {(result.stderr or result.stdout)[-600:]}")
            self.steps.append({"name": "16-profile-settings-chain", "status": "passed", "profileEvidence": str(profile_out)})


def main() -> int:
    args = parse_args()
    probe = AndroidProbe(args)
    report = args.evidence_dir / "tasks-ux-journey.json"
    try:
        probe.run(args.skip_profile)
        report.write_text(json.dumps({"status": "passed", "serial": args.serial, "steps": probe.steps}, ensure_ascii=False, indent=2))
        print(json.dumps({"status": "passed", "report": str(report)}, ensure_ascii=False))
        return 0
    except Exception as error:
        try:
            probe.screenshot("failure")
        except Exception:
            pass
        report.write_text(json.dumps({"status": "failed", "serial": args.serial, "error": str(error), "steps": probe.steps}, ensure_ascii=False, indent=2))
        print(json.dumps({"status": "failed", "report": str(report), "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
