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
# 回收站的跨设备**真机**验收（真模拟器 + 真服务端 + 真笔记本设备，零 mock）
# ========================================================================
#
# 🔴 为什么必须有这个脚本（roadmap:537 自认的那条洞）
#
# 回收站承诺的第三件事在界面上**看不见**：「在回收站里」这个事实本身跨设备。
# 手机上回收站有那条便签，笔记本上有没有，取决于 `deletedAt` 那条 DEL op
# 有没有走完 op-log → 向量时钟 → E2EE → 服务端 → 另一台设备的物化。
# 单元测试证明不了这一路，而它坏的时候**不报错** —— 症状是"另一台设备的
# 回收站是空的"，听起来像"对端还没同步"。
#
# 更具体的一条：本轮之前 `apps/node-host` 的 `trash` 命令**只列任务**。
# 也就是说"笔记本的回收站里有没有这条清单"在那台设备上**根本没有读通道** ——
# 而缺读通道和真的没收到，在输出上长得一模一样（§7 元规则一：先怀疑探针）。
# W6-a/W6-b 把四路合并搬进 `@heyta/domain` 并让 CLI 用上之后，下面第 7 步
# 这两条判据才第一次**存在**（不是"第一次通过"）。
#
# ═════════════════════════════════════════════════════════════════════════
# 六条判据，每条都把"点了"与"生效了"分开证
#
#   ① 手机删便签 → **服务端日志出现该账号的请求行**（快腿，证自动同步触发）
#   ② 手机回收站**列出**那条便签，点恢复后那一行消失、便签回到活体列表
#   ③ 手机点「恢复」→ 笔记本 `notes` **读得到它活着**（跨设备的还原）
#   ④ 手机删清单 → 笔记本的回收站**也**列出它（"在回收站"这件事本身跨设备）
#   ⑤ 全程不点任何同步按钮 —— 且**脚本自己检查自己**不含那一下点击（第 0.5 步）
#   ⑥ 手机删标签 → 点一下**只出确认行、一条 op 都不写**，取消也不写，
#      点「确认删除」才恰好写 1 条 `TAG/DEL`（W4b；第 6b 步）
#
# 🔴 ⑥ 为什么归进这个脚本而不是另起一条：标签**不进回收站**（§7.1 P-1），
#    它是这一族删除里唯一"删了没地方捞"的那一类，判据必须能失败在**那一下点击**上；
#    而这条链的载体（真模拟器 + 真库 + 能数 op 的通道）与上面五条完全重合。
#
# ⚠️ ⑥ 只证到"问句出现在设备上 + 两步各自写不写 op"。**没证**那句影响面的**数字**
#    （"它挂在 N 条任务上"）—— 那要先给一条任务挂上标签，属于标签归属的验收而不是这一档。
#    数字那一半钉在 `apps/web/tests/projects-panel.spec.tsx` 的渲染结果上。
#
# ⚠️ ② 用便签、④ 用清单：**一类只测一端等于没测**。四路合并里漏一路的症状
#    不是报错，而是"这一类能还原却根本不出现在列表里"。
#
# ⚠️ 所有手机侧动作跑完**才**开始笔记本侧的轮询：两边的等待形状不同
#    （笔记本首次同步含纯 JS Argon2id 派生，实测 30–300 秒），交错进行会让
#    手机上"点下去的那一下"与对端读数互相错位。
#
# 用法：
#   bash scripts/verify-mobile-trash.sh
#   PORT=3100 bash scripts/verify-mobile-trash.sh   # 换端口起栈时（:3000 常是别人的旧进程）
#
# 前置：模拟器在跑、Postgres 在 5432、服务端在该端口（**TEST_MODE**）。
#       账号每轮新建并写入 /tmp/heyta_mobile_{token,email,e2ee}.txt。

set -u
export PATH="/opt/homebrew/bin:$PATH"

# ── 先准备账号，再加载共享库（顺序不能反，理由见 verify-mobile-conflict.sh）──
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
heyta_e2e_ensure_account || exit 1
. "$(dirname "$0")/lib/mobile-e2e.sh"
. "$(dirname "$0")/lib/wait-for-quiet-host.sh"
. "$(dirname "$0")/lib/apk-freshness.sh"

# 🔴 负载门 + "这台设备有没有别人在用"必须放在**任何破坏性动作之前**：
#    下面的 `install -r` / `pm clear` 都会把别人的现场清掉，两边报的红会互相冒充。
BUSY=$(another_mobile_e2e_running)
if [ -n "$BUSY" ]; then
  echo "❌ 这台设备上还有别的移动端验收在跑：$BUSY"
  echo "   两边都会 pm clear + 装包 + 按坐标点击，并行 = 互相清掉对方的现场，"
  echo "   报出来的满屏「找不到按钮」不是产品缺陷。等它跑完再跑这一条。"
  exit 3
fi
step "负载门"
wait_for_quiet_host || exit 3

SERVER_LOG="${HEYTA_SERVER_LOG:-/tmp/heyta-e2e-server.log}"
LAPTOP_ROUNDS="${HEYTA_TRASH_LAPTOP_ROUNDS:-180}"   # 每轮 5 秒
TAB_WAIT=3

# 独立库：与其它验收各用一份，否则会互相看到对方的回收站条目。
LAPTOP_DB=/tmp/heyta-trash-laptop.sqlite
PHONE_DB=/tmp/heyta-trash-phone.sqlite
EVIDENCE="$HEYTA_REPO_ROOT/apps/mobile/evidence"
mkdir -p "$EVIDENCE"

# 🔴 标题必须 ASCII：`adb shell input text` 发不了非 ASCII（实测抛异常却可能退 0）。
NOTE_A="trash-e2e-note-$(date +%H%M%S)"
LIST_L="trash-e2e-list-$(date +%H%M%S)"

echo ""
echo "=== 回收站跨设备真机验收（零 mock）==="
echo "  设备: $E2E_SERIAL   服务端: $SERVER   库: heyta_mobile_smoke"
echo "  账号: $EMAIL"
echo "  便签: $NOTE_A"
echo "  清单: $LIST_L"
echo "  🔴 本轮**不会**点击任何同步按钮 —— 这是本验收的一半意义"

if [ "${#TOKEN}" -lt 100 ]; then
  echo "❌ 令牌看起来不对（长度 ${#TOKEN}）—— 先跑建号脚本"; exit 1
fi

