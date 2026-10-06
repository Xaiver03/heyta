#!/usr/bin/env bash
# #76 —— iOS 判据 B「一次 401 不许清掉本机明文库」**自己能不能红**。
#
# 为什么要这一臂：Android 侧那条存活变异教的是"只量文件在不在的 B 没有牙"（计划 §10.131/§10.132）。
# iOS 这边 A–E 基线绿 **不构成**这一臂有牙 —— 没装过变异产物，就没人知道 B 会不会红。
#
# 变异形状：`packages/sync-client/src/client.ts` 的 `isAccountClosedFailure()`
#   放宽成"任何 SyncHttpError 都算账号已注销" ⇒ 步骤 5 那发 401 TOKEN_INVALID 会走销毁器
#   ⇒ **判据 B 的两腿（文件在 + ops 行数与 A 逐字相同）必须转红**，而 C/D/E 的形状不许变。
#
# 反自己的作弊五条（都打印量，不打印布尔）：
#   ① 变异前后 client.ts 的 md5 必须不同；② 重打出来的 main.jsbundle 必须与设备上那份不同
#   （否则 rig 量的是未变异的字节）；③ **装进设备后**设备上那份的 md5 必须等于刚打的那枚
#   （12:06 那趟缺的就是这一条：产物只打在磁盘上，rig 的门 B 看见设备上还是旧的 ⇒ rc=3）；
#   ④ 复原后与 cp 下来的原件 `cmp -s` 必须逐字节相同，且**产物也要装回变异前那一枚**；
#   ⑤ 读数只认 rig 自己打印的那几行（`grep -oE` 计数），不认我推断的"应该红了"。
#
# 当前位置：`research/tools/mutation-rigs/ios-erase-arm-b76.sh`（原先躺在 gitignored 的 `tmp/`，
# 13:0x 随 §10.155 转正；判据驱动 `tmp/e2-ios-erasure.sh` **没有**转正，缺了这枚臂会 exit 3 而不是假绿）。
#
# 退出码三档，**「没跑」必须排在「没牙」前面判**（12:06 那趟把 rc=3 折进了 DEAD，
# 于是把一次环境拒绝写成了一句关于产品的结论）：
#   0 = 判据有牙（B 两腿转红、C 仍绿）
#   1 = 臂活着、判据确实执行过（腿读数 > 0）、而 B 没红 ⇒ B 这一腿没牙，本臂的产出
#   3 = 环境无效（负载/端口/设备归属/构建/安装/rc=3）⇒ 不读成任何产品结论，看守继续等
set -uo pipefail

# 根目录跟着**这个文件自己的位置**往上找到 `.git`：硬编码那台机器的绝对路径只在原地成立，
# 而 `git rev-parse --show-toplevel` 从仓库外面调起时会炸（两种错法都不响亮，取前者）。
if [ -n "${MAIN:-}" ]; then :
else
  _d=$(cd "$(dirname "$0")" && pwd)
  while [ "$_d" != "/" ] && [ ! -d "$_d/.git" ]; do _d=$(dirname "$_d"); done
  [ -d "$_d/.git" ] || { echo "   ARM=ENV root-anchor（从 $0 往上没找到 .git ⇒ 这枚臂不在仓库里，读数不作数）"; exit 3; }
  MAIN="$_d"
fi
WT="${W6C_WT:-$MAIN/../heyta-wt-trash-e2e}"
WT=$(cd "$WT" 2>/dev/null && pwd -P) || { echo "❌ 载体不存在：$WT" >&2; exit 3; }
UDID="${IOS_UDID:-$(cat "$MAIN/tmp/ios-erasure-udid.txt" 2>/dev/null)}"
BID="${IOS_BID:-com.heyta}"
PORT="${PORT:-3110}"
SRC_REL="packages/sync-client/src/client.ts"
KEEP=/tmp/heyta-b76-client.ts.orig
ARMLOG=/tmp/heyta-b76-arm.log

