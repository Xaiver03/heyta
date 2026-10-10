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
    python3 scripts/qa/check-locator-labels.py --print-floors   # 打印**已登记**的基线（现量看正常运行那栏「含中文 N」）

非零退出 = 有标签对不上真源、**或**某处 `T(中, 英)` 只写了一种语态、**或**量具看不见这枚脚本的标签。
查的是**字面量与键的对应关系**，不验旅程本身是否跑通。

🔴 四条判据各自的"能红"形状（都做过变异验证）：
1. 配对不对同一个键 ⇒ 红；
2. 用了 `T(...)` 这个形状就是**声称**双语可定位，任何一处只写一种语态 ⇒ 红
   （原来这条只写在文件头，实现里两语态齐时才有输入 —— 也就是说"只写一种语态"以前**永远不会红**）；
3. 反盲：每枚脚本在 `CJK_GROUP_FLOOR` 里有一组**含中文定位标签组数**的基线，只许降不许升；
   标签换写法（例如 `T(` 改名）会让组数掉到 0 ⇒ 红。没登记基线的新脚本也红 —— 那条成本是刻意的。
4. `T(中, 英)` 的**英文那一侧必须是 `en.ts` 里真实存在的词值** ⇒ 红。
   补这条的原因：判据一在 `if not zh_keys or not en_keys: continue` 那一支对"取不到键"是放行的，
   所以一枚拼错的、真源里根本没有的英文**两侧都不报**（2026-10-10 用变异臂实测：`T("任务","Taks")` 当时 rc=0）。
   ⇒ 这一条只保证"这个词在真源里存在"，**不保证那一屏当时渲染的就是它** —— 后者只能在设备上读到。
另有一行**披露不判红**：`tap_label("我的")` 这类单语定位的条数（那是该脚本负责人的欠项，
不该由这枚门把共享的 `pnpm check` 按红）。还有**第二行披露**：候选**成组**写、组内却整片单语
（`tap(name, ("常规","同步与隐私"), …)` 这种 iOS 旅程脚本的常见形状）—— 第一行抓不到它，因为
`single_language` 只收"不在任何组里"的字面量，而判据二只看 `T(...)` 那种写法。
🔴 **第二维数的是形状，不是欠项**：同一个形状在定位位／`then`+`absent` 断言位／分支条件位上失效方式不同
（断言位的单语按脚本自己的注释是刻意的，分支条件位最坏 —— 它走错岔路而不是超时），要逐条分诊。
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
# 🔴 **反盲判据的基线：每枚脚本"量具读得到的含中文定位标签组数"。只许降不许升** ——
# 调高要连着改脚本；往下掉就是这一格红。
# 为什么不写成"0 组就红"那种一刀切：`tap_label("我的")` 这种**单语**写法今天确实存在于别的线的脚本里，
# 那是**该线自己的欠项**（在计划里登记、由这枚门披露），不该由它把共享的 `pnpm check` 按红；
# 但"量具突然看不见标签了"是**门自己的病**，必须红 —— 两件事用两把不同的尺分开。
# 取现量：走**正常那次运行**里每枚脚本的「含中文 N」那一栏。
# ⚠️ `--print-floors` 打印的是**已登记的基线本身**（它读的就是这张表），不是现量 ——
# 拿它"重取基线"会把旧值抄回去，于是这一格从此不会变。实测：同一枚脚本正常运行读到 14、`--print-floors` 报 0。
CJK_GROUP_FLOOR = {
    "profile-settings-android.py": 56,
    "profile-settings-ios.py": 44,
    "tasks-ux-android.py": 2,
    "tasks-ux-ios.py": 42,
    "ai-assistant-atomic-android.py": 14,
}
# TS 源码不是 Python，不能用 ast 扫；这里抓所有引号里的"像键名"的串，再和真源的键集合取交集。
ANY_QUOTED = re.compile(r"""['"]([A-Za-z0-9_.-]{3,})['"]""")


def load(locale: str) -> dict[str, str]:
    source = (REPO / "packages/i18n/src/locales" / locale).read_text(encoding="utf-8")
    rows = ENTRY_RE.findall(source)
    return {k1 or k2: (v1 or v2) for k1, k2, v1, v2 in rows}


PLACEHOLDER = re.compile(r"\{[A-Za-z0-9_.]+\}")


