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
# 移动端「截止时刻」输入侧验收（真模拟器，零 mock）—— R14c 的 Android 真机腿
# ============================================================================
#
# 🔴 为什么必须有这个脚本，而不是靠 `apps/mobile/tests/task-due-time.spec.ts`
#
# 时刻栏整块住在共享层 `DatePicker` 的可选 `time` prop 里，而那句契约是
# **「不传就一个节点都不画」**。移动端此前一直没传 —— 于是：
#   · 单测读源码文本能证明 `TaskDetailSheet` 现在传了（那是在验 diff，不是验界面）；
#   · 而"传了却没接通"（prop 传了、`onChange` 没接到 `actions.setDueDate`，
#     或 `enabled` 恒假把输入框灰死）在单测里**完全看不出来**。
# 这条腿只有一台真设备能验。判据全部走 `testID`（RN 在 Android 上把它写进
# `resource-id` —— 实测见 `verify-mobile-quadrant-fill.sh:115`），
# 不依赖中文措辞，所以 i18n 改文案不会把它变成假红。
#
# ══════════════════════════════════════════════════════════════════════
# 四条必须先写下来的实测事实（它们决定了判据的形状）
#
# 1. 🔴 **任务行上看不到时刻。** 行上的徽标是 `formatCompactDate`
#    （`packages/domain/src/date.ts:430`），只输出 `MM-DD`；移动端没有任何一处
#    渲染 `localTimeOf` 的结果（全仓 `localTimeOf` 的消费点只有 `TaskDetailSheet`）。
#    所以**不许**在这里写"行上出现 16:00"这类断言 —— 那条永远红，而且红得像是产品的错。
#    时刻的可见证据只有两处：详情面板里输入框的读回，以及另一台设备上的绝对 epoch。
#
# 2. 🔴 **「全天」按钮是条件渲染**（`DatePicker.tsx:354`：`time.value !== undefined`）。
#    这条正好可以拿来当"提交发生了"的读数：它出现 ⟺ 已提交的值不再是"只到日"。
#    于是「框里是我刚敲的字」与「这个字真的进了 dueDate」被拆成两个独立判据，
#    而不是混成一条"看着像提交了"。
#
# 3. 🔴 **半截时刻不提交**（`DatePicker.tsx:146-155` + `parseLocalTime` 要 `H:MM` 整形）。
#    敲 `16:0` 之后：框里读回是 `16:0`，而「全天」按钮**必须还不出现**。
#    这一条是"输入框没撒谎"的设备级证明 —— 也是那三行 `onChangeText` 逻辑
#    唯一能在真机上被抓住的方式。
#
# 4. 🔴 **判据⑨在 DST 换日那天会红，而且红得对**（2026-10-03 离线量到，不是猜的）：
#    `dueDateToEpoch` 是「本地零点 ms + 时刻的 ms」的**朴素相加**
#    （`packages/domain/src/capture.ts:604`），而这里期望的是**墙上时钟 16:00**。
#     America/Los_Angeles / 2026-11-01（回拨那天）实测：
#      用户输入的 16:00 = 1793577600000
#      零点 ms + 16h    = 1793574000000  → 折回墙上时钟是 **15:00**，差 3600000 ms
#    Asia/Shanghai 同一天差 0。本机模拟器 `persist.sys.timezone` = Asia/Shanghai ⇒ 今晚不触发。
#    📌 这条判据刻意断的是**产品结论**（用户写的是几点就是几点）而不是实现的算术，
#    所以它在该时区的那天**应该**红 —— 那是一次真缺陷现形，不要当 flaky 改断言。
#    缺陷本身（换日区差一小时）登记在下一批，不在本轮顺手改 `packages/domain`。
#
# 用法：
#   bash scripts/verify-mobile-due-time.sh
#
# 前置（脚本第 0 步会逐条体检，不满足就 exit 3 = 环境无效，不是产品失败）：
#   模拟器在跑、服务端在 ${PORT}（默认 3000，TEST_MODE）、
#   /tmp/heyta_mobile_{token,email,e2ee}.txt 存在（或 HEYTA_E2E_*_FILE 指过去）、
#   APK 比被测源码新。
#
# 变异臂（每条都实测会红，读数记在 docs/plans/calendar-year-time-and-mobile-profile.md）：
#   a) 把 `TaskDetailSheet` 的 `time={{…}}` 整块拿掉        → 判据①②③④⑤⑥⑦⑧⑨⑩ 全红
#   b) 把 `enabled` 写成恒 `true`                            → 判据② 红
#   c) 把 `onChange` 换成空操作                              → 判据⑥⑦⑧⑨ 红
#   d) 换日子时不搬运时刻（`dueDateToEpoch(date)`）           → 判据⑧⑨ 红
#   e) 共享层把「全天」改成无条件渲染                        → 判据③④⑤ 红
#   f) 共享层把"未到 HH:MM 不提交"改成每次 onChange 都提交    → 判据⑤ 红

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"
. "$(dirname "$0")/lib/wait-for-quiet-host.sh"

# 独立的笔记本库：与「任务编辑」「冲突」各用一份，否则脚本之间会互相看到对方的任务。
LAPTOP_DB=/tmp/heyta-duetime-laptop.sqlite

