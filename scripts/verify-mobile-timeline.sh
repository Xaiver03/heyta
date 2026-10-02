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
# 移动端「时间线」验收（真模拟器，零 mock）
# ===========================================
#
# 🔴 为什么必须有这个脚本
#
# `timeline` 整刀第 3 步把时间线搬到了移动端 —— **复用 web 那一份共享实现**
# （`@heyta/ui` 的 `TimelineView` + `GanttChart`）。单元测试证明不了它挂上了：
#   · `packages/ui/tests/timeline-model.spec.ts` 能证明刻度/日界/百分比算得对；
#   · `apps/mobile/tests/*` 全是纯函数，**渲染不了屏幕**（移动端没有组件测试台）；
#   · 而"点「时间线」这个 chip 真的换到了那一档、真的画出了块"这条链路
#     隔着 chip 的 `onPress`、`planTimelineBlocks()` 与一次 RN 布局。
# ⇒ 只有真机跑得出来（M3：逐端验收）。
#
# ## 这一跑能证什么、不能证什么
#
# 🔴 2026-10-01 重画（goal：`docs/plans/goal-timeline-rework.md`）后判据翻新：
# 板 = **一根共轴 + 行=任务 + 三态降级**；本脚本建的任务没有截止时间，
# 所以它**必然落进「未排期」泳道** —— 判据钉的是这件事，不是巧合。
#
# 能证：① chip 在、② 点它换档、③ 共享 `TimelineBoard` **真的渲染了**
# （轴上出现今天的真实日期 —— 刻度来自领域层，不是装饰）、④ 任务标题
# 出现在**有名字的「未排期」泳道**里（可见，且**不落图** —— R4 判据 5 的
# 移动端形态：旧判据「未估时按 1 小时排的条」钉的是一条编出来的长度，已随
# 重画废除）。
#
# 不能证：**有截止时间的点（菱形）落位** —— `adb shell input text` 打不出
# 非 ASCII，日期选择器也进不去。那半由 web 组件判据
# （`apps/web/tests/timeline-board.spec.tsx` 判据 2/4：相对位置 + dueDate 时间）
# 与桌面载荷截图覆盖。边界写在这里，不假装它验了。
#
# 用法：
#   bash scripts/verify-mobile-timeline.sh
#
# 前置：模拟器在跑、服务端在 3000（TEST_MODE）、
#       /tmp/heyta_mobile_{token,email,e2ee}.txt 存在。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

TITLE="tl-e2e-$(date +%H%M%S)"

# 隐私同意面板（2026-10-01 并行刀新增的首启面板）：不点掉它，后面每一步
# （建任务 / 切 chip）都被面板挡住，症状是"找不到控件"而不是"被面板挡了"。
dismiss_consent_if_present() {
  # 🔴 面板带入场动画**延迟出现**：dismiss 后立刻 dump 它往往还不在
  # （上一轮就是这么漏掉的）。所以这里**轮询等它**出现（≤10s），处理后再验它走了。
  local waited=0 xy label
  while [ "$waited" -lt 10 ]; do
    dump
    [ "$(has_text "在使用联网功能之前")" = "1" ] && break
    sleep 1
    waited=$((waited + 1))
  done
  [ "$(has_text "在使用联网功能之前")" = "1" ] || return 0

  # 🔴 按钮（Button）的可辨识名在 **content-desc** 上，不在 text 上（§7 #45 同族：
  # desc/text 两张皮）—— xy_text 永远取不到它，还会误判成"按钮不存在"。
  # 「只用本机」再退一层：正文 bullet 里也有同名 text，xy_text 必须取第 2 个匹配。
  xy=$(xy_desc "以后再说"); label="以后再说"
  if [ -z "$xy" ]; then
    xy=$(xy_desc "只用本机"); label="只用本机"
  fi
  if [ -z "$xy" ]; then
    xy=$(xy_text "只用本机" 1); label="只用本机（text 第 2 匹配）"
  fi
  if [ -z "$xy" ]; then
    bad "同意面板在，但取不到按钮坐标（desc/text 都没命中）"
    return 1
  fi
  $ADB shell input tap $xy
  sleep 2
  dump
  if [ "$(has_text "在使用联网功能之前")" = "1" ]; then
    xy=$(xy_desc "只用本机")
    [ -z "$xy" ] && xy=$(xy_text "只用本机" 1)
    if [ -n "$xy" ]; then
      $ADB shell input tap $xy
      sleep 2
      echo "     面板还在：补点了一次按钮位"
    fi
  fi
  echo "     已处理隐私同意面板（${label}，等了 $waited 秒）"
}

echo ""
echo "=== 移动端时间线验收（真实模拟器，零 mock）==="
echo "  设备: $E2E_SERIAL   服务端: $SERVER"
echo "  账号: $EMAIL"
echo "  任务: $TITLE"

