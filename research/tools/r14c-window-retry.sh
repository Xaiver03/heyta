#!/bin/bash
# R14c 的 Android 腿：等到窗口，再"同步载体 → 打产物 → 跑验收"整条射出去。
#
# 🔴 为什么第二版要先同步载体（第一版不做这件事，02:0x 被现量否证）：
#   第一版只在窗口开时叫 `--confirm`，装的是载体里 **01:05 打好的那个 APK**。
#   现量：主检出 HEAD 已从载体的 `93113e30` 走到更新，而 `93113e30..HEAD` 之间有
#   **33 个 APK 输入面文件**变了（`packages/i18n/src/locales/*`、`packages/app-host/*`、
#   `packages/storage/*`、`packages/sync-client/src/client.ts`、`apps/mobile/src/{db,screens,sync}/*`、
#   `packages/ui/src/sync/model.ts`）。⇒ 那一趟如果绿了，绿的是**旧 bundle**，
#   正是 AGENTS §7 第 27 条（"packages/ 改了、APK 里是旧 JS bundle，验收对旧代码报绿"）。
#   更阴的一点：**闸门自己看不见这件事** —— 它比的 mtime 是"载体里的 APK vs 载体里的源码"，
#   载体落后于主检出时两边一起旧，判据照样 ✅。⇒ 补这条：把载体指到主检出的当前提交再打。
#
# 退出码：0 = 开窗且整条链跑完（链自己的 rc 决定成败，见 CHAIN rc= 行）
#         3 = 没等到窗口（环境不成立，不是产品失败）
#         4 = 装置前提不成立（载体/闸门/链脚本缺文件、self-test 不过）
#         5 = 窗口开了但**载体同步失败** ⇒ 不起链。这一条存在的理由：继续跑就是
#             在旧树上打包再验一遍（§7 第 27 条那一族），而判据会全绿。
# 硬约定：**不在窗口之外动设备**；不自建第二套前置判据（前置一律问 `verify-mobile-window-gate.sh`）。
# 日志：每次跑一个唯一文件，再把稳定名指过来 —— 稳定名给台账引用，唯一名防并发互相覆盖
#       （本机实测过"同一个路径先后出现两种内容"那件事）。
set -u

MAIN="${MAIN:-/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta}"
CARRIER="${CARRIER:?❌ 必须传 CARRIER=<干净载体路径>（本装置不猜，避免在带别人 WIP 的主检出里打包）}"
BUDGET="${BUDGET:-3600}"
INTERVAL="${INTERVAL:-60}"
STABLE_LOG="${STABLE_LOG:-/tmp/ht-r14c-window.log}"
# 🔴 稳定名是**台账引用的那一个指针**，只有"默认路径的那一趟"才有资格挪它。
#    原来这两行不分情形：显式传 LOG 的臂/复现跑也会 `ln -sf` 把稳定名指到自己身上，
#    于是台账里的 `/tmp/ht-r14c-window.log` 会指向某臂的夹具日志（本轮差一点把真 rig 的读数读成臂的）。
#    臂 9 / 9b 就是这条的两腿：显式 LOG ⇒ 不许建稳定名；默认 LOG ⇒ 必须建（少一腿"永远不 ln"也能骗过）。
if [ -n "${LOG:-}" ]; then
  STABLE_TIED=0                       # 显式 LOG：这一趟是特定的那一次，不动台账指针
else
  LOG="/tmp/ht-r14c-window.$(date +%Y%m%d-%H%M%S).$$.log"
  ln -sf "$LOG" "$STABLE_LOG" 2>/dev/null && STABLE_TIED=1 || STABLE_TIED=0