# 🔴 服务端可达性前置（23:4x 补，形状照 `verify-mobile-due-time.sh:350`）。
#    本脚本原来**没有**这一道，而另外四枚 rig 都有 —— 后果不是"少一句报错"：
#    服务端没起时，第 4 步那 120 秒会一条 `Upload|Download` 都数不到，
#    于是它按自己的措辞报 **"自动同步没有触发"** —— 一条**产品缺陷形状**的红，
#    实际是环境没起。设备窗口 30–45 分钟才开一次，这一道在 2 秒内把它挡住，
#    并且**退 3**（环境无效 ≠ 产品失败），看守那条按 3 继续等窗口、不记成失败。
HEALTH=$(curl -s --noproxy '*' -m 5 "${HOST_SERVER}/health" 2>/dev/null)
if ! printf '%s' "$HEALTH" | grep -q '"status":"ok"'; then
  echo "❌ 服务端没在 ${HOST_SERVER}（/health 返回：${HEALTH:-空}）—— 环境未就绪，**不是产品失败**"
  echo "   起栈：bash scripts/mobile-e2e-up.sh（端口用 PORT=… 传，本脚本跟着 ${E2E_PORT}）"
  echo "   ⚠️ 别把这一条记成「自动同步没触发」：那条判据要的是服务端在跑，这里先替它把门。"
  exit 3
fi
echo "   服务端就绪：${HOST_SERVER}"

if [ ! -f "$SERVER_LOG" ]; then
  echo "❌ 判据 ① 的证据来源不存在：$SERVER_LOG —— **这一条不许跳过，它不是六条里的一条，它是承重的**："
  echo "   第 0.5 步那条元判据（脚本自己数自己有没有点同步按钮）挡不住"手点出来的同步"，"
  echo "   那一档由 ① 兜（见上面第 237 行的注释）。没有 ①，⑤ 就退化成一句字符串自检，"
  echo "   整个验收的一半意义（"不点按钮也自己出去"）就没人了。"
  echo "   而且现在退出**还没碰任何破坏性动作**（装包 / pm clear 在下一步），不会清掉别人的现场。"
  echo ""
  echo "   修法：把服务端起在 TEST_MODE 并把日志落到那个路径，例如"
  echo "     <起栈命令> 2>&1 | tee $SERVER_LOG"
  echo "   或显式指一份现有日志："
  echo "     HEYTA_SERVER_LOG=/path/to/server.log bash scripts/verify-mobile-trash.sh"
  exit 1
fi
rm -f "$LAPTOP_DB" "$PHONE_DB"

# ── 辅助 ────────────────────────────────────────────────────

phone_db_pull_trash() {
  $ADB root >/dev/null 2>&1; sleep 2
  $ADB pull /data/data/com.heyta/databases/heyta.sqlite "$PHONE_DB" >/dev/null 2>&1
  $ADB unroot >/dev/null 2>&1
}

# 某实体某类 op 的条数。**读数拿不到不当作 0**：空串原样返回，调用方判
# "不是数字"并 `bad()` —— 否则"库没拉下来"会被读成"一条都没写"（AGENTS §7 元规则二）。
entity_op_count() {  # <entityType> <opType>
  sqlite3 "$PHONE_DB" \
    "SELECT COUNT(*) FROM ops
      WHERE json_extract(data,'\$.op.entityType')='$1'
        AND json_extract(data,'\$.op.opType')='$2';" 2>/dev/null | tr -d ' '
}

latest_payload() {  # <entityType> <opType>
  sqlite3 "$PHONE_DB" \
    "SELECT json_extract(data,'\$.op.payload') FROM ops
      WHERE json_extract(data,'\$.op.entityType')='$1'
        AND json_extract(data,'\$.op.opType')='$2'
      ORDER BY json_extract(data,'\$.seq') DESC LIMIT 1;" 2>/dev/null
}

# 🔴 找一个标签控件的坐标，**四个方向都要试**（先不滚 → 往下滚 → 往上滚）。
#    22:31 那次真跑第 5 步红在"找不到「回收站」入口"，我第一反应是"标签落在 text 不在
#    content-desc"（共享动作行 `Settings.tsx:527-536` 只有 `accessibilityRole="button"`
#    没有 `accessibilityLabel`）—— **这个假设被现量否证了**：把那枚 dump 逐节点拆开数，
#    96 枚节点里 11 枚 clickable 全是**当时可见**的控件，「回收站」「导出数据」
#    「注销账号」三个名字**两种载具一个都没有**，而「我的」在（tab 栏）。
#    ⇒ 真的原因是那些入口行**在折叠线以上、根本没进无障碍树**：第 2 步为了够到
#    「清单名称」输入框已经把页面**往下滚**了，之后 120 秒只等服务端日志、不碰界面，
#    所以入口在上方。现成的 `scroll_to_desc` / `scroll_to_text` **只会往下滚**
#    （swipe 1900→1100 = 内容上移 = 露出下面的行），够不到上面的东西。
#    ⚠️ 这也说明"滚动方向"是这一族探针的**第三个维度**（前两个：载具 desc/text、
#    裁掉与否）—— 三个都得试，只补其一照样假红。
xy_either() {  # <标签> → 坐标（找不到回空）
  local xy label=$1
  xy=$(xy_desc "$label")
  [ -z "$xy" ] && xy=$(xy_text_sane "$label")
  [ -z "$xy" ] && xy=$(scroll_to_desc "$label")        # 往下滚找（desc）
  [ -z "$xy" ] && xy=$(scroll_to_text "$label")        # 往下滚找（text）
  if [ -z "$xy" ] && scroll_up_until_text "$label" 6; then
    xy=$(xy_text_sane "$label")                        # 往上滚把它露出来之后再取
    [ -z "$xy" ] && xy=$(xy_desc "$label")
  fi
  printf '%s' "$xy"
}

go_profile() {
  local xy; xy=$(xy_either "我的")
  if [ -z "$xy" ]; then bad "找不到底部标签「我的」（desc 与 text 两种载具都没命中）"; screen_txt; return 1; fi
  $ADB shell input tap $xy; sleep $TAB_WAIT; return 0
}

open_trash() {
  local xy; xy=$(xy_either "回收站")
  if [ -z "$xy" ]; then bad "找不到「回收站」入口（mobile.trash.entry；desc 与 text 两种载具都没命中）"; screen_txt; return 1; fi
  $ADB shell input tap $xy; sleep $TAB_WAIT; return 0
}

back_from_trash() {
  local xy; xy=$(xy_either "返回")
  if [ -z "$xy" ]; then bad "回收站屏上没有「返回」（mobile.growth.back；两种载具都没命中）"; screen_txt; return 1; fi
  $ADB shell input tap $xy; sleep $TAB_WAIT; return 0
}