say() { printf '\n════ %s ════\n' "$1"; }
# 环境无效一律 3：它的含义是"这趟不成立"，不是"产品失败"。
envfail() { echo "   ❌ $1"; echo "   ARM=ENV $2"; exit 3; }

[ -n "$UDID" ] || envfail "没有 UDID" "udid-missing"

count_and_verdict() {
  # ── 第 6 段：读数 ────────────────────────────────────────────────
  # 🔴 红行的字面形状是从判据脚本 bad() 的**原文**逐字抄的，不是我推的：
  #     文件腿红 = 「判据 B 红：一次 401 就把本机库删了…」  ← **不带**「（文件腿）」
  #     数据腿红 = 「判据 B 红（数据腿）：401 把 ops 从 …」
  #     绿行才是 「判据 B（文件腿）成立」/「判据 B（数据腿）成立」
  #   12:51 那趟把 `ARM=DEAD` 当成产品结论报出来，就是因为拿**绿行的形状**去数红行
  #   ⇒ 五条腿计数全 0 ⇒ "一条都没红"。真相在日志第 99 行：数据腿红了。
  BLOCK=$(awk '/════ 5\./,/════ 6\./' "$RUNLOG")
  FILE_RED=$(printf '%s\n' "$BLOCK" | grep -c '判据 B 红：')
  DATA_RED=$(printf '%s\n' "$BLOCK" | grep -c '判据 B 红（数据腿）')
  FILE_OK=$(printf '%s\n' "$BLOCK" | grep -c '✅ 判据 B（文件腿）成立')
  DATA_OK=$(printf '%s\n' "$BLOCK" | grep -c '✅ 判据 B（数据腿）成立')
  PREM_OK=$(printf '%s\n' "$BLOCK" | grep -c '判据 B 的\*\*前提\*\*成立')
  C_OK=$(grep -c '✅ 判据 C 成立' "$RUNLOG")
  TALLY=$(grep -oE '通过 [0-9]+ 项，失败 [0-9]+ 项' "$RUNLOG" | tail -1)
  FAILED=$(printf '%s' "$TALLY" | sed -E 's/.* 失败 ([0-9]+) 项/\1/')
  case "$FAILED" in ''|*[!0-9]*) FAILED=NA ;; esac
  printf '   B 前提 ✅=%d   文件腿 ❌=%d ✅=%d   数据腿 ❌=%d ✅=%d   C ✅=%d   %s\n' \
    "$PREM_OK" "$FILE_RED" "$FILE_OK" "$DATA_RED" "$DATA_OK" "$C_OK" "${TALLY:-（没抓到 summary）}"

  # ── 第 7 段：结论 ────────────────────────────────────────────────
  say "7. 结论（四档：有牙 / 没牙 / 没跑 / 针没对准）"
  LEG_TOTAL=$(( FILE_RED + DATA_RED + FILE_OK + DATA_OK + PREM_OK + C_OK ))
  if [ "$RIG_RC" = "3" ] || [ "$LEG_TOTAL" = "0" ]; then
    echo "   ARM=NO-RUN —— 驱动 rc=${RIG_RC}、B/C 六条腿的读数合计 $LEG_TOTAL 行 ⇒ 这趟没有任何判据执行过，"
    echo "            不许判 B 有没有牙。载体已复原。"
    grep -E '环境无效|❌' "$RUNLOG" | head -6 | sed 's/^/            rig 自己说的：/'
    exit 3
  fi
  # 🔴 计数与 summary 对不上 = **探针坏**，不是"没牙"（#288/#291 同一族）。
  if [ "$FAILED" != "NA" ] && [ "$FAILED" -gt 0 ] && [ $(( FILE_RED + DATA_RED )) = "0" ] \
     && [ "$FILE_OK" = "0" ] && [ "$DATA_OK" = "0" ]; then
    echo "   ARM=NEEDLE-MISMATCH —— summary 报失败 $FAILED 项，而 B 两腿四条计数全是 0"
    echo "            ⇒ 我的 needle 读不到判据打印的形状（**探针坏**），据此判「没牙」就是假结论。"
    grep -E '❌' "$RUNLOG" | head -6 | sed 's/^/            rig 自己说的：/'
    exit 3
  fi
  if [ "$DATA_RED" -ge 1 ] || [ "$FILE_RED" -ge 1 ]; then
    [ "$DATA_RED" -ge 1 ] && echo "   牙齿在**数据腿**：401 被当成注销信号之后，ops 从基线行数变了 ⇒ B 抓到了「删库→重开空库」。"
    [ "$FILE_RED" -ge 1 ] && echo "   牙齿在**文件腿**：那次 401 真的把库文件删掉了 ⇒ B 也抓到了更粗的那种故障。"
    if [ "$DATA_RED" -ge 1 ] && [ "$FILE_RED" = "0" ]; then
      echo "   ⚠️ 文件腿这一枚**问不到**（不是「它没牙」）：变异造成的是「删完又被重开成空壳」，"
      echo "      文件确实在盘上 ⇒ 文件腿报绿是**正确行为**。要问文件腿有没有牙，得另做一枚"
      echo "      「只删不重开」的变异（登记成独立工单，不许把这一枚的读数当成对它结的案）。"
    fi
    echo "   C ✅=$C_OK ⇒ 红的正是 B 该管的那件事，没连带伤到 C。判据退出码 ${RIG_RC}（臂趟里应当非 0）。"
    echo "   ARM=OK —— 判据 B 在 iOS 上**有牙**（首次实测）。"
    exit 0
  fi
  echo "   ARM=DEAD ——【${MODE_TAG}】判据确实执行过（腿读数 ${LEG_TOTAL} 行、rc=${RIG_RC}、"
  echo "            summary「${TALLY:-读不到}」），而 B 两腿一条都没红。"
  case "$MODE_TAG" in
    完整臂趟*) echo "            ⇒ 这一趟源与产物两侧都有 md5 对照，所以这句是**关于产品的结论**：判据 B 在 iOS 上没有牙。" ;;
    *) echo "            ⚠️ RECOUNT 趟**不**携带装载证据 ⇒ 这句只是「这份日志里 B 没红」。
