#!/bin/bash
#
# W7 · 纪念卡片「设备出图」真机验收（Android，零 mock）
# =====================================================================
#
# 🔴 为什么必须有这个脚本
#
# 成品图在 web 上已经有五条判据 + 六张人看过的图（`e2e/tests/countdown-export.spec.ts`），
# 移动端只有 node 侧的四档折算单测。单测能证"折算逻辑按 density 乘回去等于契约值"，
# **证不了 RN 真的栅格化、原生真的把字节写成了那张图**。缺的正是
# `packages/ui/src/countdown/card-export-layout.ts` 文件头那张表所主张的事：
# **出厂尺寸在每一端都应当是契约那一对数**。编号 `W7-G1`（真机 IHDR 未取）与
# `W7-G2`（折算仍是推的）就堵在这里，判据写在那份文档 §2.4。
#
# 三件容易混的事，本脚本分开证（判据编号即顺序）：
#   ① 探针有牙：PNG 读数器喂两枚已知图 —— 一张必须读回契约值、另一张必须读回**不同**的值。
#      （不做这一步，后面"设备出图 = 契约"可能是恒真断言。§7 元规则二。）
#   ② 点了 ⇒ 生效了：点导出**前**缓存目录里没有那个文件名，点之后必须出现。
#   ③ 字节真是契约尺寸：拉回宿主机数出宽/高，逐字等于契约常量。
#
# ⚠️ 这一趟**不**主张"分享成功送达了某个目标"。原生模块在 `Share.share` **之前**就把字节
#   写进 `cacheDir/card-export/`（`apps/mobile/src/lib/card-export-native.ts`），
#   所以分享面板开不开、有没有可选目标，与"设备出不出得来这张图"是两件事。
#   面板若出现就按 BACK 收掉，**作为读数打印**，不作为判据。
#
# ⚠️ 卡片上的竖条**可能不是主蓝**：`EventBoard.tsx:641` 在没选过模板时故意用
#   `color.surface-sunken`。所以这一趟不拿"含品牌蓝"当判据（那会把一条设计事实测成缺陷），
#   只判"不是空白 / 没有透明像素 / 尺寸逐字对"。
#
# 用法：
#   bash scripts/verify-mobile-card-export.sh
#   HEYTA_CARD_EXPORT_ALLOW_STALE=1 bash scripts/verify-mobile-card-export.sh   # 显式跨过新鲜度门
#
# 前置：Android 模拟器在跑（`$HEYTA_E2E_SERIAL`，默认 emulator-5554），且装的是当前源码的包。
#       **不需要服务端、不需要账号** —— 这条通道本地优先，凭据配不配都该画得出图。
#
# 退出码：0 = 判据全过；1 = 有断言失败（产品问题）；3 = 环境不成立（负载 / 设备 / 读通道 /
#         产物过期 / 探针取不到输入），**不是产品失败**。三个不混。
#
# ⚠️ 与同族脚本的一条差别：这里**不做 `pm clear`**。本验收只需要"屏上有一张卡"，
#    自建一条带 ASCII 戳的即可；清库会把别人的现场（以及并行那条移动端线的账）一起抹掉，
#    而这份便利本脚本用不上（AGENTS §8.9 共享资源）。

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 按字节偏移增量读取脚本：
#    运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。入口先把整份脚本拷成
#    同目录隐藏快照再 exec 副本；$0 的 dirname 不变，lib 定位照旧。
case "$(basename "$0")" in
  .*.snap.*) ;;
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
trap 'rm -f -- "$0"' EXIT

set -u
export PATH="/opt/homebrew/bin:$PATH"

. "$(dirname "$0")/lib/mobile-e2e.sh"
. "$(dirname "$0")/lib/wait-for-quiet-host.sh"
# 取值层（READER / zh / contract / read_png / field / 判据①自检）的**单一所有者**在
# lib/card-export-probe.sh —— iOS 那一半（verify-mobile-card-export-ios.sh）source 同一个文件。
. "$(dirname "$0")/lib/card-export-probe.sh"
EVIDENCE_DIR="$HEYTA_REPO_ROOT/apps/mobile/evidence/card-export"
CACHE_ON_DEVICE="/data/data/$PKG/cache/card-export"
STAMP=$(date +%H%M%S)
# 🔴 标题必须 ASCII：`adb shell input text` 发不了非 ASCII（实测抛异常却可能退 0，§7 #43）。
CARD_TITLE="w7e2e-$STAMP"

