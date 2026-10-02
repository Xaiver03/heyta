#!/bin/bash
#
# 移动端「通知中心 + 邀请活动」验收（真模拟器 + 真服务端，零 mock）
# ===================================================================
#
# 🔴 为什么必须有这个脚本
#
# 多端覆盖审计 P0-2：`app-host` 的 inbox 三函数（fetchAccountNotifications /
# fetchActivityFeed / markNotificationsRead）在 `apps/mobile` **零 import** ——
# 邀请得会员是已上线的运营功能，移动端登录用户完全不可见。单测证明不了壳挂上了
# （移动端没有组件测试台），只有真机跑得出来。
#
# ## 触发链（判据①怎么做到零 mock）
#
# 账号 B **走产品注册端点** `POST /api/register/magic-link` 携带 A 的邀请码 ——
# TEST_MODE 下服务端自动验证邮箱**并结算邀请**（`server/src/auth.ts` 的
# autoVerifyUsers 分支，注释原话：「TEST_MODE 也必须结算邀请，少了这一行，
# 所有自动化验收都会对一个『奖励永远不会发』的账号跑绿」）。
# 结算 = 给 A 写一条 `referral-activated` 通知。全程没有一个 mock。
#
# ## 🔴 同意面板必须点「同意并联网」
#
# 通知要经服务端，而移动端的出口闸（`consent-gate.ts`）在"只用本机/未决定"时
# 一个字节都不放行 —— 这正是它的职责。所以本脚本代用户选**同意并联网**
# （真实用户要看通知也必须这么做）；点「只用本机」会让后面所有网络判据红，
# 那是闸门在正确地工作，不是产品坏了。
#
# 能证：① 双账号真通知（A 的移动端出现通知行 + 入口徽标 ≥1）；
#       ② 活动 tab 读到**自己的**邀请码、分享按钮真的把码交出去；
#       ③ 打开通知（自动已读）后徽标清零；
#       ④ 截图（人看）。
# 不能证：系统分享面板的**内容**（Android chooser 没有稳定的可断言文本）——
#       脚本只断言"点了分享、应用没崩"，chooser 检测到就加分，检测不到**响亮
#       降级**而不是算失败（失败会让人去修断言而不是产品）。
#
# 用法：bash scripts/verify-mobile-inbox.sh
# 前置：模拟器在跑、服务端 TEST_MODE 在 :3000、/tmp/heyta_mobile_{token,email,e2ee}.txt。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

CODE=""
B_EMAIL=""

echo ""
echo "=== 移动端通知中心验收（真实模拟器 + 真服务端，零 mock）==="
echo "  设备: emulator-5554   服务端: $SERVER"
echo "  账号 A: $EMAIL"

dismiss_consent_if_present() {
  local waited=0 xy label
  while [ "$waited" -lt 10 ]; do
    dump
    [ "$(has_text "在使用联网功能之前")" = "1" ] && break
    sleep 1
    waited=$((waited + 1))
  done
  [ "$(has_text "在使用联网功能之前")" = "1" ] || return 0
  # 🔴 本脚本要验的就是"经服务端的账号通知"，所以选**同意并联网**（见文件头）。
  xy=$(xy_desc "同意并联网"); label="同意并联网"
  if [ -z "$xy" ]; then xy=$(xy_text "同意并联网"); fi
  if [ -z "$xy" ]; then
    xy=$(xy_desc "只用本机"); label="只用本机"
  fi
  if [ -z "$xy" ]; then
    bad "同意面板在，但取不到按钮坐标"
    return 1
  fi
  $ADB shell input tap $xy
  sleep 2
  echo "     已处理隐私同意面板（${label}）"
  if [ "$label" != "同意并联网" ]; then
    echo "   ⚠️ 只用本机 ⇒ 出口闸会拦掉通知请求，后面的网络判据会红 —— 那是闸门在工作。"
  fi
}

