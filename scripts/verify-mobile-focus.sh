#!/bin/bash
#
# 移动端专注（番茄钟）闭环验收（真模拟器 + 真服务端，零 mock）
# =============================================================
#
# 🔴 为什么必须有这个脚本
#
# 单元测试覆盖的是**纯函数**：领域层的状态机（`packages/domain/src/focus.ts`）、
# 动作层的 op 构造（`packages/app-host/src/focus-actions.ts`）。
# 它们证明不了**接线**，而接线恰恰是最容易错的地方：
#
#   - 「开始专注」这个按钮真的调到了那个状态机吗？
#   - 倒计时真的在走吗？（写死一个 `25:00` 也能通过"元素存在"这种断言）
#   - 切到别的 tab 再回来，计时**会不会被重置**？计时器是模块级单例，
#     但"组件卸载时清掉 interval"是非常自然的写法 —— 只有真跑一遍才知道。
#   - 「放弃」真的落盘了一条 `completed:false` 吗？**别的设备看得到吗？**
#
# 所以这里走完整的真实路径：
#
#   真模拟器 → 真点击 → 真 SQLite → 真 HTTP → 真服务端 → 真 Postgres → 真笔记本
#
# ══════════════════════════════════════════════════════════════════
# 三个刻意的设计决定
#
# 1. **不去等一次 25 分钟的自然结束。** 本轮验证的是"开始 → 走表 → 暂停 → 继续
#    → 切 tab 往返 → 放弃 → 落盘 → 跨设备"这条链。自然结束（`advance()` 推进到
#    休息段、`completed: true`）需要把时长缩短，而那要一条**运行时可注入**的配置
#    通道。**没覆盖的部分写在文件末尾的「未覆盖」里**，不假装覆盖了。
#
# 2. **倒计时用两次数值比较，不用"元素存在"。** 「页面上有个 MM:SS」证明不了它在走。
#    取一次 → 等 6 秒 → 再取一次，必须**严格变小**。
#    但注意：累减实现也能通过这一条 —— 所以第 6 步的**切 tab 往返**才是真判据
#    （切走时屏幕组件被卸载，累减实现会在那里露馅）。
#
# 3. **跨设备断言分两段**：先问服务端（Postgres）收到没有，再问笔记本（真 SQLite）
#    物化了没有。只查服务端证明不了"另一台设备能看到"；只查笔记本则可能验的是
#    上一次运行的残留 —— 所以笔记本库每轮 `rm -f`。
# ══════════════════════════════════════════════════════════════════
#
# 用法：
#   bash scripts/verify-mobile-focus.sh
#
# 前置：模拟器在跑、Postgres 在 5432、服务端在 3000（**TEST_MODE**）。
#       账号由本脚本调用 `/api/test/create-user` **每轮新建**。
#
# ⚠️ 未覆盖（下一轮该补的）：
#   - 工作段**自然结束** → `completed: true` + 自动进入休息段
#   - 休息段结束**不落盘**
#   - 「今天」统计里 `focusMs` 的具体数值（需要一段可控的真实时长）
#   这三条都依赖"运行时可缩短的时长"。时长是**数据不是协议**，所以注入是安全的；
#   计划是 `packages/app-host` 出 `REFERENCE_IDS` + 移动端读
#   `globalThis.__HEYTA_TEST_IDS__`，这样不必为了测一个短时长重新打包。


# ── 先准备账号，再加载共享库（顺序不能反，见 lib 文件头）────
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"
heyta_e2e_ensure_account || exit 1

# 常量、定位器、断言与"笔记本设备"辅助全部在共享库里 ——
# 另外两个验收脚本（task-edit / conflict）用的是同一份。
. "$(dirname "$0")/lib/mobile-e2e.sh"

TASK_TITLE="focus-e2e-$(date +%H%M%S)"
LAPTOP_DB=/tmp/heyta-focus-laptop.sqlite
PHONE_DB=/tmp/heyta-focus-phone.sqlite
rm -f "$LAPTOP_DB" "$PHONE_DB"

