#!/bin/bash

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 对脚本是按字节偏移
#    增量读取的：运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。
#    入口先把整份脚本拷成同目录隐藏快照再 exec 副本 —— 之后对源文件的任何
#    编辑都影响不到本次运行；$0 的 dirname 不变，lib/tools 定位照旧。
case "$(basename "$0")" in
  .*.snap.*) ;;
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
# iOS 真模拟器上的「置顶」几何验收（零 mock）—— 滴答对齐 B5 / 阶段 2 的设备腿
# ==========================================================================
#
# 🔴 为什么单独有这一条
#
# 置顶这件事在 web 上曾经**整条是坏的**而所有单测都绿：写进 op-log 是真的，
# 但 web 展示顺序的那份所有者 `packages/domain/src/task-order.ts` 的 `sortTasks`
# 根本不认识 `pinnedAt`（2026-11-04 修，判据在 `packages/domain/tests/task-order.spec.ts`）。
# 而 `sortTasks` 是**跨端**的一份：`packages/ui/src/task-list/model.ts` 调它，
# 移动端的任务列表也走那个共享 model。⇒ 只验 web 不够：这一份改了，
# 手机上"钉住的那条排在最前"必须重新在真设备上量一次。
#
# 判据的形状（三条一起才算，缺一条都会假绿）：
#   ① **顺序按 y 坐标读**，不按"树里有没有这一行" —— ScrollView 折叠线以下的节点
#      仍在树里（`scripts/lib/mobile-e2e.sh` 的 `xy_edit_sane` 记过这条实测事实），
#      所以"存在"永远证明不了"在前"。
#   ② 置顶之后**再开一次菜单**，那一项自己要说「取消置顶」—— 证明写进去的是状态，
#      不是一次性的视觉抖动。
#   ③ 手机上那份真 SQLite 的 ops 行数**恰好 +1**，且最新那条 op 里带 `pinnedAt`
#      —— 一个用户意图 = 一个 op（AGENTS.md §3.4）。
#
# 🔴 长按这一件事的技术事实（写死在这里，免得下次又当魔法）：
#   `scripts/tools/ios-ax-shim.py` 没有长按档（它的 `--tap` 直接转 `idb ui tap`），
#   所以这一格走 `idb ui tap --duration <秒>`。⚠️ 单位是**秒**：
#   `--duration 300` 是三百秒的慢动作（同一族坑记在 journey 脚本的文件头注释里）。
#   坐标取自 shim 的 `--list`（它给的就是 idb 那套设备点坐标，同一空间）。

set -u
. "$(dirname "$0")/lib/mobile-e2e.sh"

DEVICE_NAME=${IOS_DEVICE_NAME:-iPhone 17 Pro}
BID=${IOS_BID:-com.heyta}
if [ -n "${IOS_UDID:-}" ]; then
  UDID="$IOS_UDID"
else
  UDID="$(xcrun simctl list devices 2>/dev/null | grep Booted | grep -F "$DEVICE_NAME" \
          | head -1 | sed -nE 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/p')"
  [ -n "$UDID" ] || UDID="$(xcrun simctl list devices 2>/dev/null | grep Booted \
          | head -1 | sed -nE 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/p')"
fi
[ -n "$UDID" ] || { echo "   ❌ 没有已启动的模拟器，且没给 IOS_UDID。" >&2; exit 1; }

IS_AX_SHIM="$(cd "$(dirname "$0")" && pwd)/tools/ios-ax-shim.py"
export IDB_UDID="$UDID"
resolve_idb || { echo "   ❌ 找不到 idb —— 长按这一格只有它能做。" >&2; exit 1; }

ax() { python3 "$IS_AX_SHIM" "$@" --udid "$UDID" --idb "$IDB_BIN" --companion "$IDB_COMPANION" --json; }
jget() { printf '%s' "$1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$2',''))" 2>/dev/null; }
phone_db() { echo "$(xcrun simctl get_app_container "$UDID" "${BID}" data 2>/dev/null)/Library/heyta.sqlite"; }
apps_count() { sqlite3 "${PHONE_DB}" "SELECT COUNT(*) FROM ops;" 2>/dev/null | tr -d ' '; }

