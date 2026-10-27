#!/bin/bash

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1：脚本运行期间工作树可能被另一轮任务编辑；
#    先执行不可变快照，避免 bash 按字节读取时把后半段解析成别的文件。
case "$(basename "$0")" in
  .*.snap.*) ;;
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" >"$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
trap 'rm -f -- "$0"' EXIT

# iOS 协作共享清单旅程验收（真 Release 包 + 真 iOS 模拟器 + 真服务端，零 mock）
# ==============================================================================
#
# 这条装置回答 M6 那一格：共享清单在**手机上**是不是真的能用。
# web 那侧早有 `verify:collab-*` 几套，但它们量的是线协议与服务端边界，
# **手机界面从来不在里面**。这里走同一条产品旅程，只是把"另一台设备"换成
# 一台真 iPhone 模拟器，另一侧用生产装配件（`createShareOpDispatcher`）驱动的 node 进程：
#
#   L1 手机能加入：贴邀请凭证 → 同意 → 界面自己说「加入成功」
#   L2 下行看得见：owner 写的那条任务，在手机上**不点同步**就出现
#   L3 上行写得出去：手机在评论框打字 → 点发送 → 这条评论回到界面上
#   L4 上行带签名：owner 把手机那一行写的 op 下载回来，用名册公钥重验 = `verified`
#      （服务端"收下" ≠ verified；这一条才是 ADR-0069 在移动端成立）
#   L5 信号驱动：owner 再写一条评论 → 手机靠 `new_share_ops` 自己重画，全程没碰同步按钮
#   L6 界面不谎称能力：通知偏好面只剩三枚有输入的开关（M5-3 那一格）
#   L8 本机偏好真的决定响不响：默认全关 ⇒ 共享动态是空的；翻开『新增内容』 ⇒ 同一种信号
#      在那里落成**那句带清单名的话**（两半相反才说明闸门在看偏好，单判一响是假绿）
#   L9 便签那一族也回流：owner 写一条便签进那份共享清单 ⇒ 手机「便签」板上看得见（下行；
#      上行那一格两壳今天都没有入口 —— `setNoteProject` 在 `apps/*` 零调用点，见第 10c 步那段）
#   L7 手机自己开共享：**反向**那一半 —— 手机先从界面上建一条自己的清单（产品定义里
#      「手机用户能建清单」那一格），再把它设为共享（同意闸 → 建 share → 签发邀请 → 撤销）。
#      这一档里手机是**所有者**，node 那侧只读服务端形状，不替它建。
#
# 🔴 每一档都留**截图**（AGENTS §6.2 规定一：必须肉眼看图），失败时也留。
# 🔴 证据目录只存证据（规定三）：png / txt / json / md。Release 产物与 DerivedData
#    一律在临时目录，收尾删掉。
# 🔴 不抢前台：idb 经 companion 从设备内部驱动，不启动也不激活 Simulator.app。
#
# 退出码：`0` 全绿；`1` 产品判据红；`3` 环境/装置前提不成立（不判产品）。
#
# 用法：
#   IOS_UDID=<udid> bash scripts/verify-mobile-collab-ios.sh
#
# 可覆盖：IOS_UDID / IOS_DEVICE_NAME / IOS_BID / HEYTA_IOS_DERIVED / HEYTA_IOS_BUILD_LOG
#         PORT（默认 3177）/ HEYTA_E2E_DB（默认 heyta_collab_m6_ios）
#         HEYTA_COLLAB_IOS_RUN（本轮私有目录；默认 mktemp -d）
#         HEYTA_COLLAB_IOS_KEEP_ARTIFACTS=1（留着产物与临时目录以便调试）

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHIM="$ROOT/scripts/tools/ios-ax-shim.py"
# 🔴 本线自带的锚点解析器（为什么不用 shim 的退化匹配：见该文件文件头第 22 跑那段）
ANCHOR="$ROOT/scripts/tools/ios-collab-anchor.py"
. "$(dirname "$0")/lib/mobile-e2e.sh"
. "$(dirname "$0")/lib/mobile-e2e-fresh-account.sh"

DEVICE_NAME=${IOS_DEVICE_NAME:-heyta-collab-m6}
BID=${IOS_BID:-com.heyta}
PORT=${PORT:-3177}
E2E_DB=${HEYTA_E2E_DB:-heyta_collab_m6_ios}
HOST_SERVER="http://127.0.0.1:${PORT}"
DERIVED=${HEYTA_IOS_DERIVED:-/tmp/heyta-collab-m6-release}
BUILD_LOG=${HEYTA_IOS_BUILD_LOG:-/tmp/heyta-collab-m6-build.log}
IOS_DISPLAY=${HEYTA_IOS_DISPLAY:-primary}
STAMP="$(date +%m%d%H%M)"
# 🔴 不许写成 ${VAR:-$(mktemp -d ...)} 或 ${VAR:-"$ROOT/..."} 这种形状：macOS 自带 bash 3.2
#    解析「参数展开默认值里嵌套引号」会漏配引号，症状是**离真凶很远的那一行**报
#    unexpected EOF while looking for matching "（实测报在 line 115）。
#    所以这两枚默认值一律用 if/else 求。
if [ -z "${HEYTA_COLLAB_IOS_RUN:-}" ]; then
  TMPROOT="${TMPDIR:-/tmp}"
  RUN_DIR="$(mktemp -d "${TMPROOT%/}/heyta-collab-m6-XXXXXX")"
else
  RUN_DIR="$HEYTA_COLLAB_IOS_RUN"
fi
mkdir -p "$RUN_DIR"
if [ -z "${HEYTA_COLLAB_IOS_EVIDENCE:-}" ]; then
  EVIDENCE="$ROOT/apps/mobile/evidence/collab-ios-$STAMP"
else
  EVIDENCE="$HEYTA_COLLAB_IOS_EVIDENCE"
fi
mkdir -p "$EVIDENCE"
OWNER_STATE="$RUN_DIR/owner-state.json"
OWNER_TOKEN_FILE="$RUN_DIR/owner-token.txt"
# 🔴 私有凭据文件：lib 的默认值（`/tmp/heyta_mobile_*.txt`）是跨轮共享的，
#    与别的移动端验收并行时会互相把对方的账号读进来（"写者可换、读者不可换"那次事故）。
export HEYTA_E2E_TOKEN_FILE="$RUN_DIR/member-token.txt"
export HEYTA_E2E_EMAIL_FILE="$RUN_DIR/member-email.txt"
export HEYTA_E2E_E2EE_FILE="$RUN_DIR/member-e2ee.txt"
export HEYTA_E2E_PIDFILE="$RUN_DIR/server.pid"
export HEYTA_E2E_LOGFILE="$RUN_DIR/server.log"
# 🔴 dump 必须换成**本趟私有**路径：lib 的默认值是固定路径，两趟并行时后写的会**覆盖前一趟的证据**；
#    而这条旅程会把访问令牌抄进 dump，共享路径等于在 /tmp 留一份本机明文。
export IDB_DUMP_FILE="$RUN_DIR/ax-dump.json"

SERVER_STARTED=0
OWNER_LOOP_PID=""
SHARE_ID=''
OWNER_MEMBER=''
PHONE_MEMBER=''

PASS=0
FAIL=0
ok() { echo "   ✅ $1"; PASS=$((PASS + 1)); }
bad() { echo "   ❌ $1"; FAIL=$((FAIL + 1)); }
step() { echo; echo "════ $1 ════"; }
note() { echo "   · $1"; }

summary() {
  {
    echo "iOS 协作旅程：${PASS} 通过 / ${FAIL} 失败"
    echo "share=${SHARE_ID:-未建} ownerMember=${OWNER_MEMBER:-未建} phoneMember=${PHONE_MEMBER:-未入群}"
    echo "服务端=${HOST_SERVER} 设备=${UDID:-?} bundle=$(cat "$EVIDENCE/bundle-sha256.txt" 2>/dev/null)"
  } > "$EVIDENCE/rc.txt"
  echo
  echo "════════ iOS 协作旅程：${PASS} 通过 / ${FAIL} 失败 ════"
  echo "证据目录：$EVIDENCE"
  [ "$FAIL" -eq 0 ]
}

env_bail() {  # <说明> —— 装置/环境前提不成立：不判产品
  echo "   ❌ $1"
  echo "      这是环境/装置条件，不是产品失败 ⇒ exit 3"
  cleanup
  exit 3
}

# ── 设备侧原语：全部沿用同族 iOS 装置已经踩过的那套读法 ─────────────────────
ax() { python3 "$SHIM" "$@" --udid "$UDID" --idb "$IDB_BIN" --companion "$IDB_COMPANION" --json; }
jget() { printf '%s' "$1" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$2',''))" 2>/dev/null; }
SCREEN_W=402
SCREEN_H=874

# ── 按压的唯一通道：先解析、后按，解析只认**逐字/合成精确**命中的那一枚节点 ──
#
# 🔴 为什么不再用 `ax … --pressable --press` 的退化匹配（2026-10-25 第 22 跑实测）：
#    RN 的行把标签合成成「设置, 设置」⇒ `--exact` 恒取空，而不带 `--exact` 时
#    子串退化会抓到别的行（那一跑抓到「AI 设置」一带，落进「AI 与集成」屏），
#    日志读起来却像"按到了设置"。加上屏外节点（滚动残留的负 y）按下去是**空操作
#    且不报错**，两条叠在一起 = 随机一击。⇒ 现在：
#      · 命中条件 = 标签逐字等于 want，或 want 是标签按 `,` 切分后的整段；
#      · 中心在屏外 ⇒ 先让 shim 滚进可见区、重 dump、重解析，还不在就不按；
#      · 同名多枚 ⇒ 响亮报 ambig，让调用方改用 `id:` 锚点，绝不"取第一枚"。
#    解析器自带 7 条自检（含一条对照臂），在步骤 0 里当门禁跑。
resolve_anchor() {  # <want> ⇒ "state cx cy label"（state ∈ hit|offscreen|none|ambig|bad-tree）
  python3 "$ANCHOR" "$IDB_DUMP_FILE" "$1" "$SCREEN_W" "$SCREEN_H" 2>/dev/null
}
# 量一次 app 画面尺寸：屏内/屏外的判定要有分母，不能拿 402x874 当常量。
# 取不到就沿用初值并**说出来**（沿用常量 = 一条会随设备漂移的抄件，只当兜底）。
read_screen_size() {
  local _fr w h
  _fr=$(ax - --list --json 2>/dev/null)
  w=$(jget "$_fr" width); h=$(jget "$_fr" height)
  case "$w" in '' | *[!0-9]*) note "取不到 app 画面宽，屏内判定沿用 ${SCREEN_W}"; return 1 ;; esac
  case "$h" in '' | *[!0-9]*) note "取不到 app 画面高，屏内判定沿用 ${SCREEN_H}"; return 1 ;; esac
  SCREEN_W=$w; SCREEN_H=$h
}
tree_has_id() {  # <testID> ⇒ **当下**那棵树上有没有这枚 AXUniqueId
  # 与 `tree_has` 同一条纪律：先重拍再读（旧快照会把"刚出现的那枚"读成"没有"）。
  idb_dump
  [ -f "$IDB_DUMP_FILE" ] || return 1
  python3 - "$IDB_DUMP_FILE" "$1" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(2)
roots = data if isinstance(data, list) else [data]
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
for top in roots:
    for n in walk(top):
        if (n.get("AXUniqueId") or "") == sys.argv[2]:
            sys.exit(0)
sys.exit(1)
PY
}

# 把 want 解析成"可以按"的一发：命中屏内就按，被滚走了就滚回来再按。
# ⇒ 0 = 按下了；非 0 = 没按（原因已经打到日志里，绝不静默乱按）。
press_anchor() {  # <want>
  # 🔴 `id:` 前缀与标签走**同一条**解析路径（解析器认两种 want）。第 23 跑实测过反面：
  #    这里原来另走一套 `--press` 并拿 `found` 判成功 —— 而 shim 的 press 回的是
  #    `{"result": …}`，**没有 `found` 这个键** ⇒ 那一发明明按成了（截图停在设置枢纽六节），
  #    装置却连报五次"这枚 AXUniqueId 不在当前树上"。成功只由**到达判据**判。
  local want="$1" state cx cy label enabled
  idb_dump
  read -r state cx cy label enabled <<<"$(resolve_anchor "$want")"
  if [ "$state" != "hit" ]; then
    ax "$want" --pressable --scroll-into-view --json >/dev/null 2>&1
    idb_dump
    read -r state cx cy label enabled <<<"$(resolve_anchor "$want")"
  fi
  case "$state" in
    hit) ax --tap "$cx" "$cy" --json >/dev/null 2>&1; return 0 ;;
    offscreen) echo "     [press] 「${want}」滚完仍在屏外（${cx},${cy}）⇒ 屏外坐标按下去是空操作，不按"; return 1 ;;
    ambig)  echo "     [press] 「${want}」在本屏有同名多枚（${label}）⇒ 必须改用 id: 锚点，不取第一枚"; return 3 ;;
    none)   echo "     [press] 本屏没有逐字叫「${want}」的可点节点（子串命中的是别的行，不算命中）"; return 1 ;;
    *)      echo "     [press] 读不出 AX 树（state=${state:-空}）⇒ 这一发没按"; return 1 ;;
  esac
}

# 🔴 任何跳页动作先 `forget_safe_tap`：那对坐标属于**上一页**，
#    在新界面上按坐标点就是随机一击。
# 🔴 日志不吞：按不动的原因（ambig / 屏外 / 没有这一枚）必须看得见，
#    否则"装置没按"又会读成"产品没反应"。
ax_press() { forget_safe_tap; press_anchor "$1"; }

