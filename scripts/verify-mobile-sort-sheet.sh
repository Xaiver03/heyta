#!/bin/bash

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 对脚本是按字节偏移
#    增量读取的：运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。
#    入口先把整份脚本拷成同目录隐藏快照再 exec 副本 —— 之后对源文件的任何
#    编辑都影响不到本次运行；$0 的 dirname 不变，lib/tools 定位照旧。
#    快照名 .原名.snap.PID（进 .gitignore）；trap 尽力清理，被 kill -9 留下的
#    由下一次运行按 mmin +240 顺带扫掉。
case "$(basename "$0")" in
  .*.snap.*) ;; # 已是快照：正常往下跑
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
trap 'rm -f -- "$0"' EXIT
#
# 移动端「排序选择面板」的**几何**验收（真模拟器，零 mock）
# ==========================================================
#
# 这一条是 R5（`docs/plans/ui-review-fill-zh-timeline.md` §6）的判据。
#
# 🔴 为什么必须单独有一个脚本，而不是"看图说修好了"
#
# 这条缺陷的形状是**界面在无障碍树里说谎**：改之前 Android 1080×2400 实测
#
#   scrim  content-desc="关闭排序选择"  [0,0][1080,2134]
#   标题   "选择排序方式"                [42,2176][1038,2237]
#   档位1  "默认（按截止时间）"          [42,2258][1038,2374]
#   档位2  "按添加时间"                  [42,2395][1038,2400]   ← 只剩 5px
#   档位3  "按优先级"                    （根本不在树里）
#
# ⇒ 三个档位里两个点不到。所以判据**不能是**"档位存在"，只能是其两个东西：
#   ① 矩形完整（`bottom ≤ 屏幕高` 且 `height > 0`）；② 点它真的换档。
#
# ⚠️ 为什么"在树里"不够 —— 这是 `scripts/lib/mobile-e2e.sh` 里
# `xy_edit_sane` 记过的实测事实：ScrollView 折叠线以下的节点**仍在树里**，
# 只是 `bounds` 可能是负的。于是"数得出来"和"看得见"是两件事，
# 本脚本因此读矩形（`scripts/lib/ui-bounds.py`），不数节点。
#
# ## 这一跑能证什么、不能证什么
#
# 能证：三个档位在 1080×2400 上矩形完整、第三个点得动且真的换档、
#       系统字号放到最大（3.0）时仍然完整、
#       Composer **输入长文本**（内容真的会超过剩余视口那条真实路径）时
#       面板不越界、出口（取消）可达并可点。
# 不能证：iOS 上的同一条（home indicator 那一块由 `insets.bottom` 负责，
#       需要 iOS 模拟器另跑 —— 这里只保证 Android 这一端）。
#       ⚠️ 也不证"面板被压缩"的**机制**到底由哪一行挡住 —— 那由变异验证回答
#       （结果记在 `docs/plans/ui-review-fill-zh-timeline.md` §6）。

#
# 用法：
#   bash scripts/verify-mobile-sort-sheet.sh
#
# 前置：模拟器在跑（emulator-5554）、release APK 已按当前源码打过
#       （`pnpm build:android`）。**不需要服务端与凭据** —— 这一屏只看面板几何。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

BOUNDS="python3 $(dirname "$0")/lib/ui-bounds.py"
EVIDENCE="$HEYTA_REPO_ROOT/apps/mobile/evidence"
# 滑动手势取屏幕中列（1080 宽）。
SW_MID=540
# 🔴 档位数量来自 `TASK_SORT_OPTIONS`（`@heyta/domain`）。**加档位时这里会红，
# 那是故意的**：它逼着重新跑一次面板几何验收，而不是让新档位悄悄挤进面板底部。
EXPECTED_OPTIONS=3

# 屏幕尺寸（`wm size` 覆盖之后要重读，所以做成函数而不是常量）。
screen_size() {
  $ADB shell wm size 2>/dev/null | tr -d '\r' | sed -n 's/.*: *\([0-9]*\)x\([0-9]*\)/\1 \2/p' | tail -1
}

# 从 bounds 行算中心点：`l,t,r,b<TAB>label`
center_of() {
  awk -F'[,\t]' '{ printf "%d %d\n", ($1+$3)/2, ($2+$4)/2 }' <<< "$1"
}

