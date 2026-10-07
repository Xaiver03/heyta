#!/usr/bin/env bash
# 工单 H9 第 3 刀的牙齿台：同步设置搬进 设置 → 同步 之后，那几条新判据会不会红。
#
# 规矩（AGENTS §8 第 3 条 / §7 元规则 2）：一道不能失败的判据没有价值。
# 每一臂只改**一处**，跑对应载体，然后核对"载体确实红了"——
# 红在别的臂上不算数（traps #355），而"没改动任何文件却报绿"更不算数（下面 NOT_APPLIED）。
#
# 七臂分两类：
#   U1..U4  纯 jsdom（`apps/web` 的 vitest）：改的是 store / App 的接线
#   E1..E3  真浏览器（`e2e/tests/shell-sync-rail.spec.ts`，vite dev 载体）
#
# 用法（仓库根或任意目录都行）：
#   bash research/tools/mutation-rigs/h9-sync-settings-arms.sh
# 只跑其中几臂：
#   bash research/tools/mutation-rigs/h9-sync-settings-arms.sh U1 E1
#
# 🔴 备份**从工作树自己拷一份**，不用 `git checkout --`：这几份文件此刻带着本单
#    尚未提交的改动，`git checkout` 会把它们退回 HEAD —— 那是拿变异台当删除键用。
# 🔴 恢复前先验一次"当前内容 == 这一臂打上去的那份"。不相等说明**别的会话在我跑期间
#    写了同一个文件**（共享检出），此时绝不覆盖式恢复 —— 那会把别人的工作抹掉，
#    而症状是"他改的东西凭空没了"。宁可留下一份脏文件并响亮报错。
# ⚠️ 每一臂的补丁体是**带引号的 heredoc**（`<<'PY'`）：不引号的话 bash 会在
#    补丁文本里展开 `$`，而那些 TS 片段里全是 `${...}` 与 `$1`。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

STORE='apps/web/src/features/sync/store.ts'
APP='apps/web/src/App.tsx'
PANEL='apps/web/src/features/sync/SyncSettingsPanel.tsx'
BAR='apps/web/src/features/sync/SyncBar.tsx'
SPEC='e2e/tests/shell-sync-rail.spec.ts'
FILES=( "$STORE" "$APP" "$PANEL" "$BAR" "$SPEC" )

digest() { shasum "$1" | cut -d' ' -f1; }

SNAP="$(mktemp -d)"
BASE_SUMS=()
MUT_SUMS=()
for f in "${FILES[@]}"; do
  cp "$f" "$SNAP/$(basename "$f")"
  BASE_SUMS+=( "$(digest "$f")" )
done
# 阳性对照：基线哈希取不到 ⇒ 整台什么都不证明（traps 里那台"永远 NOT_APPLIED"的台架）。
for s in "${BASE_SUMS[@]}"; do
  [ -n "$s" ] || { echo "SEED_HASH_MISSING（取不到基线哈希，这一趟没有读数）"; exit 1; }
done

restore() {
  local i=0
  for f in "${FILES[@]}"; do
    cp "$SNAP/$(basename "$f")" "$f"
    i=$((i + 1))
  done
}
trap 'restore; rm -rf "$SNAP"' EXIT

WANT="${*:-U1 U2 U3 U4 E1 E2 E3}"
FAILS=0

wanted() { case " $WANT " in *" $1 "*) return 0 ;; *) echo "ARM_$1=SKIPPED"; return 1 ;; esac; }

