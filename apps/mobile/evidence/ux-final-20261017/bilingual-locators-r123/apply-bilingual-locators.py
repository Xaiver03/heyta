#!/usr/bin/env python3
"""把 scripts/qa/tasks-ux-android.py 的单语定位补成中英同义（T(中,英) 形状）。

每一步都带**期望命中数**：任何一枚不等于期望就整笔拒绝写盘并报错，
不留"改了一半"的中间态。中文那一侧的字面一枚不动（改后由
prove-chinese-multiset.py 做多重集对账）。
"""
from __future__ import annotations

import sys
from pathlib import Path

TARGET = Path(__file__).resolve().parents[5] / "scripts/qa/tasks-ux-android.py"

PAIRS: list[tuple[str, str, int]] = [
    ('"只用本机"', 'T("只用本机", "This device only")', 2),
    ('"先离线使用"', 'T("先离线使用", "Use offline for now")', 3),
    ('"任务"', 'T("任务", "Tasks")', 1),
    ('"新建任务"', 'T("新建任务", "New task")', 1),
    ('"添加"', 'T("添加", "Add")', 1),
    ('"退出选择"', 'T("退出选择", "Exit selection")', 4),
    ('"已选 2 项"', "selected_label(2)", 1),
    ('"已选 1 项"', "selected_label(1)", 1),
    ('"选择任务"', 'T("选择任务", "Select tasks")', 1),
    ('"列表"', 'T("列表", "List")', 5),
    ('"时间线"', 'T("时间线", "Timeline")', 4),
    ('"四象限"', 'T("四象限", "Quadrants")', 2),
    ('"视图选项"', 'T("视图选项", "View options")', 6),
    ('"日期显示"', 'T("日期显示", "Date display")', 2),
    ('"选择排序方式"', 'T("选择排序方式", "Choose sort order")', 2),
    ('"倒计时"', 'T("倒计时", "Countdown")', 1),
    ('"任务详情"', 'T("任务详情", "Task details")', 3),
    ('"收起排期"', 'T("收起排期", "Hide scheduling")', 2),
    ('"展开排期"', 'T("展开排期", "Show scheduling")', 2),
    ('"标题"', 'T("标题", "Title")', 2),
    ('"撤销移动"', 'T("撤销移动", "Undo move")', 1),
    ('"默认（按截止时间）"', 'T("默认（按截止时间）", "Default (due date)")', 1),
    ('"按添加时间"', 'T("按添加时间", "Date added")', 1),
    ('"按优先级"', 'T("按优先级", "Priority")', 2),
    ('"马上做"', 'T("马上做", "Do now")', 1),
    ('"计划做"', 'T("计划做", "Schedule")', 1),
    ('"交给别人"', 'T("交给别人", "Delegate")', 1),
    ('"先不做"', 'T("先不做", "Drop")', 1),
    ('f"打开任务：{title}"', "open_task_label(title)", 2),
    ('f"打开任务：{task_b}"', "open_task_label(task_b)", 1),
    ('f"打开任务：{task_a}"', "open_task_label(task_a)", 1),
    ('f"视图选项：{view}"', "view_options_label(view)", 1),
    ('f"视图选项：{current_view}"', "view_options_label(current_view)", 1),
    ('f"移动「{task_a}」到其他象限"', "move_task_label(task_a)", 1),
    ('r"移动「(.+)」到其他象限"', 'T(r"移动「(.+)」到其他象限", "Move \\u201c(.+)\\u201d to another quadrant")', 1),
    ('"移动「" in self.label(n)', 'T("移动「", "Move \\u201c") in self.label(n)', 1),
    ('"任务已移动到" in self.label(node)', 'T("任务已移动到", "Task moved to") in self.label(node)', 1),
]

HELPERS = '''
ENGLISH = False


def T(zh: str, en: str) -> str:
    """Pick the column the installed app is actually rendering.

    `packages/i18n` carries both; the emulator's system locale decides which one
    the shell renders, so every locator has to hold both spellings.
    """
    return en if ENGLISH else zh


def open_task_label(title: str) -> str:
    return f"{T('打开任务：', 'Open task: ')}{title}"


def view_options_label(view: str) -> str:
    return f"{T('视图选项：', 'View options: ')}{view}"


def move_task_label(title: str) -> str:
    return f"{T('移动「', 'Move \\u201c')}{title}{T('」到其他象限', '\\u201d to another quadrant')}"


def selected_label(count: int) -> str:
    return T(f"已选 {count} 项", f"{count} selected")

'''

DETECT = '''        time.sleep(2)
        nodes = self.nodes()
        # 语言判定走三种首屏面：已同意联网时只有底部 tab，全新安装时先是隐私同意卡、
        # 再是离线欢迎卡（与同目录 profile-settings-android.py 的判定同形）。
        global ENGLISH
        ENGLISH = any(
            self.find(nodes, label=candidate, clickable=True)
            for candidate in ("This device only", "Use offline for now", "Tasks")
        )
        self.ui_locale = "en" if ENGLISH else "zh-CN"
'''

ANCHOR = "        time.sleep(2)\n        nodes = self.nodes()\n"


def main() -> int:
    source = TARGET.read_text(encoding="utf-8")
    if "def T(zh: str, en: str)" in source:
        print("already patched; refusing to double-apply")
        return 2
    for old, new, expected in PAIRS:
        found = source.count(old)
        if found != expected:
            print(f"REFUSED: {old!r} hit {found} times, expected {expected}")
            return 1
    for old, new, expected in PAIRS:
        source = source.replace(old, new)
    # helpers go right after the ProbeError class
    marker = "class AndroidProbe:"
    if source.count(marker) != 1:
        print(f"REFUSED: anchor {marker!r} not unique")
        return 1
    source = source.replace(marker, HELPERS.strip("\n") + "\n\n" + marker)
    if source.count(ANCHOR) != 1:
        print(f"REFUSED: detection anchor hit {source.count(ANCHOR)} times, expected 1")
        return 1
    source = source.replace(ANCHOR, DETECT)
    # probe must carry the locale even before detection ran
    source = source.replace(
        "        self.steps: list[dict[str, Any]] = []\n",
        "        self.steps: list[dict[str, Any]] = []\n        self.ui_locale: str | None = None\n",
        1,
    )
    source = source.replace(
        'report.write_text(json.dumps({"status": "passed", "serial": args.serial, "steps": probe.steps}, ensure_ascii=False, indent=2))',
        'report.write_text(json.dumps({"status": "passed", "serial": args.serial, "uiLocale": probe.ui_locale, "steps": probe.steps}, ensure_ascii=False, indent=2))',
        1,
    )
    source = source.replace(
        'report.write_text(json.dumps({"status": "failed", "serial": args.serial, "error": str(error), "steps": probe.steps}, ensure_ascii=False, indent=2))',
        'report.write_text(json.dumps({"status": "failed", "serial": args.serial, "uiLocale": probe.ui_locale, "error": str(error), "steps": probe.steps}, ensure_ascii=False, indent=2))',
        1,
    )
    source = source.replace(
        'print(json.dumps({"status": "passed", "report": str(report)}, ensure_ascii=False))',
        'print(json.dumps({"status": "passed", "report": str(report), "uiLocale": probe.ui_locale}, ensure_ascii=False))',
        1,
    )
    TARGET.write_text(source, encoding="utf-8")
    print("patched", TARGET)
    return 0


if __name__ == "__main__":
    sys.exit(main())
