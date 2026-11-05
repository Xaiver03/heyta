#!/usr/bin/env bash
#
# 移动端「一句话捕获」的日期胶囊 + 面板 · Android 设备腿（远端无头模拟器）
# =========================================================================
#
# 与 `verify-mobile-capture.sh` 判**同一件事**，但载体不同：
#
#   旧脚本 : 本机 adb + 硬编码坐标 + 需要服务端与同步凭据（`pm clear` 后走配置那一页）
#   本脚本 : 远端宿主上的模拟器 + `uiautomator dump` 的 **resource-id**
#            ⇒ 不需要服务端：这一腿量的是**接线与形状**，不发请求、不建任务
#
# 🔴 为什么必须有这一腿（而不是"共享件只有一份所以不用验"）
#
# 移动端把共享件的面板装进**自己的外壳**（`renderDuePanel` → `BottomSheet`），
# web 装进锚定浮层，两端各走自己那一支；而"这一支在真机上到底画成什么样"
# 只有设备能量：`packages/ui` 刻意不引 DOM 测试栈、移动端跑不了 Playwright。
# 把 `renderDuePanel === undefined ? panelContent` 那一支写成 `null`，web 全绿，
# 移动端与日历落点的胶囊一起变成死按钮 —— 2026-11-04 之前全仓没有任何判据渲染过它。
# 单测能证解析，证不了"真机上按下去，面板真的画出来"。
#
# 判据（每条都要能红；读不到树 = rc=2，**不算过**）：
#   ① 输入行三件都在树上：`capture-input` / `capture-due-capsule` / `capture-submit`
#   ② 空态胶囊的可及名是一整句「选择截止日期」，界面上不出现「未设置」
#   ③ 反向钉子：树上没有「实际标题」那一行（web 关、mobile 留 那种分叉不许回来）
#   ④ 点胶囊 ⇒ `capture-due-panel` 出现，且里面有月历 `date-picker`；
#      外壳那一档由 `mobile-capture-due-sheet` 在场与否**量出来**，不是计划里的一句理由
#   ④b 打了草稿之后，sheet 壳里必须有一个**带草稿原文的标题节点**在场
#      （节点不在树上 = 标题被 Yoga 量成 0 高，截图上是一条空白；web/jsdom 两侧看不见）
#   ⑤ 快捷四档都在（今天 / 明天 / 本周末 / 下周一）—— 少一档不会报错，只会静默少
#   ⑥ 点「时刻」⇒ 30 分步进列表在场（`capture-time-slots` + ≥1 枚 slot）
#      且「其它时间」「返回」两枚出口同时在
#   ⑥a 点两枚 slot（中间 + 最末）⇒ **面板自己**的时刻行接住那一枚的时刻
#      （底部面板是模态，开着时外层胶囊不在可及性树上 ⇒ 这一刻只能判面板内部）
#   ⑥b 收起面板 ⇒ 胶囊的可及名带着 ⑥a 那枚的时刻（证明面板内的反馈写回了字段）
#   ⑦ 点「返回」⇒ 回到日期视图（月历重新在场），列表那档消失
#   ⑧ 点快捷「明天」⇒ 胶囊可及名**换成带「明天」的那一句**（比的是"变了"，不是"非空"）
#
# 前置：远端宿主可达且有一台 booted 的模拟器；app 已装（`com.heyta`）。
#       要连装一起做：`APK=<path> bash scripts/verify-mobile-capture-android.sh`
#
# ⚠️ 语言：模拟器系统 locale 是 en-US，界面语言由**这个包**的 per-app locale 决定。
#    脚本自己判中英、两套 needle 全部来自 `packages/i18n`，不另写文案。
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${ANDROID_HOST:-linux-dev}"
SDK="${ANDROID_SDK_ON_HOST:-/home/xaiver/.local/opt/android-sdk}"
PKG="${PKG:-com.heyta}"
APK="${APK:-}"
OUT_DIR="${OUT_DIR:-$ROOT/apps/mobile/evidence/capture-due-capsule-android-$(date +%Y%m%d)}"
LOCAL_XML="$ROOT/.run-logs/android-capture/ui.xml"

mkdir -p "$OUT_DIR" "$(dirname "$LOCAL_XML")"

ok()   { printf '   ✅ %s\n' "$1"; }
bad()  { printf '   ❌ %s\n' "$1" >&2; }
info() { printf '   · %s\n' "$1"; }
step() { printf '\n── %s\n' "$1"; }

# 🔴 `-n` 是必需的，不是装饰：这一腿用 `while read … done <<EOF` 喂一串 resourceId，
#    不带 -n 的 ssh 会把 heredoc 剩下的 stdin 全吃掉，循环只跑第一轮 ——
#    上一轮因此把「最末一枚 slot 过了」读成了假绿（元规则一：先怀疑探针）。
rsh() { ssh -n -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "export PATH=$SDK/platform-tools:\$PATH; $*"; }

dump() {
  rm -f "$LOCAL_XML"
  # 🔴 不 dump 到 /sdcard 再 scp：这台宿主上 sshd 读不到 sdcardfs 挂载点，
  #    会"每一轮都认不出界面"而真因在取树这一步（元规则一：先怀疑探针）。
  rsh "adb shell uiautomator dump /data/local/tmp/heyta-cap.xml >/dev/null 2>&1"
  ssh -n -o BatchMode=yes "$HOST" "export PATH=$SDK/platform-tools:\$PATH; adb exec-out cat /data/local/tmp/heyta-cap.xml" > "$LOCAL_XML" 2>/dev/null || return 2
  [ -s "$LOCAL_XML" ] || return 2
  head -c 5 "$LOCAL_XML" | grep -q '<?xml' || return 2
}

