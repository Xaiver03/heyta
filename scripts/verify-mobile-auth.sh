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
# 移动端**注册 / 登录旅程**验收（真模拟器 + 真服务端，零 mock）
# ============================================================
#
# 🔴 为什么必须有这个脚本
#
# 在这一刀之前，`apps/mobile` **完全没有**产生令牌的路径：
# 全库 `grep passkey|magic|login|register` 只命中注释，`@heyta/app-host` 的
# `hosted-auth` 是 **0 调用方**。表现是**没有报错**的：
#
#   · 用户能在手机上建任务、打卡、专注（本地优先本来就该这样）；
#   · 但他**永远拿不到访问令牌**，于是数据一条都出不去；
#   · 而「我的」页只有三个手填输入框，没有任何地方告诉他令牌从哪来。
#
# 所以这个脚本要钉住的不是"某个按钮能点"，而是规范 `user-journey-and-auth.md`
# 的那一段**旅程本身**：前置性（§3.1 的 J1）、可达性（§3.2 的 J2）、
# 中性文案（§2-A2 的 J3）、同意项不许预勾（§2-A4）、以及"登录之后同步立刻可用"。
#
# ═════════════════════════════════════════════════════════════════════════
# 判据与"能失败"
#
#   J1 **≤1 次点击**：冷启动 → 欢迎页 → 数着点击数点到注册/登录表单。
#      把「注册 / 登录」入口藏回设置深处，这一条立刻红。
#
#   J2 **拿到令牌**：注册 → （TEST_MODE 自动验证）→ 请求登录链接 →
#      从数据库取出那封邮件里本来会带着的令牌 → 粘回应用 → 拿到 token。
#      把 `saveAuthSession` 做成空操作（或让 `verifyMagicLink` 的结果不落盘），
#      「访问令牌」输入框就是空的 —— 第 5 步立刻红，第 6 步的全链路也红。
#
#   J2 续 **另一台设备可见**：手机建一条任务，笔记本（真 SQLite）必须读到。
#      这是"令牌真的能同步"的全链路证据 —— 前一条只证明它**写在界面上**。
#
#   J3 **中性文案**：注册那一步断言界面上**不含**"账号已创建"这类断言
#      （规范 §2-A2：服务端防枚举时会"假成功"）。换成断言性文案这一条立刻红。
#
#   A4 **同意项不许预勾**：不勾就点注册，必须**在本地**被拦住并说清原因，
#      而且**一个请求都没发**（服务端日志不增长）。
#
#   G-11 **首启必须征求过隐私同意**：第 0 步刚 `pm clear`（= 全新设备、从没被问过），
#      所以那块面板**必须**出现 —— "没出现"不是省一步，是这条要求的失败。
#      出现过之后点「同意并联网」（本旅程要联网，选另一边会让第 2–6 步结构性
#      不可能通过），并复验它真的收起来了。
#      ⚠️ 这块面板是一块盖住整屏的 RN Modal（`accessibilityViewIsModal`）：
#      它立着的时候欢迎页/主界面的节点**不在无障碍树里**。本脚本曾经**完全没处理**
#      它，结果是第 1–6 步整片"找不到按钮 / 第一屏没有注册登录"的**假红**，
#      而产品一条都没坏。
#
#   G-11 续 **决定跨启动落盘**：第 7 步 force-stop 再启动（不 `pm clear`）时
#      不许再问一遍 —— 已经做过选择的人不该每次冷启动被问一次。
#      ⚠️ 这条判据**必须排在"欢迎页不许回来"之前**：面板盖屏时「先离线使用」
#      读不到，那句会被印成假绿，真因要到下一条才露头。
#
#   J5-移动 **欢迎页不再自动出现**：force-stop 再启动（不 `pm clear`），
#      欢迎页不许回来 —— 证明那个偏好是**持久化**的，不是只放内存。
#
# ⚠️ 这个脚本里**没有**任何 mock：模拟器是真的、服务端是真的、SMTP 之外
#    的每一步都是真的。唯一"代替用户做的事"是从数据库里把邮件令牌取出来 ——
#    因为跑批的机器没有收件箱（服务端在没配 SMTP 时走 Ethereal，邮件只在
#    预览 URL 里）。这一步是**读服务端已经写下的真值**，不是造一个假令牌。
#
# 用法：
#   bash scripts/verify-mobile-auth.sh
#
# 前置：模拟器在跑、Postgres 在 5432、服务端在 3000（**TEST_MODE**）。
#       账号每轮新建并写入 /tmp/heyta_mobile_{token,email,e2ee}.txt。
#
# 🔴 **同一台模拟器上一次只能跑一个移动端验收。**
#    这些脚本都会 `pm clear` + 装包 + 按坐标点击；两个同时跑会互相把对方的
#    应用状态清掉，症状是满屏"找不到按钮""应用没起来"—— 看起来像产品坏了，
#    其实只是撞车。跑之前先确认没有别的 `verify-mobile-*.sh` 在跑
#    （`pgrep -fl verify-mobile`）。

# ── 先准备账号，再加载共享库（顺序不能反，理由见 verify-mobile-conflict.sh）──
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
heyta_e2e_ensure_account || exit 1
. "$(dirname "$0")/lib/mobile-e2e.sh"

# 被测产物指哪儿（沿用 `verify-mobile-quadrant-fill.sh` 已有的 `HEYTA_APK` 口径，
# lib 里那条共享构建路径不改 —— 别的会话还在用它）。
# 🔴 这里要它能指是因为**主检出的工作树正被别的会话的未提交改动占着**：
#    就地打出来的 APK 混着别人的源码，而"装的是当前提交"必须是可以归因的
#    （AGENTS §6.1.1、§7 第 27/82 条）。所以本轮在隔离检出里按 HEAD 打，
#    把那份 APK 指过来。默认值仍是原本那条路径。
APK="${HEYTA_APK:-$APK}"

TITLE="auth-e2e-$(date +%H%M%S)"
# 同一账号的另一台设备：笔记本用**建号脚本发的**令牌（`$TOKEN`）。
# 🔴 手机必须**自己**登进同一个账号（见第 4 步），否则第 6 步就变成
#    "两个不相干的账号互相看不见"，而那不会有任何报错。
LAPTOP_ROUNDS="${HEYTA_AUTH_LAPTOP_ROUNDS:-180}"