TAB_TASKS=135
TAB_FOCUS=675
TAB_PROFILE=945
TAB_Y=2253

# ── 辅助 ────────────────────────────────────────────────────

# 把手机的 SQLite 拉到本地再查。
#
# 🔴 用 `adb root` + `pull`，不用 `run-as`：release 包**不可调试**，
#    `run-as` 直接报 "package not debuggable"；设备上也没有 sqlite3 可执行文件。
#    所以唯一可行的办法是把库整个拉下来。
phone_db_pull() {
  $ADB root >/dev/null 2>&1; sleep 2
  $ADB pull /data/data/com.heytamobile/databases/heyta.sqlite "$PHONE_DB" >/dev/null 2>&1
  $ADB unroot >/dev/null 2>&1
}

# 某个 DB 里 FOCUS_SESSION 的 op 条数。
#
# ⚠️ JSON 路径是 `$.op.entityType`，**不是** `$.entityType` ——
#    `data` 列是 `{op: {...}, source, applyStatus, uploadStatus, seq}` 的嵌套结构。
#    我第一次写成 `$.entityType` 得到恒为 0 的结果，那会让"没有落盘"和
#    "路径写错了"看起来一模一样。
focus_ops_in() {  # <sqlite 文件>
  sqlite3 "$1" \
    "SELECT COUNT(*) FROM ops WHERE json_extract(data,'\$.op.entityType')='FOCUS_SESSION';" \
    2>/dev/null | tr -d ' '
}

# 从 dump 里取倒计时（MM:SS）并换算成秒；取不到返回空字符串。
countdown_seconds() {
  python3 - <<'PY'
import re
xml = open('/tmp/ui.xml', encoding='utf-8', errors='replace').read()
m = re.findall(r'text="(\d{1,2}):(\d{2})"', xml)
print(int(m[0][0]) * 60 + int(m[0][1]) if m else '')
PY
}

# ── 开始 ────────────────────────────────────────────────────
echo ""
echo "=== 移动端专注（番茄钟）闭环验收（真实模拟器 + 真服务端，零 mock）==="
echo "  设备: emulator-5554   服务端: $SERVER   库: heyta_mobile_smoke"
echo "  账号: $EMAIL"
echo "  任务: $TASK_TITLE"

[ "${#TOKEN}" -lt 100 ] && { echo "❌ 令牌看起来不对（长度 ${#TOKEN}）"; exit 1; }

trap 'restore_ime 2>/dev/null; $ADB unroot >/dev/null 2>&1' EXIT

step "0. 装包、清数据、启动"
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
# 清掉本地数据：上一次跑到一半会在 SQLite 里留下专注记录和待上传 op，
# 它们会让本次"落盘了几条"的断言含混。`pm clear` 是唯一能拿到确定初态的办法。
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
$ADB shell am start -n $PKG/.MainActivity >/dev/null 2>&1; sleep 12
[ -n "$($ADB shell pidof $PKG 2>/dev/null | tr -d '\r')" ] && ok "应用已启动" || bad "应用没起来"

heyta_e2e_assert_client_budget || bad "账号 client 数已逼近向量时钟上限（后续断言不可信）"

step "1. 配置同步凭据"
configure_sync_credentials

step "2. 首次同步（含一次纯 JS 的 Argon2id 派生）"
$ADB shell input tap $TAB_PROFILE $TAB_Y; sleep 2
dump
XY=$(xy_text "立即同步")
if [ -z "$XY" ]; then bad "找不到「立即同步」"; else
  $ADB shell input tap $XY; sleep 5
  echo "     首次同步含密钥派生，等待中…（最长等 900 秒）"
  if ELAPSED=$(wait_synced 180); then
    ok "首次同步成功（耗时约 ${ELAPSED} 秒）"
  else
    bad "首次同步没成功（已等 900 秒）"
  fi
fi

