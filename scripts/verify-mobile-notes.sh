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
# 移动端「便签编辑链」验收（真模拟器，零 mock）
# ==============================================
#
# 🔴 为什么必须有这个脚本
#
# 便签的**写路径**早就在（`createNoteActions` 能建、能钉、能删，op 也真落库），
# 但**改不了正文**：共享组件的 `onEdit` prop 在、动作层的 `updateNoteContent` 在，
# 两端都不传。这种"零件都在、没人接线"的坏法**不会让任何东西变红** ——
# 类型检查绿、构建绿、既有测试绿，界面上就是"没有这个功能"。
# 所以这里验的是**接线之后的一整条链**：摘要点得开 → 编辑屏打得开且初值就是
# 当前正文 → 改正文保存 → 列表摘要真的变了 → 恰好一条 `UPD` 且只带 `content` →
# 没改动时一条都不写 → 搜索里那条便签点得开 → 出得去（服务端数得到）→
# 进得来（笔记本解密后读到同一份新正文）。
#
# 📌 单元测试证明不了后半段：它能证明 `updateNoteContent` 派发了一条什么 op，
#    证明不了界面上那个输入框把字符串交给了它，更证明不了它能穿过
#    op-log → 向量时钟 → E2EE → 服务端 → 另一台设备的物化。
#
# ═════════════════════════════════════════════════════════════════════════
# 四件刻意的"反假绿"设计
#
# 1. **正文带时间戳**，且断言精确相等。写死一句话的话，上一次跑剩的那条便签
#    会让"摘要变了"永远为真。
#
# 2. **`UPD` 条数判"恰好 1"，不是"≥1"**。多一条就是重复保存 / fan-out。
#    载荷的**键集合**判 `['content']`：多带一个键（比如顺手把 `updatedAt` 也写进
#    payload）就违反"一个意图一个 op"（AGENTS §3.4）。
#
# 3. **"点开看了一眼就关"必须一条 op 都不写**（第 7 步，保存与取消各测一次）。
#    `UPD` 会推进 `updatedAt`，而它是列表排序的第二段 —— 闸门没了的话，症状是
#    "我只是看了一眼，这条便签跳到最前"，全程不报错。
#    判的是**条数不变**，不是"界面没变" —— 后者即使闸门没了也照样成立。
#
# 4. **两端读数**：手机本地库（写出去的那条）+ 笔记本（node-host 真 SQLite）
#    **解密后**的 `remote` op（收进来的那条），比 `entityId` 与正文。
#    ⚠️ 服务端只存密文，**不能**按内容断言 —— 那里只数 op 条数（§7 第 52 条）。
#
# ⚠️ 两条已知边界（不假装做了）：
#   · `state` 表在真库里恒为空（状态是 op-log 派生的、不落盘 —— 实测三台旧
#     笔记本库 `count(state)=0` 而 `ops` 有 33 条）。所以"另一台设备**物化之后**
#     在界面上看到新正文"只能在手机界面层验（第 5 步），笔记本侧到此为止判
#     "收到了、解得开、是同一实体同一正文"。
#   · node-host CLI 没有 notes 子命令，而 `apps/node-host/**` 在本轮地界外
#     → 登记 BLOCKED.md。
#
# 用法：
#   bash scripts/verify-mobile-notes.sh
#   PORT=3100 bash scripts/verify-mobile-notes.sh   # 换端口起栈时
#
# 前置：模拟器在跑、服务端在该端口（TEST_MODE）、
#       /tmp/heyta_mobile_{token,email,e2ee}.txt 存在。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"
# 负载门与"别人正在用这台设备"的探测，必须在**任何破坏性动作之前**
# （`pm clear` / `install -r` 都算）—— 判据晚了，一轮无效的运行先把别人的现场清掉。
. "$(dirname "$0")/lib/wait-for-quiet-host.sh"

