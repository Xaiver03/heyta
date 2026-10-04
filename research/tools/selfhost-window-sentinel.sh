#!/bin/sh
# 落地前置哨兵 v4 —— 从一次性 /tmp 脚本（v3，§8.126/§8.127/§8.138 用的那枚）收进仓库。
#
# 为什么要收进来：v3 住在 /tmp，而这台机器的 /tmp 会被清；更重要的是它**只打印**要跑的那条命令，
# 于是"窗开了"和"活干了"之间永远隔着一个人醒着的那一分钟。v3 的 7200s 观察期就是这么烧完的
# （§8.138 末段：23:14:10 CAP_REACHED，期间 main 变 18 次、阻塞集恒 1 枚）。
#
# 六件事**同时且持续**成立才算开窗（缺一就继续等，不调阈值、不硬跑）：
#   1) 阻塞集归零（别人未提交的工作树压在我也改过的文件上）
#   2) 1 分钟负载 ≤ 12
#   3) 链里那几枚会被 SIGKILL 的端口现在没人监听
#   4) 载体那棵树此刻不是别人的现场
#   5) main 这一样和上一样同一个值
#   6) 上面五件同时成立要连续保持 QUIET_MIN 分钟（默认 15）
#      ⚠️ 仍然只是**代理指标**：过去 15 分钟没动 ≠ 链那几十分钟里不动。它能把"每 85 秒一笔"
#      那种窗挡掉，挡不住"链跑到第 29 分钟来一笔" —— 后者由 `--confirm` 的 gate 5 判，
#      判到了就是退 1，那一次的全链读数仍然留在日志里（不是白跑，但落地要重来一趟）。
#
# 判据本体不抄第二份：端口走 selfhost-kill-ports.mjs，载体在用者走 selfhost-carrier-busy.mjs，
# 阻塞集走 selfhost-landing-blockers.mjs，开窗之后跑的是 selfhost-land-main.mjs --confirm
# （它自己那七道闸门 + 跑链前的看守三臂自证，见 §8.138，才是裁判）。
#
# 用法：
#   research/tools/selfhost-window-sentinel.sh                       # 只等只报（打印那条命令）
#   research/tools/selfhost-window-sentinel.sh --run-on-open         # 开窗即真的跑 --confirm（授权范围内：ff-only，不 push）
#   FORCE_OPEN=1 ... --run-on-open --run-cmd 'echo 演练'              # 演练开窗那一支（成功路径平时不执行）
#   LOG=... CAP=14400 STEP=150 QUIET_MIN=15 ...                      # 旋钮都有默认值，改的是观察不是判据
cd "$(dirname "$0")/../.." || exit 2
LOG=${LOG:-/tmp/selfhost-window-sentinel.log}
CAP=${CAP:-14400}
STEP=${STEP:-150}
QUIET_MIN=${QUIET_MIN:-15}
RUN_ON_OPEN=0
RUN_CMD=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --run-on-open) RUN_ON_OPEN=1 ;;
    --run-cmd) RUN_CMD=$2; shift ;;
    *) echo "未知参数：$1" >> "$LOG"; exit 2 ;;
  esac
  shift
done
SELF_CMD="$PWD/research/tools/selfhost-land-main.mjs"
MAIN_TREE=$(git worktree list --porcelain | awk '/^worktree /{p=substr($0,10)} /^branch refs\/heads\/main$/{print p; exit}')
ELAPSED=0
PREV_MAIN=''
STREAK=0
MAIN_CHANGES=0

# 🔴 自检负载解析取的是**哪一位**（§7 第 168 条那一族）：三位互不相同的合成样本，
#    读出来必须是第一位；读错就响亮失败，而不是拿着 5 分钟那位当"现在很安静"。
CAL=$(echo '{ 11.11 22.22 33.33 }' | tr -d '{}' | awk '{print $1}')
if [ "$CAL" != "11.11" ]; then
  echo "$(date +%H:%M:%S) PROBE_BAD 负载解析取的不是 1 分钟位（合成样读到 ${CAL}）" | tee -a "$LOG"
  exit 2
fi
if [ -z "$MAIN_TREE" ]; then
  echo "$(date +%H:%M:%S) PROBE_BAD 从 git worktree list 里找不到签出 main 的工作树 ⇒ 开窗也没地方跑 --confirm" | tee -a "$LOG"
  exit 2
fi
echo "$(date +%H:%M:%S) 起步 CAP=${CAP}s STEP=${STEP}s QUIET_MIN=${QUIET_MIN} run_on_open=${RUN_ON_OPEN} 主检出=${MAIN_TREE}" >> "$LOG"

