#!/bin/bash
#
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
# 移动端「换绑邮箱 + 登录设备」验收（真模拟器 + 真服务端 + 真发信，零 mock）
# ========================================================================
#
# 🔴 为什么必须有这个脚本
#
# `EmailChangeSection.tsx` 与 `SessionsSection.tsx` 是本轮新挂上移动端的两个区块。
# jsdom（`apps/mobile/tests/account-security-copy.spec.ts`）与服务端集成套件
# （`server/tests/integration/email-change-and-sessions.integration.spec.ts`）各证了
# 自己那一层，而 **AGENTS §6.2 规定一**说得很清楚：界面「能用」的结论只能由截图支撑。
# 更要紧的是这两条路各自有一件**只在真机上才存在**的事：
#
#   · 换绑：界面上那句「还等谁点」必须来自服务端（组件里不许有本地阶段），而 RN 的
#     `SettingsScreen` 是 Modal，切走即整体卸载 —— 只有真机能把「切走再回来」做出来，
#     看那句实话是不是真的重新读回来的。
#   · 会话：撤哪一台是从**系统 Alert**（`Alert.alert`）里选出来的，jsdom 里没有这个东西。
#
# 前置（三条都不许含糊）：
#   ① `pnpm --filter @heyta/sync-server build`（步 0 会拿 401/404 当场否证旧 dist）；
#   ② 起栈时带 `PUBLIC_URL=<本机那枚>` —— 信里的链接要指回本轮这个服务端，
#      否则「那封信属于本次验收」这件事没法判（步 6 判它）；
#   ③ 端口走槽：`PORT=<空端口>`，别抢 :3000 上别人那台（它可能是旧 dist）。
#   本脚本读的服务端日志 = 起栈时 `HEYTA_E2E_LOGFILE` 指的那份。
#
# 脱敏（AGENTS §8 第 10 条）：一次性令牌、访问令牌、Ethereal 预览地址**一律不打印**。
# 需要「是不是同一枚」时用 SHA-256 前 10 位（`tok_fp`）—— 它在日志里不可还原。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

STAMP=$(date +%H%M%S)
OLD_EMAIL="acc-mail-${STAMP}@test.local"
NEW_EMAIL="acc-mail-new-${STAMP}@test.local"
OLD_PASS="OldPass123"
TOKEN=""
E2EE=$(cat /tmp/heyta_mobile_e2ee.txt 2>/dev/null || echo "e2ee-passphrase")
SERVER_LOG="${HEYTA_E2E_LOGFILE:-/tmp/heyta-e2e-server.log}"
DB_NAME="${HEYTA_E2E_DB:-heyta_account_w9}"
# 信里的链接必须以它开头；没给就红，不猜。
PUBLIC_BASE="${PUBLIC_URL:-}"
EVIDENCE_DIR="$HEYTA_REPO_ROOT/apps/mobile/evidence/account-email-sessions"
API="$HOST_SERVER"

# ── 取证工具（都只打印脱敏后的东西）────────────────────────────────
tok_fp() { printf '%s' "$1" | python3 -c 'import sys,hashlib;print(hashlib.sha256(sys.stdin.read().encode()).hexdigest()[:10])'; }
db() { psql -h 127.0.0.1 -p 5432 -U "$(whoami)" -d "$DB_NAME" -tAc "$1" 2>&1; }
# 🔴 `grep -c` 数的是**行**，而 uiautomator 的 dump 是**一整行** ——
#    拿它数节点条数恒等于 1，"两行会话"和"一行会话"读起来一模一样。数出现次数用 `count_id`。
count_id() { grep -o "resource-id=\"$1\"" "$UI_XML" 2>/dev/null | wc -l | tr -d ' '; }
shot() { mkdir -p "$EVIDENCE_DIR"; $ADB exec-out screencap -p > "$EVIDENCE_DIR/$1" 2>/dev/null; echo "     📷 apps/mobile/evidence/account-email-sessions/$1"; }

