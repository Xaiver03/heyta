#!/bin/bash
# 证据 README 里"记的 md5 == 盘上字节"的常驻对账。
#
# 为什么需要它（2026-10-04 05:3x / 05:4x 两轮实测）：
#   `apps/web/evidence/calendar-view-options/README.md` 与 `apps/web/evidence/calendar-day/README.md`
#   里记的 md5 与**盘上字节对不上** —— 01:34 另一条会话跑 e2e 时把同名 png 覆盖，
#   而"人看过那张图"与"图是当前的"那两句承诺**没有任何一层会为此变红**。
#   §6.2 规定一要求的是人真的看过那张图，前提是**看的和记的是同一份字节**。
#
# 认两种形状（现量：仓库里两种都在用）：
#   A. `md5 -r` 裸形状：      `<32hex>  name.png`
#   B. markdown 表格形状：    `| \`name.png\` | \`<32hex>\` | 说明 |`
#
# 形状纪律：
#   - 一条都解析不到 = **探针坏**，不是"没有不一致" ⇒ exit 4（AGENTS §8.3：不能失败的判据比没有更糟）。
#   - 判绿只认退出码；报错同时走 stdout 与 stderr（§7 #45 那一族：`> out 2>/dev/null` 后空 stdout 与"干净"长得一样）。
#   - `--selftest` 是这条判据的**牙**：一次性副本上未变异腿必须 0 枚、注入腿必须**恰好 1 枚**。
#   - `--all` 打印**分母**（扫了几份 README、解析出几条），只印"✅ 一致"而不印分母的判据不算判据。
set -u

DEFAULT_DIRS="apps/web/evidence/calendar-view-options"
ALL_GLOB="apps/*/evidence/*/README.md"
SELFTEST=0
ALL=0
DIRS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --selftest) SELFTEST=1; shift ;;
    --all) ALL=1; shift ;;
    --dir) DIRS="${DIRS} ${2:-}"; shift 2 ;;
    *) echo "❌ 未知参数：$1（只认 --selftest / --all / --dir <证据目录>）" >&2; exit 1 ;;
  esac
done

# 对一份 README 逐条对账；stdout 打印 `OK <名>（<md5>）` 或 `MISMATCH <名>：…`
# 返回：0 全对 / 1 有不一致 / 4 这份里解析到 0 条
check_one_dir() {
  rd="$1"
  readme="$rd/README.md"
  if [ ! -f "$readme" ]; then
    echo "SKIP ${rd}（没有 README.md）"
    return 4
  fi
  entries=$(grep -E -e '^([0-9a-f]{32}  [^ ]+\.(png|jpg|jpeg|webp))$' \
                   -e '^\| `[^`]+\.(png|jpg|jpeg|webp)` \| `[0-9a-f]{32}`' "$readme" || true)
  n=$(printf '%s\n' "$entries" | grep -c . || true)
  if [ "$n" = "0" ]; then
    echo "EMPTY ${rd}（README 里解析到 0 条 md5 条目）"
    return 4
  fi
  bad=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in
      '|'*)
        # 表格形状：| `name.png` | `md5` | ...
        name=$(printf '%s' "$line" | sed -n 's/^| `\([^`]*\)` | `\([0-9a-f]\{32\}\)`.*/\1/p')
        want=$(printf '%s' "$line" | sed -n 's/^| `\([^`]*\)` | `\([0-9a-f]\{32\}\)`.*/\2/p')
        ;;
      *)
        want=${line%%  *}
        name=${line#*  }
        ;;
    esac
    if [ -z "$name" ] || [ -z "$want" ]; then
      echo "MISMATCH ${rd}：解析出一条但取不到文件名或指纹（探针没接上，不能据此判绿）"
      bad=$((bad + 1))
      continue
    fi
    p="$rd/$name"
    if [ ! -f "$p" ]; then
      echo "MISMATCH ${name}：README 记了它，盘上没有这个文件（${rd}）"
      bad=$((bad + 1))
      continue
    fi
    got=$(md5 -q "$p")
    if [ "$got" != "$want" ]; then
      echo "MISMATCH ${name}：README=${want} 盘上=${got} —— 记的与被记的不是同一份字节"
      bad=$((bad + 1))
    else
      echo "OK ${name}（${got}）"
    fi
  done <<EOF3
$entries
EOF3
  echo "DIRCHECK ${rd} entries=${n} mismatch=${bad}"
  [ "$bad" = "0" ] && return 0 || return 1
}

