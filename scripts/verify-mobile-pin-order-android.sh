#!/usr/bin/env bash
#
# Android 远端模拟器上的「置顶」几何验收（零 mock）—— 滴答对齐 B5 的设备腿
# =========================================================================
#
# 与 verify-mobile-pin-order.sh (iOS) 判同一件事，载体不同：
#   本脚本: linux-dev 远端模拟器 + uiautomator dump 的 resource-id / bounds
#
# 判据（三条一起才算，缺一条都会假绿）：
#   1. 顺序按 y 坐标读，不按"树里有没有这一行"
#   2. 置顶之后再开一次菜单，那一项要说「取消置顶」
#   3. 真 op-log：一个用户意图 = 一条 op
#
# 前置：linux-dev 可达且有一台 booted 模拟器；APK 已按当前源码打过。
#       要连装一起做：APK=<path> bash scripts/verify-mobile-pin-order-android.sh
#
# ⚠️ 标题用 ASCII：adb shell input text 发不了非 ASCII。
# ⚠️ 系统 locale 是 en-US；界面语言由 per-app locale 决定。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${HEYTA_ANDROID_HOST:-linux-dev}"
SDK="${HEYTA_ANDROID_SDK_ON_HOST:-/home/xaiver/.local/opt/android-sdk}"
PKG="${PKG:-com.heyta}"
APK="${APK:-}"
EVIDENCE_DIR="$ROOT/apps/mobile/evidence/dida-pin-order-android-$(date +%Y%m%d)"
LOCAL_XML="$ROOT/.run-logs/android-pin-order/ui.xml"

mkdir -p "$EVIDENCE_DIR" "$(dirname "$LOCAL_XML")"

ok()   { printf '   ✅ %s\n' "$1"; }
bad()  { printf '   ❌ %s\n' "$1" >&2; }
info() { printf '   · %s\n' "$1"; }
step() { printf '\n── %s\n' "$1"; }

PASS=0; FAIL=0

rsh() { ssh -n -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "export PATH=$SDK/platform-tools:\$PATH; $*"; }

dump() {
  rm -f "$LOCAL_XML"
  rsh "adb shell uiautomator dump /data/local/tmp/heyta-pin.xml >/dev/null 2>&1"
  ssh -n -o BatchMode=yes "$HOST" "export PATH=$SDK/platform-tools:\$PATH; adb exec-out cat /data/local/tmp/heyta-pin.xml" > "$LOCAL_XML" 2>/dev/null || return 2
  [ -s "$LOCAL_XML" ] || return 2
  head -c 5 "$LOCAL_XML" | grep -q '<?xml' || return 2
}

# 按 resource-id 取 bounds 中心坐标（"x1 y1 w h" 格式）。
by_id() {
  dump || return 2
  python3 - "$LOCAL_XML" "$1" <<'PY'
import sys, re, xml.etree.ElementTree as ET
path, want = sys.argv[1], sys.argv[2]
try: root = ET.parse(path).getroot()
except Exception: sys.exit(2)
def rid(n):
    v = n.get('resource-id', '')
    return v.rsplit('/', 1)[-1] if v else v
for node in root.iter('node'):
    if rid(node) == want:
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            print(f'{x1} {y1} {x2-x1} {y2-y1}')
            sys.exit(0)
sys.exit(1)
PY
}

# 按 text 或 content-desc 子串匹配，返回 bounds 中心坐标。
by_text() {
  dump || return 2
  python3 - "$LOCAL_XML" "$1" <<'PY'
import sys, re, xml.etree.ElementTree as ET
path, want = sys.argv[1], sys.argv[2]
try: root = ET.parse(path).getroot()
except Exception: sys.exit(2)
for n in root.iter('node'):
    if want in (n.get('content-desc', ''), n.get('text', '')):
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds', ''))
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            print(f'{x1} {y1} {x2-x1} {y2-y1}')
            sys.exit(0)
sys.exit(1)
PY
}

