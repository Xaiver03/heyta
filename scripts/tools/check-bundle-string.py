#!/usr/bin/env python3
"""
在**打包产物**里数一段文案出现的次数 —— 三种编码都数，并如实报出哪一种是有效的。

    python3 scripts/tools/check-bundle-string.py <产物> <字符串> [<字符串> ...]
    python3 scripts/tools/check-bundle-string.py --expect 1 <产物> <字符串>

🔴 为什么不能直接 `grep`

本仓库已经因为"用 grep 找中文"栽过两次，**两次的结论都是错的**：

1. **Metro 的 JS bundle**：非 ASCII 的**字符串值**被转义成 `\\uXXXX`，
   而**注释保留原始 UTF-8**。所以 `grep 中文` 命中的是注释，
   而你要找的值根本不在里面 —— 却"看起来找到了"。
   （新旧文案还是子串关系时，两个方向的 grep 都会命中。见 AGENTS.md §7 第 42 条。）

2. **Hermes 的 release 产物（iOS 的 `main.jsbundle`）**：非 ASCII 的字符串
   以 **UTF-16LE** 存在字节码的字符串表里，**UTF-8 里一个字节都搜不到**。
   实测 `mobile.profile.footnote` 的新值：
   ```
   utf-8     : 0 次     ← grep 会告诉你"没进产物"，而它进了
   utf-16-le : 1 次     ← 真相
   ```
   于是 `grep 不到` 会把你骗向**完全相反**的方向：不是"假绿"，是**假红**。

所以判据必须是"**逐种编码数一遍**"，而不是"某一种编码搜不到就算没有"。

用法示例（改完 i18n、重打产物之后自查）：

    # 新值必须 1 次、旧值必须 0 次 —— 两个方向都要数（第 42 条）
    python3 scripts/tools/check-bundle-string.py --expect 1 \\
        <产物> '<新文案>'
    python3 scripts/tools/check-bundle-string.py --expect 0 \\
        <产物> '<旧文案>'

退出码：所有待查字符串都满足 `--expect` 时为 0，否则 1（不给 `--expect` 时永远 0）。
"""

import argparse
import sys

ENCODINGS = (
    ("utf-8", "utf-8"),
    ("utf-16-le", "utf-16-le"),
    ("utf-16-be", "utf-16-be"),
)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("bundle", help="打包产物路径（.jsbundle / bundle.js / dist/*.js）")
    p.add_argument("needles", nargs="+", help="要数的字符串（可以给多个）")
    p.add_argument(
        "--expect",
        type=int,
        default=None,
        help="每个字符串期望出现的次数；给了就按它算退出码，不给只打印",
    )
    args = p.parse_args()

    with open(args.bundle, "rb") as fh:
        raw = fh.read()

    print(f"产物：{args.bundle}（{len(raw)} 字节）")
    failed = False
    for needle in args.needles:
        show = needle if len(needle) <= 40 else needle[:37] + "…"
        print(f"\n待查：{show}")
        counts = {}
        for name, enc in ENCODINGS:
            n = raw.count(needle.encode(enc))
            counts[name] = n
            print(f"  {name:<10} {n} 次")
        # 只要**任意一种**编码命中，就算它真的在产物里 —— 单看某一种会给出假红。
        total = max(counts.values())
        print(f"  → 判定：{total} 次（取各编码最大值）")
        if args.expect is not None:
            if total != args.expect:
                print(f"  ❌ 期望 {args.expect} 次，实际 {total} 次")
                failed = True
            else:
                print(f"  ✅ 与期望一致（{args.expect} 次）")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