BUSY=$(another_mobile_e2e_running)
if [ -n "$BUSY" ]; then
  echo "❌ 这台设备上还有别的移动端验收在跑：$BUSY"
  echo "   两边都会 pm clear + 装包 + 按坐标点击，并行 = 互相清掉对方的现场，"
  echo "   报出来的满屏「找不到按钮」不是产品缺陷。等它跑完再跑这一条。"
  exit 3
fi
step "负载门"
wait_for_quiet_host || exit 3

# 独立库：与其它验收各用一份，否则会互相看到对方的便签。
LAPTOP_DB=/tmp/heyta-notes-laptop.sqlite
PHONE_DB=/tmp/heyta-notes-phone.sqlite
TAB_Y=2253
EVIDENCE="$HEYTA_REPO_ROOT/apps/mobile/evidence"
mkdir -p "$EVIDENCE"
# 🔴 起跑时间戳取在任何破坏性动作之前（第 0 步的 pm clear / install -r 都算）：
#    第 12 步原来只判 `-s`（非空），而**上一趟留下的旧图同样非空** ——
#    产物在、结论也对，只是它不属于这一趟（§7 第 27 条那一族的第三种面目）。
RUN_STARTED=$(date +%s)

# 🔴 **故意用 ASCII 正文**：`adb shell input text` 发不了非 ASCII（实测抛
#    NullPointerException，而它退出码仍可能是 0）。中文便签走 iOS 侧
#    （`verify-mobile-ios.sh` 里 `idb ui set-value` 那条路）。
NOTE_A="note-e2e-$(date +%H%M%S)-read-once"
NOTE_B="note-e2e-$(date +%H%M%S)-edited"

echo ""
echo "=== 移动端便签编辑链验收（真实模拟器，零 mock）==="
echo "  设备: $E2E_SERIAL   服务端: $SERVER"
echo "  初文: $NOTE_A"
echo "  新文: $NOTE_B"

if [ "${#TOKEN}" -lt 100 ]; then
  echo "❌ 令牌看起来不对（长度 ${#TOKEN}）—— 先跑建号脚本"; exit 1
fi
rm -f "$LAPTOP_DB" "$PHONE_DB"

# ── 辅助 ────────────────────────────────────────────────────

# 见 `verify-mobile-lists.sh` 的同名函数：release 包不可调试，只能 `adb root` + pull。
phone_db_pull() {
  $ADB root >/dev/null 2>&1; sleep 2
  $ADB pull /data/data/com.heyta/databases/heyta.sqlite "$PHONE_DB" >/dev/null 2>&1
  $ADB unroot >/dev/null 2>&1
}

# NOTE 实体某类 op 的条数。⚠️ 读数拿不到**不当作 0**：空串原样返回，
# 由调用方判"不是数字"并 `bad()` —— 否则"库没拉下来"会被读成"一条都没写"，
# 而后者听起来像产品缺陷（AGENTS §7 元规则 2）。
note_op_count() {  # <sqlite> <opType>
  sqlite3 "$1" \
    "SELECT COUNT(*) FROM ops
      WHERE json_extract(data,'\$.op.entityType')='NOTE'
        AND json_extract(data,'\$.op.opType')='$2';" 2>/dev/null | tr -d ' '
}

# 按载荷正文找 NOTE 的 entityId（那条 CRT）。
phone_note_id_by_content() {  # <sqlite> <content>
  sqlite3 "$1" \
    "SELECT json_extract(data,'\$.op.entityId') FROM ops
      WHERE json_extract(data,'\$.op.entityType')='NOTE'
        AND json_extract(data,'\$.op.payload.content')='$2'
      ORDER BY json_extract(data,'\$.seq') DESC LIMIT 1;" \
    2>/dev/null | tr -d ' '
}

