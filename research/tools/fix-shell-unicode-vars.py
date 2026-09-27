#!/usr/bin/env python3
"""
修 `$var` 紧跟非 ASCII 字符导致的变量名被吞 —— 改成 `${var}`。

## 这个 bug 是真的，不是风格问题

bash 解析 `$name` 时，**会把紧跟其后的非 ASCII 字节算进变量名**：

    email="a@b.com"
    echo "A: $email（括号）"      # → A: ��括号）        ← 值丢了，变成乱码
    echo "B: ${email}（括号）"    # → B: a@b.com（括号）  ← 对的

开了 `set -u` 则直接：

    line 3: email�: unbound variable

🔴 **为什么它一直没被发现**：这些几乎全在 `echo` 的**消息**里。
没有 `set -u` 时退出码不受影响，于是脚本"照常通过"，只是**打印出来的证据是乱码**。
对一份"以实测输出为证据"的验收脚本来说，这比崩溃更糟 —— 崩溃你看得见，乱码你不看。

## 为什么不能无脑全局替换

`${var}` 与 `$var` 在**会展开**的地方完全等价，所以替换是安全的。
但**单引号里**和**带引号的 heredoc 里**不展开 —— 那里的 `$var` 是字面量，
改了会**改变要显示的文字**。所以必须先判断位置。

用法：
    python3 research/tools/fix-shell-unicode-vars.py            # 预演（默认）
    python3 research/tools/fix-shell-unicode-vars.py --write    # 真改
"""

import sys
from pathlib import Path

# ⚠️ 必须按**码点**判断，不能按字节：Python 解码之后，`（` 是 U+FF08 而不是 0xEF。
# 第一版写成 `set(range(0x80, 0x100))`，于是扫出 0 处 —— 而它「看起来没问题」。
def is_nonascii(c):
    return ord(c) > 0x7F


def is_name_start(c):
    return c.isascii() and (c.isalpha() or c == '_')


def is_name_char(c):
    return c.isascii() and (c.isalnum() or c == '_')


def fix_text(text):
    """返回 (新文本, 替换处数)。"""
    out = []
    i, n = 0, len(text)
    fixes = 0

    in_single = False
    in_double = False
    heredoc = None  # (delimiter, quoted)

    while i < n:
        ch = text[i]

        # 行首判断 heredoc 结束
        if heredoc is not None and not in_single and not in_double and ch == '\n':
            # 看下一行是不是 delimiter
            j = i + 1
            k = j
            while k < n and text[k] != '\n':
                k += 1
            if text[j:k].strip() == heredoc[0]:
                heredoc = None
            out.append(ch)
            i += 1
            continue

        if not in_double and not in_single and heredoc is None:
            # 检测 heredoc 开始： <<[-]['"]?DELIM
            if text.startswith('<<', i):
                j = i + 2
                quoted = False
                if j < n and text[j] == '-':
                    j += 1
                if j < n and text[j] in '\'"':
                    quoted = True
                    j += 1
                k = j
                while k < n and (is_name_char(text[k]) or text[k] == '_'):
                    k += 1
                if k > j:
                    delim = text[j:k]
                    heredoc = (delim, quoted)
                    out.append(text[i:k])
                    i = k
                    continue

        # heredoc 体内
        if heredoc is not None and not in_single:
            if heredoc[1]:  # 带引号 = 不展开 → 原样
                out.append(ch)
                i += 1
                continue

        # 引号状态机（反斜杠转义只在双引号外/内都有意义，这里够用）
        if ch == '\\' and not in_single:
            out.append(text[i:i + 2])
            i += 2
            continue
        if ch == "'" and not in_double:
            in_single = not in_single
            out.append(ch)
            i += 1
            continue
        if ch == '"' and not in_single:
            in_double = not in_double
            out.append(ch)
            i += 1
            continue

        # 关键：单引号内不展开 → 不动
        if in_single:
            out.append(ch)
            i += 1
            continue

        # 找 $name 后紧跟非 ASCII 字节
        if ch == '$' and i + 1 < n and is_name_start(text[i + 1]):
            j = i + 1
            while j < n and is_name_char(text[j]):
                j += 1
            if j < n and is_nonascii(text[j]):
                out.append('${' + text[i + 1:j] + '}')
                fixes += 1
                i = j
                continue

        out.append(ch)
        i += 1

    return ''.join(out), fixes


def main():
    write = '--write' in sys.argv
    root = Path(__file__).resolve().parents[2]
    total_files, total_fixes = 0, 0

    for p in sorted(root.rglob('*.sh')):
        if 'node_modules' in p.parts:
            continue
        try:
            text = p.read_text(encoding='utf-8')
        except Exception:
            continue
        fixed, count = fix_text(text)
        if count == 0:
            continue
        total_files += 1
        total_fixes += count
        rel = p.relative_to(root)
        print(f'  {rel}  →  {count} 处')
        if write:
            p.write_text(fixed, encoding='utf-8')

    verb = '已修改' if write else '将修改（预演，未写入）'
    print(f'\n{verb}：{total_files} 个文件，{total_fixes} 处')
    if not write:
        print('加 --write 真正写入。')


if __name__ == '__main__':
    main()
