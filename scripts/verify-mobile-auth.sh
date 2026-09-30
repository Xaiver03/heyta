#!/bin/bash
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
L_PASTE="粘贴邮件里的链接或令牌"
L_PASSWORD="端到端加密口令"
L_TOKEN="访问令牌"
L_TERMS="我同意该服务端提供的服务条款与隐私政策"
L_REGISTER="注册新账号"
L_SEND_LINK="用邮件链接登录"
L_VERIFY="验证并登录"
L_SAVE_SYNC="保存并启用同步"

PG_DB="${HEYTA_E2E_DB:-heyta_mobile_smoke}"
PG_USER="${HEYTA_E2E_DB_USER:-$(whoami)}"

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

echo ""
echo "=== 移动端注册 / 登录旅程验收（真实模拟器 + 真服务端，零 mock）==="
echo "  设备: emulator-5554   服务端: $SERVER   库: $PG_DB"
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
hasnt_sub() { grep -q "text=\"[^\"]*$1" /tmp/ui.xml 2>/dev/null && echo 0 || echo 1; }

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

heyta_e2e_assert_client_budget || bad "账号 client 数已逼近向量时钟上限（后续断言不可信）"

# ── 1. J1：冷启动后 ≤1 次点击见到注册/登录表单 ──────────────────────────────
step "1. J1 前置性：冷启动 → **数着点击数**到注册/登录表单（≤1）"
CLICKS=0
dump
require_screen

[ "$(has_desc "$L_SIGNIN")" = "1" ] \
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

XY=$(xy_desc "$L_SIGNIN")
if [ -z "$XY" ]; then
  bad "取不到「${L_SIGNIN}」的坐标"
else
  $ADB shell input tap $XY; CLICKS=$((CLICKS + 1))
  sleep 3
  dump
  if [ -n "$(xy_edit "$L_EMAIL")" ]; then
    ok "第 $CLICKS 次点击就看到了注册/登录表单（邮箱输入框在）"
    # 🔴 这一句**必须在"真的到了表单"里面**。放在外面的话，把按钮做成
    #    "点了没反应"时它会照样印 ✅「J1 成立」—— 前一行已经红了，
    #    而总结行还在说成立，读日志的人会被这一句骗过去（实测撞到过）。
    [ "$CLICKS" -le 1 ] && ok "点击数 $CLICKS ≤ 1（J1 成立）" || bad "点击数 $CLICKS > 1"
  else
    bad "点了「${L_SIGNIN}」之后仍然看不到邮箱输入框"; screen_txt
    bad "点击数 ${CLICKS}，但没有到达表单 —— J1（≤1 次点击见到表单）不成立"
  fi
fi

# ── 2. A4：同意项**不许预勾**（本地拦截，且服务端**一个账号都没建**）─────────
step "2. A4 同意项由用户自己勾：不勾就点注册 → 本地拦住 + 服务端没建号"

# 🔴 这一条用的是**全新邮箱**，而且判据是"服务端有没有为它建号"。
#
#    为什么不能用"服务端日志里 register 请求数"：那个日志里**根本没有**
#    HTTP 请求行（服务端只打应用级 Logger），于是那条断言永远是 `0 → 0` ——
#    一条**不可能失败**的检查，比没有检查更糟（它会让人以为验过了）。
#
#    为什么"没建号"是有力证据：
#      · 服务端在这条端点上用 `termsAccepted: z.literal(true)`（规范 §2-A4）——
#        没勾而把请求发出去，只会得到 400；
#      · 但真正要防的是"界面替用户勾了"：那样请求会带着 `termsAccepted: true`
#        出去，服务端就会**建号** —— 这一条正是在抓那个。
A4_EMAIL="auth-a4-$(date +%s)@example.com"

fill_field "$L_EMAIL" "$A4_EMAIL"
dump
[ "$(has_text "$A4_EMAIL")" = "1" ] && ok "邮箱已输入（${A4_EMAIL}，全新地址）" || bad "邮箱没输进去"

