#!/usr/bin/env bash
# #87 的变异读数装置：把"销毁即死路"那一发守卫/那一发缓存摘掉，量判据会不会红。
#
# 为什么要有这个文件（而不是手改一遍代码再改回来）：
# 这条守卫的产出**不是**"测试跑过了"，是"判据有牙"这件事的证据。没有可复现的装置，
# 下一轮只能重新推导一次，而重新推导正是"永远通过的判据"能活下来的原因。
#
# 两臂各钉一件不同的事（一次只摘一枚，否则红集分不清来源）：
#   G = 摘掉三处**进门守卫**（销毁后的读会走"透明重开"把容器建回来）
#   C = 摘掉三处 **destroying 缓存**（第二次 destroy 会去重开那份已经没了的库）
#
# 需要独占：无（不碰设备、不起服务端、不开浏览器；只在本机重打一次 packages/storage/dist）。
# 用法：bash research/tools/mutation-rigs/e2-destroyed-guard-arms.sh [G|C]      # 缺省 = 两臂都跑
set -u

# 🔴 三层不是两层：本文件在 research/tools/mutation-rigs/ 下，少算一层会把 R 落到 research/，
#    而"路径不存在"在起手守卫里长得和"文件被改动过"一模一样 —— 会静默跳过整条判据。
R="$(cd "$(dirname "$0")/../../.." && pwd)"
SQLITE="$R/packages/storage/src/sqlite/sqlite-adapter.ts"
IDB="$R/packages/storage/src/indexeddb/indexeddb-adapter.ts"
MEM="$R/packages/storage/src/memory/memory-adapter.ts"
BACKUP="$(mktemp -d /tmp/e2-guard-arms.XXXXXX)"
ARM="${1:-all}"

say() { printf '%s\n' "$*"; }
die() { say "ARM=FAIL reason=$1"; restore; exit 1; }

restore() {
  cp "$BACKUP/sqlite-adapter.ts" "$SQLITE"
  cp "$BACKUP/indexeddb-adapter.ts" "$IDB"
  cp "$BACKUP/memory-adapter.ts" "$MEM"
}

# 🔴 起手必须先证"这三枚文件现在是干净的修复态"，否则摘针脚可能摘在别人的改动上。
for f in "$SQLITE" "$IDB" "$MEM"; do
  [ -f "$f" ] || { say "ARM=ENV-INVALID reason=文件不存在 $f"; exit 3; }
done
grep -q "this.destroyed) return Promise.reject(new AdapterDestroyedError('sqlite'))" "$SQLITE" \
  || { say "ARM=ENV-INVALID reason=sqlite 那一发守卫不在（装置漂了，不动别人的东西）"; exit 3; }

mkdir -p "$BACKUP"
cp "$SQLITE" "$BACKUP/sqlite-adapter.ts"
cp "$IDB" "$BACKUP/indexeddb-adapter.ts"
cp "$MEM" "$BACKUP/memory-adapter.ts"
BASE_MD5=$(md5 -q "$SQLITE" "$IDB" "$MEM" | tr '\n' ' ')

# 变异用 node 做逐串替换（sed 在多行/中文上不可靠，见 traps #77）。
patch() { # patch <file> <from> <to>
  node -e '
    const fs = require("fs");
    const [file, from, to] = process.argv.slice(1);
    const t = fs.readFileSync(file, "utf8");
    if (!t.includes(from)) { console.error("needle 不在文件里：" + from.slice(0, 60)); process.exit(2); }
    fs.writeFileSync(file, t.split(from).join(to));
  ' "$1" "$2" "$3" || die "patch 失败：$2"
}

