#!/usr/bin/env bash
# B（四端重装，AGENTS §6.1.1）的**开工体检 + 有界执行器**。
#
# 为什么要有这条：B 的前置是**瞬时读数**，而本线今天实测被三样东西分别挡住 ——
#   ① 有另一趟 reinstall 在跑（且它卡在 Apple 公证的 `--wait` 上，3h20m 累计 CPU 只有 0.03s）；
#   ② 主检出里有**别人未提交的打包输入**（`packages apps server` 现量几十枚）——
#      在这种树上跑固定收尾，装进四端的是别人的半成品（§7 第 82 条那一族，而门禁只数得出现场）；
#   ③ 负载超阈值。
# 散文写的"等窗口"没有可复跑形状，所以落成这一条。
#
# 🔴 默认 **dry-run**：只量、只打印要跑的命令，**绝不动设备、绝不动索引、绝不起 reinstall**。
#    真执行必须显式 `--confirm`，而且体检要全绿 —— 这条顺序是判据本体（见 --selftest 的臂 1）。
#
# 载体这一手不是本线发明的：`docs/plans/` 与本线台账都记着"共享工作树有别人 WIP 时
# 改用 detached worktree 从 HEAD 打包，四段已实测跑绿"。这里把它做成有前置的默认路线：
# 🔴 载体必须是**真装过依赖**的树。把 node_modules 软链回别的树会让 pnpm 判定要整目录重建，
#    而没有 TTY 时它中止；把它"修绿"的开关（CI=true / confirmModulesPurge=false）
#    等于授权 pnpm 去清别人正在用的那棵树 —— 所以软链数 ≠ 0 直接判红，不给绕过去的旋钮。
#
# 退出码：0 = 体检通过（dry-run 下打印了可跑命令；--confirm 下那一趟 reinstall 自己 rc=0）
#         1 = 用法/前提不成立（参数不认识、给了 `--confirm` 却没给可核对的载体…）
#         3 = 窗口没开（有别的 reinstall / 别人未提交的打包输入且没给载体 / 负载超阈值）
#         4 = 装置坏（找不到 reinstall-all.sh、探针自测不过）
#
# 用法：
#   bash research/tools/b-reinstall-readiness.sh                        # 干跑（主检出）
#   CARRIER=/path/to/clean/worktree bash research/tools/b-reinstall-readiness.sh
#   IOS_DEVICE_NAME=heyta-iphone-17pro CARRIER=… bash … --confirm
#
# 🔴 已知边界（00:2x 记在这里，别把它读成"载体就该停在旧提交"）：第 3 格要求**目标树没有未提交的
#    打包输入**，所以"载体 = 主检出当前提交 + 本批未提交文件"那种形状它一律判红。这是有意的 ——
#    本脚本判断不了那些未提交文件是谁的，而把不可归因的字节装进四端正是 §7 第 82 条那一族。
#    要装本批未提交的东西，先由那些文件的作者入库再走 --confirm；**不要**给这一格加"我保证是我的"旋钮。
#    （第 7 格管的是另一件事：载体入库了、但入库的那一格**不是主检出当前那一格**。）
set -u

MAIN="${MAIN:-/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta}"
# 「那一趟是在推进还是楔住」的纯读数（与窗口闸门**共用同一份 lib**，不各抄一份）。
# 它不参与本脚本的红/绿与退出码 —— 只把"下一步该等还是该找人"打在输出里。
# 🔴 解析顺序 = 旋钮 → 本文件自身位置 → ${MAIN}，三处都取不到才判装置坏。
#    为什么不能只按自身位置（第一版就是）：变异 rig 是**把本文件拷到 /tmp 再跑**的，
#    那一档下 `dirname "$0"` 指向 /tmp，于是每一臂（连对照）都撞上这里的 exit 4 ——
#    症状长得像"新鲜度那条挂了"，其实挂的是探针。只按 $MAIN 也不行：自测臂把 MAIN
#    指到一次性夹具仓库，那里没有 scripts/lib/。取不到一律**响亮**失败，不降级成"少一道读数"。
WEDGE_LIB="${WEDGE_LIB:-}"
if [ -z "$WEDGE_LIB" ]; then
  HERE_TOOLS="$(cd "$(dirname "$0")" && pwd)"
  for _c in "$HERE_TOOLS/../../scripts/lib/wedged-runner.sh" "$MAIN/scripts/lib/wedged-runner.sh"; do
    [ -f "$_c" ] && { WEDGE_LIB="$_c"; break; }
  done
fi
if [ -n "$WEDGE_LIB" ] && [ -f "$WEDGE_LIB" ]; then
  # shellcheck source=../../scripts/lib/wedged-runner.sh
  . "$WEDGE_LIB"
  # 🔴 把自己解析出来的路径**传给子进程**：--selftest 的四臂会用 `bash "$0"` 再跑一次本文件，
  #    而那时 MAIN 已被指到一次性夹具仓库、`dirname "$0"` 可能是 /tmp（变异 rig 就是这么跑的）
  #    ⇒ 两条候选都落空，臂会集体撞上下面那个 exit 4（本轮实测：九臂 rig 连**对照**都 rc=4）。
  export WEDGE_LIB
