#!/bin/bash
# macOS 原生壳的窗口取证：跑起来 → 自截屏 → 校验 → 落 evidence。
#
#   bash apps/desktop-macos/scripts/capture-window.sh [输出png]
#
# 默认输出 `apps/desktop-macos/evidence/window-first-run.png`。
#
# ── 取图方式：`SCScreenshotManager`（ScreenCaptureKit，窗口服务器合成结果）──
#
# 🔴 这段路是踩出来的。**三种"看起来更干净"的内进程渲染全部实测证伪**：
#
#   | 方式                     | 实测结果                                                        |
#   |--------------------------|-----------------------------------------------------------------|
#   | view.cacheDisplay        | 走 AppKit draw(_)；SwiftUI 文字走 CGDisplayList 私有路径拿不到   |
#   |                          | ⇒ 文字糊成横向色带（三次运行字节相同 = 确定性）                  |
#   | CALayer.render(in:)      | 走图层树也拿不到 CGDisplayList，且**左下原点** ⇒ 既糊又上下翻转   |
#   | ImageRenderer            | SwiftUI 官方快照，但**渲染不了 List / TextField / Toggle**        |
#   |                          | ⇒ 整片渲染成"禁止"占位符                                        |
#
# 前两种最坏的地方是**看起来很可信**：尺寸对、内容比例 ~96%、色阶 255，
# 空白检测完全通过 —— 只有人眼能发现字全是坏的。
#
# `CGWindowListCreateImage` 不重绘任何东西，它是**问窗口服务器要一份**，
# 所以文字/抗锯齿/深浅色都对，**被别的窗口遮挡也不影响**（同 `screencapture -l`）。
#
# ⚠️ 需要屏幕录制权限。脚本末尾会**独立复验**：把自截图与
# `screencapture -l<windowID>` 的结果比尺寸，两者都是 1800×1120 才算过。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SHELL_DIR="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$SHELL_DIR/../.." && pwd)"
OUT="${1:-$SHELL_DIR/evidence/window-first-run.png}"

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT" "$OUT.txt"

echo "=== 构建 ==="
cd "$SHELL_DIR"
swift build 2>&1 | grep -E "error:|Build complete" | awk '{print "  " $0}'

echo ""
# 🔴 **桥的默认值**（2026-09-30 补）：取证跑的通常是**裸 SwiftPM 可执行文件**，
#    它旁边没有 `native-bridge.js` ⇒ 存储宿主 `decide()` 会退化成 `.off`，
#    于是这份证据走的是**页侧兜底**那条路（`STORAGE=sqlite`），
#    而不是**产品真正走的**壳内 SQLite（`STORAGE=shell`）。
#    两者都能把界面画出来，所以"看起来一样"—— 但证据要说的是产品那条路。
#
#    ⚠️ 打包的 `Heyta.app` 不需要这个（桥在 `Contents/Resources` 里）。
#    ⚠️ 只在文件真的存在时才设：设一个不存在的路径会让 `decide()` 判成"找不到"，
#       症状与不设一模一样，却会让人以为"已经给过桥了"。
# 🔴 **共享 UI 产物目录的默认值**（2026-09-30 补，同一个理由）。
#    裸可执行文件旁边没有 `web-dist`，而 `ShellView` 只在
#    "env **或** app 包 `Contents/Resources/web-dist`"里找 ⇒ 不给就渲染**回退屏**
#    （"未找到共享 UI 产物目录"）。那份证据看起来是"窗口画出来了"，
#    其实画的**不是应用** —— 交接文档里记着这条真实缺陷（"门禁报通过、
#    而那张图显示的是回退屏"），根因就是这里少了一个 env。
if [ -z "${HEYTA_WEB_ROOT:-}" ]; then
  WEB_DEFAULT="$REPO/apps/web/dist"
  if [ -f "$WEB_DEFAULT/index.html" ]; then
    export HEYTA_WEB_ROOT="$WEB_DEFAULT"
    echo "  Web UI：${HEYTA_WEB_ROOT}（脚本内置默认）"
  else
    echo "  ⚠️ 共享 UI 产物不存在（${WEB_DEFAULT}）—— 这次截图会是**回退屏**，不是应用。"
    echo "     先执行：pnpm --filter @heyta/web build"
  fi
fi

