#!/usr/bin/env bash

# 🔴 HEYTA-SNAPSHOT-BOOTSTRAP v1（traps #110/#113）—— bash 对脚本是按字节偏移
#    增量读取的：运行中被编辑，后半段就从错位字节开始解析，炸出假语法错误。
#    入口先把整份脚本拷成同目录隐藏快照再 exec 副本 —— 之后对源文件的任何
#    编辑都影响不到本次运行；$0 的 dirname 不变，lib/tools 定位照旧。
#    快照名 .原名.snap.PID（进 .gitignore）；trap 尽力清理，被 kill -9 留下的
#    由下一次运行按 mmin +240 顺带扫掉。
case "$(basename "$0")" in
  .*.snap.*) ;; # 已是快照：正常往下跑
  *)
    _snap_dir="$(cd "$(dirname "$0")" && pwd)" || exit 1
    find "$_snap_dir" -maxdepth 1 -name ".$(basename "$0").snap.*" -mmin +240 -delete 2>/dev/null || true
    _snap="${_snap_dir}/.$(basename "$0").snap.$$"
    cat "$_snap_dir/$(basename "$0")" > "$_snap" || exit 1
    exec bash "$_snap" "$@"
    ;;
esac
trap 'rm -f -- "$0"' EXIT
# M1 垂直切片验证 —— 一条命令跑完，并**如实报告哪些没验**
# ========================================================
#
#   bash scripts/verify-universal-slice.sh
#
# ## 这个脚本存在的理由
#
# M1 要回答的是「一份 RN 组件，三端渲染在 heyta 的版本组合下真的成立吗」。
# 这个问题**只靠"构建不报错"回答不了** —— 本仓库反复吃过的亏就是
# "每一段都绿、接起来断"（见 `apps/web/src/App.tsx` 里那段用户旅程测试的注释）。
#
# 所以这里每一步都要留下**实测输出**，而不是一句"通过"。
#
# ## 🔴 关于"没验的"怎么处理
#
# 这个脚本**不会**把跑不了的东西静默跳过 —— 那是本仓库最忌讳的失效方式
# （门禁绿 ≠ 覆盖全）。跑不了的一律打印成 `⏭ 未验`，**并写明缺什么**，
# 且**不计入通过**。最后退出码只看真正跑过的那些。
#
# 一个只打印"✅ 全部通过"、却把鸿蒙/真机悄悄略过的脚本，
# 比没有这个脚本更危险：它会让 M3 的投入决策建立在一个假前提上。

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"

PASS=0
FAIL=0
SKIP=0

