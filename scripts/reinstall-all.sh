#!/bin/bash

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
#
# 固定收尾流程：**清旧包 → 重打 → 四端重装**，每端给出响亮判据。
# =====================================================================
#
#   bash scripts/reinstall-all.sh                    # 四端全跑（默认）
#   bash scripts/reinstall-all.sh --only mac,android # 只跑指定端（显式，汇总里仍列出跳过的）
#   bash scripts/reinstall-all.sh --skip ios         # 跳过指定端（必须显式，不允许静默）
#
# 🔴 为什么要有这个脚本（产品负责人 2026-09-30 拍板，纳入固定流程）：
#
#   heyta 是多端应用，**"完成一轮"的定义必须包含"四个端都装上了当前源码的产物"**，
#   而不是"测试绿了"。本仓已经两次付出过同一笔学费：
#   · AGENTS §7 第 27 条 —— packages/ 改了，APK 里打的还是旧 JS bundle，
#     验收对着旧代码报绿；
#   · verify-mobile-ios.sh 文件头 —— 脚本只验不装，跑的是"上一次打的包"，
#     36 项结论全是旧二进制的。
#   "测试全绿 ≠ 这是当前产物"。所以每轮收尾必须：清掉现有安装包 → 从当前源码
#   重新打包 → 四端重装 → 每端一个"装上的是当前产物且能起来"的判据。
#
# 四端与它们的既有管线（本脚本只编排，不重写任何一端的打包逻辑）：
#
#   | 端 | 打包 | 安装 | 判据 |
#   |----|------|------|------|
#   | mac     | apps/desktop-macos/scripts/package-app.sh（.app+.dmg+自截屏） | 卸旧 → 拷进 /Applications → **安装副本**启动自截屏 | 自截屏非空白 |
#   | windows | apps/desktop-windows/scripts/package-msix.sh（远端主机，含装） | 脚本内置：Remove-AppxPackage → Add-AppxPackage（交互会话） | install-capture.txt 里 ADD_APPX=OK 且 RESULT=OK |
#   | android | pnpm build:android（release APK） | adb uninstall → adb install（模拟器） | 安装输出 Success + 启动截图非空白 |
#   | ios     | xcodebuild Release（iphonesimulator） | simctl uninstall → simctl install（已启动模拟器） | **新鲜度**：已装 main.jsbundle 比源码新 + 截图非空白 |
#
# ⚠️ 任一端失败 ⇒ 整体退出 1。**没有静默跳过**：显式 --skip 的端会在汇总里
#    大字列出 —— "这轮没装 Windows"必须是一眼能看到的事实，不是脚本的默认。
#
# ⚠️ 本仓库一律按 **bash 3.2**（macOS 自带）写：不用 `declare -A`、不用
#    `command -v -a`（AGENTS §7 第 40 条同源：bash 3.2 没有那些能力）。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 🔴 封装运行时里 PATH 最前面的 `pnpm` 可能是不能独立 spawn 的私有垫片
#    （AGENTS §7 第 35 条同源）。按候选列表解析真的能跑的那个。
resolve_pnpm() {
  local candidate
  for candidate in \
    "${NODE_BIN_DIR:-}" \
    "$HOME/.nvm/versions/node/v22.22.3/bin" \
    /opt/homebrew/bin \
    /usr/local/bin
  do
    [ -n "$candidate" ] || continue
    if [ -x "$candidate/pnpm" ]; then echo "$candidate/pnpm"; return 0; fi
  done
  # PATH 兜底：跳过 DSH 私有垫片目录里的
  local p
  while IFS= read -r p; do
    case "$p" in *"DSH Desktop"*|*runtime-commands*) continue ;; esac
    [ -x "$p" ] && { echo "$p"; return 0; }
  done <<EOF
$(which -a pnpm 2>/dev/null)
EOF
  return 1
}

PNPM="$(resolve_pnpm)"
[ -n "$PNPM" ] || { echo "🔴 解析不到可用的 pnpm —— 打不了包"; exit 1; }

