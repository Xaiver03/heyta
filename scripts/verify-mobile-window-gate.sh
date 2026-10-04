#!/bin/bash
#
# 移动端 / 四端交付的**开工窗口闸门**（默认只体检不执行）
# ======================================================
#
# 🔴 为什么要它：B（四端重装）与 C（截止时刻的设备验收）这两件事**能不能开跑**
# 完全由现场决定 —— 负载、别的并行验收、工作树里有没有别人未提交的源码、APK 是不是
# 当前源码打出来的、服务端和凭据在不在。这些读数每小时都在变，写进文档就过期
# （本仓库实测过：同一条"负载 16–35"在三小时内变成 73）。所以把判据落成一条命令，
# 谁要开跑就先跑它，而不是谁记忆好。
#
# 用法：
#   bash scripts/verify-mobile-window-gate.sh --target b
#   bash scripts/verify-mobile-window-gate.sh --target c
#   加 --confirm 才真的执行（默认 dry-run，只打印将要执行的命令与现量读数）
#
# 退出码（**三种必须分开**，混成一个数字就没法判断该干什么）：
#   0 = 窗口开着（dry-run 时 = 全部前置满足；--confirm 时 = 被执行的那条命令自己退出 0）
#   1 = 用法错（没给 --target，或给了不认识的 target）
#   3 = 现场不成立（环境/负载/撞车/产物旧）—— **不是产品失败**，等窗口再来
set -u
export PATH="/opt/homebrew/bin:$PATH"

TARGET=''
CONFIRM=0
REPO=''
while [ $# -gt 0 ]; do
  case "$1" in
    --target)   TARGET="${2:-}"; shift 2 ;;
    --target=*) TARGET="${1#*=}"; shift ;;
    --confirm)  CONFIRM=1; shift ;;
    --repo)     REPO="${2:-}"; shift 2 ;;
    *) echo "❌ 不认识的参数：$1" >&2; echo "   用法：--target b|c [--confirm]" >&2; exit 1 ;;
  esac
done

if [ -z "$TARGET" ]; then
  echo "❌ 缺 --target（b = 四端重装；c = 截止时刻的设备验收）" >&2
  exit 1
fi
case "$TARGET" in
  b|c) ;;
  *) echo "❌ --target 只认 b 或 c，收到的是 '$TARGET'" >&2; exit 1 ;;
esac

# 仓库根：脚本可能从任何 cwd 跑（`cd scripts && bash …`），而里面的判据全是
# 相对路径 + 绝对路径混合，根算错会得到"前置全绿但跑的是另一棵树"。
if [ -z "$REPO" ]; then
  REPO="$(cd "$(dirname "$0")/.." && pwd)"
fi
cd "$REPO" || { echo "❌ 进不去仓库根：$REPO" >&2; exit 1; }
# 🔴 cd 成功后立刻把 REPO 换成绝对路径：调用方给的是相对路径时（`--repo ../heyta-wt-r14c`，
#    实测 07:0x 真撞上过），`cd` 明明成功了，而下面那句比对里 GIT_TOP 永远是 git 给的绝对路径 ⇒
#    一条**合法**的调用被判成"脚本推导的根与 git 根不一致"并 exit 1 —— 症状与真的根错一模一样，
#    而报错的口吻把人的注意力引向"这棵树有问题"，不是"我拿相对路径比绝对路径"。
REPO="$(pwd)"
# 🔴 打印**两个根**：脚本推导的根与 git 认的根。两者不一致时后面的相对路径全是错的，
# 而那看起来像"前置没过"而不是"根错了"。
GIT_TOP="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ "$REPO" != "$GIT_TOP" ]; then
  echo "❌ 脚本推导的根与 git 根不一致：REPO=$REPO GIT_TOP=$GIT_TOP" >&2
  exit 1
fi
echo "仓库根：${REPO}（与 git 根一致）"