# 🔴 控件高度的**下限**，从被约束的常量推导（§7 元规则二：不写魔法数字）。
# `touch-target.min` = 44dp（`packages/design-system/src/tokens.css:303`，
# 可访问性硬下限），换算成 px 要乘设备密度。
#
# 为什么需要这一条而"bottom 没越界"不够：uiautomator 会把**子节点裁到父容器的
# 可视矩形** —— 被折叠线切掉半截的控件，它的 `bottom` 恰好等于父容器 bottom，
# 于是"在屏内"永远成立，唯一露馅的地方是**高度低于下限**。
# 实测（1080×2400 / 密度 420 / 字号 3.0）：Composer 的「取消」报
# `42,2096,1038,2172`（高 76px），而 44dp = 115px ⇒ 这条能抓住它，
# 而"bottom < 2400 且 height > 0"抓不住。
DENSITY=$($ADB shell wm density 2>/dev/null | tr -d '\r' | sed -n 's/.*: *\([0-9]*\)/\1/p' | tail -1)
MIN_H=$(awk -v d="${DENSITY:-420}" 'BEGIN{ printf "%d", 44*d/160 }')
echo "   控件高度下限：44dp × 密度 ${DENSITY:-420}/160 = ${MIN_H}px"
too_short() { awk -F'[,\t]' -v h="$MIN_H" '$4 - $2 < h { print }'; }

# 收掉排序面板，并**断言它真的收掉了**。
#
# 🔴 为什么不能"点一下遮罩"就算完：这一版的 step 5 曾经直接去找「新建任务」，
# 而它用的还是上一步的 `/tmp/ui.xml` —— 于是"找不到新建按钮"这句话**既可能是
# 面板没关，也可能是探针在看过期树**。点遮罩这件事没有任何返回值，
# 唯一诚实的做法是关完**重新 dump 再看面板在不在**（§7 元规则一）。
# 关不掉就退回来按 BACK（RN 的 `Modal` 把 `onRequestClose` 挂在系统返回上）。
close_sort_panel() {
  $ADB shell input tap ${SW_MID} 120 >/dev/null 2>&1; sleep 2
  dump; require_screen
  if [ "$(has_sub "选择排序方式")" = "0" ]; then return 0; fi
  $ADB shell input keyevent 4 >/dev/null 2>&1; sleep 2
  dump; require_screen
  [ "$(has_sub "选择排序方式")" = "0" ]
}

echo ""
echo "=== 移动端排序面板几何验收（真实模拟器，零 mock）==="
echo "  设备: ${HEYTA_E2E_SERIAL:-emulator-5554}"

step "0. 装上当前源码打的包并启动"
$ADB shell am force-stop com.heytamobile >/dev/null 2>&1
$ADB uninstall com.heytamobile >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 6
dismiss_welcome_if_present
dump
require_screen
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动，落在任务屏"; else bad "应用没起来"; screen_txt; fi

step "1. 打开排序面板"
# chip 的标签是「排序：<当前档位>」—— 它是**打开面板的按钮**，不是三个并列档位。
CHIP=$($BOUNDS clickable-below 0 | grep '排序' | head -1)
if [ -z "$CHIP" ]; then
  bad "找不到排序 chip"; screen_txt; summary "移动端排序面板"; exit 1
fi
$ADB shell input tap $(center_of "$CHIP"); sleep 2
dump
require_screen
TITLE_LINE=$($BOUNDS sub "选择排序方式" | head -1)
if [ -z "$TITLE_LINE" ]; then
  bad "面板没打开（无障碍树里没有「选择排序方式」）"; screen_txt
  summary "移动端排序面板"; exit 1
fi
ok "面板已打开"

# ── 判据 1 ────────────────────────────────────────────────
# 面板里**每个**可点档位：矩形高度为正、且整块在屏幕内。
# 用标题的 `bottom` 当"面板上边界"，把底下的可点节点收进来 ——
# 遮罩（`flex: 1`）的 top 是 0，因此不会混进来。
step "2. 判据 1：三个档位的矩形都完整在屏幕内"
read -r SW SH <<< "$(screen_size)"
TITLE_BOTTOM=$(cut -f1 <<< "$TITLE_LINE" | awk -F, '{print $4}')
OPTIONS=$($BOUNDS clickable-below "$((TITLE_BOTTOM + 1))")
COUNT=$(printf '%s\n' "$OPTIONS" | grep -c '^[0-9]' || true)
echo "   屏幕: ${SW}×${SH}   面板标题底边: y=${TITLE_BOTTOM}   档位矩形:"
printf '%s\n' "$OPTIONS" | sed 's/^/     /'
if [ "$COUNT" -ne "$EXPECTED_OPTIONS" ]; then
  bad "面板里可点档位是 ${COUNT} 个，期望 ${EXPECTED_OPTIONS} 个"
