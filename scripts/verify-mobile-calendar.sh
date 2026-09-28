#!/bin/bash
#
# 移动端日历验收（真模拟器，零 mock）
# ====================================
#
# 🔴 为什么必须有这个脚本
#
# 日历的**数学**已经被 `packages/domain/tests/calendar.spec.ts` 覆盖了
# （`monthGrid` 的 6×7 网格、周一开头、补白格、`parseLocalDate` 的范围校验）。
# 但单元测试证明不了**接线**：算对了的网格有没有真的画到屏幕上、用户点的那一格
# 对应的是不是他以为的那一天、另一个设备建的任务有没有落在**正确的那一天**。
#
# 这三件事之间隔着 React 的一次 `map`、一个 `Pressable` 的 onPress 参数、
# 以及一次同步 —— 而那正是最容易接错的地方（"全部都用同一个日期"这种错误
# 会让界面看起来完全正常，只是所有任务都挤在今天）。
#
# 所以本脚本走完整的真实路径：
#
#   真模拟器 → 真点击 → 真 SQLite → 真 HTTP → 真服务端 → 笔记本真 SQLite
#
# ─────────────────────────────────────────────────────────────────────────
# 🔴 判据的**独立来源**
#
# "9 月 26 日是星期六"这件事不能由 `@heyta/domain` 自己来证明 ——
# 如果 `monthGrid` 整体偏了一天，用 `monthGrid` 去核对它仍然是自洽的。
#
# 所以本脚本的期望值全部由**宿主机上的 Python** 现算：
#   - 日期取自**设备时钟**（`adb shell date`），不是宿主机时钟；
#   - 星期几来自 Python 的 `datetime.weekday()`；
#   - 月份标题、某天的标题都由 Python 拼装。
#
# 于是"应用的日历和 Python 的日历一致"才是真判据。这也是那几个外部锚点的来源
# （日历数学的注释里引用的真机 dump 读数）。
# ─────────────────────────────────────────────────────────────────────────
# 🔴 **看退出码时不要接管道。** 我在验证本脚本"能不能失败"时跑了
# `bash 脚本 | sed ...`，于是看到 `exit code: 0` 而它其实报了 7 项失败 ——
# 管道的退出码取自**最后一个命令**（`sed`），脚本自己的 `exit 1` 被吃掉了。
# 我差点据此把"失败却退出 0"当成一个真实缺陷去修（脚本里那行 `exit 1` 一直是好的）。
# 要判退出码就 `bash 脚本; echo $?`，中间不要有东西。
#
# 🔴 dump 的时机
#
# 日历是**静态屏**，不跑动画、不跑计时器，所以随时 dump 都可靠
# （对比 `verify-mobile-focus.sh`：那边运行中 dump 的成功率是 1/8，
#  只有暂停态才 8/8，所以那边的断言全部安排在暂停之后）。
#
set -u

. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
heyta_e2e_ensure_account || exit 1

# 常量、定位器、断言与"笔记本设备"辅助全部在共享库里。
. "$(dirname "$0")/lib/mobile-e2e.sh"

TASK_TITLE="cal-e2e-$(date +%H%M%S)"
LAPTOP_DB=/tmp/heyta-calendar-laptop.sqlite
PHONE_DB=/tmp/heyta-calendar-phone.sqlite
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
# 🔴 「日历」现在是**第 2 个** tab，中心 **324**
# （108=任务 / 324=日历 / 540=专注 / 756=分类 / 972=我的）。
TAB_CALENDAR=324
TAB_PROFILE=972
TAB_Y=2253

# ── 辅助 ────────────────────────────────────────────────────

# 把手机的 SQLite 拉到本地再查。
#
# 🔴 用 `adb root` + `pull`，不用 `run-as`：release 包**不可调试**。
phone_db_pull() {
  $ADB root >/dev/null 2>&1; sleep 2
  $ADB pull /data/data/com.heytamobile/databases/heyta.sqlite "$PHONE_DB" >/dev/null 2>&1
  $ADB unroot >/dev/null 2>&1
}

# 某个实体在手机本地库里的 op 条数。
#
# ⚠️ JSON 路径是 `$.op.entityType`，**不是** `$.entityType` —— `data` 列是
# `{op:{...}, source, applyStatus, uploadStatus, seq}` 的嵌套结构。
task_ops_in() {  # <sqlite 文件> <实体 id> <opType>
  sqlite3 "$1" \
    "SELECT COUNT(*) FROM ops
      WHERE json_extract(data,'\$.op.entityType')='TASK'
        AND json_extract(data,'\$.op.entityId')='$2'
        AND json_extract(data,'\$.op.opType')='$3';" \
    2>/dev/null | tr -d ' '
}

