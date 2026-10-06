#!/bin/bash
# R14c 安装守卫的三臂有牙先验 —— 零设备、零窗口。
#
# 为什么存在：`scripts/verify-mobile-due-time.sh` 第 1 步原来把 `$ADB install … | tail -1 | sed …` 的退出码
# 丢给了 sed（§7 #45），装失败什么都不会说，然后拿设备上残留的旧包跑完整轮判据。现在那一段换成了
# "退出码单独取 + 必须出现 Success"两条守卫。守卫写下来不等于有牙，所以这里用桩 adb 喂三种真实结果量一遍。
#
# 退出码：0 = 三臂读数都符合预期（守卫有牙）；1 = 有一臂不符合 ⇒ 守卫坏了或形状漂了；
#         4 = 前提不成立（抽不到那段、桩没建起来）—— 那是装置坏，不是判据坏。
# 用法：bash research/tools/r14c-install-guard-arms.sh
#
# 🔴 **本装置自己的牙（2026-10-04 02:0x 现量）**：搭一棵只含两个文件的迷你树
# （`mkdir -p X/scripts X/research/tools`，把本文件与 `$SRC` 各 `cp` 一份进去），在**副本**上动刀，真实树全程不碰：
#   M1 删掉 `if ! printf … grep -q "Success"; then … fi` 整块 ⇒ 本装置 rc=**1**，且**只有 quiet 臂**报"该红没红（rc=0）"；
#   M2 删掉 `if [ "$INSTALL_RC" -ne 0 ]; then … fi` 整块 ⇒ 本装置 rc=**1**，且**只有 fail 臂**红
#      （那一臂的 rc 仍是 1 —— 第二条守卫会接住它，但 message 换成另一句 ⇒ 分类只认 message，不认码）；
#   未变异对照 ⇒ rc=**0** 三臂全绿。替换前先断言 `count(frm) == 1`，没落地就整臂跳过（不记绿也不记红）。
set -u
cd "$(dirname "$0")/../.." || exit 4

SRC=scripts/verify-mobile-due-time.sh
JUDG=research/tools/r14c-server-readability-judgment.sh
# 🔴 对账的第 5 节按 cwd 相对路径开文件，所以前提要在**开跑时**验，不能等 python 抛异常后
#    靠"stdout 为空"那一档反推（那样"迷你树少拷一个文件"和"探针自己坏了"长得一模一样）。
for f in "$SRC" "$JUDG"; do
  [ -f "$f" ] || { echo "❌ 前提不成立：$f 不在 cwd=${PWD}（这是装置/迷你树坏了，不是判据红）exit 4" >&2; exit 4; }
done
DIR=$(mktemp -d /tmp/ht-r14c-arms.XXXXXX)   # 🔴 每跑唯一：按阶段命名的日志会被并发的那一趟覆盖（本机实测踩过）
trap 'rm -rf "$DIR"' EXIT

# ── 1. 逐字节抽出那段守卫（按内容锚，不按行号 —— 行号会漂）
S=$(grep -n '^INSTALL_OUT=\$(\$ADB install' "$SRC" | cut -d: -f1)
E=$(grep -n '^ok "安装成功' "$SRC" | cut -d: -f1)
if [ -z "$S" ] || [ -z "$E" ] || [ "$E" -lt "$S" ]; then
  echo "❌ 抽不到守卫段（start=[$S] end=[$E]）⇒ 源形状变了，去读 $SRC 第 1 步" >&2
  exit 4
fi
if [ "$(grep -c '^INSTALL_OUT=\$(\$ADB install' "$SRC")" != "1" ] ||
   [ "$(grep -c '^ok "安装成功' "$SRC")" != "1" ]; then
  echo "❌ 锚不唯一，拒绝猜测抽取范围" >&2
  exit 4
fi
sed -n "${S},${E}p" "$SRC" > "$DIR/block.sh"
# 末行必须是 ok 那句，不能把后面的 `pm clear` 之类的设备动作抽进来（上一轮真踩过：多抽一行 = 真跑了一次重装）
case "$(tail -1 "$DIR/block.sh")" in
  ok\ \"安装成功*) : ;;
  *) echo "❌ 抽出内容的末行不是那句 ok（=$(tail -1 "$DIR/block.sh")）⇒ 守卫段边界变了" >&2; exit 4 ;;
