#!/usr/bin/env python3
"""把移动端验收脚本里的界面定位标签对回词条真源。

`packages/i18n` 是唯一文案事实源，而 `scripts/qa/*` 那几条旅程脚本是靠**界面文本**定位的
（AX 只暴露 AXLabel / uiautomator 只暴露 text，没有 testID 可用）。于是有两种必然失效：

1. 中英配对不对同一个键 —— 脚本写着 `("导出数据", "Export data")`，可 `导出数据` 是
   `web.export.title`，移动端那一屏渲染的是 `mobile.export.entry` =「备份与迁移」。
   这种标签**在两种语态下都打不中**，旅程死在入口，却会被读成"界面没有这个功能"。
2. 只写一种语态 —— 设备系统语言换了就整条走不到被测判据（Android 那条 2026-10-09 实测过）。

用法：

    python3 scripts/qa/check-locator-labels.py scripts/qa/profile-settings-android.py …

非零退出 = 有标签对不上真源。查的是**字面量与键的对应关系**，不验旅程本身是否跑通。
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
# 词条表两种引号都有（`en.ts` 里 `"Don't ask again"` 那一类），只认单引号会**静默漏掉**
# 一批英文值 —— 漏掉的那部分不会报红，只会让配对检查无声失效，所以两种都要收。
# `\n` 必须排除在字符类里：源码里成对的引号会跨行配上天文数字。
ENTRY_RE = re.compile(
    r"(?:'([A-Za-z0-9_.-]+)'|\"([A-Za-z0-9_.-]+)\")\s*:\s*(?:'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\")"
)
CJK = re.compile(r"[一-鿿]")
# TS 源码不是 Python，不能用 ast 扫；这里抓所有引号里的"像键名"的串，再和真源的键集合取交集。
ANY_QUOTED = re.compile(r"""['"]([A-Za-z0-9_.-]{3,})['"]""")


def load(locale: str) -> dict[str, str]:
    source = (REPO / "packages/i18n/src/locales" / locale).read_text(encoding="utf-8")
    rows = ENTRY_RE.findall(source)
    return {k1 or k2: (v1 or v2) for k1, k2, v1, v2 in rows}


PLACEHOLDER = re.compile(r"\{[A-Za-z0-9_.]+\}")


def entry_to_pattern(entry: str) -> str:
    """词条里的 `{count}` 这类占位符 → 通配。手工切段再逐段 escape，
    不用 `re.sub(re.escape(...))` —— 那种写法在转义后的空格/大括号上会静默配不中。"""
    out: list[str] = []
    pos = 0
    for match in PLACEHOLDER.finditer(entry):
        out.append(re.escape(entry[pos:match.start()]))
        out.append(r".+")
        pos = match.end()
    out.append(re.escape(entry[pos:]))
    return "^" + "".join(out) + "$"


def template_matches(value: str, table: dict[str, str]) -> list[str]:
    """`已选 2 项` 这类是词条带占位符渲染出来的（`web.shell.bulk.selected` =「已选 {count} 项」），
    不是"真源里没有"。按占位符通配回去，命中就当作合法渲染结果。
    ⚠️ 收的是 **键→值** 那张表：传反了（值→键）不会报错，只会永远配不中，于是每个插值标签都变假红。"""
    hits: list[str] = []
    for key, entry in table.items():
        if "{" not in entry:
            continue
        if re.fullmatch(entry_to_pattern(entry), value):
            hits.append(key)
    return hits


def invert(table: dict[str, str]) -> dict[str, list[str]]:
    inverted: dict[str, list[str]] = {}
    for key, value in table.items():
        inverted.setdefault(value, []).append(key)
    return inverted


ZH_TABLE = load("zh-CN.ts")
EN_TABLE = load("en.ts")
ZH = invert(ZH_TABLE)
EN = invert(EN_TABLE)


def reachable_on_mobile(part: str) -> bool:
    """AX shim 的 `find()` 是"精确优先，找不到退化成子串"，所以一段中文即使不是完整词条，
    只要落在某个 `mobile.*`/`common.*` 值里，脚本照样打得中 —— 这一类不能报成缺陷。"""
    return any(
        (key.startswith("mobile.") or key.startswith("common.")) and part in value
        for key, value in ZH_TABLE.items()
    )


