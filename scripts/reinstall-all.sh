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
#    ⇒ 主蓝必须数**第二个参数**那张（WebView 快照）。
# 🔴 第四轮实测（2026-10-03）：原句"非空白/透明**仍数窗口截图**"是**错的**，当场把它
#    照成假红 —— mac 段打包验证里窗口截图 13 KB / 内容 0.0% ⇒ 🔴 疑似空白，
#    而同一秒的 WebView 快照是完整真界面（主蓝 1269，人眼看过）。
#    反向也实测过：09-30 的窗口截图 205/206/272 KB、内容 ~100%，判据放行了，
#    可那三张里主蓝是 4/17/0 —— 放行的是壳自己的暗底 + 一行诊断字。
#    ⇒ 窗口合成既会**假红**（没合成 = 空白）也会**假绿**（自家底 = 非空白），
#    "画没画出来"这个问题只能压在 WebView 快照上；窗口图只负责"是不是真窗口"
#    （透明/标题/尺寸）。没有快照时才退回窗口图当内容载体。
# 用法：shot_ok <窗口 png> [webView png]；输出 ✅/🔴 行。
shot_ok() {
  node - "$1" "${2:-}" <<'JS'
import('./scripts/screenshots/png-stats.mjs').then((m) => {
  const st = m.inspectPng(process.argv[2]);
  const brandShot = process.argv[3] || process.argv[2];
  const cs = brandShot === process.argv[2] ? st : m.inspectPng(brandShot);
  const base = (p) => p.split('/').pop();
  let bad = false;
  if (st.hasTransparency) { console.log('  🔴 含实际透明像素'); bad = true; }
  if (m.looksBlank(cs)) { console.log(`  🔴 疑似空白（数的是 ${base(brandShot)}）`); bad = true; }
  if (cs !== st && m.looksBlank(st)) {
    console.log(`  ⚠️ 窗口截图内容 ${(st.contentRatio * 100).toFixed(1)}% —— 本机常态：WebView 没合成进窗口，不据此判红`);
  }
  const blue = m.countBrandBlue(brandShot);
  console.log(`  主蓝采样命中 ${blue}（数的是 ${base(brandShot)}）`);
  if (blue < 20) { console.log('  🔴 截图里没有 heyta 主蓝 —— 是错误屏/别的界面，不是共享 UI'); bad = true; }
  if (bad) process.exit(1);
  console.log(`  ✅ 窗口 ${st.width}x${st.height}、${base(brandShot)} 内容占比 ${(cs.contentRatio * 100).toFixed(1)}%、主蓝命中 ${blue} —— 是共享 UI`);
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
# 🔴 Windows 取证的判据清单同样只有一个所有者（`package-msix.sh` 也调它）。
#    以前只有这里有一份四项清单，而打包脚本**一条都不判** ⇒ 快捷方式那条新判据
#    只加进了生成它的一侧，读它的另一侧看不见。
source "$ROOT/scripts/lib/msix-install-facts.sh"

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
  # 🔴 这个输出目录以前是**写死的**，而它下面第一句就是 `rm -rf`。
  #    2026-10-04 实测：另一条会话 03:13 那一趟的证据正好落在同一个路径上，
  #    本脚本一跑就会把**别人的现场**整个删掉 —— 当时靠起跑前手动改名保住，
  #    而"我记得先改名"不是判据（AGENTS §8 第 9 条：共享资源要先定所有者与运行窗口）。
  #    旋钮的默认值逐字不变，所以不带 env 的行为与今天完全一致。
  MAC_OUT="${HEYTA_MACOS_DIST_DIR:-/tmp/heyta-macos-dist}"
  INSTALLED_APP="/Applications/Heyta.app"
  RESULT_mac=FAIL
  # 🔴 删之前把"删的是哪个目录、里面有什么"打进日志：这一句的失败模式是**安静**，
  #    出事后日志里连"原来那里有东西"都读不出来。
  echo "  macOS 输出目录 = ${MAC_OUT}（覆盖旋钮 HEYTA_MACOS_DIST_DIR）"
  if [ -d "$MAC_OUT" ]; then
    echo "  清空前里面有 $(ls -1 "$MAC_OUT" 2>/dev/null | wc -l | tr -d ' ') 项："
    ls -1 "$MAC_OUT" 2>/dev/null | head -8 | sed 's/^/     /'
  else
    echo "  清空前该目录不存在（首次运行）"
  fi
  rm -rf "$MAC_OUT"                                   # 清掉旧安装包
  if bash apps/desktop-macos/scripts/package-app.sh "$MAC_OUT" > /tmp/heyta-reinstall-mac.log 2>&1; then
    echo "  ✅ 打包完成（.app + .dmg，含打包即启动的自截屏验证；日志 /tmp/heyta-reinstall-mac.log）"
    rm -rf "$INSTALLED_APP"                           # 卸旧：不留"上一次的包"
    if cp -R "$MAC_OUT/Heyta.app" "$INSTALLED_APP"; then
      echo "  ✅ 已安装到 $INSTALLED_APP"
      # 🔴 **装上的必须就是刚打的那份，而那份必须是当前 dist**（2026-10-03 实测）。
      #    产品负责人在装好的 .app 里看到日历"内容超出容器范围"，当前源码同一尺寸
      #    同一状态量出来是能放下的 —— 差的就是包里那份 web-dist 是**早于 R13/R14 的
      #    另一次构建**（`now-line`/`clock-` 两个标记在包内 JS 里 0 命中，本机产物各 1 命中）。
      #    而 mac 段原有的两条判据（截图非空白 + 主蓝命中）**全绿** —— 它们量的是
      #    "有没有界面"，回答不了"是不是这份源码的界面"（AGENTS §7 第 82 条第四次露面）。
      #    比的是 `assets/` 的**文件名集合**：Vite 的文件名是内容寻址的哈希，
      #    集合相等就等于两次构建相等，不用逐字节比（也比不动 —— 包内是签名后的副本）。
      assets_of() { ls "$1" 2>/dev/null | sort; }
      DIST_ASSETS="$ROOT/apps/web/dist/assets"
      APP_ASSETS="$INSTALLED_APP/Contents/Resources/web-dist/assets"
      MAC_DIST_OK=0
      if [ ! -d "$DIST_ASSETS" ]; then
        echo "  🔴 对账没有分母：本机没有 ${DIST_ASSETS}（先 pnpm --filter @heyta/web build）"
      elif [ ! -d "$APP_ASSETS" ]; then
        echo "  🔴 对账没有分母：装出来的 .app 里没有 web-dist/assets（打包环节没进包）"
      elif diff <(assets_of "$APP_ASSETS") <(assets_of "$DIST_ASSETS") > /dev/null; then
        echo "  ✅ 安装对账：.app 里的 web-dist 与本机 apps/web/dist 是**同一次构建**（$(assets_of "$APP_ASSETS" | wc -l | tr -d ' ') 个 chunk）"
        MAC_DIST_OK=1
      else
        echo "  🔴 安装对账失败：.app 里的 web-dist 与本机 apps/web/dist **不是同一次构建**"
        diff <(assets_of "$APP_ASSETS") <(assets_of "$DIST_ASSETS") | head -8 | sed 's/^/     /'
      fi
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
      if [ "$MAC_DIST_OK" = 1 ] && [ -f "$MAC_SELFIE" ] && shot_ok_logged "$MAC_SELFIE" "$MAC_SELFIE_WV"; then
        echo "  截图证据：${MAC_SELFIE}（窗口）+ ${MAC_SELFIE_WV}（共享 UI）"
        RESULT_mac=OK
      else
        echo "  🔴 安装副本不可信 —— 产物对账没过，或窗口没起来，或共享 UI 没渲染"
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
      # 判据清单的单一所有者：`scripts/lib/msix-install-facts.sh`
      # （打包脚本 `package-msix.sh` 现在也调同一条，所以两处不会漂成两套标准）
      if msix_fact_out=$(msix_check_facts "$FACTS"); then
        echo "  ✅ 远端取证：${msix_fact_out}"
        RESULT_windows=OK
      else
        echo "  🔴 远端取证不完整 —— ${msix_fact_out}"
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
        # 🔴 截图之前必须先证明"屏上这个窗口就是我们的 App"，否则**不打分**。
        #    实测过的假绿（2026-10-03，emulator-5556 / AVD heyta-w3-yearly）：monkey 之后
        #    `mCurrentFocus` 仍是 launcher，而截图判据两条全过 ——
        #    内容占比 92.0%、主蓝命中 29（Chrome / 信息 / 搜索栏图标本身就是蓝的）。
        #    也就是说 §7 第 82 条补的"主蓝命中"在**启动器**上也会命中：判界面必须有
        #    界面特征，而"谁的窗口"这件事最直接的读数就是窗口焦点，不是像素统计。
        #    ⚠️ 两个探针都读不到时**判红并打印原文** —— 静默跳过等于这条判据只是装饰。
        focus_line() {
          adb -s "$SERIAL" shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | tr -d '\r'
        }
        resumed_line() {
          adb -s "$SERIAL" shell dumpsys activity activities 2>/dev/null | grep -m1 mResumedActivity | tr -d '\r'
        }
        FOCUS="$(focus_line)"; RESUMED="$(resumed_line)"
        if ! printf '%s %s' "$FOCUS" "$RESUMED" | grep -q "$PKG"; then
          echo "  ⚠️ monkey 之后前台不是 ${PKG}，用 am start -W 显式拉起再验一次"
          ACT="$(adb -s "$SERIAL" shell cmd package resolve-activity --brief "$PKG" 2>/dev/null | tail -1 | tr -d '\r')"
          if [ -n "$ACT" ]; then
            adb -s "$SERIAL" shell am start -W -n "$ACT" >/dev/null 2>&1
            sleep 4
            FOCUS="$(focus_line)"; RESUMED="$(resumed_line)"
          fi
        fi
        if [ -z "$FOCUS$RESUMED" ]; then
          echo "  🔴 前台窗口探针读不到（mCurrentFocus / mResumedActivity 均空）—— **不打分**"
          echo "     设备：${SERIAL}；请手工核对，不要拿这张截图当'装上了当前产物'的证据"
        elif ! printf '%s %s' "$FOCUS" "$RESUMED" | grep -q "$PKG"; then
          echo "  🔴 截图时前台仍不是 ${PKG} —— **不打分**（对着 launcher 打分必然假绿）"
          echo "     mCurrentFocus:    $FOCUS"
          echo "     mResumedActivity: $RESUMED"
        else
          echo "  ✅ 前台窗口确认：$FOCUS"
          adb -s "$SERIAL" exec-out screencap -p > "$ANDROID_SHOT" 2>/dev/null
          if [ -s "$ANDROID_SHOT" ] && shot_ok_logged "$ANDROID_SHOT"; then
            echo "  截图证据：$ANDROID_SHOT"
            RESULT_android=OK
          else
            echo "  🔴 启动后截图为空/缺失 —— 装上了但没起来"
          fi
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
  # 🔴 原来这里退化成"随便挑第一台已启动的模拟器"。这一段的下一个动作就是
  #    `simctl uninstall` —— 一台**别人项目的**设备会被静默卸掉 App。
  #    本机实测三台同时 Booted：heyta-iphone-17pro / iPhone Duo heyta / SSOS-Duo-Fresh，
  #    而默认名 "iPhone 17 Pro" 一个都不匹配（真名用连字符小写），所以**每次**都走盲选。
  #    现在：只有一台时才认它；多于一台且名字不匹配 ⇒ 响亮失败并把候选打出来。
  if [ -z "$UDID" ]; then
    BOOTED="$(xcrun simctl list devices 2>/dev/null | grep Booted | sed 's/^ *//;s/ *(Booted)//')"
    BOOTED_N=$(printf '%s\n' "$BOOTED" | grep -c .)
    if [ "$BOOTED_N" = "1" ]; then
      UDID="$(printf '%s\n' "$BOOTED" | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
      echo "  ⚠️ 名字含 \"$DEVICE_NAME\" 的模拟器没有已启动的，但**只有一台**已启动 ⇒ 用它：$BOOTED"
    elif [ "$BOOTED_N" -gt 1 ]; then
      echo "  🔴 有 $BOOTED_N 台已启动模拟器，且没有一台名字含 \"$DEVICE_NAME\" —— **不猜**（这一段会 simctl uninstall）"
      # ⚠️ 候选一行一个：`printf '%s | ' $BOOTED` 会按空格拆词，把 "iPhone Duo heyta"
      #    打成三个"候选"，而照它填 IOS_DEVICE_NAME 就永远匹配不上。
      printf '%s\n' "$BOOTED" | sed 's/^/     候选: /'
      echo "     要跑这一端：IOS_DEVICE_NAME=\"<候选里的准确名字>\" bash scripts/reinstall-all.sh --only ios"
    else
      echo "  🔴 没有已启动的模拟器 —— 先 xcrun simctl boot \"$DEVICE_NAME\""
    fi
  fi
  if [ -n "$UDID" ]; then
    echo "  模拟器：$UDID"
    # 🔴 Pods 沙盒必须先与**提交态的 Podfile.lock** 同步，否则 xcodebuild 第一步就死在
    #    "[CP] Check Pods Manifest.lock"：`error: The sandbox is not in sync with the Podfile.lock.`
    #    这一步以前**不在流程里** —— `ios/Pods/` 是 gitignored 的，隔离检出里换一次 HEAD
    #    沙盒就对不上了，而脚本原来只会打印"xcodebuild 失败 + 日志末尾"，
    #    读起来像产品坏了（实际缺的是构建输入）。
    #    env 那一串与 `scripts/check-native-deps.mjs` 打印的修法同源，**改一处要改两处** ——
    #    自 2026-10-04 起这一句由 `check:native-deps` 的第三条规则钉住（不靠注释）。
    #
    #    🔴 那串 env 里**唯一承重的**是"至少有一个 locale 变量"。四臂实测（同一棵树、
    #    同一分钟内、`/tmp/pod-arms-*.txt`）：
    #      · `LANG` 与 `LC_ALL` **都不给** ⇒ 崩在 `config.rb:167 installation_root`
    #        （`Unicode Normalization not appropriate for ASCII-8BIT`，
    #        `Encoding.default_external=US-ASCII`）。
    #      · 只给 `LANG`（显式 `-u LC_ALL`）⇒ ✅ `Pod installation complete!` 84 deps/83 pods。
    #      · 给 `LANG`+`LC_ALL` ⇒ ✅ 同上。
    #    ⚠️ 所以 `LC_ALL` **不是**必需项，这里不给它；`LANG` 必须给。
    #
    #    🔴 而 `ArgumentError - path name contains null byte`（`project.rb:452 realdirpath`）
    #    与 locale **无关**：给它 `LANG`+`LC_ALL` 的那一趟（D 臂）就崩了，而 5 秒前同样 env
    #    形状的两趟（A/B）都成功。⇒ 它是**逐趟非确定性**的（上游 CocoaPods #12798 / #12866，
    #    两条都还 open，后者标题就写着 "sometimes"）。
    #    这也**否证**了 traps #154 当时的结论"变量是这棵长活的树本身"——同一棵树上三趟两成
    #    一崩，树不是那个变量。⚠️ 它当时另一条否证（"换一棵新克隆就好了"）依然成立，只是
    #    解释力更弱：新克隆也一样可能崩，只是没撞上。
    #
    #    ⇒ 这里的处置是**有界重试**（每趟 ~10 s，最多 3 趟，逐趟落日志与 RC），
    #      而不是改 env。判据没放松：仍然要求 `Manifest.lock == Podfile.lock`，
    #      三趟全崩就照常判红。
    #
    #    🔴 而且**不再因为"哈希已经相等"就跳过这一趟**（2026-10-04 实测的理由）：
    #    上一趟 `pod install` 崩在"Generating Pods project"中段时，`Manifest.lock` 已经写完、
    #    与 `Podfile.lock` 逐字节相同，但 `Pods/Headers/Public/RCTSwiftUI/` 整层没生成 ——
    #    于是"沙盒一致"的哈希判据**被一个半写沙盒满足**，xcodebuild 接着报
    #    `fatal error: module map file '…/RCTSwiftUI.modulemap' not found`（4 个 target 全挂）。
    #    那一次失败是**响亮**的（装包段判红），所以这不是假绿；但它把"缺构建输入"
    #    伪装成"产品构建不过"，正是本文件第 396 行自己写过的那个形状。
    #    ⇒ 现在每次都跑（幂等、~10 s），把"沙盒完整"这件事交给生成器本身，而不是交给一个哈希。
    IOS_IOS_DIR="$ROOT/apps/mobile/ios"
    PODS_SYNC=OK
    LOCK_SHA="$(shasum -a 256 "$IOS_IOS_DIR/Podfile.lock" 2>/dev/null | cut -d' ' -f1)"
    MANI_SHA="$(shasum -a 256 "$IOS_IOS_DIR/Pods/Manifest.lock" 2>/dev/null | cut -d' ' -f1)"
    if [ -z "$LOCK_SHA" ]; then
      echo "  🔴 读不到 apps/mobile/ios/Podfile.lock —— 无法判断沙盒该不该装"
      PODS_SYNC=FAIL
    else
      if [ "$LOCK_SHA" = "$MANI_SHA" ]; then
        echo "  Pods 哈希本已一致，仍重跑 pod install（半写沙盒不会被哈希相等挡住）…"
      else
        echo "  Pods 沙盒与 Podfile.lock 不一致（或缺 Manifest.lock）→ 跑 pod install…"
      fi
      # 🔴 允许**有界重试**，而且每一趟各自落账（`/tmp/heyta-reinstall-pod-<n>.log`）。
      #    理由不是"重试通常能过"这种印象，是 2026-10-05 03:0x 现量：CocoaPods 1.17.0 在
      #    "Generating Pods project" 加 source file 引用那一步偶发崩
      #    `ArgumentError - path name contains null byte`（`Pathname#realdirpath`；
      #    上游 #12798 / #12866 当时都还 open），崩完沙盒是半写状态，而**同一棵载体上
      #    45 分钟前刚成功跑过一遍、手跑第二趟 rc=0**。一次就红会把这条偶发报成
      #    "ios 腿失败"，而红字里没有一个字指向"可重试" —— 读的人会去查构建，
      #    构建是好的（与 `afe7ff7a`/`d924853e` 那两发同形：**红的那一句把原因说反了**）。
      #    这不是降级判据：三趟都失败仍然整腿判红，每一趟的日志都留着。
      POD_OK=0
      for POD_TRI in 1 2 3; do
        POD_LOG="/tmp/heyta-reinstall-pod-$POD_TRI.log"
        if (cd "$IOS_IOS_DIR" && env -u NODE_USE_ENV_PROXY LANG=en_US.UTF-8 \
            RCT_USE_PREBUILT_RNCORE=0 RCT_USE_RN_DEP=0 pod install) \
            >"$POD_LOG" 2>&1; then
          POD_OK=1
          break
        fi
        echo "    ⚠️ 第 ${POD_TRI} 趟失败：$(grep -m1 -oE "ArgumentError - [^\"]*|\[!\] [^\"]*" "$POD_LOG" | head -1)（日志 ${POD_LOG}）"
      done
      cp -f "$POD_LOG" /tmp/heyta-reinstall-pod.log 2>/dev/null || true
      if [ "$POD_OK" = 1 ]; then
        [ "$POD_TRI" -gt 1 ] && echo "    （第 ${POD_TRI} 趟才成功 —— 与上面那条非确定性记录一致）"
        MANI_SHA="$(shasum -a 256 "$IOS_IOS_DIR/Pods/Manifest.lock" 2>/dev/null | cut -d' ' -f1)"
        NEW_LOCK_SHA="$(shasum -a 256 "$IOS_IOS_DIR/Podfile.lock" 2>/dev/null | cut -d' ' -f1)"
        if [ "$NEW_LOCK_SHA" != "$LOCK_SHA" ]; then
          # 不判红：提交态的 lock 能不能复现由 `check:native-deps` 管（traps #150 已实测
          # 提交态**是**可复现的）。这里只把差异如实打出来，不静默。
          DIFFN=$(diff <(git -C "$ROOT" show HEAD:apps/mobile/ios/Podfile.lock 2>/dev/null) \
                      "$IOS_IOS_DIR/Podfile.lock" 2>/dev/null | grep -c '^[<>]')
          echo "  ⚠️ pod install 改动了 Podfile.lock（与 HEAD 差 ${DIFFN} 行）—— 见 ${POD_LOG}"
        fi
        if [ -n "$MANI_SHA" ] && [ "$MANI_SHA" = "$NEW_LOCK_SHA" ]; then
          echo "  ✅ 沙盒已同步（Manifest.lock == Podfile.lock）"
        else
          echo "  🔴 pod install 之后 Manifest.lock 仍与 Podfile.lock 不一致"
          tail -10 "$POD_LOG" | sed 's/^/     /'
          PODS_SYNC=FAIL
        fi
      else
        echo "  🔴 pod install **三趟**都失败 ⇒ 不是那条偶发崩溃；最后一趟日志末尾："
        tail -10 "$POD_LOG" | sed 's/^/     /'
        PODS_SYNC=FAIL
      fi
    fi
    # 清两样：模拟器里的旧 app + 旧构建产物
    xcrun simctl uninstall "$UDID" "$BID" >/dev/null 2>&1 || true
    rm -rf /tmp/heyta-ios-release
    echo "  正在 xcodebuild Release（重打 JS bundle，数分钟）…"
    if [ "$PODS_SYNC" = OK ] && xcodebuild -workspace "$ROOT/apps/mobile/ios/Heyta.xcworkspace" \
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
      if [ "$PODS_SYNC" != OK ]; then
        # 🔴 不许 tail 那份**上一轮**的构建日志 —— 沙盒没同步时 xcodebuild 根本没跑，
        #    打出旧日志的尾巴会把人引向一个不存在的产品故障。
        echo "  🔴 沙盒未同步 ⇒ 这一轮**没有跑** xcodebuild（原因见上面的 pod 段）"
      else
        echo "  🔴 xcodebuild 失败（日志末尾：）"; tail -10 /tmp/heyta-reinstall-ios-build.log | sed 's/^/     /'
      fi
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