esac
echo "守卫段：$SRC:$S-${E}（$((E - S + 1)) 行），cmp 自证：$(cmp -s <(sed -n "${S},${E}p" "$SRC") "$DIR/block.sh" && echo 与源相同 || echo 不同)"

# ── 2. 桩 adb（三种 install 结果）
mkdir -p "$DIR/bin"
cat > "$DIR/bin/adb" <<'STUB'
#!/bin/bash
case "$1 $2" in
  "install -r")
    case "$ARM" in
      ok) echo "Performing Streamed Install"; echo "Success"; exit 0 ;;
      fail) echo "Performing Streamed Install"; echo "Failure [INSTALL_FAILED_ABORTED: User rejected permissions]"; exit 1 ;;
      quiet) echo "Performing Streamed Install"; echo "open data connection... failed somehow"; exit 0 ;;
      *) echo "STUB_BAD_ARM:$ARM" >&2; exit 99 ;;
    esac ;;
esac
exit 0
STUB
chmod +x "$DIR/bin/adb"

cat > "$DIR/fixture.sh" <<FIX
#!/bin/bash
set -u
ok() { echo "OK_LINE: \$1"; }
bad() { echo "BAD_LINE: \$1"; }
screen_txt() { echo "SCREEN_TXT_CALLED"; }
ADB="$DIR/bin/adb"
APK="$DIR/fake.apk"
APK_SHA="stub-sha-for-attribution"
echo "RUNNER_STARTED arm=\$ARM"
# 前提断言：桩必须可执行。忘了 chmod +x 时三臂会全部塌成同一条"退出码 126"的红，
# 看着像"守卫在拦"，其实红的是探针 —— 这条断言就是那次实测之后加的。
if [ ! -x "\$ADB" ]; then echo "ABORT_STUB_NOT_EXECUTABLE"; exit 4; fi
. "$DIR/block.sh"
echo "REACHED_END_OF_BLOCK"
FIX

# ── 3. 三臂各跑一次，退出码单独取（绝不接管道 —— 管道会把码换成 tail/sed 的）
overall=0
for arm in ok fail quiet; do
  ARM=$arm bash "$DIR/fixture.sh" > "$DIR/arm.$arm.out" 2>&1
  rc=$?
  out=$DIR/arm.$arm.out
  expect=""
  case $arm in
    # 对照腿：真装成功时守卫**不许**红
    ok)    [ "$rc" = "0" ] && grep -q '^OK_LINE: 安装成功' "$out" && grep -q 'APK sha256=' "$out" && grep -q '^REACHED_END_OF_BLOCK$' "$out" && ! grep -q '^BAD_LINE' "$out" || expect="该绿没绿（rc=${rc}）" ;;
    fail)  [ "$rc" = "1" ] && grep -q 'BAD_LINE: adb install 退出码 1 ⇒' "$out" && grep -q '^SCREEN_TXT_CALLED$' "$out" && ! grep -q '^REACHED_END_OF_BLOCK$' "$out" || expect="该红没红（rc=${rc}）" ;;
    quiet) [ "$rc" = "1" ] && grep -q 'BAD_LINE: adb install 退出码 0 但输出里没有 Success' "$out" && ! grep -q '^REACHED_END_OF_BLOCK$' "$out" || expect="该红没红（rc=${rc}）" ;;
  esac
  if [ -n "$expect" ]; then
    echo "❌ 臂 ${arm}：$expect"
    sed 's/^/     /' "$out"
    overall=1
  else
    echo "✅ 臂 ${arm}：rc=$rc 且落在那条守卫自己的 message 上"
  fi
done
# ── 4. 第 4 层（"直接查 Postgres"）的四臂：静默失败必须响
#   02:4x 现量的旧形状：`-U`/`-d` 是字面量 + 末尾 `2>/dev/null` + **没有任何 ok/bad 依赖它**
#   ⇒ 连不上库时什么都不印，而台账把这一格算成四层里的"服务端那一层"。这四臂钉的就是这三件事。
PS=$(grep -n '^PG_DB="\${HEYTA_E2E_DB' "$SRC" | cut -d: -f1)
PE=$(grep -n '^  bad "读不到服务端的 ops/devices 计数' "$SRC" | cut -d: -f1)
if [ -z "$PS" ] || [ -z "$PE" ] || [ "$PE" -le "$PS" ]; then
  echo "❌ 抽不到第 4 层那段（start=[$PS] end=[$PE]）⇒ $SRC 的第 13 步形状变了" >&2
  overall=1