# 最新一条 NOTE/UPD 的载荷 JSON，落到临时文件交给 python 判键集合
# （不在命令行里传 JSON —— 引号嵌套是 §7 里那种"grep 没跑还说没有残留"的形状）。
phone_latest_upd_payload() {  # <sqlite>
  sqlite3 "$1" \
    "SELECT json_extract(data,'\$.op.payload') FROM ops
      WHERE json_extract(data,'\$.op.entityType')='NOTE'
        AND json_extract(data,'\$.op.opType')='UPD'
      ORDER BY json_extract(data,'\$.seq') DESC LIMIT 1;" 2>/dev/null
}

# 「从列表进编辑屏」这一步在四个地方要用（第 4/7/7/8 步），抽成一个函数。
#
# 🔴 定位靠的是**无障碍名**，不是 testID：Android 的 uiautomator 里
# `content-desc` 来自 `accessibilityLabel`，而共享组件那一行的名字是
# `notes.a11y.edit` = 「编辑便签「{excerpt}」」。这个名字同时是读屏用户
# 听到的话 —— 用产品真正给出的那个可点性做判据，不另造一个只有测试能看见的钩子。
open_editor_for() {  # <正文（= 无障碍名里那段 excerpt）>
  local xy
  xy=$(scroll_to_desc "编辑便签「${1}」")
  if [ -z "$xy" ]; then
    bad "便签行上没有编辑入口（找不到无障碍名「编辑便签「${1}」」）"
    screen_txt; return 1
  fi
  $ADB shell input tap $xy; sleep 3
  dump
  if [ "$(has_text "编辑便签")" != "1" ]; then
    blame_crash "点摘要进编辑屏" || bad "点了摘要但编辑屏没打开"
    screen_txt; return 1
  fi
  return 0
}

close_editor_with() {  # <保存|取消>
  local xy
  xy=$(xy_desc "$1")
  if [ -z "$xy" ]; then bad "编辑屏上找不到「${1}」按钮"; screen_txt; return 1; fi
  $ADB shell input tap $xy; sleep 3
  dump
  if [ "$(has_text "编辑便签")" = "1" ]; then
    bad "点了「${1}」但编辑屏没关"; screen_txt; return 1
  fi
  return 0
}





step "0. 装包并启动（全新初态）"
# 🔴 先把 crash 缓冲区清空：`blame_crash` 归因的是**本趟**的崩溃，
#    而 `-b crash` 是会留旧的（上一趟 17:04 那条 FATAL 一直到本轮之后还在缓冲里）。
#    不清空的话，第一条"应用没起来"会带着**上一趟**的堆栈报出来 —— 那是假归因。
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
# 🔴 「我的」在树上是**主界面**的判据，但第一屏能不能读到它取决于三件外部事：
#    ① 系统权限弹窗（`com.google.android.permissioncontroller`）会盖住整个应用窗口，
#       `uiautomator dump` 导出的是**当前活动窗口** —— 那一刻应用节点一条都不在树里
#       （§7 第 63 条同族：无障碍树为空 ≠ 界面没画）；
#    ② 欢迎页还没点掉；
#    ③ 冷启动 + 建库本身要时间。
#    所以这里轮询而不是"dump 一次定生死"，且每轮先收掉弹窗、再补点一次欢迎页。
#    判据本身没放松：最后仍然要求「我的」真的在树上，拿不到就红。
on_main_screen=0
for i in 1 2 3 4 5; do
  dump
  if [ "$(has_text "我的")" = "1" ]; then on_main_screen=1; break; fi
  echo "   ↻ 第 ${i} 次树里没有底部标签「我的」，先收弹窗/补点欢迎页再读"
  if ! dismiss_permission_dialog; then
    echo "   ⚠️ 点了「不允许」弹窗还在（可能连着两问），这一轮先继续等"
  fi
  dismiss_welcome_if_present
  sleep 2
