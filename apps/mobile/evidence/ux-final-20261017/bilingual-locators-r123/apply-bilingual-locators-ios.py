#!/usr/bin/env python3
"""把 scripts/qa/tasks-ux-ios.py 的单语定位补成中英同义（r124）。

形状走台账 03:4x 那格已经跑通的第三条路：
  · pair 一律写 `T(中, 英)` —— 门的判据一只在 pair 上做交叉，这正是它该管的形状；
  · 多候选仍写元组，但每个候选自己是 `T()` ⇒ 外层元组里没有裸字符串常量，
    不会被读成"一对中英"（那正是臂 S2 抓到的混配）。
每一步都带**期望命中数**，任何一枚不等于期望就整笔拒绝写盘。
顺序有讲究：先换"元组里的整形状"，再换剩下的裸字符串，否则 `"新建任务"` 那种
子串会被前一枚替换吃掉一部分而数错。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
TARGET = ROOT / "scripts/qa/tasks-ux-ios.py"

PAIRS: list[tuple[str, str, int]] = [
    ('("视图选项",)', '(T("视图选项", "View options"),)', 6),
    ('f"视图选项：{view}"', "view_options_label(view)", 1),
    # 🔴 这三枚必须锚在**调用上下文**上，不能锚裸串：替换写进去的 `T("新建任务", …)`
    # 自己就含 `"新建任务"`，按裸串数永远数不到 1（这就是第一次跑拒绝的原因）。
    ('AX.find(state, "新建任务", True', 'AX.find(state, T("新建任务", "New task"), True', 1),
    ('("新建任务",)', '(T("新建任务", "New task"),)', 1),
    ('self.type_text("新任务标题", title)', 'self.type_text(T("新任务标题", "New task title"), title)', 1),
    ('("新任务标题",)', '(T("新任务标题", "New task title"),)', 1),
    ('("添加",)', '(T("添加", "Add"),)', 2),
    ('("只用本机", "先离线使用")',
     '(T("只用本机", "This device only"), T("先离线使用", "Use offline for now"))', 1),
    ('("已选 2 项",)', "(selected_label(2),)", 1),
    ('("退出选择", "已选 1 项")', '(T("退出选择", "Exit selection"), selected_label(1))', 1),
    ('("退出选择",)', '(T("退出选择", "Exit selection"),)', 3),
    ('("选择任务",)', '(T("选择任务", "Select tasks"),)', 1),
    ('("日期显示",)', '(T("日期显示", "Date display"),)', 2),
    ('("选择排序方式",)', '(T("选择排序方式", "Choose sort order"),)', 2),
    ('("默认（按截止时间）", "按添加时间", "按优先级")',
     '(T("默认（按截止时间）", "Default (due date)"), T("按添加时间", "Date added"), T("按优先级", "Priority"))', 1),
    ('("按优先级",)', '(T("按优先级", "Priority"),)', 1),
    ('("倒计时",)', '(T("倒计时", "Countdown"),)', 1),
    ('("关闭视图选项",)', '(T("关闭视图选项", "Close view options"),)', 2),
    ('AX.find(nodes, "关闭视图选项", True', 'AX.find(nodes, T("关闭视图选项", "Close view options"), True', 1),
    ('("撤销移动",)', '(T("撤销移动", "Undo move"),)', 3),
    ('("任务详情",)', '(T("任务详情", "Task details"),)', 3),
    ('("关闭任务详情",)', '(T("关闭任务详情", "Close task details"),)', 2),
    ('("展开排期",)', '(T("展开排期", "Show scheduling"),)', 3),
    ('("收起排期",)', '(T("收起排期", "Hide scheduling"),)', 2),
    ('("标题",)', '(T("标题", "Title"),)', 1),
    ('self.recover_detail_title("标题")', 'self.recover_detail_title(T("标题", "Title"))', 1),
    ('("马上做", "计划做", "交给别人", "先不做")',
     '(T("马上做", "Do now"), T("计划做", "Schedule"), T("交给别人", "Delegate"), T("先不做", "Drop"))', 1),
    ('f"打开任务：{task_a}"', "open_task_label(task_a)", 1),
    ('f"打开任务：{task_b}"', "open_task_label(task_b)", 1),
    ('f"选择：{task_b}"', "select_task_label(task_b)", 1),
    ('f"选择：{task_a}"', "select_task_label(task_a)", 1),
    ('f"移动「{task_a}」到其他象限"', "move_task_label(task_a)", 3),
    ('f"移动「{task_b}」到其他象限"', "move_task_label(task_b)", 2),
    ('"时间线：共 2 条任务"', "timeline_group_label(2)", 1),
    ('self.choose_view("列表", "时间线")', 'self.choose_view(T("列表", "List"), T("时间线", "Timeline"))', 1),
    ('self.choose_view("时间线", "列表")', 'self.choose_view(T("时间线", "Timeline"), T("列表", "List"))', 1),
    ('self.choose_view("列表", "四象限")', 'self.choose_view(T("列表", "List"), T("四象限", "Quadrants"))', 1),
    ('self.choose_view("四象限", "时间线")', 'self.choose_view(T("四象限", "Quadrants"), T("时间线", "Timeline"))', 1),
    ('self.open_view_options("列表")', 'self.open_view_options(T("列表", "List"))', 2),
    ('self.open_view_options("时间线")', 'self.open_view_options(T("时间线", "Timeline"))', 1),
]

HELPERS = '''ENGLISH = False


def T(zh: str, en: str) -> str:
    """Pick the column the installed app is actually rendering.

    `packages/i18n` carries both; the simulator's app language decides which one
    the shell renders, so every locator has to hold both spellings.
    """
    return en if ENGLISH else zh


def open_task_label(title: str) -> str:
    return T("打开任务：{title}", "Open task: {title}").format(title=title)


def select_task_label(title: str) -> str:
    return T("选择：{title}", "Select: {title}").format(title=title)


def view_options_label(view: str) -> str:
    return T("视图选项：{view}", "View options: {view}").format(view=view)


def move_task_label(title: str) -> str:
    return T("移动「{title}」到其他象限", "Move “{title}” to another quadrant").format(title=title)


def timeline_group_label(count: int) -> str:
    return T("时间线：共 {count} 条任务", "Timeline: {count} tasks").format(count=count)


def selected_label(count: int) -> str:
    return T("已选 {count} 项", "{count} selected").format(count=count)


'''

DETECT = '''        state = self.tree()
        # 语言判定走三种首屏面：已同意联网时只有底部 tab，全新安装时先是隐私同意卡、
        # 再是离线欢迎卡（与 scripts/qa/profile-settings-android.py 的判定同形）。
        global ENGLISH
        ENGLISH = any(
            AX.find(state, candidate, True, False, None, True, 0) is not None
            for candidate in ("This device only", "Use offline for now", "New task")
        )
        self.ui_locale = "en" if ENGLISH else "zh-CN"
        deadline = time.monotonic() + self.timeout
'''

DETECT_ANCHOR = '''        # Privacy and welcome screens arrive in separate native render passes.
        deadline = time.monotonic() + self.timeout
'''


def main() -> int:
    source = TARGET.read_text(encoding="utf-8")
    if "def T(zh: str, en: str)" in source:
        print("already patched; refusing to double-apply")
        return 2
    # 🔴 期望数是**对着逐步替换后的源文**数的：`"新建任务"` 这类裸串有一半住在
    # `("新建任务",)` 里面，先换掉元组那一枚之后剩下的才是 1。一次预扫全部会数错。
    # `--dry` 把每一枚都过一遍再一起报，省得一次只撞出一格。
    bad: list[str] = []
    for old, new, expected in PAIRS:
        found = source.count(old)
        if found != expected:
            bad.append(f"{old!r} hit {found}, expected {expected}")
            continue
        source = source.replace(old, new)
    if "--dry" in sys.argv:
        print("\n".join(bad) if bad else f"dry: all {len(PAIRS)} patterns match")
        return 1 if bad else 0
    if bad:
        print("REFUSED:\n" + "\n".join(bad))
        return 1
    marker = "class Probe:"
    if source.count(marker) != 1:
        print(f"REFUSED: anchor {marker!r} not unique")
        return 1
    source = source.replace(marker, HELPERS + marker)
    if source.count(DETECT_ANCHOR) != 1:
        print(f"REFUSED: detection anchor hit {source.count(DETECT_ANCHOR)}")
        return 1
    source = source.replace(DETECT_ANCHOR, "        # Privacy and welcome screens arrive in separate native render passes.\n" + DETECT)
    source = source.replace(
        "        self.steps: list[dict[str, Any]] = []\n",
        "        self.steps: list[dict[str, Any]] = []\n        self.ui_locale: str | None = None\n",
        1,
    )
    source = source.replace(
        'json.dumps({"status": "passed", "udid": args.udid, "steps": probe.steps}',
        'json.dumps({"status": "passed", "udid": args.udid, "uiLocale": probe.ui_locale, "steps": probe.steps}',
        1,
    )
    source = source.replace(
        'json.dumps({"status": "failed", "udid": args.udid, "error": str(error), "steps": probe.steps}',
        'json.dumps({"status": "failed", "udid": args.udid, "uiLocale": probe.ui_locale, "error": str(error), "steps": probe.steps}',
        1,
    )
    TARGET.write_text(source, encoding="utf-8")
    print("patched", TARGET)
    return 0


if __name__ == "__main__":
    sys.exit(main())
