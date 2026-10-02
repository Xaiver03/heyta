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
# 移动端「清单」验收（真模拟器，零 mock）
# ========================================
#
# 🔴 为什么必须有这个脚本
#
# 在它之前，移动端**能把任务建出来、设日期、设优先级、设重复，但没法归类** ——
# 所有任务只能待在「收集箱」。而清单是这类产品的核心组织方式：
# 没有它，"能日常用"不成立（`docs/plans/phase-2-multi-platform.md` §3.18i）。
#
# 单元测试证明不了这条链路：
#   - `project-actions.spec.ts` 能证明 `createProject('x')` 派发了一条
#     `entityType='PROJECT'` 的 `CRT` op，但它**证明不了**界面上那个输入框
#     真的把字符串交给了它、也证明不了那条 op 落了库；
#   - 它更证明不了 `moveToProject` 写进去的 `projectId` 会**跨设备**到达 ——
#     中间隔着 op-log、向量时钟、E2EE、服务端与另一次物化。
#
# ═════════════════════════════════════════════════════════════════════════
# 这个脚本刻意做的三件"反假绿"的事
#
# 1. **清单名带时间戳**，且断言的是**这个名字**，不是"有清单了"。
#    写死一个名字的话，上一次跑剩的那条会让断言永远为真。
#
# 2. **核对的是 `projectId`（一个 id），不是清单名出现在界面上。**
#    "界面上看起来有"是本仓库反复栽过的证据（§7 第 38 条同族）。
#    名字对了而 id 没连上，是一种真实存在的坏法：任务显示在清单里，
#    但清单删掉之后任务不会回到收集箱 —— 因为它其实压根没进那个清单。
#
# 3. **两端都读 `projectId`**：手机本地库一条、
#    笔记本（node-host，真 SQLite）同步后一条，**必须相等**。
#
# 用法：
#   bash scripts/verify-mobile-lists.sh
#
# 前置：模拟器在跑、服务端在 3000（TEST_MODE）、
#       /tmp/heyta_mobile_{token,email,e2ee}.txt 存在。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

# 独立库：与其它验收各用一份，否则会互相看到对方的任务。
LAPTOP_DB=/tmp/heyta-lists-laptop.sqlite
PHONE_DB=/tmp/heyta-lists-phone.sqlite
TAB_Y=2253

# 🔴 **故意用 ASCII 名**：`adb shell input text` **发不了非 ASCII**。
#    实测传中文会抛 `java.lang.NullPointerException: Attempt to get length of null array`
#    （`InputShellCommand.sendText`）—— `input text` 走 KeyCharacterMap，
#    表里没有的字符直接炸；而且它**退出码仍是 0**的时候也有过，不能靠退出码发现。
#    中文清单名走 **iOS 侧**验证（`idb ui set-value` 能写中文，且那条路径上
#    有「添加」enabled 的 L3 断言证明应用真的收到了文字）。
LIST_NAME="proj-e2e-$(date +%H%M%S)"
TASK_TITLE="task-e2e-$(date +%H%M%S)"

echo ""
echo "=== 移动端清单验收（真实模拟器，零 mock）==="
echo "  设备: $E2E_SERIAL   服务端: $SERVER"
echo "  清单: $LIST_NAME"
echo "  任务: $TASK_TITLE"

if [ "${#TOKEN}" -lt 100 ]; then
  echo "❌ 令牌看起来不对（长度 ${#TOKEN}）—— 先跑建号脚本"; exit 1
fi
rm -f "$LAPTOP_DB" "$PHONE_DB"

# ── 辅助 ────────────────────────────────────────────────────

# 把手机的 SQLite 拉到本地再查。
# 🔴 用 `adb root` + `pull`，不用 `run-as`：release 包**不可调试**。
phone_db_pull() {
  $ADB root >/dev/null 2>&1; sleep 2
  $ADB pull /data/data/com.heyta/databases/heyta.sqlite "$PHONE_DB" >/dev/null 2>&1
  $ADB unroot >/dev/null 2>&1
}

# 手机本地库里某实体类型的 op 条数。
phone_entity_ops() {  # <sqlite> <entityType> [opType]
  local op_type="${3:-}"
  local extra=""
  if [ -n "$op_type" ]; then extra="AND json_extract(data,'\$.op.opType')='$op_type'"; fi
  sqlite3 "$1" \
    "SELECT COUNT(*) FROM ops
      WHERE json_extract(data,'\$.op.entityType')='$2' $extra;" \
    2>/dev/null | tr -d ' '
}

# 按载荷里的 `name` 找 PROJECT 的 id。
phone_project_id_by_name() {  # <sqlite> <name>
  sqlite3 "$1" \
    "SELECT json_extract(data,'\$.op.entityId') FROM ops
      WHERE json_extract(data,'\$.op.entityType')='PROJECT'
        AND json_extract(data,'\$.op.payload.name')='$2'
      ORDER BY json_extract(data,'\$.seq') DESC LIMIT 1;" \
    2>/dev/null | tr -d ' '
}