done
if [ "$on_main_screen" != "1" ]; then
  bad "进了前台但没落到主界面（5 轮之后底部标签「我的」仍不在树上）"
  echo "   • 当前前台：$($ADB shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | tr -d '\r')"
  echo "   • Hermes 探针：$($ADB logcat -d 2>/dev/null | grep -c 'heyta A/D Hermes probe: PASS') 条 PASS"
  screen_txt; exit 1
fi
ok "应用已启动并停在主界面"

step "1. 配置同步凭据"
require_screen
configure_sync_credentials
# 第一次唤起输入法就可能弹系统权限窗（见 `dismiss_permission_dialog` 的文件头），
# 而它是**这一步**招来的 —— 在这里收掉，下一步读到的才是应用的界面。
dismiss_permission_dialog

# ── 2. 建一条便签（编辑的前提是有东西可编辑）───────────────
step "2. 在「我的 → 便签」建一条便签：$NOTE_A"
# 🔴 坐标现取，不写死 `945 $TAB_Y`：这台模拟器 1080×2400，标签文字实测
# `bounds=[78,2271][137,2308]`，写死的 2253 落在文字**上方**的图标区。
# 这里**不用** `tap_tab`：它的第二个参数要"换页后立刻在树上"的标记，
# 而便签输入框在「我的」页**要滚动才露出来** —— 拿它当标记会让
# 一次成功的换页被读成失败，然后重试三次、点三次同一个标签。
XY=$(xy_desc "我的")
if [ -z "$XY" ]; then bad "底部标签「我的」不在树上（应用没在主界面？）"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
dismiss_permission_dialog
XY=$(scroll_to_desc "写点什么…")
if [ -z "$XY" ]; then
  bad "找不到便签输入框（滚动到「便签」段也没找到）"; screen_txt; exit 1
fi
require_screen
XY=$(scroll_to_desc "写点什么…")
if [ -z "$XY" ]; then
  bad "找不到便签输入框（滚动到「便签」段也没找到）"; screen_txt; exit 1
fi
$ADB shell input tap $XY; sleep 1.2
clear_and_type "$NOTE_A" "写点什么…"
dump
GOT=$(edit_value "写点什么…" 2>/dev/null)
if [ "$GOT" != "$NOTE_A" ]; then
  bad "便签正文不精确（期望「${NOTE_A}」，实际「${GOT}」）—— 带着脏正文往下跑没有意义"
  screen_txt; exit 1
fi
ok "已输入初文：$NOTE_A"
XY=$(scroll_to_desc "添加便签")
if [ -z "$XY" ]; then bad "找不到「添加便签」按钮"; screen_txt; exit 1; fi
$ADB shell input tap $XY; sleep 3
dump
if [ "$(has_text "$NOTE_A")" != "1" ]; then
  blame_crash "点「添加便签」" || bad "建完之后列表里没有这条便签"
  screen_txt; exit 1
fi
ok "便签已出现在列表里"

step "3. 断言：本地库里有一条 NOTE/CRT，且能按正文查到 entityId"
phone_db_pull
CRT_N=$(note_op_count "$PHONE_DB" CRT)
if ! printf '%s' "$CRT_N" | grep -qE '^[0-9]+$'; then
  bad "读不到手机库的 NOTE/CRT 计数（库没拉下来？）：$PHONE_DB"; exit 1
fi
if [ "$CRT_N" -lt 1 ]; then
  bad "本地库里没有 NOTE/CRT op —— 界面上的便签没走 op-log"; screen_txt; exit 1
fi
ok "本地库里有 $CRT_N 条 NOTE/CRT op"
NOTE_ID=$(phone_note_id_by_content "$PHONE_DB" "$NOTE_A")
if [ -z "$NOTE_ID" ]; then
  bad "按初文查不到 NOTE 的 entityId（正文没进 payload？）"; screen_txt; exit 1
fi
ok "便签落库且能按正文查到 id：$NOTE_ID"