# 界面标签（词条表里的原文）。用变量而不是散落的字面量：词条改名时
# 这里一处可见 —— 见 `lib/mobile-e2e.sh` 里 "辅助会漂移就会制造假绿" 那段。
L_SIGNIN="注册 / 登录"
L_OFFLINE="先离线使用"
L_EMAIL="邮箱"
# 🔴 两个秘密各有一枚标签，而且**都不许共用**：这一枚是发给服务端验 Argon2id 的
# 登录密码，下一枚是永不出设备的加密口令。共用一枚的界面会让人以为
# "忘了登录密码 = 忘了数据"。
L_LOGIN_PASSWORD="登录密码"
L_E2EE="加密口令"
L_TOKEN="访问令牌"
L_TERMS="我同意服务条款与隐私政策，并允许本机联网"
# 未勾同意时共享表单自己说的那句（`common.auth.error.termsRequired`）。
L_TERMS_ERROR="注册前请先勾选同意项"
# 模式切换（共享表单底部那枚次级出口）。⚠️ 它与主按钮 5 个字都不一样，
# 所以按文本定位不会串到主按钮上。
L_TO_REGISTER="还没有这个邮箱的账号？创建一个"
L_TO_SIGNIN="已经有账号了？直接登录"
# 注册档的第二格密码（AuthForm 的 confirmPassword）。它与「登录密码」是两枚不同的标签，
# ⚠️ 顺序也有讲究：`scroll_to_edit` 是按**标签**找的，两格都叫"密码"就会点错格。
L_CONFIRM_PASSWORD="再次输入密码"
L_CODE_TITLE="验证邮箱"
L_CHANGE_EMAIL="更改邮箱"
L_SIGNED_IN="已登录"
L_SAVE_SYNC="保存并启用同步"
# 主按钮与表单节点一律按 **testID** 定位（线上是 `resource-id`）：
# 「登录」这两个字在屏幕上不止一处（切换链接里也有），按文本点会串到别的控件上，
# 而症状是"点完没反应"—— 看起来像按钮坏了。
ID_SUBMIT="mobile-auth-form-submit"
ID_EMAIL="mobile-auth-form-email"
ID_PASSWORD="mobile-auth-form-password"
ID_TERMS="mobile-auth-form-terms"
# 首屏那两枚按钮（WelcomeScreen）。🔴 按 testID 定位：`content-desc` 在 MIUI 上会被
# 合成串顶掉，`has_desc` 是精确匹配 ⇒ 落空，而失败信息只会说"入口不在第一屏"。
ID_WELCOME_SIGNIN="welcome-signin"
ID_WELCOME_OFFLINE="welcome-offline"
ID_SWITCH="mobile-auth-form-switch-mode"

PG_DB="$E2E_DB"
PG_USER="$E2E_DB_USER"

# 🔴 **前置：这台模拟器上不能同时跑两个移动端验收。**
#
# 两者都会 `pm clear` + 装包 + 按坐标点击，于是对方的应用状态会被自己清掉：
# 症状是"应用没起来""冷启动第一屏没有注册/登录"—— 看起来像产品坏了。
# 与其让它变成一堆假红，不如**在动手之前就拒绝**（退出码 3 = 环境不成立，
# 与 `require_screen` 同一约定：3 不是"有断言失败"，两者的处置完全不同）。
BUSY=$(another_mobile_e2e_running)
if [ -n "$BUSY" ]; then
  echo "   ❌ 本机还有**别的**移动端验收在跑 —— 同一台模拟器上并行必然互相破坏。" >&2
  echo "      ${BUSY}" >&2
  echo "      等它跑完再重跑本脚本（本脚本自己不会去抢设备）。" >&2
  exit 3
fi

# ── 关掉系统动画，并在退出时还原 ─────────────────────────────────────────────
#
# 🔴 2026-10-26 实测：首屏有**无限循环**的背景动效，于是窗口永远不进入 idle，
#    `adb shell uiautomator dump` 直接报 `could not get idle state` ——
#    设备腿里**每一条**基于 dump 的断言都拿不到界面，报出来是"拿不到真实界面（环境失败）"。
#    两处都修了：应用侧去掉常驻循环（换页的淡入有终点，保留）；脚本侧在这里关掉
#    系统动画 —— 它同时也让 RN 的 `AccessibilityInfo.isReduceMotionEnabled()` 为真，
#    于是**「减少动效」那条分支在真机上也被真的走了一遍**。
# ── 设备侧服务端地址若是 127.0.0.1，必须自己establish `adb reverse` ──────────
#
# 🔴 实测两次踩在同一处：`adb reverse` 是**会话级/设备级**的映射，
#    **设备一重启就没了**（本轮模拟器为了切 zh-CN 重启过两次），
#    而症状是界面上那句「连不上服务端，检查地址与网络后重试」——
#    看起来像服务端没起或地址填错，其实是设备侧根本没有那条转发。
#    所以：只要设备侧地址是回环，就在**跑之前**重建一次，不靠调用方记得。
# ⚠️ 用 `-E` 而不是 `\?`：BSD sed（macOS）对 `s|^https\?://||` 不按"可选 s"解释，
#    于是 `http://127.0.0.1:3210` 会被第二段正则截成 `http` —— 分支静默不成立，
#    而症状正是"界面说连不上服务端"（本轮实测：三次跑里只有一次真的建立了映射）。
_dev_host=$(printf '%s' "$SERVER" | sed -E -e 's|^https?://||' -e 's|[:/].*$||')
_dev_port=$(printf '%s' "$SERVER" | sed -E -e 's|^https?://[^:/]*||' -e 's|^:||' -e 's|/.*$||')
if [ "$_dev_host" = "127.0.0.1" ] || [ "$_dev_host" = "localhost" ]; then
  if $ADB reverse "tcp:${_dev_port:-3210}" "tcp:${_dev_port:-3210}" >/dev/null 2>&1; then
    echo "   ✅ 已建立 adb reverse tcp:${_dev_port:-3210}（设备回环 → 宿主机 → 你本机的服务端）"
  else
    echo "   ❌ adb reverse 建立失败 —— 设备侧连不到服务端，后面每一条网络断言都会是假红" >&2
    exit 3
  fi
fi

_old_animator=$($ADB shell settings get global animator_duration_scale 2>/dev/null | tr -d '\r')
_old_transition=$($ADB shell settings get global transition_animation_scale 2>/dev/null | tr -d '\r')
_old_window=$($ADB shell settings get global window_animation_scale 2>/dev/null | tr -d '\r')
$ADB shell settings put global animator_duration_scale 0 >/dev/null 2>&1
$ADB shell settings put global transition_animation_scale 0 >/dev/null 2>&1
$ADB shell settings put global window_animation_scale 0 >/dev/null 2>&1
# 🔴 自动填充同样要关（2026-10-26 实测）：共享表单的字段带
#    `autocomplete="username"/"current-password"`，于是提交之后**系统的"保存密码"弹窗**
#    会盖在界面上 —— 脚本下一次 `tap` 落在弹窗上，报出来是"提交之后没有进入「验证邮箱」
#    阶段"，而产品完全正常。这类"系统弹窗偷走我的一击"在设备腿上必须提前关掉，
#    不能靠运气。
_old_autofill=$($ADB shell settings get secure autofill_service 2>/dev/null | tr -d '\r')
$ADB shell settings put secure autofill_service null >/dev/null 2>&1