# 🔴 软键盘：整轮关掉，退出一定恢复（`input text` 只要焦点在就能注入，不需要 IME 可见）。
disable_ime
trap 'restore_ime' EXIT

step "0. 现场门：设备在线、没有别的移动端验收、宿主机负载"
if ! $ADB get-state >/dev/null 2>&1; then
  echo "❌ 设备 $E2E_SERIAL 不在线 —— 本轮无效（不是产品失败）"; exit 3
fi
BUSY=$(another_mobile_e2e_running)
if [ -n "$BUSY" ]; then
  echo "❌ 这台设备上还有别的移动端验收在跑：$BUSY"
  echo "   两边都往同一块屏幕按坐标，并行 = 互相制造「找不到按钮」的假红。"
  exit 3
fi
wait_for_quiet_host || exit 3

step "0b. 产物新鲜度：装上的包不许比源码旧（AGENTS §6.1.1、§7 #27/#82）"
# 🔴 这条不是仪式：本仓三次"判据对着旧二进制报绿"。宁可拒跑，也不要在旧 APK 上
#    量出一个"看起来属于本轮"的 IHDR。
APK_LINE=$($ADB shell dumpsys package "$PKG" 2>/dev/null | grep -m1 'lastUpdateTime' | tr -d '\r')
# 🔴 两种形状都得吃：这台模拟器打的是**格式化时间**（`lastUpdateTime=2026-10-04 07:05:07`），
#    旧版 Android 打的是 **epoch 秒**。原先那句 `sed 's/.*=//;s/ .*//'` 对前者得到
#    `2026-10-04`（不是整数），于是"应用没装？"这条读数其实是**探针读不出格式** ——
#    04 07:1x 第一次执行到这一步才照出来（前两次都停在第 0 步的现场门，从没走到 0b）。
APK_RAW=$(printf '%s' "$APK_LINE" | sed 's/.*=//')
APK_EPOCH=''
case "$APK_RAW" in
  ''|*[!0-9]*) ;;                                  # 不是纯数字 ⇒ 走日期那一支
  *) APK_EPOCH=$APK_RAW ;;
esac
if [ -z "$APK_EPOCH" ]; then
  APK_EPOCH=$(date -j -f '%Y-%m-%d %H:%M:%S' "$(printf '%s' "$APK_RAW" | cut -c1-19)" +%s 2>/dev/null || true)
fi
# 1577836800 = 2020-01-01：解析不出、或早于它，都判"探针读不出格式"而不是"包很旧"。
if [ -z "$APK_EPOCH" ] || ! [ "$APK_EPOCH" -eq "$APK_EPOCH" ] 2>/dev/null || [ "$APK_EPOCH" -lt 1577836800 ]; then
  echo "   ❌ 读不出 $PKG 的安装时间：原始行「${APK_LINE:-（空 ⇒ 包没装或 dumpsys 里没这一行）}」"
  echo "      这是**探针读不出格式**，不是产品失败；本轮无效"
  exit 3
fi
echo "   新鲜度门输入（设备侧）：${APK_LINE} ⇒ epoch ${APK_EPOCH}"
NEWEST_SRC=0
for path in apps/mobile/src packages/ui/src/countdown; do
  [ -d "$HEYTA_REPO_ROOT/$path" ] || { echo "   ❌ $path 不在，新鲜度门没有输入（本轮无效）"; exit 3; }
  m=$(find "$HEYTA_REPO_ROOT/$path" -type f \( -name '*.ts' -o -name '*.tsx' \) -exec stat -f %m {} + 2>/dev/null | sort -rn | head -1)
  [ -n "$m" ] && [ "$m" -gt "$NEWEST_SRC" ] && NEWEST_SRC=$m