# TASK 的最新 `projectId`（含写 null 的清除）。
# 🔴 按 `seq` 取最新，不按"最后一条"—— 接口上顺序未定义（§7 第 16 条）。
phone_task_project() {  # <sqlite> <taskId>
  sqlite3 "$1" \
    "SELECT json_extract(data,'\$.op.payload.projectId') FROM ops
      WHERE json_extract(data,'\$.op.entityType')='TASK'
        AND json_extract(data,'\$.op.entityId')='$2'
        AND json_extract(data,'\$.op.payload.projectId') IS NOT NULL
      ORDER BY json_extract(data,'\$.seq') DESC LIMIT 1;" \
    2>/dev/null | tr -d ' '
}

# 见 `verify-mobile-task-edit.sh` 文件头结论 2：**RN 的 `Modal` 打开时
# 底下的屏幕不在无障碍树里**，所以"行上的状态对不对"这类断言必须
# 先关掉面板再做 —— 否则一条本来成立的断言会因为查不到节点而报红。
open_sheet() {  # <任务行的可访问名>
  local xy; xy=$(scroll_to_desc "$1")
  if [ -z "$xy" ]; then bad "找不到任务行：$1"; screen_txt; return 1; fi
  $ADB shell input tap $xy; sleep 3
  dump
  if [ "$(has_text "任务详情")" != "1" ]; then bad "详情面板没打开"; screen_txt; return 1; fi
  return 0
}
close_sheet() {
  dump
  local xy; xy=$(xy_desc "关闭任务详情")
  if [ -z "$xy" ]; then bad "找不到关闭按钮"; screen_txt; return 1; fi
  $ADB shell input tap $xy; sleep 2.5
  dump
  if [ "$(has_text "任务详情")" = "1" ]; then bad "面板没关掉"; screen_txt; return 1; fi
  return 0
}

# 在「我的」页的清单段里建一个清单。**必须先滚过去** ——
# 那一段在页面下方（y≈1200+），设备只有 874 逻辑高。
create_list_on_phone() {  # <名字>
  $ADB shell input tap 945 $TAB_Y; sleep 3   # 「我的」
  dump
  XY=$(scroll_to_desc "清单名称")
  if [ -z "$XY" ]; then bad "找不到清单名称输入框（滚动到底也没找到）"; screen_txt; return 1; fi
  $ADB shell input tap $XY; sleep 1.2
  clear_and_type "$1" "清单名称"
  dump
  # 🔴 断言的是**精确相等**，不是"包含"。实测出现过输入框里是
  # `proj-e2e-021007g`（`clear_and_type` 的读回补齐多补了一个字符）——
  # 用 `has_text` 判包含的话这个多出来的字符**永远查不出来**，
  # 而它会一路跟着这条清单同步到别的设备上。
  GOT=$(edit_value "清单名称" 2>/dev/null)
  if [ "$GOT" = "$1" ]; then
    ok "已输入清单名：$1"
  else
    bad "清单名不精确（期望「$1」，实际「${GOT}」）"; screen_txt; return 1
  fi
  XY=$(scroll_to_desc "新建清单")
  if [ -z "$XY" ]; then bad "找不到「新建清单」按钮"; screen_txt; return 1; fi
  $ADB shell input tap $XY; sleep 3
  return 0
}

step "0. 装包并启动"
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
# 全新初态：上一次跑剩的清单会让"这条清单是不是刚建的"含混。
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 6
dismiss_welcome_if_present   # 首次启动的欢迎页会盖住主界面（规范 §3.1）——先离开它
dump
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; fi

step "1. 配置同步凭据"
require_screen
configure_sync_credentials

step "2. 建一个只有标题的任务（清单归属的载体）"
$ADB shell input tap 135 $TAB_Y; sleep 3   # 「任务」
dump
XY=$(xy_desc "新建任务")
if [ -z "$XY" ]; then bad "找不到新建按钮"; screen_txt; else
  $ADB shell input tap $XY; sleep 2.5
  dump
  XY=$(xy_edit_any)
  if [ -z "$XY" ]; then bad "新建面板里找不到输入框"; else
    $ADB shell input tap $XY; sleep 1
    $ADB shell input text "$TASK_TITLE"; sleep 1.5
    dump
    [ "$(has_text "$TASK_TITLE")" = "1" ] && ok "标题已输入" || { bad "标题没输进去"; screen_txt; }
    dump
    XY=$(xy_text "添加")
    if [ -z "$XY" ]; then bad "找不到「添加」"; screen_txt; else
      $ADB shell input tap $XY; sleep 3
    fi
  fi
