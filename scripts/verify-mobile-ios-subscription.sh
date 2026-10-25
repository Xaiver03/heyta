#!/usr/bin/env bash
#
# 移动端「订阅」独立一节 + 「?」气泡的**像素腿**（iOS 模拟器，无头）
# =====================================================================
#
# 为什么要单独一条脚本：`apps/mobile/tests/subscription-section.spec.ts` 钉的是**形状**
# （源码正则：这一屏只编排、标价不写金额、入口只有一个、词条两种语言都在），
# 而下面这四件事**只有真设备能证**：
#
#   ① 设置目录里那一节**真的到得了**（写了却接不上 = 没写）；
#   ② `SettingsInfoTip` 的正文**默认不占屏** —— jsdom 的 `textContent` 连
#      `display:none` 都读得到，所以面板单测证明不了这一条（traps 同族：假绿）；
#   ③ 点一下 `?` **真的**把正文摊开、再点一下**真的**收起（原生没有 hover，只认点击）；
#   ④ 收银台那一屏的标价/要点来自词条而不是写死，且未登录按下会**说人话**。
#
# 判据全部读 **AX 树**（`idb ui describe-all`），不靠像素比对：
#   · 树上有没有某句话 ⇒ `needle_state`（0=有 / 1=没有 / 2=树读不出）
#   · 某一行在不在 ⇒ 按 `AXUniqueId`（RN 的 `testID` 落到这里）
# 三档必须分开报，否则「探针读不到树」会被写成「产品没有这一节」。
#
# 前置（脚本自己会查，查不到就响亮失败）：
#   1. 一枚 booted 的模拟器 —— `xcrun simctl boot <UDID>` 就够，**别开 Simulator.app**（会抢前台）
#   2. app 已装（Release 包内嵌 jsbundle）。要连装一起做：
#        HEYTA_IOS_APP=apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app \
#        bash scripts/verify-mobile-ios-subscription.sh
#   3. 不需要服务端：这条腿走的是「同意联网 + 未登录」那一档，
#      收银台的**拒单**由壳自己说（`onRenew` 里 config 缺那一支），不发任何请求。
#
# 🔴 这条腿**不**证明「能买到」：真下单要真服务端 + 真账号，那两条各有自己的腿
#    （`verify-mobile-ios-renew-sellable.sh` 管服务端拒单，`pnpm verify:mobile-ios` 管登录链路）。
#    把它读成"支付通了"是错的 —— 它证明的是**这一屏存在、可交互、说的是真话**。
#
# 用法：
#   bash scripts/verify-mobile-ios-subscription.sh
#   UDID=<udid> OUT_DIR=<dir> bash scripts/verify-mobile-ios-subscription.sh
#
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IDB_BIN="${IDB_BIN:-$HOME/.local/bin/idb}"
IDB_COMPANION="${IDB_COMPANION:-$HOME/.local/bin/idb_companion}"
SHIM="$ROOT/scripts/tools/ios-ax-shim.py"
UDID="${UDID:-}"
BUNDLE="${BUNDLE:-com.heyta}"
OUT_DIR="${OUT_DIR:-$ROOT/apps/mobile/evidence/subscription-$(date +%Y%m%d)}"
APP="${HEYTA_IOS_APP:-}"
DUMP="${DUMP:-$ROOT/.run-logs/sub-ios/ax-dump.json}"

# 判据文本（全部来自 `packages/i18n/src/locales/zh-CN.ts`，这里只**读**，不另写一份文案）
LEAD="官方托管同步：当前状态、选档与下单"
TIER_TITLE="买哪一档"
PRICE_HOSTED="¥5 / 月"
PRICE_HOSTED_AI="¥12 / 月"
CTA="订阅这一档"
FOOTNOTE="订阅只买"
SIGNED_OUT="先登录你的 heyta 账号，才能下单。"
ENTRY_ID="profile-entry-subscription"
# 那一行的 hint（`mobile.subscription.entry.hint`）—— 它**只许**出现在展开之后
HINT="官方托管同步的订阅与续费"

ok() { printf '   ✅ %s\n' "$1"; }
bad() { printf '   ❌ %s\n' "$1" >&2; }
info() { printf '   · %s\n' "$1"; }

mkdir -p "$OUT_DIR" "$(dirname "$DUMP")"

# ── AX 树 ───────────────────────────────────────────────────────────────
ax_dump() { rm -f "$DUMP"; "$IDB_BIN" --companion-path "$IDB_COMPANION" ui describe-all --udid "$UDID" > "$DUMP" 2>/dev/null; }

# 0=界面上有 / 1=没有 / 2=探针自己读不到树。三档必须分开（同族：renew-sellable 的 needle_state）
needle_state() {
  rm -f "$DUMP" 2>/dev/null
  ax_dump || return 2
  [ -s "$DUMP" ] || return 2
  python3 - "$DUMP" "$1" <<'PY'
import json, sys, unicodedata
path, needle = sys.argv[1], unicodedata.normalize("NFKC", sys.argv[2])
try: nodes = json.load(open(path, encoding="utf-8"))
except Exception: sys.exit(2)
def walk(n):
    yield n
    for c in (n.get("children") or []): yield from walk(c)
for top in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(top):
        for v in n.values():
            if isinstance(v, str) and needle in unicodedata.normalize("NFKC", v): sys.exit(0)
sys.exit(1)
PY
}