# 🔴 屏上**有正在填的表单**时唯一可用的按法：不碰软键盘，直接按解析出来的坐标。
#    `ax_press_until` 每一发之前都 `dismiss_keyboard`，而那一发是按键盘的 **return 键**
#    （见 `ios-ax-shim.py` 的 `RETURN_KEY_LABELS`）—— RN 的输入框把 return 当
#    `onSubmitEditing`，于是"收个键盘"= **把表单提交了**。
#    第 41 跑实测：新建任务面板里按落点芯片，第一发就把任务提交进收集箱、面板随之关闭，
#    后四发读到的"没有这一枚"是装置自己造成的现场，不是产品缺控件。
press_in_form() {  # <want> [重试次数]
  local want=$1 tries=${2:-5} i=1
  while [ "$i" -le "$tries" ]; do
    if press_anchor "$want"; then return 0; fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

dismiss_keyboard() { ax --dismiss-keyboard --json >/dev/null 2>&1 || true; }

# 🔴 键盘立着的时候**整个 App 的子树都不在 AX 树上**（只剩键盘那 44 个节点），
#    于是"读不到那个框"会被读成"产品没那个框"。所以要一条**带复测**的收法，
#    退不掉就返回非 0 —— 调用方**必须**据此报红/退 3，不许在"树里只有键盘"的
#    状态下做任何"某某不见了"的断言（那是一条恒真的判据）。
#
# 🔴 收法**只许点一枚事先量过的静态文本**（`SAFE_TAP_*` 那对坐标），两条禁令都有实测：
#    ① 不许按 return 收 —— `ios-ax-shim.py:1054-1057` 写得明白，RN 输入框把 return 当
#      `onSubmitEditing`，"收个键盘"会把表单提交掉；
#    ② 不许按屏幕比例点"看着像空白"的坐标 —— 2026-10-24 第二跑实测：点 (50%,34%)
#      落在设置面「同步」那一节的表头上（`{{40,282},{346,23}}`），自托管表单当场收起，
#      后三次就报"框不在树上了"（装置自己造的假红）。
#    坐标必须**趁树还看得见**记下来（`remember_safe_tap`）：键盘起来之后再查标签查不到。
#    任何跳页动作（`ax_press` / `ax_press_until` / 返回列表）先 `forget_safe_tap` ——
#    旧坐标点到新界面上就是随机一击。
SAFE_TAP_X=''
SAFE_TAP_Y=''
remember_safe_tap() {  # <静态文本标签>
  local n
  n=$(ax "$1" --role AXStaticText --list --json 2>/dev/null)
  [ "$(jget "$n" found)" = "True" ] || return 1
  SAFE_TAP_X=$(jget "$n" x)
  SAFE_TAP_Y=$(jget "$n" y)
}
forget_safe_tap() { SAFE_TAP_X=''; SAFE_TAP_Y=''; }

dismiss_keyboard_hard() {
  local i
  [ "$(jget "$(ax --keyboard --json)" present)" = "True" ] || return 0
  [ -n "$SAFE_TAP_X" ] || return 1
  for i in 1 2 3; do
    ax --tap "$SAFE_TAP_X" "$SAFE_TAP_Y" --json >/dev/null 2>&1
    sleep 1.2
    [ "$(jget "$(ax --keyboard --json)" present)" = "False" ] && return 0
  done
  return 1
}
cpcount() { python3 -c 'import sys;print(len(sys.argv[1]))' "$1"; }

# 数**这一棵树**里标签含某个词的输入框有几枚（同族装置实测：两枚框同一个 label 时
# 不先数就会填错那一格；本装置「加密口令」也是「端到端加密口令」的子串，同一类失法）。
field_count() {
  python3 - "$IDB_DUMP_FILE" "$1" <<'PYCOUNT'
import json, sys, unicodedata
try:
    nodes = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print(-1); sys.exit(0)
needle = unicodedata.normalize("NFKC", sys.argv[2])
def walk(n):
    yield n
    for c in (n.get("children") or n.get("nodes") or []):
        yield from walk(c)
count = 0
for top in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(top):
        if not isinstance(n, dict):
            continue
        if str(n.get("role") or "") != "AXTextField":
            continue
        label = unicodedata.normalize("NFKC", str(n.get("AXLabel") or ""))
        if needle and needle in label:
            count += 1
print(count)
PYCOUNT
}

# app 自己那棵树里有几枚节点。用来判「iOS 系统弹窗立着没有」——
# 弹窗在的时候 app 树会塌成一两枚（同族装置实测），而不是"底部标签找不到"。
tree_node_count() {
  python3 - "$IDB_DUMP_FILE" <<'PYNODES'
import json, sys
try:
    nodes = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print(0); sys.exit(0)
def walk(n):
    yield n
    for c in (n.get("children") or n.get("nodes") or []):
        yield from walk(c)
print(sum(1 for top in (nodes if isinstance(nodes, list) else [nodes])
          for n in walk(top) if isinstance(n, dict)))
PYNODES
}

# 从这一棵树里读出「待发布」那一屏画出来的恢复码。
#
# 🔴 为什么按**形状**读、不按标签读：那串码是 `<Text selectable>{pending.recoveryCode}</Text>`
#    （`VaultSettingsSection.tsx:463`），它是一行正文，没有标签可挂。而形状是钉死的：
#    `packages/sync-core/src/key-lifecycle.ts:29-31` ⇒ 24 字节 → 32 字母表
#    `0123456789ABCDEFGHJKMNPQRSTVWXYZ`、`normalizeRecoveryCode` 之后定长 40、不带分隔符。
#    所以"恰好一枚 40 位该字母表的串"就是它；数出 0 枚或 >1 枚都当场响亮报，**不猜码**。
#    读数只走 stdout 给装置用，一律不落日志、不进证据目录（见 SECRET_FRAMES）。
recovery_code_from_tree() {
  python3 - "$IDB_DUMP_FILE" <<'PYRC'
import json, re, sys, unicodedata
try:
    nodes = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print("__unreadable__"); sys.exit(0)
pat = re.compile(r"[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{40}")
def walk(n):
    yield n
    for c in (n.get("children") or n.get("nodes") or []):
        yield from walk(c)
hits = set()
for top in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(top):
        if not isinstance(n, dict):
            continue
        for k in ("AXValue", "AXLabel", "value", "label", "title"):
            v = n.get(k)
            if isinstance(v, str):
                v = unicodedata.normalize("NFKC", v)
                for ch in ("\n", "\r", " ", "-"):
                    v = v.replace(ch, "")
                if pat.fullmatch(v):
                    hits.add(v)
                    break
if len(hits) != 1:
    print(f"__count:{len(hits)}__"); sys.exit(0)
print(next(iter(hits)))
PYRC
}

# 界面文本读数：NFKC 归一化 + 子串。
# 🔴 不用"精确标签"：RN 在 iOS 上把按钮可及名拼成组合句，而 iOS 还会把 ASCII 规范化成
#    **全角**（`ios-erase-1` → `ｉｏｓ－ｅｒａｓｅ－１`）。精确比对对这两件事恒不命中，
#    症状是"界面上明明有的东西读不到"。
# 等某枚按钮从 disabled 翻成 enabled（RN 那一侧的读数）。翻面返回 0，等不到返回 1。
wait_enabled() {  # <按钮标签>
  # 🔴 与按压通道同一把尺（子串命中会读到别的控件的 enabled ⇒ "打字进了表单状态"会假绿）
  local want="$1" i _st _x _y _lb en
  for i in 1 2 3 4 5 6; do
    idb_dump
    read -r _st _x _y _lb en <<<"$(resolve_anchor "$want")"
    if [ "$_st" != "none" ] && [ "$_st" != "ambig" ] && [ "$en" = "true" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# 按下某枚按钮之后**有界等待**界面进入终态，同时采样那枚按钮自己的 enabled。
#
# 🔴 为什么要采样，而不是只看结果：这一族有三种坏，修法各不相同 ——
#   · 从头到尾没变灰 = `onPress` 根本没落上（RN 按压抖动 = 装置问题）；
#   · 变过灰、又亮回来却没到终态 = 落上了但那次调用抛错（产品/现场问题）；
#   · 一直灰到超时 = 还在算（是装置的预算给小了）。
# ⚠️ "变灰"只证**按钮当时不可点**，不证原因是 `busy`：RN 那侧 disabled 常有两个来源
#    （忙 / 输入还没填够，例如「确认并发布」的条件是 `busy || pendingCode.length === 0`）。
#    所以这一档读数只用来把"从没点着过"与"点着过但没走完"分开，别拿它当"还在算"的证明。
# 最后一种在移动端不是假设而是**已登记的实测**：`beginCreation` 走纯 JS Argon2id
# （`packages/sync-core/src/encryption/argon2.ts` 原文："Hermes 没有 JIT ⇒ 手机上数十秒
# 量级"，并且明写"真机耗时必须实测，不能估算"）。⇒ 拿固定 `sleep` 判成败一定会把
# "还在算"读成"没成"。2026-10-25 第 14 跑就是这个形状：口令 20 掩码点、按钮已变灰
# （`kit.tsx:803` 的 disabled-opacity ⇒ `busy=true` ⇒ 按压确实落上了），5 秒时还没有「确认并发布」。
# 读数写进全局：WAIT_HIT（命中的终态标签）、WAIT_SAW_BUSY（1=观察到过 disabled）、
# WAIT_LAST_RC（最后一次 tree_has 的 rc，2=树读不出）、WAITED（实际等了多少秒）。
wait_state() {  # <探针按钮标签> <超时秒> <终态标签> [终态标签...]
  local want="$1" budget="$2"; shift 2
  local i=0 lbl rc saw_busy=0 _st _x _y _lb _en
  WAIT_HIT=''; WAIT_SAW_BUSY=0; WAIT_LAST_RC=1; WAITED=0
  while [ "$i" -lt "$budget" ]; do
    sleep 2
    i=$((i + 2))
    idb_dump
    for lbl in "$@"; do
      tree_has "$lbl" >/dev/null 2>&1; rc=$?
      WAIT_LAST_RC=$rc
      if [ "$rc" = "0" ]; then
        WAIT_HIT="$lbl"; WAIT_SAW_BUSY=$saw_busy; WAITED=$i; return 0
      fi
    done
    # 🔴 忙态探针与按压通道必须**同一把尺**：这里原本是"子串命中 + 取那枚的 enabled"，
    #    而子串命中的可能是别的控件 ⇒ "变过灰"这个读数会假（第 22 跑同一类缺陷的第二处）。
    read -r _st _x _y _lb _en <<<"$(resolve_anchor "$want")"
    if [ "$_st" != "none" ] && [ "$_st" != "ambig" ] && [ "$_en" = "false" ]; then
      saw_busy=1
    fi
  done
  WAIT_SAW_BUSY=$saw_busy; WAITED=$i
  return 1
}

tree_has() {
  # 🔴 **读数之前先重拍**：dump 文件只由 `idb_dump` 写，而按/填这些动作各走各的通道
  #    （shim 自己快照），于是"填完之后断言那一串在不在树上"量到的是**填之前**那棵树 ——
  #    2026-10-25 第 24 跑实测：凭证已经逐字进了输入框（shim 回读相同），本函数却报
  #    "树里读不到"，装置自己造红；当场手工 `describe-all` 证实 `AXTextArea` 的 `AXValue`
  #    就是那一串。同一形反过来更糟：减法判据（"这行已经没了"）量到旧树会**恒过**。
  #    ⇒ 快照归读者负责，调用方漏写 `idb_dump` 不再是失法。
  idb_dump
  python3 - "${2:-$IDB_DUMP_FILE}" "$1" <<'PY'
import json, sys, unicodedata
try:
    nodes = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(2)
needle = unicodedata.normalize("NFKC", sys.argv[2])
def walk(n):
    yield n
    for c in (n.get("children") or n.get("nodes") or []):
        yield from walk(c)
for top in (nodes if isinstance(nodes, list) else [nodes]):
    for n in walk(top):
        for k in ("AXLabel", "AXValue", "label", "value", "title"):
            v = n.get(k)
            if isinstance(v, str) and needle in unicodedata.normalize("NFKC", v):
                sys.exit(0)
sys.exit(1)
PY
}

wait_tree() {  # <needle> [超时秒]
  local want="$1" timeout="${2:-90}" i=0
  while [ "$i" -lt "$timeout" ]; do
    # `tree_has` 自己会重拍快照，这里不再另写一遍 `idb_dump`。
    tree_has "$want" && return 0
    sleep 3
    i=$((i + 3))
  done
  return 1
}

# 同一件事，但锚在 `AXUniqueId`（= RN 的 `testID`）上而不是界面文字上。
# 什么时候用这一枚：断言的是"走到了哪一个相位"，而那一相位有自己独占的节点 ——
# 拿整句文案当判据会把**装置和产品文案绑在一起**（改一个字就要重跑一趟设备）。
# 🔴 前提：那枚 `testID` 必须挂在**可交互节点**上（`Button`/`Pressable`/`TextInput`）。
#    挂在 `Text` 或纯容器上时 RN 不会把它落成 `AXUniqueId`（那类节点在 `describe-all` 里
#    只有 `AXLabel`、没有 `AXUniqueId`），于是这一枚**永远不会命中** ——
#    产品绿、装置红，而且红得像产品坏了。第 29 跑实测，见 §7 #575。
wait_tree_id() {  # <testID> [超时秒]
  local want="$1" timeout="${2:-90}" i=0
  while [ "$i" -lt "$timeout" ]; do
    tree_has_id "$want" >/dev/null 2>&1 && return 0
    sleep 3
    i=$((i + 3))
  done
  return 1
}

# SECRET_FRAMES=1 ⇒ 屏幕上正画着当趟那枚一次性恢复码 ⇒ 这一帧**不许进证据目录**
#（证据目录是要提交进 git 的）。改落私有 RUN_DIR：默认随目录删掉，即便
# HEYTA_COLLAB_IOS_KEEP_ARTIFACTS=1 也只留在本机 /tmp，不会被下一次提交带出去。
SECRET_FRAMES=0
shot() { _shot_to "$EVIDENCE" "$1"; }
_shot_to() {  # <目录> <文件名>：截图要"能用"才算留下 —— 全黑 PNG 不是证据
  local path
  if [ "$SECRET_FRAMES" = "1" ]; then path="$RUN_DIR/$2.png"; else path="$1/$2.png"; fi
  rm -f -- "$path"
  idb_ui screenshot "$path" >/dev/null 2>&1 || true
  if ! png_usable "$path"; then
    xcrun simctl io "$UDID" screenshot --display "$IOS_DISPLAY" "$path" >/dev/null 2>&1 || true
  fi
  if png_usable "$path"; then echo "   🖼 $path"; else echo "   ⚠️ 截图不可用（全黑或没落盘）：$path"; fi
}
png_usable() {
  local path="$1"
  [ -s "$path" ] || return 1
  HEYTA_PNG_STATS="$ROOT/scripts/screenshots/png-stats.mjs" node --input-type=module - "$path" <<'NODE' >/dev/null 2>&1
const { inspectPng, looksBlank } = await import(process.env.HEYTA_PNG_STATS);
const stats = inspectPng(process.argv[2]);
if (looksBlank(stats)) process.exit(1);
NODE
}

# iOS「保存密码？」是**别的进程**的弹窗：它立着的时候底部两个标签都不在树上。
# 判"这是弹窗态"用这条读数，点完必须回读"树回来了没有"（按下 ≠ 生效）。
dismiss_ios_save_password() {
  dismiss_keyboard
  local t m _fr _aw _ah _sx _sy
  t=$(jget "$(ax "任务" --list --json)" found)
  m=$(jget "$(ax "我的" --list --json)" found)
  if [ "$t" != "True" ] && [ "$m" != "True" ]; then
    # 🔴 底部标签找不到**不等于**弹窗立着：在设置/保险库这类屏上本来就没有底部标签
    #    （第 14 跑实测：这里连点两次都读不回底部标签，说明那两发坐标点是白点的）。
    #    真弹窗的特征是 app 树整体塌掉。所以先量节点数，树是完整的就**不做盲点坐标**。
    idb_dump
    _n=$(tree_node_count)
    if [ "${_n:-0}" -gt 15 ]; then
      echo "     [dismiss] app 树完整（${_n} 枚节点）⇒ 不是「保存密码？」弹窗态，不做盲点坐标"
      return 1
    fi
    echo "     底部两个标签都不在树上、app 树只剩 ${_n} 枚 ⇒ 按 iOS 系统弹窗态处理，按坐标点「以后」"
    _fr=$(ax - --list --json 2>/dev/null)
    _aw=$(jget "$_fr" width)
    _ah=$(jget "$_fr" height)
    case "$_aw" in '' | *[!0-9]*) _aw=402; note "取不到 app frame 宽，退回 402" ;; esac
    case "$_ah" in '' | *[!0-9]*) _ah=874; note "取不到 app frame 高，退回 874" ;; esac
    _sx=$(python3 -c "print(int(${_aw}*0.31))")
    _sy=$(python3 -c "print(int(${_ah}*0.615))")
    ax --tap "$_sx" "$_sy" --json >/dev/null 2>&1 || true
    sleep 2
    t=$(jget "$(ax "任务" --list --json)" found)
    m=$(jget "$(ax "我的" --list --json)" found)
    if [ "$t" = "True" ] || [ "$m" = "True" ]; then
      ok "已关掉 iOS「保存密码？」系统弹窗（回读：任务=${t} 我的=${m}）"
      return 0
    fi
    echo "     [dismiss] 点完仍读不到底部标签（任务=${t} 我的=${m}）"
  fi
  return 1
}

# 点一个入口，用**到达判据**回读，不按按压的返回值判成功。
#
# 🔴 为什么预算是 5 次：同族 iOS 装置实测这台机上 RN 的按压**时灵时不灵**
#    （3 次全落空过，也第一次即中过），3 次的预算分不出"夹具抖"与"产品坏了"。
#    到达判据必须是**下一屏才有的东西** —— 只看 `press` 回 `success` 是
#    "按下 ≠ 生效"那一族（AGENTS §7 陷阱账里本线踩过多次）。
PRESS_HIT=''
# 落点回读失败时打印"现在到底在哪一屏"：取顶部那枚静态文字（导航标题）。
# 没有这一行，下一读的人只能像第 22 跑那样去猜"是不是被滚走了"。
where_am_i() {
  python3 - "$IDB_DUMP_FILE" <<'PY' 2>/dev/null
import json, sys, unicodedata
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print("<读不出树>"); raise SystemExit
roots = data if isinstance(data, list) else [data]
nodes = []
def walk(n):
    if isinstance(n, dict):
        nodes.append(n)
        for c in (n.get("children") or []):
            walk(c)
for r in roots:
    walk(r)
tops = []
for n in nodes:
    lab = unicodedata.normalize("NFKC", (n.get("AXLabel") or "")).strip()
    f = n.get("frame") or {}
    if not lab or (n.get("type") or "") != "StaticText":
        continue
    y = int(f.get("y") or 0)
    if 0 <= y < 140:
        tops.append((y, lab))
print(tops[0][1][:34] if tops else "<顶部没有静态文字>")
PY
}
ax_press_until() {  # <要点标签或 id:锚点> <到达后树上必须有的标签> [exact] [另一个可接受的到达标签…]
  # 🔴 第三枚 `exact` 是**旧调用位**：现在的解析本来就只认逐字/合成整段（见 `press_anchor`），
  #    保留它是为了让既有调用一行不改也不会退化成子串。短标签靠子串命中正是第 22 跑红起来的根因。
  # ⚠️ 第四枚起 = **同一屏的其它可接受落点**，命中哪一档写进 `$PRESS_HIT` 让调用方分档处置。
  #    入群那一屏有两档（这台设备没确认过 ⇒ 先落 PIPL 同意面；确认过 ⇒ 直接落凭证框），
  #    拿单一落点当到达判据就会把"同意闸正常工作"报成"入口按不动"。
  # 🔴 到达判据必须**只在目标屏出现**：拿「设置」当"已到设置枢纽"的判据是假命中 ——
  #    「我的」页那一行的 AXLabel 逐字就是「设置, 设置」（第 22 跑实测，枢纽上请用
  #    `id:settings-section-sync` 这类只在目标屏存在的锚点）。
  local want=$1 arrive=$2 try=1
  PRESS_HIT=''
  shift 2
  [ "${1:-}" = "exact" ] && shift
  local -a arrives=("$arrive" "$@")
  while [ "$try" -le 5 ]; do
    forget_safe_tap
    # 导航场合收键盘只收软键盘：这里没有正在填的表单，不许按 return（它会提交表单），
    # 也不许按比例点空白（第 2 跑实测它把自托管表单点收起过）。
    dismiss_keyboard
    # shellcheck disable=SC2086
    if ! press_anchor "$want"; then
      echo "     [press] 「${want}」第 ${try} 次没按成（原因见上一行：不按不明落点）"
      try=$((try + 1)); sleep 1; continue
    fi
    sleep 2
    idb_dump
    for _a in "${arrives[@]}"; do
      if [ "${_a#id:}" != "$_a" ]; then
        tree_has_id "${_a#id:}" >/dev/null 2>&1 && { PRESS_HIT="$_a"; return 0; }
      elif tree_has "$_a" >/dev/null 2>&1; then
        PRESS_HIT="$_a"; return 0
      fi
    done
    echo "     [press] 「${want}」第 ${try} 次按下了，但树上没有落点「${arrives[*]}」；当前屏顶部文字=$(where_am_i)"
    try=$((try + 1))
    sleep 1
  done
  return 1
}

# 填输入框：普通框走 `--set`（替换），secure 框走 `--type-text`（键入 + 掩码码点回读）。
# 🔴 三条实测换来的纪律：
#    ① 普通框不许用键入：地址框被产品默认值**预填**过，键入是追加 ⇒ 回读永远不等。
#    ② 不许信 rc：`set-value` 返回 0 而值没动过是实测过的形状 ⇒ **判据是回读逐字相同**。
#    ③ 写之前先 `--scroll-into-view` 并确认 `visible=True`：折叠线以下的框**在树上但点不到**，
#       而"定位不到"在全新装机语境下**不是**"已经设好了"，是页面状态不对 ⇒ 报红，不容错跳过。
# fill_field <标签> <值> [secure] [enabled-probe <按钮标签>]
#   第四/五枚实参：secure 框**没有可读回**（值不进 AX），所以"打字有没有进 RN 状态"
#   在这一层是判不了的。给一枚**依赖这个状态的按钮**（它的 disabled 直接写着
#   `passphrase.length === 0`），填完去读它的 `enabled` —— 那是 RN 那一侧的读数，
#   不是 UIKit 的。两档都不在树上/不翻面 ⇒ 响亮报"没进去"，不拿掩码码点当成功。
fill_field() {  # <标签> <值> [secure] [probe <按钮标签>]
  local lbl="$1" val="$2" kind="${3:-}" probe="${5:-}" pre out back attempt=1 vl bl note=''
  # 🔴 趁树还看得见，把这一行标题的静态文本坐标记成安全落点：填完之后键盘会把
  #    整棵 App 子树藏掉，那时再查标签就查不到了（`dismiss_keyboard_hard` 依赖这对坐标）。
  #    以前这里是无条件 `dismiss_keyboard_hard`（内含按 return + 按比例点空白）：
  #    第二跑就是被那两下弄红的 —— return 可能把表单提交掉，比例点落在表头上把
  #    自托管面板收起，于是"框不在了"被读成"产品没有这个框"。
  remember_safe_tap "$lbl"
  # 🔴 框不止 `AXTextField` 这一种角色：`multiline` 的 RN TextInput 在 iOS 上落成为
  #    **`AXTextArea`**（2026-10-25 第 19 跑实测 dump：入群凭证框 `share-join-token` 与
  #    评论框 `comment-composer-input` 两枚都是 multiline、role=AXTextArea）。
  #    原来这里写死 AXTextField，于是 multiline 框永远 `found=False`，装置报出来的是
  #    "这一屏没有这个框"——那是装置瞎，不是产品缺框。两档各探一次，探不到才按原样报错。
  local role='AXTextField' _r
  for _r in AXTextField AXTextArea; do
    if [ "$(jget "$(ax "$lbl" --role "$_r" --json)" found)" = "True" ]; then role="$_r"; break; fi
  done
  while [ "$attempt" -le 5 ]; do
    dismiss_keyboard_hard
    pre=$(ax "$lbl" --role "$role" --scroll-into-view --json)
    if [ "$(jget "$pre" visible)" != "True" ]; then
      echo "     [fill] 「${lbl}」第 ${attempt} 次滚不进可见区：found=$(jget "$pre" found) visible=$(jget "$pre" visible) scrollRc=$(jget "$pre" scrollRc)"
      # 框不在树上时先试**一次**重新展开自托管表单（装置自己可能把它点了收起），
      # 展开了下一轮再试；不猜"它就是没了"。
      if [ "$(jget "$pre" found)" != "True" ]; then
        ax_press "使用自托管服务器"
        sleep 1
      fi
      attempt=$((attempt + 1))
      sleep 1.5
      continue
    fi
    if [ "$kind" = "secure" ]; then
      out=$(ax "$lbl" --role "$role" --type-text "$val")
      back=$(jget "$out" detail)
      vl=$(cpcount "$val")
      bl=$(cpcount "$back")
      if [ "$(jget "$out" typedRc)" = "0" ] && [ "$bl" = "$vl" ] && [ -n "$back" ]; then
        # 🔴 掩码码点只证 UIKit 里有字，**不证 RN 收得到**（`ios-ax-shim.py:737-741` 那一族）。
        #    有 probe 就等它翻面；没翻面 = 这一发没进表单状态，按失败重试而不是按成功返回。
        if [ -n "$probe" ]; then
          if wait_enabled "$probe"; then
            ok "已填「${lbl}」（secure：掩码码点 ${bl} = 原文码点 ${vl}）并且「${probe}」已经可点 ⇒ 值真进了 RN 状态"
            return 0
          fi
          note="掩码码点=${bl} 但「${probe}」仍是 disabled ⇒ 打字没进 RN 表单状态（不是 UIKit 没收到）"
        else
          ok "已填「${lbl}」（secure：掩码码点 ${bl} = 原文码点 ${vl}；值本身不进 AX，这一屏没有可翻面的探针）"
          return 0
        fi
      else
        note="typedRc=$(jget "$out" typedRc) 掩码码点=${bl}（期望 ${vl}）"
      fi
    else
      out=$(ax "$lbl" --role "$role" --set "$val")
      back=$(jget "$out" detail)
      if [ "$back" = "$val" ]; then
        ok "已填「${lbl}」（set-value 替换，回读逐字相同）"
        return 0
      fi
      note="setRc=$(jget "$out" setRc) 回读长度=${#back}（期望 ${#val}）setErr=$(jget "$out" setErr)"
    fi
    echo "     [fill] 「${lbl}」第 ${attempt} 次没成：${note}"
    attempt=$((attempt + 1))
    sleep 0.8
  done
  # 🔴 失败也留图（AGENTS §6.2 规定一）：上一跑红在这里却没留任何截图，
  #    等于"装置说界面坏了，但没人看得见界面当时是什么"。
  shot "填不进-${lbl}"
  bad "「${lbl}」五次都没能写进去（${kind:-text}）：${note}"
  return 1
}

# 走到"手填凭据"那三个输入框。**2026-10-24 设备腿第一跑实测的界面形状**：
#   我的 → 设置（分区枢纽：订阅/常规/同步与隐私/AI 与集成/数据管理/账号安全）
#       → 同步与隐私 → 「使用自托管服务器」
# 地址/令牌/口令三框在那一层**任何状态下都在树上**（不是旧「我的」页那种"设好就收起"）。
# 🔴 旧写法"我的 → 设置 → 直接等服务器地址"量的是一版已经不存在的界面 ——
#    第一跑就是这么红的（12 秒读不到框，截图证明停在分区枢纽上）。
open_settings_sheet() {
  read_screen_size || true
  # 🔴 三跳的到达判据各用**只在目标屏出现**的锚点（AXUniqueId 那三枚是设备上现量的，
  #    不是照抄文档）：「我的」页 → profile-entry-settings，枢纽 → settings-section-sync，
  #    同步屏 → 「使用自托管服务器」那段文字。以前用「设置」当枢纽的判据是假命中。
  ax_press_until "我的" "id:profile-entry-settings" \
    || { note "「我的」页没打开（底部标签按 5 次，树上没有 profile-entry-settings）"; return 1; }
  ax_press_until "id:profile-entry-settings" "id:settings-section-sync" \
    || { note "设置枢纽没打开（那一行按下去了，树上没有 settings-section-sync）"; return 1; }
  ax_press_until "id:settings-section-sync" "使用自托管服务器" \
    || { note "同步与隐私那屏没有「使用自托管服务器」入口"; return 1; }
  ax_press_until "使用自托管服务器" "服务器地址" \
    || { note "展开自托管表单后读不到「服务器地址」"; return 1; }
  local i
  for i in 1 2 3; do
    [ "$(jget "$(ax "服务器地址" --role AXTextField --scroll-into-view --json)" visible)" = "True" ] && return 0
    sleep 1
  done
  note "「服务器地址」框在树上但滚不进可见区"
  return 1
}

# 从任意子屏退回**底部标签那一层**（设置面是全屏幕，不退干净下一步按「我的」必然落空）。
back_to_tabs() {
  local i _b_st _bx _by _blb _ben
  for i in 1 2 3; do
    idb_dump
    # 🔴 逐字/整段命中才算"到底部标签那一层"：子串的「我的」会抓到「我的成长, 我的成长」
    #    那一行 ⇒ "退干净了"是假的，下一步按「我的」就会落到别的行上。
    # ⚠️ 这一枚判据只证**底部标签在场**，不证"人在该档的根"：第二层 section 里底部标签
    #    也在场（`App.tsx:285-293` 是 `display:none` 的面板，section 挂在面板内部），而按
    #    同一档的标签是空操作。要落到某一档/某一层的根，用 `back_to_anchor`（第 26 跑实测）。
    read -r _b_st _bx _by _blb _ben <<<"$(resolve_anchor "我的")"
    if [ "$_b_st" = "hit" ] || [ "$_b_st" = "offscreen" ]; then return 0; fi
    ax_press "关闭"
    sleep 2
  done
  return 1
}

# ── 用顶栏「返回」逐层退回画着某一枚锚点的那一层 ─────────────────────────────
# 🔴 出路只有顶栏那枚「返回」（`ShareSpaceScreen.tsx:631` 的 `backAction`，文案
#    `mobile.growth.back`=「返回」）：底部标签此刻**在树上但按了不动** —— 人已经在
#    「我的」这一档里，再按一次同一档不改 `tab`，而共享面的层级在 `ShareSpaceScreen`
#    自己的 state 里（列表 → 选中那份 → 任务详情，`backAction` 逐层 `setSelected/setCommentTask`）。
#    第 26 跑实测：沿用第 6 步的"按「我的」"5 次全空转、`where_am_i` 恒为「共享清单」。
# <到达判据（id:... 或只在目标层出现的标签）>；先量后按 ⇒ 已经在那一层上不白按。
back_to_anchor() {
  local arrive=$1 try=1
  while [ "$try" -le 4 ]; do
    if [ "${arrive#id:}" != "$arrive" ]; then
      tree_has_id "${arrive#id:}" >/dev/null 2>&1 && return 0
    else
      tree_has "$arrive" >/dev/null 2>&1 && return 0
    fi
    ax_press "返回" || echo "     [back] 第 ${try} 次没按到「返回」"
    sleep 2
    try=$((try + 1))
  done
  return 1
}

cleanup() {
  if [ -n "$OWNER_LOOP_PID" ] && kill -0 "$OWNER_LOOP_PID" >/dev/null 2>&1; then
    kill "$OWNER_LOOP_PID" >/dev/null 2>&1 || true
  fi
  if [ "$SERVER_STARTED" = "1" ]; then
    bash "$ROOT/scripts/mobile-e2e-down.sh" >/dev/null 2>&1 || true
    note "已停本趟起的服务端栈"
  fi
  # 产物按「用完即弃」：DerivedData 与本轮临时目录不进证据目录，收尾删掉。
  if [ "${HEYTA_COLLAB_IOS_KEEP_ARTIFACTS:-0}" != "1" ]; then
    [ -d "$DERIVED" ] && rm -rf -- "$DERIVED"
    case "$RUN_DIR" in
      /tmp/heyta-collab-m6-* | /var/folders/* | /private/var/folders/*) rm -rf -- "$RUN_DIR" ;;
    esac
  fi
}
# 🔴 不是裸 `trap cleanup EXIT`：那会**整条替换**掉 lib 在 source 时挂上的
# EXIT handler（里面带着 `rm -f -- "$0"` 的自快照清理），症状是"该删的没删"——
# `check:shell-exit-chain` 判的就是这个。`heyta_chain_exit` 把两条串起来（新的先跑）。
heyta_chain_exit cleanup

# ── 0. 现场：设备、AX 工具接口 ──────────────────────────────────────────────
step "0. 现场与归属（设备 / AX 工具接口）"
UDID=${IOS_UDID:-}
if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl list devices booted -j 2>/dev/null | python3 -c '
import json, sys
want = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
same = []
for _rt, devs in (data.get("devices") or {}).items():
    for d in devs:
        if d.get("state") == "Booted" and (d.get("name") or "").startswith(want):
            same.append(d.get("udid") or "")
if len(same) == 1:
    print(same[0])
' "$DEVICE_NAME" 2>/dev/null)
fi
[ -n "$UDID" ] || env_bail "认不出该验收哪台模拟器（名字前缀「${DEVICE_NAME}」的已启动设备不唯一或不存在）—— 不猜设备。显式指定：IOS_UDID=<udid> bash $0"
IDB_UDID="$UDID"
export IDB_UDID
note "设备 ${UDID}（本机已启动模拟器 $(xcrun simctl list devices booted 2>/dev/null | grep -c Booted) 台）"
# 🔴 显式给了 `IOS_UDID` 也要现量它此刻是不是 Booted。第 27 跑就是这么烧掉两分钟的：那台设备
#    在上一趟之后被关机，装置一路走到第 2 步的 `simctl install` 才撞出
#    `Unable to lookup in current state: Shutdown`（domain=com.apple.CoreSimulator.SimError 405）。
#    本线两枚脚本都**不代起设备**（起哪台要人判闲忙，见计划 §9.13 那条装机纪律），
#    所以这里只把失法说清并给出那一条命令，不替你 boot。
UDID_STATE=$(xcrun simctl list devices -j 2>/dev/null | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
for _rt, devs in (data.get("devices") or {}).items():
    for d in devs:
        if (d.get("udid") or "") == sys.argv[1]:
            print(d.get("state") or "")
            raise SystemExit(0)
raise SystemExit(1)
' "$UDID" 2>/dev/null)
[ "${UDID_STATE:-}" = "Booted" ] \
  || env_bail "设备 $UDID 当前状态=${UDID_STATE:-读不出}（不是 Booted）⇒ 先起它：xcrun simctl boot ${UDID}。本趟不判产品"

OTHER=$(another_mobile_e2e_running)
if [ -n "$OTHER" ]; then
  echo "   ❌ 有别的移动端验收正在跑（并行 = 互相拆现场 / 抢同一台设备）："
  printf '%s\n' "$OTHER" | sed 's/^/      /'
  env_bail "本趟不判产品"
fi

resolve_idb >/dev/null 2>&1 || env_bail "找不到 idb/idb_companion（装法见 scripts/lib/mobile-e2e.sh 文件头）"
for _flag in --dismiss-keyboard --type-text --scroll-into-view; do
  python3 "$SHIM" --help 2>&1 | grep -q -- "$_flag" \
    || env_bail "ios-ax-shim 不再接受 $_flag ⇒ 装置与共享 iOS 工具的接口漂了，本趟不判产品"
done
ok "iOS AX 工具接口在位"
[ -f "$ANCHOR" ] || env_bail "找不到锚点解析器 $ANCHOR ⇒ 按压通道不可信，本趟不判产品"
python3 "$ANCHOR" --selftest >/dev/null 2>&1 \
  || env_bail "锚点解析器的自检不绿（现量：python3 $ANCHOR --selftest）⇒ 每一发按压都不可信，本趟不判产品"
ok "锚点解析器自检通过（12 条，含一条对照臂：把命中规则换成子串，自检必须红）"

# ── 1. 服务端栈（私有端口 + 私有库 + 私有 pidfile） ─────────────────────────
step "1. 起本趟专属服务端栈（TEST_MODE，零 mock）"
PATH="/opt/homebrew/bin:$PATH"
pg_isready >/dev/null 2>&1 || env_bail "本机 Postgres 没在跑（pg_isready 不通）—— 这条旅程零 mock，起不了服务端就不成立"
if ! psql -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$E2E_DB"; then
  note "库 $E2E_DB 不存在 —— 建库并只走 migrate-deploy.sh（不许直接 prisma migrate deploy）"
  createdb "$E2E_DB" || env_bail "createdb $E2E_DB 失败"
  (cd "$ROOT/server" && DATABASE_URL="postgresql://${USER}@127.0.0.1:5432/${E2E_DB}" sh scripts/migrate-deploy.sh) \
    > "$RUN_DIR/migrate.log" 2>&1 || env_bail "迁移失败，读数在 $RUN_DIR/migrate.log"
  ok "库就位并已迁移"
else
  ok "库已在（复用本线的私有库；每轮仍换新账号）"
fi
PORT="$PORT" HEYTA_E2E_DB="$E2E_DB" bash "$ROOT/scripts/mobile-e2e-up.sh" > "$RUN_DIR/up.log" 2>&1 \
  || env_bail "起栈失败：$(tail -3 "$RUN_DIR/up.log" | tr '\n' ' ')"
SERVER_STARTED=1
ok "服务端在 ${HOST_SERVER}（pid $(cat "$HEYTA_E2E_PIDFILE")）"
curl -sf --noproxy '*' -m 4 "$HOST_SERVER/health" >/dev/null 2>&1 || env_bail "健康检查不通：$HOST_SERVER/health"

# ── 2. 当前源码 Release 构建、安装、新鲜度对账 ──────────────────────────────
step "2. 当前源码 Release 构建 + 安装（产物住临时目录，不进证据目录）"
# 🔴 装进 bundle 的是各 workspace 包的 **`dist`**，不是 `src`。现量（2026-10-25）：
#    移动端 `dependencies` 里那 13 枚 `@heyta/*` 的 `main`/`exports["."]` 全部指向 `./dist/…`
#    （`@heyta/i18n`、`@heyta/ui` 都在内），metro 照 `package.json` 解析 ⇒ **改了 src 不构建，
#    装机的就是旧产物**。第 28 跑撞上的正是这一格：改了 `packages/i18n/src/locales/*.ts`
#    直接构建，屏幕上还是旧句子 —— 而 L1 的到达判据锚在 `testID` 上，这一格**静默通过**。
#    （同族另一头是环境陷阱 #565：`apps/web` 的 jsdom 用例也吃 `dist`。）
STALE_PKGS=$(python3 - "$ROOT" <<'PY'
import json, os, sys
root = sys.argv[1]
pkg = json.load(open(os.path.join(root, 'apps/mobile/package.json'), encoding='utf-8'))
names = sorted({n for sec in ('dependencies', 'devDependencies')
                for n in (pkg.get(sec) or {}) if n.startswith('@heyta/')})
def newest(d):
    best = 0.0
    for base, dirs, files in os.walk(d):
        dirs[:] = [x for x in dirs if x != 'node_modules']
        for f in files:
            try:
                best = max(best, os.stat(os.path.join(base, f)).st_mtime)
            except OSError:
                pass
    return best
stale = []
for n in names:
    p = os.path.join(root, 'packages', n.split('/', 1)[1])
    s, d = os.path.join(p, 'src'), os.path.join(p, 'dist')
    if os.path.isdir(s) and os.path.isdir(d) and newest(s) > newest(d):
        stale.append(n)
print(' '.join(stale))
PY
)
if [ -n "${STALE_PKGS:-}" ]; then
  _filters=''
  for _p in $STALE_PKGS; do _filters="$_filters --filter $_p"; done
  env_bail "这些被移动端依赖的包 src 比 dist 新 ⇒ 装进 bundle 的会是旧产物（不是产品坏）：${STALE_PKGS}。先跑：pnpm $_filters build"
fi
rm -f -- "$DERIVED/Build/Products/Release-iphonesimulator/Heyta.app/main.jsbundle"
xcodebuild -workspace "$ROOT/apps/mobile/ios/Heyta.xcworkspace" -scheme Heyta \
  -configuration Release -sdk iphonesimulator -destination "id=$UDID" \
  -derivedDataPath "$DERIVED" build > "$BUILD_LOG" 2>&1 \
  || { tail -25 "$BUILD_LOG" >&2; env_bail "Release 构建失败（${BUILD_LOG}）"; }
APP="$DERIVED/Build/Products/Release-iphonesimulator/Heyta.app"
[ -d "$APP" ] || env_bail "找不到 Release 产物：$APP"
xcrun simctl uninstall "$UDID" "$BID" >/dev/null 2>&1 || true
xcrun simctl install "$UDID" "$APP" || env_bail "simctl install 失败（${APP} @ ${UDID}）"
ok "已装当前 Release 包（先卸再装 = 全新态）"
INSTALLED="$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null)"
BUILT_SHA="$(shasum -a 256 "$APP/main.jsbundle" 2>/dev/null | awk '{print $1}')"
INST_SHA="$(shasum -a 256 "$INSTALLED/main.jsbundle" 2>/dev/null | awk '{print $1}')"
{ [ -n "$BUILT_SHA" ] && [ "$BUILT_SHA" = "$INST_SHA" ]; } \
  || env_bail "已安装的 main.jsbundle 与本轮构建产物 hash 不一致（built=${BUILT_SHA:0:12} installed=${INST_SHA:0:12}）"
printf '%s\n' "$BUILT_SHA" > "$EVIDENCE/bundle-sha256.txt"
ok "安装的 bundle 与本轮构建逐字节相同（hash 对账，不看 mtime）"

# ── 3. 两个账号 ─────────────────────────────────────────────────────────────
step "3. owner（服务端那台设备）+ 手机用的 member —— 每轮换号"
note "MAX_VECTOR_CLOCK_SIZE=20：复用老号会让每条 op 判 CONFLICT_CONCURRENT"
OWNER_EMAIL="collab-owner-${STAMP}@example.test"
OWNER_RESP=$(curl -s --noproxy '*' -X POST "$HOST_SERVER/api/test/create-user" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${OWNER_EMAIL}\",\"password\":\"collab-verify-password\"}")
OWNER_TOKEN=$(printf '%s' "$OWNER_RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
[ -n "$OWNER_TOKEN" ] || env_bail "owner 建号失败：$(printf '%s' "$OWNER_RESP" | head -c 160)"
printf '%s' "$OWNER_TOKEN" > "$OWNER_TOKEN_FILE"
ok "owner 就位：$OWNER_EMAIL"
# 🔴 覆盖 `HEYTA_E2E_SERVER` 而不是 `SERVER`：helper 里那句默认值在 **source 时**就展开定死了。
HEYTA_E2E_SERVER="$HOST_SERVER" heyta_e2e_fresh_account \
  || env_bail "member 建号失败（服务端 TEST_MODE？端口对到了吗？）"
MEMBER_EMAIL="$(cat "$HEYTA_E2E_EMAIL_FILE")"
E2EE_PASS="$(cat "$HEYTA_E2E_E2EE_FILE")"
# 🔴 登录密码**从唯一事实源现读**，不在本文件里抄一份字面量：
#    `scripts/lib/mobile-e2e-fresh-account.sh` 里那枚 `password="…"` 常量。
MEMBER_LOGIN_PASSWORD=$(sed -n 's/^[[:space:]]*password="\([^"]*\)".*/\1/p' "$ROOT/scripts/lib/mobile-e2e-fresh-account.sh" | head -1)
[ -n "$MEMBER_LOGIN_PASSWORD" ] || env_bail "从 lib 里读不到那枚登录密码常量 ⇒ 不猜密码，本趟作废"
ok "手机账号就位：$MEMBER_EMAIL"

# ── 4. 起 App、处置首启、把凭据填进设置面 ───────────────────────────────────
step "4. 起 App → 处置首启屏 → 登录并启用同步（手机成为已登录、口令在内存里的设备）"
ensure_idb_companion || env_bail "idb companion 起不来"
xcrun simctl launch "$UDID" "$BID" --terminate-running-process >/dev/null 2>&1 \
  || xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1 \
  || env_bail "App 起不来（$BID @ $UDID）"
sleep 8
for _screen in "同意并联网" "先离线使用"; do
  idb_dump
  if tree_has "$_screen"; then
    ax_press "$_screen"
    sleep 3
    note "已处置首启屏「${_screen}」"
  else
    note "首启没有「${_screen}」这一屏"
  fi
done
dismiss_ios_save_password || true
if ! wait_tree "任务" 30; then
  shot "00-没到主屏"
  env_bail "处置完首启屏仍读不到底部「任务」标签 —— 界面没到主屏，后面的填写都不可信"
fi
ok "已到主界面"
shot "01-主界面"

# 🔴 这台手机要成为**已登录**的设备，走的是同族装置（`verify-mobile-ios-account-email-sessions.sh`
#    的 `sign_in_with_password`）实测出来的那条规定路径，不是"往设置面手抄令牌"：
#    自托管表单里那颗账号按钮（`SettingsScreen.tsx:570` 的 `openAuth(true)`）→ AuthScreen
#    （只有它带「服务器地址」那一栏）→ 地址 + 邮箱 + 登录密码 →「用邮箱和密码登录」
#    → 会话卡「已登录」**之后**才有「加密口令」那一栏 → 填口令 →「保存并启用同步」。
#    2026-10-24 设备腿实测：在**没有登录态**的自托管表单里把口令填进去（框里画出 20 个掩码点、
#    `--type-text` 回 rc=0），应用自己那句「还没设置端到端加密口令，同步已停止」纹丝不动
#    ⇒ 那条路拿不到能解开共享信封的口令，L2/L5 全都不成立。
if open_settings_sheet; then
  ok "自托管表单已打开（「服务器地址」输入框可见）"
else
  shot "02-自托管表单没开"
  env_bail "走不到「同步与隐私 → 使用自托管服务器」那张表单 ⇒ 登录入口没有载体"
fi

# 进 AuthScreen：那颗按钮按 `form.configured` 换文案（未配置=「注册 / 登录」，已有凭据=「切换账号」），
# 两代都够得着；两枚都不在树上就退 3，**不猜入口**。
if tree_has "注册 / 登录"; then
  ax_press "注册 / 登录"
elif tree_has "切换账号"; then
  ax_press "切换账号"
else
  shot "02b-没有登录入口"
  env_bail "自托管表单上既没有「注册 / 登录」也没有「切换账号」⇒ 进不去带服务器地址栏的 AuthScreen"
fi
sleep 3
idb_dump
# 🔴 全新设备上 AuthScreen 默认**不**在邮箱/密码那张表上：`AuthScreen.tsx:226` 的
#    `centralMode = isOfficialCentralAuthEndpoint(serverUrl)` 为真时，`:751` 那个 `!centralMode`
#    整段（含「邮箱」「服务器地址」两栏）根本不渲染。2026-10-25 第 8 跑截图现量到的是这一档的
#    三件：条款勾选框 +「使用统一身份登录」+「使用自建服务端」，而标题「注册 / 登录」照旧在树上
#    ⇒ 拿"有没有标题"当"落在哪一屏"会读成假成功，拿"有没有邮箱框"当"没落在 AuthScreen"会读成假归因。
#    这一趟要连自建服务端 ⇒ 按 `:1058` 那颗切换（`allowServerSelection && session === undefined`
#    才渲染，正是从自托管表单进来的那一代）：它把 serverUrl 打回空串 ⇒ centralMode 转假 ⇒ 表单出现。
if [ "$(field_count "邮箱")" != "1" ]; then
  if tree_has "使用自建服务端"; then
    note "落在「统一身份登录」那一档 ⇒ 按「使用自建服务端」切到自建表单那一代"
    ax_press "使用自建服务端" || { shot "02c2-切不到自建档"; env_bail "「使用自建服务端」在树上却按不动（装置问题）"; }
    sleep 2.5
    idb_dump
  fi
fi
if [ "$(field_count "邮箱")" != "1" ]; then
  shot "02c-没落在AuthScreen"
  env_bail "按完入口（含切档那一发）之后「邮箱」输入框不是恰好 1 枚（实读 $(field_count "邮箱")，-1=树读不出）⇒ 不在能填自建凭据的那张表上，后面的填写都不作数"
fi
# 注册那张表与登录那张表共用邮箱/密码两栏，**填错那张 = 拿本轮账号去注册**（服务端会回具名错误，
# 但这一腿要的是登录态）。判据是注册独有的两件，存在性读；命中就按模式切换那一行，切完回读。
if tree_has "再次输入密码" || tree_has "发送验证码"; then
  note "数到注册那张表的独有件 ⇒ 按「已经有账号了？直接登录」切到登录那一代"
  ax_press "已经有账号了？直接登录" || { shot "02c3-切不到登录代"; env_bail "模式切换那一行在树上却按不动（装置问题）"; }
  sleep 2
  idb_dump
  if tree_has "再次输入密码"; then
    shot "02c4-仍是注册那张表"
    env_bail "按了模式切换之后「再次输入密码」还在 ⇒ 代没切过去，不拿注册那张表填密码"
  fi
fi
if ! tree_has "服务器地址"; then
  shot "02d-没有服务器地址栏"
  env_bail "AuthScreen 上没有「服务器地址」那一栏（`allowServerSelection` 为假）⇒ 这一趟没法把登录指向本轮服务端"
fi
if ! tree_has "用邮箱和密码登录"; then
  shot "02d2-数不到登录那颗按钮"
  env_bail "树上数不到「用邮箱和密码登录」⇒ 不能确认落在**登录**那一代，不往下填"
fi
ok "已到 AuthScreen 的登录那一代（「邮箱」「服务器地址」两栏 +「用邮箱和密码登录」都在）"

fill_field "服务器地址" "$HOST_SERVER" || env_bail "AuthScreen 的服务器地址写不进去（装置问题）"
fill_field "邮箱" "$MEMBER_EMAIL" || env_bail "邮箱写不进去（装置问题）"
# 登录密码那一栏是明文档还是遮住档**量出来的**（移动端默认揭示），两档各有填法；
# 两枚显隐开关都不在树上 ⇒ 判不了该走哪条腿，退 3，不猜。
if tree_has "隐藏密码"; then
  note "显隐开关此刻写「隐藏密码」⇒ 登录密码是明文档，按普通框填（回读逐字相同）"
  fill_field "登录密码" "$MEMBER_LOGIN_PASSWORD" || env_bail "登录密码写不进去（装置问题）"
elif tree_has "显示密码"; then
  note "显隐开关此刻写「显示密码」⇒ 登录密码是遮住档，按 secure 框填（掩码码点回读）"
  fill_field "登录密码" "$MEMBER_LOGIN_PASSWORD" secure || env_bail "登录密码写不进去（装置问题）"
else
  shot "02e-判不了密码档"
  env_bail "两枚显隐开关都不在树上 ⇒ 判不了「登录密码」该走哪一条填写腿，不猜"
fi
dismiss_ios_save_password || true
ax_press "用邮箱和密码登录"
signed=0
for _i in $(seq 1 30); do
  sleep 2
  idb_dump
  if tree_has "已登录"; then signed=1; break; fi
  # 「保存密码？」是**提交之后**才弹的，它会盖住整屏 ⇒ 每 5 次采样摘一遍再读。
  if [ "$((_i % 5))" = 0 ]; then
    dismiss_ios_save_password || true
    idb_dump
    if tree_has "已登录"; then signed=1; break; fi
  fi
done
if [ "$signed" != "1" ]; then
  shot "02f-登录没成"
  env_bail "30×2s 内没出现会话卡「已登录」⇒ 登录这一发没成，后面的口令那一栏根本不存在"
fi
ok "登录成功（会话卡「已登录」在）"

# ── 加密口令 + 保存并启用同步（🔴 登录之后这一栏才存在）─────────────────────
idb_dump
_fc=$(field_count "加密口令")
if [ "$_fc" != "1" ]; then
  shot "02f2-加密口令栏数不对"
  env_bail "树上标签含「加密口令」的输入框数到 ${_fc} 枚（期望恰好 1，-1=树读不出）⇒ 不猜往哪一格写"
fi
fill_field "加密口令" "$E2EE_PASS" secure || env_bail "加密口令写不进去（装置问题）"
dismiss_ios_save_password || true
dismiss_keyboard
ax_press "保存并启用同步"
left=0
for _i in $(seq 1 20); do
  sleep 2
  idb_dump
  # 🔴 `tree_has` 的第三档（rc=2 = 这一棵树根本读不出）**不许**被读成「按钮已经没了」：
  #    那一档下"减法断言"是恒真的（§7 元规则一）。同族装置 `needle_state` 三分档同理。
  tree_has "保存并启用同步" >/dev/null 2>&1; _rc=$?
  if [ "$_rc" = "1" ]; then left=1; break; fi
  [ "$_rc" = "2" ] && echo "     [save] 第 ${_i} 次树读不出（不拿它当「这一栏已经没了」）"
done
if [ "$left" != "1" ]; then
  shot "02g-同步没启用"
  env_bail "40×2s 之后「保存并启用同步」还在（或树一直读不出）⇒ AuthScreen 没退出，这次登录没落成活配置"
fi
ok "「保存并启用同步」按掉且这一栏已从树上消失（AuthScreen 已退出）"
# 🔴 这张图的名字承诺的是"已登录并启用同步"，那就得拍到那一件事。iOS 的「保存密码？」
#    是**提交之后**才弹的（上面那次收是收不到它的），第 24 跑肉眼复核这张图时它正盖着整屏
#    —— 判据（AuthScreen 退出）是读 AX 读到的，图却画着另一件事，等于一张会误导人的证据。
dismiss_ios_save_password || true
sleep 1
shot "02-已登录并启用同步"

dismiss_ios_save_password || true
back_to_tabs || { shot "03b-退不到主标签层"; env_bail "填完凭据退不回底部标签那一层（装置问题）"; }
# 口令这一档的**判据**在 L1/L2（加入共享要把清单密钥解出来）。这里只取一句界面读数当**归因证据**，
# 为什么不拿它判红：见下面 `BANNER_AT_LOGIN` 那一段（同一条码覆盖两种坏，读源码定的）。
idb_dump
tree_has "还没设置端到端加密口令" >/dev/null 2>&1; _rc=$?
# 🔴 这一句**不当终判，只留证**。两条理由，都是读源码定的：
#    ① 它不是配置谓词，是**上一次同步的错误读数**：`common.sync.error.noPassword` 由
#      `packages/ui/src/sync/model.ts:262` 从同步码 `no-encryption-password` 映射来。
#    ② 那个码**两种坏同形**：`packages/sync-client/src/client.ts:800` 的 catch（安全存储／
#      口令包校验抛错）与 `:802` 的 `payloadCipher === undefined`（真的没口令）打的是同一个码。
#    ⇒ 拿它判红会把两种不同的坏说成同一件，而这一趟真正要证的"口令可用"由 L1/L2 判：
#      加入共享要把清单密钥解出来，口令不在状态里那一步必然过不去。
#    2026-10-25 第 10/11 跑实测：登录成功、口令栏填入 20 掩码码点、AuthScreen 已退出，
#    这句仍在；手动点「立即同步」再等 60s 也仍在 —— 但那仍然分不清①②，故降级为诊断。
BANNER_AT_LOGIN=''
case "$_rc" in
  0) BANNER_AT_LOGIN=present
     shot "03c-登录后仍报未设置口令"
     note "登录后那句红字在册 ⇒ 留作 L1/L2 失败时的归因证据（它本身不判红，理由见上面那段）" ;;
  1) BANNER_AT_LOGIN=absent
     ok "登录后界面没有报「还没设置端到端加密口令」" ;;
  *) shot "03c2-树读不出"
     env_bail "登录后这一棵树读不出（rc=2）⇒ 连那句在不在都判不了，先修探针再谈产品" ;;