ok()   { printf '  ✅ %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL + 1)); }
skip() { printf '  ⏭  未验：%s\n' "$1"; printf '      原因：%s\n' "$2"; SKIP=$((SKIP + 1)); }

# 每一步都保留完整输出，失败时只回放尾部，成功时只报一行 ——
# 否则真正的报错会被淹在几百行日志里。
run() {
  local label="$1"; shift
  local log
  log="$(mktemp)"
  if "$@" >"$log" 2>&1; then
    ok "$label"
  else
    bad "$label"
    tail -20 "$log" | sed 's/^/       /'
  fi
  rm -f "$log"
}

printf '\n════ M1 垂直切片验证 ════\n'
printf '仓库：%s\n\n' "$ROOT"

# ── 1. 共享组件本身 ───────────────────────────────────────────────
printf '【1】共享组件 packages/ui\n'
run 'build（ESM + CJS + dts）' pnpm --filter @heyta/ui run build
run 'typecheck' pnpm --filter @heyta/ui run typecheck
run '单测（排序 / 空标题 / completedAt / dueDate 边界）' pnpm --filter @heyta/ui run test
printf '\n'

# ── 2. 三个守门门禁 ───────────────────────────────────────────────
printf '【2】门禁\n'
run 'check:design（共享组件的裸值会被四个端一起放大）' pnpm check:design
run 'check:layering（业务逻辑不许进 apps）' pnpm check:layering
# 🔴 这条是 M1 判据第 3 条：@heyta/i18n 曾自带 React，APK 启动即崩。
run 'check:mobile-bundle（无第二份 React）' pnpm check:mobile-bundle
printf '\n'

# ── 3. Web 端：构建 + **真实浏览器渲染** ──────────────────────────
printf '【3】Web 端（react-native-web）\n'
run 'build' pnpm --filter @heyta/web run build

# 构建通过只说明"能打包"，不说明"能渲染"。这里真的开一个浏览器去看。
SLICE_PORT=4173
if command -v node >/dev/null 2>&1 && [ -d e2e/node_modules/@playwright ]; then
  ( cd apps/web && exec ./node_modules/.bin/vite preview --port "$SLICE_PORT" --strictPort --host 127.0.0.1 ) >/tmp/slice-preview.log 2>&1 &
  PREVIEW_PID=$!
  # 轮询而不是 `sleep 5`：机器快时白等，机器慢时不够等。
  for _ in $(seq 1 40); do
    curl -s -o /dev/null "http://127.0.0.1:${SLICE_PORT}/?slice=1" && break
    sleep 0.25
  done

  check_log="$(mktemp)"
  if ( cd e2e && node "$ROOT/scripts/verify-universal-slice.browser.mjs" \
        "http://127.0.0.1:${SLICE_PORT}/?slice=1" ) >"$check_log" 2>&1; then
    ok '浏览器渲染（RNW 真的把组件画出来了）'
    sed 's/^/       /' "$check_log"
  else
    bad '浏览器渲染'
    tail -25 "$check_log" | sed 's/^/       /'
  fi
  rm -f "$check_log"
  kill "$PREVIEW_PID" 2>/dev/null || true
  wait "$PREVIEW_PID" 2>/dev/null || true
else
  skip '浏览器渲染' 'e2e/node_modules/@playwright 不存在（先跑 pnpm -C e2e install）'
fi
printf '\n'

# ── 3b. 桌面端：**同一份 web 产物**在 Electron 里画不画得出来（判据 4）──
#
# 🔴 这一段曾经是一条 `skip`，理由写的是"M2 的打包尚未接入" —— **那是陈旧的**。
# `e2e/tests/desktop-window.spec.ts` 早就在跑了（`pnpm check` 的 e2e 里含它 2 条），
# 而且"打包产物"那条是**从 `app.asar` 里**加载 `renderer-dist/index.html` 的，
# 正好就是判据 4 要的东西。把已验证的事说成"未验"会让人重复劳动，
# 也会让这份清单逐渐失去可信度 —— 所以改成**真的去跑**。
printf '【3b】桌面端（Electron 加载同一份 web 产物 —— 判据 4）\n'
if command -v node >/dev/null 2>&1 && [ -d e2e/node_modules/@playwright ]; then
  run '桌面端（开发构建）：真窗口打开且共享 UI 画出来了' \
    sh -c 'cd e2e && npx playwright test tests/desktop-window.spec.ts --grep "开发构建" --reporter=line'

  # 打包产物只在**对应平台**存在。macOS 上要有 `release/heyta-darwin-arm64`。
  case "$(uname -s)" in
    Darwin) packaged_dir='release/heyta-darwin-arm64' ;;
    Linux)  packaged_dir='release/heyta-linux-x64' ;;
    MINGW*|MSYS*|CYGWIN*) packaged_dir='release/heyta-win32-x64' ;;
    *)      packaged_dir='' ;;
  esac

  if [ -n "$packaged_dir" ] && [ -d "$packaged_dir" ]; then
    run '桌面端（打包产物）：从 app.asar 里加载同一份产物' \
      sh -c 'cd e2e && npx playwright test tests/desktop-window.spec.ts --grep "打包产物" --reporter=line'
  else
    skip '桌面端打包产物加载（判据 4 的"打包"那一半）' \
      "没有 $packaged_dir —— 先跑 node scripts/package-desktop.mjs"
  fi
else
  skip '桌面端渲染' 'e2e/node_modules/@playwright 不存在（先跑 pnpm -C e2e install）'
fi
printf '\n'

# ── 4. 没验的那些，如实说 ─────────────────────────────────────────
printf '【4】本机跑不了的判据\n'
skip 'iOS / Android 真机渲染' \
  '需要 Xcode 模拟器或 adb 设备；本脚本不假装检测器存在'
skip '鸿蒙（RNOH）渲染 + op-sqlite 打开/读/写' \
  '需要 DevEco Studio + RNOH 工具链与设备，当前环境没有'
printf '\n'

printf '════ 结果 ════\n'
printf '  通过 %d · 失败 %d · 未验 %d\n' "$PASS" "$FAIL" "$SKIP"
if [ "$SKIP" -gt 0 ]; then
  printf '\n  ⚠️ 未验 %d 项**不等于通过** —— M1 的完整判据（含鸿蒙存储读写）\n' "$SKIP"
  printf '     在它们跑完之前不能算达成，理由见 docs/plans/multi-platform-adaptation.md §M1。\n'
fi
printf '\n'

[ "$FAIL" -eq 0 ] || exit 1
exit 0
