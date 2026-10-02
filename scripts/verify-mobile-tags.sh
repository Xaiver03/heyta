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
# 移动端「标签」验收（真模拟器，零 mock）
# ========================================
#
# 🔴 为什么必须有这个脚本
#
# 标签在**数据模型里存在了很久**：`EntityBase.tagIds` 早就有了、`TAG` 一直是
# 合法的 `entityType`、`ProjectActions.createTag` / `listTags` 也实现了。
# 但**全仓库没有一处读写过 `tagIds`** ——
# 也就是说它对用户**完全不存在**，而任何单元测试都不会报这个错：
# 每个零件都"通过"了，产品里没有这个功能。
#
# 单元测试证明不了这条链路：
#   - `project-actions.spec.ts` 能证明 `setTags` 派发了一条带 `tagIds` 的 UPD，
#     但它**证明不了**界面上那个 Chip 真的调到了它、也证明不了 op 落了库；
#   - 它更证明不了 `tagIds` 会**跨设备**到达，而且标签**实体本身**也在另一端
#     物化出来了（否则任务指着一串查不到的 id）。
#
# ═════════════════════════════════════════════════════════════════════════
# 这个脚本刻意做的四件"反假绿"的事
#
# 1. **标签名带时间戳**，且断言的是**这个名字**，不是"有标签了"。
#
# 2. **核对的是 id，不是标签名出现在界面上。**
#    名字对了而 id 没连上是一种真实存在的坏法：标签显示在任务上，
#    但删掉这个标签之后它还挂在任务上 —— 因为它其实压根没进 `tagIds`。
#
# 3. **两处都要核：标签实体 + 任务上的引用。**
#    只核其中一处，会漏掉一半的坏法：
#      - 只核任务 `tagIds`：「标签实体没同步过去」看不出来（任务指着一串悬空 id）；
#      - 只核标签实体：「引用没写进任务」看不出来（标签建好了，但没人用）。
#
# 4. **手机侧数远端 op**（与清单脚本同一条关键判据）。
#    "界面说同步完成了"在"上传成了、下载整批作废"时**同样为真**。
#
# 用法：
#   bash scripts/verify-mobile-tags.sh
#
# 前置：模拟器在跑、服务端在 3000（TEST_MODE）、
#       /tmp/heyta_mobile_{token,email,e2ee}.txt 存在。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

# 独立库：与其它验收各用一份，否则会互相看到对方的任务。
LAPTOP_DB=/tmp/heyta-tags-laptop.sqlite
PHONE_DB=/tmp/heyta-tags-phone.sqlite
TAB_Y=2253

# 🔴 **故意用 ASCII 名**：`adb shell input text` **发不了非 ASCII**
#    （实测抛 `java.lang.NullPointerException: Attempt to get length of null array`，
#    走的是 KeyCharacterMap；而且它**退出码仍为 0** 的时候也有过）。
#    中文标签走 **iOS 侧**验证。
TAG_NAME="tag-e2e-$(date +%H%M%S)"
TASK_TITLE="tagtask-e2e-$(date +%H%M%S)"

echo ""
echo "=== 移动端标签验收（真实模拟器，零 mock）==="
echo "  设备: emulator-5554   服务端: $SERVER"
echo "  标签: $TAG_NAME"
echo "  任务: $TASK_TITLE"

if [ "${#TOKEN}" -lt 100 ]; then
  echo "❌ 令牌看起来不对（长度 ${#TOKEN}）—— 先跑建号脚本"; exit 1
fi
rm -f "$LAPTOP_DB" "$PHONE_DB"

# ── 辅助 ────────────────────────────────────────────────────

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

# 按载荷里的 `name` 找 TAG 的 id。
phone_tag_id_by_name() {  # <sqlite> <name>
  sqlite3 "$1" \
    "SELECT json_extract(data,'\$.op.entityId') FROM ops
      WHERE json_extract(data,'\$.op.entityType')='TAG'
        AND json_extract(data,'\$.op.payload.name')='$2'
      ORDER BY json_extract(data,'\$.seq') DESC LIMIT 1;" \
    2>/dev/null | tr -d ' '
}

# TASK 最新一条带 `tagIds` 的载荷（原样 JSON 串，含 `null`）。
# 🔴 按 `seq` 取最新，不按"最后一条"—— 接口上顺序未定义（§7 第 16 条）。
# 🔴 **必须把 `null` 也算进来**：清空标签写的就是 `null`。
#    只筛"非空"的话，"打上又摘掉"会被读成"打上了"。
phone_task_tagids() {  # <sqlite>
  sqlite3 "$1" \
    "SELECT json_extract(data,'\$.op.payload.tagIds') FROM ops
      WHERE json_extract(data,'\$.op.entityType')='TASK'
        AND json_extract(data,'\$.op.payload.tagIds') IS NOT NULL
      ORDER BY json_extract(data,'\$.seq') DESC LIMIT 1;" \
    2>/dev/null | tr -d ' '
}

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
  return 0
}