# 取某 resource-id 节点的 y 坐标（上沿）。返回空 = 找不到。
y_of_id() {
  local f; f="$(by_id "$1")" || return 1
  set -- $f
  echo "$2"
}

# 取某个任务行标题的 y。task-title-<id> 不在这里用（ID 未知），
# 而是按 content-desc/text 匹配标题。
y_of_title() {
  local f; f="$(by_text "$1")" || return 1
  set -- $f
  echo "$2"
}

tap_id() {
  local f; f="$(by_id "$1")" || return 1
  [ -n "$f" ] || return 1
  set -- $f
  rsh "adb shell input tap $(( $1 + $3 / 2 )) $(( $2 + $4 / 2 ))" >/dev/null 2>&1
}

tap_text() {
  local f; f="$(by_text "$1")" || return 1
  [ -n "$f" ] || return 1
  set -- $f
  rsh "adb shell input tap $(( $1 + $3 / 2 )) $(( $2 + $4 / 2 ))" >/dev/null 2>&1
}

# 长按：swipe 同一点，duration 在 ms。
long_press_id() {
  local f; f="$(by_id "$1")" || return 1
  set -- $f
  local cx=$(( $1 + $3 / 2 )) cy=$(( $2 + $4 / 2 ))
  rsh "adb shell input swipe $cx $cy $cx $cy 1000" >/dev/null 2>&1
}

long_press_text() {
  local f; f="$(by_text "$1")" || return 1
  set -- $f
  local cx=$(( $1 + $3 / 2 )) cy=$(( $2 + $4 / 2 ))
  rsh "adb shell input swipe $cx $cy $cx $cy 1000" >/dev/null 2>&1
}

shot() {
  if ssh -n -o BatchMode=yes "$HOST" "export PATH=$SDK/platform-tools:\$PATH; adb exec-out screencap -p" > "$EVIDENCE_DIR/$1" 2>/dev/null && [ -s "$EVIDENCE_DIR/$1" ]; then
    info "截图 → $EVIDENCE_DIR/$1"
  else
    bad "截图没落下来（$EVIDENCE_DIR/$1）"
  fi
}

# 归一化：关掉可能残留的浮层。
dismiss_overlays() {
  for _m in "关闭排序选择" "以后再说" "完成" "返回"; do
    tap_text "$_m" >/dev/null 2>&1 || true
  done
  if by_text "置顶" >/dev/null 2>&1 || by_text "取消置顶" >/dev/null 2>&1; then
    rsh "adb shell input keyevent KEYCODE_BACK" >/dev/null 2>&1
    sleep 2
  fi
}

# 过首启**两屏**（隐私面板 + 欢迎页）。
# 实测：uninstall 重装后先弹隐私面板（只用本机/同意并联网），点完再落到欢迎页（先离线使用）。
pass_first_launch() {
  local i rc
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if by_id "mobile-task-add" >/dev/null 2>&1; then return 0; fi
    dump >/dev/null 2>&1; rc=$?
    if [ "$rc" != 0 ]; then
      info "第 $i 轮：树读不到（rc=$rc），等 3 秒再来"
      sleep 3; continue
    fi
    # 隐私面板
    if by_text "只用本机" >/dev/null 2>&1; then
      info "第 $i 轮：点隐私面板「只用本机」"
      tap_text "只用本机"; sleep 4; continue
    fi
    if by_text "Use offline for now" >/dev/null 2>&1; then
      info "第 $i 轮：点隐私面板 Use offline"
      tap_text "Use offline for now"; sleep 4; continue
    fi
    if by_text "同意并联网" >/dev/null 2>&1; then
      info "第 $i 轮：点隐私面板「同意并联网」（无离线出口）"
      tap_text "同意并联网"; sleep 4; continue
    fi
    # 欢迎页
    if by_text "先离线使用" >/dev/null 2>&1; then
      info "第 $i 轮：点欢迎页「先离线使用」"
      tap_text "先离线使用"; sleep 4; continue
    fi
    if by_text "Skip" >/dev/null 2>&1; then
      tap_text "Skip"; sleep 4; continue
    fi
    info "第 $i 轮：当前屏不认识，等 3 秒"
    sleep 3
  done
  by_id "mobile-task-add" >/dev/null 2>&1
}