elif [ "$(grep -c '^PG_DB="\${HEYTA_E2E_DB' "$SRC")" != "1" ]; then
  echo "❌ 第 4 层的锚不唯一，拒绝猜测抽取范围" >&2
  overall=1
else
  sed -n "${PS},$((PE + 1))p" "$SRC" > "$DIR/pgblock.sh"
  if [ "$(tail -1 "$DIR/pgblock.sh")" != "fi" ]; then
    echo "❌ 第 4 层抽出内容的末行不是 fi（=$(tail -1 "$DIR/pgblock.sh")）⇒ 边界变了" >&2
    overall=1
  else
    echo "第 4 层段：$SRC:$PS-$((PE + 1))（$((PE + 1 - PS + 1)) 行），末行 = fi"
    mkdir -p "$DIR/bin"
    cat > "$DIR/bin/psql" <<'PSTUB'
#!/bin/bash
case "$PGARM" in
  ok)    echo "41|9"; exit 0 ;;
  err)   echo 'psql: error: FATAL:  database "heyta_mobile_smokf" does not exist' >&2; exit 2 ;;
  quiet) exit 0 ;;   # 连上了但什么都没印 —— 旧形状在这一格静默"通过"
  *) echo "PSTUB_BAD_ARM:$PGARM" >&2; exit 99 ;;
esac
PSTUB
    chmod +x "$DIR/bin/psql"
    cat > "$DIR/pgfixture.sh" <<PGFIX
#!/bin/bash
set -u
ok() { echo "OK_LINE: \$1"; }
bad() { echo "BAD_LINE: \$1"; }
if [ ! -x "$DIR/bin/psql" ]; then echo "ABORT_PSTUB_NOT_EXECUTABLE"; exit 4; fi
PATH="$DIR/bin:\$PATH"
. "$DIR/pgblock.sh"
echo "REACHED_END_OF_PG_BLOCK"
PGFIX
    for arm in ok env err quiet; do
      if [ "$arm" = env ]; then
        PGARM=ok HEYTA_E2E_DB=zzz_knob_marker bash "$DIR/pgfixture.sh" > "$DIR/pg.$arm.out" 2>&1
      else
        PGARM=$arm bash "$DIR/pgfixture.sh" > "$DIR/pg.$arm.out" 2>&1
      fi
      rc=$?
      pout=$DIR/pg.$arm.out
      pgexpect=""
      case $arm in
        # 读数拿到了 ⇒ 必须绿，且 message 里要带库名与地址（连接参数不是字面量的证据）
        ok)   { [ "$rc" = "0" ] && grep -q '^OK_LINE: 服务端现场' "$pout" &&
                 grep -q 'heyta_mobile_smoke @ 127.0.0.1:5432' "$pout" &&
                 grep -q '^REACHED_END_OF_PG_BLOCK$' "$pout" && ! grep -q '^BAD_LINE' "$pout"; } || pgexpect="该绿没绿（rc=${rc}）" ;;
        # env 旋钮必须真的进连接（否则"走 env"只是注释）
        env)  { grep -q '^OK_LINE: 服务端现场' "$pout" && grep -q 'zzz_knob_marker @' "$pout"; } || pgexpect="库名的 env 没被用（rc=${rc}）" ;;
        # 连不上 ⇒ 必须红，且原始错误全文要带出来（旧形状在这里静默）
        err)  { [ "$rc" = "0" ] && grep -q '^BAD_LINE: 读不到服务端的 ops/devices 计数' "$pout" &&
                 grep -q 'does not exist' "$pout" && ! grep -q '^OK_LINE' "$pout"; } || pgexpect="该红没红（rc=${rc}）" ;;
        # 最坏那一格：退出码 0 但输出为空 ⇒ 旧形状什么都不说，新版必须红
        quiet) { [ "$rc" = "0" ] && grep -q '^BAD_LINE: 读不到服务端的 ops/devices 计数' "$pout" &&
                 ! grep -q '^OK_LINE' "$pout"; } || pgexpect="静默空输出没被抓住（rc=${rc}）" ;;
      esac
      if [ -n "$pgexpect" ]; then
        echo "❌ 第 4 层臂 ${arm}：$pgexpect"
        sed 's/^/     /' "$pout"
        overall=1
      else
        echo "✅ 第 4 层臂 ${arm}：rc=$rc 且落在那条判据自己的 message 上"
      fi
    done
  fi
