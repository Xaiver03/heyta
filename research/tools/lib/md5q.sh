#!/bin/sh
# 跨平台 md5 —— 这个仓库里实现 md5 的**唯一**一处。
#
# 🔴 为什么要有它（2026-10-25 的 CI 4 020 238 1746 红在这里）：
#    哈希工具的名字在 macOS 与 Linux 上不同（BSD 那个带安静开关，GNU 那个是另一条命令）。
#    写死哪一边，另一边就是 `command not found` —— 而 `check:calendar-evidence-rigs` 的
#    selftest 把它报成"臂坏了"，一句指不到"这台机器没有那条命令"的话（§7 元规则一）。
#    同族旧账：`f5d93b0e3` 那笔把三处平台专属的 `stat` 写法换成跨平台写法。
#
# 🔴 为什么用 `openssl dgst` 而不是"探测两边再分支"：
#    `openssl` 在 macOS 与 Linux 上都在（前者是系统自带的 LibreSSL），所以**它没有分支**。
#    而"探测 + 分支"会把两边都写进代码里，恰好让 `check:shell-portability` 的债务账本
#    多出好几站 —— 一份"为了可移植而写的两分支代码"在账本上等于把债写回去。
#    ⇒ 这里是一处实现、零分支。（⚠️ 注释里也**不要**写那两条命令的字面，
#      账本按文本扫站点，连注释一起算 —— 这一条是 2026-10-25 实测撞出来的。）
#
# 用法（bash 3.2 兼容，别用数组）：
#   . "$(dirname "$0")/lib/md5q.sh"
#   sum=$(md5q "$file")
#   sum=$(printf '%s' "$text" | md5q_stdin)
#
# 输出是**裸哈希**（与旧读数同形），文件名不出现 —— 调用方拿到的就是那一串十六进制。

md5q() {
  openssl dgst -md5 -- "$1" | sed 's/^.*= //'
}

md5q_stdin() {
  openssl dgst -md5 | sed 's/^.*= //'
}
