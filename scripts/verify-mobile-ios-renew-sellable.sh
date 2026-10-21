#!/usr/bin/env bash
#
# 移动端「¥12 那一档被服务端拒」的**像素腿**（iOS 模拟器，无头）
# ============================================================
#
# 为什么要单独一条脚本：`renew-entry.spec.ts` 钉的是**形状**（源码正则），
# 而"这台实例没配托管上游 ⇒ 按下去真的会看到那句人话"是一条**行为**主张，
# 移动壳没有组件渲染测试载体 ⇒ 只能真跑一次并留一张图（AGENTS §6.2 规定一）。
#
# 前置（脚本自己会查，查不到就响亮地失败）：
#   1. 一枚 booted 的模拟器 —— `xcrun simctl boot <UDID>` 就够，**别开 Simulator.app**（会抢前台）
#   2. 本机服务端在 `HOST_SERVER`（默认 3177）上活着
#   3. app 已装（Release 包内嵌 jsbundle）
#   4. 一枚能登录的账号：邮箱与加密口令各走一个文件，登录口令走 `PASS`
#
# 起栈一条命令（⚠️ 四枚路径**必须绝对** —— `mobile-e2e-up.sh` 会 `cd` 到 `server/` 再重定向，
# 相对路径在它那儿落空 ⇒ 服务端 60 秒不就绪，2026-10-22 00:3x 实测踩过）：
#   R="$PWD/.run-logs/renew-leg" PORT=3177 \
#   HEYTA_E2E_TOKEN_FILE="$R/token3.txt" HEYTA_E2E_EMAIL_FILE="$R/email3.txt" \
#   HEYTA_E2E_E2EE_FILE="$R/e2ee3.txt" HEYTA_E2E_LOGFILE="$R/up3.log" \
#   bash scripts/mobile-e2e-up.sh
#
# 🔴 本机 idb 的 `ui set-value` **已经不存在了**（子命令表里只有
# describe-all/describe-point/tap/button/text/key/key-sequence/swipe）
# ⇒ 往输入框写值只能走"聚焦 + 键盘输入"（`--type-text`），`--set` 一律 `setRc=2`。
# 这条是本腿第一版红在半路的真因（不是产品，是桥）。

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IDB_BIN="${IDB_BIN:-$HOME/.local/bin/idb}"
IDB_COMPANION="${IDB_COMPANION:-$HOME/.local/bin/idb_companion}"
UDID="${UDID:-}"
HOST_SERVER="${HOST_SERVER:-http://127.0.0.1:3177}"
BUNDLE="${BUNDLE:-com.heyta}"
EMAIL_FILE="${EMAIL_FILE:-$ROOT/.run-logs/renew-leg/email3.txt}"
E2EE_FILE="${E2EE_FILE:-$ROOT/.run-logs/renew-leg/e2ee3.txt}"
PASS="${PASS:-mobile-e2e-password}"
OUT_DIR="${OUT_DIR:-$ROOT/apps/mobile/evidence/renew-ios-20261022}"
SHOT="${SHOT:-5-signed-in-sellable-refusal.png}"
DUMP="${DUMP:-$ROOT/.run-logs/renew-leg/ax-dump.json}"
SELLABLE_NEEDLE="这一档现在还不能卖"
# 「保存密码？」那枚系统弹窗的「以后」按钮中心（**点**坐标，402x874 那一档机型上实测；
# 弹窗属于另一个进程 ⇒ 它不在 app 的树里，只能按坐标点）
SAVE_LATER_X="${SAVE_LATER_X:-137}"
SAVE_LATER_Y="${SAVE_LATER_Y:-594}"

ok() { printf '   ✅ %s\n' "$1"; }
bad() { printf '   ❌ %s\n' "$1" >&2; }

# 🔴 树操作全走 `scripts/tools/ios-ax-shim.py`：它把"按标签找节点 / 只认可点节点 /
#    滚动进视野 / 键盘输入"收敛成命令行。idb 自己的全局参数（`--companion-path`）
#    **必须放在子命令之前**，手敲必错（rc=2 usage）。
SHIM="$ROOT/scripts/tools/ios-ax-shim.py"
axx() { python3 "$SHIM" "$@" --udid "$UDID" --idb "$IDB_BIN" --companion "$IDB_COMPANION" --json; }
jget() { printf '%s' "$1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$2',''))" 2>/dev/null; }

idb_dump() { "$IDB_BIN" --companion-path "$IDB_COMPANION" ui describe-all --udid "$UDID" > "$DUMP" 2>/dev/null; }

