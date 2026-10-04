#!/bin/bash
# r14c-window-retry.sh 的 BOOT_AVD 那一手的四臂自测：拿桩闸门 + 桩 emulator 喂读数，
# 绝不动真设备（真 emulator 可执行文件根本不会被引用：EM_BIN 全部指向桩）。
set -u
MAIN="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
CARRIER="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-r14c"
cd "$MAIN" || exit 4
PASS=0; BAD=0
CALLED_BASE=0
say() { printf '%s\n' "$1"; }
chk() { # $1=臂名 $2=日志 $3=必须出现（且只 1 次）$4=必须不出现
  local h m
  h=$(grep -c -F -- "$3" "$2"); h=${h:-0}
  m=$(grep -c -F -- "$4" "$2"); m=${m:-0}
  if [ "$h" = "1" ] && [ "$m" = "0" ]; then
    say "  ✅ $1：正向命中 1 条，反向缺席"
    PASS=$((PASS+1))
  else
    say "  ❌ $1：正向 ${h} 条（要 1）／反向 ${m} 条（要 0）"
    BAD=$((BAD+1))
  fi
}
mkstub() { # $1=桩路径 $2=REDS 行的值（空串 = 打 `REDS=` 空值）其余 = 给人看的 ❌ 行
  local p="$1" reds="$2"; shift 2
  # 🔴 第一版把红行**直接写成可执行行**（`printf '❌ %s\n'`），于是桩自己不执行 echo，
  #    而是让 bash 报 `❌: command not found` —— 那行**同样含 ❌ 字符**，被本装置数成"一条红"，
  #    四条臂因此全红。臂红之后先读臂（本机今天第三次同族）。
  # 🔴 07:3x 起红集走 `REDS=` 这一条**机器通道**（原来看守数 ❌ 的行数，而一条 dev 旗标
  #    可以对应两条 ❌：粗筛 + reinstall）。桩必须照新版闸门的样子打，否则臂测的是旧形状。
  { echo '#!/bin/bash'
    for line in "$@"; do printf 'echo %s\n' "$(printf '%s' "❌ $line" | sed 's/.*/"&"/')"; done
    printf 'echo "REDS=%s"\n' "$reds"
    echo 'exit 3'; } > "$p"; chmod +x "$p"; }
arm() { # $1=桩闸门 $2=BOOT_AVD $3=日志 $4=额外 env 赋值
  local g="$1" avd="$2" lg="$3" ex="$4"
  # 🔴 SELF_GUARD=0 是必需的，不是偷懒：07:07 现量，真看守挂着时这些臂**全部 exit 6 且一个
  #    日志文件都不会建**（互斥守卫在写日志之前就退了），于是七条读数全红，
  #    看起来像"启动逻辑坏了"。互斥那一手有它自己的腿（heal-fire 那套 + 台账里的 rc=6 现量），
  #    不在这里重复测；这里测的只有 maybe_boot_avd。
  # 🔴 CO_PATTERN 同理要**中和**（12:5x 现量补的，同一族的第二枚守卫）：链里还有一道
  #    "别的重验证看守活着就让它"的读现场守卫，而这一把臂的 GATE 与 BOOT_AVD **都是桩**、
  #    adb 也是注进去的（下面两型桩），根本不起真设备 ⇒ 守卫要挡的"真动设备"在这里不存在。
  #    不中和的后果就是 12:5x 那次：H 的看守活着 ⇒ 八条臂全"坏读数"，rc=4 报成装置坏，
  #    而真相是"让路"。守卫自己的牙在它自己那儿（`r14c-window-retry.sh` 起手那次
  #    `positive_ok/BROKEN` 正向对照 + window-retry-arms 的臂），不在这把臂上重复。
  #    ⚠️ 前提是"这两枚都是桩"：以后谁把某条臂换成真 BOOT_AVD，这一行必须一并撤掉。
  env CARRIER="$CARRIER" BUDGET=0 INTERVAL=1 SELF_GUARD=0 CO_PATTERN=zz-none-bootarm-Q LOG="$lg" GATE="$g" BOOT_AVD="$avd" BOOT_WAIT=5 \
    ${ex:+$ex} bash research/tools/r14c-window-retry.sh >/dev/null 2>&1
}
# 桩 adb 两型：off（一台都不在线）/ on（emulator-5554 在线）。
# 🔴 必须注桩：07:0x 现场有人真把模拟器起起来了，用真 adb 的臂读的是活机器而不是夹具，
#    于是"守卫做对了"被报成"臂红"（夹具读活机器 = 下一次还会翻的臂）。
ADB_OFF=$(mktemp); ADB_ON=$(mktemp)
cat > "$ADB_OFF" <<'STUB'
#!/bin/bash
if [ "$1" = "-s" ]; then exit 1; fi
if [ "$1" = "devices" ]; then echo "List of devices attached"; exit 0; fi
exit 1
STUB
cat > "$ADB_ON" <<'STUB'
#!/bin/bash
if [ "$1" = "-s" ]; then shift 2; fi
if [ "$1" = "get-state" ]; then echo device; exit 0; fi
if [ "$1" = "devices" ]; then echo "List of devices attached"; printf 'emulator-5554\tdevice\n'; exit 0; fi
if [ "$1" = "shell" ]; then echo 1; exit 0; fi
exit 0
STUB
chmod +x "$ADB_OFF" "$ADB_ON"

