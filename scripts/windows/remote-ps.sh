#!/usr/bin/env bash
# 在 Windows 打包机上以「分离进程」方式跑 PowerShell 命令，并落日志。
#
# 为什么需要它：SSH 会话断开时，前台进程会被带走。Windows 上的 winget / sdkmanager
# 要跑几十分钟，必须用 Start-Process 分离，否则一断线安装就半途而废。
#
# 用法：
#   scripts/windows/remote-ps.sh <命令字符串> [日志文件]
#
# 例：
#   scripts/windows/remote-ps.sh 'Write-Host hi' /tmp/out.log
#
# 注意：命令字符串里请避免双引号（会被 Start-Process 的参数解析吃掉一层）。

set -euo pipefail

HOST="${HEYTA_WIN_HOST:-windows-pc}"
CMD="${1:?用法: remote-ps.sh <命令字符串> [日志文件]}"
LOG="${2:-C:\\src\\heyta-build.log}"

# 把命令包进一份临时 ps1 脚本，用 Start-Process 分离执行。
# -PassThru 拿进程对象，立刻返回，SSH 可以马上退出。
WRAPPER="\$ErrorActionPreference='Continue'; \
\$log='$LOG'; \
New-Item -ItemType Directory -Force -Path (Split-Path \$log) | Out-Null; \
\$script = @'
$CMD
'@; \
Set-Content -Path \$env:TEMP\\heyta-remote.ps1 -Value \$script -Encoding UTF8; \
\$p = Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',\$env:TEMP\\heyta-remote.ps1 -RedirectStandardOutput \$log -RedirectStandardError \"\$log.err\" -PassThru -WindowStyle Hidden; \
Write-Output (\"STARTED PID=\" + \$p.Id + \" LOG=\" + \$log)"

ssh -o ConnectTimeout=15 "$HOST" "$WRAPPER"