# 跑一臂：$1 名字，$2 载体（vitest|pw），$3 目标（vitest 文件参数 / playwright 用例路径）
run_arm() {
  # 🔴 一行 `local` 里不许引用同一行刚声明的变量：`local name="$1" log="/tmp/x-$name.log"`
  #    在 `set -u` 下直接以 "name: unbound variable" 退出（2026-10-06 实测：
  #    七臂一台都没跑，日志里只有这一行错 —— 而台架的退出码来自外层包装命令，
  #    通知上写的是 exit 0。**台架自己坏了的时候，它看起来像"跑完了"**）。
  local name carrier target log rc applied i
  name="$1"
  carrier="$2"
  target="$3"
  log="/tmp/h9-arms-$name.log"
  rc=0
  applied=0
  i=0

  for f in "${FILES[@]}"; do
    MUT_SUMS+=( "$(digest "$f")" )
    [ "$(digest "$f")" != "${BASE_SUMS[$i]}" ] && applied=1
    i=$((i + 1))
  done
  if [ "$applied" = "0" ]; then
    echo "ARM_$name=NOT_APPLIED（变异没改进任何文件 ⇒ 这一臂什么都不证明）"
    FAILS=$((FAILS + 1)); MUT_SUMS=(); return 0
  fi

  if [ "$carrier" = "vitest" ]; then
    NO_COLOR=1 pnpm --filter @heyta/web exec vitest run $target > "$log" 2>&1 || rc=$?
  else
    ( cd e2e && NO_COLOR=1 npx playwright test "$target" ) > "$log" 2>&1 || rc=$?
  fi

  # 恢复前的共享检出护栏：文件必须还是这一臂打上去的那份。
  i=0
  for f in "${FILES[@]}"; do
    if [ "$(digest "$f")" != "${MUT_SUMS[$i]}" ]; then
      echo "CONFLICT_$name：$f 在本臂运行期间被**别人**改过 ⇒ 不做覆盖式恢复，人工介入"
      trap - EXIT
      FAILS=$((FAILS + 1)); MUT_SUMS=(); return 0
    fi
    i=$((i + 1))
  done
  restore
  i=0
  for f in "${FILES[@]}"; do
    if [ "$(digest "$f")" != "${BASE_SUMS[$i]}" ]; then
      echo "ARM_$name=RESTORE_MISMATCH（恢复后哈希不等于基线：$f）"; FAILS=$((FAILS + 1))
    fi
    i=$((i + 1))
  done
  MUT_SUMS=()

  if [ "$rc" = "0" ]; then
    echo "ARM_$name=SURVIVED（变异后载体仍全绿 ⇒ 这条判据没有牙）"; FAILS=$((FAILS + 1))
  else
    echo "ARM_$name=KILLED rc=$rc 红行=$(grep -cE '✘|failed' "$log")（日志 $log）"
  fi
}

# ── U1：拿掉 `applyAuthToken` 里的草稿镜像
#        ⇒ 登录发生在面板挂载之后时框里是空的（2026-09-30 那条缺陷的形状）
if wanted U1; then
  restore
  python3 - "$STORE" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text()
old = "      syncDraft: { baseUrl, token, password: get().syncDraft.password },"
assert s.count(old) == 1, "U1 锚点没找到"
p.write_text(s.replace(old, "      // MUTATED U1: 登录不推进草稿"))
PY
  run_arm U1 vitest 'tests/sync-settings-prefill.spec.tsx'
fi

# ── U2：拿掉 `clearCredentials` 里的草稿镜像
#        ⇒ 登出之后框里还留着上一个账号的令牌，下一次保存会把它写回去
if wanted U2; then
  restore
  python3 - "$STORE" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text()
old = "      syncDraft: { baseUrl: get().baseUrl, token: '', password: '' },"
assert s.count(old) == 1, "U2 锚点没找到"
p.write_text(s.replace(old, "      // MUTATED U2: 登出不清草稿"))
PY
  run_arm U2 vitest 'tests/sync-settings-prefill.spec.tsx'
fi

# ── U3：拿掉落位 effect 里的聚焦
#        ⇒ "焦点也要一起给"退回成一句注释（这一格 2026-10-06 之前就是这状态）
if wanted U3; then
  restore
  python3 - "$APP" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text()
old = """    if (anchor.focus !== undefined) {
      (document.querySelector<HTMLElement>(anchor.focus) ?? undefined)?.focus();
    }"""
assert s.count(old) == 1, "U3 锚点没找到"
p.write_text(s.replace(old, "    // MUTATED U3: 只滚不给焦点"))
PY
  run_arm U3 vitest 'tests/settings-anchor-focus.spec.tsx'
fi