# 按 resource-id 拿坐标（RN 的 testID 落成 resource-id，**不带包名前缀**）。
# 🔴 只认中心点在标签栏之上（<2100）且高度为正的节点 —— ScrollView 折叠线以下的节点
#    仍在无障碍树里但 bounds 是负的，按它的「中心」点下去点的是别的东西（lib 同族）。
xy_id() {
  UI_XML="$UI_XML" ID="$1" python3 - <<'PY'
import os, re
try:
    s = open(os.environ['UI_XML'], errors='ignore').read()
except OSError:
    raise SystemExit(0)
for m in re.finditer(r'resource-id="%s"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' % re.escape(os.environ['ID']), s):
    x1, y1, x2, y2 = (int(g) for g in m.groups())
    if y2 > y1 and (y1 + y2) // 2 < 2100:
        print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
}
# 滚到某个 resource-id 可见（滚 8 次还没有就返回空 ⇒ 调用方判红，不当成「没有」）。
scroll_to_id() {
  local n=0 xy=""
  while [ "$n" -lt 8 ]; do
    dump
    xy=$(xy_id "$1")
    [ -n "$xy" ] && { printf '%s' "$xy"; return 0; }
    $ADB shell input swipe 500 1600 500 700 300; n=$((n + 1)); sleep 1
  done
  return 1
}
# 系统 Alert 里的按钮：列表行上同名按钮**同时在树里**（Alert 是另一个窗口），
# 所以必须按几何取 —— 只认标题**下方**那一枚。按下同名但位置错的那枚 = 撤错设备。
xy_dialog_button() { # <弹窗标题> <按钮文本>
  UI_XML="$UI_XML" TITLE="$1" BTN="$2" python3 - <<'PY'
import os, re
s = open(os.environ['UI_XML'], errors='ignore').read()
t = re.search(r'text="%s"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' % re.escape(os.environ['TITLE']), s)
if not t:
    raise SystemExit(0)
ty = int(t.group(2))
for m in re.finditer(r'text="%s"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' % re.escape(os.environ['BTN']), s):
    x1, y1, x2, y2 = (int(g) for g in m.groups())
    if y1 > ty and y2 > y1:
        print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
}
# 从服务端日志的 Ethereal 预览里取那封信里的**整条链接**。
# 🔴 预览页内嵌正文时做了两层转义（`\u002f` 与 `&amp;`），不归一化就取不出链接
#    —— 症状是「信里明明有 token，脚本说没有」（`verify-email-password-chain.mjs` 同族）。
# 打的是**两行**：第一行令牌、第二行整条链接。链接要用来判「它指向本轮那个服务端」，
# 只看令牌会把「信是给生产的」这件事读成通过。
preview_link() { # <preview URL> → "token<TAB>link"（调用方只放进变量，不进日志）
  python3 - "$1" <<'PY'
import re, sys, urllib.request
try:
    raw = urllib.request.urlopen(sys.argv[1], timeout=30).read().decode('utf-8', 'replace')
except Exception:
    print('\t'); raise SystemExit(0)
msg = raw.replace('\\u002f', '/').replace('\\/', '/').replace('&amp;', '&')
m = re.search(r'(https?://[^"\'\s]*/change-email\?token=([0-9a-f]{16,}))', msg)
print(f"{m.group(2)}\n{m.group(1)}" if m else '\n')
PY
}

echo ""
echo "=== 移动端「换绑邮箱 + 登录设备」（真模拟器 + 真服务端 + 真发信，零 mock）==="
echo "  设备: $E2E_SERIAL   服务端: $API   库: $DB_NAME   日志: $SERVER_LOG"
echo "  账号: $OLD_EMAIL → $NEW_EMAIL"