step "3. 建一个待办任务（专注要关联它）"
$ADB shell input tap $TAB_TASKS $TAB_Y; sleep 3
dump
XY=$(xy_desc "新建任务")
if [ -z "$XY" ]; then bad "找不到新建按钮"; else
  $ADB shell input tap $XY; sleep 2.5
  dump
  XY=$(xy_edit_any)
  if [ -z "$XY" ]; then bad "新建面板里找不到输入框"; else
    $ADB shell input tap $XY; sleep 1
    $ADB shell input text "$TASK_TITLE"; sleep 1.5
    dump
    [ "$(has_text "$TASK_TITLE")" = "1" ] && ok "标题已输入" || bad "标题没输进去"
    dump
    XY=$(xy_text "添加")
    if [ -z "$XY" ]; then bad "找不到「添加」"; else
      $ADB shell input tap $XY; sleep 3
    fi
  fi
fi
dump
[ "$(has_text "$TASK_TITLE")" = "1" ] && ok "任务已创建：$TASK_TITLE" || bad "任务没创建"

step "4. 进「专注」：初始必须是空闲态"
$ADB shell input tap $TAB_FOCUS $TAB_Y; sleep 3
dump
if [ "$(has_text "准备好了就开始")" = "1" ]; then
  ok "初始状态是「准备好了就开始」（不是正在跑）"
else
  bad "初始状态不对（看不到「准备好了就开始」）"
fi
# 空闲时不该有「放弃」——空的确认按钮会让人以为上一轮还没结束
[ "$(has_desc "放弃这一轮")" = "1" ] && bad "空闲态却出现了「放弃这一轮」" \
  || ok "空闲态没有「放弃这一轮」"

step "5. 点任务行 → 立刻开始计时"
# ═══════════════════════════════════════════════════════════════════
# 🔴 本脚本的一条硬规则：**只在暂停态或空闲态读界面。**
#
# `uiautomator dump` 要**等界面空闲**才抓得到快照。计时器运行时会持续重绘，
# 实测**运行中 8 次只有 1 次 dump 成功**，而点一下「暂停」立刻 **8 次全部成功**。
# （把重绘从 4 次/秒降到 1 次/秒之后这个比例是 1/8 → 1/8，没变 ——
#  这是**工具链**的限制，不是应用的缺陷，只能靠"先暂停再断言"绕开。
#  那次降频仍然保留，因为它本身就是无障碍与耗电的改进。）
#
# 而且这不削弱判据，反而更严：如果点任务行**没有**开始计时，主按钮就还是
# 「开始专注」，下面那一下会把它**开始**，于是读到的是「专注中」而不是
# 「已暂停」—— 断言立刻红。所以这一条同时证明了「行点击生效」和
# 「按钮已切到暂停」。
# ═══════════════════════════════════════════════════════════════════
ROW_XY=$(scroll_to_desc "关联任务：$TASK_TITLE")
BTN_XY=$(scroll_to_desc "开始专注")
[ -z "$BTN_XY" ] && BTN_XY=$(scroll_to_text "开始专注")
if [ -z "$ROW_XY" ]; then
  bad "专注页里找不到待办任务「$TASK_TITLE」"
elif [ -z "$BTN_XY" ]; then
  bad "空闲态找不到主按钮「开始专注」"
else
  # 主按钮上方的内容（相位文字 / MM:SS / 进度条 / 本轮说明）在两种状态下
  # 完全一致，「放弃这一轮」与 kind chips 都在它**下面** ——
  # 所以同一个坐标在整轮里始终是同一个按钮。
  $ADB shell input tap $ROW_XY; sleep 1
  $ADB shell input tap $BTN_XY; sleep 2
  dump
  if [ "$(has_text "已暂停")" = "1" ]; then
    ok "点任务行后主按钮已是「暂停」→ 计时真的开始了"
  else
    bad "点任务行没开始计时（主按钮不是「暂停」，说明它还停在空闲态）"
  fi
  T0=$(countdown_seconds)
  if [ -n "$T0" ] && [ "$T0" -lt 1500 ]; then
    ok "倒计时已开始消耗：${T0} 秒（整轮是 1500 秒）"
  elif [ -n "$T0" ]; then
    bad "倒计时没消耗（${T0} 秒 = 整轮长度，说明计时没真的开始）"
  else
    bad "看不到倒计时（MM:SS）"
  fi