esac

# ── 4b. 创建「加密数据钥匙」——同步那侧真正要读的钥匙 ─────────────────────────
# 🔴 这一步是读源码定出来的，不是猜的：
#    `host.ts:609` 的 `getPayloadCipher` 走的是 `readVaultSession()`，
#    **不是** `readSyncConfig().password`；而 vault 会话由 `SettingsScreen.tsx:724`
#    挂的 `VaultSettingsSection` 那一屏创建/解锁（`beginCreation(passphrase)` →
#    「确认并发布」→ 已解锁）。⇒ 只在 AuthScreen 填口令**不会**让同步拿到可用密文。
#    2026-10-25 第 10/11 跑实测正是这个形状：登录成功、AuthScreen 正常退出、
#    口令栏 20 掩码码点，但「还没设置端到端加密口令」在手动「立即同步」之后仍在。
step "4b. 创建加密数据钥匙（设置 → 账号安全 → 创建钥匙 → 确认并发布）"
dismiss_ios_save_password || true
ax_press_until "设置" "账号安全" || { shot "04-进不去账号安全"; env_bail "设置枢纽里到不了「账号安全」⇒ 走不到「加密数据钥匙」那一屏（装置问题）"; }
ax_press_until "账号安全" "加密数据钥匙" || { shot "04b-没有保险库那一屏"; env_bail "「账号安全」那一屏读不到「加密数据钥匙」⇒ 这一代界面把它挪走了，装置跟着挪，不猜"; }
idb_dump
if tree_has "创建加密数据钥匙"; then
  note "落在「创建加密数据钥匙」那一态（这台设备还没有 keyPackage）⇒ 建一把"
  _fc=$(field_count "加密口令")
  [ "$_fc" = "1" ] || { shot "04c-口令栏数不对"; env_bail "保险库那一屏标签含「加密口令」的输入框数到 ${_fc} 枚（期望恰好 1，-1=树读不出）⇒ 不猜往哪一格写"; }
  fill_field "加密口令" "$E2EE_PASS" secure probe "创建钥匙" || env_bail "保险库的加密口令写不进去（含「创建钥匙」一直 disabled = 打字没进 RN 状态）"
  dismiss_ios_save_password || true
  dismiss_keyboard
  ax_press "创建钥匙"
  # 预算 300s 不是拍脑袋：这一发要的就是"真机耗时实测"那个数（读数落在 WAITED 里，
  # 会原样打进日志）。跑这台机同时挂着 6 台模拟器，所以更要量出来而不是估。
  if ! wait_state "创建钥匙" 300 "确认并发布" "这台设备上的加密数据已经解锁"; then
    shot "04d-按创建钥匙后没到终态"
    if [ "$WAIT_LAST_RC" = "2" ]; then
      env_bail "按「创建钥匙」后 ${WAITED}s 里最后一棵树读不出（rc=2）⇒ 装置判不了，不拿它当产品坏了"
    elif [ "$WAIT_SAW_BUSY" = "1" ]; then
      bad "按下了（按钮变灰过 = busy=true = onPress 落上了）但 ${WAITED}s 内既没到「确认并发布」也没到「已解锁」⇒ beginCreation 抛错，或 Argon2 慢过 ${WAITED}s 预算"
      summary
      exit 1
    else
      env_bail "${WAITED}s 内「创建钥匙」从没变灰过 ⇒ onPress 没落上（RN 按压抖动 = 装置问题，不是产品问题）"
    fi
  fi
  ok "按「创建钥匙」后 ${WAITED}s 到终态「${WAIT_HIT}」（按钮变灰过=${WAIT_SAW_BUSY}）⇒ 这一发的 Argon2 实测耗时=${WAITED}s"
  if tree_has "确认并发布"; then
    # 🔴 待发布那一屏**不是**按一下就过：它把恢复码画出来，要求**照着输一遍**才放行
    #    （`VaultSettingsSection.tsx:463-470` 那枚 `mobile.vault.recoveryConfirm` 输入框，
    #    按钮条件是 `busy || pendingCode.length === 0`）。2026-10-25 第 15 跑实测：
    #    空着按 ⇒ 按不动，等 180 秒也不会到已解锁。⇒ 先读码、再填、再按。
    note "到了待发布那一态（beginCreation 成了）⇒ 这一屏要照着把恢复码输回去"
    SECRET_FRAMES=1
    RC=$(recovery_code_from_tree)
    case "$RC" in
      __unreadable__)
        shot "04g-恢复码那棵树读不出"
        env_bail "待发布那一屏的树读不出 ⇒ 拿不到恢复码，走不下去（装置不猜码）" ;;
      __count:0__)
        shot "04h-数不到恢复码"
        env_bail "待发布那一屏没读到 40 位恢复码（字母表与长度钉在 key-lifecycle.ts:29-31）⇒ 界面换了形状，装置跟着改，不猜" ;;
      __count:*)
        shot "04i-恢复码数出多枚"
        env_bail "待发布那一屏数出 ${RC#__count:} 枚候选码 ⇒ 不知道抄哪一枚，不猜" ;;
      *)
        ok "从界面上读出这一趟的恢复码（${#RC} 位；值不落日志、不进证据目录）" ;;
    esac
    _fc=$(field_count "输入恢复码以确认")
    [ "$_fc" = "1" ] || { shot "04j-恢复码确认栏数不对"; env_bail "确认栏数到 ${_fc} 枚（期望恰好 1，-1=树读不出）⇒ 不猜往哪一格写"; }
    fill_field "输入恢复码以确认" "$RC" || { SECRET_FRAMES=0; env_bail "恢复码写不进确认栏"; }
    dismiss_keyboard
    ax_press "确认并发布"
    if ! wait_state "确认并发布" 240 "这台设备上的加密数据已经解锁"; then
      shot "04d3-确认并发布后没解锁"
      SECRET_FRAMES=0
      bad "「确认并发布」按下去 ${WAITED}s 后仍没到已解锁态（按钮变灰过=${WAIT_SAW_BUSY}，最后一次树读数 rc=${WAIT_LAST_RC}）⇒ 同步拿不到可用密文"
      summary
      exit 1
    fi
    SECRET_FRAMES=0
    ok "恢复码已照抄、待发布已确认（这一步又用了 ${WAITED}s）"
  fi
  # 再扫一遍终态：既是兜底复判，也把这条文案留在 check:verify-script-copy 的扫描面上
  if ! tree_has "这台设备上的加密数据已经解锁"; then
    shot "04d4-复扫没读到已解锁"
    bad "等待过程中读到过终态，复扫却没有「这台设备上的加密数据已经解锁。」⇒ 界面自己退回了，这一趟的读数不可信"
    summary
    exit 1
  fi
  ok "加密数据钥匙已建好并且这台设备上是解锁态 ⇒ 同步与共享信封有可用密文"
  shot "04e-保险库已解锁"