dump_labels() {
  python3 - "$DUMP" <<'PY'
import json, sys
try: nodes = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception: print(0); raise SystemExit
def walk(x):
    yield x
    for c in (x.get("children") or []): yield from walk(c)
n = 0
for t in (nodes if isinstance(nodes, list) else [nodes]):
    for x in walk(t):
        if (x.get("AXLabel") or "").strip(): n += 1
print(n)
PY
}

# needle_state：0=界面上有 / 1=没有 / 2=**探针自己读不到树**。三档必须分开，
# 否则"树读不出"会被当成"界面上没有"，报出来的是一枚假的产品缺陷。
needle_state() {
  rm -f "$DUMP" 2>/dev/null; idb_dump || return 2
  [ -s "$DUMP" ] || return 2
  python3 - "$DUMP" "$1" <<'PY'
import json, sys, unicodedata
path, needle = sys.argv[1], unicodedata.normalize("NFKC", sys.argv[2])
try: nodes = json.load(open(path, encoding="utf-8"))
except Exception: sys.exit(2)
def walk(n):
    yield n
    for c in (n.get("children") or []): yield from walk(c)
for top in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(top):
        for k, v in n.items():
            if isinstance(v, str) and needle in unicodedata.normalize("NFKC", v): sys.exit(0)
sys.exit(1)
PY
}

field_found() { [ "$(jget "$(axx "$1" --role AXTextField --list --json)" found)" = "True" ]; }

press_row() {
  axx "$1" --pressable --scroll-into-view >/dev/null 2>&1
  axx "$1" --press >/dev/null 2>&1
}

# 🔴 底部标签栏**不许**带 `--scroll-into-view`：那枚滑动作用在内容 ScrollView 上，
#    会把标签栏自己滚走 ⇒ 按下落到别处（本仓设备腿记过的同一条）。
press_tab() { axx "$1" --press >/dev/null 2>&1; }

# 写值 = 聚焦 + 键盘输入（见文件头那枚 set-value 已失效）。
# 明文框回读**逐字相同**才算成；遮住框只回读到掩码 ⇒ 只验"非空且码点数对得上"。
fill_field() { # <标签> <值> [secure]
  local lbl="$1" val="$2" kind="${3:-}" out back want i
  want=$(printf '%s' "$val" | wc -m | tr -d ' ')
  for i in 1 2 3; do
    axx --dismiss-keyboard --json >/dev/null 2>&1
    out=$(axx "$lbl" --role AXTextField --type-text "$val")
    back=$(jget "$out" detail)
    if [ "$(jget "$out" typedRc)" = "0" ]; then
      if [ "$kind" = "secure" ]; then
        [ -n "$back" ] && { ok "已填「${lbl}」（secure：回读到掩码 ${#back} 字节，原文不进 AX）"; return 0; }
      else
        [ "$back" = "$val" ] && { ok "已填「${lbl}」（回读逐字相同）"; return 0; }
      fi
    fi
    echo "     [fill] 「${lbl}」第 ${i} 次没成：typedRc=$(jget "$out" typedRc) 回读=[$back]（期望 ${want} 码点）"
    sleep 0.8
  done
  bad "「${lbl}」三次都没能写进去（${kind:-text}）"
  return 1
}

# 按下之前**要确认键盘真的收了**：iOS 软键盘盖住表单下半部时，按「用邮箱和密码登录」
# 会落在键盘上（2026-10-22 从零复现：三栏回读全对、`--press` 退 0，但 60 秒等不到会话卡，
# 树上还挂着 `q/w/e/r/t` 与「More suggestions」= 键盘支着）。
wait_keyboard_gone() {
  local i
  for i in 1 2 3 4 5; do
    axx --dismiss-keyboard --json >/dev/null 2>&1
    sleep 1
    needle_state "More suggestions" >/dev/null 2>&1 || return 0
    echo "     [kbd] 第 ${i} 次收起之后键盘还在树上"
  done
  return 1
}

# iOS「保存密码？」弹窗弹在 RN Modal 之上，指纹是**树上只剩 ≤2 枚可及名**。
# ⚠️ 不许拿"底部标签不在"当判据：设置面本来就是 Modal，底部标签在不在跟弹窗无关。
dismiss_save_password() {
  local n
  rm -f "$DUMP" 2>/dev/null; idb_dump || true
  n=$(dump_labels)
  [ "${n:-0}" -gt 2 ] && return 0
  axx --tap "$SAVE_LATER_X" "$SAVE_LATER_Y" --json >/dev/null 2>&1 || true
  sleep 2
  rm -f "$DUMP" 2>/dev/null; idb_dump || true
  ok "摘掉系统弹窗（按坐标点「以后」；树从 ${n} 枚恢复到 $(dump_labels) 枚）"
}