# ── 4. 编辑入口 → 编辑屏 ───────────────────────────────────
step "4. 点摘要那段 → 编辑屏打开，输入框里是**当前正文**"
require_screen
open_editor_for "$NOTE_A"
VAL=$(edit_value "写点什么…" 2>/dev/null)
if [ "$VAL" != "$NOTE_A" ]; then
  bad "编辑屏初值不是这条便签的正文（期望「${NOTE_A}」，实际「${VAL}」）"
else
  ok "初值精确相等 —— 不是新建屏复用、也不是空草稿"
fi
$ADB exec-out screencap -p > "$EVIDENCE/android-notes-1-editor-open.png" 2>/dev/null

step "5. 改成正文 B 并保存 → 回列表、摘要变了"
XY=$(xy_desc "写点什么…")
if [ -z "$XY" ]; then
  bad "编辑屏里没有输入框"; screen_txt
else
  $ADB shell input tap $XY; sleep 1.2
  clear_and_type "$NOTE_B" "写点什么…"
  dump
  VAL=$(edit_value "写点什么…" 2>/dev/null)
  if [ "$VAL" != "$NOTE_B" ]; then
    bad "新正文没输进编辑框（期望「${NOTE_B}」，实际「${VAL}」）"; screen_txt
  else
    ok "新正文已在编辑框里"
    close_editor_with "保存"
    dump
    if [ "$(has_text "$NOTE_B")" != "1" ]; then
      bad "列表摘要仍是旧正文 —— 保存没生效到界面上"; screen_txt
    else
      ok "列表摘要已变成新正文：$NOTE_B"
    fi
  fi
fi
$ADB exec-out screencap -p > "$EVIDENCE/android-notes-2-list-after-edit.png" 2>/dev/null

step "6. 断言：恰好一条 NOTE/UPD，且载荷只有 content"
phone_db_pull
UPD_N=$(note_op_count "$PHONE_DB" UPD)
if ! printf '%s' "$UPD_N" | grep -qE '^[0-9]+$'; then
  bad "读不到手机库的 NOTE/UPD 计数"
elif [ "$UPD_N" != "1" ]; then
  bad "NOTE/UPD 不是恰好 1 条（实际 ${UPD_N}）—— 多写=重复保存/fan-out，少写=没保存"
else
  ok "恰好 1 条 NOTE/UPD —— 一次意图一条 op"
fi
printf '%s' "$(phone_latest_upd_payload "$PHONE_DB")" > /tmp/heyta-notes-upd-payload.json
python3 - "$NOTE_B" <<'PY' > /tmp/heyta-notes-payload-verdict.txt 2>&1
import json, sys
raw = open('/tmp/heyta-notes-upd-payload.json', encoding='utf-8').read().strip()
want = sys.argv[1]
if not raw:
    print('读数拿不到（载荷为空）—— 不能当"没问题"'); raise SystemExit(3)
d = json.loads(raw)
keys = sorted(d.keys())
if keys != ['content']:
    print(f'载荷键集合是 {keys}，只许 content'); raise SystemExit(2)
if d['content'] != want:
    print(f'载荷里的正文不是新正文（实际「{d["content"]}」）'); raise SystemExit(2)
print(f'键集合 = [content]，值 = 界面上那次改动')
PY
PAY_RC=$?
if [ "$PAY_RC" -eq 0 ]; then
  ok "UPD 载荷的键集合与值都判过（$(cat /tmp/heyta-notes-payload-verdict.txt)）"
else
  bad "UPD 载荷不合格（rc=${PAY_RC}）：$(cat /tmp/heyta-notes-payload-verdict.txt)"
fi

