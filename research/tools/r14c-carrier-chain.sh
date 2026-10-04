#!/usr/bin/env bash
# R14c 的 Android 真机腿：在**按提交 SHA 切出的干净载体**里跑完整链。
#
# 为什么要在载体里做而不是主检出：00:5x 现量主检出有 22 枚别人未提交的源码，
# 其中 `apps/mobile/src/db/op-sqlite-driver.ts` 正在本线判据的落库路径上 ——
# 从主检出打的 APK 会把别人的 WIP 一起打进去，而判据全绿（AGENTS §7 第 82 条一族）。
#
# 每一步都打 `STEP <名> rc=<码>` 哨兵行；退出码不被管道吃掉（traps #45）。
#
# 🔴 **被测产物**与**判据脚本**是两件事，载体同步只保住前者（03:5x 现量后补的第 0 步）：
#   开窗时 `r14c-window-retry.sh` 把载体 `checkout --detach <主检出 HEAD>`，APK 打的是当前提交 ——
#   但 `scripts/verify-mobile-due-time.sh` 在载体里是**那个提交的已提交副本**，本线这轮写进主检出
#   **工作树**的判据一条都不在里面。03:5x 逐字节现量（载体 93113e30 的工作树副本 vs 主检出工作树）：
#   载体独有 3 行、主检出独有 14 行，而载体那 3 行正是第 4 层的**纯打印版**
#   （`psql … 2>/dev/null | sed 's/^/      ops|devices = /'` —— 读不到也照样绿），
#   主检出那一段（`verify-mobile-due-time.sh:626-635`）才是带 `ok/bad` 与 exit 码的判据版。
#   ~~原句（本文件 02:4x 的头部）：排除本体在主检出，要等 A 落笔才进得了载体。~~
#   ⇒ 03:5x 否证：**不必等提交**。第 0 步按点名清单把判据脚本从主检出工作树 `cp` 进载体，
#   逐枚 md5 对账（§7 第 82 条"远端字节 == 本地工作树"的同一形状），跑完**逐枚还原**
#   （traps #83：探针留下的状态就是下一次前置读数的输入 —— 不还原的话，下一次闸门 §2 会把
#   **我的**覆盖件报成"别人的 WIP"）。
#   覆盖清单只准是"判据/探针"这一类：点名 `packages/` `apps/` `server/` 会被本步自己拒绝，
#   且还原用的是**覆盖前的字节备份**，不是 `git checkout --`（后者会把载体里别人那部分未提交
#   状态一起抹掉；备份还原只回到"我来之前"的样子）。
# 第 5 步的验收脚本自带负载门与设备占用探针：不达标它会 exit 3（环境无效，不是产品失败），
# 那时前面的产物已经备好，直接重跑第 5 步即可。
set -u
CARRIER="${CARRIER:-/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-r14c}"
MAIN="${MAIN:-/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta}"
LOG="${LOG:-/tmp/ht-r14c-chain.log}"
cd "$CARRIER" || { echo "CARRIER 不存在: $CARRIER"; exit 1; }
SHA=$(git rev-parse --short HEAD)
echo "=== chain start $(date '+%F %T') carrier=$CARRIER sha=$SHA main=$MAIN" > "$LOG"