# 0=在 / 1=不在 / 2=读不到树。三档必须分开：**"读不到"不能记成"没有"**。
have() {
  dump || return 2
  python3 - "$LOCAL_XML" "$1" <<'PY'
import sys, unicodedata, xml.etree.ElementTree as ET
path, needle = sys.argv[1], unicodedata.normalize("NFKC", sys.argv[2])
try: root = ET.parse(path).getroot()
except Exception: sys.exit(2)
for n in root.iter('node'):
    for attr in ('text', 'content-desc'):
        if needle in unicodedata.normalize("NFKC", n.get(attr, '')): sys.exit(0)
sys.exit(1)
PY
}

# 按 testID（resource-id）找节点。⚠️ 两种形状都认：RN 有的版本给裸名，
# 有的给 `<pkg>:id/<name>` —— 只按一种匹配会把"存在"读成"不存在"。
by_id() {
  dump || return 2
  python3 - "$LOCAL_XML" "$1" <<'PY'
import sys, re, xml.etree.ElementTree as ET
path, want = sys.argv[1], sys.argv[2]
try: root = ET.parse(path).getroot()
except Exception: sys.exit(2)
def rid(n):
    v = n.get('resource-id', '')
    return v.rsplit('/', 1)[-1] if v else v
for node in root.iter('node'):
    if rid(node) == want:
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            print(f'{x1} {y1} {x2-x1} {y2-y1}')
            sys.exit(0)
sys.exit(1)
PY
}

# 某个 testID 节点的可及名（content-desc，空则退回 text）
desc_of() {
  dump || return 2
  python3 - "$LOCAL_XML" "$1" <<'PY'
import sys, xml.etree.ElementTree as ET
path, want = sys.argv[1], sys.argv[2]
try: root = ET.parse(path).getroot()
except Exception: sys.exit(2)
def rid(n):
    v = n.get('resource-id', '')
    return v.rsplit('/', 1)[-1] if v else v
for node in root.iter('node'):
    if rid(node) == want:
        print((node.get('content-desc') or node.get('text') or '').strip()); sys.exit(0)
sys.exit(1)
PY
}

# resource-id 优先，其次 content-desc/text —— 与网页端同一句"一个目的地一个控件"
tap_id() {
  local f; f="$(by_id "$1")" || return 1
  [ -n "$f" ] || return 1
  set -- $f
  rsh "adb shell input tap $(( $1 + $3 / 2 )) $(( $2 + $4 / 2 ))" >/dev/null 2>&1
}

tap_text() {
  dump || return 2
  local xy
  xy="$(python3 - "$LOCAL_XML" "$1" <<'PY'
import sys, re, xml.etree.ElementTree as ET
path, want = sys.argv[1], sys.argv[2]
root = ET.parse(path).getroot()
for n in root.iter('node'):
    if want in (n.get('content-desc', ''), n.get('text', '')):
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds', ''))
        if m:
            x1, y1, x2, y2 = map(int, m.groups()); print((x1+x2)//2, (y1+y2)//2); sys.exit(0)
sys.exit(1)
PY
)" || return 1
  # shellcheck disable=SC2086
  rsh "adb shell input tap $xy" >/dev/null 2>&1
}

shot() {
  if ssh -n -o BatchMode=yes "$HOST" "export PATH=$SDK/platform-tools:\$PATH; adb exec-out screencap -p" > "$OUT_DIR/$1" 2>/dev/null && [ -s "$OUT_DIR/$1" ]; then
    info "截图 → $OUT_DIR/$1"
  else
    bad "截图没落下来（$OUT_DIR/$1）"
  fi
}

FAILED=0
# 「没有被证明」的格数：不稳定通道那一格不算红也不算过，但必须被数出来（§9.34）。
UNJUDGED=0
expect_have()   { have "$1" >/dev/null;   local rc=$?; [ "$rc" = 0 ] && ok "$2" || { bad "$2（rc=${rc}）"; FAILED=$((FAILED+1)); }; }
expect_absent() { have "$1" >/dev/null;   local rc=$?; [ "$rc" = 1 ] && ok "$2" || { bad "$2（rc=${rc}：0=还在，2=读不到树）"; FAILED=$((FAILED+1)); }; }