" ;;
  esac
  exit 1
}

if [ -n "${RECOUNT:-}" ]; then
  # 只重算读数：拿**已经落盘的判据日志**当输入，一个字节都不改、一台设备都不碰。
  # 存在的理由：读数与结论这把尺改过之后，旧趟的产物要能用新尺重读，
  # 否则"修好了计数逻辑"就只能靠再烧一趟设备来兑现。
  [ -f "$RECOUNT" ] || { echo "RECOUNT=LOG-MISSING $RECOUNT"; exit 3; }
  RUNLOG="$RECOUNT"
  # 🔴 rc **不许多手填**。`RECOUNT_RC` 保留给"我知道真实 rc"的场合，默认从日志自己的收尾句推：
  #    那三句分别是 summary 的三个分支打出来的（FAIL≠0 ⇒「❌ 有失败项」随后 exit 1；
  #    环境无效 ⇒ exit 3；全绿 ⇒「真机全链路通过」exit 0）。推不出来就**拒绝**，不替那趟编一个码。
  if [ -n "${RECOUNT_RC:-}" ]; then
    RIG_RC="$RECOUNT_RC"; RC_WHY="显式传入 RECOUNT_RC"
  elif grep -q '❌ 有失败项' "$RECOUNT"; then
    RIG_RC=1; RC_WHY="日志里的「❌ 有失败项」= summary 的 FAIL≠0 分支，它随后 exit 1"
  elif grep -q '环境无效' "$RECOUNT"; then
    RIG_RC=3; RC_WHY="日志里的「环境无效」= 装置侧中止，exit 3"
  elif grep -q '真机全链路通过' "$RECOUNT"; then
    RIG_RC=0; RC_WHY="日志里的「真机全链路通过」= FAIL 为 0，exit 0"
  else
    echo "   RECOUNT=RC-UNKNOWN —— 三条收尾句一条都不在这份日志里 ⇒ 这趟没跑到 summary，rc 读不出（不编）"
    exit 3
  fi
  INSTALLED_JS_MD5="（RECOUNT 趟，不重新装包）"
  MODE_TAG="RECOUNT（只重读一份旧日志，不携带装载证据）"
  say "0. RECOUNT 模式"
  echo "   判据日志=$RUNLOG"
  printf '   驱动 rc=%s（来历：%s）  这一趟不碰设备、不改源码\n' "$RIG_RC" "$RC_WHY"
  count_and_verdict