# ── 0. 判据脚本的点名覆盖 + 逐枚 md5 对账 + 覆盖前备份 ──────────────────────
JUDG_PATHS=(
  scripts/verify-mobile-due-time.sh
  scripts/lib/mobile-e2e-runner-probe.sh
  research/tools/r14c-bundle-testid-preflight.sh
  research/tools/r14c-server-readability-judgment.sh
  # 🔴 闸门自己也要点名覆盖（07:2x 加）：第 6 步要在**动设备那一刻**再问一次窗口，
  #   而载体里 `checkout` 到的那份是**该提交的已提交副本** —— 现量：那一版 §3 没有
  #   "有另一趟 reinstall-all 在跑"这一条（`reinstall_other_pids` 探针只活在主检出工作树）。
  #   拿载体那份重问 = 用一个瞎掉的判据证明窗口开着，比不问更糟（它会给出 ✅）。
  #   走这条清单而不是直接 `bash "$MAIN/scripts/…"`：清单带逐枚 md5 对账与跑完还原，
  #   "哪一份判据在跑"是可对账的，不是靠调用路径隐式决定（§6 第 19 条那一族）。
  scripts/verify-mobile-window-gate.sh
  # 🔴 规则（13:2x 现量补齐的）：**闸门 source 的每一枚 lib 都要同列**，不是"漏了才补哪一枚"。
  #    漏的后果不是崩（闸门只 `set -u`，会打一行 command not found 继续跑），
  #    而是**在最需要那条读数的"动设备那一刻"悄悄没有它** —— 抄件必漂的那条规则在这里成立。
  #    现量：闸门 :103/:106/:109 三枚 source，12:5x 之前清单里只有 `wedged-runner` 一枚，
  #    `apk-freshness.sh`（当天新加，载体那份**根本没有**）与 `wait-for-quiet-host.sh` 都不在。
  #    先验把这一条抓出来的正是 `r14c-chain-overlay-arms.sh` 的依赖对偶不变式。
  #    `wait-for-quiet-host` 此刻载体那份与主检出**逐字节相同**（按"缺失/才要求"的判定式它还不该红），
  #    仍然并列：清单要是按"这一趟碰巧的 sha"来写，下次有人在工作树里改它就又漂一次。
  scripts/lib/wedged-runner.sh
  scripts/lib/apk-freshness.sh
  scripts/lib/wait-for-quiet-host.sh
  # 🔴 下面两枚**不是判据，是起栈的运行依赖**，规则一样："链依赖的东西必须与 dependent 同列"。
  #    17:5x 实测到不带它们会怎样：链给 `mobile-e2e-up.sh` 传了新旋钮 `HEYTA_E2E_PIDFILE/LOGFILE`，
  #    而载体那份是**已提交副本**（现量 `grep -n 'PIDFILE=' 载体那份` = 第 46 行写死 `/tmp/heyta-e2e-server.pid`）
  #    ⇒ 旋钮被静默忽略，本线那趟起栈照样**覆盖了两枚跨树共享件**（pidfile 从死 pid 95105 变成我的 34466、
  #    共享日志被我的启动输出续写）。这条链新加的后置断言（`stack_isolation` 那一格）会把这种"传了却不生效"
  #    当场判红 —— 覆盖清单让它是**绿的来路**，断言保证它不是"我以为生效了"。
  scripts/mobile-e2e-up.sh
  scripts/mobile-e2e-down.sh
)
# 🔴 可覆盖只是为了让本步自己的臂（缺文件 / 点名产品代码 / 载体脏）能在隔离克隆里试；
#    下面那条 `packages/*|apps/*|server/*)` 守卫**不认来源**，覆盖也越不过去。
if [ -n "${JUDG_PATHS_OVERRIDE:-}" ]; then
  IFS='|' read -r -a JUDG_PATHS <<<"$JUDG_PATHS_OVERRIDE"
fi
MD5TOOL=""
for t in md5 md5sum; do
  if command -v "$t" >/dev/null 2>&1; then MD5TOOL="$t"; break; fi