# dump 里是否存在 **content-desc 含某子串** 的节点。
#
# 🔴 日历格子里**没有文字能用来断言"这天有几个任务"** —— 那几个小圆点是纯 View，
# 无障碍名在 `accessibilityLabel` 上。所以断言必须读 content-desc。
# `has_desc` 是**全等**匹配，而格子的标签是"标题 + 任务数"拼出来的，只能用子串。
has_desc_sub() {  # <子串>
  grep -q "content-desc=\"[^\"]*$1[^\"]*\"" /tmp/ui.xml && echo 1 || echo 0
}

# **唯一处于选中态的那一格**的 content-desc，按三种情形回显：
#   空字符串 = 一格都没选中；`MULTI:<n>` = 有多格同时选中；否则就是那一格的描述。
#
# 🔴 为什么必须有这个：`has_desc_sub "$TODAY_TITLE"` 看着像在断言"今天"，
# 其实只证明了"网格里**存在**这一天的格子" —— 而月视图里**任何一天都存在**
# （包括上/下月的补白格）。于是它**永远不会失败**。
# 实测：把期望值整体 +1 天后重跑，它照样报 ✅「今天那格是「9月27日 星期日 …」」，
# 全脚本 23/0 全绿 —— 而那描述的正是"整体偏一天的日历"。
# **不能失败的检查没有价值**，这条断言当时就是。
#
# 真正要断言的是"日历认为哪一天是今天"，而它在无障碍树里只有一个可靠载体：
# `selected`。初始状态 `selected` 就是今天（点过「回到今天」之后也是）。
selected_day_desc() {
  python3 - <<'PY'
import re
s = open('/tmp/ui.xml', encoding='utf-8', errors='replace').read()
hits = []
for m in re.finditer(r'<node[^>]*?>', s):
    tag = m.group(0)
    d = re.search(r'content-desc="(\d+月\d+日 [^"]*)"', tag)
    if not d:
        continue
    if 'selected="true"' in tag:
        hits.append(d.group(1))
if len(hits) == 1:
    print(hits[0])
elif hits:
    print(f"MULTI:{len(hits)}")
else:
    print('')
PY
}

# ── 期望值：全部由宿主机 Python 现算 ────────────────────────

step "0. 期望值（独立来源：设备时钟 + Python 算的日历）"
DEV_DATE=$($ADB shell date +%Y-%m-%d 2>/dev/null | tr -d '\r')
if [ -z "$DEV_DATE" ]; then
  echo "❌ 读不到设备日期，后面的期望值全部不可信 —— 停止"
  exit 1
fi
ok "设备日期 $DEV_DATE"

# Python 只负责**算术**；中文星期名在这里另外拼一遍 ——
# 这正是"独立来源"的意义：如果领域层的 `isoWeekday` 偏了一天，
# 两边拼出来的字符串就会不一样。
EXPECT=$(python3 - "$DEV_DATE" <<'PY'
import datetime, sys
d = datetime.date.fromisoformat(sys.argv[1])
W = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']
# 同一月里挑一个**不等于今天**的日子，让"选中那天"和"今天"在界面上分得开。
due_day = 22 if d.day <= 20 else 15
due = d.replace(day=due_day)
def title(x):
    return f"{x.month}月{x.day}日 {W[x.weekday()]}"
print(f"{d.year}年{d.month}月")
print(title(d))
print(title(due))
print(due.isoformat())
print(due_day)
PY
)
MONTH_TITLE=$(printf '%s' "$EXPECT" | sed -n 1p)
TODAY_TITLE=$(printf '%s' "$EXPECT" | sed -n 2p)
DUE_TITLE=$(printf '%s' "$EXPECT" | sed -n 3p)
DUE_DATE=$(printf '%s' "$EXPECT" | sed -n 4p)
DUE_DAY=$(printf '%s' "$EXPECT" | sed -n 5p)
ok "期望月份「${MONTH_TITLE}」，今天「${TODAY_TITLE}」，目标日「${DUE_TITLE}」（${DUE_DATE}）"

# ── 开始 ────────────────────────────────────────────────────
echo ""
echo "=== 移动端日历验收（真实模拟器 + 真服务端 + 真笔记本设备，零 mock）==="
echo "  设备: emulator-5554   服务端: $SERVER   库: heyta_mobile_smoke"
echo "  账号: $EMAIL"
echo "  任务: ${TASK_TITLE}（截止 ${DUE_DATE}）"