# 笔记本侧的三态轮询（0 读到 / 1 没读到 / 2 **探针自己坏了**）——
# 形状照搬 `wait_laptop_has`：把 1 和 2 合并报，上一轮曾让一次 `$NODE`
# 解析事故整场跑偏到"同步协议有问题"上去。
#
# 与 `wait_laptop_has` 的唯一区别是读通道：那条写死了 `laptop list --all`（任务），
# 这里要读四路回收站与便签列表，所以把"取数的子命令"参数化。
wait_laptop_json() {  # <kind（空=不判 kind）> <标题> <laptop 子命令...>
  local want_kind=$1 title=$2; shift 2
  local i out synced=0
  for i in $(seq 1 "$LAPTOP_ROUNDS"); do
    [ "$i" -gt 1 ] && sleep 5
    out=$(laptop_raw sync)
    # "跑起来了"不等于"全绿"：undecryptable-ops 是一次真的执行了的同步。
    if printf '%s' "$out" | grep -qE '"ok":true|undecryptable-ops'; then synced=$((synced + 1)); fi
    laptop "$@" > /tmp/heyta-trash-laptop.json 2>/dev/null
    if python3 -c "
import json, sys
want_kind, title = sys.argv[1], sys.argv[2]
try:
    d = json.load(open('/tmp/heyta-trash-laptop.json', encoding='utf-8'))
except Exception:
    raise SystemExit(1)
rows = d.get('rows', []) if want_kind else d.get('notes', [])
if want_kind:
    hit = any(r.get('kind') == want_kind and title in str(r.get('title', '')) for r in rows)
else:
    hit = any(title in str(r.get('content', '')) for r in rows)
sys.exit(0 if hit else 1)
" "$want_kind" "$title" 2>/dev/null; then
      printf '%s' "$i"; return 0
    fi
  done
  if [ "$synced" = "0" ]; then return 2; fi
  return 1
}

step "0. 装包并启动（全新初态）"
# 🔴 装包之前当场判新鲜度（§7 第 27 条）。这条判据此前**只住在** `verify-mobile-window-gate.sh`
#    的第 4 步 —— 也就是说"忘了先跑闸门"的人照样会装旧 bundle 并拿到一串全绿，
#    那道防线等于只存在于"人记得先量一次"。判据要生效就得住在**被约束的那一步**上。
#    拒装发生在任何设备侧写动作（install / pm clear / force-stop）之前。
heyta_apk_freshness_guard "$APK" "verify-mobile-trash" || {
  bad "装包被拒（见上面那两行时间戳与扫描根）"
  exit 1
}
if $ADB logcat -c -b crash >/dev/null 2>&1; then
  echo "   crash 缓冲区已清空（崩溃归因只认本趟）"
else
  echo "   ⚠️ crash 缓冲区清不掉 —— 下面若报崩溃，可能是上一趟的残留"
fi
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
if ! settle_foreground; then bad "应用起不到前台（6 次拉起后 mCurrentFocus 仍不是 ${PKG}）"; screen_txt; exit 1; fi
dismiss_welcome_if_present
if ! settle_foreground; then bad "点掉欢迎页之后应用不在前台"; screen_txt; exit 1; fi
heyta_e2e_assert_client_budget || bad "账号 client 数已逼近向量时钟上限（后续断言不可信）"

on_main=0
for i in 1 2 3 4 5; do
  dump
  [ "$(has_text "我的")" = "1" ] && { on_main=1; break; }
  dismiss_permission_dialog
  dismiss_welcome_if_present
  sleep 2
done
if [ "$on_main" != "1" ]; then
  bad "进了前台但没落到主界面（5 轮之后底部标签「我的」仍不在树上）"; screen_txt; exit 1
fi
ok "应用已启动并停在主界面"

step "0.5. 元判据：这个脚本自己数得出"从没调用同步"这件事"
# 🔴 判据成立的前提写成会被自己检查的形式，而不是写在注释里。
#    加了那一下点击，整条验收就退化成"按钮还能用"（那件事早有人测），
#    而"自动同步 + 回收站跨设备"这一条再也测不到 —— 且退化那一版**照样全绿**。
#
# ⚠️ 锚点为什么是"行首的调用"而不是全文搜词：全文搜会命中**这一行自己**
#    与解释它的注释，那条判据就永远为假（比永远为真更难查）。
#    行首锚点也挡不住有人写成 `X=1 phone_sync` —— 那一档由判据 ① 兜：
#    真点了同步，服务端日志就不再证明"自动"，只是这一步会先红。
SYNC_CALLS=$(grep -cE '^[[:space:]]*(phone_sync|tap_sync|heyta_sync_now)\b' "$0" || true)
if [ "${SYNC_CALLS:-0}" != "0" ]; then
  grep -nE '^[[:space:]]*(phone_sync|tap_sync|heyta_sync_now)\b' "$0" | sed 's/^/     /'
  bad "脚本里有 ${SYNC_CALLS} 处对同步的调用 —— 本验收的全部意义被上面那几行抵消"
else
  ok "脚本自身确认：行首没有任何同步调用（$(basename "$0") 里数为 0）"
fi

step "1. 配置同步凭据（只填表单，**不点同步**），并记服务端日志基线"
require_screen
configure_sync_credentials
dismiss_permission_dialog
LOG_BASE=0
[ -f "$SERVER_LOG" ] && LOG_BASE=$(wc -l < "$SERVER_LOG" | tr -d ' ')

# 🔴 行载具探针（2026-10-04 21:46 那趟假红的正解，也是 #55 的取证装置）。
#    界面上"这一行在不在"有两种可证形状：
#      · 按钮的 `content-desc`（产品自己给的无障碍名，如「删除清单「X」」「恢复：X」）
#      · 行名的 `text` 节点
#    21:46 的真实现量到 **desc 在而 text 不在**（整行 `bounds` 高 3 = 被 ScrollView 裁掉）
#    ⇒ 只拿 `text` 判存在，会把"存在但被裁掉"读成"没建出来"（那趟就是这么红的）。
#    但反过来只拿 `desc` 判也不对：回收站那一行的具名形状**本轮还没在设备上量过**，
#    拿没量过的形状当唯一判据 = 赌下一趟窗口。
#    ⇒ 存在性：两种任一命中即成立，并把**命中的那一种**交给调用方；
#      配对的"消失"判据必须复用同一个载体 —— 否则"没了"可能只是"这种载体本来就不存在"，
#      那是一条永远为真的判据（AGENTS §7 元规则二：一条永远通过的判据比没有判据更糟）。
row_carrier() {  # <desc needle> <行名 text> → stdout: desc|text；两者都没有则返回 1
  if [ "$(has_desc_sub "$1")" = "1" ]; then printf 'desc'; return 0; fi
  if [ "$(has_text "$2")" = "1" ]; then printf 'text'; return 0; fi
  return 1
}
# 用**上一步刚证明存在的那个载具**判"还在不在"。
# stdout：0=还在 / 1=确实没了 / 2=上一步没拿到载具（这一档无从判起，调用方必须响亮处理）
_row_there() {  # <载具 desc|text> <desc 中缀> <行名 text>
  if [ -z "$1" ]; then printf '2'; return 0; fi
  case "$1" in
    desc) if [ "$(has_desc_sub "$2")" = "1" ]; then printf '0'; else printf '1'; fi ;;
    text) if [ "$(has_text "$3")" = "1" ]; then printf '0'; else printf '1'; fi ;;
    *) printf '2' ;;
  esac
}
# 三个"命中的载具"各自记一份（`set -u` 下必须先声明，未命中时下游要能区分"没命中"和"没跑"）
NOTE_CAR=""
LIST_CAR=""
TRASH_NOTE_CAR=""