STUBLOG=/tmp/arm-boot-avd.stub.log
S1=$(mktemp); S2=$(mktemp); S3=$(mktemp); S4=$(mktemp); S5=$(mktemp); SP=$(mktemp)
mkstub "$S1" 'load,dev' "负载 15 > 12 —— 等落回阈值内再开跑" "有另一趟 reinstall-all 在跑（pid：99999）" "emulator-5554 不在线（设备离线）"
mkstub "$S2" 'dev' "emulator-5554 不在线（设备离线）"
mkstub "$S3" 'dev' "emulator-5554 不在线（设备离线）"
mkstub "$S5" 'dev,apk' "emulator-5554 不在线（设备离线）" "APK 比源码旧 —— 跑它验的是旧 bundle"
mkstub "$S4" ''
cat > "$SP" <<STUB
#!/bin/bash
if [ "\${1:-}" = "-list-avds" ]; then echo "heyta-w3-yearly"; echo "SSOS-Parity-A36"; exit 0; fi
echo CALLED >> $STUBLOG
sleep 30
STUB
chmod +x "$SP"
: > "$STUBLOG"
L1=/tmp/arm1.log; L2=/tmp/arm2.log; L3=/tmp/arm3.log; L4=/tmp/arm4.log
rm -f "$L1" "$L2" "$L3" "$L4"

arm "$S1" 'heyta-w3-yearly' "$L1" "EM_BIN=$SP ADB=$ADB_OFF"
chk "臂 1（还在门外 ⇒ 不许动设备）" "$L1" "BOOT=wait（除 dev/apk 之外还红：load" "BOOT=refused"
if grep -qE 'BOOT=(start|skipped)' "$L1"; then say "  ❌ 臂 1 进了启动分支"; BAD=$((BAD+1));
else say "  ✅ 臂 1 没进启动分支，桩调用次数=$(grep -c CALLED "$STUBLOG")"; fi

arm "$S2" 'heyta-w3-yea' "$L2" "EM_BIN=$SP ADB=$ADB_OFF"
chk "臂 2（AVD 名差一个字符 ⇒ refused）" "$L2" "不在 -list-avds 的逐字列表里" "BOOT=start"

arm "$S3" 'heyta-w3-yearly' "$L3" "EM_BIN=$SP ADB=$ADB_OFF"
chk "臂 3（正向腿 ⇒ 真的调用 emulator）" "$L3" "BOOT=start avd=heyta-w3-yearly" "BOOT=refused"
CALLED=$(grep -c CALLED "$STUBLOG"); CALLED=${CALLED:-0}
if [ "$CALLED" = "1" ]; then say "  ✅ 臂 3：桩 emulator 被真调用 1 次（不是只打了行）"; PASS=$((PASS+1));
else say "  ❌ 臂 3：桩调用次数=${CALLED}（要 1）⇒ 启动没真发生，臂 3 的绿是假的"; BAD=$((BAD+1)); fi
APID=$(grep -o 'BOOT pid=[0-9]*' "$L3" | head -1 | cut -d= -f2)
if [ -n "$APID" ]; then kill "$APID" 2>/dev/null; sleep 0.5
  if ps -p "$APID" >/dev/null 2>&1; then say "  ❌ 臂 3 的桩没被收掉（pid $APID 还活着）"; BAD=$((BAD+1));
  else say "  ✅ 臂 3 收尾：桩进程（pid=${APID}）已收"; PASS=$((PASS+1)); fi