fi

say "0. 负载门（一次性读数；超了不硬跑）"
NCPU=$(sysctl -n hw.ncpu); LOAD_MAX=${LOAD_MAX:-$(( NCPU * 3 / 4 ))}
LOAD=$(sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1}')
echo "   现量 loadavg(1m)=$LOAD 阈值=$LOAD_MAX ncpu=$NCPU"
awk -v l="$LOAD" -v m="$LOAD_MAX" 'BEGIN{exit !(l>m)}' && envfail "负载超阈值，这一趟不起跑" "load=$LOAD"

say "1. 设备与端口归属（现量，不假设）"
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && envfail ":$PORT 已被别人监听" "port=$PORT"
# 别的移动验收在跑 ⇒ 让窗口（自己这一条排除在外）
BUSY=$(pgrep -f 'verify-mobile-[a-z-]*\.sh' | grep -v "^$PPID\$" || true)
if [ -n "$BUSY" ]; then
  echo "   现役移动验收进程：$(echo "$BUSY" | tr '\n' ' ')"
  pgrep -fl 'verify-mobile-[a-z-]*\.sh' | head -4
  envfail "有别的移动验收在跑" "busy=verify-mobile"
fi
# 只清**自己这台设备**的 companion（别人的 UDID 不动）
pkill -f "idb_companion --udid $UDID" 2>/dev/null && echo "   清掉自己这台设备的 idb_companion 残留"
xcrun simctl list devices booted 2>/dev/null | grep -q "$UDID" || envfail "模拟器 $UDID 不在 booted 清单里" "udid-not-booted"

say "2. 变异前快照（源 + 设备上那份产物的 bundle）"
cp -p "$WT/$SRC_REL" "$KEEP" || envfail "读不到 $SRC_REL" "src-missing"
PRE_MD5=$(md5 -q "$KEEP"); echo "   PRE_SRC_MD5=$PRE_MD5"
APP_ON_DEVICE=$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null)
PRE_JS_MD5=$(md5 -q "$APP_ON_DEVICE/main.jsbundle" 2>/dev/null)
echo "   PRE_JS_MD5=${PRE_JS_MD5:-（设备上读不到 main.jsbundle）}"
# 🔴 把设备上那一枚**存一份**，收尾装回去。臂会把变异产物装上设备，
#    只复原源码不等于复原产物 —— 下一趟基线会在"源码干净、设备里是变异字节"的世界里跑，
#    那是一条关于产品的假结论（同一族的教训见 traps #286：装置不许许下它没有的能力）。
PRE_APP_DIR=/tmp/heyta-b76-app-pre
rm -rf "$PRE_APP_DIR"; mkdir -p "$PRE_APP_DIR"
if [ -n "$APP_ON_DEVICE" ] && cp -a "$APP_ON_DEVICE" "$PRE_APP_DIR/Heyta.app" 2>/dev/null; then
  echo "   SAVED_PRE_APP=OK（$PRE_APP_DIR/Heyta.app，md5=$(md5 -q "$PRE_APP_DIR/Heyta.app/main.jsbundle" 2>/dev/null)）"
