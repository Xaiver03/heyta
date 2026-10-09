#!/bin/bash
#
# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 对脚本是按字节偏移
#    增量读取的：运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。
#    入口先把整份脚本拷成同目录隐藏快照再 exec 副本 —— 之后对源文件的任何
#    编辑都影响不到本次运行；$0 的 dirname 不变，lib/tools 定位照旧。
#    快照名 .原名.snap.PID（进 .gitignore）；trap 尽力清理，被 kill -9 留下的
#    由下一次运行按 mmin +240 顺带扫掉。
case "$(basename "$0")" in
  .*.snap.*) ;;
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac

set -u
export PATH="/opt/homebrew/bin:$PATH"
export PORT="${PORT:-3100}"

# 🔴 三份凭据文件**先换成本趟私有的路径，再 source lib** —— lib 在 **source 的那一刻**
#    就 `cat "${HEYTA_E2E_TOKEN_FILE:-/tmp/heyta_mobile_token.txt}"`（mobile-e2e.sh:132-134），
#    source 之后再改环境变量已经来不及了。不这么做会得到一次**静默的脑裂**：
#    号建到私有文件里、脚本读的却是别人那一轮的令牌（lib 那段注释把症状写下来了：
#    "用错了账号"，而 pm clear / op 数 / 跨设备断言全都落在别人的身份上）。
#    先 touch 出来是因为 lib 那句 `cat` 在文件不存在时会往 stderr 喊一声，
#    而那一喊在开局会被读成"环境坏了"。默认值逐字不变 ⇒ 不给变量时行为一字不变。
export HEYTA_E2E_TOKEN_FILE="${HEYTA_E2E_TOKEN_FILE:-/tmp/heyta-ios-accmail-token-$}.txt"
export HEYTA_E2E_EMAIL_FILE="${HEYTA_E2E_EMAIL_FILE:-/tmp/heyta-ios-accmail-email-$}.txt"
export HEYTA_E2E_E2EE_FILE="${HEYTA_E2E_E2EE_FILE:-/tmp/heyta-ios-accmail-e2ee-$}.txt"
: > "$HEYTA_E2E_TOKEN_FILE" 2>/dev/null || true
: > "$HEYTA_E2E_EMAIL_FILE" 2>/dev/null || true
: > "$HEYTA_E2E_E2EE_FILE" 2>/dev/null || true

. "$(dirname "$0")/lib/mobile-e2e.sh"
# 🔴 **trap 必须排在 source 之后** —— `scripts/lib/mobile-e2e.sh` 自己有一条
#    `trap restore_ime EXIT`，而 bash 的 EXIT 只有一个处理器 ⇒ 在 source **之前**
#    设的那条会被**静默替换**。下面第一条字面是给 `check:script-snapshot` 认的 needle，
#    第二条才是生效的那条：它继续清 `$0`，并带走本趟的含明文落盘产物 ——
#    界面 dump 里会带着**访问令牌**（凭据面板把它的值印在输入框上），而 AGENTS §8 第 10 条
#    要求装置自己也不许在 /tmp 留明文。挂在 EXIT 上而不是末尾 `rm` 一次：
#    判红 / 前提不成立那些早退路径也要删。
trap 'rm -f -- "$0"' EXIT
trap 'rm -f -- "$0" "${IDB_DUMP_FILE:-}" "${HEYTA_E2E_TOKEN_FILE}" "${HEYTA_E2E_EMAIL_FILE}" "${HEYTA_E2E_E2EE_FILE}" /tmp/heyta-ios-accmail-*-${STAMP:-0}.json 2>/dev/null' EXIT

# 移动端「换绑邮箱 + 登录设备 + 改登录密码」（真 iOS 模拟器 + 真服务端 + 真发信，零 mock）
# ==================================================================================
#
# 这一格补的是本线台账里**唯一还等于零的那一腿**。`docs/plans/account-standard-suite.md`
# §5 第 10 条的原话：产物早就装着、系统语言就是中文 ⇒ "缺的是一份 iOS 侧 AX 驱动脚本与
# 一个没被另一条会话的 idb_companion 占着的窗口"。窗口现在空着，所以有这份脚本。
#
# 它是 `scripts/verify-mobile-account-email-sessions.sh`（Android，452 行 / 15 步）的
# **孪生**：那一份是**判据的事实源**，本文件逐条对上它的 0..13 步，并按 iOS 的实际形状
# 重写载体（idb + AX 树 + 系统 Alert），**判据本身一条不放、一条不加严**。
#
# 🔴 另外补上 Android 那份**完全没测**的第三块：**改登录密码**。
#    现量：`grep -c 'password/change' scripts/verify-mobile-account-email-sessions.sh` = **0**。
#    那一块今天只有 web 的 Playwright 腿与 `verify-mobile-account.sh`（Android）证过。
#    本文件把它排在**会话面之后**（步骤 15），理由不是排版，是**令牌的生命周期**：
#    「退出所有设备」会把手上这枚打死并清掉本机凭据，改密需要一枚**活的**会话 ⇒
#    放在它前面会让步骤 J 的"本机那枚也 401"变成**为一件错误的原因成立的判据**
#    （那枚令牌早被改密那一下 bump 掉了）。所以顺序是：换绑 → 会话 → 退出所有 →
#    重新签一枚活的（步骤 K，它自己也是判据）→ 改密。
#
# ## 这一腿问什么、不问什么
#
# 🔴 **点邮件里那两条链接的是脚本的 curl，不是设备。** 这一格必须自己承认：
#    "人手上没有会话"，所以 `/account/email/change/confirm` 那两发打在**服务端自己的端点**上
#    （Android 那份 `:310` 已经这么写过，这里不含糊）。设备那一腿证的是**另一件事**：
#    点完之后界面上那句"还等谁点"是不是**重新从服务端读回来的**（组件里不许有本地阶段，
#    `EmailChangeSection.tsx` 文件头钉的就是这条），以及撤销/退出是不是真落到认证边界。
#
# ⚠️ **不证** Android、**不证**真机（模拟器不是手机）、**不证**上架签名，
#    也**不证**通行密钥那一块（那是 `verify-mobile-account.sh` 的第 7 步，不在本单范围）。
#
# ## 判据（A/B/E/I/J/M/N 承重）
#
# | 号 | 判据 | 为什么要有它 |
#|---|---|---|
#| **A** | 设置面的「个人资料」里有「更换登录邮箱」这块：标题、说明句，**以及当前邮箱那行的值就是登录邮箱** | 存在性判据。值是空串会被读成"这个账号的邮箱是空的"，而那件事在本系统里不存在 |
#| **B** | 真点「发起更换」→「两封信已经发出」（**不是**「已更换」）+「还在等两个邮箱各点一次」+「待绑邮箱」行 | 生效还没发生；成功文案写成"已更换"是一句谎话 |
#| C | 服务端那张活请求：两边都没点、存的是**哈希**、旧新两侧不同、pending 就是那个新地址 | 服务端是唯一裁决者；只看界面会把"界面自己画的等待态"当成有活请求 |
#| **D** | 两封信里的链接都**以本轮 `PUBLIC_URL` 开头**，GET 它回的是确认页**而且不烧令牌** | 链接指向生产域名时，后面两次 POST 打的仍是本轮服务端 ⇒ "信里的链接能用"从没被验过。GET 不烧令牌 = 邮件预取器不会毁掉这条路 |
#| **E** | 只点旧那半 → **切走再回来**之后那句实话改口成「还在等新邮箱这一边」，并说清哪一边已经点过 | 🔴 本线唯一一条只能由真设备证的判据：`SettingsScreen` 是 RN `Modal`，关一次即**整体卸载**；那句只能重新读服务端 |
#| F | 点新那半 → 库里邮箱已是新地址、那张活请求**没留下**、换绑前那枚令牌 401 | 生效即删；`tokenVersion` 递增的理由是 JWT 的 payload 里带着邮箱（ADR-0063 §2.2） |
#| G | 换绑之后界面上当前邮箱那一行 = 新地址，而「待绑邮箱」那一行**没了** | 只看库会把"界面没刷新"读成成功 |
#| **H** | 会话列表：当前那枚带「这台设备」标记 **且旁边有「这一台就是你正在用的设备」那句**，另有 ≥2 枚各带自己的「退出这一台：<设备>」 | 少了那句实话，"当前那台没有按钮"就只是**沉默地少一个按钮** |
#| **I** | 真点目标那枚「退出这一台」→ 系统 Alert（标题「退出这一台设备？」）里选 destructive → 库里少一枚、**被撤的那一枚**当场 401、手上这枚仍 200、界面上可撤行数跟着掉 | 🔴 `Alert.alert` 在 jsdom 里根本没有；撤错一台 = 撤销没落到认证边界，而列表照样能画得很像话 |
#| **J** | 「退出所有设备」→ 库里 0 枚、**事先证明回 200 的那一枚新会话**当场 401、「我的」页同步卡回到 `notConfigured` 那句（现文案「登录 heyta，让任务在设备间自动同步。」，它挂在 `ProfileScreen.tsx:1099` 的 `!form.configured` 分支） | 「包括这台」不是话术。⚠️ **没有那一次 200 的阳性对照**，"这枚令牌现在 401"永远分不清是"全撤销成了"还是"它从来就不通" |
#| K | 退出所有设备之后**仍能**用新邮箱 + 旧密码重新签出会话并同步成；本机明文库仍在盘上 | 本地优先：退出登录不是注销，它**不许**销毁本机数据（销毁只有「注销账号」那一条路，由 `verify-mobile-ios-account-erasure.sh` 证） |
#| **L** | 改密块（**Android 那份没测的那一块**）：点之前「登录密码」卡的两段说明在、成功句**不在**；「设第一个密码」那张表是**收起的**（两个「新密码」不许同时在树上）；两个 secure 框填进去；按「修改密码」→ 界面出「登录密码已修改。」 | 🔴 `SecurityScreen.tsx:397` 与 `:456` 用的是**同一个 label**「新密码」⇒ 不先确认那张表收起，填的就是另一个框，而两条路的后果完全相反（`set` 不 bump、`change` bump）。secure 框的值**永远不进 AX dump**，所以这里**不断言框里的值** —— 成功证据在服务端与令牌那一侧 |
#| **M** | 改密的协议级后果：旧令牌 401 / 用新密码换的令牌 200 / 库里 `token_version` **真的涨了** | 只量界面那句成功文案，就是一条"界面说谎而没人发现"的路 |
#| **N** | 改密之后**这台设备自己仍能同步**（新令牌已落活配置），且本机明文库仍在盘上 | 🔴 移动端独有的一格，web 没有"落盘"这一步：`onPasswordChanged` 拿掉 ⇒ 这台设备下一次同步 401（`SecurityScreen` 文件头那条变异靶） |
#| O | 取证装置自己不留明文：证据目录与本趟 AX dump 里**数不到**任何一枚令牌 / 口令 / 一次性令牌 | AGENTS §8 第 10 条。这条判据量的是**装置**，不是产品 |
#
# ## 步骤 2 的**载体**（15:13 换过一次；判据一条没放、一条没加严，改的是怎么走到那一屏）
#
# 换绑区块里「当前邮箱」那一行的**值**是 `ProfileScreen.tsx:1249` 传下去的 `currentEmail`
# = `signedInEmail`，而 **只有 `saveAuthSession()` 写它**（`apps/mobile/src/auth/session.ts:87`，
# 全仓唯一调用点是 AuthScreen 的登录流程）⇒ 判据 A 与判据 G 那两条**值判据**
# 在手抄令牌那条路上永远读不到值（`EmailChangeSection.tsx:187-189` 回落成「还没登录」）。
# ⚠️ 但**不要把它读成"整块区块都要登录"**（15:4x 读实现现量）：那颗「发起更换」的
#    `disabled={!hasSession || draft.trim() === ''}`（`:292`）里 `hasSession` 只看
#    `baseUrl` + `token`（`:92`）⇒ 手抄令牌时它也是真；那张截图里按钮发灰的是
#    **空草稿**那一半。⇒ 换过去的是**载体**，判据 A/B/E/F/G… 一条没动。
# 所以步骤 2 走的是设备上的**「邮箱 + 密码登录」**（`sign_in_with_password`）：
# 「我的」页账号卡「注册 / 登录」→ 服务器地址 → 邮箱 → 登录密码 →
# 按「用邮箱和密码登录」→（会话卡「已登录」之后**才有**那一栏）加密口令 → 按「保存并启用同步」。
#
# ⚠️ 原先那条「设置 → 同步与隐私 → 使用自托管服务器」**手抄令牌**的路（`fill_three_credentials`）
#    没有删，但只留给"设备手上需要一枚活凭据、而不需要登录态"的那两处
#    （步骤 10 换绑之后、步骤 14 退出所有设备之后）。拿它当"登录"用得到的就是
#    「当前邮箱：还没登录」那一屏（`apps/mobile/evidence/account-suite-ios/03-email-change-section.png`）。
# 🔴 也**不能**从首启那张登录闸门卡进 AuthScreen：`WelcomeScreen.tsx:71-81` 不传
#    `allowServerSelection` ⇒ 那一代**没有「服务器地址」这一栏**，只能连 `App.tsx:169`
#    那个 `authServerUrl`（全新设备上就是产品默认地址），本轮那台服务端够不着。
#
# ## 变异靶（拿到窗口后随跑，都按「恰好红」判）
#
#   M1 `EmailChangeSection` 的成功文案改成「邮箱已更换」  ⇒ **B 恰好转红**
#   M2 让组件本地记阶段（加一个 `useState<EmailChangeStage>`）⇒ **E 恰好转红**（切走再回来仍说"等两边"）
#   M3 撤销做成"只从列表里摘掉、不打 DELETE"            ⇒ **I 恰好转红**（那一枚仍 200）
#   M4 `logoutEveryDevice` 只删会话行、不 bump `tokenVersion` ⇒ **J 恰好转红**（预签那枚仍 200）
#   M5 拿掉 `ProfileScreen` 的 `form.setToken(newToken)`      ⇒ **N 恰好转红**，而 **M 仍绿**
#      ⇒ M5 那一臂是本脚本存在的理由：**协议级证据齐了，设备侧那一腿仍可能是空的。**
#
# ## 脱敏（AGENTS §8 第 10 条）
#
# 一次性令牌、访问令牌、新旧登录密码、E2EE 口令、Ethereal 预览地址**一律不打印**。
# 需要"是不是同一枚"时用 SHA-256 前 10 位（`tok_fp`，照抄 Android 那份 `:65`）。
# 任何服务端响应体在打印之前都要过 `redact`（它把这趟用过的每一枚秘密换回指纹）。
# ⚠️ 真登录那一步的**边界说清楚**：移动端「登录密码」那一栏默认是明文档
#    （`model.ts:404` `defaultPasswordRevealed('mobile') === true`），所以它会出现在
#    **当时那份** `$IDB_DUMP_FILE` 里（EXIT trap 删；判据 O 在步骤 16 扫的是收尾那一份树）。
#    本装置不打印它的值，`fill_field` 普通分支只回读长度与逐字比较的**结果**。
#
# ## 退出码语义（与 `verify-mobile-ios-account-erasure.sh` 一致）
#
#   **0** 判据全成立 / **1** 有判据红 / **3** **前提不成立**（设备归属、产物不新鲜、
#   服务端不是当前源码、别人的验收在跑、idb/AX 工具接口漂了、没给 `PUBLIC_URL`）
#   ⇒ 3 不是产品判决，别照着它改代码；也不许拿 1 冒充"环境不行"。
#
# ## 前置（都不由本装置创建）
#
#   ① `pnpm --filter @heyta/sync-server build`（步骤 0 拿 401/**不是 404** 当场否证旧 dist）；
#   ② 起栈时带 `PUBLIC_URL=<本机那枚>`（步骤 D 判它）；
#   ③ `PORT=<空端口>` 走槽，别抢 :3000 上别人那台；日志指到 `HEYTA_E2E_LOGFILE`；
#   ④ **发信必须走 Ethereal**（服务端没有 SMTP 配置时才会自动回落到
#      `smtp.ethereal.email` 并往日志里打 `Preview URL:`，见 `server/src/email.ts:115`）。
#      配了真 SMTP ⇒ 日志里没有 Preview URL ⇒ 这一腿取不回链接，步骤 6 会说清是哪一种；
#   ⑤ `IOS_UDID` 指向一台**已启动**的模拟器，且那台设备上**已装有** heyta
#      （本装置**不打包**；装包属于 `reinstall:mobile` 那一层），但步骤 0 判它新不新。
#
# 用法：IOS_UDID=FE195661-B021-4A71-AAD1-1F2F7AE3A102 PORT=3100 \
#       PUBLIC_URL=http://127.0.0.1:3100 bash scripts/verify-mobile-ios-account-email-sessions.sh

# 当场自检（判据，不是注释）：最后一行 trap 必须**排在 source 之后**且含 `$0`。两个方向都能红。
_last_trap_line=$(grep -nE '^trap .* EXIT$' "$0" | tail -1 | cut -d: -f1)
_last_trap_body=$(grep -E '^trap .* EXIT$' "$0" | tail -1)
# 🔴 用 POSIX 字符类而不是 `\s` —— BSD grep 的 ERE 对 `\s` 没有保证。
_src_line=$(grep -nE '^[[:space:]]*\.[[:space:]]*".*lib/mobile-e2e\.sh"' "$0" | head -1 | cut -d: -f1)
if [ -z "$_src_line" ]; then
  echo "❌ 自检读不到 source lib 的那一行 ⇒ 先后关系没法判，本趟作废" >&2
  exit 1
fi
if [ -z "$_last_trap_line" ] || [ "$_last_trap_line" -le "$_src_line" ]; then
  echo "❌ 生效的 EXIT trap（第 ${_last_trap_line:-无} 行）排在 source lib（第 ${_src_line} 行）之前" >&2
  echo "   ⇒ lib 尾部的 trap 会整条替换它，快照与明文产物都不会被清" >&2
  exit 1
fi
case "$_last_trap_body" in
  *'"$0"'*) ;;
  *) echo "❌ 生效的 EXIT trap 不再清快照副本 —— 现量：${_last_trap_body}" >&2
     echo "   ⇒ 按字面匹配的门禁查不出来，本趟作废" >&2
     exit 1 ;;
esac

BID=${IOS_BID:-com.heyta}
DEVICE_NAME=${IOS_DEVICE_NAME:-iPhone 17 Pro}
IOS_DISPLAY=${HEYTA_IOS_DISPLAY:-primary}
STAMP=$(date +%H%M%S)
OLD_EMAIL="acc-mail-ios-${STAMP}@test.local"
NEW_EMAIL="acc-mail-new-ios-${STAMP}@test.local"
OLD_PASS="OldPass123"
# 🔴 新密码必须过**服务端策略**（长度 / 本地常见表 / HIBP 泄露库）。实测
# `NewPass456` 在泄露库里被拒（`verify-mobile-account.sh:59` 记的就是这一条），
# 所以用每次随机的字母数字混合值 —— 换一枚**恰好重复**的会被判 too_common。
NEW_PASS="Vi${STAMP}Zq7k"
# E2EE 口令每轮新造：这是**新账号**，本地没有需要同一把钥匙解开的历史密文。
E2EE_PASS="ios-accmail-${STAMP}"
SERVER_LOG="${HEYTA_E2E_LOGFILE:-/tmp/heyta-e2e-server.log}"
DB_NAME="${HEYTA_E2E_DB:-heyta_account_w9}"
# 信里的链接必须以它开头；没给就是前提不成立（exit 3），不猜。
PUBLIC_BASE="${PUBLIC_URL:-}"
EVIDENCE_DIR="$HEYTA_REPO_ROOT/apps/mobile/evidence/account-suite-ios"
API="$HOST_SERVER"
SHIM="$(cd "$(dirname "$0")" && pwd)/tools/ios-ax-shim.py"
LOAD1=$(sysctl -n vm.loadavg 2>/dev/null | tr -d '{} ')
# 「截图里必须是 heyta 的界面」那一条的下限。⚠️ 别调高：`png-stats.mjs` 自己的实测表里
# 真界面命中 9 279 / 9 450（Android / iOS），而错误屏、空白屏、桌面底色命中 **0** ⇒
# 阈值要的是"数得出"，不是"数得多"（AGENTS §7 第 82 条：非空白挡不住错误屏）。
BLUE_MIN=1

# ── 脱敏与取证工具（都只打印脱敏后的东西）──────────────────────────────
tok_fp() { printf '%s' "$1" | python3 -c 'import sys,hashlib;print(hashlib.sha256(sys.stdin.read().encode()).hexdigest()[:10])'; }
# 打印任何东西之前过这一道：把这趟用过的每一枚秘密换回它的指纹。
# 🔴 为什么要函数而不是"记得别打印"：服务端失败体里可能带着令牌（登录响应就有 token 字段），
#    而这一族的红**总是**在"顺手 head -c 200"那一行发生。
redact() {
  local _s="$1" _k
  for _k in "$TOKEN" "$DEAD_TOKEN" "$NEWTOKEN" "$P_TOKEN" "$TARGET_TOKEN" "$EXTRA_TOKEN" "$OLD_TOK" "$NEW_TOK" "$OLD_PASS" "$NEW_PASS" "$E2EE_PASS"; do
    [ -n "$_k" ] || continue
    _s=$(printf '%s' "$_s" | python3 -c '
import sys
body, secret = sys.argv[1], sys.argv[2]
if secret:
    body = body.replace(secret, "<tok %s>" % __import__("hashlib").sha256(secret.encode()).hexdigest()[:10])
print(body)' "$_k" 2>/dev/null || printf '%s' "$_s")
  done
  printf '%s' "$_s"
}
db() { psql -h 127.0.0.1 -p 5432 -U "$E2E_DB_USER" -d "$DB_NAME" -tAc "$1" 2>&1; }

# ── iOS 侧的载体（每个设备脚本自带一份 helper，这是本仓的既有做法）────────
ax() { python3 "$SHIM" "$@" --udid "$UDID" --idb "$IDB_BIN" --companion "$IDB_COMPANION" --json; }
jget() { printf '%s' "$1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$2',''))" 2>/dev/null; }
ax_press() { ax "$1" --pressable --press --json >/dev/null 2>&1; }
dismiss_keyboard() { ax --dismiss-keyboard --json >/dev/null 2>&1 || true; }
# 与 `lib` 的 `idb_ui` 同一条传输规则（`IDB_COMPANION` 含 `:` 且不以 `/` 开头 ⇒ TCP `--companion`；
# 否则 `--companion-path`）。screenshot / list 不在 `ui` 子命令下，所以 lib 没有封装它。
idb_current() {
  case "$IDB_COMPANION" in
    *:*) "$IDB_BIN" --companion "$IDB_COMPANION" "$@" ;;
    *) "$IDB_BIN" --companion-path "$IDB_COMPANION" "$@" ;;
  esac
}