# 🔴 定位器写**进程私有**路径，不复用 `/tmp/_xy.py` 那个名字：共享库每轮 `cat >` 重写它
#    再执行，两轮并发就会执行到对方写到一半的那份（`countdown-anniversary.md:894` 记的同类事故）。
RID_PY="/tmp/_heyta_rid_$$.py"
# 🔴 这个 trap **替换**了 lib 里的 `trap restore_ime EXIT`（`mobile-e2e.sh:596`）——
#    所以必须把 `restore_ime` 一起接上，否则本脚本 `disable_ime` 之后就把设备
#    软键盘永久留在关闭状态，下一个跑这台模拟器的人拿到的是改过的设备。
trap 'rm -f -- "$RID_PY"; restore_ime' EXIT

TIME_HALF="16:0"   # 半截：只该活在草稿里
TIME_FULL="16:00"  # 整形：该提交
TITLE="duetime-e2e-$(date +%H%M%S)"

# ── 按 resource-id（= RN 的 testID）定位 ────────────────────
# 三种模式：count / xy（滚进可点区后的中心）/ attr（enabled 或 text）。
cat > "$RID_PY" <<'PY'
import re, sys

mode, want, xml_path = sys.argv[1], sys.argv[2], sys.argv[3]
tab_cutoff = int(sys.argv[4]) if len(sys.argv) > 4 else 0
raw = open(xml_path, encoding='utf-8', errors='replace').read()

def name_of(node):
    rid = re.search(r'resource-id="([^"]*)"', node)
    if not rid:
        return None
    # 同时接受 `task-due` 与 `com.heyta:id/task-due` 两种写法：RN 的 TestIdSetter
    # 交的是裸名，但这一层不该押住平台的序列化格式（押错的症状是"全都查不到"）。
    return rid.group(1).split('/')[-1]

hits = []
for m in re.finditer(r'<node[^>]*?>', raw):
    tag = m.group(0)
    if name_of(tag) != want:
        continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
    if not b:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    hits.append((x1, y1, x2, y2, tag))

if mode == 'count':
    print(len(hits))
    sys.exit()

# 🔴 「在 dump 里」不等于「可点」：详情面板的 ScrollView 会裁掉折叠线以下的节点，
#    它们照样在无障碍树里，但 top > bottom（负高度），中心点落在标签栏上
#    （`mobile-e2e.sh` 的 `desc-sane` 记过同一条）。这里同一守卫，只是按 id 找。
sane = [h for h in hits if h[2] > h[0] and h[3] > h[1] and (h[1] + h[3]) // 2 < tab_cutoff]

if mode == 'xy':
    if not sane:
        sys.exit()
    x1, y1, x2, y2, _ = sane[0]
    print(f'{(x1 + x2) // 2} {(y1 + y2) // 2}')
elif mode == 'attr':
    # 🔴 读属性**不**要求节点在可点区：被 ScrollView 裁掉的节点照样带 `text`/`enabled`，
    #    而"框里现在是什么"这件事与它此刻能不能点无关。把 sane 守卫加在这里的后果是
    #    读到空串 ⇒ 判据把"我没滚到"说成"值不对" —— 那是假红（本仓库同一类事故记在
    #    `mobile-e2e.sh` 的 `desc-sane` 注释里：查不到 ≠ 不存在）。
    key = sys.argv[5]
    if not hits:
        print('')
        sys.exit()
    m2 = re.search(rf'\s{key}="([^"]*)"', hits[0][4])
    print(m2.group(1) if m2 else '')
else:
    print(f'UNKNOWN_MODE:{mode}')
    sys.exit(1)
PY

rid_count() { python3 "$RID_PY" count "$1" /tmp/ui.xml; }
rid_xy()     { python3 "$RID_PY" xy "$1" /tmp/ui.xml "$TAB_Y"; }
rid_attr()   { python3 "$RID_PY" attr "$1" /tmp/ui.xml "$TAB_Y" "$2"; }

# 滚到某个 testID 进可点区（失败返回空坐标）。
scroll_to_rid() {  # <testID>
  for _ in 1 2 3 4 5 6; do
    dump
    local xy; xy=$(rid_xy "$1")
    if [ -n "$xy" ]; then printf '%s' "$xy"; return 0; fi
    $ADB shell input swipe "$MID_X" "$SCROLL_FROM_Y" "$MID_X" "$SCROLL_TO_Y" 300; sleep 1.5
  done
  return 1
}

# 读时刻输入框的当前内容（空串 = 框里没有字）。
# 🔴 **这一条在 19:1x 之前是坏的，而且坏的方向是"假红"**：无障碍里的 `text` 在框为空时
#    回的是**占位符**（词条 `common.due.timePlaceholder`，zh 值是「时:分」）而不是空串 ——
#    现场读数：判据 ④b「清空后框里还剩 '时:分'」。于是
#      · ②（"未设日期敲字敲不进去"判 `text != ""`）**恒红**，
#      · ④b（清空生效判 `text == ""`）**恒红**，
#    这两条红与产品无关，是读数通道把"没字"和"占位符"混成一件事。
#    ⚠️ 不把「时:分」这个字面值抄进脚本（抄件必漂；词条改一次这里就静默失效）：
#    改成**自校准** —— 第 5 步开跑前这条任务是刚建的、只有标题、没有时刻，
#    所以此刻的读数就是"空"在这个设备/这份语言下的字面形状，记成 `TIME_EMPTY`，
#    之后凡等于它的都归一成空串。若某台设备上空框真的回空串，`TIME_EMPTY` 就是空串，
#    归一成为**无操作** —— 这个设计两个方向都不会引入假绿。
TIME_EMPTY=""
time_value_raw() { dump; rid_attr task-due-time-input text; }
time_value() {
  local v; v=$(time_value_raw)
  [ -n "$TIME_EMPTY" ] && [ "$v" = "$TIME_EMPTY" ] && v=""
  printf '%s' "$v"
}
# 🔴 归一这把刀**自己也要有一道闸门**，否则它会把上面那个"假红"换成一个更贵的"假绿"：
#    锚点一旦取晚了（或某设备上这条新任务真带了一个默认时刻），`TIME_EMPTY` 就等于
#    后面各步要填进去的内容值 ⇒ ② 会报"填不进字"、④b 会报"清空生效"，**两条都绿**，
#    而它们读的是被自己的锚点吃掉的真空。便宜地排除掉能排除的那一半：
#    锚点不许与本轮任何一步"要填进去的值"同形。
calibrate_time_empty() {
  TIME_EMPTY=$(time_value_raw)
  case "$TIME_EMPTY" in
    "1" | "$TIME_HALF" | "$TIME_FULL") return 1 ;;
  esac
  return 0
}

