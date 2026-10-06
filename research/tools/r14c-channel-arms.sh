#!/usr/bin/env bash
# `scripts/verify-mobile-due-time.sh` 里 `assert_channel` 那一道**停止条件**的牙（五臂）。
#
# 🔴 为什么要单独一把 rig：20:0x 那趟第 2 步起 `uiautomator` 连续 10 次抓不到界面、
#    `/tmp/ui.xml` 被截成空文件，而 `dump()` 重试完**不退出** —— 脚本于是继续往下走，
#    收了 8 条"找不到 X"的假红，一条产品判据都没跑到。
#    新增的 `assert_channel` 要把那种无效**落成一个 exit 3**，而"会停"这件事不能只在日志里
#    等下一次通道真的死才算数（那等于没有判据 —— §8.3：不能失败的检查没有价值）。
# 八臂（不碰 adb、不碰设备：`ADB` 指向一枚自造桩）：
#   A 正：hierarchy 在 + 前台是本应用 ⇒ 不停（rc=0、走到 REACHED_END）
#   B   前台是别人的包（SIM Toolkit 那一形）⇒ 必须 rc=3，且读数里带着"是谁的前台"
#   C 🔴 `dumpsys window` 取不到 ⇒ 前台串为**空** ⇒ 同样必须 rc=3
#        （"取不到"不许读成"通过"；B 与 C 成对，才排除"只判了等于 PKG 的反面"）
#   D   hierarchy 为空 ⇒ 由**真的** `require_screen` 先停（顺序：空树轮不到前台判断）
#   E 🔴 变异：把那条比较摘成恒假 ⇒ B 形与 C 形两腿都**不再停**（rc=0/0），A 仍绿
#        （少了 E，B/C 的 rc=3 可能是桩自己给的）
#   G/H/I 第 1 步换的承重判据用的是**共享库既有**的 `settle_foreground` —— 抽库里的原文跑三条腿：
#        G 前 2 次别人的包、第 3 次本应用 ⇒ rc=0（等到位移成立，不是第一反应就停）；
#        H 6 次全是别人的包 ⇒ rc=1 且六次都留痕；
#        I 🔴 前台行根本取不到 ⇒ 同样 rc=1（"取不到"不许读成"已在前台"）。
#
# 抽原文跑，不重抄（本线既有约定：重抄一份就变成臂在测臂自己抄的那份）。
# 用法：bash research/tools/r14c-channel-arms.sh
# 退出码：0 = 五臂如预期；1 = 某一臂不按预期（= 装置或那道停止条件坏了，不是仓库坏了）
set -u
cd "$(dirname "$0")/../.." || exit 1
S="${SCRIPT_OVERRIDE:-scripts/verify-mobile-due-time.sh}"
L="${LIB_OVERRIDE:-scripts/lib/mobile-e2e.sh}"
for f in "$S" "$L"; do [ -f "$f" ] || { echo "❌ 找不到被测文件：$f"; exit 1; }; done

B=$(grep -n '^assert_channel() {' "$S" | head -1 | cut -d: -f1)
[ -n "$B" ] || { echo "❌ 锚点没找到（脚本里没有 assert_channel 这道停止条件）⇒ 本装置先失效，而不是恒绿"; exit 1; }
E=$(awk -v from="$B" 'NR>from && /^\}/ {print NR; exit}' "$S")
[ -n "$E" ] || { echo "❌ 找到 assert_channel 的开头（行 ${B}）却找不到它的闭合 ⇒ 函数被改坏了"; exit 1; }
BLOCK=$(sed -n "${B},${E}p" "$S")
printf '%s\n' "$BLOCK" | grep -q 'exit 3' || { echo "❌ 抽出的段里没有 exit 3 ⇒ 那道条件谁也停不了"; exit 1; }
echo "抽原文：${S} 第 ${B}-${E} 行（$(printf '%s\n' "$BLOCK" | grep -c .) 行有内容）"