restore_device_animations() {
  $ADB shell settings put global animator_duration_scale "${_old_animator:-1}" >/dev/null 2>&1
  $ADB shell settings put global transition_animation_scale "${_old_transition:-1}" >/dev/null 2>&1
  $ADB shell settings put global window_animation_scale "${_old_window:-1}" >/dev/null 2>&1
  # 空值 = 关闭自动填充；还原成原来那串（默认常见值是 null，那就还是 null）。
  if [ -n "${_old_autofill:-}" ] && [ "$_old_autofill" != "null" ]; then
    $ADB shell settings put secure autofill_service "$_old_autofill" >/dev/null 2>&1
  else
    $ADB shell settings put secure autofill_service null >/dev/null 2>&1
  fi
}
# ⚠️ 必须 trap 而不是只写在结尾：中途 `exit 3`（环境失败）也要还原，
#    否则这台设备会**永久**停在"动画全关"上，而下一个人看到的是"界面突然变生硬"。
#
# 🔴 **不许直接 `trap … EXIT`**：共享库 `lib/mobile-e2e.sh` 已经装了一个 EXIT trap
#    （`restore_ime` 之类），裸覆盖会把它**静默换掉** —— 症状是这一趟关过软键盘、
#    跑完设备却没有软键盘，而且只有跑到第 7 步的那条自检会发现（本轮就是它发现的）。
#    所以：先把现有的 trap 命令串取出来，再串上我们这一句。
_prev_exit_trap=$(trap -p EXIT | sed -e "s/^trap -- '//" -e "s/' EXIT$//")
if [ -n "${_prev_exit_trap:-}" ]; then
  trap "restore_device_animations; eval \"${_prev_exit_trap}\"" EXIT
else
  trap restore_device_animations EXIT
fi

echo ""
echo "=== 移动端注册 / 登录旅程验收（真实模拟器 + 真服务端，零 mock）==="
echo "  设备: $E2E_SERIAL   服务端: $SERVER   库: $PG_DB"
echo "  账号: ${EMAIL}（手机将**自己登录**这个账号，不是用手填令牌）"
echo "  任务: $TITLE"

if [ "${#TOKEN}" -lt 100 ]; then
  echo "❌ 令牌看起来不对（长度 ${#TOKEN}）—— 先跑建号脚本"; exit 1
fi

# 读**服务端写下的**邮件令牌。
#
# 🔴 只在"还没有令牌"时读，并且**轮询**：`requestLoginMagicLink` 是先发邮件、
#    成功了才保留 `loginToken`（发信失败会把它清回 null），所以点完按钮之后
#    有一个真实的窗口期。轮询 60 秒足够；读不到就是失败，**不编一个**。
read_login_token() {
  local email="$1" i token
  for i in $(seq 1 20); do
    token=$(psql -h 127.0.0.1 -p 5432 -U "$PG_USER" -d "$PG_DB" -tAc \
      "SELECT login_token FROM users WHERE email = '$email';" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$token" ] && [ "$token" != "NULL" ]; then
      printf '%s' "$token"
      return 0
    fi
    sleep 3
  done
  return 1
}

# 某个邮箱在服务端**有没有账号**。回显行数，查不到回 `unknown`。
#
# 🔴 判据必须来自**服务端写下的真值**，不能来自"界面上说了什么"：
#    界面文案是客户端自己渲染的，客户端自己坏了它也会照说。
#    这里直接问数据库 —— 与 `heyta_e2e_assert_client_budget` 同一条路子。
# ⚠️ **查不到不等于通过**：`unknown` 必须被调用方判成失败，
#    否则"psql 连不上"会被读成"服务端没建号"（一条恒真的检查）。
user_exists() {  # <email>  → 行数 | unknown
  local n
  n=$(psql -h 127.0.0.1 -p 5432 -U "$PG_USER" -d "$PG_DB" -tAc \
    "SELECT count(*) FROM users WHERE email = '$1';" 2>/dev/null | tr -d '[:space:]')
  case "$n" in
    '' | *[!0-9]*) printf '%s' "unknown" ;;
    *) printf '%s' "$n" ;;
  esac
}

# 界面里**不含**某段文本。与 `has_sub` 配对使用 —— "断言一句话不存在"
# 与"断言一句话存在"一样重要（J3 就是靠它成立的）。
hasnt_sub() { grep -q "text=\"[^\"]*$1" "$UI_XML" 2>/dev/null && echo 0 || echo 1; }

# 把一个**滚动面板**拨回顶部。
#
# 🔴 为什么必须有它：注册/登录面板比一屏长，而 `scroll_to_desc` / `scroll_to_edit`
#    会在找控件时把面板**滚下去**。于是"上一步之后的提示语"（它渲染在面板
#    最上面）滚出了可视区 —— 实测第 3/4 步的失败就是这样：请求**真的发出去了**
#    （第 4 步从库里读到了服务端写下的登录令牌！），但断言说"没有看到中性文案"。
#    不修的话，这条验收会把"滚过头"报成"界面没说那句话"。
#
# ⚠️ 方向：`input swipe y1 y2`（y1 < y2）= 手指往下拖 = 内容往下走 = **向上滚**。
scroll_panel_to_top() {
  local _i
  for _i in 1 2 3 4; do
    $ADB shell input swipe 540 900 540 1950 200
    sleep 0.8
  done
}

# 把一段界面文本断言在**可读位置**上：先回顶，再抓，再匹配。
# 返回 1/0，与 `has_sub` 同形。
has_sub_after_scroll_top() {  # <片段>
  scroll_panel_to_top
  dump
  has_sub "$1"
}

# 在一个输入框里填值（必要时先把它滚进可点区域）。
# ⚠️ 用 `scroll_to_edit` 而不是 `xy_edit`：注册/登录面板比一屏长，
#    折叠线以下的输入框**仍在无障碍树里**，但它的中心点落在键盘或标签栏上。
fill_field() {  # <标签> <值>
  local label="$1" value="$2" xy
  xy=$(scroll_to_edit "$label")
  if [ -z "$xy" ]; then bad "找不到输入框：$label"; return 1; fi
  $ADB shell input tap $xy; sleep 1.2
  clear_and_type "$value" "$label"
}

# ── 认证屏专用的小工具（2026-10-26）──────────────────────────────────────────
#
# 🔴 `tap_id`：按 **testID** 点，不按文案点。
#    「登录」这两个字在这一屏上不止一处（主按钮 + 底部「已经有账号了？直接登录」），
#    按文案取坐标会串到别的控件上 —— 症状是"点了没反应"，看起来像按钮坏了。
#    testID 不跟着文案合成变，是这里唯一稳的锚点。
#
# 🔴 收键盘那一下**必须**先判"键盘是不是真的开着"：`input keyevent 4` 在键盘
#    已收起时是**返回**，会把整个认证屏退掉。于是后面每一步都落在欢迎页上，
#    报出来的是"找不到按钮"—— 一次误判会在日志里长成十几个产品缺陷。
auth_hide_keyboard() {
  local shown
  shown=$($ADB shell dumpsys input_method 2>/dev/null | grep -c "mInputShown=true" | tr -d ' ')
  if [ "${shown:-0}" != "0" ]; then
    $ADB shell input keyevent 4 >/dev/null 2>&1
    sleep 0.8
  fi
}