FAIL=0
# 🔴 「下一步」必须按**真红的那几条**给。06:0x 实测两处不符：负载已经 ✅（7 ≤ 12）却仍然打印
#    "等负载落回 7 → ≤12"，而当天真正挡住 B 和 C 的那条「有另一趟 reinstall-all 在跑」
#    在清单里**一个字都没有** —— 一份和现场不对应的建议清单，比没有建议更费时间。
WHY_LOAD=0; WHY_SRC=0; WHY_DEV=0; WHY_CRED=0; WHY_APK=0
pass() { echo "   ✅ $1"; }
warn() { echo "   ❌ $1"; FAIL=$((FAIL + 1)); }
# ── 共用：有没有**另一趟 reinstall-all** 在跑（排除自己这一棵树）───────────────
#    b 侧要它（两趟 B 并行 = 互相卸装）；c 侧更要它（04:2x 现量：另一条会话正以
#    `bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817` 在跑，而它的 android 段
#    会对同一台 emulator-5554 做 `adb uninstall` —— C 的链正在往那上面装 APK）。
#    🔴 设备独占探针 `lib/mobile-e2e-runner-probe.sh` **认不出这一形**：那条正则是
#    `verify-mobile-[a-z-]+\.sh`，而 reinstall-all 不叫那个名字。它是设备面上的**第三种运行者**，
#    两边各写一份 pgrep 就会漂 ⇒ 抽成这个函数，b/c 两个分支共用。
#    `[.]?` 是必需的：`reinstall-all.sh` 会把自己快照成 `scripts/.reinstall-all.sh.snap.$$` 再 exec
#    （它文件头 14-16 行），带点那一形才是现场运行形态（不带点的那一形由臂 T3 一起钉住）。
reinstall_other_pids() {
  local _t=" $$ " _p=$$ _o="" _pid
  while [ -n "$_p" ] && [ "$_p" != "1" ] && [ "$_p" != "0" ]; do
    _p=$(ps -o ppid= -p "$_p" 2>/dev/null | tr -d ' ')
    [ -n "$_p" ] || break
    _t="${_t}${_p} "
  done
  for _pid in $(pgrep -f 'scripts/[.]?reinstall-all[.]sh' 2>/dev/null); do
    case "$_t" in
      *" $_pid "*) : ;;
      *) _o="${_o}${_pid} " ;;
    esac
  done
  printf '%s' "${_o% }"
}

# ── 通用前置一：负载门。用**仓里那条规范实现**，不在这里重写解析
#    （`wait-for-quiet-host.sh` 的文件头记着 #168：自己手写 `tr -d '{} '` 会把
#     分隔符连同三个值粘成一个非法整数 ⇒ 比较恒假、循环恒睡，坏了 15 轮没人发现）。
echo ""
echo "════ 1. 负载门（规范实现，阈值 = hw.ncpu × 3/4）════"
. scripts/lib/wait-for-quiet-host.sh
# 「那一趟是在推进还是已经楔住」的**纯读数**（不参与下面的红/绿与 REDS= 机器通道）。
# 抽成 lib 是因为两道门都要它：抄一份到第二道门就是等它漂（AGENTS §7 那一族）。
. scripts/lib/wedged-runner.sh
# APK 新鲜度的算法（下面第 4 步与 `verify-mobile-trash.sh` 装包前共用同一份；
# 那份脚本以前没有这道门，所以"忘了跑闸门"的人会拿旧 bundle 报全绿 —— §7 第 27 条）。
. scripts/lib/apk-freshness.sh
# 这里**只读一次现量**，不阻塞等人：窗口的判断是给调用者的，不是替调用者睡觉。
CORES=$(sysctl -n hw.ncpu)
LIMIT=$((CORES * 3 / 4))
LOAD1=$(uptime | sed 's/.*load averages: //' | awk '{print int($1)}')
echo "   现量：1 分钟负载 ${LOAD1}，阈值 ${LIMIT}（$CORES 核）"
if [ "$LOAD1" -le "$LIMIT" ]; then
  pass "负载达标"
else
  warn "负载 $LOAD1 > $LIMIT —— 等落回阈值内再开跑（本脚本不替你等）"
  WHY_LOAD=1
fi

# ── 通用前置二：工作树里**别人**未提交的源码。
#    这是 §7 第 82 条那一族的根判据："装进四端的是别人 WIP 而判据全绿"。
#    所以这一条不是礼貌性检查，是"这次交付到底是不是当前源码"的唯一现场证据。
echo ""
echo "════ 2. 工作树：有没有别人未提交的源码 ════"
DIRTY_SRC=$(git status --porcelain -- packages apps server | grep -E '^ ?M' | wc -l | tr -d ' ')
if [ "$DIRTY_SRC" = "0" ]; then
  pass "packages/ apps/ server/ 里没有未提交的修改"
