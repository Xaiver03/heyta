#!/bin/bash
#
# 移动端「任务可编辑」验收（真模拟器，零 mock）
# ================================================
#
# 🔴 为什么必须有这个脚本
#
# 在这个面板出现之前，移动端只能做三件事：建一个**只有标题**的任务、勾完成、删除。
# 而「今天」是这个产品的核心视图 —— **没有截止日期就永远到不了今天**。
#
# 单元测试证明不了这个面板接通了：
#   - `task-fields.spec.ts` 能证明 `toDueDisplay` 在 `countdown` 模式下返回
#     "今天"，但它证明不了**点「今天」这个动作真的把 dueDate 写进了 op-log**；
#   - 它更证明不了 `TaskActions.setDueDate` 收到的是**设备时区的那一天**，
#     而不是一个差了一天的 epoch。
# 这两件事之间隔着 DatePicker 的 `onChange`、`dueDateToEpoch` 和一次 SQLite 写入。
#
# ═════════════════════════════════════════════════════════════════════════
# 两个必须写下来的实测结论
#
# 1. **点任务行 = 打开详情，不再切换完成。** 这是本轮改掉的交互，而"改了但分不清"
#    的后果很具体：用户想看一眼任务，结果把它勾掉了。所以第 3 步会断言勾选框
#    **没有**翻成 `取消完成：…`。
#
# 2. 🔴 **RN 的 `Modal` 打开时，底下的屏幕不在无障碍树里。**
#    实测：面板开着时 `uiautomator dump` 里只有面板内容，**查不到任务行**。
#    所以"行上的状态对不对"这类断言**必须先关掉面板再做** ——
#    否则一条本来成立的断言会因为查不到节点而报红，而**假红会掩盖真问题**。
#    下面的 `open_sheet` / `close_sheet` 就是为此存在的。
#
# 用法：
#   bash scripts/verify-mobile-task-edit.sh
#
# 前置：模拟器在跑、服务端在 3000（TEST_MODE）、
#       /tmp/heyta_mobile_{token,email,e2ee}.txt 存在。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

# 独立的笔记本库：与冲突验收各用一份，否则两个脚本会互相看到对方的任务。
LAPTOP_DB=/tmp/heyta-edit-laptop.sqlite

TITLE="edit-e2e-$(date +%H%M%S)"
RENAMED="renamed-$TITLE"
# 设备自己的日期。截止徽标显示的是 `MM-DD`，而"是哪一天"必须问设备 ——
# 用宿主机的日期会让脚本在跨零点或时区不同的模拟器上假红。
MMDD=$($ADB shell date +%m-%d 2>/dev/null | tr -d '\r')

echo ""
echo "=== 移动端任务编辑验收（真实模拟器，零 mock）==="
echo "  设备: emulator-5554   服务端: $SERVER"
echo "  账号: $EMAIL"
echo "  任务: $TITLE → $RENAMED"
echo "  设备日期: $MMDD"

if [ "${#TOKEN}" -lt 100 ]; then
  echo "❌ 令牌看起来不对（长度 ${#TOKEN}）—— 先跑建号脚本"; exit 1
fi
rm -f "$LAPTOP_DB"

# ── 流程辅助 ──────────────────────────────────────────────
# 见文件头结论 2：面板开着时查不到底下的行。
open_sheet() {  # <任务行的可访问名>
  local xy; xy=$(scroll_to_desc "$1")
  if [ -z "$xy" ]; then bad "找不到任务行：$1"; screen_txt; return 1; fi
  $ADB shell input tap $xy; sleep 3
  dump
  if [ "$(has_text "任务详情")" != "1" ]; then bad "详情面板没打开"; screen_txt; return 1; fi
  return 0
}
close_sheet() {
  dump
  local xy; xy=$(xy_desc "关闭任务详情")
  if [ -z "$xy" ]; then bad "找不到关闭按钮"; screen_txt; return 1; fi
  $ADB shell input tap $xy; sleep 2.5
  dump
  if [ "$(has_text "任务详情")" = "1" ]; then bad "面板没关掉"; screen_txt; return 1; fi
  return 0
}

step "0. 装包并启动"
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
# 全新初态：上一次跑剩的任务会让"这条任务落在哪个分组"含混。
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 6
dismiss_welcome_if_present   # 首次启动的欢迎页会盖住主界面（规范 §3.1）——先离开它
dump
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; fi