step "2. 建一条便签与一条清单（两类各一个载体）"
go_profile || exit 1
XY=$(scroll_to_desc "写点什么…")
if [ -z "$XY" ]; then bad "找不到便签输入框（滚动到便签段也没找到）"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 1.2
clear_and_type "$NOTE_A" "写点什么…"
XY=$(scroll_to_desc "添加便签")
if [ -z "$XY" ]; then bad "找不到「添加便签」按钮"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
dump
# 存在性按两种载具**任一**命中即成立，并把命中的那种记进 `NOTE_CAR`
# —— 第 3 步那句"消失了"要用同一个载具判，否则那条判据可能永远为真。
if ! NOTE_CAR=$(row_carrier "删除便签「${NOTE_A}」" "$NOTE_A"); then
  blame_crash "点「添加便签」" || bad "便签没出现在列表里（按钮无障碍名与行名 text 两种载具都没命中）"
  screen_txt; exit 1
fi
ok "便签已建出：${NOTE_A}（载具=${NOTE_CAR}）"

XY=$(scroll_to_desc "清单名称")
if [ -z "$XY" ]; then bad "找不到清单名称输入框（滚动到清单段也没找到）"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 1.2
clear_and_type "$LIST_L" "清单名称"
XY=$(scroll_to_desc "新建清单")
if [ -z "$XY" ]; then bad "找不到「新建清单」按钮"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
dump
# 🔴 两条判据分开写，因为它们的**失效原因不同**（21:46 那趟假红的教训记在 lib 的 helper 注释里）：
#   存在性 = 那一行的按钮无障碍名在树里（「删除清单「X」」是产品自己给的标签，不是探针起的名）
#   可见性 = 把内容往上滚回来之后，行名的 `text` 节点出现
# 原来只有第二条的一半（不滚就断言 `has_text`），于是"建出来了但在折叠线上面"被读成"没建出来"。
if [ "$(has_desc_sub "「${LIST_L}」")" != "1" ]; then
  blame_crash "点「新建清单」" || bad "清单没建出来（整行不在 AX 树里，四个按钮名一个都没出现）"
  screen_txt; exit 1
fi
# 存在性这一档走的是 desc，而 21:46 实测过 desc **在被裁形状下仍然在树里**
# ⇒ 把载具固定成 desc，第 6 步的"消失了"就复用它（不许换一把尺去判"没了"）。
LIST_CAR="desc"
# ⚠️ 这一档**只报不判**：21:46 那趟的现场量到"行存在、但行名没有 text 节点、整行 bounds 高 3"，
#    而"往上滚就能看见"这件事**没验成** —— 21:57:47 别人往这台模拟器重装了 APK（`am_kill … installPackageLI`），
#    我那五下滚动量到的是**被清过数据的新实例**，不构成证据。所以这里打印读数、不改判据强度，
#    真正的可见性/无障碍那一档挂在计划 §10.83 的未决项上，等一趟干净的跑再定。
if ! scroll_up_until_text "$LIST_L" 4; then
  echo "   ⚠️ 行名 text 节点没滚出来（存在性已按按钮无障碍名成立）⇒ 界面可见性这一档未定，见计划 §10.83"
fi
ok "清单已建出：${LIST_L}（判据=那一行四个按钮的无障碍名在树里；可见性只报不判）"

step "3. 手机上删便签：先证「点了」，再证「生效了」"
XY=$(scroll_to_desc "删除便签「${NOTE_A}」")
if [ -z "$XY" ]; then
  bad "便签行上没有删除入口（找不到无障碍名「删除便签「${NOTE_A}」」）"; screen_txt; exit 1
fi
$ADB shell input tap $XY; sleep 3
dump
# 🔴 用第 2 步**刚证明存在的那个载具**判"消失了"（见 `row_still_there`）。
#    原来这里用 `has_text`，而"行名 text 本来就不在树里"（21:46 实测过那种形状）
#    会让这条判据**无条件为真** —— 删没删成功都报"消失了"，是假绿不是假红。
THERE=$(_row_there "$NOTE_CAR" "删除便签「${NOTE_A}」" "$NOTE_A")
if [ "$THERE" = "2" ]; then
  bad "上一档没拿到行载具 ⇒ 「消失了」这一档无从判起（探针问题，不是产品缺陷）"; screen_txt; exit 1
elif [ "$THERE" = "0" ]; then
  bad "点了删除，便签却还在活体列表里（未生效；载具=${NOTE_CAR}）"; screen_txt
else
  ok "点了删除并且生效：便签从活体列表消失（按载具 $NOTE_CAR 复判）"
fi
phone_db_pull_trash
DEL_N=$(entity_op_count NOTE DEL)
if ! printf '%s' "$DEL_N" | grep -qE '^[0-9]+$'; then
  bad "读不到手机库的 NOTE/DEL 计数（库没拉下来？）：$PHONE_DB"; exit 1
elif [ "$DEL_N" -ge 1 ]; then
  ok "删除走的是 op-log（本地库有 $DEL_N 条 NOTE/DEL，不是直接改物化状态）"
else
  bad "界面上消失了，本地库却一条 NOTE/DEL 都没有 —— 绕开了唯一写入口（AGENTS §3.4）"
  screen_txt
fi

step "4. 判据 ①：没点按钮，服务端也该收到请求（自动同步真的触发了）"
# 这一条是**最快**能证伪"自动同步没接线"的判据，所以放在笔记本那几条慢判据之前：
# 只数真正的同步请求行，不数 wc -l（日志里混着大量 prisma:query）。
#
# 🔴 原来这里写的是 `if [ "$LOG_BASE" -gt 0 ]`，那是一个**会静默消失的判据**，而且
#    恰好在最该跑的时候消失：自己新起的栈，日志是刚从 `tee` 出来的空文件，
#    基线 = 0 ⇒ 整条腿被跳过，而 ⑤ 的那一档正是靠它兜的。
#    现在基线为 0 是**合法输入**（从头数整个文件），只有"读出来不是数字"才当探针坏了。
case "$LOG_BASE" in
  ''|*[!0-9]*)
    bad "判据 ① 的日志基线不是数字（LOG_BASE=${LOG_BASE}）—— 探针没读到，不许当成「没请求」"
    LOG_BASE=0
    ;;
