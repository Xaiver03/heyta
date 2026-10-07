#!/usr/bin/env python3
"""变异锚点替换：命中数必须**恰好为 1**，否则整条臂作废退出 4。

为什么不用 sed：这些锚点里同时有 `/ $ ( ) ! & " |`，转义层一多就会出现"替空了但没人说"
—— 那正是 §7 那一族"臂是 no-op，读数却被写成判据不能失败"。这里按**字面串**替换并断言命中数，
所以"锚点漂了"和"判据真的不能失败"这两种情况会被打印成不同的行。
"""
import sys

src, dst, old, new = sys.argv[1:5]
text = open(src, encoding="utf-8").read()
n = text.count(old)
if n != 1:
    print(f"ANCHOR=BAD hits={n} file={src}")
    print(f"  锚点前 60 字: {old[:60]!r}")
    sys.exit(4)
open(dst, "w", encoding="utf-8").write(text.replace(old, new, 1))
print(f"ANCHOR=OK hits=1 dst={dst}")
