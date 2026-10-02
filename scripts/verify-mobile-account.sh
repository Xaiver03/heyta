#!/bin/bash
#
# 移动端「账号与安全」验收（真模拟器 + 真服务端，零 mock）
# ==========================================================
#
# 🔴 为什么必须有这个脚本
#
# 多端覆盖审计 P1-1：改密码 / 通行密钥管理在 app-host 里语义完整
# （`changePassword` / `listPasskeys` / `renamePasskey` / `deletePasskey`），
# web 全有，`apps/mobile` **零 import** —— 手机上魔法链接注册的账号没有任何
# 途径管理自己的凭据。单测证明不了壳挂上了，只有真机跑得出来。
#
# ## 🔴 变异靶（goal 硬规则 1）
#
# `changePassword` 成功时服务端 bump `tokenVersion`（全局计数器）并返回**新会话**
# —— 不把新令牌落盘，症状是"改个密码把自己这台设备也踢出去"（hosted-auth.ts
# 文件头的原话）。判据 3（改密后同步仍通）就是它的正面；变异（把"落盘新令牌"
# 的回调拿掉）⇒ 判据 3 恰好转红（同步 401）。台账在 goal §7。
#
# ## 账号从哪来
#
# 每轮 `/api/test/create-user` 新建（密码已知），token 填进 app——与
# verify-mobile-focus / -conflict 同一模式。改完密用 `/api/login/email-password`
# 换新令牌（协议级真调用）验证新密码生效、旧令牌 401（全局失效）。
#
# 通行密钥：移动端**没有 WebAuthn 平台桥**（`auth/passkey-host.ts` 是结论不是
# 占位），所以本验收只验**管理**（列表空态 + 入口可达）；"注册"在移动端
# 登记排除（接口已定好，接原生模块时只改 passkey-host 一个文件）。
#
# 用法：bash scripts/verify-mobile-account.sh
# 前置：模拟器在跑、服务端 TEST_MODE 在 :3000、/tmp/heyta_mobile_e2ee.txt（E2EE 口令）。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

# 每轮新建账号（已知密码）——覆盖 lib 从 /tmp 读的值（source 之后改才有效）。
STAMP=$(date +%H%M%S)
EMAIL="acct-e2e-${STAMP}@test.local"
OLD_PASS="OldPass123"
# 🔴 新密码必须过服务端策略（太短/太常见/已泄露都会拒）——实测 NewPass456
# 在 HIBP 泄露库里被拒；用每次随机的字母数字混合值。
NEW_PASS="Vx${STAMP}Qz9k"
TOKEN=""
E2EE=$(cat /tmp/heyta_mobile_e2ee.txt 2>/dev/null || echo "e2ee-passphrase")

# 🔴 与其它移动端验收互斥（lib 的防撞守卫）：两个实例同时在跑会互相
#    pm clear / 抢前台，症状是满屏"应用没起来"—— 实测踩过（两个本脚本的
#    残留实例互相打架，启动连续假红）。
# 🔴 函数返回的是 awk 的退出码（永远 0）—— 判断依据是**输出非空**，
#    不是退出码。写成 `if OUT=$(…)` 会在没有任何别的验收时也进本分支。
OUT=$(another_mobile_e2e_running)
if [ -n "$OUT" ]; then
  echo "❌ 有别的移动端验收正在跑，先等它结束："
  echo "$OUT"
  exit 1
fi

echo ""
echo "=== 移动端账号安全验收（真实模拟器 + 真服务端，零 mock）==="
echo "  设备: $E2E_SERIAL   服务端: $SERVER"
echo "  账号: $EMAIL"

step "0. 装包并启动"
$ADB shell am force-stop com.heytamobile >/dev/null 2>&1
$ADB uninstall com.heytamobile >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
# 🔴 monkey 偶发不起（模拟器高负载时静默失败，桌面留在前台）——起不来就重试，
#    别让"环境抖动"伪装成"产品没起来"。
# 🔴 前台判据用 topResumedActivity，不用 pidof：实测 Google Lens 的活动会
#    盖在应用上面（进程活着、界面全是 Lens），pidof 判不出来。
in_foreground() {
  $ADB shell dumpsys activity activities 2>/dev/null | tr -d '\r' | grep -q "topResumedActivity=.*$PKG"
}
LAUNCHED=0
for i in 1 2 3; do
  # Lens 残留任务会盖在最上面，先清掉再起。
  $ADB shell am force-stop com.google.android.googlequicksearchbox >/dev/null 2>&1
  $ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 6
  if in_foreground; then LAUNCHED=1; break; fi
