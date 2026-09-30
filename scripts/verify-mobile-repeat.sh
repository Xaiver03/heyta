#!/bin/bash
#
# 移动端重复任务验收（真模拟器，零 mock）
# ========================================
#
# 🔴 为什么必须有这个脚本
#
# 重复任务的**规则数学**被 `packages/domain/tests/recurrence.spec.ts` 覆盖了，
# **动作语义**被 `packages/app-host/tests/repeat-actions.spec.ts` 覆盖了
# （含"设一次重复只许产生一条 op""完成后顺延""提前勾选也往后推"）。
#
# 但那些测试一个都证明不了下面这些**接线**：
#
#   - 界面上那个「每周」按钮点下去，真的走到了 `setRepeat`，
#     而且用的锚点与界面显示的星期是同一天；
#   - 手机本地真的**只**多了一条 op（一个用户意图 = 一个 op，§3.4）；
#   - 那条 op 真的同步到了另一台设备（不是"本地看起来对"）；
#   - 在**手机**上勾选完成，推进的是**到期日**而不是把它标成已完成 ——
#     而且另一台设备看到的是同一个新到期日。
#
# 这些正是"能日常用"与"看起来能用"的区别，而它们的失效方式全是**静默**的：
# 规则存对了但锚点偏一天、op 拆成了两条、勾选把它标成已完成然后从列表里消失。
#
# ─────────────────────────────────────────────────────────────────────────
# 🔴 判据的独立来源
#
# "今天"取自**设备时钟**（`adb shell date`），星期几与两个后续日期由
# **宿主机上的 Python** 算（`datetime`），中文星期名也在那边另拼一遍。
# 不用 `@heyta/domain` 自己算期望值 —— 那样规则整体偏一天时它仍然自洽，
# 断言会全绿（日历验收里那条"永远不会失败"的断言就是这么来的）。
# ─────────────────────────────────────────────────────────────────────────
# 🔴 两个已知陷阱（都在别的脚本里踩过，这里直接规避）
#
# 1. **看退出码时不要接管道。** `bash 脚本 | sed` 的退出码取自 `sed`，
#    脚本自己的 `exit 1` 会被吃掉（实测报过 7 项失败却 `exit code: 0`）。
#    要判退出码就 `bash 脚本; echo $?`。
# 2. 🔴 **`laptop list` 读的是笔记本的本地库 —— sync 之前它是旧的。**
#    第一版第 11/13 步没让笔记本下载就读，得到 5 条假红；
#    第 14 步还因此让笔记本基于旧日期完成任务，撞出一个真的并发冲突。
#    **跨设备断言的前置条件不是"另一个设备做过什么"，而是"它下载过"。**
# 3. **`uiautomator dump` 需要界面静止。** 转圈/计时器运行中 dump 会失败
#    **且不覆盖** `/tmp/ui.xml`，于是 `cat` 出来的是上一屏 —— 假红与假绿
#    都会出现。本脚本每一步 dump 前都有 sleep，且详情面板是静态的。
#
set -u

. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
heyta_e2e_ensure_account || exit 1

# 常量、定位器、断言与"笔记本设备"辅助全部在共享库里。
. "$(dirname "$0")/lib/mobile-e2e.sh"

TASK_TITLE="repeat-e2e-$(date +%H%M%S)"
LAPTOP_DB=/tmp/heyta-repeat-laptop.sqlite
PHONE_DB=/tmp/heyta-repeat-phone.sqlite
rm -f "$LAPTOP_DB" "$PHONE_DB"