else
  echo "   SAVED_PRE_APP=FAIL ⇒ 收尾**装不回**变异前的产物，这一趟结束后设备上仍是变异字节"
fi

say "3. 落变异（锚点命中数必须 =1）"
if [ "${PREFLIGHT:-0}" = "1" ]; then
  # 预检模式：只验"闸门有没有牙 + 归属能不能读到 + 变异锚点在不在"，一个字节都不改。
  ANCHOR=$(grep -c '^  return error instanceof SyncHttpError && error.code === ACCOUNT_CLOSED_CODE;$' "$WT/$SRC_REL")
  echo "   PREFLIGHT：变异锚点命中=${ANCHOR}（要 1）"
  [ "$ANCHOR" = "1" ] || { echo "   ARM=ANCHOR"; exit 1; }
  echo "   ARM=PREFLIGHT-OK（负载门、端口/设备归属、源与 bundle 快照、锚点都读到了；未落变异）"
  exit 0
fi
python3 - "$WT/$SRC_REL" <<'PY' || { echo "   ARM=MUT-SHAPE-MISS"; exit 1; }
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
OLD = "  return error instanceof SyncHttpError && error.code === ACCOUNT_CLOSED_CODE;"
NEW = "  return error instanceof SyncHttpError; // MUTATED-B76"
n = s.count(OLD)
assert n == 1, f"锚点命中 {n} 次（要 1）⇒ 变异形状对不上，不动文件"
io.open(p, "w", encoding="utf-8").write(s.replace(OLD, NEW))
print(f"   MUT hit={n} ⇒ 已落变异")
PY
ARM_MD5=$(md5 -q "$WT/$SRC_REL")
[ "$ARM_MD5" != "$PRE_MD5" ] || { echo "   ARM=NO-OP MD5=$ARM_MD5"; exit 1; }
echo "   ARM_SRC_MD5=$ARM_MD5  （与 PRE 不同 ⇒ 源真的换了）"

# 复原挂在 EXIT 上：构建失败/被判据打断都不许把变异留在载体里。
restore() {
  cp -p "$KEEP" "$WT/$SRC_REL"
  if cmp -s "$KEEP" "$WT/$SRC_REL"; then echo "   RESTORE_SRC=OK（与原件逐字节相同）"; else echo "   RESTORE_SRC=FAIL（复原后与原件不同！）"; fi
  local NOW=$(md5 -q "$WT/$SRC_REL")
  echo "   RESTORE_MD5=$NOW 期望=$PRE_MD5"
  # 产物也要装回去：只复原源码 = 设备上仍是变异字节。
  if [ -d "$PRE_APP_DIR/Heyta.app" ]; then
    xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1
    if xcrun simctl install "$UDID" "$PRE_APP_DIR/Heyta.app" >/tmp/heyta-b76-restore-install.log 2>&1; then
      local BACK=$(md5 -q "$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null)/main.jsbundle" 2>/dev/null)
      if [ -n "$PRE_JS_MD5" ] && [ "$BACK" = "$PRE_JS_MD5" ]; then
        echo "   RESTORE_APP=OK（设备上那份 = 变异前那份 md5=${BACK}）"
      else
        echo "   RESTORE_APP=PARTIAL（装回去了但 md5=$BACK ≠ 变异前 ${PRE_JS_MD5:-读不到}）"
      fi
    else
      echo "   RESTORE_APP=FAIL ⇒ 设备上可能仍留着变异产物，见 /tmp/heyta-b76-restore-install.log"
    fi
  else
    echo "   RESTORE_APP=SKIPPED（变异前没存下产物 ⇒ 设备状态没还回去，下一趟必须先重装当前产物）"
  fi
}
trap restore EXIT

say "4. 重打产物（sync-client dist → iOS Release .app）"
(cd "$WT" && pnpm --filter @heyta/sync-client build >/tmp/heyta-b76-build.log 2>&1) \
  || { tail -15 /tmp/heyta-b76-build.log; envfail "sync-client 构建失败" "build=client"; }