# 走到"能填三栏凭据"的那一层。本壳这一代 AuthScreen 有**两道前置闸**（2026-10-22 现量）：
#   ① 条款同意那一枚必须先勾上，否则两颗按钮按了没反应；
#   ② 邮箱/口令那张表在「使用自建服务端」后面 —— 旧那代（`verify-mobile-ios-account-email-sessions.sh`
#      假设的"进面即见表单"）在这台产物上已经不成立。
open_auth_form() {
  press_tab "我的"; sleep 3
  needle_state "个人资料、偏好、同步与安全" >/dev/null 2>&1 || { bad "没站到「我的」根层"; return 1; }
  press_row "设置"; sleep 3
  local i
  for i in 1 2 3 4 5 6 7 8; do
    field_found "服务器地址" && break
    needle_state "同步与隐私" >/dev/null 2>&1 && { press_row "同步与隐私"; sleep 2; }
    if ! field_found "服务器地址" && needle_state "使用自托管服务器" >/dev/null 2>&1; then
      press_row "使用自托管服务器"; sleep 2
    fi
    sleep 1
  done
  field_found "服务器地址" || { bad "进不到能填凭据的那一层"; return 1; }
  press_row "注册 / 登录"; sleep 2
  if needle_state "使用自建服务端" >/dev/null 2>&1; then
    echo "     落在**新一代** AuthScreen（先要勾条款，再选登录方式）"
    press_row "我同意服务条款与隐私政策，并允许本机联网"; sleep 2
    press_row "使用自建服务端"; sleep 3
  fi
  field_found "邮箱" || { bad "按完入口之后树上没有「邮箱」框 ⇒ 没落在凭据表单上"; return 1; }
  ok "已到凭据表单（「邮箱」与「服务器地址」两栏都在）"
}

login_self_hosted() {
  local mail="$1" e2ee="$2" rc i signed=0
  open_auth_form || return 1
  needle_state "再次输入密码" >/dev/null 2>&1 && { press_row "已经有账号了？直接登录"; sleep 2; }
  fill_field "服务器地址" "$HOST_SERVER" || return 1
  fill_field "邮箱" "$mail" || return 1
  needle_state "隐藏密码" >/dev/null 2>&1; rc=$?
  [ "$rc" = "2" ] && { bad "判不了「登录密码」是明文还是遮住档（树读不出）"; return 1; }
  if [ "$rc" = "0" ]; then fill_field "登录密码" "$PASS" || return 1
  else fill_field "登录密码" "$PASS" secure || return 1; fi
  wait_keyboard_gone
  dismiss_save_password
  press_row "用邮箱和密码登录"
  for i in $(seq 1 30); do
    sleep 2
    needle_state "已登录" >/dev/null 2>&1; rc=$?
    [ "$rc" = "0" ] && { signed=1; break; }
    [ $((i % 5)) -eq 0 ] && dismiss_save_password
  done
  [ "$signed" = "1" ] || { bad "60 秒内没出现会话卡「已登录」"; return 1; }
  ok "登录成功（会话卡「已登录」在树上）"
  fill_field "加密口令" "$e2ee" secure || return 1
  wait_keyboard_gone
  dismiss_save_password
  # 🔴 「保存并启用同步」之后 iOS 才弹「保存密码？」，它把整棵树盖住 ⇒ 只按"按钮读不到了"
  #    判"按下生效"是**假绿**（2026-10-22 leg5 实测：那句 ok 打出来了，真因是弹窗）。
  #    所以每一轮都先摘弹窗，再要 `needle_state` 回 1（树读得出、且按钮确实不在）才算过。
  for i in 1 2 3; do
    press_row "保存并启用同步"; sleep 5
    dismiss_save_password
    needle_state "保存并启用同步" >/dev/null 2>&1; rc=$?
    if [ "$rc" = "1" ]; then ok "「保存并启用同步」已收（第 ${i} 次按下生效，且这棵树读得出）"; return 0; fi
    echo "     [sync] 第 ${i} 次判不了（rc=${rc}；2=树读不出，1=按钮还在）⇒ 不拿它当成功"
    dismiss_save_password
  done
  bad "按了三次「保存并启用同步」它还挂在树上 ⇒ 同步没启用，后面的读数都不算数"
  return 1
}