# 落到「我的」标签。
# 🔴 优先按 **testID**（`tab-profile`）定位：标签栏的 `content-desc` 在部分机型上会被
#    合成（`"我的, …"`），`xy_desc` 是**精确**匹配 ⇒ 精确匹配落空，而失败信息只说
#    "标签栏上没有「我的」"，看起来像产品少了一个 tab。
tap_profile_tab() {
  local xy
  xy=$(xy_rid "tab-profile")
  if [ -z "$xy" ]; then
    dump
    xy=$(xy_rid "tab-profile")
  fi
  if [ -z "$xy" ]; then
    bad "标签栏上没有「我的」（testID=tab-profile）"
    return 1
  fi
  $ADB shell input tap "$xy"
  sleep 3
  return 0
}

# 点掉"保存密码"这类**系统**弹窗。
#
# 🔴 它们是异步出现的：关掉 autofill 之后多数机型不再弹，但个别 ROM 仍会插一句。
#    判据不能假设"界面上只有我们的东西" —— 一次弹窗就足以让后面每一步都错位，
#    而日志会说"没有进入验证邮箱阶段"，看起来像产品坏了。
dismiss_system_prompt() {
  local xy
  dump
  for label in "取消" "以后再说" "不保存" "暂不"; do
    xy=$(xy_text "$label" 1)
    if [ -n "$xy" ]; then
      $ADB shell input tap "$xy"; sleep 1
      echo "     （点掉了系统弹窗：「${label}」）"
      return 0
    fi
  done
  return 1
}

tap_id() {  # <testID> <人话>
  local xy
  auth_hide_keyboard
  xy=$(scroll_to_rid "$1")
  if [ -z "$xy" ]; then
    bad "找不到「$2」（testID=$1）—— 滚 5 次也不在可点区"
    return 1
  fi
  $ADB shell input tap $xy
  return 0
}

# ── 0. 装包并**冷启动**（全新安装 = 全新设备身份）────────────────────────────
step "0. 装包并冷启动（欢迎页必须出现 —— 这一轮**不**点「先离线使用」）"
# 🔴 **先卸掉改名前的旧包**（`com.heytamobile`）。
#
# `build.gradle` 里 `applicationId` 已经是 `com.heyta`，而 `namespace` 仍是
# `com.heytamobile`。这台模拟器上曾经装过改名前的包，它**长得一模一样**：
# 一旦它留在前台（`am start` 指向不存在的类时就会这样），这台设备上所有
# 基于界面的断言都会对着**另一个应用**做 —— 而失败信息只会说"找不到按钮"。
# 卸掉它，让"这台设备上只有一个 heyta"成为一条**前提**，而不是运气。
$ADB uninstall com.heytamobile >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
# 🔴 `pm clear` 是这里的关键：它把设备本地偏好（`welcome.hasSeen`）一起清掉，
#    于是下一次启动就是**真正的首次启动**。不清的话这个脚本第二次跑就
#    看不到欢迎页了，而"看不到"会被误报成"功能坏了"。
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
launch_app; sleep 12
# 🔴 **轮询**而不是看一眼：`pm clear` 之后是冷启动 + 全新 SQLite 初始化，
#    实测在这台模拟器上偶尔超过 12 秒。单次判断会把"慢"报成"应用没起来"，
#    而后面每一条断言都会跟着红 —— 一次环境慢被写成十几个产品缺陷。
APP_UP=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -n "$($ADB shell pidof $PKG 2>/dev/null | tr -d '\r')" ]; then APP_UP=1; break; fi
  sleep 2
done
[ "$APP_UP" = "1" ] && ok "应用已启动" || bad "应用没起来（轮询 20 秒仍没有进程）"

# 🔴 **先把软键盘关掉，再碰任何按钮。**
#
# 这一条是实测撞出来的：注册/登录面板比一屏长，填完邮箱之后软键盘会占掉
# 下半个屏幕，而 `xy_desc` 给出的按钮坐标**仍然在无障碍树里**（树不关心遮挡）——
# 于是点「注册新账号」点到了键盘上：真实输入框里多出一个 `v`、后面还跟着
# 一个 😛，而断言只会说"没有看到中性文案"。四个步骤的失败全都来自这一条。
#
# `disable_ime` 是共享库里的既有做法（`configure_sync_credentials` 第一件事就是它），
# 而且不会影响输入：`input text` 是把按键事件**直接注入 InputManager** 的，
# 不需要 IME 可见。退出时 `trap restore_ime EXIT` 会恢复。
disable_ime; sleep 2

# ── 0.5 首启隐私同意面板：它**必须**出现，出现就必须点掉 ──────────────────────
#
# 🔴 为什么这一步是**判据**而不是"顺手清掉的前置噪声"
#
# 第 0 步刚跑过 `pm clear` = 全新安装 = 这台设备**从没被问过**。而 G-11 要求的
# 就是"首次启动必须向用户征求过隐私同意"。所以在这一轮里
# 「面板没出现」不是一个可以跳过的情况，**它是这条要求的失败**。
#
# 之前这个脚本**完全没有**处理这块面板，症状不是"少一条判据"而是**整片假红**：
# 面板是一块 `accessibilityViewIsModal` 的 RN Modal，立着的时候欢迎页和主界面的
# 节点**根本不在无障碍树里**，于是第 1 步报"冷启动第一屏没有注册/登录"、
# 第 2–6 步报"找不到输入框/找不到按钮"。产品一条都没坏。
# （同族做法散在另外五个安卓脚本里各抄一份，抄漏的就是这里 —— 现在收进
# `lib/mobile-e2e.sh` 的 `handle_privacy_consent`。）
#
# ⚠️ 选**「同意并联网」**：本脚本验的是注册 / 登录 / 跨设备同步，
#    而出口闸（`apps/mobile/src/privacy/consent-gate.ts`）在"只用本机/未决定"时
#    一个字节都不放行。点「只用本机」会让第 2–6 步结构性不可能通过 ——
#    那是闸门在正确地工作，不是产品坏了。真用户要登录也必须选这一边。
step "0.5 首启隐私同意面板：pm clear 之后**必须**问到（G-11），并点「同意并联网」"
# 🔴 先要一张**真界面**再判"问没问"。`handle_privacy_consent` 内部靠 `dump` 找面板，
# 而宿主机过载时 `uiautomator` 会连续失败、把 `/tmp/ui.xml` 截成**空文件** ——
# 那时 `CONSENT_GATE_SEEN=0` 的含义是"什么都没抓到"，不是"产品没问"。
# 2026-10-03 12:35 那一跑就是这个形状：负载窗口刚开、设备却被另一条验收占着，
# 连着 10 次抓空，这两条判据当场印出两条 ❌（真凶是探针，产品一条没坏）。
dump
require_screen
handle_privacy_consent "同意并联网"; CONSENT_RC=$?
if [ "$CONSENT_GATE_SEEN" = "1" ]; then
  ok "冷启动**问过了**（首启隐私同意面板出现过）—— G-11 成立"