if [ "${#TOKEN}" -lt 100 ]; then
  echo "❌ 令牌看起来不对（长度 ${#TOKEN}）—— 先跑建号脚本"; exit 1
fi

step "1. 装包并启动"
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
# 🔴 清掉本地数据：上一次跑到一半会留下任务，让"这天有几个任务"的断言含混。
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
$ADB shell am start -n $PKG/.MainActivity >/dev/null 2>&1; sleep 12
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

step "4. 🔴 笔记本建一个**有截止时间**的任务并同步（跨设备的起点）"
# 从另一台设备造数据是本脚本的关键：它一次证明两件事 ——
# 截止时间真的同步到了手机，以及手机把它放到了**正确的那一天**。
# 在手机上自己建一个的话，"放对了没有"就退化成"我刚填的日期有没有被读回来"。
#
# ⚠️ 只调一次 `laptop add`。`laptop_ok add ... && laptop add ...` 那种写法
# 会**建出两条**任务，而下面「那天只有 1 个任务」的断言就变成了假红。
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

step "6. 日历渲染：月份标题必须与独立算出的日历一致"
$ADB shell input tap $TAB_CALENDAR $TAB_Y; sleep 4
dump
if [ "$(has_text "$MONTH_TITLE")" = "1" ]; then
  ok "月份标题正确：$MONTH_TITLE"
else
  bad "月份标题不是「${MONTH_TITLE}」（界面上的日历和设备时钟不一致）"
fi
# 列头：周一开头。少一个都不是完整的 7 列。
MISSING=""
for w in 一 二 三 四 五 六 日; do
  [ "$(has_text "$w")" = "1" ] || MISSING="$MISSING $w"
done
if [ -z "$MISSING" ]; then ok "星期列头完整：一 二 三 四 五 六 日"; else bad "星期列头缺：$MISSING"; fi

step "7. 🔴 日历打开时**恰好选中一格**，且那一格就是今天"
# 这条同时钉三件事：选中态唯一、它就是今天、以及每个格子的读屏名带上了任务数
# （否则读屏用户听到的是一屏 42 个孤零零的数字）。
SEL=$(selected_day_desc)
case "$SEL" in
  '')
    bad "没有任何格子处于选中态 —— 日历打开时应该选中今天（${TODAY_TITLE}）"
    ;;
  MULTI:*)
    bad "同时有多个格子处于选中态（${SEL}）—— 选中态必须唯一"
    ;;
  "$TODAY_TITLE"*)
    ok "恰好选中一格，且就是今天：「${SEL}」"
    ;;
  *)
    bad "选中的是「${SEL}」，但今天是「${TODAY_TITLE}」—— 日历认错了今天是哪一天"
    ;;
esac

step "8. 🔴 笔记本那条任务落在**它截止的那一天**，且那天只显示 1 个任务"
# 这是本脚本最重要的一条：它同时证明"截止时间同步过来了"和"分到了对的日子"。
if [ -n "$TASK_ID" ] && [ "$(has_desc_sub "${DUE_TITLE}，1 个任务")" = "1" ]; then
  ok "「${DUE_TITLE}」那格显示 1 个任务 —— 跨设备任务落在了正确的那一天"
elif [ -n "$TASK_ID" ]; then
  bad "「${DUE_TITLE}」那格不是「1 个任务」—— 任务被放到了别的一天（或没同步过来）"
  # 把每格的读数打出来，好判断是"整体偏一天"还是"根本没到"
  echo "     各格实际读数："
  grep -o 'content-desc="[0-9]*月[0-9]*日[^"]*"' /tmp/ui.xml | sort -u | head -12 | sed 's/^/       /'
fi

step "9. 点那一天 → 当天列表里出现那条任务"
DAY_XY=$(xy_desc "${DUE_TITLE}，1 个任务")
if [ -z "$DAY_XY" ]; then
  # 标签里任务数可能因为同步差异不同，退一步按"日期标题开头"找
  DAY_XY=$(python3 - "$DUE_TITLE" <<'PY'
import re, sys
want = sys.argv[1]
s = open('/tmp/ui.xml', encoding='utf-8', errors='replace').read()
for m in re.finditer(r'<node[^>]*?>', s):
    tag = m.group(0)
    d = re.search(r'content-desc="([^"]*)"', tag)
    if not d or not d.group(1).startswith(want):
        continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
    if not b:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    if y2 > y1 and (y1 + y2) // 2 < 2100:
        print(f"{(x1 + x2) // 2} {(y1 + y2) // 2}")
        break
PY
)
fi
if [ -n "$DAY_XY" ]; then
  $ADB shell input tap $DAY_XY; sleep 3
  dump
  if [ "$(has_text "$TASK_TITLE")" = "1" ]; then
    ok "点「${DUE_TITLE}」后，当天列表里出现了「${TASK_TITLE}」"
  else
    bad "点了「${DUE_TITLE}」但那天的列表里没有「${TASK_TITLE}」"
  fi
  # 列表上方的区块标题也应该跟着变成那一天 —— 否则是"数据变了、标题没变"
  if [ "$(has_desc_sub "$DUE_TITLE")" = "1" ] || [ "$(has_text "$DUE_TITLE")" = "1" ]; then
    ok "当天区块标题已切到「${DUE_TITLE}」"
  else
    bad "选了那一天，但区块标题没切过去"
  fi