elif tree_has "这台设备上的加密数据已经解锁"; then
  bad "全新安装的设备上保险库已经是解锁态 ⇒ 现场没清干净，这一趟的归属不可信（先查是不是复用了别人的容器）"
  summary
  exit 1
else
  shot "04f-保险库那一屏两态都不是"
  env_bail "「加密数据钥匙」那一屏既没有「创建加密数据钥匙」也没有「已经解锁」⇒ 这一代还有第三种态，装置不猜"
fi

# ── 5. owner 建共享 + 发邀请 + 种一条任务 ───────────────────────────────────
step "5. owner 侧：建共享、发邀请、写一条任务（下行要有东西可看）"
TASK_TITLE="owner取证任务${STAMP}"
node "$ROOT/scripts/lib/collab-owner-step.mjs" init \
  --base-url "$HOST_SERVER" --owner-token "$OWNER_TOKEN" \
  --invited-email "$MEMBER_EMAIL" --state "$OWNER_STATE" > "$RUN_DIR/init.json" 2> "$RUN_DIR/init.err" \
  || { sed 's/^/      /' "$RUN_DIR/init.err" >&2; env_bail "owner init 失败"; }
SHARE_ID=$(python3 -c 'import json;print(json.load(open("'"$RUN_DIR"'/init.json"))["shareId"])')
OWNER_MEMBER=$(python3 -c 'import json;print(json.load(open("'"$RUN_DIR"'/init.json"))["ownerMemberId"])')
INVITE_TOKEN=$(python3 -c 'import json;print(json.load(open("'"$RUN_DIR"'/init.json"))["invitationToken"])')
ok "share=$SHARE_ID；邀请凭证已签发（只在这一次响应里）；owner 签名公钥已在册"
node "$ROOT/scripts/lib/collab-owner-step.mjs" add-task --state "$OWNER_STATE" --title "$TASK_TITLE" \
  > "$RUN_DIR/task.json" 2> "$RUN_DIR/task.err" \
  || { sed 's/^/      /' "$RUN_DIR/task.err" >&2; env_bail "owner 写任务失败"; }