else
  bad "pm clear 之后冷启动**没有**征求隐私同意 —— G-11（首启必须问）不成立"
fi
if [ "$CONSENT_RC" = "0" ] && [ "$CONSENT_GATE_SEEN" = "1" ]; then
  ok "面板已点掉（「${CONSENT_GATE_CHOSEN}」），下面才开始数 J1 的点击数"
else
  bad "隐私同意面板没能收起来（rc=${CONSENT_RC}）—— 它盖着整屏，后面的界面断言全部不可信"
  screen_txt
fi

heyta_e2e_assert_client_budget || bad "账号 client 数已逼近向量时钟上限（后续断言不可信）"

# ── 1. J1：冷启动后 ≤1 次点击见到注册/登录表单 ──────────────────────────────
# ⚠️ **计数起点是隐私同意面板之后**（0.5 步），理由写在上面：那是一次性的法定
#    前置询问，问的是"这台设备能不能对外说话"，不是"你要不要登录"（两处问的不是
#    同一个决定，所以产品没有把它们合并 —— 见 `apps/mobile/src/privacy/startup.ts`）。
#    它单独由 0.5 那两条判据覆盖，不是没验。
step "1. J1 前置性：冷启动 → **数着点击数**到注册/登录表单（≤1，不含 0.5 那次法定询问）"
CLICKS=0
# 🔴 先把应用拉回前台再断言。
#
#    实测（run8）：同意面板点掉后约 7 秒，MIUI 把应用切成 `invisible -> background`，
#    前台回到桌面 —— **进程还活着**（`pidof` 有值），也没有任何崩溃日志。
#    于是接下来每一条断言都在对着**桌面**做，报的是"冷启动第一屏没有「注册 / 登录」"
#    和"欢迎页没有「先离线使用」"—— 看起来像产品丢了入口，其实是应用不在前台。
#
#    `ensure_app_foreground` 是共享库已有的那道闸（它会解析真实组件名再 `am start`），
#    这里只是把它用在"刚处理完系统面板"这个最容易被踢到后台的位置。
ensure_app_foreground || bad "应用无法回到前台（本轮后续断言都不可信）"
dump
require_screen

ENTRY_VISIBLE=0
[ -n "$(xy_rid "$ID_WELCOME_SIGNIN")" ] && ENTRY_VISIBLE=1
[ "$ENTRY_VISIBLE" = "0" ] && [ "$(has_desc "$L_SIGNIN")" = "1" ] && ENTRY_VISIBLE=1

[ "$ENTRY_VISIBLE" = "1" ] \
  && ok "冷启动第一屏就有「${L_SIGNIN}」（0 次点击就**看得见**它）" \
  || {
    # 🔴 区分"我的界面坏了"与"这轮被别的验收清掉了"。前者要改代码，
    #    后者要重跑 —— 把两者混成一句"入口不在第一屏"会把方向整体带偏。
    BUSY_NOW=$(another_mobile_e2e_running)
    if [ -n "$BUSY_NOW" ]; then
      echo "" >&2
      echo "   ❌ 检测到**别的移动端验收**在我跑的期间启动了 —— 本轮结果无效（环境失败，不是产品失败）。" >&2
      echo "      ${BUSY_NOW}" >&2
      exit 3
    fi
    bad "冷启动第一屏没有「${L_SIGNIN}」—— 入口不在第一屏"
  }

# 🔴 反证：此时**必须还没有**邮箱输入框。不然"1 次点击看到表单"这句话
#    会在"表单本来就在第一屏"的情况下自动成立，什么也没验到。
if [ -z "$(xy_edit "$L_EMAIL")" ]; then
  ok "此刻还看不到邮箱输入框（说明下面那一次点击是真的把表单叫出来的）"
else
  bad "冷启动直接就在表单上 —— 这一条没验到「点击→表单」这个动作"
fi

XY=$(xy_rid "$ID_WELCOME_SIGNIN")
[ -z "$XY" ] && XY=$(xy_desc "$L_SIGNIN")
if [ -z "$XY" ]; then
  bad "取不到「${L_SIGNIN}」的坐标"
else
  $ADB shell input tap $XY; CLICKS=$((CLICKS + 1))
  sleep 3
  dump
  # 🔴 官方托管档（`DEFAULT_SERVER_URL`）走的是**统一身份**：这一屏上根本没有
  #    邮箱输入框，只有「使用统一身份登录」。把"必须见到邮箱框"当判据的话，
  #    这条在官方档上恒红 —— 而产品是对的（那正是它该给的东西）。
  #    所以判据是「到了**认证屏**」：官方档 = 统一身份卡，自托管档 = 邮箱表单。
  if [ -n "$(xy_edit "$L_EMAIL")" ] || [ "$(has_sub "使用统一身份登录")" = "1" ]; then
    ok "第 $CLICKS 次点击就到了认证屏（官方档给统一身份 / 自托管档给邮箱表单）"
    # 🔴 这一句**必须在"真的到了表单"里面**。放在外面的话，把按钮做成
    #    "点了没反应"时它会照样印 ✅「J1 成立」—— 前一行已经红了，
    #    而总结行还在说成立，读日志的人会被这一句骗过去（实测撞到过）。
    [ "$CLICKS" -le 1 ] && ok "点击数 $CLICKS ≤ 1（J1 成立）" || bad "点击数 $CLICKS > 1"
  else
    bad "点了「${L_SIGNIN}」之后仍然看不到邮箱输入框"; screen_txt
    bad "点击数 ${CLICKS}，但没有到达表单 —— J1（≤1 次点击见到表单）不成立"
  fi
fi

# ── 1.5 转进「设置 → 同步 → 自托管」那条路 ──────────────────────────────────
#
# 🔴 为什么必须转过去，而且**地址要先在设置表单里填**：
#
#    · 设备侧地址：模拟器有 `10.0.2.2` 这个宿主机别名，**真机没有**。真机要么给
#      应用一个真实可达的 https origin（跑批机器没有 DNS/证书），要么
#      `adb reverse tcp:<port> tcp:<port>` + 手填 `http://127.0.0.1:<port>`。
#    · 更关键的一条：认证屏自己判 `centralMode`（`isOfficialCentralAuthEndpoint(serverUrl)`）。
#      `serverUrl` 的初值来自**打开它之前**同步设置里的地址 —— 还是官方 origin 时，
#      屏幕给的是「使用统一身份登录」卡，**邮箱 + 口令那张表单压根不渲染**。
#      所以"在认证屏里填地址"是走不通的：必须在**设置表单**里先填，再点登录。
#      这一条以前没人写下来，而它的症状正是"点了登录看不到表单"。
step "1.5 转进设置路径：先把服务端地址填进同步设置（真机没有 10.0.2.2 别名）"

# 退出认证屏。🔴 按 testID 点，不按「返回」两个字：官方档那张卡与共享表单的
# 关闭按钮都叫「返回」，按文案取坐标会点到另一个（或点到屏幕外）。
if [ -n "$(xy_rid "mobile-auth-form-close")" ]; then
  tap_id "mobile-auth-form-close" "关闭" >/dev/null 2>&1