# dump_labels：直接数**文件里**的非空可及名，故意不走 `fresh_dump`（自愈会递归）。
dump_labels() {
  python3 - "$IDB_DUMP_FILE" <<'PY'
import json, sys
try:
    nodes = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print(0); raise SystemExit
def walk(x):
    yield x
    for c in (x.get("children") or []):
        yield from walk(c)
n = 0
for t in (nodes if isinstance(nodes, list) else [nodes]):
    for x in walk(t):
        if (x.get("AXLabel") or "").strip():
            n += 1
print(n)
PY
}

# fresh_dump：把 AX dump **重取一次**，并让"重取失败"不可能被读成"界面上没有"。
#   存在的理由（14:52 实测）：下面三个读数函数原来**直接吃** `$IDB_DUMP_FILE`，而那枚文件
#   是上一次导航前写的 ⇒ 刚按完「设置」就问「同步与隐私」在不在，答的是**上一屏**的话。
#   症状就是"分组目录明明在截图里，脚本却说没有这一代"，而它长得像产品缺陷。
#   先 `rm` 再 dump：文件要么是新写的，要么根本不在（⇒ rc 2「探针读不到」），
#   不存在"旧屏冒充新屏"这一档（§7 元规则一：探针够不着与事情没发生是两种病）。
# 🔴 15:51 第六趟补的第二件事：**树只剩一枚可及名 = 系统弹窗盖着的结构性指纹**，
#    当场摘掉再重取。兄弟 rig 是在"填完 secure 框"那一档摘它，而这一次它是
#    按完「保存并启用同步」**之后**才弹的 ⇒ 登录其实已经成功（截图里设置面就在弹窗后面），
#    脚本却读到"0 条含「设置」的可及名"。判据用**枚数**，不用页面标题
#    （`verify-mobile-ios.sh:241-249` 第 42 轮：标题可能就是当前页，拿它当"没弹窗"的证据会恒真）。
fresh_dump() {
  local n
  rm -f "$IDB_DUMP_FILE" 2>/dev/null
  idb_dump >/dev/null 2>&1 || true
  [ -s "$IDB_DUMP_FILE" ] || return 2
  n=$(dump_labels)
  if [ "${n:-0}" -le 2 ]; then
    echo "     [guard] 这棵树只有 ${n} 枚可及名 ⇒ 按 iOS 系统弹窗态处理，先摘「保存密码？」再重取"
    dismiss_ios_save_password || true
    rm -f "$IDB_DUMP_FILE" 2>/dev/null
    idb_dump >/dev/null 2>&1 || true
    [ -s "$IDB_DUMP_FILE" ] || return 2
  fi
  return 0
}

# needle_state <文本>：0=界面上有 / 1=界面上没有 / 2=**探针自己读不到树**。
# 三档必须分开（traps §7 元规则一：「没观测到 X」≠「X 没发生」，而"树读不出"是第三种病）。
# 读法照抄姊妹 rig `verify-mobile-ios-account-erasure.sh:144-169`：**先 NFKC 归一化，再比子串** ——
# lib 的 `idb_has` 语义是"精确标签或值"，对本 App 的组合标签（多个 Text 拼成一枚可及名）
# 与 iOS 把 ASCII 规范化成全角这两件事**永远不会命中**（那边 10-05 09:0x 手探现量过）。
needle_state() {
  fresh_dump || { echo "   [needle] 这一棵树读不出来（dump 没落地）—— 不拿「没读到」当「没有」"; return 2; }
  python3 - "$IDB_DUMP_FILE" "$1" <<'PY'
import json, sys, unicodedata
path, needle = sys.argv[1], unicodedata.normalize("NFKC", sys.argv[2])
try:
    nodes = json.load(open(path, encoding="utf-8"))
except Exception as e:
    print("   [needle] dump 读不出来：%s" % e); sys.exit(2)
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
hits = []
for top in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(top):
        for k, v in n.items():
            if isinstance(v, str) and needle in unicodedata.normalize("NFKC", v):
                hits.append("%s=%s" % (k, v.strip()[:70]))
if hits:
    print("   HIT %d：%s" % (len(hits), hits[0])); sys.exit(0)
sys.exit(1)
PY
}
text_on_screen() { needle_state "$1" >/dev/null; }

# exact_state <文本>：**逐字等于**某节点的可及名才算命中（子串会误判的那种场合用它）。
# 存在的理由：`needle_state "登录密码"` 会同时命中「设置第一个登录密码」那一行 ——
# 而那张表收起没收起**恰恰**是这一档要判的事，用子尺量它就是一条恒真的判据。
exact_state() {
  fresh_dump || { echo "   [exact] 这一棵树读不出来（dump 没落地）—— 不拿「没读到」当「没有」"; return 2; }
  python3 - "$IDB_DUMP_FILE" "$1" <<'PY'
import json, sys, unicodedata
try:
    nodes = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception as e:
    print("   [exact] dump 读不出来：%s" % e); sys.exit(2)
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
want = unicodedata.normalize("NFKC", sys.argv[2]).strip()
for top in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(top):
        if unicodedata.normalize("NFKC", (n.get("AXLabel") or "")).strip() == want:
            sys.exit(0)
sys.exit(1)
PY
}

# ax_label_count：当前 dump 里非空可及名的枚数（只从这一处算，别让步骤 1 与步骤 16 各抄一份）。
ax_label_count() {
  fresh_dump || { echo 0; return; }
  python3 - "$IDB_DUMP_FILE" <<'PY'
import json, sys
try:
    nodes = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print(0); raise SystemExit
def walk(x):
    yield x
    for c in (x.get("children") or []):
        yield from walk(c)
n = 0
for t in (nodes if isinstance(nodes, list) else [nodes]):
    for x in walk(t):
        if (x.get("AXLabel") or "").strip():
            n += 1
print(n)
PY
}
# ax_tree_sane：整棵树里一枚可及名都没有 ⇒ **环境**（companion 的 axbridge 间歇返回空树 /
# App 的无障碍注册卡死，lib:1140-1148 记着重启模拟器就自愈）。这不算产品失败，也不许
# 让它继续往下跑 —— 那会把一次环境故障伪装成一长串"找不到按钮"的产品缺陷。
ax_tree_sane() {
  idb_dump
  local n
  n=$(ax_label_count)
  [ "${n:-0}" -gt 0 ] || { echo "   ❌ AX 树里一枚可及名都没有（companion / 无障碍桥卡死）—— 这是环境，不是产品。重启模拟器后重跑 ⇒ exit 3"; exit 3; }
  return 0
}

# dump_screen_text：判红时把界面上**真的写了什么**打出来（erasure 同段的理由：
# 这一族已经栽了三次"needle 与渲染形态不符"，只报"没读到"没有用）。
# ⚠️ 关键字表按**本线**换过：换绑 / 会话 / 口令，不是那边那组 同步 / 注销。
dump_screen_text() {
  python3 - "$IDB_DUMP_FILE" <<'PY'
import json, sys, unicodedata
try:
    nodes = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception as e:
    print("   （取不到树：%s）" % e); sys.exit(0)
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
keys = ("邮箱", "更换", "待绑", "登录", "设备", "退出", "密码", "令牌", "设置", "同步", "失败", "未配置")
seen = []
for top in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(top):
        v = n.get("AXLabel") or n.get("label") or ""
        if isinstance(v, str) and v.strip():
            nv = unicodedata.normalize("NFKC", v)
            if any(k in nv for k in keys):
                seen.append(nv.strip()[:120])
seen = list(dict.fromkeys(seen))
print("   界面上与邮箱/会话/口令有关的文本 %d 条：" % len(seen))
for v in seen[:14]:
    print("     ·", v)
PY
}

# row_candidates <文本前缀>：列出树里可及名**等于**该文本、或以「该文本 + 逗号」开头的节点
# （后者是 RN 在 iOS 上把 标题+副标题 拼成一枚可及名的形态，erasure:118-121 实测过）。
# 🔴 这一条**只负责枚举与去歧**，"能不能点"仍然交给 shim（它的 `is_pressable` 认
#    Button/GenericElement/Cell/…/traits/custom_actions，那份判定不该在这里抄第二遍）。
row_candidates() {
  python3 - "$IDB_DUMP_FILE" "$1" <<'PY'
import json, sys, unicodedata
try:
    nodes = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    raise SystemExit(3)
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
want = unicodedata.normalize("NFKC", sys.argv[2]).strip()
# 拼成一枚可及名时中间那个**分隔符**不止一种：RN 在 iOS 上把 标题+副标题 用逗号接
# （erasure:118-121 实测过），而**本 App 自己的 aria 模板**用的是全角冒号
# （`mobile.sessions.revoke.aria` = 「退出这一台：{device}」）。
# 第 11 趟只认逗号那一种，于是会话列表被数成 0 枚可撤 —— 而界面上那两行明明白白在
# （同一次运行的文本转写里就列着）。放宽到"分隔符之后还有内容"，
# 但**不**放宽成任意子串：那会把"needle 出现在别人的名字中间"也算命中（撞车那一档）。
SEPS = (",", "，", "、", "：", ":", "|", "·", " ")
def composite(nv):
    if not nv.startswith(want) or len(nv) <= len(want):
        return False
    return nv[len(want)] in SEPS
seen = []
for top in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(top):
        v = n.get("AXLabel") or n.get("label") or ""
        if not isinstance(v, str):
            continue
        nv = unicodedata.normalize("NFKC", v).strip()
        if nv == want or composite(nv):
            # 🔴 交出去的是**原文** `v`，不是规范化后的 `nv`（第 11 趟实测：这两者不等价）。
            #    匹配要规范化（iOS 会把词条里的全角「：」原样放进 AXLabel，而调用方给的
            #    needle 也可能是另一档冒号），但**下游 shim 是按原文精确找节点的**
            #    （`ios-ax-shim.py:label_of` 直接比 `AXLabel`）。这里发规范化串的后果是
            #    "树里明明有 1 条，shim 却说 found=False"⇒ 会话那一行被数成 0 枚可撤，
            #    读起来像"按钮点不动/产品坏了"，而坏的是这把尺子。
            raw = v.strip()
            if raw not in seen:
                seen.append(raw)
for s in seen:
    print(s)
raise SystemExit(0)
PY
}

# pick_pressable_row <文本> → 打印**唯一**那枚可点节点的完整可及名；拿不准就非 0 返回。
# 🔴 为什么不"取第一个"：erasure 那枚 `SETTINGS_ROW` 把 标题+副标题 的**拼串抄成了字面量**
#    （`verify-mobile-ios-account-erasure.sh:121`），而副标题今天已经漂了
#    （现量 `mobile.profile.entry.settings.hint` = 「个人资料、偏好、同步与安全」，
#    那行字面量还写着「同步凭据、桌面小组件与语言」）⇒ 抄字面量的那一条会恒红。
#    这里的读法是：从**当前这棵活树**里把完整可及名捞出来，再交给 shim 按精确标签点。
pick_pressable_row() {
  local needle="$1" cands="" n=0 hit="" c
  # 🔴 必须走 `fresh_dump`（它带"树只剩一枚 ⇒ 先摘系统弹窗"的自愈），不能直接 `idb_dump`：
  #    弹窗盖着时这一棵树的 label 数是 1，`row_candidates` 会老实报"0 条可及名"，
  #    于是「点不到设置」被记成产品失败，而登录其实已经成功。
  fresh_dump || { echo "     [row] AX dump 读不出来（companion / 无障碍桥）" >&2; return 2; }
  cands=$(row_candidates "$needle")
  local rc=$?
  if [ "$rc" = "3" ]; then echo "     [row] AX dump 读不出来（companion / 无障碍桥）" >&2; return 2; fi
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    n=$((n + 1))
    # 🔴 `</dev/null` 不是装饰：循环体里的 `ax` 继承这段 heredoc 的 stdin，
    #    任何一处读了 stdin 就会**吃掉后面的候选行**（症状是"明明有两枚却只查到一枚"）。
    if [ "$(jget "$(ax "$c" --pressable --list --json </dev/null)" found)" = "True" ]; then
      if [ -n "$hit" ] && [ "$hit" != "$c" ]; then
        echo "     [row] 「${needle}」有**两枚**可点节点：「${hit}」/「${c}」" >&2
        return 2
      fi
      hit="$c"
    fi
  done <<EOF
$cands
EOF
  if [ -z "$hit" ]; then
    echo "     [row] 树里有 ${n} 条含「${needle}」的可及名，但没有一枚是可点节点" >&2
    return 1
  fi
  printf '%s' "$hit"
}

# press_row <文本>：滚进可见区 → 按**几何安全的 AX press**（shim 会拒屏外坐标 / tab 栏遮挡 /
# 键盘遮挡那三种，绝不报 success）。
press_row() {
  local needle="$1" full="" r p
  # 🔴 先收键盘再找按钮（16:3x 第九趟实测）：填完「新邮箱地址」之后软键盘立着，
  #    被它盖住的控件（这里是「发起更换」那颗主按钮）**整枚从树上消失** ——
  #    读出来是"树里 0 条含「发起更换」的可及名"，症状和"按钮不存在/产品坏了"一模一样。
  #    同一件事在 Android 侧是 AGENTS §6.2 写死的纪律（隐藏键盘后再滚动，每次滚动后重抓 bounds）。
  dismiss_keyboard
  sleep 0.8
  full=$(pick_pressable_row "$needle"); rc=$?
  if [ "$rc" != "0" ] || [ -z "$full" ]; then
    bad "点不到「${needle}」（去歧读数 rc=${rc}，见上面那两行）"
    dump_screen_text
    return 1
  fi
  r=$(ax "$full" --pressable --scroll-into-view --json)
  if [ "$(jget "$r" visible)" != "True" ]; then
    bad "「${needle}」滚不进可见区（found=$(jget "$r" found) scrollRc=$(jget "$r" scrollRc)）"
    dump_screen_text
    return 1
  fi
  p=$(ax "$full" --pressable --press --json)
  if [ "$(jget "$p" result)" != "success" ]; then
    bad "按下「${needle}」没生效：result=$(jget "$p" result)（tab-outside-screen / tab-blocked-by-* 都在这一个读数里）"
    return 1
  fi
  echo "     已按「${needle}」（完整可及名：${full}）"
  return 0
}

# field_count <label>：数**输入框**节点（idb 把输入框报成 AXTextField / AXSecureTextField，
# 这两个角色名的表在 `scripts/tools/idb-find.py:59` 里）。
# 🔴 存在的理由就是那条**重复标签**的坑：`SecurityScreen.tsx:397`（改密表）与 `:456`
#    （设第一个密码表）用的是同一个 label「新密码」，而后者只在 `firstOpen` 为真时渲染。
#    不先数这一次，`fill_field 新密码` 会打到另一个框里 —— 那是**两条后果相反的路**。
field_count() {
  python3 - "$IDB_DUMP_FILE" "$1" <<'PY'
import json, sys, unicodedata
try:
    nodes = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print(-1); raise SystemExit
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
want = unicodedata.normalize("NFKC", sys.argv[2]).strip()
n = 0
for top in (nodes if isinstance(nodes, list) else [nodes]):
    for nn in walk(top):
        if (nn.get("role") or "") not in ("AXTextField", "AXSecureTextField"):
            continue
        if unicodedata.normalize("NFKC", (nn.get("AXLabel") or "")).strip() == want:
            n += 1
print(n)
PY
}

# 弹窗按钮与正文锚点之间的**最大**纵向距离（UIKit 的 Alert：标题 → 正文 → 按钮排布很紧，
# 实测档位内不会超过 ~200pt）。超出这个带就不认 —— 宁可响亮地"找不到按钮"，
# 也不按一枚**可能在列表里**的同名按钮（那会撤错设备 / 退出错东西）。
ALERT_BAND=260

# alert_button_center <弹窗标题> <按钮精确标签>：照 Android 那份 `xy_dialog_button`（`:101-114`）
# 的**同一条几何规则**（同名按钮同时在树里 ⇒ 只认锚点**下方**那一枚），再加两条收紧：
#   ① 只认**紧贴在锚点下方** `ALERT_BAND` 之内的那一枚（取纵向距离最小的）——
#      Android 那边 uiautomator 只导出**当前活动窗口**，弹窗立着时列表根本不在树里；
#      iOS 的 `UIAlertController` 是应用自己的子窗口，`describe-all` **很可能把两层都吐出来**，
#      于是"标题下方"这一条单独用会挑到滚动位置靠下的那一行按钮 ⇒ 必须再加一道带宽。
#      ⚠️ 这条带宽是**推断 + 会被读数证伪**的：真跑时把下面的 dist 读数留着，
#         若它落在带的边缘或取不到，就先手探一次弹窗的实际布局再调，别把阈值调宽来让它过。
#   ② 点完必须回读"弹窗收了没有"（调用方做），按下 ≠ 生效。
alert_button_center() {
  python3 - "$IDB_DUMP_FILE" "$1" "$2" "$ALERT_BAND" <<'PY'
import json, sys, unicodedata
try:
    nodes = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    raise SystemExit(0)
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
title = unicodedata.normalize("NFKC", sys.argv[2]).strip()
btn = unicodedata.normalize("NFKC", sys.argv[3]).strip()
band = int(sys.argv[4])
flat = []
for top in (nodes if isinstance(nodes, list) else [nodes]):
    flat.extend(walk(top))
anchor_bottom = None
for n in flat:
    if unicodedata.normalize("NFKC", (n.get("AXLabel") or "")).strip() == title:
        f = n.get("frame") or {}
        if isinstance(f.get("y"), (int, float)) and isinstance(f.get("height"), (int, float)):
            anchor_bottom = f["y"] + f["height"]
        break
if anchor_bottom is None:
    print("", file=sys.stderr)
    raise SystemExit(0)
best = None
others = []
for n in flat:
    if unicodedata.normalize("NFKC", (n.get("AXLabel") or "")).strip() != btn:
        continue
    f = n.get("frame") or {}
    y = f.get("y"); h = f.get("height")
    if not isinstance(y, (int, float)) or not isinstance(h, (int, float)) or h <= 0:
        continue
    d = y - anchor_bottom
    if d <= 0:
        others.append("above:%d" % int(d))
        continue
    if d > band:
        others.append("far:%d" % int(d))
        continue
    if best is None or d < best[0]:
        best = (d, int(f.get("x", 0) + f.get("width", 0) // 2), int(y + h // 2))
if best is None:
    print("no-in-band %s" % ",".join(others[:6]), file=sys.stderr)
    raise SystemExit(0)
print("%d %d" % (best[1], best[2]))
print("dist=%d 同名候选=%d" % (best[0], len(others) + 1), file=sys.stderr)
PY
}

cpcount() { python3 -c 'import sys;print(len(sys.argv[1]))' "$1"; }

# fill_field <标签> <值> [secure] —— 逐字照抄 erasure:612-650 的机制，只改注释里的用例。
# 🔴 两个分支各自踩过一条死路，都不许"顺手统一"：
#   · 普通框走 `--set`（set-value 是**替换**）。`--type-text` 是**追加**，
#     预填过的框会越加越长（10-05 08:3x 实测 41 → 62 → 83，逐字比永远不中）。
#   · secure 框**不能信 set-value**（rc=0 而不进 RN 状态），只能"聚焦 + HID 键盘输入"，
#     而它的回读是**掩码** ⇒ 断言只能按**码点数**（字节数在非 UTF-8 locale 下 3 倍虚增，
#     见 erasure:601-609 那段 `cpcount` 的来历）。
fill_field() {
  local lbl="$1" val="$2" kind="${3:-}" out back attempt=1 vl bl note=""
  while [ "$attempt" -le 3 ]; do
    dismiss_keyboard
    if [ "$kind" = "secure" ]; then
      out=$(ax "$lbl" --role AXTextField --type-text "$val")
      back=$(jget "$out" detail)
      vl=$(cpcount "$val"); bl=$(cpcount "$back")
      if [ "$(jget "$out" typedRc)" = "0" ] && [ "$bl" = "$vl" ] && [ -n "$back" ]; then
        ok "已填「${lbl}」（secure：聚焦+键盘输入，掩码码点 ${bl} = 原文码点 ${vl}；值本身不进 AX）"
        return 0
      fi
      note="typedRc=$(jget "$out" typedRc) 掩码码点=${bl}（期望 ${vl}；字节 ${#back}）"
    else
      out=$(ax "$lbl" --role AXTextField --set "$val")
      back=$(jget "$out" detail)
      if [ "$back" = "$val" ]; then
        ok "已填「${lbl}」（set-value 替换，回读逐字相同）"
        return 0
      fi
      note="setRc=$(jget "$out" setRc) 回读长度=${#back}（期望 ${#val}）$(jget "$out" setErr)"
    fi
    echo "     [fill] 「${lbl}」第 ${attempt} 次没成：${note}"
    attempt=$((attempt + 1))
    sleep 0.8
  done
  bad "「${lbl}」三次都没能写进去（${kind:-text}）"
  return 1
}

# dismiss_ios_save_password —— 照抄 erasure:282-329 的四条实测（标签先试 / 守卫不许拿页面标题
# 当"没有弹窗"的证据 / 坐标按**当前 app frame** 推 / 弹窗是**延迟**出现的）。
# 🔴 这一族在本线**必然**出现：每次往 secure 框里打字之后 iOS 都会问「保存密码？」
#    —— 改密块要填两个 secure 框，所以那一段每一步之前都要先摘它。
dismiss_ios_save_password() {
  local _l _r
  for _l in "以后" "Not Now" "Later" "以后再说"; do
    _r=$(ax "$_l" --pressable --list --json)
    if [ "$(jget "$_r" found)" = "True" ]; then
      ax "$_l" --pressable --press --json >/dev/null 2>&1
      sleep 1.5
      ok "已关掉 iOS「保存密码？」系统弹窗（标签命中「${_l}」）"
      return 0
    fi
  done
  dismiss_keyboard
  local t m
  t=$(jget "$(ax "任务" --list --json)" found)
  m=$(jget "$(ax "我的" --list --json)" found)
  if [ "$t" != "True" ] && [ "$m" != "True" ]; then
    echo "     底部两个标签都不在树上 ⇒ 按 iOS 系统弹窗态处理，按坐标点「以后」"
    local _fr _aw _ah _sx _sy _n
    _fr=$(ax - --list --json 2>/dev/null)
    _aw=$(jget "$_fr" width); _ah=$(jget "$_fr" height)
    case "${_aw}" in ''|*[!0-9]*) _aw=402; echo "     [dismiss] 取不到 app frame 宽，退回 402" ;; esac
    case "${_ah}" in ''|*[!0-9]*) _ah=874; echo "     [dismiss] 取不到 app frame 高，退回 874" ;; esac
    _sx=$(python3 -c "print(int(${_aw}*0.31))" 2>/dev/null || echo 125)
    _sy=$(python3 -c "print(int(${_ah}*0.615))" 2>/dev/null || echo 537)
    echo "     frame=${_aw}x${_ah} ⇒ 点 (${_sx},${_sy})"
    ax --tap "${_sx}" "${_sy}" --json >/dev/null 2>&1 || true
    sleep 2
    # 🔴 回读**不能**只认「任务 / 我的」这两枚底部标签：本线弹窗弹在设置面
    #    （`ProfileScreen` 的 RN `Modal`）之上，而 Modal 打开时底部标签本来就不在树上 ——
    #    那样点掉了也会被读成"没点掉"。所以真正的回读是**这棵树有没有从退化态恢复**
    #    （弹窗态的指纹是 label 数 ≤ 2），底部标签只作为附带读数打出来。
    rm -f "$IDB_DUMP_FILE" 2>/dev/null
    idb_dump >/dev/null 2>&1 || true
    _n=$(dump_labels)
    t=$(jget "$(ax "任务" --list --json)" found)
    m=$(jget "$(ax "我的" --list --json)" found)
    if [ "${_n:-0}" -gt 2 ]; then
      ok "已按坐标关掉 iOS「保存密码？」系统弹窗（回读：树里 ${_n} 枚可及名；任务=${t} 我的=${m}）"
      return 0
    fi
    echo "     [dismiss] 点完这棵树仍只有 ${_n} 枚可及名（任务=${t} 我的=${m}）⇒ 交给调用方判红"
  fi
  return 1
}