(cd "$WT" && pnpm --filter @heyta/mobile run build:ios >>/tmp/heyta-b76-build.log 2>&1) \
  || { tail -20 /tmp/heyta-b76-build.log; envfail "iOS Release 构建失败" "build=ios"; }
APP="$WT/apps/mobile/ios/build/Build/Products/Release-iphonesimulator/Heyta.app"
[ -d "$APP" ] || envfail "打不出 $APP" "app-missing"
ARM_JS_MD5=$(md5 -q "$APP/main.jsbundle" 2>/dev/null)
echo "   ARM_JS_MD5=${ARM_JS_MD5:-读不到}  PRE_JS_MD5=${PRE_JS_MD5:-（无）}"
if [ -n "$PRE_JS_MD5" ] && [ "$ARM_JS_MD5" = "$PRE_JS_MD5" ]; then
  echo "   ARM=STALE-BUNDLE（产物字节没变 ⇒ rig 量的还是旧代码，这一趟不作数）"; exit 3
fi

say "4b. 把变异产物**装进设备**（12:06 那趟的教训：只打不装，rig 的门 B 必拦）"
# 为什么必须由臂来装：门 B 比的是「设备上那份 bundle 的 mtime」与「载体源码最新 mtime」。
# 变异这一步恰好把源码推到"刚刚"，所以**不落变异则已、一落必撞门 B** ——
# 除非设备上那份就是刚打的变异产物。rig 内部的 uninstall+IOS_APP_SRC 装得更晚，
# 拦在起栈之前的那道门看不见它。装完还要有一条"装进去的字节 == 打出来的字节"的身份腿，
# 否则 mtime 新不等于内容新（同 §7 #72 那一族）。
xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 && echo "   先 terminate 自家 app 残留"
# 🔴 装之前再看一眼归属：`install` 是会覆盖设备上那份产物的动作，而 rig 自己的占用者门
#    跑在**起栈之后**，够不着这一步。这条腿不代替那道门，只挡"我这一步动手的这一刻有人在这台上"。
COMPANION_NOW=$(pgrep -f "idb_companion --udid $UDID" || true)
[ -z "$COMPANION_NOW" ] || envfail "有人正用 idb 通道驱动这台设备（pid=${COMPANION_NOW//$'\n'/,}），不装" "busy=companion-preinstall"
BUSY_NOW=$(pgrep -f 'verify-mobile-[a-z-]*\.sh' || true)
[ -z "$BUSY_NOW" ] || envfail "有别的移动端验收在跑（pid=${BUSY_NOW//$'\n'/,}），不装" "busy=rig-preinstall"
echo "   装前归属现量：idb 通道 0 枚、verify-mobile rig 0 枚 ✅"
xcrun simctl install "$UDID" "$APP" >/tmp/heyta-b76-install.log 2>&1 \
  || { tail -8 /tmp/heyta-b76-install.log; envfail "变异产物装不进设备" "install-fail"; }
APP_ON_DEVICE=$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null)
[ -n "$APP_ON_DEVICE" ] || envfail "装完读不到设备上的 app 容器" "container-missing"
INSTALLED_JS_MD5=$(md5 -q "$APP_ON_DEVICE/main.jsbundle" 2>/dev/null)
INSTALLED_MTIME=$(stat -f %m "$APP_ON_DEVICE/main.jsbundle" 2>/dev/null || echo 0)
SRC_NEWEST_NOW=$(find "$WT/packages" -name '*.ts' -not -path '*/node_modules/*' -newer "$APP_ON_DEVICE/main.jsbundle" 2>/dev/null | head -1)
printf '   INSTALLED_JS_MD5=%s  ARM_JS_MD5=%s\n' "${INSTALLED_JS_MD5:-读不到}" "${ARM_JS_MD5:-读不到}"
[ -n "$INSTALLED_JS_MD5" ] && [ "$INSTALLED_JS_MD5" = "$ARM_JS_MD5" ] \
  || envfail "设备上那份与刚打的那份字节不同 ⇒ 装的不是变异产物" "install-identity"