# 🔴 坐标**由 tab 数量推导**，不许再手写一个数：底部栏是 **5 个平级 tab**
# （任务/日历/专注/分类/我的，见 `apps/mobile/src/nav/TabBar.tsx`），
# 1080 宽均分 ⇒ 中心 = 1080/5 × (i + 0.5) = **108 / 324 / 540 / 756 / 972**。
# ⚠️ 这里曾经是 135/405/675/945 —— 那是**4 个 tab 时代**的值，
# 换成 5 tab 之后没人改，于是一整批 E2E 一直在点错位置。
# 2026-09-28：TAB_FOCUS 被单独修正过（675→540），但同一文件里的
# TAB_TASKS / TAB_PROFILE 没跟着改 —— "改了一处、漏了其余的"。
# 2026-09-28 晚：一度新增第 6 个 tab「四象限」（插在「任务」之后），
# 坐标整体换成 6 tab 的（90/270/450/630/810/990）。
# 🔴 P10 撤销了那个 tab（它违反 ADR-0015 §4），坐标**回到 5 tab** 的推导值。
# 见 `docs/plans/multi-platform-adaptation.md` 的 P10。这一步不许省：坐标不改，
# 脚本会**点错 tab 却照样"通过"或莫名失败**。
TAB_TASKS=108
TAB_PROFILE=972
TAB_Y=2253

# ── 辅助 ────────────────────────────────────────────────────

# 把手机的 SQLite 拉到本地再查。
#
# 🔴 用 `adb root` + `pull`，不用 `run-as`：release 包**不可调试**。
phone_db_pull() {
  $ADB root >/dev/null 2>&1; sleep 2
  $ADB pull /data/data/com.heyta/databases/heyta.sqlite "$PHONE_DB" >/dev/null 2>&1
  $ADB unroot >/dev/null 2>&1
}

# 手机本地库里，**载荷里带某字段**的 TASK op 条数。
#
# ⚠️ JSON 路径是 `$.op.payload.<字段>` —— `data` 列是
# `{op:{...}, source, applyStatus, uploadStatus, seq}` 的嵌套结构。
# `IS NOT NULL` 是刻意的：清除类字段写的是 `null`，那条 op **带这个键但不该被数进来**。
phone_ops_with_field() {  # <sqlite> <任务id> <字段名> [opType]
  local op_type="${4:-}"
  local extra=""
  if [ -n "$op_type" ]; then extra="AND json_extract(data,'\$.op.opType')='$op_type'"; fi
  sqlite3 "$1" \
    "SELECT COUNT(*) FROM ops
      WHERE json_extract(data,'\$.op.entityType')='TASK'
        AND json_extract(data,'\$.op.entityId')='$2'
        AND json_extract(data,'\$.op.payload.$3') IS NOT NULL
        $extra;" \
    2>/dev/null | tr -d ' '
}

# 真正生效的那个值：按 `seq` 取**最新**一条带该字段的 op。
#
# 🔴 不能按 `getOpsForEntity` 那种"取最后一条"的写法 —— 接口上顺序未定义
# （见 AGENTS.md §7 第 16 条）。`seq` 是存储层自己维护的单调序号，是确定性的。
phone_field() {  # <sqlite> <任务id> <字段名> [opType]
  local op_type="${4:-}"
  local extra=""
  if [ -n "$op_type" ]; then extra="AND json_extract(data,'\$.op.opType')='$op_type'"; fi
  sqlite3 "$1" \
    "SELECT json_extract(data,'\$.op.payload.$3') FROM ops
      WHERE json_extract(data,'\$.op.entityType')='TASK'
        AND json_extract(data,'\$.op.entityId')='$2'
        AND json_extract(data,'\$.op.payload.$3') IS NOT NULL
        $extra
      ORDER BY json_extract(data,'\$.seq') DESC LIMIT 1;" \
    2>/dev/null | tr -d ' '
}

# 某字段在手机本地**被写过几次**（含写 `null` 的清除）—— 用于"设了几次重复"。
phone_field_writes() {  # <sqlite> <任务id> <字段名>
  sqlite3 "$1" \
    "SELECT COUNT(*) FROM ops
      WHERE json_extract(data,'\$.op.entityType')='TASK'
        AND json_extract(data,'\$.op.entityId')='$2'
        AND json_extract(data,'\$.op.payload.$3') IS NOT NULL;" \
    2>/dev/null | tr -d ' '
}

