#!/usr/bin/env bash
# #77 那档 `ERASURE_TRIGGER=external`（**被动通道**：宿主机发注销、设备只同步）的离线判据。
#
# 为什么不能等真机才验：这一档的价值全在"两档是不是真的走了不同的路"，
# 而那是**结构**问题，不需要模拟器就能证。真机那一趟（等窗口）只负责读数。
#
# 五条腿（每条一个独立进程，桩里写死服务端应答与界面读数）：
#  1 默认档 ⇒ 走 UI（主动）那一支，且**不**发 DELETE
#  2 external + 200/204/410+ACCOUNT_CLOSED + 界面有那句 ⇒ P0 ok、P1 ok、C ok，不提前收
#  3 external + 注销前探针就不通（404）⇒ 响亮 bad + 收工，且**不许**已经把账号注销了
#  4 external + 注销后回的是 401 而不是 410 ⇒ P1 bad + 收工，且**不许**去驱动设备同步
#  5 external + 前提都成立但界面始终没那句 ⇒ C 判红（这一腿挡"恒真的 C"）
#
# 🔴 三件装置纪律（traps #277）：载具落成一次性脚本文件（bash 3.2 的 `$( … case )` 会炸）、
#    桩写**带全局序号的记录文件**（被测代码自己带重定向）、取空要响亮失败。
set -uo pipefail
# RIG 从**本文件自己的位置**往上推到仓库根，不依赖调用时的 cwd。
RIG="${RIG:-$(cd "$(dirname "$0")/../../.." && pwd)/scripts/verify-mobile-account-erasure.sh}"
BLOCK=$(awk '/^if \[ "\$\{ERASURE_TRIGGER/,/^fi$/' "$RIG")
[ -n "$BLOCK" ] || { echo "PASSIVE=EXTRACT-EMPTY（锚点没命中）"; exit 1; }
echo "   提取到判据 C 的两档分支 $(printf '%s\n' "$BLOCK" | grep -c '') 行（载体：${RIG}）"

HARNESS=$(mktemp /tmp/android-passive-harness.sh.XXXXXX)
BODYF=$(mktemp /tmp/android-passive-body.txt.XXXXXX)
RECF=$(mktemp /tmp/android-passive-rec.txt.XXXXXX)
trap 'rm -f "$HARNESS" "$BODYF" "$RECF"' EXIT
printf '%s\n' "$BLOCK" > "$BODYF"

cat >"$HARNESS" <<'HE'
set -u
BODY=$(cat "$1"); REC="$2"
SEQ=0
mark() { SEQ=$(( SEQ + 1 )); printf '%03d %s\n' "$SEQ" "$*" >> "$REC"; }
echo() { mark "ECHO|$*"; }
# 服务端应答由环境注入
P0=${LEG_P0:-200}; PCLOSE=${LEG_CLOSE:-204}; P1=${LEG_P1:-410}
CODE=${LEG_CODE:-ACCOUNT_CLOSED}; HIT=${LEG_HAS_SUB:-1}
curl() {
  mark "CURL|$*"
  ALL="$*"
  out=""; method="GET"
  while [ $# -gt 0 ]; do
    case "$1" in
      -o) shift; out="$1" ;;
      -X) shift; method="$1" ;;
    esac
    shift
  done
  if [ "$method" = "DELETE" ]; then
    [ -n "$out" ] && printf '{"ok":true}' > "$out"
    printf '%s' "$PCLOSE"; return 0
  fi
  if printf '%s' "$ALL" | grep -q 'sync/status'; then   # 🔴 用 $ALL：while 循环已经把位置参数移空了
    if printf '%s' "$ALL" | grep -qo '/dev/null'; then
      printf '%s' "$P0"
    else
      [ -n "$out" ] && printf '{"code":"%s"}' "$CODE" > "$out"
      printf '%s' "$P1"
    fi
    return 0
  fi
  printf '000'
}
ok()  { mark "JUDGE|ok|$*"; }
bad() { mark "JUDGE|bad|$*"; }
summary() { mark "SUMMARY|rc=${3:-0}"; exit 7; }
go_profile() { mark "NAV|go_profile"; return 0; }
ensure_phone_sync() { mark "SYNC|ensure_phone_sync"; return 0; }
dump() { mark "DUMP"; }
# has_sub 的产出是被 `$( )` 捕获的 ⇒ 必须 printf，不能用已被桩化成"只写记录文件"的 echo
has_sub() { if [ "$HIT" = "1" ]; then printf 1; else printf 0; fi; }
screen_txt() { mark "SCREEN_TXT"; }
save_failure_dump() { mark "SAVE_DUMP"; }
scroll_to_text() { mark "UI|scroll_to_text|$1"; printf ''; }
xy_desc() { mark "UI|xy_desc|$1"; printf ''; }
settle_for() { mark "UI|settle_for|$1"; return 1; }
sleep() { :; }
ADB="ADB-STUB"
UI_XML=/dev/null
STAMP=selftest
HOST_SERVER=http://127.0.0.1:3101
TOKEN=dev.tok
eval "$BODY"
mark "END|no-summary"
HE