if [ -z "${HEYTA_BRIDGE_BUNDLE:-}" ]; then
  BRIDGE_DEFAULT="$REPO/packages/app-host/bridge-bundle/native-bridge.js"
  if [ -f "$BRIDGE_DEFAULT" ]; then
    export HEYTA_BRIDGE_BUNDLE="$BRIDGE_DEFAULT"
    echo "  桥：${HEYTA_BRIDGE_BUNDLE}（脚本内置默认 ⇒ STORAGE 应为 shell）"
  else
    echo "  ⚠️ 桥不存在（${BRIDGE_DEFAULT}）—— 这次证据会走页侧兜底（STORAGE=sqlite）。"
    echo "     要跑产品那条路先执行：node packages/app-host/scripts/build-native-bridge.mjs"
  fi
fi

echo "=== 运行 + 自截屏 ==="
# 🔴 HEYTA_NO_FOCUS=1：取证启动**绝不抢用户前台**（AGENTS §6.2 规定二；
#    2026-09-29 产品负责人再次投诉后被做成壳级开关，与 Electron 壳同名同义）。
# 🔴 **对 `-3811` 重试一次**（2026-09-30 实测）。
#
# `ScreenCaptureKit` 会偶发：
#   SCStreamErrorDomain Code=-3811 "音频/视频捕捉失败，无法开始流播放"
# 它是**瞬时**的（紧接着重跑就过），而门禁的"环境 vs 真故障"启发式会把它判成**真故障**
# （因为 `launchctl managername` 是 Aqua）⇒ 门禁随机变红一次。
# 与其让下一个人反复重跑，这里对**这一条明确的瞬时错误**重试一次：
# 真实的失败（编译错、应用没起来、权限真没给）重试也照样失败，不会被掩盖。
for attempt in 1 2; do
  RUN_LOG="/tmp/heyta-mac-capture-run-$attempt.log"
  HEYTA_NO_FOCUS=1 HEYTA_SELF_CAPTURE="$OUT" \
    "$SHELL_DIR/.build/out/Products/Debug/HeytaMac" > "$RUN_LOG" 2>&1
  sed 's/^/  /' "$RUN_LOG"
  if [ -f "$OUT" ]; then break; fi
  if grep -q 'SCStreamErrorDomain Code=-3811' "$RUN_LOG" && [ "$attempt" = 1 ]; then
    echo "  ⚠️  ScreenCaptureKit -3811（已知瞬时错误）—— 停 3 秒重试一次"
    sleep 3
    continue
  fi
  break
done

if [ ! -f "$OUT" ]; then
  # 🔴 **把"取图基础设施坏了"与"应用/编译坏了"分开**（2026-09-30）：
  #    前者门禁应当**响亮跳过**（这条没被验过），后者才是真故障。
  #    实测的取图基础设施故障有两种，都发生在**应用之外**：
  #      · `SCStreamErrorDomain Code=-3811`（流起不来）
  #      · 截图失败（多半是没给屏幕录制权限）
  if grep -qE 'SCStreamErrorDomain Code=-3811|截图失败' "$RUN_LOG" 2>/dev/null; then
    echo "🔴 取图基础设施不可用（不是应用的问题）"
    exit 4
  fi
  echo "🔴 没产出截图"
  exit 1
fi

echo ""
echo "=== 校验（不能有 alpha、不能是空白）==="
cd "$REPO"
node - "$OUT" <<'JS'
import { inspectPng, looksBlank } from './scripts/screenshots/png-stats.mjs';
const st = inspectPng(process.argv[2]);
console.log(`  ${st.width}x${st.height}  colorType=${st.colorType}  hasAlpha=${st.hasAlpha}`);
console.log(`  内容比例 ${(st.contentRatio * 100).toFixed(1)}%   色阶差 ${st.colorSpan}`);
let bad = false;
if (st.hasTransparency) { console.error('  🔴 含实际透明像素'); bad = true; }
if (looksBlank(st)) { console.error('  🔴 疑似空白'); bad = true; }
if (bad) process.exit(1);
console.log('  ✅ 通过');
JS