# ── 截图判据：非空白 + **数得出 heyta 主蓝**（复用零依赖的 png-stats）────────
# 🔴 2026-09-30 实测："非空白"挡不住错误屏 —— macOS 安装包没打 web-dist 时，
#    装出来的 .app 永远渲染"找不到共享 UI 产物"，而错误屏有标题有正文
#    （contentRatio 99.6%），四轮截图统计全绿，最后是人眼看窗口才发现。
#    真正的 UI 特征：heyta 界面必带主蓝（rail 激活项/主按钮/链接），
#    错误屏、空白屏、桌面底色都没有。判据 = 非空白 且 主蓝采样命中 ≥ 20。
# 🔴 2026-09-30 第二轮实测：主蓝**只数浅色的 `#2563EB` 会把正确的安装判成红的**。
#    mac 段启动前清掉壳的 WebKit 存储（全新安装的一部分），应用回落到**系统外观**，
#    这台机器晚上是深色 ⇒ `[data-theme='dark']` 的主蓝是 `--ht-blue-400` `#60A5FA`，
#    截图里人眼看着就是真共享 UI，而旧判据命中 0 ⇒ 🔴。
#    所以走 `countBrandBlue`（两套主题相加）：错误屏两个值都是 0，阈值 20 不变。
# 🔴 第三轮实测：**数的是哪张图**同样是判据缺陷。同一秒的两份产物——
#    窗口截图 48 KB / colorSpan 62 / 主蓝 **0**（人眼看 = 空暗窗口 + 三个交通灯），
#    WebView 快照 286 KB / 主蓝 **79**（人眼看 = 真共享 UI）。
#    这不是新发现：壳自己的代码（`HeytaMacApp.swift` 的 `captureAndExit` 注释）写着
#    "**WebView 的内容没合成进窗口**是这台机器上的**常态**"，并规定两份产物各证一件事：
#    窗口截图证"有一个真的 macOS 窗口"，`OUT.webview.png` 证"那份共享 UI 真渲染了"。
#    ⇒ 主蓝必须数**第二个参数**那张（WebView 快照），非空白/透明仍数窗口截图。
# 用法：shot_ok <窗口 png> [webView png]；输出 ✅/🔴 行。
shot_ok() {
  node - "$1" "${2:-}" <<'JS'
import('./scripts/screenshots/png-stats.mjs').then((m) => {
  const st = m.inspectPng(process.argv[2]);
  let bad = false;
  if (st.hasTransparency) { console.log('  🔴 含实际透明像素'); bad = true; }
  if (m.looksBlank(st)) { console.log('  🔴 疑似空白'); bad = true; }
  const brandShot = process.argv[3] || process.argv[2];
  const blue = m.countBrandBlue(brandShot);
  console.log(`  主蓝采样命中 ${blue}（数的是 ${brandShot.split('/').pop()}）`);
  if (blue < 20) { console.log('  🔴 截图里没有 heyta 主蓝 —— 是错误屏/别的界面，不是共享 UI'); bad = true; }
  if (bad) process.exit(1);
  console.log(`  ✅ 截图 ${st.width}x${st.height}、内容占比 ${(st.contentRatio * 100).toFixed(1)}%、主蓝命中 ${blue} —— 是共享 UI`);
}).catch((e) => { console.log(`  🔴 读不了截图：${e.message}`); process.exit(1); });
JS
}

# 🔴 上面那层是 `| grep -q "✅"` 用的，**判据数字会被整个吞掉** ——
#    于是"四端全绿"的日志里一个主蓝命中数都查不到，红了也说不出为什么红。
#    这层只负责把数字打进日志，退出码原样透传。
shot_ok_logged() {
  local out rc=0
  out="$(shot_ok "$@")" || rc=$?
  printf '%s\n' "$out"
  return "$rc"
}