def entry_to_pattern(entry: str) -> str | None:
    """词条里的 `{count}` 这类占位符 → 通配。手工切段再逐段 escape，
    不用 `re.sub(re.escape(...))` —— 那种写法在转义后的空格/大括号上会静默配不中。

    🔴 **整条值就是光一个占位符**的词条（`web.search.count` =「{count}」、`common.date.yearTitle`
    =「{year}」、`mobile.recurrence.yearDay.n` =「{n}」…）返回 `None`，**不参与通配**：
    它拼出来是 `^.+$`，任何字符串都算"合法渲染结果"。这种通配条目不会报错，只会让
    每一处调用**无声地放行一切** —— 而"这个标签在真源里不存在"正是这道检查唯一在回答的问题。
    实测 6 枚（en 侧），把它们算进来时 `site.*` 里每一个引号段都能"配对成功"。
    """
    out: list[str] = []
    pos = 0
    for match in PLACEHOLDER.finditer(entry):
        out.append(re.escape(entry[pos:match.start()]))
        out.append(r".+")
        pos = match.end()
    out.append(re.escape(entry[pos:]))
    pattern = "".join(out)
    if r"\A" not in pattern and re.fullmatch(r"(?:\.\+)+", pattern):
        return None
    return "^" + pattern + "$"


def template_matches(value: str, table: dict[str, str]) -> list[str]:
    """`已选 2 项` 这类是词条带占位符渲染出来的（`web.shell.bulk.selected` =「已选 {count} 项」），
    不是"真源里没有"。按占位符通配回去，命中就当作合法渲染结果。
    ⚠️ 收的是 **键→值** 那张表：传反了（值→键）不会报错，只会永远配不中，于是每个插值标签都变假红。"""
    hits: list[str] = []
    for key, entry in table.items():
        if "{" not in entry:
            continue
        pattern = entry_to_pattern(entry)
        if pattern is None:
            continue
        if re.fullmatch(pattern, value):
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