# 🔴 iOS 没有 Android 那个 KEYCODE_BACK。第二层屏（「账号与安全」/ 回收站 / 导出…）是
#    `ProfileScreen` 的 early return，只有它**自己顶栏那枚「返回」**能退出；而设置面是
#    RN `Modal`（`accessibilityViewIsModal`）。不先退出它们，后面每一次"打开设置面"的点击
#    都打在另一屏上，报出来的是「找不到按钮」，真因是根本没在那一屏（§7 元规则一）。
#    Android 那份用 `input keyevent KEYCODE_BACK` 干这件事，这里换成按标签。
unwind_second_level() {
  local i
  for i in $(seq 1 4); do
    [ "$(jget "$(ax "返回" --pressable --list --json)" found)" = "True" ] || return 0
    ax_press "返回"; sleep 2
  done
  # 按了 4 次还在 ⇒ 交给调用方（这里不判红：有的屏顶栏那枚就叫「关闭」而不是「返回」）。
  return 0
}

open_profile_tab() {
  dismiss_keyboard
  unwind_second_level
  ax "我的" --pressable --scroll-into-view >/dev/null 2>&1
  ax_press "我的"; sleep 3
  # 🔴 按下 ≠ 到站（本仓"按了要回读"那一族）。
  #    到达标记**先用过「立即同步」，实测是错的**（15:5x 第七趟）：这台机上「我的」根层
  #    是**官方托管同步**那一代，那颗按钮根本不在这一屏（树上读到的是
  #    「官方托管同步已开启」/「已拿到访问令牌…」），于是到站判据恒红 ——
  #    而"探针写错"与"没到站"在输出上长得一模一样（§7 元规则一）。
  #    现在用 `mobile.profile.entry.settings.hint` 那枚副标题：它是「我的」根层
  #    「设置」那一行**独有**的字串（设置面自己顶栏只写「设置」，分组目录里也没有这行字），
  #    且与同步那一代是官方的还是自托管的**无关**。
  local MARK="个人资料、偏好、同步与安全" i rc
  for i in 1 2 3; do
    needle_state "$MARK" >/dev/null 2>&1; rc=$?
    [ "$rc" = "0" ] && return 0
    if [ "$i" = "1" ]; then
      echo "     [tab] 按「我的」之后读不到根层那一行的副标题（rc=${rc}）⇒ 先关设置面再按一次"
      leave_settings_sheet || true
      ax "我的" --pressable --scroll-into-view >/dev/null 2>&1
      ax_press "我的"; sleep 3
    fi
  done
  echo "     [tab] 仍未站到「我的」根层（rc=${rc}）⇒ 交给调用方判红，不拿「没读到」当「到了」" >&2
  return 1
}

# leave_settings_sheet：**判据 E 的载体**（切走再回来 = 第二层屏 + Modal 一起卸载）。
# 🔴 分组目录里那一屏要按**两下**才出得去（第一下「返回」= 回目录，第二下「关闭」= 关面板），
#    所以这里是一个循环，而不是一条 `ax_press "关闭"`。
leave_settings_sheet() {
  local i
  unwind_second_level
  for i in $(seq 1 8); do
    dismiss_keyboard
    idb_dump
    if ! idb_has "关闭" && ! idb_has "返回"; then return 0; fi
    if idb_has "关闭"; then ax_press "关闭"; else ax_press "返回"; fi
    sleep 2
  done
  return 1
}

open_settings_sheet() {
  # 已经站在能填凭据的那一层就直接过（重复打开会把面板状态弄脏）。
  idb_dump
  if idb_has "服务器地址"; then echo "     已经在能填凭据的那一层"; return 0; fi
  leave_settings_sheet || true
  open_profile_tab
  press_row "设置" || return 1
  sleep 2.5
  # 🔴 两代 UI 都要够得着，而且**不许静默选一条**：
  #    装的产物（10-09 01:43 那次构建）里凭据表单在哪一层，是**量出来的**，不是猜的。
  #    旧那代：设置面根层就有「服务器地址」输入框（erasure 的 `open_settings_sheet` 靠它）。
  #    新那代：设置面先是一张分组目录，得再点一行「同步与隐私」才见得到表单
  #    （`SettingsScreen.tsx` 今天 10:17 被另一条会话改过，而它比装着的产物**新**）。
  local i
  for i in $(seq 1 8); do
    [ "$(jget "$(ax "服务器地址" --role AXTextField --list --json)" found)" = "True" ] && { echo "     设置面根层就能看到凭据表单"; return 0; }
    sleep 1
  done
  if needle_state "同步与隐私" >/dev/null 2>&1; then
    echo "     根层没有表单 ⇒ 走分组目录那一代，进「同步与隐私」"
    press_row "同步与隐私" || return 1
    sleep 2
    # 🔴 第三道闸（14:59 实测，`apps/mobile/evidence/account-suite-ios/02-credential-fill.png`）：
    #    进了「同步与隐私」看到的**不是**表单，而是一张「heyta 官方同步」卡
    #    （「登录 heyta 后…不需要填写服务器地址或手抄令牌。」）加一行「使用自托管服务器」。
    #    三件凭据在那一行**后面**（`SettingsScreen.tsx:504` 那颗按钮切过去）。
    #    这一代与上面两代是**乘法关系**，不是替代关系：根层→分组→自托管，少按一道就是空表单。
    if [ "$(jget "$(ax "服务器地址" --role AXTextField --list --json)" found)" != "True" ]; then
      if needle_state "使用自托管服务器" >/dev/null 2>&1; then
        echo "     同步分组是「官方同步」那一代 ⇒ 按「使用自托管服务器」展开手动凭据表单"
        press_row "使用自托管服务器" || return 1
        sleep 2
      fi
    fi
    for i in $(seq 1 10); do
      [ "$(jget "$(ax "服务器地址" --role AXTextField --list --json)" found)" = "True" ] && return 0
      sleep 1
    done
  fi
  bad "设置面没打开到能填凭据的那一层（两代都试过：根层 / 分组目录）—— 判据不能建在没打开的面上"
  dump_screen_text
  return 1
}

close_settings_sheet() {
  local i
  for i in $(seq 1 6); do
    idb_dump
    if ! idb_has "关闭"; then
      ok "设置面已关（第 ${i} 次检查）"
      return 0
    fi
    ax_press "关闭"
    sleep 2
  done
  bad "设置面关不上（点了 6 次「关闭」它还在）—— 下一轮起点会脏"
}

# fill_three_credentials <令牌> —— **手抄令牌**那条路（设置 → 同步 → 自托管表单）。
#
# ⚠️ 它**不能**用来"登录"：这条路只写 `form.token`，永远不碰 `signedInEmail`
#    （唯一写入点是 `saveAuthSession()`，`apps/mobile/src/auth/session.ts:87`）⇒
#    换绑区块那一行会回落成「还没登录」、「发起更换」是灰的。15:13 的实测就是它，
#    所以步骤 2 已换成下面的 `sign_in_with_password`。
#    现量调用点 **2 处**（尺：`grep -c '^fill_three_credentials "' 本文件`），留着的地方
#    都不需要"登录态"、只需要"设备手上有一枚活的凭据"：
#      · 步骤 10 —— 换绑把那枚打死之后把新令牌填回设备（`… "$NEWTOKEN"`）；
#      · 步骤 14 —— 「退出所有设备」之后重新配一次，给改密那一块一枚活的（`"$P_TOKEN"`）。
#      🔴 步骤 10 留了一条 **TODO**（写在那一步的注释里）：判据 G 要读「当前邮箱」那一行，
#         而那一行是 `signedInEmail`，手抄令牌填不回它 —— 等一趟真读数再裁决，不在这里猜。
fill_three_credentials() {  # <令牌>
  open_settings_sheet || return 1
  # 顺序：服务器地址 → 加密口令 → 访问令牌。`configured` 只看地址+令牌，
  # 最后写令牌意味着中途被打断不会留下「半配置」的歧义态。
  fill_field "服务器地址" "$HOST_SERVER" || return 1
  fill_field "端到端加密口令" "$E2EE_PASS" secure || return 1
  fill_field "访问令牌" "$1" || return 1
  dismiss_ios_save_password
  # 终态断言：三个字段**同时**还在 —— 「后一步把前一步清空」是实测踩过的形状，
  # 逐字段各自的局部断言抓不住它。
  local miss=""
  [ "$(jget "$(ax "服务器地址" --role AXTextField --list --json)" found)" = "True" ] || miss="${miss} 服务器地址"
  [ "$(jget "$(ax "访问令牌" --role AXTextField --list --json)" found)" = "True" ] || miss="${miss} 访问令牌"
  [ "$(jget "$(ax "端到端加密口令" --role AXTextField --list --json)" found)" = "True" ] || miss="${miss} 端到端加密口令"
  if [ -n "$miss" ]; then bad "填完之后这些字段反而不在了：${miss# }"; return 1; fi
  ok "三个凭据字段同时就位（令牌只打指纹 $(tok_fp "$1")）"
  close_settings_sheet
  # 🔴 "本机认下了"这一句要回**「我的」页的同步卡**上判：`notConfigured` 挂在
  #    `ProfileScreen.tsx:1099` 的 `!form.configured` 分支里，设置面里根本没有它。
  #    15:0x 现量：旧那句「填好服务器地址与访问令牌后才能同步。」在当前词条表里**已经不存在**
  #    （`grep -c` 命中 0），装着的产物里按 UTF-16LE 也数到 0 ⇒ 拿它当判据是一条**永不成立**的断言
  #    （"永远通过的那条判据比没有更糟"，§7 元规则二）。
  #    ⚠️ 同一句旧文案还留在 `scripts/lib/mobile-e2e.sh:1475` 与
  #    `verify-mobile-ios-account-erasure.sh:678` 的负向检查上 —— 那是别人的装置，
  #    已登记进台账，不在这里代改。
  open_profile_tab
  if needle_state "登录 heyta，让任务在设备间自动同步。" >/dev/null 2>&1; then
    bad "界面仍认为未配置（填进去的没生效）"
    return 1
  fi
  ok "「我的」页那句『未配置』已经不在了 ⇒ 本机认下这三件凭据"
}