fi
CLIPPED=$(printf '%s\n' "$OPTIONS" | awk -F'[,\t]' -v sh="$SH" '$4 >= sh || $4 <= $2 { print }')
NEG=$(printf '%s\n' "$OPTIONS" | awk -F'[,\t]' '$4 - $2 <= 0 { print }')
SHORT=$(printf '%s\n' "$OPTIONS" | too_short)
if [ -z "$CLIPPED" ] && [ -z "$NEG" ] && [ -z "$SHORT" ] && [ "$COUNT" -eq "$EXPECTED_OPTIONS" ]; then
  ok "${COUNT} 个档位全部完整可见（bottom < ${SH}、height > 0 且 ≥ ${MIN_H}px）"
else
  [ -n "$SHORT" ] && { echo "   低于触控下限 ${MIN_H}px 的档位:"; printf '%s\n' "$SHORT" | sed 's/^/     /'; }
  bad "有档位被屏幕底边切掉、高度非正、或被父容器裁到下限以下 —— 这就是 R5 原本的形状"
fi

$ADB exec-out screencap -p > "$EVIDENCE/android-sort-3-picker-fixed.png" 2>/dev/null
echo "   📷 截图: $EVIDENCE/android-sort-3-picker-fixed.png（**人必须打开看**）"

# ── 判据 2 ────────────────────────────────────────────────
# 点**最后一个**档位。改之前这条做不到（第三个不在树里），
# 而它是唯一能证明"完整可见"不只是像素对齐的行为判据。
step "3. 判据 2：点最后一个档位真的换档"
LAST=$(printf '%s\n' "$OPTIONS" | sort -t, -k2 -n | tail -1)
LAST_LABEL=$(cut -f2 <<< "$LAST")
if [ -z "$LAST" ] || [ -z "$LAST_LABEL" ]; then
  bad "拿不到最后一个档位"; screen_txt
else
  echo "   档位「${LAST_LABEL}」矩形: $(cut -f1 <<< "$LAST")"
  $ADB shell input tap $(center_of "$LAST"); sleep 3
  dump
  require_screen
  NEW_CHIP=$($BOUNDS clickable-below 0 | grep '排序' | head -1)
  if [ -z "$NEW_CHIP" ]; then
    bad "换档后找不到排序 chip"; screen_txt
  elif printf '%s' "$NEW_CHIP" | grep -q "$LAST_LABEL"; then
    ok "chip 文字跟着变成了「${LAST_LABEL}」"
  else
    bad "点了「${LAST_LABEL}」但 chip 没跟着变: $(cut -f2 <<< "$NEW_CHIP")"
  fi
fi

# ── 判据 3 ────────────────────────────────────────────────
# 内容长到**上限真的成为上限**时，面板必须滚动而不是裁切。
#
# 🔴 为什么不能"往档位列表里加两个桩"：那验的是"我写的桩刚好被我写的滚动兜住"。
# 档位数量由领域层给，壳不该为测试改它 —— 所以这一条去改**真实存在的变量**。
#
# ⚠️ 这条判据**曾经是空跑**：先用 1080×1400 跑，三个档位全可见 ——
# 上限根本没起作用，"可滚动"也没被需要（§7 元规则二：一条永远通过的判据
# 比没有判据更糟）。所以内容必须真的顶过 `0.9 × 视口高`。
step "4. 判据 3：系统字号顶到最大档时，三个档位仍然完整"
# 🔴 为什么**不是**"把屏幕压到 1080×520"：实测过 —— 那种高度下整屏先塌，
# 连排序 chip 都不渲染（档位行自己都变成 `top > bottom` 的负高度矩形），
# 于是"面板不裁切"在一台不存在的设备上没有意义。
#
# 用的两个变量都是**真实设备上用户会有的状态**：
#   ① 系统字号 `font_scale = 3.0`（无障碍设置里最大的一档）—— 它把面板内容顶高；
#   ② **用户真的输入长文本** —— Composer 的内容高度由输入决定，这是它会长高的
#      那条真实路径，不需要往领域层加档位（档位数量不归壳管）。
$ADB shell settings put system font_scale 3.0 >/dev/null 2>&1
sleep 2
$ADB shell am force-stop $PKG; sleep 1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 7
dismiss_welcome_if_present
dump
require_screen
CHIP=$($BOUNDS clickable-below 0 | grep '排序' | head -1)
if [ -z "$CHIP" ]; then
  bad "字号 3.0 下找不到排序 chip —— 这一屏本身已经不可用"; screen_txt
