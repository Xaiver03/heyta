#!/usr/bin/env python3
"""逐条分诊单语定位：输出行号、所在调用、该枚中文标签在 i18n 真源里的键与英文词值。

口径跟着 scripts/qa/check-locator-labels.py（组 = 元组/列表里的相邻字符串；
单语 = 不在任何组里的中文字面量），但这里要的是**位置与用途**，不是计数。
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
CJK = re.compile(r"[\u4e00-\u9fff]")


def load_table(name: str) -> dict[str, str]:
    src = (ROOT / "packages/i18n/src/locales" / name).read_text(encoding="utf-8")
    out: dict[str, str] = {}
    for key, value in re.findall(r"'([^']+)':\s*'((?:[^'\\]|\\.)*)'", src):
        out[key] = value.replace("\\'", "'")
    for key, value in re.findall(r'"([^"]+)":\s*"((?:[^"\\]|\\.)*)"', src):
        out[key] = value.replace('\\"', '"')
    return out


ZH = load_table("zh-CN.ts")
EN = load_table("en.ts")
EN_BY_VALUE: dict[str, list[str]] = {}
for k, v in EN.items():
    EN_BY_VALUE.setdefault(v, []).append(k)
ZH_BY_VALUE: dict[str, list[str]] = {}
for k, v in ZH.items():
    ZH_BY_VALUE.setdefault(v, []).append(k)


def parts(node: ast.AST) -> list[ast.expr]:
    out: list[ast.expr] = []
    for child in ast.iter_child_nodes(node):
        if isinstance(child, (ast.Tuple, ast.List, ast.Set)):
            out.extend(child.elts)
        elif isinstance(child, ast.Call):
            out.append(child)
        else:
            out.append(child)
    return out


def main(path: Path) -> int:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    groups: list[list[tuple[int, str]]] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Tuple, ast.List, ast.Set)):
            continue
        vals = [
            (e.lineno, e.value)
            for e in node.elts
            if isinstance(e, ast.Constant) and isinstance(e.value, str) and "\n" not in e.value
        ]
        if len(vals) >= 1 and any(CJK.search(v) for _, v in vals):
            groups.append(vals)
    grouped = {v for vals in groups for _, v in vals}

    print(f"# {path.name}  组数={len(groups)}")
    print("\n## A. 单语定位（不在任何组里的中文字面量，按调用出现）")
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = ast.unparse(node.func)[:34]
        for a in parts(node):
            if isinstance(a, ast.Constant) and isinstance(a.value, str) and not isinstance(a, ast.keyword):
                pass
        for arg in [*node.args, *(k.value for k in node.keywords)]:
            if (
                isinstance(arg, ast.Constant)
                and isinstance(arg.value, str)
                and CJK.search(arg.value)
                and "\n" not in arg.value
                and arg.value not in grouped
            ):
                keys = ZH_BY_VALUE.get(arg.value, [])
                ens = sorted({EN[k] for k in keys if k in EN})
                role = "assert?" if any(
                    w in func + (node.keywords and ",".join(k.arg or "" for k in node.keywords) or "")
                    for w in ("then", "absent", "assert", "expect", "verify")
                ) else "locator/branch"
                print(
                    f"  :{arg.lineno:<4} {func:<34} kw={node.keywords and ','.join(k.arg or '?' for k in node.keywords) or '-':<12} "
                    f"{role:<14} {arg.value!r} keys={keys or '(不在 zh)'} en={ens or '(无)'}"
                )

    print("\n## B. 成组但组内无英文同义（逐组）")
    for vals in groups:
        if any(not CJK.search(v) and re.search(r"[A-Za-z]{3}", v) for _, v in vals):
            continue
        line = vals[0][0]
        texts = [v for _, v in vals]
        per = []
        for t in texts:
            keys = ZH_BY_VALUE.get(t, [])
            ens = sorted({EN[k] for k in keys if k in EN})
            per.append(f"{t!r}→{ens[0] if len(ens) == 1 else (ens or '∅')}")
        print(f"  :{line:<4} {' | '.join(per)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]).resolve()))