step "7. 反证：一个字不改直接保存、以及点取消 —— 都必须**一条 op 都不多写**"
# 🔴 这一档是本轮唯一一处的**行为**判据（其余都是接线），所以设备层也钉一次：
# 它挡的是变异 M2（拿掉 `packages/app-host/src/note-actions.ts` 里那句
# `if (next === current.content) return`）。只判条数，不判"界面没变"。
require_screen
BEFORE=$(note_op_count "$PHONE_DB" UPD)
# 下面这一档不是形式主义：`note_op_count` 读不到库时返回**空串**（函数注释自己要求调用方判
# "不是数字"，第 6 步判了、这里原来没判）。拉库一失败，`"$AFTER" != "$BEFORE"` 就退化成
# `"" != ""` ⇒ 恒假 ⇒ 打印"没改动 → 一条 op 都没写"。那是一条**永远通过**的判据，
# 而它挡的正是变异 M2（拿掉 note-actions.ts 里 `if (next === current.content) return`）。
if ! printf '%s' "$BEFORE" | grep -qE '^[0-9]+$'; then
  bad "第 7 步起跑前就读不到手机库的 NOTE/UPD 计数（实际「${BEFORE:-空}」）—— 探针没跑成，这一档不作数"
else
  open_editor_for "$NOTE_B"
  close_editor_with "保存"
  phone_db_pull
  AFTER=$(note_op_count "$PHONE_DB" UPD)
  if ! printf '%s' "$AFTER" | grep -qE '^[0-9]+$'; then
    bad "保存后读不到计数（改前=${BEFORE}、改后=「${AFTER:-空}」）—— 不能把'读不到'读成'没多写'"
  elif [ "$AFTER" != "$BEFORE" ]; then
  bad "没改动却多写了 op（${BEFORE} → ${AFTER}）—— 就是「看一眼就把这条顶到列表最前」那个事故形状"
  else
    ok "没改动 → 一条 op 都没写（NOTE/UPD 仍为 ${AFTER}）"
  fi
  open_editor_for "$NOTE_B"
  close_editor_with "取消"
  phone_db_pull
  CANCEL_N=$(note_op_count "$PHONE_DB" UPD)
  if ! printf '%s' "$CANCEL_N" | grep -qE '^[0-9]+$'; then
    bad "点取消后读不到计数（基线=${BEFORE}、取消后=「${CANCEL_N:-空}」）—— 同上，不作数"
  elif [ "$CANCEL_N" != "$BEFORE" ]; then
    bad "点「取消」却写了 op（${BEFORE} → ${CANCEL_N}）"
  else
    ok "点「取消」同样一条 op 都没写"
  fi
fi

step "8. 第二个宿主：任务页搜索里点开这条便签"
# 🔴 这一条是「搜索里点开便签」那个产品断点的设备级判据：`SearchPanel.onOpenNote`
# 在移动端此前**零消费点**，而共享面板对没传的形态是把那一行 `disabled` ——
# 不报错、不消失，只是点了没反应。所以判"点得开、并且开到编辑屏"。
if ! tap_tab "任务" "打开搜索"; then
  bad "切不到任务页（底部标签「任务」点不动，或任务页顶栏没有「打开搜索」入口）"
  screen_txt; exit 1
fi
require_screen
XY=$(xy_desc "打开搜索")
if [ -z "$XY" ]; then bad "任务页没有「打开搜索」入口"; screen_txt; exit 1; fi
ok "任务页顶栏有「打开搜索」入口（坐标现取：${XY}）"
$ADB shell input tap $XY; sleep 3
dump
if [ "$(has_sub "输入关键词")" != "1" ]; then
  bad "搜索浮层没打开（没有那条「输入关键词」提示）"; screen_txt; exit 1
fi
ok "搜索浮层已打开"
XY=$(xy_edit_any)
if [ -z "$XY" ]; then
  bad "搜索浮层里没有输入框"; screen_txt