# 🔴 **笔记本必须先 `sync` 再读。** `laptop list` 读的是**本地库**，
# 而本地库只有 sync 之后才有别人的改动 —— 这是我在第一版里漏掉的一步，
# 代价是 5 条假红（第 11/13/14 步），而且第 14 步的症状特别有误导性：
# 笔记本基于**旧到期日**去完成任务，于是产生一个**真的并发冲突**
# （服务端如实报 CONFLICT_CONCURRENT），看起来像"同步坏了"。
#
# 有趣的是那次冲突本身就是证据 —— 它的 remote op 载荷里写着
# `{"dueDate":1790956800000}`，正是手机推进后的到期日：
# 数据**已经到了服务端**，只是笔记本没下载。**假红也会留下真线索。**
laptop_pull() {
  if laptop_ok sync >/dev/null; then
    return 0
  fi
  echo "      ⚠️ 笔记本下载失败（本地库可能仍是旧的，随后的断言不可信）"
  return 1
}

# 笔记本读到的某个字段（`list --all` 里的，取最后匹配上的那条任务）。
laptop_field() {  # <任务id> <字段名>
  laptop list --all | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
t=next((t for t in d.get('tasks',[]) if t['id']=='$1'),None)
if t is None: print(''); raise SystemExit
v=t.get('$2')
print('' if v is None else v)
"
}

# ── 期望值：设备时钟 + 宿主机 Python ────────────────────────

step "0. 期望值（独立来源：设备时钟 + Python 算的星期与后续日期）"
DEV_DATE=$($ADB shell date +%Y-%m-%d 2>/dev/null | tr -d '\r')
if [ -z "$DEV_DATE" ]; then
  echo "❌ 读不到设备日期，后面的期望值全部不可信 —— 停止"
  exit 1
fi
ok "设备日期 $DEV_DATE"

EXPECT=$(python3 - "$DEV_DATE" <<'PY'
import datetime, sys
d = datetime.date.fromisoformat(sys.argv[1])
# RRULE 的 BYDAY 取值，按 Python 的 weekday()（0=周一）索引
BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
# 中文星期名在这里**另拼一遍** —— 这正是"独立来源"的意义：
# 领域层的 isoWeekday 若偏了一天，两边拼出来的字符串就不一样。
CN = ['一', '二', '三', '四', '五', '六', '日']
due = d                              # 锚点 = 今天
nxt = d + datetime.timedelta(days=7)  # 第一次完成后应推进到这里
nxt2 = d + datetime.timedelta(days=14)  # 第二次完成后
def ms(x):
    return int(datetime.datetime(x.year, x.month, x.day).timestamp() * 1000)
print(BYDAY[d.weekday()])
print(CN[d.weekday()])
print(f'FREQ=WEEKLY;INTERVAL=1;BYDAY={BYDAY[d.weekday()]}')
print(f'每周{CN[d.weekday()]}')
print(due.isoformat())
print(nxt.isoformat())
print(nxt2.isoformat())
print(ms(due))
print(ms(nxt))
print(ms(nxt2))
PY
)
BYDAY=$(printf '%s' "$EXPECT" | sed -n 1p)
CN_WEEKDAY=$(printf '%s' "$EXPECT" | sed -n 2p)
EXPECT_RULE=$(printf '%s' "$EXPECT" | sed -n 3p)
EXPECT_LABEL=$(printf '%s' "$EXPECT" | sed -n 4p)
DUE_DATE=$(printf '%s' "$EXPECT" | sed -n 5p)
NEXT_DATE=$(printf '%s' "$EXPECT" | sed -n 6p)
NEXT2_DATE=$(printf '%s' "$EXPECT" | sed -n 7p)
DUE_MS=$(printf '%s' "$EXPECT" | sed -n 8p)
NEXT_MS=$(printf '%s' "$EXPECT" | sed -n 9p)
NEXT2_MS=$(printf '%s' "$EXPECT" | sed -n 10p)
ok "锚点 ${DUE_DATE}（星期${CN_WEEKDAY}）→ 规则 ${EXPECT_RULE}，显示「${EXPECT_LABEL}」"
ok "完成后应推进到 ${NEXT_DATE}，再完成一次到 $NEXT2_DATE"