echo ""
echo "=== 独立复验：与 screencapture -l 比尺寸 ==="
# 说明：自截图走的是同一个数据源，尺寸必然一致；若不一致，说明权限或窗口状态有问题。
# 🔴 必须先删旧图：下面的 screencapture 失败是被 `|| true` 吞掉的，
#    而"文件存在"就是参与比较的条件 —— 不删的话，本轮失败会拿**上一轮的旧图**
#    来比（2026-09-29 实测：上一轮窗口 1485×1014 的旧图让新窗口 1120×720 的
#    本轮被误判成"自截图不可信"）。
rm -f /tmp/heyta-mac-crosscheck.png
# 🔴 交叉验证的实例同样不抢前台（同上）。
#
# 🔴 **记下 PID + `trap` 收尾**（2026-09-30 实测改）。这一格原来长这样：
#
#     (nohup env HEYTA_NO_FOCUS=1 "…/HeytaMac" >/dev/null 2>&1 &)
#
# 一个**分离**的实例，收尾靠下面那句 `pkill -f HeytaMac`。那其实是**两条独立的
# 失败路径**，各自都会把人坑一次：
#
#   1. 本脚本是 `set -euo pipefail`，而交叉校验的 `node` 结尾是
#      `process.exit(sameLogical ? 0 : 1)` ⇒ **尺寸不一致时脚本当场死掉**，
#      下面那句 `pkill` **永远不会执行** ⇒ 那个分离实例**留在用户屏幕上**。
#      用户看到的是"这个应用起不来"（真症状见
#      `evidence/storage-host/storage-matrix-*.txt` 的四格矩阵），
#      而它其实是一个**取证实例** —— 产品负责人 2026-09-30 报的就是这一屏。
#   2. `pkill -f HeytaMac` 是**按名字杀**的：它会顺手杀掉**用户自己正在用的**
#      那个 HeytaMac。
#
# 改成"记 PID + `trap … EXIT`"：不管脚本从哪条路径退出（正常走完、`set -e`
# 半路死掉、Ctrl-C、门禁超时把 bash 杀掉），这个实例都会被收掉，
# 而且**只收自己起的那个**。
HEYTA_NO_FOCUS=1 "$SHELL_DIR/.build/out/Products/Debug/HeytaMac" >/dev/null 2>&1 &
CROSSCHECK_PID=$!
# ⚠️ `trap` 必须在 `CROSSCHECK_PID` 赋值**之后**注册 —— 否则 `set -u` 下
#    引用未定义变量，trap 自己会炸。
trap 'kill "$CROSSCHECK_PID" 2>/dev/null || true' EXIT
sleep 6

# 🔴 **注入**：在"分离实例已经起来、脚本还没走完"这一刻**故意让脚本死掉**。
#
# 它证明的是上面那段注释：脚本半路退出时，那个实例**必须**被收掉。
# 没有这个开关就没法验 —— 正常路径是绿的，而"绿的时候不留窗口"说明不了
# "红的时候也不留"。位置刻意选在**交叉校验之前**：本机 `swift window-id.swift`
# 取不到窗口 id（会走 else 分支跳过后面的 node），所以注入必须放在这之前才到得了。
#
# 用法：`HEYTA_CAPTURE_INJECT_FAIL_CROSSCHECK=1 bash scripts/capture-window.sh <out>`
# 期望：脚本非零退出，**且事后没有任何属于本次运行的 HeytaMac 留在进程表里**。
if [ "${HEYTA_CAPTURE_INJECT_FAIL_CROSSCHECK:-}" = "1" ]; then
  echo "  🔴 注入：在分离实例存活时让脚本死掉（证明收尾不依赖走完全程）"
  exit 1
fi

WID=$(cd "$HERE" && swift window-id.swift 2>/dev/null | head -1 | cut -f1 || true)
if [ -n "${WID:-}" ]; then
  screencapture -x -o -l"$WID" /tmp/heyta-mac-crosscheck.png 2>/dev/null || true
  if [ -f /tmp/heyta-mac-crosscheck.png ]; then
    node - "$OUT" /tmp/heyta-mac-crosscheck.png <<'JS'
import { inspectPng } from './scripts/screenshots/png-stats.mjs';
const a = inspectPng(process.argv[2]);
const b = inspectPng(process.argv[3]);
// 🔴 判等必须对 **1x/2x 缩放不敏感**（2026-09-29 实测 2240×1440 vs 1120×720）：
//    自截图按**自己窗口所在屏**的 scale 出像素（Retina 2x），screencapture -l
//    按**目标窗口实际落屏**的 scale 出 —— 两个实例可能落在不同屏
//    （本机有一块 1x 外接屏）。它们证明的是"同一个窗口"，不是"同一块屏"。
const sameLogical =
  (a.width === b.width && a.height === b.height) ||
  (a.width === b.width * 2 && a.height === b.height * 2) ||
  (b.width === a.width * 2 && b.height === a.height * 2);
console.log(`  自截图      ${a.width}x${a.height}`);
console.log(`  screencapture ${b.width}x${b.height}`);
console.log(
  sameLogical
    ? '  ✅ 尺寸一致（1x/2x 归一后；同一数据源的交叉验证）'
    : '  🔴 尺寸不一致 —— 自截图不可信',
);
process.exit(sameLogical ? 0 : 1);
JS
  fi
else
  echo "  ⚠️ 取不到窗口 ID，跳过交叉验证"
