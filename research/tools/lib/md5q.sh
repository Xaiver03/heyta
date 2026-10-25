#!/bin/sh
# 跨平台 md5 —— 这两个函数是这个仓库里**唯一**一处 md5 实现。
#
# 🔴 为什么要收成一处（2026-10-25 的 CI 4 020 238 1746 红在这里）：
#    macOS 的 `md5 -q <file>` 在 Linux 上**不存在**（那边是 `md5sum`），
#    于是 `check:calendar-evidence-rigs` 的三份装置在 ubuntu runner 上打出
#    `md5: command not found`，selftest 的臂整片崩 —— 而报出来的是"臂坏了"，
#    指不到"这台机器没有 macOS 那条命令"（§7 元规则一：先怀疑探针）。
#    同族旧账：`stat -f`（`f5d93b0e3` 那笔"三处 stat -f 换成跨平台写法"）。
#
# 用法（bash 3.2 兼容，别用数组）：
#   . "$(dirname "$0")/lib/md5q.sh"
#   sum=$(md5q "$file")
#   sum=$(printf '%s' "$text" | md5q_stdin)
#
# ⚠️ 只输出**裸哈希**（`md5 -q` 的形状），不带文件名 —— 调用方拿到的就是那一串十六进制。

md5q() {
  if command -v md5 >/dev/null 2>&1; then
    md5 -q "$1"
  else
    md5sum "$1" | cut -d' ' -f1
  fi
}

md5q_stdin() {
  if command -v md5 >/dev/null 2>&1; then
    md5 -q
  else
    md5sum | cut -d' ' -f1
  fi
}