pick_locale() {
  local en=0 zh=0
  have "New task" >/dev/null && en=1
  have "新建任务" >/dev/null && zh=1
  have "Today"    >/dev/null && en=1
  have "今天"      >/dev/null && zh=1
  # 🔴 首启那两枚面板本身也分中英，而**刚装完的包一定停在那一屏** ——
  #    只认底部标签的话， readiness 那一轮会"20 轮认不出界面"，
  #    看起来像产品坏了，其实是探针没覆盖首启屏（实测撞过一次）。
  have "Agree and connect"  >/dev/null && en=1
  have "同意并联网"           >/dev/null && zh=1
  have "Use offline for now" >/dev/null && en=1
  have "只用本机"             >/dev/null && zh=1
  # 欢迎页那一屏（隐私选择已记住时，重装后直接落在这里）
  have "先离线使用"           >/dev/null && zh=1
  if [ "$en" = 1 ] && [ "$zh" = 1 ]; then bad "同一屏上中英 needle 都在 ⇒ 判不了语言"; return 1; fi
  if   [ "$en" = 1 ]; then UI=en
  elif [ "$zh" = 1 ]; then UI=zh
  else bad "中英 needle 都没看到 ⇒ 判不了界面语言（这一屏不是预期的那一屏）"; return 1; fi
  if [ "$UI" = en ]; then
    T_NEW="New task"; CAPSULE_EMPTY="Choose a due date"; PANEL_TITLE="Choose a due date"
    ADD="Add"; TIME_ROW="Due time for this new task (leave empty for all day)"
    OTHER="Other time"; BACK_LIST="List"; BACK_DAY="Back"
    QP=("Today" "Tomorrow" "This weekend" "Next Monday")
    NAIL="Actual title"
    OFFLINE="Use offline for now"; AGREE="Agree and connect"
  else
    T_NEW="新建任务"; CAPSULE_EMPTY="选择截止日期"; PANEL_TITLE="选择截止日期"
    ADD="添加"; TIME_ROW="这条新任务的截止时刻（留空表示全天）"
    OTHER="其它时间"; BACK_LIST="列表"; BACK_DAY="返回"
    QP=("今天" "明天" "本周末" "下周一")
    NAIL="实际标题"
    OFFLINE="只用本机"; AGREE="同意并联网"
  fi
  local sysloc; sysloc="$(rsh "adb shell getprop ro.product.locale" | tr -d '\r')"
  info "界面语言 = ${UI}（系统 locale = ${sysloc}；UI 是 app 自己的偏好，不等于系统）"
}

# 首启**两屏**都要过：① 隐私同意面板（同意并联网 / 只用本机），② 欢迎页（注册登录 / 先离线使用）。
# 两支都走**离线**那一侧 —— 这一腿不发请求、不需要服务端，
# 联网那一支会把下一步变成"要账号"，那是另一条腿的前置。
#
# 🔴 实测形状（2026-11-04）：`pm clear`/重装之后先弹隐私面板，点完**再**落到欢迎页，
#    两屏的出口措辞不同（「只用本机」 vs 「先离线使用」），只过一屏会卡在第二屏，
#    报出来是"点不到新建任务"—— 看着像产品坏了，真因是探针少覆盖一屏（元规则一）。
pass_first_launch() {
  local i moved=0
  for i in 1 2 3 4 5 6 7 8; do
    if by_id welcome-offline >/dev/null 2>&1; then
      tap_id welcome-offline || { bad "认得出 welcome-offline 但点不到"; return 1; }
      sleep 3; ok "已过欢迎页（走 welcome-offline 这枚 resource-id）"; moved=1; continue
    fi
    if have "$OFFLINE" >/dev/null; then
      tap_text "$OFFLINE" || { bad "认得出「${OFFLINE}」但点不到"; return 1; }
      sleep 3; ok "已点隐私面板的「${OFFLINE}」"; moved=1; continue
    fi
    if have "$AGREE" >/dev/null; then
      tap_text "$AGREE" || { bad "认得出「${AGREE}」但点不到"; return 1; }
      sleep 3; ok "隐私面板上没有离线出口，改点「${AGREE}」"; moved=1; continue
    fi
    return 0
  done
  bad "八轮之后仍停在首启某屏（moved=${moved}）"; return 1
}

echo "════ 移动端「一句话捕获」日期胶囊 + 面板 · Android 设备腿 ════"
echo "   宿主 $HOST · $(rsh 'adb shell wm size | tr -d "\r"' 2>/dev/null) · 证据 $OUT_DIR"

command -v python3 >/dev/null || { bad "本机没有 python3"; exit 1; }
rsh "adb get-state" >/dev/null 2>&1 || { bad "远端 $HOST 上没有可达的模拟器"; exit 1; }

if [ -n "$APK" ]; then
  [ -f "$APK" ] || { bad "APK 不存在：$APK"; exit 1; }
  # 🔴 判"传过去了没有"**不许用 `scp` 的退出码**。实测（2026-11-05）：
  #    70 MB 那枚 scp 收尾时连接被断，`scp -q` 退非零、脚本报「APK 传不上去」，
  #    而远端 `/tmp/heyta-cap.apk` 大小与 sha256 **与本地逐字相同** —— 传输是成功的。
  #    把传输退出码当产物正确性，会在一枚好包上报出假失败，
  #    反过来也能在一次真截断上报出假成功（scp 未必每次都报错）。
  #    所以这里改成：**传 → 远端算 sha → 与本地逐字对**，对不上才停。
  LOCAL_SHA=$(shasum -a 256 "$APK" | cut -d' ' -f1)
  # 实测这条 70 MB 的链路会**间歇性**传不完（2026-11-05 两次：一次收尾断连、一次直接没写）。
  # 重试一次，成败仍只按落地端 sha 判 —— 传输退出码不参与结论（#643）。
  scp -q "$APK" "$HOST:/tmp/heyta-cap.apk" 2>/dev/null \
    || scp -q "$APK" "$HOST:/tmp/heyta-cap.apk" 2>/dev/null
  REMOTE_SHA=$(ssh -n -o BatchMode=yes "$HOST" 'sha256sum /tmp/heyta-cap.apk 2>/dev/null | cut -d" " -f1' | tr -d '\r')
  if [ "$REMOTE_SHA" != "$LOCAL_SHA" ]; then
    bad "APK 没传对：本地 sha256=${LOCAL_SHA:0:16}… 远端=${REMOTE_SHA:0:16}…（scp 退码不可信，这里只认 sha）"
    exit 1
  fi
  info "APK 传输已按 sha256 逐字对账（${LOCAL_SHA:0:16}…）"
  rsh "adb uninstall $PKG" >/dev/null 2>&1
  rsh "adb install -r -d /tmp/heyta-cap.apk" 2>&1 | tail -1 | sed 's/^/   /'
  info "已从当前产物重装（$(wc -c < "$APK" | tr -d ' ') 字节）"