ok "owner 写了一条任务：$TASK_TITLE"

# ── 6. 手机加入：贴凭证 → 同意 → 等界面自己说成功 ────────────────────────────
step "6. 加入判据（L1）：手机走自己的界面加入这份共享"
dismiss_ios_save_password || true
# 🔴 先退回主标签层再按「我的」：4b 结束时人还停在「账号安全」那一屏
#    （`SettingsScreen.tsx:724` 把 `VaultSettingsSection` 挂在全屏 section 里），
#    底部标签根本不在树上 —— 第 7 步早就有这一发，第 6 步是漏的。
back_to_tabs || { shot "06a-退不到主标签层"; env_bail "创建完钥匙后退不回底部标签那一层（装置问题，不判产品）"; }
if ! ax_press_until "我的" "id:profile-entry-share"; then
  shot "06-我的页没有共享入口"
  # 实测过的两种失法：① iOS「保存密码？」那枚系统弹窗压住整棵 App 树（读什么都不是）；
  # ② 入口的渲染条件 `syncConfigured` 没成立（凭据没被认下）。P-1 翻案之后**没有**
  # 实验开关这一档了（`check:share-entry-visible` 反过来钉"不许再藏"），别再往那猜。
  bad "「我的」页上读不到共享清单入口（要么系统弹窗压着树，要么 syncConfigured 没成立）；口令那句读数=$BANNER_AT_LOGIN"
  summary
  exit 1
fi
if ! ax_press_until "id:profile-entry-share" "加入共享清单"; then
  shot "06b-共享首页没有加入入口"
  bad "共享面上没有「加入共享清单」入口"
  summary
  exit 1
fi
shot "06c-共享清单首页"
# 🔴 落点判据不许用「邀请凭证或链接」：那一屏的**副标题**写着「粘贴邀请凭证或链接。…」，
#    两档相位都画它 ⇒ 拿它当到达判据会在同意面上就假命中（2026-10-25 第 18 跑实测：
#    到达判据过了、`fill` 却五次 found=False）。用只有输入相位才画的清单名那一行。
if ! ax_press_until "加入共享清单" "确认共享" exact "清单名称（仅本机显示）"; then
  shot "06b2-加入面板没开"
  bad "按不进「加入共享清单」那面板（按了 5 次也没读到同意面或凭证输入）"
  summary
  exit 1
fi
if [ "$PRESS_HIT" = "确认共享" ]; then
  # 这台设备从没确认过 PIPL 同意 ⇒ `JoinShareScreen` 的初始 phase 停在同意面（fail-closed，
  # 判断在 `@heyta/ui` 的 `shouldShowConsent`）。这一档**不是**装置绕路，是产品要求的那道闸：
  # 本趟每一轮都先 `simctl uninstall`，同意态跟着沙盒一起清掉 ⇒ 同意面每轮都会在场。
  shot "06b3-入群同意面"
  if ! ax_press_until "确认共享" "清单名称（仅本机显示）" exact; then
    shot "06b4-按同意后没到凭证框"
    env_bail "按了「确认共享」却没走到凭证输入（装置问题，不判产品）"
  fi
  note "入群同意闸按过 ⇒ 这台设备有了同意记录（通知路径读的就是它）"
fi
# 🔴 从这一行起，屏幕上画着**当趟那枚一次性邀请凭证**（明文就在输入框里）⇒ 与恢复码同一档：
#    帧只落私有 RUN_DIR，不进证据目录。代价是实测出来的：这一帧曾以 `06e-已贴凭证.png`
#    进了证据目录，被并行会话按目录扫证据时顺手提交并推到公开远端
#    （`git log --oneline -- apps/mobile/evidence/collab-ios-*/06e-*.png` 现量）。
#    而"凭证进了框"这条判据本来不需要像素 —— 读界面值命中即可，值不落日志。
SECRET_FRAMES=1
fill_field "邀请凭证或链接" "$INVITE_TOKEN" || { shot "06d-凭证填不进"; env_bail "邀请凭证填不进输入框（装置问题）"; }
if tree_has "$INVITE_TOKEN" >/dev/null 2>&1; then
  ok "凭证已进输入框（按界面值命中，长度 ${#INVITE_TOKEN}；值不落日志、这一帧不进证据目录）"
else
  # 这一发的**值本身**不许进日志，但它"有没有长度"可以说 ⇒ 打下那一枚输入框的码点数，
  # 把"框是空的"与"探针没读到"分开（第 24 跑栽的就是后者，当时只留下一句"读不到"）。
  idb_dump
  python3 - "$IDB_DUMP_FILE" <<'PY' 2>/dev/null
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print("     [fill] 快照读不出（rc=2 那一档，不拿它当「框是空的」）"); sys.exit(0)
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
for top in (data if isinstance(data, list) else [data]):
    for n in walk(top):
        if (n.get("AXUniqueId") or "") == "share-join-token":
            v = n.get("AXValue")
            print(f"     [fill] share-join-token：role={n.get('role')} AXValue 码点数={0 if v is None else len(str(v))}")
            sys.exit(0)
print("     [fill] 这棵树上没有 share-join-token 这枚节点 ⇒ 已经离开凭证那一屏")
PY
  shot "06e-凭证没进框"
  env_bail "fill 说成功但树里读不到那一串 ⇒ 装置判不了，不拿它当产品坏了"
fi
shot "06e-已贴凭证"
SECRET_FRAMES=0
# 🔴 清单名那一格**故意填一个带当趟戳的名字**，不留在空着时的默认值上：空着 ⇒ 本机那一行的名字
#    就是词表默认值「共享清单」（`JoinShareScreen.tsx:121` 走 `web.share.join.defaultName`），
#    而第 10a 步那句正文里插的也是同一串 ⇒ 两半同形，读不出"名字是从本机行上来的"还是
#    "句子里写死了一份"（#581 那一族）。填了戳，第 10a 步才拿得出"行名 == 这里填的名"这道对照。
JOIN_LIST_NAME="本机清单${STAMP}"
fill_field "id:share-join-name" "$JOIN_LIST_NAME" \
  || { shot "06f-清单名填不进"; env_bail "清单名输入框填不进（装置问题，不判产品）"; }
ax_press "加入"
sleep 3
idb_dump
# owner 侧在后台等成员行出现并把清单密钥封给它 —— 手机界面会停在
# 「已入群。正在等待所有者分发密钥」直到这一步真的发生。
(
  node "$ROOT/scripts/lib/collab-owner-step.mjs" wait-member --state "$OWNER_STATE" --timeout 150 \
    > "$RUN_DIR/member.json" 2> "$RUN_DIR/member.err" \
    && node "$ROOT/scripts/lib/collab-owner-step.mjs" deliver --state "$OWNER_STATE" \
      > "$RUN_DIR/deliver.json" 2> "$RUN_DIR/deliver.err"
) &
OWNER_LOOP_PID=$!
# 🔴 到达判据锚在 `share-join-close-final` 这枚 `testID`（= RN 的 `testID` → `AXUniqueId`）上，
#    不锚在整句文案上：那一相位有独占节点，而句子是产品文案 —— 第八批肉眼复核时它按平台
#    改过（「侧栏」是 web 外壳那一格的名字，手机上画的是「已共享的清单」）。拿整句当判据
#    等于把装置和文案绑死：改一个字就要重烧一趟稀缺的设备窗口。
# 🔴 **锚点必须挂在可交互节点上**（`Button`/`Pressable`/`TextInput`），不能挂在 `Text` 上。
#    第 29 跑就是这么红的：那句成功文案由 `<Text testID="share-join-done">` 画，界面上明明
#    写着「加入成功」（`06f-加入没走到成功态.png` 拍到了），而 `describe-all` 里那枚节点是
#    `AXStaticText`、**没有 `AXUniqueId`** —— RN 只给可访问元素（按钮那类）落 `accessibilityIdentifier`。
#    于是产品绿、装置红。这一相位的独占可访问节点就是同屏那枚「关闭」（`JoinShareScreen`
#    只有走到 done 分支才画它），拿它当到达判据；那句文案留给肉眼复核截图。
if ! wait_tree_id "share-join-close-final" 240; then
  idb_dump
  shot "06f-加入没走到成功态"
  for probe in "已入群。正在等待所有者分发密钥" "邀请凭证无效或已被使用。" "共享密钥已加密保存，解锁保险库后即可继续。"; do
    tree_has "$probe" && note "界面停在：$probe"
  done
  bad "手机上没有走到「加入成功」那一句；口令那句读数=$BANNER_AT_LOGIN（present=同步那侧报过取不到可用口令）"
  summary
  exit 1