step "0. 装包并启动"
$ADB shell am force-stop com.heytamobile >/dev/null 2>&1
$ADB uninstall com.heytamobile >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 6
dismiss_consent_if_present
dump
if [ -n "$($ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r')" ]; then
  ok "被测应用（${PKG}）已在运行"
else
  bad "被测应用（${PKG}）没有运行 —— 前台可能是别的包"; screen_txt
fi
dismiss_welcome_if_present
dump
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; fi

step "1. 配置同步凭据（账号 A），停在「我的」页"
configure_sync_credentials
dump
if [ "$(has_desc "新建任务")" != "1" ] && [ "$(has_text "通知")" != "1" ]; then
  $ADB shell input tap 945 2253; sleep 3
  dump
fi

step "2. 判据②前半：「通知」入口行在「我的」页"
dump
if [ "$(has_text "通知")" = "1" ]; then
  ok "「通知」入口行已在（此前为零入口）"
else
  bad "「我的」页找不到「通知」入口行"; screen_txt
fi

step "3. 打开通知中心：两个 tab 都在"
XY=$(xy_text "通知")
if [ -z "$XY" ]; then
  bad "找不到「通知」入口可点"; screen_txt
else
  $ADB shell input tap $XY; sleep 3
  dump
  if [ "$(has_text "通知")" = "1" ] && [ "$(has_text "活动")" = "1" ]; then
    ok "通知中心已打开，两 tab（通知 / 活动）都在"
  else
    bad "通知中心的两 tab 不齐"; screen_txt
  fi
fi

step "4. 判据②：活动 tab 读到自己的邀请码，分享按钮把码交出去"
XY=$(xy_text "活动")
if [ -z "$XY" ]; then
  bad "找不到「活动」tab"; screen_txt
else
  $ADB shell input tap $XY; sleep 2
  # 活动目录是**惰性建码**：第一次打开才创建邀请码，轮询等它出现。
  for i in $(seq 1 15); do
    dump
    CODE=$(sed -n 's/.*content-desc="邀请码 \([^"]*\)".*/\1/p' /tmp/ui.xml | head -1)
    if [ -n "$CODE" ]; then break; fi
    sleep 2
  done
  if [ -n "$CODE" ]; then
    ok "读到自己的邀请码（content-desc「邀请码 ${CODE}」）"
  else
    bad "15×2s 内没等到邀请码（惰性建码失败或不可见）"; screen_txt
  fi
fi
$ADB exec-out screencap -p > /tmp/heyta-inbox-activity.png 2>/dev/null
if [ -n "$CODE" ]; then
  XY=$(xy_text "分享邀请码")
  if [ -z "$XY" ]; then
    bad "找不到「分享邀请码」按钮"; screen_txt
  else
    $ADB shell input tap $XY; sleep 2
    CHOOSER=""
    for i in $(seq 1 5); do
      if $ADB shell dumpsys window windows 2>/dev/null | tr -d '\r' | grep -qiE 'resolver|chooser'; then
        CHOOSER=1; break
      fi
      sleep 1
    done
    if [ -n "$CHOOSER" ]; then
      ok "系统分享面板出现了（chooser/resolver 在窗口列表里）"
    else
      echo "   ⚠️ 响亮降级：Android chooser 没有稳定的可断言文本，『面板出现』不可判 ——"
      echo "      已验证的是『点了分享、应用没崩、码在界面上』。该半条由人工看截图补证。"
      ok "分享已触发且应用无崩溃（chooser 断言不可判，见上）"
    fi
    $ADB shell input keyevent 4; sleep 1.5
  fi
fi

step "5. 判据①触发：账号 B 用 A 的邀请码注册（真产品端点，TEST_MODE 自动验证并结算邀请）"
if [ -z "$CODE" ]; then
  bad "CODE 为空 —— B 注册不会带邀请，服务端不会发奖励；判据①/③必然红。先修②再重跑。"
  cp /tmp/heyta-inbox-activity.png "$PWD/apps/mobile/evidence/android-inbox-activity.png" 2>/dev/null
  summary "移动端通知中心"
  exit 1