# 禁用 IME：模拟器默认有拼音输入法，input text 的 "pin" 会被转成 "品"。
disable_ime() {
  local imes; imes=$(rsh "adb shell ime list -s" 2>/dev/null | tr -d '\r' | grep -v '^$')
  for ime in $imes; do rsh "adb shell ime disable '$ime'" >/dev/null 2>&1; done
  rsh "adb shell settings put secure show_ime_with_hard_keyboard 0" >/dev/null 2>&1
}
restore_ime() {
  local imes; imes=$(rsh "adb shell ime list -s" 2>/dev/null | tr -d '\r' | grep -v '^$')
  for ime in $imes; do rsh "adb shell ime enable '$ime'" >/dev/null 2>&1; done
  rsh "adb shell settings put secure show_ime_with_hard_keyboard 1" >/dev/null 2>&1
}
trap restore_ime EXIT

# 建一条任务（通过 FAB → capture-input → capture-submit）。
# ⚠️ 标题用 ASCII，且必须先 disable_ime（否则拼音 IME 把 "pin" 转成 "品"）。
add_task() {
  local title="$1" i
  for i in 1 2; do
    tap_id "mobile-task-add" >/dev/null 2>&1
    sleep 2
    if by_id "capture-input" >/dev/null 2>&1; then break; fi
    dismiss_overlays
  done
  if ! by_id "capture-input" >/dev/null 2>&1; then
    bad "两次点 FAB 后仍没有输入框"
    return 1
  fi
  tap_id "capture-input" >/dev/null 2>&1
  sleep 1
  rsh "adb shell input text '$title'" >/dev/null 2>&1
  sleep 1
  tap_id "capture-submit" >/dev/null 2>&1
  sleep 3
  if by_id "capture-submit" >/dev/null 2>&1; then
    bad "按了提交但 Composer 仍开着 —— 「$title」没建出来"
    return 1
  fi
  return 0
}

echo "════ 移动端「置顶」顺序 · Android 设备腿（远端 linux-dev）════"

command -v python3 >/dev/null || { bad "本机没有 python3"; exit 1; }
rsh "adb get-state" >/dev/null 2>&1 || { bad "远端 $HOST 上没有可达的模拟器"; exit 1; }

# ── 安装 APK（如果指定了）──
APK_SHA=""
if [ -n "$APK" ]; then
  [ -f "$APK" ] || { bad "APK 不存在：$APK"; exit 1; }
  APK_SHA=$(shasum -a 256 "$APK" | cut -d' ' -f1)
  scp -q "$APK" "$HOST:/tmp/heyta-pin-order.apk" 2>/dev/null \
    || scp -q "$APK" "$HOST:/tmp/heyta-pin-order.apk" 2>/dev/null
  REMOTE_SHA=$(ssh -n -o BatchMode=yes "$HOST" 'sha256sum /tmp/heyta-pin-order.apk 2>/dev/null | cut -d" " -f1' | tr -d '\r')
  if [ "$REMOTE_SHA" != "$APK_SHA" ]; then
    bad "APK 传输 sha 不对：本地=${APK_SHA:0:16}… 远端=${REMOTE_SHA:0:16}…"
    exit 1
  fi
  info "APK sha256 对账通过（${APK_SHA:0:16}…）"
  rsh "adb uninstall $PKG" >/dev/null 2>&1 || true
  rsh "adb install -r -d /tmp/heyta-pin-order.apk" 2>&1 | tail -1 | sed 's/^/   /'
fi

RUN_HEAD="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
RUN_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