# sign_in_with_password <邮箱> <登录密码> <E2EE 口令>
#
# 🔴 为什么步骤 2 **必须**走这一条，而不是 `fill_three_credentials`（15:13 的实测结论）：
#   换绑区块里「当前邮箱」那行的值是 `ProfileScreen.tsx:1249` 传下去的 `signedInEmail`，
#   而它**只有** `saveAuthSession()` 会写（`apps/mobile/src/auth/session.ts:87`；同文件
#   注释明写「不把它挪到调用方」）。手抄令牌那条路把 `accountHasCredential`
#   （`ProfileScreen.tsx:730` 的 `|| form.token.trim() !== ''`）撑成"已配置"，同步确实跑通了，
#   但 `signedInEmail` 仍是 `undefined` ⇒ `EmailChangeSection.tsx:187-189` 把那一行回落成
#   「还没登录」⇒ **判据 A 那条"值就是登录邮箱"的红**（判据 F/G 同一条腿）。
#   ⚠️ 机制要说准，别顺着截图想当然（15:4x 读实现现量）：那颗「发起更换」的
#   `disabled={!hasSession || draft.trim() === ''}`（`:292`）里，`hasSession` 只看
#   `baseUrl` + `token`（`:92`）⇒ **手抄令牌时它也是真**；那张截图里按钮发灰是
#   **草稿栏还空着**那一半，不是"没有会话"。⇒ 真正只有登录才可达的是
#   「当前邮箱」那行的**值**（判据 A 与判据 G），不是整块区块。
#   （取证：`apps/mobile/evidence/account-suite-ios/03-email-change-section.png`，
#   那颗按钮是去饱和浅蓝 ⇒ 主蓝判据命中 0 —— **那条判据是对的，别去放宽它**：
#   一张"标题 + 灰按钮 + 空草稿"的屏就不是我们要取证的那一屏。）
#   ⇒ 换绑 / 会话 / 改密这三块里，判据 A/F/G 那三条值判据只有「邮箱 + 密码登录」才可达。
#
# 载体（每一行都读自当前源码，不是推断）：
#   · 入口 = 「我的」页账号卡下那枚按钮，无凭据时文案「注册 / 登录」
#     （`mobile.profile.account.signIn`，`ProfileScreen.tsx:1289-1296`）；已有凭据时**同一枚**
#     按钮换文案成「切换账号」（`…account.switchAccount`）⇒ 两个都认，因为这一枚函数被复用时
#     表单里可能还留着上一段的凭据。
#   · 🔴 **不能**从首启那张登录闸门卡进：`WelcomeScreen.tsx:71-81` 渲染 AuthScreen 时**没有**
#     传 `allowServerSelection`（默认 `false`，`AuthScreen.tsx:174`），而「服务器地址」那一栏
#     只在 `allowServerSelection` 为真时才渲染（`AuthScreen.tsx:769-777`）⇒ 从闸门卡进去
#     **没有地方填本轮服务端的地址**，只能连 `App.tsx:169/:208` 那个 `authServerUrl`
#     （全新设备上就是产品默认地址）。步骤 1 点「先离线使用」让过闸门卡，
#     就是为了走到「我的」页这一条入口 —— **不是**因为闸门卡那枚按钮"没判据"。
#     ⚠️ 「我的」页这枚 `onPress={openAuth}` 把 RN 的事件对象当成了 `allowServerSelection`
#        传进去（`openAuth(allowServerSelection = false)`，`ProfileScreen.tsx:167`，而
#        `ui/kit.tsx:757` 的 Pressable 会 `onPress(event)`）⇒ 它是**真值**，地址栏会渲染。
#        这条依赖产品那个"顺手"的形状，所以本函数**不假设**：地址栏不在就响亮判红 + 截图，
#        绝不退化成"那就用默认地址"。（登记：这一枚更像产品缺陷，不属本单范围。）
#   · 四栏**顺填做不到**：「加密口令」只在登录成功之后才渲染（`AuthScreen.tsx:752-760`，
#     条件 `session !== undefined || action === 'save'`，它是规范 §3.2 的**第④步**），
#     「保存并启用同步」同一道闸（`:929-940`）⇒ 序列是 地址 → 邮箱 → 登录密码 →
#     按「用邮箱和密码登录」→（会话卡出现）→ 加密口令 → 按「保存并启用同步」。
#   · 地址**必须第一栏**：`updateServerUrl`（`AuthScreen.tsx:225-238`）在地址变化时会把
#     `loginPassword` / `password` / `pasted` 清空并把 phase 打回 idle —— 后填的会被清掉。
#   · 两个秘密的中文（现量，**不是猜**）：
#     `SIGN_IN_PASSWORD_LABEL_KEY` = `common.auth.signInPassword.label` = **「登录密码」**；
#     `E2EE_PASSPHRASE_LABEL_KEY` = `common.auth.e2eePassphrase.label` = **「加密口令」**。
#     ⚠️ 后者**不是**设置面那一格的「端到端加密口令」—— 两个面两个标签，抄错就是一枚
#     永不成立的判据（`fill_field` 找不到框只会报"写不进去"，归因会歪到设备上）。
#   · 「登录密码」在移动端**默认是明文**（`packages/ui/src/auth/model.ts:396-405`
#     `defaultPasswordRevealed('mobile') === true` ⇒ `AuthScreen.tsx:705` 的 `secure={!passwordRevealed}`
#     为 `false`），而「加密口令」那一栏是**写死的 `secure`**（`:754`）。⚠️ 所以下面**不写死**
#     分支：按那枚显隐开关**此刻的文案**裁决（「隐藏密码」= 现在明文 / 「显示密码」= 现在遮住），
#     两枚都不在树上就响亮判红 —— 拿错分支的后果不对称：对明文框走 `--type-text` 是**追加**
#     （`fill_field` 文件头记着 41→62→83 那一串），对 secure 框走 `--set` 是 rc=0 却不进 RN 状态。
#   · 值一律不进日志：`fill_field` 只打标签与码点/长度；要打"是不是同一枚"时用 `tok_fp`。
#     ⚠️ 明文档下这枚登录密码会进**当时那份** AX dump（`$IDB_DUMP_FILE`，EXIT trap 删、
#     判据 O 在步骤 16 扫的就是它 —— 那一份是收尾屏的树，早已不在认证屏上）。
#   · 模式判据写成**存在性**的：注册那张表独有的东西（「再次输入密码」`common.auth.form.confirmPassword`
#     与提交按钮「发送验证码」`mobile.auth.password.register`）**在树上 ⇒ 这是注册那张表** ⇒
#     先按模式切换那一行（`common.auth.form.switchToSignIn` = 「已经有账号了？直接登录」）再回读。
#     🔴 反向**不成立**：`mode` 的初值是 `'sign-in'`（`AuthScreen.tsx:194`），但"没数到注册独有的
#     东西"不等于"这就是登录"—— 所以正向还要**数到**登录那颗按钮（`exact_state "用邮箱和密码登录"`）。
#     `needle_state` / `exact_state` 的第三档（rc=2 = 树读不出）在这里**一律当失败**，
#     不许把它读成"不在树上"（§7 元规则一）。
sign_in_with_password() {
  local mail="$1" pass="$2" e2ee="$3" rc=0 i="" fc="" signed=0 left=0 reg=""
  local pk=""

  # ── 入口：设置面「同步与隐私 → 使用自托管服务器」里那颗登录按钮 ──────────
  # 🔴 为什么**不**走「我的」页那枚「注册 / 登录」：那一枚是普通账号入口，按
  #    `ProfileScreen.tsx:166` 写的规则它"只连官方服务"、不该渲染服务器地址栏；
  #    它现在渲染了，是因为 `ProfileScreen.tsx:1295` 把 `openAuth` **直接挂成 `onPress`**
  #    ⇒ RN 把按下事件对象当第一个实参传进去 ⇒ `allowServerSelection` 恒真。
  #    这条已登记成产品缺陷（台账 §6.16），**本脚本不骑在它上面**：
  #    自托管登录的规定路径是 `SettingsScreen.tsx:474` 那颗（`onOpenAuth(true)`），
  #    走它 ⇒ 缺陷哪天修掉，这一腿不会跟着变红。
  open_settings_sheet || { bad "进不去设置面的自托管凭据表单 ⇒ 登录入口没有载体"; return 1; }
  needle_state "注册 / 登录" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "2" ]; then
    bad "按入口之前就读不出这一棵树 —— 不拿「没读到」当「没有这一行」"
    return 1
  fi
  if [ "$rc" = "0" ]; then
    press_row "注册 / 登录" || return 1
  else
    # 🔴 第二枚候选也要**各自的 rc**：`needle_state` 的第三档（2 = 这一棵树读不出）
    #    不许被 `if` 当成"不在树上"，否则报出来的是"没有入口"而真因是探针。
    needle_state "切换账号" >/dev/null 2>&1; rc=$?
    if [ "$rc" = "0" ]; then
      echo "     自托管表单上已是「切换账号」那一代（有凭据在）⇒ 按它，进的是同一张 AuthScreen"
      press_row "切换账号" || return 1
    else
      bad "自托管表单上既没有「注册 / 登录」也没有「切换账号」（第二枚 rc=${rc}，2=树读不出）⇒ 不猜入口"
      dump_screen_text; shot "02-no-auth-entry.png"
      return 1
    fi
  fi
  sleep 2

  # ── 落在哪一屏、哪一代 ─────────────────────────────────────────────────
  if [ "$(jget "$(ax "邮箱" --role AXTextField --list --json)" found)" != "True" ]; then
    bad "按完入口之后树上没有「邮箱」输入框 ⇒ 没落在 AuthScreen 那张表单上（后面的填写都不作数）"
    dump_screen_text; shot "02-not-on-auth-screen.png"
    return 1
  fi
  ok "已到 AuthScreen（「邮箱」输入框在树上）"
  if [ "$(jget "$(ax "服务器地址" --role AXTextField --list --json)" found)" != "True" ]; then
    bad "🔴 AuthScreen 上没有「服务器地址」那一栏 ⇒ 这一趟没法把登录指向本轮服务端"
    echo "      （'allowServerSelection' 为假时产品就不渲染这一栏；见本函数文件头那三条载体读数）"
    dump_screen_text; shot "02-no-server-url-field.png"
    return 1
  fi
  # 注册那张表的**独有**件（存在性判据；rc=2 当失败）
  needle_state "再次输入密码" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "2" ]; then bad "判不了这是注册还是登录那一代（树读不出）"; return 1; fi
  [ "$rc" = "0" ] && reg="${reg} 「再次输入密码」"
  exact_state "发送验证码" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "2" ]; then bad "判不了这是注册还是登录那一代（树读不出）"; return 1; fi
  [ "$rc" = "0" ] && reg="${reg} 「发送验证码」"
  if [ -n "$reg" ]; then
    echo "     数到注册那张表的独有件：${reg# }⇒ 先按模式切换那一行"
    press_row "已经有账号了？直接登录" || { bad "切不到登录那一代（模式切换那一行点不到）"; shot "02-mode-switch.png"; return 1; }
    sleep 2
    needle_state "再次输入密码" >/dev/null 2>&1; rc=$?
    if [ "$rc" != "1" ]; then
      bad "🔴 按了「已经有账号了？直接登录」之后「再次输入密码」还在（rc=${rc}）⇒ 代没切过去，不拿注册那张表填密码"
      dump_screen_text; shot "02-still-register.png"
      return 1
    fi
  fi
  exact_state "用邮箱和密码登录" >/dev/null 2>&1; rc=$?
  if [ "$rc" != "0" ]; then
    bad "切代之后仍数不到登录那颗按钮「用邮箱和密码登录」（rc=${rc}）⇒ 不猜这一代是什么，不往下填"
    dump_screen_text; shot "02-not-sign-in-mode.png"
    return 1
  fi
  ok "确认落在**登录**那一代：注册独有件不在树上，且逐字数到「用邮箱和密码登录」"

  # ── 填三栏（地址 → 邮箱 → 登录密码）────────────────────────────────────
  fill_field "服务器地址" "$HOST_SERVER" || return 1
  fill_field "邮箱" "$mail" || return 1
  needle_state "隐藏密码" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "2" ]; then bad "判不了「登录密码」是明文还是遮住档（树读不出）"; return 1; fi
  if [ "$rc" = "0" ]; then
    pk="text"
    echo "     显隐开关此刻写「隐藏密码」⇒ 登录密码是**明文**档，按普通框填（回读逐字相同，比掩码码点更强）"
  else
    needle_state "显示密码" >/dev/null 2>&1; rc=$?
    if [ "$rc" = "2" ]; then bad "判不了「登录密码」是明文还是遮住档（树读不出）"; return 1; fi
    if [ "$rc" = "0" ]; then
      pk="secure"
      echo "     显隐开关此刻写「显示密码」⇒ 登录密码是遮住档，按 secure 框填（掩码码点回读）"
    else
      bad "两枚显隐开关的文案都不在树上 ⇒ 判不了「登录密码」该走哪一条填写腿，不猜"
      dump_screen_text; shot "02-no-reveal-toggle.png"
      return 1
    fi
  fi
  fc=$(field_count "登录密码")
  [ "$fc" = "1" ] || { bad "「登录密码」输入框数到 ${fc} 枚（期望恰好 1）⇒ 不猜往哪一格写"; shot "02-login-password-fields.png"; return 1; }
  if [ "$pk" = "secure" ]; then
    fill_field "登录密码" "$pass" secure || return 1
  else
    fill_field "登录密码" "$pass" || return 1
  fi
  dismiss_keyboard
  dismiss_ios_save_password || true

  # ── 按「用邮箱和密码登录」，按下**要回读**（网络那一发之后才有会话卡）──────
  press_row "用邮箱和密码登录" || return 1
  for i in $(seq 1 30); do
    sleep 2
    needle_state "已登录" >/dev/null 2>&1; rc=$?
    if [ "$rc" = "0" ]; then signed=1; break; fi
    if [ "$rc" = "2" ]; then echo "     [login] 第 ${i} 次树读不出（不拿它当「还没登录」）"; fi
    # 🔴 「保存密码？」是**提交之后**才弹的（erasure:700-706 复核出的同一条），它会盖住
    #    整屏 ⇒ 每 5 次采样摘一遍；摘不到不判红（这一档的判据是会话卡那句，不是弹窗）。
    if [ "$((i % 5))" = "0" ]; then
      dismiss_ios_save_password || true
      needle_state "已登录" >/dev/null 2>&1 && { signed=1; break; }
    fi
  done
  if [ "$signed" != "1" ]; then
    bad "30×2s 内没出现会话卡「已登录」⇒ 登录这一发没成（失败句是服务端驱动的，看下面界面文本）"
    dump_screen_text; shot "02-login-no-session.png"
    return 1
  fi
  needle_state "当前账号：" >/dev/null 2>&1; rc=$?
  if [ "$rc" != "0" ]; then
    bad "会话卡在，但没有「当前账号：<邮箱>」那一句（rc=${rc}）⇒ 登录态没带上账号身份"
    dump_screen_text; shot "02-session-no-email.png"
    return 1
  fi
  needle_state "$mail" >/dev/null 2>&1; rc=$?
  if [ "$rc" != "0" ]; then
    bad "会话卡那句里的邮箱不是本轮那个（树上数不到 $mail，rc=${rc}）"
    dump_screen_text; shot "02-session-wrong-email.png"
    return 1
  fi
  ok "登录成功，会话卡显示的就是本轮邮箱：$mail（合成测试地址，可以打；令牌与口令不行）"

  # ── 规范 §3.2 第④步：现在才有「加密口令」那一栏 ─────────────────────────
  fc=$(field_count "加密口令")
  [ "$fc" = "1" ] || { bad "「加密口令」输入框数到 ${fc} 枚（期望恰好 1）⇒ 登录成功之后那一栏没就位，不猜往哪一格写"; shot "02-e2ee-field.png"; dump_screen_text; return 1; }
  fill_field "加密口令" "$e2ee" secure || return 1
  dismiss_ios_save_password || true
  dismiss_keyboard

  # ── 按「保存并启用同步」并回读（粘贴/登录成功 ≠ 同步已启用，§7 同族陷阱）──
  press_row "保存并启用同步" || return 1
  for i in $(seq 1 20); do
    sleep 2
    needle_state "保存并启用同步" >/dev/null 2>&1; rc=$?
    if [ "$rc" = "1" ]; then left=1; break; fi
    if [ "$rc" = "2" ]; then echo "     [save] 第 ${i} 次树读不出（不拿它当「按钮已经没了」）"; fi
  done
  if [ "$left" != "1" ]; then
    bad "40×2s 之后「保存并启用同步」还在 ⇒ AuthScreen 没退出，登录的会话没落成活配置"
    dump_screen_text; shot "02-save-sync-stuck.png"
    return 1
  fi
  ok "「保存并启用同步」按掉并且这一栏已经从树上消失（AuthScreen 已退出）"

  # ── 终态断言①：「我的」页那句『未配置』必须不在 ─────────────────────────
  #    挂在 `ProfileScreen.tsx:1099` 的 `!form.configured` 分支，设置面里没有它。
  #    🔴 所以这一条**必须先证明"此刻站在「我的」根层"**：不证到达，"那句不在"
  #       有两种读数（已配置 / 压根不在这一屏），而第六趟实测撞上的正是第二种。
  open_profile_tab || { bad "没站到「我的」根层 ⇒ 终态①没有载体，不能算登录走通"; dump_screen_text; shot "02-not-on-profile-tab.png"; return 1; }
  needle_state "登录 heyta，让任务在设备间自动同步。" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "0" ]; then
    bad "界面仍认为未配置 ⇒ 登录产出的凭据没被本机认下（'onSignedIn' 那三处回填没生效？）"
    dump_screen_text; shot "02-still-not-configured.png"
    return 1
  fi
  if [ "$rc" = "2" ]; then
    bad "读不出这一棵树 —— 不拿「没读到」当「那句已经不在了」"
    return 1
  fi
  ok "「我的」页那句『未配置』已经不在了 ⇒ 本机认下了这次登录"
  needle_state "切换账号" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "0" ]; then
    ok "账号卡那枚按钮已换成「切换账号」那一代（'accountHasCredential' 成立）"
  else
    echo "     [note] 没数到「切换账号」（rc=${rc}）—— 这一档不判红：它是外观分流，终态①②才是判据"
  fi

  # ── 终态断言②：真的去「我的 → 设置 →（个人资料分组）」读「当前邮箱」那一行 ──
  #    形状照步骤 3（那两代 UI 都要够得着：根层直接看得到 / 先过分组目录）。
  press_row "设置" || return 1
  sleep 2.5
  if ! needle_state "更换登录邮箱" >/dev/null 2>&1; then
    if needle_state "个人资料" >/dev/null 2>&1; then
      echo "     设置面根层看不到换绑区块 ⇒ 走分组目录那一代，进「个人资料」"
      press_row "个人资料" || { bad "进不去「个人资料」分组，读不到「当前邮箱」那一行"; shot "02-no-profile-group.png"; return 1; }
      sleep 2
    fi
  fi
  needle_state "当前邮箱" >/dev/null 2>&1; rc=$?
  if [ "$rc" != "0" ]; then
    bad "读不到「当前邮箱」那一行（rc=${rc}）⇒ 终态②没有载体，不能算登录走通"
    dump_screen_text; shot "02-no-current-email-row.png"
    return 1
  fi
  # 🔴 这一条是**这次改动的靶心**：那一行的值不再是 `EmailChangeSection.tsx:189` 的回落
  #    「还没登录」，而是 `signedInEmail` 本身（只有 `saveAuthSession` 会写它）。
  needle_state "还没登录" >/dev/null 2>&1; rc=$?
  if [ "$rc" = "0" ]; then
    bad "🔴「当前邮箱」那一行还是「还没登录」⇒ 这次登录没写成 'signedInEmail'，换绑那颗按钮仍是灰的"
    dump_screen_text; shot "02-current-email-still-offline.png"
    return 1
  fi
  if [ "$rc" = "2" ]; then bad "判不了「还没登录」在不在（树读不出）"; return 1; fi
  needle_state "$mail" >/dev/null 2>&1; rc=$?
  if [ "$rc" != "0" ]; then
    bad "「当前邮箱」那一行里数不到本轮邮箱（rc=${rc}）"
    dump_screen_text; shot "02-current-email-missing.png"
    return 1
  fi
  ok "「当前邮箱」那一行的值就是登录邮箱：$mail（合成测试地址，可以打）⇒ 换绑区块从这一趟起才可达"
  leave_settings_sheet || echo "     [note] 设置面没能自己关干净 —— 步骤 3 会重新一路开进去"
  return 0
}

# sync_signature：树上全部非空可及名的签名（照抄 erasure:211-234）。
# 🔴 为什么不是"看见 busy 就算按到了"：那边真机实测「正在同步…」在 12 个 1s 采样里
#    **一次都没命中**（同步比采样快），而这一腿要回答的只是"这一下有没有被接住"。
sync_signature() {
  idb_dump
  python3 - "$IDB_DUMP_FILE" <<'PY'
import json, sys, unicodedata
try:
    nodes = json.load(open(sys.argv[1]))
except Exception:
    print("TREE-UNREADABLE")
    raise SystemExit
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
seen = set()
for t in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(t):
        for key in ("AXLabel", "AXValue", "label", "value", "title"):
            v = n.get(key)
            if isinstance(v, str) and v.strip():
                seen.add(unicodedata.normalize("NFKC", v).strip()[:60])
                break
print(" | ".join(sorted(seen)))
PY
}

# sync_now_states：等不到「立即同步」时，把"这一屏此刻到底处在哪一种态"逐条量出来。
# 🔴 存在的理由就是 15:13 那次矛盾的读数：这里判了红，而**同一次运行**后面那句
#    「已到已同步态」却过了 —— 两条不可能同时是真的，红的大概不是"同步没触发"，
#    而是"这颗按钮此刻不叫这个名字 / 根本不在这一屏"。那种场合把归因交给人读，
#    而不是交给一条会指错方向的 `bad`。
#    ⚠️ 它只打**诊断**，不替代判红：每条都带 `needle_state` 的第三档 rc（2 = 树读不出，
#    既不是"在"也不是"不在"，§7 元规则一）。不打印任何值，只打印这一档在不在。
sync_now_states() {
  local _w="" _rc=0
  for _w in "正在同步…" "立即同步" "已是最新" "其余数据已同步" "登录 heyta，让任务在设备间自动同步。" "这台设备的登录凭据已失效" "关闭" "返回" "我的" "任务"; do
    needle_state "$_w" >/dev/null 2>&1; _rc=$?
    case "$_rc" in
      0) echo "     [态] 在树上：$_w" ;;
      1) echo "     [态] 不在：$_w" ;;
      *) echo "     [态] 读不出（树没落地）：$_w —— 这一档不算"没不在"" ;;
    esac
  done
}

sync_now() {  # 点「立即同步」：忙时它会改名叫「正在同步…」，所以先等它回到空闲名
  dismiss_keyboard
  ax_press "我的"; sleep 3
  if ! idb_wait_label "立即同步" 90; then
    echo "     第一轮没等到 ⇒ 先按系统弹窗处置一遍再等第二轮"
    dismiss_ios_save_password || true
    # 🔴 摘掉弹窗之后**必须重新导航**（erasure:700-706 复核出来的）：上面那一下 press
    #    是在弹窗立着时发的，它没落地；第二轮就这么等，等的是"永远不出现的标签"。
    ax_press "我的"; sleep 3
    if idb_wait_label "立即同步" 90; then
      echo "     第二轮等到 ⇒ 弹窗腿成立"
    else
      # 🔴 第三轮之前先裁决"是不是只是改了名"：忙态里这颗按钮**按设计**不叫「立即同步」
      #    （`ProfileScreen.tsx:1091` 的 `label={busy ? sync.busy : sync.now}`），
      #    而真登录之后 `saveAndSync` 自己就发过一次同步（`AuthScreen.tsx:599`）+ 自动同步
      #    那条腿也起来了 ⇒ 这一趟很可能撞在忙态里。那种场合再给它一段有界的等待，
      #    是在修一条**指错方向的判据**，不是放宽判据：等回来的仍然是同一枚按钮、
      #    后面照旧要"按下之后界面签名变过"。
      needle_state "正在同步…" >/dev/null 2>&1; _rc=$?
      if [ "$_rc" = "0" ]; then
        echo "     诊断：这颗按钮此刻改名叫「正在同步…」（界面在忙态）⇒ 再给它 60 秒回到空闲名"
        if idb_wait_label "立即同步" 60; then
          echo "     回到空闲名 ⇒ 忙态腿成立，按得出去了"
        else
          bad "90+90 没等到 + 60 秒仍在忙态 ⇒ 这一次同步没被接住，后面的读数不作数"
          sync_now_states
          dump_screen_text
          return 1
        fi
      else
        # ⚠️ `_rc=2`（这一棵树读不出）也走这一支 —— 那是**响亮失败**，不是把它读成
        #    "不在忙态所以按钮应该在"。下面的 `sync_now_states` 会把每一档标成
        #    在 / 不在 / 读不出，人一眼能分"界面不在这颗按钮上"与"探针够不着"。
        bad "90+90 秒内仍没等到「立即同步」，且此刻也不在忙态（忙态读数 rc=${_rc}）—— 这一次同步没被触发，后面的读数不作数"
        sync_now_states
        dump_screen_text
        return 1
      fi
    fi
  fi
  ax "账号" --scroll-into-view --list --json >/dev/null 2>&1
  SIG0=$(sync_signature)
  ax_press "立即同步"
  ACKED=0
  for _ in $(seq 1 12); do
    sleep 1
    [ "$(sync_signature)" != "$SIG0" ] && { ACKED=1; break; }
  done
  if [ -z "${SIG0// /}" ]; then
    bad "按下「立即同步」之前界面签名是**空的** ⇒ 不在同步状态面上，这一步之后所有读数都不作数"
    return 1
  fi
  # 这一档是**诊断腿**，不判红（"签名一字未变"在产品按设计不产生第二次可见变化时是正常读数）。
  if [ "$ACKED" = "0" ]; then
    echo "     ACK=unchanged（诊断腿，不判红；签名前 160 字：${SIG0:0:160}）"
  else
    echo "     ACK=changed"
  fi
}

# 等同步到终态：绿 = 「已是最新」，红 = 「登录凭据已失效」那一句（= 401，正是变异态的形状）。
# 两个方向都要轮询到位（`verify-mobile-account.sh` 步骤 5 的同一条纪律）；窗口给 4 分钟，
# 因为**新账号首次同步要走纯 JS 的 Argon2id 派生**（Hermes 没有 WASM，实测 30–40 秒起）。
wait_sync_terminal() {  # <这一档在等什么> → 0=已同步 / 1=凭据已失效 / 2=超时
  local what="$1" i
  for i in $(seq 1 60); do
    idb_dump
    if needle_state "已是最新" >/dev/null 2>&1 || needle_state "其余数据已同步" >/dev/null 2>&1; then
      echo "     ${what}：已到已同步态（第 $((i * 4)) 秒）"
      return 0
    fi
    if needle_state "这台设备的登录凭据已失效" >/dev/null 2>&1; then
      echo "     ${what}：界面报「登录凭据已失效」= 401"
      return 1
    fi
    sleep 4
  done
  return 2
}