if [ "$SELFTEST" = "1" ]; then
  D=$(mktemp -d /tmp/ht-r17-md5.XXXXXX)
  trap 'rm -rf "$D"' EXIT
  mkdir -p "$D/tree"
  cp "$DEFAULT_DIRS/README.md" "$D/tree/README.md"
  for p in "$DEFAULT_DIRS"/*.png; do cp "$p" "$D/tree/"; done
  echo "== selftest 对照腿（未变异）=="
  check_one_dir "$D/tree" >"$D/ctrl.out" 2>&1
  CTRL_RC=$?
  CTRL_N=$(grep -c '^MISMATCH ' "$D/ctrl.out")
  echo "   ctrl rc=${CTRL_RC} MISMATCH行数=${CTRL_N}"
  if [ "$CTRL_RC" != "0" ] || [ "$CTRL_N" != "0" ]; then
    echo "❌ 对照腿坏了：未变异副本应当 rc=0 且零枚不一致（这是装置坏，不是判据红）" >&2
    sed 's/^/      /' "$D/ctrl.out" >&2
    exit 4
  fi
  victim=$(ls "$D/tree"/*.png | head -1)
  printf 'x' >> "$victim"
  echo "== selftest 变异腿（给 $(basename "$victim") 追加 1 字节）=="
  check_one_dir "$D/tree" >"$D/mut.out" 2>&1
  MUT_RC=$?
  MUT_N=$(grep -c '^MISMATCH ' "$D/mut.out")
  echo "   mut rc=${MUT_RC} MISMATCH行数=${MUT_N}"
  sed 's/^/      /' "$D/mut.out"
  if [ "$MUT_RC" = "0" ] || [ "$MUT_N" != "1" ]; then
    echo "❌ 变异腿没红（rc=${MUT_RC}，枚数=${MUT_N}，期望 rc!=0 且恰好 1 枚）⇒ 这条对账没有牙" >&2
    exit 1
  fi
  # 第三臂：表格形状也得解析得到（否则 --all 那一半是空的却看起来像"没有不一致"）
  T=$(mktemp -d /tmp/ht-r17-tbl.XXXXXX)
  mkdir -p "$T/apps/web/evidence/tableshape"
  printf '| `a.png` | `%s` | 说明 |\n' "$(printf 'A' | md5 -q)" > "$T/apps/web/evidence/tableshape/README.md"
  printf 'A' > "$T/apps/web/evidence/tableshape/a.png"
  echo "== selftest 表格形状臂 =="
  check_one_dir "$T/apps/web/evidence/tableshape" >"$T/tbl.out" 2>&1
  TBL_RC=$?
  TBL_N=$(grep -c '^DIRCHECK .*entries=1' "$T/tbl.out")
  echo "   tbl rc=${TBL_RC} entries=1 命中=${TBL_N}"
  sed 's/^/      /' "$T/tbl.out"
  if [ "$TBL_RC" != "0" ] || [ "$TBL_N" != "1" ]; then
    echo "❌ 表格形状臂坏了（rc=${TBL_RC}，entries=1 命中=${TBL_N}）⇒ --all 那一半没有牙" >&2
    rm -rf "$T"
    exit 1
  fi
  # 第四臂：表格形状也要**能红**（只证明解析到，不证明检测得到）
  printf 'B' >> "$T/apps/web/evidence/tableshape/a.png"
  check_one_dir "$T/apps/web/evidence/tableshape" >"$T/tbl2.out" 2>&1
  T2_RC=$?
  T2_N=$(grep -c '^MISMATCH ' "$T/tbl2.out")
  echo "   tbl2（表格形状注入腿）rc=${T2_RC} MISMATCH行数=${T2_N}"
  sed 's/^/      /' "$T/tbl2.out"
  rm -rf "$T"
  if [ "$T2_RC" = "0" ] || [ "$T2_N" != "1" ]; then
    echo "❌ 表格形状注入腿没红（rc=${T2_RC}，枚数=${T2_N}）⇒ 解析得到但检不出来" >&2
    exit 1
  fi
  echo "SELFTEST=OK（对照 0 枚 / 变异恰好 1 枚 / 表格形状解析到 1 条 / 表格形状注入腿恰好 1 枚）"
  exit 0
fi

TOTAL_BAD=0
TOTAL_DIRS=0
TOTAL_ENTRIES=0
if [ "$ALL" = "1" ]; then
  README_LIST=$(ls -d $ALL_GLOB 2>/dev/null || true)
  [ -n "$README_LIST" ] || { echo "❌ 前提不成立：glob ${ALL_GLOB} 一份 README 都没找到（cwd=$(PWD)）" >&2; exit 4; }
  for r in $README_LIST; do
    d=$(dirname "$r")
    TOTAL_DIRS=$((TOTAL_DIRS + 1))
    OUT=$(check_one_dir "$d"); RC=$?
    printf '%s\n' "$OUT"
    E=$(printf '%s\n' "$OUT" | sed -n 's/^DIRCHECK .* entries=\([0-9]*\) .*/\1/p')
    [ -n "$E" ] && TOTAL_ENTRIES=$((TOTAL_ENTRIES + E))
    if [ "$RC" = "1" ]; then TOTAL_BAD=$((TOTAL_BAD + 1)); fi
  done
  echo "ALLCHECK dirs_scanned=${TOTAL_DIRS} entries_parsed=${TOTAL_ENTRIES} dirs_with_mismatch=${TOTAL_BAD}"
  if [ "$TOTAL_ENTRIES" = "0" ]; then
    echo "❌ 前提不成立：${TOTAL_DIRS} 份 README 里解析到 0 条 md5 ⇒ 探针没接上，不能据此判绿" >&2
    exit 4
  fi
  [ "$TOTAL_BAD" = "0" ] && { echo "✅ ${TOTAL_ENTRIES} 条 md5 与盘上字节逐条相同（${TOTAL_DIRS} 份 README）"; exit 0; }
  echo "❌ ${TOTAL_BAD} 份 README 有 md5 与盘上字节不一致（要重取指纹，且「人看过的那张图」要重看）" >&2
  exit 1
fi

if [ -z "$DIRS" ]; then DIRS="$DEFAULT_DIRS"; fi
for d in $DIRS; do
  check_one_dir "$d" || TOTAL_BAD=$((TOTAL_BAD + 1))
done
if [ "$TOTAL_BAD" != "0" ]; then
  echo "❌ ${TOTAL_BAD} 个证据目录有 md5 不一致（README 要重取指纹，且「人看过的那张图」要重看）" >&2
  exit 1
fi
echo "✅ 证据 README 的 md5 与盘上字节逐条相同"
exit 0