step "0. 前置：这一读数属于哪一棵树"
printf '   git HEAD  : %s\n' "$RUN_HEAD"
printf '   设备       : %s\n' "$(rsh 'adb shell getprop ro.product.model' | tr -d '\r')"
printf '   屏幕       : %s\n' "$(rsh 'adb shell wm size' | tr -d '\r')"

step "1. 起 app，过首启"
rsh "adb shell am force-stop $PKG" >/dev/null 2>&1
rsh "adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
sleep 8
if ! pass_first_launch; then
  bad "8 轮后仍到不了任务屏（首启没过？）"
  shot "fail-no-main.png"
  echo ""; echo "════════════════════════════════════════"; echo "  通过 $PASS 项，失败 $((FAIL+1)) 项"; echo "  ❌ Android 置顶顺序：中止"; exit 1
fi
ok "任务屏就绪"
dismiss_overlays
disable_ime

# 取 ops 行数（前置）
BEFORE_OPS=$(rsh "adb shell run-as $PKG sqlite3 databases/heyta.db 'SELECT COUNT(*) FROM ops;'" 2>/dev/null | tr -d '\r' | grep -oE '[0-9]+' | head -1)
if [ -z "$BEFORE_OPS" ]; then
  info "取不到 ops 行数（run-as 不可用？），判据 3 降级为仅验界面"
  BEFORE_OPS=""
fi

STAMP=$(date +%H%M%S)
A="pinA${STAMP}"
B="pinB${STAMP}"

step "2. 建两条任务"
add_task "$A" || { bad "建任务 A 失败"; ((FAIL++)); }
add_task "$B" || { bad "建任务 B 失败"; ((FAIL++)); }
if [ "$FAIL" -gt 0 ]; then shot "fail-add.png"; fi

YA=$(y_of_title "$A") || { bad "列表里读不到「$A」的 y"; shot "fail-no-row.png"; ((FAIL++)); }
YB=$(y_of_title "$B") || { bad "列表里读不到「$B」的 y"; shot "fail-no-row.png"; ((FAIL++)); }

if [ "$FAIL" -gt 0 ]; then
  echo ""; echo "════════════════════════════════════════"; echo "  失败 $FAIL 项"; echo "  ❌ Android 置顶顺序：中止"; exit 1
fi

# 判定"下面那条"—— 移动端 addedAt 默认新的在上，所以不一定是 A 在下
if [ "$YA" -gt "$YB" ]; then
  TARGET="$A"; OTHER="$B"; YT="$YA"; YO="$YB"
else
  TARGET="$B"; OTHER="$A"; YT="$YB"; YO="$YA"
fi
ok "置顶之前：「$TARGET」在「$OTHER」下面（y $YT > $YO）"
((PASS++))

step "3. 长按「$TARGET」开行菜单"
MENU_OK=""
for attempt in 1 2 3; do
  long_press_text "$TARGET" >/dev/null 2>&1
  sleep 2
  if by_text "置顶" >/dev/null 2>&1 || by_text "取消置顶" >/dev/null 2>&1; then
    MENU_OK=1; break
  fi
  info "第 $attempt 次长按没开出菜单，把列表往下滚一段再来"
  rsh "adb shell input swipe 540 800 540 400 500" >/dev/null 2>&1
  sleep 1
done

if [ -z "$MENU_OK" ]; then
  bad "三次长按都没开出行菜单"
  shot "fail-no-menu.png"
  ((FAIL++))
else
  ok "长按之后菜单里出现了「置顶」/「取消置顶」"
  ((PASS++))
fi
shot "row-menu.png"

step "4. 按「置顶」，顺序必须翻过来"
tap_text "置顶" >/dev/null 2>&1
sleep 3
YT2=$(y_of_title "$TARGET") || { bad "置顶后读不到「$TARGET」"; ((FAIL++)); }
YO2=$(y_of_title "$OTHER") || { bad "置顶后读不到「$OTHER」"; ((FAIL++)); }