# 按 testID 找那一行，打印 "x y w h"（找不到打印空）。RN 的 testID 落到 AXUniqueId。
node_frame_by_id() {
  rm -f "$DUMP" 2>/dev/null
  ax_dump || return 2
  [ -s "$DUMP" ] || return 2
  python3 - "$DUMP" "$1" <<'PY'
import json, sys
path, want = sys.argv[1], sys.argv[2]
try: nodes = json.load(open(path, encoding="utf-8"))
except Exception: sys.exit(2)
def walk(n):
    yield n
    for c in (n.get("children") or []): yield from walk(c)
for top in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(top):
        if n.get("AXUniqueId") == want:
            f = n.get("frame") or {}
            print(f'{f.get("x",0)} {f.get("y",0)} {f.get("width",0)} {f.get("height",0)}')
            sys.exit(0)
sys.exit(1)
PY
}

axx() { python3 "$SHIM" "$@" --udid "$UDID" --idb "$IDB_BIN" --companion "$IDB_COMPANION" --json; }
press_row() { axx "$1" --pressable --scroll-into-view >/dev/null 2>&1; axx "$1" --press >/dev/null 2>&1; }
press_tab() { axx "$1" --press >/dev/null 2>&1; } # 底部标签栏不许带 --scroll-into-view
tap_at() { axx --tap "$1" "$2" >/dev/null 2>&1; }

shot() { xcrun simctl io "$UDID" screenshot "$OUT_DIR/$1" >/dev/null 2>&1; info "截图 → $OUT_DIR/$1"; }

# 首启那两枚面板（隐私 → 欢迎卡）。顺序实测是**隐私在前**，所以两枚都判"都不在树上"才算过。
pass_first_launch() {
  local i
  for i in 1 2 3 4 5 6; do
    needle_state '同意并联网'; [ $? = 0 ] && { press_row "同意并联网"; sleep 3; ok "已点「同意并联网」（出境同意落盘）"; continue; }
    needle_state '先离线使用'; [ $? = 0 ] && { press_row "先离线使用"; sleep 3; ok "已点「先离线使用」（欢迎卡收掉）"; continue; }
    return 0
  done
  bad "六轮之后首启面板还挂着 ⇒ 不拿「按过了」当「按掉了」"
  return 1
}

# ── ① 设置目录里真有这一节，且「?」默认不摊开 ─────────────────────────
check_entry_and_tip() {
  press_tab "我的"; sleep 4
  local frame rc
  frame="$(node_frame_by_id "$ENTRY_ID")"; rc=$?
  if [ "$rc" = "2" ]; then bad "AX 树读不出 ⇒ 这一条**没有被证明**（不是"没有这一节"）"; return 1; fi
  if [ "$rc" != "0" ] || [ -z "$frame" ]; then
    bad "「我的」页上没有 testID=${ENTRY_ID} 那一行 ⇒ 订阅入口到不了"
    return 1
  fi
  ok "「我的」页有订阅入口（testID=${ENTRY_ID}，frame=${frame}）"

  # 先滚进视野，再读一次 frame —— 上面的坐标可能还在屏幕外
  axx "订阅" --scroll-into-view >/dev/null 2>&1; sleep 1
  frame="$(node_frame_by_id "$ENTRY_ID")"
  local x y w h
  x="$(printf '%s' "$frame" | awk '{printf "%d", $1}')"; y="$(printf '%s' "$frame" | awk '{printf "%d", $2}')"
  w="$(printf '%s' "$frame" | awk '{printf "%d", $3}')"; h="$(printf '%s' "$frame" | awk '{printf "%d", $4}')"
  info "入口行 frame=${frame}（屏幕内：y=${y}，高 ${h}）"

  # ② 默认不摊开：hint 那句话**不许**在树上
  needle_state "$HINT"; rc=$?
  if [ "$rc" = "0" ]; then bad "hint 默认就在树上 ⇒ 「?」根本没拦住说明文字（禁令破了）"; return 1; fi
  if [ "$rc" = "2" ]; then bad "AX 树读不出 ⇒ 「默认不摊开」这一条没有被证明"; return 1; fi
  ok "hint「${HINT}」默认**不在**树上（说明文字不占屏）"

  # 默认（收起）那一张：要和展开后那张**同一处**比对「?」有没有跳（见 00/01 两张图）。
  # 2026-10-24 实测：`actionHead` 居中对齐时，展开会让 `?` 往上跳约 10pt（点一次跳一次）；
  # 改成顶端对齐后两张图里图标中心同一 y。
  shot "00-tip-collapsed.png"

  # ③ 点一下「?」→ 正文摊开。图标紧贴标签右侧，x 偏移随标签字数变
  #    ⇒ 不写死一个坐标，逐个候选试，**必须**看到正文出现才算成（自校准，失败时逐条打印）。
  local dx hit=""
  for dx in 60 65 70 75 80 85 90 95 100 105 110; do
    tap_at "$(( x + dx ))" "$(( y + h / 2 ))"
    sleep 1
    needle_state "$HINT"; rc=$?
    if [ "$rc" = "0" ]; then hit="$dx"; break; fi
    if [ "$rc" = "2" ]; then bad "点「?」之后树读不出 ⇒ 停在这里（不拿它当"没展开"）"; return 1; fi
  done
  if [ -z "$hit" ]; then
    bad "点了 11 个候选偏移都没把正文摊开 ⇒ 要么「?」不可点，要么正文不随点击出现"
    return 1
  fi
  ok "点「?」展开成功（x 偏移 ${hit}pt）—— 正文「${HINT}」现在在树上"
  shot "01-tip-expanded.png"

  # 再点一下 → 收起（开合是一个**开关**，不是单向）
  tap_at "$(( x + hit ))" "$(( y + h / 2 ))"
  sleep 1
  needle_state "$HINT"; rc=$?
  if [ "$rc" = "2" ]; then bad "收起之后树读不出 ⇒ 这一条没有被证明"; return 1; fi
  if [ "$rc" = "0" ]; then bad "再点一下正文还在 ⇒ 只开不合"; return 1; fi
  ok "再点一下收起（正文重新不在树上）"

  # 把行位置留给下一步（进订阅页要点行中心，不能点在「?」上）
  ROW_CX=$(( x + w / 2 )); ROW_CY=$(( y + h / 2 ))
}

