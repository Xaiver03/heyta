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
# 移动端四象限「铺满」的**几何**验收（真模拟器，零 mock）
# ========================================================
#
# 这一条是 R2（`docs/plans/ui-review-fill-zh-timeline.md` §3）的**主战场判据**。
# 桌面载荷那份在 `e2e/tests/quadrant-fill.spec.ts`（真 Chromium + 真盒模型）。
# 两边跑的是**同一个共享层** `packages/ui/src/quadrant/QuadrantBoard.tsx`，
# 但盒模型是两套引擎（CSS 弹性盒 vs Yoga），**谁也不能代替谁**。
#
# ─────────────────────────────────────────────────────────────────────────
# 🔴 类 C 在移动端的表现**不是**"没长满"，而是"契约换了一个分支"
#
# 手机宽 < `layout.two-column-min`（768px）⇒ `QuadrantBoard` 走**单列**（`stack`）。
# 单列下四格各有 `minHeight: layout.quadrant-min-height`（12rem = 192dp），
# 实测 4×192dp + 三条缝 ≈ 800dp，而本机的滚动视口只有 ≈ 410dp ⇒ **总和必然超过视口**。
# `flex-grow` 分配的是**剩余**自由空间（弹性盒 §9.7），剩余是 0 ⇒
# 板子那句 `flexGrow: 1` 在这条载体上**今天什么都不分配**。
#
# 所以这里判的不是"板子长到多高"，而是同一条"只长不缩"在移动端应当产生的**结果**：
# **每一格都够得着**（靠滚动，而不是被压扁或被裁）。
#
# 🔴 两条决定判据形状的**实测事实**（第一轮跑出来的，不是推测的）：
#   1. RN 交给无障碍树的矩形是**裁到父层可视区**的 —— 折叠线以下那格报成负高
#      （修前实测 `[84,2199][996,2166]`，高 = **-33px**，而它的真实兄弟格高 504px）；
#   2. **超出得多的那一格整节点不在树里** —— 不滚的时候 dump 只有
#      `quadrant-cell-1/2/3`，4 号**根本不存在**（第一轮就是它把 ① 判成 `total=3` 红）。
# 于是"节点在树里"不等于"用户看得见"，而**静态一帧里数节点数**也不等于"节点不在树里" ——
# 两种假信号都来自"拿一帧当全部"（§7 元规则一：探针够不着和被测对象没做，输出长得一模一样）。
# ⇒ ①（在树里）和 ③（看得见）**都必须从滚动扫描里取**：跨帧并集才是真的集合。
#
# ⚠️ 高度判据**必须带容差**，而且这容差也是实测的：同一份基线里四格的最大高是
#   **504 / 503 / 504 / 504**（修前的旧包还见过 502）—— 那 1~2px 是 1dp 边框与 dp→px 取整，
#   **不是**"没长到 minHeight"。严格 `≥ 504` 会假红（第一轮就是这么红的）。
#
# 🔴 承重关系（**变异实测**，2026-10-02：两份变异包各跑一轮，不是推测）：
#   · `Screen` 的 `ScrollView` = **承重**。把 `scroll ?` 那一支注掉（⇒ 走 `View`）后：
#       ④ 红（`scrollables=0`）、① 红（4 号格 12 帧都没进过树）、
#       ③ 红（3、4 号从未完整可见；3 号被切成 **201px**、4 号高 0）。
#       ②/⑤ 仍然绿 —— 横向铺满不需要滚动所有者，这个分工是对的。
#   · `contentContainerStyle` 与 body 上的 `flexGrow` = **护栏、今天不承重**：
#       两处一起删掉后**逐帧矩形与基线完全一致**（帧记录 `diff` 0 行，
#       四格最大高都是 504/503/504/504）⇒ 剩余空间本来就是 0，那句 `flexGrow` 分配不到东西。
#       它挡的是"任务少到一屏装得下"那种状态下板子不长的情形（§3.4）。
#   把它标成护栏而不是判据，和 R1 的 ②a、R5 的 A/D 是同一条纪律：
#   **一条永远通过的判据比没有判据更糟**（§7 元规则二）。
#
# ⚠️ 变异还照出**本脚本自己**的一处坏法：删掉 `ScrollView` 之后，"前提断言"那一支
#   会报一句指错方向的话（"本机已装得下"）—— 因为没滚动所有者时视口取的是**退化值**
#   （整屏 2400px）。所以那一支现在只**说明**、不判，证据交给 ①③ 那两条红。
#
# ─────────────────────────────────────────────────────────────────────────
# 用法
#   bash scripts/verify-mobile-quadrant-fill.sh
#
# 前置：模拟器在跑（emulator-5554）；`pnpm build:android` 已按当前源码打过。
#       **不需要服务端与凭据**，也**不清数据**（判据只看几何，空格子照样有 minHeight）。
#       ⚠️ 刻意不 `pm clear`、不 uninstall：这台设备与另一条会话共用，
#          清库会把对方正在跑的真机验收的现场抹掉。
#       ⚠️ **同一个理由**：打包抓的是**工作树**，不是某个分支。实测过一次"torn build"——
#          另一条会话 01:15:05 落了 `timeline-labels.ts` + 两个词条文件，而它的
#          `packages/i18n/dist` 要到 01:18:53 才重生成；我这 01:15:26 的包正好把
#          **新消费者 + 旧词条表**打在了一起，装上去以
#          `[@heyta/i18n] 词条不存在：zh-CN / web.board.untitledTask` 崩在启动。
#          症状长得像"我的改动弄坏了产品"，实际与我的改动无关。
#          ⇒ 打完包先 `adb logcat -b crash` 看一眼再跑判据；崩溃先查词条时间戳。
#
# ⚠️ **没有**注册成根 `pnpm verify:mobile-quadrant-fill`：根 `package.json` 此刻带着
#    另一条会话未提交的 hunk，动它就是替别人提交。这条缺口登记在计划 §3.4。