else
  echo "   ❌ $DIRTY_SRC 枚未提交的源码改动（这些会被打进产物，而判据看不出来）："
  git status --porcelain -- packages apps server | grep -E '^ ?M' | sed 's/^/      /'
  WHY_SRC=1
  FAIL=$((FAIL + 1))
fi
# `??` 不判：未跟踪文件进不了包（打包走 `git ls-files`），所以它不是"装了别人 WIP"的通道。

case "$TARGET" in
  b)
    echo ""
    echo "════ 3. B 专属：reinstall-all.sh 自身必须干净 ════"
    # 🔴 被执行的那个脚本自己在工作树里被改着 = 跑的是"上一版流程 + 这一版判据"。
    #    本仓库实测过这条（交接 §4 B 那条错就是"只看 op-log、没看被执行脚本自己"）。
    if [ -z "$(git status --porcelain -- scripts/reinstall-all.sh)" ]; then
      pass "scripts/reinstall-all.sh 干净"
    else
      warn "scripts/reinstall-all.sh 正被改动 —— 先等它落地"
    fi
    echo ""
    echo "════ 4. B 专属：iOS 设备名每次现取（不许抄字面量）════"
    BOOTED=$(/usr/bin/xcrun simctl list devices booted 2>/dev/null | grep -E '\(Booted\)' | sed 's/^ *//;s/ (.*//')
    echo "$BOOTED" | sed 's/^/      已启动的模拟器: /'
    if [ -z "$(printf '%s' "$BOOTED" | tr -d '[:space:]')" ]; then
      warn "没有已启动的 iOS 模拟器 —— B 的 ios 段会判红（脚本如实报因，不硬装）"
    else
      # 🔴 `$BOOTED` 不加引号会被**按空格分词**：一台叫 `iPhone Duo heyta` 的模拟器
      # 会打印成 `iPhone; Duo; heyta`（01:2x 实测），三个名字看着像六台。
      # 显示错了不要紧，要紧的是它让人以为"名字里没空格"，而下面 --confirm 取的
      # 是真名字 —— 两边对不上就会有人怀疑赋值那一侧。逐行读，保留空格。
      BOOTED_LIST=$(printf '%s\n' "$BOOTED" | while IFS= read -r n; do [ -n "$n" ] && printf '%s; ' "$n"; done)
      pass "有已启动的模拟器：${BOOTED_LIST%; *}"
      BOOTED_N=$(printf '%s\n' "$BOOTED" | grep -c '[^[:space:]]')
      if [ "$BOOTED_N" -gt 1 ]; then
        # ⚠️ 故意**不进 FAIL**：这台机器常年三台 booted，把它做成前置就等于
        # 一条天生红的门禁（AGENTS §8.3）—— 那不是"更安全"，是"没人会再跑它"。
        # 它的作用只是把"取哪一台"这件事从静默变成打印出来可否认。
        echo "   ⚠️ $BOOTED_N 台模拟器同时 booted —— --confirm 默认取列表第一台；要指定另一台就显式传 IOS_DEVICE_NAME"
      fi
    fi
    echo ""
    echo "════ 3b. B 专属：设备面独占（AGENTS §8.9 —— 04:1x 补，原来 b 分支没有这道门）════"
    # 🔴 原来 b 分支只看"reinstall-all.sh 自己干净不干净"，**没看设备面上有没有别人在跑验收**，
    #    而 B 会 `simctl uninstall` + `adb uninstall` + 覆盖 /Applications/Heyta.app ——
    #    那三条都是直接拆别人正在量的现场。c 分支早就有这条门，b 分支缺，是"闸门按 target 分岔时漏了一半"。
    #    与 c 分支同一个单所有者探针（不抄 pgrep 正则；探针文件头写了为什么）。
    . "$(dirname "$0")/lib/mobile-e2e-runner-probe.sh"
    B_OTHERS=$(mobile_e2e_runner_lines | awk '{print $1}')
    if [ -n "$B_OTHERS" ]; then
      echo "   ❌ 有移动端验收在跑（pid：$(printf '%s ' $B_OTHERS)）—— B 会卸掉它们的安装包，先让路"
      WHY_DEV=1
      FAIL=$((FAIL + 1))
    else
      pass "没有别的移动端验收在跑"
    fi
    # 另一条 B 正在跑（两个 reinstall:all 并行 = 互相卸装），以及**自己这一棵树**要豁免：
    # 🔴 将来那把"等窗口就起 B"的看守，自己的命令行里就带着 `scripts/reinstall-all.sh` 这个串 ——
    #    不豁免自己就会造成一条**永远红的门禁**（§8.3：不能失败的检查比没有检查更糟）。
    RI_OTHERS=$(reinstall_other_pids)
    if [ -n "$RI_OTHERS" ]; then
      echo "   ❌ 有另一趟 reinstall-all 在跑（pid：${RI_OTHERS}）—— 两趟并行会互相卸装"
      # 只加读数，不改这一档的红：楔住也红（它随时可能醒过来动设备面），
      # 但"等它跑完"和"这一条要人拍板"是两种下一步，不能让人自己去看 ps。
      for _w in $RI_OTHERS; do ht_wedge_report "$_w" "重装" "   "; done
      WHY_DEV=1
      FAIL=$((FAIL + 1))
    else
      pass "没有别的 reinstall-all 在跑（已豁免自己与祖先进程）"
    fi
    CMD="IOS_DEVICE_NAME=\"<上面现取的名字>\" bash scripts/reinstall-all.sh"
    ;;
  c)
    E2E_SERIAL="${HEYTA_E2E_SERIAL:-emulator-5554}"
    echo ""
    echo "════ 3. C 专属：设备独占（AGENTS §8.9）════"
    # 🔴 **不 source `lib/mobile-e2e.sh`**：它在文件尾 `trap restore_ime EXIT`，
    #    而 `restore_ime` 是真的会动设备的（`ime enable` + `show_ime_with_hard_keyboard 1`）。
    #    一个"只是看看窗口开没开"的 dry-run 不该改设备状态。
    #    但它要的排除规则与验收脚本第 0 步那道门**是同一条** ⇒ source 两者共用的那个
    #    无 trap 探针文件。旧写法是在这里抄一份 `pgrep` 正则，而那份抄件**跨不过仓库
    #    路径里的空格**，对被快照成 `.snap.<pid>` 的运行者永久隐形（细则见该文件头）。
    . "$(dirname "$0")/lib/mobile-e2e-runner-probe.sh"
    OTHERS=$(mobile_e2e_runner_lines | awk '{print $1}')
    if [ -n "$OTHERS" ]; then
      echo "   ❌ 有移动端验收在跑（pid：$(printf '%s ' $OTHERS)）"
      WHY_DEV=1
      FAIL=$((FAIL + 1))
    else
      pass "粗筛没有别的移动端验收在抢 ${E2E_SERIAL}（权威判据在验收脚本第 0 步）"
    fi
    RI_C=$(reinstall_other_pids)
    if [ -n "$RI_C" ]; then
      echo "   ❌ 有另一趟 reinstall-all 在跑（pid：${RI_C}）—— 它的 android 段会对同一台设备 adb uninstall"
      for _w in $RI_C; do ht_wedge_report "$_w" "重装" "   "; done
      WHY_DEV=1
      FAIL=$((FAIL + 1))
    else
      pass "没有别的 reinstall-all 在抢设备面（探针只认 verify-mobile-*，这一形单独问过）"
    fi
    if adb -s "$E2E_SERIAL" get-state >/dev/null 2>&1; then
      pass "$E2E_SERIAL 在线"
    else
      warn "$E2E_SERIAL 不在线"
    fi
    echo ""
    echo "════ 4. C 专属：验收的三个外部前置 ════"
    # 这三个都实测过"缺了会怎样"：缺凭据 → lib 在 source 阶段就 `cat: No such file`，
    # 但脚本**照往下跑**（TOKEN 变空串），要到第 0 步的令牌长度判据才拦下来；
    # 缺服务端 → 症状是"应用没起来 / 找不到按钮"，看起来像产品坏了。
    MISSING_CRED=''
    for f in "${HEYTA_E2E_TOKEN_FILE:-/tmp/heyta_mobile_token.txt}" \
             "${HEYTA_E2E_EMAIL_FILE:-/tmp/heyta_mobile_email.txt}" \
             "${HEYTA_E2E_E2EE_FILE:-/tmp/heyta_mobile_e2ee.txt}"; do
      [ -f "$f" ] || MISSING_CRED="$MISSING_CRED $f"
    done
    if [ -z "$MISSING_CRED" ]; then
      pass "凭据三件套都在"
    else
      warn "缺凭据文件：$MISSING_CRED"
      WHY_CRED=1
    fi
    # 🔴 原来这四行把"服务端就绪"当成一条 pass 前置：`curl :${PORT:-3000}/health` 只看有没有
    #    `"status":"ok"`。02:2x 现量 :3000 上是**别人的一枚 node 进程**（pid 70256）⇒ 这条 pass 是假的，
    #    而假 pass 比假 fail 贵：它让我以为环境欠的东西不齐、其实欠的是"别人才有的服务端"。
    #    本线的服务端由链自己起（`r14c-carrier-chain.sh` 现在会挑一个**真空闲**的端口并把同一个 PORT
    #    传给起栈与验收），所以"开跑前有没有服务端"根本不是 C 的前置。
    #    改法：默认只作说明、不计 pass 也不计 warn；显式传 `HEYTA_GATE_SERVER_PORT` 才去探，
    #    并且**把监听者的 pid 打出来**，让人能一眼否认"那是不是我们的"。
    GATE_SVC_PORT="${HEYTA_GATE_SERVER_PORT:-}"
    if [ -n "$GATE_SVC_PORT" ]; then
      HEALTH=$(curl -s --noproxy '*' -m 5 "http://127.0.0.1:${GATE_SVC_PORT}/health" 2>/dev/null)
      LISTENER=$(lsof -nP -iTCP:"${GATE_SVC_PORT}" -sTCP:LISTEN -t 2>/dev/null | head -1)
      if printf '%s' "$HEALTH" | grep -q '"status":"ok"'; then
        pass "服务端就绪（:${GATE_SVC_PORT}/health，监听者 pid=${LISTENER:-未知}）"
      else
        warn "服务端没在 :${GATE_SVC_PORT}（返回：${HEALTH:-空}）"
      fi
    else
      SVC3000=$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null | head -1)
      echo "   ℹ️ 服务端不计入前置：链自己在空闲端口起栈，并把同一个 PORT 同时传给起栈与验收"
      echo "      现量 :3000 监听者 pid=${SVC3000:-（空）} —— 非空就说明那**不是**本线起的服务端"
    fi
    APK="apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
    if [ -f "$APK" ]; then
      # 算法住在 `scripts/lib/apk-freshness.sh`（真机验收脚本装包前那一发用的是同一份）。
      # 这里只保留**呈现**，两行输出的字面形状与抽出去之前逐字相同。
      read -r APK_MT NEWEST < <(heyta_apk_pair "$APK" "$PWD")
      echo "      APK $(date -r "${APK_MT:-0}" '+%F %T') / 最新源码 $(date -r "${NEWEST:-0}" '+%F %T')"
      if [ -n "$NEWEST" ] && [ "$NEWEST" -le "$APK_MT" ]; then
        pass "APK 不比源码旧"
      else
        warn "APK 比源码旧 —— 跑它验的是旧 bundle（§7 第 27 条）"
        WHY_APK=1
      fi
    else
      warn "APK 不存在：$APK"
      WHY_APK=1
    fi
    echo ""
    echo "════ 5. C 专属：脚本已进自快照 MANIFEST ════"
    if grep -q "verify-mobile-due-time.sh" scripts/check-script-snapshot.mjs; then
      pass "scripts/check-script-snapshot.mjs 的 MANIFEST 里有本线那条脚本"
    else
      warn "MANIFEST 里没有它 —— 长验收脚本必须登记（traps #110/#113）"
    fi
    CMD="bash scripts/verify-mobile-due-time.sh"
    ;;