fi
ok "手机自己说了「加入成功」"
shot "06g-加入成功"
# 🔴 回执必须**按得掉**：这一屏只有「关闭」一枚出口（第 25 跑之前它根本不出现 ——
#    入群成功的同一拍宿主就把屏幕换掉了，那句成功文案一帧都没画过，装置等满 240s 报红）。
#    按完之后回到共享主屏，第 7 步从那里接着走。
ax_press "关闭" || { shot "06h-成功回执退不出去"; bad "「加入成功」那一屏没有按得动的「关闭」⇒ 用户被卡在回执上"; summary; exit 1; }
sleep 2
wait "$OWNER_LOOP_PID" 2>/dev/null || {
  sed 's/^/      /' "$RUN_DIR/member.err" "$RUN_DIR/deliver.err" >&2 2>/dev/null
  env_bail "owner 侧等成员行/封信封失败"
}
OWNER_LOOP_PID=''
[ -s "$RUN_DIR/member.err" ] && sed 's/^/      /' "$RUN_DIR/member.err"
PHONE_MEMBER=$(python3 -c 'import json;print(json.load(open("'"$RUN_DIR"'/member.json"))["memberId"])' 2>/dev/null)
[ -n "$PHONE_MEMBER" ] || env_bail "读不到手机那一行成员 id"
ok "服务端看到手机那一行成员 $PHONE_MEMBER，清单密钥已封给它"

# ── 7. 下行：owner 写的那条任务，手机不点同步就要看得见 ─────────────────────
step "7. 下行判据（L2）：手机界面出现 owner 写的那条任务"
# 🔴 第 6 步末尾按「关闭」回到的是**共享主屏**（入群回执不再顺手把整块 section 关掉，
#    与 web 同形）⇒ 人在「我的」这一档的第二层里，按底部标签是空操作。
back_to_anchor "id:profile-entry-share" \
  || { shot "07-退不到主标签层"; bad "按顶栏「返回」也退不出共享面 ⇒ 用户被关在第二层里"; summary; exit 1; }
ax_press_until "id:profile-entry-share" "加入共享清单" \
  || { shot "07b-进不去共享面"; bad "按不动「共享清单」入口"; summary; exit 1; }
# 🔴 共享清单入口屏只是**一份共享一行**，任务/评论那一节挂在选中之后（`ShareSpaceScreen`
#    的 `selected === undefined` 分支只画列表与偏好面）。旧写法按完入口就直接断言任务那一节
#    ⇒ 少一步选中，判据量的是没打开过的那一屏。走 `testID`（`AXUniqueId`），不靠行名子串。
if ! ax_press_until "id:share-space-row-$SHARE_ID" "评论区"; then
  shot "07c-选不中那份共享"
  bad "共享列表里点不开这一行（shareId=$SHARE_ID）⇒ 后面 L2/L3 都无从谈起"
  summary
  exit 1
fi
# 空间屏的到达判据：那一节要么列出任务（「选一条任务看它的评论」），要么明说没有
# （「这条共享清单里还没有任务」）。两种都算"进到了这份共享的空间"。
_space_open=0
for _i in 1 2 3 4 5 6; do
  idb_dump
  if tree_has "选一条任务看它的评论" || tree_has "这条共享清单里还没有任务" || tree_has "$TASK_TITLE"; then
    _space_open=1
    break
  fi
  sleep 3
done
if [ "$_space_open" != "1" ]; then
  shot "07c-共享空间没渲染"
  bad "进了共享清单却没看到任务那一节（空间屏没渲染 / 没选中这份共享）"
  summary
  exit 1
fi
if ! wait_tree "$TASK_TITLE" 180; then
  idb_dump
  shot "07-看不到owner的任务"
  bad "手机界面里没有 owner 写的那条任务「$TASK_TITLE」；口令那句读数=$BANNER_AT_LOGIN（present 时优先怀疑口令没进状态，见上面那段两种坏同形）"
  summary
  exit 1
fi
ok "手机上看见了 owner 写的任务（没点过一次同步）"
shot "08-下行任务可见"

# ── 8. 上行：手机发一条评论，owner 侧下载回来必须是 verified ─────────────────
step "8. 上行判据（L3/L4）：手机发评论 → owner 侧重验签 = verified"
ax_press_until "$TASK_TITLE" "写下你的评论" \
  || { shot "09b-任务点不开"; bad "点不开 owner 那条任务（评论输入框没出现）"; summary; exit 1; }
idb_dump
tree_has "评论区" || note "没读到「评论区」标题（可能在屏幕下方，继续试输入）"
PHONE_COMMENT="手机取证评论${STAMP}"
fill_field "写下你的评论" "$PHONE_COMMENT" || { shot "09-评论框进不去"; bad "评论输入框写不进去"; summary; exit 1; }
# 收键盘用的是 `fill_field` 记下的那行标题坐标；收不掉只记一句、**不因此宣布产品坏了**
#（下面 L3 那两条断言才是判据：点「发送」→ 评论回到界面）。
dismiss_keyboard_hard || note "软键盘没收掉（「写下你的评论」那行标题当量过落点的坐标不可得）—— 继续按发送"
shot "10-评论已输入"
ax_press "发送"
sleep 3
if ! wait_tree "$PHONE_COMMENT" 90; then
  shot "11-评论没出现在界面上"
  bad "手机发出去的评论没有回到界面上（本地物化那一半没成立）"
  summary
  exit 1
fi
ok "手机发出的评论回到了界面上"
shot "11-手机评论可见"

node "$ROOT/scripts/lib/collab-owner-step.mjs" verify-phone-op --state "$OWNER_STATE" \
  --expect-body "$PHONE_COMMENT" > "$EVIDENCE/phone-op-signature.json" 2> "$EVIDENCE/phone-op-signature.err"
if [ "$?" -ne 0 ]; then
  shot "12-上行验签没过"
  bad "owner 侧下载手机写的那条 op，重验没有通过（读数见 phone-op-signature.err）"
  summary
  exit 1
fi
ok "手机写出的 op 在 owner 侧重验 = verified（ADR-0069 在移动端成立）"

# ── 9. 信号驱动：owner 再写一条评论，手机不点同步自己重画 ───────────────────
step "9. 信号判据（L5）：owner 写第二条评论 → 手机靠 new_share_ops 自己出现"
OWNER_COMMENT="owner第二条评论${STAMP}"
node "$ROOT/scripts/lib/collab-owner-step.mjs" add-comment --state "$OWNER_STATE" --body "$OWNER_COMMENT" \
  > "$RUN_DIR/owner-comment.json" 2> "$RUN_DIR/owner-comment.err" \
  || { sed 's/^/      /' "$RUN_DIR/owner-comment.err" >&2; env_bail "owner 写评论失败"; }
note "owner 已写「$OWNER_COMMENT」；这一步**不许碰同步按钮**，手机只能靠信号"
if ! wait_tree "$OWNER_COMMENT" 180; then
  shot "13-信号没把评论送到手机"
  bad "owner 那条评论没有出现在手机界面上（信号→拉取那条腿在移动端没成立，或手机没有活连接）"
  summary
  exit 1
fi
ok "owner 的评论靠信号出现在手机上（全程没点同步）"
shot "14-信号驱动到的评论"
# 🔴 两行兜底署名必须是**同一种形状**（第 31 跑看图登记的那枚候选，回源码定完性之后剩下的那一半）。
#    组件那一行是「成员 + `authorUserId` 前 8 位」（`packages/ui/src/sync/comments-model.ts:76`），
#    两壳同一份。同一屏里一行像账号 id、另一行像 uuid ⇒ 有一方把**成员行的 id** 当作者写进了 op。
#    实测成因在装置这一侧（`collab-owner-step.mjs` 原先 `?? ownerMemberId` 兜下去了），不在 App 里；
#    这一格把它钉住：读不出树不算通过、一枚都没数到也不算通过（永远为真的判据比没有判据更糟）。
idb_dump
AUTH_SHAPE=$(python3 - "$IDB_DUMP_FILE" <<'PY'
import json, re, sys
try:
    raw = open(sys.argv[1], encoding="utf-8", errors="replace").read()
    json.loads(raw)  # 读不出这棵树就打印 unreadable，别让"没数到"冒充"形状一致"
except Exception:
    print("unreadable")
    raise SystemExit(0)
ids = re.findall(r"成员[\s,]*([0-9A-Za-z-]{2,12})", raw)
digits = [i for i in ids if i.isdigit()]
others = sorted(set(i for i in ids if not i.isdigit()))
print(f"n={len(ids)} digits={len(digits)} offenders={','.join(others)}")
PY
)
case "$AUTH_SHAPE" in
  unreadable)
    shot "14b-署名形状读不出树"
    env_bail "评论那一屏的树读不出 ⇒ 不拿「没数到」当「形状一致」"
    ;;
esac
# 🔴 这条读数要落在**取证目录**里，不许只活在一次性的控制台日志上：日志随清场消失，
#    而台账里那句"现量命令"就会指到一个不存在的地方（#529 那一族的近亲）。
printf '%s\n' "$AUTH_SHAPE" > "$EVIDENCE/auth-shape.txt"
if printf '%s' "$AUTH_SHAPE" | grep -q 'offenders=.'; then
  shot "14b-署名两行形状不一"
  bad "界面上出现了不像账号 id 的兜底署名（有一行把成员行 id 当作者写了）：$AUTH_SHAPE"
  summary
  exit 1
fi
if printf '%s' "$AUTH_SHAPE" | grep -q 'n=0'; then
  shot "14b-读不到任何兜底署名"
  bad "这一屏一枚「成员 …」都没数到 ⇒ 线程没渲染，这条判据不能靠『没数到』通过：$AUTH_SHAPE"
  summary
  exit 1
fi
ok "两行兜底署名同一种形状（都是账号 id 前缀）：$AUTH_SHAPE"

# ── 10. 界面不谎称能力：通知偏好面只剩三枚有输入的开关 ──────────────────────
step "10. 偏好面判据（L6）：只有活动那三档，没有「任务提醒」/「自动接受」"
# 🔴 偏好面挂在**共享空间那一屏**（`apps/mobile/src/screens/ShareSpaceScreen.tsx:773` 挂
#    `NotificationPrefsPanel`，节标题取 `common.share.notif.sectionTitle` =「共享通知」），
#    而上一步停在**任务详情**里。旧写法这里按的是一颗界面上根本不存在的「通知偏好」按钮
#    （那是装置自己编的词，不是产品文案），于是要么在不合适的屏上断言、要么恒过。
idb_dump
if ! tree_has "活动通知"; then
  note "当前屏上没有「活动通知」⇒ 按「返回」退回共享空间那一屏再找"
  ax_press "返回" || note "按「返回」没落上，仍继续找偏好面"
  sleep 2
  idb_dump
fi
if ! tree_has "活动通知"; then
  ax "活动通知" --scroll-into-view --json >/dev/null 2>&1 || true
  sleep 1
  idb_dump
fi
if tree_has "活动通知" || tree_has "完成/取消完成了任务"; then
  ok "通知偏好面在活动那一档（共享空间屏上读到的）"
  shot "16-通知偏好面"
  # 🔴 三档活动必须是**树上的可寻址元素**，不是三段裸文字。2026-10-25 看这张截图时发现的：
  #    行是 `Pressable`、`aria-checked` 也在、点了确实翻转，但屏幕上没有方框也没有对钩 ⇒
  #    看不出是开关、更看不出当前是开还是关（既有判据一条都不红：这里判文字在不在，
  #    减法那条判"没有输入的开关不许摆着"）。修在 `packages/ui/src/sync/NotificationPrefsPanel.tsx`
  #    （与 `Settings.ToggleLine` 同形状的标记）。
  #    ⚠️ 分工：设备上只能证"这三行是有 testID 的交互元素"（裸 `<Text>` 不会进 AX 树）；
  #      标记的**颜色与两态**由 `apps/web/tests/share-notif-prefs-affordance.spec.tsx` 判，
  #      像素由上面这张 16 号图肉眼复核（AGENTS §6.2 规定一）。
  _missing=''
  for _kind in completed added deleted; do
    tree_has_id "share-notif-activity-$_kind" >/dev/null 2>&1 || _missing="$_missing $_kind"
  done
  if [ -n "$_missing" ]; then
    bad "活动档里这些行不在 AX 树上（没有 testID 的裸文字不算开关）：${_missing# }"
  else
    ok "三档活动行都在 AX 树上（completed/added/deleted 各有 testID）"
  fi
else
  shot "15-偏好面读不到活动档"
  bad "退回共享空间屏、滚过「活动通知」之后仍没读到活动那一档（面板没渲染 / 文案漂了 / 没退到那一屏）"
  summary
  exit 1
fi
for ghost in "任务提醒" "指派给他人的除外" "自动接受已知合作者的共享邀请"; do
  # 🔴 这一档是**减法**判据（"界面上不许再摆着没有输入的开关"），所以 rc=2 那一档
  #    单独走：树读不出时"没数到"和"确实没有"逐字同形，把它算成 ✅ 就是一条恒真判据。
  tree_has "$ghost" >/dev/null 2>&1; _rc=$?
  if [ "$_rc" = "0" ]; then
    bad "界面上还摆着没有输入的开关：「$ghost」（M5-3 那一格没成立）"
  elif [ "$_rc" = "2" ]; then
    bad "判不了「$ghost」在不在这一棵树上（树读不出）⇒ 不拿「没读到」当「已经撤掉」"
  else
    ok "界面上没有「$ghost」（没有输入的档位已撤干净）"
  fi
done

# ── 10a. L8：本机偏好决定响不响，响的那一句带着清单名 ────────────────────────
step "10a. 投递判据（L8）：默认全关⇒零打扰；翻开『新增内容』⇒共享动态里那句带清单名的话"
# 🔴 这一档判的是产品定义里"收得到实时信号并**按本机偏好打扰用户**"那一半的后半。
#    node 那边把闸门、正文、消费者都钉住了（`apps/mobile/tests/share-ui-assembly.spec.ts`
#    ⑤⑦⑧ 三组），但设备上此前**没有任何一条判据看见过这句投递正文**：移动端的系统横幅
#    做不到（原因登记在 `apps/mobile/src/share/share-activity-notify.ts` 文件头），
#    "打扰"落在界面上的唯一一处就是通知中心那第三档。投了而没人看得见 = 这一半不成立。
# ⚠️ 为什么可以放心把起始读数当"全关"：本趟开头就 `simctl uninstall`（上面那一发），
#    偏好那份磁盘（设备级一枚键 `heyta.share-notif-prefs.v1`）跟着沙盒一起清掉。
#    这里不靠"应当是关的"，靠**第一趟不响、翻完第二趟必响**这一对相反读数 ——
#    单判一响分不清是闸门放行的还是本来就一直开着的。
# 🔴 每一趟都先让那条评论出现在**评论区**再去看动态：少了这道控制，"动态里静默"和
#    "信号根本没到手机"逐字同形，拿静默冒充闸门生效就是假绿（#580 那一族）。

# 从共享列表那一层进 owner 那条任务的评论区（两按：选这份共享 → 选这条任务）。
l8_goto_comments() {
  ax_press_until "id:share-space-row-$SHARE_ID" "$TASK_TITLE" || return 1
  ax_press "$TASK_TITLE" || return 1
}
# 从任一共享层退回「我的」，进通知中心并打开「共享动态」那一档。
l8_goto_activity_tab() {
  back_to_anchor "id:profile-entry-notifications" || return 1
  ax_press_until "id:profile-entry-notifications" "id:inbox-tab-share" || return 1
  ax_press "id:inbox-tab-share" || return 1
}

# 界面上那份共享叫什么，从**这一屏那一行自己的读数**里取（不猜），再拿它跟第 6 步填进去的
# 那个名字对一次账。🔴 上一趟（第 36/37 跑）这里两半同形：装置那侧的 owner 只写过一条任务 op，
# 从没写过"清单名"那一枚（`collab-owner-step.mjs` 的 `projectId: 'project-owner'` 是一份没有
# PROJECT op 的虚拟清单），而手机入群时名字那一格也空着 ⇒ 行名与正文里的名字都是词表默认值
# 「共享清单」，那句正文证明不了名字是从本机行上来的。现在填了带戳的名，这一格才有牙。
# ⚠️ 它判的仍**不是**"owner 改的名会不会同步过来"（那是另一格，本机名只本机可见）。
idb_dump
SHARE_LIST_NAME=$(python3 - "$IDB_DUMP_FILE" "$SHARE_ID" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(0)
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
for top in (data if isinstance(data, list) else [data]):
    for n in walk(top):
        if (n.get("AXUniqueId") or "") == "share-space-row-" + sys.argv[2]:
            print((n.get("AXLabel") or "").strip())
            sys.exit(0)
PY
)
if [ -z "$SHARE_LIST_NAME" ]; then
  shot "18a-读不到那份共享的名字"
  env_bail "共享列表里那一行（share-space-row-$SHARE_ID）读不出名字 ⇒ 正文该带哪个名字这一格判不了（装置问题，不判产品）"