# 首启那两枚面板：卸载重装之后实测的顺序是 **隐私面板 → 欢迎卡**（不是反过来），
# 所以这里是一个"两个都不在树上才算过"的循环 —— 一拿到同意就 return 会把欢迎卡留在原地，
# 下一发按「我的」按在空气上（2026-10-22 00:5x 第一版就是这么红的）。
pass_first_launch() {
  local i
  for i in 1 2 3 4 5 6; do
    if [ "$(jget "$(axx "同意并联网" --pressable --list --json)" found)" = "True" ]; then
      press_row "同意并联网"; sleep 3; ok "已点「同意并联网」（出境同意落盘）"; continue
    fi
    if [ "$(jget "$(axx "先离线使用" --pressable --list --json)" found)" = "True" ]; then
      press_row "先离线使用"; sleep 3; ok "已点「先离线使用」（欢迎卡收掉）"; continue
    fi
    return 0
  done
  bad "六轮之后首启面板还挂着 ⇒ 不拿「按过了」当「按掉了」"
  return 1
}

main() {
  mkdir -p "$ROOT/.run-logs/renew-leg" "$OUT_DIR"
  [ -n "$UDID" ] || UDID="$(xcrun simctl list devices booted | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1)"
  [ -n "$UDID" ] || { bad "没有 booted 的模拟器（先 xcrun simctl boot <UDID>）"; exit 1; }
  curl -s -m 5 -o /dev/null "${HOST_SERVER}/health" || { bad "服务端没在 ${HOST_SERVER} 上活着"; exit 1; }
  local mail e2ee rc
  mail="$(tr -d '\n' < "$EMAIL_FILE" 2>/dev/null)"; e2ee="$(tr -d '\n' < "$E2EE_FILE" 2>/dev/null)"
  [ -n "$mail" ] && [ -n "$e2ee" ] || { bad "读不到邮箱或加密口令（$EMAIL_FILE / $E2EE_FILE）"; exit 1; }
  echo "════ 移动端「这一档还不能卖」像素腿 ════"
  echo "   设备 $UDID · 服务端 $HOST_SERVER · 账号 $mail"

  xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null
  xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null 2>&1 || { bad "app 起不来（先装 $BUNDLE）"; exit 1; }
  sleep 8
  pass_first_launch || { bad "首启那两枚面板没过去 ⇒ 后面看不到续费那块"; exit 1; }

  login_self_hosted "$mail" "$e2ee" || { bad "登录这一腿没走完 ⇒ 后面的按下都不算数"; exit 1; }

  dismiss_save_password
  # 「关闭」要**回读**：它没关掉的话，后面每一发都打在设置面的分组目录里，
  # 而报出来的却是"界面上没有那句话"——那是把探针的失手记成产品的失手（§7 元规则一）。
  for rc in 1 2 3; do
    press_row "关闭"; sleep 2
    [ "$(jget "$(axx "关闭" --pressable --list --json)" found)" != "True" ] && break
  done
  press_tab "我的"; sleep 4
  needle_state "个人资料、偏好、同步与安全" >/dev/null 2>&1 || { bad "还站在设置面／没到「我的」根层 ⇒ 不拿这一屏的读数当产品结论"; exit 1; }
  axx "买哪一档" --scroll-into-view >/dev/null 2>&1; sleep 1
  needle_state "买哪一档" >/dev/null 2>&1 || { bad "「我的」根层上没有续费那块（渲染闸门没过去？）"; exit 1; }
  press_row "官方托管 + 云端 AI"; sleep 2
  needle_state "不受端到端加密保护" >/dev/null 2>&1 || bad "⚠️ 换档之后出境警告那句没出现 ⇒ 这一单可能落在**另一档**上，下面的读数要带着这条看"
  press_row "下单续费"; sleep 12
  dismiss_save_password

  axx "$SELLABLE_NEEDLE" --scroll-into-view >/dev/null 2>&1; sleep 1
  xcrun simctl io "$UDID" screenshot "$OUT_DIR/$SHOT" >/dev/null 2>&1
  echo "   截图 → $OUT_DIR/$SHOT"
  needle_state "$SELLABLE_NEEDLE" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "0" ]; then
    ok "界面上有「${SELLABLE_NEEDLE}…」那一句（服务端 409 PRICE_NOT_SELLABLE 被翻译成了人话）"
    exit 0
  fi
  bad "按下之后界面上没有那句话（rc=${rc}；2=树读不出，别当成「没有」）"
  exit 1
}

main "$@"