done
if [ "$NEWEST_SRC" -gt "$APK_EPOCH" ]; then
  echo "   ❌ 装的是旧产物：移动端源码最新 $NEWEST_SRC > 包 ${APK_EPOCH}（${APK_LINE}）"
  echo "      先 pnpm reinstall:mobile（或 build:android + install）。"
  echo "      显式跨过：HEYTA_CARD_EXPORT_ALLOW_STALE=1 —— 但那样本轮读数**不代表当前源码**。"
  [ "${HEYTA_CARD_EXPORT_ALLOW_STALE:-0}" = 1 ] || exit 3
  echo "   ⚠️ 已按显式旋钮跨过新鲜度门"
else
  ok "装的包不比源码旧（${APK_LINE}）"
fi

step "1. 判据①：PNG 读数器读得对，而且**会区分**（走共享自检，两端同一段）"
mkdir -p "$EVIDENCE_DIR"
EXP_W=$(contract EXPORT_CARD_EDGE_PX)
EXP_H=$(contract EXPORT_CARD_HEIGHT_PX)
probe_reader_selfcheck "$EXP_W" "$EXP_H"

step "2. 起应用，走「我的」→ 倒数日（W8 移动半那条注册表）"
ensure_app_foreground
sleep 2
handle_privacy_consent
dismiss_welcome_if_present
dump; require_screen
TAB_LABEL=$(zh mobile.tab.profile)
TAB_XY=$(xy_desc "$TAB_LABEL")
# 🔴 底栏目标**只能走 `xy_desc`，不能走 `scroll_to_text` / `scroll_to_desc`** ——
#    那两个的 `*-sane` 模式带一条 `cy < 2100` 守卫（防"ScrollView 折叠线以下的节点照样在树里、
#    按它的'中心点'下去会跳到别的标签页"，理由写在 lib :1259 那段）。而**底栏自己的中心就在 2100 以下**：
#    「我的」那颗可点的 View 是 `bounds=[864,2169][1080,2337]` ⇒ 中心 2253 ⇒ 被守卫滤掉 ⇒ 恒空。
#    04 07:3x 在同一台设备上量过三种取法：`xy_desc` = **972 2253**、`scroll_to_desc` = **空**、
#    `scroll_to_text` = **空**（屏上明明有「我的」—— 于是"找不到"是探针，不是产品）。
#    这里不写死 `945 2253` 那种字面坐标（§7：坐标每次现取，兄弟脚本里那种硬码是旧账）。
if [ -z "$TAB_XY" ]; then
  echo "   ❌ 底部找不到「${TAB_LABEL}」这一格 —— 先排除探针（词条来自真源）"; screen_txt; exit 3
fi
$ADB shell input tap $TAB_XY; sleep 3
ENTRY_LABEL=$(zh mobile.countdown.entry)
ENTRY_XY=$(scroll_to_text "$ENTRY_LABEL")
if [ -z "$ENTRY_XY" ]; then
  bad "「我的」页里没有倒数日入口「${ENTRY_LABEL}」（`feature-entries.ts` 那一行没渲染？）"; screen_txt
  summary "纪念卡片设备出图（Android）" "入口没开到，判据②③未跑" 1
fi
$ADB shell input tap $ENTRY_XY; sleep 3
VIEW_TITLE=$(zh web.shell.views.countdown)
if settle_for "$VIEW_TITLE" 8 2; then ok "倒数日屏开到前台（标题「${VIEW_TITLE}」）"
else bad "点了入口却没开到倒数日屏"; screen_txt; fi