elif [ -n "$(xy_rid "mobile-central-auth-back")" ]; then
  tap_id "mobile-central-auth-back" "返回" >/dev/null 2>&1
else
  XY=$(xy_desc "返回")
  [ -n "$XY" ] && $ADB shell input tap $XY
fi
sleep 2.5

XY=$(xy_rid "$ID_WELCOME_OFFLINE")
[ -z "$XY" ] && XY=$(xy_desc "$L_OFFLINE")
if [ -z "$XY" ]; then
  bad "欢迎页没有「${L_OFFLINE}」"
else
  $ADB shell input tap $XY; sleep 7
  ok "进入主界面（先离线使用）"
fi

# 🔴 先落到「我的」标签：`open_settings_section` 从**那一页**出发找「设置」入口，
#    默认落点是「任务」标签，直接调它会一直在任务页里滚着找一格不存在的行。
ensure_app_foreground || bad "应用无法回到前台"
tap_profile_tab || exit 3

if open_settings_section data; then
  ok "进了「我的 → 设置 → 同步与隐私」"
else
  bad "进不了「同步与隐私」—— 后面的网络动作都做不了"
  exit 3
fi

XY=$(scroll_to_text "使用自托管服务器")
if [ -z "$XY" ]; then
  bad "同步与隐私里没有「使用自托管服务器」"
else
  $ADB shell input tap $XY; sleep 2.5
  ok "切到自托管表单"
fi

fill_field "服务器地址" "$SERVER"
dump
if [ "$(has_text "$SERVER")" = "1" ]; then
  ok "服务端地址已填进同步设置：${SERVER}"
else
  bad "服务端地址没填进去（${SERVER}）"; screen_txt
fi

# 现在再进认证屏：`serverUrl` 已经是自托管地址 ⇒ `centralMode` 为假 ⇒ 邮箱表单。
XY=$(xy_desc "$L_SIGNIN")
[ -z "$XY" ] && XY=$(xy_desc "切换账号")
if [ -z "$XY" ]; then
  bad "自托管表单里没有登录入口"
else
  $ADB shell input tap $XY; sleep 4
  # 🔴 用 `scroll_to_edit`（会滚）而不是 `xy_edit`（只认当前树上可见的节点）：
  #    面板升起后邮箱框可能落在折叠线以下，`xy_edit` 会报"没有表单"，
  #    而那看起来像 `centralMode` 判错了 —— 两条完全不同的方向。
  if [ -n "$(scroll_to_edit "$L_EMAIL")" ]; then
    ok "进了自托管档的邮箱表单（地址来自同步设置，不是官方 origin）"
  else
    bad "自托管地址下仍然没有邮箱表单（centralMode 判错了？）"; screen_txt
  fi
fi
# ── 2. A4：同意项**不许预勾**（本地拦截，且服务端**一个账号都没建**）─────────
step "2. A4 同意项由用户自己勾：切到注册、不勾就点「发送验证码」→ 本地拦住 + 服务端没建号"

# 🔴 2026-10-26 重写说明（这一条以前**根本跑不到**）：
#
#    旧版点的是「注册新账号」—— 那是「其他登录方式」折叠区里的**邮件链接注册**，
#    默认收起，而且它只在注册档才渲染。脚本既没切模式、也没展开折叠区，
#    所以那一步必然落在"找不到按钮"上。也就是说这一整段是一个**从没绿过**的判据。
#
#    现在注册是共享 `AuthForm` 里的一个**模式**（底部那枚次级出口），
#    主路是「邮箱 + 口令 + 验证码」。所以这一条改成：切到注册 → 不勾同意就提交
#    → 必须被**本地**拦住，且服务端一个号都没建。
XY=$(scroll_to_desc "$L_TO_REGISTER")
if [ -z "$XY" ]; then
  bad "找不到「${L_TO_REGISTER}」（切不到注册档？）"
else
  $ADB shell input tap $XY; sleep 2.5
  dump
  [ "$(has_desc "$L_TERMS")" = "1" ] \
    && ok "切到注册档后出现了同意项（共享表单的模式切换真的换了字段）" \
    || bad "切到注册档之后没有出现同意项 —— 模式切换没生效"
fi

A4_EMAIL="auth-a4-$(date +%s)@example.com"

fill_field "$L_EMAIL" "$A4_EMAIL"
dump
[ "$(has_text "$A4_EMAIL")" = "1" ] && ok "邮箱已输入（${A4_EMAIL}，全新地址）" || bad "邮箱没输进去"

# 🔴 断言的是**共享表单自己那句**（`common.auth.error.termsRequired`），
#    不是壳拼的句子：句子只有一处来源，改文案时这里跟着词条表走。
# 🔴 **必须先填登录密码**：共享表单的本地校验顺序是
#    `baseUrl → email → password → terms`（`firstAuthErrorField`，四端共用一份）。
#    不填密码就提交，第一条报的永远是「还没有填密码。」—— 于是"未勾同意项被本地拦住"
#    这条判据**永远看不到它要看的句子**。run6 的实测就是这个形状。
#    ⚠️ 判据没有放宽：填了密码之后，缺的就只剩同意项那一格。
A4_PASSWORD="Auth-A4-pass-2026!"
fill_field "$L_LOGIN_PASSWORD" "$A4_PASSWORD"
dump

if tap_id "$ID_SUBMIT" "发送验证码"; then
  sleep 3
  dismiss_system_prompt >/dev/null 2>&1 || true
  sleep 1
  if [ "$(has_sub_after_scroll_top "$L_TERMS_ERROR")" = "1" ]; then
    ok "未勾同意项时被**本地**拦住，并说清了原因"
  else
    bad "未勾同意项时界面没有说「${L_TERMS_ERROR}」"; screen_txt
  fi

  # 🔴 硬证据：服务端**一个号都没建**。只看界面文案的话，"按钮没点到"和
  #    "界面说了拦住了"长得一模一样（都是通过）。
  A4_EXISTS=$(user_exists "$A4_EMAIL")
  case "$A4_EXISTS" in
    0) ok "服务端**没有**为 ${A4_EMAIL} 建号（未勾同意项时一条凭据都没写）" ;;
    unknown) bad "查不到 ${A4_EMAIL} 是否建号（psql 不可用？）—— 这道检查**没有被验证**" ;;
    *) bad "服务端为 ${A4_EMAIL} 建了号（count=${A4_EXISTS}）—— 界面替用户同意了" ;;
  esac
fi

# ── 3. 注册请求真的出门了：勾上同意项 → 进入「验证邮箱」阶段 ─────────────────
step "3. 勾上同意项后提交 → 服务端发验证码、界面进入「${L_CODE_TITLE}」阶段"
# 🔴 按 testID 点，不按文案点：同意项那一行的 `content-desc` 是**标签文字**，
#    而同一串字在勾选框与它右边的说明里各出现一次 —— 按文案取坐标有概率点到说明文字，
#    于是"勾了但没勾上"，下一步的提交又被本地拦住，而日志只会说"没进入验证码阶段"。
if tap_id "$ID_TERMS" "同意项"; then
  sleep 1.5
  ok "已点同意项（用户自己做的那一下）"