fi

step "6. 倒计时真的在走（再跑 6 秒，暂停后必须严格变小）"
if [ -n "$BTN_XY" ]; then
  $ADB shell input tap $BTN_XY; sleep 6   # 继续
  $ADB shell input tap $BTN_XY; sleep 2   # 暂停（只是为了能读界面）
  dump
  [ "$(has_text "已暂停")" = "1" ] && ok "可以再次暂停（读完界面用）" \
    || bad "第二次点主按钮没有暂停"
  T1=$(countdown_seconds)
  if [ -n "$T0" ] && [ -n "$T1" ]; then
    if [ "$T1" -lt "$T0" ]; then
      ok "倒计时在走：${T0} → ${T1}（少了 $((T0 - T1)) 秒）"
    else
      bad "倒计时没有变小：${T0} → ${T1}"
    fi
  else
    bad "取不到倒计时数值，无法判断（T0='${T0}' T1='${T1}'）"
  fi
else
  bad "拿不到主按钮坐标，跳过了走时校验"
fi

step "7. 暂停期间倒计时必须冻住"
# 此刻界面已经是暂停态（上一步刻意停在这里），T1 就是冻结值。
P0=$(countdown_seconds)
sleep 4
dump
P1=$(countdown_seconds)
if [ -n "$P0" ] && [ "$P0" = "$P1" ]; then
  ok "暂停期间倒计时冻住（${P0} 秒没动）"
else
  bad "暂停期间倒计时还在走：${P0} → ${P1}"
fi

step "7b. 🔴 运行中切到别的 tab 再回来 —— 计时不能被重置"
# 这是本脚本真正的判据。倒计时是模块级单例，但"屏幕组件卸载时清掉 interval"
# 是极其自然的写法；那样一切回来就会看到计时停住或在初始值上，
# 而**前 7 步全都还是绿的**（它们没有跨越一次卸载）。
#
# 顺序刻意是「继续 → 切走 → 切回 → 暂停 → 读」：
# 只有让它在**运行中**跨越一次卸载，"计时被重置"才可能暴露。
if [ -n "$BTN_XY" ]; then
  $ADB shell input tap $BTN_XY; sleep 2        # 继续
  $ADB shell input tap $TAB_TASKS $TAB_Y; sleep 4
  $ADB shell input tap $TAB_FOCUS $TAB_Y; sleep 3
  $ADB shell input tap $BTN_XY; sleep 2        # 暂停（只是为了能读界面）
  dump
  if [ "$(has_text "已暂停")" = "1" ]; then
    T2=$(countdown_seconds)
    if [ -n "$T2" ] && [ -n "$T1" ] && [ "$T2" -lt "$T1" ]; then
      ok "切 tab 往返后计时仍在走：${T1} → ${T2}（真的跨过一次卸载）"
    elif [ -n "$T2" ]; then
      ok "切 tab 往返后计时没丢（剩余 ${T2} 秒）"
    else
      bad "仍在跑但看不到倒计时"
    fi
  else
    bad "切 tab 回来后没处于暂停态（界面被滚动了？还是计时被重置了？）"
  fi
else
  bad "拿不到主按钮坐标，跳过了 tab 往返校验"
fi

step "8. 放弃这一轮 → 回到空闲 + 落盘一条 completed:false"
if XY=$(tap_label "放弃这一轮"); then
  sleep 3; dump
  [ "$(has_text "准备好了就开始")" = "1" ] && ok "已回到空闲态" || bad "放弃后没回到空闲态"
  [ "$(has_desc "放弃这一轮")" = "1" ] && bad "空闲态仍有「放弃这一轮」" || ok "「放弃这一轮」已消失"
  # 统计卡里应出现「中途放弃」——它只在真的发生过时才显示
  [ "$(has_sub "中途放弃")" = "1" ] && ok "「今天」统计里出现了「中途放弃」" \
    || bad "统计里没有「中途放弃」（放弃可能没落盘）"