fi

RUN_HEAD="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
# 🔴 出处由装置自己落盘（文末 `provenance.txt`），不靠人抄：HEAD 之外工作树里还混着
#    别线未提交的行，只记 SHA 回答不了"这读数是哪一棵树跑出来的"。`RUN_INPUT` 是
#    这条腿真正读到的那批源文件的逐字节指纹，改任何一枚它都会变。
RUN_INPUT="$(git -C "$ROOT" status --porcelain -- packages/ui/src/capture packages/ui/src/overlay apps/mobile/src apps/web/src/features/capture packages/i18n/src/locales 2>/dev/null | sha256sum | cut -d' ' -f1)"
RUN_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

step "0. 起 app，等到认得出界面"
rsh "adb shell am force-stop $PKG" >/dev/null 2>&1
rsh "adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
READY=""
for i in $(seq 1 20); do
  sleep 3
  dump >/dev/null 2>&1 || continue
  if have "新建任务" >/dev/null || have "New task" >/dev/null \
     || have "只用本机" >/dev/null || have "Use offline for now" >/dev/null \
     || have "同意并联网" >/dev/null || have "Agree and connect" >/dev/null \
     || have "先离线使用" >/dev/null; then READY=1; break; fi
done
[ -n "$READY" ] || { bad "20 轮（约 60s）后仍认不出任何已知界面 ⇒ 停（这一腿不替'读不到树'开绿灯）"; exit 1; }
ok "界面已就绪（轮询 ${i} 轮）"
pick_locale || exit 1
pass_first_launch || exit 1

step "1. 打开「新建任务」面板"
if ! by_id mobile-capture >/dev/null 2>&1; then
  tap_text "$T_NEW" || { bad "点不到「${T_NEW}」"; exit 1; }
  sleep 3
fi

step "2. 判据 ①②③ —— 输入行三件、空态胶囊、旧预览行不许回来"
for id in capture-input capture-due-capsule capture-submit; do
  f="$(by_id "$id")"; rc=$?
  if [ "$rc" = 0 ]; then ok "输入行里有 ${id}（bounds=($f)）"
  elif [ "$rc" = 2 ]; then bad "读不到 UI 树 ⇒ $id 这一条没有被证明"; FAILED=$((FAILED+1))
  else bad "输入行里没有 $id —— 三件套缺了一枚"; FAILED=$((FAILED+1)); fi
done
aria="$(desc_of capture-due-capsule)"; rc=$?
if [ "$rc" = 0 ] && [ "$aria" = "$CAPSULE_EMPTY" ]; then ok "空态胶囊的可及名是一整句「${aria}」"
else bad "空态胶囊可及名不是预期的那句（读到「${aria}」，rc=${rc}）"; FAILED=$((FAILED+1)); fi
expect_absent "未设置" "界面上没有「未设置」这类审计腔"
expect_absent "$NAIL" "树上没有「${NAIL}」那一行（与 web 同一档）"
shot "01-row-empty.png"