fi

# 🔴 注册档还差"再次输入密码"：`onSubmit` 的顺序是
#    missing → confirm 为空 → confirm 不一致，所以不填它，提交会停在「再次输入密码」，
#    注册请求一条都不会发出去（而那看起来像"注册按钮坏了"）。
fill_field "$L_CONFIRM_PASSWORD" "$A4_PASSWORD"
dump

if tap_id "$ID_SUBMIT" "发送验证码"; then
  sleep 4
  dismiss_system_prompt >/dev/null 2>&1 || true
  sleep 2
  if [ "$(has_sub_after_scroll_top "$L_CODE_TITLE")" = "1" ]; then
    ok "注册请求真的发出去了（界面进入「${L_CODE_TITLE}」阶段）"
  else
    bad "提交之后没有进入「${L_CODE_TITLE}」阶段"; screen_txt
  fi
  # 🔴 这一句**一句都不许出现**：服务端在"邮箱已属已验证账号"时故意回成功
  #    而**不写凭据**（规范 §2-A2）。说了就是应用在骗用户。
  for forbidden in "账号已创建" "账号已建" "注册成功" "已为你创建"; do
    if [ "$(hasnt_sub "$forbidden")" = "1" ]; then
      ok "界面没有出现断言性文案「${forbidden}」"
    else
      bad "界面出现了断言性文案「${forbidden}」—— 注册可能是「假成功」（规范 §2-A2）"
    fi
  done
  # 退出验证码阶段（下一步要登录建号脚本那个账号）。点「更改邮箱」= 取消挑战。
  XY=$(scroll_to_desc "$L_CHANGE_EMAIL")
  if [ -n "$XY" ]; then
    $ADB shell input tap $XY; sleep 2
    ok "点了「${L_CHANGE_EMAIL}」退回登录档"
  else
    bad "验证码阶段找不到「${L_CHANGE_EMAIL}」"
  fi
fi

# ── 4. J2 可达性：用邮箱 + 口令登进建号脚本那个账号 → 会话 → 加密口令 → 同步 ──
step "4. J2 可达性：邮箱 + 口令登录 → **拿到令牌** → 加密口令 → 启用同步"
#
# 🔴 为什么这一段从"邮件链接 + 粘贴令牌"改成"邮箱 + 口令"：
#
#    · 粘贴令牌那一栏只在**从设置 → 同步**进入时渲染（`allowServerSelection`）。
#      本脚本是从**欢迎页**进认证屏的，那一栏压根不存在 —— 旧版第 4 步因此
#      在"找不到粘贴框"上必红。**主路**现在是邮箱 + 口令，那才是该验的东西。
#    · 邮件链接那条路仍由 `read_login_token` + 第 5 步的令牌断言覆盖（它验的是
#      服务端真的写下了登录令牌），只是不再由手机界面上点出来。
#
# 🔴 **必须登录建号脚本那个账号**：第 6 步的"另一台设备"用的是它的令牌。
#    手机若登在别的账号上，两台设备各写各的账，而**不会有任何报错**。
XY=$(scroll_to_desc "$L_TO_SIGNIN")
if [ -z "$XY" ]; then
  bad "找不到「${L_TO_SIGNIN}」（切不回登录档？）"
else
  $ADB shell input tap $XY; sleep 2.5
  ok "切回登录档"
fi

fill_field "$L_EMAIL" "$EMAIL"
dump
[ "$(has_text "$EMAIL")" = "1" ] && ok "邮箱已换回建号账号（${EMAIL}）" \
  || bad "邮箱没换回 ${EMAIL}"

# ⚠️ 建号脚本用**固定口令**造号（`lib/mobile-e2e-fresh-account.sh` 的
#    `HEYTA_E2E_PASSWORD`），所以这里能用产品那条登录路径真登进去 ——
#    这也是"TEST_MODE 造的号要能被产品登录路径验起来"那句话的现场证据。
fill_field "$L_LOGIN_PASSWORD" "$HEYTA_E2E_PASSWORD"
dump
# ⚠️ 这里**不拿 `has_secure` 当判据**：实测这台机型上 `password="true"` 这个属性
#    时有时无（run6 里它报了红，而同一轮的登录是**成功**的）。安全字段的内容本来就
#    读不到，真正的证据是下一步真的登进去了 —— 用结果当判据，不用属性当判据。
ok "登录密码已填（安全字段，内容读不回来；由下一步登录成功来证明）"

if tap_id "$ID_SUBMIT" "登录"; then
  sleep 5
  dismiss_system_prompt >/dev/null 2>&1 || true
  sleep 4
  if [ "$(has_sub_after_scroll_top "$L_SIGNED_IN")" = "1" ]; then
    ok "🔑 应用自己拿到了会话（界面进入「${L_SIGNED_IN}」）"
  else
    bad "登录之后没有进入「${L_SIGNED_IN}」"; screen_txt
  fi
  # 🔴 断言的是**那一整句**「当前账号：<email>」，不是"界面上有邮箱"——
  #    邮箱本来就在输入框里，后者会在登录**失败**时也通过（实测发生过）。
  if [ "$(has_sub "当前账号：${EMAIL}")" = "1" ]; then
    ok "界面显示的账号就是 ${EMAIL}（「当前账号：…」那一句）"
  else
    bad "界面上没有出现「当前账号：${EMAIL}」"; screen_txt
  fi

  # 口令放在**保存之前**填：它是规范 §3.2 的第 ④ 步。
  fill_field "$L_E2EE" "$E2EE"
  dump
  [ "$(has_secure)" = "1" ] && ok "端到端加密口令已填" || bad '找不到加密口令输入框'

  XY=$(scroll_to_desc "$L_SAVE_SYNC")
  if [ -z "$XY" ]; then
    bad "找不到「${L_SAVE_SYNC}」"
  else
    $ADB shell input tap $XY; sleep 6
    ok "已点「${L_SAVE_SYNC}」（规范 §3.2 第 ④⑤ 步）"

    # 🔴 这一趟是从**设置 → 同步**进来的：登录成功后会话回到**设置目录**，
    #    设置 Modal 仍盖着整屏。不关它，下面"回到主界面"的断言就在对着设置面做，
    #    报"没有回到主界面"——而那看起来像登录没生效（本轮实测就是这个形状）。
    #    ⚠️ **不要加 `if 有 settings-sheet` 的守卫**：那一瞬间面板可能正在转场，
    #    `xy_rid` 取不到就整段跳过，于是又回到上面那个假红。`close_settings_sheet`
    #    本身是幂等的（没有面就什么都不做），直接调用即可。
    close_settings_sheet || true
    sleep 2
    ok "关掉了设置面（会话已回到设置目录）"
  fi
fi