def mobile_referenced_keys() -> set[str]:
    """移动端源码里出现过的**词条键**集合。

    判"移动端渲染不到这个标签"必须按这张表，不能按键名前缀 —— 实测 `TasksScreen.tsx` 有 18 处
    直接复用 `web.shell.*`（批量选择、排序、搜索那几屏），按前缀判会把它们全报成缺陷。
    也不要只抓 `t('…')`：标签会经 `{labelKey: 'mobile.tab.categories'}` 这类**间接表**送进 `t()`，
    只抓直接调用会漏掉一整类，而漏掉的那一类正是假红的来源。
    代价是注释里出现过的键也会被算进来 —— 那只会让判据**更宽**（少报），不会误报成缺陷。
    """
    keys: set[str] = set()
    root = REPO / "apps/mobile/src"
    for path in sorted(root.rglob("*")):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        keys.update(candidate for candidate in ANY_QUOTED.findall(text) if candidate in ALL_KEYS)
    return keys


ALL_KEYS = set(ZH_TABLE) | set(EN_TABLE)

MOBILE_KEYS = mobile_referenced_keys()


def rendered_on_mobile(part: str) -> bool:
    """脚本可以用**子串**定位（`"任务已移动到" in label` 对上的就是「任务已移动到「{quadrant}」」），
    所以"这条字面量不是完整词条"本身不构成缺陷 —— 先看移动端读走的键里有没有包含它的值。"""
    return any(part in ZH_TABLE[key] for key in MOBILE_KEYS if key in ZH_TABLE)


def is_mobile(script: Path) -> bool:
    name = script.name
    return ("android" in name or "ios" in name) and "web" not in name


def check(script: Path) -> list[str]:
    tree = ast.parse(script.read_text(encoding="utf-8"))
    problems: list[str] = []
    fstring_parts: set[str] = set()
    literals: set[str] = set()
    groups: list[list[str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            literals.add(node.value)
        elif isinstance(node, ast.Tuple):
            groups.append([e.value for e in node.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)])
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):  # f-string 的片段是模板，不是界面标签
            fstring_parts.update(v.value for v in node.values if isinstance(v, ast.Constant) and isinstance(v.value, str))

    for value in sorted(literals):
        if not CJK.search(value) or "\n" in value or value in fstring_parts:
            continue  # 多行的是 docstring/说明，不是界面标签
        # AX 会把「标签, 提示」拼成一条 label（脚本里 `("设置, 个人资料、偏好、同步与安全", …)`
        # 就是这种），所以整条对不上真源时先按 `", "` 拆开逐段查；`、` 是真源里的正文标点，不拆。
        if value not in ZH and (template_matches(value, ZH_TABLE) or rendered_on_mobile(value)):
            continue  # 占位符词条渲染出来的标签
        parts = [value] if value in ZH or ", " not in value else [p.strip() for p in value.split(", ") if p.strip()]
        for part in parts:
            if part not in ZH and (template_matches(part, ZH_TABLE) or reachable_on_mobile(part) or rendered_on_mobile(part)):
                continue
            if part not in ZH:
                problems.append(f"中文标签在词条真源里不存在：{part!r}（脚本字面量 {value!r}）")
            elif is_mobile(script) and all(k not in MOBILE_KEYS for k in ZH[part]):
                problems.append(
                    f"{part!r} 只挂在移动端从不读的键上（{', '.join(ZH[part])}）—— "
                    f"这一条在两种语态下都打不中"
                )

    for vals in groups:
        cjk = [v for v in vals if CJK.search(v)]
        latin = [v for v in vals if not CJK.search(v) and re.search(r"[A-Za-z]{3}", v)]
        for chinese in cjk:
            for english in latin:
                zh_keys, en_keys = ZH.get(chinese, []), EN.get(english, [])
                if not zh_keys or not en_keys:
                    continue  # 单独的候选/非文案字面量，由上面那一段负责报
                if set(zh_keys) & set(en_keys):
                    continue
                problems.append(
                    f"中英配对不对同一个键：{chinese!r} → {', '.join(zh_keys)}；"
                    f"{english!r} → {', '.join(en_keys)}"
                )
    return problems


def main(argv: list[str]) -> int:
    if not argv:
        print("用法：check-locator-labels.py <scripts/qa/某条旅程脚本> …", file=sys.stderr)
        return 2
    # 分母自检：解析器漏键不会报错，只会让"这个标签不存在"变成假红或"配对没问题"变成假绿。
    zh_total = sum(len(v) for v in ZH.values())
    en_total = sum(len(v) for v in EN.values())
    print(f"词条真源分母：zh {zh_total} 键 / en {en_total} 键 / 移动端读走的键 {len(MOBILE_KEYS)} 个")
    failed = False
    for name in argv:
        script = Path(name)
        problems = check(script)
        if problems:
            failed = True
            print(f"🔴 {script}")
            for problem in dict.fromkeys(problems):
                print(f"   {problem}")
        else:
            print(f"✅ {script}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