echo "   设备 bundle mtime=$(date -r "$INSTALLED_MTIME" '+%m-%d %H:%M:%S')  比它更新的源码=${SRC_NEWEST_NOW:-无} ⇒ 门 B 应当放行"

MODE_TAG="完整臂趟（源与设备产物的 md5 都在上面打印过）"
say "5. 跑判据本体（B 必须转红）"
# 🔴 12:41 那趟的形状：臂自己装的包把 rig 的**门 A**触发了（"bundle 是 1s 前装的 ⇒ 别人在用这台"）。
#    那道门有自己的逃生口，但它是**按 UDID 绑名字**的（`e2-ios-erasure.sh:60-70` 用 python 只取
#    `udid == IOS_UDID` 那一行的 name），所以"我这台的"这个说法不会替别人的台子开绿灯。
#    这里不直接甩 `IOS_SELF_DEVICE=1`，而是**先现量这台的名字**：落在本线命名空间 `heyta-e2-` 里才转
#    那个旗；不是本线的台子 ⇒ 不转，让门 A 照旧把它拒掉（修装置不等于放宽门）。
# ⚠️ UDID 走 **argv**，不走 `IOS_UDID=… xcrun … | python3` 那种前缀赋值：前者只给管道里第一条命令，
#    python3 读不到 ⇒ 名字读成空 ⇒ 这腿会**恒判"不是自家台子"**（rig 里同样写法能成，是因为它那个变量
#    是 `IOS_UDID=… bash 脚本` 传进来的，在脚本里天然带着 export）。
TARGET_NAME=$(xcrun simctl list devices booted -j 2>/dev/null | python3 -c '
import json, sys
want = sys.argv[1]
for devs in json.load(sys.stdin)["devices"].values():
    for x in devs:
        if x["udid"] == want:
            print(x["name"]); sys.exit(0)
' "$UDID" 2>/dev/null)
SELF_FLAG=0
case "$TARGET_NAME" in
  heyta-e2-*) SELF_FLAG=1; echo "   目标这台的名字=${TARGET_NAME}（在本线命名空间 heyta-e2- 里）⇒ 转 IOS_SELF_DEVICE=1" ;;
  *) echo "   目标这台的名字=${TARGET_NAME:-读不到}（不是 heyta-e2- 开头）⇒ 不转 IOS_SELF_DEVICE，门 A 应当把它拒掉" ;;
esac
RIG="$MAIN/tmp/e2-ios-erasure.sh"
# 🔴 这枚驱动躺在 **gitignored 的 `tmp/`**（计划 §10.153 ③）⇒ 换一台干净检出上它不存在。
#    缺它不是产品结论也不是"臂没牙"，是环境无效：响亮 exit 3，不许走到下面的读数段。
[ -f "$RIG" ] || envfail "判据驱动不在：${RIG}（它在 gitignored 的 tmp/ 里，干净检出上没有这一枚）" "rig-driver-missing"
IOS_SELF_DEVICE="$SELF_FLAG" IOS_APP_SRC="$APP" PORT="$PORT" IOS_UDID="$UDID" bash "$RIG" >"$ARMLOG" 2>&1
RIG_RC=$?
RUNLOG=$(ls -t /tmp/e2-ios-erasure-*.log 2>/dev/null | head -1)
echo "   驱动 rc=$RIG_RC   判据日志=${RUNLOG:-读不到}"
[ -n "$RUNLOG" ] || { tail -25 "$ARMLOG"; envfail "找不到 rig 的判据日志" "log-missing"; }


say "6. 读数（只认 rig 打印的行，逐条带命中数）"
count_and_verdict