# ── U4：请求不"取到即清"
#        ⇒ 第二次点「改用你自己的服务器」没有反应（store 里恒真，effect 不再重跑）
if wanted U4; then
  restore
  python3 - "$APP" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text()
old = "    useSyncStore.getState().closeSettings();"
assert s.count(old) == 1, "U4 锚点没找到"
p.write_text(s.replace(old, "    // MUTATED U4: 请求留在 store 里"))
PY
  run_arm U4 vitest 'tests/settings-anchor-focus.spec.tsx'
fi

# ── E1：拿掉 S3 的 scrollIntoViewIfNeeded
#        ⇒ 那张"同步那一节"的截图拍的是浮层顶部（第一版就是这么拍坏的）
if wanted E1; then
  restore
  python3 - "$SPEC" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text()
old = "    await panel.scrollIntoViewIfNeeded();"
assert s.count(old) == 1, "E1 锚点没找到"
p.write_text(s.replace(old, "    // MUTATED E1: 不滚进视野"))
PY
  run_arm E1 pw 'tests/shell-sync-rail.spec.ts'
fi

# ── E2：拿掉那一节里的共享状态条
#        ⇒ "搬家的收尾是把旧的删了"（`check:ui-provider` 登记的消费者没了）
if wanted E2; then
  restore
  python3 - "$PANEL" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text()
old = """      <HeytaUiProvider>
        <SyncStatusBar
          status={sync.status}
          labels={{ status: (status) => describeSyncStatus(status, t) }}
          testID="sync-status-bar"
        />
      </HeytaUiProvider>"""
assert s.count(old) == 1, "E2 锚点没找到"
p.write_text(s.replace(old, "      {/* MUTATED E2: 状态条没搬过来 */}"))
PY
  run_arm E2 pw 'tests/shell-sync-rail.spec.ts'
fi

# ── E3：把 rail 那颗齿轮加回去
#        ⇒ 负责人第 2 条的歧义复活（"长得像全局设置"的那一枚又出现在 rail 上）
if wanted E3; then
  restore
  python3 - "$BAR" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text()
old = '        <span className="ht-rail__sync__status" role="status" aria-live="polite">'
assert s.count(old) == 1, "E3 锚点没找到"
gear = (
  '        <button type="button" className="ht-rail__tab" data-testid="sync-settings-entry"'
  ' onClick={() => sync.openSettings()}>{statusText}</button>\n' + old
)
p.write_text(s.replace(old, gear))
PY
  run_arm E3 pw 'tests/shell-sync-rail.spec.ts'
fi

echo "----"
# 🔴 收尾必须**在干净载体上再跑一次**：七臂各自恢复之后，"回到基线"只由哈希证明，
# 而哈希相等不等于载体能跑绿（第一版就是这么把一台坏台架读成"六臂全 KILLED"的）。
CLEAN_RC=0
NO_COLOR=1 pnpm --filter @heyta/web exec vitest run \
  tests/sync-settings-prefill.spec.tsx tests/settings-anchor-focus.spec.tsx \
  > /tmp/h9-arms-clean-unit.log 2>&1 || CLEAN_RC=$?
( cd e2e && NO_COLOR=1 npx playwright test tests/shell-sync-rail.spec.ts ) \
  > /tmp/h9-arms-clean-e2e.log 2>&1 || CLEAN_RC=$?
if [ "$CLEAN_RC" = "0" ]; then
  echo "BACK_TO_CLEAN=OK（干净载体：两份 jsdom + 一份真浏览器全绿）"
else
  echo "BACK_TO_CLEAN=FAIL rc=${CLEAN_RC}（恢复之后载体跑不绿 ⇒ 上面那些 KILLED 读数全部作废）"
  FAILS=$((FAILS + 1))
fi

if [ "$FAILS" = "0" ]; then
  echo "RESULT=OK（每一臂都被它声称的那条判据抓到，且恢复后哈希回到基线）"
else
  echo "RESULT=FAIL（$FAILS 格不成立，见上面 ARM_*/CONFLICT_* 行）"
fi
if [ "$FAILS" -gt 0 ]; then exit 1; fi
