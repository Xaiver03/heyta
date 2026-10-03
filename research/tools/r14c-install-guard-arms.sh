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
echo "守卫段：$SRC:$S-$E（$((E - S + 1)) 行），cmp 自证：$(cmp -s <(sed -n "${S},${E}p" "$SRC") "$DIR/block.sh" && echo 与源相同 || echo 不同)"

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
    ok)    [ "$rc" = "0" ] && grep -q '^OK_LINE: 安装成功' "$out" && grep -q 'APK sha256=' "$out" && grep -q '^REACHED_END_OF_BLOCK$' "$out" && ! grep -q '^BAD_LINE' "$out" || expect="该绿没绿（rc=$rc）" ;;
    fail)  [ "$rc" = "1" ] && grep -q 'BAD_LINE: adb install 退出码 1 ⇒' "$out" && grep -q '^SCREEN_TXT_CALLED$' "$out" && ! grep -q '^REACHED_END_OF_BLOCK$' "$out" || expect="该红没红（rc=$rc）" ;;
    quiet) [ "$rc" = "1" ] && grep -q 'BAD_LINE: adb install 退出码 0 但输出里没有 Success' "$out" && ! grep -q '^REACHED_END_OF_BLOCK$' "$out" || expect="该红没红（rc=$rc）" ;;
  esac
  if [ -n "$expect" ]; then
    echo "❌ 臂 $arm：$expect"
    sed 's/^/     /' "$out"
    overall=1
  else
    echo "✅ 臂 $arm：rc=$rc 且落在那条守卫自己的 message 上"
  fi
done
# 一条如实的形状记录（不是缺陷）：quiet 那条红不 dump 屏幕，fail 那条 dump。
echo "形状读数：SCREEN_TXT_CALLED —— fail 臂 $(grep -c 'SCREEN_TXT_CALLED' "$DIR/arm.fail.out") / quiet 臂 $(grep -c 'SCREEN_TXT_CALLED' "$DIR/arm.quiet.out")"

if [ "$overall" = "0" ]; then
  echo "结论：两条安装守卫都有牙（三臂 = 1 条对照 + 2 条各自点到自己那句红）"
fi
exit $overall