else say "  ❌ 臂 3 没记下 pid ⇒ 无法收尾（这本身是缺陷）"; BAD=$((BAD+1)); fi

arm "$S4" 'heyta-w3-yearly' "$L4" "EM_BIN=$SP ADB=$ADB_OFF"

echo "== 臂 3b：闸门只缺设备、而 adb 报**已有一台在线** ⇒ 必须 skipped（不起第二台）=="
L3b=$(mktemp)
BEFORE3B=$(grep -c CALLED "$STUBLOG" || true); BEFORE3B=${BEFORE3B:-0}
arm "$S3" 'heyta-w3-yearly' "$L3b" "EM_BIN=$SP ADB=$ADB_ON"
AFTER3B=$(grep -c CALLED "$STUBLOG" || true); AFTER3B=${AFTER3B:-0}
CALLED3B=$((AFTER3B - BEFORE3B))   # 🔴 取**增量**，不是累计（累计里已经含臂 3 那一次）
if grep -q 'BOOT=skipped（已在线 emulator-5554' "$L3b" && [ "$CALLED3B" = 0 ]; then
  echo "  ✅ 臂 3b：报 skipped 且桩 emulator 调用次数=0（06:51 那一趟真踩到的一形，现在可复现）"; PASS=$((PASS+1))
else
  echo "  ❌ 臂 3b：skipped 行没出现或桩被起了（本臂增量调用=${CALLED3B}）"; sed 's/^/      /' "$L3b" | tail -4; BAD=$((BAD+1))
fi
rm -f "$L3b"

echo "== 臂 3c：红集是 dev,apk（载体刚同步过的常态）⇒ **仍然要**进启动分支 =="
# 这一臂挡的是 07:3x 查出的第二处自锁：开窗要设备在线、设备在线要起模拟器、
# 而起模拟器原来要求"只红设备"—— 可 apk 那一红只有开窗后链自己打产物才能消 ⇒ 环闭上，永远出不去。
L3c=$(mktemp)
BEFORE3C=$(grep -c CALLED "$STUBLOG" || true); BEFORE3C=${BEFORE3C:-0}
arm "$S5" 'heyta-w3-yearly' "$L3c" "EM_BIN=$SP ADB=$ADB_OFF"
AFTER3C=$(grep -c CALLED "$STUBLOG" || true); AFTER3C=${AFTER3C:-0}
CALLED3C=$((AFTER3C - BEFORE3C))
APID3C=$(grep -o 'BOOT pid=[0-9]*' "$L3c" | head -1 | cut -d= -f2)
[ -n "$APID3C" ] && kill "$APID3C" 2>/dev/null
if grep -q 'BOOT=start avd=heyta-w3-yearly' "$L3c" && [ "$CALLED3C" = 1 ] && [ -n "$APID3C" ]; then
  echo "  ✅ 臂 3c：dev,apk 并存时照样走到启动分支（桩调用增量=1，pid=${APID3C} 已收）"; PASS=$((PASS+1))
else
  echo "  ❌ 臂 3c：没进启动分支（增量调用=${CALLED3C}，pid=${APID3C:-无}）"; sed 's/^/      /' "$L3c" | tail -4; BAD=$((BAD+1))
fi
rm -f "$L3c"

chk "臂 4（一条红都没有却 rc=3 ⇒ 不瞎猜）" "$L4" "BOOT=not-needed" "BOOT=start"

rm -f "$S1" "$S2" "$S3" "$S4" "$SP" "$ADB_OFF" "$ADB_ON" "$STUBLOG"
say "汇总：好读数 ${PASS} 条，坏读数 ${BAD} 条"
[ "$BAD" = "0" ] || exit 4
exit 0