step "0. 前置：防撞、日志可读、这台服务端上有本线的路由"
[ -n "$PUBLIC_BASE" ] || { echo "❌ PUBLIC_URL 没给 —— 无法判「信里的链接属于本轮服务端」。起栈时带上它。"; exit 1; }
OUT=$(another_mobile_e2e_running)
if [ -n "$OUT" ]; then echo "❌ 有别的移动端验收正在跑，先等它结束："; echo "$OUT"; exit 1; fi
[ -r "$SERVER_LOG" ] || { echo "❌ 读不到服务端日志 $SERVER_LOG —— 那两封信取不回来，步 6/7 会恒红"; exit 1; }
for p in account/email/change/status auth/sessions; do
  C=$(curl -s --noproxy '*' -m 5 -o /dev/null -w '%{http_code}' "$API/api/$p")
  # 🔴 期望 401，不是 404：404 意味着这台服务端**没有本线的路由**（跑的是旧 dist），
  #    那时整轮结论都不可信 —— 这正是 AGENTS §7 第 27/82 条的形状。
  [ "$C" = "401" ] || { echo "❌ $API/api/$p 回 $C（期望 401）。404 = 这台跑的不是当前源码：先 pnpm --filter @heyta/sync-server build 再起栈"; exit 1; }
done
ok "两条路由都在，未登录各回 401"

step "1. 装包并启动"
[ -f "$APK" ] || { echo "❌ 读不到 $APK"; exit 1; }
$ADB shell am force-stop $PKG >/dev/null 2>&1
$ADB uninstall $PKG >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
in_foreground() { $ADB shell dumpsys activity activities 2>/dev/null | tr -d '\r' | grep -q "topResumedActivity=.*$PKG"; }
# 🔴 上限按**时间**给，不按"试三次、每次 sleep 6"给：`pm clear` 之后的第一次启动要走
#    release bundle 的初始化，实测这一台模拟器上会超过 18 秒（旧写法那三道 6 秒的窗口
#    在第一趟就把一个**其实起来了**的应用判成"三次启动都没到前台" —— 那是探针太窄，
#    不是产品坏了；AGENTS §7 元规则第 1 条：先怀疑探针）。当日第二趟实测读数：
#    负载 497 时用了 **27 秒**才到前台 ⇒ 窗口按 120 秒给，且每 20 秒补一次启动动作。
LAUNCHED=0
$ADB shell am force-stop com.google.android.googlequicksearchbox >/dev/null 2>&1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
for i in $(seq 1 40); do
  sleep 3
  if in_foreground; then LAUNCHED=1; echo "   到前台用了 $((i * 3)) 秒"; break; fi
  if [ $(( (i - 1) % 7 )) = 0 ] && [ "$i" != 1 ]; then
    $ADB shell am force-stop com.google.android.googlequicksearchbox >/dev/null 2>&1
    $ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  fi
done
[ "$LAUNCHED" = "1" ] || { bad "120 秒内没到前台（模拟器状态或宿主机负载？）"; summary "移动端换绑与会话" "" 1; }
# 🔴 隐私同意面板走**库里的** `handle_privacy_consent`，不在本脚本里抄一份：
#    它会复验"点了还在就再点一次"，也会把"面板在但取不到按钮"和"没有面板"分开报。
#    这一族按钮的可辨识名在 content-desc，不在 text（lib 同段注释）。
# 🔴 候选**只给「同意并联网」**：这条旅程后面每一步都要真发请求，
#    把「只用本机」当兜底候选会把离线态钉进这一轮，之后所有"信发出去了"的判据都成了假绿。
handle_privacy_consent "同意并联网" || bad "隐私同意面板没收下"
dismiss_welcome_if_present
dump
[ "$(has_text "任务")" = "1" ] && ok "应用已启动" || { bad "应用没起来"; screen_txt; }

