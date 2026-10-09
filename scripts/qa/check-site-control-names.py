#!/usr/bin/env python3
"""帮助页/文档页里"让用户去点"的那个名字，必须逐字等于词条真源里的某个值。

失效形状（2026-10-09 实测抓到的三对）：界面上那颗按钮叫「更换登录邮箱」
（`common.emailChange.title`），而 `site.docs.account.s6p1` 与 `site.help.a.rebind`
写的是点「换绑邮箱」；按钮叫「忘记密码？」，帮助页写「忘记密码」；英文侧
`common.sessions.revoke` = "Sign out this device"，帮助页写 "Sign this device out"。
**界面改了、说明没跟着改，而两层都没有任何一层会失败** —— 用户照着说明找不到那个按钮，
读出来的是"这功能没做"。这正是 AGENTS §5「零硬编码文案」的另一半：不写进代码不等于
不会漂，抄进**说明文**里一样会漂。

抽取规则（只用能确定的形状，不猜）：
1. 中文：`点/按/走/用/进入/打开/在/见/前往` 之后紧跟的 `「X」`；以及加粗段以 `「X」` 开头。
2. 英文：`press/click/tap/choose/select/use/open/in/under/see/with/go to` 之后紧跟的 `"X"` 或 `“X”`；
   以及加粗段以其中一副引号开头。

载体（`SCOPE_PREFIXES`）= 帮助页/文档页里本线那几页，**加上服务端的全部对外文案**（`server.*`：
三封安全通知信 + 三张凭据页）。加服务端那一档是因为实测到的四处错名里，有两封是
"这不是你本人操作 ⇒ 去点忘记密码"那种**给可能被盗号的人看的信**，
而它写的名字界面上不存在。

分母 = **同语种整张词条表的所有值**（含 `site.*`，因为文档也会指另一篇文档的标题）。
判据问的是"这个名字在唯一文案事实源里存在吗"，不是"它是不是按钮"。

🔴 射程边界（不许读成"整站都验了"）：只查 `SCOPE` 里列出的那几页 + `server.*`
（账号 / 口令 / 通行密钥 / 会话 / 找回那几条旅程，以及服务端的信与凭据页）。整站普查另有 16 处
引号段落在**别的线**的页面里（重复任务、导出、迁移、视图、自托管、集成说明），其中多数指的是
文档站自己的导航标题，而那些标题住在 `apps/landing/src/site/pages.ts`、不在词条表里 ——
要把它们一起钉住，得先给那道门禁加第二个分母。两条候选规则（近似名档 / 动词表扩进法务散文）
都在纯 HEAD 上实测过并被否证，逐条读数见 `docs/plans/account-standard-suite.md` §6.22。

用法：
    python3 scripts/qa/check-site-control-names.py            # 真表
    python3 scripts/qa/check-site-control-names.py --self-test # 六臂，证明它能红

非零退出 = 有名字对不上真源，或有条豁免已经用不上了。
"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

# 解析器不重写第二份：`check-locator-labels.py` 已经负责从 .ts 源码里读键值
# （两种引号形状都收），同一个判断抄两遍就是从那里开始漂的。
_spec = importlib.util.spec_from_file_location(
    "locator_labels", REPO / "scripts/qa/check-locator-labels.py"
)
_locator = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_locator)
template_matches = _locator.template_matches
entry_to_pattern = _locator.entry_to_pattern

SCOPE_PREFIXES = ("site.docs.account.", "site.docs.loss.", "site.docs.passphrase.", "server.")
SCOPE_EXACT = {
    "site.help.a.rebind",
    "site.help.a.sessions",
    "site.help.a.passkey",
    "site.help.q.rebind",
    "site.help.q.sessions",
    "site.help.q.passkey",
}

ZH_PATTERNS = (
    re.compile(r"(?:点|按|走|用|进入|打开|在|见)\s*「([^「」]+?)」"),
    re.compile(r"\*\*「([^「」]+?)」"),
)
EN_PATTERNS = (
    # 🔴 英文文案里的"引号"有**两副**：站点帮助页用直引号 `"X"`，而服务端的信模板用排版弯引号 `“X”`
    # （`server.email.changed.notYou` 实测是后者）。只认直引号那一副时，这两封安全通知信里的
    # 错名**一根都扫不到** —— 症状不是报错，而是"这条判据绿"。
    re.compile(r"(?:press|click|tap|choose|select|use|open|in|under|see|with|go to)\s+[\"“]([^\"”]+?)[\"”]", re.I),
    re.compile(r"\*\*[\"“]([^\"”]+?)[\"”]"),
)

# 例外要带理由，而且**用不上就是错** —— 一张只进不出的豁免表会和它要挡的漂移一起烂掉。
EXEMPT: dict[tuple[str, str, str], str] = {
    # ("zh", "site.docs.xxx", "「某名字」") 形式的条目一律要写清为什么界面里就是没有它。
}


def in_scope(key: str) -> bool:
    return key.startswith(SCOPE_PREFIXES) or key in SCOPE_EXACT


def quoted_names(table: dict[str, str], patterns: tuple[re.Pattern[str], ...]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for key, value in table.items():
        if not in_scope(key) or not value:
            continue
        for pattern in patterns:
            for match in pattern.finditer(value):
                out.append((key, match.group(1)))
    return out


def check(zh: dict[str, str], en: dict[str, str]) -> tuple[list[str], int, int]:
    problems: list[str] = []
    used: set[tuple[str, str, str]] = set()
    total = 0
    for locale, table, patterns in (("zh", zh, ZH_PATTERNS), ("en", en, EN_PATTERNS)):
        values = {v for v in table.values() if v}
        for key, name in quoted_names(table, patterns):
            total += 1
            if name in values or template_matches(name, table):
                continue
            tag = (locale, key, name)
            if tag in EXEMPT:
                used.add(tag)
                continue
            problems.append(f"{locale} · {key} 里的 {name!r} 不是词条真源里的任何值")
    unused = sorted(set(EXEMPT) - used)
    for locale, key, name in unused:
        problems.append(f"{locale} · {key} 的豁免 {name!r} 已经用不上了 —— 拿掉它")
    return problems, total, len(used)


def self_test() -> int:
    """六臂。每臂都要能把它那一侧的断言打红或打绿，否则这道门禁只是装饰。"""
    zh = {"site.docs.account.s9p1": "设置页里点「更换登录邮箱」。", "common.emailChange.title": "更换登录邮箱"}
    en = {"site.docs.account.s9p1": 'Press "Change sign-in email".', "common.emailChange.title": "Change sign-in email"}
    arms: list[tuple[str, bool]] = []

    arms.append(("① 真名字两侧都不报", not check(zh, en)[0]))

    bad_zh = dict(zh)
    bad_zh["site.docs.account.s9p1"] = "设置页里点「根本不存在的那个按钮」。"
    arms.append(("② 中文假名字会红", bool(check(bad_zh, en)[0])))

    bad_en = dict(en)
    bad_en["site.docs.account.s9p1"] = 'Press "Change the thing that does not exist".'
    arms.append(("③ 英文假名字会红", bool(check(zh, bad_en)[0])))

    exempted = {("zh", "site.docs.account.s9p1", "根本不存在的那个按钮"): "写一条理由才能豁免"}
    saved = dict(EXEMPT)
    try:
        EXEMPT.clear()
        EXEMPT.update(exempted)
        arms.append(("④ 带理由的豁免确实放行", not check(bad_zh, en)[0]))
        EXEMPT.clear()
        EXEMPT.update({("zh", "site.docs.account.s9p1", "没人引用的旧名字"): "过期条目"})
        arms.append(("⑤ 用不上的豁免自己会红", bool(check(zh, en)[0])))
    finally:
        EXEMPT.clear()
        EXEMPT.update(saved)

    # ⑥ 这条洞是**承重**的：整条值就是一个占位符的词条如果参与通配，任何字符串都算"合法渲染"。
    bare = {"web.search.count": "{count}"}
    arms.append((
        "⑥ 光占位符词条通配不了一切",
        entry_to_pattern("{count}") is None and not template_matches("换绑邮箱", bare),
    ))

    failed = [label for label, ok in arms if not ok]
    print(f"自测 {len(arms)} 臂：{'全绿' if not failed else '🔴 ' + '；'.join(failed)}")
    return 1 if failed else 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
    zh, en = _locator.ZH_TABLE, _locator.EN_TABLE
    scoped = [k for k in zh if in_scope(k)]
    if not scoped:
        # 键被改名/整页挪走时，这道检查会静默变成"什么都不查"。那一格必须响亮地红。
        print("🔴 射程内一条 site 键都没匹配上 ——  SCOPE 已经和真源脱节", file=sys.stderr)
        return 1
    problems, total, used = check(zh, en)
    print(f"分母：射程内 site 键 {len(scoped)} 枚 / 抽出的引号名 {total} 段 / 命中豁免 {used} 条")
    if problems:
        for problem in problems:
            print(f"🔴 {problem}")
        return 1
    print("✅ 帮助页里让用户去点的名字，逐条对得上词条真源")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