# 清空时刻输入框（全选 + 删除，与 `clear_and_type` 同一手法；不循环 DEL —— 会 ANR）。
# 🔴 清完必须读回"真的空了"：清空失败时后面那条"填不进字"的负向判据会因为
#    框里还留着上一步的字而**恒假**，也就是变成一条永远不会红的判据。
clear_time() {
  $ADB shell input keycombination 113 29; sleep 0.6
  $ADB shell input keyevent 67; sleep 0.8
  time_value
}

# 打开/关闭详情面板（与 `verify-mobile-task-edit.sh` 同一条理由：
# RN 的 Modal 开着时，底下的行**不在**无障碍树里，行上的断言必须在关掉之后做）。
open_sheet() {
  local xy; xy=$(scroll_to_desc "打开任务：$1")
  if [ -z "$xy" ]; then return 1; fi
  $ADB shell input tap $xy; sleep 3
  dump
  [ "$(has_text "任务详情")" = "1" ]
}
close_sheet() {
  dump
  local xy; xy=$(xy_desc "关闭任务详情")
  if [ -z "$xy" ]; then return 1; fi
  $ADB shell input tap $xy; sleep 2.5
  dump
  [ "$(has_text "任务详情")" != "1" ]
}

# 把 dueDate（epoch ms）按**设备自己的时区**折回本地墙上时钟。
# 🔴 不用宿主机时区：模拟器可以是另一个 TZ，届时判据会因宿主配置而红。
epoch_to_local() {  # <ms>
  TZ= python3 -c '
import sys, datetime
from zoneinfo import ZoneInfo
ms, tz = int(sys.argv[1]), sys.argv[2]
print(datetime.datetime.fromtimestamp(ms/1000, ZoneInfo(tz)).strftime("%Y-%m-%d %H:%M:%S"))
' "$1" "$DEV_TZ"
}
local_to_epoch() {  # <YYYY-MM-DD> <HH:MM>
  TZ= python3 -c '
import sys, datetime
from zoneinfo import ZoneInfo
y, m, d, hh, mm = map(int, (sys.argv[1].replace("-", " ") + " " + sys.argv[2].replace(":", " ")).split())
tz = ZoneInfo(sys.argv[3])
print(int(datetime.datetime(y, m, d, hh, mm, tzinfo=tz).timestamp() * 1000))
' "$1" "$2" "$DEV_TZ"
}

echo ""
echo "=== 移动端截止时刻验收（真实模拟器，零 mock）==="
echo "  设备: $E2E_SERIAL   服务端: $SERVER"
echo "  账号: $EMAIL"
echo "  任务: $TITLE   输入: $TIME_HALF → $TIME_FULL"

# ── 第 0 步：载体体检。不满足一律 exit 3（环境无效 ≠ 产品失败），
#    并且**每条都打印读数**，好让下一轮失败时能分辨是哪一层不成立。
step "0. 载体体检（六条前置，缺一条就不开跑）"

OTHER=$(another_mobile_e2e_running)
if [ -n "$OTHER" ]; then
  echo "   ❌ 同一台模拟器上还有别的移动端验收在跑：" >&2
  printf '%s\n' "$OTHER" | sed 's/^/      /' >&2
  echo "      这些脚本都会 pm clear + 装包 + 按坐标点击，并行 = 互相清掉对方的界面状态。" >&2
  echo "      等它跑完再来（AGENTS §8.9）。" >&2
  exit 3
fi
ok "没有别的移动端验收在抢这台设备"

wait_for_quiet_host || { echo "   ❌ 载入门没过 —— 本轮不跑（环境无效，不是产品失败）" >&2; exit 3; }

if ! $ADB get-state >/dev/null 2>&1; then
  echo "   ❌ $E2E_SERIAL 不在线（adb devices 里没有它）" >&2
  exit 3
fi
SCREEN=$($ADB shell wm size 2>/dev/null | tail -1 | sed 's/.*: //')
SW=${SCREEN%x*}; SH=${SCREEN#*x}
case "$SW$SH" in
  ''|*[!0-9]*) echo "   ❌ 取不到设备分辨率（wm size 给出 '$SCREEN'）" >&2; exit 3 ;;