run_arm() {
  local arm="$1"
  say "── 臂 $arm ──"
  if [ "$arm" = "G" ]; then
    patch "$SQLITE" "if (this.destroyed) return Promise.reject(new AdapterDestroyedError('sqlite'));" \
                   "if (false && this.destroyed) return Promise.reject(new AdapterDestroyedError('sqlite'));"
    patch "$IDB" "if (this.destroyed) return Promise.reject(new AdapterDestroyedError(this.dbName));" \
                 "if (false && this.destroyed) return Promise.reject(new AdapterDestroyedError(this.dbName));"
    patch "$MEM" "if (this.destroyed) throw new AdapterDestroyedError('memory');" \
                 "if (false && this.destroyed) throw new AdapterDestroyedError('memory');"
  else
    # 🔴 变异形状 = **把那一行整条删掉**，不是把它改成 if (false)。
    #    后者会连 TS 的类型收窄一起摘掉（`return this.destroying` 变成 possibly undefined），
    #    于是 tsup 的 **dts 阶段**先报错、臂 C 的探针腿根本没机会跑（traps #162 同族：
    #    vitest 绿 ≠ build 绿 —— 这里是反过来，build 红 ≠ 判据红）。
    #    "只拿掉修复"应当只拿掉修复本身。
    for f in "$SQLITE" "$IDB" "$MEM"; do
      patch "$f" "if (this.destroying !== undefined) return this.destroying;" ""
    done
  fi

  # 判据一侧：常驻契约 + 文件级那两条腿
  local out="$BACKUP/$arm.log"
  ( cd "$R" && NO_COLOR=1 pnpm --filter @heyta/storage test ) >"$out" 2>&1
  # 🔴 **先证明测试真的跑了**，再谈失败条数。这一台机器上有一条内存闸门
  # （`/tmp/tfa-test.lock`）会在别的会话跑套件时**拒绝启动** vitest：它输出一句中文说明
  # 并以非零退出，而那句话里既没有 `failed` 也没有 `×`。上一版这里直接写
  # `${failures:-0}`，于是"根本没跑"被印成"零失败"—— 装置把最危险的状态（没观测）
  # 翻译成了最安心的状态（全绿）。这类形状在本仓库已经记过不止一次（traps「没复现 ≠ 没执行」族）。
  if ! grep -q 'Test Files' "$out"; then
    restore
    say "ARM=BLOCKED reason=测试根本没跑起来（被闸门挡住），这不等于零失败"
    sed -n '1,6p' "$out"
    exit 3
  fi
  local failures
  # 🔴 汇总行的词序两种都出现过（`6 failed | 412 passed` 与 `412 passed | 6 failed`），
  #    只按一种抓会读成"未报" —— 而"未报"和"零失败"在输出上长得一模一样。
  failures=$(grep -oE '[0-9]+ failed' "$out" | tail -1 | grep -oE '[0-9]+')
  say "判据读数：failed=${failures:-0}（这个 0 是跑出来的：上一行已现量 Test Files 在输出里）"
  grep -E '^\s+(×|✗)' "$out" | sed 's/^ *//' | head -20

  # 装置一侧：只有臂 G 会让探针回到 REOPENED —— 臂 C 摘的是**第二次** destroy 的缓存，
  # 而探针全程只 destroy 一次，那一发路径它压根没走到。给臂 C 报探针读数是**假配对**。
  if [ "$arm" = "G" ]; then
    ( cd "$R" && NO_COLOR=1 pnpm --filter @heyta/storage build ) >"$BACKUP/$arm-build.log" 2>&1 \
      || { restore; die "臂 ${arm}：变异后的构建失败"; }
    local probe
    probe=$( cd "$R" && node research/tools/mutation-rigs/e2-destroy-reopen-probe.mjs 2>&1 | grep -oE 'PROBE=[A-Z-]+' | tail -1 )
    say "探针读数：$probe"
  else
    say "探针读数：不适用（臂 $arm 不改第一次销毁的路径）"
  fi

  restore
  ( cd "$R" && NO_COLOR=1 pnpm --filter @heyta/storage build ) >"$BACKUP/$arm-restore-build.log" 2>&1
}

case "$ARM" in
  G) run_arm G ;;
  C) run_arm C ;;
  all) run_arm G; run_arm C ;;
  *) say "ARM=ENV-INVALID reason=臂名只认 G / C / all"; exit 3 ;;
esac

AFTER_MD5=$(md5 -q "$SQLITE" "$IDB" "$MEM" | tr '\n' ' ')
if [ "$BASE_MD5" != "$AFTER_MD5" ]; then
  say "RESTORED=FAIL —— 三枚文件与起手快照逐字节不一致，立刻 git diff 自查"
  exit 1
fi
say "RESTORED=OK（三枚源文件 md5 与起手快照一致）"

# 阳性对照：恢复之后判据必须重新全绿、探针必须重新报 clean，
# 否则刚才那几枚红可能只是"载体坏了"而不是"摘掉修复"。
FINAL=$( cd "$R" && NO_COLOR=1 pnpm --filter @heyta/storage test 2>&1 | grep -oE 'Tests +[0-9]+ passed' | tail -1 )
say "恢复后判据：$FINAL"
cd "$R" && node research/tools/mutation-rigs/e2-destroy-reopen-probe.mjs 2>&1 | grep -oE 'PROBE=[A-Z-]+' | tail -1