# 取那一行无障碍节点上的一个字段（y / height / …）。
row_raw_field() {  # <标题> <字段>
  local out; out=$(ax "打开任务：$1" --pressable --list --json)
  [ "$(jget "$out" found)" = "True" ] || return 1
  jget "$out" "$2"
}

# 行的中心点（设备坐标）。找不到就返回空 —— 调用方必须把空当成红，不许当 0。
# 🔴 读数之前先 `--scroll-into-view`：这台设备的库里会**攒下上一趟钉住的那条**
#    （置顶是持久状态，不会自己消失），于是这一趟新建的两行被挤到 ScrollView 折叠线
#    附近 —— 长按落在半截行上就打不开菜单（实测：截图里目标行只剩上半截，
#    「置顶」不在树上）。滚进可见区之后 y 坐标才是能点的那块地。
row_center() {  # <标题>
  local out; out=$(ax "打开任务：$1" --pressable --scroll-into-view --list --json)
  [ "$(jget "$out" found)" = "True" ] || return 1
  python3 -c 'import sys;a=[float(x) for x in sys.argv[1:]];print(int(a[0]+a[2]/2),int(a[1]+a[3]/2))' \
    "$(jget "$out" x)" "$(jget "$out" y)" "$(jget "$out" width)" "$(jget "$out" height)"
}

# 行的 y（顺序读数的唯一依据）。
row_y() {  # <标题>
  local out; out=$(ax "打开任务：$1" --pressable --scroll-into-view --list --json)
  [ "$(jget "$out" found)" = "True" ] || return 1
  jget "$out" y
}

# 🔴 长按这一格必须"按下之后回读，没开成就重来"，而不是"调用了 tap 就算开了"。
#    实测（2026-11-05 00:1x，本机 iPhone Duo heyta）：目标行的无障碍框报 y=455、
#    高 74，看起来整行都在列表里；但**短按同一个点 (217,492) 什么都没打开**，
#    而长按上一行 (217,410) 立刻开出菜单 —— 也就是那一行的**真命中区比 AX 框低一档**
#    （截图里它正好压在列表下沿，标题被裁掉半截）。
#    所以这里不猜坐标：按下去 → 回读菜单在不在 → 不在就把列表往上滚一段再来。
#    滚动用 `idb ui swipe --duration 1.0`（直接操纵、无惯性，单位是**秒**）。
menu_open() {
  local _p
  for _p in "置顶" "取消置顶"; do
    [ "$(jget "$(ax "$_p" --pressable --exact --list --json)" found)" = "True" ] && return 0
  done
  return 1
}

open_row_menu() {  # <标题>
  local i cxy
  for i in 1 2 3; do
    cxy=$(row_center "$1") || return 1
    idb_ui tap --duration 0.9 ${cxy} >/dev/null 2>&1
    sleep 2
    menu_open && return 0
    echo "     （第 $i 次长按没开出菜单，把列表往上滚一段再来）"
    idb_ui swipe 196 470 196 300 --duration 1.0 >/dev/null 2>&1
    sleep 1
  done
  return 1
}

fill_composer_title() {  # <标题>（三层兜底，理由照 journey 那条：AXSetValue 偶发静默失败）
  local val="$1" i
  for i in 1 2 3; do
    ax - --field --set "$val" --json >/dev/null 2>&1
    sleep 1
    [ "$(jget "$(ax "添加" --pressable --list --json)" enabled)" = "True" ] && return 0
  done
  ax - --field --type-text "$val" >/dev/null 2>&1
  sleep 1
  [ "$(jget "$(ax "添加" --pressable --list --json)" enabled)" = "True" ]
}