fi
# GATE/CHAIN 都可覆盖：为了本装置自己的四臂自测能拿桩试（不覆盖时走真实路径）。
# 🔴 06:5x 现量把默认值从**载体那份**改成**主检出那份**，因为差出一份真判据：
#   载体的已提交副本（93113e30）里 c 分支的 §3 **没有"有另一趟 reinstall-all 在跑"这一条** ——
#   那个探针（`reinstall_other_pids`，认 `.reinstall-all.sh.snap.<pid>` 那形 argv）只存在于
#   本线工作树那份。逐字对照：载体的 §3 只有 `verify-mobile-*` 那把粗筛 + `不在线`；
#   `grep -n reinstall <载体副本>` 现量只命中"B 专属：文件干净"那一节。
#   后果不是读数少一行，是**开窗判据本身看不见正在跑的重装**：那一趟会在同一台设备上
#   `adb uninstall`，而我这会把 APK 装上去并跑判据 —— §8.9 禁的正是这个。
#   同一个理由本文件对 CHAIN 已经写过一次（"拿主检出那份就没有装置依赖尚未同步的文件这种自锁"），
#   这次是它的另一半：**前置判据也在同步范围之外**。
GATE="${GATE:-$MAIN/scripts/verify-mobile-window-gate.sh}"
# 开窗后的**载体自愈**装置（默认取主检出那份，理由与 GATE 同一手：它在同步范围之外）。
HEAL="${HEAL:-$MAIN/research/tools/r14c-carrier-heal.sh}"
# 🔴 链脚本取**主检出**那份（它自己会 `cd "$CARRIER"`）：载体现在落后于主检出，
#    同步之前它那份可能还不存在 —— 拿主检出那份就没有"装置依赖尚未同步的文件"这种自锁。
CHAIN="${CHAIN:-$MAIN/research/tools/r14c-carrier-chain.sh}"

# ── 前提（缺一样就 exit 4，不带着坏装置进窗口）
for f in "$GATE" "$CHAIN" "$HEAL"; do
  [ -f "$f" ] || { echo "❌ 载体里缺文件：$f" >&2; exit 4; }
done

# ── self-test：等待条件里的 pgrep 模式必须能"看得见东西"，否则那条让路判据永远不触发。
#    反例形状（本机踩过两次）：模式匹配到装置自己的命令行 ⇒ 恒"有人在跑"；或漏了 -f ⇒ 恒 0。
#    🔴 让路判据排在闸门**之前**（02:0x 实测：另一把看守活着时第四臂根本走不到桩）——
#       这是有意的（串行优先于开火），但四臂自测要用一个必不命中的模式才能测到开火路径，
#       所以模式做成旋钮；阳性对照那枚假进程的名字由模式**去掉方括号**推出来，两者永远同形。
CO_PATTERN="${CO_PATTERN:-h-flaky-window-watche[r]}"
CO_NAME=$(printf '%s' "$CO_PATTERN" | tr -d '[]')
if pgrep -f "$CO_PATTERN" >/dev/null 2>&1; then
  SELFTEST=sees_other   # 此刻真有别的看守在跑（正常，且这本身就证明模式看得见）
else
  # 阳性对照：临时起一枚带该串的睡眠进程，模式必须数得出它
  ( exec -a "$CO_NAME-SELFTEST" sleep 2 ) &
  SPID=$!
  sleep 0.4
  if pgrep -f "$CO_PATTERN" >/dev/null 2>&1; then SELFTEST=positive_ok; else SELFTEST=BROKEN; fi
  kill "$SPID" 2>/dev/null
fi
[ "$SELFTEST" = BROKEN ] && { echo "❌ 让路判据的 pgrep 模式自测不过（pattern=${CO_PATTERN} name=${CO_NAME}）⇒ 装置坏，不开跑" >&2; exit 4; }

# ── 同一张设备面**只允许一把本装置**（06:2x 实测补）
# 🔴 现场：本会话 05:28 挂了这把（BUDGET=7200，还活着），06:19 我又挂了一把（BUDGET=5400）。
#    上面那条让路判据的 CO_PATTERN 里只有 **H 那把看守**（`h-flaky-window-watche[r]`），
#    **不含自己** —— 也就是说两把 C 看守会各自等到开窗、各自起一次设备链：
#    同一台 emulator-5554 上并发 install、同一个载体里并发 checkout。
#    这正是 AGENTS §8.9 禁止的共享资源互抢，而它长在我这轮刚补的"让路给真在跑的 C 链"**旁边** ——
#    补了「H 让 C」，却没想到「C 也要让 C」。判"谁在跑"要按**同一份资源**枚举，不是按"另一种装置"。
# 旋钮：SELF_GUARD=0 关掉（给自测臂用）；PEER_PATTERN 可换成一枚必不命中的模式来测"没有同类"那一腿。
SELF_GUARD="${SELF_GUARD:-1}"
PEER_PATTERN="${PEER_PATTERN:-r14c-window-retry[.]sh}"
if [ "$SELF_GUARD" = 1 ]; then
  # 排除自己这一对（bash 本体 $$ 与它的 zsh 包装父进程 $PPID —— 包装行的命令行里也带这个串）
  PEERS=$(pgrep -f "$PEER_PATTERN" 2>/dev/null | grep -vw "$$" | grep -vw "$PPID" | tr '\n' ' ' || true)
  if [ -n "${PEERS// /}" ]; then
    echo "❌ 已经有另一把 C 看守在等同一张设备面（pid：${PEERS% }）⇒ 本把不起，第二把。" >&2
    echo "   两把并行 = 开窗时各自起一次设备链（同一台 emulator 并发 install、同一载体并发 checkout）。" >&2
    echo "   要接管：先停那一把（kill 那个 pid 或收掉它的后台任务），再重挂本装置。exit 6。" >&2
    exit 6
  fi