set -u
export PATH="/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/lib/mobile-e2e.sh"

EVIDENCE="$HEYTA_REPO_ROOT/apps/mobile/evidence"
TOKENS="$HEYTA_REPO_ROOT/packages/design-system/src/tokens.css"
QRECT=/tmp/_qrect.py
FRAMES_LOG=/tmp/qfill-frames.txt

# 变异验证用：把被测产物指到另一份 apk（默认仍是 lib 里那条共享构建路径）。
# lib 不许改（另一条会话在用），所以覆盖点放在这里。
APK="${HEYTA_APK:-$APK}"

# 🔴 本验收全程不落任何要出门的动作（实测：`configure_sync_credentials` /
#    `wait_laptop_has` / 笔记本 CLI 三类调用行数都是 0），所以点**「只用本机」**：
#    这既是真用户走这条旅程时的选择，也让"这条验收其实不需要联网"变成一条
#    可被门禁核对的声明（`check:mobile-first-run-gate` 判据 4）。
CONSENT_GATE_PREFERRED=只用本机

# 🔴 帧记录**一开场就清空**：它只在扫描那一步被重写，如果本轮在扫描之前就失败退出，
# 留在磁盘上的会是**上一轮**的记录。实测踩过：一次载体故障让脚本 0 判据通过就退出，
# 而我拿"帧矩形与基线逐像素一致"当成了本轮的变异结论 —— 那份 log 是上一轮的。
: > "$FRAMES_LOG"

# ── 探针：从 uiautomator 的 XML 里读**矩形**，并能沿父链找滚动祖先 ──────────
# 为什么不用现成的 `ui-bounds.py`：它按 text/content-desc 找，而这里要按
# `resource-id`（RN 的 `testID` 在 Android 上就落在这一位 —— 已实测：dump 里
# 确有 `resource-id="quadrant-cell-1"`），并且要**沿父链**找滚动祖先。
# 写成 /tmp 下的独立探针文件（和 lib 里 `_xy.py` 同一个路子），不进共享 lib，
# 免得和另一条会话撞车。
cat > "$QRECT" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

XML = "/tmp/ui.xml"
BOARD = "quadrant-board"


def tree():
    root = ET.parse(XML).getroot()
    parent = {c: p for p in root.iter() for c in p}
    return root, parent