step "3. 保证屏上有一张卡（空态就现场建一条带 ASCII 戳的）"
dump; require_screen
if grep -qF -- "$(zh web.countdown.empty)" "$UI_XML"; then
  echo "   屏上是空态 ⇒ 建一条：$CARD_TITLE"
  FIELD_XY=$(xy_edit "$(zh web.countdown.composer.placeholder)")
  [ -z "$FIELD_XY" ] && FIELD_XY=$(scroll_to_desc "$(zh web.countdown.composer.placeholder)")
  PICK_XY=$(scroll_to_text "$(zh web.countdown.pickDate)")
  if [ -z "$FIELD_XY" ] || [ -z "$PICK_XY" ]; then
    echo "   ❌ 输入框或「$(zh web.countdown.pickDate)」拿不到 —— 探针未到位（本轮无效）"; screen_txt; exit 3
  fi
  $ADB shell input tap $FIELD_XY; sleep 1
  clear_and_type "$CARD_TITLE"
  $ADB shell input tap $PICK_XY; sleep 2
  DAY_TPL=$(zh mobile.datePicker.dayLabel)
  MON_NUM=$(date -v+7d +%-m 2>/dev/null || date -d '+7 days' +%-m)
  DAY_NUM=$(date -v+7d +%-d 2>/dev/null || date -d '+7 days' +%-d)
  if [ -z "$MON_NUM" ] || [ -z "$DAY_NUM" ]; then
    echo "   ❌ 取不到「7 天后」的月/日 —— 本轮那条日期格没法定位（探针无效）"; exit 3
  fi
  DAY_DESC=$(printf '%s' "$DAY_TPL" | sed "s/{title}//g; s/{month}/$MON_NUM/g; s/{day}/$DAY_NUM/g")
  DAY_XY=$(scroll_to_desc "$DAY_DESC")
  if [ -z "$DAY_XY" ]; then
    echo "   ❌ 日期格里找不到「${DAY_DESC}」—— 模板或默认月份视图与预期不符（本轮无效）"; screen_txt; exit 3
  fi
  $ADB shell input tap $DAY_XY; sleep 1
  ADD_XY=$(scroll_to_text "$(zh web.countdown.add)")
  [ -z "$ADD_XY" ] && { echo "   ❌ 找不到「$(zh web.countdown.add)」"; screen_txt; exit 3; }
  $ADB shell input tap $ADD_XY; sleep 3
  if settle_for "$CARD_TITLE" 8 2; then ok "新卡片上了屏（「点了」之后「看得见」）"
  else bad "建卡之后屏上找不到标题「${CARD_TITLE}」"; screen_txt; fi
else
  echo "   屏上已有卡片，本轮不新增"
  CARD_TITLE=""
fi

step "4. 判据②：点导出**前**那个文件名不存在，点之后必须出现"
# 🔴 读私有目录用 `adb root` + `pull`，**不用 `run-as`** —— 与 `verify-mobile-lists.sh`
#    :89 同一台设备上的同一条结论：装的是 release 包，`run-as` 直接报
#    "package not debuggable"，所以那条通道**根本不该被试**（原先这句错误信息里写着
#    "run-as 与 adb root 都不通"，而代码从没跑过 run-as —— 探针的措辞会把排查方向
#    引去怀疑一条自己没试过的通道）。
$ADB root >/dev/null 2>&1; sleep 2; $ADB wait-for-device >/dev/null 2>&1
if ! $ADB shell "ls $CACHE_ON_DEVICE" >/dev/null 2>&1 && [ -z "$($ADB shell ls /data/data/$PKG 2>/dev/null | tr -d '\r')" ]; then
  echo "   ❌ 读不到 $PKG 的私有目录（adb root 没通）—— 本轮无效"; exit 3
fi
BEFORE=$($ADB shell "ls $CACHE_ON_DEVICE 2>/dev/null" | tr -d '\r')
if [ -z "$BEFORE" ]; then
  echo "   ℹ️ 缓存目录现在是空的或还不存在（正常：它由第一次导出时建）"
else
  echo "   目录里已有 $(printf '%s\n' "$BEFORE" | grep -c .) 个文件"
fi

MENU_TPL=$(zh web.countdown.a11y.menu)
if [ -z "$CARD_TITLE" ]; then
  CARD_TITLE=$(node "$READER" card-title "$UI_XML" "$MENU_TPL" 2>/dev/null) || {
    echo "   ❌ 从 a11y 名里剥不出卡片标题 —— 探针未到位（本轮无效）"; screen_txt; exit 3; }
fi
MENU_DESC=$(printf '%s' "$MENU_TPL" | sed "s/{title}/$CARD_TITLE/g")
MENU_XY=$(xy_desc "$MENU_DESC")
[ -z "$MENU_XY" ] && MENU_XY=$(scroll_to_desc "$MENU_DESC")
if [ -z "$MENU_XY" ]; then
  bad "卡片上没有「${MENU_DESC}」这颗菜单钮"; screen_txt