fi
dump
if [ "$(has_desc "打开任务：$TASK_TITLE")" != "1" ]; then
  bad "任务没创建"; screen_txt
else
  ok "任务已创建：$TASK_TITLE"
fi

step "3. 在「我的」页新建清单：$LIST_NAME"
# 这一步要在界面上找输入框和按钮 —— 拿不到真实界面就直接停（见 `require_screen`）。
require_screen
if create_list_on_phone "$LIST_NAME"; then
  dump
  # UI 层的证据：清单出现在清单列表里（刚建完就在首屏，不用滚）。
  if [ "$(has_text "$LIST_NAME")" = "1" ]; then
    ok "清单已出现在「我的」页的清单列表里"
  else
    bad "建完之后界面上看不到这条清单"; screen_txt
  fi
fi

step "4. 断言：本地库里真的多了一条 PROJECT 的 CRT op"
phone_db_pull
PROJ_OPS=$(phone_entity_ops "$PHONE_DB" PROJECT CRT)
if [ "${PROJ_OPS:-0}" -ge 1 ]; then
  ok "本地库里有 $PROJ_OPS 条 PROJECT/CRT op"
else
  bad "本地库里没有 PROJECT/CRT op —— 界面上的清单没有走 op-log"; screen_txt
fi
PROJECT_ID=$(phone_project_id_by_name "$PHONE_DB" "$LIST_NAME")
if [ -n "$PROJECT_ID" ]; then
  ok "清单落库且能按名字查到 id：$PROJECT_ID"
else
  bad "按名字查不到 PROJECT 的 entityId（清单名可能没进 payload）"; screen_txt
fi

step "5. 打开任务详情，把任务放进这条清单"
# 🔴 第 3、4 步把应用留在了「我的」页 —— 不切回「任务」页就直接找任务行，
# 会在"我的"页上找一个根本不在这一页的元素（本轮第一版就是这么错的）。
$ADB shell input tap 135 $TAB_Y; sleep 3
dump; require_screen
open_sheet "打开任务：$TASK_TITLE" || true
if [ "$(has_text "任务详情")" = "1" ]; then
  # 🔴 必须用 `scroll_to_text`：段标题是**文字节点**，不是 `content-desc`。
  # 本仓库第一版这里写的是 `scroll_to_desc`，于是"找到了才怪" ——
  # 而报出来的失败是"详情面板里找不到「清单」段"，指向的根本不是真正的原因。
  XY=$(scroll_to_text "清单")
  if [ -z "$XY" ]; then bad "详情面板里找不到「清单」段"; screen_txt; else
    ok "详情面板里有「清单」段"
    # 「收集箱」必须也在，它是**未归类**的选项 ——
    # 少了它，用户把任务移进清单之后就再也移不回来。
    dump
    if [ "$(has_text "收集箱")" = "1" ]; then
      ok "「收集箱」选项也在（能把任务移出清单）"
    else
      bad "没有「收集箱」选项 —— 任务进清单后就出不来了"; screen_txt
    fi
    dump
    XY=$(scroll_to_text "$LIST_NAME")
    if [ -z "$XY" ]; then bad "详情面板里找不到清单「${LIST_NAME}」"; screen_txt; else
      $ADB shell input tap $XY; sleep 3
      ok "已点选清单「${LIST_NAME}」"
    fi
  fi
  close_sheet || true
else
  bad "详情面板没打开"; screen_txt
fi