step "0. 装包并启动"
# 🔴 先卸掉改名前的旧包（`com.heytamobile`）：与它并存时 `monkey -p com.heyta`
# 在旧包占前台时看起来"起来了"，于是整个 E2E 驱动的是**旧界面**。
$ADB shell am force-stop com.heytamobile >/dev/null 2>&1
$ADB uninstall com.heytamobile >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 6
dump
if [ -n "$($ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r')" ]; then
  ok "被测应用（${PKG}）已在运行"
else
  bad "被测应用（${PKG}）没有运行 —— 前台可能是别的包"; screen_txt
fi
# 🔴 首启的两块屏**交替出现**（实测顺序：同意面板 → 欢迎页 → 先离线使用 →
# 同意面板再弹 → 任务页）：任何"各处理一次"的固定序列都会在换序后整轮作废。
# 所以这里收敛循环：两块屏都不在场才算稳定（有界，4 轮）。
settle_first_run_screens() {
  local i
  for i in 1 2 3 4; do
    dismiss_consent_if_present
    dump
    if [ "$(has_text "先离线使用")" = "1" ]; then
      dismiss_welcome_if_present
    fi
    dump
    if [ "$(has_text "在使用联网功能之前")" != "1" ] && [ "$(has_text "先离线使用")" != "1" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}
settle_first_run_screens
dump
if [ "$(has_text "任务")" = "1" ]; then
  ok "应用已启动"
else
  bad "应用没起来（同意面板处理后的落点见截图）"
  $ADB exec-out screencap -p > /tmp/heyta-timeline-step0.png 2>/dev/null
  screen_txt
fi

step "1. 确保在任务页（无需凭据：本判据全部是本地行为）"
# 🔴 2026-10-02 起去掉凭据步骤：重画后的两条判据（轴日期 + 未排期泳道）全是
# **本地**行为，不需要服务端；且凭据页入口所在的底部导航刚被并行刀改过
# （任务|日历|专注|分类|我的）。挂着它只会让脚本耦合环境，不是判据要钉的东西。
# （零 mock 的口径不变：真模拟器 + 真本地库，没有 mock。）
dismiss_consent_if_present
# 兜底回任务页（底部导航最左档）
$ADB shell input tap 108 2253; sleep 2
dump
step "2. 建一条任务（时间线要有东西可排）"
XY=$(xy_desc "新建任务")
if [ -z "$XY" ]; then
  bad "找不到新建按钮"; screen_txt
else
  $ADB shell input tap $XY; sleep 2.5
  dump
  XY=$(xy_edit_any)
  if [ -z "$XY" ]; then
    bad "新建面板里找不到输入框"; screen_txt
  else
    $ADB shell input tap $XY; sleep 1
    $ADB shell input text "$TITLE"; sleep 1.5
    # 🔴 键盘必须收：弹着的时候「添加」的坐标落在键盘上（此前这一收是凭据
    # 步骤里的 disable_ime 顺手做的，凭据步骤删掉后它必须在这里显式做）。
    disable_ime; sleep 1
    dump
    if [ "$(has_sub "$TITLE")" = "1" ]; then ok "标题已输入"; else bad "标题没输进去"; screen_txt; fi
    XY=$(xy_text "添加")
    if [ -z "$XY" ]; then bad "找不到「添加」"; screen_txt; else
      $ADB shell input tap $XY; sleep 3
    fi
  fi
fi
dump
if [ "$(has_desc "打开任务：$TITLE")" = "1" ]; then
  ok "任务已创建：$TITLE"
else
  bad "任务没创建"; screen_txt
fi

step "3. 切到「时间线」那一档（页内第三档，不是第 6 个 tab）"
XY=$(xy_text "时间线")
if [ -z "$XY" ]; then
  bad "找不到「时间线」chip"; screen_txt
else
  $ADB shell input tap $XY; sleep 3
fi
dump
# 🔴 判据 1（轴是真的）：轴刻度上出现**今天的真实日期**（紧凑档 `MM-DD`）。
# 列表那一档已经不在了；一个"把标题原样打在空屏上"的实现画不出日历日期。
TODAY_COMPACT="$(date +%m-%d)"
if [ "$(has_sub "$TODAY_COMPACT")" = "1" ]; then
  ok "轴上出现了今天的日期：${TODAY_COMPACT}（共享板真的渲染了）"
else
  bad "轴上没有今天的日期（${TODAY_COMPACT}）—— 板可能没画出来"; screen_txt
fi
# 🔴 判据 2（三态降级）：没截止时间的任务出现在**有名字的「未排期」泳道**里，
# 且泳道里有任务标题 —— 可见（不静默消失）、不落图（不编长度，R4 判据 5）。
if [ "$(has_sub "未排期")" = "1" ] && [ "$(has_text "$TITLE")" = "1" ]; then
  ok "任务落在「未排期」泳道里：${TITLE}（可见、不落图）"
else
  bad "没看到「未排期」泳道或里面的任务（${TITLE}）"; screen_txt
fi

summary "移动端时间线"