XY=$(xy_desc "$L_REGISTER")
[ -z "$XY" ] && XY=$(scroll_to_desc "$L_REGISTER")
if [ -z "$XY" ]; then
  bad "找不到「${L_REGISTER}」"
else
  $ADB shell input tap $XY; sleep 5
  if [ "$(has_sub_after_scroll_top "请先勾选同意项")" = "1" ]; then
    ok "未勾同意项时被**本地**拦住，并说清了原因"
  else
    bad "未勾同意项时界面没有说「要先勾同意项」"; screen_txt
  fi
fi

A4_EXISTS=$(user_exists "$A4_EMAIL")
case "$A4_EXISTS" in
  0) ok "服务端**没有**为 ${A4_EMAIL} 建号（未勾同意项时一条凭据都没写）" ;;
  unknown) bad "查不到 ${A4_EMAIL} 是否建号（psql 不可用？）—— 这道检查**没有被验证**" ;;
  *) bad "服务端为 ${A4_EMAIL} 建了号（count=${A4_EXISTS}）—— 界面替用户同意了" ;;
esac

# ── 3. J3：注册**真的**能建号，且界面说你中性 ────────────────────────────────
step "3. J3：勾上同意项后注册 —— 中性文案，且**不许**说「账号已创建」"
XY=$(scroll_to_desc "$L_TERMS")
if [ -z "$XY" ]; then
  bad "找不到同意项（${L_TERMS}）"
else
  $ADB shell input tap $XY; sleep 2
  ok "已勾选同意项（用户自己做的那一下）"
fi

J3_EMAIL="auth-j3-$(date +%s)@example.com"
fill_field "$L_EMAIL" "$J3_EMAIL"
dump
[ "$(has_text "$J3_EMAIL")" = "1" ] && ok "邮箱已换成 ${J3_EMAIL}（另一个全新地址）" || bad "邮箱没换成功"

XY=$(scroll_to_desc "$L_REGISTER")
if [ -z "$XY" ]; then
  bad "找不到「${L_REGISTER}」"
else
  $ADB shell input tap $XY; sleep 6
  if [ "$(has_sub_after_scroll_top "如果这个邮箱可用")" = "1" ]; then
    ok "注册请求已提交，界面用的是**中性**文案（如果…会发送…）"
  else
    bad "注册之后没有看到中性文案"; screen_txt
  fi
  # 🔴 硬证据：这一次服务端**真的**建了号。只看界面文案的话，
  #    "按钮没点到"和"界面说了中性话"长得一模一样（都是通过）。
  J3_EXISTS=$(user_exists "$J3_EMAIL")
  case "$J3_EXISTS" in
    0) bad "服务端没有为 ${J3_EMAIL} 建号 —— 勾了同意项也没发出去" ;;
    unknown) bad "查不到 ${J3_EMAIL} 是否建号（psql 不可用？）—— 这道检查**没有被验证**" ;;
    *) ok "服务端为 ${J3_EMAIL} 建了号（count=${J3_EXISTS}）—— 注册真的发出去了" ;;
  esac
  # 🔴 这四句**一句都不许出现**：服务端在"邮箱已属已验证账号"时故意回成功
  #    而**不写凭据**（规范 §2-A2）。说了就是应用在骗用户。
  for forbidden in "账号已创建" "账号已建" "注册成功" "已为你创建"; do
    if [ "$(hasnt_sub "$forbidden")" = "1" ]; then
      ok "界面没有出现断言性文案「${forbidden}」"
    else
      bad "界面出现了断言性文案「${forbidden}」—— 注册可能是「假成功」（规范 §2-A2）"
    fi
  done
fi

# ── 4. J2：请求登录链接 → 取出邮件令牌 → 粘回应用 → **拿到 token** ───────────
step "4. J2 可达性：登录链接 → 从库里取出邮件令牌 → 粘贴 → 拿到访问令牌"
# 🔴 **必须换回建号脚本那个账号**（第 2/3 步用的是两个一次性邮箱）。
#    第 6 步的"另一台设备"用的是建号脚本发的令牌 —— 手机若登在别的账号上，
#    两台设备会各自写各自的账号，而**不会有任何报错**（只是互相看不见）。
#    那样第 6 步会红，但方向会被引去怀疑同步，真正的原因在这里。
fill_field "$L_EMAIL" "$EMAIL"
dump
[ "$(has_text "$EMAIL")" = "1" ] && ok "邮箱已换回建号账号（${EMAIL}）" \
  || bad "邮箱没换回 ${EMAIL}"

