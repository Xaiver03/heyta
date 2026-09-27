#!/bin/bash
#
# 移动端零 mock E2E：把本地栈停掉。
# ==================================
#
# 配套 `scripts/mobile-e2e-up.sh`。只停**本脚本起的那个**服务端（认 pidfile），
# 不去按端口或进程名乱杀 —— 本机可能同时跑着别的 3000 端口服务
# （实测就踩过：早期有另一个长期在跑的服务端，误杀会让下一轮 E2E 莫名其妙地红）。
#
# 用法：
#   bash scripts/mobile-e2e-down.sh            # 停服务端，保留账号凭据
#   HEYTA_E2E_PURGE=1 bash scripts/mobile-e2e-down.sh   # 连账号凭据一起清掉

set -uo pipefail

PIDFILE="/tmp/heyta-e2e-server.pid"

if [ ! -f "$PIDFILE" ]; then
  echo "   ⏭  没有 pidfile（$PIDFILE）—— 本脚本起的服务端不在运行。"
else
  PID="$(cat "$PIDFILE" 2>/dev/null)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null
    # 等它真的走，最多 15 秒；**不要**上来就 -9，让连接池有时间收尾。
    for _ in $(seq 1 15); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$PID" 2>/dev/null; then
      echo "   ⚠️  pid $PID 15 秒没退出，强制结束"
      kill -9 "$PID" 2>/dev/null
    else
      echo "   ✅ 服务端已停止（pid $PID）"
    fi
  else
    echo "   ⏭  pid $PID 已经不在运行"
  fi
  rm -f "$PIDFILE"
fi

if [ "${HEYTA_E2E_PURGE:-0}" = "1" ]; then
  rm -f /tmp/heyta_mobile_token.txt /tmp/heyta_mobile_email.txt /tmp/heyta_mobile_e2ee.txt
  echo "   ✅ 账号凭据已清除（下一轮 up 会建新号）"
fi