add_task() {  # <标题>
  local _try
  for _try in 1 2; do
    ax "新建任务" --pressable --press --json >/dev/null 2>&1
    sleep 2
    [ "$(jget "$(ax - --field --list --json)" found)" = "True" ] && break
    # 没开成：先归一化再来一次（遮罩/上一趟残留是这一格最主要的干扰源）。
    dismiss_overlays
  done
  if [ "$(jget "$(ax - --field --list --json)" found)" != "True" ]; then
    bad "点「新建任务」两次之后仍没有出现输入框 —— Composer 没打开，后面的判据都不成立"
    return 1
  fi
  fill_composer_title "$1" || { bad "「$1」没写进 Composer（添加键仍是禁用态）"; return 1; }
  ax "添加" --pressable --exact --press --json >/dev/null 2>&1
  sleep 3
  # 🔴 裁决看 Composer 关没关，不看 press 的返回值（"工具返回成功 ≠ 生效"）。
  if [ "$(jget "$(ax "添加" --pressable --list --exact --json)" found)" = "True" ]; then
    bad "按了「添加」但 Composer 还开着 —— 这条任务没真的建出来"
    return 1
  fi
  return 0
}

STAMP=$(date +%H%M%S)
A="滴答置顶甲条${STAMP}"
B="滴答置顶乙条${STAMP}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/apps/mobile/evidence/dida-pin-order-$(date +%Y%m%d)"
mkdir -p "$EVIDENCE_DIR"

# 归一化：把上一趟留在树上的浮层收掉（**这一条是前置，不是装饰**）。
# 实测：上一趟 step 4 打开的「取消置顶」菜单没关，`simctl launch`（不 terminate）
# 恢复的就是那一屏 ⇒ 再点 FAB 时那一下落在遮罩上，症状是"Composer 没打开"。
dismiss_overlays() {
  ax --dismiss-keyboard --json >/dev/null 2>&1 || true
  for _m in "关闭排序选择" "以后再说" "完成" "返回"; do
    # 🔴 `--exact` 是必须的，不是洁癖。实测踩过（本脚本自己写进去的一条 op）：
    #    不带 --exact 时「取消」子串命中「取消置顶」，于是归一化这一步**自己按下了
    #    取消置顶**，手机里凭空多一条 `UPD_TASK {"pinnedAt":null}`（现量：
    #    `sqlite3 <库> "SELECT rowid,json_extract(data,'$.op.actionType'),
    #     json_extract(data,'$.op.payload') FROM ops ORDER BY rowid DESC LIMIT 8;"`）。
    #    这正是 traps #109 记过的那一族：标签匹配是子串匹配，会撞车。
    ax "$_m" --pressable --exact --press --json >/dev/null 2>&1
  done
  # 🔴 行级菜单**没有**「取消」那枚可点的按钮（现量：`"取消" --exact` 在树上
  #    found=False；不带 --exact 命中的其实是「取消置顶」那一行 —— 按下去就写了一条
  #    `pinnedAt: null`，见上面那条注释）。能关它的产品手势是**点遮罩**。
  #    坐标不写死：读这一层最后一项（「删除」）自己的 y，往下挪一段就是遮罩。
  #    ⚠️ 原来这里走的是"切 tab 收走这一层"（`TasksScreen.tsx` 那条 effect 确实写着），
  #    但菜单开着的时候底部 tab 被遮罩挡住、按不动（实测：`新建任务` found=False，
  #    那一步等于没做）—— 所以这条路只在**菜单没开**时成立，不能当收场手段。
  if [ "$(jget "$(ax "打开详情" --pressable --exact --list --json)" found)" = "True" ]; then
    local dy
    dy=$(jget "$(ax "删除" --pressable --exact --list --json)" y)
    [ -n "$dy" ] || dy=300
    ax --tap 196 "$((dy + 150))" --json >/dev/null 2>&1
    sleep 2
    if [ "$(jget "$(ax "打开详情" --pressable --exact --list --json)" found)" = "True" ]; then
      ax --tap 196 700 --json >/dev/null 2>&1
      sleep 2
    fi
  fi
}