done
if [ "$LAUNCHED" = "0" ]; then
  bad "三次启动都没到前台（模拟器状态？）"; summary "移动端账号安全" "" 1
fi
# 同意面板：改密与同步都要联网，选「同意并联网」。
WAITED=0
while [ "$WAITED" -lt 10 ]; do
  dump
  [ "$(has_text "在使用联网功能之前")" = "1" ] && break
  sleep 1; WAITED=$((WAITED + 1))
done
if [ "$(has_text "在使用联网功能之前")" = "1" ]; then
  XY=$(xy_desc "同意并联网"); [ -z "$XY" ] && XY=$(xy_text "同意并联网")
  if [ -n "$XY" ]; then $ADB shell input tap $XY; sleep 2; echo "   已同意联网"; fi
fi
dismiss_welcome_if_present
dump
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; fi

step "1. 建已知密码的测试账号"
RESP=$(curl -s -X POST "$HOST_SERVER/api/test/create-user" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${OLD_PASS}\"}")
TOKEN=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [ -n "$TOKEN" ]; then
  ok "账号已建（已知密码 ${OLD_PASS}，token 已取得）"
else
  bad "create-user 没走通：$RESP"; summary "移动端账号安全" "" 1
fi

step "2. 配置 app 凭据（用测试账号的令牌）"
configure_sync_credentials

step "3. 判据：「账号与安全」入口行在「我的」页"
$ADB shell input tap 945 2253; sleep 3
dump
if [ "$(has_text "账号与安全")" = "1" ]; then
  ok "「账号与安全」入口行已在（此前为零入口）"
else
  bad "「我的」页找不到「账号与安全」入口行"; screen_txt
fi

step "4. 判据：改密码（真 UI 提交 → 成功文案）"
XY=$(scroll_to_text "账号与安全")
if [ -z "$XY" ]; then
  bad "打不开账号与安全"; screen_txt
else
  $ADB shell input tap $XY; sleep 3
  dump
  XY=$(xy_edit "当前密码")
  if [ -z "$XY" ]; then bad "找不到「当前密码」输入框"; screen_txt; fi
  $ADB shell input tap $XY; sleep 1
  clear_and_type "$OLD_PASS" "当前密码"
  # 🔴 与 configure_sync_credentials 同一条纪律：键盘不收起会把下一个字段
  #    顶出屏，「新密码」就找不到了（实测红过一轮）。
  disable_ime; sleep 1.5
  dump
  XY=$(xy_edit "新密码")
  if [ -z "$XY" ]; then bad "找不到「新密码」输入框"; screen_txt; fi
  $ADB shell input tap $XY; sleep 1
  clear_and_type "$NEW_PASS" "新密码"
  disable_ime; sleep 1
  dump
  XY=$(xy_text "修改密码")
  if [ -z "$XY" ]; then bad "找不到「修改密码」提交按钮"; screen_txt; fi
  $ADB shell input tap $XY
  # 🔴 提交成功后宿主会立即触发一次同步 —— 新账号首次同步要走纯 JS 的
  #    Argon2id 派生（本模拟器实测 30–40 秒），Hermes 单线程被占满，
  #    「已修改」的渲染会迟到。固定 sleep 4s 是实测过的假红；轮询等它。
  DONE=0
  for i in $(seq 1 45); do
    dump
    if [ "$(has_sub "已修改")" = "1" ]; then DONE=1; break; fi
    sleep 2
  done
  if [ "$DONE" = "1" ]; then
    ok "改密码成功（界面确认）"
  else
    bad "45×2s 内没看到修改成功的确认（界面或服务端拒了）"; screen_txt
  fi
  $ADB exec-out screencap -p > /tmp/heyta-account-changed.png 2>/dev/null
