#!/bin/bash
#
# 移动端任务行「勾选框」的**几何**验收（真模拟器，零 mock）
# ==========================================================
#
# 这一条是 R1（`docs/plans/ui-review-fill-zh-timeline.md` §2）的主战场判据。
# 共享层 `packages/ui/src/task-list/TaskRow.tsx` **两端同一份**（mobile 的
# `TaskList` 就是它，见 `apps/mobile/src/screens/TasksScreen.tsx`），
# 所以桌面载荷那份 Playwright 判据（`e2e/tests/task-row-touch-target.spec.ts`）
# **不能代替**这里 —— 反过来也一样。
#
# 🔴 为什么"圈看着完整"不算修好
#
# 改之前的 `checkboxHit` 只有 `marginLeft: -(44-22)/2`，**没有任何 width/height**
# —— 注释里承诺的 44 触控区在盒模型上根本不存在（类 A）。实测命中区就是那 22px 的圈，
# 而负边距把它推到裁剪祖先之外（类 B），于是"像缺了一半"。
# 所以判据必须是**三条**，各自挡一种假修：
#
#   ① 命中区**宽和高**都 ≥ `touch-target.min`（44dp）—— 只删负边距不给尺寸 ⇒ 这条红；
#   ② 命中区左边 ≥ `screen.gutter`（16dp）—— 命中区被推出行的左边距 ⇒ 这条红；
#   ③ 点命中区中心真的把任务改成已完成 —— 前两条都过但点不到 ⇒ 这条红。
#
# 🔴 **② 在这条载体上不承重**（变异测出来的，不是推测）：注回修前那版以后 ① 两条都红，
#   而 ② 仍然绿 —— Android 无障碍树报的是布局后的矩形，类 B 的"探出"在这里没有 rect 信号。
#   所以下面把 ② 标成**护栏**，移动端类 B 的证据是那张截图。详见 §2.3 的变异表。
#
# ⚠️ 一条**不在这里验**、也**不存在**的东西：`body` 上的 `minWidth`。
# 原本为 R1 加过 `minWidth: 0`（挡 CSS 弹性盒 §4.5 的"自动最小尺寸 = 内容宽"），
# 实测证伪：删掉后桌面载荷上 body 仍计算为 `min-width: 0px`、行也不撑宽（RNW 的
# `flex: 1` 本身就把 min-width 归零），所以那一行和只看撑宽的断言**一起删了**
# （见 `packages/ui/src/task-list/TaskRow.tsx` 的注释与 §2 的变异表）。
# Yoga 更没有这个默认值 —— 移动端对这条**无可验之物**，在这里记一句免得后人再补回来。
#
# 用法：
#   bash scripts/verify-mobile-task-row.sh
#
# 前置：模拟器在跑（emulator-5554）、release APK 已按当前源码打过
#       （`pnpm build:android`）。**不需要服务端与凭据。**

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

BOUNDS="python3 $(dirname "$0")/lib/ui-bounds.py"
EVIDENCE="$HEYTA_REPO_ROOT/apps/mobile/evidence"
SW_MID=540
# 标题刻意用 ASCII：`adb shell input text` 发不了非 ASCII（§7 第 43 条）。
TITLE="R1touchtargetaverylongtasktitleformeasuringtheleadingbox"

screen_size() {
  $ADB shell wm size 2>/dev/null | tr -d '\r' | sed -n 's/.*: *\([0-9]*\)x\([0-9]*\)/\1 \2/p' | tail -1
}
center_of() {
  # 传进来的可能是整行（`bounds<TAB>标签`），也可能只有坐标列。
  # 🔴 不能图省事写 `-F'[,\t]'`：BWK awk 在那里把 `\t` 当**字面 `t`**，标签里的 `t` 会变成分隔符
  #    （`toggles()` 下面记了它造成的假红）。先按 TAB 切出坐标列，再按逗号拆四个数。
  awk -F'\t' '{ split($1, b, ","); printf "%d %d\n", (b[1]+b[3])/2, (b[2]+b[4])/2 }' <<< "$1"
}