# 🔴 图那一格必须**自证不是全黑**，而且要判对"全黑"的形状：
#    · 黑帧的特征是 colorSpan=0（整屏亮度全同）。仓库那把尺 `looksBlank()` 的另一半是
#      `contentRatio < 0.01`（非白像素太少），而**白底界面本来就 99% 是白的** ——
#      现量（2026-11-04 桌面壳那张 desktop-window.png）：contentRatio=0.007、
#      colorSpan=255、色桶 66，真有内容却被那一半误判成空白。所以这里只用 colorSpan。
#    · 取图必须显式 --display=primary。不带它时 simctl 挑的是 enumerate 里那个
#      com.apple.display.captureservice 端口（**宿主的**显示捕获服务）：要么超时
#      （NSPOSIXErrorDomain code=60 Timeout waiting for screen surfaces），
#      要么返回一张 colorSpan=0 的全黑帧 —— 尺寸与退出码全部正常，
#      只看"命令没报错"永远发现不了。真设备那一屏住在 DisplayAdapter 的
#      Device Name: primary（现量：xcrun simctl io "$UDID" enumerate）。
# ⚠️ 下面那段 node 代码**不许**用双引号包：双引号里反引号会被 shell 当命令替换执行。
#    实测踩过：注释里写 contentRatio < 0.01 与 desktop-window.png 各带一对反引号，
#    跑起来就是 "0.01: No such file or directory" 与 "desktop-window.png: command not found"，
#    而 node 仍然算出了正确结论 ⇒ 这是一颗会自己藏起来的雷（判据绿着，shell 在报错）。
#    路径一律走环境变量传入，node 侧只读 process.env。
SHOT_MISSING=0
shot() {  # <文件名>
  local f="$EVIDENCE_DIR/$1"
  xcrun simctl io "$UDID" screenshot --display=primary "$f" >/dev/null 2>&1
  local verdict
  verdict=$(PNG_PATH="$f" STATS_MODULE="$REPO_ROOT/scripts/screenshots/png-stats.mjs" \
    node --input-type=module -e '
      // import 的来源必须是字面量字符串，所以这里走动态 import。
      const {inspectPng} = await import(process.env.STATS_MODULE);
      const s = inspectPng(process.env.PNG_PATH);
      console.log(s.colorSpan < 16 ? "blank" : "ok " + s.colorSpan);
    ' 2>/dev/null)
  case "$verdict" in
    ok*) ok "证据图 $(basename "$f") 有内容（色阶差 ${verdict#ok }）" ;;
    *)   rm -f "$f"; SHOT_MISSING=1
         echo "   ⚠️  证据图 $1 取回来是空的或全黑（判定：${verdict:-读不到}），已删掉不留 —— 这一趟的图那一格**没取到**" ;;
  esac
}

step "0. 前置：这一读数属于哪一棵树"
PHONE_DB=$(phone_db)
[ -n "$PHONE_DB" ] && [ -f "$PHONE_DB" ] || { bad "取不到手机里的真 SQLite（$PHONE_DB）"; summary "iOS 置顶顺序"; }
APP_BIN="${HEYTA_IOS_DERIVED:-/tmp/heyta-ios-release}/Build/Products/Release-iphonesimulator/Heyta.app"
printf '   git HEAD      : %s\n' "$(cd "$(dirname "$0")/.." && git rev-parse --short HEAD)"
printf '   装着的产物     : %s（mtime %s）\n' "$APP_BIN" "$(stat -f '%Sm' "$APP_BIN" 2>/dev/null || echo 不存在)"
printf '   手机 ops 行数  : %s\n' "$(apps_count)"
ok "设备 $UDID / 库 $PHONE_DB 都在"

step "1. 起应用，建两条任务（先后顺序就是判据的"之前"）"
xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1
sleep 4
dismiss_overlays
BEFORE_OPS=$(apps_count)
add_task "$A" || { summary "iOS 置顶顺序"; }
add_task "$B" || { summary "iOS 置顶顺序"; }