def rect(node):
    m = re.match(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", node.get("bounds", ""))
    return tuple(int(g) for g in m.groups()) if m else None


def find(rid):
    root, _ = tree()
    out = []
    for n in root.iter("node"):
        if n.get("resource-id") == rid:
            r = rect(n)
            if r:
                out.append(r)
    return out


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "count":
        root, _ = tree()
        hits = {}
        for n in root.iter("node"):
            m = re.match(r"^quadrant-cell-([1-4])$", n.get("resource-id") or "")
            if m and rect(n):
                hits[m.group(1)] = hits.get(m.group(1), 0) + 1
        for k in "1234":
            print(f"cell{k}={hits.get(k, 0)}")
        print(f"total={sum(hits.values())}")
    elif mode == "cells":
        # 一行一格：格号 l t r b（供调用方在 shell 里算宽高）
        root, _ = tree()
        rows = []
        for n in root.iter("node"):
            m = re.match(r"^quadrant-cell-([1-4])$", n.get("resource-id") or "")
            if m and rect(n):
                rows.append((int(m.group(1)), *rect(n)))
        for row in sorted(rows):
            print(" ".join(map(str, row)))
    elif mode == "cell":
        for r in find("quadrant-cell-" + sys.argv[2]):
            print(" ".join(map(str, r)))
    elif mode == "board":
        for r in find(BOARD):
            print(" ".join(map(str, r)))
    elif mode == "scroller":
        root, parent = tree()
        node = next((n for n in root.iter("node") if n.get("resource-id") == BOARD), None)
        if node is None:
            print("scrollables=-1")
            return 0
        hits, best = 0, None
        cur = parent.get(node)
        while cur is not None:
            if cur.get("scrollable") == "true":
                hits += 1
                if best is None:
                    r = rect(cur)
                    if r:
                        best = (*r, cur.get("class", ""))
            cur = parent.get(cur)
        print(f"scrollables={hits}")
        if best:
            print("rect %d %d %d %d %s" % best)
    else:
        print("用法: qrect.py {count|cells|cell N|board|scroller}")
        return 2
    return 0


sys.exit(main())
PY

# ── 阈值全部从 tokens.css 现场读（§7 元规则二：不写死 192 / 16 / 2）──────────
read_token_dp() {  # <变量名> —— rem → dp（root 16px）
  local raw
  raw=$(grep -o -- "--ht-$1: *[0-9.]*rem" "$TOKENS" | head -1 | sed 's/.*: *//; s/rem//')
  [ -z "$raw" ] && { echo ""; return; }
  awk -v r="$raw" 'BEGIN{ printf "%d", r*16 }'
}

dp2px() { awk -v d="$D" -v v="$1" 'BEGIN{ printf "%d", v*d/160 }'; }

MIN_CELL_DP=$(read_token_dp layout-quadrant-min-height)
BOARD_PAD_DP=$(read_token_dp space-4)
GUTTER_DP=$(read_token_dp screen-gutter)
DENSITY=$($ADB shell wm density 2>/dev/null | tr -d '\r' | sed -n 's/.*: *\([0-9]*\)/\1/p' | tail -1)
D=${DENSITY:-420}

echo ""
echo "=== 移动端四象限铺满验收（真实模拟器，零 mock）==="
echo "  设备: ${HEYTA_E2E_SERIAL:-emulator-5554}"

step "0. 阈值前提：token 读得到，换算才成立"
# 🔴 这三个值一旦读空，下面每条判据都变成"跟 0 比大小"的**永远通过**。
# 所以这里不是打印信息，是判据：读不到就终止整轮（退出码 3 = 环境上就不成立）。
if [ -z "$MIN_CELL_DP" ] || [ -z "$BOARD_PAD_DP" ] || [ -z "$GUTTER_DP" ]; then
  echo "   ❌ tokens.css 里读不到 layout-quadrant-min-height / space-4 / screen-gutter"
  echo "      （三条阈值全部由它推导；读空 ⇒ 后面每条判据都会假绿）"
  exit 3
fi
MIN_CELL=$(dp2px "$MIN_CELL_DP")
BOARD_PAD=$(dp2px "$BOARD_PAD_DP")
GUTTER=$(dp2px "$GUTTER_DP")
TOL=$(dp2px 2)  # RN 的 dp→px 是浮点、无障碍矩形只报整数，边框(1dp)还会吃掉 2~3px
# 🔴 高度判据用 MIN_OK 而不是 MIN_CELL：见文件头那条实测（同帧里 504 与 502 并存）。
# 容差不是"放水"，是**把这 2px 的来源说清楚**；真的没长到 minHeight 会一次短 2 倍以上。
MIN_OK=$(( MIN_CELL - TOL ))
read -r SW SH <<< "$($ADB shell wm size 2>/dev/null | tr -d '\r' | sed -n 's/.*: *\([0-9]*\)x\([0-9]*\)/\1 \2/p' | tail -1)"
echo "   密度 ${D} ⇒ 格子下限 ${MIN_CELL_DP}dp=${MIN_CELL}px（判据取 ≥${MIN_OK}px）/ 板子内边距 ${BOARD_PAD_DP}dp=${BOARD_PAD}px / 页边 ${GUTTER_DP}dp=${GUTTER}px / 容差 ${TOL}px"
echo "   屏幕 ${SW}×${SH}"

step "1. 装上当前源码打的包并走到「四象限」那一档"
$ADB shell am force-stop $PKG >/dev/null 2>&1
$ADB install -r "$APK" 2>&1 | tail -1 | sed 's/^/   /'
$ADB shell am force-stop $PKG; sleep 1
launch_app; sleep 6

# 首启两道闸门（同意页 / 欢迎页）。与 `verify-mobile-task-row.sh` 里那段同源，
# 复制而不抽共享 lib：同意页还在另一条会话手里改，动 `lib/mobile-e2e.sh` 会撞车。
dump
if [ "$(has_text "只用本机")" = "1" ]; then
  XY=$(xy_text "只用本机"); [ -z "$XY" ] && XY=$(xy_desc "只用本机")
  if [ -n "$XY" ]; then $ADB shell input tap $XY; sleep 3; echo "     已离开隐私同意页（点「只用本机」）"; fi
fi
dismiss_welcome_if_present

# 到任务屏 → 点「四象限」那一档。判据问的是"板子在不在"，不是"点没点到"，
# 所以点一次不中不判红（§7 元规则一），走完四圈还看不见才算载体不成立。
#
# 🔴 每一圈都先 `ensure_app_foreground`：实测换装另一份 apk（变异验证）之后
#    `am force-stop` + 冷启动有一次**停在了桌面启动器**上，于是后面四次点击
#    全打在启动器图标上，报出来的是"板子不在树上"（听着像产品缺陷，其实是没进应用）。
#    lib 里那句注释就是为这件事写的：前台不是本应用时，点击会打进**别的应用**。
ON_BOARD=0
for attempt in 1 2 3 4; do
  ensure_app_foreground; sleep 2
  dump; require_screen
  if [ -n "$(python3 "$QRECT" board 2>/dev/null | head -1)" ]; then ON_BOARD=1; break; fi
  TAB=$(xy_text "任务"); [ -n "$TAB" ] && { $ADB shell input tap $TAB; sleep 2; dump; }
  CHIP=$(xy_text "四象限"); [ -z "$CHIP" ] && CHIP=$(xy_desc "四象限")
  [ -n "$CHIP" ] && { $ADB shell input tap $CHIP; sleep 2; }
done
if [ "$ON_BOARD" != "1" ]; then
  bad "走不到「四象限」那一档（板子不在树上）"; screen_txt
  summary "移动端四象限铺满" "" 1
fi
ok "已到四象限档"

# ── 判据 ④（先跑，后面两条要用它定的折叠线）────────────────
step "2. 判据 ④：滚动所有者 = 板子祖先里恰有一个 scrollable 节点"
python3 "$QRECT" scroller | sed 's/^/   /'
SCROLL_INFO=$(python3 "$QRECT" scroller)
NSCROLL=$(sed -n 's/scrollables=//p' <<< "$SCROLL_INFO")
SL=""; ST=""; SR=""; SB=""
# 行形状：`rect <l> <t> <r> <b> <class>`（没有可滚动祖节点时整行为空）
set -- $(grep '^rect ' <<< "$SCROLL_INFO" | cut -d' ' -f2-5)
SL=${1:-}; ST=${2:-}; SR=${3:-}; SB=${4:-}
if [ "$NSCROLL" = "1" ]; then
  ok "判据 ④ board 往上**恰好一个**可滚动祖节点（挡 ScrollView→View；也挡将来嵌套出两个滚动所有者）"
  [ "$SB" -gt "$SH" ] && SB=$SH
  FOLD=$SB
  echo "   滚动视口 [$SL,$ST][$SR,$SB] ⇒ 折叠线 ${FOLD}px"
else
  # 没有滚动所有者时也要能把后面的算术跑完（否则 `set -u` 直接炸，
  # 报出来的是一句 shell 错误而不是那句「内容被裁」）：退化成整屏当视口。
  [ -z "$SL" ] && { SL=0; ST=0; SR=$SW; SB=$SH; }
  FOLD=$SH
  if [ "$NSCROLL" = "0" ]; then
    bad "判据 ④ board 往上**没有任何**可滚动祖节点 ⇒ 超出视口的内容永远够不着（那是被裁，不是能滚）"
  else
    bad "判据 ④ 有 ${NSCROLL} 个嵌套滚动祖节点 ⇒ 滚动所有者不唯一，用户不知道该滚哪一层"
  fi
fi

# ── 判据 ② ───────────────────────────────────────────────
step "3. 判据 ②：每一格**横向**铺满板子内宽（R2 里「宽」那一半）"
read -r BL BT BR BB <<< "$(python3 "$QRECT" board | head -1)"
BOARD_INNER=$(( (BR - BL) - 2 * BOARD_PAD ))
read -r C1L C1T C1R C1B <<< "$(python3 "$QRECT" cell 1 | head -1)"
if [ -z "${C1L:-}" ]; then
  bad "读不到 quadrant-cell-1 的矩形"; screen_txt
else
  W=$((C1R - C1L))
  echo "   板子外宽 $((BR-BL))px − 内边距 2×${BOARD_PAD}px ⇒ 内宽 ${BOARD_INNER}px；第一格宽 ${W}px / 左边 ${C1L}px"
  DIFF=$(( W - BOARD_INNER )); [ "$DIFF" -lt 0 ] && DIFF=$(( -DIFF ))
  if [ "$DIFF" -le "$TOL" ]; then
    ok "判据 ②a 格子宽 ${W} == 板子内宽 ${BOARD_INNER}（差 ${DIFF} ≤ ${TOL}）"
  else
    bad "格子宽 ${W} ≠ 板子内宽 ${BOARD_INNER}（差 ${DIFF}）⇒ 横向没铺满"
  fi
  if [ "$C1L" -ge $(( BL + BOARD_PAD - TOL )) ]; then
    ok "判据 ②b 格子左边 ${C1L} ≥ 板子内容线 $((BL+BOARD_PAD))（没越过内边距）"
  else
    bad "格子左边 ${C1L} < 内容线 $((BL+BOARD_PAD))：格子探出板子的内容区"
  fi
fi

# 护栏 ⑤：与 R1 的 ②a 同一实测机制 —— Android 报的是**布局后**的矩形，
# 类 B 的"负边距探出"在这条载体上没有 rect 信号，所以它只挡"整块推出页边"这一类新坏法。
if [ -n "${BL:-}" ] && [ "$BL" -ge "$GUTTER" ]; then
  ok "护栏 ⑤ 板子左边 ${BL} ≥ 页边 ${GUTTER}px（**不承重**，只挡将来整块推出页边）"
else
  bad "板子左边 ${BL:-?} < 页边 ${GUTTER}：整块被推到页边之外"
fi

# ── 判据 ① / ①b / ③：同一次滚动扫描的三个出口 ────────────────
# 为什么必须扫：静态一帧里 4 号格**可能整节点不在树上**（文件头事实 2），
# 所以"在树里"（①）和"看得见"（③）都只能取**跨帧并集**；
# ①b「重影」反过来钉上界：任何一帧都不许出现同一格号两份（那意味着渲染了两遍）。
step "4. 判据 ①／①b／③：滚动扫描 —— 每格都要出现过、不得有重影、且各有一次完整落进视口且高 ≥ ${MIN_CELL_DP}dp"
MID_X=$(( (SL + SR) / 2 ))
[ "$MID_X" -gt 0 ] 2>/dev/null || MID_X=$(( SW / 2 ))
TOP_Y=$(( ST + 300 )); BOT_Y=$(( SB - 300 ))
[ "$TOP_Y" -lt "$BOT_Y" ] 2>/dev/null || { TOP_Y=$(( SH / 3 )); BOT_Y=$(( SH * 2 / 3 )); }

# 先滚回顶（往下拖 = 内容往上回），再从顶逐格往下滚，每一帧采一次矩形。
for i in 1 2 3 4; do $ADB shell input swipe $MID_X $TOP_Y $MID_X $BOT_Y 350 >/dev/null 2>&1; done
sleep 1

OBS=""
COMPLETE=""
DUP=""
MAXH=""
FRAMES=12
: > "$FRAMES_LOG"

# 🔴 跨帧并集**不能在 shell 变量里累加** —— bash 3.2（这台机器的 /bin/bash）实测：
#   `while read … done <<< "$X"` 放在 `for` 里，循环体对外层变量的赋值**每轮被吃掉**
#   （最小复现：三轮各喂 "1 2 3"，累加变量最后一轮只剩 " 1"）。
# 症状会是"每一格都没完整见过"—— 一句**关于产品的假红**。
# ⇒ 状态只放**文件**（帧记录），并集用 awk 从文件里算；awk 里顺手算宽高，
#   免得再把字段序抄错一遍（第一次跑就抄错过：用 `$5-$2` 当高度，报了 1548/2082 这种数）。
union_of() {
  awk -v st="$ST" -v fold="$FOLD" -v minok="$MIN_OK" '
    $1 == "frame" { fr = $2; next }
    NF == 5 && $1 ~ /^[1-4]$/ {
      k = $1; h = $5 - $3
      seen[k] = 1
      if (h > maxh[k]) maxh[k] = h
      if ($3 >= st && $5 <= fold && h >= minok) okc[k] = 1
      cnt[k "," fr]++
    }
    END {
      o = ""; c = ""; m = ""
      for (k = 1; k <= 4; k++) {
        if (seen[k]) o = o k " "
        if (okc[k])  c = c k " "
        m = m maxh[k] + 0 " "
      }
      d = ""
      for (key in cnt) if (cnt[key] > 1) { split(key, p, ","); d = d p[1] " " }
      printf "obs %s\nok %s\nmaxh %s\ndup %s\n", o, c, m, d
    }' "$FRAMES_LOG"
}

for round in $(seq 1 $FRAMES); do
  dump >/dev/null 2>&1; require_screen
  CELLS=$(python3 "$QRECT" cells)
  { echo "frame $round"; echo "$CELLS"; } >> "$FRAMES_LOG"
  # 本帧的只读信息（真正的并集在 union_of 里）
  SEEN_NOW=$(awk 'NF==5 && $1 ~ /^[1-4]$/ {printf "%s ", $1}' <<< "$CELLS")
  OK_NOW=$(awk -v st="$ST" -v fold="$FOLD" -v minok="$MIN_OK" 'NF==5 && $1 ~ /^[1-4]$/ && $3 >= st && $5 <= fold && ($5-$3) >= minok {printf "%s ", $1}' <<< "$CELLS")
  UNION=$(union_of)
  OBS=$(sed -n 's/^obs //p' <<< "$UNION")
  COMPLETE=$(sed -n 's/^ok //p' <<< "$UNION")
  echo "   第 ${round} 帧：格号 →${SEEN_NOW}｜本帧完整可见 →${OK_NOW}｜累计 →${COMPLETE}"
  if [ "$(echo "$OBS" | wc -w)" -ge 4 ] && [ "$(echo "$COMPLETE" | wc -w)" -ge 4 ]; then
    echo "   四格都已完整可见，提前收扫描"
    break
  fi
  $ADB shell input swipe $MID_X $BOT_Y $MID_X $TOP_Y 400 >/dev/null 2>&1
  sleep 1
done

MAXH=$(sed -n 's/^maxh //p' <<< "$UNION")
DUP=$(sed -n 's/^dup //p' <<< "$UNION")

# 🔴 每格在这一轮里达到的**最大高度**：这是"容差那件事"的证据来源，
# 也防"刚好压线一点点"—— 真没长到 minHeight 会一次短 2 倍以上，不会只是差 2px。
echo "   各格跨帧最大高度（px，按格号 1…4；判据线 ${MIN_OK} = token ${MIN_CELL} − 容差 ${TOL}）："
echo "     $MAXH"
echo "   帧记录: $FRAMES_LOG"

missing() {
  local list="$1" out=""
  for k in 1 2 3 4; do case " $list " in *" $k "*) ;; *) out="$out $k";; esac; done
  echo "$out"
}