step "2.5 打一句草稿 —— 下一格要判「壳说的话里有没有这句话」"
# ⚠️ 用 ASCII 且**不带空格**：`adb shell input text` 打不进中文（本线在册坑），
#    而空格要写成 `%s` 才能穿过两层 shell —— 上一版用 `review notes` 时字根本没进去，
#    读回来的是 placeholder「新任务标题」，把下面两格一起顶成假红（元规则一：先怀疑探针）。
DRAFT="reviewnotes"
# 🔴 **前置信号用「添加」那枚按钮的 `enabled`，不用输入框的 `text`。**
#    实测（2026-11-05，同一枚 APK、同一个状态）：打字进去之后 `capture-input` 的
#    `text` 仍然是那句提示语，而按「添加」却建出了一条标题就是所打字串的任务 ——
#    也就是说 `text` 在这一层会**说谎**（值在 React 状态里、在原生编辑器里，就是不在可及性树上）。
#    共享层有一条在册契约"标题为空时禁用提交"，它落成 Android 的 `enabled=false`，
#    于是"草稿进没进"有一个不会说谎的读法：`enabled` 从 false 翻成 true。
#    ⚠️ 打字通道本身在这台模拟器上仍然时好时坏（`input text` / `keyboard text` / 逐字符
#    `keyevent` 三种形式实测都有不进的趟），所以这里**按 `enabled` 重试**，
#    并把每一轮的 `enabled` 读数打出来；始终翻不过来就响亮记"未判定"（不算过也不算红）。
submit_enabled() { by_id capture-submit >/dev/null 2>&1 || return 2; dump || return 2; python3 - "$LOCAL_XML" <<'PY'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
def rid(n):
    v = n.get('resource-id', ''); return v.rsplit('/', 1)[-1] if v else v
n = next((n for n in root.iter('node') if rid(n) == 'capture-submit'), None)
print('' if n is None else n.get('enabled', ''))
PY
}
# 🔴 三种注入形式**轮着试**，而不是同一形式重试五次：
#    实测这一台模拟器上 `input text` 有时进、有时整串丢；`input keyboard text` 与
#    逐字符 `keyevent` 也各有成功的趟。哪个进了由 `enabled` 那把尺判，不由形式自己声明。
type_keyevent_word() { # 只覆盖 a-z（本格的草稿就是这几个字母）
  local c code out=""
  for (( i=0; i<${#1}; i++ )); do
    c="${1:i:1}"
    code=$(printf '%d' "'$c")            # 小写字母的 ASCII
    out="$out $(( code - 97 + 29 ))"     # a→KEYCODE_A(29) … z→54
  done
  for code in $out; do rsh "adb shell input keyevent $code" >/dev/null 2>&1; done
}
DRAFT_OK=""
DRAFT_FORM=""
TAP_BROKE=""
EN=""
for _r in 1 2 3 4 5 6; do
  tap_id capture-input >/dev/null 2>&1 || { TAP_BROKE=1; bad "第 ${_r} 轮取不到输入框（载体/树读不到）"; FAILED=$((FAILED+1)); break; }
  sleep 2
  case $(( _r % 3 )) in
    1) rsh "adb shell input text $DRAFT" >/dev/null 2>&1; FORM="input text" ;;
    2) rsh "adb shell input keyboard text \"$DRAFT\"" >/dev/null 2>&1; FORM="input keyboard text" ;;
    0) type_keyevent_word "$DRAFT"; FORM="逐字符 keyevent" ;;
  esac
  sleep 2
  EN=$(submit_enabled || true)
  info "第 ${_r} 轮（${FORM}）：capture-submit enabled=${EN:-读不到}"
  if [ "$EN" = "true" ]; then DRAFT_OK=1; DRAFT_FORM="$FORM"; break; fi
done
if [ -n "$DRAFT_OK" ]; then
  ok "草稿进得去（${DRAFT_FORM}，第 ${_r} 轮把 enabled 从 false 翻成 true）——「标题为空时禁用提交」那条契约同时在真机上被量到"
elif [ -n "$TAP_BROKE" ]; then
  # 🔴 这一格**没被判定**，而且原因不是打字：连输入框都取不到 = 载体/树读不到。
  #    把它写成"打字通道没打通"会把一次网络故障记成产品事实（元规则一）。
  UNJUDGED=$((UNJUDGED + 1))
  info "④b-2 **未判定**：第 ${_r} 轮就取不到输入框（载体或树读不到，非打字通道）⇒ 这一格没有被证明"
else
  UNJUDGED=$((UNJUDGED + 1))
  info "④b-2 **未判定**：${_r} 轮把三种注入形式都试过，enabled 仍是 false ⇒ 这一格没有被证明"
fi

step "3. 判据 ④ —— 点胶囊，面板就地展开"
tap_id "capture-due-capsule" || { bad "胶囊点不到（resource-id 没落进树上？）"; exit 1; }
sleep 2
if dump >/dev/null 2>&1; then
  python3 - "$LOCAL_XML" <<'PY'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
def rid(n):
    v = n.get('resource-id', ''); return v.rsplit('/', 1)[-1] if v else v
ids = {rid(n) for n in root.iter('node') if rid(n)}
want = ('capture-due-panel', 'date-picker')
missing = [w for w in want if w not in ids]
sys.exit(1 if missing else 0)
PY
  rc=$?
else rc=2; fi
if [ "$rc" = 0 ]; then ok "面板出现且里面有月历（capture-due-panel + date-picker 都在树上）"
else bad "点胶囊后面板或月历不在树上（rc=${rc}）—— 就地展开那一支没接上"; FAILED=$((FAILED+1)); fi
# 🔴 外壳本身也要量，不能只量内容：内容在树上 ≠ 宿主给的那层壳在场。
#    这一格把"移动端走哪一档外壳"变成**读数**，而不是计划里的一句理由（§9.6）。
if by_id mobile-capture-due-sheet >/dev/null 2>&1; then
  ok "外壳那一档 = BottomSheet（mobile-capture-due-sheet 在树上）"
elif have "$PANEL_TITLE" >/dev/null; then
  info "外壳那一档 = 就地展开（没有 sheet 壳，但面板标题在场）"
else
  bad "既没有 sheet 壳、也读不到面板标题 ⇒ 外壳那一档没接上"; FAILED=$((FAILED+1))
fi