# 首启的隐私同意页（2026-10-01 落地）盖在**所有屏之上**，共享 lib 的
# `dismiss_welcome_if_present` 只认旧的欢迎页（「先离线使用」），对它一无所知 ——
# 实测：不点掉的话后面每一次 `input tap` 都落在遮罩上，症状长得像"应用没起来"。
# 这里走真实出口（点「只用本机」），**不往 SharedPreferences 塞值**：伪造的初始状态
# 会让"首启用户看到的到底是什么"这件事永远验不到。
# ⚠️ 写在**本脚本里**而不是共享 lib：这个功能还在另一条会话手里改，
#    动 `lib/mobile-e2e.sh` 会撞车；将来它进了 lib，这段有存在性判断，重复执行不出事。
dismiss_privacy_consent_if_present() {
  dump
  if [ "$(has_text "只用本机")" != "1" ]; then
    return 0
  fi
  local xy
  xy=$(xy_text "只用本机")
  [ -z "$xy" ] && xy=$(xy_desc "只用本机")
  if [ -z "$xy" ]; then
    bad "隐私同意页在，但取不到「只用本机」的坐标（文案改了？）"
    return 1
  fi
  $ADB shell input tap $xy
  sleep 3
  echo "     已离开隐私同意页（点「只用本机」@ ${xy}）"
  return 0
}

# 🔴 两条阈值都**从 token 推导**（§7 元规则二：不写魔法数字）。
#   · `touch-target.min` = 44dp（tokens.css）→ 命中区宽高下限
#   · `screen.gutter`    = 16dp（tokens.css）→ 行的左边，也就是"借位"的分界线
DENSITY=$($ADB shell wm density 2>/dev/null | tr -d '\r' | sed -n 's/.*: *\([0-9]*\)/\1/p' | tail -1)
D=${DENSITY:-420}
MIN_HIT=$(awk -v d="$D" 'BEGIN{ printf "%d", 44*d/160 }')
GUTTER=$(awk -v d="$D" 'BEGIN{ printf "%d", 16*d/160 }')
echo "   密度 ${D} ⇒ 命中区下限 44dp = ${MIN_HIT}px，行左边 screen.gutter 16dp = ${GUTTER}px"

# 勾选框那一颗：可点、且无障碍标签是「完成：<标题>」/「取消完成：<标题>」。
# 🔴 必须用**标签前缀**筛，不能只 `sub "$TITLE"` —— 「打开任务：<标题>」那一颗
# （行体）也含同一段文字，混进来的话测的就不是勾选框了。
# 🔴🔴 分隔符踩了一次：**`-F'[,\t]'` 在这台机器的 awk（BWK awk）里把 `\t` 当字面字符 `t`**，
# 于是 `完成：R1touchtarget…title…` 被在每一个 `t` 上切碎，`$2` 成了坐标片段而不是标签，
# 筛出来永远是空 —— 报出来的症状是"列表里没有勾选框那颗可点节点"（实测就是这句），
# 而节点一直在那儿：`42,1443,158,1559  完成：…`，`class=android.widget.CheckBox`、`clickable=true`。
# 行形状是 `bounds<TAB>标签` ⇒ **先按 TAB 分列**，坐标那一列再由后面的 `cut -f1 | awk -F,` 拆。
toggles() {
  $BOUNDS clickable-below 0 | grep "$TITLE" | awk -F'\t' '$2 ~ /^(取消)?完成：/'
}

echo ""
echo "=== 移动端任务行勾选框几何验收（真实模拟器，零 mock）==="
echo "  设备: ${HEYTA_E2E_SERIAL:-emulator-5554}"