# ── ④ 订阅页：内容真的画出来了，未登录按下说人话 ─────────────────────
check_subscription_screen() {
  local rc
  tap_at "$ROW_CX" "$ROW_CY"; sleep 3
  shot "02-subscription-screen.png"

  local needle
  for needle in "$LEAD" "$TIER_TITLE" "$PRICE_HOSTED" "$PRICE_HOSTED_AI" "$CTA" "$FOOTNOTE"; do
    needle_state "$needle"; rc=$?
    if [ "$rc" = "2" ]; then bad "树读不出 ⇒ 「${needle}」没有被证明"; return 1; fi
    if [ "$rc" != "0" ]; then bad "订阅页上没有「${needle}」⇒ 这一屏没画全"; return 1; fi
    ok "订阅页有「${needle}」"
  done

  # 未登录按下：壳自己那句人话（不发请求 —— 没有服务端也能验）
  press_row "$CTA"; sleep 3
  needle_state "$SIGNED_OUT"; rc=$?
  if [ "$rc" = "2" ]; then bad "树读不出 ⇒ 「未登录会说人话」没有被证明"; return 1; fi
  if [ "$rc" != "0" ]; then bad "按下「${CTA}」之后没有「${SIGNED_OUT}」⇒ 失败被吞了"; return 1; fi
  ok "未登录按下「${CTA}」→ 界面上有「${SIGNED_OUT}」"
  shot "03-signed-out-refusal.png"
}

main() {
  command -v python3 >/dev/null || { bad "没有 python3"; exit 1; }
  [ -x "$IDB_BIN" ] || { bad "没有 idb：$IDB_BIN"; exit 1; }
  [ -f "$SHIM" ] || { bad "没有 AX shim：$SHIM"; exit 1; }
  [ -n "$UDID" ] || UDID="$(xcrun simctl list devices booted | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1)"
  [ -n "$UDID" ] || { bad "没有 booted 的模拟器（先 xcrun simctl boot <UDID>）"; exit 1; }

  echo "════ 移动端「订阅」一节 + 「?」气泡 · 设备腿 ════"
  echo "   设备 $UDID"
  echo "   证据 $OUT_DIR"

  if [ -n "$APP" ]; then
    [ -d "$APP" ] || { bad "HEYTA_IOS_APP 指向的不是 .app：$APP"; exit 1; }
    xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1
    xcrun simctl uninstall "$UDID" "$BUNDLE" >/dev/null 2>&1
    xcrun simctl install "$UDID" "$APP" || { bad "装不上 $APP"; exit 1; }
    # 同一条理由（§7 第 364 条）：换成 node 读 mtime，跨平台同一件事。
    ok "已从当前产物重装（$(basename "$APP")，main.jsbundle $(node -p 'try{require("fs").statSync(process.argv[1]).mtime.toISOString().slice(11,19)}catch{""}' "$APP/main.jsbundle")）"
  fi

  xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1
  xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null 2>&1 || { bad "app 起不来（先装 ${BUNDLE}）"; exit 1; }
  sleep 8
  pass_first_launch || exit 1

  check_entry_and_tip || exit 1
  check_subscription_screen || exit 1

  echo ""
  echo "════ 结论 ════"
  ok "订阅一节在设备上到得了、画得全、未登录按下说人话"
  ok "「?」默认不占屏、点开、再点收起 —— 三条都在真 AX 树上量的"
  echo "   ⚠️ 这条腿**不**证明「能买到」：真下单要真服务端 + 真账号（见文件头）。"
}

main "$@"