else
  $ADB shell input tap $MENU_XY; sleep 2
  EXPORT_LABEL=$(zh web.countdown.export)
  EXP_XY=$(scroll_to_text "$EXPORT_LABEL")
  if [ -z "$EXP_XY" ]; then
    bad "菜单里没有「${EXPORT_LABEL}」那一格（宿主没接 onExportCard，或 labels.exportCard 没给）"; screen_txt
  else
    $ADB shell input tap $EXP_XY
    FOUND=""
    ATTEMPTS=0
    while [ $ATTEMPTS -lt 10 ]; do
      ATTEMPTS=$((ATTEMPTS + 1)); sleep 3
      AFTER=$($ADB shell "ls $CACHE_ON_DEVICE 2>/dev/null" | tr -d '\r')
      NEW=$(printf '%s\n' "$AFTER" | while IFS= read -r f; do
             [ -z "$f" ] && continue
             printf '%s\n' "$BEFORE" | grep -qxF -- "$f" || printf '%s\n' "$f"
           done)
      [ -n "$NEW" ] && { FOUND=$(printf '%s\n' "$NEW" | head -1); break; }
    done
    if [ -z "$FOUND" ]; then
      bad "点了导出、缓存目录 ${ATTEMPTS}×3 秒内没有新文件（栅格化没跑 / 原生模块没接 / 写盘失败）"
      dump
      grep -qF -- "$(zh web.countdown.export.failed)" "$UI_XML" && echo "   界面上有失败句（那句说了什么由 i18n 真源定）"
    else
      ok "缓存目录里出现了新文件：$FOUND"
      case "$FOUND" in
        heyta-*.png) ok "文件名形状是 heyta-….png（前缀/后缀都由共享层 cardExportFileName 给）" ;;
        *) bad "文件名不符合 heyta-….png：$FOUND" ;;
      esac
      IMG="$EVIDENCE_DIR/latest-card.png"
      $ADB pull "$CACHE_ON_DEVICE/$FOUND" "$IMG" >/dev/null 2>&1
      $ADB shell input keyevent 4 >/dev/null 2>&1   # 收掉可能开着的分享面板
      step "5. 判据③：那串字节的 IHDR 逐字等于契约"
      if [ ! -f "$IMG" ]; then
        bad "pull 回来的文件不在 $IMG —— 读通道断了，不是产品坏（本轮无效）"
        exit 3
      fi
      IMG_R=$(read_png "$IMG")
      echo "   $IMG_R"
      if [ "$(field "$IMG_R" W)" = "$EXP_W" ] && [ "$(field "$IMG_R" H)" = "$EXP_H" ]; then
        ok "设备出图 = 契约 ${EXP_W}×${EXP_H} —— 这就是 W7-G1/G2 缺的那一对数"
      else
        bad "设备出图 $(field "$IMG_R" W)×$(field "$IMG_R" H) ≠ 契约 ${EXP_W}×${EXP_H} ⇒ density 折算那一档错了（尺寸口径，不是小瑕疵）"
      fi
      [ "$(field "$IMG_R" BLANK)" = "false" ] && ok "不是空白图" || bad "数出来是空白 —— 栅格化画了个寂寞"
      [ "$(field "$IMG_R" TRANSPARENT)" = "false" ] && ok "没有透明像素（与 web 那张同口径）" || bad "图里有透明像素"
      echo "   证据留在 ${IMG}（设备侧原名 ${FOUND}）—— 🔴 人要打开看一眼"
    fi
  fi
fi

step "6. 这一趟不该出现任何运行时授权弹窗"
FOCUS=$($ADB shell dumpsys window 2>/dev/null | grep -m1 'mCurrentFocus' | tr -d '\r')
echo "   此刻前台：$FOCUS"
case "$FOCUS" in
  *"$PKG"*) ok "前台仍是 $PKG —— 这条路没有触发任何权限页（与「不申请照片」那句条款同向）" ;;
  *) bad "前台不是 ${PKG}（${FOCUS}）—— 要么弹了授权页/系统页，要么应用掉了；本条通道按设计不该有这些" ;;
esac

$ADB unroot >/dev/null 2>&1
summary "纪念卡片设备出图（Android）" "设备真的画得出契约尺寸的那张图"