# ── 开始 ────────────────────────────────────────────────────
echo ""
echo "=== 移动端重复任务验收（真实模拟器 + 真服务端 + 真笔记本设备，零 mock）==="
echo "  设备: emulator-5554   服务端: $SERVER   库: heyta_mobile_smoke"
echo "  账号: $EMAIL"
echo "  任务: ${TASK_TITLE}（截止 ${DUE_DATE}，每周重复）"

if [ "${#TOKEN}" -lt 100 ]; then
  echo "❌ 令牌看起来不对（长度 ${#TOKEN}）—— 先跑建号脚本"; exit 1
fi

step "1. 装包并启动"
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
# 🔴 清掉本地数据：上一次跑到一半会留下任务，让 op 计数与列表断言含混。
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
launch_app; sleep 12
dismiss_welcome_if_present   # 首次启动的欢迎页会盖住主界面（规范 §3.1）——先离开它
[ -n "$($ADB shell pidof $PKG 2>/dev/null | tr -d '\r')" ] && ok "应用已启动" || bad "应用没起来"

step "2. 配置同步凭据"
configure_sync_credentials

step "3. 首次同步（含一次纯 JS 的 Argon2id 派生）"
$ADB shell input tap $TAB_PROFILE $TAB_Y; sleep 3
dump
if XY=$(tap_label "立即同步"); then
  echo "     首次同步含密钥派生，等待中…（最长等 900 秒）"
  T=$(wait_synced 180)
  if [ -n "$T" ]; then ok "首次同步成功（耗时约 $T 秒）"; else bad "首次同步未完成"; fi
else
  bad "找不到「立即同步」按钮"
fi