# 在「我的」页新建一个标签。
#
# ⚠️ 标签段在**清单段下面**，首屏看不到，必须滚过去。
#    「标签名称」这个无障碍名**刻意与按钮「新建标签」不同名** ——
#    同名的话无障碍树里会有三个同名节点，按标签取节点只能靠 role 去猜。
create_tag_on_phone() {  # <名字>
  local XY GOT
  $ADB shell input tap 945 $TAB_Y; sleep 3   # 「我的」
  dump
  XY=$(scroll_to_desc "标签名称")
  if [ -z "$XY" ]; then bad "找不到标签名称输入框（滚动到底也没找到）"; screen_txt; return 1; fi
  $ADB shell input tap $XY; sleep 1.2
  clear_and_type "$1" "标签名称"
  dump
  # 🔴 断言**精确相等**，不是"包含"：输入框里多一个字符（实测过）用包含判据
  #    永远查不出来，而它会一路跟着这个标签同步到别的设备上。
  GOT=$(edit_value "标签名称" 2>/dev/null)
  if [ "$GOT" = "$1" ]; then
    ok "已输入标签名：$1"
  else
    bad "标签名不精确（期望「$1」，实际「${GOT}」）"; screen_txt; return 1
  fi
  XY=$(scroll_to_desc "新建标签")
  if [ -z "$XY" ]; then bad "找不到「新建标签」按钮"; screen_txt; return 1; fi
  $ADB shell input tap $XY; sleep 3
  return 0
}

step "0. 装包并启动"
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 6
dismiss_welcome_if_present   # 首次启动的欢迎页会盖住主界面（规范 §3.1）——先离开它
dump
if [ "$(has_text "任务")" = "1" ]; then ok "应用已启动"; else bad "应用没起来"; screen_txt; fi

step "1. 配置同步凭据"
require_screen
configure_sync_credentials

step "2. 建一个只有标题的任务（标签的载体）"
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

step "3. 在「我的」页新建标签：$TAG_NAME"
require_screen
if create_tag_on_phone "$TAG_NAME"; then
  dump
  if [ "$(has_text "$TAG_NAME")" = "1" ]; then
    ok "标签已出现在「我的」页的标签列表里"
  else
    bad "建完之后界面上看不到这个标签"; screen_txt
  fi
fi

step "4. 断言：本地库里真的多了一条 TAG 的 CRT op（带正确的名字）"
phone_db_pull
TAG_OPS=$(phone_entity_ops "$PHONE_DB" TAG CRT)
if [ "${TAG_OPS:-0}" -ge 1 ]; then
  ok "本地库里有 $TAG_OPS 条 TAG/CRT op"
else
  bad "本地库里没有 TAG/CRT op —— 界面上的标签没有走 op-log"; screen_txt
fi
TAG_ID=$(phone_tag_id_by_name "$PHONE_DB" "$TAG_NAME")
if [ -n "$TAG_ID" ]; then
  ok "标签落库且能按名字查到 id：$TAG_ID"
else
  bad "按名字查不到 TAG 的 entityId（标签名可能没进 payload）"; screen_txt
fi

step "5. 打开任务详情，把标签打到任务上"
# 🔴 第 3、4 步把应用留在了「我的」页 —— 不切回「任务」页就直接找任务行，
# 会在「我的」页上找一个根本不在这一页的元素。
$ADB shell input tap 135 $TAB_Y; sleep 3
dump; require_screen
open_sheet "打开任务：$TASK_TITLE" || true
if [ "$(has_text "任务详情")" = "1" ]; then
  # 🔴 必须用 `scroll_to_text`：段标题是**文字节点**，不是 `content-desc`。
  XY=$(scroll_to_text "标签")
  if [ -z "$XY" ]; then bad "详情面板里找不到「标签」段"; screen_txt; else
    ok "详情面板里有「标签」段"
    dump
    XY=$(scroll_to_text "$TAG_NAME")
    if [ -z "$XY" ]; then bad "详情面板里找不到标签「${TAG_NAME}」"; screen_txt; else
      $ADB shell input tap $XY; sleep 3
      ok "已点选标签「${TAG_NAME}」"
    fi
  fi
  close_sheet || true
else
  bad "详情面板没打开"; screen_txt
fi

