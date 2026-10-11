#!/usr/bin/env python3
"""把任务书里那句「执行者不许自己把 AC 勾上」从一句**散文**变成一枚**能红的尺**。

为什么要它：任务书给的判卷句子是 `grep -c '^- \\[x\\] \\*\\*AC-' docs/plans/inbound-automation.md` 必须仍是 0。
2026-10-11 实测：台账里有两处把它抄成了不带反斜杠的 `'^- [x] \\*\\*AC-'` —— 未转义时 `[x]` 在 BRE 里是
**字符类**（匹配单个字母 x），匹配不上字面量 `[x]` 那三个字符，于是**真把格子勾上，那句现量照样报 0**。
也就是说"防作弊的尺"自己可以是瞎的，而它印在文档里的样子比"没有尺"更让人安心。
本装置把判定收进 Python 的正则（不经 shell 引号），并把它自己的瞎法做成一臂（臂 5）。

四条规矩（任一不成立就不许报"已勾 0"）：
  R1 分母非空：未勾的 AC 行必须 > 0。空集给的"已勾=0"是最安静的一枚假绿。
  R2 已勾必须为 0：一旦有人（包括执行者自己）勾了，**响亮地红并逐枚点名**是哪一条 AC。
  R3 每一行 AC 勾选都要被分类：`已勾 + 未勾` 必须等于"状态位是任意单字符"的 AC 行数。
     挡的是形状漂了（例如被改成 `[X]` / `[-]`）—— 那种行两把尺都数不到，于是"已勾=0"照旧成立。
  R4 AC 编号必须连续且唯一（1..n），否则分母本身被人动过。

自测五臂（两个方向都要有，只测能红会把判据写成永远红）：
  臂 1 静止对照：真文档 ⇒ rc=0；
  臂 2 注入"勾了一枚"：副本里把一枚 `[ ]` 改成 `[x]` ⇒ 必须 rc=1，且要点名那一枚的 AC 编号；
  臂 3 注入"分母空"：喂一份没有 AC 行的文档 ⇒ 必须 rc=2（拒绝，不许报"已勾 0"）；
  臂 4 注入"形状漂了"：把一枚改成 `[X]`（大写）⇒ 必须 rc=2 并点名未分类的那一行（R3 的存在理由）；
  臂 5 反证"写法差两个反斜杠就瞎"：拿臂 2 那份**已改勾**的副本，用文档里那句未转义的
       `grep -c '^- [x] \\*\\*AC-'` 数一遍 ⇒ 它必须报 0（即那枚永远绿的尺）。
       这一臂不许反过来"修成能数到"—— 它测的是**旧写法**的失明，不是本装置的。
退出码：0 成立 / 1 有人勾了 AC / 2 装置前置不成立（文件读不到、分母为空、状态位未分类、编号不连续）。
臂数由 `self_test()` 自己在末尾打印，文档里不抄第二份（仓规）。
"""
import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_DOC = 'docs/plans/inbound-automation.md'
CHECKED = re.compile(r'^- \[x\] \*\*AC-(\d+)\b')
UNCHECKED = re.compile(r'^- \[ \] \*\*AC-(\d+)\b')
ANY_STATE = re.compile(r'^- \[(.)\] \*\*AC-(\d+)\b')
# 臂 5 用的那枚**故意错**的写法：方括号未转义 ⇒ BRE 里是字符类 ⇒ 永远数不到。
NAIVE_GREY = r'^- [x] \*\*AC-'


def read_doc(path: str) -> list[str]:
    try:
        return Path(path).read_text(encoding='utf-8').splitlines()
    except OSError as exc:
        print(f'REFUSE: 读不到 `{path}`（{exc}）')
        return []


def report(path: str) -> int:
    lines = read_doc(path)
    if not lines:
        return 2
    checked = [m.group(1) for m in (CHECKED.match(l) for l in lines) if m]
    unchecked = [m.group(1) for m in (UNCHECKED.match(l) for l in lines) if m]
    any_state = [(m.group(1), m.group(2)) for m in (ANY_STATE.match(l) for l in lines) if m]
    unclassified = [(st, num) for st, num in any_state if st not in ('x', ' ')]
    print(f'文档 `{path}`　AC 行={len(any_state)}　已勾={len(checked)}　未勾={len(unchecked)}　状态位未分类={len(unclassified)}')
    if not unchecked and not checked:
        print('REFUSE: 一份 AC 勾选行都没枚举到 —— 空分母不许报"已勾 0"（R1）')
        return 2
    if len(checked) + len(unchecked) != len(any_state):
        print(f'REFUSE: {len(any_state) - len(checked) - len(unchecked)} 行状态位不是 `x` 也不是空格 ⇒ '
              f"两把尺都数不到它，'已勾=0' 会是假话（R3）")
        for st, num in unclassified:
            print(f'  UNCLASSIFIED AC-{num} 状态位 {st!r}')
        return 2
    nums = sorted(int(n) for n in checked + unchecked)
    if nums != list(range(1, len(nums) + 1)):
        print(f'REFUSE: AC 编号不连续或不唯一（读到 {nums}）（R4）')
        return 2
    for n in checked:
        print(f'  🔴 已勾：AC-{n}')
    if checked:
        print(f'结论：有 {len(checked)} 枚 AC 被勾上 —— 执行者不许自己勾（R2 红）')
        return 1
    print(f'结论：已勾=0、未勾={len(unchecked)}，且 {len(any_state)} 行全部落入两把尺之一（成立）')
    return 0


