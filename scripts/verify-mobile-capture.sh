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
# 移动端「一句话捕获」验收（真模拟器，零 mock）
# =================================================
#
# 🔴 为什么必须有这个脚本
#
# `capture` 整刀的尾巴补的是**两端不一致**：web 的捕获框能认「明天」「!1」并显示
# 识别芯片，而移动端一直以来只是一个**纯标题输入框** —— 同一句话在两端建出不同的
# 任务，且两边都不报错。现在两端共用同一个 `@heyta/ui` 的 `CaptureComposer`。
#
# 单测证明不了这件事：
#   · `capture-model.spec.ts`（packages/ui）能证明解析出来的芯片对不对；
#   · `capture-labels` 能证明文案装配得对；
#   · 但**没有一条**能证明"移动端真的把共享捕获件挂上了、提交真的走了
#     `actions.create(title, {priority})`" —— 那正是本脚本要证的（M3：逐端验收）。
#
# ⚠️ **为什么只验优先级、不验中文日期**：`adb shell input text` **不支持非 ASCII**
#    （打不出「明天」）。所以日期那一半由共享层的单测（`capture-model.spec.ts`）
#    与 web 的真浏览器 e2e 覆盖；移动端这一跑验的是**接线**：芯片出现、
#    预览出现、提交后标题被清洗、任务真的出现在列表里。
#
# 用法：
#   bash scripts/verify-mobile-capture.sh
#
# 前置：模拟器在跑、服务端在 3000（TEST_MODE）、
#       /tmp/heyta_mobile_{token,email,e2ee}.txt 存在。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

TITLE="cap-e2e-$(date +%H%M%S)"

echo ""
echo "=== 移动端一句话捕获验收（真实模拟器，零 mock）==="
echo "  设备: $E2E_SERIAL   服务端: $SERVER"
echo "  账号: $EMAIL"
echo "  句子: 「$TITLE !1」——「!1」是**确定性的优先级标记**（ASCII，能打进去）"

step "0. 装包并启动"
# 🔴 **先卸掉改名前的旧包**（`com.heytamobile`）。
#    实测踩过：现场同时装着旧包，而 `monkey -p com.heyta` 在旧包仍占前台时
#    看起来"应用起来了" —— 于是整个 E2E 驱动的是**旧界面**（输入框的 hint 是
#    「要做什么？」，即共享捕获件之前那个纯标题框），断言全部指向错的东西。
$ADB shell am force-stop com.heytamobile >/dev/null 2>&1
$ADB uninstall com.heytamobile >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
# 全新初态：上一次跑剩的任务会让"这条任务落在哪一组"含混。
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 6
dump

# 🔴 断言**前台进程就是被测包**：`has_text "任务"` 之类的界面断言在旧包上也会成立，
#    只有进程号能分清"起来的是哪一个应用"。
if [ -n "$($ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r')" ]; then
  ok "被测应用（${PKG}）已在运行"
else
  bad "被测应用（${PKG}）没有运行 —— 前台可能是别的包"; screen_txt
fi

# 🔴 `pm clear` 之后应用会回到**欢迎页**（注册 / 登录 / 先离线使用）——
#    不先离开它，下面每一步都会"找不到按钮"，而那看起来像产品坏了。
#    ⚠️ 顺序也不能反：**先离开欢迎页再断言"起来了"**，否则欢迎页上当然没有「任务」，
#    一条本来成立的断言会报成"应用没起来"（实测踩过）。
dismiss_welcome_if_present
dump
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; fi