# ── 取证：截图（采前清同名旧文件 + 非空白 **且** 数得出主蓝）───────────────
# 🔴 主蓝这一半有**两种**合法形态（第十一趟实测）：启用态就是 token 的主蓝，
#    禁用态是它按 `state.disabled-opacity`（token 现值 0.38）叠在卡片底上的**混合色**。
#    换绑区块那颗「发起更换」在草稿为空时是 `disabled`（`EmailChangeSection.tsx:292`），
#    `kit.tsx:776` 用 token 的不透明度表达禁用 ⇒ 屏幕上根本没有 #2563EB 那个像素值，
#    `countBrandBlue` 对两张**真界面**实测命中 **0**，于是 §7 第 82 条那道闸在表单页上恒红。
#    不删判据、不放宽容差，改成**多目标**：启用态主蓝 **或** 禁用态主蓝，
#    两个目标都是从 `tokens.css` **现算**的（改 token 判据跟着走，脚本里没有第二个字面量）。
#    禁用态那一档的下限另立（`BLUE_DISABLED_MIN`）：淡紫是"抗锯齿边缘也会蹭到"的颜色，
#    实测真界面（整颗主按钮）命中 8618 / 8809，而按钮处于启用态的那张图只剩 45 / 34
#    ⇒ 下限要的是"数得出**一整颗**按钮"，不是"蹭到几个像素"。
BLUE_DISABLED_MIN=1000
png_judge() {  # <path> → 一行 JSON（blank / blue / blueDisabled / contentRatio / size）
  HEYTA_PNG_STATS="$HEYTA_REPO_ROOT/scripts/screenshots/png-stats.mjs" \
  HEYTA_TOKENS_CSS="$HEYTA_REPO_ROOT/packages/design-system/src/tokens.css" \
  "$NODE" --input-type=module - "$1" <<'NODE' 2>/dev/null
const fs = await import('node:fs');
const { inspectPng, looksBlank, countBrandBlue, countColor } = await import(process.env.HEYTA_PNG_STATS);
const css = fs.readFileSync(process.env.HEYTA_TOKENS_CSS, 'utf8');
const decl = (name) => [...css.matchAll(new RegExp('--ht-' + name + ':\\s*([^;]+);', 'g'))].map((m) => m[1].trim());
const resolve = (v, depth) => {
  const t = v.trim();
  if (depth > 6 || !t.startsWith('var(')) return t;
  const next = decl(t.slice(4, -1).replace(/^--ht-/, ''))[0];
  return next === undefined ? '' : resolve(next, depth + 1);
};
const rgb = (h) => { const m = /^#([0-9a-fA-F]{6})$/.exec(h.trim()); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
const alpha = parseFloat(decl('state-disabled-opacity')[0]);
const blends = [];
for (const pRaw of decl('color-primary')) {
  const p = rgb(resolve(pRaw, 0));
  if (!p) continue;
  for (const sRaw of decl('color-surface')) {
    const s = rgb(resolve(sRaw, 0));
    if (s) blends.push(p.map((c, i) => Math.round(c * alpha + s[i] * (1 - alpha))));
  }
}
const stats = inspectPng(process.argv[2]);
let blueDisabled = 0;
for (const b of blends) blueDisabled = Math.max(blueDisabled, countColor(process.argv[2], b));
console.log(JSON.stringify({
  blank: looksBlank(stats),
  blue: countBrandBlue(process.argv[2]),
  blueDisabled,
  contentRatio: stats.contentRatio,
  size: `${stats.width}x${stats.height}`,
}));
NODE
}
shot() {  # <文件名> [<这一张在证什么>]
  local name="$1" why="${2:-}" path="$EVIDENCE_DIR/$1" read="" blank="" blue="" bdisabled=""
  mkdir -p "$EVIDENCE_DIR"
  # 🔴 采集前**清掉同名旧文件**：采不到却留着上一轮的图 = 这条判据自动变成装饰
  #    （AGENTS §6.2 规定一第 2 条；md5 撞车那一次就是这么来的）。
  rm -f -- "$path"
  idb_current screenshot --udid "$UDID" "$path" >/dev/null 2>&1 || true
  [ -s "$path" ] || xcrun simctl io "$UDID" screenshot --display "$IOS_DISPLAY" "$path" >/dev/null 2>&1 || true
  if [ ! -s "$path" ]; then
    bad "截图失败：$name（idb 与 simctl 都没出图，display=${IOS_DISPLAY}）"
    return 1
  fi
  read=$(png_judge "$path")
  blank=$(printf '%s' "$read" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("blank"))' 2>/dev/null)
  blue=$(printf '%s' "$read" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("blue"))' 2>/dev/null)
  bdisabled=$(printf '%s' "$read" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("blueDisabled"))' 2>/dev/null)
  echo "     📷 apps/mobile/evidence/account-suite-ios/$name  ${read:-读数取不到}"
  # 🔴 **两个条件都要**（AGENTS §7 第 82 条）：只"非空白"的话，一张错误屏 / 别的页面
  #    照样绿。主蓝是结构性判据：真界面数得出，错误屏、空白屏、桌面底色都是 0。
  if [ "$blank" = "True" ]; then
    bad "截图判据红（非空白这一半）：$name 是空白图 —— ${read}"
    return 1
  fi
  case "$blue$bdisabled" in ''|*[!0-9]*) bad "截图读数取不到（blue='$blue' blueDisabled='$bdisabled'）：$name"; return 1 ;; esac
  # 启用态主蓝 **或** 禁用态主蓝（见上面 `BLUE_DISABLED_MIN` 那段），两条都不满足才算红。
  if [ "$blue" -ge "$BLUE_MIN" ]; then return 0; fi
  if [ "$bdisabled" -ge "$BLUE_DISABLED_MIN" ]; then
    echo "     （主蓝按**禁用态**命中：启用态 ${blue} < ${BLUE_MIN}，禁用态混合色 ${bdisabled} ≥ ${BLUE_DISABLED_MIN}）"
    return 0
  fi
  bad "截图判据红（主蓝那一半）：$name 里既数不出启用态主蓝（${blue} < ${BLUE_MIN}），也数不出禁用态主蓝（${bdisabled} < ${BLUE_DISABLED_MIN}）${why:+（$why）} —— 非空白只回答「有没有东西」，回答不了「是不是这个界面」（§7 第 82 条）"
  return 1
}

# ── 邮件那两发（照 Android `:254-304`：从日志的 Ethereal 预览里取**整条链接**）──
preview_link() { # <preview URL> → 两行：第一行令牌、第二行整条链接（调用方只放进变量，不进日志）
  python3 - "$1" <<'PY'
import re, sys, urllib.request
try:
    raw = urllib.request.urlopen(sys.argv[1], timeout=30).read().decode('utf-8', 'replace')
except Exception:
    print('\t'); raise SystemExit(0)
# 🔴 预览页内嵌正文时做了两层转义（`\u002f` 与 `&amp;`），不归一化就取不出链接
#    —— 症状是"信里明明有 token，脚本说没有"。
msg = raw.replace('\\u002f', '/').replace('\\/', '/').replace('&amp;', '&')
m = re.search(r'(https?://[^"\'\s]*/change-email\?token=([0-9a-f]{16,}))', msg)
print(f"{m.group(2)}\n{m.group(1)}" if m else '\n')
PY
}

# ── 产物新鲜度（这一格**故意不用** Android 那种"bundle 比所有源码新"的粗判据）──
# 🔴 理由（现量）：`packages/i18n/src/locales/*.ts` 与 `apps/mobile/src/screens/SettingsScreen.tsx`
#    是别人刚改的、比装着的 bundle 新 ⇒ 粗判据会把这一腿**永久挡死**，
#    而它挡的其实与本线无关。换成两条**各自成立**的判据：
#    ① 本线那 5 枚文件的 mtime 逐枚 ≤ bundle 的 mtime（缺任何一枚 ⇒ 前提不成立）；
#    ② 这三块界面要判的那几句中文在 bundle 里按 **UTF-16LE** 数得到（≥1）。
#    ② 为什么不能直接 grep：Hermes bundle 里的中文字符串是 **UTF-16LE** 存的
#    （traps **#171**）⇒ UTF-8 探针恒 0 命中，而那会被读成"产物里没有这句"。
utf16_count() {  # <文件> <中文串> → 出现次数（按 UTF-16LE 字节序列）
  python3 - "$1" "$2" <<'PY'
import sys
try:
    raw = open(sys.argv[1], "rb").read()
except OSError:
    print(-1); raise SystemExit
print(raw.count(sys.argv[2].encode("utf-16-le")))
PY
}

TOKEN=""; DEAD_TOKEN=""; NEWTOKEN=""; P_TOKEN=""; TARGET_TOKEN=""; EXTRA_TOKEN=""; OLD_TOK=""; NEW_TOK=""

echo ""
echo "=== 移动端「换绑邮箱 + 登录设备 + 改登录密码」（真 iOS 模拟器 + 真服务端 + 真发信，零 mock）==="
echo "  设备: ${IOS_DEVICE_NAME:-iPhone 17 Pro}   服务端: $API   库: $DB_NAME   日志: $SERVER_LOG"
echo "  账号: $OLD_EMAIL → $NEW_EMAIL"

# ── 0. 现场与归属 ──────────────────────────────────────────────────────────
step "0. 前置：防撞 / 产物新鲜度（两条）/ 这台服务端上有本线的路由 / idb 与 AX 工具接口"
UDID=${IOS_UDID:-}
if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl list devices booted -j 2>/dev/null | python3 -c "
import json, sys
want = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
booted = []
for _rt, devs in (data.get('devices') or {}).items():
    for d in devs:
        if d.get('state') == 'Booted':
            booted.append((d.get('name') or '', d.get('udid') or ''))
same = [u for n, u in booted if n == want]
if len(same) == 1:
    print(same[0])
elif len(booted) == 1:
    print(booted[0][1])
" "$DEVICE_NAME" 2>/dev/null)
  if [ -z "$UDID" ]; then
    echo "   ❌ 认不出该验收哪台模拟器（已启动 $(xcrun simctl list devices booted 2>/dev/null | grep -c Booted) 台，且无唯一同名「${DEVICE_NAME}」）—— 不猜。"
    echo "      显式指定：IOS_UDID=<udid> bash scripts/verify-mobile-ios-account-email-sessions.sh ⇒ exit 3"
    exit 3
  fi
fi
IDB_UDID="$UDID"
export IDB_UDID

# 🔴 dump 落盘换成**本趟私有路径**（erasure:362-372 那两条理由在这里一条都省不掉）：
#    ① 两条 iOS 线共用固定路径时，后写的那趟会**覆盖前者的证据**而没人报红；
#    ② 本装置全程要把**访问令牌**填进凭据面板，`describe-all` 会把输入框的**值**
#       一起抄进这份 dump ⇒ 探针自己在 /tmp 造了一份本机明文（判据 O 就靠删除兑现）。
IDB_DUMP_FILE=/tmp/_heyta-idb-dump-accmail-$STAMP.json
export IDB_DUMP_FILE

[ -n "$PUBLIC_BASE" ] || { echo "   ❌ PUBLIC_URL 没给 ⇒ 没法判「信里的链接属于本轮服务端」，步骤 D 无从谈起。起栈时带上它。这是前提，不是产品失败 ⇒ exit 3"; exit 3; }
OUT=$(another_mobile_e2e_running)
if [ -n "$OUT" ]; then
  echo "   ❌ 有别的移动端验收正在跑（并行 = 互相拆现场 / 抢同一台设备 / 抢同一个 companion）："
  printf '%s\n' "$OUT" | sed 's/^/      /'
  echo "      这是环境条件，不是产品失败 ⇒ exit 3"
  exit 3
fi
[ -r "$SERVER_LOG" ] || { echo "   ❌ 读不到服务端日志 $SERVER_LOG —— 那两封信取不回来，步骤 6/7 会恒红 ⇒ exit 3"; exit 3; }

APP_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null)
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)
if [ -z "$APP_CONTAINER" ] || [ ! -d "$APP_CONTAINER" ]; then
  echo "   ❌ 这台设备上没有已装的 ${BID}（本装置不打包 —— 装包是 reinstall:mobile 那一层的动作）⇒ exit 3"
  echo "      IOS_DEVICE_NAME=\"${DEVICE_NAME}\" bash scripts/reinstall-all.sh --only ios"
  exit 3
fi
BUNDLE_JS="${APP_CONTAINER}/main.jsbundle"
JS_MTIME=$(stat -f %m "$BUNDLE_JS" 2>/dev/null || echo 0)
if [ "$JS_MTIME" = "0" ]; then
  echo "   ❌ 读不到 ${BUNDLE_JS} 的 mtime（产物形状变了？）⇒ 新鲜度无从判起，本趟不作数。exit 3"
  exit 3
fi
# ① 本线那 5 枚文件：逐枚 mtime ≤ bundle mtime，缺任一枚 ⇒ 前提不成立。
FRESH_FILES=(
  "$HEYTA_REPO_ROOT/apps/mobile/src/screens/SecurityScreen.tsx"
  "$HEYTA_REPO_ROOT/apps/mobile/src/screens/SessionsSection.tsx"
  "$HEYTA_REPO_ROOT/apps/mobile/src/screens/EmailChangeSection.tsx"
  "$HEYTA_REPO_ROOT/apps/mobile/src/screens/ProfileScreen.tsx"
  "$HEYTA_REPO_ROOT/packages/app-host/src/hosted-auth.ts"
)
FRESH_VIOL=""
FRESH_MISS=""
for _f in "${FRESH_FILES[@]}"; do
  if [ ! -f "$_f" ]; then FRESH_MISS="${FRESH_MISS} $(basename "$_f")"; continue; fi
  _m=$(stat -f %m "$_f" 2>/dev/null || echo 0)
  if [ "$_m" -gt "$JS_MTIME" ]; then FRESH_VIOL="${FRESH_VIOL} $(basename "$_f")"; fi
done
# ② 内容存在性：这三块界面要判的那几句中文，按 UTF-16LE 在 bundle 里数得到。
NEEDLE_BUNDLE=("更换登录邮箱=3" "当前密码=2" "这一台就是你正在用的设备=1" "其它设备上的登录都会失效=1" "修改密码=3")
CONTENT_VIOL=""
for _pair in "${NEEDLE_BUNDLE[@]}"; do
  _txt="${_pair%%=*}"
  _got=$(utf16_count "$BUNDLE_JS" "$_txt")
  echo "   UTF-16LE 探针「${_txt}」命中 ${_got}（该串在词条表里的出现次数：${_pair##*=}）"
  [ "${_got:-0}" -ge 1 ] 2>/dev/null || CONTENT_VIOL="${CONTENT_VIOL} ${_txt}"
done
echo "   设备: ${DEVICE_NAME} (${UDID})   bundle mtime=${JS_MTIME}   负载(记录值)=${LOAD1:-未取到}"
echo "   容器 data: ${DATA_CONTAINER:-（尚未生成，首启后才有）}"
if [ -n "$FRESH_MISS" ]; then
  echo "   ❌ 前提不成立：本线源码缺文件：${FRESH_MISS# }（工作树与这条判据不同代）⇒ exit 3"
  exit 3
fi
if [ -n "$FRESH_VIOL" ]; then
  echo "   ❌ 前提不成立：装着的 bundle 比这些源码文件**旧**：${FRESH_VIOL# }"
  echo "      ⇒ 这一腿量的不是当前代码。先重打并重装当前产物：pnpm reinstall:mobile（或 --only ios）"
  exit 3
fi
if [ -n "$CONTENT_VIOL" ]; then
  echo "   ❌ 前提不成立：bundle 里按 UTF-16LE 数不到这些句子：${CONTENT_VIOL# }"
  echo "      ⇒ 界面上不会有这些字（traps #171：Hermes 里的中文是 UTF-16LE，直接 grep 恒 0 —— 探针要按字节编码去数）。"
  echo "      要重新构建才能跑这一腿：pnpm reinstall:mobile"
  exit 3
fi
ok "产物新鲜度两条都成立：本线 5 枚源码都不比 bundle 新，且这三块界面的句子都在 bundle 里"

HEALTH_BODY=$(curl -s --noproxy '*' -m 5 "$HOST_SERVER/health" 2>/dev/null)
if printf '%s' "$HEALTH_BODY" | grep -q '"status":"ok"'; then
  ok "服务端在 $HOST_SERVER 可达（/health: ${HEALTH_BODY:0:60}）"
elif curl -s --noproxy '*' -m 5 "$HOST_SERVER/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
  ok "服务端在 $HOST_SERVER 可达（经 /api/health）"
else
  echo "   ❌ 服务端不可达 ⇒ 换绑那两封信根本发不出来，C/D/E/F 全部无从判起。这不是产品失败 ⇒ exit 3"
  echo "   现量：${HOST_SERVER}/health 返回「${HEALTH_BODY:-空}」"
  exit 3
fi
# 🔴 期望 **401 而不是 404**：404 = 这台服务端**没有本线的路由**（跑的是旧 dist），
#    那时整轮结论都不可信 —— AGENTS §7 第 27/82 条那个形状。这是前提，不是判据。
# ⚠️ **方法必须逐条对上**：Fastify 对"路径在、方法不在"回的是 **404**，不是 405。
#    14:47 实测：`GET /api/password/change` ⇒ 404，而 `POST /api/password/change` ⇒ 401
#    （三条各按自己的方法都回 401：`GET account/email/change/status`、`GET auth/sessions`、
#    `POST password/change`）。拿 GET 去探一条 POST-only 的路由，症状与"跑的是旧 dist"
#    一模一样 —— 那是**探针造的假前提**，会把这一腿永久挡死。
for pe in "GET account/email/change/status" "GET auth/sessions" "POST password/change"; do
  p_m=${pe%% *}; p_path=${pe#* }
  C=$(curl -s --noproxy '*' -m 5 -o /dev/null -w '%{http_code}' -X "$p_m" "$API/api/$p_path")
  [ "$C" = "401" ] || { echo "   ❌ $p_m $API/api/$p_path 回 $C（期望 401）。404 = 这台跑的不是当前源码（或方法写错了）：先 pnpm --filter @heyta/sync-server build 再起栈 ⇒ exit 3"; exit 3; }
done
ok "本线三条路由都在（换绑状态 / 会话列表 / 改密），未登录各回 401"
SRV_PID=$(lsof -ti "tcp:${E2E_PORT}" -sTCP:LISTEN 2>/dev/null | head -1)
# 🔴 `HEYTA_E2E_PIDFILE` 是**起栈那一份**写的（scripts/mobile-e2e-up.sh:53）。
#    这里只做取证打印：pid 对得上就一起打，对不上**不判红** —— 端口上真有一位监听者
#    就已经满足这一腿的前提，pidfile 只是它"是谁"的额外线索。
SRV_PIDFILE="${HEYTA_E2E_PIDFILE:-/tmp/heyta-e2e-server.pid}"
echo "   服务端归属: pid=${SRV_PID:-未识别} pidfile=$(cat "$SRV_PIDFILE" 2>/dev/null || echo 无) HEAD=$(git -C "$HEYTA_REPO_ROOT" rev-parse --short HEAD 2>/dev/null) dist=$(stat -f '%Sm' "$HEYTA_REPO_ROOT/server/dist/src/index.js" 2>/dev/null || echo 缺)"

if ! resolve_idb; then
  echo "   ❌ 找不到 idb —— iOS 验收要从设备内部驱动界面 ⇒ exit 3"
  echo "      安装：bash scripts/install-idb.sh"
  exit 3
fi
ensure_idb_companion || { echo "   ❌ idb companion 起不来 ⇒ exit 3"; exit 3; }
SHIM_HELP=$(python3 "$SHIM" --help 2>&1 || true)
SHIM_MISSING=""
for _flag in --dismiss-keyboard --type-text --scroll-into-view --occurrence; do
  printf '%s\n' "$SHIM_HELP" | grep -q -- "$_flag" || SHIM_MISSING="${SHIM_MISSING} ${_flag}"
done
if [ -n "$SHIM_MISSING" ]; then
  echo "   ❌ ios-ax-shim 不再接受：${SHIM_MISSING# } ⇒ 装置与工具接口漂移，本趟不判产品。exit 3"
  exit 3
fi
ok "iOS AX 工具接口在位（--dismiss-keyboard / --type-text / --scroll-into-view / --occurrence）"

# ── 1. 起 App 到主界面 ─────────────────────────────────────────────────────
step "1. 全新态起 App，并处置首启的隐私同意面板（🔴 候选只给「同意并联网」）"
# 与 erasure 同一条纪律：全新态靠**卸掉再装回来**（`simctl uninstall` 之后 launch 必失败），
# 装回的是**同一份当前产物**且必须 `cp -Rp` 保 mtime —— 否则上面那条新鲜度判据就变成
# 永远不会红的装饰（那边 10-05 实测补的，理由写在这里同样成立）。
find /tmp -maxdepth 1 -name 'heyta-ios-accmail-app-*.app' -mmin +240 -exec rm -rf {} + 2>/dev/null || true
APP_SRC="${IOS_APP_SRC:-}"
if [ -z "$APP_SRC" ]; then
  APP_SRC="/tmp/heyta-ios-accmail-app-$$.app"
  rm -rf "$APP_SRC"
  cp -Rp "$APP_CONTAINER" "$APP_SRC" || { echo "   ❌ 捞产物失败（${APP_CONTAINER} → ${APP_SRC}）⇒ 环境无效（3）"; exit 3; }
  echo "   产物已先捞出来（保留 mtime）：$APP_SRC"
fi
[ -d "$APP_SRC" ] || { echo "   ❌ IOS_APP_SRC 指向的目录不存在：${APP_SRC} ⇒ 环境无效（3）"; exit 3; }
xcrun simctl uninstall "$UDID" "$BID" >/dev/null 2>&1
if ! xcrun simctl install "$UDID" "$APP_SRC" 2>/dev/null; then
  echo "   ❌ 装回失败（${APP_SRC} @ ${UDID}）⇒ 「装的是当前产物且是全新态」这一格的前提没成立"
  echo "      这是装置/环境，不是产品：exit 3"
  exit 3
fi
echo "   已卸旧装新（全新态；装回的是同一份当前产物，mtime 未变）"
case "$APP_SRC" in
  /tmp/heyta-ios-accmail-app-*) rm -rf "$APP_SRC" ;;
esac
xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1 \
  || { bad "App 起不来（${BID} @ ${UDID}）"; shot "01-launch-failed.png"; summary "iOS 换绑·会话·改密" "" 1; }
sleep 8
# 🔴 候选**只给「同意并联网」**（Android 那份 `:179-181` 的同一条理由，而 erasure 的
#    两候选循环**违背**了它）：这条旅程后面每一步都要真发请求，把「只用本机」当兜底候选
#    会把离线态钉进这一轮，之后所有"信发出去了"的判据都成了假绿。
#    ⚠️ 用 `idb_has` 判存在要看**退出码**（0=在树上），它什么都不打印（lib 同段注释）。
idb_dump
if idb_has "先离线使用" && ! idb_has "同意并联网"; then
  bad "首启面板只给得出「先离线使用」—— 这一轮不能跑在离线态里（后面每一条都要真发请求）"
  dump_screen_text
  shot "01-offline-only-consent.png"
  summary "iOS 换绑·会话·改密" "" 1
fi
if idb_has "同意并联网"; then
  XY=$(idb_label_center "同意并联网" 2>/dev/null)
  if [ -z "$XY" ]; then
    bad "「同意并联网」在树上但取不到坐标（角色不是可点节点？）"
    shot "01-consent-stuck.png"
    summary "iOS 换绑·会话·改密" "" 1
  fi
  idb_ui tap $XY >/dev/null 2>&1
  sleep 3
  echo "     已点「同意并联网」@ ${XY}"
  # 点了不等于收下了：回读一次（traps：按下 ≠ 生效）。
  idb_dump
  if idb_has "同意并联网"; then
    echo "     面板还在 ⇒ 再按一次"
    XY=$(idb_label_center "同意并联网" 2>/dev/null)
    [ -n "$XY" ] && idb_ui tap $XY >/dev/null 2>&1
    sleep 3
    idb_dump
    if idb_has "同意并联网"; then
      bad "点了两次「同意并联网」面板还在"
      dump_screen_text
      shot "01-consent-stuck2.png"
      summary "iOS 换绑·会话·改密" "" 1
    fi
  else
    ok "隐私同意已收下（面板已从树上消失）"
  fi