else
  echo "❌ 装置坏：取不到 wedged-runner.sh（旋钮 WEDGE_LIB=<路径> 可显式给）⇒ 楔住与否这条读数无法给出，本脚本不降级" >&2
  exit 4
fi
cd "$MAIN" || { echo "❌ 进不去主检出：$MAIN" >&2; exit 4; }
[ -f scripts/reinstall-all.sh ] || { echo "❌ 找不到 scripts/reinstall-all.sh（装置坏）" >&2; exit 4; }

CONFIRM=0
SELFTEST=0
for a in "$@"; do
  case "$a" in
    --confirm) CONFIRM=1 ;;
    --selftest) SELFTEST=1 ;;
    -h|--help) awk '/^set -u/{exit} {print}' "$0"; exit 0 ;;
    *) echo "❌ 未知参数：${a}（只认 --confirm / --selftest / --help）" >&2; exit 1 ;;
  esac
done

# 真跑哪一条命令是可注入的：`--selftest` 靠它把"该拒的必须拒"测成真话，而不是拿本仓库当夹具。
REINSTALL_CMD="${REINSTALL_CMD:-}"

TARGET="${CARRIER:-$MAIN}"
LOAD_LIMIT=$(( $(sysctl -n hw.ncpu) * 3 / 4 ))
RI_PATTERN='scripts/[.]?reinstall-all[.]sh'
# 🔴 三个环境探针（有没有别的 reinstall / 负载 / 已启动模拟器）都可注入，默认值逐字等于原命令。
#    注入不是为了跳过判据，是为了能造出一棵「全绿」的现场：--selftest 的臂 1 只测了「该拒的必须拒」，
#    而「全绿时真的会起」这一腿当时没有任何一层在验 —— 少它的话，一处误写的 FAILS+1 会让这台执行器
#    永久拒启，而臂 1 照样绿（§8.3 的对偶：永远不通过的判据与永远通过的同样糟）。
RI_PRODUCER="${RI_PRODUCER:-pgrep -f \"$RI_PATTERN\"}"
LOAD_SRC="${LOAD_SRC:-uptime}"
SIM_LIST="${SIM_LIST:-xcrun simctl list devices booted}"
FAILS=0; NOTES=''