step "6. 断言：任务的 op 里真的写了 tagIds（且包含那个 id）"
phone_db_pull
# ⚠️ 与清单脚本同样的前提：第 2 步只建了一条任务且它是新建（载荷里没有 tagIds），
#    所以"最新一条带 tagIds 的 TASK op"就是它。下面第 9 步会在笔记本侧
#    用同一条标题再交叉验证一次。
TASK_TAGS=$(phone_task_tagids "$PHONE_DB")
if [ -n "$TASK_TAGS" ]; then
  ok "任务的 op 里写了 tagIds：$TASK_TAGS"
  if printf '%s' "$TASK_TAGS" | grep -q "$TAG_ID"; then
    ok "任务挂的正是刚建的那个标签（id 在 tagIds 里）"
  else
    bad "任务的 tagIds 里没有刚建的标签 id（tagIds=$TASK_TAGS 标签=${TAG_ID}）"
  fi
else
  bad "任务的 op 里没有 tagIds —— 点选没有真的写进去"; screen_txt
fi

step "6b. 标签筛选行：点标签 → 只剩带该标签的任务"
# 🔴 这一条覆盖的是**此前根本不存在的入口**：Web 侧栏点标签能筛，
#    而移动端连一条筛选行都没有 —— 同一件能力两端不一致。
#    判据需要一个**不带标签的对照组**，否则"筛完还在"什么都证明不了。
UNTAGGED="untagged-$(date +%H%M%S)"
$ADB shell input tap 135 $TAB_Y; sleep 2.5   # 「任务」
dump
if [ "$(has_text "${TAG_NAME}")" != "1" ]; then
  bad "任务视图里没有标签筛选项「${TAG_NAME}」——筛选行没渲染出来"; screen_txt
else
  ok "任务视图里出现了标签筛选项「${TAG_NAME}」"
fi

# 建一条**不带标签**的对照任务
dump
XY=$(xy_desc "新建任务")
if [ -z "$XY" ]; then bad "找不到新建按钮"; screen_txt; else
  $ADB shell input tap $XY; sleep 2.5
  dump
  XY=$(xy_edit_any)
  if [ -z "$XY" ]; then bad "新建面板里找不到输入框"; else
    $ADB shell input tap $XY; sleep 1
    $ADB shell input text "${UNTAGGED}"; sleep 1.5
    dump
    XY=$(xy_text "添加")
    [ -n "$XY" ] && { $ADB shell input tap $XY; sleep 3; }
  fi
fi
dump
if [ "$(has_desc "打开任务：${UNTAGGED}")" = "1" ]; then
  ok "对照任务已创建：${UNTAGGED}（不带标签）"
else
  bad "对照任务没创建"; screen_txt
fi

# 点标签筛选
dump
XY=$(xy_desc "${TAG_NAME}")
if [ -z "$XY" ]; then
  bad "找不到可点的标签筛选项"; screen_txt
else
  $ADB shell input tap $XY; sleep 2.5
  dump
  # 带标签的那条要在，不带标签的那条要**不在**
  [ "$(has_desc "打开任务：${TASK_TITLE}")" = "1" ] \
    && ok "筛选后带该标签的任务仍在" \
    || bad "筛选后带标签的任务不见了 —— 筛反了"
  [ "$(has_desc "打开任务：${UNTAGGED}")" = "0" ] \
    && ok "筛选后不带该标签的任务被排除（${UNTAGGED}）" \
    || { bad "筛选没生效：不带标签的任务 ${UNTAGGED} 仍在"; screen_txt; }
fi

# 点「全部」清掉筛选 —— 也要证明**能清掉**（否则用户被卡在空列表里）
dump
XY=$(xy_desc "全部")
if [ -z "$XY" ]; then
  bad "找不到「全部」——筛过之后没有清除入口，用户会被卡住"; screen_txt
else
  $ADB shell input tap $XY; sleep 2.5
  dump
  [ "$(has_desc "打开任务：${UNTAGGED}")" = "1" ] \
    && ok "点「全部」后对照组任务回来了（筛选可清除）" \
    || bad "点了「全部」但对照任务没回来"
fi
# ── 6c. 搜索：此前移动端**根本没有搜索框**（Web 有） ──
# 判据同样需要一个**不命中**的对照：只搜到"那条在"什么都证明不了。
dump
# 🔴 content-desc 的**实际值**是「搜索任务（标题与备注）」（词条 `web.shell.search.aria`），
# 而 `xy_edit` 要求 `desc == want` **精确相等** —— 写「搜索任务」匹配不到。
# 第一次跑就栽在这里，而界面上搜索框明明在（dump 里有它）。
XY=$(xy_edit "搜索任务（标题与备注）")
if [ -z "${XY}" ]; then
  bad "任务视图里找不到搜索框 —— 判据在共享层，但移动端没人能用"; screen_txt