fi
if [ "$SHARE_LIST_NAME" != "$JOIN_LIST_NAME" ]; then
  shot "18a2-那一行的名字不是入群时填的"
  bad "共享列表那一行显示=$SHARE_LIST_NAME，第 6 步填进「清单名称」的是 $JOIN_LIST_NAME ⇒ 本机行名没落到界面上（正文插的就是它，这一格先红在这里）"
  summary
  exit 1
fi
ok "那一行的名字就是入群时填的那个（下面的正文因此是在拿本机行名插句子，不是拿词表默认值）"
note "界面上这份共享的名字=$SHARE_LIST_NAME"
# 期望那句正文在这里就先拼出来：两半的判据、红时的归因话术都用它，不各写一份。
# ⚠️ 它是模板代入之后的**渲染结果**（`common.share.activityNamed.added`），
#    词表对账门（`check:verify-script-copy`）认这一形；写成裸子串那档会被报成缺失。
L8_SENTENCE="有人在你参与的共享清单「$SHARE_LIST_NAME」里写了新内容"

L8_COMMENT_OFF="偏好全关时的owner评论${STAMP}"
node "$ROOT/scripts/lib/collab-owner-step.mjs" add-comment --state "$OWNER_STATE" --body "$L8_COMMENT_OFF" \
  > "$RUN_DIR/l8-comment-off.json" 2> "$RUN_DIR/l8-comment-off.err" \
  || { sed 's/^/      /' "$RUN_DIR/l8-comment-off.err" >&2; env_bail "owner 写第一条取证评论失败"; }
if ! l8_goto_comments; then
  shot "18b-进不到评论区"
  env_bail "从共享列表进不到 owner 那条任务的评论区（装置落点问题，不判产品）"
fi
if ! wait_tree "$L8_COMMENT_OFF" 180; then
  shot "18c-取证评论没到手机"
  bad "偏好全关时 owner 那条评论本身也没靠信号到手机 ⇒ 内容那一腿是断的，L8 不能拿『动态里静默』当闸门生效"
  summary
  exit 1
fi
ok "控制读数在场：评论靠信号到了手机（下面的静默因此只可能是偏好那一格）"
if ! l8_goto_activity_tab; then
  shot "18d-进不到共享动态那一档"
  env_bail "按不到「我的」→通知中心→共享动态这一路（装置落点问题，不判产品）"
fi
tree_has "还没有共享动态" >/dev/null 2>&1; rc_empty=$?
if [ "$rc_empty" = "2" ]; then
  shot "18e-共享动态读不出树"
  env_bail "共享动态那一档的树读不出（rc=2）⇒ 不拿「没读到」当「偏好全关所以没响」"
fi
if [ "$rc_empty" != "0" ]; then
  idb_dump
  if tree_has "$L8_SENTENCE" >/dev/null 2>&1; then
    shot "18f-偏好全关却响了"
    bad "通知偏好一处都没开，共享动态里却出现了投递正文 ⇒ 闸门没生效（ADR-0062 决策 7 那一格在设备上翻了）"
    summary
    exit 1
  fi
  shot "18g-共享动态既没空态也没句子"
  bad "共享动态那一档既读不到空态句、也读不到投递正文 ⇒ 这一档根本没渲染出来"
  summary
  exit 1
fi
ok "偏好全关 ⇒ 共享动态是空的（零打扰在设备上成立）"
shot "18-偏好全关时共享动态为空"

# 翻开『新增内容』那一档：这一按之后必须**换一副读数**。
# 🔴 先回偏好面那一屏 —— 上一段结束人还在**通知中心的共享动态**那一档，那里根本没有开关。
#    第 36 跑就是在这里 env_bail 的（`本屏没有逐字叫 id:share-notif-activity-added 的可点节点`）：
#    那句话是装置的导航错，不是产品没有开关 —— 同一屏第 10 步刚数到过那三行。
#    偏好面板挂在共享面**未选中**那一支（`ShareSpaceScreen.tsx:708` 的 `selected === undefined`），
#    与"一份共享一行"同屏，所以从「我的」按那一行入口进去就在面板上。
back_to_anchor "id:profile-entry-share" \
  || { shot "18h0-翻开关前爬不到我的页"; env_bail "翻开关前按顶栏「返回」爬不到「我的」那一行（装置问题，不判产品）"; }
if ! ax_press_until "id:profile-entry-share" "id:share-notif-activity-added"; then
  shot "18h1-进不到偏好面"
  env_bail "从「我的」那行入口进不到画着活动开关的那一屏（装置落点问题，不判产品）"
fi
ax_press "id:share-notif-activity-added" \
  || { shot "18h-按不到新增内容那一档"; env_bail "偏好面上按不到『新增内容』那一行（装置落点问题，不判产品）"; }
sleep 2
L8_COMMENT_ON="偏好翻开后的owner评论${STAMP}"
node "$ROOT/scripts/lib/collab-owner-step.mjs" add-comment --state "$OWNER_STATE" --body "$L8_COMMENT_ON" \
  > "$RUN_DIR/l8-comment-on.json" 2> "$RUN_DIR/l8-comment-on.err" \
  || { sed 's/^/      /' "$RUN_DIR/l8-comment-on.err" >&2; env_bail "owner 写第二条评论失败"; }
if ! l8_goto_comments; then
  shot "18i-第二次进不到评论区"
  env_bail "第二次从共享列表进不到评论区（装置落点问题，不判产品）"
fi
if ! wait_tree "$L8_COMMENT_ON" 180; then
  shot "18j-第二条评论没到手机"
  bad "翻开偏好后 owner 那条评论没能靠信号到手机 ⇒ 内容那一腿断了，动态那一格判不了"
  summary
  exit 1
fi
if ! l8_goto_activity_tab; then
  shot "18k-第二次进不到共享动态"
  env_bail "第二次按不到通知中心那第三档（装置落点问题，不判产品）"
fi
# 到达判据钉的是"本机那一行的名字被带进了 `「…」`"：匿名那句里没有书名号 ⇒ 这一枚只可能
# 在**有名**那一档出现（`common.share.activityNamed.added`），比整串匹配更抗词表微调。
if ! wait_tree "「$SHARE_LIST_NAME」" 120; then
  idb_dump
  shot "18l-翻开偏好后动态里没那句"
  if tree_has "还没有共享动态" >/dev/null 2>&1; then
    bad "翻开『新增内容』后信号也到了、动态却仍写着空态 ⇒ 偏好写盘或投递那一格在设备上没成立（期望带上本机那一行的名字：$SHARE_LIST_NAME）"
  else
    bad "共享动态里那句正文没带上本机那一行的名字「$SHARE_LIST_NAME」 ⇒ 名字那一格没进正文（期望逐字：$L8_SENTENCE）"
  fi
  summary
  exit 1
fi
# 屏幕上那一句逐字取回来落进**证据目录**：台账要引用一份还在那里的文件，而不是一次性的
# 控制台日志（#576/#529 那一族 —— 日志随清场消失，台账那句"现量命令"就指到不存在的地方）。
idb_dump
L8_ROW_TEXT=$(python3 - "$IDB_DUMP_FILE" "$SHARE_LIST_NAME" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(0)
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
needle = "\u300c" + sys.argv[2] + "\u300d"
for top in (data if isinstance(data, list) else [data]):
    for n in walk(top):
        label = (n.get("AXLabel") or "").strip()
        if needle in label:
            print(label)
            sys.exit(0)
PY
)
if [ -z "$L8_ROW_TEXT" ]; then
  shot "18l2-读不到那一行正文"
  env_bail "名字命中了却读不出那一整行文字（装置读不出这棵树，不判产品）"
fi
printf '%s\n' "$L8_ROW_TEXT" > "$EVIDENCE/l8-sentence.txt"
if ! printf '%s' "$L8_ROW_TEXT" | grep -qF '有人在你参与的共享清单'; then
  bad "动态里那行文字不是那句活动正文（逐字读数在 evidence/l8-sentence.txt）：$L8_ROW_TEXT"
  summary
  exit 1
fi
ok "翻开偏好 ⇒ 同一种信号在共享动态里落成那句带清单名的话：$L8_ROW_TEXT"
shot "19-共享动态里那句带清单名的话"

# ── 10b. L7：手机自己开启共享（反向那一半）──────────────────────────────────
step "10b. 开共享判据（L7）：手机自己建一条清单、把它设为共享、签发邀请、再撤销"
# 🔴 这一档此前**整条不在旅程里**：第 5 步用服务端把 owner 那一侧建好（`collab-owner-step.mjs init`），
#    所以"手机上按『开启共享』⇒ 同意闸 ⇒ 建 share ⇒ 发邀请"这条路径从未在设备上走过一次。
#    界面与生产装配都在（`ShareSpaceScreen.tsx:745` 那颗 `share-create-${projectId}` → `startShare`
#    → `ShareConsentModal` → `createShare`：`api.createShare` + `sealListKeyForRecipient`
#    + `putMemberEnvelope` + `putMemberSigningKey` + `bindProjectShare`），欠的只是有人真按一次。
# 🔴 第 10a 步结束时人停在**通知中心那第三档**（「我的」这一档的第二层里）。这里不许按底部标签找路：
#    共享面挂在「我的」这一档的第二层里，再按一次同一档不改 `tab`（本文件 725-729 行那条实测），
#    第 32 跑就是在这里红的 —— 日志写「树上没有落点 id:profile-entry-share；当前屏顶部文字=共享清单」，
#    读的是装置走错了路，不是产品没有入口。出路只有顶栏那枚「返回」⇒ 用 `back_to_anchor` 逐层爬。
back_to_anchor "id:profile-entry-share" \
  || { shot "17a-爬不到我的页那一行"; env_bail "按顶栏「返回」也爬不到「我的」页那一行（装置问题，不判产品）"; }
# 🔴 先**从界面上建一条自己的清单**，再拿它去开共享。"可共享的清单"那一节读的是本机没挂
#    shareId 的清单行（`ShareSpaceScreen.tsx:213` 那段减法），而这台账号是旅程里新注册的、
#    此前只**加入**过别人那一份 ⇒ 名下一条自己的清单都没有。第 33 跑就是在这里 env_bail 的
#    （截图 17d：那一节写着空态）。这里不绕过它 —— 产品定义里「手机用户能建清单」那一格
#    此前从未在设备上走过，建不出来就是产品红，不是装置前提不成立。
PHONE_LIST_NAME="手机自建清单${STAMP}"
if ! ax_press_until "id:profile-entry-lists" "id:mobile-list-add"; then
  shot "17b1-进不到清单管理"
  env_bail "按「我的」页那行清单入口进不到清单管理面（装置读不到落点，不判产品）"
fi
if ! fill_field "id:mobile-list-name" "$PHONE_LIST_NAME"; then
  shot "17b3-清单名填不进"
  env_bail "清单名填不进输入框（装置问题，不判产品）"
fi
if ! ax_press_until "id:mobile-list-add" "$PHONE_LIST_NAME"; then
  shot "17b4-手机上建不出清单"
  bad "按了「新建清单」那一枚，界面上没有出现「$PHONE_LIST_NAME」⇒ 产品定义里「手机用户能建清单」那一格在设备上没成立"
  summary
  exit 1
fi
ok "手机自己建出一条清单（$PHONE_LIST_NAME）"
shot "17b5-手机建出的清单"
if ! back_to_anchor "id:profile-entry-share"; then
  shot "17b6-建完清单爬不到我的页"
  env_bail "建完清单后按顶栏「返回」爬不到「我的」页那一行（装置问题，不判产品）"
fi
if ! ax_press_until "id:profile-entry-share" "id:share-join-entry"; then
  shot "17b-按不动共享入口"
  bad "「我的」页那行共享入口按不动，进不到共享首页（L7 走不下去）；口令那句读数=$BANNER_AT_LOGIN"
  summary
  exit 1