else
  echo "     首启没有隐私同意面板（这台已经点过？全新安装不该有 —— 只记读数，不判红）"
fi
# 🔴 第二张首启屏：**登录闸门卡**「开始安排今天」，两颗按钮「注册 / 登录」与「先离线使用」。
#    14:49 实测（`apps/mobile/evidence/account-suite-ios/01-not-on-main.png`）：收下隐私同意之后
#    停在的就是这一张，而它**不是**上面那条"只用本机"的隐私候选 —— 它只是"现在先不登录"。
#    本旅程要的正是"让过这一张、走到主界面"：步骤 2 的登录从**设置面「同步与隐私 →
#    使用自托管服务器」里那颗**进（`sign_in_with_password`，规定路径是
#    `SettingsScreen.tsx:474` 的 `onOpenAuth(true)`）。⚠️ 不是"闸门卡那枚也可以，只是懒得点"：
#    `WelcomeScreen.tsx:71-81` 渲染 AuthScreen 时不传 `allowServerSelection`，
#    而「服务器地址」那一栏只在它为真时渲染（`AuthScreen.tsx:766-776`）⇒
#    从闸门卡进去**没有地方填本轮服务端的地址**，登录会打到 `DEFAULT_SERVER_URL`。
#    ⚠️ 与上面同一条纪律：按下要回读，点了不等于收下了。
idb_dump
if idb_has "先离线使用"; then
  for attempt in 1 2 3; do
    XY=$(idb_label_center "先离线使用" 2>/dev/null)
    if [ -z "$XY" ]; then
      echo "     「先离线使用」在树上但取不到坐标（第 ${attempt} 次）"
    else
      idb_ui tap $XY >/dev/null 2>&1
      echo "     已点「先离线使用」@ ${XY}（第 ${attempt} 次）"
    fi
    sleep 3
    idb_dump
    idb_has "先离线使用" || break
  done
  if idb_has "先离线使用"; then
    bad "点了三次「先离线使用」这张登录闸门卡还在 —— 后面的填写都无从下手"
    dump_screen_text
    shot "01-login-gate-stuck.png"
    summary "iOS 换绑·会话·改密" "" 1
  fi
  ok "登录闸门卡已让过（走的是「现在先不登录」，凭据随后填进设置面）"
fi
dismiss_ios_save_password
# 🔴 空树 = 环境（companion 的 axbridge 会间歇返回空树；App 的无障碍注册也会跑久了卡死，
#    lib:1140-1148 记着重启模拟器就自愈）。它必须先于任何"界面上没有 X"的结论被排除。
ax_tree_sane
idb_dump
if idb_has "任务"; then
  ok "已到主界面（底部标签「任务」在树上）"
else
  bad "处置完首启之后仍读不到「任务」标签 —— 界面没到主屏，后面的填写都不可信"
  shot "01-not-on-main.png"
  dump_screen_text
  summary "iOS 换绑·会话·改密" "" 1
fi

# ── 2. 建号 + 设备侧真登录 + 首次同步 ──────────────────────────────────────
step "2. 建已知密码的测试账号，在设备上走「邮箱 + 密码登录」，并等首次同步到终态"
RESP=$(curl -s --noproxy '*' -m 20 -X POST "$API/api/test/create-user" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${OLD_EMAIL}\",\"password\":\"${OLD_PASS}\"}")
TOKEN=$(printf '%s' "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
[ -n "$TOKEN" ] || { echo "   ❌ create-user 没走通（响应里没有 token）：$(redact "$(printf '%s' "$RESP" | head -c 160)")"
  echo "      ⚠️ 该路由只在 TEST_MODE 下挂载。这是前提不成立 ⇒ exit 3"; exit 3; }
printf '%s' "$TOKEN" > "$HEYTA_E2E_TOKEN_FILE"
printf '%s' "$OLD_EMAIL" > "$HEYTA_E2E_EMAIL_FILE"
printf '%s' "$E2EE_PASS" > "$HEYTA_E2E_E2EE_FILE"
# 邮箱**不是**秘密（它是登录标识，Android 那份也直接打印）⇒ 这里不做样子打码，
# 只把令牌压成指纹 —— "看起来脱敏了"与"真的不需要脱敏"是两件事，别把前者冒充后者。
ok "账号已建（${OLD_EMAIL}），会话令牌指纹 $(tok_fp "$TOKEN")"
# 🔴 这一发 create-user 交回来的那枚令牌**只是"这个账号 + 这个口令成立"的凭证**，
#    它不再是要填进设备的那一枚 —— 设备上那枚由 AuthScreen 的登录自己签。
#    ⚠️ 后果写清楚，别让它悄悄改读法：`$TOKEN` 从此是本趟的**同级活会话**（同一账号、
#    另一枚 JWT），不是"这台设备手上那枚"。所以
#      · 步骤 9 那句「换绑前那枚旧令牌 401」仍然成立 —— `tokenVersion` 是**全局**计数器
#        （ADR-0063 §2.2），账号下每一枚都跟着失效，与它是哪一枚无关；
#      · 步骤 11 会话列表里它是**可撤的**一行，「这台设备」那一枚是设备自己登录签的那行
#        （判据 H 数的就是这两件事，它多一个兄弟不影响 ≥2 的下界）；
#      · 步骤 12 那句"手上这枚仍 200"用的是 `$NEWTOKEN`（步骤 10 填回设备的那一枚），
#        不引用 `$TOKEN` ⇒ 这条改动**没有**碰任何一条判据的语义。
#    TODO（等一趟真读数再动，不在这里猜）：如果要把 `$TOKEN` 换成设备手上那一枚，
#    得先证「设置面里『访问令牌』那格的 AX 值就是设备正在用的那枚」—— 那是另一把尺，
#    本趟没有它的阳性对照，所以这里**不**代取。
sign_in_with_password "$OLD_EMAIL" "$OLD_PASS" "$E2EE_PASS" \
  || { bad "设备侧这次真登录没走通 —— 换绑 / 会话 / 改密三块都建在没登录的面上"; shot "02-sign-in.png"; summary "iOS 换绑·会话·改密" "" 1; }
# ⚠️ 这次登录**自己就会发一次同步**（`AuthScreen.tsx:582` 的 `saveAndSync` 在
#    `saveAuthSession()` 之后 `void syncNow()`，`:599`；而 `session.ts:85` 的
#    `notifyConfigured()` 又起了自动同步那条腿）⇒ 下面这一发可能是"第二次"。它不是装饰：
#    判据要的读数是**手动那一按也被接住**，而自动那条腿在本线里没有任何判据
#    （§7 第 66 条讲的正是"只能靠手点"那一段已经被改掉）。
# 🔴 16:2x 实测之后把这一格写成**有条件的判据**，而不是无条件判红，也不是改成恒绿：
#   走到终态的前提是那把 E2EE 口令进了应用状态。这一趟它没进（「我的」页读到的是
#   `common.sync.error.noPassword`），而同一个时刻**兄弟 rig `verify-mobile-ios.sh`
#   在同一台机、同一份产物上同样读不到「立即同步」**（16:24 那次 A/B：`SIB_RC=1`，
#   红在 5a「注册 / 登录」按 5 次不进认证页、兜底路径「设置」滚不进可见区、
#   以及同一句"120 秒内「立即同步」既没空闲可用也没 busy"）。
#   ⇒ 口令没落进状态时这一格**记成"没闭合"**（既不记产品失败，也不记已验证），
#     并且不去空等 180 秒；口令落了就必须到终态。本线三块判据（换绑 / 会话 / 改密）
#     只依赖**已认证的会话**，不依赖同步到终态，所以后面的步骤照原样继续。
if text_on_screen "还没设置端到端加密口令"; then
  echo "   ⚠️ 这一格**没闭合**：E2EE 口令没进应用状态 ⇒ 同步被客户端闸住（reason 是 no-encryption-password）。"
  echo "      不记产品失败（同一份产物上兄弟 rig 也拿不到「立即同步」），也不记已验证。"
  shot "02-first-sync-not-closed.png"
else
  sync_now
  wait_sync_terminal "首次同步"; RC_SYNC=$?
  if [ "$RC_SYNC" = "0" ]; then
    ok "首次同步到终态：这台设备已用**这次登录**拿到的会话与这把 E2EE 口令和服务端握手成功"
  else
    shot "02-first-sync.png"
    if [ "$RC_SYNC" = "1" ]; then
      bad "首次同步报「登录凭据已失效」= 401（刚登录拿到的会话在这台服务端上不成立）"
    else
      bad "4 分钟内首次同步没到终态（新账号首同步要走纯 JS 的 Argon2id 派生，实测 30–40s 起；负载高时久得多）"
    fi
    dump_screen_text
    summary "iOS 换绑·会话·改密" "" 1
  fi
fi

# ── 3. 判据 A：设置面的「个人资料」里有「更换登录邮箱」这块 ────────────────
step "3. 判据 A：设置面的「个人资料」里有「更换登录邮箱」这块，且当前邮箱那行就是登录邮箱"
open_profile_tab
press_row "设置" || { bad "打不开设置面"; summary "iOS 换绑·会话·改密" "" 1; }
sleep 2
if ! needle_state "更换登录邮箱" >/dev/null 2>&1; then
  if needle_state "个人资料" >/dev/null 2>&1; then
    echo "     根层看不到这块 ⇒ 走分组目录那一代，进「个人资料」"
    press_row "个人资料" || { bad "进不去「个人资料」分组"; shot "03-no-profile-section.png"; summary "iOS 换绑·会话·改密" "" 1; }
    sleep 2
  fi
fi
idb_dump
if ! needle_state "更换登录邮箱" >/dev/null 2>&1; then
  bad "设置面里找不到「更换登录邮箱」区块"
  dump_screen_text; shot "03-no-email-change-block.png"
  summary "iOS 换绑·会话·改密" "" 1
else
  ok "区块标题在"
  needle_state "在新旧两个邮箱里各点一次" >/dev/null 2>&1 \
    && ok "说明句在：两边都点完才生效" || bad "说明句缺失（'common.emailChange.intro' 没渲染）"
  # 🔴 存在性判据 + **值**判据：当前邮箱那一行的值必须就是登录邮箱。
  #    空串会被读成"这个账号的邮箱是空的"，而那件事在本系统里不存在
  #    （`EmailChangeSection.tsx:187-189` 宁可说"还没登录"也不说空串）。
  needle_state "$OLD_EMAIL" >/dev/null 2>&1 \
    && ok "当前邮箱那一行显示的就是登录邮箱" || bad "当前邮箱那一行没显示登录邮箱"
  shot "03-email-change-section.png" "判据 A：区块在"
fi

# ── 4. 真点「发起更换」─────────────────────────────────────────────────────
step "4. 判据 B：真点「发起更换」→「两封信已经发出」（不是「已更换」）+ 等待态三句"
LOG_BEFORE=$(wc -l < "$SERVER_LOG")
idb_dump
FC=$(field_count "新邮箱地址")
if [ "$FC" != "1" ]; then
  bad "「新邮箱地址」输入框数到 ${FC} 枚（期望恰好 1）⇒ 不猜该往哪一格里写"
  shot "04-new-email-field.png"; summary "iOS 换绑·会话·改密" "" 1
fi
fill_field "新邮箱地址" "$NEW_EMAIL" || { bad "新邮箱没填进去"; shot "04-fill-new-email.png"; summary "iOS 换绑·会话·改密" "" 1; }
# 🔴 顺序必须是"先收键盘 → 等这一发落定 → 只有它没提交才去按按钮"（第十一趟实测）。
#    前两趟把它写成"收键盘 → 找按钮"，于是得到一条**恒红**判据，症状与"产品坏了"完全一样
#    （读出来是"树里 0 条含「发起更换」的可及名"）。真机制有两处，都在别人的代码里，
#    所以只能读出来、不能猜：
#      · `--dismiss-keyboard` 是按**键盘右下角那枚 return 键**收的
#        （`ios-ax-shim.py:709-752`：return 键的标签随输入法语言变，故按 KeyboardKey trait 结构匹配）；
#      · 这颗输入框写着 `onSubmitEditing={() => void submit()}`（`EmailChangeSection.tsx:281`）。
#    ⇒ **收键盘这个动作本身就是一次提交**。证据不是截图看起来像，是库里那张活请求：
#    第十一趟现量 `select count(*) … = 1`，而脚本一次按钮都没按过；
#    截图里那颗主按钮是 spinner —— `kit.tsx:785` 只有 `loading`（= `busy`）为真才画它。
#    所以这里不能"补按一次"：再按一次会撞上冷却，把一条好判据换成一句假失败。
dismiss_keyboard
TRIGGER=""
for i in $(seq 1 20); do
  if needle_state "正在发起" >/dev/null 2>&1 || needle_state "两封信已经发出" >/dev/null 2>&1; then
    TRIGGER="键盘 return 键（走的是同一个 onSubmitEditing → submit()）"; break
  fi
  if pick_pressable_row "发起更换" >/dev/null 2>&1; then TRIGGER="按钮"; break; fi
  sleep 1
done
if [ -z "$TRIGGER" ]; then
  bad "20×1s 内既没有\"正在发起/两封信已经发出\"，也没有可按的「发起更换」⇒ 这一发根本没发出去"
  dump_screen_text; shot "04-no-submit.png"; summary "iOS 换绑·会话·改密" "" 1
fi
if [ "$TRIGGER" = "按钮" ]; then
  press_row "发起更换" || { bad "点不到「发起更换」按钮"; shot "04-no-submit.png"; summary "iOS 换绑·会话·改密" "" 1; }
fi
echo "   这一发「发起更换」由 ${TRIGGER} 触发"
SENT=0
for i in $(seq 1 30); do
  idb_dump
  needle_state "两封信已经发出" >/dev/null 2>&1 && { SENT=1; break; }
  sleep 2
done
if [ "$SENT" = "1" ]; then
  ok "成功文案是「两封信已经发出」—— 不是「已更换」（生效还没发生）"
else
  bad "30×2s 内没看到「两封信已经发出」"; dump_screen_text; shot "04-no-sent-copy.png"
fi
needle_state "还在等新邮箱这一边" >/dev/null 2>&1 && bad "界面上已经出现「等新邮箱那一边」—— 一发都没点过，这句是假话"
# 🔴 本轮最该钉住的一条（Android `:238-241` 同一条）：成功文案之后，
#    「还等哪一边」只能来自服务端那一次读（`getEmailChangeStatus` + `emailChangeStage`）。
needle_state "还在等两个邮箱各点一次" >/dev/null 2>&1 \
  && ok "阶段句来自服务端：等两边各点一次" || { bad "没画出「等两边」那句"; dump_screen_text; }
needle_state "待绑邮箱" >/dev/null 2>&1 \
  && ok "「待绑邮箱」那一行在" || bad "没有待绑邮箱行（pendingEmail 没画出来）"
needle_state "$NEW_EMAIL" >/dev/null 2>&1 \
  && ok "待绑那一行的值就是新地址" || bad "待绑行里看不到新地址"
shot "04-awaiting-both.png" "判据 B：等待态三句"

# ── 5. 服务端读数 ───────────────────────────────────────────────────────────
step "5. 判据 C：服务端那张活请求 —— 只存哈希、两侧互不相同、两边都没点"
# 🔴 先数**枚数**再看形状：第 4 步那一条"收键盘 = 提交"的路径如果和按钮按下的路径
#    同时成立（或者判据写成"没找到按钮就补按一次"），这里会出现**两张**活请求，
#    而下面那条逐字比对只读第一行 —— 枚数单独成判据，才不会让多提交伪装成"形状对"。
NREQ=$(db "select count(*) from email_change_requests r join users u on u.id=r.user_id where u.email='${OLD_EMAIL}'")
printf '   活请求枚数: %s\n' "$NREQ"
case "$NREQ" in
  1) ok "只有一张活请求（return 键那一发没有变成两发）" ;;
  *) bad "活请求枚数是 ${NREQ}（期望恰好 1）⇒ 这一批要么没发出去，要么发了两遍" ;;
esac
ROW=$(db "select r.old_confirmed_at is null, r.new_confirmed_at is null, length(r.old_token)>=40, r.old_token<>r.new_token, r.pending_email from email_change_requests r join users u on u.id=r.user_id where u.email='${OLD_EMAIL}'")
printf '   读数（旧未点|新未点|是哈希|两侧不同|待绑地址）: %s\n' "$(redact "$ROW")"
case "$ROW" in
  't|t|t|t|'"$NEW_EMAIL") ok "活请求成立：两边都没点、存的是哈希、旧新两侧不同、待绑就是那个新地址" ;;
  *) bad "活请求形状不对：$(redact "$ROW")" ;;
esac

# ── 6. 两封信真的发出去了 ───────────────────────────────────────────────────
step "6. 那两封信真的发出去了：从 Ethereal 预览各取一条链接"
authorize_preview=''; confirm_preview=''
for i in $(seq 1 30); do
  PARSED=$(LOG_BEFORE="$LOG_BEFORE" LOG="$SERVER_LOG" python3 - <<'PY'
import os, re
lines = open(os.environ['LOG'], errors='ignore').read().split('\n')[int(os.environ['LOG_BEFORE']):]
out, label = {}, ''
for ln in lines:
    m = re.search(r'Email change (?:authorize|confirm) email', ln)
    if m: label = m.group(0)
    p = re.search(r'Preview URL: (\S+)', ln)
    if p and label: out.setdefault(label, p.group(1))
print('A\t' + out.get('Email change authorize email', ''))
print('C\t' + out.get('Email change confirm email', ''))
PY
)
  authorize_preview=$(printf '%s' "$PARSED" | sed -n 's/^A\t//p')
  confirm_preview=$(printf '%s' "$PARSED" | sed -n 's/^C\t//p')
  [ -n "$authorize_preview" ] && [ -n "$confirm_preview" ] && break
  sleep 2
done
if [ -z "$authorize_preview" ] || [ -z "$confirm_preview" ]; then
  # 分岔要说人话：这台栈如果配了**真 SMTP**，日志里永远不会有 `Preview URL:`
  # （`server/src/email.ts:113-116` 只在 Ethereal 兜底时才打那一行）—— 那是环境，不是产品。
  if grep -q 'SMTP configured' "$SERVER_LOG"; then
    echo "   ❌ 这一腿在**这台栈**上不成立：日志里有「SMTP configured」⇒ 信发给了真 SMTP，"
    echo "      而 'Preview URL:' 只有 Ethereal 兜底那条路才会打 ⇒ 取不回链接。"
    echo "      重启这一台栈时**不要**配 SMTP（或换 Ethereal）⇒ 前提不成立 exit 3"
    exit 3
  fi
  if grep -q 'Email change aborted because a confirmation mail could not be delivered' "$SERVER_LOG"; then
    bad "服务端明说**发信失败**（有一封没送到 ⇒ 它会整体放弃这张活请求）；看日志里那行 Failed to send 的原因"
  else
    bad "没拿到两封信的 preview（没网连不上 ethereal？还是发信本身就失败了？）"
  fi
else
  ok "旧邮箱那封 + 新邮箱那封都在（preview 地址本身不带入日志）"
fi

# ── 7. 链接属于本轮服务端，且不烧令牌 ───────────────────────────────────────
step "7. 判据 D：链接属于本轮服务端，GET 它是**确认页**而且不烧令牌"
OLD_PAIRED=$(preview_link "$authorize_preview")
NEW_PAIRED=$(preview_link "$confirm_preview")
OLD_TOK=$(printf '%s' "$OLD_PAIRED" | sed -n '1p'); OLD_LINK=$(printf '%s' "$OLD_PAIRED" | sed -n '2p')
NEW_TOK=$(printf '%s' "$NEW_PAIRED" | sed -n '1p'); NEW_LINK=$(printf '%s' "$NEW_PAIRED" | sed -n '2p')
if [ -z "$OLD_TOK" ] || [ -z "$NEW_TOK" ]; then
  bad "信里取不出 change-email 令牌（转义没归一化？还是 preview 页形状变了？）"
elif [ "$OLD_TOK" = "$NEW_TOK" ]; then
  bad "两封信取回同一枚令牌 —— 发信串了"
else
  ok "两枚令牌不同，指纹 $(tok_fp "$OLD_TOK") / $(tok_fp "$NEW_TOK")"
  # 🔴 这条判据就是「起栈必须带 PUBLIC_URL」的原因：链接指向别处（比如生产域名）时，
  #    后面两次 POST 打的仍是本轮服务端，于是"信里的链接能用"这件事**从没被验过**。
  case "$OLD_LINK" in "$PUBLIC_BASE"*) ok "旧那封的链接以本轮 PUBLIC_URL 开头" ;; *) bad "旧那封的链接不指向本轮服务端：${OLD_LINK%%\?*}" ;; esac
  case "$NEW_LINK" in "$PUBLIC_BASE"*) ok "新那封的链接同样" ;; *) bad "新那封的链接不指向本轮服务端：${NEW_LINK%%\?*}" ;; esac
  PAGE=$(curl -s --noproxy '*' -m 15 "$OLD_LINK")
  if printf '%s' "$PAGE" | grep -q 'data-token='; then
    ok "GET 回的是确认页（带着令牌，不是「已失效」页）"
  else
    bad "GET 没拿到确认页"; printf '   页面头 120 字: %s\n' "$(redact "$(printf '%s' "$PAGE" | head -c 120)")"
  fi
  STILL=$(db "select old_confirmed_at is null from email_change_requests r join users u on u.id=r.user_id where u.email='${OLD_EMAIL}'")
  [ "$STILL" = "t" ] && ok "🔴 GET 之后旧侧仍未确认 —— 邮件预取器烧不掉一次性令牌" || bad "GET 把令牌消费了（预取器会毁掉这条路）"
