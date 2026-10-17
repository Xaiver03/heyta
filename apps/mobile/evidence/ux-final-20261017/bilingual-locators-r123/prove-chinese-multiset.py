#!/usr/bin/env python3
"""代改条件②的现量：中文那一侧的字面**一枚没动、一枚没改**。

对 HEAD 那份与改后这份各抽**全部含中文的字符串字面量**（含 f-string 里的静态片段）
做多重集对账；丢一枚、多一枚、改一枚都非零退出。
"""
from __future__ import annotations

import ast
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

CJK = re.compile(r"[一-鿿]")


def chinese_literals(src: str) -> Counter[str]:
    tree = ast.parse(src)
    out: Counter[str] = Counter()
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if CJK.search(node.value):
                out[node.value] += 1
        elif isinstance(node, ast.JoinedStr):
            static = "".join(
                v.value for v in node.values if isinstance(v, ast.Constant) and isinstance(v.value, str)
            )
            if CJK.search(static):
                out[static] += 1
    return out


def main(target: str) -> int:
    head = subprocess.run(
        ["git", "show", f"HEAD:{target}"], capture_output=True, text=True, check=True
    ).stdout
    now = Path(target).read_text(encoding="utf-8")
    a, b = chinese_literals(head), chinese_literals(now)
    lost = a - b
    added = b - a
    print(f"HEAD 含中文面 {sum(a.values())} 枚（去重 {len(a)}）/ 改后 {sum(b.values())} 枚（去重 {len(b)}）")
    print(f"丢失 = {dict(lost) or '{}'}")
    print(f"新增 = {dict(added) or '{}'}")
    if lost or added:
        print("VERDICT: 中文那一侧变了 ⇒ 代改条件②不成立")
        return 1
    print("VERDICT: 中文那一侧逐字相同（英文为纯增）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