def self_test() -> int:
    src = Path(DEFAULT_DOC).read_text(encoding='utf-8')
    failed: list[str] = []
    arms = 0

    with tempfile.TemporaryDirectory(prefix='heyta-inb-ac-ticks-') as d:
        d = Path(d)
        base = d / 'base.md'
        base.write_text(src, encoding='utf-8')

        # 臂 1 静止对照
        arms += 1
        rc1 = report(str(base))
        ok = rc1 == 0
        print(f'臂 1 静止对照 ⇒ rc={rc1}（要求 0）：' + ('成立' if ok else '不成立'))
        if not ok:
            failed.append('臂 1')

        # 臂 2 注入"勾了一枚"
        arms += 1
        hit = re.search(r'^- \[ \] \*\*AC-(\d+)', src, re.MULTILINE)
        mutated = src.replace(f'- [ ] **AC-{hit.group(1)}', f'- [x] **AC-{hit.group(1)}', 1)
        assert mutated != src, '注入没生效'
        mut = d / 'mut-checked.md'
        mut.write_text(mutated, encoding='utf-8')
        import io
        from contextlib import redirect_stdout
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc2 = report(str(mut))
        named = f'AC-{hit.group(1)}' in buf.getvalue()
        ok = rc2 == 1 and named
        print(f'臂 2 注入勾（AC-{hit.group(1)}）⇒ rc={rc2}（要求 1）、点名={named}：' + ('成立' if ok else '不成立'))
        if not ok:
            failed.append('臂 2')

        # 臂 3 注入"分母空"
        arms += 1
        empty = d / 'empty.md'
        empty.write_text('# 没有 AC 行的文档\n\n- [ ] **不是 AC**\n', encoding='utf-8')
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc3 = report(str(empty))
        ok = rc3 == 2
        print(f'臂 3 空分母 ⇒ rc={rc3}（要求 2）：' + ('成立' if ok else '不成立'))
        if not ok:
            failed.append('臂 3')

        # 臂 4 注入"形状漂了"（大写 X：两把尺都数不到）
        arms += 1
        drifted = src.replace(f'- [ ] **AC-{hit.group(1)}', f'- [X] **AC-{hit.group(1)}', 1)
        drift = d / 'drift.md'
        drift.write_text(drifted, encoding='utf-8')
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc4 = report(str(drift))
        named4 = f'AC-{hit.group(1)}' in buf.getvalue()
        ok = rc4 == 2 and named4
        print(f'臂 4 状态位漂成大写（AC-{hit.group(1)}）⇒ rc={rc4}（要求 2）、点名={named4}：' + ('成立' if ok else '不成立'))
        if not ok:
            failed.append('臂 4')

        # 臂 5 反证文档里那句未转义写法是瞎的（它必须在那枚已改勾的副本上报 0）
        arms += 1
        naive = subprocess.run(['grep', '-c', NAIVE_GREY, str(mut)], capture_output=True, text=True)
        naive_count = (naive.stdout or '0').strip()
        escaped = subprocess.run(['grep', '-c', r'^- \[x\] \*\*AC-', str(mut)], capture_output=True, text=True)
        escaped_count = (escaped.stdout or '0').strip()
        ok = naive_count == '0' and escaped_count != '0'
        print(f'臂 5 同一份已改勾的副本：未转义写法数出 {naive_count}、转义写法数出 {escaped_count} ⇒ '
              + ('成立（未转义那枚确实永远绿，本装置的存在理由被复现）' if ok else '不成立'))
        if not ok:
            failed.append('臂 5')

    print(f'臂数={arms}，不成立={len(failed)}' + ("" if not failed else " → " + ", ".join(failed)))
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--doc', default=DEFAULT_DOC)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    return self_test() if args.self_test else report(args.doc)


if __name__ == '__main__':
    sys.exit(main())
