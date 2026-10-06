#!/bin/bash
# macOS 原生壳打包：构建 → 组装 .app → Developer ID 签名 → 启动验证 → .dmg → 公证 → 装订。
#
#   bash apps/desktop-macos/scripts/package-app.sh [输出目录]
#
# 默认输出到 /tmp/heyta-macos-dist。
#
# ── 这条路能走到哪一步，取决于**证书**，脚本会自己判定并如实说明 ────────────
#
#   Developer ID Application  → 可以签名；**再加 ASC API key 就能公证**
#   只有 Apple Distribution   → 只能签"App Store 分发"，装不进普通 Mac
#   什么都没有                → 只能 ad-hoc（`-`），本机能跑，发出去会被 Gatekeeper 拦
#
# 🔴 「签名」和「公证」是两件事，不要混：
#   签名证明"这个包是谁发的"；公证是 Apple 又扫了一遍并给你一张票据。
#   只签名不公证，别人下载后仍会看到"来自身份不明的开发者"。
#   本脚本**两个都做**，且**分别报告**成功与否 —— 不许把"签了名"说成"能分发"。
#
# `HEYTA_SKIP_NOTARIZE=1` 只跳过第 ⑥ 步（默认不跳，行为逐字不变）。
#   它**不会**把红变成绿：第 ⑥ 步从不在判据里 —— `if xcrun notarytool … | tail -8 | awk`
#   判的是 `awk` 的退出码（AGENTS §7 第 179 条那个形状），失败分支只打印一句红就继续走完。
#   它去掉的是**没有上界的等待**：`--wait` 没有超时，2026-10-04 实测同一档被卡住 11h25m
#   （pid 98934，父链是另一条会话的 `reinstall-all`），而验证载体的排队被这一格占死。
#   ⇒ 跳过之后这一趟**不许**主张"包已通过公证"；那句只有不带这个变量的一趟能说。
#
# ── 为什么需要 entitlements ─────────────────────────────────────────────
#
# hardened runtime（公证的硬性前提）默认禁止 JIT 与可写可执行内存，
# 而 **JavaScriptCore 需要它们**。不给就会在启动时崩、且崩得没有线索。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SHELL_DIR="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$SHELL_DIR/../.." && pwd)"
OUT_DIR="${1:-/tmp/heyta-macos-dist}"
BUNDLE_ID="cloud.finlaw.heyta.desktop"
VERSION="1.0.0"
BUILD_NUM="1"

APP="$OUT_DIR/Heyta.app"
DMG="$OUT_DIR/Heyta-$VERSION.dmg"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# ── ① 构建 ──────────────────────────────────────────────────────────────
echo "=== ① 构建 release ==="
cd "$SHELL_DIR"
# 🔴 构建期同步设计系统生成物 —— `Sources/HeytaMac/Generated/HeytaTokens.swift` 是
#    **派生物且已 gitignore**，SwiftPM 只编译目标目录内的源码，所以缺了它就报
#    `cannot find 'HeytaTokens' in scope`。此前**只有门禁** `check-macos-shell.mjs` 调这条
#    同步，于是"跑过 pnpm check 的机器能打包、干净检出打不出包"（实测：隔离 worktree
#    从 HEAD 直接跑本脚本 ⇒ 构建失败）。打包路径必须自带这一步，不能依赖别人先跑过门禁。
bash "$SHELL_DIR/scripts/sync-tokens.sh" || { echo "🔴 同步设计系统生成物失败"; exit 1; }
swift build -c release --product HeytaMac 2>&1 | grep -E "error:|warning:|Build complete" | awk '{print "  " $0}'
BIN="$(swift build -c release --product HeytaMac --show-bin-path)/HeytaMac"
[ -x "$BIN" ] || { echo "🔴 找不到 release 可执行：$BIN"; exit 1; }
echo "  可执行：$BIN ($(stat -f%z "$BIN") 字节)"