step "0. 装上当前源码打的包并启动"
$ADB shell am force-stop com.heytamobile >/dev/null 2>&1
$ADB uninstall com.heytamobile >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell pm clear $PKG >/dev/null 2>&1
$ADB shell am force-stop $PKG; sleep 1
$ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 6
dismiss_welcome_if_present
dismiss_privacy_consent_if_present || { screen_txt; summary "移动端任务行勾选框"; exit 1; }
# 🔴 实测的首启顺序是 **同意页在欢迎页底下先出现**：点掉「只用本机」之后，
# 「先离线使用」那张才露出来。只按一种顺序写，第二次跑就会卡在欢迎页上，
# 而症状又是一句"首屏没有新建任务"。两道闸门各自都是"在场才点"，所以再走一遍欢迎页。
dismiss_welcome_if_present
dump
require_screen
# 🔴 判据问的是"能不能开始操作"，不是"有没有渲染"。上一版这里写的是 `has_text "任务"`，
# 而首屏被隐私同意页盖住时**应用明明起来了**、屏幕上有内容，报出来的却是"应用没起来" ——
# 一条会把人往错方向带的判据比没有判据更糟（§7 元规则一）。改成直接问后面要用到的那颗控件。
#
# ⚠️ 实测两种落点都会出现：落在任务屏（多数），或落在「我的」屏（走完首启闸门之后）。
# 那不是产品缺陷，是**载体的起点不确定** —— 所以这里先自己走回任务屏（点底部「任务」那一格），
# 而不是点一次没中就判红。走不回才算失败，且报的是"到不了能新建任务的屏"。
ON_TASKS=0
for attempt in 1 2 3; do
  if [ "$(has_desc "新建任务")" = "1" ] || [ "$(has_text "新建任务")" = "1" ]; then
    ON_TASKS=1
    break
  fi
  TAB=$(xy_text "任务")
  [ -z "$TAB" ] && break
  $ADB shell input tap $TAB; sleep 2
  dump; require_screen
done
if [ "$ON_TASKS" = "1" ]; then
  ok "应用已启动，落在能找到「新建任务」的任务屏"
else
  bad "走完首启闸门后仍到不了任务屏（屏上内容见下）"; screen_txt
  summary "移动端任务行勾选框"; exit 1
fi

step "1. 建一条长标题任务（走真实 Composer → 真实 op）"
disable_ime
# ⚠️ 实测撞过一次：浮层（同意页/欢迎页）的收尾动画还没落位，这一次 `input tap` 被底下那层
# 吃掉，屏幕变成「我的成长」—— 于是报出来的是"新建面板里找不到输入框"。
# 那是**载体的时序**，不是产品缺陷（§7 元规则一：先怀疑探针）。所以这里重试并先回任务屏，
# 而不是点一次就判红。
EDIT=""
for attempt in 1 2 3; do
  dump; require_screen
  if [ "$(has_desc "新建任务")" != "1" ]; then
    TAB=$(xy_text "任务")
    [ -n "$TAB" ] && { $ADB shell input tap $TAB; sleep 2; }
  fi
  XY=$(xy_desc "新建任务")
  [ -z "$XY" ] && continue
  $ADB shell input tap $XY; sleep 2
  dump; require_screen
  EDIT=$(xy_edit_any)
  [ -n "$EDIT" ] && { echo "   第 ${attempt} 次点开新建面板（FAB @ ${XY}）"; break; }
done
if [ -z "$EDIT" ]; then
  bad "三次都没能打开新建面板"
  screen_txt; summary "移动端任务行勾选框"; exit 1
fi
XY="$EDIT"
$ADB shell input tap $XY; sleep 1
$ADB shell input text "$TITLE" >/dev/null 2>&1; sleep 1
dump; require_screen
ADD=$(center_of "$($BOUNDS text "添加" | head -1)")
if [ -z "$ADD" ] || [ "$ADD" = "0 0" ]; then
  bad "找不到「添加」按钮"; screen_txt; summary "移动端任务行勾选框"; exit 1
fi
$ADB shell input tap $ADD; sleep 3
dump
require_screen
if [ "$(has_sub "$TITLE")" = "1" ]; then
  ok "任务已落库并出现在列表里"
else
  bad "任务没出现在列表里（后面的判据都没有意义了）"; screen_txt
  summary "移动端任务行勾选框"; exit 1
fi

# ── 判据 ① ──────────────────────────────────────────────
step "2. 判据 ①：命中区宽高都 ≥ 44dp（+ 护栏 ②：不越出行左边与屏底）"
read -r SW SH <<< "$(screen_size)"
T=$(toggles | head -1)
if [ -z "$T" ]; then
  bad "列表里没有勾选框那颗可点节点（标签应是「完成：<标题>」）"; screen_txt
  summary "移动端任务行勾选框"; exit 1