# 真的 `require_screen` 本体 —— D 臂要的是它自己那一句 exit 3，不是桩
RB=$(grep -n '^require_screen() {' "$L" | head -1 | cut -d: -f1)
[ -n "$RB" ] || { echo "❌ 共享库里找不到 require_screen 的定义 ⇒ D 臂无从判起"; exit 1; }
RE=$(awk -v from="$RB" 'NR>from && /^\}/ {print NR; exit}' "$L")
REQ=$(sed -n "${RB},${RE}p" "$L")
[ -n "$REQ" ] || { echo "❌ require_screen 抽出来是空的（第 ${RB}-${RE:-空} 行）"; exit 1; }

T=$(mktemp -d /tmp/r14c-channel.XXXXXX)
PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); printf '✅ %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '❌ %s\n' "$1"; }
trap 'rm -rf "$T"' EXIT

# `grep -c` 在 0 命中时**已经打印了 0** 又以 1 退出，再 `|| echo 0` 就变成 "0\n0"（比较恒假）
# ⇒ 兜底只放在「文件不存在」这一侧。
lines_with() { if [ -f "$2" ]; then grep -c "$1" "$2"; else echo 0; fi; }

# 桩 adb：只认 `shell dumpsys window`，回**真机那一形的原话**（空 = 取不到）
# 🔴 帧形状照 `dumpsys window` 的真实输出 `mCurrentFocus=Window{<hex id> u0 <pkg>/<活动>}`：
#    被测那段是 `s/.*u0 //` 再 `s/\/.*//` 两级裁剪，桩回别的一形时，臂测的就是
#    "桩与那两级 sed 合不合得来"，而不是被测代码（本仓那条"新加桩后首条红先怀疑桩的响应格式"）。
cat > "$T/adb" <<'ADB_EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "shell" ] && printf '%s' "${*:-}" | grep -q 'dumpsys window'; then
  if [ -n "${FAKE_FOCUS:-}" ]; then
    echo "  mCurrentFocus=Window{1a2b3c4 u0 ${FAKE_FOCUS}/com.x.MainActivity}"
  fi
  exit 0
fi
exit 0
ADB_EOF
chmod +x "$T/adb"

# run_case <臂名> <tree|notree> <前台串> <real|stub> [被测段=默认 BLOCK]
run_case() {
  local name="$1" have="$2" focus="$3" req="$4" block="${5:-$BLOCK}"
  if [ "$have" = "tree" ]; then printf '%s\n' '<hierarchy text="x">' > "$T/$name.xml"; else : > "$T/$name.xml"; fi
  cat > "$T/$name.sh" <<CASE_EOF
set -u
PKG="com.heyta.app"
UI_XML="$T/$name.xml"
ADB="$T/adb"
# 🔴 必须 **export**：桩 adb 是**另一个进程**，普通赋值它看不见 ⇒ 三臂全读成"取不到"，
#    症状是"正向腿红了、负向腿反而绿了"（第一跑就是这个形状）。
export FAKE_FOCUS="$focus"
dump() { :; }
screen_txt() { echo "SCREEN_TXT_RAN"; }
who_else() { echo "WHO_ELSE_STUB"; }
bad() { printf 'BAD %s\n' "\$1"; }
ok()  { printf 'OK %s\n' "\$1"; }
CASE_EOF
  if [ "$req" = "real" ]; then
    printf '%s\n' "$REQ" >> "$T/$name.sh"
  else
    printf 'require_screen() { return 0; }\n' >> "$T/$name.sh"
  fi
  printf '%s\n' "$block" >> "$T/$name.sh"
  {
    printf 'assert_channel "step5"\n'
    printf 'echo REACHED_END\n'
  } >> "$T/$name.sh"
  bash "$T/$name.sh" > "$T/$name.out" 2>&1
  printf '%s' "$?"
}

# ---------------------------------------------------------------- 臂 A
RC=$(run_case A tree "com.heyta.app" stub)
if [ "$RC" = "0" ] && grep -q REACHED_END "$T/A.out"; then
  ok "臂 A 正向：hierarchy 在、前台是本应用的包 ⇒ 通道自检放过，判据集才允许开跑"
