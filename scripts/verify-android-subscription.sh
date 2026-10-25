#!/usr/bin/env bash
#
# 移动端「订阅」一节 + 「?」气泡的**像素腿 · Android 版**（无头模拟器，跑在远端 Linux 宿主上）
# ==================================================================================
#
# 与 iOS 那条（`verify-mobile-ios-subscription.sh`）**判同一件事**，只是载具不同：
#
#   iOS  : 本机模拟器 + idb（AX 树里 testID 落在 `AXUniqueId`，`?` 与标题会被合并成一个节点
#          ⇒ 只能按坐标点，脚本里那 11 个候选 x 偏移就是为此存在的自校准）
#   Android: 远端宿主上的 headless 模拟器 + `uiautomator dump`
#          ⇒ **每个节点都有 `resource-id` 与 `bounds`**，`?` 是独立节点（`<row-testID>-tip`），
#            所以这里不需要猜坐标：点它的中心。这一版比 iOS 那版**更硬**。
#
# 判据（与 iOS 一一对应）：
#   ① 「我的/Profile」页里有 `profile-entry-subscription` 那一行（写了却到不了 = 没写）
#   ② hint 默认**不在**树上（说明文字不占屏）—— 判 `?` 节点的 text 是否为空 + 全文搜 hint
#   ③ 点 `?` → hint 出现在树上；再点 → 又不在
#   ④ 订阅页有 lead / 「买哪一档」/ 两档标价 / CTA / 脚注；未登录按下说人话
#
# ⚠️ **语言**：模拟器的**系统** locale 是 en-US（`ro.product.locale`）。要让这条腿量中文，
#    先给**这个包**设 per-app locale（API 33+；设完必须重装或重启 app 才生效）：
#
#      adb shell cmd locale set-app-locales com.heyta --locales zh-CN
#
#    脚本**自己判断**界面语言（首启面板/底部标签是英文还是中文），并把量的是哪一档打出来 ——
#    两套 needle 都来自 `packages/i18n`，不另写文案。**别把"界面是中文"读成"系统是中文"**。
#
# 前置（脚本自己会查，查不到就响亮失败）：
#   · 远端宿主可达（`ANDROID_HOST`，默认 `linux-dev`）且上面有一台 **booted** 的模拟器
#   · app 已装（`com.heyta`）；要连装一起做：`APK=<path> bash scripts/verify-android-subscription.sh`
#   · 不需要服务端：拒单那句由壳自己说（未登录那一支），不发请求
#
# 🔴 与 iOS 版同样**不**证明"能买到"：真下单要真服务端 + 真账号。
#
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${ANDROID_HOST:-linux-dev}"
SDK="${ANDROID_SDK_ON_HOST:-$HOME/.local/opt/android-sdk}"   # 远端宿主上的字面路径（$HOME 在远端展开）
PKG="${PKG:-com.heyta}"
APK="${APK:-}"
OUT_DIR="${OUT_DIR:-$ROOT/apps/mobile/evidence/subscription-android-$(date +%Y%m%d)}"
LOCAL_XML="$ROOT/.run-logs/android-sub/ui.xml"

mkdir -p "$OUT_DIR" "$(dirname "$LOCAL_XML")"

ok() { printf '   ✅ %s\n' "$1"; }
bad() { printf '   ❌ %s\n' "$1" >&2; }
info() { printf '   · %s\n' "$1"; }

# 远端执行（PATH 里先塞 adb；SDK 路径**逐字**传给远端，别在本地展开）
rsh() { ssh -o BatchMode=yes "$HOST" "export PATH=$SDK/platform-tools:\$PATH; $*"; }

dump() {   # 把当前界面拉到 $LOCAL_XML
  rm -f "$LOCAL_XML"
  # 🔴 **不要** dump 到 `/sdcard/` 再 `scp` 回来：这台宿主上 `scp host:/sdcard/x` 会
  #    "No such file or directory"（`/sdcard` 是 sdcardfs 挂载点，sshd 那侧读不到），
  #    而 `adb pull`/`adb exec-out` 走的是 adb 通道 —— 第一版就是这么"20 轮都认不出界面"的，
  #    真因不是模拟器，是**取树这一步静默失败**（元规则一：先怀疑探针）。
  rsh "adb shell uiautomator dump /data/local/tmp/heyta-sub.xml >/dev/null 2>&1"
  ssh -o BatchMode=yes "$HOST" "export PATH=$SDK/platform-tools:\$PATH; adb exec-out cat /data/local/tmp/heyta-sub.xml" > "$LOCAL_XML" 2>/dev/null || return 2
  [ -s "$LOCAL_XML" ] || return 2
  head -c 5 "$LOCAL_XML" | grep -q '<?xml' || return 2
}

