# -*- coding: utf-8 -*-
"""从 packages/i18n 读取真实产品文案（唯一事实源）。
品牌物料上的标语、副标题一律走这里，不在脚本里手写。"""
import re, os

WD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(WD)
LOCALES = {
    "zh": os.path.join(ROOT, "packages/i18n/src/locales/zh-CN.ts"),
    "en": os.path.join(ROOT, "packages/i18n/src/locales/en.ts"),
}

_CACHE: dict[str, dict[str, str]] = {}

def _load(lang: str) -> dict[str, str]:
    if lang in _CACHE:
        return _CACHE[lang]
    src = open(LOCALES[lang], encoding="utf-8").read()
    table: dict[str, str] = {}
    # 形状：'landing.hero.titleLead': '今天该做什么，',
    for m in re.finditer(r"'([a-zA-Z0-9_.]+)'\s*:\s*'((?:[^'\\]|\\.)*)'\s*,", src):
        key = m.group(1)
        val = m.group(2).replace("\\'", "'").replace("\\\\", "\\")
        table[key] = val
    _CACHE[lang] = table
    return table

def t(key: str, lang: str = "zh", default: str | None = None) -> str:
    """取一条文案。**没有默认值兜底**：key 不存在就抛错，避免品牌物料带着编的内容发布。"""
    table = _load(lang)
    if key not in table:
        if default is not None:
            return default
        raise KeyError(f"i18n 里没有 {key}（{lang}）—— 品牌物料不许自己编文案")
    return table[key]

def hero(lang: str = "zh") -> dict[str, str]:
    """首页主标语的三段结构（lead + emphasis），与站点渲染一致。"""
    return {
        "lead": t("landing.hero.titleLead", lang),
        "emphasis": t("landing.hero.titleEmphasis", lang),
        "lede": t("landing.hero.lede", lang),
    }

def tagline_html(lang: str = "zh") -> str:
    """主标语拼成一行（lead + 强调段），供海报/卡片的 h1 使用。"""
    h = hero(lang)
    return h["lead"] + h["emphasis"]

if __name__ == "__main__":
    for lang in ("zh", "en"):
        h = hero(lang)
        print(f"[{lang}] {h['lead']}{h['emphasis']}")
        print(f"       lede: {h['lede'][:40]}…")