esac
# 底部标签栏与滚动区从**现量分辨率**推，不抄字面量（换设备的坐标会变）。
TAB_Y=$((SH - 147))
MID_X=$((SW / 2))
SCROLL_FROM_Y=$((SH - 500))
SCROLL_TO_Y=$((SH - 900))
OK_X=$((SW - 135))
ok "设备在线：${SCREEN}，坐标 TAB_Y=$TAB_Y MID_X=$MID_X 我的=$OK_X,$TAB_Y"

HEALTH=$(curl -s --noproxy '*' -m 5 "${HOST_SERVER}/health" 2>/dev/null)
if ! printf '%s' "$HEALTH" | grep -q '"status":"ok"'; then
  echo "   ❌ 服务端没在 ${HOST_SERVER}（/health 返回：${HEALTH:-空}）" >&2
  echo "      起栈：bash scripts/mobile-e2e-up.sh（端口用 PORT=… 传，本脚本跟着 ${PORT}）" >&2
  exit 3
fi
ok "服务端就绪：$HOST_SERVER"

if [ "${#TOKEN}" -lt 100 ]; then
  echo "   ❌ 令牌长度 ${#TOKEN} 看着不对 —— 先跑建号脚本 mobile-e2e-fresh-account.sh" >&2
  exit 1
fi
ok "凭据就位"