else
  $ADB shell input tap $(center_of "$CHIP"); sleep 2
  dump
  require_screen
  read -r SW SH <<< "$(screen_size)"
  TITLE_BOTTOM=$(cut -f1 <<< "$($BOUNDS sub "选择排序方式" | head -1)" | awk -F, '{print $4}')
  BIG_OPTIONS=$($BOUNDS clickable-below "$((TITLE_BOTTOM + 1))")
  BIG_COUNT=$(printf '%s\n' "$BIG_OPTIONS" | grep -c '^[0-9]' || true)
  echo "   字号 3.0 / ${SW}×${SH}  档位矩形:"
  printf '%s\n' "$BIG_OPTIONS" | sed 's/^/     /'
  BIG_BAD=$(printf '%s\n' "$BIG_OPTIONS" | awk -F'[,\t]' -v sh="$SH" '$4 > sh || $4 <= $2 { print }')
  if [ "$BIG_COUNT" -eq "$EXPECTED_OPTIONS" ] && [ -z "$BIG_BAD" ]; then
    ok "字号 3.0 下 ${BIG_COUNT} 个档位仍然完整（内容被放大也没切）"
  else
    bad "字号 3.0 下有档位被切或数量不对（${BIG_COUNT} 个）"
  fi
  $ADB exec-out screencap -p > "$EVIDENCE/android-sort-4-fontscale3.png" 2>/dev/null
  echo "   📷 截图: $EVIDENCE/android-sort-4-fontscale3.png（**人必须打开看**）"
  # 收掉面板，换 Composer。
  if close_sort_panel; then
    ok "排序面板已收掉（回到任务屏）"
  else
    bad "排序面板关不掉 —— 后面的 Composer 判据会在过期树上跑，本轮无效"
  fi
fi

# ── 判据 3b ───────────────────────────────────────────────
# Composer 里**真的**输一段长文本：它的内容高度由用户输入决定，
# 是"面板比剩余视口高"这件事在产品里的真实形态。判据仍是两条：
# **面板不越界** + **出口（取消）可达并可点**。
step "5. 判据 3b：Composer 输入长文本时，面板不越界、出口可达"
dump
require_screen
XY=$(xy_desc "新建任务")
if [ -z "$XY" ]; then
  bad "找不到新建按钮"; screen_txt