# ── Windows 源码同步：把**当前工作树**（含未提交改动与未跟踪文件）+ web-dist 送过去 ──
# 🔴 2026-09-30 实测踩到：`C:\src\heyta` 是 **Sep 28** 的旧树，而这段流程只调
#    `package-msix.sh`（远端**就地**构建）—— 于是"四端重装 ✅"装的是两天前的源码，
#    而且包里没有 web-dist，窗口里显示的其实是 M2-B 通道试验页
#    （`dist/windows/packaged-first-run.png` 里那三行「M2-B 真数据」）。
#    **判据全绿、东西是错的** —— 这正是 §6.1.1 想消灭的那一类。
#    所以规则是：**同步 → 验新鲜度 → 才允许打包**；验不过判红退出，不装旧的。
# 🔴 同步 + 新鲜度对账抽到 `scripts/lib/sync-windows-sources.sh`：
#    Windows 旅程验收（`scripts/verify-windows-shell-journey.mjs`）用的是**同一份**。
#    两份实现会漂移成"一个送新树、一个送旧树"，正是 §7 第 82 条那次事故的形状。
source "$ROOT/scripts/lib/sync-windows-sources.sh"

# ── 段选择 ────────────────────────────────────────────────────────────────
ALL="mac windows android ios"
ONLY="" ; SKIP="" ; SKIPPED=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="${2:-}"; shift 2 ;;
    --skip) SKIP="${2:-}"; shift 2 ;;
    *) echo "未知参数：$1（支持 --only / --skip，端：${ALL}）"; exit 2 ;;
  esac
done
WANT=""
for seg in $ALL; do
  if [ -n "$ONLY" ] && printf '%s' ",$ONLY," | grep -q ",$seg,"; then :;
  elif [ -n "$ONLY" ]; then continue; fi
  if [ -n "$SKIP" ] && printf '%s' ",$SKIP," | grep -q ",$seg,"; then
    SKIPPED="$SKIPPED $seg"; continue
  fi
  WANT="$WANT $seg"
done

RESULT_mac="" ; RESULT_windows="" ; RESULT_android="" ; RESULT_ios=""

# ── ① 前置：全仓构建（AGENTS §6.1：打包前必须先跑，APK/.app 里打的是 packages/*/dist）──
echo "═══ 0. 前置：pnpm -r build ═══"
if "$PNPM" -r build > /tmp/heyta-reinstall-build.log 2>&1; then
  echo "  ✅ 全仓构建完成（日志 /tmp/heyta-reinstall-build.log）"
else
  echo "  🔴 全仓构建失败 —— 打包必然打进旧产物，停下（日志末尾：）"
  tail -15 /tmp/heyta-reinstall-build.log | sed 's/^/     /'
  exit 1
fi