# 🔴 这条是本仓库栽过三次的同一件事（§7 #27/#82 + AGENTS §6.1.1）：
#    **验收对旧产物报绿**。这台设备的判据全在 APK 里，APK 旧 = 整轮读数都是旧的。
NEWEST_SRC=$(find apps/mobile/src packages/ui/src packages/i18n/src packages/domain/src \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' -exec stat -f %m {} + 2>/dev/null | sort -rn | head -1)
if [ ! -f "$APK" ]; then
  echo "   ❌ APK 不存在：$APK" >&2
  exit 3
fi
APK_MT=$(stat -f %m "$APK")
if [ -z "$NEWEST_SRC" ]; then
  echo "   ❌ 源码新鲜度取不到最新 mtime（find 没抓到文件）—— 这条判据此刻是空的" >&2
  exit 3
fi
if [ "$NEWEST_SRC" -gt "$APK_MT" ]; then
  echo "   ❌ APK 比被测源码旧 —— 跑它只会验到旧 bundle（§7 #27）" >&2
  echo "      APK   : $(date -r "$APK_MT" '+%F %T')" >&2
  echo "      最新源码: $(date -r "$NEWEST_SRC" '+%F %T')" >&2
  echo "      先重打再跑：pnpm --filter @heyta/ui build && pnpm build:android" >&2
  exit 3
fi
ok "APK 不比源码旧（APK $(date -r "$APK_MT" '+%F %T') ≥ 最新源码 $(date -r "$NEWEST_SRC" '+%F %T')）"
# 🔴 读数要能归因到**具体那一枚产物**：mtime 只说"新不新"，说不了"是哪一份"。
# 并行会话在同一个路径上重打过 APK（本仓 §7 #27 那一族），事后拿日志对源码时
# 只有内容指纹能回答"这轮装进去的到底是哪个字节集合"。
APK_SHA=$(shasum -a 256 "$APK" 2>/dev/null | awk '{print $1}')
if [ -z "$APK_SHA" ]; then
  echo "   ❌ 取不到 APK 的 sha256（shasum 失败或文件不可读）—— 这轮的产物无法归因" >&2
  exit 3
fi
echo "   APK sha256=${APK_SHA} size=$(stat -f %z "$APK")"

DEV_TZ=$($ADB shell getprop persist.sys.timezone 2>/dev/null | tr -d '\r')
if [ -z "$DEV_TZ" ]; then
  echo "   ❌ 取不到设备时区 —— 绝对 epoch 判据（第 9/10 步）没有参照系" >&2
  exit 3
fi
DEV_TODAY=$($ADB shell date +%Y-%m-%d 2>/dev/null | tr -d '\r')
PY_TODAY=$(TZ= python3 -c '
import sys, datetime
from zoneinfo import ZoneInfo
print(datetime.datetime.now(ZoneInfo(sys.argv[1])).strftime("%Y-%m-%d"))
' "$DEV_TZ")
if [ "$DEV_TODAY" != "$PY_TODAY" ]; then
  echo "   ❌ 设备日期 $DEV_TODAY 与按设备时区算出的 $PY_TODAY 不一致 —— 参照系不可用" >&2
  exit 3
fi
TOMORROW=$(TZ= python3 -c '
import sys, datetime
from zoneinfo import ZoneInfo
print((datetime.datetime.now(ZoneInfo(sys.argv[1])) + datetime.timedelta(days=1)).strftime("%Y-%m-%d"))
' "$DEV_TZ")
ok "设备时区 ${DEV_TZ}，今天 ${DEV_TODAY}，明天 ${TOMORROW}（宿主机 TZ=${TZ:-未设}）"

rm -f "$LAPTOP_DB"

# ── 第 1 步：装包、离开首启覆盖层、配凭据
step "1. 装包并启动"
# 🔴 原来这一行是 `$ADB install -r "$APK" 2>&1 | tail -1 | sed …`：管道的退出码是 sed 的（§7 #45），
# 装失败**什么都不会说**，然后继续用设备上那台旧包跑完整轮判据 —— 假绿形状与 #27 同一个。
INSTALL_OUT=$($ADB install -r "$APK" 2>&1)
INSTALL_RC=$?
printf '%s\n' "$INSTALL_OUT" | sed 's/^/   /'
if [ "$INSTALL_RC" -ne 0 ]; then
  bad "adb install 退出码 $INSTALL_RC ⇒ 停：装失败还往下跑，验的是设备上残留的旧包"
  screen_txt
  exit 1
fi
if ! printf '%s\n' "$INSTALL_OUT" | grep -q "Success"; then
  bad "adb install 退出码 0 但输出里没有 Success —— 不能把「命令没报错」当「装上了」（AGENTS §6.1.1）"
  exit 1
fi
ok "安装成功（rc=0 且输出含 Success；APK sha256=${APK_SHA:-未取}）"
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
launch_app; sleep 6
dismiss_welcome_if_present
dump
require_screen
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; fi

step "2. 配置同步凭据"
configure_sync_credentials

step "3. 建一条只有标题的任务"
$ADB shell input tap 135 "$TAB_Y"; sleep 3   # 「任务」标签
dump
XY=$(xy_desc "新建任务")
if [ -z "$XY" ]; then bad "找不到新建按钮"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 2.5
dump
XY=$(xy_edit_any)
if [ -z "$XY" ]; then bad "新建面板里找不到输入框"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 1
disable_ime   # 软键盘会盖住面板下半部分，而时刻栏就在下面
$ADB shell input text "$TITLE"; sleep 1.5
dump
XY=$(xy_text "添加")
if [ -z "$XY" ]; then bad "找不到「添加」"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
dump
if [ "$(has_desc "打开任务：$TITLE")" != "1" ]; then bad "任务没创建"; screen_txt; exit 1; fi
ok "任务已创建：$TITLE"

# ── 第 4 步：探针自检 —— 先把"探针看不见 testID"和"产品没画这个节点"分开。
#    这两件事在输出上长得一模一样（都是"count = 0"），而处置完全相反。
step "4. 打开详情面板，先验探针本身"
if ! open_sheet "$TITLE"; then bad "详情面板没打开"; screen_txt; exit 1; fi
if [ -z "$(scroll_to_rid task-due)" ]; then
  echo "   ❌ 对照失败：连截止区的外层 testID=\"task-due\" 都查不到 —— " >&2
  echo "      分不清是 resource-id 探针坏了还是面板没渲染。本轮读数无效。" >&2
  screen_txt
  exit 3
fi
ok "对照（正）：resource-id 探针看得见 task-due"
if [ "$(rid_count task-due-time-nonsense)" != "0" ]; then
  echo "   ❌ 对照失败：一个仓里根本不存在的 testID 也数得出节点 ⇒ 匹配器过宽，" >&2
  echo "      后面所有\"数到了\"都不算数。本轮读数无效。" >&2
  exit 3
fi
ok "对照（负）：不存在的 testID 数出 0（匹配器没在过度匹配）"

# ── 判据 ①②③：还没有日期时的三个应当状态。
#    ①时刻栏**存在**（这一条就是 R14c 的主张：以前移动端不传 time prop，这里是 0）
#    ②**敲字敲不进去**（"没日子就没有几点可言"由宿主把事实传进共享层）
#    ③「全天」按钮**不出现**（已经全天还给一个"改成全天"是假可供性）
#
# 🔴 ②为什么判"填不进字"而不判 `enabled="false"`：属性名是要赌的（RN 把 `editable`
#    落到哪个无障碍属性上，本机没实测过），赌错了得到的是一条**恒红**的判据，
#    而红的原因跟产品没关系。"敲进去没有字"是产品对用户承诺的那件事本身，
#    用的还是 ④⑤⑥ 同一个读数通道 —— 通道坏了一致地坏，四步会一起红，一眼能认出来。
#    `enabled` 只在旁边**打印**作诊断，不参与判定。
step "5. 判据 ①②③ —— 未设日期时的时刻栏"

# 🔴 **空框读数的自校准锚点，必须在任何敲字之前取**（19:1x 那趟的现场形状：
#    ④ 报「填进了 1」而 ② 与 ④b 报「框里是 '时:分'」—— 同一个框、同一个通道，
#    三条互相打脸，红的原因是占位符被当成了内容，不是 enabled 接线）。
#    此刻这条任务只有标题、没有时刻 ⇒ 这一读就是"空"在这台设备 + 这份语言下的
#    字面形状。空框若真回空串，`TIME_EMPTY` 就是空串，归一为无操作 —— 两个方向
#    都不会引入假绿（见上面 `time_value` 与 `calibrate_time_empty` 的注释）。
if ! calibrate_time_empty; then
  echo "   ❌ 空框锚点取到了'要填进去的内容值'（'${TIME_EMPTY}' 与 '1'/'${TIME_HALF}'/'${TIME_FULL}' 同形）" >&2
  echo "      这时归一会把**真空**吞成空串 ⇒ ② 与 ④b 会变成两条**假绿**（比原来的假红更贵）。" >&2
  echo "      本轮读数无效 ⇒ 停。要么是锚点取晚了（脚本侧），要么这条新任务真的自带默认时刻（产品侧）。" >&2
  screen_txt
  exit 3
fi
echo "   空框锚点 TIME_EMPTY='${TIME_EMPTY}'（长度 ${#TIME_EMPTY}；凡等于它的读数归一成空串）"

RAW_COUNT=$(rid_count task-due-time-input)
XY_NO_DATE=$(scroll_to_rid task-due-time-input)
# 🔴 ① 原来读的是**上一次没滚动的 dump** 的 `rid_count`，而 ②④ 走 `scroll_to_rid` ——
#    同一个节点两条通道。19:1x 实测就是这么自相矛盾的：① 报"不在无障碍树里"，
#    下一行 ② 却拿到了可点坐标。"没滚进可点区"被说成"没画"，与
#    `verify-mobile-edit` 记过的同一族（ScrollView 折叠线以下的节点在树里但不 sane）。
#    现在 ① 与 ②④ 同通道，原始枚数**另打一行**做归因：
#      数得出却没滚到 = 探针/布局问题；一枚都数不出 = 共享层真的没画这一行。
if [ -n "$XY_NO_DATE" ]; then
  ok "① 时刻输入框画出来了，且已滚进可点区（testID=task-due-time-input，树里共 $RAW_COUNT 枚）"
elif [ "$RAW_COUNT" -ge 1 ]; then
  bad "① 判不了：树里数得出 $RAW_COUNT 枚时刻输入框，但滚了 6 次都没进可点区 —— 探针/布局问题，不是产品没画"
else
  bad "① 时刻输入框不在无障碍树里（0 枚）—— 移动端没把 time prop 传下去，或共享层没画这一行"
fi
if [ -z "$XY_NO_DATE" ]; then
  bad "② 判不了：滚了 6 次都没把时刻输入框送进可点区（读数通道此刻不可用）"
else
  $ADB shell input tap $XY_NO_DATE; sleep 1.2
  $ADB shell input text "1"; sleep 1.2
  # 🔴 读数取一次、两个分支共用（原来 `if` 里调 `time_value`、bad 分支里什么都不打，
  #    于是"红了但看不出框里是什么"—— 与 19:1x 那趟要靠翻 ④b 才知道占位符这件事同族）。
  NO_DATE_READ=$(time_value)
  if [ "$NO_DATE_READ" = "" ]; then
    ok "② 未设日期时敲字敲不进去（框里仍是空）—— enabled 读数：$(rid_attr task-due-time-input enabled)"
  else
    bad "② 未设日期却把字填进了时刻框（归一后读到 '$NO_DATE_READ'，空框锚点是 '${TIME_EMPTY}'）—— '没有日子也能填几点'，enabled 接线没生效"
  fi
fi
if [ "$(rid_count task-due-time-all-day)" = "0" ]; then
  ok "③ 未设时刻时「全天」按钮不出现（不是无条件渲染的假可供性）"
else
  bad "③ 未设时刻却出现了「全天」按钮 —— 条件渲染失效"
fi

# ── 判据 ④：点了「今天」之后同一个框**能**填进字 —— 与 ② 用同一条腿、同一个读数，
#    配成双向对照。只写②的话，"读数恒空"这种通道故障也会让它一直绿。
#    ④之后必须清空：清空不生效的话，⑤那条"半截不提交"就建立在脏框上。
step "6. 判据 ④⑤ —— 有了日子才填得进，只到日仍算全天"
XY=$(scroll_to_desc "今天")
if [ -z "$XY" ]; then bad "找不到「今天」快捷项"; screen_txt; else
  $ADB shell input tap $XY; sleep 2.5
  XY2=$(scroll_to_rid task-due-time-input)
  if [ -z "$XY2" ]; then
    bad "④ 判不了：设了日期之后取不到时刻框坐标"
  else
    $ADB shell input tap $XY2; sleep 1.2
    $ADB shell input text "1"; sleep 1.2
    WITH_DATE=$(time_value)
    if [ "$WITH_DATE" = "1" ]; then
      ok "④ 设了「今天」之后同一个框能填进字（②/④ 双向：这条通道既不是恒空也不是恒满）"
    else
      bad "④ 设了日期之后仍然填不进字（框里是 '$WITH_DATE'）—— enabled 恒假，输入框被灰死"
    fi
    AFTER_CLEAR=$(clear_time)
    if [ "$AFTER_CLEAR" = "" ]; then
      ok "④b 清空生效（后面那条'半截不提交'建立在空框上，不是脏读数）"
    else
      bad "④b 清空后框里还剩 '$AFTER_CLEAR' —— ⑤⑥ 的读数不可信"
    fi
  fi
fi
if [ "$(rid_count task-due-time-all-day)" = "0" ]; then
  ok "⑤ 只到日仍算全天：「全天」按钮此时仍不出现"
else
  bad "⑤ 只选了日子（没填时刻）就出现「全天」按钮 —— '改成全天'对本来就没时刻的东西是假选择"
fi

# ── 判据 ⑥：半截时刻只活在草稿里，不提交。
step "7. 判据 ⑥ —— 半截时刻（${TIME_HALF}）不提交"
XY=$(scroll_to_rid task-due-time-input)
if [ -z "$XY" ]; then bad "滚不到时刻输入框"; screen_txt; else
  $ADB shell input tap $XY; sleep 1.2
  $ADB shell input text "$TIME_HALF"; sleep 1.5
  GOT=$(time_value)
  if [ "$GOT" = "$TIME_HALF" ]; then
    ok "⑥a 框里读回 ${TIME_HALF}（输入到了；注意读回只证明**草稿**）"
  else
    bad "⑥a 框里是 '$GOT'，不是 '$TIME_HALF' —— 输入没落地（高负载丢字？焦点不在框上？）"
  fi
  if [ "$(rid_count task-due-time-all-day)" = "0" ]; then
    ok "⑥b 半截时刻没有触发提交（「全天」按钮仍不出现 = 已提交值仍是'只到日'）"
  else
    bad "⑥b 敲了 $TIME_HALF 就提交了 —— 半截时刻被写进 dueDate，等于替用户猜时间"
  fi
fi

# ── 判据 ⑦：补成整形之后提交发生（「全天」出现 = 已提交值不再等于只到日）。
step "8. 判据 ⑦ —— 补成 $TIME_FULL 之后提交"
$ADB shell input text "0"; sleep 1.5
GOT=$(time_value)
if [ "$GOT" = "$TIME_FULL" ]; then
  ok "⑦a 框里读回 $TIME_FULL"
else
  bad "⑦a 框里是 '$GOT'，不是 '$TIME_FULL'"
fi
if [ "$(rid_count task-due-time-all-day)" -ge 1 ]; then
  ok "⑦b 「全天」按钮出现 ⇒ 提交真的发生了（已提交值不再是'只到日'）"
else
  bad "⑦b 填了 $TIME_FULL 而「全天」按钮没出现 —— 没提交（onChange 没接到写入，或写进去的还是 00:00）"
fi

# ── 判据 ⑧：关掉再开，值还在 —— 证明进了 op-log 而不是只活在组件 state 里。
step "9. 判据 ⑧ —— 重开面板后时刻仍在（落库，不是本地态）"
if ! close_sheet; then bad "面板没关掉"; screen_txt; fi
if open_sheet "$TITLE"; then
  XY8=$(scroll_to_rid task-due-time-input)
  RAW8=$(rid_count task-due-time-input)
  # 🔴 红了要**当场**把"现在停在哪一屏"打出来。19:1x 那趟从 ⑧ 起连红五条，
  #    而我是在**下一步**（⑨ 的 screen_txt）里才看出界面当时停在「我的」页 ——
  #    那条读数离出事点已经隔了两步，只支持推断、不算取证（AGENTS §8.7：
  #    归因要写在产生它的那一步）。枚数一起打，好让下一轮能分辨
  #    "树里就没有"（产品/渲染回退）与"有但滚不到"（探针/布局）。
  if [ -z "$XY8" ]; then
    bad "⑧ 重开后面板上取不到时刻输入框的可点坐标（树里 $RAW8 枚）—— 面板没绑到这一条任务？还是整页已经不是详情面板？"
    screen_txt
  else
    GOT=$(time_value)
    if [ "$GOT" = "$TIME_FULL" ]; then
      ok "⑧ 重开后框里仍是 ${TIME_FULL} —— 写进了 op-log"
    else
      bad "⑧ 重开后框里是 '$GOT'（空框锚点是 '${TIME_EMPTY}'）—— 上一次写的时刻没落库"
      screen_txt
    fi
  fi
else
  bad "⑧ 重开面板失败"
  screen_txt
fi

# ── 判据 ⑨：换日子要**搬运**已有的时刻（TaskDetailSheet 的 onChange 里那句
#    `dueDateToEpoch(date, dueTimeValue)`）。少了它，用户点「明天」就等于把 16:00
#    静默清零，而提醒算的是 dueDate - offset ⇒ 提醒整整挪一天，界面上毫无异常。
step "10. 判据 ⑨ —— 点「明天」后时刻不丢"
XY=$(scroll_to_desc "明天")
if [ -z "$XY" ]; then bad "找不到「明天」快捷项"; screen_txt; else
  $ADB shell input tap $XY; sleep 2.5
  GOT=$(time_value)
  if [ "$GOT" = "$TIME_FULL" ]; then
    ok "⑨a 换日子后框里仍是 ${TIME_FULL}（时刻被搬运，不是归零）"
  else
    bad "⑨a 换日子后框里是 '$GOT' —— 时刻被静默清掉了"
  fi
fi
if ! close_sheet; then bad "面板没关掉"; screen_txt; fi

step "11. 手机同步，笔记本读绝对 epoch"
$ADB shell input tap "$OK_X" "$TAB_Y"; sleep 3   # 「我的」
ensure_phone_sync
sleep 5
echo "     首次同步含密钥派生，最长等 900 秒…"
if ROUNDS=$(wait_laptop_has "$TITLE" 180); then
  ok "上传已到达服务端（笔记本第 $ROUNDS 轮拉到）"
else
  bad "等了约 900 秒，笔记本仍拉不到这条任务"
  screen_txt
fi
if laptop_ok sync; then ok "笔记本已下载"; else bad "笔记本 sync 失败"; fi

# ── 判据 ⑩：跨设备的**绝对值**，不是"有个 dueDate"。
#    "存在性"挡不住差一天、差八小时、或只写到日 —— 那三种都同样"存在"。
EXPECT=$(local_to_epoch "$TOMORROW" "$TIME_FULL")
LT=$(laptop list --all)
VERDICT=$(printf '%s' "$LT" | python3 -c '
import json, sys
want = int(sys.argv[2])
d = json.load(sys.stdin)
ts = [t for t in d.get("tasks", []) if t["title"] == sys.argv[1]]
if not ts:
    print("MISSING"); raise SystemExit
due = ts[0].get("dueDate")
if due is None:
    print("NONE"); raise SystemExit
print("OK" if int(due) == want else f"{int(due)}")
' "$TITLE" "$EXPECT")
if [ "$VERDICT" = "OK" ]; then
  ok "⑩ 笔记本侧 dueDate == $TOMORROW ${TIME_FULL}（设备时区 ${DEV_TZ}）逐毫秒相同"
else
  ACTUAL=""
  [ "$VERDICT" != "OK" ] && [ "$VERDICT" != "MISSING" ] && [ "$VERDICT" != "NONE" ] \
    && ACTUAL="，实测 $VERDICT = $(epoch_to_local "$VERDICT")"
  bad "⑩ 跨设备的时刻不对：期望 $TOMORROW $TIME_FULL${ACTUAL:-（${VERDICT}）}"
fi

# ── 判据 ⑪：点「全天」= 清掉时刻，且**日子保留**（清的是精度，不是日期）。
step "12. 判据 ⑪ —— 「全天」把时刻清掉、日子留住"
if open_sheet "$TITLE"; then
  ALLDAY_XY=$(scroll_to_rid task-due-time-all-day)
  if [ -z "$ALLDAY_XY" ]; then
    bad "⑪a 找不到「全天」按钮（前一步明明出现过；树里 $(rid_count task-due-time-all-day) 枚）"
    screen_txt
  else
    $ADB shell input tap $ALLDAY_XY; sleep 2.5
    GOT=$(time_value)
    if [ "$GOT" = "" ]; then
      ok "⑪a 点「全天」后框清空"
    else
      bad "⑪a 点「全天」后框里还剩 '$GOT'"
    fi
    if [ "$(rid_count task-due-time-all-day)" = "0" ]; then
      ok "⑪b 「全天」按钮随之消失（值真的回到'只到日'，于是条件渲染为假）"
    else
      bad "⑪b 点完之后「全天」按钮还在 —— 条件与值不同步"
    fi
  fi
  if ! close_sheet; then bad "面板没关掉"; screen_txt; fi
else
  # 🔴 这一条以前**不存在**，而 19:1x 那趟的后果是：第 12 步整步没有打印任何一条 ⑪
  #    判据（日志里那一步只有"笔记本已下载"和 ⑪c），界面已经不在任务页，
  #    脚本却一路跑到汇总 —— 两条判据被**静默跳过**，而总数仍报"通过 27 / 失败 10"，
  #    读起来像"⑪ 判过了"。跳过必须是看得见的一条红，不能是缺两行。（§7 #46 同族：
  #    没跑到的那一段不会自己报错，它只是不在输出里。）
  bad "⑪ 判不了：详情面板没重开，第 12 步的两条判据（⑪a/⑪b）一条都没跑到"
  screen_txt
fi

$ADB shell input tap "$OK_X" "$TAB_Y"; sleep 3
ensure_phone_sync
sleep 5
if laptop_ok sync; then ok "笔记本已下载"; else bad "笔记本 sync 失败"; fi
EXPECT_ALLDAY=$(local_to_epoch "$TOMORROW" "00:00")
LT=$(laptop list --all)
VERDICT2=$(printf '%s' "$LT" | python3 -c '
import json, sys
want = int(sys.argv[2])
d = json.load(sys.stdin)
ts = [t for t in d.get("tasks", []) if t["title"] == sys.argv[1]]
if not ts:
    print("MISSING"); raise SystemExit
due = ts[0].get("dueDate")
if due is None:
    print("NONE"); raise SystemExit
t = int(due)
# 两条一起判：数值等于本地零点（清的是精度），而且日子**还在**明天（没顺手把日期也清掉）。
print("OK" if t == want else f"{t}")
' "$TITLE" "$EXPECT_ALLDAY")
if [ "$VERDICT2" = "OK" ]; then
  ok "⑪c 笔记本侧 dueDate == $TOMORROW 00:00 —— 回到全天而日期保留"
else
  ACTUAL2=""
  [ "$VERDICT2" != "OK" ] && [ "$VERDICT2" != "MISSING" ] && [ "$VERDICT2" != "NONE" ] \
    && ACTUAL2="，实测 $VERDICT2 = $(epoch_to_local "$VERDICT2")"
  bad "⑪c 全天之后跨设备的值不对：期望 $TOMORROW 00:00${ACTUAL2:-（${VERDICT2}）}"
fi

step "13. 直接查 Postgres"
# 🔴 连接参数走 env（与 `verify-mobile-lists.sh:386` / `verify-mobile-notes.sh:460` 同一套约定，仓内理由写在 `lib/mobile-e2e.sh:57-61`）：
#    原来这里硬印 `-U rocalight -d heyta_mobile_smoke`，换一台机器就连不上，而失败形态被 `2>/dev/null` 吞成"什么都没打印"。
#    默认值与原来逐字相同（库名同源、用户默认当前登录者），所以现有跑法行为不变。
PG_DB="${HEYTA_E2E_DB:-heyta_mobile_smoke}"
PG_USER="${HEYTA_E2E_DB_USER:-$(whoami)}"
PG_HOST="${HEYTA_E2E_DB_HOST:-127.0.0.1}"
PG_PORT="${HEYTA_E2E_DB_PORT:-5432}"
PG_SERVER_STATS=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT (SELECT count(*) FROM operations) AS ops, (SELECT count(*) FROM sync_devices) AS devices" 2>&1)
if printf '%s' "$PG_SERVER_STATS" | grep -qE '^[0-9]+\|[0-9]+$'; then
  ok "服务端现场 ops|devices = ${PG_SERVER_STATS}（库 ${PG_DB} @ ${PG_HOST}:${PG_PORT}，用户 ${PG_USER}）"
else
  bad "读不到服务端的 ops/devices 计数（库 ${PG_DB} @ ${PG_HOST}:${PG_PORT}，用户 ${PG_USER}）—— 原始输出：$PG_SERVER_STATS"
fi

summary "移动端截止时刻输入侧闭环"