else
  bad "臂 A 不如预期：rc=$RC 输出=$(tr '\n' ' ' < "$T/A.out")"
fi

# ---------------------------------------------------------------- 臂 B
RC=$(run_case B tree "com.android.simtoolkit" stub)
if [ "$RC" = "3" ] && grep -q 'com.android.simtoolkit' "$T/B.out"; then
  ok "臂 B：前台是别人的包 ⇒ 以 rc=3 停住，且读数里带着「是谁的前台」（不是含糊的一句「通道失败」）"
else
  bad "臂 B 不如预期：rc=$RC 输出=$(tr '\n' ' ' < "$T/B.out")"
fi

# ---------------------------------------------------------------- 臂 C
RC=$(run_case C tree "" stub)
if [ "$RC" = "3" ]; then
  ok "臂 C 🔴 关键一臂：dumpsys 取不到（前台串为空）⇒ 同样停住 ——「取不到」不许读成「通过」"
else
  bad "臂 C 不如预期：rc=$RC 输出=$(tr '\n' ' ' < "$T/C.out") ⇒ 空读数被当成合法，这道条件只判了反面"
fi

# ---------------------------------------------------------------- 臂 D
RC=$(run_case D notree "com.heyta.app" real)
if [ "$RC" = "3" ] && grep -q '本轮结果无效' "$T/D.out"; then
  ok "臂 D：hierarchy 为空时由**真的** require_screen 先停（顺序对：空树轮不到前台判断）"
else
  bad "臂 D 不如预期：rc=$RC 输出=$(tr '\n' ' ' < "$T/D.out")"
fi

# ---------------------------------------------------------------- 臂 E（变异腿）
# 🔴 变异用 python 做**字面替换**并断言命中数（sed 的转义层 + 非 ASCII 替换串在这台机上
#    是 §7 #77 那一族；替换串里只放 ASCII）。
export HT_SRC="$S" HT_OUT="$T/mut.sh"
python3 - <<'PY' || { echo "❌ 变异腿的前提没落地"; exit 1; }
import os, pathlib
src = pathlib.Path(os.environ["HT_SRC"]).read_text()
needle = '[ "$cur" != "$PKG" ]'
repl = '[ "" != "NEVER-EQUAL" ] && [ -n "$cur" ] && [ -z "$cur" ]'
n = src.count(needle)
if n != 1:
    raise SystemExit(f"变异应当恰好命中那一处比较，实际 {n} 处")
mut = src.replace(needle, repl)
if mut.count(needle) != 0:
    raise SystemExit("变异后原比较还在")
pathlib.Path(os.environ["HT_OUT"]).write_text(mut)
PY
# 从变异副本里重新抽同一段（保证变异真的在被测段内，而不是只改了另一个文件）
MB=$(grep -n '^assert_channel() {' "$T/mut.sh" | head -1 | cut -d: -f1)
ME=$(awk -v from="$MB" 'NR>from && /^\}/ {print NR; exit}' "$T/mut.sh")
MUT=$(sed -n "${MB},${ME}p" "$T/mut.sh")
if [ "$MUT" != "$BLOCK" ] && printf '%s\n' "$MUT" | grep -q 'NEVER-EQUAL'; then
  RCB=$(run_case E1 tree "com.android.simtoolkit" stub "$MUT")
  RCC=$(run_case E2 tree "" stub "$MUT")
  if [ "$RCB" = "0" ] && [ "$RCC" = "0" ]; then
    ok "臂 E 🔴 有牙证明：把那条比较摘成恒假之后，B 形（别人的前台）与 C 形（取不到）两腿都**不再停**（rc=0/0）⇒ 那两臂的 rc=3 是被测那段给的，不是桩给的"
  else
    bad "臂 E 不如预期：摘掉比较应当让两腿放行，实际 rc=$RCB / $RCC ⇒ 停住的原因另有其物，B/C 测的不是这段"
  fi
else
  bad "臂 E 前提不成立：变异副本与原文一致或没带上标记 ⇒ 变异没落在被测段里"