done
[ -n "$MD5TOOL" ] || { echo "CHAIN_STOPPED_AT=overlay（没有 md5 也没有 md5sum ⇒ 对账做不了）" >> "$LOG"; exit 5; }
digest() {
  case "$MD5TOOL" in
    md5)     md5 -q "$1" ;;
    md5sum)  md5sum "$1" | cut -d' ' -f1 ;;
  esac
}
BAK=$(mktemp -d /tmp/ht-r14c-chain-bak.XXXXXX) || { echo "CHAIN_STOPPED_AT=overlay（备份目录建不起来）" >> "$LOG"; exit 5; }
OVERLAY_LIST="$BAK/list"
: > "$OVERLAY_LIST"
restore_carrier() {
  [ "${RESTORED:-0}" = 1 ] && return
  RESTORED=1
  [ -s "$OVERLAY_LIST" ] || { echo "RESTORE 无覆盖件可还原" >> "$LOG"; return; }
  while IFS='|' read -r p existed; do
    [ -n "$p" ] || continue
    if [ "$existed" = 1 ]; then
      cp "$BAK/$p" "$CARRIER/$p" && echo "RESTORED ${p}（回到覆盖前字节）" >> "$LOG"
    else
      rm -f "$CARRIER/$p" && echo "REMOVED ${p}（覆盖前不存在）" >> "$LOG"
    fi
  done < "$OVERLAY_LIST"
  echo "RESTORE_DONE $(grep -c . "$OVERLAY_LIST") 枚 备份留在 $BAK" >> "$LOG"
}
trap 'restore_carrier' EXIT   # 🔴 在动第一枚文件**之前**挂上：中途 exit 5 也要还原已覆盖的那几枚
# 🔴 06:5x 现场事故：本会话把正在跑的链 kill 掉，载体留下一枚
#    ` M scripts/verify-mobile-due-time.sh`。代价不是"脏一个文件"，是**下一次开窗时
#    `git checkout --detach` 被拒**（06:53 实跑现量 rc=1；而那枚未提交内容与目标提交逐字节相同
#    也一样拒 —— 我第一版以为"内容相同能干净过去"，被这次实际运行否证）。
# ⚠️ 下面这条 trap 的**归因写过一次错的**，留原文是为了让后来者别再照着推：
#    原句是"EXIT 那道挡不住被 kill（非交互 bash 收到没 trap 的 TERM 直接死、不跑 EXIT）"——
#    三臂实测（/tmp/trap-arm.sh，复刻同一 trap 形状）：**SIGTERM 下 EXIT trap 照样跑**（臂 2
#    去掉 TERM trap 后仍还原成 ORIG），只有 **SIGKILL 什么都不跑**（臂 3 留在 OVERLAY）。
#    所以那次残留的形状是 -9（后台任务被强杀），不是 TERM。
# ⇒ 这条 TERM trap 的真实增量只有两点：日志里那一行 signal 哨兵（下一个人知道链为什么
#    停在中途）+ 确定的 143 退出码。它**不是**防残留的手段 —— 防 -9 残留靠
#    `research/tools/r14c-carrier-heal.sh`（开窗前的有界自愈）。
trap 'restore_carrier; echo "CHAIN_STOPPED_AT=signal（收到 TERM/INT，已还原覆盖件后以 143 退出）" >> "$LOG"; exit 143' TERM INT

