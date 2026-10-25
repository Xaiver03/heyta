#!/bin/sh
# 探一次这台机器能不能套限制性 sandbox profile，不能就打印 `--disable-sandbox`。
#
# 🔴 为什么这必须是**一处实现**（2026-10-25）：
#    SwiftPM 编译 `Package.swift` 时要经 `sandbox-exec` 套一层限制性 profile，
#    而**已经在沙箱里**再套会 `sandbox_apply: Operation not permitted` ⇒
#    `error: <pkg>: Invalid manifest`。那句报错指向"清单写坏了"，实际是环境
#    （macOS 的 Seatbelt **继承给子孙进程**，所以在任何受沙箱约束的运行时里都必然中招，
#    与工具链版本无关）。
#
#    2026-09-30 只在 `package-app.sh` 里修过一次，于是同一个环境里
#    "能打包、`check-macos-shell` 红、`check-macos-window` 也红" ——
#    同一条规则三个消费者，只有一处拿到了开关。本文件就是把它收成一处。
#
# 用法（bash 3.2 兼容，**不要**用数组）：
#   FLAG="$(bash "$(dirname "$0")/swift-sandbox-flag.sh")"
#   swift build $FLAG          # 空串会被词分割吃掉，正合适
#   swift run heyta-smoke $FLAG
#
# 判据是探针本身能不能跑通，不是去 grep 报错文本：报错文案会随工具链版本变，
# 而"探针跑不跑得通"是机制。

if sandbox-exec -p '(version 1)(deny default)(allow file-read*)' /bin/echo >/dev/null 2>&1; then
  exit 0
fi

printf '%s' '--disable-sandbox'