# 🔴 判据 ④b —— 壳起来之后，**壳自己必须说出正在改哪句话**。
#    这一格不是装饰：模态起来后输入行既被盖住又不在树上，标题是唯一还能说话的地方
#    （§9.6 当初就因为它撤过壳）。判"标题节点在不在"而不是"标题非空"，因为
#    Yoga 把"自动高度列容器里 flex:1 的孩子"量成 0 高 ⇒ 节点整棵从树上掉出去，
#    截图上是一条空白，而 web/jsdom 两侧全绿（CSS 引擎不塌）。
if by_id mobile-capture-due-sheet >/dev/null 2>&1; then
  TITLE_READ=$(python3 - "$LOCAL_XML" "$DRAFT" "$PANEL_TITLE" <<'PY'
import sys, re, xml.etree.ElementTree as ET
path, draft, static_title = sys.argv[1], sys.argv[2], sys.argv[3]
root = ET.parse(path).getroot()
def rid(n):
    v = n.get('resource-id', ''); return v.rsplit('/', 1)[-1] if v else v
def top(n):
    m = re.match(r'\[\d+,(\d+)\]\[\d+,(\d+)\]', n.get('bounds', ''))
    return int(m.group(1)) if m else 10 ** 9
sheet = next((n for n in root.iter('node') if rid(n) == 'mobile-capture-due-sheet'), None)
if sheet is None:
    print('NOSHELL|'); sys.exit(0)
scroll = min((top(n) for n in sheet.iter('node') if n.get('class') == 'android.widget.ScrollView'),
             default=10 ** 9)
# 头部那一带 = 壳里、滚动区之上、有可见文字的节点。
# 🔴 零面积的节点 uiautomator 直接不收，所以"这一带有节点"就等于"标题画出来了"。
band = [n for n in sheet.iter('node')
        if (n.get('text') or '').strip() and top(n) < scroll]
if not band:
    print(f'BAND|scroll={scroll}'); sys.exit(0)
n = min(band, key=top)
words = n.get('text') or ''
has_draft = 'DRAFT_YES' if draft in words else 'DRAFT_NO'
has_static = 'STATIC_YES' if static_title in words else 'STATIC_NO'
print(f'HEAD|{n.get("bounds")}|{has_draft}|{has_static}|{words!r}|带内节点={len(band)}')
PY
) || TITLE_READ=""
  case "$TITLE_READ" in
    HEAD*)
      # ④b-1：标题这一带有画出来的节点 ⇒ 壳在说话（Yoga 塌成 0 高时这里整条是空的）
      ok "壳的标题带画得出来：${TITLE_READ#HEAD|}"
      case "$TITLE_READ" in
        *DRAFT_YES*) ok "标题带着此刻那句话：${TITLE_READ##*|}" ;;
        *) if [ -n "$DRAFT_OK" ]; then
             bad "草稿进去了而标题是「$(printf '%s' "$TITLE_READ" | cut -d'|' -f5)」，不含 ${DRAFT} ⇒ 壳没说用户在改哪句话"; FAILED=$((FAILED+1))
           else
             info "标题那句话那一格**没判**：2.5 的草稿没进去（前提不成立，不算过也不算红）"
           fi ;;
      esac
      ;;
    BAND*) bad "壳里、滚动区之上读不到任何可见文字节点（${TITLE_READ}）⇒ 标题没画出来：模态起来后输入行既被盖住又不在树上，标题是唯一还能说话的地方"; FAILED=$((FAILED+1)) ;;
    *) bad "标题那一格没读到东西（「${TITLE_READ}」）⇒ 这一格没有被证明"; FAILED=$((FAILED+1)) ;;
  esac
fi
for label in "${QP[@]}"; do
  expect_have "$label" "快捷档「${label}」在面板里"
done
expect_have "$PANEL_TITLE" "面板带着自己的标题"
shot "02-panel-inline.png"

