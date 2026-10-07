#!/bin/bash
# P-12 第二板（备份默认加密）的**逐条承诺变异取证**。为什么单独一趟：
# §10.238① 那一行引用的九臂是**恢复闸**的变异（p12-restore-gate-arms.py），
# 它证明的是 restore.sh 的那六步会红；备份侧这五条承诺当时只留了"47 passed"这条**存在性**读数
# —— 而"用例存在"不等于"判据不能失败"（AGENTS §7 元规则 2）。本 rig 把这五格各自补成一臂。
#
# 形状：
#   变异对象是**拷贝**（整份 server/scripts 目录一起拷，因为 backup.sh:37 用 BASH_SOURCE 推 SCRIPT_DIR，
#   只拷一个文件会让臂因"找不到同伴脚本"而红 —— 那是错因，§7 那一族）。仓库那两份一字未动。
#   被测通道是 server/tests/backup-script.spec.ts 里那枚 HEYTA_BACKUP_SCRIPT 旋钮
#   （它只决定"执行哪一份脚本"，不参与任何断言 ⇒ 取证不需要放宽判据）。
#   每臂两条腿：**基线**（未变异拷贝，同一枚用例必须 `1 passed`）+ **变异**（必须 `1 failed` 且 rc≠0）。
#   🔴 只要求 rc≠0 不够：vitest 的 `-t` 打空时是"没有用例被跑"，也会给非零/零里的某一个，
#      看形状不如看它自己打印的那行 —— 所以两条腿各自断言**它声称的那件事**（本计划 §10.244 那条教训）。
#
# 用法：bash research/tools/mutation-rigs/p12-backup-arms.sh          # 五臂全跑
#       bash research/tools/mutation-rigs/p12-backup-arms.sh --list    # 只报名臂与用例名，不跑
# 退出码：0 五臂各自把对应判据打死 / 1 有臂存活 / 3 环境无效（vitest 起不来、基线没跑到用例）
#        / 4 锚点问题（命中数≠1 ⇒ 那一臂是 no-op，绝不当成"存活"或"打死"）
set -uo pipefail
SRC="/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta"
W="$SRC/tmp/p12-readings/mut-backup-arms"
ANCHOR="$SRC/research/tools/mutation-rigs/p12-backup-anchor.py"
SPEC="tests/backup-script.spec.ts"
LOG="$W/rig.log"
ARMCOUNT=0

# 臂：i|变异前(字面串)|变异后(字面串)|用例名(-t 的子串)|这一臂在挡哪一句承诺
ARMS=(
  '1|ENCRYPTED=1|ENCRYPTED=0|the default artifact is real ciphertext|默认产物必须是密文（名字带 .enc 的明文不算）'
  '2|if [ ! -f "$BACKUP_ENCRYPTION_PASSPHRASE_FILE" ]; then|if [ -f "$BACKUP_ENCRYPTION_PASSPHRASE_FILE" ]; then|missing passphrase file: refuses loudly and writes NOTHING|缺口令 ⇒ 响亮拒绝且不写任何产物'
  '3|if [ "$(( 0$KEY_MODE & 077 ))" -ne 0 ]; then|if [ 0 -ne 0 ]; then|a passphrase anyone but the owner can read is refused|组/其他位必须为 0（同机别的账号能读口令 = 没加密）'
  '4|case "$KEY_REAL" in|case "X" in|a key stored inside BACKUP_DIR is refused|密钥不许与产物同目录'
  '5| -o -name "supersync_*.sql.gz.enc" -o -name "supersync_accounts_*.sql.gz.enc"| |retention sweeps the ENCRYPTED names|留存清扫必须扫到新名字（漏了⇒旧密文永不过期⇒法务那句 14 天变假）'
)
# 臂 5 的额外正向对照：换了名字的**新鲜**密文不许被扫掉（证明那一臂不是"整个清扫坏了"这种错因）
ARM5_EXTRA='a fresh encrypted artifact is NOT swept'

say() { printf '%s\n' "$*" | tee -a "$LOG"; }

# 🔴 任何一条出口都得先有 ${W}：`--list` 原来跑在 mkdir 之前，于是每行 say 的 tee 都在报
#    "No such file or directory"（stdout 照打 ⇒ 看起来是成功的）。那种噪声会让人在真跑时
#    把"装置自己写不进日志"误读成"臂坏了"。
mkdir -p "$W"

[ "${1:-}" = "--list" ] && { for a in "${ARMS[@]}"; do IFS='|' read -r i _ _ c why <<< "$a"; say "ARM$i  用例=「${c}」  挡的是=$why"; done; say "ARM5 额外正向对照用例=「${ARM5_EXTRA}」"; say "LIST_ONLY arms=${#ARMS[@]}"; exit 0; }

rm -rf "$W"; mkdir -p "$W"; : > "$LOG"
say "取数时刻: $(date '+%Y-%m-%d %H:%M:%S')"

# ── 前置：旋钮在不在（不在就说明 spec 那份改动没落地，整趟作废，别跑出五枚假读数）
if ! grep -q 'HEYTA_BACKUP_SCRIPT' "$SRC/server/tests/backup-script.spec.ts"; then
  say "RIG=ENV-INVALID reason=spec 里没有 HEYTA_BACKUP_SCRIPT 旋钮（变异臂会全打同一份真脚本）"; exit 3