fi

# ---------------------------------------------------------------- 臂 G/H（第 1 步那条新腿：settle_foreground）
# 🔴 第 1 步换的承重判据用的是**共享库既有**的 `settle_foreground`，不是我写的新装置；
#    那两行本身不在这把 rig 的射程里，所以这里抽库里的原文跑三条腿，把"它到底会不会停"钉住。
#    桩要能**按次数换答案**（它的语义就是"最多拉起 6 次，等到为止"），所以前台值走一枚计数文件。
SF=$(grep -n '^settle_foreground() {' "$L" | head -1 | cut -d: -f1)
[ -n "$SF" ] || { echo "❌ 共享库里找不到 settle_foreground ⇒ 臂 G/H 无从判起"; exit 1; }
SFE=$(awk -v from="$SF" 'NR>from && /^\}/ {print NR; exit}' "$L")
SF_BLOCK=$(sed -n "${SF},${SFE}p" "$L")
printf '%s\n' "$SF_BLOCK" | grep -q 'return 1' || { echo "❌ 抽出的 settle_foreground 里没有 return 1 ⇒ 抽取范围不对"; exit 1; }

cat > "$T/adb_seq" <<'SEQ_EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "shell" ] && printf '%s' "${*:-}" | grep -q 'dumpsys window'; then
  n=$(cat "$HT_SEQ_FILE" 2>/dev/null || echo 0)
  n=$((n + 1)); printf '%s' "$n" > "$HT_SEQ_FILE"
  if [ "$n" -le "${HT_BAD_UNTIL:-0}" ]; then
    echo "  mCurrentFocus=Window{1a2b3c4 u0 com.android.simtoolkit/com.x.MainActivity}"
  elif [ "${HT_FOREVER_BAD:-0}" = "1" ]; then
    echo "  mCurrentFocus=Window{1a2b3c4 u0 com.android.simtoolkit/com.x.MainActivity}"
  elif [ "${HT_EMPTY:-0}" = "1" ]; then
    :
  else
    echo "  mCurrentFocus=Window{1a2b3c4 u0 com.heyta.app/com.x.MainActivity}"
  fi
  exit 0
fi
exit 0
SEQ_EOF
chmod +x "$T/adb_seq"

run_sf() {  # <臂名> <bad_until> <forever_bad> <empty>
  printf '0' > "$T/$1.count"
  cat > "$T/$1.sh" <<SF_EOF
set -u
PKG="com.heyta.app"
ADB="$T/adb_seq"
# 🔴 四枚都要 **export**（桩 adb 是另一个进程 —— 同一个坑在这把 rig 里第二次踩，
#    症状是"三条腿全部 rc=0、重试行数 0"，看着像被测函数不会停，其实桩一直在答"正常"）。
export HT_SEQ_FILE="$T/$1.count" HT_BAD_UNTIL="$2" HT_FOREVER_BAD="$3" HT_EMPTY="$4"
launch_app() { :; }
$SF_BLOCK
settle_foreground
SF_RC=\$?
echo "SF_REACHED rc=\$SF_RC"
# 🔴 必须把被测函数的返回码**原样转成脚本的退出码**：第一跑这里只到 `echo "SF_REACHED rc=$?"`，
#    而脚本自己的退出码是那句 echo 的（恒 0）⇒ 臂 H/I 读出 rc=0，看着像"库里的函数不会停"，
#    实际是我的取法把码丢了。
exit \$SF_RC
SF_EOF
  bash "$T/$1.sh" > "$T/$1.out" 2>&1
  printf '%s' "$?"
}

# 🔴 三条腿都要先核**桩真的被问过**（`$T/<臂>.count` = 桩被调用的次数）：
#    第一跑这三条全是 rc=0、重试行数 0，看着像"被测函数不会停"，真因是桩的 env 没 export、
#    它一直在答"正常"。没有这条前提，G/H/I 的绿什么都不能证明。
RC=$(run_sf G 2 0 0)
G_CALLS=$(cat "$T/G.count" 2>/dev/null || echo 0)
G_RETRY=$(lines_with '↻ 前台是' "$T/G.out")
if [ "$G_CALLS" -lt 3 ]; then
  bad "臂 G 前提不成立：桩只被问了 $G_CALLS 次（应当 ≥3）⇒ 分支没生效，这条读数什么都不能证明"