YA=$(row_y "$A") || { bad "列表里读不到「$A」那一行"; summary "iOS 置顶顺序"; }
YB=$(row_y "$B") || { bad "列表里读不到「$B」那一行"; summary "iOS 置顶顺序"; }
# 🔴 "之前"是**读出来的**，不是假设的。移动端列表的默认档是 `addedAt`
#   （新的在上，与搬共享层之前那句 `reverse()` 逐条等价 —— 见
#   `apps/mobile/src/screens/TasksScreen.tsx` 那条注释），而 web 的展示档是 `display`。
#   两端档位不是同一个，所以"先建的那条在上面"这句在手机上不成立；
#   上一版就是拿它当前置，红成了一次探针缺陷而不是产品缺陷。
#   判据要的是**相对变化**：把此刻在下面那条钉住，它必须跑到上面去。
if [ "$YA" -gt "$YB" ]; then TARGET="$A"; OTHER="$B"; else TARGET="$B"; OTHER="$A"; fi
YT=$(row_y "$TARGET"); YO=$(row_y "$OTHER")
ok "置顶之前：「$TARGET」在「$OTHER」下面（y $YT > $YO）"

step "2. 长按「$TARGET」开行菜单"
if open_row_menu "$TARGET"; then
  ok "长按之后菜单里出现了「置顶」/「取消置顶」这一项"
else
  bad "长按没开出行菜单（「置顶」不在树上）—— 要么手势没送达，要么这一档菜单没接线"
  shot fail-no-menu.png
  summary "iOS 置顶顺序"
fi
shot row-menu.png

step "3. 按「置顶」，顺序必须翻过来"
ax "置顶" --pressable --exact --press --json >/dev/null 2>&1
sleep 3
YT2=$(row_y "$TARGET") || { bad "置顶之后读不到「$TARGET」那一行了"; summary "iOS 置顶顺序"; }
YO2=$(row_y "$OTHER") || { bad "置顶之后读不到「$OTHER」那一行了"; summary "iOS 置顶顺序"; }
if [ "$YT2" -lt "$YO2" ]; then
  ok "钉住的那条真的排到最前（y $YT > $YO → y $YT2 < $YO2）"
else
  bad "点了「置顶」但顺序没翻（y $YT2 vs $YO2）—— 共享 model 那份顺序所有者又不读 pinnedAt 了"
fi
shot after-pin.png

step "4. 反向：再开一次菜单，那一项要说「取消置顶」"
open_row_menu "$TARGET" || { bad "再开菜单失败（三次长按都没开出那一层）"; summary "iOS 置顶顺序"; }
if [ "$(jget "$(ax "取消置顶" --pressable --exact --list --json)" found)" = "True" ]; then
  ok "已置顶的行，菜单里那一项自己说「取消置顶」（写进去的是状态，不是一帧视觉）"
else
  bad "菜单里那一项还写着「置顶」—— 说明这一条的 pinnedAt 没落到界面上"
fi

step "5. 真 op-log：一个用户意图 = 一条 op"
AFTER_OPS=$(apps_count)
if [ "$AFTER_OPS" = "$((BEFORE_OPS + 3))" ]; then
  ok "ops 行数 $BEFORE_OPS → $AFTER_OPS（两条建 + 一条置顶，恰好 +3）"
else
  bad "ops 行数 $BEFORE_OPS → $AFTER_OPS，期望恰好 +3"
fi
LAST_OP=$(sqlite3 "${PHONE_DB}" "SELECT data FROM ops ORDER BY rowid DESC LIMIT 1;" 2>/dev/null)
if printf '%s' "$LAST_OP" | grep -q "pinnedAt"; then
  ok "最新那条 op 里带 pinnedAt"
else
  bad "最新那条 op 里没有 pinnedAt —— 置顶不是走 op-log 写进去的"
fi

summary "iOS 置顶顺序"
# 收尾：把这一趟打开的菜单关掉（走应用自己的"切 tab 收走这一层"），
#   否则下一趟进来面对的就是一个盖住 FAB 的浮层。
dismiss_overlays

if [ "$SHOT_MISSING" = "1" ]; then
  echo "   ⚠️  图那一格没取到：数值判据（AX 几何 + 真 op-log）成立，但屏幕上没有一张能给人看的图。"
  echo "      候选解法：让 simctl 走有窗口的渲染路径（`open -g -a Simulator --args -CurrentDeviceUDID $UDID`）"
  echo "      或改用 `apps/desktop` 的 `webContents.capturePage()`（`src/smoke.ts` 那条实测路径）。"
fi
summary "iOS 置顶顺序"