# 🔴 判据不能只认一个锚点：登录成功之后落在「任务」页，而那一页在**没有任务**时
#    画的是空态（「今天还没有安排」），FAB 的 `content-desc` 也可能被机型合成。
#    只钉「新建任务」会在"空账号"这种最正常的情况下报"没回到主界面" —— 假红。
LANDED=0
for anchor in "新建任务" "今天还没有安排" "$( printf 'x' )"; do
  [ "$anchor" = "x" ] && continue
  if settle_for "$anchor" 8 2; then LANDED=1; break; fi
done
if [ "$LANDED" = "0" ] && [ -n "$(xy_rid "tab-profile")" ]; then LANDED=1; fi
if [ "$LANDED" = "1" ]; then
  ok "登录成功后回到了主界面（欢迎页已被登录离开）"
else
  bad "登录成功后没有回到主界面"; screen_txt
fi
# ── 5. J2 的证据：令牌真的写进了同步配置（不是只显示了一下）─────────────────
step "5. J2 证据：登录拿到的令牌落在了同步设置里，而且**不是**手填的那个"
# 🔴 按**无障碍名**点标签栏，不按坐标：这台机器上跑的不一定是 1080×2340 的模拟器
#    （本轮实测是一台 1156×2510 的真机）。写死的 (945,2253) 在别的分辨率上落在
#    空白处，而症状是"点了没反应 → 后面每一条都找不到控件"，看起来像产品坏了。
tap_profile_tab || exit 3
# 🔴 令牌那枚输入框**不在「我的」页面上**，它在 设置 → 同步与隐私 → 自托管表单里。
#    直接 `edit_value` 会读到空串，报"令牌没落进同步配置"——而它其实好好在那儿
#    （本轮实测就是这个形状：第 4 步保存成功，第 5 步却说令牌是空的）。
if open_settings_section data; then
  dump
  if [ -z "$(xy_edit_sane "$L_TOKEN")" ]; then
    SELFHOST_XY=$(scroll_to_text "使用自托管服务器")
    [ -n "$SELFHOST_XY" ] && { $ADB shell input tap $SELFHOST_XY; sleep 2; }
  fi
fi
APP_TOKEN=$(edit_value "$L_TOKEN" 2>/dev/null)
if [ -z "$APP_TOKEN" ]; then
  bad "「我的」页的$L_TOKEN 是空的 —— 登录拿到的东西没有落进同步配置"
else
  ok "同步设置里已经有令牌（${#APP_TOKEN} 字符）"
  if [ "${#APP_TOKEN}" -ge 32 ]; then
    ok "令牌长度 ${#APP_TOKEN} ≥ 32（不是被截断/占位的串）"
  else
    bad "令牌长度只有 ${#APP_TOKEN} —— 看起来不是一个真令牌"
  fi
  if [ "$APP_TOKEN" = "$TOKEN" ]; then
    bad "令牌与建号脚本发的那个**一模一样** —— 说明它是手填的，不是走登录拿到的"
  else
    ok "令牌与应用自己走完登录链路拿到的一致（与手填的建号令牌不同）"
  fi
fi
close_settings_sheet || true

# ── 6. J2 续：登录之后同步可用 —— 另一台设备读得到手机写的任务 ───────────────
step "6. J2 续：手机建一条任务，**另一台设备**必须读到（真 SQLite）"
rm -f "$LAPTOP_DB"
XY=$(xy_desc "任务")
if [ -z "$XY" ]; then bad "标签栏上没有「任务」"; else $ADB shell input tap $XY; sleep 3; fi
dump
XY=$(xy_desc "新建任务")
if [ -z "$XY" ]; then
  bad "找不到新建按钮"
else
  $ADB shell input tap $XY; sleep 2.5
  dump
  XY=$(xy_edit_any)
  if [ -z "$XY" ]; then
    bad "新建面板里找不到输入框"
  else
    $ADB shell input tap $XY; sleep 1
    # ⚠️ 标题必须 ASCII：`adb shell input text` 对非 ASCII 直接抛异常。
    $ADB shell input text "$TITLE"; sleep 1.5
    dump
    [ "$(has_text "$TITLE")" = "1" ] && ok "标题已输入" || bad "标题没输进去"
    dump
    XY=$(xy_text "添加")
    if [ -z "$XY" ]; then
      bad "找不到「添加」"
    else
      $ADB shell input tap $XY; sleep 3
    fi
  fi
fi
dump
[ "$(has_text "$TITLE")" = "1" ] && ok "任务已创建：$TITLE" || { bad "任务没创建"; screen_txt; }

LAPTOP_OUT=$(wait_laptop_has "$TITLE" "$LAPTOP_ROUNDS"); LAPTOP_RC=$?
case "$LAPTOP_RC" in
  0) ok "另一台设备在第 $LAPTOP_OUT 轮读到了「${TITLE}」—— 登录拿到的令牌真的能同步" ;;
  2) bad "笔记本**探针自己**坏了，本条判据无效（不是产品缺陷）：$LAPTOP_OUT" ;;
  *) bad "笔记本 $((LAPTOP_ROUNDS * 5)) 秒内没读到「${TITLE}」—— 令牌没有让同步真正可用" ;;
esac

# ── 7. 欢迎页不再自动出现（偏好是**持久化**的，不是只放内存）─────────────────
step "7. 欢迎页不再自动出现：force-stop → 再启动（**不** pm clear）"
$ADB shell am force-stop $PKG; sleep 2
launch_app; sleep 10
dump
# 🔴 这一处**必须**先 require_screen，否则是假**绿**：空 dump 上 `privacy_gate_present`
#    为假 ⇒ 下面那条印出 ✅「决定已落盘」，而它其实什么都没抓到。
#    0.5 那两条在同样情况下会印 ❌（会响），这一条不会 —— 判"没再出现"的断言
#    在空界面上**恒为真**，正是"永远通过的判据比没有判据更糟"那一条（§7 元规则二）。
require_screen
# 🔴 **先判隐私面板在不在，再判欢迎页** —— 顺序反了的话，一块盖住整屏的面板会让
#    欢迎页的「先离线使用」**读不到**，于是这一条印出假绿 ✅「欢迎页没有回来」，
#    真因要到下一条（"没有落在主界面"）才露头，而那句话根本没提隐私面板。
if privacy_gate_present; then
  bad "再冷启动**又问了一遍**隐私同意 —— 第 0.5 步那次「同意并联网」没落盘"
else
  ok "决定已落盘：再冷启动没有重复征求（第 0.5 步的选择跨启动记住了）"
fi
if [ "$(has_desc "$L_OFFLINE")" = "1" ] || [ "$(has_text "$L_OFFLINE")" = "1" ]; then
  bad "冷启动又出现了欢迎页 —— 「点过之后不再出现」这句话在跨启动上不成立"
else
  ok "欢迎页没有回来（设备本地偏好写成功了）"
fi
if [ -n "$(xy_desc "新建任务")" ]; then
  ok "重开之后直接落在主界面"
else
  bad "重开之后没有落在主界面"; screen_txt
fi

summary "移动端注册 / 登录旅程"