MISS_OBS=$(missing "$OBS")
if [ -z "$MISS_OBS" ]; then
  ok "判据 ① 四格都**在树里出现过**（quadrant-cell-1…4，跨 ${FRAMES} 帧的并集）"
else
  bad "判据 ① 这些格滚到最后一帧都没进过树：${MISS_OBS} ⇒ 根本没渲染（或探针的 resource-id 变了）"
fi

if [ -z "$DUP" ]; then
  ok "判据 ①b 没有重影：没有任何一帧出现同一格号两份"
else
  bad "判据 ①b 这些格号在某一帧里出现了不止一份：${DUP} ⇒ 板子被渲染了两遍"
fi

MISS_OK=$(missing "$COMPLETE")
if [ -z "$MISS_OK" ]; then
  ok "判据 ③ 四格都在滚动过程中某一次**完整**落进视口，且那次高度 ≥ ${MIN_OK}px（= ${MIN_CELL_DP}dp − ${TOL}px 容差）"
else
  bad "判据 ③ 这些格从头滚到尾都没完整见过一次：${MISS_OK} ⇒ 内容被裁而不是能滚到"
fi

# 🔴 前提断言（§7 元规则二）：这条判据之所以有意义，是因为**内容确实比视口高**。
# 实测本机：四格总高 = 4×${MIN_CELL}px+缝 ≫ 视口高。若哪天装得下了，
# "可滚动"这条腿就没有前提可验，必须让它**响**而不是悄悄跳过。
TOTAL_CELL_H=$(( MIN_CELL * 4 ))
VIEW_H=$(( SB - ST ))
if [ "$NSCROLL" != "1" ]; then
  # 🔴 这一条**不能**在"没有滚动所有者"时判红或判绿：那种情况下 $ST/$SB 是退化值
  #   （整屏），于是 `2016 ≤ 2400` 会打印一句"本机已装得下" —— 而真正的原因是判据 ④ 已经红了。
  #   变异实测就是这样：注掉 ScrollView 后这里报"失去前提"，把人往"设备屏幕变大了"的方向带。
  #   前提断言问的是"滚这一腿有没有必要"，没有滚动所有者时这个问题不成立 ⇒ 只说明，不判。
  echo "   ⚠️ 前提未评估：没有滚动所有者（判据 ④ 已红），上面的视口是**退化值**（整屏 2400px）"
  echo "      四格总高 ${TOTAL_CELL_H}px；「够不够得着」的证据在判据 ①③ 那两条红里（实测：3 号被切成 201px、4 号根本不在树上）"
