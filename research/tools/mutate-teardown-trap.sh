#!/bin/bash
# scripts/verify-selfhost-stack.sh 那条 EXIT-trap 拆栈的**自检夹具**（不是门禁，不进 pnpm check）。
# 它量的是控制流：把真文件里的 cleanup() 与 down_stack() **函数体抽出来**（不手抄第二份），
# 用只记参数的 compose() 桩跑五臂。审计读数在 docs/research/self-host-distribution-audit.md §8.63。
#
# 跑法：bash research/tools/mutate-teardown-trap.sh        # 对照 + 两枚变异，全过才 exit 0
# 成本：< 1 秒，不碰 docker、不起容器、不联网。
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${SRC:-$REPO_ROOT/scripts/verify-selfhost-stack.sh}"
CALLS="$(mktemp /tmp/teardown-calls.XXXXXX)"
TMPD="$(mktemp -d)"
# ⚠️ 这里必须写 `command rm`：下面 stubs() 会遮蔽 `rm`（为了挡掉真 cleanup 的 `rm -f -- "$0"`），
#    而遮蔽版不带 `-r` —— 用普通 `rm -rf` 收尾会留下一堆临时目录（第一版就是这样，跑完不报错但没清干净）。
trap 'command rm -f -- "$CALLS"; command rm -rf -- "$TMPD"' EXIT

[ -s "$SRC" ] || { echo "SRC_MISSING: $SRC"; exit 1; }

extract() { awk -v pfx="$1" 'index($0,pfx)==1{f=1} f{print} f&&$0=="}"{exit}' "$SRC"; }
CLEANUP_SRC="$(extract 'cleanup() {')"
DOWNSTACK_SRC="$(extract 'down_stack() {')"
[ -n "$CLEANUP_SRC" ] || { echo "EXTRACT_FAILED: cleanup() —— 形状变了，先更新本夹具"; exit 1; }
[ -n "$DOWNSTACK_SRC" ] || { echo "EXTRACT_FAILED: down_stack() —— 形状变了，先更新本夹具"; exit 1; }

fail() { echo "ARM_BAD: $*"; exit 1; }

# 桩：compose() 只把参数与"那一刻 env 还在不在"记进文件。
# ⚠️ 桩收到的就是 `compose down …` 那几个参数，所以行首是 `COMPOSE down` 而不是 `COMPOSE -p … down`
#    （真脚本里才是 compose() 自己加 -p/--env-file）。第一版按 `-p` 的形状写 grep，三条臂一起报
#    "却没拆栈" —— 那是探针坏了，不是修法坏了。
stubs() {
  PROJECT=harness
  COMPOSE_FILES=(-f a.yml)
  log() { printf '%s\n' "$*" >> "$CALLS"; }
  # cleanup() 第一行是 `rm -f -- "$0"`（真脚本的自快照清理）；夹具里必须跳过等于 $0 的那个参数，
  # 否则它把这份夹具自己删了，后面的臂就在被删掉的脚本里继续跑。
  rm() {
    local a
    for a in "$@"; do
      [ "$a" = "$0" ] && continue
      { [ "$a" = "-f" ] || [ "$a" = "--" ]; } && continue
      command rm -f -- "$a"
    done
  }
  compose() {
    local exists=no
    [ -f "$ENV_FILE" ] && exists=yes
    printf 'COMPOSE %s env_exists=%s\n' "$*" "$exists" >> "$CALLS"
  }
}

reset_env() {
  : > "$CALLS"
  ENV_FILE="$(mktemp "$TMPD/env.XXXXXX")"
  KEEP="$1"
  STACK_UP="$2"
  stubs
  if [ "$3" = "yes" ]; then eval "$DOWNSTACK_SRC"; else unset -f down_stack 2>/dev/null || true; fi
  eval "$CLEANUP_SRC"
}