esac

echo ""
echo "════ 结论 ════"
# 🔴 机器读的**红灯集合**，与下面那五条建议行是同一批 WHY_* 旗标的投影，不是第二套判据。
#   为什么要这一行：消费方 research/tools/r14c-window-retry.sh 原来用 `grep -c '❌'` 数红，
#   而它真正要区分的是"**哪几条**红"（只有 APK 红 = 链自己会打产物，可以开窗；
#   只有设备离线红 = 才配得起动设备那一手）。把给人看的建议清单当机器输入，
#   改一个字就静默失效（§6 第 18 条那一族）。
#   顺序固定 load,src,dev,cred,apk；全绿时打**空值**。消费方必须断"这行存在" ——
#   缺行 = 闸门版本不对或装置坏（它自己的 exit 4），不是"没有红"。
#   ⚠️ REDS 的**条数可以小于 FAIL**：FAIL 还数着没有 WHY_ 旗标的提示行
#   （"服务端没在 :PORT"、"MANIFEST 里没有它"），所以不许写成 FAIL==条数 那种假等式。
REDS=""
[ "$WHY_LOAD" = 1 ] && REDS="${REDS}load,"
[ "$WHY_SRC"  = 1 ] && REDS="${REDS}src,"
[ "$WHY_DEV"  = 1 ] && REDS="${REDS}dev,"
[ "$WHY_CRED" = 1 ] && REDS="${REDS}cred,"
[ "$WHY_APK"  = 1 ] && REDS="${REDS}apk,"
echo "REDS=${REDS%,}"
if [ "$FAIL" -gt 0 ]; then
  echo "   窗口**没开**：$FAIL 条前置不成立。这是环境状态，不是产品失败（exit 3）。"
  # 🔴 只列**真红的那几条**（06:0x 改）。原来这五行是无条件打印的，实测两处不对应现场：
  #    负载已经 ✅（7 ≤ 12）却仍输出"等负载落回 7 → ≤12"，
  #    而当天真正同时挡住 B 和 C 的「有另一趟 reinstall-all 在跑」在这份清单里**一个字都没有**。
  #    一份和现场不对应的建议清单比没有建议更费时间 —— 它会让人去等一个不需要等的条件。
  echo "   下一步（只列真红的这几条）："
  [ "$WHY_DEV" = 1 ] && echo "     · 等那趟抢占设备面的验收/重装跑完：现量 pgrep -f 'scripts/[.]?reinstall-all[.]sh'；c 那一路可挂 bash research/tools/r14c-window-retry.sh"
  [ "$WHY_SRC" = 1 ] && echo "     · 等并行会话把上面列出的文件提交（本线自有那份走 research/tools/calendar-line-commit-plan.sh）"
  [ "$WHY_LOAD" = 1 ] && echo "     · 等负载落回 ${LOAD1} → ≤${LIMIT}"
  [ "$WHY_CRED" = 1 ] && echo "     · bash scripts/mobile-e2e-up.sh        # 起服务端 + 建号写凭据"
  [ "$WHY_APK" = 1 ] && echo "     · pnpm --filter @heyta/ui build && pnpm build:android   # APK 比源码旧"
  echo "     · 重跑本脚本（不带 --confirm）确认全绿"
  exit 3