esac
SAW_REQUEST=0
for i in $(seq 1 24); do
  sleep 5
  NEW_REQ=$(sed -n "$((LOG_BASE + 1)),\$p" "$SERVER_LOG" \
    | grep -cE "\[user:[0-9]+\] (Upload|Download)" | tr -d ' ')
  if [ "${NEW_REQ:-0}" -gt 0 ]; then
    SAW_REQUEST=1
    echo "     第 $i 轮（约 $((i * 5)) 秒）看到 $NEW_REQ 条同步请求行"
    break
  fi
done
sed -n "$((LOG_BASE + 1)),\$p" "$SERVER_LOG" \
  | grep -E "\[user:[0-9]+\)?\]? (Upload|Download)" | head -5 | sed 's/^/     /'
if [ "$SAW_REQUEST" = "1" ]; then
  ok "服务端在**没有点任何同步按钮**的情况下收到了请求"
else
  bad "删便签后 120 秒内服务端**一条请求都没有** —— 自动同步没有触发"
fi

step "5. 判据 ②：手机回收站列出它，点「恢复」后那一行消失、便签回到活体列表"
open_trash || exit 1
dump
# 回收站那一行的具名形状**本轮第一次在设备上量**（以前一步都没走到过这里）⇒ 两种载具任一
# 命中都算"列出"，并把命中的那种留给下面"那一行消失了"复判；两种都没有才是真没列出。
TRASH_NOTE_CAR=$(row_carrier "恢复：${NOTE_A}" "$NOTE_A") || TRASH_NOTE_CAR=""
if [ -n "$TRASH_NOTE_CAR" ]; then
  ok "回收站里有那条便签（载具=${TRASH_NOTE_CAR}）"
else
  bad "回收站里看不到刚删的便签（恢复按钮无障碍名与行名 text 两种载具都没命中）"; screen_txt
fi
$ADB exec-out screencap -p > "$EVIDENCE/android-trash-1-phone-note.png" 2>/dev/null

XY=$(xy_either "恢复：${NOTE_A}")
if [ -z "$XY" ]; then
  bad "回收站那一行上没有「恢复：${NOTE_A}」（可访问名来自 mobile.trash.restoreA11y）"
  screen_txt; exit 1
fi
$ADB shell input tap $XY; sleep 3
dump
THERE=$(_row_there "$TRASH_NOTE_CAR" "恢复：${NOTE_A}" "$NOTE_A")
if [ "$THERE" = "2" ]; then
  bad "上面那档没回收站载具 ⇒ 「那一行消失了」无从判起（探针问题）"; screen_txt; exit 1
elif [ "$THERE" = "0" ]; then
  bad "点了恢复，那一行却还留在回收站里（未生效；载具=${TRASH_NOTE_CAR}）"; screen_txt
else
  ok "点了恢复并且生效：那一行从回收站消失（按载具 $TRASH_NOTE_CAR 复判）"
fi
$ADB exec-out screencap -p > "$EVIDENCE/android-trash-2-phone-restored.png" 2>/dev/null

back_from_trash || exit 1
# 🔴 presence 这一档**必须先滚再 dump** —— 上面那段注释里的"第三个维度（滚动方向）"在这里也成立。
#    现量（10-05 02:3x，两趟连报同一个红）：`back_from_trash` 之后「我的」回到顶部，
#    红那一刻的 `screen_txt` 只有 账号/状态/设置/通知/账号与安全/成长/习惯/倒数纪念日/回收站
#    —— 便签/清单/标签那三段**整段不在树里**。只 dump 会把"探针够不着"读成
#    "还原把这条便签弄丢了"，而同一条链里 `NOTE/UPD = 1` 与载荷 `[deletedAt]=null` 两条同趟都绿。
#    `xy_either` 四种方向都试（不滚 → 往下滚 desc → 往下滚 text → 往上滚），它滚完留下的
#    那一次 dump 就是命中位置的树，随后再 dump 一次同一位置给 `row_carrier` 判载具。
xy_either "删除便签「${NOTE_A}」" >/dev/null || true
xy_either "$NOTE_A" >/dev/null || true
dump
if RET_CAR=$(row_carrier "删除便签「${NOTE_A}」" "$NOTE_A"); then
  ok "便签回到了活体列表（还原不是只把行藏起来；载具=${RET_CAR}）"
else
  bad "回收站里没了，而**滚动四个方向后**活体列表里仍没有 —— 还原把这条便签弄丢了"
  screen_txt
fi

phone_db_pull_trash
UPD_N=$(entity_op_count NOTE UPD)
if ! printf '%s' "$UPD_N" | grep -qE '^[0-9]+$'; then
  bad "读不到手机库的 NOTE/UPD 计数"
elif [ "$UPD_N" = "1" ]; then
  ok "还原恰好写了 1 条 NOTE/UPD（多写 = 重复派发 / fan-out）"
else
  bad "NOTE/UPD = ${UPD_N}（期望 1）—— 还原的 op 形状不对"
fi
# 载荷判**键集合等于 [deletedAt] 且值为 null**：写 `undefined` 会被 JSON 丢掉，
# 对端既不清除也不设置 —— 那是一种"本机好了、别的设备永远回不来"的坏法。
printf '%s' "$(latest_payload NOTE UPD)" > /tmp/heyta-trash-restore-payload.json
python3 - <<'PY' > /tmp/heyta-trash-restore-verdict.txt 2>&1
import json
raw = open('/tmp/heyta-trash-restore-payload.json', encoding='utf-8').read().strip()
if not raw:
    print('读数拿不到（载荷为空）—— 不能当"没问题"'); raise SystemExit(3)
d = json.loads(raw)
if sorted(d.keys()) != ['deletedAt']:
    print(f'载荷键集合是 {sorted(d.keys())}，只许 [deletedAt]'); raise SystemExit(2)
if d['deletedAt'] is not None:
    print(f'deletedAt 不是 null（实际 {d["deletedAt"]!r}）—— 墓碑没被清'); raise SystemExit(2)
print('键集合 = [deletedAt]，值为 null')
PY
REST_RC=$?
if [ "$REST_RC" = "0" ]; then
  ok "还原那条 UPD 的载荷判过（$(cat /tmp/heyta-trash-restore-verdict.txt)）"
else
  bad "还原载荷不合格（rc=${REST_RC}）：$(cat /tmp/heyta-trash-restore-verdict.txt)"