XY=$(scroll_to_desc "$L_SEND_LINK")
if [ -z "$XY" ]; then
  bad "找不到「${L_SEND_LINK}」"
else
  $ADB shell input tap $XY; sleep 6
  if [ "$(has_sub_after_scroll_top "如果这个邮箱有账号")" = "1" ]; then
    ok "登录链接请求已提交（中性文案）"
  else
    bad "没有看到登录链接的中性文案"; screen_txt
  fi
fi

echo "     从数据库读服务端写下的邮件令牌（跑批机器没有收件箱）…"
MAIL_TOKEN=$(read_login_token "$EMAIL")
if [ -z "$MAIL_TOKEN" ]; then
  bad "60 秒内没读到 login_token —— 登录链接那一步没有真的发生"
else
  ok "读到服务端写下的登录令牌（${#MAIL_TOKEN} 字符）"
fi

if [ -n "$MAIL_TOKEN" ]; then
  # 口令放在**粘贴之前**填：它是规范 §3.2 的第 ④ 步，界面上必须和令牌
  # 一起就位，否则"保存并启用同步"会带着空口令跑起来。
  fill_field "$L_PASSWORD" "$E2EE"
  dump
  [ "$(has_secure)" = "1" ] && ok "端到端加密口令已填（安全字段，dump 看不到内容）" \
    || bad '找不到口令输入框（没有 password="true" 节点）' 

  fill_field "$L_PASTE" "$MAIL_TOKEN"
  dump
  [ "$(has_text "$MAIL_TOKEN")" = "1" ] && ok "邮件令牌已粘贴" || bad "邮件令牌没粘进去"

  XY=$(scroll_to_desc "$L_VERIFY")
  if [ -z "$XY" ]; then
    bad "找不到「${L_VERIFY}」"
  else
    $ADB shell input tap $XY; sleep 8
    if [ "$(has_sub_after_scroll_top "已登录")" = "1" ]; then
      ok "🔑 应用自己拿到了会话（界面进入「已登录」）"
    else
      bad "粘贴令牌之后没有进入「已登录」"; screen_txt
    fi
    # 🔴 断言的是**那一整句**「当前账号：<email>」，不是"界面上有邮箱"——
    #    邮箱本来就在输入框里，后者会在登录**失败**时也通过（实测发生过）。
    if [ "$(has_sub "当前账号：${EMAIL}")" = "1" ]; then
      ok "界面显示的账号就是 ${EMAIL}（「当前账号：…」那一句）"
    else
      bad "界面上没有出现「当前账号：${EMAIL}」"; screen_txt
    fi
  fi

  XY=$(scroll_to_desc "$L_SAVE_SYNC")
  if [ -z "$XY" ]; then
    bad "找不到「${L_SAVE_SYNC}」"
  else
    $ADB shell input tap $XY; sleep 5
    ok "已点「${L_SAVE_SYNC}」（规范 §3.2 第 ④⑤ 步）"
  fi
fi

dump
if [ -n "$(xy_desc "新建任务")" ]; then
  ok "登录成功后回到了主界面（欢迎页已被登录离开）"
else
  bad "登录成功后没有回到主界面"; screen_txt
fi

# ── 5. J2 的证据：令牌真的写进了同步配置（不是只显示了一下）─────────────────
step "5. J2 证据：登录拿到的令牌落在了同步设置里，而且**不是**手填的那个"
$ADB shell input tap 945 2253; sleep 3   # 「我的」
dump
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

# ── 6. J2 续：登录之后同步可用 —— 另一台设备读得到手机写的任务 ───────────────
step "6. J2 续：手机建一条任务，**另一台设备**必须读到（真 SQLite）"
rm -f "$LAPTOP_DB"
$ADB shell input tap 135 2253; sleep 3   # 「任务」
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