fi
# 🔴 正常路径显式收掉那个实例（`trap` 也会兜一次）——**按 PID，不按名字**。
kill "$CROSSCHECK_PID" 2>/dev/null || true
wait "$CROSSCHECK_PID" 2>/dev/null || true

echo ""
echo "=== 合成证据说明（避免两份漂移）==="
# 应用自己写的是 `.png.txt`（只有实测值）。这里把它和"怎么采的"合成一份
# `<名字>.txt`，一份文件讲清楚：命令、方式、踩过的坑、交叉验证结果。
NARRATIVE="${OUT%.png}.txt"

CROSSCHECK="skipped"
if [ -f /tmp/heyta-mac-crosscheck.png ]; then
  # 🔴 与上面的交叉验证同一把尺：1x/2x 归一后再判等（两实例可能落在不同屏）。
  CROSSCHECK=$(node -e "
    import('./scripts/screenshots/png-stats.mjs').then(m=>{
      const a = m.inspectPng(process.argv[1]);
      const b = m.inspectPng('/tmp/heyta-mac-crosscheck.png');
      const same = (a.width===b.width && a.height===b.height) ||
        (a.width===b.width*2 && a.height===b.height*2) ||
        (b.width===a.width*2 && b.height===a.height*2);
      process.stdout.write(same
        ? 'ok(' + a.width + 'x' + a.height + ')'
        : 'MISMATCH(' + a.width + 'x' + a.height + ' vs ' + b.width + 'x' + b.height + ')');
    });" "$OUT" 2>/dev/null || echo "error")
fi
{
  cat <<'HEADER'
# macOS 原生壳窗口取证记录
#
# 采集命令（可复现）：
#   bash apps/desktop-macos/scripts/capture-window.sh
#
# 采集方式：应用**自截屏**（HEYTA_SELF_CAPTURE=<png>），走
#           **SCScreenshotManager**（ScreenCaptureKit）取**窗口服务器合成结果**。
#
# 🔴 为什么不是"应用自己重绘一遍"—— 三条弯路，全部实测证伪：
#
#   1. view.cacheDisplay(in:to:)
#      走 AppKit 的 draw(_:) 路径。现代 SwiftUI 的文字走 **CGDisplayList**
#      私有渲染路径，拿不到 ⇒ **文字糊成横向色带**；而 NSButton / NSTextField
#      因为 AppKit 自绘所以清晰。三次运行字节完全相同（确定性，非时序）。
#      最坏的是它**看起来很可信**：尺寸对、内容比例 96%、色阶 255，
#      空白检测完全通过 —— 只有人眼能发现字全是坏的。
#
#   2. CALayer.render(in:)
#      走图层树同样拿不到 CGDisplayList，且是**左下原点** ⇒ 既糊又上下翻转。
#
#   3. ImageRenderer（SwiftUI 官方快照 API）
#      渲染不了 List / TextField / Toggle ⇒ 整片变成"禁止"占位符。
#
#   4. ⚠️ CGWindowListCreateImage
#      能拿到窗口服务器合成结果，与外部 `screencapture -l<windowID>` 同源 ——
#      但 **macOS 14 起已废弃**，所以它不再是本项目用的那条。
#      （保留在本表里是因为"试过什么"这件事本身有价值。）
#
#   5. ✅ SCScreenshotManager（ScreenCaptureKit）—— **现在用的就是这条**
#      同样问窗口服务器要一份，文字/抗锯齿/深浅色都对，
#      **被别的窗口遮挡也不影响**。它是 CGWindowListCreateImage 的官方替代。
#      ⚠️ 需要屏幕录制权限；且必须**轮询** `SCShareableContent` ——
#      刚启动的进程里窗口可能还没登记，查一次会报"找不到窗口"（已实测）。
#
# ⚠️ 需要屏幕录制权限。没有权限时窗口服务器只给一张桌面背景图，
#    应用会**显式判失败**（比对尺寸）—— 绝不写一张"看起来成功其实是空的"图。
#
# PNG 后处理：窗口截图必然带 alpha（圆角/投影），已按窗口自身外观
# （深色→黑底 / 浅色→白底）合成到**不透明**底上，便于查看与逐字节比对。
#
# 交叉验证（本脚本自动执行）：自截图与 `screencapture -l` 的尺寸必须一致。

HEADER
  cat "$OUT.txt"
  echo ""
  echo "CROSSCHECK=${CROSSCHECK:-skipped}"
} > "$NARRATIVE"
rm -f "$OUT.txt"

echo ""
echo "=== 产物 ==="
ls -la "$OUT" "$NARRATIVE" 2>/dev/null | awk '{print "  " $0}'
echo "  --- 证据说明 ---"
sed 's/^/  /' "$NARRATIVE" | tail -12