note() { NOTES="${NOTES}   · $1
"; }

# ── 1. 有没有**另一趟** reinstall 在跑（排除自己这一棵树：本脚本的命令行里不含那个串）──
RI_PIDS=$(eval "$RI_PRODUCER" 2>/dev/null | grep -vw "$$" | tr '\n' ' ' || true)
if [ -n "${RI_PIDS// /}" ]; then
  echo "❌ 有另一趟 reinstall-all 在跑（pid：${RI_PIDS% }）—— 两趟并行会互相卸装"
  for p in $RI_PIDS; do
    ps -p "$p" -o pid=,etime=,command= 2>/dev/null | cut -c1-140 | sed 's/^/      /'
    # 追一层：它**卡在哪一步**决定还要不要等（"在跑"和"卡在外部服务"是两种下一步）
    kid=$(pgrep -P "$p" 2>/dev/null | tail -1)
    [ -n "$kid" ] && ps -p "$kid" -o pid=,stat=,time=,etime=,command= 2>/dev/null | cut -c1-150 | sed 's/^/        └ /'
    # 上面那两行只给**数**，这一行给**结论**：那一趟是"还在推进"还是"卡在外部服务上"。
    ht_wedge_report "$p" "重装" "        "
  done
  FAILS=$((FAILS + 1))
else
  echo "✅ 没有别的 reinstall-all 在跑"
fi

# ── 2. 负载门（只量不等；要等请用仓库那道 canonical 门）──
LOAD1=$(eval "$LOAD_SRC" | sed 's/.*load averages: //' | awk '{print int($1)}')
if [ "$LOAD1" -le "$LOAD_LIMIT" ]; then
  echo "✅ 负载 $LOAD1 ≤ ${LOAD_LIMIT}（$(sysctl -n hw.ncpu) 核 × 3/4）"
else
  echo "❌ 负载 $LOAD1 > $LOAD_LIMIT —— 等落回阈值内（本脚本不替你等：等是另一道门的事）"
  FAILS=$((FAILS + 1))
fi

# ── 3. 打包输入：目标树里有没有**别人未提交**的源码 ──
DIRTY=$(git -C "$TARGET" status --porcelain -- packages apps server 2>/dev/null | grep -E '^ ?M' | wc -l | tr -d ' ')
if [ "$DIRTY" = "0" ]; then
  echo "✅ 目标树（${TARGET}）里 packages/apps/server 没有未提交改动 —— 装的就是它自己的提交"
else
  echo "❌ 目标树里有 $DIRTY 枚未提交的打包输入 —— 装进四端的就是别人的半成品（§7 第 82 条）"
  note "这一条**没有**'照样跑'的旋钮。要么等那些文件的所有者提交，要么传 CARRIER=<干净载体>。"
  FAILS=$((FAILS + 1))
fi

# ── 4. 载体的依赖树必须是真装的（软链 = 会让 pnpm 去清别人那棵树）──
if [ "$TARGET" != "$MAIN" ]; then
  LINKS=$(find "$TARGET" -maxdepth 4 -type l -name node_modules 2>/dev/null | wc -l | tr -d ' ')
  if [ "$LINKS" = "0" ]; then
    echo "✅ 载体里没有软链来的 node_modules（${LINKS}）"
  else
    echo "❌ 载体里有 $LINKS 枚软链 node_modules —— 装置红（exit 1），不是产品红"
    echo "   在这种树上跑 pnpm 会判定要整目录重建 modules，无 TTY 时中止；"
    echo "   而把它'修绿'的开关等于授权 pnpm 清别人正在用的那棵树 ⇒ 本脚本不给绕过的旋钮。"
    exit 1
  fi
fi

# ── 5. iOS 目标名现取（B 的 ios 段下一步就是 `simctl uninstall`，不许靠默认值猜目标）──
IOS="${IOS_DEVICE_NAME:-}"
# 🔴 **整名**取，不许按空格切。本机现场有一台叫 `iPhone Duo heyta`，
#    原来那枚 `grep -oE '[^ (]+ \(…\)'` 把它截成 `heyta` —— 于是列表里冒出一个**不存在**的目标名，
#    而下一句就是 `simctl uninstall`。同一族缺陷今天在 `verify-mobile-window-gate.sh` 里刚修过（带空格的真名字要逐字保留）。
BOOTED=$(eval "$SIM_LIST" 2>/dev/null \
  | sed -nE 's/^[[:space:]]*(.*)[[:space:]]+\([0-9A-Fa-f-]+\)[[:space:]]*\(Booted\).*$/\1/p' || true)
# 🔴 解析层与原始行**必须对得上**，否则"0 台已启动"会被读成"没有模拟器"。
#    这不是假想：上一版这里用 BSD sed 的 BRE 写 `+`（在 BRE 里 `+` 是字面加号，不是量词），
#    于是三台 booted 解析成 **0 台** —— 症状比截断更坏，因为它读起来像现场事实。
RAW_BOOTED=$(eval "$SIM_LIST" 2>/dev/null | grep -c '(Booted)' || true)
N_PARSED=$(printf '%s\n' "$BOOTED" | grep -c '[^[:space:]]')
if [ "$N_PARSED" != "$RAW_BOOTED" ]; then
  echo "❌ 探针坏了：解析出 $N_PARSED 台，而原始输出里有 $RAW_BOOTED 行 '(Booted)' —— 不拿这个读数判目标" >&2
  exit 4
fi
BOOTED_N=$(printf '%s\n' "$BOOTED" | grep -c '[^[:space:]]')
if [ -z "$IOS" ]; then
  if [ "$BOOTED_N" = "1" ]; then
    IOS="$BOOTED"; note "IOS_DEVICE_NAME 没传，取唯一那台已启动模拟器：$IOS"
  else
    echo "⚠️ 有 $BOOTED_N 台已启动模拟器且没传 IOS_DEVICE_NAME —— 不猜目标，要跑请显式传"
    printf '%s\n' "$BOOTED" | sed 's/^/      /'
    FAILS=$((FAILS + 1))
  fi
else
  # 🔴 三个旗标**分开写**。原来写成 `grep -fxq` —— getopt 里 `-f` 是"模式文件"，
  #    它把同一簇里后面的 `xq` 整个吞掉当文件名 ⇒ `grep: xq: No such file or directory`，
  #    退出码非零 ⇒ 这条匹配**对任何名字都判"不在列表里"**，而输出的口吻像在说现场有问题。
  #    一条永远不通过的判据比没有判据更糟（AGENTS §8.3），这次是当场撞上的。
  if printf '%s\n' "$BOOTED" | grep -q -x -F -- "$IOS"; then
    echo "✅ iOS 目标现取到且匹配：$IOS"
  else
    echo "❌ 传的 IOS_DEVICE_NAME='$IOS' 不在已启动列表里 —— 不猜、不改名去凑"
    printf '%s\n' "$BOOTED" | sed 's/^/      /'
    FAILS=$((FAILS + 1))
  fi
fi

# ── 6. Android 段的目标设备可达 ──
# reinstall-all.sh 的 android 段第一句就是 adb -s "$SERIAL" get-state（现量：SERIAL 取
# HEYTA_E2E_SERIAL，默认 emulator-5554），不通则该段判红、整体 exit 1。
# 体检不检这一条 ⇒ 它能报"五项全绿、可以开跑"，而那一趟**注定有一端红** ——
# 报"窗口开"却验不出窗口关着，正是 AGENTS §8.3 说的那类装饰判据。
# 🔴 adb 走可注入的 ADB 旋钮：selftest 靠它把"绿的那条腿真的能绿"测出来（上一条 grep -fxq
#    的教训——只测负向，就会把探针的坏读成现场的坏）。
ADB="${ADB:-adb}"
SERIAL="${HEYTA_E2E_SERIAL:-emulator-5554}"
if ! command -v "$ADB" >/dev/null 2>&1; then
  echo "❌ 探针坏：本机没有 adb（${ADB}），这条前置无法判定 —— 不许当成'设备没问题'" >&2
  exit 4
fi
if "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
  echo "✅ Android 段目标可达：${SERIAL}"
else
  ONLINE=$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}' | tr '\n' ' ')
  echo "❌ Android 段目标 ${SERIAL} 不可达；当前 adb 在线设备：${ONLINE:-一个都没有}"
  echo "   现在起 reinstall 的 android 段必红（§6.1.1：环境原因如实报红，不硬装）"
  EM_BIN=''
  for c in "${ANDROID_HOME:-}/emulator/emulator" "${ANDROID_SDK_ROOT:-}/emulator/emulator" \
           /opt/homebrew/share/android-commandlinetools/emulator/emulator \
           "$HOME/Library/Android/sdk/emulator/emulator"; do
    [ -x "$c" ] && { EM_BIN="$c"; break; }
  done
  if [ -z "$EM_BIN" ]; then
    echo "   ⚠️ 没找到 emulator 可执行文件 ⇒ 这一步连命令都给不出，请手工起模拟器"
  else
    HEYTA_AVDS=$("$EM_BIN" -list-avds 2>/dev/null | grep -i heyta | tr '\n' ' ' || true)
    N_H=$(printf '%s' "$HEYTA_AVDS" | wc -w | tr -d ' ')
    if [ "$N_H" = "1" ]; then
      echo "   环境准备**不在本脚本里代跑**（起 qemu 会把负载顶上去，别人的 adb 因此超时）："
      echo "     ${EM_BIN} -avd ${HEYTA_AVDS% } -no-snapshot-save >/dev/null 2>&1 &"
      note "Android 段没有可达设备（${SERIAL} 离线；本线 AVD = ${HEYTA_AVDS% }，要人先起）"
    else
      echo "   ⚠️ 名字含 heyta 的 AVD 有 ${N_H} 台（${HEYTA_AVDS:-一台都没有}）—— 不替你选目标，显式 -avd 再起"
    fi
  fi
  FAILS=$((FAILS + 1))