step "6. 断言：任务的 op 里真的写了 projectId（且等于清单那个 id）"
phone_db_pull
# 🔴 这里取的是"**最新一条**带 projectId 的 TASK op"，而不是按任务 id 过滤 ——
# 因为任务 id 从列表行上读不到（无障碍名里只有标题）。
# 这么写是**有前提的**：第 2 步只建了一条任务，且它是新建（载荷里没有 projectId）。
# 前提不成立时这个值会指向别的任务 —— 所以下面第 9 步会用**笔记本侧
# 同一条标题的任务**再交叉验证一次；两步都过，才说明这条归属真的属于这条任务。
TASK_PROJECT=$(sqlite3 "$PHONE_DB" \
  "SELECT json_extract(data,'\$.op.payload.projectId') FROM ops
    WHERE json_extract(data,'\$.op.entityType')='TASK'
      AND json_extract(data,'\$.op.payload.projectId') IS NOT NULL
    ORDER BY json_extract(data,'\$.seq') DESC LIMIT 1;" 2>/dev/null | tr -d ' ')

if [ -n "$TASK_PROJECT" ]; then
  ok "任务的 op 里写了 projectId：$TASK_PROJECT"
  if [ "$TASK_PROJECT" = "$PROJECT_ID" ]; then
    ok "任务挂的正是刚建的那条清单（id 相等）"
  else
    bad "任务挂的清单 id 与新建的不是同一条（任务=$TASK_PROJECT 清单=${PROJECT_ID}）"
  fi
else
  bad "任务的 op 里没有 projectId —— 点选没有真的写进去"; screen_txt
fi

step "7. 手机同步（上传 + 下载）"
# 同步按钮在「我的」页。
$ADB shell input tap 945 $TAB_Y; sleep 3
if phone_sync; then ok "手机同步完成"; else bad "手机同步没成功"; screen_txt; fi

# 🔴 「同步完成」还不够 —— 必须**真的拉到了远端 op**。
#
# 这一条是本轮补上的关键判据。原来的脚本只判 `wait_synced`（界面说同步成了），
# 于是"上传成功 + 下载整批作废"这种半瘫状态会被判成通过：界面上的清单和任务确实
# 都在（那是本地写的），而**本地库里的远端 op 数是 0** ——
# 一台永远收不到别的设备数据的机器，看起来完全健康。
#
# 实测（2026-09-27）：上传响应里搭车的 op 有一条解不开，整次同步死在 upload 阶段，
# `download()` 根本没执行。详见 ADR-0016 §6。
phone_db_pull
REMOTE_OPS=$(sqlite3 "$PHONE_DB" \
  "SELECT count(*) FROM ops WHERE json_extract(data,'\$.source') <> 'local';" 2>/dev/null | tr -d ' ')
if [ "${REMOTE_OPS:-0}" -ge 1 ]; then
  ok "手机本地库里有 $REMOTE_OPS 条远端 op —— 下载这一侧真的跑通了"
else
  bad "手机本地库里远端 op 数 = 0 —— 上传可能成了，但下载一条都没落地（同步只做了一半）"
  screen_txt
fi

step "8. 断言：笔记本（node-host 真 SQLite）同步后读到同一条清单"
# 🔴 这里**不能**用 `laptop_ok sync`：笔记本的库里有 `user:37` 早期用另一代口令
# 加密的 op（serverSeq 6、7），所以 `sync` 会以 `undecryptable-ops` 收尾。
# 按 ADR-0016，**这不是失败**：好的 op 已经逐条应用、游标也已经推进，
# 只是把解不开的那几条如实报出来。`wait_laptop_has` 早就是这么判的，
# 这里跟着它走 —— 否则一条与本功能无关的历史遗留会让整轮验收报红（假红掩盖真问题）。
LT_SYNC=$(laptop sync)
case "$LT_SYNC" in
  *'"ok":true'*) ok "笔记本 sync 成功" ;;
  *undecryptable-ops*) ok "笔记本 sync 完成（含已知的 undecryptable-ops，见 ADR-0016）" ;;
  *) bad "笔记本 sync 失败：$LT_SYNC" ;;
esac
LT_PROJECTS=$(laptop projects)
echo "      $LT_PROJECTS" | head -c 300; echo
LT_MATCH=$(printf '%s' "$LT_PROJECTS" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
print(next((p['id'] for p in d.get('projects',[]) if p['name']=='$LIST_NAME'),''))
")
if [ -n "$LT_MATCH" ]; then
  ok "笔记本读到了清单「${LIST_NAME}」：$LT_MATCH"
  if [ "$LT_MATCH" = "$PROJECT_ID" ]; then
    ok "两端清单 id 一致（${PROJECT_ID}）—— 清单真的跨设备同步了"
  else
    bad "两端清单 id 不一致（手机=$PROJECT_ID 笔记本=${LT_MATCH}）"
  fi
else
  bad "笔记本没读到清单「${LIST_NAME}」—— 清单没同步过去"; screen_txt
fi

step "9. 断言：笔记本读到的任务也挂在同一条清单上"
LT=$(laptop list --all)
LT_TASK_PROJECT=$(printf '%s' "$LT" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
print(next((t.get('projectId') or '' for t in d.get('tasks',[]) if t['title']=='$TASK_TITLE'),''))
")
if [ -n "$LT_TASK_PROJECT" ]; then
  ok "笔记本上这条任务的 projectId = $LT_TASK_PROJECT"
  if [ "$LT_TASK_PROJECT" = "$PROJECT_ID" ]; then
    ok "任务归属跨设备一致 —— 「建清单 → 归入 → 另一台设备读到」全链路无 mock"
  else
    bad "笔记本上的归属与手机不一致（笔记本=$LT_TASK_PROJECT 手机=${PROJECT_ID}）"
  fi
else
  bad "笔记本上这条任务没有 projectId —— 归属没同步过去"; screen_txt
fi

step "10. 直接查 Postgres"
psql -h 127.0.0.1 -p 5432 -U rocalight -d heyta_mobile_smoke -tAc \
  "SELECT count(*) FROM operations WHERE op_type='CRT' AND entity_type='PROJECT'" 2>/dev/null \
  | sed 's|^|      服务端 PROJECT/CRT op 数 = |'

summary "移动端清单闭环"