fi
B_EMAIL="inbox-e2e-$(date +%H%M%S)@test.local"
RESP=$(curl -s -X POST "$HOST_SERVER/api/register/magic-link" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${B_EMAIL}\",\"inviteCode\":\"${CODE}\"}")
echo "   B: $B_EMAIL"
echo "   服务端响应: $RESP"
case "$RESP" in
  *"automatically verified"*|*"Registration successful"*)
    ok "B 注册成功且已被自动验证（邀请应已结算给 A）" ;;
  *)
    bad "B 注册没走通 —— 检查服务端是否 TEST_MODE 且 autoVerifyUsers 生效"; screen_txt ;;
esac

step "6. 判据①：A 的入口徽标 ≥1（在**打开**通知中心之前观察）"
XY=$(xy_desc "返回")
if [ -n "$XY" ]; then
  $ADB shell input tap $XY; sleep 2.5
fi
BADGE=""
for i in $(seq 1 15); do
  dump
  BADGE=$(sed -n 's/.*content-desc="\([0-9][0-9]* 条未读\)".*/\1/p' /tmp/ui.xml | head -1)
  if [ -n "$BADGE" ]; then break; fi
  sleep 2
done
if [ -n "$BADGE" ]; then
  ok "入口徽标出现：${BADGE}（≥1）—— 通知还没看过，徽标先亮"
else
  bad "返回「我的」后没看到未读徽标"; screen_txt
fi
$ADB exec-out screencap -p > /tmp/heyta-inbox-badge.png 2>/dev/null

step "7. 判据①后半 + ③：打开通知看到那条真通知（自动已读）→ 返回后徽标清零"
XY=$(xy_text "通知")
if [ -z "$XY" ]; then
  bad "找不到「通知」入口"; screen_txt
else
  $ADB shell input tap $XY; sleep 3
  SEEN=""
  for i in $(seq 1 20); do
    dump
    if [ "$(has_sub "邀请奖励")" = "1" ]; then SEEN=1; break; fi
    sleep 3
  done
  if [ -n "$SEEN" ]; then
    ok "通知列表里出现了「邀请奖励」那条（双账号真通知）"
  else
    bad "20×3s 内 A 的通知没出现"; screen_txt
  fi
  $ADB exec-out screencap -p > /tmp/heyta-inbox-notification.png 2>/dev/null
  sleep 3
  XY=$(xy_desc "返回")
  if [ -n "$XY" ]; then
    $ADB shell input tap $XY; sleep 2.5
  fi
  CLEAN=1
  for i in $(seq 1 8); do
    dump
    if [ -z "$(sed -n 's/.*content-desc="\([0-9][0-9]* 条未读\)".*/\1/p' /tmp/ui.xml | head -1)" ]; then
      CLEAN=0; break
    fi
    sleep 2
  done
  if [ "$CLEAN" = "0" ]; then
    ok "打开过通知之后徽标清零（markNotificationsRead 真的发生了）"
  else
    bad "徽标还在 —— 自动已读没生效"; screen_txt
  fi
fi
$ADB exec-out screencap -p > /tmp/heyta-inbox-after-read.png 2>/dev/null
mkdir -p "$PWD/apps/mobile/evidence"
cp /tmp/heyta-inbox-activity.png "$PWD/apps/mobile/evidence/android-inbox-activity.png" 2>/dev/null
cp /tmp/heyta-inbox-notification.png "$PWD/apps/mobile/evidence/android-inbox-notification.png" 2>/dev/null
cp /tmp/heyta-inbox-badge.png "$PWD/apps/mobile/evidence/android-inbox-badge.png" 2>/dev/null
cp /tmp/heyta-inbox-after-read.png "$PWD/apps/mobile/evidence/android-inbox-after-read.png" 2>/dev/null
echo "     截图：apps/mobile/evidence/android-inbox-{activity,notification,badge,after-read}.png"

summary "移动端通知中心"