step "1. 配置同步凭据"
configure_sync_credentials

step "2. 建一个只有标题的任务"
$ADB shell input tap 135 2253; sleep 3   # 「任务」
dump
XY=$(xy_desc "新建任务")
if [ -z "$XY" ]; then bad "找不到新建按钮"; screen_txt; else
  $ADB shell input tap $XY; sleep 2.5
  dump
  XY=$(xy_edit_any)
  if [ -z "$XY" ]; then bad "新建面板里找不到输入框"; else
    $ADB shell input tap $XY; sleep 1
    $ADB shell input text "$TITLE"; sleep 1.5
    dump
    [ "$(has_text "$TITLE")" = "1" ] && ok "标题已输入" || { bad "标题没输进去"; screen_txt; }
    dump
    XY=$(xy_text "添加")
    if [ -z "$XY" ]; then bad "找不到「添加」"; screen_txt; else
      $ADB shell input tap $XY; sleep 3
    fi
  fi
fi
dump
if [ "$(has_desc "打开任务：$TITLE")" != "1" ]; then
  bad "任务没创建"; screen_txt
else
  ok "任务已创建：$TITLE"
  # 🔴 反证：还没设日期时，行上**不该**出现日期徽标。
  # 没有这条，"日期徽标永远显示"这种 bug 也能让后面所有断言通过。
  if [ "$(has_text "$MMDD")" = "0" ]; then
    ok "未设日期时没有日期徽标"
  else
    bad "还没设日期，行上却出现了 $MMDD"
  fi
fi

step "3. 点任务行 → 应打开详情，且**不应**切换完成"
if open_sheet "打开任务：$TITLE"; then
  ok "详情面板已打开"
  # 面板必须绑定**这一条**任务。只断言"面板出现了"是拦不住
  # "面板拿到的是另一条任务的快照"这类 bug 的。
  # 🔴 字段的无障碍名是**「标题」**（词条 `mobile.detail.field.title`），
  #    不是「任务标题」—— i18n 迁移（`ccf3e50`）改了文案，脚本没跟着改。
  #    实测后果：这里恒读到 ''，第 6 步 `xy_edit "任务标题"` 恒找不到输入框，
  #    再往下第 7、8 步全部连锁失败。**这条验收在自动同步之前就已经是红的**
  #    （A/B 实测：把自动同步关掉，失败点一模一样）。
  VAL=$(python3 /tmp/_xy.py editval "标题" 0)
  if [ "$VAL" = "$TITLE" ]; then
    ok "面板绑定的是这一条任务（标题框里是 ${TITLE}）"
  else
    bad "面板标题框里是 '$VAL'，不是 '$TITLE'"
  fi
  # 🔴 **必须滚到再断言。** 「优先级」区块在面板里位于「截止日期」**下方**，
  #    而 UI dump 只看得到**屏幕内**的节点 —— 不滚动就 `has_text`，
  #    等于把"我没滚到"当成"它没渲染"。实测：这条断言一直是红的，
  #    而第 5 步却能成功点到「高」并把行变成「高优先级」——
  #    **区块明明在，只是不在第一屏**。
  #    （又是那条：**"查不到"不是"不存在"**。）
  if [ -n "$(scroll_to_text "截止日期")" ]; then ok "面板有「截止日期」区块"; else bad "面板缺「截止日期」区块"; fi
  if [ -n "$(scroll_to_text "优先级")" ]; then ok "面板有「优先级」区块"; else bad "面板缺「优先级」区块"; fi
  close_sheet && ok "面板已关闭"
fi
dump
# 🔴 本轮交互改动的核心回归点。必须在**面板关掉之后**断言。
if [ "$(has_desc "完成：$TITLE")" = "1" ]; then
  ok "任务没有被误勾完成（点行只打开详情）"
else
  bad "点行把任务勾掉了 —— 交互改动没生效或回退了"
fi

step "4. 设截止日期为「今天」"
if open_sheet "打开任务：$TITLE"; then
  dump
  XY=$(scroll_to_desc "今天")
  if [ -z "$XY" ]; then bad "找不到「今天」快捷项"; screen_txt; else
    $ADB shell input tap $XY; sleep 2.5
    ok "已点「今天」"
  fi
  close_sheet