fi

step "6. 判据 ④ 的手机侧：删一条清单，回收站里也要列出它"
go_profile || exit 1
# 🔴 与第 3 步同一条形状：先 `scroll_to_desc` 把那一行**滚进可见区**再拿坐标。
#    第 10 趟（03:3x）这里用的是 `xy_either`（不滚），而清单行在「我的」那页的折叠线以下 ——
#    节点照样在无障碍树里，但按那个"中心点"点下去什么都不会发生：
#    读数是一条真红（`点了删除，清单却还在活体列表里`）加两条它带出来的下游红。
#    §7 那条"desc-sane/text-sane 的负高度守卫"讲的是同一件事的**读**侧，这里是**点**侧。
#
# 🔴 第 11 趟（03:5x）改完上面那半之后红在下一格，现量把**另一半**照出来了：
#    `scroll_to_desc` 只会**往下**滚（`lib/mobile-e2e.sh:661` 那一发 `swipe 540 1900 540 1100`，
#    循环 5 次同一个方向 —— 我上一轮写的"滚过四个方向"是**句假话**，函数没这个能力），
#    而清单那一行排在**输入框上面**（`OrganizerList` 的行在 `清单名称` 之前），
#    从第 5 步的回收站回来到这一屏时它已经在视口**上沿之外**
#    ⇒ 往下滚五档只会离它越来越远。当时树里读到的形状：`bounds="[879,213][994,2]"`（bottom<top）。
#    03:59 手工复现（跑完之后同一台设备，只读+滚动）：往上滚到页顶、再往下滚三档，
#    那一行**画得好好的** —— `trash-e2e-list-035…` + 四个图标（移入文件夹/重命名/归档/红色垃圾桶），
#    四个按钮的 bounds 变成 `[879,691][994,806]`（115×115，正常触控目标）。
#    ⇒ **不是产品缺陷**（第 55 号那个"清单行是不是 a11y 缺陷"的疑问在这里被否证了一半：
#    行会画、按钮有 sane bounds；剩下的"行名有没有独立 text 节点"仍按 #55 记着）。
#    修法是**先把这一屏推到顶**，再让只会往下走的 `scroll_to_desc` 从顶开始找。
for _ in 1 2 3 4 5; do $ADB shell input swipe 540 700 540 1800 300; sleep 1; done
XY=$(scroll_to_desc "删除清单「${LIST_L}」")
if [ -z "$XY" ]; then
  bad "清单行上没有删除入口（已先把「我的」推到页顶，再往下滚 5 档仍找不到「删除清单「${LIST_L}」」）"; screen_txt; exit 1
fi
$ADB shell input tap $XY; sleep 3
echo "   （点的是 desc=「删除清单行」的 sane 中心点：${XY}）"
dump
# 同第 3 步：消失必须用**建出来那一档证明过的载具**（LIST_CAR 在那里被钉成 desc，
# 而 21:46 实测 desc 在被裁形状下仍在树里 ⇒ 它归零才真的等于"行没了"）。
THERE=$(_row_there "$LIST_CAR" "「${LIST_L}」" "$LIST_L")
if [ "$THERE" = "2" ]; then
  bad "清单那档没拿到载具 ⇒ 「消失了」无从判起（探针问题）"; screen_txt; exit 1
elif [ "$THERE" = "0" ]; then
  bad "点了删除，清单却还在活体列表里（未生效；载具=${LIST_CAR}）"; screen_txt
else
  ok "点了删除并且生效：清单从活体列表消失（按载具 $LIST_CAR 复判）"
fi
phone_db_pull_trash
PDEL=$(entity_op_count PROJECT DEL)
if ! printf '%s' "$PDEL" | grep -qE '^[0-9]+$'; then
  bad "读不到手机库的 PROJECT/DEL 计数"
elif [ "$PDEL" -ge 1 ]; then
  ok "清单的删除也走 op-log（PROJECT/DEL = $PDEL 条）"
else
  bad "本地库一条 PROJECT/DEL 都没有（UI 那一档实测 THERE=${THERE}：1=已消失 / 0=仍在 ⇒ 到底是'没写 op'还是'没点到'，看上面那行）"
fi
open_trash || exit 1
dump
# PROJECT 那一行在回收站里的形状同样是**第一次量** ⇒ 两种载具任一命中都算"列出"
if LIST_TRASH_CAR=$(row_carrier "恢复：${LIST_L}" "$LIST_L"); then
  ok "手机回收站列出了那条清单（W4 的四路在设备端成立；载具=${LIST_TRASH_CAR}）"
else
  bad "手机回收站没列出那条清单（这一趟 PROJECT/DEL=${PDEL} 条；恢复按钮名与行名两种载具都没命中）—— PDEL=0 时这一条只是上一条的下游，不能读成'第四路缺'"
  screen_txt
fi
$ADB exec-out screencap -p > "$EVIDENCE/android-trash-3-phone-list.png" 2>/dev/null
back_from_trash

step "6b. W4b：标签删除要两步 —— 点一下**一条 op 都不许多写**，确认才写"
# 🔴 为什么设备级也要钉一次：标签**不进回收站**（§7.1 P-1 拍板：重建成本≈0，
#    防护改成"删之前告诉你影响几条任务"）。于是"按下即删"这个坏法**没有第二处能拦** ——
#    删掉的标签在活体列表里不留痕、回收站里也找不到，而重新建一个同名标签拿到的是
#    **新 id**，原来那些任务的归属不会回来。这一档唯一的价值就是那一下被拦住。
TAG_T="tag-e2e-$(date +%H%M%S)"
go_profile || exit 1
# 🔴 定位走**标签**（`标签名称`）不走占位文案（`给新标签起个名字`）：05 02:3x 真机 dump 现量，
#    这两个 EditText 的 `content-desc` 是它上面的小标题、`text` 才是 placeholder
#    （`class=EditText desc='标签名称' text='给新标签起个名字'`），而 `scroll_to_desc` 只比 desc
#    ⇒ 拿 placeholder 当针**永远不命中**（第 6 趟就死在这句上，而同一棵树里那个串明明在）。
#    上一行清单（第 5 步）用的是 `清单名称`，所以它没中招 —— 这是我写这一档时没跟兄弟对齐。
XY=$(scroll_to_desc "标签名称")
if [ -z "$XY" ]; then bad "找不到标签输入框（desc=「标签名称」）"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 1.2
clear_and_type "$TAG_T" "标签名称"
XY=$(scroll_to_desc "新建标签")
if [ -z "$XY" ]; then bad "找不到「新建标签」按钮"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
dump
if [ "$(has_desc "删除标签「${TAG_T}」")" != "1" ]; then
  blame_crash "点「新建标签」" || bad "建完之后标签行没出现（找不到「删除标签「${TAG_T}」」）"
  screen_txt; exit 1