fi

# ── 06:4x 补：设备这一手（BOOT_AVD）——不补这手，看守等的是一台**没人会起**的设备 ──
# 现场：本机 `adb devices` 在线 0 台，而 C 的阻塞项之一就是"emulator-5554 不在线"；
#   仓内**没有任何脚本会起安卓模拟器**（`grep -rn -- '-avd' scripts docs/runbooks` 现量只命中鸿蒙那节），
#   所以原来的行为是：预算内一直 exit 3，窗口永远不会因为"设备"这一条而开。
# 🔴 三条不越的线（这一手动的是一台共享设备面上的新对象，不是别人的数据）：
#   ① 只有"闸门除了设备离线**没有别的红**"时才动 —— 还在门口才配得起开设备；
#   ② AVD 名必须在 `emulator -list-avds` 的**逐字整行**里（不顺手建新的、不改名去凑）；
#   ③ 已经有在线设备就不起第二台（也不猜目标）；一律 `-no-window`（§6.2 规定二：不抢前台）。
# 默认空 = 与本文件 06:4x 之前的行为逐字相同（设备离线就一直等），这一手只在显式传 BOOT_AVD 时生效。
BOOT_AVD="${BOOT_AVD:-}"
BOOT_WAIT="${BOOT_WAIT:-300}"
SERIAL_EXPECTED="${HEYTA_E2E_SERIAL:-emulator-5554}"
# 🔴 adb 也要能注桩：07:0x 现场有人**真的把 emulator-5554 起起来了**，于是那条正向臂读到的
#    不再是夹具而是活机器（它报 BOOT=skipped，守卫行为是对的，但臂自己的期望失效）。
#    "夹具读活机器"下一次还会翻，而且翻出来的方向是"被测装置坏"。
ADB="${ADB:-adb}"
maybe_boot_avd() {  # $1 = 从闸门 `REDS=` 行读到的红集（逗号分隔，全绿时为空）
  local reds="$1" other em='' c online real
  # 🔴 判"到没到门口"也走 REDS 这一条通道（07:2x 换的），不再数 ❌：
  #   设备离线挂的是 **dev** 一条旗标，而 07:2x 现量 dev 那一条旗标对应**两条** ❌
  #   （`有移动端验收在跑` + `有另一趟 reinstall-all 在跑`），4 条 ❌ 只对应 3 条腿。
  #   数 ❌ 的老写法在这种时候会把"还有别的红"读成"只红设备"⇒ 在别人抢设备面上起模拟器。
  # ⚠️ 允许与 dev 并存的红**只有 apk**（07:3x 查出的第二处自锁）：载体刚 checkout 过就恒红 apk，
  #   而"只红 apk"要成立的前提恰恰是**设备已经在线** ⇒ 若"还红 apk 就不起设备"，
  #   那么在设备离线 + 载体同步过的那种现场里：开窗要设备在线、设备在线要起模拟器、
  #   起模拟器要"只红设备"、"只红设备"要 apk 不红、apk 不红要开窗后链自己打 —— 环闭上了，永远出不去。
  #   其余任何红（load/src/cred）都还在门外，一律不许动设备面。
  reds=${reds:-}
  if [ -z "${reds// /}" ]; then echo "BOOT=not-needed（红集为空 ⇒ 闸门没拦，走原路径）"; return; fi
  other=$(printf '%s' "$reds" | tr ',' '\n' | grep -Ev '^(dev|apk)$' | grep -v '^[[:space:]]*$' | tr '\n' ' ')
  if [ -n "${other// /}" ]; then
    echo "BOOT=wait（除 dev/apk 之外还红：${other% } ⇒ 没到门口，不动设备）"; return
  fi
  em="${EM_BIN:-}"
  if [ -n "$em" ] && [ ! -x "$em" ]; then
    echo "BOOT=refused（EM_BIN='${em}' 不可执行 —— 桩也得是真的）"; return
  fi
  if [ -z "$em" ]; then
    for c in "${ANDROID_HOME:-}/emulator/emulator" "${ANDROID_SDK_ROOT:-}/emulator/emulator" \
             /opt/homebrew/share/android-commandlinetools/emulator/emulator \
             "$HOME/Library/Android/sdk/emulator/emulator"; do
      [ -x "$c" ] && { em="$c"; break; }
    done
  fi
  if [ -z "$em" ]; then echo "BOOT=refused（找不到 emulator 可执行文件 —— 这条前置给不出命令）"; return; fi
  # 🔴 三个旗标分开写：`grep -fxq` 里 -f 会把 xq 当文件名吞掉（本机 06:3x 刚因此把
  #    "AVD 不存在"报成"现场没有设备"）。这里要的是**整行逐字相等**，所以 -x -F。
  if ! "$em" -list-avds 2>/dev/null | grep -q -x -F -- "$BOOT_AVD"; then
    echo "BOOT=refused（AVD '${BOOT_AVD}' 不在 -list-avds 的逐字列表里 —— 不建新的）"
    "$em" -list-avds 2>/dev/null | sed 's/^/      现有：/'
    return
  fi
  if ! command -v "$ADB" >/dev/null 2>&1; then
    echo "BOOT=refused（adb=${ADB} 不可执行 ⇒ 这条前置无法判定，不能当成'设备没问题'）"; return
  fi
  online=$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}' | tr '\n' ' ')
  if [ -n "${online// /}" ]; then echo "BOOT=skipped（已在线 ${online% } ⇒ 不起第二台、不猜目标）"; return; fi
  if pgrep -f 'emulator -avd' >/dev/null 2>&1; then echo "BOOT=skipped（已有 emulator 进程在起，不叠加）"; return; fi
  echo "BOOT=start avd=${BOOT_AVD} flags=-no-window -no-boot-anim -no-audio -no-snapshot-save $(date '+%T')"
  "$em" -avd "$BOOT_AVD" -no-window -no-boot-anim -no-audio -no-snapshot-save \
    >"/tmp/ht-r14c-avd.$$.log" 2>&1 &
  local apid=$!
  echo "BOOT pid=${apid} 日志=/tmp/ht-r14c-avd.$$.log（本装置起的这一枚；收尾 kill ${apid}）"
  local waited=0
  while [ "$waited" -lt "$BOOT_WAIT" ]; do
    real=$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1; exit}')
    if [ -n "$real" ] && [ "$("$ADB" -s "$real" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
      echo "BOOT=ready（${waited}s 后 ${real} 起完，boot_completed=1）"
      if [ "$real" != "$SERIAL_EXPECTED" ]; then
        echo "BOOT=serial 换了：闸门找的是 ${SERIAL_EXPECTED}，实际拿到 ${real} ⇒ 本进程导出 HEYTA_E2E_SERIAL=${real}"
        export HEYTA_E2E_SERIAL="$real"
      fi
      return
    fi
    sleep 5; waited=$((waited + 5))
  done
  echo "BOOT=timeout（${BOOT_WAIT}s 内没等到 boot_completed；不看日志就重试等于叠第二台）"
}