# bridge bundle 必须在 .app 里，否则壳起来了但业务逻辑是空的
BUNDLE="$REPO/packages/app-host/bridge-bundle/native-bridge.js"
# 🔴 与上面 sync-tokens 同一族：`bridge-bundle/` 已 gitignore（根 `.gitignore:131`），
#    此前**只有三条壳门禁**会跑这个生成器，打包脚本只检查存在并"报一句让你自己去跑"。
#    于是干净检出上 `pnpm reinstall:all` 必然停在这里 —— 打包路径要自己把输入备齐，
#    复用的是同一个生成器（不另写一份），下面那条存在检查保留为**断言**。
node "$REPO/packages/app-host/scripts/build-native-bridge.mjs" || { echo "🔴 生成 bridge bundle 失败"; exit 1; }
[ -f "$BUNDLE" ] || { echo "🔴 生成器跑完了但产物不存在：${BUNDLE}"; exit 1; }

# 🔴 共享 UI 产物必须打进 .app 的 **Contents/Resources/web-dist/**
#    （HeytaMacApp.swift 的 webRoot 解析：环境变量优先，否则就是这里）。
#    2026-09-30 实测事故：此前**从来没打过**，装出来的 .app 永远渲染
#    "找不到共享 UI 产物"错误屏 —— 而打包自验的"非空白"判据拦不住错误屏
#    （它有标题有正文，contentRatio 99.6%），四轮截图统计全绿，
#    最后是产品负责人人眼看窗口才发现。
#    ⚠️ 也不能放 bundle 根（`Heyta.app/web-dist`）：code signing 只封 Contents/，
#    根下散目录让 codesign 报 "unsealed contents present in the bundle root"（实测）。
WEB_DIST="$REPO/apps/web/dist"
[ -f "$WEB_DIST/index.html" ] || { echo "🔴 缺少共享 UI 产物：$WEB_DIST/index.html（先 pnpm -r build）"; exit 1; }

# 🔴 **存在 ≠ 是当前源码打出来的**（2026-10-03 实测事故）。
#    产品负责人在装好的 .app 里看到日历"内容超出容器范围"，而当前源码同一尺寸同一状态
#    量出来是能放下的（真浏览器现量：脚注 y=697 < 视口 720）。差在哪：包里的 web-dist 是
#    **另一次构建** —— 4 个 chunk 哈希与本机 `apps/web/dist` 不同，且
#    `now-line` / `clock-` 两个标记在包里的 JS 里 **0 命中**（当前产物各 1 命中），
#    也就是那份产物**早于 R13/R14**：日历的工具栏还在卡片里（多占一行）、行更高，
#    于是当天那张卡被顶到窗口下沿之外。
#    🔴 关键是**已有判据全绿**：截图非空白 + 主蓝命中，量的是"有没有界面"，
#    回答不了"是不是这份源码的界面"（AGENTS §7 第 82 条的第四次露面）。
#    所以下面这条不是仪式：它比的是**产物的输入**，输入变新而产物没重建 = 拒绝打包。
#    ⚠️ 刻意**不**在这里顺手 `pnpm -r build`：打包脚本替别人重建共享 dist
#       会把并行会话的 WIP 打进产品包里（那是比"旧产物"更坏的结果）。它只拒绝，并给出命令。
WEB_STALE=""
for d in "$REPO/apps/web/src" "$REPO/apps/web/public" "$REPO/apps/web/index.html"; do
  [ -e "$d" ] || continue
  hit=$(find "$d" -type f -newer "$WEB_DIST/index.html" 2>/dev/null | head -6)
  [ -n "$hit" ] && WEB_STALE="$WEB_STALE$hit