fi
ok "标签已建：$TAG_T"
phone_db_pull_trash
BEFORE_TAG=$(entity_op_count TAG DEL)
if ! printf '%s' "$BEFORE_TAG" | grep -qE '^[0-9]+$'; then
  bad "读不到手机库的 TAG/DEL 基线计数（库没拉下来？）"; exit 1
fi

# ── 第一步：点删除，只许出确认行，一条 op 都不许多写 ──────────
XY=$(xy_either "删除标签「${TAG_T}」")
if [ -z "$XY" ]; then bad "标签行上没有删除入口"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
dump
if [ "$(has_desc "确认删除")" != "1" ]; then
  blame_crash "点标签删除" || bad "点了删除却没出现确认行（没有「确认删除」那个入口 —— 很可能是按下即删）"
  screen_txt; exit 1
fi
if [ "$(has_text "确定要删除「${TAG_T}」吗？")" != "1" ]; then
  bad "确认行里没有那句问句（词条没落到设备上，或渲染的不是共享那一行）"; screen_txt
else
  ok "确认行出现，问句是共享层那句"
fi
phone_db_pull_trash
MID_TAG=$(entity_op_count TAG DEL)
if ! printf '%s' "$MID_TAG" | grep -qE '^[0-9]+$'; then
  bad "读不到点删除之后的 TAG/DEL 计数"
elif [ "$MID_TAG" != "$BEFORE_TAG" ]; then
  bad "只点了一下删除就多写了 op（${BEFORE_TAG} → ${MID_TAG}）—— 这一档存在的全部意义就是拦住那一下"
else
  ok "点删除**一条 op 都没写**（TAG/DEL 仍为 ${MID_TAG}）"
fi
$ADB exec-out screencap -p > "$EVIDENCE/android-trash-4-tag-confirm.png" 2>/dev/null

# ── 第二步：取消，同样一条都不写，且那条标签必须还在 ──────────
XY=$(xy_either "取消删除")
if [ -z "$XY" ]; then bad "确认行里没有「取消删除」入口"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
dump
if [ "$(has_desc "删除标签「${TAG_T}」")" != "1" ]; then
  bad "点「取消删除」之后那条标签不在了（取消被当成了确认）"; screen_txt
else
  ok "取消之后那条标签还在"
fi
phone_db_pull_trash
CANCEL_TAG=$(entity_op_count TAG DEL)
if ! printf '%s' "$CANCEL_TAG" | grep -qE '^[0-9]+$'; then
  bad "读不到取消之后的 TAG/DEL 计数"
elif [ "$CANCEL_TAG" != "$BEFORE_TAG" ]; then
  bad "点「取消删除」却写了 op（${BEFORE_TAG} → ${CANCEL_TAG}）"
else
  ok "取消同样一条 op 都没写"
fi

# ── 第三步：确认才真的写，且恰好一条 ──────────────────────────
XY=$(xy_either "删除标签「${TAG_T}」")
if [ -z "$XY" ]; then bad "第二次找不到那条标签的删除入口"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
XY=$(xy_either "确认删除")
if [ -z "$XY" ]; then bad "第二次点删除后确认行没出来"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
phone_db_pull_trash
AFTER_TAG=$(entity_op_count TAG DEL)
if ! printf '%s' "$AFTER_TAG" | grep -qE '^[0-9]+$'; then
  bad "读不到确认之后的 TAG/DEL 计数"
else
  WANT_TAG=$((BEFORE_TAG + 1))
  if [ "$AFTER_TAG" -ne "$WANT_TAG" ]; then
    bad "确认之后 TAG/DEL 不是恰好 +1（${BEFORE_TAG} → ${AFTER_TAG}，应为 ${WANT_TAG}）—— 多写就是 fan-out"
  else
    ok "确认之后恰好写了 1 条 TAG/DEL —— 一个意图一条 op"
  fi
  dump
  if [ "$(has_desc "删除标签「${TAG_T}」")" = "1" ]; then
    bad "确认删除之后那条标签还在活体列表里（写了 op 却没生效到界面）"; screen_txt
  else
    ok "确认之后那条标签从活体列表消失"
  fi
fi

step "7. 判据 ③/④ 的对端：笔记本的回收站列出那条清单、便签在对端是活的（且不在回收站里）"
# 🔴 这一整步在 W6-b 之前**不可能存在**：那时 node-host 的 `trash` 只吐任务，
#    便签与清单在笔记本侧读不出来，"跨设备的回收站"这句话只能靠界面推断。
#
# 🔴 顺序与期望是 10-05 02:5x 改的（第 7 趟现场），原因不是"跑太慢"而是**期望写错了**：
#    第一条原来写的是「等笔记本的回收站列出那条便签」—— 可第 5 步已经在手机上把它**还原**了，
#    跨设备之后它在对端应该是活的、**不在回收站里**。现量：手机还原后服务端 `latestSeq=7`，
#    笔记本 `trash` 实际返回 `rows=[{kind:PROJECT,title:trash-e2e-list-023510}]`（一条 NOTE 都没有），
#    而 `LAPTOP_ROUNDS=180` 每轮 5 秒 ⇒ 这一档要空等 15 分钟，最后报一条**假红**。
#    ⇒ PROJECT 那条挪到最前：它既是跨设备事实，也是"回收站通道在对端可用"的正向对照；
#      便签活着走 `notes`；"便签不该在回收站里"降级成**负向**判据，且只在对照成立时才判。
P_AT=$(wait_laptop_json PROJECT "$LIST_L" trash); P_RC=$?
if [ "$P_RC" = "0" ]; then
  ok "笔记本回收站第 $P_AT 轮列出那条清单（kind=PROJECT）—— 四路合并真的到了 CLI 这一端"
elif [ "$P_RC" = "2" ]; then
  bad "笔记本**探针自己**坏了（${LAPTOP_ROUNDS} 轮里一次同步都没成功），清单那一条无效（不是产品缺陷）"
else
  bad "笔记本 $((LAPTOP_ROUNDS * 5)) 秒内没在回收站里列出那条清单 —— 删除事实没跨设备"
fi

R_AT=$(wait_laptop_json "" "$NOTE_A" notes); R_RC=$?
if [ "$R_RC" = "0" ]; then
  ok "笔记本 notes 第 $R_AT 轮读到「${NOTE_A}」—— 手机上点的那下「恢复」到了另一台设备"
elif [ "$R_RC" = "2" ]; then
  bad "笔记本探针自己坏了，活体那条无效（不是产品缺陷）"