for p in "${JUDG_PATHS[@]}"; do
  case "$p" in
    packages/*|apps/*|server/*)
      echo "CHAIN_STOPPED_AT=overlay（覆盖清单点名了产品代码 $p —— 那会被编进 APK 而载体 SHA 声称的不是它）" >> "$LOG"
      exit 5 ;;
  esac
  [ -f "$MAIN/$p" ] || { echo "CHAIN_STOPPED_AT=overlay（主检出缺 $p ⇒ 清单过期，先修清单）" >> "$LOG"; exit 5; }
  if [ -f "$CARRIER/$p" ]; then
    mkdir -p "$BAK/$(dirname "$p")"; cp "$CARRIER/$p" "$BAK/$p" || { echo "CHAIN_STOPPED_AT=overlay（备份失败 ${p}）" >> "$LOG"; exit 5; }
    printf '%s|1\n' "$p" >> "$OVERLAY_LIST"
  else
    printf '%s|0\n' "$p" >> "$OVERLAY_LIST"
  fi
  mkdir -p "$CARRIER/$(dirname "$p")"
  cp "$MAIN/$p" "$CARRIER/$p" || { echo "CHAIN_STOPPED_AT=overlay（cp 失败 ${p}）" >> "$LOG"; exit 5; }
  A=$(digest "$MAIN/$p"); B=$(digest "$CARRIER/$p")
  if [ "$A" != "$B" ]; then
    echo "CHAIN_STOPPED_AT=overlay（$p 拷后字节不符 main=${A} carrier=${B}）" >> "$LOG"; exit 5
  fi
  echo "OVERLAY $p md5=${A}" >> "$LOG"
done
# 载体里除了覆盖件不许有产品目录的脏 —— 有就会被 `pnpm -r build` 编进产物，而载体 SHA 声称的不是它
DIRT=$(git -C "$CARRIER" status --porcelain -uno -- packages apps server | grep -c . || true)
if [ "$DIRT" != "0" ]; then
  echo "CHAIN_STOPPED_AT=carrier_dirty（packages/apps/server 有 ${DIRT} 行未提交修改，不打包）" >> "$LOG"
  git -C "$CARRIER" status --porcelain -uno -- packages apps server | sed 's/^/   仍脏：/' >> "$LOG"
  exit 5
fi
echo "OVERLAY_DONE n=${#JUDG_PATHS[@]} carrier_product_dirt=0 bak=$BAK" >> "$LOG"

# ── 1. 端口 ────────────────────────────────────────────────────────────────
# 🔴 端口**不许用默认 3000**：`scripts/lib/mobile-e2e.sh:144` 是 `E2E_PORT="${PORT:-3000}"`，
#    而 02:2x 现量 :3000 被**别人的一枚 node 进程**听着（pid 70256）。
#    那时 `mobile-e2e-up.sh` 起不来（或被跳过），而验收脚本只问 `${HOST_SERVER}/health` ——
#    别人的服务端照样回 `{"status":"ok"}` ⇒ 整轮四层判据是**对着别人的服务端**跑绿的。
#    本机早记过同一形状（`:3000 是别人旧进程`），所以这里按候选挑一个真空闲的端口，
#    并把同一个 PORT 同时传给起栈与验收（两边必须同源，否则一个在 3100、一个在问 3000）。
PORT_CANDIDATES="${PORT_CANDIDATES:-3100 3120 3140 3160}"
port_free() { [ -z "$(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1)" ]; }
if [ -n "${PORT:-}" ]; then
  port_free "$PORT" || { echo "CHAIN_STOPPED_AT=port（显式传入的 PORT=${PORT} 已被占）" >> "$LOG"; exit 4; }
else
  PORT=""
  for cand in $PORT_CANDIDATES; do
    if port_free "$cand"; then PORT="$cand"; break; fi
    echo "   候选 ${cand} 已被占（pid=$(lsof -nP -iTCP:"$cand" -sTCP:LISTEN -t 2>/dev/null | head -1)），跳过" >> "$LOG"
  done
  [ -n "$PORT" ] || { echo "CHAIN_STOPPED_AT=port（候选 ${PORT_CANDIDATES} 全被占）" >> "$LOG"; exit 4; }
fi
export PORT
echo "PORT=${PORT}（候选=${PORT_CANDIDATES}）" >> "$LOG"
# 演练旋钮：只验挑端口这一段就退出（02:2x 用它做阳性对照：候选里放进 3000 就必须被跳过）
if [ "${PORT_ONLY:-0}" = 1 ]; then echo "PORT_ONLY=${PORT}"; exit 0; fi

# ── 0b. 服务端的运行输入：载体里没有 `server/.env`，这两枚必须由链带过来 ──────────
# 🔴 17:4x 现量的失败形状：`STEP install rc=0`、`STEP build_all rc=0`，然后 `STEP stack_up rc=1`，
#    整条日志里唯一的线索是那一发 `Error: JWT_SECRET environment variable is required`
#    （抛点在 `server/dist/src/auth.js:63` = `server/src/auth.ts:34`）。
#    机制：`scripts/mobile-e2e-up.sh:208` 那个启动 env 块里**没有** JWT_SECRET，
#    主检出能起栈靠的是 `server/src/index.ts:1` 的 `import 'dotenv/config'` 去读**未跟踪**的
#    `server/.env` —— 而 linked worktree 不带来未跟踪文件
#    （现量 `ls "$CARRIER/server/.env"` = No such file；同刻主检出那枚有 JWT_SECRET 58 字符、
#    PASSWORD_PEPPER 70 字符 ⇒ "起得来"这件事从来没被任何判据量过）。
#    ⇒ 这是"运行输入由主检出里恰好有那个文件隐提供"那一族（本文件头那条"打包输入"与 §7 第 82 条同形）。
# 🔴 **不许就地生成一枚随机值了事**：`PASSWORD_PEPPER` 进的是**库里已存账号的口令哈希**
#    （`server/src/password/hash.ts:47`），换一枚 ⇒ 验收脚本拿老账号登录失败，
#    而那个红长得像"这条功能坏了"，不像"你把 pepper 换了"。
#    ⇒ 只从主检出那枚真源**显式带过来**，并且**只打名字与长度，值一个都不进日志**（AGENTS §8.10）。
# ⚠️ 优先级写成行为而不是巧合：dotenv **不覆盖已存在的 `process.env`**，所以下面 export 的两枚
#    压过载体那侧的任何 `.env`（载体此刻没有 ⇒ 现在这一条是"以后有也照这个走"，不是"现在没事"）。
# 这一格排在 install **之前**是刻意的：它是纯文件读，而窗口是稀缺资源（白烧一次 = 别人多等一轮）。
SERVER_ENV_SRC="${SERVER_ENV_SRC:-$MAIN/server/.env}"
srv_env_get() { sed -n "s|^$1=||p" "$SERVER_ENV_SRC" 2>/dev/null | tail -1; }   # 同名多行取最后一行（覆盖式写法的语义）
JWT_SECRET_VAL=$(srv_env_get JWT_SECRET)
PASSWORD_PEPPER_VAL=$(srv_env_get PASSWORD_PEPPER)
if [ -z "$JWT_SECRET_VAL" ] || [ -z "$PASSWORD_PEPPER_VAL" ]; then
  echo "CHAIN_STOPPED_AT=server_env（从 ${SERVER_ENV_SRC} 取到 JWT_SECRET=${#JWT_SECRET_VAL} PASSWORD_PEPPER=${#PASSWORD_PEPPER_VAL} 字符，两枚都必须非空）" >> "$LOG"
  echo "  ⇒ 这不是产品失败，也不是「再等一个窗口就好」：载体的运行输入缺了一整类，下一个窗口还是这一发。" >> "$LOG"
  exit 4
fi
export JWT_SECRET="$JWT_SECRET_VAL" PASSWORD_PEPPER="$PASSWORD_PEPPER_VAL"
echo "SERVER_ENV src=${SERVER_ENV_SRC} JWT_SECRET_len=${#JWT_SECRET_VAL} PASSWORD_PEPPER_len=${#PASSWORD_PEPPER_VAL} carrier_env=$([ -f "$CARRIER/server/.env" ] && echo present || echo absent)（值不进日志；export 的这两枚压过 dotenv）" >> "$LOG"
# 演练旋钮：只验这一格就退出（两腿：真 MAIN ⇒ rc=0 并打长度；MAIN 指到空目录 ⇒ rc=4 且停在 server_env）
if [ "${SERVER_ENV_ONLY:-0}" = 1 ]; then echo "SERVER_ENV_ONLY ok jwt_len=${#JWT_SECRET_VAL} pepper_len=${#PASSWORD_PEPPER_VAL}"; exit 0; fi

run() { # <步骤名> <命令...>
  local name="$1"; shift
  echo "----- STEP ${name} begin $(date '+%T') -----" >> "$LOG"
  "$@" >> "$LOG" 2>&1
  local rc=$?
  echo "STEP ${name} rc=${rc}" >> "$LOG"
  echo "[chain] ${name} rc=${rc}"
  return $rc
}

run install pnpm install --frozen-lockfile || { echo "CHAIN_STOPPED_AT=install" >> "$LOG"; exit 1; }
# 🔴 链接解析必须落在载体里，否则"在载体里打包"打的是别的树（本线 §3·补 ⑭ 记的那条坑）
RESOLVED=$(node -e 'console.log(require("fs").realpathSync(require("path").resolve("apps/mobile/node_modules/@heyta/ui")))' 2>/dev/null)
echo "RESOLVE ui=${RESOLVED}" >> "$LOG"
case "$RESOLVED" in
  "$CARRIER"/*) echo "RESOLVE_OK 载体自洽" >> "$LOG" ;;
  *) echo "CHAIN_STOPPED_AT=resolve（@heyta/ui 解析到别的树：${RESOLVED}）" >> "$LOG"; exit 1 ;;
esac

run build_all pnpm -r build || { echo "CHAIN_STOPPED_AT=build_all" >> "$LOG"; exit 1; }
# 🔴 载体这趟起栈**不许写那两枚跨树共享的名字**（`scripts/mobile-e2e-up.sh` 的 pidfile/logfile
#    原本写死 `/tmp/heyta-e2e-server.{pid,log}`，主检出与任何 worktree 载体共用同一个文件）。
#    17:5x 现量的后果两条，都是真的而不是推的：
#    ① 载体那趟起栈失败后，pidfile 里躺着一枚**死** pid（`95105 alive=no`），
#       而此刻 :3000 的真实监听者（`70256`）**没有任何地方记下它** ⇒ 那一棵的主人跑
#       `mobile-e2e-down.sh` 会"成功退出而什么都没停"（traps #191 一族：报绿的动作没碰到被测对象）；
#    ② 同一枚 logfile 被后起的那一棵截断覆盖 ⇒ 前一棵的服务端日志（判据读数）直接没了。
#    旋钮默认值逐字不变，所以这里传的是**本线自己隔离**，不改别人的行为。
#    路径打进链自己的日志：留下"这棵起过栈、怎么停"的口径，别留一枚没人知道的活进程。
E2E_PIDFILE="${E2E_PIDFILE:-/tmp/heyta-e2e-server.carrier.$$.pid}"
E2E_LOGFILE="${E2E_LOGFILE:-/tmp/heyta-e2e-server.carrier.$$.log}"
echo "E2E_PIDFILE=${E2E_PIDFILE} E2E_LOGFILE=${E2E_LOGFILE}（停它：HEYTA_E2E_PIDFILE=${E2E_PIDFILE} bash scripts/mobile-e2e-down.sh）" >> "$LOG"
run stack_up env PORT="$PORT" HEYTA_E2E_PIDFILE="$E2E_PIDFILE" HEYTA_E2E_LOGFILE="$E2E_LOGFILE" \
  bash scripts/mobile-e2e-up.sh || { echo "CHAIN_STOPPED_AT=stack_up" >> "$LOG"; exit 1; }
# 🔴 起栈失败**不再往下走**（原来这里只 `echo NOTE` 然后继续，等于把"没服务端"留给验收脚本来个 exit 3 ——
#    白烧一个窗口）。失败就停在哨兵 `CHAIN_STOPPED_AT=stack_up` 上。
# 阳性对照：栈起来之后这个端口必须真的在听。
if [ -z "$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)" ]; then
  echo "CHAIN_STOPPED_AT=stack_listen（PORT=${PORT} 起栈后没在听）" >> "$LOG"; exit 1
fi
echo "STACK_UP_OK port=${PORT} listener=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)" >> "$LOG"
# 🔴 后置断言：**"传了旋钮"不等于"接住旋钮的那份代码被跑了"**。载体那份 up 若是旧的已提交副本，
#    它照旧写那两枚跨树共享名，而副作用落在**别的树的读数**上、本线任何门禁都不会红
#    （§7 第 82 条同族："另一棵的状态 == 我以为的那份"要有判据，不能靠调用路径隐式决定）。
#    三条一起成立才算隔离住了：① 本线那枚 pidfile 在；② 里面那枚 pid **活着**；③ 它就是 $PORT 的监听者。
ISO_PID=""
[ -f "$E2E_PIDFILE" ] && ISO_PID=$(cat "$E2E_PIDFILE" 2>/dev/null)
ISO_LISTEN=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -z "$ISO_PID" ] || [ "$ISO_PID" != "$ISO_LISTEN" ] || ! kill -0 "$ISO_PID" 2>/dev/null; then
  echo "CHAIN_STOPPED_AT=stack_isolation（pidfile=${E2E_PIDFILE} 里的 pid=${ISO_PID:-〈空〉}，:${PORT} 的监听者=${ISO_LISTEN:-〈无〉}）" >> "$LOG"
  echo "  ⇒ 载体那份 scripts/mobile-e2e-up.sh 不认这两个旋钮 = 它是旧的已提交副本（第 0 步的覆盖清单没带到它）。" >> "$LOG"
  echo "    这一趟已经写过共享的 /tmp/heyta-e2e-server.{pid,log}；收尾前先 `ps -o pid,command -p ${ISO_LISTEN:-0}` 确认那是本线这棵，" >> "$LOG"
  echo "    **不要**停不是自己那棵的服务端（AGENTS §8.9：共享资源的动作要认所有者）。" >> "$LOG"
  exit 1
fi
echo "STACK_ISOLATION_OK pid=${ISO_PID}（就是 :${PORT} 的监听者；共享那两枚本线没碰）" >> "$LOG"
run build_android pnpm build:android || { echo "CHAIN_STOPPED_AT=build_android" >> "$LOG"; exit 1; }
# 🔴 刚打出来的 APK 里必须数得出本轮判据要点的三枚 testID 片段（§7 第 27 条那一族的正面补强：
#    "APK 不比源码旧"只比 mtime，比不出"判据要点的那几个字符串在不在产物里"）。
run preflight_after_build bash research/tools/r14c-bundle-testid-preflight.sh \
  || { echo "CHAIN_STOPPED_AT=preflight_after_build（本轮 APK 里没有判据要点的片段 ⇒ 装上去也验不到这条功能）" >> "$LOG"; exit 1; }

# ── 6. 动设备**那一刻**再问一次窗口（07:2x 补）──────────────────────────────
# 两个理由，都来自现量而不是设想：
# ① §8.9 的不变量是"install 时没人抢这台设备"，而链从开窗到 verify 中间隔着 `pnpm -r build`
#    + `pnpm build:android`（分钟级）。开窗判据量的是**几分钟前**，管不到这个时刻。
# ② 它是看守那一手 `FIRE=apk-deferred` 的**实现处**：看守允许"只红 APK"开窗，理由是链会自己打产物 ——
#    这个承诺只有在这里被同一条判据再量一次才算数；打完仍红就停在这里，不进设备面（验账，不是降级）。
# 判据一律复用闸门（不自建第二套），走**载体那份**（第 0 步已从主检出点名覆盖 + 逐枚 md5 对账），
# dry-run 不加 --confirm —— 执行由本链做，闸门只回答"窗口开着没"。
# 🔴 负载红可以给一次落位的机会：那一分钟负载里有**我自己刚打的 build** 一份。
#    这不是放松阈值（阈值仍是闸门算的那个数），是"把 caused-by-me 的读数等成不是自己造成的"。
#    除 load 以外的任何红（含 REDS 行缺失 = 闸门版本不对/装置坏）当场停。
REGATE_TRIES="${REGATE_TRIES:-3}"
REGATE_SETTLE="${REGATE_SETTLE:-60}"
RG=0; REGATE_RC=1; REGATE_REDS=''
while :; do
  RG=$((RG + 1))
  RT="/tmp/ht-r14c-regate.$$.try${RG}.txt"
  NO_COLOR=1 bash scripts/verify-mobile-window-gate.sh --target c --repo "$CARRIER" > "$RT" 2>&1
  REGATE_RC=$?
  sed 's/^/   [regate] /' "$RT" >> "$LOG"
  REGATE_REDS=$(grep -m1 '^REDS=' "$RT" 2>/dev/null | cut -d= -f2-)
  rm -f "$RT"
  echo "REGATE try=${RG} rc=${REGATE_RC} REDS=${REGATE_REDS:-〈该行不存在〉}" >> "$LOG"
  [ "$REGATE_RC" = 0 ] && break
  if [ "$REGATE_RC" = 3 ] && [ "$REGATE_REDS" = load ] && [ "$RG" -lt "$REGATE_TRIES" ]; then
    echo "REGATE=load-only（第 ${RG} 次，${REGATE_SETTLE}s 后重问；build 刚跑完，1 分钟负载还没落）" >> "$LOG"
    sleep "$REGATE_SETTLE"
    continue
  fi
  echo "CHAIN_STOPPED_AT=regate（try=${RG} rc=${REGATE_RC} REDS=${REGATE_REDS:-〈该行不存在〉} ⇒ 没动设备）" >> "$LOG"
  exit "$REGATE_RC"
done
echo "REGATE_OK try=${RG} —— 下面是第一次也是最后一次动设备" >> "$LOG"

run verify env PORT="$PORT" bash scripts/verify-mobile-due-time.sh
rc=$?
# 第 4 层单独再取一次独立读数（它和 verify 里那段同逻辑、同 env 默认值：`heyta_mobile_smoke@127.0.0.1:5432`，
# 03:5x 现量主检出 `verify-mobile-due-time.sh:626-629` 就是这四个默认值）。
# 用途是分辨"op 没到服务端"和"读不到服务端"—— 前者是产品红，后者是环境红。
run readability bash research/tools/r14c-server-readability-judgment.sh
echo "=== chain end $(date '+%F %T') verify_rc=${rc} readability_rc=$? ===" >> "$LOG"
echo "[chain] verify rc=${rc}"
exit $rc