elif [ "$TOTAL_CELL_H" -gt "$VIEW_H" ]; then
  ok "前提成立：四格总高 ${TOTAL_CELL_H}px > 滚动视口 ${VIEW_H}px ⇒ 这里必须靠滚，判据 ③ 的前提不是编的"
else
  bad "前提不成立：四格总高 ${TOTAL_CELL_H}px ≤ 视口 ${VIEW_H}px ⇒ 本机已装得下，判据 ③ 的「滚得到」腿失去前提，载体要重新设计"
fi

$ADB shell screencap -p /sdcard/q1.png >/dev/null 2>&1
$ADB pull /sdcard/q1.png "$EVIDENCE/android-quadrant-fill-last.png" >/dev/null 2>&1
# 再回顶截一张"第一屏长什么样"
for i in 1 2 3 4; do $ADB shell input swipe $MID_X $TOP_Y $MID_X $BOT_Y 350 >/dev/null 2>&1; done
sleep 1; dump >/dev/null 2>&1
$ADB shell screencap -p /sdcard/q2.png >/dev/null 2>&1
$ADB pull /sdcard/q2.png "$EVIDENCE/android-quadrant-fill-top.png" >/dev/null 2>&1
echo "   📷 截图: $EVIDENCE/android-quadrant-fill-{top,last}.png（**人必须打开看**）"

summary "移动端四象限铺满"