# ── mac ──────────────────────────────────────────────────────────────────
if printf '%s' "$WANT" | grep -q "mac"; then
  echo ""
  echo "═══ 1. macOS：清旧包 → 打包 → 卸旧 → 装新 ═══"
  MAC_OUT="/tmp/heyta-macos-dist"
  INSTALLED_APP="/Applications/Heyta.app"
  RESULT_mac=FAIL
  rm -rf "$MAC_OUT"                                   # 清掉旧安装包
  if bash apps/desktop-macos/scripts/package-app.sh "$MAC_OUT" > /tmp/heyta-reinstall-mac.log 2>&1; then
    echo "  ✅ 打包完成（.app + .dmg，含打包即启动的自截屏验证；日志 /tmp/heyta-reinstall-mac.log）"
    rm -rf "$INSTALLED_APP"                           # 卸旧：不留"上一次的包"
    if cp -R "$MAC_OUT/Heyta.app" "$INSTALLED_APP"; then
      echo "  ✅ 已安装到 $INSTALLED_APP"
      # 🔴 清壳的 WKWebView 存储（重装 = 首次运行态）。不清的话上一轮的
      #    localStorage（比如“最后停留在设置页”）会把应用带进别的视图，
      #    判据截图就不是冷启动第一屏（实测：曾因此对着设置 sheet 打分）。
      #    只清**验证机**这份；真实用户升级走的是 App 数据迁移，与本流程无关。
      rm -rf "$HOME/Library/WebKit/cloud.finlaw.heyta.desktop" \
             "$HOME/Library/Caches/cloud.finlaw.heyta.desktop" 2>/dev/null || true
      # 判据用**安装副本**本身：能起来、能自截屏、截出来非空白。
      # 🔴 主蓝数的是 `.webview.png` 那一份（壳自己的规定，见 shot_ok 文件头）。
      MAC_SELFIE="/tmp/heyta-reinstall-mac-installed.png"
      MAC_SELFIE_WV="$MAC_SELFIE.webview.png"
      rm -f "$MAC_SELFIE" "$MAC_SELFIE_WV"
      HEYTA_NO_FOCUS=1 HEYTA_SELF_CAPTURE="$MAC_SELFIE" \
        "$INSTALLED_APP/Contents/MacOS/HeytaMac" >/dev/null 2>&1 || true
      if [ -f "$MAC_SELFIE" ] && shot_ok_logged "$MAC_SELFIE" "$MAC_SELFIE_WV"; then
        echo "  截图证据：${MAC_SELFIE}（窗口）+ ${MAC_SELFIE_WV}（共享 UI）"
        RESULT_mac=OK
      else
        echo "  🔴 安装副本不可信 —— 窗口没起来，或共享 UI 没渲染"
        echo "     证据：${MAC_SELFIE}:$([ -f "$MAC_SELFIE" ] && stat -f%z "$MAC_SELFIE" || echo 缺)" \
             "${MAC_SELFIE_WV}:$([ -f "$MAC_SELFIE_WV" ] && stat -f%z "$MAC_SELFIE_WV" || echo 缺)"
      fi
    else
      echo "  🔴 拷进 /Applications 失败"
    fi
  else
    echo "  🔴 打包失败（日志末尾：）"; tail -15 /tmp/heyta-reinstall-mac.log | sed 's/^/     /'
  fi
fi

# ── windows ──────────────────────────────────────────────────────────────
if printf '%s' "$WANT" | grep -q "windows"; then
  echo ""
  echo "═══ 2. Windows：同步当前源码 → 清旧包 → 远端打包 + 安装（默认主机 windows-pc）═══"
  WIN_HOST="${HEYTA_WIN_HOST:-windows-pc}"
  WIN_OUT="$ROOT/dist/windows"
  RESULT_windows=FAIL
  if sync_windows_sources "$WIN_HOST"; then
    rm -rf "$WIN_OUT"                                 # 清掉旧安装包（msix/cer/取证）
    if bash apps/desktop-windows/scripts/package-msix.sh "$WIN_HOST" "$WIN_OUT" \
        > /tmp/heyta-reinstall-win.log 2>&1; then
      echo "  ✅ 远端打包 + 安装 + 启动截图完成（日志 /tmp/heyta-reinstall-win.log）"
      FACTS="$WIN_OUT/install-capture.txt"
      # 判据四件套（缺一不可）：
      #   ADD_APPX=OK      装上了
      #   RESULT=OK        起来了、截了图
      #   PAYLOAD_WEBDIST  包里带**真共享 UI**（否则是通道试验页，不是产品）
      #   M2D=OK           壳自己的身份菜单判据（第一项=登录/注册、无退出登录）
      MISSING=""
      for fact in "ADD_APPX=OK" "RESULT=OK" "PAYLOAD_WEBDIST=True" "M2D=OK"; do
        grep -q "$fact" "$FACTS" 2>/dev/null || MISSING="$MISSING $fact"
      done
      if [ -z "$MISSING" ]; then
        echo "  ✅ 远端取证：装上的是**当前源码的真应用**，且身份菜单判据成立"
        RESULT_windows=OK
      else
        echo "  🔴 远端取证不完整 —— 缺：${MISSING# }（${FACTS}：）"
        [ -f "$FACTS" ] && sed 's/^/     /' "$FACTS"
      fi
    else
      echo "  🔴 打包/安装失败 —— 主机不可达属于**环境**，如实报告不要硬装（日志末尾：）"
      tail -10 /tmp/heyta-reinstall-win.log | sed 's/^/     /'
    fi
  else
    echo "  🔴 源码同步没通过 —— **不打包**（宁可不装，也不装旧产物）"
  fi