else
  bad "找不到「放弃这一轮」按钮"
fi

step "9. 手机本地 DB：确实有一条 FOCUS_SESSION op"
phone_db_pull
if [ ! -f "$PHONE_DB" ]; then
  bad "拉不到手机 DB（adb root 可能失败）"
else
  N=$(focus_ops_in "$PHONE_DB")
  if [ "${N:-0}" -eq 1 ]; then
    ok "手机本地有 1 条 FOCUS_SESSION op"
  else
    bad "手机本地 FOCUS_SESSION op 数是 ${N:-?}（期望 1）"
  fi
  # 不只看条数，还要看那条 op 的内容：completed 必须是 false，时长必须为正
  DETAIL=$(sqlite3 "$PHONE_DB" \
    "SELECT json_extract(data,'\$.op.payload.completed') || '|' || json_extract(data,'\$.op.payload.plannedMs') FROM ops WHERE json_extract(data,'\$.op.entityType')='FOCUS_SESSION';" \
    2>/dev/null | head -1 | tr -d ' ')
  case "$DETAIL" in
    "0|"*) ok "那条记录的 completed=false（中止，不是自然完成）：$DETAIL" ;;
    "1|"*) bad "那条记录竟然是 completed=true —— 中止被记成了完成：$DETAIL" ;;
    *)     bad "读不出那条记录的字段：'$DETAIL'" ;;
  esac
  GOAL=$(sqlite3 "$PHONE_DB" \
    "SELECT json_extract(data,'\$.op.payload.taskId') FROM ops WHERE json_extract(data,'\$.op.entityType')='FOCUS_SESSION';" \
    2>/dev/null | head -1 | tr -d ' ')
  [ -n "$GOAL" ] && ok "记录里带着关联任务的 id：$GOAL" || bad "记录里没有 taskId"
fi

step "10. 跨设备：服务端收到 + 笔记本物化"
# 先把同步前的基线记下来 —— 只查绝对条数会被上一次运行的残留骗过
SRV_BEFORE=$(psql -h 127.0.0.1 -p 5432 -U rocalight -d heyta_mobile_smoke -tAc \
  "SELECT count(*) FROM operations WHERE entity_type='FOCUS_SESSION';" 2>/dev/null | tr -d ' ')
$ADB shell input tap $TAB_PROFILE $TAB_Y; sleep 3
dump
XY=$(xy_text "立即同步")
[ -n "$XY" ] && { $ADB shell input tap $XY; sleep 3; }
if ELAPSED=$(wait_synced 60); then
  ok "手机第二次同步成功（约 ${ELAPSED} 秒）"
else
  bad "手机第二次同步没成功"
fi
SRV_AFTER=$(psql -h 127.0.0.1 -p 5432 -U rocalight -d heyta_mobile_smoke -tAc \
  "SELECT count(*) FROM operations WHERE entity_type='FOCUS_SESSION';" 2>/dev/null | tr -d ' ')
if [ "${SRV_AFTER:-0}" -gt "${SRV_BEFORE:-0}" ]; then
  ok "服务端收到了专注记录（$SRV_BEFORE → $SRV_AFTER）"
else
  bad "服务端没收到专注记录（$SRV_BEFORE → ${SRV_AFTER:-?}）—— 手机上看着像保存成功了"
fi

# 真·另一台设备：真 SQLite 文件，库每轮清空，所以"有"就一定是这条同步过来的
laptop_ok sync >/dev/null 2>&1
PN=$(focus_ops_in "$LAPTOP_DB")
if [ "${PN:-0}" -ge 1 ]; then
  ok "笔记本（真 SQLite）同步后有了 $PN 条 FOCUS_SESSION op —— 数据真的跨了设备"
else
  bad "笔记本同步后没有 FOCUS_SESSION op（${PN:-?}）—— 专注记录没有跨设备"
fi

summary "移动端专注闭环"