fi
command -v python3 >/dev/null 2>&1 || { say "RIG=ENV-INVALID reason=缺 python3（锚点替换器要用）"; exit 3; }

# 未变异的 scripts 目录（基线 + 每臂各拷一份，臂只改自己那一行）
mk_scripts() { rm -rf "$1"; mkdir -p "$1"; cp -R "$SRC/server/scripts" "$1/scripts"; }

run_case() { # $1=脚本目录(其下 scripts/backup.sh) $2=用例名 $3=日志
  ( cd "$SRC/server" && NO_COLOR=1 HEYTA_BACKUP_SCRIPT="$1/scripts/backup.sh" \
      pnpm vitest run "$SPEC" -t "$2" ) > "$3" 2>&1
  return $?
}

# 从 vitest 自己的汇总行取"这一枚用例到底跑没跑、结果是什么"
verdict() { # $1=日志 → 打印 PASSED / FAILED / NORUN
  local lg="$1"
  if grep -qE '^\s*Tests?\s+1 passed' "$lg"; then echo PASSED; return; fi
  if grep -qE '^\s*Tests?\s+1 failed' "$lg"; then echo FAILED; return; fi
  echo NORUN
}

mk_scripts "$W/base"
SURVIVED=0; BADARM=0; ENVBAD=0
say "═══ 基线（未变异拷贝：五枚用例都必须真跑到且过）═══"
for a in "${ARMS[@]}"; do
  IFS='|' read -r i old new c why <<< "$a"
  run_case "$W/base" "$c" "$W/base-$i.log"; brc=$?
  bv=$(verdict "$W/base-$i.log")
  say "BASE$i rc=$brc verdict=$bv 用例=「${c}」"
  [ "$bv" = "PASSED" ] || { say "  ⇒ 基线没跑到这一枚（用例名对不上或套件坏了），臂 $i 判不了"; ENVBAD=1; }
done

say "═══ 五臂 ═══"
for a in "${ARMS[@]}"; do
  IFS='|' read -r i old new c why <<< "$a"
  ARMCOUNT=$((ARMCOUNT+1))
  d="$W/arm$i"; mk_scripts "$d"
  # 锚点按**字面串**交给替换器（不经 shell 再解释，也不走 $(…) 命令替换 ——
  # 那会吃掉尾换行，本计划今晚刚为这事翻过一次面）。
  python3 "$ANCHOR" "$SRC/server/scripts/backup.sh" "$d/scripts/backup.sh" "$old" "$new" >> "$LOG" 2>&1
  arc=$?
  if [ "$arc" != "0" ]; then
    say "ARM$i ANCHOR=BAD rc=${arc}（锚点命中数≠1 ⇒ 这一臂是 no-op，不能当成任何一种结果）"
    BADARM=1; continue
  fi
  run_case "$d" "$c" "$W/arm$i.log"; mrc=$?
  mv=$(verdict "$W/arm$i.log")
  # 🔴 分类只认 vitest 自己说的"这一枚用例**因为断言**红了"：
  #    rc≠0 或"红"这个词都不够 —— 脚本崩、模块找不到、快照缺失都能给 rc≠0（§7 #197 那一族：
  #    成功运行里也会出现错误样的一行 ⇒ 它连必要条件都不是）。
  asserted=$(grep -cE 'AssertionError|expected .* to (be|contain|equal|have)' "$W/arm$i.log")
  if [ "$mv" = "FAILED" ] && [ "$asserted" != "0" ]; then
    say "ARM$i=KILLED verdict=FAILED rc=$mrc 断言标记=$asserted 用例=「${c}」 挡的是=$why"
  elif [ "$mv" = "FAILED" ]; then
    say "ARM$i=SUSPECT 红但没有断言标记 ⇒ 多半是脚本崩/环境错因，要人读 $W/arm$i.log"
    BADARM=1
  else
    say "ARM$i=SURVIVED verdict=$mv rc=$mrc ⇒ 这条承诺被摘掉之后判据没红（${why}）"
    SURVIVED=1
  fi
  if [ "$i" = "5" ]; then
    run_case "$d" "$ARM5_EXTRA" "$W/arm5-extra.log"; erc=$?
    ev=$(verdict "$W/arm5-extra.log")
    say "ARM5_EXTRA verdict=$ev rc=$erc 用例=「${ARM5_EXTRA}」（新鲜的不许被扫 ⇒ 排除"整个清扫坏了"这种错因）"
    [ "$ev" = "PASSED" ] || { say "  ⇒ 额外对照没绿：那一臂的证词不算（错因未排除）"; BADARM=1; }
  fi
done

say "═══ 判定 ═══"
say "ARMS_TOTAL=${#ARMS[@]} SURVIVED=$SURVIVED BADANCHOR=$BADARM ENVBAD=$ENVBAD"
[ "$ENVBAD" = "1" ] && exit 3
[ "$BADARM" = "1" ] && exit 4
[ "$SURVIVED" = "1" ] && exit 1
say "RESULT=OK 每臂各自把对应判据打红，且基线同用例全绿"
exit 0