# 0=有 / 1=没有 / 2=读不到树（三档必须分开）
needle_state() {
  dump || return 2
  python3 - "$LOCAL_XML" "$1" <<'PY'
import sys, unicodedata, xml.etree.ElementTree as ET
path, needle = sys.argv[1], unicodedata.normalize("NFKC", sys.argv[2])
try: root = ET.parse(path).getroot()
except Exception: sys.exit(2)
for n in root.iter('node'):
    for attr in ('text', 'content-desc'):
        v = unicodedata.normalize("NFKC", n.get(attr, ''))
        if needle in v: sys.exit(0)
sys.exit(1)
PY
}

# 按 resource-id 找节点，打印 "x y w h"（找不到打印空，读不到树 rc=2）
node_frame() {
  dump || return 2
  python3 - "$LOCAL_XML" "$1" <<'PY'
import sys, re, xml.etree.ElementTree as ET
path, want = sys.argv[1], sys.argv[2]
try: root = ET.parse(path).getroot()
except Exception: sys.exit(2)
for n in root.iter('node'):
    if n.get('resource-id') == want:
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds', ''))
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            print(f'{x1} {y1} {x2-x1} {y2-y1}')
            sys.exit(0)
sys.exit(1)
PY
}

tap() { rsh "adb shell input tap $1 $2" >/dev/null 2>&1; }
tap_center() { tap "$(( $1 + $3 / 2 ))" "$(( $2 + $4 / 2 ))"; }
type_ok() { dump || return 2; }

shot() {   # 截图同理：走 adb 通道直接落到本地（不经 /sdcard）
  if ssh -o BatchMode=yes "$HOST" "export PATH=$SDK/platform-tools:\$PATH; adb exec-out screencap -p" > "$OUT_DIR/$1" 2>/dev/null && [ -s "$OUT_DIR/$1" ]; then
    info "截图 → $OUT_DIR/$1"
  else
    bad "截图没落下来（$OUT_DIR/$1）"
  fi
}

# ── 语言与文案（两套都来自 packages/i18n，不另写） ─────────────────────
# 🔴 必须在 `pass_first_launch` **之前**调用：首启那两枚面板本身也分中英，
#    而它们的中英文案只有先知道语言才选得出来（第一版把顺序写反了 ⇒ `AGREE: unbound variable`）。
#    判语言的探针**同时**认首启面板与底部标签，所以哪一屏上都成立。
pick_locale() {
  local en=1 zh=1
  needle_state "Agree and connect"; [ $? = 0 ] && en=0
  needle_state "Profile";           [ $? = 0 ] && en=0
  needle_state "同意并联网";         [ $? = 0 ] && zh=0
  needle_state "我的";               [ $? = 0 ] && zh=0
  if [ "$en" = 0 ] && [ "$zh" = 0 ]; then
    bad "同一屏上既有英文 needle 又有中文 needle ⇒ 判不了语言（截图看看）"; return 1
  elif [ "$en" = 0 ]; then UI=en
  elif [ "$zh" = 0 ]; then UI=zh
  else
    bad "既没看到英文 needle 也没看到中文 needle ⇒ 判不了界面语言，停"; return 1
  fi
  if [ "$UI" = "en" ]; then
    T_PROFILE="Profile"; T_SETTINGS="Settings"
    LEAD="Hosted sync: current status, plan choice and checkout"
    TIER_TITLE="Which plan"; PRICE_A="CNY 5 / month"; PRICE_B="CNY 12 / month"
    CTA="Subscribe to this plan"; FOOTNOTE="A subscription only pays for us running the sync server"
    HINT="Subscription and renewal for hosted sync"
    SIGNED_OUT="Sign in to your heyta account before placing an order."
    AGREE="Agree and connect"; OFFLINE="Use offline for now"
  else
    T_PROFILE="我的"; T_SETTINGS="设置"
    LEAD="官方托管同步：当前状态、选档与下单"
    TIER_TITLE="买哪一档"; PRICE_A="¥5 / 月"; PRICE_B="¥12 / 月"
    CTA="订阅这一档"; FOOTNOTE="订阅只买"
    HINT="官方托管同步的订阅与续费"
    SIGNED_OUT="先登录你的 heyta 账号，才能下单。"
    AGREE="同意并联网"; OFFLINE="先离线使用"
  fi
  local sysloc; sysloc="$(rsh "adb shell getprop ro.product.locale" | tr -d '\r')"
  info "界面语言 = ${UI}（系统 locale = ${sysloc}；这里的 ${UI} 是 app 自己的语言偏好，见文件头）"
}