fi
# 手机这一页上"可共享的清单"那一节的每一行是一颗 `share-create-<projectId>`（可交互 ⇒ 进 AX 树）。
# 🔴 认哪一行**按刚建的那条清单的名字**认，不按"树上第一颗"认：第 33 跑之后这一页上会同时有
#    上一趟留下的行（同一台模拟器复用沙盒时）与这一条新行，取第一颗会把别的行当成目标。
#    有行但没有我们这条 ⇒ 判产品红（建出来的清单没进可共享那一节）；一行都没有 ⇒ 判装置/环境。
idb_dump
CREATE_READ=$(python3 - "$IDB_DUMP_FILE" "$PHONE_LIST_NAME" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(0)
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
name = sys.argv[2]
rows = []
for top in (data if isinstance(data, list) else [data]):
    for n in walk(top):
        u = n.get("AXUniqueId") or ""
        if not u.startswith("share-create-"):
            continue
        label = " ".join(str(n.get(k) or "") for k in ("AXLabel", "AXValue", "label", "value", "title"))
        rows.append(u if name in label else "")
print(f"{next((r for r in rows if r), '')}|{len(rows)}")
PY
)
CREATE_ANCHOR=${CREATE_READ%%|*}
CREATE_ROWS=${CREATE_READ##*|}
if [ -z "$CREATE_ROWS" ]; then
  shot "17d2-共享首页读不到树"
  env_bail "共享首页那棵树读不出 ⇒ 不拿「没读到」当「界面上没有可共享的清单」"
elif [ "$CREATE_ROWS" = "0" ]; then
  shot "17d-没有可共享的清单"
  bad "手机上刚建出来的那条清单没有出现在『可共享的清单』那一节（界面上这一节一行都没有）"
  summary
  exit 1
elif [ -z "$CREATE_ANCHOR" ]; then
  shot "17d3-可共享那一节里没有这条"
  bad "『可共享的清单』里有 $CREATE_ROWS 行，但没有一行是刚建出来的「$PHONE_LIST_NAME」⇒ 名册/减法那一格没对上"
  summary
  exit 1
fi
ok "手机上有一条自己的清单可以设成共享（$CREATE_ANCHOR）"
if ! ax_press_until "id:${CREATE_ANCHOR}" "id:share-consent-accept" "id:share-invite-submit"; then
  shot "17e-按不动开启共享"
  bad "按「${CREATE_ANCHOR}」五次也没落到同意面或共享面板"
  summary
  exit 1
fi
if [ "$PRESS_HIT" = "id:share-consent-accept" ]; then
  # 这道闸在设备上第一次为 **owner** 一侧出现（第 6 步那次是 member 一侧）：
  # 判断在 `@heyta/ui` 的 `shouldShowConsent`，本轮每趟都 `simctl uninstall` ⇒ 沙盒里同意态是空的。
  shot "17f-开共享同意面"
  if ! ax_press_until "id:share-consent-accept" "id:share-invite-submit"; then
    shot "17g-按了同意却没到共享面板"
    env_bail "按了「确认共享」却没走到共享面板（装置读不到落点，不判产品）"
  fi
  ok "开共享这一侧的同意闸在设备上按过了（与入群那一侧同一道闸）"
fi
shot "17h-手机建好的共享面板"
ok "手机自己把一条清单设成了共享：面板上有所有者才有的『生成邀请』那一格"
fill_field "id:share-invite-email" "$OWNER_EMAIL" \
  || { shot "17i-邮箱填不进"; env_bail "邀请邮箱填不进输入框（装置问题，不判产品）"; }
# 🔴 从这一按起，屏幕上画出**当趟那张一次性邀请凭证**的明文（`ShareSpaceScreen.tsx:838` 那枚
#    `share-invite-token`）⇒ 与第 6 步凭证框、与恢复码同一档：帧只落私有 RUN_DIR，不进证据目录。
#    判"签发成功"不需要像素 —— 锚在只有 ticket 相位才画的两枚按钮上（`share-invite-handoff`）。
SECRET_FRAMES=1
ax_press "id:share-invite-submit" || true
if ! wait_tree_id "share-invite-handoff" 120; then
  idb_dump
  shot "17j-没签发邀请"
  tree_has "share-create-error" >/dev/null 2>&1 && note "面板上挂着 share-create-error（建 share 那一步就没成）"
  bad "按了『生成邀请』，界面上没有出现『把邀请交给对方』那一格 ⇒ 手机没签发出一张可用邀请"
  summary
  exit 1
fi
ok "手机自己签发了一张邀请（『把邀请交给对方』那一格出现 = ticket 已在界面上）"
# 服务端形状要在**撤销之前**读：撤销会把那张邀请打上 revokedAt，活邀请那一格就读不到了。
node "$ROOT/scripts/lib/collab-owner-step.mjs" phone-owner \
  --base-url "$HOST_SERVER" --token-file "$RUN_DIR/member-token.txt" --exclude-share "$SHARE_ID" \
  > "$EVIDENCE/phone-owner.json" 2> "$RUN_DIR/phone-owner.err"
rc_po=$?
if [ "$rc_po" -ne 0 ]; then
  sed 's/^/      /' "$RUN_DIR/phone-owner.err" >&2 2>/dev/null
  SECRET_FRAMES=0
  bad "服务端没把这台手机认成它自己那条共享的所有者（手机建的 share / 所有者成员行 / 活邀请三格里有格没成立，rc=$rc_po）"
  summary
  exit 1
fi
PHONE_SHARE=$(python3 -c 'import json;print(json.load(open("'"$EVIDENCE"'/phone-owner.json"))["shareId"])')
PHONE_LIVE=$(python3 -c 'import json;print(json.load(open("'"$EVIDENCE"'/phone-owner.json"))["liveInvitationCount"])')
ok "服务端读数：手机名下 role=owner 的共享 $PHONE_SHARE，所有者行带签名公钥，活邀请 $PHONE_LIVE 张"
# 撤销那一发要真把明文从屏幕上摘掉 —— 这是"可逆状态"的判据，也是下一张图能进证据目录的前提。
ax_press "id:share-invite-revoke" || true
sleep 2
tree_has_id "share-invite-handoff" >/dev/null 2>&1; rc_rev=$?
if [ "$rc_rev" = "0" ]; then
  SECRET_FRAMES=0
  shot "17k-撤销后凭证还挂在屏上"
  bad "按了「撤销这张邀请」，「把邀请交给对方」那一格还在 ⇒ 撤销没回到无邀请态（一次性凭证继续画在屏上）"
  summary
  exit 1
elif [ "$rc_rev" = "2" ]; then
  SECRET_FRAMES=0
  shot "17k-撤销后读不到树"
  env_bail "撤销之后那棵树读不出（rc=2）⇒ 不拿「没读到」当「撤销成功」"
fi
SECRET_FRAMES=0
ok "撤销回到无邀请态（凭证那一格从界面上摘掉了）"
shot "17l-撤销后无邀请态"
# 这一趟多出来一份**手机自己建的**共享：回到共享首页，它必须与加入那一份并排在场 ——
# 服务端在册而界面上没有，也是这一格会红的那一档。
if ! back_to_anchor "id:profile-entry-share"; then
  shot "17m-L7 收尾爬不到我的页"
  env_bail "L7 收尾时按顶栏「返回」爬不到「我的」页那一行（装置问题，不判产品）"
fi
if ! ax_press_until "id:profile-entry-share" "id:share-join-entry"; then
  shot "17o-收尾进不到共享首页"
  bad "L7 收尾时从那行入口进不到共享首页"
  summary
  exit 1
fi
tree_has_id "share-space-row-$PHONE_SHARE" >/dev/null 2>&1; rc_row=$?
if [ "$rc_row" = "0" ]; then
  ok "共享首页上有了手机自己那一行（share-space-row-$PHONE_SHARE），与加入的那一份并排"
  shot "17p-手机自己建的共享在列表里"
elif [ "$rc_row" = "2" ]; then
  shot "17q-收尾读不到共享首页那棵树"
  env_bail "读不出共享首页的树（rc=2）⇒ 不拿「没读到」当「界面上没建出来」"
else
  shot "17r-手机建的那份不在列表里"
  bad "手机自己建的共享没出现在界面上（服务端在册、界面上没有 ⇒ 名册/绑定那一格没回流）"
  summary
  exit 1
fi

# ── 10c. 便签那一族的设备腿（L9）────────────────────────────────────────────
step "10c. 便签下行判据（L9）：owner 写一条便签进共享清单 ⇒ 手机『便签』板上看得见，全程不点同步"
# 🔴 产品定义那句是「任务/便签/评论**三族**与另一台设备双向同步」，而设备上被看见过的只有
#    任务与评论两族（L2/L3/L5）。便签那一族在宿主层是通的（`verify:collab-sync` 把三族都收进
#    共享日志），但"手机界面上看得见"此前**没有任何一条判据量过** —— 漏的是设备腿自己。
# ⚠️ 这一格只有**下行**：手机上没有"把一条便签归进某份清单"那一枚入口 ——
#    `setNoteProject` 在 `apps/mobile/src` 与 `apps/web/src` 都是**零调用点**（现量
#    `git grep -n setNoteProject -- 'apps/**/src/**' 'packages/**/src/**'` ⇒ 只剩接口声明与实现两处；
#    ⚠️ 别扫整个 `apps`：那里面 `apps/web/dist` 的打包产物会命中，读出来不是零），
#    所以"手机写便签进共享清单"两壳今天都到不了，
#    那是缺一个界面入口，不是缺一条判据。登记在计划 §9.15 末那张表里。
L9_NOTE_BODY="owner写的共享便签${STAMP}"
node "$ROOT/scripts/lib/collab-owner-step.mjs" add-note --state "$OWNER_STATE" --content "$L9_NOTE_BODY" \
  > "$RUN_DIR/l9-note.json" 2> "$RUN_DIR/l9-note.err" \
  || { sed 's/^/      /' "$RUN_DIR/l9-note.err" >&2 2>/dev/null; env_bail "owner 写那条取证便签失败（装置/服务端那一腿，不判产品）"; }
if ! back_to_anchor "id:profile-entry-notes"; then
  shot "20a-L9 爬不到便签入口"
  env_bail "按顶栏「返回」爬不到「我的」页上便签那一行（装置问题，不判产品）"
fi
# 到达判据用 `notes-submit`（`Pressable` + `accessibilityRole="button"` ⇒ 进 AX 树），
# 不用 `mobile-notes-board` / `note-row-*` —— 那两枚都是裸 `View`，按 #575 那一族恒不命中。
if ! ax_press_until "id:profile-entry-notes" "id:notes-submit"; then
  shot "20b-进不到便签板"
  env_bail "按了便签那一行却没走到便签板（装置落点问题，不判产品）"
fi
if wait_tree "$L9_NOTE_BODY" 180; then
  ok "owner 写进那份共享清单的便签出现在手机的便签板上（没点过同步 ⇒ 走的仍是那条信号）"
  shot "20-owner的共享便签到手机"
else
  idb_dump
  # 失法分档：板上一行都没有（那块面没渲染）与"有别行、独缺这一条"（便签那一族没回流）
  # 不是同一件事，读屏的静态文字条数落进取证目录，下一位不用重跑就能分。
  L9_STATIC_LINES=$(python3 - "$IDB_DUMP_FILE" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print(-1); sys.exit(0)
def walk(n):
    yield n
    for c in (n.get("children") or []):
        yield from walk(c)
rows = 0
for top in (data if isinstance(data, list) else [data]):
    for n in walk(top):
        if (n.get("role") or "") == "AXStaticText" and (n.get("AXLabel") or "").strip():
            rows += 1
print(rows)
PY
)
  echo "   · 便签板那棵树上读得到的静态文字条数=$L9_STATIC_LINES（-1 = 树读不出，别拿它当空板）"
  if [ "$L9_STATIC_LINES" = "-1" ]; then
    shot "20c-便签板读不出树"
    env_bail "便签板那棵树读不出（rc=2 那一档）⇒ 不拿「没读到」当「便签没回流」"
  fi
  shot "20d-便签板上没有那条共享便签"
  bad "owner 写进共享清单的便签没出现在手机便签板上（板上静态文字 $L9_STATIC_LINES 条，独缺这一条）⇒ 产品定义里三族中的便签那一族在手机上没接上"
  summary
  exit 1
fi

# ── 10d. 任务那一族的上行（L10）：手机把一条新任务指进那份共享清单 ────────────
#
# 🔴 这一格补的是产品定义那句「三族与另一台设备**双向**同步」里最后缺的一族方向：
# 此前手机上建任务只有两处调用点、都不交 `projectId`（⇒ 新任务一律落收集箱），
# 本批把「落进哪一份清单」那一枚控件接上（`CaptureComposer` 的 `projectPicker`），
# 于是这里判的是**真机上的整条上行**：按那枚芯片 ⇒ 提交 ⇒ owner 侧从共享日志读回并验签。
step "10d. 上行判据（L10）：手机新建一条任务并指进那份共享清单 ⇒ owner 侧读回并验签"
L10_TASK_TITLE="手机写进共享的任务${STAMP}"
# 🔴 三枚针脚各管一格，且都是**整句**（不拿前缀拼清单名）：
#    芯片的无障碍名 = 入口在不在场；那一行的标题 = 此刻的落点（默认收集箱 → 按完变成那份共享）。
#    标题这一枚是**按压的到达判据**：它随选中而变，所以"按下了但没生效"红得出来。
#    （第 41 跑用的到达判据是输入框里的标题 —— 它在按之前就在场，是一条恒真判据。）
L10_CHIP_LABEL="落点选为「本机清单${STAMP}」"
L10_DEFAULT_TARGET="新建落进收集箱"
L10_PICKED_TARGET="新建落进「本机清单${STAMP}」"
if ! ax_press "id:tab-tasks"; then
  shot "21a-回不到任务标签"
  env_bail "按不动底部「任务」标签（装置/AX 那一腿，不判产品）"
fi
if ! ax_press_until "id:mobile-task-add" "id:capture-input"; then
  shot "21b-新建面板没开"
  env_bail "按不开新建任务面板（捕获输入框没出现）"
fi
if ! fill_field "id:capture-input" "$L10_TASK_TITLE"; then
  shot "21c-任务标题填不进"
  env_bail "捕获输入框填不进字（set-value 那一腿）"
fi
# 落点那一行必须在场 —— 这一格是本批新加的控件，不在场就是产品红，不是"装置没点到"。
if ! wait_tree "$L10_CHIP_LABEL" 30; then
  idb_dump
  shot "21d-面板上没有那份共享"
  bad "新建面板里读不到「$L10_CHIP_LABEL」那一枚 ⇒ 手机上还是没有把新任务指进某份清单的入口"
  summary
  exit 1
fi
if ! tree_has "$L10_DEFAULT_TARGET"; then
  shot "21d2-落点标题没念默认值"
  bad "面板上那一行的标题没念「$L10_DEFAULT_TARGET」⇒ 未选时的默认落点说不清（选中态只靠颜色）"
  summary
  exit 1
fi
ok "面板上那份共享的落点芯片在场，且此刻的落点念的是收集箱"
# 🔴 只按，不碰键盘（`ax_press_until` 会先按 return 收键盘 ⇒ 把这条任务提交掉）。
if ! press_in_form "$L10_CHIP_LABEL"; then
  shot "21e-落点芯片按不动"
  bad "按不动那份共享那一枚落点芯片（界面上有它却按不下去）"
  summary
  exit 1
fi
if ! wait_tree "$L10_PICKED_TARGET" 20; then
  shot "21e2-按了但落点没改口"
  bad "按过那份共享的芯片后，那一行的标题仍没念「$L10_PICKED_TARGET」⇒ 选择没有真的生效"
  summary
  exit 1
fi
ok "按过芯片，那一行的标题改口成那份共享（选择真的生效，不是画了个样子）"
shot "21-选好落点待提交"
if ! ax_press "id:capture-submit"; then
  shot "21f-提交按钮按不动"
  env_bail "按不动捕获器的添加按钮（装置那一腿）"
fi
# owner 侧读回并验签（与 L3/L4 同一把尺，只是这次期望正文是一条 TASK）。
node "$ROOT/scripts/lib/collab-owner-step.mjs" verify-phone-op --state "$OWNER_STATE" \
  --expect-body "$L10_TASK_TITLE" > "$EVIDENCE/l10-task-signature.json" 2> "$EVIDENCE/l10-task-signature.err" \
  || {
    sed 's/^/      /' "$EVIDENCE/l10-task-signature.err" >&2 2>/dev/null
    shot "21g-owner侧没读回那条任务"
    bad "手机指进共享的那条任务在 owner 侧读不回或重验没过（读数见 l10-task-signature.err）⇒ 任务那一族的上行没接上"
    summary
    exit 1
  }
ok "手机把一条新任务写进了那份共享清单，owner 侧重验 = verified（三族里的任务那一族真双向）"

# ── 10e. 便签那一族的上行（L11）：手机把一条新便签指进那份共享清单 ────────────
#
# 🔴 L10 的对偶。产品定义那句是「任务/便签/评论**三族**与另一台设备双向同步」：
#    评论那一族早就双向（L3/L5），任务这一批补上（L10），便签此前只有下行（L9）。
#    同一枚控件也接在便签板上（`NotesSection` 挂 `CaptureProjectPickerRow` +
#    `createNote(content, { projectId })`），所以这里判的是**真机上的整条上行**，
#    判据形状与 L10 逐格对称：入口在场 ⇒ 按下改口 ⇒ owner 侧读回并验签。
step "10e. 上行判据（L11）：手机新建一条便签并指进那份共享清单 ⇒ owner 侧读回并验签"
L11_NOTE_BODY="手机写进共享的便签${STAMP}"
# 🔴 上一格（L10）结束时人在**任务**那一档的根上，那里**没有**顶栏「返回」可爬
#    （第 44 跑实测：`back_to_anchor` 连报四次"本屏没有逐字叫「返回」的可点节点"）。
#    所以走底部标签，与 L9 的来路不同 —— L9 是从共享那一屏往上爬，这一格是从另一档过去。
if ! ax_press "id:tab-profile"; then
  shot "22a-L11 按不动「我的」标签"
  env_bail "按不动底部「我的」标签（装置/AX 那一腿，不判产品）"
fi
# 🔴 回到这一档之后人在**哪一层**不固定：这一档记得自己上次的内层屏（#571 那一族），
#    而 L9 就是停在便签板上 ⇒ 第 45 跑实测：按完标签到达判据 `profile-entry-notes` 五发都不在，
#    日志打出的当前屏顶部文字逐字就是「便签」—— 已经站在便签板上了，再按那一行反而会走深一层。
#    ⇒ 与 `back_to_anchor` 同一条纪律、方向相反：**先量到达判据，不在才按**。
if ! tree_has_id "notes-submit"; then
  if ! ax_press_until "id:profile-entry-notes" "id:notes-submit"; then
    shot "22b-进不到便签板"
    env_bail "按了便签那一行却没走到便签板（装置落点问题，不判产品）"
  fi
fi
if ! fill_field "id:notes-input" "$L11_NOTE_BODY"; then
  shot "22c-便签内容填不进"
  env_bail "便签板那条输入框填不进字（set-value 那一腿）"
fi
if ! tree_has "$L10_CHIP_LABEL"; then
  shot "22d-便签板上没有那份共享"
  bad "便签板上读不到「$L10_CHIP_LABEL」那一枚 ⇒ 便签那一族还是没有指进某份清单的入口"
  summary
  exit 1
fi
if ! press_in_form "$L10_CHIP_LABEL"; then
  shot "22e-便签落点芯片按不动"
  bad "按不动便签板上那份共享的落点芯片（界面上有它却按不下去）"
  summary
  exit 1
fi
if ! wait_tree "$L10_PICKED_TARGET" 20; then
  shot "22f-按了但便签落点没改口"
  bad "按过芯片后便签板那一行仍没念「$L10_PICKED_TARGET」⇒ 便签那一族的选择没有真的生效"
  summary
  exit 1
fi
ok "便签板上按过同一枚落点芯片，那一行也改口成那份共享（与任务那一屏共用一份形状）"
# 图证：AGENTS §6.2 要"真看截图"，这一格此前只有日志断言、没有一张绿路径的图。
shot "22-便签选好落点待提交"
if ! ax_press "id:notes-submit"; then
  shot "22g-便签添加按钮按不动"
  env_bail "按不动便签板的添加按钮（装置那一腿）"
fi
node "$ROOT/scripts/lib/collab-owner-step.mjs" verify-phone-op --state "$OWNER_STATE" \
  --expect-body "$L11_NOTE_BODY" > "$EVIDENCE/l11-note-signature.json" 2> "$EVIDENCE/l11-note-signature.err" \
  || {
    sed 's/^/      /' "$EVIDENCE/l11-note-signature.err" >&2 2>/dev/null
    shot "22h-owner侧没读回那条便签"
    bad "手机指进共享的那条便签在 owner 侧读不回或重验没过（读数见 l11-note-signature.err）⇒ 便签那一族的上行没接上"
    summary
    exit 1
  }
ok "手机把一条新便签写进了那份共享清单，owner 侧重验 = verified（三族里便签那一族也真双向）"

# ── 11. 证据收尾 ────────────────────────────────────────────────────────────
step "11. 证据目录（只存读数，不存产物）"
node "$ROOT/scripts/lib/collab-owner-step.mjs" dump --state "$OWNER_STATE" > "$EVIDENCE/server-side.json" 2> /dev/null \
  || note "dump 读数没落成（不影响上面的判据）"
{
  echo "# iOS 协作旅程证据（$(date -Iseconds)）"
  echo
  echo "- 设备：$UDID（名字前缀 $DEVICE_NAME）"
  echo "- 服务端：$HOST_SERVER（库 $E2E_DB，TEST_MODE，零 mock）"
  echo "- 安装包 main.jsbundle sha256：$(cat "$EVIDENCE/bundle-sha256.txt" 2>/dev/null)"
  echo "- share：$SHARE_ID"
  echo "- owner 成员行：$OWNER_MEMBER"
  echo "- 手机成员行：$PHONE_MEMBER"
  echo "- 判据读数：$PASS 通过 / $FAIL 失败"
  echo
  echo "截图逐张对应上面每一步；上行验签的机器读数在 phone-op-signature.json，"
  echo "服务端侧的成员/日志形状在 server-side.json。"
} > "$EVIDENCE/README.md"
note "截图 $(ls -1 "$EVIDENCE" | grep -c 'png$') 张，证据目录 $EVIDENCE"

summary