fi
echo "   勾选框矩形: $T"
L=$(cut -f1 <<< "$T" | awk -F, '{print $1}')
W=$(cut -f1 <<< "$T" | awk -F, '{print $3-$1}')
H=$(cut -f1 <<< "$T" | awk -F, '{print $4-$2}')
B=$(cut -f1 <<< "$T" | awk -F, '{print $4}')
echo "   宽 ${W}px / 高 ${H}px / 左边 ${L}px / 底边 ${B}px（屏幕 ${SW}×${SH}）"
# ⚠️ 变量名不能叫 `FAIL`：共享 lib 用 `FAIL` 做**总失败计数器**（`bad()` 里 `FAIL=$((FAIL+1))`），
# 我上一版在这里写 `FAIL=""` 把它清了 ⇒ 收尾变成「通过 4 项，失败  项」并以
# `[: : integer expression expected` + ❌ 有失败项 结束 —— **一轮全绿的验收被载体自己判成红**。
# 这是撞出来的真坑：共享 lib 里的名字就是命名空间，脚本自己起名要避开。
# 🔴 四条各报各的 ok/bad，不合并成一条 —— 合并的话"只给宽不给高"和"四条全塌"
#    在计数上长得一样，变异就没法逐条归因了。
if [ "$W" -ge "$MIN_HIT" ]; then
  ok "判据 ①a 宽度 ${W} ≥ ${MIN_HIT}px（44dp）"
else
  bad "宽度 ${W} < ${MIN_HIT}：命中区还是那个视觉圈的大小（类 A 没修）"
fi
if [ "$H" -ge "$MIN_HIT" ]; then
  ok "判据 ①b 高度 ${H} ≥ ${MIN_HIT}px（44dp）"
else
  bad "高度 ${H} < ${MIN_HIT}：同上（只给一个方向不算修）"
fi
# 🔴 ②a/②b 是**护栏**，不是承重判据 —— 这是测出来的，不是推测的：
# 把 `checkboxHit` 注回修前那版（只有 `marginLeft: -11`、没有任何尺寸）以后，
# ①a 宽 29<115 红、①b 高 58<115 红，而 **②a 左边仍然 42 ≥ 42，不红**。
# 原因：Android 无障碍树报的是**布局后**的矩形，负边距那 11dp 探出被它自己吸进了
# 行的左边距里 ⇒ 类 B 在这条载体上**没有 rect 信号**。它在桌面载荷上才咬人
# （那里 `overflow-x: hidden` 是真裁剪，见 §2.1 的 x=317 vs 可视左边 328）。
# 所以：移动端类 B 的证据是**截图**（人已看过：整颗方框在屏内），
# ②a/②b 留着只挡"将来有人把命中区整个推出屏/推出行"这一类新坏法。
if [ "$L" -ge "$GUTTER" ]; then
  ok "护栏 ②a 左边 ${L} ≥ 行左边 ${GUTTER}px（16dp），没有借位探出"
else
  bad "左边 ${L} < 行边 ${GUTTER}：命中区被推到行的左边距之外"
fi
if [ "$B" -le "$SH" ]; then
  ok "护栏 ②b 底边 ${B} ≤ 屏幕高 ${SH}px，整颗都在屏内"
else
  bad "底边 ${B} > 屏幕高 ${SH}：整颗被切到屏外"
fi
$ADB shell screencap -p /sdcard/r1.png >/dev/null 2>&1
$ADB pull /sdcard/r1.png "$EVIDENCE/android-task-row-checkbox.png" >/dev/null 2>&1
echo "   📷 截图: $EVIDENCE/android-task-row-checkbox.png（**人必须打开看**）"

# ── 判据 ③ ───────────────────────────────────────────────
# 点**命中区中心**。这一条挡的是前两条的合谋漏网：宽高都够、位置也对，
# 但那一层实际上不接收点击（例如可点性挂在里面那颗 22px 的圈上）。
step "3. 判据 ③：点命中区中心真的把任务改成已完成"
BEFORE=$(cut -f2 <<< "$T")
$ADB shell input tap $(center_of "$T"); sleep 2
dump
require_screen
AFTER=$(toggles | head -1)
LABEL=$(cut -f2 <<< "${AFTER:-}" )
echo "   点前标签: $BEFORE"
echo "   点后标签: ${LABEL:-（那颗不在了）}"
case "$LABEL" in
  取消完成：*) ok "标签翻成「取消完成：…」，命中区点得中" ;;
  *) bad "点命中区中心没有改成已完成 —— 可点性不在这一层" ;;
esac

restore_ime
summary "移动端任务行勾选框"