else
  $ADB shell input tap $XY; sleep 1
  $ADB shell input text "$NOTE_B"; sleep 2
  dump
  if [ "$(has_text "便签")" != "1" ]; then
    bad "搜索结果里没有「便签」这一段（这个词就在这条便签的正文里）"; screen_txt
  else
    ok "搜索命中便签段"
    XY=$(xy_desc "$NOTE_B")
    if [ -z "$XY" ]; then
      bad "结果里那条便签点不开（那一行的可访问名不是正文，或它被禁用了 —— 宿主没传 onOpenNote）"
      screen_txt
    else
      $ADB shell input tap $XY; sleep 3
      dump
      if [ "$(has_text "编辑便签")" = "1" ]; then
        ok "从搜索结果点进了编辑屏（搜索浮层先关，两层 Modal 没有叠）"
        $ADB exec-out screencap -p > "$EVIDENCE/android-notes-3-from-search.png" 2>/dev/null
        close_editor_with "取消"
      else
        bad "点了便签但编辑屏没打开"; screen_txt
      fi
    fi
  fi
fi

step "9. 手机同步（上传 + 下载）"
# 同样走 tap_tab（见那条 helper 的注释）：同步按钮在「我的」页，
# 点了没切过去就会在任务页上找「同步」，两处都有那个按钮 —— 读起来一切正常。
if tap_tab "我的" "同步"; then
  ok "已回到「我的」页"
else
  echo "   ⚠️ 没能确认切到「我的」页，仍按原样继续（下一步的同步判据自己会红）" >&2
fi
if phone_sync; then ok "手机同步完成"; else bad "手机同步没成功"; screen_txt; fi
phone_db_pull
REMOTE_OPS=$(sqlite3 "$PHONE_DB" \
  "SELECT count(*) FROM ops WHERE json_extract(data,'\$.source') <> 'local';" 2>/dev/null | tr -d ' ')
if ! printf '%s' "$REMOTE_OPS" | grep -qE '^[0-9]+$'; then
  bad "读不到手机库的远端 op 条数（不是「0 条」，是**没读到**）"
elif [ "$REMOTE_OPS" -ge 1 ]; then
  ok "手机本地库里有 $REMOTE_OPS 条远端 op —— 下载这一侧真的跑通了"
else
  bad "手机本地库里远端 op 数 = 0 —— 上传可能成了，下载一条都没落地（同步只做了一半）"
  screen_txt
fi

step "10. 直接查 Postgres（服务端数得出那条 UPD 吗）"
# ⚠️ 服务端只存密文，**只能数条数**，不能按正文断言（§7 第 52 条）。
# 连接参数走 env（与 `verify-mobile-lists.sh:386-389` 同一套约定）；
# 读数不是纯数字必须 `bad()` —— "只打印不判定"就是那条判据原来的坏法。
PG_DB="${HEYTA_E2E_DB:-heyta_mobile_smoke}"
PG_USER="${HEYTA_E2E_DB_USER:-$(whoami)}"
PG_HOST="${HEYTA_E2E_DB_HOST:-127.0.0.1}"
PG_PORT="${HEYTA_E2E_DB_PORT:-5432}"
SRV_NOTE_UPD=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT count(*) FROM operations WHERE op_type='UPD' AND entity_type='NOTE'" 2>&1)
if ! printf '%s' "$SRV_NOTE_UPD" | grep -qE '^[0-9]+$'; then
  bad "读不到服务端的 NOTE/UPD 计数（库 ${PG_DB} @ ${PG_HOST}:${PG_PORT}，用户 ${PG_USER}）—— 原始输出：$(printf '%s' "$SRV_NOTE_UPD" | head -3 | tr '\n' ' ')"
else
  ok "服务端 NOTE/UPD op 数 = $SRV_NOTE_UPD"
  if [ "$SRV_NOTE_UPD" -ge 1 ]; then
    ok "那次编辑真的出去了 —— 服务端 operations 表里数得出它的 UPD"
  else
    bad "服务端 NOTE/UPD = 0 —— 界面说保存好了、也说同步了，服务端一条都没收到"
  fi
fi