while [ "$ELAPSED" -lt "$CAP" ]; do
  B=$(node research/tools/selfhost-landing-blockers.mjs 2>/dev/null | grep -o '阻塞集 [0-9]* 枚' | head -1 | tr -cd '0-9')
  L=$(sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1}')
  M=$(git rev-parse --short main 2>/dev/null)
  P=$(node -e '
    import("./research/tools/selfhost-kill-ports.mjs").then(async (m) => {
      const d = m.deriveKillPorts(process.env.HEYTA_CARRIER_WT ?? "/tmp/heyta-merge-carrier");
      if (d.error) { console.log("JUDGE:" + d.error.slice(0, 60)); return; }
      const s = m.listenersOn(d.ports);
      if (s.noLsof || s.brokenProbe) { console.log("JUDGE:" + (s.noLsof ? "no-lsof" : s.brokenProbe)); return; }
      console.log("BUSY=" + s.rows.map((r) => r.port + "/" + r.pid).join(",") + " OF " + d.ports.join("/"));
    });
  ' 2>&1)
  node research/tools/selfhost-carrier-busy.mjs --check > /tmp/selfhost-window-sentinel-carrier.txt 2>&1
  CB=$?
  CQ=$(head -1 /tmp/selfhost-window-sentinel-carrier.txt | cut -c1-72)

  LOAD_OK=0
  case "$L" in
    ''|*[!0-9.]*) LOAD_OK=0 ;;                      # 读不出形状 ⇒ 不算安静
    *) [ "$(echo "${L} <= 12" | bc -l 2>/dev/null || echo 0)" = "1" ] && LOAD_OK=1 ;;
  esac
  PORTS_FREE=0
  if echo "${P}" | grep -q '^BUSY= OF '; then PORTS_FREE=1; fi
  CARRIER_FREE=0
  if [ "$CB" = "0" ]; then CARRIER_FREE=1; fi
  MAIN_QUIET=0
  if [ -n "$M" ] && [ -n "$PREV_MAIN" ] && [ "$M" = "$PREV_MAIN" ]; then MAIN_QUIET=1; fi
  if [ -n "$M" ] && [ -n "$PREV_MAIN" ] && [ "$M" != "$PREV_MAIN" ]; then MAIN_CHANGES=$((MAIN_CHANGES + 1)); fi

  ONE_OK=0
  if [ "${B:-9}" = "0" ] && [ "${LOAD_OK}" = "1" ] && [ "${PORTS_FREE}" = "1" ] \
     && [ "${CARRIER_FREE}" = "1" ] && [ "${MAIN_QUIET}" = "1" ]; then ONE_OK=1; fi
  if [ "${ONE_OK}" = "1" ]; then STREAK=$((STREAK + 1)); else STREAK=0; fi
  QUIET_HOLD=0
  NEED_STREAK=$(( (QUIET_MIN * 60 + STEP - 1) / STEP ))
  if [ "${STREAK}" -ge "${NEED_STREAK}" ]; then QUIET_HOLD=1; fi

  echo "$(date +%H:%M:%S) 阻塞集=${B:-读不到} 负载=${L:-读不到} 端口=${P} main=${M:-读不到}(上一=${PREV_MAIN:-首样}) 连静=${STREAK}/${NEED_STREAK} 载体(rc${CB})=${CQ}" >> "$LOG"
  if [ "${FORCE_OPEN:-0}" = "1" ]; then STREAK=${NEED_STREAK}; QUIET_HOLD=1; M=${M:-forceopen}; fi
  if [ "${QUIET_HOLD}" = "1" ]; then
    echo "$(date +%H:%M:%S) WINDOW_OPEN 五件同时成立已连续 $((STREAK * STEP))s ≥ ${QUIET_MIN} 分钟（负载=${L} main=${M} 观察期内 main 变过 ${MAIN_CHANGES} 次）" >> "$LOG"
    echo "    手工等价命令：cd \"${MAIN_TREE}\" && node \"${SELF_CMD}\" --confirm" >> "$LOG"
    if [ "${RUN_ON_OPEN}" = "1" ]; then
      CMD_BODY=${RUN_CMD:-node "${SELF_CMD}" --confirm}
      echo "    $(date +%H:%M:%S) 开窗即执行：cd \"${MAIN_TREE}\" && ${CMD_BODY}" >> "$LOG"
      ( cd "$MAIN_TREE" && eval "$CMD_BODY" ) >> "$LOG" 2>&1
      RC=$?
      echo "    $(date +%H:%M:%S) LAND_RC=${RC}（0=已落地或未落地按 dry-run 语义；1/2/3/4 见 selfhost-land-main.mjs 文件头）" >> "$LOG"
      exit "$RC"
    fi
    echo "    ⚠️ 本哨兵没加 --run-on-open ⇒ 只报不开工。" >> "$LOG"
    exit 0
  fi
  PREV_MAIN=$M
  sleep "$STEP"
  ELAPSED=$((ELAPSED + STEP))
done
echo "$(date +%H:%M:%S) CAP_REACHED 等满 ${CAP}s：窗口仍未到（观察期内 main 变过 ${MAIN_CHANGES} 次，负载/端口/载体/阻塞集未同时凑齐）——环境/协作未到位，不是产品失败" >> "$LOG"
exit 3