fi

# ── 7. 载体新鲜度：走隔离载体那一手时，产物必须与主检出当前提交**在打包输入面上同形** ──
# 为什么单独立一条：`CARRIER=` 这条路是"主检出里有别人 WIP"时的正解，但它自带一个新问题 ——
# 载体停在**某个旧提交**上，reinstall 就从那里打包。
# 🔴 而 §6.1.1 给每一端配的那四条判据（截图非空白 / 主蓝命中 / install Success / 产物新鲜）
#   **一条都不问"是不是这一批"**（§7 第 178 条原话）。
#   本线 C 那一趟已为同一件事付过学费：02:0x 现量载体落后主检出 33 个 APK 输入面文件，
#   而当时"APK 不比源码旧"那条腿在载体内部两边一起旧 ⇒ 照样报绿。
#
# 🔴 判的是**输入面差集**，不是"sha 是否相等"（00:1x 现量把这条照出来了）：
#   主检出这几小时前进了 20 个提交，全仓只差 7 个文件、其中 3 个在 `scripts/`（mobile-e2e 夹具）——
#   裸 sha 判据会把"只动文档"的漂移也判红（那是 §6 第 20 条说的"永远关着的门"），
#   又把真正要拦的东西埋在一条不指名的"旧提交"里。⇒ 差集非空才判红，差集为空就如实判绿并写明差在哪。
#   输入面取 `packages apps server scripts` + 根 build 三件（`package.json`/`pnpm-workspace.yaml`/
#   `pnpm-lock.yaml`）：这四类是打进四端产物或驱动打包的字节；`docs`/`research`/台账不在内。
#   🔴 取不到差集时按**红**处理（fail-closed）—— 独立克隆的载体没有主检出那几个提交的对象，
#      "算不出差异"不能读成"没有差异"。
INPUT_FACES='packages apps server scripts package.json pnpm-workspace.yaml pnpm-lock.yaml'
if [ "$TARGET" != "$MAIN" ]; then
  CAR_SHA=$(git -C "$TARGET" rev-parse HEAD 2>/dev/null || printf '')
  MAIN_SHA=$(git -C "$MAIN" rev-parse HEAD 2>/dev/null || printf '')
  if [ -z "$CAR_SHA" ] || [ -z "$MAIN_SHA" ]; then
    echo "❌ 探针坏：取不到提交号（载体=${CAR_SHA:-空} 主检出=${MAIN_SHA:-空}）⇒ 新鲜度无法判定，不能当成'载体是新的'" >&2
    exit 4
  fi
  if [ "$CAR_SHA" = "$MAIN_SHA" ]; then
    echo "✅ 载体新鲜：${CAR_SHA} == 主检出 HEAD"
  else
    git -C "$TARGET" diff --name-only "$CAR_SHA" "$MAIN_SHA" -- $INPUT_FACES >/tmp/b-carrier-delta.txt 2>/dev/null
    D_RC=$?
    NDIFF=$(grep -c . /tmp/b-carrier-delta.txt 2>/dev/null || true); NDIFF=${NDIFF:-0}
    NALL=$(git -C "$TARGET" diff --name-only "$CAR_SHA" "$MAIN_SHA" 2>/dev/null | grep -c . || true); NALL=${NALL:-0}
    BEHIND=$(git -C "$TARGET" rev-list --count "$CAR_SHA..$MAIN_SHA" 2>/dev/null || printf ''); BEHIND=${BEHIND:-〈取不到〉}
    AHEAD=$(git -C "$TARGET" rev-list --count "$MAIN_SHA..$CAR_SHA" 2>/dev/null || printf ''); AHEAD=${AHEAD:-〈取不到〉}
    if [ "$D_RC" != "0" ]; then
      echo "❌ 载体停在 ${CAR_SHA}，主检出 HEAD 是 ${MAIN_SHA}，而**打包输入面差异取不到**（rc=${D_RC}，多半这棵载体里没有对方提交的对象 —— 独立克隆而非 linked worktree）⇒ 按红处理：算不出差异不等于没有差异"
      echo "   修法：把载体做成主检出的 linked worktree（git -C \"$MAIN\" worktree add --detach <路径> ${MAIN_SHA}），或在载体里 git fetch 到能看见该提交后重跑本体检"
      note "载体与主检出不同提交且打包输入面差异无法计算（fail-closed 判红）"
      FAILS=$((FAILS + 1))
    elif [ "$NDIFF" != "0" ]; then
      echo "❌ 载体停在 ${CAR_SHA}，主检出 HEAD 是 ${MAIN_SHA}（落后 ${BEHIND} 个提交 / 超前 ${AHEAD} 个）—— **打包输入面差 ${NDIFF} 个文件** ⇒ 这一趟装出来的是旧提交的产品代码或验收夹具（§7 第 178 条那一族）"
      sed 's/^/      /' /tmp/b-carrier-delta.txt | head -25
      echo "   修法：git -C \"$TARGET\" checkout --detach \"$MAIN_SHA\""
      echo "        （载体脏着会被拒；先 bash research/tools/r14c-carrier-heal.sh 做有界自愈）"
      note "载体在打包输入面上落后主检出（${NDIFF} 个文件，清单 /tmp/b-carrier-delta.txt）"
      FAILS=$((FAILS + 1))
    else
      echo "ℹ️ 载体停在 ${CAR_SHA}，主检出 HEAD 是 ${MAIN_SHA}（落后 ${BEHIND} 个提交 / 超前 ${AHEAD} 个）—— 但**打包输入面逐字相同**（全仓差 ${NALL} 个文件，都在非输入面：docs/research/台账）⇒ 产物同形，本腿判绿"
      note "载体落后 ${BEHIND} 个提交，差异只在非输入面（产物同形，不拦）"
    fi
  fi