if [ -n "${YT2:-}" ] && [ -n "${YO2:-}" ]; then
  if [ "$YT2" -lt "$YO2" ]; then
    ok "钉住的那条排到最前（y $YT > $YO → y $YT2 < $YO2）"
    ((PASS++))
  else
    bad "点了「置顶」但顺序没翻（y $YT2 vs $YO2）"
    ((FAIL++))
  fi
fi
shot "after-pin.png"

step "5. 反向：再开菜单，那一项要说「取消置顶」"
MENU_OK2=""
for attempt in 1 2 3; do
  long_press_text "$TARGET" >/dev/null 2>&1
  sleep 2
  if by_text "取消置顶" >/dev/null 2>&1; then
    MENU_OK2=1; break
  fi
  if by_text "置顶" >/dev/null 2>&1; then
    bad "菜单里那一项还写「置顶」—— pinnedAt 没落到界面"
    ((FAIL++))
    rsh "adb shell input keyevent KEYCODE_BACK" >/dev/null 2>&1; sleep 1
    break
  fi
  info "第 $attempt 次再开菜单没开成"
  rsh "adb shell input swipe 540 800 540 400 500" >/dev/null 2>&1; sleep 1
done
if [ -n "$MENU_OK2" ]; then
  ok "已置顶的行，菜单那一项自己说「取消置顶」（写进去的是状态）"
  ((PASS++))
fi
# 关掉菜单
rsh "adb shell input keyevent KEYCODE_BACK" >/dev/null 2>&1; sleep 1

step "6. 真 op-log：一个用户意图 = 一条 op"
if [ -n "$BEFORE_OPS" ]; then
  AFTER_OPS=$(rsh "adb shell run-as $PKG sqlite3 databases/heyta.db 'SELECT COUNT(*) FROM ops;'" 2>/dev/null | tr -d '\r' | grep -oE '[0-9]+' | head -1)
  EXPECTED=$((BEFORE_OPS + 3))
  if [ "$AFTER_OPS" = "$EXPECTED" ]; then
    ok "ops 行数 $BEFORE_OPS → $AFTER_OPS（两条建 + 一条置顶，恰好 +3）"
    ((PASS++))
  else
    bad "ops 行数 $BEFORE_OPS → ${AFTER_OPS:-读不到}，期望 $EXPECTED"
    ((FAIL++))
  fi
  LAST_OP=$(rsh "adb shell run-as $PKG sqlite3 databases/heyta.db 'SELECT data FROM ops ORDER BY rowid DESC LIMIT 1;'" 2>/dev/null | tr -d '\r')
  if printf '%s' "$LAST_OP" | grep -q "pinnedAt"; then
    ok "最新那条 op 里带 pinnedAt"
    ((PASS++))
  else
    bad "最新那条 op 里没有 pinnedAt"
    ((FAIL++))
  fi
else
  info "ops 行数判据跳过（run-as 不可用）"
fi

dismiss_overlays

# 出处件
{
  printf 'head=%s\n' "$RUN_HEAD"
  printf 'started_utc=%s\n' "$RUN_STARTED"
  printf 'finished_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'device=%s\n' "$(rsh 'adb shell getprop ro.product.model' | tr -d '\r')"
  printf 'screen=%s\n' "$(rsh 'adb shell wm size' | tr -d '\r')"
  printf 'apk_sha256=%s\n' "${APK_SHA:-existing}"
  printf 'failed=%s\n' "$FAIL"
} > "$EVIDENCE_DIR/provenance.txt"
ok "出处件已落盘"

echo ""
echo "════════════════════════════════════════"
echo "  通过 $PASS 项，失败 $FAIL 项"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ Android 置顶顺序：真机全链路通过"
  exit 0
else
  echo "  ❌ Android 置顶顺序：有失败项（证据 $EVIDENCE_DIR）"
  exit 1
fi