fi

# 一条如实的形状记录（不是缺陷）：quiet 那条红不 dump 屏幕，fail 那条 dump。
echo "形状读数：SCREEN_TXT_CALLED —— fail 臂 $(grep -c 'SCREEN_TXT_CALLED' "$DIR/arm.fail.out") / quiet 臂 $(grep -c 'SCREEN_TXT_CALLED' "$DIR/arm.quiet.out")"

# ── 5. 这条判据现在有**两份拷贝** ⇒ 必须有一条漂移对账（"抄件一定会漂"）
#    第 4 节测的是 `scripts/verify-mobile-due-time.sh` 里那段；
#    `research/tools/r14c-server-readability-judgment.sh` 是为了给"开窗那一趟用的是载体已提交副本"
#    补一个判据形态的读数而写的同逻辑第二份。两份共存是**权宜**（等 A 落笔后第一份就有牙），
#    权宜的代价就是漂移，所以把它钉成判据：SQL 与形状正则两处必须逐字相同。
# 🔴 03:4x 修过一处自己的错：这里原来写 `cd "$(dirname \"$0\")/.."`，而 `research/tools/..` = `research/`
#    （不是仓库根）⇒ python 找不到文件、stdout 为空，而当时把"空"归进了"内容漂移"那一档 ——
#    **探针坏了报成被测物坏了**。正解是不自算相对路径：第 19 行已 cd 到仓库根，文件按仓库根相对路径开，
#    且 existence 前提已在开跑时验掉（见顶部 for f in …）。
DRIFT=$(python3 - <<'PYEOF'
import re,sys
A="scripts/verify-mobile-due-time.sh"
B="research/tools/r14c-server-readability-judgment.sh"
def core(path):
    src=open(path,encoding="utf-8").read()
    sql=[l.strip() for l in src.splitlines() if "SELECT (SELECT count(*) FROM operations) AS ops" in l]
    pat=[l.strip() for l in src.splitlines() if "grep -qE" in l and "[0-9]+" in l and "\\|" in l]
    if len(sql)!=1: return ("SQL 命中数="+str(len(sql)), [])
    if len(pat)!=1: return ("形状正则命中数="+str(len(pat)), [])
    m=re.search(r"\'([^\']*)\'", sql[0])
    # 🔴 只比**被断言的那两个字面量**（SQL 串与形状正则），不比整行：
    #    两份拷贝的行里变量名不同（$PG_SERVER_STATS vs $OUT），比整行会把这种无害差异报成漂移。
    m2=re.search(r"grep -qE \'([^\']*)\'", pat[0])
    return ("", [("SQL", m.group(1) if m else sql[0]), ("形状正则", m2.group(1) if m2 else pat[0])])
ea,ca=core(A); eb,cb=core(B)
if ea or eb:
    print("RED 结构:"+(ea or eb)); sys.exit(0)
diff=[n for (n,a),(_2,b) in zip(ca,cb) if a!=b]
if diff:
    print("RED 内容漂移在:"+",".join(diff)); sys.exit(0)
print("OK 两份逐字相同（SQL 与形状正则各命中 1 次）")
PYEOF
)
case "$DRIFT" in
  OK*)   echo "✅ 判据拷贝对账：$DRIFT" ;;
  "")    echo "❌ 判据拷贝对账：探针没输出（python 没跑成）—— 这是装置坏了，不是两份拷贝漂移"
         overall=1 ;;
  *)     echo "❌ 判据拷贝对账：$DRIFT —— 两份拷贝漂移了，改一份必须同时改另一份（或合成一份）"
         overall=1 ;;
esac

if [ "$overall" = "0" ]; then
  echo "结论：两条安装守卫都有牙（三臂 = 1 条对照 + 2 条各自点到自己那句红）"
fi
exit $overall
