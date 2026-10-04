#!/bin/bash
#
# W7 · 纪念卡片「设备出图」真机验收 —— **iOS 那一半**（零 mock）
# =====================================================================
#
# 🔴 为什么要有这个脚本（编号 W7-G3）
#
# Android 那一半由 `verify-mobile-card-export.sh` 管，它量到的是"设备真的画得出
# 契约尺寸的那张图"。iOS 侧此前只有 Swift 模块 + JS 折算单测 —— 而**单测证不了
# 原生真的把字节写进了沙盒**。缺的正是 `packages/ui/src/countdown/card-export-layout.ts`
# 文件头那张表主张的事：出厂尺寸在每一端都应当是契约那一对数。
#
# 三件事分开证（判据编号即顺序，与 Android 那一趟同口径）：
#   ① 探针有牙：读数器喂两枚已知图 —— 现成那张必须等于契约、对照那张必须**不等**。
#   ② 点了 ⇒ 生效了：点导出**前**沙盒 `tmp/card-export/` 里没有那个文件名，点之后必须出现。
#   ③ 字节真是契约尺寸：从沙盒拉回宿主机数 IHDR，逐字等于契约常量。
#
# ⚠️ 这一趟**不**主张"分享成功送达某个目标"。原生模块在 `Share.share` **之前**就把字节
#   写进 `temporaryDirectory/card-export/`（`HeytaCardExportModule.swift`），所以分享面板
#   开不开、有没有可选目标，与"设备出不出得来这张图"是两件事。面板出现就点「取消」收掉，
#   **作为读数打印**，不作为判据。
#
# 🔴 与 Android 那一趟的两条差别（都是实测出来的，不是风格差异）：
#   1. **读数通道更便宜**：iOS 的沙盒是宿主机上的一个目录
#      （`xcrun simctl get_app_container <UDID> <BID> data` ⇒ `tmp/card-export/`），
#      不需要 Android 那一档 `adb root`（release 包不可 `run-as`）。
#   2. **卡片一律由本趟自建**（标题 `w7ios-<时刻>`）：Android 那趟允许"屏上已有卡片就复用"，
#      而 iOS 上要从 AX 树里反推卡片标题得多一层探针（`card-title` 那个模式读的是 uiautomator XML）。
#      少一层探针就少一处会坏的地方 —— 代价是这台设备上会多一条测试卡片。
#
# 前置（三条，缺任何一条都是 **exit 3 = 环境不成立**，不是产品失败）：
#   · 一台**已启动**且**装着当前源码产物**的模拟器，并且**必须显式指名**：
#       IOS_UDID=<UDID>  或  IOS_DEVICE_NAME=<名字>
#     没有指名 ⇒ 拒跑。理由：本机常年有别人的模拟器在跑，而这一趟会
#     `simctl terminate` + 改屏幕状态 —— **只准对自己造的那台动手**（AGENTS §8.9）。
#   · idb（`bash scripts/install-idb.sh` 装）+ companion 能应答。
#   · 产物新鲜度：已装的 `main.jsbundle` 不许比源码旧（同 §6.1.1 / §7 #27/#82）。
#
# 用法：
#   IOS_DEVICE_NAME=heyta-batch2-closeout bash scripts/verify-mobile-card-export-ios.sh
#   HEYTA_CARD_EXPORT_ALLOW_STALE=1 …    # 显式跨过新鲜度门（那样本轮读数**不代表当前源码**）
#
# 退出码：0 = 判据全过；1 = 有断言失败（产品问题）；3 = 环境不成立
#         （设备 / companion / 负载 / 产物过期 / 探针取不到输入）。三个不混。
#

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 按字节偏移增量读取脚本：
#    运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。入口先把整份脚本拷成
#    同目录隐藏快照再 exec 副本；$0 的 dirname 不变，lib 定位照旧。
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

set -u
export PATH="/opt/homebrew/bin:$PATH"

. "$(dirname "$0")/lib/mobile-e2e.sh"
. "$(dirname "$0")/lib/wait-for-quiet-host.sh"
. "$(dirname "$0")/lib/card-export-probe.sh"