fi

step "5. 变异靶正面：改密后同步仍通（新令牌已落盘）"
# 🔴 Android 返回键不会弹出 early-return 的第二层屏（没有 BackHandler），
#    它只会把应用最小化 —— 实测红过。用屏内顶栏的「返回」；且改密成功回调
#    已经触发过一次同步（form.submit），这里只需要**等它到已同步态**，
#    不需要再点按钮（Argon2 派生占线程时按钮文案是「正在同步…」，点了也没用）。
XY=$(xy_desc "返回")
if [ -n "$XY" ]; then
  $ADB shell input tap $XY; sleep 2
fi
$ADB shell input tap 945 2253; sleep 2
# ensure_phone_sync：自动同步抢跑时按钮是「正在同步…」，旧写法会假红（lib 里已修）。
STATE=$(ensure_phone_sync)
# 🔴 上面只是**点了**同步；判据必须等到**结果**。两个方向都轮询到位：
#    已同步（绿）与「登录凭据已失效」（401，= 变异态：新令牌没落盘）。
#    窗口给足 4 分钟 —— 新账号首次同步要走纯 JS Argon2id 派生（实测 30–40s+）。
RESULT=0
for i in $(seq 1 60); do
  dump
  if [ "$(has_sub "已是最新")" = "1" ] || [ "$(has_sub "其余数据已同步")" = "1" ]; then RESULT=1; break; fi
  if [ "$(has_sub "登录凭据已失效")" = "1" ]; then RESULT=2; break; fi
  sleep 4
done
if [ "$RESULT" = "1" ]; then
  ok "改密后同步仍通（状态卡已到已同步）—— 轮换令牌已落盘，没把自己踢出去"
elif [ "$RESULT" = "2" ]; then
  bad "同步被 401 拒（状态卡：登录凭据已失效）—— 新令牌没落盘（变异态？）"; screen_txt
else
  bad "4 分钟内同步没到已同步态"; screen_txt
fi

step "6. 新密码生效 + 旧令牌全局失效（协议级真调用）"
LOGIN=$(curl -s -X POST "$HOST_SERVER/api/login/email-password" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${NEW_PASS}\"}")
echo "$LOGIN" | grep -q "token" && ok "新密码能换到新会话（登录成功）" || bad "新密码登录失败：$LOGIN"
OLDHTTP=$(curl -s -o /dev/null -w "%{http_code}" "$HOST_SERVER/api/notifications" -H "authorization: Bearer $TOKEN")
if [ "$OLDHTTP" = "401" ]; then
  ok "改密前的旧令牌已 401（tokenVersion 全局失效，其余设备掉线的语义）"
else
  bad "旧令牌 HTTP 状态 = ${OLDHTTP}（预期 401）"
fi

step "7. 判据：通行密钥管理入口可达 + 空态正确（移动端无 WebAuthn，注册登记排除）"
XY=$(xy_text "账号与安全")
[ -z "$XY" ] && XY=$(xy_text "返回")
$ADB shell input tap 945 2253; sleep 2
XY=$(scroll_to_text "账号与安全")
if [ -z "$XY" ]; then bad "回不到账号与安全"; screen_txt; else
  $ADB shell input tap $XY; sleep 3
  dump
  if [ "$(has_sub "还没有通行密钥")" = "1" ] || [ "$(has_sub "电脑上注册")" = "1" ]; then
    ok "通行密钥空态正确（如实说明去哪里注册，不假装能加）"
  else
    bad "通行密钥段没有空态说明"; screen_txt
  fi
fi
$ADB exec-out screencap -p > /tmp/heyta-account-security.png 2>/dev/null
mkdir -p "$PWD/apps/mobile/evidence"
cp /tmp/heyta-account-changed.png "$PWD/apps/mobile/evidence/android-account-changed.png" 2>/dev/null
cp /tmp/heyta-account-security.png "$PWD/apps/mobile/evidence/android-account-security.png" 2>/dev/null
echo "     截图：apps/mobile/evidence/android-account-{changed,security}.png"

summary "移动端账号安全"