elif [ "$RC" = "0" ] && grep -q 'SF_REACHED rc=0' "$T/G.out" && [ "$G_RETRY" = "2" ]; then
  ok "臂 G：前台前 2 次是别人的包、第 3 次是本应用 ⇒ settle_foreground 自己拉起并等到位移成立（rc=0，重试 2 次、问了 $G_CALLS 次）—— 停不是第一反应"
else
  bad "臂 G 不如预期：rc=$RC 重试行数=$G_RETRY 桩被问=$G_CALLS 次 输出=$(tr '\n' ' ' < "$T/G.out")"
fi

RC=$(run_sf H 0 1 0)
H_CALLS=$(cat "$T/H.count" 2>/dev/null || echo 0)
H_RETRY=$(lines_with '↻ 前台是' "$T/H.out")
if [ "$H_CALLS" -lt 6 ]; then
  bad "臂 H 前提不成立：桩只被问了 $H_CALLS 次（应当 6）⇒ 分支没生效"
elif [ "$RC" = "1" ] && [ "$H_RETRY" = "6" ]; then
  ok "臂 H：6 次全是别人的包 ⇒ rc=1（第 1 步那两处把它落成 exit 3），且六次尝试都留了痕"
else
  bad "臂 H 不如预期：rc=$RC 重试行数=$H_RETRY 桩被问=$H_CALLS 次"
fi

RC=$(run_sf I 0 0 1)
I_CALLS=$(cat "$T/I.count" 2>/dev/null || echo 0)
if [ "$I_CALLS" -lt 6 ]; then
  bad "臂 I 前提不成立：桩只被问了 $I_CALLS 次（应当 6）⇒ 分支没生效"
elif [ "$RC" = "1" ]; then
  ok "臂 I 🔴 取不到前台（dumpsys 里没有 mCurrentFocus 行）⇒ 同样 rc=1，不许把「取不到」读成「已经在前台」（问了 $I_CALLS 次，每次都答空）"
else
  bad "臂 I 不如预期：rc=$RC ⇒ 空读数被判成通过"
fi

# ---------------------------------------------------------------- 臂 J（通道单所有者：静态不变式）
# 🔴 这一臂拦的是"半套现场"：同一个脚本里 `dump`/`require_screen` 读 `$UI_XML`，
#    而 `rid_*` 三枚助手读字面量 `/tmp/ui.xml` —— 换路径时一半判据会去读**别人的界面**，
#    且**不报错**（lib 自己在 `mobile-e2e.sh:38-48` 写过这句：半套现场比全套更难查）。
#    只查**代码行**：注释里出现那个路径是历史说明，删掉反而毁掉理由。
CODE_LITERAL=$(grep -vn '^#' "$S" | grep -c '/tmp/ui\.xml' || true)
HELPERS_WITH_VAR=$(grep -c 'python3 "\$RID_PY" .*"\$UI_XML"' "$S" || true)
if [ "$CODE_LITERAL" = "0" ] && [ "$HELPERS_WITH_VAR" = "3" ]; then
  ok "臂 J：dump 通道**只有一个所有者**（代码里 0 处字面 /tmp/ui.xml，三枚助手都传 \"\$UI_XML\"）"
else
  bad "臂 J 不成立：代码里还有 $CODE_LITERAL 处字面 /tmp/ui.xml、助手带变量的只有 $HELPERS_WITH_VAR/3 ⇒ 换路径时这半边会读别人的界面而不报错"
fi

echo "== 结论：通道自检的停止条件 + settle_foreground 的三条腿 + 变异对照 pass=$PASS fail=$FAIL =="
[ "$FAIL" = 0 ] || exit 1
exit 0
