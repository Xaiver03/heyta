#!/usr/bin/env python3
"""`$var` 紧跟非 ASCII 的**独立**扫描 —— 与门禁 `scripts/check-shell-unicode-vars.mjs` 并存，不替代它。

为什么存在（2026-10-04 02:5x 现量）：那道门禁自己有假阴性 —— 单引号串里出现双引号时它的引号状态机翻面，
此后**同一文件内**的同类命中全部静默。当时两本账是：门禁 = 1 枚文件 / 6 行，本扫描 = 4 枚文件 / 15 行。
一条只会说"没问题"的门禁拦不住任何东西（AGENTS §8.3），所以留一把口径不同的尺：
本扫描**不做词法状态机**，按行正则匹配，因此它在字符串里的 `"$rc）"` 也算命中 —— 两侧都看，才分得清
"这行真没事"与"解析器没看到这一行"。

用法：
  python3 research/tools/shell-unicode-independent-scan.py            # 只打印
  python3 research/tools/shell-unicode-independent-scan.py --strict    # 有命中就 exit 1（默认不判，见下）

⚠️ 默认**不**非零退出：这不是门禁，是取证尺。真红的四处里三处不归本线，把它们变成每次 push 都红的门禁
    等于造一条天生红的检查 —— 要接进 `pnpm check`，必须先与那三处的修法同一笔落地。
"""
from __future__ import annotations

import os
import re
import sys

OFFENDER = re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]")  # 打印要带上那个非 ASCII 字符，否则读数看着不像同一族
SKIP_DIRS = {"node_modules", ".git", ".worktrees", "dist", "build", ".pnpm-store", "release"}


def scan(root: str) -> list[tuple[str, int, str]]:
    hits: list[tuple[str, int, str]] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if not name.endswith(".sh"):
                continue
            path = os.path.join(dirpath, name)
            try:
                lines = open(path, encoding="utf-8").read().split("\n")
            except (OSError, UnicodeDecodeError):
                continue
            for n, line in enumerate(lines, 1):
                m = OFFENDER.search(line)
                if m:
                    hits.append((path, n, m.group(0)))
    return hits


def count_shell(root: str) -> int:
    total = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        total += sum(1 for f in filenames if f.endswith(".sh"))
    return total


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    strict = "--strict" in sys.argv[1:]
    files = count_shell(root)
    hits = scan(root)
    by_file: dict[str, list[tuple[int, str]]] = {}
    for path, n, tok in hits:
        by_file.setdefault(os.path.relpath(path, root), []).append((n, tok))
    print(f"独立扫描：{files} 个 .sh / {len(by_file)} 枚文件有命中 / 命中行合计 {len(hits)}")
    for path in sorted(by_file, key=lambda p: -len(by_file[p])):
        print(f"   {path} = {len(by_file[path])} 处")
        for n, tok in by_file[path][:6]:
            print(f"      :{n}  {tok}")
        if len(by_file[path]) > 6:
            print(f"      …还有 {len(by_file[path]) - 6} 处")
    if not hits:
        print("   （无命中 —— 这只证明**本扫描的口径**下没有，不证明运行环境是 UTF-8）")
    return 1 if (strict and hits) else 0


if __name__ == "__main__":
    sys.exit(main())
