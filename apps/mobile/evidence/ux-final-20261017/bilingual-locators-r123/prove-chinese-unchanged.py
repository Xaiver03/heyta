#!/usr/bin/env python3
"""代改条件②的现量：中文那一侧逐字没动。

两道一起判：
  A. 字面量层 —— HEAD 与改后两份各自抽全部含中文字符串字面量做集合对账。
     允许差集**只有**那几枚"从写死的组合标签换成 i18n 模板"的字面，多一枚都判红。
  B. 渲染层 —— 在 `ENGLISH=False` 下把每一枚组合标签真的求值出来，逐字等于
     HEAD 里原来写死的那串；再在 `ENGLISH=True` 下逐字等于 `packages/i18n` 的 en 列。

只有 A 不够：组合标签从 f-string 变成模板之后字面量形状本来就变。
只有 B 也不够：它不看别的定位位有没有被顺手改掉。
"""
from __future__ import annotations

import ast
import importlib.util
import re
import subprocess
import sys
from pathlib import Path

CJK = re.compile(r"[一-鿿]")
TARGET = "scripts/qa/tasks-ux-android.py"
EVIDENCE = Path(__file__).resolve().parent

# HEAD 里写死的组合片段 ↔ 改后住进 i18n 模板的那一枚；这两侧同一形状的一换一才允许
ALLOWED_SHAPE_MOVES = {
    "打开任务：": "打开任务：{title}",
    "视图选项：": "视图选项：{view}",
    "移动「": "移动「{title}」到其他象限",
    "」到其他象限": "移动「{title}」到其他象限",
    "已选 2 项": "已选 {count} 项",
    "已选 1 项": "已选 {count} 项",
    "任务已移动到": "任务已移动到「{quadrant}」",
    # 这枚是**判据真抓到的一次遗漏**：正则那一枚也换了形状（由模板把 {title} 换成捕获组派生），
    # 第一版没写进清单 ⇒ A 层判红。B 层单独证它仍匹配同一串，所以形状挪动成立、清单补上。
    "移动「(.+)」到其他象限": "移动「{title}」到其他象限",
}

HEAD_RENDERS = {
    "open_task_label": ("打开任务：UxTaskA1", "Open task: UxTaskA1", lambda m: m.open_task_label("UxTaskA1")),
    # 这两枚的期望值第一版写错了（B 层把它照出来才算测到）：
    # view_options 的入参本身就是**当前语态的视图名**，两种语态要各喂各的；
    "view_options_label": ("视图选项：列表", "View options: List", lambda m: m.view_options_label("列表" if not m.ENGLISH else "List")),
    "move_task_label": ("移动「UxTaskA1」到其他象限", "Move “UxTaskA1” to another quadrant", lambda m: m.move_task_label("UxTaskA1")),
    # pattern 那一枚的用途是**把标题从渲染好的标签里取回来**，所以它的期望是标题本身，
    # 两种语态都应当取出同一枚 `UxTaskA1`（原期望写成整串，是探针写错，不是代码错）。
    "move_task_pattern": (
        "UxTaskA1",
        "UxTaskA1",
        lambda m: re.fullmatch(
            m.move_task_pattern(),
            "移动「UxTaskA1」到其他象限" if not m.ENGLISH else "Move “UxTaskA1” to another quadrant",
        ).group(1),
    ),
    "move_sheet_marker": ("移动「", "Move “", lambda m: m.move_sheet_marker()),
    "moved_feedback_marker": ("任务已移动到「", "Task moved to “", lambda m: m.moved_feedback_marker()),
    "selected 2": ("已选 2 项", "2 selected", lambda m: m.selected_label(2)),
    "selected 1": ("已选 1 项", "1 selected", lambda m: m.selected_label(1)),
}


def chinese_literals(src: str) -> set[str]:
    tree = ast.parse(src)
    return {
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and CJK.search(node.value)
    }


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    repo = Path.cwd()
    head_src = subprocess.run(["git", "show", f"HEAD:{TARGET}"], capture_output=True, text=True, check=True).stdout
    head_path = EVIDENCE / "tasks-ux-android.HEAD.py"
    head_path.write_text(head_src, encoding="utf-8")

    before = chinese_literals(head_src)
    after = chinese_literals((repo / TARGET).read_text(encoding="utf-8"))
    lost = sorted(before - after)
    gained = sorted(after - before)
    print(f"A. 含中文面：HEAD {len(before)} 枚去重 / 改后 {len(after)} 枚去重")
    print(f"   HEAD 有而改后没有：{lost}")
    print(f"   改后新出现：{gained}")
    unexpected = [v for v in lost if v not in ALLOWED_SHAPE_MOVES] + [
        v for v in gained if v not in set(ALLOWED_SHAPE_MOVES.values())
    ]
    if unexpected:
        print(f"   VERDICT A: {len(unexpected)} 枚中文面不在允许的形状挪动清单里 ⇒ 代改条件②不成立：{unexpected}")
        return 1
    print(f"   VERDICT A: 差集全部由 {len(lost)} 枚组合标签换成 i18n 模板解释，其余中文面逐字未变")

    patched = load(repo / TARGET, "patched_probe")
    print("B. ENGLISH=False 逐枚求值（改前那台设备看到的串）：")
    rc = 0
    for name, (zh, en, call) in HEAD_RENDERS.items():
        patched.ENGLISH = False
        got = call(patched)
        ok = got == zh
        rc = rc or (0 if ok else 1)
        print(f"   {'=' if ok else '≠'} {name}: {got!r}  (want {zh!r})")
    print("C. ENGLISH=True 逐枚求值（英文系统下应当渲染的串，逐枚取自 en.ts）：")
    for name, (zh, en, call) in HEAD_RENDERS.items():
        patched.ENGLISH = True
        got = call(patched)
        ok = got == en
        rc = rc or (0 if ok else 1)
        print(f"   {'=' if ok else '≠'} {name}: {got!r}  (want {en!r})")
    print("VERDICT B/C:", "中文态运行时形状逐字等于改前，英文态等于词条真源" if rc == 0 else "有枚不一致")
    return rc


if __name__ == "__main__":
    sys.exit(main())
