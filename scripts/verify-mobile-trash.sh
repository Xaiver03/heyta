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

go_profile() {
  local xy; xy=$(xy_desc "我的")
  [ -z "$xy" ] && xy=$(scroll_to_desc "我的")
  if [ -z "$xy" ]; then bad "找不到底部标签「我的」"; screen_txt; return 1; fi
  $ADB shell input tap $xy; sleep $TAB_WAIT; return 0
}

open_trash() {
  local xy; xy=$(xy_desc "回收站")
  [ -z "$xy" ] && xy=$(scroll_to_desc "回收站")
  if [ -z "$xy" ]; then bad "找不到「回收站」入口（mobile.trash.entry）"; screen_txt; return 1; fi
  $ADB shell input tap $xy; sleep $TAB_WAIT; return 0
}

back_from_trash() {
  local xy; xy=$(xy_desc "返回")
  if [ -z "$xy" ]; then bad "回收站屏上没有「返回」（mobile.growth.back）"; screen_txt; return 1; fi
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
if [ "$(has_text "$NOTE_A")" != "1" ]; then
  blame_crash "点「添加便签」" || bad "便签没出现在列表里"
  screen_txt; exit 1
fi
ok "便签已建出：$NOTE_A"

XY=$(scroll_to_desc "清单名称")
if [ -z "$XY" ]; then bad "找不到清单名称输入框（滚动到清单段也没找到）"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 1.2
clear_and_type "$LIST_L" "清单名称"
XY=$(scroll_to_desc "新建清单")
if [ -z "$XY" ]; then bad "找不到「新建清单」按钮"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
dump
if [ "$(has_text "$LIST_L")" != "1" ]; then
  blame_crash "点「新建清单」" || bad "清单没出现在列表里"
  screen_txt; exit 1
fi
ok "清单已建出：$LIST_L"

step "3. 手机上删便签：先证「点了」，再证「生效了」"
XY=$(scroll_to_desc "删除便签「${NOTE_A}」")
if [ -z "$XY" ]; then
  bad "便签行上没有删除入口（找不到无障碍名「删除便签「${NOTE_A}」」）"; screen_txt; exit 1
fi
$ADB shell input tap $XY; sleep 3
dump
if [ "$(has_text "$NOTE_A")" = "1" ]; then
  bad "点了删除，便签却还在活体列表里（未生效）"; screen_txt
else
  ok "点了删除并且生效：便签从活体列表消失"
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
    bad "判据 ① 的日志基线不是数字（LOG_BASE=${LOG_BASE}）—— 探针没读到，不许当成"没请求""
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
if [ "$(has_text "$NOTE_A")" = "1" ]; then ok "回收站里有那条便签"; else bad "回收站里看不到刚删的便签"; screen_txt; fi
$ADB exec-out screencap -p > "$EVIDENCE/android-trash-1-phone-note.png" 2>/dev/null

XY=$(scroll_to_desc "恢复：${NOTE_A}")
if [ -z "$XY" ]; then
  bad "回收站那一行上没有「恢复：${NOTE_A}」（可访问名来自 mobile.trash.restoreA11y）"
  screen_txt; exit 1
fi
$ADB shell input tap $XY; sleep 3
dump
if [ "$(has_text "$NOTE_A")" = "1" ]; then
  bad "点了恢复，那一行却还留在回收站里（未生效）"; screen_txt
else
  ok "点了恢复并且生效：那一行从回收站消失"
fi
$ADB exec-out screencap -p > "$EVIDENCE/android-trash-2-phone-restored.png" 2>/dev/null

back_from_trash || exit 1
dump
if [ "$(has_text "$NOTE_A")" = "1" ]; then
  ok "便签回到了活体列表（还原不是只把行藏起来）"
else
  bad "回收站里没了，活体列表里也没有 —— 还原把这条便签弄丢了"
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
XY=$(scroll_to_desc "删除清单「${LIST_L}」")
if [ -z "$XY" ]; then
  bad "清单行上没有删除入口（找不到「删除清单「${LIST_L}」」）"; screen_txt; exit 1
fi
$ADB shell input tap $XY; sleep 3
dump
if [ "$(has_text "$LIST_L")" = "1" ]; then
  bad "点了删除，清单却还在活体列表里（未生效）"; screen_txt
else
  ok "点了删除并且生效：清单从活体列表消失"
fi
phone_db_pull_trash
PDEL=$(entity_op_count PROJECT DEL)
if ! printf '%s' "$PDEL" | grep -qE '^[0-9]+$'; then
  bad "读不到手机库的 PROJECT/DEL 计数"
elif [ "$PDEL" -ge 1 ]; then
  ok "清单的删除也走 op-log（PROJECT/DEL = $PDEL 条）"
else
  bad "清单在界面上没了，本地库却一条 PROJECT/DEL 都没有"
fi
open_trash || exit 1
dump
if [ "$(has_text "$LIST_L")" = "1" ]; then
  ok "手机回收站列出了那条清单（W4 的四路在设备端成立）"
else
  bad "手机回收站里没有那条清单 —— 四路合并缺 PROJECT 这一路"
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
XY=$(scroll_to_desc "给新标签起个名字")
if [ -z "$XY" ]; then bad "找不到标签输入框（「给新标签起个名字」）"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 1.2
clear_and_type "$TAG_T" "给新标签起个名字"
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
XY=$(scroll_to_desc "删除标签「${TAG_T}」")
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
XY=$(scroll_to_desc "取消删除")
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
XY=$(scroll_to_desc "删除标签「${TAG_T}」")
if [ -z "$XY" ]; then bad "第二次找不到那条标签的删除入口"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
XY=$(scroll_to_desc "确认删除")
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

step "7. 判据 ③/④ 的对端：笔记本的回收站两类都列出、便签读得到活着"
# 🔴 这一整步在 W6-b 之前**不可能存在**：那时 node-host 的 `trash` 只吐任务，
#    便签与清单在笔记本侧读不出来，"跨设备的回收站"这句话只能靠界面推断。
N_AT=$(wait_laptop_json NOTE "$NOTE_A" trash); N_RC=$?
if [ "$N_RC" = "0" ]; then
  ok "笔记本回收站第 $N_AT 轮列出那条便签（kind=NOTE）—— 删除的事实跨了设备"
elif [ "$N_RC" = "2" ]; then
  bad "笔记本**探针自己**坏了（${LAPTOP_ROUNDS} 轮里一次同步都没成功），这一条无效（不是产品缺陷）"
else
  bad "笔记本 $((LAPTOP_ROUNDS * 5)) 秒内没在回收站里列出那条便签 —— 删除事实没跨设备"
fi

P_AT=$(wait_laptop_json PROJECT "$LIST_L" trash); P_RC=$?
if [ "$P_RC" = "0" ]; then
  ok "笔记本回收站第 $P_AT 轮列出那条清单（kind=PROJECT）—— 四路合并真的到了 CLI 这一端"
elif [ "$P_RC" = "2" ]; then
  bad "笔记本探针自己坏了，清单那一条无效（不是产品缺陷）"
else
  bad "笔记本回收站里没有那条清单 —— 只测任务的话，这一档永远不会被发现"
fi

R_AT=$(wait_laptop_json "" "$NOTE_A" notes); R_RC=$?
if [ "$R_RC" = "0" ]; then
  ok "笔记本 notes 第 $R_AT 轮读到「${NOTE_A}」—— 手机上点的那下「恢复」到了另一台设备"
elif [ "$R_RC" = "2" ]; then
  bad "笔记本探针自己坏了，活体那条无效（不是产品缺陷）"
else
  bad "笔记本读不到那条便签活着 —— 还原只在手机上看得见，跨设备没生效"
fi

step "8. 手机上「待上传」应已归零（队列真的排空了）"
go_profile || exit 1
dump
if [ "$(has_text "已全部上传")" = "1" ]; then
  ok "待上传队列已排空（不是「拉下来了但没推上去」）"
elif has_sub "项"; then
  PENDING_TXT=$(grep -oE 'text="[^"]*项"' /tmp/ui.xml | head -1)
  bad "待上传没有归零 —— 删除/还原没全部推出去（${PENDING_TXT}）"
else
  bad "读不到待上传状态"; screen_txt
fi

step "9. 截图证据落库"
for f in android-trash-1-phone-note.png android-trash-2-phone-restored.png android-trash-3-phone-list.png android-trash-4-tag-confirm.png; do
  if [ -s "$EVIDENCE/$f" ]; then ok "证据在库：apps/mobile/evidence/$f"; else bad "证据缺失：apps/mobile/evidence/$f"; fi
done
echo "   📷 四张图（**人必须打开看**）：回收站里有那条便签 / 点恢复之后 / 回收站里有那条清单 / 标签那条的删除确认行"

summary "回收站跨设备：删除事实与还原都要走完 op-log → E2EE → 服务端 → 另一台设备"