step "2. 建已知密码的测试账号，把凭据填进 app"
RESP=$(curl -s --noproxy '*' -m 20 -X POST "$API/api/test/create-user" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${OLD_EMAIL}\",\"password\":\"${OLD_PASS}\"}")
TOKEN=$(printf '%s' "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
[ -n "$TOKEN" ] || { echo "❌ create-user 没走通（响应里没有 token）"; exit 1; }
ok "账号已建，会话令牌指纹 $(tok_fp "$TOKEN")"
configure_sync_credentials

step "3. 判据：设置面的「个人资料」里有「更换登录邮箱」这块"
$ADB shell input tap 945 2253; sleep 3
XY=$(scroll_to_id "profile-entry-settings"); [ -z "$XY" ] && XY=$(xy_text "设置")
[ -n "$XY" ] && { $ADB shell input tap $XY; sleep 3; }
if [ -z "$(scroll_to_id "email-change-current-row")" ]; then
  bad "设置面里找不到「更换登录邮箱」区块"; screen_txt
else
  dump
  [ "$(has_sub "更换登录邮箱")" = "1" ] && ok "区块标题在" || bad "区块标题没渲染"
  [ "$(has_sub "这次更换需要你在新旧两个邮箱里各点一次")" = "1" ] && ok "说明句在：两边都点完才生效" || bad "说明句缺失"
  # 🔴 存在性判据：当前邮箱那一行的**值**必须就是登录邮箱。空串会被读成
  #    「这个账号的邮箱是空的」，而那件事在本系统里不存在。
  grep -qF -- "$OLD_EMAIL" "$UI_XML" && ok "当前邮箱那一行显示的是登录邮箱" || bad "当前邮箱那一行没显示登录邮箱"
  shot "01-email-change-section.png"
fi

step "4. 真点「发起更换」：填新邮箱 → 提交 → 界面进入等待态"
LOG_BEFORE=$(wc -l < "$SERVER_LOG")
XY=$(scroll_to_id "email-change-new-input")
if [ -z "$XY" ]; then
  bad "找不到新邮箱输入框"; screen_txt
else
  $ADB shell input tap $XY; sleep 1.2
  clear_and_type "$NEW_EMAIL" "新邮箱地址"
  disable_ime; sleep 1.5
  dump
  [ "$(has_text "$NEW_EMAIL")" = "1" ] && ok "新地址已进输入框" || bad "新地址没填进去"
  XY=$(scroll_to_id "email-change-submit")
  if [ -z "$XY" ]; then
    bad "找不到「发起更换」按钮"; screen_txt
  else
    $ADB shell input tap $XY
    SENT=0
    for i in $(seq 1 30); do
      dump
      [ "$(has_sub "两封信已经发出")" = "1" ] && { SENT=1; break; }
      sleep 2
    done
    if [ "$SENT" = "1" ]; then
      ok "成功文案是「两封信已经发出」—— 不是「已更换」（生效还没发生）"
    else
      bad "30×2s 内没看到「两封信已经发出」"; screen_txt
    fi
    # 🔴 本轮最该钉住的一条：成功文案之后，「还等哪一边」只能来自服务端那一次读。
    dump
    [ "$(has_sub "还在等两个邮箱各点一次")" = "1" ] && ok "阶段句来自服务端：等两边各点一次" || bad "没画出「等两边」那句"
    [ "$(has_sub "待绑邮箱")" = "1" ] && ok "「待绑邮箱」那一行在" || bad "没有待绑邮箱行"
    shot "02-awaiting-both.png"
  fi
fi

step "5. 服务端读数：那张活请求只存哈希，两侧互不相同"
ROW=$(db "select r.old_confirmed_at is null, r.new_confirmed_at is null, length(r.old_token)>=40, r.old_token<>r.new_token, r.pending_email from email_change_requests r join users u on u.id=r.user_id where u.email='${OLD_EMAIL}'")
printf '   读数（旧未点|新未点|是哈希|两侧不同|待绑地址）: %s\n' "$ROW"
case "$ROW" in
  't|t|t|t|'"$NEW_EMAIL") ok "活请求成立：两边都没点、存的是哈希、旧新两侧不同、待绑就是那个新地址" ;;
  *) bad "活请求形状不对：$ROW" ;;
esac

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
  bad "没拿到两封信的 preview（没网？还是发信本身就失败了？）"