leg() { # $1=名字 $2=TRIGGER值(可空) $3..=桩的输入（KEY=VAL，导出给载具）—— 打印记录文件
  : >"$RECF"
  if [ -n "$2" ]; then export ERASURE_TRIGGER="$2"; else unset ERASURE_TRIGGER; fi
  shift 2
  for kv in "$@"; do export "$kv"; done
  bash "$HARNESS" "$BODYF" "$RECF" >/dev/null 2>&1
  cat "$RECF"
  for kv in "$@"; do unset "${kv%%=*}"; done
}

FAIL=0
want() { # $1=描述 $2=必须出现的子串
  if printf '%s\n' "$LOG" | grep -q "$2"; then echo "   ✔ $1"
  else echo "   ✘ $1：记录里没有「$2」"; printf '%s\n' "$LOG" | sed 's/^/       /' | head -8; FAIL=$((FAIL+1)); fi
}
wantnt() { # $1=描述 $2=必须**不**出现的子串
  if printf '%s\n' "$LOG" | grep -q "$2"; then
    echo "   ✘ $1：记录里出现了「$2」（不该走到）"; FAIL=$((FAIL+1))
  else echo "   ✔ $1"; fi
}

echo "── 腿 1：默认档（主动通道）──"
LOG=$(leg default "")
want   "走的是 UI 那一支"        "UI|scroll_to_text|注销账号"
wantnt "没发 DELETE /api/account" "CURL|.*DELETE"

echo "── 腿 2：external 且前提全成立 ──"
LOG=$(leg ext external)
want "前提腿 P0 判绿"   "JUDGE|ok|前提腿 P0"
want "前提腿 P1 判绿"   "JUDGE|ok|前提腿 P1 成立"
want "判据 C（被动）判绿" "JUDGE|ok|判据 C（被动通道）成立"
wantnt "没有提前收工"     "SUMMARY"
want   "设备只被按了同步"  "SYNC|ensure_phone_sync"
wantnt "被动档不点注销入口" "UI|scroll_to_text"

echo "── 腿 3：注销前探针就不通（404）──"
LOG=$(leg p0bad external LEG_P0=404)
want   "P0 响亮判红"        "JUDGE|bad|探针自己不通"
want   "当场收工（rc=1）"    "SUMMARY|rc=1"
wantnt "探针不通时不许先把账号注销掉" "CURL|.*DELETE"

echo "── 腿 4：注销后回 401 而不是 410 ──"
LOG=$(leg p1bad external LEG_P1=401 LEG_CODE=UNAUTHORIZED)
want   "P1 判红并收工"        "JUDGE|bad|前提腿 P1 不成立"
want   "当场 rc=1"            "SUMMARY|rc=1"
wantnt "信号不对时不许去驱动设备同步" "SYNC|ensure_phone_sync"

echo "── 腿 5：前提成立但界面上没那句话 ──"
LOG=$(leg noball external LEG_HAS_SUB=0)
want   "C 这一腿会红（不是恒真）" "JUDGE|bad|45×2s 内界面上没出现"
wantnt "没被误报成成立"           "JUDGE|ok|判据 C（被动通道）成立"

echo ""
[ "$FAIL" = "0" ] && { echo "PASSIVE=pass（5 条腿：两档确实分路 + 三枚前提腿各有牙）"; exit 0; }
echo "PASSIVE=fail=$FAIL"; exit 1