pass_first_launch() {
  local i
  for i in 1 2 3 4 5 6; do
    needle_state "$AGREE";   [ $? = 0 ] && { tap_cnt_desc "$AGREE";   sleep 3; ok "已点「${AGREE}」"; continue; }
    needle_state "$OFFLINE"; [ $? = 0 ] && { tap_cnt_desc "$OFFLINE"; sleep 3; ok "已点「${OFFLINE}」"; continue; }
    return 0
  done
  bad "六轮之后首启面板还挂着"; return 1
}

# 按 content-desc 点（Android 上 RN 的可点元素都有 content-desc）
tap_cnt_desc() {
  dump || return 2
  local xy
  xy="$(python3 - "$LOCAL_XML" "$1" <<'PY'
import sys, re, xml.etree.ElementTree as ET
path, want = sys.argv[1], sys.argv[2]
root = ET.parse(path).getroot()
for n in root.iter('node'):
    if n.get('content-desc','').strip() == want or n.get('text','').strip() == want:
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds',''))
        if m:
            x1,y1,x2,y2 = map(int, m.groups()); print((x1+x2)//2, (y1+y2)//2); sys.exit(0)
sys.exit(1)
PY
)" || return 1
  tap ${xy}
}

# ── 主流程 ─────────────────────────────────────────────────────────────
main() {
  command -v python3 >/dev/null || { bad "没有 python3"; exit 1; }
  rsh "adb get-state" >/dev/null 2>&1 || { bad "远端 ${HOST} 上没有可达的模拟器（adb devices 空？）"; exit 1; }

  echo "════ 移动端「订阅」一节 + 「?」气泡 · Android 设备腿 ════"
  echo "   宿主 ${HOST} · 屏幕 $(rsh 'adb shell wm size | tr -d "\r"') · $(rsh 'adb shell wm density | tr -d "\r"')"
  echo "   证据 $OUT_DIR"

  if [ -n "$APK" ]; then
    [ -f "$APK" ] || { bad "APK 不存在：$APK"; exit 1; }
    scp -q "$APK" "$HOST:/tmp/heyta-sub.apk" || { bad "传不上去"; exit 1; }
    rsh "adb uninstall $PKG" >/dev/null 2>&1
    rsh "adb install -r -d /tmp/heyta-sub.apk" 2>&1 | tail -1
    ok "已从当前产物重装（$(basename "$APK")，$(stat -f%z "$APK") 字节）"
  fi

  rsh "adb shell am force-stop $PKG" >/dev/null 2>&1
  rsh "adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
  # 🔴 固定 `sleep 8` 在模拟器冷启时会读到空白树 ⇒ 判语言那一步会误报"认不出"。
  #    改成**轮询到某一枚可认的 needle 出现**（最多 60s），认不出再停。
  local i ready=""
  for i in $(seq 1 20); do
    sleep 3
    needle_state "agree and connect" >/dev/null 2>&1
    dump >/dev/null 2>&1 || continue
    if python3 - "$LOCAL_XML" <<'PY2'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
hits = ("Agree and connect", "同意并联网", "This device only", "只用本机", "Profile", "我的")
for n in root.iter('node'):
    v = n.get('text','') + '|' + n.get('content-desc','')
    if any(h in v for h in hits): sys.exit(0)
sys.exit(1)
PY2
    then ready=1; break; fi
  done
  [ -n "$ready" ] && ok "界面已就绪（轮询 ${i} 轮）" || { bad "20 轮（约 60s）之后界面上仍认不出任何已知 needle ⇒ 停"; exit 1; }
  pick_locale || exit 1
  pass_first_launch || exit 1

  # ①入口 + ②默认不占屏
  tap_cnt_desc "$T_PROFILE" >/dev/null || { bad "点不到 Profile/我的 标签"; exit 1; }
  sleep 4
  rsh "adb shell input swipe 540 1500 540 700 300" >/dev/null 2>&1; sleep 1
  rsh "adb shell input swipe 540 1500 540 700 300" >/dev/null 2>&1; sleep 2

  local f rc x y w h
  f="$(node_frame profile-entry-subscription)"; rc=$?
  [ "$rc" = 2 ] && { bad "读不到 UI 树 ⇒ 这一条没有被证明"; exit 1; }
  [ "$rc" != 0 ] && { bad "「我的」页上没有 profile-entry-subscription ⇒ 订阅入口到不了"; exit 1; }
  x=$(echo "$f"|awk '{print $1}'); y=$(echo "$f"|awk '{print $2}'); w=$(echo "$f"|awk '{print $3}'); h=$(echo "$f"|awk '{print $4}')
  ok "「我的」页有订阅入口（resource-id=profile-entry-subscription，bounds=($x,$y,${w}x${h})）"

  needle_state "$HINT"; rc=$?
  [ "$rc" = 2 ] && { bad "读不到树 ⇒ 默认不占屏没有被证明"; exit 1; }
  [ "$rc" = 0 ] && { bad "hint 默认就在树上 ⇒ 「?」没拦住说明文字"; exit 1; }
  ok "hint「${HINT}」默认**不在**树上"
  shot "00-tip-collapsed.png"

  # ③ 点 `?` —— Android 上它是**独立节点**，直接点它的中心（比 iOS 那版硬）
  f="$(node_frame profile-entry-subscription-tip)"; rc=$?
  [ "$rc" != 0 ] && { bad "找不到 profile-entry-subscription-tip 节点 ⇒ 「?」不在这一行上"; exit 1; }
  x=$(echo "$f"|awk '{print $1}'); y=$(echo "$f"|awk '{print $2}'); w=$(echo "$f"|awk '{print $3}'); h=$(echo "$f"|awk '{print $4}')
  tap_center "$x" "$y" "$w" "$h"; sleep 1
  needle_state "$HINT"; rc=$?
  [ "$rc" != 0 ] && { bad "点了「?」正文没出现（rc=${rc}；2=树读不出）"; exit 1; }
  ok "点「?」展开成功（点的是 tip 节点中心 $((x+w/2)),$((y+h/2))）"
  shot "01-tip-expanded.png"

  tap_center "$x" "$y" "$w" "$h"; sleep 1
  needle_state "$HINT"; rc=$?
  [ "$rc" = 2 ] && { bad "收起后树读不出 ⇒ 没被证明"; exit 1; }
  [ "$rc" = 0 ] && { bad "再点一下正文还在 ⇒ 只开不合"; exit 1; }
  ok "再点一下收起"

  # ④ 进订阅页
  f="$(node_frame profile-entry-subscription)"
  x=$(echo "$f"|awk '{print $1}'); y=$(echo "$f"|awk '{print $2}'); w=$(echo "$f"|awk '{print $3}'); h=$(echo "$f"|awk '{print $4}')
  tap_center "$x" "$y" "$w" "$h"; sleep 3
  shot "02-subscription-screen.png"

  local n
  for n in "$LEAD" "$TIER_TITLE" "$PRICE_A" "$PRICE_B"; do
    needle_state "$n"; rc=$?
    [ "$rc" = 2 ] && { bad "读不到树 ⇒ 「${n}」没被证明"; exit 1; }
    [ "$rc" != 0 ] && { bad "订阅页上没有「${n}」"; exit 1; }
    ok "订阅页有「${n}」"
  done

  # 🔴 CTA 与脚注在**首屏之外**（两档卡片把这一屏占满了）：`uiautomator dump` 只吐可见节点，
  #    所以必须先把它们滚进视野再判 —— 不滚就断言 = 拿"没滚到"当"没画"（探针失手记成产品缺陷）。
  local sw
  for sw in 1 2 3 4; do
    needle_state "$CTA"; [ $? = 0 ] && break
    rsh "adb shell input swipe 540 1500 540 800 300" >/dev/null 2>&1; sleep 1
  done
  for n in "$CTA" "$FOOTNOTE"; do
    needle_state "$n"; rc=$?
    [ "$rc" = 2 ] && { bad "读不到树 ⇒ 「${n}」没被证明"; exit 1; }
    [ "$rc" != 0 ] && { bad "滚到底也没有「${n}」⇒ 这一屏没画全"; exit 1; }
    ok "订阅页有「${n}」（滚动 ${sw} 次后可见）"
  done
  shot "02b-subscription-screen-bottom.png"

  tap_cnt_desc "$CTA" >/dev/null || { bad "点不到「${CTA}」"; exit 1; }
  sleep 3
  needle_state "$SIGNED_OUT"; rc=$?
  [ "$rc" = 2 ] && { bad "读不到树 ⇒ 未登录拒单那句没被证明"; exit 1; }
  [ "$rc" != 0 ] && { bad "按下「${CTA}」之后没有「${SIGNED_OUT}」⇒ 失败被吞了"; exit 1; }
  ok "未登录按下「${CTA}」→ 界面上有「${SIGNED_OUT}」"
  shot "03-signed-out-refusal.png"

  echo ""
  echo "════ 结论 ════"
  ok "Android 上：订阅一节到得了、画得全、未登录按下说人话"
  ok "「?」默认不占屏 / 点开 / 再点收起 —— 三条都在真 UI 树上量的（界面语言 ${UI}）"
  echo "   ⚠️ 不证明「能买到」：真下单要真服务端 + 真账号（见文件头）。"
  echo "   ⚠️ 界面语言 ${UI} 来自 **app 自己的语言偏好**（这台模拟器的系统 locale 是 en-US）；"
  echo "      zh 那一档是怎么设的见文件头「语言」那一段 —— 别把它读成"系统是中文"。"
}

main "$@"