else
  ok "旧邮箱那封 + 新邮箱那封都在（preview 地址本身不带入日志）"
fi

step "7. 判据：链接属于本轮服务端，GET 它是**确认页**而且不烧令牌"
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
  #    后面那两次 POST 打的仍是本轮服务端，于是「信里的链接能用」这件事**从没被验过**。
  case "$OLD_LINK" in "$PUBLIC_BASE"*) ok "旧那封的链接以本轮 PUBLIC_URL 开头" ;; *) bad "旧那封的链接不指向本轮服务端：${OLD_LINK%%\?*}" ;; esac
  case "$NEW_LINK" in "$PUBLIC_BASE"*) ok "新那封的链接同样" ;; *) bad "新那封的链接不指向本轮服务端：${NEW_LINK%%\?*}" ;; esac
  PAGE=$(curl -s --noproxy '*' -m 15 "$OLD_LINK")
  if printf '%s' "$PAGE" | grep -q 'data-token='; then
    ok "GET 回的是确认页（带着令牌，不是「已失效」页）"
  else
    bad "GET 没拿到确认页"; printf '   页面头 120 字: %s\n' "$(printf '%s' "$PAGE" | head -c 120)"
  fi
  STILL=$(db "select old_confirmed_at is null from email_change_requests r join users u on u.id=r.user_id where u.email='${OLD_EMAIL}'")
  [ "$STILL" = "t" ] && ok "🔴 GET 之后旧侧仍未确认 —— 邮件预取器烧不掉一次性令牌" || bad "GET 把令牌消费了（预取器会毁掉这条路）"
fi

step "8. 只点旧那半：界面上那句实话必须改口成「等新邮箱那一边」"
CODE=$(curl -s --noproxy '*' -m 20 -o /tmp/acc-confirm-old.json -w '%{http_code}' -X POST "$API/api/account/email/change/confirm" \
  -H 'content-type: application/json' -d "{\"token\":\"${OLD_TOK}\"}")
if [ "$CODE" = "200" ]; then
  ok "旧侧确认 HTTP 200（**不带会话**也能点 —— 点链接的人手上没有会话）"
else
  bad "旧侧确认 HTTP $CODE：$(head -c 200 /tmp/acc-confirm-old.json)"
fi
# 切走再回来：Modal 卸载重挂 ⇒ 组件只能重新读服务端（本地压根没有「阶段」可留）。
$ADB shell input keyevent KEYCODE_BACK; sleep 2
$ADB shell input tap 945 2253; sleep 3
XY=$(scroll_to_id "profile-entry-settings"); [ -n "$XY" ] && { $ADB shell input tap $XY; sleep 3; }
STAGE=0
for i in $(seq 1 20); do
  dump
  [ "$(has_sub "还在等新邮箱这一边")" = "1" ] && { STAGE=1; break; }
  sleep 2
done
if [ "$STAGE" = "1" ]; then
  ok "重新挂载后那句实话来自服务端：等新邮箱那一边"
else
  bad "切走再回来没读出「等新邮箱」"; screen_txt
fi
[ "$(has_sub "当前邮箱那一边已经确认")" = "1" ] && ok "句子说清了哪一边已经点过" || bad "阶段句没写清哪一边已确认"
shot "03-awaiting-new.png"

step "9. 点新那半：换绑生效、库里地址改了、换绑前那枚令牌全局失效"
CODE=$(curl -s --noproxy '*' -m 20 -o /tmp/acc-confirm-new.json -w '%{http_code}' -X POST "$API/api/account/email/change/confirm" \
  -H 'content-type: application/json' -d "{\"token\":\"${NEW_TOK}\"}")