else
  $ADB shell input tap $XY; sleep 2
  disable_ime
  dump
  require_screen
  XY=$(xy_edit_any)
  if [ -z "$XY" ]; then
    bad "新建面板里找不到输入框"; screen_txt
  else
    $ADB shell input tap $XY; sleep 1
    LONG=$(printf 'x%.0s' 1 2 3 4 5 6 7 8 9 10)
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      $ADB shell input text "$LONG" >/dev/null 2>&1
    done
    sleep 2
    dump
    require_screen
    read -r SW SH <<< "$(screen_size)"
    CANCEL=$($BOUNDS text "取消" | head -1)
    echo "   Composer 的「取消」矩形: ${CANCEL:-（不在树里）}"
    # 面板里**所有**可点节点都必须完整在屏内（负高度 = 被压缩 = 原来的形状）。
    SHEET_BAD=$($BOUNDS clickable-below 0 | awk -F'[,\t]' -v sh="$SH" '$4 > sh || $4 <= $2 { print }')
    SHEET_SHORT=$($BOUNDS clickable-below 0 | too_short)
    if [ -n "$SHEET_BAD" ]; then
      echo "   越界/负高度的节点:"; printf '%s\n' "$SHEET_BAD" | sed 's/^/     /'
      bad "Composer 长文本下有节点被切 —— 上限没有生效"
    elif [ -n "$SHEET_SHORT" ]; then
      echo "   低于触控下限 ${MIN_H}px 的节点（= 被父容器的折叠线裁掉半截）:"
      printf '%s\n' "$SHEET_SHORT" | sed 's/^/     /'
      bad "Composer 里有控件被裁到 $MIN_H}px 以下 —— 出口看着在、其实缺了一半"
    else
      ok "Composer 长文本下所有可点节点都在屏内、高度为正且不低于触控下限"
    fi
    # 🔴 这一条才是"上限真的成为上限"的证明：内容已经高过视口，所以面板里
    # **必须**存在一个可滚动容器 —— 否则"没越界"只可能是"下面的东西根本不存在"。
    # 必须按**面板上边界**过滤：底下那层任务列表本身就是可滚动容器，
    # 不过滤的话这条会在"面板里没滚、滚的是列表"时假绿。
    SHEET_TOP=$($BOUNDS text "新建任务" | head -1 | awk -F'[,\t]' '{print $2}')
    SHEET_TOP=${SHEET_TOP:-0}
    SCROLLABLE=$($BOUNDS scrollable | awk -F'[,\t]' -v st="$SHEET_TOP" '$2 >= st { print }')
    if [ -n "$SCROLLABLE" ]; then
      ok "面板里有可滚动容器（内容确实超出，不是没画）: $(cut -f1 <<< "$SCROLLABLE" | head -1)"
    else
      bad "面板里没有可滚动容器 —— 长文本下没有路可走（或内容压根没长高）"
    fi
    # 出口可达：取消可能已被滚到可视区外，滚一下再点。
    TAP_CANCEL="$CANCEL"
    TRIES=0
    while [ -z "$TAP_CANCEL" ] && [ "$TRIES" -lt 3 ]; do
      $ADB shell input swipe ${SW_MID} $((SH - 200)) ${SW_MID} 300 400 >/dev/null 2>&1
      sleep 1; dump; TRIES=$((TRIES+1))
      CANCEL=$($BOUNDS text "取消" | head -1)
      echo "   第 ${TRIES} 次滑动后的「取消」矩形: ${CANCEL:-（仍不在树里）}"
      TAP_CANCEL="$CANCEL"
    done
    $ADB exec-out screencap -p > "$EVIDENCE/android-sort-5-composer-long.png" 2>/dev/null
    echo "   📷 截图: $EVIDENCE/android-sort-5-composer-long.png（**人必须打开看**）"
    if [ -n "$TAP_CANCEL" ]; then
      $ADB shell input tap $(center_of "$TAP_CANCEL"); sleep 2
      dump
      if [ -z "$($BOUNDS text "取消" | head -1)" ]; then
        ok "点得到「取消」，面板收掉了"
      else
        bad "点了「取消」但面板还开着"
      fi
    else
      bad "滚了 ${TRIES} 次仍然点不到「取消」—— 内容超出时没有路可走"
    fi
    $ADB shell input keyevent 4 >/dev/null 2>&1; sleep 1
  fi
fi
# 🔴 `font_scale` 是**设备级**状态，留着它，下一轮任何移动端验收都会在一台
# "不存在的超大字号设备"上跑（§7 第 83 条：探针留下的状态就是下一次看图的输入）。
$ADB shell settings put system font_scale 1.0 >/dev/null 2>&1
$ADB shell wm size reset >/dev/null 2>&1
sleep 2
read -r SW SH <<< "$(screen_size)"
if [ "$SH" != "2400" ]; then
  echo "   ⚠️ 屏幕尺寸没有回到 2400（现在是 ${SW}×${SH}）—— 请手动 \`adb shell wm size reset\`"
else
  echo "   屏幕尺寸已还原（${SW}×${SH}）"
fi
if [ "$($ADB shell settings get system font_scale 2>/dev/null | tr -d '\r')" != "1.0" ]; then
  echo "   ⚠️ 系统字号没有回到 1.0 —— 请手动 \`adb shell settings put system font_scale 1.0\`"
else
  echo "   系统字号已还原（1.0）"
fi

summary "移动端排序面板"