control() {
  # A) 栈起来了 + 没 --keep ⇒ 必须拆栈，且拆的那一刻 env 还在
  reset_env 0 1 yes; cleanup
  grep -q '^COMPOSE down' "$CALLS" || fail "A: STACK_UP=1 却没拆栈"
  grep -q 'env_exists=yes' "$CALLS" || fail "A: 拆栈那一刻 env 已经不在了（顺序反了）"
  [ ! -f "$ENV_FILE" ] || fail "A: env 文件没删"

  # B) 栈没起来 ⇒ 一条 compose 都不许调（否则会去动别人的同名资源）
  reset_env 0 0 yes; cleanup
  grep -q '^COMPOSE ' "$CALLS" && fail "B: STACK_UP=0 却调了 compose"
  [ ! -f "$ENV_FILE" ] || fail "B: env 文件没删"

  # C) --keep ⇒ 不拆栈也不删 env（那条手工拆栈命令要能用）
  reset_env 1 1 yes; cleanup
  grep -q '^COMPOSE down' "$CALLS" && fail "C: --keep 却拆了栈"
  [ -f "$ENV_FILE" ] || fail "C: --keep 却删了 env"

  # D) die 发生在 down_stack 定义之前 ⇒ 不 127、且 env 删除没被一起吞掉
  reset_env 0 1 no; cleanup
  grep -q '^COMPOSE ' "$CALLS" && fail "D: 函数还没定义却调了"
  [ ! -f "$ENV_FILE" ] || fail "D: 未定义那条路把 env 删除也一起吞了"

  # E) 正常结束那条路：先显式 down_stack，再由 EXIT trap 走 cleanup ⇒ 只许拆一遍
  reset_env 0 1 yes; down_stack; cleanup
  [ "$(grep -c '^COMPOSE down' "$CALLS")" = 1 ] || fail "E: 正常结束那条路拆了 $(grep -c '^COMPOSE down' "$CALLS") 遍（应当 1）"
  echo "CONTROL_OK 五臂（A 拆栈+顺序 / B 不拆 / C --keep / D 未定义不崩 / E 只拆一遍）"
}

# 两枚变异：各红在它该红的那一臂（"摘掉修复却全绿"的夹具没有牙）。
mutations() {
  python3 - "$SRC" "$TMPD" <<'PY'
import sys, os
src, out = sys.argv[1], sys.argv[2]
t = open(src, encoding='utf-8').read()
trap_block = '''  if [ "$STACK_UP" = "1" ] && declare -F down_stack >/dev/null; then
    down_stack
  fi
'''
reset_line = "  STACK_UP=0\n"
assert trap_block in t, 'M1 的靶子不在文件里'
assert t.count(reset_line) >= 1, 'M2 的靶子不在文件里'
open(os.path.join(out, 'no-trap.sh'), 'w', encoding='utf-8').write(t.replace(trap_block, ''))
lines = t.split('\n')
for i, l in enumerate(lines):
    if l == reset_line.rstrip('\n') and i > 0 and 'down_stack()' in '\n'.join(lines[max(0, i - 8):i]):
        del lines[i]
        break
else:
    raise SystemExit('M2 定位失败：找不到 down_stack 里那行 STACK_UP=0')
open(os.path.join(out, 'no-reset.sh'), 'w', encoding='utf-8').write('\n'.join(lines))
PY
  [ -f "$TMPD/no-trap.sh" ] || { echo "MUTATION_WRITE_FAILED"; exit 1; }

  local out
  out="$(SRC="$TMPD/no-trap.sh" bash "$0" --control 2>&1)"
  printf '%s\n' "$out" | grep -q 'ARM_BAD: A' || fail "M1（摘掉 trap 里那三行）应当红在 A，实际：$(printf '%s' "$out" | tail -1)"
  echo "M1_OK 红在 A（trap 不拆栈）"

  out="$(SRC="$TMPD/no-reset.sh" bash "$0" --control 2>&1)"
  printf '%s\n' "$out" | grep -q 'ARM_BAD: E' || fail "M2（摘掉 down_stack 末尾的 STACK_UP=0）应当红在 E，实际：$(printf '%s' "$out" | tail -1)"
  echo "M2_OK 红在 E（拆了两遍）"
}

case "${1:-all}" in
  --control) control ;;
  --mutations) mutations ;;
  all) control; mutations ;;
  *) echo "用法：$0 [--control|--mutations]"; exit 2 ;;
esac
