#!/bin/bash
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
# 能证：① chip 在、② 点它换档、③ 共享视图**真的渲染了块**（任务标题出现在
# 时间线里，而列表视图那一档已经不在屏幕上）、④ **未估时那条如实说明也在**
# （`web.gantt.durationDefault` = 「未估时（按 …排）」）—— 它证明画出来的是
# 一条**按默认时长排的条**，而不是一张空图的"看起来没报错"。
#
# 不能证：**真实估时**（`预计耗时：30 分钟`）那条路径 ——
# 估时标记是**中文**，而 `adb shell input text` **打不出非 ASCII**。
# 那半由 app-host 的单测（`timeline-plan.spec.ts`：估时从备注读回来、三人分不摊）
# 与 web 的真浏览器 e2e 覆盖。边界写在这里，不假装它验了估时。
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

echo ""
echo "=== 移动端时间线验收（真实模拟器，零 mock）==="
echo "  设备: emulator-5554   服务端: $SERVER"
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
# `pm clear` 之后是欢迎页；且**先离开再断言**（欢迎页上当然没有「任务」）。
dismiss_welcome_if_present
dump
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; fi

step "1. 配置同步凭据"
configure_sync_credentials
# 凭据填在「我的」页，填完停在那里；「新建任务」的 FAB 只在「任务」tab 上。
$ADB shell input tap 108 2253; sleep 3
dump
if [ "$(has_desc "新建任务")" != "1" ]; then
  $ADB shell input tap 108 2253; sleep 3
  dump
fi

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
# 🔴 判据 1：**任务标题出现在时间线里**。列表那一档已经不在了，所以这个标题
# 只可能来自共享 `TimelineView` 画的块。
if [ "$(has_text "$TITLE")" = "1" ]; then
  ok "时间线里出现了这条任务的块：$TITLE"
else
  bad "时间线里没有这条任务的块"; screen_txt
fi
# 🔴 判据 2：**未估时那条如实说明也在**（`web.gantt.durationDefault`）。
# 只断言"标题在"的话，一个把标题原样打在空屏上的实现也能过；这一条钉的是
# "真的画出了一条按默认时长排的条"。
if [ "$(has_sub "未估时")" = "1" ]; then
  ok "条上带着「未估时」的如实说明（是按默认时长排的，不是空图）"
else
  bad "没看到「未估时」说明 —— 块可能没画出来"; screen_txt
fi

summary "移动端时间线"