step "4. 笔记本建一个**有截止日**的任务并同步（跨设备的起点）"
# 从另一台设备造数据：它一次证明两件事 —— 截止日真的同步到了手机，
# 以及手机设重复时用的锚点是**那个同步过来的日子**，不是"它自己以为的今天"。
LAPTOP_ADD=$(laptop add "$TASK_TITLE" --due "$DUE_DATE")
if printf '%s' "$LAPTOP_ADD" | grep -q '"ok":true'; then
  TASK_ID=$(printf '%s' "$LAPTOP_ADD" | python3 -c "
import json,sys
print(json.load(sys.stdin).get('id',''))
" 2>/dev/null)
  if [ -n "$TASK_ID" ]; then
    ok "笔记本已创建任务（截止 ${DUE_DATE}）：$TASK_ID"
  else
    bad "笔记本建了任务但取不到 id：$LAPTOP_ADD"
  fi
  if laptop_ok sync >/dev/null; then ok "笔记本已同步到服务端"; else bad "笔记本同步失败"; fi
else
  TASK_ID=""
  bad "笔记本建任务失败：$LAPTOP_ADD"
fi

step "5. 手机同步，拿到笔记本那条任务"
$ADB shell input tap $TAB_PROFILE $TAB_Y; sleep 3
dump
if XY=$(tap_label "立即同步"); then
  T=$(wait_synced 180)
  if [ -n "$T" ]; then ok "手机同步完成（约 $T 秒）"; else bad "手机同步未完成"; fi
else
  bad "找不到「立即同步」按钮"
fi

step "6. 任务页出现该任务，且**还没有**重复标记（反向基线）"
$ADB shell input tap $TAB_TASKS $TAB_Y; sleep 3
dump
if [ -z "$TASK_ID" ]; then
  bad "没有任务 id，后面所有 op 断言都无从谈起 —— 跳过"
else
  if [ "$(has_text "$TASK_TITLE")" = "1" ]; then
    ok "任务行已出现：「${TASK_TITLE}」"
  else
    bad "任务页里没有「${TASK_TITLE}」（同步没到或没渲染）"
  fi
  # 🔴 反向基线：设重复**之前**不该出现任何重复文案。
  # 没有这条的话，"行上有重复标记"这条断言分不清"设成功了"与"一直都显示"。
  if [ "$(has_sub "$EXPECT_LABEL")" = "1" ]; then
    bad "还没设重复，任务行上就已经有「${EXPECT_LABEL}」了 —— 标记是假的"
  else
    ok "尚未设重复，行上没有重复标记（基线成立）"
  fi
fi

step "7. 打开任务详情：出现「重复」区块与四个预设"
TASK_XY=$(xy_text "$TASK_TITLE")
if [ -z "$TASK_XY" ]; then
  bad "点不到任务行，后面的界面操作做不下去"
else
  $ADB shell input tap $TASK_XY; sleep 3
  dump
  if [ "$(has_text "重复")" = "1" ] || [ "$(has_desc_sub "重复")" = "1" ]; then
    ok "详情面板里有「重复」区块"
  else
    bad "详情面板里没有「重复」区块（界面没接上）"
  fi
  MISSING=""
  for c in 不重复 每天 每周 工作日 每月; do
    [ "$(has_desc "$c")" = "1" ] || MISSING="$MISSING $c"
  done
  if [ -z "$MISSING" ]; then
    ok "五个选项都在：不重复 / 每天 / 每周 / 工作日 / 每月"
  else
    bad "重复选项缺：$MISSING"
  fi
fi

step "8. 🔴 点「每周」→ 手机本地**恰好一条** op 带 repeatRule，且锚点是同步来的那个截止日"
if [ -z "$TASK_ID" ]; then
  bad "没有任务 id —— 跳过"
else
  phone_db_pull
  BEFORE=$(phone_ops_with_field "$PHONE_DB" "$TASK_ID" repeatRule)
  echo "     点击前带 repeatRule 的 op 数：$BEFORE"
  if XY=$(tap_label "每周"); then
    sleep 2
    phone_db_pull
    AFTER=$(phone_ops_with_field "$PHONE_DB" "$TASK_ID" repeatRule)
    GOT_RULE=$(phone_field "$PHONE_DB" "$TASK_ID" repeatRule)
    GOT_ANCHOR=$(phone_field "$PHONE_DB" "$TASK_ID" repeatDtstart)

    # 🔴 §3.4：**一个用户意图 = 一个 op**。多出一条就说明"设重复"被拆成了两次写入，
    # 而那会产生"任务指着一个还不存在的规则"这样的中间态。
    if [ "$AFTER" = "$((BEFORE + 1))" ]; then
      ok "设一次重复只产生了 1 条 op（$BEFORE → ${AFTER}）"
    else
      bad "设一次重复产生了 $((AFTER - BEFORE)) 条带 repeatRule 的 op，应该恰好 1 条（§3.4）"
    fi
    if [ "$GOT_RULE" = "$EXPECT_RULE" ]; then
      ok "规则正确：$GOT_RULE"
    else
      bad "落库的规则是「${GOT_RULE}」，期望「${EXPECT_RULE}」"
    fi
    # 锚点必须是**同步过来的截止日**。若界面拿"今天"当锚点而任务截止日是别的日子，
    # "每周"就会高亮着却对应另一天 —— 界面上没有任何地方会显示这件事。
    if [ "$GOT_ANCHOR" = "$DUE_DATE" ]; then
      ok "锚点正确：${GOT_ANCHOR}（就是这条任务的截止日）"
    else
      bad "锚点是「${GOT_ANCHOR}」，期望「${DUE_DATE}」—— 锚点没跟着截止日走"
    fi
  else
    bad "找不到「每周」这个选项"
  fi
fi

step "9. 详情面板显示「当前：${EXPECT_LABEL}」"
dump
if [ "$(has_sub "当前：$EXPECT_LABEL")" = "1" ]; then
  ok "面板上显示了当前规则：「当前：${EXPECT_LABEL}」"
else
  # 描述可能被 ScrollView 裁掉，滚一下再找
  if XY=$(scroll_to_text "当前：$EXPECT_LABEL"); then
    ok "面板上显示了当前规则（滚动后可见）：「当前：${EXPECT_LABEL}」"
  else
    bad "面板上没有「当前：${EXPECT_LABEL}」这个说明"
  fi
fi

step "10. 关闭面板 → 任务行上出现重复标记"
# 用右上角那个**有名字**的关闭按钮，不点遮罩：遮罩的 bounds 覆盖整屏，
# 中心点会落在面板上（日历/编辑验收都实测踩过）。
if XY=$(tap_label "关闭任务详情"); then
  sleep 3
  dump
  if [ "$(has_sub "$EXPECT_LABEL")" = "1" ]; then
    ok "任务行上出现了重复标记：「${EXPECT_LABEL}」"
  else
    bad "关掉面板后，任务行上没有「${EXPECT_LABEL}」"
  fi
  # 面板必须真的关掉了 —— 否则后面点勾选框会打到面板上
  if [ "$(has_text "$TASK_TITLE")" = "1" ]; then
    ok "面板已关闭，列表回来了"
  else
    bad "面板没关掉（列表不可见）"
  fi
else
  bad "找不到「关闭任务详情」按钮"
fi

step "11. 手机同步 → 笔记本读到重复规则（跨设备）"
$ADB shell input tap $TAB_PROFILE $TAB_Y; sleep 3
dump
if XY=$(tap_label "立即同步"); then
  T=$(wait_synced 180)
  if [ -n "$T" ]; then ok "手机同步完成（约 $T 秒）"; else bad "手机同步未完成"; fi
else
  bad "找不到「立即同步」按钮"
fi
# 🔴 先下载再读。少了这一步，下面两条断言读的是笔记本**同步前**的旧状态。
if laptop_pull; then ok "笔记本已下载（读到手机上传的变更）"; else bad "笔记本下载失败"; fi
L_RULE=$(laptop_field "$TASK_ID" repeatRule)
L_ANCHOR=$(laptop_field "$TASK_ID" repeatDtstart)
if [ "$L_RULE" = "$EXPECT_RULE" ]; then
  ok "笔记本读到了规则：$L_RULE"
else
  bad "笔记本读到的规则是「${L_RULE}」，期望「${EXPECT_RULE}」—— 规则没同步过去"
fi
if [ "$L_ANCHOR" = "$DUE_DATE" ]; then
  ok "笔记本读到了锚点：$L_ANCHOR"
else
  bad "笔记本读到的锚点是「${L_ANCHOR}」，期望「${DUE_DATE}」"
fi

step "12. 🔴 在**手机**上勾选完成 → 到期日推进，且**没有**被标成已完成"
$ADB shell input tap $TAB_TASKS $TAB_Y; sleep 3
dump
# 勾选框的无障碍名是「完成：<标题>」；勾选后变成「取消完成：<标题>」。
if XY=$(tap_label "完成：$TASK_TITLE"); then
  sleep 3
  phone_db_pull
  GOT_DUE=$(phone_field "$PHONE_DB" "$TASK_ID" dueDate)
  DONE_WRITES=$(phone_ops_with_field "$PHONE_DB" "$TASK_ID" completedAt)
  if [ "$GOT_DUE" = "$NEXT_MS" ]; then
    ok "到期日已推进到 ${NEXT_DATE}（${GOT_DUE}）"
  else
    bad "到期日是「${GOT_DUE}」，期望 ${NEXT_DATE}（${NEXT_MS}）—— 没有顺延"
  fi
  # 🔴 这条是本功能的核心：标成完成的话它掉进「已完成」并且**再也不会回来**，
  # 用户下周就看不到它了。所以"没有 completedAt"必须显式断言。
  if [ "$DONE_WRITES" = "0" ]; then
    ok "没有被标成已完成（completedAt 一次都没写过）—— 它仍然是待办"
  else
    bad "写入了 $DONE_WRITES 次 completedAt —— 重复任务被误标成已完成"
  fi
  # 勾选后仍应留在待办列表里
  dump
  if [ "$(has_text "$TASK_TITLE")" = "1" ]; then
    ok "任务仍然留在列表里（说明是「顺延」而不是「消失」）"
  else
    bad "勾选后任务从列表里消失了 —— 它被当成普通任务完成了"
  fi
else
  bad "找不到勾选框「完成：${TASK_TITLE}」"
fi

step "13. 手机同步 → 笔记本看到同一个新到期日，且仍未完成（跨设备一致）"
$ADB shell input tap $TAB_PROFILE $TAB_Y; sleep 3
dump
if XY=$(tap_label "立即同步"); then
  T=$(wait_synced 180)
  if [ -n "$T" ]; then ok "手机同步完成（约 $T 秒）"; else bad "手机同步未完成"; fi
else
  bad "找不到「立即同步」按钮"
fi
if laptop_pull; then ok "笔记本已下载（读到手机推进后的到期日）"; else bad "笔记本下载失败"; fi
L_DUE=$(laptop_field "$TASK_ID" dueDate)
L_DONE=$(laptop_field "$TASK_ID" completedAt)
if [ "$L_DUE" = "$NEXT_MS" ]; then
  ok "笔记本读到的到期日也是 $NEXT_DATE"
else
  bad "笔记本读到的到期日是「${L_DUE}」，期望 $NEXT_MS —— 顺延没同步过去"
fi
if [ -z "$L_DONE" ]; then
  ok "笔记本上它仍然是未完成（没有 completedAt）"
else
  bad "笔记本上它被标成了已完成（completedAt=${L_DONE}）"
fi

step "14. 🔴 反向：在**笔记本**上完成同一任务 → 同步回手机，手机的到期日再推进 7 天"
# 这一步证明"顺延"是**设备无关**的产品语义，而不是手机壳里的一段特殊逻辑。
# 如果它只写在手机里，这一步会失败 —— 而两台设备从此对同一条任务各说各话。
# 🔴 **完成之前必须先下载。** 否则笔记本是按**旧到期日**算的：
# 它算出来的"下一次"会是 2026-10-03（而不是 2026-10-10），并且因为
# 本地还没有重复规则，它会当成普通任务写 `completedAt` ——
# 两处都不对，而根因只是"没先下载"。第一版就是这样，还撞出一个真冲突。
if laptop_pull; then ok "笔记本已下载到最新到期日（完成前的前提）"; else bad "笔记本下载失败"; fi
L_DUE_BEFORE=$(laptop_field "$TASK_ID" dueDate)
if [ "$L_DUE_BEFORE" = "$NEXT_MS" ]; then
  ok "笔记本手上的到期日已是 ${NEXT_DATE}（顺延后的值）"
else
  bad "笔记本手上的到期日仍是「${L_DUE_BEFORE}」，期望 $NEXT_MS —— 后面的顺延结果会连带错"
fi

if laptop complete "$TASK_ID" >/dev/null 2>&1; then
  ok "笔记本上已勾选完成"
else
  bad "笔记本上勾选完成失败"
fi
if laptop_ok sync >/dev/null; then ok "笔记本已同步"; else bad "笔记本同步失败"; fi

$ADB shell input tap $TAB_PROFILE $TAB_Y; sleep 3
dump
if XY=$(tap_label "立即同步"); then
  T=$(wait_synced 180)
  if [ -n "$T" ]; then ok "手机同步完成（约 $T 秒）"; else bad "手机同步未完成"; fi
else
  bad "找不到「立即同步」按钮"
fi
phone_db_pull
GOT_DUE2=$(phone_field "$PHONE_DB" "$TASK_ID" dueDate)
if [ "$GOT_DUE2" = "$NEXT2_MS" ]; then
  ok "手机上的到期日已推进到 $NEXT2_DATE —— 笔记本上的完成也走同一条顺延语义"
else
  bad "手机上的到期日是「${GOT_DUE2}」，期望 ${NEXT2_DATE}（${NEXT2_MS}）"
fi

summary "移动端重复任务"