step "11. 笔记本（node-host 真 SQLite）同步后**解得开**这条 UPD"
LT_SYNC=$(laptop sync)
case "$LT_SYNC" in
  *'"ok":true'*) ok "笔记本 sync 成功" ;;
  *undecryptable-ops*) ok "笔记本 sync 完成（含已知的 undecryptable-ops，见 ADR-0016）" ;;
  *) bad "笔记本 sync 失败：$LT_SYNC" ;;
esac
if [ ! -f "$LAPTOP_DB" ]; then
  bad "笔记本库不存在：$LAPTOP_DB —— 探针自己没跑成，这**不是**「对端没收到」"
else
  LT_TOTAL=$(sqlite3 "$LAPTOP_DB" 'SELECT count(*) FROM ops;' 2>/dev/null | tr -d ' ')
  LT_ROW=$(sqlite3 "$LAPTOP_DB" \
    "SELECT json_extract(data,'\$.op.entityId') || '|' || json_extract(data,'\$.op.payload.content')
      FROM ops
      WHERE json_extract(data,'\$.op.entityType')='NOTE'
        AND json_extract(data,'\$.op.opType')='UPD'
        AND json_extract(data,'\$.source')='remote'
      ORDER BY json_extract(data,'\$.seq') DESC LIMIT 1;" 2>/dev/null)
  if [ -z "$LT_ROW" ]; then
    bad "笔记本没读到任何 remote 的 NOTE/UPD —— 便签编辑没跨设备"
    echo "      笔记本 ops 总数 = ${LT_TOTAL}（为 0 说明这台设备一次都没同步成功，与协议无关）"
  else
    LT_ID=$(printf '%s' "$LT_ROW" | cut -d'|' -f1)
    LT_CONTENT=$(printf '%s' "$LT_ROW" | cut -d'|' -f2-)
    ok "笔记本解密后收到一条 remote 的 NOTE/UPD：entityId=$LT_ID"
    if [ "$LT_ID" = "$NOTE_ID" ]; then
      ok "两端 entityId 一致 —— 是同一条便签，不是恰好同正文"
    else
      bad "两端 entityId 不一致（手机=${NOTE_ID} 笔记本=${LT_ID}）"
    fi
    if [ "$LT_CONTENT" = "$NOTE_B" ]; then
      ok "笔记本读到的正文 = 界面上那次改动 —— 「手机改 → 另一台设备读到」全链路无 mock"
    else
      bad "笔记本读到的正文不是新正文（实际「${LT_CONTENT}」）"
    fi
  fi
fi

step "12. 截图证据落库（非空**且本轮新生**）"
# 🔴 这里判两件事，缺一不可：
#    · `-s`（非空）—— 挡"adb 没写出来"；
#    · mtime ≥ 起跑 —— 挡"那是上一趟留下的"。第 8 步那张在很深的成功分支里，
#      那一支没走到时旧图**照样非空**，只判前一条就会把"这一趟没拍到"印成"证据在库"。
for f in android-notes-1-editor-open.png android-notes-2-list-after-edit.png android-notes-3-from-search.png; do
  p="$EVIDENCE/$f"
  if [ ! -s "$p" ]; then
    bad "证据缺失或为空：apps/mobile/evidence/$f"; continue
  fi
  M=$(stat -f %m "$p")
  if [ "$M" -lt "$RUN_STARTED" ]; then
    bad "证据是旧的：apps/mobile/evidence/$f —— mtime $(stat -f '%Sm' -t '%m-%d %H:%M:%S' "$p") 早于本轮起跑 $(date -r "$RUN_STARTED" '+%m-%d %H:%M:%S')（非空不等于本轮拍的）"
  else
    ok "证据在库且本轮新生：apps/mobile/evidence/$f（$(stat -f %z "$p") bytes）"
  fi
done
echo "   📷 三张截图（**人必须打开看**）：编辑屏初值 / 列表摘要已变 / 从搜索结果进来的编辑屏"

summary "移动端便签编辑链"