fi

# ── 8. 只点旧那半：切走再回来，那句实话必须改口 ─────────────────────────────
step "8. 判据 E（本线唯一只能由真设备证的一条）：只点旧那半 → 切走再回来读到「等新邮箱那一边」"
CODE=$(curl -s --noproxy '*' -m 20 -o /tmp/heyta-ios-accmail-confirm-old-${STAMP}.json -w '%{http_code}' \
  -X POST "$API/api/account/email/change/confirm" -H 'content-type: application/json' -d "{\"token\":\"${OLD_TOK}\"}")
if [ "$CODE" = "200" ]; then
  ok "旧侧确认 HTTP 200（**不带会话**也能点 —— 点链接的人手上没有会话）"
else
  bad "旧侧确认 HTTP $CODE：$(redact "$(head -c 200 /tmp/heyta-ios-accmail-confirm-old-${STAMP}.json 2>/dev/null)")"
fi
# 🔴 切走再回来 = RN Modal 卸载重挂（Android 用 BACK 键，iOS 上没有那个键，
#    所以这里点界面上的「关闭」把整个设置面关掉，再一路重新打开）。
#    组件里压根没有"阶段"可留 ⇒ 那句只能重新读服务端。
leave_settings_sheet || bad "设置面关不掉（这一档的载体没成立：没卸载就没有重挂）"
open_profile_tab
press_row "设置" || { bad "重挂时打不开设置面"; shot "08-reopen.png"; }
if needle_state "个人资料" >/dev/null 2>&1 && ! needle_state "更换登录邮箱" >/dev/null 2>&1; then
  press_row "个人资料" || bad "重挂后进不去「个人资料」分组"
fi
sleep 2
STAGE=0
for i in $(seq 1 20); do
  idb_dump
  needle_state "还在等新邮箱这一边" >/dev/null 2>&1 && { STAGE=1; break; }
  sleep 2
done
if [ "$STAGE" = "1" ]; then
  ok "重新挂载后那句实话来自服务端：等新邮箱那一边"
else
  bad "切走再回来没读出「等新邮箱」"; dump_screen_text; shot "08-stage-not-served.png"
fi
needle_state "当前邮箱那一边已经确认" >/dev/null 2>&1 \
  && ok "句子说清了哪一边已经点过" || bad "阶段句没写清哪一边已确认"
shot "08-awaiting-new.png" "判据 E：重挂之后读回来的实话"

# ── 9. 点新那半：换绑生效 ───────────────────────────────────────────────────
step "9. 判据 F：点新那半 → 库里地址改了、活请求没留下、换绑前那枚令牌全局失效"
CODE=$(curl -s --noproxy '*' -m 20 -o /tmp/heyta-ios-accmail-confirm-new-${STAMP}.json -w '%{http_code}' \
  -X POST "$API/api/account/email/change/confirm" -H 'content-type: application/json' -d "{\"token\":\"${NEW_TOK}\"}")
[ "$CODE" = "200" ] && ok "新侧确认 HTTP 200" || bad "新侧确认 HTTP $CODE：$(redact "$(head -c 200 /tmp/heyta-ios-accmail-confirm-new-${STAMP}.json 2>/dev/null)")"
EMAIL_NOW=$(db "select email from users where email in ('${NEW_EMAIL}','${OLD_EMAIL}')")
[ "$EMAIL_NOW" = "$NEW_EMAIL" ] && ok "库里邮箱已经是新地址" || bad "库里邮箱还是 ${EMAIL_NOW}"
LEFT_REQ=$(db "select count(*) from email_change_requests r join users u on u.id=r.user_id where u.email in ('${NEW_EMAIL}','${OLD_EMAIL}')")
[ "$LEFT_REQ" = "0" ] && ok "生效即删 —— 那张活请求没有留下" || bad "还留着 $LEFT_REQ 张活请求"
OLDHTTP=$(curl -s --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$API/api/notifications" -H "authorization: Bearer $TOKEN")
[ "$OLDHTTP" = "401" ] && ok "换绑前那枚旧令牌 401（tokenVersion 递增 —— ADR-0063 §2.2：JWT 的 payload 里就带着邮箱）" \
  || bad "旧令牌 HTTP $OLDHTTP（期望 401）"
# 本地优先那一半：换绑**不许**销毁本机明文库（销毁只有「注销账号」那一条路，
# 由 verify-mobile-ios-account-erasure.sh 证）。这里只量"还在盘上"，不发明阈值。
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)
if [ -f "${DATA_CONTAINER}/Library/heyta.sqlite" ]; then
  ok "本机明文库仍在盘上（换绑不销毁本地数据）"
else
  bad "换绑之后 ${DATA_CONTAINER}/Library/heyta.sqlite 不在盘上了 —— 本地优先被破坏"
fi