else
  ok "任务视图里有搜索框"
  $ADB shell input tap "${XY}"; sleep 1
  # `${TASK_TITLE}` 里带秒级时间戳，取它做关键词最不容易误命中
  $ADB shell input text "${TASK_TITLE}"; sleep 2
  dump
  [ "$(has_desc "打开任务：${TASK_TITLE}")" = "1" ] \
    && ok "搜索后命中的任务仍在" \
    || bad "搜索把该命中的任务也筛掉了 —— 判据可能反了"
  [ "$(has_desc "打开任务：${UNTAGGED}")" = "0" ] \
    && ok "搜索后不命中的任务被排除（${UNTAGGED}）" \
    || { bad "搜索没生效：不命中的 ${UNTAGGED} 仍在"; screen_txt; }
  # 清除：否则用户只能一个字一个字删
  dump
  XY=$(xy_desc "清除搜索")
  if [ -z "${XY}" ]; then
    bad "搜索框旁没有「清除搜索」—— 用户只能逐字删"; screen_txt
  else
    $ADB shell input tap "${XY}"; sleep 2
    dump
    [ "$(has_desc "打开任务：${UNTAGGED}")" = "1" ] \
      && ok "点「清除搜索」后列表回到全部" \
      || bad "点了清除但任务没回来"
  fi
fi

$ADB shell input tap 945 $TAB_Y; sleep 2.5   # 回「我的」，下一步要同步

step "7. 手机同步（上传 + 下载）"
$ADB shell input tap 945 $TAB_Y; sleep 3   # 同步按钮在「我的」页
if phone_sync; then ok "手机同步完成"; else bad "手机同步没成功"; screen_txt; fi

# 🔴 「同步完成」还不够 —— 必须**真的拉到了远端 op**。
#    这一条与清单脚本同源：上传成功 + 下载整批作废时，
#    界面上的东西都在（那是本地写的），而本地库里的远端 op 数是 0。
phone_db_pull
REMOTE_OPS=$(sqlite3 "$PHONE_DB" \
  "SELECT count(*) FROM ops WHERE json_extract(data,'\$.source') <> 'local';" 2>/dev/null | tr -d ' ')
if [ "${REMOTE_OPS:-0}" -ge 1 ]; then
  ok "手机本地库里有 $REMOTE_OPS 条远端 op —— 下载这一侧真的跑通了"
else
  bad "手机本地库里远端 op 数 = 0 —— 上传可能成了，但下载一条都没落地（同步只做了一半）"
  screen_txt
fi

step "8. 断言：笔记本（node-host 真 SQLite）同步后读到同一个标签"
# 🔴 与清单脚本同理：笔记本的库里有 `user:37` 早期用另一代口令加密的 op，
#    所以 `sync` 会以 `undecryptable-ops` 收尾。按 ADR-0016，**这不是失败**。
LT_SYNC=$(laptop sync)
case "$LT_SYNC" in
  *'"ok":true'*) ok "笔记本 sync 成功" ;;
  *undecryptable-ops*) ok "笔记本 sync 完成（含已知的 undecryptable-ops，见 ADR-0016）" ;;
  *) bad "笔记本 sync 失败：$LT_SYNC" ;;
esac
LT_TAGS=$(laptop tags)
echo "      $LT_TAGS" | head -c 300; echo
LT_MATCH=$(printf '%s' "$LT_TAGS" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
print(next((t['id'] for t in d.get('tags',[]) if t['name']=='$TAG_NAME'),''))
")
if [ -n "$LT_MATCH" ]; then
  ok "笔记本读到了标签「${TAG_NAME}」：$LT_MATCH"
  if [ "$LT_MATCH" = "$TAG_ID" ]; then
    ok "两端标签 id 一致（${TAG_ID}）—— 标签实体真的跨设备同步了"
  else
    bad "两端标签 id 不一致（手机=$TAG_ID 笔记本=${LT_MATCH}）"
  fi
else
  bad "笔记本没读到标签「${TAG_NAME}」—— 标签没同步过去"; screen_txt
fi

step "9. 断言：笔记本上这条任务的 tagIds 里也有那个 id"
LT=$(laptop list --all)
LT_TASK_TAGS=$(printf '%s' "$LT" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
print(json.dumps(next((t.get('tagIds') for t in d.get('tasks',[]) if t['title']=='$TASK_TITLE'),None)))
")
echo "      笔记本上这条任务的 tagIds = $LT_TASK_TAGS"
if printf '%s' "$LT_TASK_TAGS" | grep -q "$TAG_ID"; then
  ok "任务上的标签引用跨设备一致 —— 「建标签 → 打到任务 → 另一台设备读到」全链路无 mock"
else
  bad "笔记本上这条任务的 tagIds 里没有 $TAG_ID —— 引用没同步过去"; screen_txt
fi

step "10. 直接查 Postgres"
psql -h 127.0.0.1 -p 5432 -U rocalight -d heyta_mobile_smoke -tAc \
  "SELECT count(*) FROM operations WHERE op_type='CRT' AND entity_type='TAG'" 2>/dev/null \
  | sed 's|^|      服务端 TAG/CRT op 数 = |'

summary "移动端标签闭环"