else
  echo "ℹ️ 目标树就是主检出 ⇒ 本腿不适用（别人 WIP 那一面由第 3 条管）"
fi

echo ""
echo "目标树：$TARGET"
echo "要跑的命令（本脚本不代执行，除非 --confirm 且上面全绿）："
echo "  IOS_DEVICE_NAME=\"${IOS:-<现取>}\" bash \"$TARGET/scripts/reinstall-all.sh\""

if [ "$SELFTEST" = 1 ]; then
  # ── 臂 2：新加的 Android 前置**两条腿都要能走** ──
  # 只测"没设备应当红"这一条，测不出"这条判据结构上永远不成立"（本脚本上一条 grep -fxq
  # 就是这么把一个永远不通过的匹配读成"现场没有这台模拟器"）。所以拿 adb 桩各喂一次。
  echo "== selftest 臂 2：Android 段前置的正/负两条腿 =="
  ADB_OK=$(mktemp); printf '#!/bin/sh\nif [ "$1" = "-s" ]; then shift 2; fi\nif [ "$1" = "get-state" ]; then echo device; exit 0; fi\nif [ "$1" = "devices" ]; then echo "List of devices attached"; echo "emulator-5554\tdevice"; exit 0; fi\nexit 0\n' > "$ADB_OK"; chmod +x "$ADB_OK"
  ADB_BAD=$(mktemp); printf '#!/bin/sh\nif [ "$1" = "-s" ]; then shift 2; fi\nif [ "$1" = "get-state" ]; then exit 1; fi\nif [ "$1" = "devices" ]; then echo "List of devices attached"; exit 0; fi\nexit 0\n' > "$ADB_BAD"; chmod +x "$ADB_BAD"
  ARM2_BAD=0
  ADB="$ADB_OK" bash "$0" >/tmp/b-arm2-ok.out 2>&1
  RC_OK=$?
  HIT_OK=$(grep -c '✅ Android 段目标可达：' /tmp/b-arm2-ok.out || true)
  if [ "$HIT_OK" != "1" ]; then
    echo "   ❌ 正向腿：桩 adb 报了 device，这一条却没判绿（命中 ${HIT_OK}）—— 判据永远不通过"
    ARM2_BAD=$((ARM2_BAD + 1))
  else
    echo "   ✅ 正向腿：桩报 device ⇒ 判绿（rc=${RC_OK}）"
  fi
  ADB="$ADB_BAD" bash "$0" >/tmp/b-arm2-bad.out 2>&1
  RC_BAD=$?
  HIT_BAD=$(grep -c '❌ Android 段目标' /tmp/b-arm2-bad.out || true)
  if [ "$HIT_BAD" != "1" ] || [ "$RC_BAD" = "0" ]; then
    echo "   ❌ 负向腿：桩报不可达，却没判红（命中 ${HIT_BAD}，rc=${RC_BAD}）"
    ARM2_BAD=$((ARM2_BAD + 1))
  else
    echo "   ✅ 负向腿：桩报不可达 ⇒ 判红且 rc=${RC_BAD}（带 AVD 名的准备命令，不代跑）"
  fi
  rm -f "$ADB_OK" "$ADB_BAD" /tmp/b-arm2-ok.out /tmp/b-arm2-bad.out

  # ── 臂 3：载体新鲜度那条的四条腿（夹具全是一次性 git 仓库，不碰本仓库）──
  # 第 7 条判的是**打包输入面差集**，所以夹具要能造出四种现场，缺一种就是缺一条腿：
  #   腿 1 同提交 ⇒ 判绿（新鲜）；腿 2 只差非输入面 ⇒ 判绿（产物同形，这条挡"sha 不等就判红"的过严形状）；
  #   腿 3 差输入面 ⇒ 判红**并指名那枚文件**；腿 4 两枚互不相干的仓库 ⇒ 差异取不到 ⇒ fail-closed 判红。
  echo ""
  echo "== selftest 臂 3：载体新鲜度的四条腿（夹具是一次性 git 仓库）=="
  FM=$(mktemp -d); FR=$(mktemp -d); WTROOT=$(mktemp -d)
  A3BAD=0
  expect3() { # $1=腿号 $2=说明 $3=日志 $4=needle $5=期望命中数
    local got
    got=$(grep -c -- "$4" "$3" 2>/dev/null || true); got=${got:-0}
    if [ "$got" = "$5" ]; then
      echo "   ✅ 腿 $1（$2）：「$4」命中 ${got}（要 $5）"
    else
      echo "   ❌ 腿 $1（$2）：「$4」命中 ${got}（要 $5）"
      tail -6 "$3" | sed 's/^/      /'
      A3BAD=$((A3BAD + 1))
    fi
  }
  # 主检出夹具要带得上文件头那道装置前提（取不到 scripts/reinstall-all.sh 会直接 exit 4），
  # 否则这一臂测的是装置前提，不是新鲜度。
  mkdir -p "$FM/docs" "$FM/packages/app-host" "$FM/scripts"
  printf '#!/bin/sh\n' > "$FM/scripts/reinstall-all.sh"; chmod +x "$FM/scripts/reinstall-all.sh"
  printf 'base\n' > "$FM/docs/base.md"
  printf 'export const a = 1\n' > "$FM/packages/app-host/a.ts"
  git -C "$FM" init -q; git -C "$FM" config user.email t@t; git -C "$FM" config user.name t
  git -C "$FM" add -A >/dev/null 2>&1; git -C "$FM" commit -qm base >/dev/null 2>&1
  git -C "$FM" worktree add -q --detach "$WTROOT/base" HEAD >/dev/null 2>&1
  # adb 桩**自带一份**，不复用臂 2 那两枚：臂 2 在自己的收尾里把它们 rm 了，
  # 复用拿到的是不存在的路径 ⇒ 第 6 条 command -v 判「探针坏」exit 4，
  # 读数看着像"新鲜度这条挂了"，其实是夹具生命周期没接上。
  ADB_FR=$(mktemp)
  printf '#!/bin/sh\nif [ "$1" = "-s" ]; then shift 2; fi\nif [ "$1" = "get-state" ]; then echo device; exit 0; fi\nif [ "$1" = "devices" ]; then echo "List of devices attached"; echo "emulator-5554\tdevice"; exit 0; fi\nexit 0\n' > "$ADB_FR"
  chmod +x "$ADB_FR"
  a3run() { # $1=载体 $2=主检出 $3=日志
    ADB="$ADB_FR" IOS_DEVICE_NAME=fixture-target CARRIER="$1" MAIN="$2" bash "$0" >"$3" 2>&1
  }

  # 腿 1：主检出前进了一笔**只动文档**的提交 ⇒ sha 不等但产物同形，必须判绿
  printf 'only docs\n' > "$FM/docs/only.md"
  git -C "$FM" add -A >/dev/null 2>&1; git -C "$FM" commit -qm docs-only >/dev/null 2>&1
  L1=$(mktemp); a3run "$WTROOT/base" "$FM" "$L1"
  expect3 1 '只差非输入面⇒产物同形判绿' "$L1" '打包输入面逐字相同' 1
  expect3 1 '同一趟不许误判红' "$L1" '❌ 载体停在' 0

  # 腿 2：主检出又前进了一笔**动输入面**的提交 ⇒ 必须判红，且把差的那枚点名出来
  printf 'export const b = 2\n' > "$FM/packages/app-host/b.ts"
  git -C "$FM" add -A >/dev/null 2>&1; git -C "$FM" commit -qm pkg-change >/dev/null 2>&1
  L2=$(mktemp); a3run "$WTROOT/base" "$FM" "$L2"
  expect3 2 '输入面落后⇒判红' "$L2" '❌ 载体停在' 1
  expect3 2 '红要指名差集' "$L2" 'packages/app-host/b.ts' 1

  # 腿 3：载体与主检出同一枚提交 ⇒ 判绿（少了这条测不出"永远判红"）
  git -C "$FM" worktree add -q --detach "$WTROOT/same" HEAD >/dev/null 2>&1
  L3=$(mktemp); a3run "$WTROOT/same" "$FM" "$L3"
  expect3 3 '同提交⇒判绿' "$L3" '✅ 载体新鲜' 1
  expect3 3 '同一趟不许误判红' "$L3" '❌ 载体停在' 0

  # 腿 4：两枚互不相干的仓库 ⇒ 差异根本算不出来，必须 fail-closed 判红而不是当成"没差异"
  git -C "$FR" init -q; git -C "$FR" config user.email t@t; git -C "$FR" config user.name t
  printf 'unrelated\n' > "$FR/f"; git -C "$FR" add -A >/dev/null 2>&1; git -C "$FR" commit -qm v1 >/dev/null 2>&1
  L4=$(mktemp); a3run "$FR" "$FM" "$L4"
  expect3 4 '差异取不到⇒fail-closed 判红' "$L4" '打包输入面差异取不到' 1

  ARM3_BAD=$A3BAD
  git -C "$FM" worktree remove --force "$WTROOT/base" >/dev/null 2>&1
  git -C "$FM" worktree remove --force "$WTROOT/same" >/dev/null 2>&1
  rm -f "$ADB_FR" "$L1" "$L2" "$L3" "$L4" /tmp/b-carrier-delta.txt
  rm -rf "$FM" "$FR" "$WTROOT"

  # ── 臂 1b：全绿现场下 --confirm **必须真起一次** ──
  # 臂 1 测的是"该拒的必须拒"，那一臂在"这台执行器永远拒启"的坏法下**照样绿** ——
  # 而"拒启"看起来完全安全，所以这个缺陷可以永久存在而不被任何人发现（§8.3 的对偶）。
  # 这一臂靠三个注入点造出一棵全绿现场（探针的默认值没被改，测的还是同一条判定路径）。
  echo ""
  echo "== selftest 臂 1b：全绿 ⇒ 桩命令被起恰好 1 次 =="
  FM2=$(mktemp -d); STUB2=$(mktemp)
  mkdir -p "$FM2/scripts"
  printf '#!/bin/sh\n' > "$FM2/scripts/reinstall-all.sh"; chmod +x "$FM2/scripts/reinstall-all.sh"
  git -C "$FM2" init -q >/dev/null 2>&1
  git -C "$FM2" config user.email t@t; git -C "$FM2" config user.name t
  git -C "$FM2" add -A >/dev/null 2>&1; git -C "$FM2" commit -qm base >/dev/null 2>&1
  ADB_1B=$(mktemp)
  printf '#!/bin/sh\nif [ "$1" = "-s" ]; then shift 2; fi\nif [ "$1" = "get-state" ]; then echo device; exit 0; fi\nexit 0\n' > "$ADB_1B"
  chmod +x "$ADB_1B"
  printf '#!/bin/sh\necho CALLED >> "%s.call2"\nexit 0\n' "$STUB2" > "$STUB2.call2.sh"; chmod +x "$STUB2.call2.sh"
  : > "$STUB2.call2"
  RI_PRODUCER='true' LOAD_SRC='echo "load averages: 2.00"' \
    SIM_LIST='echo "    fixture-target (12345678-1234-1234-1234-1234567890AB) (Booted)"' \
    IOS_DEVICE_NAME=fixture-target ADB="$ADB_1B" MAIN="$FM2" REINSTALL_CMD="$STUB2.call2.sh" \
    bash "$0" --confirm >/tmp/b-arm1b.out 2>&1
  RC1B=$?
  N1B=$(grep -c CALLED "$STUB2.call2" 2>/dev/null || true); N1B=${N1B:-0}
  ARM1B_BAD=0
  if [ "$N1B" = "1" ] && [ "$RC1B" = "0" ]; then
    echo "   ✅ 臂 1b（全绿⇒真执行）：桩命令被起 1 次、rc=0（窗口开着时它不会装死）"
  else
    echo "   ❌ 臂 1b（全绿⇒真执行）：桩被起 ${N1B} 次（要 1）、rc=${RC1B}（要 0）"
    tail -8 /tmp/b-arm1b.out | sed 's/^/      /'
    ARM1B_BAD=1
  fi
  rm -rf "$FM2"
  rm -f "$STUB2" "$STUB2.call2.sh" "$STUB2.call2" "$ADB_1B" /tmp/b-arm1b.out



  # 自测：只验"该拒的必须拒"这一条承重判据 —— 拿桩命令当 reinstall，看它有没有被真的起起来。
  echo ""
  echo "== selftest 臂 1：--confirm 在体检不成立时**必须不起** =="
  STUB=$(mktemp); printf '#!/bin/sh\necho CALLED >> "%s"\n' "$STUB.call" > "$STUB"; chmod +x "$STUB"
  : > "$STUB.call"
  REINSTALL_CMD="$STUB" bash "$0" --confirm >/tmp/b-selftest.out 2>&1
  RC=$?
  CALLED=$(wc -l < "$STUB.call" | tr -d ' ')
  rm -f "$STUB" "$STUB.call"
  ARM1_BAD=0
  if [ "$FAILS" = "0" ]; then
    echo "   ⚠️ 臂 1（该拒必须拒）：体检本来就全绿（rc=${RC}），这一臂测不出「该不该拒」—— 读数只在窗口关着时有效"
  elif [ "$CALLED" = "0" ]; then
    echo "   ✅ 臂 1（该拒必须拒）：体检有 $FAILS 项不成立 ⇒ rc=$RC 且桩命令一次都没被起"
  else
    echo "   ❌ 臂 1（该拒必须拒）：体检有 $FAILS 项不成立，桩命令却被起了 $CALLED 次 —— 拒启的判据没牙"
    ARM1_BAD=1
  fi
  # 🔴 汇总出口必须排在**四条臂都判完**之后。它原来写在臂 1 的判定**之前**，于是任何一条先红的臂
  #    都会把臂 1 自己的发现吞掉（rig 的 H 那一型实测：臂 1 本该报"红着也照样执行"，
  #    输出里却只有臂 2 的一行 —— 看的人会以为拒启判据仍然是好的）。
  if [ "$ARM2_BAD" != "0" ] || [ "$ARM3_BAD" != "0" ] || [ "$ARM1B_BAD" != "0" ] || [ "$ARM1_BAD" != "0" ]; then
    echo "结论：臂 2 有 $ARM2_BAD 条、臂 3 有 $ARM3_BAD 条、臂 1b 有 $ARM1B_BAD 条、臂 1 有 $ARM1_BAD 条不成立 —— 装置坏（exit 4），不是产品坏"
    exit 4
  fi
  echo "四臂逐条成立（臂 1 该拒必拒 / 臂 1b 全绿必起 / 臂 2 安卓两腿 / 臂 3 新鲜度四腿）"
  exit 0
fi

if [ "$FAILS" != "0" ]; then
  echo ""
  echo "结论：窗口**没开**（$FAILS 项前置不成立）。这是环境状态，不是产品失败（exit 3）。"
  printf '%s' "$NOTES"
  exit 3
fi

printf '%s' "$NOTES"
if [ "$CONFIRM" != 1 ]; then
  echo "== dry-run 结束（没动设备、没起 reinstall）。要执行加 --confirm =="
  exit 0
fi

echo "== --confirm：执行 =="
if [ -n "$REINSTALL_CMD" ]; then
  bash -c "$REINSTALL_CMD"; RC=$?
else
  IOS_DEVICE_NAME="$IOS" bash "$TARGET/scripts/reinstall-all.sh"; RC=$?
fi
echo "REINSTALL_RC=$RC"
exit "$RC"