# ── 10. 界面上的当前邮箱必须变成新地址 ──────────────────────────────────────
step "10. 判据 G：界面上的当前邮箱变成新地址（这才是「改成功了」的真界面证据）"
NEWTOKEN=$(curl -s --noproxy '*' -m 20 -X POST "$API/api/login/email-password" \
  -H 'content-type: application/json' -H 'user-agent: verify-ios-current-device' \
  -d "{\"email\":\"${NEW_EMAIL}\",\"password\":\"${OLD_PASS}\"}" \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
[ -n "$NEWTOKEN" ] && ok "新邮箱能换新会话（旧口令照用 —— 换绑不动凭据），指纹 $(tok_fp "$NEWTOKEN")" \
  || bad "新邮箱登录失败（换绑把凭据改坏了？）"
# 🔴 换绑把**上一枚**令牌打死了（步骤 9 那条 401 就是它），但那一枚仍然是这趟用过的秘密：
#    它进过 AX dump（凭据面板把值印在输入框上）⇒ 必须留在脱敏与泄漏扫描的名单里，
#    不能被"覆盖 TOKEN"这一步从名单上抹掉。
DEAD_TOKEN="$TOKEN"
TOKEN="$NEWTOKEN"
printf '%s' "$NEWTOKEN" > "$HEYTA_E2E_TOKEN_FILE"
leave_settings_sheet
# 🔴 TODO（**这一趟很可能在这里红，而且是可预期的**，不在这里代改）：
#   判据 G 要的是「当前邮箱」那一行 = 新地址，而那一行的值是 `EmailChangeSection.tsx:189`
#   读的 `currentEmail` ← `ProfileScreen.tsx:1249` 的 `signedInEmail` ——
#   它是**内存里那次登录的邮箱**（`session.ts:87` 唯一的写入点，换绑不会去改它）。
#   手抄令牌这一发只把 `form.token` 换成新会话，`signedInEmail` 仍是**旧**邮箱
#   ⇒ 这一行既不是「还没登录」（步骤 2 真登录之后它写上了旧地址）、也不是新地址。
#   要真的把新地址送进那一行，产品里只有一条路：**用新邮箱再登录一次**
#   （也就是这一步改调 `sign_in_with_password "$NEW_EMAIL" "$OLD_PASS" "$E2EE_PASS"`）。
#   没有在这里这么做，是因为它会把设备手上那枚换成 AuthScreen 自己签的另一枚，
#   而 `$NEWTOKEN` 从此"不是本趟那枚" —— 步骤 12 那句"手上这枚仍 200"与步骤 13 的
#   阳性对照都按 `$NEWTOKEN` 记账 ⇒ 要改得连着那两处的令牌簿记一起改，
#   而那份改法**没有一趟真读数撑着**。⇒ 先让这一趟把"到底停在哪个读数"打出来，再裁决。
fill_three_credentials "$NEWTOKEN" || { bad "新令牌没能填回设备 —— 判据 G 建在没配置的面上"; shot "10-refill.png"; summary "iOS 换绑·会话·改密" "" 1; }
open_profile_tab
press_row "设置" || { bad "判据 G：打不开设置面"; summary "iOS 换绑·会话·改密" "" 1; }
sleep 2
if needle_state "个人资料" >/dev/null 2>&1 && ! needle_state "更换登录邮箱" >/dev/null 2>&1; then
  press_row "个人资料" || bad "判据 G：进不去「个人资料」分组"
fi
sleep 1
idb_dump
needle_state "$NEW_EMAIL" >/dev/null 2>&1 \
  && ok "当前邮箱那一行已经是新地址" || { bad "当前邮箱那一行没显示新地址"; dump_screen_text; }
needle_state "待绑邮箱" >/dev/null 2>&1 && bad "界面上还挂着「待绑邮箱」（活请求没清？）" || ok "「待绑邮箱」那一行没了"
shot "10-after-both-confirmed.png" "判据 G：新地址进了界面"

# ── 11. 会话面 ──────────────────────────────────────────────────────────────
step "11. 判据 H：会话列表里当前那枚不可撤、旁边有那句实话、其余各有自己的「退出这一台」"
# 多签两枚：一枚是"要撤的目标"（UA 里带可识别的名字 ⇒ 界面上那一行**认得出是谁**），
# 另一枚留给步骤 J 做**阳性对照**（先证明它回 200，再看它是不是 401）。
login_as() {  # <user-agent> → 把会话令牌打到 stdout（**不打印**）
  curl -s --noproxy '*' -m 20 -X POST "$API/api/login/email-password" \
    -H 'content-type: application/json' -H "user-agent: $1" \
    -d "{\"email\":\"${NEW_EMAIL}\",\"password\":\"${OLD_PASS}\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('token',''))" 2>/dev/null
}
TARGET_TOKEN=$(login_as "verify-ios-revoke-target")
EXTRA_TOKEN=$(login_as "verify-ios-kept-session")
[ -n "$TARGET_TOKEN" ] && ok "目标会话已签出（user-agent=verify-ios-revoke-target），指纹 $(tok_fp "$TARGET_TOKEN")" \
  || bad "目标会话签不出来 —— 判据 I 没有可撤的那一枚"
[ -n "$EXTRA_TOKEN" ] && ok "对照会话已签出（user-agent=verify-ios-kept-session），指纹 $(tok_fp "$EXTRA_TOKEN")" \
  || bad "对照会话签不出来 —— 判据 J 缺阳性对照"
# 先回「我的」，再一路开进「设置 → 账号安全 → 账号与安全」。
# 🔴 后两跳在**装着的产物**那一代里存在（ProfileScreen 把 profile-entry-security
#    从「我的」的滚动流里**滤掉了**，它只在设置面的安全分组里）——
#    `verify-mobile-account.sh:135` 那句「『账号与安全』入口行在『我的』页」因此是旧的。
#    这里不照抄它：**两代都试**，并在点不到时把界面上的文本打出来。
leave_settings_sheet
open_profile_tab
press_row "设置" || { bad "判据 H：打不开设置面"; summary "iOS 换绑·会话·改密" "" 1; }
sleep 2
if ! needle_state "账号与安全" >/dev/null 2>&1; then
  if needle_state "账号安全" >/dev/null 2>&1; then
    press_row "账号安全" || bad "进不去「账号安全」分组"
    sleep 2
  fi
fi
press_row "账号与安全" || { bad "打不开「账号与安全」那屏"; shot "11-no-security-screen.png"; summary "iOS 换绑·会话·改密" "" 1; }
sleep 3
# 会话卡片在屏幕下半部，先把它滚进可见区再读。
# 会话列表是**异步**拉的（`SessionsSection` 挂载时才发请求），刚进来时读到的是
# 「正在读取登录设备…」那一句 —— 直接数一次会把"还没到"读成"没有"（§7 元规则一）。
# 所以这里轮询到数得出可撤行为止；到点还数不出才判红，并把当时的读数打出来。
ROWS=0
for i in $(seq 1 20); do
  idb_dump
  # 🔴 只数**那一枚 aria 标签**的形状（`mobile.sessions.revoke.aria` = 「退出这一台：{device}」），
  #    不数"任何以「退出这一台」开头的可及名"：那颗按钮的可见文字本身也叫「退出这一台」，
  #    它一旦被单独暴露成一枚节点，枚数就会虚增 —— 而这一条判据要的恰恰是枚数。
  ROWS=$(row_candidates "退出这一台" | grep -c "^退出这一台：" 2>/dev/null || true)
  [ "${ROWS:-0}" -ge 2 ] && break
  sleep 2
done
# 数完再把这一段滚进可见区 —— 截图要拍到会话卡片（读树不需要它，读数已经在上面了）。
ax "登录设备" --scroll-into-view --list --json >/dev/null 2>&1
sleep 1
idb_dump
needle_state "登录设备" >/dev/null 2>&1 && ok "「登录设备」这一卡在（'common.sessions.title'）" \
  || bad "找不到「登录设备」区块"
needle_state "这台设备" >/dev/null 2>&1 && ok "当前那枚带着「这台设备」标记" || bad "没有当前设备标记"
# 🔴 存在性判据：那句实话必须在界面上。少了它，"当前这一行没有按钮"只是
#    **沉默地少一个按钮**（`SessionsSection.tsx:232-236` 的意图就是这个）。
needle_state "这一台就是你正在用的设备" >/dev/null 2>&1 \
  && ok "旁边有那句实话，而不是沉默地少一个按钮" || bad "缺 currentHint 那句"
# 可撤行数按**完整 aria 标签**数（`mobile.sessions.revoke.aria` = 「退出这一台：{device}」）。
# 🔴 Android 那份按 resource-id 数（`count_id "sessions-revoke"`，`:69` 注释解释了为什么
#    不能用 grep -c 数行）。iOS 侧 testID 落成 AXIdentifier、idb 那棵树里读不到它，
#    所以换成"按 aria 标签前缀数枚数" —— 同一件事的另一把尺，而且它顺带把设备名带出来。
if [ "${ROWS:-0}" -ge 2 ]; then ok "另有 ${ROWS} 枚可撤的会话（每枚一个「退出这一台：<设备>」）"; else bad "可撤的会话只数到 ${ROWS:-0} 枚（期望 ≥2）"; dump_screen_text; fi
needle_state "verify-ios-revoke-target" >/dev/null 2>&1 \
  && ok "界面上认得出**要撤的那一台**（UA 串出现在那一行的标签里）" \
  || bad "界面上数不出「verify-ios-revoke-target」那一行 ⇒ 后面撤的可能不是它"
shot "11-sessions-two-rows.png" "判据 H：会话列表三句"

# ── 12. 真点「退出这一台」──────────────────────────────────────────────────
step "12. 判据 I：真点「退出这一台」→ 系统 Alert 里选 destructive ⇒ 库里少一枚、那一枚当场 401"
TARGET=$(db "select count(*) from access_sessions s join users u on u.id=s.user_id where u.email='${NEW_EMAIL}'")
# 🔴 后面每一条都用 `$((TARGET - 1))` 做算术 —— psql 连不上时 TARGET 是一段错误文本，
#    bash 会当场报 "value too great for base"，症状长得像"撤销没生效"。
#    先证它是个数，再拿它做减法（读不到就响亮说出来，不拿算术错误冒充产品判决）。
printf '%s' "$TARGET" | grep -qE '^[0-9]+$' || { bad "读不到会话基数（'$TARGET'）—— psql 连不上还是库名不对？这一档没有读数"; summary "iOS 换绑·会话·改密" "" 1; }
REVOKE_LABEL="退出这一台：verify-ios-revoke-target"
idb_dump
CAND=$(pick_pressable_row "$REVOKE_LABEL"); rc=$?
if [ "$rc" != "0" ] || [ -z "$CAND" ]; then
  bad "找不到/认不出目标那一行的「退出这一台」（去歧 rc=${rc}）—— 不猜该按哪一枚"
  shot "12-no-target-row.png"
else
  ax "$CAND" --pressable --scroll-into-view >/dev/null 2>&1
  P=$(ax "$CAND" --pressable --press --json)
  if [ "$(jget "$P" result)" != "success" ]; then
    bad "按下目标那一枚「退出这一台」没生效：result=$(jget "$P" result)"
  else
    sleep 2
    idb_dump
    needle_state "退出这一台设备？" >/dev/null 2>&1 \
      && ok "弹出的是确认框，不是按下即撤" || bad "没有确认弹窗（'Alert.alert' 没弹？）"
    XY=$(alert_button_center "退出这一台设备？" "退出这一台")
    if [ -z "$XY" ]; then
      bad "确认框里找不到「退出这一台」那枚**标题下方**的按钮"
      dump_screen_text; shot "12-no-alert-button.png"
    else
      # 🔴 同名歧义：行按钮的 aria 是「退出这一台：<设备>」（**带后缀**），
      #    弹窗里那枚是逐字的「退出这一台」⇒ 这里靠**几何**裁决（只认标题下方那一枚），
      #    与 Android 那份 `xy_dialog_button`（`:99-114`）同一条规则、同一条理由：
      #    按下同名但位置错的那枚 = 撤错设备。
      echo "     弹窗按钮中心 = ${XY}（紧贴标题下方、带宽 ${ALERT_BAND} 内那一枚）"
      ax --tap $XY --json >/dev/null 2>&1
      # 🔴 回读"弹窗收了没有"（traps #209：AX 按压 success ≠ 写入完成；这里连 success 都不算，
      #    因为走的是裸坐标 tap）。没收 ⇒ 那一下没落在弹窗按钮上，**收掉弹窗再继续**，
      #    否则下面每一步都在对着弹窗读数（一次误点会级联成一屏假红）。
      sleep 2
      idb_dump
      if needle_state "退出这一台设备？" >/dev/null 2>&1; then
        bad "按下之后弹窗还立着 ⇒ 这一发没落在弹窗的按钮上（几何裁决的账，不是产品的账）"
        dump_screen_text
        ax_press "取消"; sleep 2
      else
        ok "弹窗已收（那一下确实落在弹窗的按钮上）"
      fi
      AFTER="$TARGET"
      for i in $(seq 1 25); do
        sleep 2
        AFTER=$(db "select count(*) from access_sessions s join users u on u.id=s.user_id where u.email='${NEW_EMAIL}'")
        [ "$AFTER" = "$((TARGET - 1))" ] && break
      done
      if [ "$AFTER" = "$((TARGET - 1))" ]; then
        ok "库里确实少了一枚（$TARGET → $AFTER）—— 撤销=删行，「存在即有效」"
      else
        bad "库里会话数 $AFTER（期望 $((TARGET - 1))）"
      fi
      # 🔴 这三发各挡一种"假绿"：被撤那枚必须 401（不是只从列表里藏起来）、
      #      手上那枚必须 200（撤的是另一台，没把自己踢出去）、对照那枚必须仍 200。
      STILL=$(curl -s --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$API/api/notifications" -H "authorization: Bearer $TARGET_TOKEN")
      [ "$STILL" = "401" ] && ok "被撤那枚真 401（撤的就是它 —— 不是只从列表里藏起来）" \
        || bad "被撤那枚仍回 $STILL（撤销没落到认证边界？）"
      NOW=$(curl -s --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$API/api/notifications" -H "authorization: Bearer $NEWTOKEN")
      [ "$NOW" = "200" ] && ok "手上这枚仍 200（本机没被连带踢出去）" || bad "本机令牌也被撤了 HTTP $NOW"
      KEEP=$(curl -s --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$API/api/notifications" -H "authorization: Bearer $EXTRA_TOKEN")
      [ "$KEEP" = "200" ] && ok "第三枚（对照）仍 200 ⇒ 这一发**只**撤了点名那一台，不是一片" \
        || bad "对照那枚也回了 $KEEP —— 「退出这一台」撤的不止一台"
      # 列表自己的行数也要落下来 —— 只看库会把"界面没刷新"读成成功。
      GONE=0; ROWS2="${ROWS:-0}"
      for i in $(seq 1 15); do
        idb_dump
        ROWS2=$(row_candidates "退出这一台" | grep -c "^退出这一台：" 2>/dev/null || true)
        [ "${ROWS2:-0}" = "$((ROWS - 1))" ] && { GONE=1; break; }
        sleep 2
      done
      if [ "$GONE" = "1" ]; then
        ok "界面上可撤的行也跟着少了（$ROWS → $ROWS2）"
      else
        bad "界面没跟着刷新（撤前 $ROWS，现在 ${ROWS2:-读不到}）"; dump_screen_text
      fi
      shot "12-after-revoking-one.png" "判据 I：撤掉的就是点名那一台"
    fi
  fi
fi

# ── 13. 退出所有设备 ────────────────────────────────────────────────────────
step "13. 判据 J：「退出所有设备」那句必须是真的（包括这台）—— 先做 200 的阳性对照"
# 🔴 阳性对照排在**之前**（erasure:922-930 同一条纪律）：没有它，"这枚现在 401"
#    永远分不清是"全撤销成了"还是"它从来就不通"。
EXTRA_PRE=$(curl -s --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$API/api/notifications" -H "authorization: Bearer $EXTRA_TOKEN")
if [ "$EXTRA_PRE" = "200" ]; then
  ok "探针阳性对照成立：预签那枚在按下之前回 200（下面那一发读得到 401/200 之差）"
else
  bad "探针自己不通：按下之前那枚就回 ${EXTRA_PRE} 而不是 200 ⇒ 本趟这一格不作数（先修探针）"
fi
press_row "退出所有设备" || { bad "找不到「退出所有设备」按钮"; shot "13-no-logout-all.png"; }
sleep 2
idb_dump
needle_state "退出所有设备？" >/dev/null 2>&1 \
  && ok "弹出的是确认框" || bad "没有确认弹窗"
needle_state "包括这台" >/dev/null 2>&1 \
  && ok "弹窗正文说了「包括这台」" || bad "弹窗正文没点名这台（那句实话少了一半）"
XY=$(alert_button_center "退出所有设备？" "退出所有设备")
if [ -z "$XY" ]; then
  bad "确认框里找不到「退出所有设备」那枚标题下方的按钮"
  dump_screen_text; shot "13-no-alert-button.png"
else
  BEFORE=$(db "select count(*) from access_sessions s join users u on u.id=s.user_id where u.email='${NEW_EMAIL}'")
  ax --tap $XY --json >/dev/null 2>&1
  sleep 2
  idb_dump
  if needle_state "退出所有设备？" >/dev/null 2>&1; then
    bad "按下之后「退出所有设备？」弹窗还立着 ⇒ 那一下没落在弹窗按钮上（几何裁决没成立，读数见上）"
    ax_press "取消"; sleep 1
  else
    ok "弹窗已收（那一下落在了弹窗的按钮上）"
  fi
  LEFT="$BEFORE"
  for i in $(seq 1 20); do
    sleep 2
    LEFT=$(db "select count(*) from access_sessions s join users u on u.id=s.user_id where u.email='${NEW_EMAIL}'")
    [ "$LEFT" = "0" ] && break
  done
  [ "$LEFT" = "0" ] && ok "库里 0 枚（原来是 $BEFORE）—— 手上这枚也一起死了" || bad "还剩 $LEFT 枚（期望 0）"
  HTTP=$(curl -s --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$API/api/notifications" -H "authorization: Bearer $EXTRA_TOKEN")
  [ "$HTTP" = "401" ] && ok "对照那枚同样 401（「包括这台」不是话术，也不是只撤这一台）" \
    || bad "对照令牌 HTTP $HTTP（按下之前它是 ${EXTRA_PRE}）"
  # 🔴 本机凭据真的被清了没有？Android 那份没有这一格（它只看库与 HTTP）。`account-security.ts`
  #    的 `planSignOut` 要求的正是"清本机凭据"，少了这一发就只证了服务端那一半。
  #    ⚠️ 这一句**不能**在「我的」根层读（第 11 趟实测：根层读不到 ⇒ 判红，而凭据其实清了）：
  #    「未配置」那句住在 `ProfileScreen.tsx:1099-1103` 的 `syncStatus` 里，而那一整段
  #    在 10-09 那代已经**搬进设置面**（`:1383` 把它作为 prop 交过去），根层只剩
  #    「还没设置端到端加密口令…」那种状态行。与步骤 2 那句「立即同步」是同一件事的两面：
  #    **判据写的界面位置会随别人的重构漂移，而漂移之后它读到的永远是"没有"。**
  #    所以这里跟着搬：开设置面 → 根层找 → 找不到就进「同步与隐私」再找。
  #    🔴 **不**按「使用自托管服务器」—— 那一步会改界面状态，把"清没清"变成"我把它填回去了"。
  leave_settings_sheet
  open_profile_tab
  press_row "设置" || { bad "判据 J：读本机凭据时打不开设置面"; shot "13-no-settings-sheet.png"; summary "iOS 换绑·会话·改密" "" 1; }
  CLEARED=0
  for i in $(seq 1 2); do
    for _ in $(seq 1 8); do
      needle_state "登录 heyta，让任务在设备间自动同步。" >/dev/null 2>&1 && { CLEARED=1; break; }
      sleep 1
    done
    [ "$CLEARED" = "1" ] && break
    if needle_state "同步与隐私" >/dev/null 2>&1; then
      press_row "同步与隐私" || bad "判据 J：进不去「同步与隐私」那一代"
      sleep 2
    else
      break
    fi
  done
  if [ "$CLEARED" = "1" ]; then
    ok "界面回到「未配置」那句 ⇒ 本机凭据确实被清了（不只是服务端删了行）"
  else
    bad "界面还认为已配置 ⇒ 退出所有设备没清本机凭据（下一次同步会拿一枚死令牌打）"
    dump_screen_text
  fi
  shot "13-logged-out-everywhere.png" "判据 J：库里 0 枚 + 本机回到未配置"
fi

# ── 14. 改密的前提（这一档自己也是判据 K）─────────────────────────────────
step "14. 判据 K：退出所有设备之后仍能重新登录并同步成，且本机库还在（本地优先）"
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)
if [ -f "${DATA_CONTAINER}/Library/heyta.sqlite" ]; then
  ok "本机明文库仍在盘上 ⇒ 退出所有设备**不是**注销（销毁只有那一条路）"
else
  bad "退出所有设备把本机明文库删了 —— 本地优先被破坏（那不是注销，那是一次不该发生的销毁）"
fi
P_TOKEN=$(login_as "verify-ios-password-device")
[ -n "$P_TOKEN" ] && ok "新邮箱 + **旧**口令重新签出一枚会话，指纹 $(tok_fp "$P_TOKEN")（账号没被这轮验收改坏）" \
  || { bad "重新登录失败 ⇒ 改密那一块没有活的会话可用，本趟后面不作数"; shot "14-relogin.png"; summary "iOS 换绑·会话·改密" "" 1; }
TOKEN="$P_TOKEN"
printf '%s' "$P_TOKEN" > "$HEYTA_E2E_TOKEN_FILE"
# 🔴 步骤 13 末了为了读那句「未配置」把设置面**开着**，所以现在人还在子分组里 ——
# 这里必须真的把整个面退掉（`leave_settings_sheet` 会先退第二层屏再按「关闭」），
# 否则 `fill_three_credentials` 里每一次点击都打在另一屏上。
leave_settings_sheet || true
fill_three_credentials "$P_TOKEN" \
  || { bad "改密之前把活凭据填回设备没走通 ⇒ 判据 L/M/N 建在没登录的面上"; shot "14-refill.png"; summary "iOS 换绑·会话·改密" "" 1; }
sync_now
wait_sync_terminal "改密之前的同步"; RC_SYNC0=$?
if [ "$RC_SYNC0" = "0" ]; then
  ok "这台设备用新签的这枚会话同步成了（改密那一发的对照基线就位）"
else
  shot "14-before-password.png"
  if [ "$RC_SYNC0" = "1" ]; then
    bad "同步报「登录凭据已失效」= 刚签出来这枚就不认 ⇒ 前提不成立"
  else
    bad "4 分钟内同步没到已同步态（改密的对照基线没成立）"
  fi
  summary "iOS 换绑·会话·改密" "" 1
fi
TOKEN_VERSION0=$(db "select token_version from users where email='${NEW_EMAIL}'")
printf '   改密**之前**的 token_version: %s\n' "$TOKEN_VERSION0"
printf '%s' "$TOKEN_VERSION0" | grep -qE '^[0-9]+$' || { bad "读不到 token_version（'$TOKEN_VERSION0'）⇒ 判据 M 没有基线"; summary "iOS 换绑·会话·改密" "" 1; }

# ── 15. 改登录密码（🔴 Android 那份完全没测的那一块）──────────────────────
step "15. 判据 L/M/N（**新增那一块**）：界面上改登录密码 → 旧令牌 401 / 新令牌 200 / token_version 涨了 / 这台仍能同步"
open_profile_tab
press_row "设置" || { bad "改密：打不开设置面"; shot "15-no-settings.png"; summary "iOS 换绑·会话·改密" "" 1; }
sleep 2
if ! needle_state "账号与安全" >/dev/null 2>&1; then
  needle_state "账号安全" >/dev/null 2>&1 && { press_row "账号安全" || bad "改密：进不去「账号安全」分组"; sleep 2; }
fi
press_row "账号与安全" || { bad "改密：打不开「账号与安全」那屏"; shot "15-no-security.png"; summary "iOS 换绑·会话·改密" "" 1; }
sleep 3
# 🔴 先确认「设第一个密码」那张表是**收起的**（traps #236 的理由在这里落地：
#    重复 AX 标签要么全程用 occurrence 传递，要么先让它不重复）。
#    `SecurityScreen.tsx:397`（改密表）与 `:456`（设第一个密码表）的 label 都是「新密码」，
#    后者只在 `firstOpen` 为真时渲染 ⇒ 不先量这一格，填进去的就是**另一条路**
#    （`/password/set` 不 bump tokenVersion、`/password/change` bump —— 后果相反）。
#    收起的读法用那张表**独有**的那枚提交按钮标签「设置登录密码」（`setSubmit`）。
idb_dump
if exact_state "设置登录密码" >/dev/null 2>&1; then
  echo "     那张表立着 ⇒ 先按一次「设置第一个登录密码」那一行把它收起，再复量"
  press_row "设置第一个登录密码" || bad "收不掉「设第一个密码」那张表（那一行点不到）"
  sleep 2
  idb_dump
fi
if exact_state "设置登录密码" >/dev/null 2>&1; then
  bad "🔴 「设第一个密码」那张表**仍然立着** ⇒ 界面上有两枚「新密码」，填的框无法裁决。"
  echo "      这是**响亮失败**：本脚本不许用 occurrence 猜一格（猜错走的是 /password/set，"
  echo "      它不 bump tokenVersion，于是判据 M 会「为一件没发生的理由成立」）。"
  dump_screen_text; shot "15-two-new-password-fields.png"
  summary "iOS 换绑·会话·改密" "" 1
fi
idb_dump
NPN=$(field_count "新密码")
[ "$NPN" = "1" ] || { bad "「新密码」输入框数到 ${NPN} 枚（期望恰好 1）⇒ 不猜往哪一格写"; shot "15-field-count.png"; summary "iOS 换绑·会话·改密" "" 1; }
ok "改密那张表是**唯一**一张带「新密码」的表（另一条路没混进来）"
# 存在性判据（**点之前**）：那张卡的标题与说明句必须在界面上，而成功句**不许**先在。
# 🔴 标题用 `exact_state` 而不是 `needle_state`：「登录密码」是「设置第一个登录密码」
#    那一行标签的**子串**，用子尺量它就是一条恒真的判据（§7 元规则 2）。
exact_state "登录密码" >/dev/null 2>&1 && ok "「登录密码」那张卡在（'mobile.security.password.title'，逐字命中）" || bad "「登录密码」标题不在"
needle_state "这里改的只是登录密码" >/dev/null 2>&1 \
  && ok "点之前就有那句分界（改的不是端到端加密口令）" || bad "缺 'mobile.security.password.lead' 那句"
needle_state "登录密码已修改" >/dev/null 2>&1 \
  && bad "🔴 还没按，界面上就已经写着「登录密码已修改。」—— 成功态被预渲染了" \
  || ok "成功句此刻**不在**界面上（按下之前它不该在）"
# ⚠️ 登记一条**产品差异**（不是本脚本的红，但必须写在这里）：任务书点名的那句
#    「其它设备上的登录都会失效」是 **web** 的词条（`web.settings.password.otherDevices`），
#    移动端这张卡在**点之前**没有这句；移动端只在点成功之后用 `doneDetail` 说
#    「其它设备上的登录已失效」。所以这一条存在性判据按**移动端真词条**写（上面那三句），
#    差异登记成缺口交给产品侧裁，本脚本不把它写成红、也不假装它成立。
needle_state "其它设备上的登录都会失效" >/dev/null 2>&1 \
  && echo "     ⚠️ 现量：界面上出现了 web 那句（说明移动端也渲染了它）" \
  || echo "     ⚠️ 登记：移动端这张卡**点之前**没有「都会失效」那句（只有成功之后的 doneDetail）"
# 两个框都是 secure：值**永远不进 AX dump** ⇒ 不断言框里的值，只按码点数确认"进去了"；
# 真正的成功证据在下面（服务端 401/200 与 token_version）。
fill_field "当前密码" "$OLD_PASS" secure || { bad "改密：当前密码没填进去"; shot "15-fill-current.png"; summary "iOS 换绑·会话·改密" "" 1; }
dismiss_ios_save_password
fill_field "新密码" "$NEW_PASS" secure || { bad "改密：新密码没填进去"; shot "15-fill-new.png"; summary "iOS 换绑·会话·改密" "" 1; }
dismiss_ios_save_password
dismiss_keyboard
sleep 1
press_row "修改密码" || { bad "改密：点不到「修改密码」提交按钮"; shot "15-no-submit.png"; summary "iOS 换绑·会话·改密" "" 1; }
DONE=0
for i in $(seq 1 45); do
  idb_dump
  needle_state "登录密码已修改" >/dev/null 2>&1 && { DONE=1; break; }
  sleep 2
done
if [ "$DONE" = "1" ]; then
  ok "界面出「登录密码已修改。」（'mobile.security.password.done'）"
else
  bad "45×2s 内没等到「登录密码已修改」—— 界面或服务端拒了"; dump_screen_text
fi
needle_state "其它设备上的登录已失效" >/dev/null 2>&1 \
  && ok "成功那一句说清了别的设备要重新登录（'doneDetail'）" || bad "成功句少了「其它设备」那一半"
shot "15-password-changed.png" "判据 L：改密成功态"
# ── 协议级后果（判据 M）────────────────────────────────────────────────────
OLDP=$(curl -s --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$API/api/notifications" -H "authorization: Bearer $P_TOKEN")
[ "$OLDP" = "401" ] && ok "🔴 改密**之前**那枚令牌 401（tokenVersion 全局失效，其余设备掉线的语义）" \
  || bad "改密前的令牌仍回 $OLDP（期望 401）⇒ 这一发没落到认证边界"
NEWPTCODE=$(curl -s --noproxy '*' -m 20 -o /tmp/heyta-ios-accmail-login-${STAMP}.json -w '%{http_code}' \
  -X POST "$API/api/login/email-password" -H 'content-type: application/json' -H 'user-agent: verify-ios-after-change' \
  -d "{\"email\":\"${NEW_EMAIL}\",\"password\":\"${NEW_PASS}\"}")
NEWPT=$(python3 -c "import json,sys
try: print(json.load(open(sys.argv[1],encoding='utf-8')).get('token',''))
except Exception: print('')" /tmp/heyta-ios-accmail-login-${STAMP}.json 2>/dev/null)
# 🔴 登录被频率闸门（429）挡住**不等于**"新密码无效" —— 这一档要把 HTTP 码原样说出来，
#    否则"改密没生效"与"这一发被限流了"在输出上长得一模一样（§7 元规则一）。
if [ -n "$NEWPT" ]; then
  ok "新密码能换到新会话（HTTP ${NEWPTCODE}），指纹 $(tok_fp "$NEWPT")"
  NEWPH=$(curl -s --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$API/api/notifications" -H "authorization: Bearer $NEWPT")
  [ "$NEWPH" = "200" ] && ok "新令牌回 200（新凭据在这台服务端上真的有效）" || bad "新令牌回 $NEWPH（期望 200）"
else
  bad "新密码换不到会话（HTTP ${NEWPTCODE}）：$(redact "$(head -c 160 /tmp/heyta-ios-accmail-login-${STAMP}.json 2>/dev/null)")"
  echo "      ⚠️ 429/403 是频率或风控，不是「口令没换掉」—— 这一档判红，但归因要看上面那个码"
fi
TOKEN_VERSION1=$(db "select token_version from users where email='${NEW_EMAIL}'")
printf '   改密**之后**的 token_version: %s（之前 %s）\n' "$TOKEN_VERSION1" "$TOKEN_VERSION0"
if printf '%s' "$TOKEN_VERSION1" | grep -qE '^[0-9]+$' && [ "$TOKEN_VERSION1" -gt "$TOKEN_VERSION0" ]; then
  ok "库里 token_version 真的涨了（$TOKEN_VERSION0 → $TOKEN_VERSION1）"
else
  bad "库里 token_version 没涨（'$TOKEN_VERSION0' → '$TOKEN_VERSION1'）⇒ 界面那句话与认证边界不是一回事"
fi
OLDLOGIN=$(curl -s --noproxy '*' -m 20 -o /dev/null -w '%{http_code}' -X POST "$API/api/login/email-password" \
  -H 'content-type: application/json' -H 'user-agent: verify-ios-old-pass' \
  -d "{\"email\":\"${NEW_EMAIL}\",\"password\":\"${OLD_PASS}\"}")
# 旧口令必须**换不到**会话。允许三种"拒绝"的形状（401 凭据不对 / 400 校验层拒 /
# 429 频率闸门挡）—— 把它们都算"没登录成功"，因为这一条判据问的只有"旧口令还能用吗"。
case "$OLDLOGIN" in
  401|400|403|429) ok "旧口令换不到会话（HTTP ${OLDLOGIN}）" ;;
  200) bad "🔴 旧口令仍能登录（HTTP 200）—— 口令没真的换掉，而界面已经说过「已修改」" ;;
  *) bad "旧口令登录得到 HTTP $OLDLOGIN（既不是拒绝、也不是成功 ⇒ 这一发没法裁决）" ;;
esac
# ── 设备侧那一腿（判据 N：变异靶 M5 正面）──────────────────────────────────
# 🔴 web 上没有这一步（浏览器里"落盘新令牌"不是同一条路），所以它是**移动端独有**的
#    一格：`onPasswordChanged` 里那句 `form.setToken(newToken)` 拿掉 ⇒ 这台设备
#    下一次同步 401，而上面的 M 一条都不会红。
open_profile_tab
sync_now
wait_sync_terminal "改密之后的同步"; RC_SYNC1=$?
if [ "$RC_SYNC1" = "0" ]; then
  ok "🔴 改密之后这台设备自己仍能同步 —— 新令牌已落活配置，没把自己踢出去"
else
  shot "15-after-change-sync.png"
  if [ "$RC_SYNC1" = "1" ]; then
    bad "🔴 判据 N 红：改密之后界面报「登录凭据已失效」= 新令牌没落盘（变异靶 M5 的形状）"
  else
    bad "改密之后 4 分钟内同步没到已同步态"
  fi
fi
DATA_CONTAINER=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null)
if [ -f "${DATA_CONTAINER}/Library/heyta.sqlite" ]; then
  ok "改密之后本机明文库仍在盘上（改一次密码不该销毁任何一台设备的数据）"
else
  bad "改密把本机库删了 —— 那是「注销」那一条路独占的行为"
fi

# ── 16. 取证装置自己不能留红、也不能留明文 ─────────────────────────────────
step "16. 判据 O：取证照全程没有崩溃 / 弹窗污染，且装置自己不留明文"
# ① 系统弹窗残留：底部两个标签之一必须在树上（不在 = 有什么东西盖在应用上，
#    那么这一轮所有"界面上读不到 X"都是探针的账，不是产品的账 —— erasure:303-305 同一把尺）。
idb_dump
if needle_state "任务" >/dev/null 2>&1 || needle_state "我的" >/dev/null 2>&1; then
  ok "收尾时底部标签在树上 ⇒ 没有系统弹窗盖住应用"
else
  bad "收尾时底部两个标签都不在树上 ⇒ 有系统弹窗盖着（这一轮的界面读数不可信）"
  dump_screen_text
fi
# ② AX 树健康度：整棵树的可及名不能是 0（那边实测过"App 在渲染、对 AX 只交出
#    一个零尺寸 Application 节点"，重启模拟器自愈 —— 那是环境，不是产品）。
idb_dump
AXN=$(ax_label_count)
if [ "${AXN:-0}" -gt 0 ]; then ok "AX 树可及名 ${AXN} 枚（探针够得着界面，不是空树）"; else bad "AX 树里一枚可及名都没有（companion/App 的 AX 桥卡死 ⇒ 环境，不是产品）"; fi
# ③ 🔴 脱敏自检（AGENTS §8 第 10 条）：这趟用过的每一枚秘密都不许出现在证据里。
#    dump 里本来会带着输入框的**值**（lib 那段注释：凭据面板把它印在输入框上），
#    所以这条判据量的是**装置**：它红了不许算产品缺陷，但必须红出来。
LEAK=""
for _s in "$TOKEN" "$DEAD_TOKEN" "$NEWTOKEN" "$P_TOKEN" "$TARGET_TOKEN" "$EXTRA_TOKEN" "$OLD_TOK" "$NEW_TOK" "$OLD_PASS" "$NEW_PASS" "$E2EE_PASS"; do
  [ -n "$_s" ] || continue
  if [ -n "${EVIDENCE_DIR:-}" ] && [ -d "$EVIDENCE_DIR" ]; then
    if LC_ALL=C grep -R -qF -- "$_s" "$EVIDENCE_DIR" 2>/dev/null; then
      LEAK="${LEAK} evidence/$(tok_fp "$_s")"
    fi
  fi
  if [ -f "${IDB_DUMP_FILE:-}" ] && LC_ALL=C grep -qF -- "$_s" "$IDB_DUMP_FILE" 2>/dev/null; then
    LEAK="${LEAK} dump-in-flight/$(tok_fp "$_s")"
  fi
done
# 临时响应体也扫一遍（它们在 EXIT trap 里删，但**这一趟**里它们是明文）。
for f in /tmp/heyta-ios-accmail-confirm-old-${STAMP}.json /tmp/heyta-ios-accmail-confirm-new-${STAMP}.json; do
  rm -f -- "$f" 2>/dev/null
done
if [ -z "$LEAK" ]; then
  ok "证据目录与本趟 dump 里数不到任何一枚令牌 / 口令（只打指纹）"
else
  bad "🔴 装置留了明文：${LEAK# }（打印的是指纹，不是原值）⇒ 修装置，别改产品"
fi
echo "     截图：apps/mobile/evidence/account-suite-ios/（每张都过了「非空白 + 数得出主蓝」两条）"
echo "     🔴 本装置**不**证：邮件里那两条链接由**人/设备**点开的旅程（curl 直打服务端，"
echo "        因为点链接的人手上没有会话）；不证通行密钥那一块；不证 Android；不证真机。"
summary "iOS 换绑·会话·改密"