step "4. 判据 ⑥ —— 时刻子视图：30 分步进列表 + 两枚出口"
f="$(by_id capture-time-row)"; rc=$?
if [ "$rc" != 0 ]; then bad "面板里没有「时刻」那一行（rc=${rc}）"; FAILED=$((FAILED+1)); else
  tap_id capture-time-row; sleep 2
  dump >/dev/null 2>&1
  SLOTS=$(python3 - "$LOCAL_XML" <<'PY'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
def rid(n):
    v = n.get('resource-id', ''); return v.rsplit('/', 1)[-1] if v else v
print(sum(1 for n in root.iter('node') if rid(n).startswith('capture-time-slot-')))
PY
) || SLOTS=ERR
  if [ "$SLOTS" != "ERR" ] && [ "$SLOTS" -ge 48 ]; then ok "步进列表在场，实测 ${SLOTS} 枚 slot（全天 + 48 个半点）"
  else bad "步进列表只有 ${SLOTS} 枚 slot —— 30 分一档的列表没画全"; FAILED=$((FAILED+1)); fi
  expect_have "$OTHER" "「${OTHER}」出口在场（非整半点填得进去）"
  expect_have "$BACK_DAY" "「${BACK_DAY}」出口在场（进得去也出得来）"
  shot "03-time-slots.png"

  # 🔴 **在场 ≠ 点得到**。web 那侧为这件事翻过一次案（§9.2 第 4 条：面板"没越视口"是绿的，
  #    而底边那两条的 × 压在底部导航下面，用户点不到）。
  #    这里挑**两枚**点：一枚中间、一枚最末（y 最大）。两枚都点不动 ⇒ 是探针的坐标算法错；
  #    只有最末那枚点不动 ⇒ 是产品的位置性问题。**只测一枚分不出这两种**。
  # 🔴 进子视图后**第一下会被吞**（实测：中间那枚红、随后最末那枚反而过 —— 位置解释不了这个顺序）。
  #    所以这里不是"加个 sleep 让它过"就算完：先把树读到**连续两次一致**再点，
  #    并把"等到第几轮"打出来。等不到稳定就响亮失败，
  #    否则这条判据永远在测"动画有没有结束"，而不是测"slot 点不点得到"。
  STABLE=""
  PREV=""
  for _w in 1 2 3 4 5 6 7 8; do
    dump >/dev/null 2>&1 || break
    NOW=$(python3 - "$LOCAL_XML" <<'PY'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
def rid(n):
    v = n.get('resource-id', ''); return v.rsplit('/', 1)[-1] if v else v
print('|'.join(sorted(rid(n) + n.get('bounds', '') for n in root.iter('node')
                     if rid(n).startswith('capture-time-slot-'))))
PY
)
    if [ -n "$PREV" ] && [ "$NOW" = "$PREV" ]; then STABLE="$_w"; break; fi
    PREV="$NOW"; sleep 1
  done
  if [ -z "$STABLE" ]; then
    bad "时刻子视图的树八轮都没稳定 ⇒ 这一格在测动画而不是测可点性，停"; FAILED=$((FAILED+1))
  else
    info "子视图树在第 ${STABLE} 轮稳定后才开始点"
  fi
  PICK=$(python3 - "$LOCAL_XML" <<'PY'
import sys, re, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
def rid(n):
    v = n.get('resource-id', ''); return v.rsplit('/', 1)[-1] if v else v
rows = []
for n in root.iter('node'):
    i = rid(n)
    if i.startswith('capture-time-slot-') and i != 'capture-time-slot-all-day':
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds', ''))
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            rows.append((y1, i, (x1 + x2) // 2, (y1 + y2) // 2))
if len(rows) < 2:
    sys.exit(1)
rows.sort()
print(f"mid {rows[len(rows) // 2][1]} {rows[len(rows) // 2][2]} {rows[len(rows) // 2][3]}")
print(f"last {rows[-1][1]} {rows[-1][2]} {rows[-1][3]}")
PY
) || PICK=""
  if [ -z "$PICK" ]; then
    bad "读不到至少两枚具体时刻 slot ⇒ 没法分'探针坐标错'与'末行点不到'"; FAILED=$((FAILED+1))
  else
    # 🔴 **两阶段的第 1 阶段（面板内部即时反馈）**。底部面板是 `accessibilityViewIsModal`
    #    的模态：面板开着时外层胶囊整棵从可及性树里掉出去（这是模态的正确行为，不是缺陷），
    #    所以这一刻 `desc_of capture-due-capsule` **注定读不到** —— 拿它当判据会得到一句
    #    "点不到也红、点得到也红"的断言。面板自己那行的文字还在树上，所以判它：
    #    回日期视图 → 读 `capture-time-value`（那格的可见文字就是当前时刻）。
    #    判的是**这枚 slot 自己的时刻**，不是"有没有值"：两枚连着点，第一枚一点就把值填上了，
    #    此后"非空"这一条再也分不出第二枚点没点动（元规则二）。
    LAST_WANT=""
    while read -r tag sid sx sy; do
      [ -n "${tag:-}" ] || continue
      WANT="${sid#capture-time-slot-}"
      rsh "adb shell input tap $sx $sy" >/dev/null 2>&1; sleep 2
      tap_text "$BACK_DAY" >/dev/null 2>&1; sleep 2
      VAL=$(desc_of capture-time-value || true)
      if printf '%s' "$VAL" | grep -q -- "$WANT"; then
        ok "${tag} 那枚 ${sid}（y=${sy}）点得到，面板的时刻行接住了：「${VAL}」"
        LAST_WANT="$WANT"
      else
        bad "${tag} 那枚 ${sid}（y=${sy}）点了而面板的时刻行是「${VAL}」（没出现 ${WANT}）⇒ 在场但点不到"; FAILED=$((FAILED+1))
      fi
      # 下一枚要点，得先回时刻子视图：日期视图的出口段是「时刻 …」那一行。
      tap_id capture-time-row >/dev/null 2>&1; sleep 2
    done <<EOF
$PICK
EOF
    shot "03b-slots-tapped.png"

    # 🔴 两阶段判据的"能红"证明之一：第 1 阶段没有第 2 阶段那种"读不到"的退路，
    #    它红就是真红（点不到 / 没写进面板状态）。第 2 阶段在 5.5 收口。
    [ -n "$LAST_WANT" ] || { bad "两阶段的第 1 阶段一次都没接住 ⇒ 后面没法判写回"; FAILED=$((FAILED+1)); }
  fi

  step "5. 判据 ⑦ —— 点「${BACK_DAY}」回日期视图"
  tap_text "$BACK_DAY"; sleep 2
  dump >/dev/null 2>&1
  if python3 - "$LOCAL_XML" <<'PY'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
def rid(n):
    v = n.get('resource-id', ''); return v.rsplit('/', 1)[-1] if v else v
ids = {rid(n) for n in root.iter('node') if rid(n)}
sys.exit(0 if ('date-picker' in ids and not any(i.startswith('capture-time-slot-') for i in ids)) else 1)
PY
  then ok "回到日期视图（月历在场、slot 列表消失）"
  else bad "点「${BACK_DAY}」没回到日期视图"; FAILED=$((FAILED+1)); fi

  step "5.5 判据 ⑥b —— 收起底部面板后，胶囊必须念出面板里那个值（两阶段的第 2 阶段）"
  #    第 1 阶段只证"面板显示对了"，这一阶段证**它写回了收集框的字段** —— 产品持久化的
  #    是胶囊那句。两步都过，"点一格 ⇒ 值进胶囊"这条链才闭合。
  #    收起走系统返回键（表里 popover 那档 `systemBack = dismiss`），顺带把这一格也量了。
  if [ -n "${LAST_WANT:-}" ]; then
    if by_id mobile-capture-due-sheet >/dev/null 2>&1; then
      rsh "adb shell input keyevent KEYCODE_BACK" >/dev/null 2>&1; sleep 2
      if by_id mobile-capture-due-sheet >/dev/null 2>&1; then
        bad "按返回键没收起底部面板 ⇒ 胶囊这一刻还在模态后面，第 2 阶段判不了"; FAILED=$((FAILED+1))
      else
        ok "系统返回键收得起这一档（popover 的 systemBack=dismiss 在真机上落地）"
      fi
    else
      info "树上已无 sheet 壳 ⇒ 面板此前已收起，直接读胶囊"
    fi
    CAP2=$(desc_of capture-due-capsule || true)
    if printf '%s' "$CAP2" | grep -q -- "$LAST_WANT"; then
      ok "胶囊可及名「${CAP2}」带着收起前那格的 ${LAST_WANT}"
    else
      bad "收起面板后胶囊是「${CAP2}」（没出现 ${LAST_WANT}）⇒ 面板内反馈没有写回字段"; FAILED=$((FAILED+1))
    fi
    shot "03c-sheet-dismissed.png"
  else
    bad "第 4 节没有任何一次成功的 slot 点击 ⇒ 第 2 阶段没有可回读的值（先修第 1 阶段）"; FAILED=$((FAILED+1))
  fi
fi

step "6. 判据 ⑧ —— 选一天，胶囊从**上一个值**变成带「${QP[1]}」的那句"
# 🔴 这一条**不能**再和"空态那句"比：上一节已经把两枚时刻真的点进去了
#    （旧形状里它们静默无效，所以"≠ 空态"当时就够）。现在胶囊早就带值，
#    再拿 CAPSULE_EMPTY 当参照就是一句**点不到也会绿**的断言（元规则二）。
BEFORE="$(desc_of capture-due-capsule)"
# 面板已在 5.5 收起；快捷档住在面板里，所以先由胶囊把它打开 —— 这一步顺带证明
# "胶囊自己是 reopening 的入口"，而不是只有第一次点才有效。
tap_id capture-due-capsule || { bad "点胶囊打不开面板（收起后再点没反应？）"; FAILED=$((FAILED+1)); }
sleep 2
tap_text "${QP[1]}"; sleep 2
# 快捷档不关闭面板（`pick()` 只写覆盖），所以这里再收一次才读得到胶囊。
if by_id mobile-capture-due-sheet >/dev/null 2>&1; then
  rsh "adb shell input keyevent KEYCODE_BACK" >/dev/null 2>&1; sleep 2
fi
aria="$(desc_of capture-due-capsule)"; rc=$?
if [ "$rc" = 0 ] && [ "$aria" != "$BEFORE" ] && printf '%s' "$aria" | grep -q -- "${QP[1]}"; then
  ok "胶囊可及名「${BEFORE}」→「${aria}」（换了日子，值也进了可及名）"
else
  bad "点「${QP[1]}」后胶囊仍是「${aria}」（点之前是「${BEFORE}」，rc=${rc}）⇒ 这一条没有可及名变化"; FAILED=$((FAILED+1))
fi
shot "04-capsule-picked.png"

# 🔴 出处件：没有它，这堆 PNG 与一段散文之间没有任何可核对的关系。
#    共享工作树里 HEAD 之外还混着别线未提交的行 ⇒ 只记 SHA 回答不了
#    "这读数是哪一棵树跑出来的"，所以连输入面指纹一起落盘。
{
  printf 'head=%s\n' "$RUN_HEAD"
  printf 'input_digest=%s\n' "$RUN_INPUT"
  printf 'started_utc=%s\n' "$RUN_STARTED"
  printf 'finished_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'apk_sha256=%s\n' "${LOCAL_SHA:-unknown}"
  printf 'device=%s\n' "$(rsh "adb shell getprop ro.product.model" | tr -d '\r')"
  printf 'failed=%s\n' "$FAILED"
  printf 'unjudged=%s\n' "$UNJUDGED"
} > "$OUT_DIR/provenance.txt"
if [ -s "$OUT_DIR/provenance.txt" ] && grep -q '^head=' "$OUT_DIR/provenance.txt"; then
  ok "出处件已落盘（head=$(printf '%.12s' "$RUN_HEAD")…，输入指纹 ${RUN_INPUT:0:12}…）"
else
  bad "出处件缺失或为空 ⇒ 这趟读数对应不到任何一棵树，不算跑过"; FAILED=$((FAILED+1))
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "✅ 移动端捕获胶囊这一腿全过（证据 ${OUT_DIR}）"
  [ "$UNJUDGED" -eq 0 ] || echo "   ⚠️ 其中 ${UNJUDGED} 格**没有被证明**（通道不稳定，见日志里的「未判定」行与计划 §9.34）"
  exit 0
fi
echo "🔴 移动端捕获这一腿有 ${FAILED} 格没过、${UNJUDGED} 格未判定（证据 ${OUT_DIR}）"
exit 1