echo "start $(date '+%T') 窗口预算=${BUDGET}s 间隔=${INTERVAL}s 载体=$CARRIER 日志=$LOG selftest=$SELFTEST 稳定名=$STABLE_TIED" >> "$LOG"
# 🔴 引号 heredoc：原来写 `<<HDR`（不带引号）⇒ 里面那句 `git checkout <主检出当前提交>` 被当成命令替换执行，
#    报 `syntax error near unexpected token 'newline'`，而日志里那行变成"开窗后先  再打产物"（命令丢了）。
#    同一族的坑本机记过：双引号里的 grep pattern 含反引号会被命令替换。
cat >> "$LOG" <<'HDR'
本装置第二版：开窗后先 `git checkout <主检出当前提交>` 再打产物（原因见文件头那条 33 文件的现量否证）。
HDR

START=$(date +%s)
N=0
while :; do
  N=$((N + 1))
  {
    echo "----- 第 $N 次 $(date '+%T') -----"
    MAIN_SHA=$(git -C "$MAIN" rev-parse --short HEAD 2>/dev/null)
    CAR_SHA=$(git -C "$CARRIER" rev-parse --short HEAD 2>/dev/null)
    echo "载体 sha=${CAR_SHA:-取不到} / 主检出 sha=${MAIN_SHA:-取不到} / 需要同步=$( [ "$CAR_SHA" != "$MAIN_SHA" ] && echo yes || echo no)"
  } >> "$LOG" 2>&1

  # 让路：另一条重验证看守还活着就继续等（Playwright 与设备腿都算重活，AGENTS §8.9 + 本机"串行"纪律）
  CO_PIDS=$(pgrep -f "$CO_PATTERN" 2>/dev/null | tr '\n' ' ')
  if [ -n "$CO_PIDS" ]; then
    echo "CO_RUNNER=alive pid=${CO_PIDS% } —— 让路，本轮不起设备腿" >> "$LOG"
  else
    # 问权威闸门：窗口开没开（dry-run，不加 --confirm，绝不让它替我动手）
    NO_COLOR=1 bash "$GATE" --target c --repo "$CARRIER" > "$LOG.tmp.$$" 2>&1
    GATE_RC=$?
    cat "$LOG.tmp.$$" >> "$LOG"
    echo "ATTEMPT rc=$GATE_RC" >> "$LOG"
    # 🔴 "红的是哪几条"一律读闸门自己打的 `REDS=` 行（07:2x 换的通道）。
    #   原来这里数 ❌ —— 那个数分不开"只红 APK"与"负载+APK 都红"，而这两件事的决定完全相反
    #   （前者该开窗，后者该等）；数给人看的行本身就是 §6 第 18 条那一族。
    #   现量 07:2x：`REDS=load,dev,apk` 而 ❌ 有 **4** 条（两条同挂 dev 旗标）⇒ 条数天生不能互推。
    GATE_REDS=$(grep -m1 '^REDS=' "$LOG.tmp.$$" 2>/dev/null | cut -d= -f2-)
    if [ "$GATE_RC" = 3 ] && ! grep -q '^REDS=' "$LOG.tmp.$$"; then
      rm -f "$LOG.tmp.$$"
      echo "ALL_DONE final_rc=4（闸门没打 REDS 行 ⇒ GATE=${GATE} 那一份是旧判据，本装置不猜开窗条件）" >> "$LOG"
      exit 4
    fi
    # 🔴 开窗判据第二版：rc=0 **或** rc=3 且红的只有 APK 一条（`FIRE=apk-deferred`）。
    #   这不是把 APK 那一腿摘了：它管的是"别拿旧 bundle 去验"，而本链在动设备前一定自己
    #   `pnpm -r build` + `pnpm build:android`，并且链的第 6 步会用**同一条闸门**在 install 那一刻
    #   再量一次，红就停在 `CHAIN_STOPPED_AT=regate`、不进设备面。
    #   为什么非加不可（07:2x 查出的自锁）：开窗动作里的 `checkout` 会把载体源码 mtime 刷成"现在"，
    #   APK 还是上一次打的 ⇒ "只红 APK"是开窗这一步自己造出来的恒红，
    #   而链只在 rc=0 时才起 ⇒ 结构上永远开不了窗、永远打不出那个 APK。
    FIRE_DEFERRED=0
    if [ "$GATE_RC" = 3 ] && [ "$GATE_REDS" = apk ]; then FIRE_DEFERRED=1; fi
    if [ "$GATE_RC" -eq 0 ] || [ "$FIRE_DEFERRED" = 1 ]; then
      rm -f "$LOG.tmp.$$"
      if [ "$FIRE_DEFERRED" = 1 ]; then
        echo "WINDOW=open $(date '+%T')（FIRE=apk-deferred：唯一红的是 APK 新旧 ⇒ 链自己补产物，动设备前重问闸门）" >> "$LOG"
      else
        echo "WINDOW=open $(date '+%T') —— 开始整条链" >> "$LOG"
      fi
      # 🔴 开窗 ≠ 载体能同步。上一趟链被强杀（SIGKILL 不跑任何 trap，06:56 三臂实测）会留下
      #    覆盖件，而 `git checkout --detach` 对"未提交且区间内会变"的文件**直接拒**
      #    （06:53 实跑 rc=1，且那枚内容与目标提交逐字节相同也一样拒）⇒ 原本这里会 exit 5、
      #    设备面整趟白等。先问自愈装置：它只在"零独占信息"时才动，产品代码一律拒。
      PRE_DIRTY=$(git -C "$CARRIER" status --porcelain | wc -l | tr -d ' ')
      if [ "$PRE_DIRTY" != "0" ]; then
        echo "PRE-CHECKOUT 载体脏 ${PRE_DIRTY} 枚 ⇒ 先走有界自愈（HEAL=${HEAL}）" >> "$LOG"
        CARRIER="$CARRIER" TARGET="$MAIN_SHA" bash "$HEAL" --confirm >> "$LOG" 2>&1
        HEAL_RC=$?
        echo "HEAL rc=${HEAL_RC}" >> "$LOG"
        if [ "$HEAL_RC" != "0" ]; then
          echo "FIRE=aborted（自愈拒或装置红 ⇒ 没打包、没动设备）" >> "$LOG"
          echo "ALL_DONE final_rc=5（自愈拒 = 载体里有独占信息，那是要人看的形状）" >> "$LOG"
          exit 5
        fi
      fi
      if [ "$CAR_SHA" != "$MAIN_SHA" ]; then
        git -C "$CARRIER" checkout --detach "$MAIN_SHA" >> "$LOG" 2>&1
        SYNC_RC=$?
        echo "SYNC rc=${SYNC_RC}（目标 ${MAIN_SHA}）" >> "$LOG"
        if [ "$SYNC_RC" -ne 0 ]; then
          # 🔴 同步失败**绝不继续**：那时载体还是旧树，接着打包 = 把 §7 第 27 条那个假绿重做一遍。
          #    典型成因：载体工作树有改动会被目标提交覆盖（`would be overwritten by checkout`）——
          #    本载体确实带着 `scripts/verify-mobile-due-time.sh` 的未提交副本，
          #    今天它与目标提交逐字节相同所以能干净过去，**别人一旦改这个文件就会翻**。
          echo "FIRE=aborted（同步失败 ⇒ 没打包、没动设备）" >> "$LOG"
          echo "ALL_DONE final_rc=5（先把载体清干净再重挂：git -C <载体> status --porcelain 自查）" >> "$LOG"
          exit 5
        fi
        git -C "$CARRIER" status --porcelain -- packages apps server scripts | sed 's/^/   仍脏：/' >> "$LOG"
      else
        echo "SYNC rc=0（载体已在 ${MAIN_SHA}，无需同步）" >> "$LOG"
      fi
      CARRIER="$CARRIER" LOG="/tmp/ht-r14c-chain.$$.log" bash "$CHAIN" >> "$LOG" 2>&1
      CHAIN_RC=$?
      echo "CHAIN rc=$CHAIN_RC" >> "$LOG"
      echo "ALL_DONE final_rc=$CHAIN_RC" >> "$LOG"
      exit $CHAIN_RC
    elif [ "$GATE_RC" -ne 3 ]; then
      rm -f "$LOG.tmp.$$"
      echo "ALL_DONE final_rc=${GATE_RC}（闸门回了非 0 非 3 的码 —— 不洗白，原样交出去）" >> "$LOG"
      exit $GATE_RC
    else
      # rc=3 = 窗口没开。只有红集**恰好是 dev 一条**（= 已经站在门口、缺的只是设备）时，
      # 才允许按 BOOT_AVD 那一手起**本线自己的** AVD；不传 BOOT_AVD 就维持原行为（继续等）。
      if [ -n "$BOOT_AVD" ]; then maybe_boot_avd "$GATE_REDS" >> "$LOG" 2>&1; fi
      rm -f "$LOG.tmp.$$"
    fi
  fi

  NOW=$(date +%s)
  if [ $((NOW - START)) -ge "$BUDGET" ]; then
    echo "WINDOW=timeout（${BUDGET}s 用尽，共 $N 次）$(date '+%T')" >> "$LOG"
    echo "ALL_DONE final_rc=3" >> "$LOG"
    exit 3
  fi
  sleep "$INTERVAL"
done