else
  bad "笔记本读不到那条便签活着 —— 还原只在手机上看得见，跨设备没生效"
fi

# 负向那一档读的是**同一条通道**的一份新读数：已还原的便签不许再出现在对端回收站里。
# 🔴 它必须有上面那条 PROJECT 行做对照 —— 没有对照的"没有"不算证据（AGENTS §7 元规则 1），
#    而"通道整片空了"与"还原真的跨了设备"在 `rows` 上长得一模一样。
NOTE_CHECK=/tmp/heyta-trash-note-check.json
laptop trash > "$NOTE_CHECK" 2>/dev/null
NOTE_CHECK_RC=0
python3 - "$NOTE_CHECK" "$NOTE_A" "$LIST_L" >/tmp/heyta-trash-note-verdict.txt 2>&1 <<'PY_CHECK' || NOTE_CHECK_RC=$?
import json, sys
path, note, lst = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    rows = json.load(open(path, encoding='utf-8')).get('rows', [])
except Exception as e:
    print(f'CHANNEL=读不到那份 trash 读数（{e}）'); raise SystemExit(2)
if not any(r.get('kind') == 'PROJECT' and lst in str(r.get('title', '')) for r in rows):
    print('CHANNEL=对照不成立：这条读数里没有那条 PROJECT 行 ⇒ 不能判下面的负向'); raise SystemExit(2)
bad = [r for r in rows if r.get('kind') == 'NOTE' and note in str(r.get('title', ''))]
if bad:
    print(f'NEG=坏：还原之后的便签仍留在对端回收站（{len(bad)} 行）'); raise SystemExit(1)
print('NEG=ok（通道由 PROJECT 行证明可用，而那条已还原的便签不在回收站里）')
PY_CHECK
if [ "$NOTE_CHECK_RC" = "0" ]; then
  ok "对端回收站里没有那条已还原的便签（正向对照=同一条读数里的 PROJECT 行）"
elif [ "$NOTE_CHECK_RC" = "2" ]; then
  bad "回收站通道对照不成立 ⇒ 这一档无从判起（探针/环境问题，不是产品缺陷）：$(cat /tmp/heyta-trash-note-verdict.txt)"
else
  bad "$(cat /tmp/heyta-trash-note-verdict.txt) —— 还原在对端没生效：手机上看不见了，另一台还当它躺在回收站"
fi
step "8. 手机上「待上传」应已归零（队列真的排空了）"
go_profile || exit 1
# 🔴 第 12 趟（04:09）三档拆分**第一次真跑就落在第三档**，并带着屏把原因照出来了：
#   那一屏的文本是「清单名称 / 新建清单 / 标签 / 便签 / trash-e2e-note-… / 钉到今天」——
#   也就是「我的」**下半部**，而 `待上传` 那一行住在**上半部的状态卡**里，
#   根本没被渲染进可视区 ⇒ 三种形状当然一个都不命中。
#   `go_profile` 只保证"在「我的」这一页"，不保证"在这一页的顶部"（它点的是 tab，
#   而上一段判据（6b 删标签）刚好把这页滚到了下半部）。
#   与步 6 同一条形状：**读数之前先把这一屏推到顶**，否则量的是"没渲染"而不是"没排空"。
for _ in 1 2 3 4 5; do $ADB shell input swipe 540 700 540 1800 300; sleep 1; done
dump
# 🔴 第 10 趟（03:4x）实测这条的旧写法有两个缺陷，都在**探针**上而不是产品上：
#   1. `elif has_sub "项"` 是**恒真**的。`has_sub` 返回的是**输出** 1/0，而 `elif` 读的是
#      **退出码**；函数体 `grep -q … && echo 1 || echo 0` 两条分支里 `echo` 都成功 ⇒ 退出码恒 0
#      ⇒ 只要界面不是"已全部上传"就直接落到"没归零"那一档，而下面那条"读不到待上传状态"
#      **永远不可能执行**（一条死判据 —— §7 元规则二讲的是同一族：不能失败/不能命中的判据不算判据）。
#      兄弟脚本用的都是正确的比较形状 `[ "$(has_sub …)" = "1" ]`，这里漏了。
#   2. 落在那一档后打印的 `（${PENDING_TXT}）` 是**空括号**。抽取本身没错（`text="[^"]*项"`
#      在 `'{count} 项'` 这种形状上能命中），空的原因是**它被带到了一个界面里根本没有"项"字
#      的现场**（最可能是 `读取中…` 那一态）⇒ 判据红、读数空、还不 dump 屏。
#      ⚠️ "当时那一屏到底是哪一态"**没取证**（第 10 趟没 dump），所以这里只把三态拆成三条
#      各带 `screen_txt`，不写成"就是因为读取中"。抽取同时补宽成 `[^"]*项[^"]*` 少一个形状依赖。
#   形状的现量真源：`ProfileScreen.tsx:552-559` 的三态 + `zh-CN.ts` 的
#   `pending.loading='读取中…' / pending.allUploaded='已全部上传' / pending.count='{count} 项'`。
#   "读取中…" 是 `undefined`（还没读到），**既不算排空也不算没排空** ⇒ 单独一档判"无从判起"。
if [ "$(has_text "已全部上传")" = "1" ] || [ "$(has_desc_sub "已全部上传")" = "1" ]; then
  ok "待上传队列已排空（不是「拉下来了但没推上去」）"
else
  PENDING_TXT=$(grep -oE 'text="[^"]*项[^"]*"' "$UI_XML" | head -1)
  if [ -z "$PENDING_TXT" ] && [ "$(has_sub "读取中")" = "1" ]; then
    bad "待上传停在「读取中…」= 还没读到（`undefined` 与 `0` 在两态判定里是两回事）⇒ 这一档无从判起，不算排空也不算没排空"; screen_txt
  elif [ -n "$PENDING_TXT" ]; then
    bad "待上传没有归零 —— 删除/还原没全部推出去（${PENDING_TXT}）"; screen_txt
  else
    bad "读不到待上传状态（三种形状都没命中：已全部上传 / 读取中… / N 项）"; screen_txt
  fi
fi

step "9. 截图证据落库"
for f in android-trash-1-phone-note.png android-trash-2-phone-restored.png android-trash-3-phone-list.png android-trash-4-tag-confirm.png; do
  if [ -s "$EVIDENCE/$f" ]; then ok "证据在库：apps/mobile/evidence/$f"; else bad "证据缺失：apps/mobile/evidence/$f"; fi
done
echo "   📷 四张图（**人必须打开看**）：回收站里有那条便签 / 点恢复之后 / 回收站里有那条清单 / 标签那条的删除确认行"

summary "回收站跨设备：删除事实与还原都要走完 op-log → E2EE → 服务端 → 另一台设备"