def check(script: Path) -> tuple[list[str], dict[str, int]]:
    empty = {"组数": 0, "含中文组数": 0, "T()调用": 0, "单语标签": 0, "单语候选组": 0}
    source = script.read_text(encoding="utf-8")
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        # 传进来一枚非 Python 的脚本（或语法坏掉的）时，**不许 traceback**：
        # 那会被读成"门坏了"而不是"这一枚脚本量具吃不下"，下一个人就直接把它从清单里删了。
        return [f"量具解析不了这枚脚本（只吃 Python 旅程脚本）：{error}"], empty
    problems: list[str] = []
    fstring_parts: set[str] = set()
    literals: set[str] = set()
    groups: list[list[str]] = []
    t_groups: list[list[str]] = []
    bilingual_calls = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            literals.add(node.value)
        elif isinstance(node, ast.Tuple):
            groups.append([e.value for e in node.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)])
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "T":
            # `T('我的','Profile')` 是中英同义定位的另一种写法（Android 那条旅程脚本 2026-10-09 改成这个形状）。
            # 只认 `ast.Tuple` 的量具对它**一组都读不到** —— 那行 "✅ 这个脚本没问题" 其实是
            # "这个脚本我一个字都没看见"。⇒ `T(...)` 的字符串实参也算一组。
            vals = [a.value for a in node.args if isinstance(a, ast.Constant) and isinstance(a.value, str)]
            if vals:
                groups.append(vals)
                t_groups.append(vals)
                bilingual_calls += 1
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

    # 判据二：文件头那条"只写一种语态"的失效模式，原来**没人兑现**（配对检查在两语态齐时才有输入）。
    # 用了 `T(中, 英)` 这个形状就是**声称**这条脚本双语可定位 ⇒ 每一处都必须两种语态齐。
    for vals in t_groups:
        has_cjk = any(CJK.search(v) for v in vals)
        has_latin = any(not CJK.search(v) and re.search(r"[A-Za-z]{3}", v) for v in vals)
        if has_cjk and not has_latin:
            problems.append(f"`T(...)` 只写了中文、没有英文同义定位：{vals!r}（设备换系统语言就整条走不到被测判据）")
        elif has_latin and not has_cjk:
            problems.append(f"`T(...)` 只写了英文、没有中文同义定位：{vals!r}")

    # 判据二之补（英文那一侧的牙）：上面判据一只在"两侧都能在真源里取到键"时才做交叉 ——
    # `if not zh_keys or not en_keys: continue` 意味着**英文拼错/真源里没这个词**时两边都不报。
    # `T(中, 英)` 这个形状声称的是"同一枚标签的两种语态"，那英文那一侧也必须真的在词条表里。
    for vals in t_groups:
        for value in vals:
            if CJK.search(value) or not re.search(r"[A-Za-z]{3}", value):
                continue
            if value in EN or template_matches(value, EN_TABLE):
                continue
            problems.append(
                f"`T(...)` 的英文同义不在 en.ts 的词值里：{value!r}（配对判据读不到它的键，"
                "所以它既不会报混键、也不会报拼写 —— 这一枚英文此刻没有任何东西在守）"
            )

    # 反盲判据：量具**看不见标签**时不许静默返回"没问题"。按**含中文的那一组**数，不是按总组数 ——
    # `T(` 换成 `L(` 之后元组组还在（那些是 resource-id 一类），只看"组数为 0"会照样静默放行。
    cjk_groups = sum(1 for vals in groups if any(CJK.search(v) for v in vals))
    # 🔴 披露的**第二个维度**（原来这一格是空的）：候选**成组**写、但组里只有中文。
    # 这类整片单语定位在旧尺下两条都不命中 —— `single_language` 只收"**不在任何组里**"的中文字面量，
    # 判据二只看 `T(...)` 那种写法 —— 于是 `tap(name, ("常规","同步与隐私","数据管理"), …)` 这种
    # iOS 旅程脚本的常见形状会静默 ✅，而它在英文系统语言下一枚都点不到。
    mono_groups = sum(
        1
        for vals in groups
        if any(CJK.search(v) for v in vals)
        and not any(not CJK.search(v) and re.search(r"[A-Za-z]{3}", v) for v in vals)
    )
    label_like = [v for v in literals if CJK.search(v) and "\n" not in v]
    grouped = {v for vals in groups for v in vals}
    single_language = sorted(
        {
            a.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            for a in [*node.args, *(k.value for k in node.keywords)]
            if isinstance(a, ast.Constant)
            and isinstance(a.value, str)
            and CJK.search(a.value)
            and "\n" not in a.value
            and a.value not in grouped
        }
    )
    floor = CJK_GROUP_FLOOR.get(script.name)
    if floor is None:
        problems.append(
            f"「{script.name}」没在 CJK_GROUP_FLOOR 里登记基线（量具当前读到 {cjk_groups} 组含中文定位标签）"
            "⇒ 新脚本要**显式**登记它的组数，哪怕是 0：这条成本是刻意的，"
            "否则「以后多加一枚脚本」会让反盲判据静默失效"
        )
    elif cjk_groups < floor:
        example = sorted(label_like)[0] if label_like else "(无中文字面量)"
        problems.append(
            f"量具读到的含中文定位标签组数从基线 {floor} 掉到 {cjk_groups} ⇒ "
            f"要么标签换了写法（量具看不见它了），要么中英同义定位被删了。这不是「这个脚本没问题」。例：{example!r}"
        )
    return problems, {
        "组数": len(groups),
        "含中文组数": cjk_groups,
        "T()调用": bilingual_calls,
        "单语标签": len(single_language),
        "单语候选组": mono_groups,
    }


def main(argv: list[str]) -> int:
    if argv == ["--print-floors"]:
        for name, value in sorted(CJK_GROUP_FLOOR.items()):
            print(f'    "{name}": {value},')
        return 0
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
        problems, stats = check(script)
        readout = (
            f"读到 {stats['组数']} 组（含中文 {stats['含中文组数']}、"
            f"T() 同义定位 {stats['T()调用']} 处）"
        )
        if problems:
            failed = True
            print(f"🔴 {script}  {readout}")
            for problem in dict.fromkeys(problems):
                print(f"   {problem}")
        else:
            print(f"✅ {script}  {readout}")
        if stats["单语标签"]:
            print(
                f"   ⚠️ 披露（**不判红**）：{stats['单语标签']} 条定位标签只写了一种语态 —— "
                "设备换系统语言时这些点不到；归该脚本的负责人，欠项记在计划里"
            )
        # 这一行是**新增的第二维**，措辞与上面那行分开，好让旧读数在台账里仍然逐字对得上。
        if stats["单语候选组"]:
            print(
                f"   ⚠️ 披露（**不判红**）：{stats['单语候选组']} 组候选整片只有一种语态（成组写却组内无英文同义）—— "
                "旧尺看不见它，因为 `single_language` 只收不在任何组里的字面量。"
                "**这一维数的是形状，不是欠项**：同一个形状有三种用途，失效方式各不相同 —— 定位位是"
                "英文下点不到；`then`/`absent` 位的单语按脚本自己的注释是**刻意**（防语言不对冒充通过）；"
                "分支条件位最坏，它不超时而是**走错岔路**。逐条分诊才知道哪几处是欠项"
            )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