fi

# ── android ──────────────────────────────────────────────────────────────
if printf '%s' "$WANT" | grep -q "android"; then
  echo ""
  echo "═══ 3. Android：清旧包 → release APK → 模拟器卸旧装新 ═══"
  APK="$ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
  SERIAL="${HEYTA_E2E_SERIAL:-emulator-5554}"
  PKG=com.heyta
  RESULT_android=FAIL
  if ! adb -s "$SERIAL" get-state >/dev/null 2>&1; then
    echo "  🔴 模拟器 $SERIAL 不可达（adb devices 里没有/离线）—— 先起模拟器"
  else
    rm -f "$APK"                                      # 清掉旧安装包
    if "$PNPM" build:android > /tmp/heyta-reinstall-apk.log 2>&1 && [ -f "$APK" ]; then
      echo "  ✅ release APK 已重打（$(du -h "$APK" | cut -f1)；日志 /tmp/heyta-reinstall-apk.log）"
      # 🔴 卸旧装新（不是 install -r）：清掉旧数据与旧容器，"重装"必须是干净的。
      adb -s "$SERIAL" uninstall "$PKG" >/dev/null 2>&1 || true
      if adb -s "$SERIAL" install "$APK" 2>&1 | grep -q "Success"; then
        echo "  ✅ 模拟器 $SERIAL 全新安装成功"
        adb -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
        sleep 8
        ANDROID_SHOT="/tmp/heyta-reinstall-android.png"
        adb -s "$SERIAL" exec-out screencap -p > "$ANDROID_SHOT" 2>/dev/null
        if [ -s "$ANDROID_SHOT" ] && shot_ok_logged "$ANDROID_SHOT"; then
          echo "  截图证据：$ANDROID_SHOT"
          RESULT_android=OK
        else
          echo "  🔴 启动后截图为空/缺失 —— 装上了但没起来"
        fi
      else
        echo "  🔴 adb install 失败"
      fi
    else
      echo "  🔴 APK 构建失败（日志末尾：）"; tail -10 /tmp/heyta-reinstall-apk.log | sed 's/^/     /'
    fi
  fi
fi