else
  bad "找不到「${DUE_TITLE}」那一格，点不下去"
fi

step "10. 点「回到今天」→ 选中回到今天，那条任务从列表里消失"
if XY=$(tap_label "回到今天"); then
  sleep 3; dump
  # 🔴 反向断言：它**必须消失**。只断言"今天的任务出现了"是拦不住
  # "列表根本没换、还是那一天的"这种 bug 的 —— 那样两边都会显示同一条。
  if [ "$(has_text "$TASK_TITLE")" = "0" ]; then
    ok "「${TASK_TITLE}」已从列表消失（列表确实换到了今天）"
  else
    bad "点了「回到今天」但「${TASK_TITLE}」还在列表里 —— 列表没换"
  fi
  # ⚠️ 用 `has_sub`（子串）而不是 `has_text`（全等）：界面上的文案带句号，
  # 而全等匹配会因为一个标点而静默不命中。
  if [ "$(has_sub "这一天没有到期的任务")" = "1" ]; then
    ok "今天显示为空（今天确实没有到期的任务）"
  fi
  # 选中态也应该回到今天 —— 否则是"列表换了、选中框还停在原来那天"，
  # 用户点下一格时会以为日历跳了。
  SEL2=$(selected_day_desc)
  case "$SEL2" in
    "$TODAY_TITLE"*) ok "选中态已回到今天：「${SEL2}」" ;;
    *) bad "点了「回到今天」，但选中态是「${SEL2}」而不是今天" ;;
  esac
else
  bad "找不到「回到今天」按钮"
fi

step "11. 重新选中那一天 → 勾选完成 → 手机本地必须落一条 op"
if [ -n "$DAY_XY" ]; then
  $ADB shell input tap $DAY_XY; sleep 3
  dump
  if XY=$(tap_label "标记完成：$TASK_TITLE"); then
    sleep 3
    if [ -n "$TASK_ID" ]; then
      phone_db_pull
      N=$(task_ops_in "$PHONE_DB" "$TASK_ID" UPD)
      if [ -n "$N" ] && [ "$N" -ge 1 ]; then
        ok "手机本地落了 $N 条该任务的 UPD op（日历页的勾选真的写了 op-log）"
      else
        bad "手机本地没有该任务的 UPD op —— 日历页的勾选没走 op-log"
      fi
    else
      bad "没有任务 id，无法查 op"
    fi
  else
    bad "找不到该任务行的勾选框（标签应为「标记完成：${TASK_TITLE}」）"
  fi
else
  bad "找不到那一天，跳过了勾选校验"
fi

step "12. 🔴 跨设备回传：笔记本同步后必须看到它已完成"
# 这是"能多端"的最终判据：手机上的一次日历操作，经 op-log → 服务端 →
# 笔记本的真 SQLite，另一端读到的 `completedAt` 不再是 null。
$ADB shell input tap $TAB_PROFILE $TAB_Y; sleep 3
dump
if XY=$(tap_label "立即同步"); then
  T=$(wait_synced 180)
  if [ -n "$T" ]; then ok "手机第二次同步完成（约 $T 秒）"; else bad "手机第二次同步未完成"; fi
fi
laptop sync >/dev/null 2>&1
DONE=$(laptop list --all | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('ERR'); raise SystemExit
t=next((x for x in d.get('tasks',[]) if x['id']=='$TASK_ID'), None)
print('ERR' if t is None else ('DONE' if t['completedAt'] is not None else 'NOT_DONE'))
" 2>/dev/null)
case "$DONE" in
  DONE)     ok "笔记本从服务端读到该任务已完成 —— 手机上的一次日历勾选跨了设备" ;;
  NOT_DONE) bad "笔记本看到了这条任务，但 completedAt 仍是 null（完成态没同步过去）" ;;
  *)        bad "笔记本没有这条任务（结果：${DONE}）—— 数据没跨过去" ;;
esac

summary "移动端日历"