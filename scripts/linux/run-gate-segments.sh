#!/usr/bin/env bash
# 在**本机**（通常就是那台 Linux 载体）上逐段跑根 package.json 里 `check` 链的若干段，
# 每段落一份日志，最后对一次数：**记录数必须等于段数**。
#
# 为什么要这么一枚薄工具，而不是直接 `pnpm check`：
#   `pnpm check` 是一串 `&&`，第一段红就整条停在那里 —— 它回答"这链能不能过"，
#   不回答"这链上有几段红、各红在哪"。载体归因需要后者（runbook §5 那张表就是这么来的）。
#
# 🔴 三条自己踩过的坑，都写成了断言而不是注释：
#   1. `while IFS= read` 会丢掉**没有尾换行的最后一行** ⇒ 链尾 `pnpm -r test` 一次都没跑过还报"96 段"。
#      现在用 mapfile，并断言读到的段数与预期一致。
#   2. 段名里带 `/`（`pnpm --filter @heyta/landing check:entries`）会拼出一个不存在的日志路径，
#      日志没落盘 ⇒ 读数时把它记成"红"。现在消毒段名，并断言日志文件真的存在。
#   3. `echo "$(cmd) rc=$?"` 里命令替换会把 `$?` 吞掉；管道后的 `$?` 是管道最后一个命令的。
#      现在**先把退出码存进变量**，再打印。
#
# 用法：
#   bash scripts/linux/run-gate-segments.sh                      # 默认跑 e2e 那几族（载体上最可疑的一批）
#   bash scripts/linux/run-gate-segments.sh --all                # 全链（慢；从 package.json 现读，不抄段数）
#   bash scripts/linux/run-gate-segments.sh check:ai-e2e "pnpm --filter @heyta/web check:foo"
#
# 日志与汇总落在 dist/linux-gate-segments/（产物目录，不进 git）。
set -uo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUT="$REPO/dist/linux-gate-segments"
mkdir -p "$OUT"

DEFAULT_SEGMENTS=(
  "pnpm check:e2e-helper-exports"
  "pnpm check:web-artifact"
  "pnpm check:ai-e2e"
  "pnpm check:privacy-consent-e2e"
  "pnpm check:landing-e2e"
  "pnpm check:web-storage"
  "pnpm check:web-migration"
)
# 🔴 `check:web-artifact` 在这张默认清单里的理由：它是共享 UI 产物的**自洽**判据
#    （`index.html` 自己说挂哪儿，就核对那份产物真在那儿跑得通）。批二 P4 要把 Linux 打的
#    `web-dist` 塞进 `.deb`，而"这台 Linux 能不能打出自洽的 web-dist"是那条工单唯一还没量的前提。
#    ⚠️ 今天差点在这里写了第二份实现（一个只查"引用是否存在"的小脚本）—— 已删：
#    同一件事的两份判据一定会漂，而这个仓库被这一形状咬过不止一次。

ALL_MODE=0
if [ "${1:-}" = "--all" ]; then
  ALL_MODE=1
  shift
fi

# 段清单：--all 从根 package.json 的 `check` 脚本现读（**唯一真源**，不在这里抄第二份列表）。
declare -a SEGMENTS=()
if [ "$ALL_MODE" -eq 1 ]; then
  mapfile -t SEGMENTS < <(node -e '
    const s = require("./package.json").scripts.check;
    for (const part of s.split(" && ")) console.log(part.trim());
  ')
  [ "${#SEGMENTS[@]}" -gt 0 ] || { echo "❌ 从 package.json 读到 0 段 —— 判据读不到段清单，不放行。"; exit 1; }
  echo "段清单来自 package.json 的 check 脚本，现读 $(printf '%s\n' "${SEGMENTS[@]}" | wc -l | tr -d ' ') 段。"
elif [ "$#" -gt 0 ]; then
  SEGMENTS=("$@")
else
  SEGMENTS=("${DEFAULT_SEGMENTS[@]}")
fi

if [ "$ALL_MODE" -eq 0 ]; then
  # 非 --all 时先确认每一段真的存在于链里 —— 否则"这段红了"可能只是我拼错了名字。
  KNOWN=$(node -e 'console.log(require("./package.json").scripts.check)')
  for seg in "${SEGMENTS[@]}"; do
    case "$KNOWN" in
      *"$seg"*) : ;;
      *) echo "❌ 这一段不在 check 链里：$seg"; exit 1 ;;
    esac
  done
fi

TSV="$OUT/segments.tsv"
: >"$TSV"
ran=0
for seg in "${SEGMENTS[@]}"; do
  slug=$(printf '%s' "$seg" | tr -c 'A-Za-z0-9._-' '_')
  log="$OUT/$slug.log"
  echo "── $seg"
  (cd "$REPO" && eval "$seg") >"$log" 2>&1
  rc=$?
  [ -f "$log" ] || { echo "❌ 日志没落盘：$log —— 这一段的读数不存在，不许按红/绿记。"; exit 1; }
  printf '%s\t%s\n' "$rc" "$seg" >>"$TSV"
  if [ "$rc" -eq 0 ]; then echo "   ✅ rc=0"; else echo "   🔴 rc=${rc}（日志：${log}）"; fi
  ran=$((ran + 1))
done

# 🔴 对账：跑过的段数必须等于清单条数，否则有段从来没被跑到（同一个失效形状：链尾被丢掉）。
expected="${#SEGMENTS[@]}"
recorded=$(wc -l <"$TSV" | tr -d ' ')
if [ "$ran" -ne "$expected" ] || [ "$recorded" -ne "$expected" ]; then
  echo "❌ 段数对不上：清单 $expected / 跑了 $ran / 记录 $recorded"
  exit 1
fi

reds=$(awk -F'\t' '$1 != 0' "$TSV" | wc -l | tr -d ' ')
echo ""
echo "SUMMARY segments=$expected reds=$reds logs=$OUT"
if [ "$reds" -gt 0 ]; then
  echo "红的段（逐条退出码）："
  awk -F'\t' '$1 != 0 {printf "  rc=%s  %s\n", $1, $2}' "$TSV"
  exit 1
fi
echo "✅ 这些段全绿。"