UDID=${IOS_UDID:-}
DEVICE_NAME=${IOS_DEVICE_NAME:-}
BID=${IOS_BID:-com.heyta}
IS_AX_SHIM="$HEYTA_REPO_ROOT/scripts/tools/ios-ax-shim.py"
EVIDENCE_DIR="$HEYTA_REPO_ROOT/apps/mobile/evidence/card-export"
STAMP=$(date +%H%M%S)
CARD_TITLE="w7ios-$STAMP"
IDB_BIN=${IDB_BIN:-}
IDB_COMPANION=${IDB_COMPANION:-}

ax() {
  python3 "$IS_AX_SHIM" "$@" \
    --udid "$UDID" --idb "$IDB_BIN" --companion "$IDB_COMPANION" --json
}
jget() { printf '%s' "$1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$2',''))" 2>/dev/null; }
ax_found() { [ "$(jget "$(ax "$1" --list --json)" found)" = "True" ]; }
press_raw() { ax "$1" --pressable --press --json >/dev/null 2>&1; }
# 🔴 「按过了」不等于「按到了」—— shim 自己的文件头记着这条实测：
#    **tap 对屏外坐标是静默空操作，不报错**，而 `--press` 只要 idb 退 0 就回
#    `result: success`。04 08:5x 那一趟就是这样骗掉一步的：`倒数纪念日` 那颗按钮在
#    「我的」页的滚动区里，`AXFrame` 中心 y=948 而屏高 874 ⇒ 按了、树上"有"它、
#    页面却没动。所以这里把 press 重写成**先滚进可见区、再点**，并且把
#    "滚不进去"当成**返回值**交给调用方判（不滚就直接点等于白点）。
press() {
  local lbl="$1" vis
  vis=$(ax "$lbl" --pressable --scroll-into-view --json)
  [ "$(jget "$vis" visible)" = "True" ] || { echo "   ↳ 「$lbl」滚不进可见区（$(jget "$vis" found)/$(jget "$vis" scrollRc)）"; return 1; }
  ax "$lbl" --pressable --press --json >/dev/null 2>&1
}
# ⚠️ **底部标签栏不适用**上面那个：shim 的"可见"定义是 `中心 y < 屏高-120`（给标签栏让位），
#    而标签栏自己那颗「我的」中心 y=808 > 874-120=754 ⇒ 按那条定义**永远不可见**、
#    又因为它不在滚动容器里也滚不动。所以底栏走 `press_raw`，"在不在树上"由
#    调用方的 `ax_found` 轮询负责（08:5x 现量的两枚 frame）。
# 「它消失了吗」比「某样东西出现了吗」可靠 —— 欢迎页背后就是底部标签栏，
# 用"出现了任务"当条件会一次都没按就假绿（verify-mobile-ios.sh:294 那段实测）。
press_until_gone() {  # <要按的> <应消失的> [尝试次数]
  local do_lbl="$1" gone_lbl="$2" tries="${3:-4}" i
  for i in $(seq 1 "$tries"); do
    ax_found "$gone_lbl" || return 0
    press "$do_lbl"; sleep 2
  done
  ax_found "$gone_lbl" && return 1 || return 0
}
# 只扫会进 bundle 的地方；⚠️ 不要 `-newer /dev/null`（恒假），必须 `-print0`+`xargs -0`
# （本仓路径有空格）—— 两条都是 verify-mobile-ios.sh:394 那段实测换来的。
newest_src() {
  find "$HEYTA_REPO_ROOT/apps/mobile/src" "$HEYTA_REPO_ROOT/packages"/*/src \
    -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null \
    | xargs -0 stat -f '%m' 2>/dev/null | sort -rn | head -1
}

step "0. 现场门：设备必须显式指名、已启动、没有别的 iOS 验收、宿主机负载"
if [ -z "$UDID" ]; then
  if [ -z "$DEVICE_NAME" ]; then
    echo "❌ 没给 IOS_UDID 也没给 IOS_DEVICE_NAME —— 本机常年有别人的模拟器在跑，"
    echo "   而这一趟会 terminate 应用并改屏幕状态 ⇒ **不猜**（AGENTS §8.9）。"
    echo "   现在 Booted 的机器："
    xcrun simctl list devices booted 2>/dev/null | sed 's/^/     /'
    echo "   指名其一：IOS_UDID=<UDID> 或 IOS_DEVICE_NAME=\"<名字>\" 重跑"
    exit 3
  fi
  UDID=$(xcrun simctl list devices booted 2>/dev/null | grep -F "$DEVICE_NAME" \
    | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/' | head -1)
  [ -n "$UDID" ] || { echo "❌ 没有**已启动**且名字含「$DEVICE_NAME」的模拟器 ⇒ 本轮无效（不是产品失败）"; exit 3; }
fi
xcrun simctl list devices booted 2>/dev/null | grep -qF "$UDID" \
  || { echo "❌ $UDID 不在 Booted 列表里 ⇒ 先 xcrun simctl boot $UDID"; exit 3; }
ok "设备已指名且已启动：$UDID"

IOSBUSY=$(ps -eo pid,etime,command | grep -E 'xcodebuild|verify-mobile-ios|simctl (install|uninstall|erase)|reinstall-all\.sh --only ios' \
  | grep -vE 'card-export-ios|device-closeout|grep -E' | cut -c1-90)
if [ -n "$IOSBUSY" ]; then
  echo "❌ 这一档有别人在写 ⇒ 不硬挤（§8.9）：$(printf '%s' "$IOSBUSY" | head -2 | tr '\n' ';')"
  exit 3
fi
ok "没有别的 iOS 验收 / 构建在跑"

if ! resolve_idb; then echo "❌ 找不到 idb —— iOS 验收要从设备内部驱动界面（bash scripts/install-idb.sh）"; exit 3; fi
IDB_UDID="$UDID"
ensure_idb_companion || { echo "❌ idb companion 起不来 ⇒ 探针没有驱动通道"; exit 3; }
[ -f "$IS_AX_SHIM" ] || { echo "❌ AX shim 不在 $IS_AX_SHIM ⇒ 探针没有驱动通道"; exit 3; }
wait_for_quiet_host || exit 3

step "0b. 产物新鲜度：装上的 app 不许比源码旧（§6.1.1、§7 #27/#82）"
APP_DIR=$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null | tr -d '\r')
if [ -z "$APP_DIR" ] || [ ! -d "$APP_DIR" ]; then
  echo "❌ 按 BID=$BID 在这台上解析不到已安装的 app —— 没装上，或装的是别的 bundle id ⇒ 本轮无效"; exit 3
fi
JSB="$APP_DIR/main.jsbundle"
[ -f "$JSB" ] || { echo "❌ $JSB 不在（装了个没有 bundle 的东西？）⇒ 本轮无效"; exit 3; }
JSB_M=$(stat -f %m "$JSB"); SRC_M=$(newest_src)
if [ -z "$SRC_M" ]; then echo "❌ 新鲜度门没有输入（源码目录扫不到 .ts/.tsx？）⇒ 本轮无效"; exit 3; fi
echo "   新鲜度门输入：bundle $JSB_M（$(date -r "$JSB_M" '+%m-%d %H:%M:%S')）／源码最新 $SRC_M"
if [ "$SRC_M" -gt "$JSB_M" ]; then
  echo "   ❌ 装的是旧产物：源码最新 $SRC_M > bundle $JSB_M"
  echo "      先 pnpm reinstall:mobile（或 --only ios）。显式跨过：HEYTA_CARD_EXPORT_ALLOW_STALE=1"
  echo "      —— 但那样本轮读数**不代表当前源码**。"
  [ "${HEYTA_CARD_EXPORT_ALLOW_STALE:-0}" = 1 ] || exit 3
  echo "   ⚠️ 已按显式旋钮跨过新鲜度门"
else
  ok "装的 app 不比源码旧"
fi

step "1. 判据①：PNG 读数器读得对，而且**会区分**"
EXP_W=$(contract EXPORT_CARD_EDGE_PX)
EXP_H=$(contract EXPORT_CARD_HEIGHT_PX)
mkdir -p "$EVIDENCE_DIR"
probe_reader_selfcheck "$EXP_W" "$EXP_H"

step "2. 起应用（只动我指名的那台），并归一化掉已知浮层"
xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1 || { echo "❌ simctl launch 失败 ⇒ 本轮无效"; exit 3; }
sleep 5
TREE_OK=0
# 🔴 「树就绪」**不能**拿「主屏标签在不在」当判据 —— 实测（08:4x 那一趟 exit 3 的真相）：
#    这台上的 App 起来第一屏是隐私同意面板，而 RN 的 modal 会把底部标签栏整个摘出
#    AX 树（`describe-all` 11 个 label 全是面板的，「我的」一个都不在）。
#    §7 #63 那种卡死形态是「只剩一个零尺寸 Application 节点、label 数 0」。
#    两者的**区别**是 label 数，不是"某个特定标签在不在"；而"读到的确实是本 App
#    的内容"由**顶层屏的候选标签任一在树里**来证（三个候选 = 主屏 / 同意面板 / 欢迎页，
#    全部取自 i18n 真源，不抄字面量）。
TAB_LABEL=$(zh mobile.tab.profile)
CONSENT_TITLE=$(zh common.privacy.consent.title)
WELCOME=$(zh mobile.welcome.offline)
TREE_N=0
for _i in 1 2 3 4 5 6 7 8; do
  TREE_N=$(idb_ax_label_count)
  if [ "${TREE_N:-0}" -ge 2 ] \
    && { ax_found "$TAB_LABEL" || ax_found "$CONSENT_TITLE" || ax_found "$WELCOME"; }; then
    TREE_OK=1; break
  fi
  sleep 3
done
[ "$TREE_OK" = 1 ] || { echo "❌ AX 树里没有本 App 的内容（label 数 ${TREE_N:-?}，且主屏/同意面板/欢迎页三个候选标签都不在）";
  echo "   label 数 0 ⇒ §7 #63 那种卡死形态，重启模拟器可自愈；非 0 却没有候选标签 ⇒ 界面停在别的屏。两种都是探针未到位 ⇒ 本轮无效"; exit 3; }
ok "无障碍树能读到 App 内容（label 数 $TREE_N）"

# 🔴 key 一律从读数器取，界面字面量不抄进脚本（抄件必漂）。
#    这三个键名是**读数器验出来的**，不是我推的：第一版写了
#    `web.consent.title` / `mobile.consent.localOnly` / `mobile.welcome.offlineFirst`，
#    `node scripts/verify-mobile-card-export-read.mjs zh <key>` 三个全部非零退出 ——
#    也就是说探针在碰设备之前就把自己的假设抓出来了（真源见 locales/zh-CN.ts）。
CONSENT_TITLE=$(zh common.privacy.consent.title)
if ax_found "$CONSENT_TITLE"; then
  LOCAL_ONLY=$(zh common.privacy.consent.localOnly)
  press_until_gone "$LOCAL_ONLY" "$CONSENT_TITLE" 4 \
    && ok "隐私同意面板已按「$LOCAL_ONLY」收掉" \
    || { echo "❌ 同意面板在，但按「$LOCAL_ONLY」没收掉 ⇒ 探针未到位（本轮无效）"; exit 3; }
fi
WELCOME=$(zh mobile.welcome.offline)
if ax_found "$WELCOME"; then
  press_until_gone "$WELCOME" "$WELCOME" 4 && ok "已离开欢迎页" || { echo "❌ 欢迎页没收掉"; exit 3; }
fi
# 顺手收掉可能挡在前台的浮层（**不进门禁**：按不到就是空操作）。
# 🔴 有真源 key 的一律走读数器；「关闭排序选择」是 RN 侧无键的裸标签，留字面量并写明它不参与判据。
DISMISS_CANCEL=$(zh mobile.common.cancel)
DISMISS_LATER=$(zh common.privacy.consent.close)
for _m in "关闭排序选择" "$DISMISS_CANCEL" "$DISMISS_LATER"; do press "$_m"; done

step "3. 走到倒数日屏（W8 移动半那条注册表）"
# 上一节可能刚把同意面板收掉 —— 主屏要一会儿才回到前台。等的是**标签本身**，
# 不是"按得到就算到了"：`press` 对不在树上的标签是静默空操作。
TAB_READY=0
for _i in 1 2 3 4 5 6; do ax_found "$TAB_LABEL" && { TAB_READY=1; break; }; sleep 3; done
[ "$TAB_READY" = 1 ] || { echo "   ❌ 浮层归一化之后仍读不到「$TAB_LABEL」标签 —— 探针未到位（本轮无效）"; exit 3; }
press_raw "$TAB_LABEL"; sleep 3
ENTRY=$(zh mobile.countdown.entry)
if ! ax_found "$ENTRY"; then
  echo "   ❌ 「$TAB_LABEL」页里没有倒数日入口「$ENTRY」"; exit 3
fi
# 🔴 rc 必须收下：入口在「我的」页的滚动区里，屏外那一档 `press` 现在是**会返回 1** 的
#    （旧版静默按空、然后靠下一节的"屏没开到"去反推，红落在哪里全靠运气）。
press "$ENTRY" || { echo "   ❌ 入口「$ENTRY」滚不进可见区 ⇒ 按不到，本轮无效（不是产品失败）"; exit 3; }
sleep 3
# 🔴 判据**不能**用 web.shell.views.countdown：它的 zh 值与入口标签是**同一个串**
#    （两个都是「倒数纪念日」，实测读数），于是"点了入口没开屏"时树上仍有那个串 ⇒
#    这条判据永远为真（AGENTS §7 元规则 2：一条永远通过的判据比没有判据更糟）。
#    换成只有倒数日屏才产出的两样之一：输入框占位符 或 空态句。
PLACEHOLDER=$(zh web.countdown.composer.placeholder)
EMPTY=$(zh web.countdown.empty)
if ax_found "$PLACEHOLDER" || ax_found "$EMPTY"; then
  ok "倒数日屏开到前台（读到「$PLACEHOLDER」或空态「$EMPTY」）"
else
  bad "点了入口却没开到倒数日屏（输入框与空态都不在树上）"
fi

step "4. 自建一条卡片（标题 $CARD_TITLE，日期取 7 天后）"
ADD_LABEL=$(zh web.countdown.add)
# 🔴 上一节"placeholder 或 空态任一在树里"就够了，这一节不够：`--field --set` 打的是
#    "树上第一个输入域"，而"placeholder 不在树里"意味着 composer 没在前台（空态句在
#    屏幕上，输入框可能要展开）—— 那样会把标题写进**别的**字段，然后用「$ADD_LABEL」
#    的 enabled 当"成功"读数。所以这里必须正向确认 placeholder 在树里。
ax_found "$PLACEHOLDER" || { echo "   ❌ 倒数日屏上读不到输入框占位符「$PLACEHOLDER」⇒ 探针够不着 composer，本轮无效"; exit 3; }
# 🔴 输入框**不能**走上面那个 `press()`：它带着 `--pressable` 这层过滤，而 shim 的
#    `is_pressable` 认的是 Button 那一类 —— `AXTextField` 不算，于是"定位"直接返回
#    found=False，`scroll_into_view` 把它报成 `element-left-tree`（09:1x 那趟的 exit 3
#    就是这个形状：屏上明明有输入框，探针却说它消失了）。输入框要走 `--field` 那一侧。
focus_field() {
  local lbl="$1" vis
  vis=$(ax "$lbl" --field --scroll-into-view --json)
  [ "$(jget "$vis" visible)" = "True" ] || { echo "   ↳ 输入框「$lbl」不可达（found=$(jget "$vis" found) scrollRc=$(jget "$vis" scrollRc)）"; return 1; }
  ax "$lbl" --field --press --json >/dev/null 2>&1
}
# 🔴 顺序错了整节就废：共享层 `packages/ui/src/countdown/EventBoard.tsx:367` 写的是
#    `canSubmit = draftTitle.trim() !== '' && draftDate !== undefined`（`:358` 的 draftDate
#    初值是 `undefined`）—— **「添加」在选日期之前必然不可点**。而 09:0x 那一版是在
#    打字之后、选日期之前去读 enabled 的，那条判据在产品规则下**永远为假**，
#    于是它报的红（"标题没进得去"）说的不是那件事。现在按产品的顺序走：
#    打字 → 选日期 → **这时候** enabled 才是"标题+日期都进了应用的态"的亲口确认。
focus_field "$PLACEHOLDER" || { echo "   ❌ 输入框「$PLACEHOLDER」不可达 ⇒ 焦点进不去，本轮无效"; exit 3; }
sleep 1
TT=$(ax - --field --type-text "$CARD_TITLE" --json 2>&1); sleep 1
echo "   type-text 回读：${TT:-（空 ⇒ shim 自己没输出，先看这一行）}"
# ⚠️ 这里**不再**用 `--set`：shim 文件头第 2 条记着 `set-value` 不触发 RN 的 onChangeText，
#    而 09:0x 那趟现场把它坐实了 —— 连按三次 set 之后字段回读仍是**双份**
#    （`w7ios-090810w7ios-090810`）：原生被写了字、JS 态不知道，受控 TextInput 再把
#    键入的那份接上去。先 set 再 type 这条路本身就是在制造脏值。
# 🔴 iOS 上这颗按钮**只能按 `web.countdown.field.date`（「日期」）按，不能按「选日期」**：
#    `EventBoard.tsx:443` 的 `accessibilityLabel` 是 `labels.fieldDate`，而「选日期」是它
#    **里面那个 Text 子节点**（`:456` 的 `draftDate === undefined ? labels.pickDate : …`）。
#    RN-Android 的 uiautomator 会把子文本也序列化出来（所以 Android 那趟 `scroll_to_text 选日期` 是对的），
#    而 iOS 的 AX 树只给 `accessibilityLabel` —— 09:0x 的 `describe-all` 里那颗按钮就是
#    `'日期' | {{226.7,191},{85.3,44}} | AXButton`，「选日期」三个字在树上根本不存在。
#    ⇒ 探针按「选日期」找不到东西，报的是 `element-left-tree`（第三处"探针够不着被读成产品没有"）。
#    另外先把键盘收掉再开日期格：日期面板在键盘那一侧，键盘不收起会整片按不到。
ax - --dismiss-keyboard --json >/dev/null 2>&1; sleep 1
DATE_BTN_LABEL=$(zh web.countdown.field.date)
press "$DATE_BTN_LABEL" || { echo "   ❌ 「$DATE_BTN_LABEL」按钮不可达 ⇒ 日期选不了，本轮无效"; exit 3; }
sleep 2
MON_NUM=$(date -v+7d +%-m 2>/dev/null || date -d '+7 days' +%-m)
DAY_NUM=$(date -v+7d +%-d 2>/dev/null || date -d '+7 days' +%-d)
DAY_TPL=$(zh mobile.datePicker.dayLabel)
DAY_DESC=$(printf '%s' "$DAY_TPL" | sed "s/{title}//g; s/{month}/$MON_NUM/g; s/{day}/$DAY_NUM/g")
ax_found "$DAY_DESC" || { echo "   ❌ 日期格里找不到「$DAY_DESC」⇒ 探针未到位（本轮无效）"; exit 3; }
press "$DAY_DESC" || { echo "   ❌ 日期格「$DAY_DESC」滚不进可见区 ⇒ 按不到，本轮无效"; exit 3; }
sleep 1
ax - --dismiss-keyboard --json >/dev/null 2>&1; sleep 1
FILLED=0
[ "$(jget "$(ax "$ADD_LABEL" --pressable --list --json)" enabled)" = "True" ] && FILLED=1
# 判据用的是 **应用自己算出来的那个 enabled**（标题为空 或 日期没选 都点不动），不是"我按过了"。
[ "$FILLED" = 1 ] || { echo "   ❌ 打完字也选了日期，「$ADD_LABEL」仍然不可点 —— 探针未到位（本轮无效，不是产品失败）"
  echo "   ↳ 输入框此刻回读：$(ax - --field --list --json 2>&1)"; exit 3; }
ok "标题与日期都进了应用的态（「$ADD_LABEL」启用 = 它亲口确认，判据条件就是 canSubmit 那一条）"
press "$ADD_LABEL"; sleep 3
ax_found "$CARD_TITLE" && ok "新卡片上了屏（「点了」之后「看得见」）" \
  || { echo "   ❌ 建卡之后屏上找不到标题「$CARD_TITLE」"; bad "建卡没生效"; }

step "5. 判据②：点导出**前**沙盒里没那个文件名，点之后必须出现"
DATA_DIR=$(xcrun simctl get_app_container "$UDID" "$BID" data 2>/dev/null | tr -d '\r')
[ -n "$DATA_DIR" ] && [ -d "$DATA_DIR/tmp" ] \
  || { echo "   ❌ 读不到沙盒 data 容器（$DATA_DIR）⇒ 探针够不着，本轮无效"; exit 3; }
EXPORT_DIR="$DATA_DIR/tmp/card-export"
BEFORE_LIST=$(ls -1 "$EXPORT_DIR" 2>/dev/null | tr -d '\r')
[ -n "$BEFORE_LIST" ] && echo "   目录里已有 $(printf '%s\n' "$BEFORE_LIST" | grep -c .) 个文件（不清它 —— 只判"新增加没新增"）"

MENU_TPL=$(zh web.countdown.a11y.menu)
MENU_DESC=$(printf '%s' "$MENU_TPL" | sed "s/{title}/$CARD_TITLE/g")
ax_found "$MENU_DESC" || { echo "   ❌ 卡片上没有「$MENU_DESC」这颗菜单钮"; bad "菜单钮没找到"; }
press "$MENU_DESC"; sleep 2
EXPORT_LABEL=$(zh web.countdown.export)
ax_found "$EXPORT_LABEL" || { echo "   ❌ 菜单里没有「$EXPORT_LABEL」那一格（宿主没接 onExportCard？）"; bad "导出格没找到"; }
press "$EXPORT_LABEL"
FOUND=""
for _i in $(seq 1 12); do
  sleep 3
  AFTER=$(ls -1 "$EXPORT_DIR" 2>/dev/null | tr -d '\r')
  NEW=$(comm -13 <(printf '%s\n' "$BEFORE_LIST" | sort) <(printf '%s\n' "$AFTER" | sort) | grep -v '^$' | head -1)
  [ -n "$NEW" ] && { FOUND="$NEW"; break; }
done
if [ -z "$FOUND" ]; then
  bad "点了导出，沙盒 $EXPORT_DIR 里没有出现新文件 —— 原生那一步没落盘（或 bundle 是旧的）"
  summary "纪念卡片设备出图（iOS）" "判据②没成立，③未跑" 1
fi
ok "沙盒里出现了新文件：$FOUND"
case "$FOUND" in heyta-*.png) ok "文件名形状是 heyta-….png（前缀/后缀由共享层 cardExportFileName 给）";; *) bad "文件名形状不对：$FOUND";; esac

step "6. 判据③：那串字节的 IHDR 逐字等于契约"
cp "$EXPORT_DIR/$FOUND" "$EVIDENCE_DIR/ios-latest-card.png" || { echo "   ❌ 拉不回宿主机"; exit 3; }
R=$(read_png "$EVIDENCE_DIR/ios-latest-card.png")
echo "   $R"
[ "$(field "$R" W)" = "$EXP_W" ] && [ "$(field "$R" H)" = "$EXP_H" ] \
  && ok "设备出图 = 契约 ${EXP_W}×${EXP_H} —— 这就是 W7-G1/G2 缺的那一对数（iOS 侧）" \
  || bad "设备出图 $(field "$R" W)×$(field "$R" H)，与契约 ${EXP_W}×${EXP_H} 不符"
[ "$(field "$R" BLANK)" = "false" ] && ok "不是空白图" || bad "读出来是空白的（BLANK=true）"
[ "$(field "$R" TRANSPARENT)" = "false" ] && ok "没有透明像素（与 web / Android 那张同口径）" || bad "含透明像素"

step "7. 这一趟不该出现任何运行时**权限**弹窗（与「不申请照片」那句条款同向）"
SHARE_DISMISSED=""
for _m in "$DISMISS_CANCEL" "Done" "好"; do   # Done / 好 是 UIKit 系统控件，不在我们的 i18n 里
  if ax_found "$_m"; then press "$_m"; SHARE_DISMISSED="$_m"; break; fi
done
[ -n "$SHARE_DISMISSED" ] && echo "   ℹ️ 分享/系统面板出现过，已按「$SHARE_DISMISSED」收掉（这是读数，不是判据）"
PERM_HIT=""
for _p in "想访问" "允许访问" "无线局域网与蜂窝数据" "照片"; do
  ax_found "$_p" && PERM_HIT="$PERM_HIT「$_p」"
done
[ -z "$PERM_HIT" ] && ok "AX 树里没有任何系统权限页文案（$PERM_HIT 为空）" \
  || bad "出现了系统权限页文案：$PERM_HIT —— 与条款「不申请照片」相违，必须查 Info.plist 的 usage key"

summary "纪念卡片设备出图（iOS）" "成品图：$EVIDENCE_DIR/ios-latest-card.png"