fi
dump
if [ "$(has_text "今天")" = "1" ]; then ok "出现了「今天」分组"; else bad "没有「今天」分组 —— 日期没写进去"; fi
if [ "$(has_text "$MMDD")" = "1" ]; then
  ok "行上显示今天的日期：$MMDD"
else
  bad "行上没有 $MMDD —— 日期没生效或显示的是别的日子"
  screen_txt
fi

step "5. 设优先级为「高」"
if open_sheet "打开任务：$TITLE"; then
  dump
  # 🔴 必须滚：优先级芯片在面板的 ScrollView 里是**被裁掉**的
  # （实测 bounds=[426,2141][531,2100]，高度 -41）。用 `xy_desc` 会拿到一个
  # 落在裁剪区的坐标，点下去什么都没发生，而日志会写"已点「高」"。
  XY=$(scroll_to_desc "高")
  if [ -z "$XY" ]; then bad "找不到「高」优先级项"; screen_txt; else
    $ADB shell input tap $XY; sleep 2.5
    ok "已点「高」"
  fi
  close_sheet
fi
dump
if [ "$(has_sub "高优先级")" = "1" ]; then
  ok "行上出现「高优先级」"
else
  bad "行上没有「高优先级」—— 优先级没写进去"
  screen_txt
fi

step "5b. 写备注（此前移动端**没有**备注输入框）"
# 🔴 为什么这一条必须在这里、而不是只靠单测：
#
# `Task.note` 与 `TaskActions.setNote` 一直都在，但**唯一调用点是 AI**
# （拆解 checklist / 估时写时长）—— 用户自己写不了备注。
# 单测能证明 `commitNote` 算得对，证明不了"面板上真的有这个输入框"，
# 更证明不了**它真的写进 op-log 并同步出去**。后者只能在这里验。
NOTE_TEXT="note-$TITLE"
if open_sheet "打开任务：$TITLE"; then
  dump
  # 备注紧跟在标题下面，正常在第一屏；找不到才滚（"查不到"不是"不存在"）。
  XY=$(xy_edit "备注")
  [ -z "$XY" ] && XY=$(scroll_to_desc "备注")
  if [ -z "$XY" ]; then bad "详情面板里找不到备注输入框"; screen_txt; else
    $ADB shell input tap $XY; sleep 1.2
    clear_and_type "$NOTE_TEXT" "备注"
    dump
    VAL=$(edit_value "备注")
    if [ "$VAL" = "$NOTE_TEXT" ]; then
      ok "备注已输入：$NOTE_TEXT"
    else
      bad "备注框里是 '$VAL'，不是 '$NOTE_TEXT'"
    fi
    # 关闭面板时会提交备注（见 TaskDetailSheet 的 close()）。
    # 只在 onBlur 提交的话，"写完直接关"会丢掉刚打的字 —— 而那是移动端最常见的动作。
    close_sheet
  fi
fi
# 重新打开，断言**备注真的落库了**（不是只活在输入框里）。
if open_sheet "打开任务：$TITLE"; then
  dump
  VAL=$(edit_value "备注")
  if [ "$VAL" = "$NOTE_TEXT" ]; then
    ok "重新打开后备注还在（已经写进 op-log，不是只改本地态）"
  else
    bad "重新打开后备注是 '$VAL' —— 没提交成功"
  fi
  close_sheet
fi

step "6. 改标题"
if open_sheet "打开任务：$TITLE"; then
  dump
  XY=$(xy_edit "标题")
  if [ -z "$XY" ]; then bad "详情面板里找不到标题输入框"; screen_txt; else
    $ADB shell input tap $XY; sleep 1.2
    clear_and_type "$RENAMED" "标题"
    dump
    # 关闭时会提交标题（见 TaskDetailSheet 的 close()）
    close_sheet
  fi
fi
dump
if [ "$(has_desc "打开任务：$RENAMED")" = "1" ]; then
  ok "标题已改并生效：$RENAMED"
else
  bad "标题没改成功（行上的无障碍名还是旧的）"
  screen_txt
fi

step "7. 切换「日期 / 倒计时」"
dump
XY=$(xy_desc "倒计时")
if [ -z "$XY" ]; then bad "找不到「倒计时」开关"; screen_txt; else
  $ADB shell input tap $XY; sleep 2.5
  ok "已切到「倒计时」"