[ "$CODE" = "200" ] && ok "新侧确认 HTTP 200" || bad "新侧确认 HTTP $CODE：$(head -c 200 /tmp/acc-confirm-new.json)"
EMAIL_NOW=$(db "select email from users where email in ('${NEW_EMAIL}','${OLD_EMAIL}')")
[ "$EMAIL_NOW" = "$NEW_EMAIL" ] && ok "库里邮箱已经是新地址" || bad "库里邮箱还是 $EMAIL_NOW"
LEFT_REQ=$(db "select count(*) from email_change_requests r join users u on u.id=r.user_id where u.email in ('${NEW_EMAIL}','${OLD_EMAIL}')")
[ "$LEFT_REQ" = "0" ] && ok "生效即删 —— 那张活请求没有留下" || bad "还留着 $LEFT_REQ 张活请求"
OLDHTTP=$(curl -s --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$API/api/notifications" -H "authorization: Bearer $TOKEN")
[ "$OLDHTTP" = "401" ] && ok "换绑前那枚旧令牌 401（tokenVersion 递增 —— ADR-0063 §2.2：JWT 的 payload 里就带着邮箱）" || bad "旧令牌 HTTP $OLDHTTP（期望 401）"

step "10. 界面上的当前邮箱必须变成新地址（这才是「改成功了」的真界面证据）"
NEWTOKEN=$(curl -s --noproxy '*' -m 20 -X POST "$API/api/login/email-password" \
  -H 'content-type: application/json' -H 'user-agent: verify-current-device' \
  -d "{\"email\":\"${NEW_EMAIL}\",\"password\":\"${OLD_PASS}\"}" \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
[ -n "$NEWTOKEN" ] && ok "新邮箱能换新会话（旧口令照用 —— 换绑不动凭据）" || bad "新邮箱登录失败"
TOKEN="$NEWTOKEN"
$ADB shell input keyevent KEYCODE_BACK; sleep 1
configure_sync_credentials
$ADB shell input tap 945 2253; sleep 3
XY=$(scroll_to_id "profile-entry-settings"); [ -n "$XY" ] && { $ADB shell input tap $XY; sleep 3; }
scroll_to_id "email-change-current-row" >/dev/null; sleep 1
dump
grep -qF -- "$NEW_EMAIL" "$UI_XML" && ok "当前邮箱那一行已经是新地址" || bad "当前邮箱那一行没显示新地址"
[ "$(has_sub "待绑邮箱")" = "1" ] && bad "界面上还挂着「待绑邮箱」（活请求没清？）" || ok "「待绑邮箱」那一行没了"
shot "04-after-both-confirmed.png"

step "11. 会话面：再造一枚会话，列表里当前那枚不可撤、其余各有自己的「退出这一台」"
TOKEN3=$(curl -s --noproxy '*' -m 20 -X POST "$API/api/login/email-password" \
  -H 'content-type: application/json' -H 'user-agent: verify-third-device' \
  -d "{\"email\":\"${NEW_EMAIL}\",\"password\":\"${OLD_PASS}\"}" \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
[ -n "$TOKEN3" ] && ok "第三枚会话已签出（user-agent=verify-third-device）" || bad "第三枚没签出来"
$ADB shell input keyevent KEYCODE_BACK; sleep 1
$ADB shell input tap 945 2253; sleep 2
XY=$(scroll_to_text "账号与安全"); [ -n "$XY" ] && { $ADB shell input tap $XY; sleep 3; }
if [ -z "$(scroll_to_id "sessions-list")" ]; then
  bad "找不到「登录设备」列表"; screen_txt
  ROWS=0
else
  dump
  ROWS=$(count_id "sessions-revoke")
  [ "$(has_sub "这台设备")" = "1" ] && ok "当前那枚带着「这台设备」标记" || bad "没有当前设备标记"
  [ "$(has_sub "这一台就是你正在用的设备")" = "1" ] && ok "旁边有那句实话，而不是沉默地少一个按钮" || bad "缺 currentHint"
  if [ "$ROWS" -ge 2 ]; then ok "另有 $ROWS 枚可撤的会话"; else bad "可撤的会话只有 $ROWS 枚（期望 ≥2）"; fi
  shot "05-sessions-two-rows.png"
fi

step "12. 真点「退出这一台」：系统 Alert 里选 destructive ⇒ 库里少一枚、那一枚当场 401"
TARGET=$(db "select count(*) from access_sessions s join users u on u.id=s.user_id where u.email='${NEW_EMAIL}'")
REVOKE_XY=$(scroll_to_id "sessions-revoke")
if [ -z "$REVOKE_XY" ]; then
  bad "找不到「退出这一台」按钮"
else
  $ADB shell input tap $REVOKE_XY; sleep 2
  dump
  [ "$(has_sub "退出这一台设备？")" = "1" ] && ok "弹出的是确认框，不是按下即撤" || bad "没有确认弹窗"
  XY=$(xy_dialog_button "退出这一台设备？" "退出这一台")
  if [ -z "$XY" ]; then
    bad "确认框里找不到「退出这一台」那枚按钮"; screen_txt
  else
    $ADB shell input tap $XY
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
    STILL3=$(curl -s --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$API/api/notifications" -H "authorization: Bearer $TOKEN3")
    [ "$STILL3" = "401" ] && ok "被撤那枚真 401（不是只从列表里藏起来）" || bad "被撤那枚仍回 $STILL3（撤销没落到认证边界？）"
    NOW=$(curl -s --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$API/api/notifications" -H "authorization: Bearer $NEWTOKEN")
    [ "$NOW" = "200" ] && ok "手上这枚仍 200（撤的是另一台，没把自己踢出去）" || bad "本机令牌也被撤了 HTTP $NOW"
    # 列表自己的行数也要落下来 —— 只看库会把「界面没刷新」读成成功。
    GONE=0
    for i in $(seq 1 15); do
      dump
      ROWS2=$(count_id "sessions-revoke")
      [ "${ROWS2:-0}" = "$((ROWS - 1))" ] && { GONE=1; break; }
      sleep 2
    done
    if [ "$GONE" = "1" ]; then
      ok "界面上可撤的行也跟着少了（$ROWS → $ROWS2）"
    else
      bad "界面没跟着刷新（撤前 $ROWS，现在 ${ROWS2:-读不到}）"; screen_txt
    fi
    shot "06-after-revoking-one.png"
  fi
fi

step "13. 「退出所有设备」那句必须是真的（包括这台）"
XY=$(scroll_to_id "sessions-logout-all")
if [ -z "$XY" ]; then
  bad "找不到「退出所有设备」按钮"; screen_txt
else
  BEFORE=$(db "select count(*) from access_sessions s join users u on u.id=s.user_id where u.email='${NEW_EMAIL}'")
  $ADB shell input tap $XY; sleep 2
  XY=$(xy_dialog_button "退出所有设备？" "退出所有设备")
  [ -n "$XY" ] && $ADB shell input tap $XY
  LEFT="$BEFORE"
  for i in $(seq 1 20); do
    sleep 2
    LEFT=$(db "select count(*) from access_sessions s join users u on u.id=s.user_id where u.email='${NEW_EMAIL}'")
    [ "$LEFT" = "0" ] && break
  done
  [ "$LEFT" = "0" ] && ok "库里 0 枚（原来是 $BEFORE）—— 手上这枚也一起死了" || bad "还剩 $LEFT 枚（期望 0）"
  HTTP=$(curl -s --noproxy '*' -m 10 -o /dev/null -w '%{http_code}' "$API/api/notifications" -H "authorization: Bearer $NEWTOKEN")
  [ "$HTTP" = "401" ] && ok "本机那枚同样 401（「包括这台」不是话术）" || bad "本机令牌 HTTP $HTTP"
  shot "07-logged-out-everywhere.png"
fi

step "14. 取证过程本身不能留红：ANR / 弹窗污染"
CRASH=$(cat "${UI_XML}.dump-err" 2>/dev/null | grep -ci 'ANR\|not responding' || true)
[ "${CRASH:-0}" = "0" ] && ok "取证照全程没有 ANR 痕迹" || bad "dump 归因里出现过 ANR / not responding（读数不可信）"

summary "移动端换绑与会话"