fi

if [ "$CONFIRM" = "0" ]; then
  echo "   窗口开着。**未执行** —— 这是 dry-run。要执行加 --confirm："
  echo "     $CMD"
  exit 0
fi

echo "   窗口开着，--confirm 已给，开始执行："
echo "     $CMD"
if [ "$TARGET" = "b" ]; then
  # 🔴 原来这里无条件取 booted 列表的第一台。现场有**三台** booted（01:2x 现量），
  # 而 `reinstall-all.sh` 的 ios 段会对它拿到的名字做 `simctl uninstall` ——
  # "列表第一台"不是"我要的那台"，选错的代价是卸掉别人正在用的模拟器（§7 #169）。
  # ⇒ 外部显式传的优先；没传才回落到第一台，并且**把取到的名字打出来**让人能否证。
  IOS_NAME="${IOS_DEVICE_NAME:-$(printf '%s\n' "$BOOTED" | head -1)}"
  if [ -z "$(printf '%s' "$IOS_NAME" | tr -d '[:space:]')" ]; then
    echo "❌ iOS 目标取不到设备名（外部没传 IOS_DEVICE_NAME，且 booted 列表为空）—— 停，不让脚本自己猜目标" >&2
    exit 3
  fi
  echo "   iOS 目标设备名 = [$IOS_NAME]（来源：${IOS_DEVICE_NAME:+外部显式传入}${IOS_DEVICE_NAME:-booted 列表第一台}）"
  IOS_DEVICE_NAME="$IOS_NAME" bash scripts/reinstall-all.sh
else
  bash scripts/verify-mobile-due-time.sh
fi