step "1. 配置同步凭据"
configure_sync_credentials
# 🔴 `configure_sync_credentials` 把凭据填在**「我的」页**，填完停在那里 ——
#    而「新建任务」的 FAB 只在「任务」tab 上。不回切过去，下一步必然找不到按钮。
#    （实测：不回切时 `xy_edit_any` 抓到的是「我的」页的**服务器地址**输入框，
#     于是 `cap-e2e-… !1` 被填进了服务器地址，界面文本里明晃晃地显示出来。）
#
# ⚠️ 用**坐标**而不是 `tap_label "任务"`：那条路在实测里点完仍停在原屏
#    （「任务」这个名字在页面里出现多处，命中的第一个不一定是底部 tab）。
#    坐标 108,2253 是这台设备底部标签栏「任务」的中心，已实测。
$ADB shell input tap 108 2253; sleep 3
dump
# 回切失败的兜底：再点一次（首次点可能被输入法/过渡动画吃掉）。
if [ "$(has_desc "新建任务")" != "1" ]; then
  $ADB shell input tap 108 2253; sleep 3
  dump
fi

step "2. 打开「新建任务」面板 —— 里面应当是**共享捕获件**"
XY=$(xy_desc "新建任务")
if [ -z "$XY" ]; then
  bad "找不到新建按钮"; screen_txt
else
  $ADB shell input tap $XY; sleep 2.5
  dump
  # 共享捕获件的 placeholder 是 `mobile.capture.placeholder`（前缀匹配，
  # 因为它是长句）—— 用它证明"挂上的是捕获件，不是那个纯标题输入框"。
  if [ "$(has_sub "添加任务")" = "1" ]; then
    ok "捕获面板已打开（是捕获件，不是纯标题框）"
  else
    bad "面板里没有捕获件的输入框"; screen_txt
  fi
fi

step "3. 输入「$TITLE !1」—— 识别芯片必须出现"
XY=$(xy_edit_any)
if [ -z "$XY" ]; then
  bad "找不到输入框"; screen_txt
else
  $ADB shell input tap $XY; sleep 1
  # `%s` = 空格（`adb shell input text` 的约定）。
  $ADB shell input text "${TITLE}%s!1"; sleep 1.5
  dump
  # 🔴 芯片：`web.capture.priority.high` → 「高优先级」
  #    （共享层的 `capturePriorityLabelKey()` 刻意复用 web 前缀的键，见
  #    `apps/mobile/src/lib/capture-labels.ts` 文件头。）
  if [ "$(has_text "高优先级")" = "1" ]; then
    ok "识别出「高优先级」芯片"
  else
    bad "没有识别出优先级芯片 —— 共享捕获件可能没真的挂上"; screen_txt
  fi
  # 🔴 预览：`mobile.capture.previewLead` → 「实际标题：」
  #    ⚠️ 必须用 `has_sub`（子串）而不是 `has_text`（整节点精确匹配）：
  #    预览节点是**一句拼起来的**（`实际标题： cap-e2e-…`），精确匹配永远查不到 ——
  #    实测就把一条本来成立的断言报成了"没有预览"，而产品其实是对的。
  if [ "$(has_sub "实际标题")" = "1" ]; then
    ok "出现「实际标题」预览"
  else
    bad "没有「实际标题」预览"; screen_txt
  fi
fi

# ⚠️ 标题里**不许**出现反引号：`step "… \`!1\`"` 会让 bash 把 `!1` 当命令执行
# （实测报 `!1: command not found`，而失败信息指向脚本自己，不是产品）。
step "4. 提交 —— 标题里不许再带 !1"
XY=$(xy_text "添加")
if [ -z "$XY" ]; then
  bad "找不到「添加」"; screen_txt
else
  $ADB shell input tap $XY; sleep 3
fi
dump
# 行上的可访问名是 `打开任务：<标题>`。**精确匹配** `$TITLE` 同时证明了两件事：
# ① 任务建出来了；② 标题是清洗过的（若 `!1` 还在，desc 就对不上）。
if [ "$(has_desc "打开任务：$TITLE")" = "1" ]; then
  ok "任务已创建，且标题被清洗为：$TITLE"
else
  bad "任务没创建，或标题里还留着 !1"; screen_txt
fi

summary "移动端一句话捕获"