fi
dump
# 倒计时模式下，行上说的是"今天 / 还剩 N 天"，不再显示 `MM-DD`。
# 这条断言成立的前提是：本次是全新库，而**只有我们这条任务**有截止日期
# （下载回来的那些任务从来没有过 dueDate）。
if [ "$(has_text "$MMDD")" = "0" ]; then
  ok "切到倒计时后不再显示日期串 ${MMDD}（换的是说法，不是数据）"
else
  bad "切到倒计时后仍显示 $MMDD —— 开关没生效"
  screen_txt
fi
if [ "$(has_desc "打开任务：$RENAMED")" = "1" ]; then
  ok "切换后任务仍在（没有被过滤掉）"
else
  bad "切换后任务不见了"
fi
# 再切回去，「日期」的说法要回来 —— 单向开关不算开关
dump
XY=$(xy_desc "日期")
[ -n "$XY" ] && { $ADB shell input tap $XY; sleep 2.5; }
dump
[ "$(has_text "$MMDD")" = "1" ] && ok "切回「日期」后重新显示 $MMDD" || bad "切回日期后 $MMDD 没回来"

step "8. 手机同步"
$ADB shell input tap 945 2253; sleep 3   # 「我的」
# 🔴 用 `ensure_phone_sync` 而不是自己找按钮：自动同步上线后，busy 时
#    按钮文案是「正在同步…」，旧写法的 `[ -z "$XY" ] → bad` 会在
#    **自动同步已经抢跑**时报一条**假红**（"找不到「立即同步」"），
#    而那一刻同步其实正在正常进行。
ensure_phone_sync
sleep 5
echo "     首次同步含密钥派生，等待中…（最长等 900 秒）"
# 🔴 判据是**结果**（另一台设备能不能拉到），不是本机的状态标签。
# 见共享库里 `wait_laptop_has` 的注释：负载高时界面标签会滞后几分钟，
# 而"数据其实早就到了"会被报成失败。
if ROUNDS=$(wait_laptop_has "$RENAMED" 180); then
  ok "手机的上传已到达服务端（笔记本第 $ROUNDS 轮拉到，约 $((ROUNDS * 5)) 秒）"
else
  bad "等了约 900 秒，笔记本仍拉不到这条任务"
  screen_txt
fi

step "9. 断言：截止日期、优先级与**备注**同步到了另一台设备"
# 🔴 必须先 sync：`list` 只读**本地**库，而笔记本这份库刚被删掉重建过。
# 少了这一步，断言会在"笔记本还没有任何数据"的前提下失败 ——
# 那看起来像"没同步过去"，实际是脚本自己没下载。
if laptop_ok sync; then ok "笔记本已下载"; else bad "笔记本 sync 失败"; fi
LT=$(laptop list --all)
VERDICT=$(printf '%s' "$LT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception as e:
    print('PARSE:' + str(e)); raise SystemExit
ts = [t for t in d.get('tasks', []) if t['title'] == '$RENAMED']
if not ts:
    print('MISSING:笔记本上没有标题为 $RENAMED 的任务'); raise SystemExit
t = ts[0]
if t.get('dueDate') is None:
    print('NODUE:dueDate 是空的'); raise SystemExit
if t.get('priority') != 3:
    print('NOPRI:priority=' + repr(t.get('priority'))); raise SystemExit
# 备注：证明**用户自己写的字**进了 op-log 并跨设备到达。
# 在它之前这条断言不可能成立 —— 移动端根本没有写备注的入口。
if t.get('note') != '$NOTE_TEXT':
    print('NONOTE:note=' + repr(t.get('note'))); raise SystemExit
print('OK dueDate=%s priority=%s note=%s' % (t['dueDate'], t['priority'], t['note']))
")
case "$VERDICT" in
  OK*) ok "笔记本侧拿到同一份数据：$VERDICT" ;;
  *)   bad "笔记本侧不一致：$VERDICT" ;;
esac

step "10. 直接查 Postgres"
psql -h 127.0.0.1 -p 5432 -U rocalight -d heyta_mobile_smoke -tAc \
  "SELECT (SELECT count(*) FROM operations) AS ops, (SELECT count(*) FROM sync_devices) AS devices" 2>/dev/null \
  | sed 's/^/      ops|devices = /'

summary "移动端任务编辑闭环"