# ── ios ──────────────────────────────────────────────────────────────────
if printf '%s' "$WANT" | grep -q "ios"; then
  echo ""
  echo "═══ 4. iOS：模拟器卸旧 → Release 重打 → 装新 + 新鲜度判据 ═══"
  DEVICE_NAME=${IOS_DEVICE_NAME:-iPhone 17 Pro}
  BID=${IOS_BID:-com.heyta}
  RESULT_ios=FAIL
  UDID="$(xcrun simctl list devices 2>/dev/null | grep Booted | grep -F "$DEVICE_NAME" \
    | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
  [ -n "$UDID" ] || UDID="$(xcrun simctl list devices 2>/dev/null | grep Booted \
    | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
  if [ -z "$UDID" ]; then
    echo "  🔴 没有已启动的模拟器 —— 先 xcrun simctl boot \"$DEVICE_NAME\""
  else
    echo "  模拟器：$UDID"
    # 清两样：模拟器里的旧 app + 旧构建产物
    xcrun simctl uninstall "$UDID" "$BID" >/dev/null 2>&1 || true
    rm -rf /tmp/heyta-ios-release
    echo "  正在 xcodebuild Release（重打 JS bundle，数分钟）…"
    if xcodebuild -workspace "$ROOT/apps/mobile/ios/Heyta.xcworkspace" \
        -scheme Heyta -configuration Release -sdk iphonesimulator \
        -destination "id=$UDID" -derivedDataPath /tmp/heyta-ios-release build \
        >/tmp/heyta-reinstall-ios-build.log 2>&1; then
      echo "  ✅ 构建成功（日志 /tmp/heyta-reinstall-ios-build.log）"
      IOS_APP_DIR="/tmp/heyta-ios-release/Build/Products/Release-iphonesimulator/Heyta.app"
      if xcrun simctl install "$UDID" "$IOS_APP_DIR" >/dev/null 2>&1; then
        echo "  ✅ 已安装进模拟器（全新安装）"
        # 🔴 新鲜度判据（沿用 verify-mobile-ios.sh 那次事故的产物）：
        #    "装上了"不够，装的必须是**当前源码**的产物。
        INSTALLED_APP="$(xcrun simctl get_app_container "$UDID" "$BID" app 2>/dev/null)"
        BUNDLE_MTIME=$(stat -f '%m' "$INSTALLED_APP/main.jsbundle" 2>/dev/null || echo 0)
        SRC_MTIME=$(find "$ROOT/apps/mobile/src" "$ROOT/packages"/*/src \
          -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 2>/dev/null \
          | xargs -0 stat -f '%m' 2>/dev/null | sort -rn | head -1)
        FRESH=0
        if [ "${SRC_MTIME:-0}" -le 0 ]; then
          echo "  🔴 算不出源码最新 mtime —— 新鲜度判据没在运行，不算通过"
        elif [ "${BUNDLE_MTIME:-0}" -le 0 ]; then
          echo "  🔴 读不到已装 app 的 main.jsbundle —— 验的不是刚装的这个"
        elif [ "$BUNDLE_MTIME" -ge "$SRC_MTIME" ]; then
          echo "  ✅ 已装的包比源码新 —— 这一轮装的是当前产物"; FRESH=1
        else
          echo "  🔴 已装的包比源码旧 —— 装的是旧代码"
        fi
        if [ "$FRESH" = "1" ]; then
          xcrun simctl launch "$UDID" "$BID" >/dev/null 2>&1
          sleep 10
          IOS_SHOT="/tmp/heyta-reinstall-ios.png"
          xcrun simctl io "$UDID" screenshot "$IOS_SHOT" >/dev/null 2>&1
          if [ -s "$IOS_SHOT" ] && shot_ok_logged "$IOS_SHOT"; then
            echo "  截图证据：$IOS_SHOT"
            RESULT_ios=OK
          else
            echo "  🔴 启动后截图为空/缺失 —— 装上了但没起来"
          fi
        fi
      else
        echo "  🔴 simctl install 失败：$IOS_APP_DIR"
      fi
    else
      echo "  🔴 xcodebuild 失败（日志末尾：）"; tail -10 /tmp/heyta-reinstall-ios-build.log | sed 's/^/     /'
    fi
  fi
fi

# ── 汇总（任何一端"没有结论"都按失败处理 —— 中途 return/漏写不许静默）────────
echo ""
echo "═══ 重装汇总 ═══"
FAIL=0
for seg in $ALL; do
  eval "r=\$RESULT_$seg"
  if printf '%s' " $SKIPPED " | grep -q " $seg "; then
    echo "  ⏭ ${seg}：本轮显式跳过（--skip）—— 这端**没有**验证当前产物"
  elif printf '%s' "$WANT" | grep -q "$seg"; then
    case "$r" in
      OK)   echo "  ✅ ${seg}：已清旧包、重打、重装、有当前产物判据" ;;
      FAIL) echo "  🔴 ${seg}：失败 —— 见上文"; FAIL=1 ;;
      *)    echo "  🔴 ${seg}：没有结论（段内未走到判据）—— 按失败处理"; FAIL=1 ;;
    esac
  else
    echo "  ⏭ ${seg}：不在 --only 范围 —— 这端**没有**验证当前产物"
  fi
done
exit "$FAIL"
