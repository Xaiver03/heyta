#!/bin/bash
#
# 移动端「自定义重复规则」验收（真模拟器，零 mock）
# ==================================================
#
# 🔴 为什么必须有这个脚本
#
# 在这一刀之前，**移动端只能选预设**（每天/每周/工作日/每月）：用户想要
# "每两周的周一"就得去网页上设 —— 同一件能力两端不一致，而手机上那条规则
# **只能看见、不能改**。
#
# 单测证明不了它接通了：
#   · `isValidRecurrenceRule` 的单测能证明判据本身对；
#   · `describeRecurrenceText` 的单测能证明文案拼得对；
#   · 但"输入框真的收下了串、点「应用规则」真的写了 op、界面真的换了说法"
#     这条链路隔着 TextInput 的 onChangeText、`actions.setRepeat` 与一次重渲染。
# ⇒ 只有真机跑得出来（M3：逐端验收）。
#
# ✅ 这一跑**能**验真实规则：`FREQ=WEEKLY;INTERVAL=2;BYDAY=MO` 全是 ASCII，
#    而 `adb shell input text` 打得出 ASCII。
#
# ## 两个踩过的坑（都写在这里，免得下一个人再踩）
#
# 1. 🔴 **`;` 在设备侧的 shell 里是命令分隔符**。`adb shell input text a;b` 会被
#    设备 shell 切成两条命令：`input text a` 与 `b`（后一条报 command not found），
#    落地的是半个串。所以整串必须用**设备侧的单引号**包住：
#    `$ADB shell "input text '...'"`。
# 2. **键盘会盖住下半屏**：输入完先 `disable_ime` 再点按钮，否则
#    `tap_label` 取到的坐标落在键盘上（点了等于没点，而被记成"按钮没生效"）。
#
# 用法：
#   bash scripts/verify-mobile-repeat-custom.sh
#
# 前置：模拟器在跑、服务端在 3000（TEST_MODE）、
#       /tmp/heyta_mobile_{token,email,e2ee}.txt 存在。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

TITLE="rc-e2e-$(date +%H%M%S)"
# 🔴 刻意**不属于任何预设**（预设是 FREQ=WEEKLY / FREQ=DAILY;INTERVAL=1 /
# FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR / FREQ=MONTHLY），所以界面上出现它的说法
# 只可能来自这个输入框。
RULE="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"
# 领域层的说法（`mobile.recurrence.weeklyOnEvery` = 「每 {n} 周{days}」，
# 星期一是「一」）—— 断言只取前四个字符，避免被正字法细节咬到。
EXPECT_SUB="每 2 周"

echo ""
echo "=== 移动端自定义重复规则验收（真实模拟器，零 mock）==="
echo "  设备: emulator-5554   服务端: $SERVER"
echo "  任务: $TITLE"
echo "  规则: $RULE"

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
dismiss_welcome_if_present
dump
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; fi

step "1. 配置同步凭据"
configure_sync_credentials
# 凭据填在「我的」页；「新建任务」的 FAB 只在「任务」tab 上。
$ADB shell input tap 108 2253; sleep 3
dump
if [ "$(has_desc "新建任务")" != "1" ]; then
  $ADB shell input tap 108 2253; sleep 3
  dump
fi

step "2. 建一条任务"
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

step "3. 打开任务详情"
XY=$(xy_desc "打开任务：$TITLE")
if [ -z "$XY" ]; then
  bad "找不到任务行"; screen_txt
else
  $ADB shell input tap $XY; sleep 3
fi
dump
if [ "$(has_text "任务详情")" = "1" ]; then
  ok "详情面板已打开"
else
  bad "详情面板没打开"; screen_txt
fi

step "4. 在「自定义规则」里填 $RULE 并应用"
XY=$(scroll_to_edit "自定义规则")
if [ -z "$XY" ]; then
  bad "滚不到「自定义规则」输入框"; screen_txt
else
  ok "找到「自定义规则」输入框"
  $ADB shell input tap $XY; sleep 1
  # 🔴 整串用**设备侧单引号**包住：`;` 在设备 shell 里是命令分隔符（见文件头坑 1）。
  $ADB shell "input text '$RULE'"; sleep 1.5
  dump
  # 读回：`input text` 会**静默丢字符**，不读回就等于赌它一次成功。
  CUR=$(edit_value "自定义规则")
  if [ "$CUR" = "$RULE" ]; then
    ok "输入框里就是这条规则"
  else
    bad "输入框里是「${CUR}」，期望「${RULE}」"; screen_txt
  fi
  # 收起键盘再点按钮（见文件头坑 2）。
  disable_ime; sleep 1
  dump
  if tap_label "应用规则"; then
    ok "点了「应用规则」"
  else
    bad "找不到「应用规则」按钮"; screen_txt
  fi
  sleep 3
fi

step "5. 断言：界面用领域层的说法显示这条规则"
dump
# 🔴 判据 1：领域层的说法出现了（`每 2 周…`）。
# 只断言"输入框里还是那串字符"的话，一个**没有提交**的实现也能过。
if [ "$(has_sub "$EXPECT_SUB")" = "1" ]; then
  ok "界面显示了「${EXPECT_SUB}…」—— 规则真的写进去并读回来了"
else
  bad "界面上没有「${EXPECT_SUB}」的说法 —— 规则可能没提交"; screen_txt
fi
# 🔴 判据 2：它**不属于预设**这件事被标出来了（自定义芯片）。
# 没有这一条，"规则写进去了但面板看上去像没设过"也能过。
if [ "$(has_text "当前：")" = "1" ] || [ "$(has_sub "当前：")" = "1" ]; then
  ok "「当前」那行也在（规则常驻可见）"
else
  bad "没看到「当前」那行"; screen_txt
fi

summary "移动端自定义重复规则"