"
done
for p in "$REPO"/packages/*/; do
  for d in "${p}src" "${p}dist"; do
    [ -d "$d" ] || continue
    hit=$(find "$d" -type f -newer "$WEB_DIST/index.html" 2>/dev/null | head -6)
    [ -n "$hit" ] && WEB_STALE="$WEB_STALE$hit
"
  done
done
if [ -n "$WEB_STALE" ]; then
  echo "🔴 共享 UI 产物比它的输入**旧** —— 打进 .app 的会是旧界面，而截图判据拦不住这件事。"
  printf '%s' "$WEB_STALE" | sed '/^$/d' | sed 's/^/     比产物新的输入: /'
  echo "   （每个目录最多列 6 条）闭合命令：pnpm -r build && pnpm --filter @heyta/web build"
  exit 1
fi
echo "  ✅ web-dist 新鲜度对账通过（不比 apps/web 与 packages/* 的任何输入旧）"

# ── ② 组装 .app ─────────────────────────────────────────────────────────
echo ""
echo "=== ② 组装 Heyta.app ==="
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/HeytaMac"
cp "$BUNDLE" "$APP/Contents/Resources/native-bridge.js"

# web-dist 进包（Contents/Resources —— 在签名**之前**，让 --deep 把它封进签名）。
cp -R "$WEB_DIST" "$APP/Contents/Resources/web-dist"
[ -f "$APP/Contents/Resources/web-dist/index.html" ]   && echo "  ✅ web-dist 已进包（$(du -sh "$APP/Contents/Resources/web-dist" | cut -f1)）"

# 🔴 应用图标（2026-09-30 安装包审查：装出来的 Dock 里是通用图标）。
#    源用 PWA 的 512 图标（apps/web/public/icons，与浏览器/各端同一份品牌素材），
#    按 Apple 的 iconset 尺寸表生成 .icns。必须在签名**之前** —— 图标也是被封的内容。
APP_ICON_SRC="$REPO/apps/web/public/icons/icon-512.png"
[ -f "$APP_ICON_SRC" ] || { echo "🔴 缺少图标源：$APP_ICON_SRC"; exit 1; }
ICONSET="$OUT_DIR/Heyta.iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
for spec in "16 icon_16x16" "32 icon_16x16@2x" "32 icon_32x32" "64 icon_32x32@2x" \
            "128 icon_128x128" "256 icon_128x128@2x" "256 icon_256x256" "512 icon_256x256@2x" \
            "512 icon_512x512" "1024 icon_512x512@2x"; do
  set -- $spec
  sips -z "$1" "$1" "$APP_ICON_SRC" --out "$ICONSET/$2.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Heyta.icns" \
  && rm -rf "$ICONSET" \
  && echo "  ✅ 应用图标已生成（Heyta.icns，$(stat -f%z "$APP/Contents/Resources/Heyta.icns") 字节）" \
  || { echo "🔴 iconutil 生成 .icns 失败"; exit 1; }

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Heyta</string>
  <key>CFBundleIconFile</key><string>Heyta</string>
  <key>CFBundleDisplayName</key><string>heyta</string>
  <key>CFBundleExecutable</key><string>HeytaMac</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${BUILD_NUM}</string>
  <!-- 🔴 桌面壳反向授权要用它（ADR-0039 §2.3）：系统浏览器登录完回跳 heyta://auth#token=…
       ⚠️ 这是壳**第一次**对外承诺一个 URL scheme —— 改它是破坏性变更，
       且必须与 apps/web/src/features/auth/desktop-handoff.ts 的 DESKTOP_CALLBACK_SCHEME 一致。 -->
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>${BUNDLE_ID}.auth</string>
      <key>CFBundleURLSchemes</key>
      <array><string>heyta</string></array>
    </dict>
  </array>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Xiaoli Creativity Culture Industry Development (beijing) Co., Ltd.</string>
</dict>
</plist>
PLIST

cat > "$OUT_DIR/entitlements.plist" <<'ENT'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- JavaScriptCore 需要；hardened runtime 默认禁止，不给会启动即崩 -->
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict>
</plist>
ENT

plutil -lint "$APP/Contents/Info.plist" >/dev/null && echo "  ✅ Info.plist 合法"

# ── ③ 签名（按证书可用性降级，并如实说明降到了哪一档）──────────────────
echo ""
echo "=== ③ 签名 ==="
DEV_ID="$(security find-identity -v -p codesigning 2>/dev/null | grep -o 'Developer ID Application: .*' | head -1 | sed 's/"$//' || true)"
SIGN_KIND=""
if [ -n "$DEV_ID" ]; then
  SIGN_KIND="developer-id"
  echo "  身份：$DEV_ID"
  codesign --force --deep --options runtime --timestamp \
    --entitlements "$OUT_DIR/entitlements.plist" \
    --sign "$DEV_ID" "$APP"
else
  SIGN_KIND="adhoc"
  echo "  ⚠️ 没有 Developer ID Application —— 降级为 **ad-hoc**（本机能跑，发出去会被 Gatekeeper 拦）"
  codesign --force --deep --options runtime \
    --entitlements "$OUT_DIR/entitlements.plist" \
    --sign - "$APP"
fi

codesign --verify --deep --strict --verbose=1 "$APP" 2>&1 | tail -2 | awk '{print "  " $0}'
echo "  --- 展开确认 ---"
codesign -dvvv "$APP" 2>&1 | grep -E "Identifier|Authority|TeamIdentifier|flags" | awk '{print "  " $0}'

# ── ④ 启动验证：打好的 .app 真的能起来并渲染吗 ──────────────────────────
echo ""
echo "=== ④ 启动验证（.app 里那一个，不是 .build 里那个）==="
SELFIE="$OUT_DIR/packaged-first-run.png"
# 🔴 §6.2 规定二：任何会开窗口的验证都必须**不抢前台**。macOS 上光靠"后台启动"不够 ——
#    窗口只要可聚焦就会被激活，所以壳认 `HEYTA_NO_FOCUS=1`（`reinstall-all.sh` 的启动段
#    早就带了，这一行漏了；G4 那轮实测过带着它照样能取自截屏）。
if HEYTA_NO_FOCUS=1 HEYTA_SELF_CAPTURE="$SELFIE" "$APP/Contents/MacOS/HeytaMac" 2>&1 | awk '{print "  " $0}'; then
  :
fi
[ -f "$SELFIE" ] || { echo "  🔴 打包后的 .app 没能自截屏 —— 它跑不起来或渲染失败"; exit 1; }

cd "$REPO"
node - "$SELFIE" "$SELFIE.webview.png" <<'JS'
import { existsSync } from 'node:fs';
import { inspectPng, looksBlank, looksSmeared, countBrandBlue } from './scripts/screenshots/png-stats.mjs';
const st = inspectPng(process.argv[2]);
console.log(`  窗口截图 ${st.width}x${st.height}  内容 ${(st.contentRatio * 100).toFixed(1)}%  色阶 ${st.colorSpan}  边缘 ${st.edgeOnContent.toFixed(3)}`);
let bad = false;
if (st.hasTransparency) { console.error('  🔴 含实际透明像素'); bad = true; }
// 🔴 内容判据的**载体**：2026-10-03 实测这条压在窗口截图上会双向出错 ——
//    窗口图 13 KB / 内容 0.0% 判"疑似空白"，而同一秒的 WebView 快照是完整真界面
//    （主蓝 1269，人眼看过）；反向是 09-30 的 205/206/272 KB 窗口图内容 ~100%
//    却主蓝 4/17/0 —— 放行的是壳自己的暗底 + 一行诊断字。
//    ⇒ "画没画出来"只压在 WebView 快照上；窗口图只证"有一个真窗口"。
//    没有快照时才退回窗口图当内容载体（那时它是唯一证据）。
const brandShot = existsSync(process.argv[3]) ? process.argv[3] : process.argv[2];
const cs = brandShot === process.argv[2] ? st : inspectPng(brandShot);
console.log(`  内容载体 ${brandShot.split('/').pop()}  内容 ${(cs.contentRatio * 100).toFixed(1)}%  色阶 ${cs.colorSpan}`);
if (looksBlank(cs)) { console.error('  🔴 疑似空白'); bad = true; }
if (cs !== st && looksBlank(st)) console.log('  ⚠️ 窗口截图本身是空的 —— 本机常态：WebView 内容没合成进窗口，不据此判红');
if (looksSmeared(cs)) console.error('  ⚠️ 启发式提示疑似渲染坏了 —— 请人眼看一眼');
// 🔴 UI 特征判据（2026-09-30）：错误屏"非空白"（contentRatio 99.6%），只有
//    "界面里数得出主蓝"才分得清是真 UI 还是"找不到共享 UI 产物"那张错误屏。
//    ⚠️ 必须两套主题都数：应用外观跟随系统，深色下 `--ht-color-primary` 是
//    `#60A5FA` 而不是 `#2563EB`，只数浅色的会把**真界面判成红的**（同日实测）。
const blue = countBrandBlue(brandShot);
console.log(`  主蓝采样命中 ${blue}（数的是 ${brandShot.split('/').pop()}）`);
if (blue < 20) { console.error('  🔴 截图里没有 heyta 主蓝 —— 这是错误屏/别的界面，不是共享 UI'); bad = true; }
// 🔴 2026-10-05：同一枚洞在这条腿上的第二份（第一份修在 `scripts/reinstall-all.sh` 的 `shot_ok`，
//    两处判据必须一起走，否则"打包自验"与"装机复验"会给出相反的答案）。
//    首屏**品牌帧**那块底板本身就是主蓝 `#2563EB`，实测命中 **2000**（真界面 1127）——
//    "主蓝 ≥ 20"不但拦不住它，还给它打更高分数；它此前只靠 `looksBlank` 的 0.01 擦边压住
//    （品牌帧实测 contentRatio **0.00943**，余量 5.7%，而画幅/DPR/MARK_SIZE/采样步长任一变动即翻）。
//    ⇒ 下界 **0.05** = 最低真图实测 0.1034 的一半（对品牌帧 5.3 倍、对最低真图 2 倍）。
if (cs.contentRatio < 0.05) {
  console.error(`  🔴 内容占比 ${(cs.contentRatio * 100).toFixed(1)}% < 5% —— 主蓝再多也不算数：` +
    `**首屏品牌帧**就是一块主蓝底板压在近白底上（实测命中 2000、占比 0.9%），那是遮罩还没从 DOM 摘掉的一帧`);
  bad = true;
}
if (bad) process.exit(1);
console.log('  ✅ 打包后的 .app 能起来、界面有真实内容（且确实是共享 UI）');
JS

# ── ⑤ .dmg ──────────────────────────────────────────────────────────────
echo ""
echo "=== ⑤ 生成 .dmg ==="
hdiutil create -volname "heyta" -srcfolder "$APP" -ov -format UDZO "$DMG" 2>&1 | tail -2 | awk '{print "  " $0}'
if [ "$SIGN_KIND" = "developer-id" ]; then
  codesign --force --timestamp --sign "$DEV_ID" "$DMG"
  echo "  ✅ .dmg 也已签名"
fi
echo "  $(basename "$DMG")  $(stat -f%z "$DMG") 字节"

# ── ⑥ 公证（只有 Developer ID + ASC key 才可能成功）────────────────────
echo ""
echo "=== ⑥ 公证 ==="
KEY_FILE=""
for candidate in \
  "$HOME/Library/Private/AppStoreConnect/AuthKey_T2H876K8MJ.p8" \
  "$HOME/Desktop/AuthKey_T2H876K8MJ.p8" \
  "$HOME/.appstoreconnect/private_keys/AuthKey_T2H876K8MJ.p8"
do
  [ -f "$candidate" ] && KEY_FILE="$candidate" && break
done
KEY_ID="T2H876K8MJ"
ISSUER="627afa93-122d-4739-a780-0ad593aee505"

if [ "${HEYTA_SKIP_NOTARIZE:-}" = "1" ]; then
  echo "  ⏭ 显式跳过（HEYTA_SKIP_NOTARIZE=1）。这一趟的判据是「装出来的包里有这一屏」（第 ④ 步已经量过），"
  echo "     公证不是它的组成部分 ⇒ 本趟**不主张**「这个包已通过公证」，那句要等不带这个变量的一趟。"
elif [ "$SIGN_KIND" != "developer-id" ]; then
  echo "  ⏭ 跳过：不是 Developer ID 签名，公证必然被拒"
elif [ -z "$KEY_FILE" ]; then
  echo "  ⏭ 跳过：找不到 ASC API key（试过 ~/Library/Private/AppStoreConnect、~/Desktop、~/.appstoreconnect/private_keys）"
else
  echo "  用 key：$(basename "$KEY_FILE")（内容不打印）"
  # 🔴 `--wait` 原来**没有上限**：Apple 侧不回话时整段永久挂住。2026-10-04 05:1x 实测另一条会话的
  #    `reinstall:all` 卡在这一行 1h57m：进程累计 CPU 0:00.03、**一条 TCP 连接都没有**
  #    （即它连"正在重试"都不是，就是在等一个不会来的东西），而它同时是"有别人在重装"那道互斥门的
  #    持有者 ⇒ 一个外部调用把并行会话的固定收尾一起钉死了。上限走 `HEYTA_NOTARY_TIMEOUT`
  #    （默认 900s；设 `0` = 显式要旧行为"不设限"）。**超时不等于通过**：走 🔴 那一支，不装订票据。
  NOTARY_TIMEOUT="${HEYTA_NOTARY_TIMEOUT:-900}"
  TIMEOUT_BIN=""
  for t in timeout gtimeout; do
    command -v "$t" >/dev/null 2>&1 && { TIMEOUT_BIN="$t"; break; }
  done
  NOTARY_LOG="$(mktemp)"
  # 🔴 裸 macOS **不带** timeout（它属于 GNU coreutils / homebrew），所以"没有 timeout"是
  #    打包机的默认情况而不是边角；那种时候退化成"不设限"就等于没修。这里用纯 bash 看门狗兜底。
  run_bounded() {
    local limit="$1"; shift
    if [ "$TIMEOUT_BIN" != "" ]; then
      "$TIMEOUT_BIN" "$limit" "$@"
      return $?
    fi
    "$@" &
    local pid=$! waited=0
    while kill -0 "$pid" 2>/dev/null; do
      if [ "$waited" -ge "$limit" ]; then
        kill -TERM "$pid" 2>/dev/null; sleep 2; kill -KILL "$pid" 2>/dev/null
        wait "$pid" 2>/dev/null
        return 124
      fi
      sleep 2; waited=$((waited + 2))
    done
    wait "$pid" 2>/dev/null
  }
  notary_rc=0
  if [ "$NOTARY_TIMEOUT" != "0" ]; then
    run_bounded "$NOTARY_TIMEOUT" xcrun notarytool submit "$DMG" --key "$KEY_FILE" --key-id "$KEY_ID" --issuer "$ISSUER" --wait >"$NOTARY_LOG" 2>&1 || notary_rc=$?
  else
    echo "  ⚠️ HEYTA_NOTARY_TIMEOUT=0 ⇒ 显式要求不设限（旧行为）"
    xcrun notarytool submit "$DMG" --key "$KEY_FILE" --key-id "$KEY_ID" --issuer "$ISSUER" --wait >"$NOTARY_LOG" 2>&1 || notary_rc=$?
  fi
  tail -8 "$NOTARY_LOG" | awk '{print "  " $0}'
  rm -f "$NOTARY_LOG"
  # ⚠️ 输出走临时文件而不是管道：`set -o pipefail` 下管道能保住退出码，但**区分不了**
  #    "Apple 拒绝"与"到点没回话"（124），而这两种要说的话不一样。
  if [ "$notary_rc" -eq 0 ]; then
    echo "  ✅ 公证通过，开始装订票据"
    xcrun stapler staple "$DMG" 2>&1 | tail -2 | awk '{print "  " $0}'
    xcrun stapler validate "$DMG" 2>&1 | tail -2 | awk '{print "  " $0}'
  elif [ "$notary_rc" -eq 124 ]; then
    echo "  🔴 公证在 ${NOTARY_TIMEOUT}s 内没有返回（Apple 侧未回话）。包本身已签名可用，但**没通过公证**，不装订票据。"
  else
    echo "  🔴 公证失败（上面的输出是 Apple 的原话，rc=$notary_rc）。包本身已签名可用，但**没通过公证**。"
  fi
fi

echo ""
echo "=== 产物 ==="
ls -la "$OUT_DIR" | awk '{print "  " $0}'
echo ""
echo "  签名档位：$SIGN_KIND"
