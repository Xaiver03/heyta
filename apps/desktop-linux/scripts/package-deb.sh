#!/bin/bash
# Linux 原生壳打包成 .deb：共享 UI 产物 → 组装 → dpkg-deb → **免 root** 解开跑一次窗口。
#
#   bash apps/desktop-linux/scripts/package-deb.sh [目标机|local] [输出目录]
#
# 目标机的取法（**没有"默认打到生产机"这一档**，见下面第二条边界）：
#   位置参数 > `HEYTA_LINUX_HOST=<ssh 别名>` > 本机是 Linux 就 `local` > 响亮拒绝。
#
# ── 两条边界，都是被实测逼出来的 ─────────────────────────────────────────
#
# 🔴 **本脚本不再 `dpkg -i`。** 旧版最后一步是"安装 + 启动验证"，而它的默认远端 `sanjiaozhou`
#    是一台**生产机**（Caddy 在跑线上站点、postgres、几十个容器 —— 见
#    docs/runbooks/linux-dev-box.md §8：可以借它编译取证，不可以往它上面装包）。
#    现在改用 `dpkg-deb -x` 把包解进一个临时根，直接跑**解出来的那棵树**：
#    同样回答"装出来的包里是同一个 heyta 吗"，但不需要 root、也不碰任何一台机的系统目录。
#    真要装进系统：显式 `HEYTA_DEB_INSTALL=1`，而那必须是一台允许装包的机器。
#
# 🔴 **`.deb` 里没有共享 UI 产物就等于打了一个不能用的包。** 旧版只装二进制 +
#    `native-bridge.js`，于是"打成 .deb 了"这句话对得上、装上却只能渲染
#    "找不到共享 UI 产物"那一屏（macOS 那侧 §7 第 82 条踩过同一格）。
#    所以这里有三条承重判据，任何一条不成立就**拒绝产出**：
#      ① `apps/web/dist/index.html` 缺席 ⇒ `RESULT=WEB_DIST_MISSING`；
#      ② 目标机上那份与发起方那份 sha256 逐字不同 ⇒ `PKG_FRESHNESS=FAIL`（不打包）；
#      ③ 解包后的那棵树跑出来的窗口没有页侧落定行 ⇒ `PKG_RESULT=FAIL`。
#    ⚠️ 回传的 `dist/linux/package-facts.txt` 是**纯 ASCII 判据行**（AGENTS §7 第 83 条：
#    人的说明与机器的判据分两个通道），`check:shell-surfaces` 的 Linux D 档读的就是它。
#
# ── 安装布局（FHS，且**可重定位**）──────────────────────────────────────
#
#   /usr/lib/heyta/heyta-linux        二进制
#   /usr/lib/heyta/native-bridge.js   与它同目录 ⇒ 满足"exe 同目录"那条默认，不需要环境变量
#   /usr/share/heyta/web-dist/**      共享 UI 产物（壳按 exe 目录的 ../../share/heyta/web-dist 找到它）
#   /usr/bin/heyta                    一行 wrapper，按**自己所在位置**exec（不写死 /usr/...）
#   /usr/share/applications/heyta.desktop / usr/share/icons/... / usr/share/doc/heyta/copyright
#
# wrapper 用 `dirname "$0"` 而不是绝对路径，是**为了让 `dpkg-deb -x` 的临时根能直接跑**：
# 写死 `/usr/lib/heyta/heyta-linux` 的话，解包态验证就跑不起来，而那条验证是上面 ③ 的载体。
#
# ── 依赖：从 ldd 反查真实包名，不手写 ───────────────────────────────────
#
# 手写 Depends 一定会漂（发行版改名、so 版本变化）。这里用
# `ldd <binary> → 逐个 dpkg -S → 取包名`，只排除加载器与 libc 这类 essential 噪声。
# 那串回退清单的唯一真源是 `scripts/linux/shell-modules.mjs` 的 RUNTIME_PACKAGE，
# 两枚判据（A8 与 `check-native-lib-registry`）都从本文件这一行取锚点 ⇒ **不要改它的形状**。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LINUX_DIR="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$LINUX_DIR/../.." && pwd)"
REMOTE_DIR="/tmp/heyta-linux-pkg"
VERSION="${HEYTA_VERSION:-1.0.0}"

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  if [ -n "${HEYTA_LINUX_HOST:-}" ]; then
    TARGET="$HEYTA_LINUX_HOST"
  elif [ "$(uname -s)" = "Linux" ]; then
    TARGET="local"
  else
    echo "🔴 没定目标机，而本机是 $(uname -s) —— 打不出 .deb（dpkg-deb 只在 Linux 上）。"
    echo "   选一台：package-deb.sh local（就在这台 Linux 上）／ package-deb.sh <ssh 别名> ／"
    echo "   HEYTA_LINUX_HOST=<ssh 别名> pnpm build:linux。载体取证用 linux-dev-lan，"
    echo "   别用 sanjiaozhou：那是生产机，只借编译、不装包（runbook §8）。"
    exit 1
  fi
fi
OUT_DIR="${2:-$REPO/dist/linux}"
SKIP_WINDOW="${HEYTA_DEB_SKIP_WINDOW:-0}"
DO_INSTALL="${HEYTA_DEB_INSTALL:-0}"

hash_file() {
  # 两边都要能用：GNU 有 sha256sum，macOS 有 shasum -a 256，输出的十六进制逐字相同。
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

echo "=== ⓪ 发起方这一侧：共享 UI 产物必须在，且取一份指纹去对账 ==="
if [ ! -f "$REPO/apps/web/dist/index.html" ]; then
  echo "RESULT=WEB_DIST_MISSING"
  echo "🔴 $REPO/apps/web/dist/index.html 不在 —— 先 pnpm --filter @heyta/web build。"
  echo "   这一条不是仪式：macOS 那侧就是「装上了、起得来、画的是错误屏」混过去了四轮（§7 第 82 条）。"
  exit 1
fi
EXPECTED_DIST_SHA="$(hash_file "$REPO/apps/web/dist/index.html")"
echo "  发起方 index.html sha256=${EXPECTED_DIST_SHA:0:16}…"

# ── 组装 + 验证的正文：一份脚本，两种投递方式（ssh 管道 / 本机直接跑）────────
# 🔴 写成**临时文件**而不是两处各抄一遍：过去这条路上"远端那份"与"本地那份"就是两份实现，
#    漂移从抄第二遍开始。
BODY="$(mktemp "${TMPDIR:-/tmp}/heyta-deb-body.XXXXXX")"
trap 'rm -f "$BODY"' EXIT

cat >"$BODY" <<'BODY_SH'
set -e
if [ "$(uname -s)" != "Linux" ]; then
  echo "RESULT=NOT_LINUX —— 组装 .deb 必须在 Linux 上（dpkg-deb / dpkg -S）"
  exit 1
fi
cd "$RD"

BRIDGE_DEFAULT="$RD/packages/app-host/bridge-bundle/native-bridge.js"
if [ ! -f "$BRIDGE_DEFAULT" ]; then
  echo "--- 门面 bundle 不在，先打一份 ---"
  node packages/app-host/scripts/build-native-bridge.mjs >/dev/null
fi
export HEYTA_BRIDGE_BUNDLE="$BRIDGE_DEFAULT"

echo "--- ① 共享 UI 产物：缺席就红，指纹不对也红 ---"
if [ ! -f "$RD/apps/web/dist/index.html" ]; then
  echo "RESULT=WEB_DIST_MISSING"
  exit 1
fi
TARGET_SHA="$(sha256sum "$RD/apps/web/dist/index.html" | cut -d' ' -f1)"
if [ "$TARGET_SHA" != "$EXPECTED_DIST_SHA" ]; then
  echo "PKG_FRESHNESS=FAIL"
  echo "  发起方=${EXPECTED_DIST_SHA}"
  echo "  这一台=$TARGET_SHA"
  echo "🔴 这台机上的 apps/web/dist 不是发起方那一份 ⇒ 拒绝打包。"
  echo "   远端模式下这一步等于「装的是上一次同步的旧产物」（§7 第 82 条同族）。"
  exit 1
fi
DIST_FILES="$(find "$RD/apps/web/dist" -type f | wc -l | tr -d ' ')"
echo "  ✅ PKG_FRESHNESS=OK files=$DIST_FILES index_sha256=${TARGET_SHA:0:16}"
echo "PKG_INDEX_SHA=$TARGET_SHA"

echo "--- ② 构建壳（-Werror）---"
cd "$RD/apps/desktop-linux"
make clean >/dev/null 2>&1 || true
make >/tmp/heyta-linux-build.log 2>&1 || {
  echo "🔴 编译失败，日志尾部："
  tail -15 /tmp/heyta-linux-build.log
  exit 1
}
if grep -qE "(error|warning):" /tmp/heyta-linux-build.log; then
  echo "🔴 -Werror 之下仍有 error/warning 字样："
  grep -E "(error|warning):" /tmp/heyta-linux-build.log | head -5
  exit 1
fi
echo "  ✅ 0 警告：$(stat -c%s heyta-linux) 字节"

echo "--- ③ 组装 .deb 树 ---"
PKG=/tmp/heyta-deb
rm -rf "$PKG"
mkdir -p "$PKG/DEBIAN" \
         "$PKG/usr/lib/heyta" \
         "$PKG/usr/bin" \
         "$PKG/usr/share/applications" \
         "$PKG/usr/share/heyta" \
         "$PKG/usr/share/icons/hicolor/512x512/apps" \
         "$PKG/usr/share/doc/heyta"

install -m 0755 heyta-linux "$PKG/usr/lib/heyta/heyta-linux"
install -m 0644 "$HEYTA_BRIDGE_BUNDLE" "$PKG/usr/lib/heyta/native-bridge.js"

# 共享 UI：**整份**拷进来，不是只拷 index.html（模块脚本按 assets/… 逐级请求，缺一个就是白屏）。
cp -R "$RD/apps/web/dist" "$PKG/usr/share/heyta/web-dist"
IN_PACKAGE_SHA="$(sha256sum "$PKG/usr/share/heyta/web-dist/index.html" | cut -d' ' -f1)"
if [ "$IN_PACKAGE_SHA" != "$EXPECTED_DIST_SHA" ]; then
  echo "PKG_FRESHNESS_INPACKAGE=FAIL"
  exit 1
fi
echo "  ✅ PKG_FRESHNESS_INPACKAGE=OK"

ICON="$RD/apps/web/public/icons/icon-512.png"
if [ -f "$ICON" ]; then
  install -m 0644 "$ICON" "$PKG/usr/share/icons/hicolor/512x512/apps/heyta.png"
else
  echo "  ⚠️ 没找到 $ICON，跳过图标"
fi

cat >"$PKG/usr/bin/heyta" <<'WRAP'
#!/bin/sh
# 按 wrapper 自己所在位置找二进制 ⇒ 解包态（dpkg-deb -x 到临时根）也能直接跑这一份。
# bundle 与产物都不用环境变量：壳默认看 exe 同目录的 native-bridge.js，
# 以及 exe 目录的 ../../share/heyta/web-dist（FHS）。
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$here/../lib/heyta/heyta-linux" "$@"
WRAP
chmod 0755 "$PKG/usr/bin/heyta"

cat >"$PKG/usr/share/applications/heyta.desktop" <<'DESK'
[Desktop Entry]
Type=Application
Name=heyta
Comment=本地优先的任务管理（原生 GTK4 壳）
Exec=/usr/bin/heyta
Icon=heyta
Terminal=false
Categories=Office;Utility;
DESK

cat >"$PKG/usr/share/doc/heyta/copyright" <<'COPY'
heyta —— 本地优先的任务管理。
Desktop shell: GTK4 + JavaScriptCoreGTK + WebKitGTK（M2：壳内 WebView 载共享 UI 产物）。业务逻辑与存储由同一份 TS bundle 提供。
COPY

echo "--- 反查运行时依赖 ---"
# 🔴 取的是**直接 NEEDED**（`objdump -p`），不是 `ldd`：后者给出整条传递闭包。
#    07 04:2x 在这台载体上实测反查出 **110 枚**包名（`libvulkan1` / `libunwind8` / `libgstreamer*`
#    全进来了），既不是"这个壳自己要的"，也与登记册口径（由 Makefile 的 PKGS 推导）对不上 ——
#    而 A8 与 `check-native-lib-registry` 两条判据核对的正是后者。
#    写多不会报错，只会把包变得不可读：这一格的失败形状是"Depends 里 110 个包"，不是失败。
# 🔴 过滤条件也不能按 `/lib` 这个**路径前缀**排除：Ubuntu 24.04 是合并 /usr，
#    每条都是 `/lib/x86_64-linux-gnu/...`，旧写法把**全部**运行时库
#    滤成空集，`DEPS` 静默退回下面那串手写清单 —— 症状是"包里 Depends 是三枚"，
#    而产物其实链了五枚（`dpkg -I` 看不出来，装到缺库的机器上才炸）。
#    现在按**库名**只排除加载器与 libc 这两枚 essential 噪声。
DEPS=$(objdump -p "$PKG/usr/lib/heyta/heyta-linux" \
  | awk '/NEEDED/ {print $2}' \
  | grep -vE "^(ld-linux|libc\.so|libm\.so|libdl\.so|libpthread\.so|librt\.so)" \
  | sort -u \
  | while read -r so; do dpkg -S "/usr/lib/x86_64-linux-gnu/$so" 2>/dev/null | head -1 | cut -d: -f1; done \
  | grep -E "^lib" | sort -u | paste -sd, -)
DEPS_SCANNED=$DEPS
# 回退清单的唯一真源是 `scripts/linux/shell-modules.mjs` 的 RUNTIME_PACKAGE；
# `check-native-lib-registry` 的 A8 会核对**这一行**与该清单相等 —— 加了 Makefile 模块
# 而忘了登记运行时包名，那条臂当场红。⚠️ 这一行的字面形状是两枚判据的锚点，别改。
[ -n "$DEPS" ] || DEPS="libgtk-4-1, libjavascriptcoregtk-4.1-0, libjavascriptcoregtk-6.0-1, libsqlite3-0, libwebkitgtk-6.0-4"
DEPS_N=$(printf '%s' "$DEPS" | tr ',' '\n' | grep -c . || true)
if [ -z "$DEPS_SCANNED" ]; then
  # 空集不是"没有依赖"，是探针坏了 —— 旧版就在这里静默回退，才有了"包里写三枚、产物链五枚"。
  echo "  🔴 反查得到空集 ⇒ Depends 用的是手写回退清单，这一格的读数不可信"
fi
echo "  $DEPS"

SIZE_KB=$(( $(du -sk "$PKG/usr" | cut -f1) ))
cat >"$PKG/DEBIAN/control" <<CTRL
Package: heyta
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: amd64
Depends: ${DEPS}
Installed-Size: ${SIZE_KB}
Maintainer: Xiaoli Creativity Culture Industry Development (beijing) Co., Ltd.
Description: heyta —— 本地优先的任务管理（GTK4 原生壳）
 同一份 TS bundle 驱动 web / mobile / desktop 三端；界面是 apps/web 打出的共享产物，数据落在本机 SQLite，
 端到端加密后才同步。本包是 Linux 桌面原生壳（GTK4 + JavaScriptCoreGTK + WebKitGTK）。
CTRL

echo "--- ④ dpkg-deb 打包 ---"
DEB="/tmp/heyta_${VERSION}_amd64.deb"
rm -f "$DEB"
dpkg-deb --build --root-owner-group "$PKG" "$DEB" >/dev/null
echo "  ✅ $(basename "$DEB") $(stat -c%s "$DEB") 字节"
dpkg-deb -c "$DEB" | grep -c "usr/share/heyta/web-dist/" | sed 's/^/   包内 web-dist 条目: /' || true

echo "--- ⑤ 解开跑一次窗口（免 root；不设 HEYTA_WEB_ROOT）---"
if [ "$DO_INSTALL" = "1" ]; then
  dpkg -i "$DEB" >/tmp/heyta-deb-install.log 2>&1 || {
    echo "🔴 安装失败："; tail -5 /tmp/heyta-deb-install.log; exit 1; }
  echo "  ✅ 已安装：$(dpkg -s heyta | grep -E '^Version')"
  RUN_BIN="/usr/bin/heyta"
else
  ROOT=/tmp/heyta-deb-x
  rm -rf "$ROOT"; mkdir -p "$ROOT"
  dpkg-deb -x "$DEB" "$ROOT"
  RUN_BIN="$ROOT/usr/bin/heyta"
  echo "  ✅ 解到 $ROOT（零 root；跑的就是包内那份字节）"
fi

if [ "$SKIP_WINDOW" = "1" ]; then
  echo "PKG_WINDOW=skipped（HEYTA_DEB_SKIP_WINDOW=1）"
  exit 0
fi
if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "RESULT=NO_XVFB"
  echo "🔴 这台机上没有 xvfb-run ⇒ 「装出来的包里是同一个 heyta」这一格没法取证。"
  echo "   要么在这台机上补 X 载体（scripts/linux/provision-user-prefix.sh --with-x11），"
  echo "   要么显式 HEYTA_DEB_SKIP_WINDOW=1 只要包、不要窗口证据。不静默跳过。"
  exit 1
fi

SHOT=/tmp/heyta-deb-window.png
rm -f "$SHOT" /tmp/heyta-deb-run.log
rc_run=0
# ⚠️ 选项形状由 `xvfb-run --help` 现量得来：`-a` 自己挑空闲号（不去碰别人在用的 :0/:1/:1024），
#    `-s` 才是给 Xvfb 的参数。探测 `xvfb-run --version` 会回 1 —— 那条已经错过一次（§7 第 380 条）。
run_packaged() {
  # $1 = off 时关掉 WebKit 沙箱（这台载体 apparmor 拦了非特权 userns，bwrap 起不来是致命的，
  # 见 docs/reference/environment-traps.md 第 375 条）。用了哪一档由下面那行 PKG_SANDBOX 说。
  # 🔴 `env -u HEYTA_BRIDGE_BUNDLE`：上面为 `make` 导出的是**源码树里那份** bundle。
  #    留着它，这一跑验的就不再是包（07 04:3x 就是这么"通过"过一次，而壳的默认分支其实还是坏的：
  #    装出来的壳在自己的布局里找 bundle，用户在自家目录敲 `heyta` 会得到"找不到 bundle"）。
  #    剥掉它之后，这一格跑的才是**包内布局**：wrapper 定位二进制、二进制在同目录取 native-bridge.js、
  #    产物走 exe 目录的 ../../share/heyta/web-dist。
  if [ "$1" = "off" ]; then
    env -u HEYTA_BRIDGE_BUNDLE WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
      HEYTA_LINUX_SNAPSHOT="$SHOT" HEYTA_EXIT_AFTER_MS=15000 HEYTA_WEB_PROBE=1 \
      xvfb-run -a -s "-screen 0 1280x800x24" "$RUN_BIN" >>/tmp/heyta-deb-run.log 2>&1
  else
    env -u HEYTA_BRIDGE_BUNDLE HEYTA_LINUX_SNAPSHOT="$SHOT" HEYTA_EXIT_AFTER_MS=15000 HEYTA_WEB_PROBE=1 \
      xvfb-run -a -s "-screen 0 1280x800x24" "$RUN_BIN" >>/tmp/heyta-deb-run.log 2>&1
  fi
}
run_packaged on || rc_run=$?
# 🔴 重试的触发条件是**退出码**，不是"某一行有没有出现"。第一版这里写的是
#    「日志里有 bwrap 且没有 SHELL_UI=web-dist」⇒ 永远不成立：壳在 web 进程被沙箱打死**之前**
#    就已经打印了 `SHELL_UI=web-dist`（它只说明 WebView 控件建起来了、产物目录解析到了）。
#    那一行回答不了"页面加载了没有"，而 rc=133（SIGTRAP）回答得了。
if [ "$rc_run" -ne 0 ] && grep -qE "bwrap|dbus-proxy" /tmp/heyta-deb-run.log; then
  echo "  ⚠️ 默认档起不来（$(grep -m1 -oE 'bwrap[^"]*|Failed to fully launch dbus-proxy[^"]*' /tmp/heyta-deb-run.log)）⇒ 改跑无沙箱档取证"
  : >/tmp/heyta-deb-run.log
  # ⚠️ 先清零再跑：`|| rc_run=$?` 只在**失败**时赋值，第二次成功的话上一轮的 133 会留在原地 ——
  #    本轮就把它读成了"包内的壳也崩了一次"，而三臂对照（开发树 ± 探针 / 包内树）其实全是 rc=0。
  rc_run=0
  run_packaged off || rc_run=$?
  echo "PKG_SANDBOX=off"
else
  echo "PKG_SANDBOX=on"
fi
echo "PKG_RUN_RC=$rc_run"

grep -E "^SHELL_UI=" /tmp/heyta-deb-run.log | sed 's/^/  壳侧: /' || true
grep -Eo "^M2_SETTLED_AFTER=[0-9]+" /tmp/heyta-deb-run.log | sed 's/^/  页侧: /' || true
if grep -q "^SHELL_UI=web-dist" /tmp/heyta-deb-run.log; then echo "PKG_SHELL_UI=web-dist"; else echo "PKG_SHELL_UI=FAIL"; fi
if grep -qE "^M2_SETTLED_AFTER=[1-9]" /tmp/heyta-deb-run.log; then
  echo "PKG_SETTLED=OK"
else
  echo "PKG_SETTLED=FAIL"
  echo "🔴 解包态的壳没有页侧落定行。日志尾部："
  tail -20 /tmp/heyta-deb-run.log
  exit 1
fi
if grep -q "M2_SCHEME_MISS=" /tmp/heyta-deb-run.log; then
  echo "PKG_SCHEME_MISS=FAIL"
  grep -m3 "M2_SCHEME_MISS=" /tmp/heyta-deb-run.log | sed 's/^/  /'
  exit 1
fi
[ -f "$SHOT" ] && echo "PKG_SNAPSHOT_TAKEN=OK" || { echo "PKG_SNAPSHOT_TAKEN=FAIL"; exit 1; }
BODY_SH

echo ""
echo "=== ① 在 ${TARGET} 上执行上面那份正文 ==="
LOG="/tmp/heyta-deb-body-$$.log"
rc=0
if [ "$TARGET" = "local" ]; then
  RD="$REPO" EXPECTED_DIST_SHA="$EXPECTED_DIST_SHA" VERSION="$VERSION" \
    DO_INSTALL="$DO_INSTALL" SKIP_WINDOW="$SKIP_WINDOW" \
    bash "$BODY" >"$LOG" 2>&1 || rc=$?
else
  echo "  同步源码 + web-dist + bundle 到 ${TARGET}:${REMOTE_DIR}"
  rsync -az --delete \
    --include='/*' --include='/apps/' --include='/apps/desktop-linux/***' \
    --include='/packages/' --include='/packages/app-host/' --include='/packages/app-host/bridge-bundle/***' \
    --include='/packages/design-system/' --include='/packages/design-system/generated/***' \
    --include='/apps/web/' --include='/apps/web/public/' --include='/apps/web/public/icons/***' \
    --include='/apps/web/dist/***' \
    --exclude='*' \
    "$REPO/" "${TARGET}:${REMOTE_DIR}/"
  # 🔴 **免 sudo 那台载体上，pkg-config 与头文件只活在 provisioning 写出的那份 env 里**，
  #    而 ssh 管道起的是**非登录** shell —— 不 source 就得到
  #    `make: pkg-config: 没有那个文件或目录`（07 10:1x 实测：`pnpm build:linux <别名>` 这一档
  #    在 `linux-dev-lan` 上从来没打出过包，而 `check:linux-shell` 那侧的读数是**人先 source 再跑**
  #    拿到的 —— 那条手递手没有写进这里，就成了"入口存在但打不出产物"）。
  #    有则用、没有就照旧走系统 PATH，且把用没用**打印出来**：不静默改任何一台机的环境。
  # 🔴 前置那行走的是 **stdin**：`< <(...)`，`<` 与 `<(` 中间那个空格**不能省**。省掉就变成
  #    `ssh host cmd /dev/fd/63` —— 远端那句 `bash -s` 从 ssh 通道读到的是**空**，正文一行都没跑，
  #    而 ② 照样把上一轮留在远端的 `.deb` 与快照取回来、③ 照样打印 `PKG_RESULT=OK`。
  #    07 10:1x 这一面是**我自己写错时实测到的**：那一趟 `PKG_BLUE_HITS=3987` 与上一轮逐字相同，
  #    日志里连一行编译输出都没有。⇒ 本脚本对"取回的产物是本轮打的"没有一条判据（① 那三条
  #    只钉 `web-dist` 的指纹），这一格已登记给 Linux 线（BLOCKED B101 格 5）。
  ENV_PRELUDE='if [ -f "${HOME}/heyta-linux-prefix/env.sh" ]; then . "${HOME}/heyta-linux-prefix/env.sh"; echo "LINUX_ENV=sourced ${HOME}/heyta-linux-prefix/env.sh"; else echo "LINUX_ENV=none（用系统 PATH 里的 pkg-config）"; fi'
  ssh "$TARGET" \
    "RD='${REMOTE_DIR}' EXPECTED_DIST_SHA='${EXPECTED_DIST_SHA}' VERSION='${VERSION}' DO_INSTALL='${DO_INSTALL}' SKIP_WINDOW='${SKIP_WINDOW}' bash -s" \
    < <(printf '%s\n' "$ENV_PRELUDE"; cat "$BODY") >"$LOG" 2>&1 || rc=$?
fi
cat "$LOG"
if [ "$rc" -ne 0 ]; then
  echo ""
  echo "PKG_RESULT=FAIL（正文 rc=${rc}）"
  exit "$rc"
fi

echo ""
echo "=== ② 取回产物 ==="
mkdir -p "$OUT_DIR"
if [ "$TARGET" = "local" ]; then
  cp "/tmp/heyta_${VERSION}_amd64.deb" "$OUT_DIR/"
  cp /tmp/heyta-deb-window.png "$OUT_DIR/packaged-first-run.png" 2>/dev/null || true
else
  scp -q "${TARGET}:/tmp/heyta_${VERSION}_amd64.deb" "$OUT_DIR/"
  scp -q "${TARGET}:/tmp/heyta-deb-window.png" "$OUT_DIR/packaged-first-run.png" 2>/dev/null || true
fi
DEB_PATH="$OUT_DIR/heyta_${VERSION}_amd64.deb"
[ -f "$DEB_PATH" ] || { echo "🔴 没取回 .deb：$DEB_PATH"; exit 1; }
DEB_BYTES=$(wc -c <"$DEB_PATH" | tr -d ' ')
echo "  ✅ $(basename "$DEB_PATH") ${DEB_BYTES} 字节"

echo ""
echo "=== ③ 校验装出来的那个窗口 ==="
# 判据与开发树那一档同一条（非空白 + 主蓝命中），但**边界也一样**：
# 共享 UI 的启动屏本身就是品牌蓝 ⇒ 承重的仍是上面那行 PKG_SETTLED，像素只挡"有落定行而画布是空的"。
if [ -f "$OUT_DIR/packaged-first-run.png" ]; then
  cd "$REPO"
  PIXLOG="/tmp/heyta-deb-pix-$$.log"
  prc=0
  # 判据行的形状与上面正文那一档一致：**先看 rc，再放人读的输出**，别让管道尾的 rc 冒充被测命令的
  # （§7 第 179/184 条那一族），所以这里不走 tee 管道，直接落文件再 cat。
  node - "$OUT_DIR/packaged-first-run.png" >"$PIXLOG" 2>&1 <<'JS' || prc=$?
import { countBrandBlue, inspectPng, looksBlank } from './scripts/screenshots/png-stats.mjs';
// ⚠️ `countBrandBlue` 吃的是**路径**，`inspectPng` 才返回 stats —— 传错不是类型报错在门口，
//    而是它在里面 `readFileSync(<Object>)` 抛 `ERR_INVALID_ARG_TYPE`（本轮就这么红过一次）。
const blue = countBrandBlue(process.argv[2]);
const st = inspectPng(process.argv[2]);
console.log(`  ${st.width}x${st.height}  内容 ${(st.contentRatio * 100).toFixed(3)}  主蓝命中 ${blue}`);
let bad = false;
if (st.hasTransparency) { console.error('  🔴 含实际透明像素'); bad = true; }
if (looksBlank(st)) { console.error('  🔴 疑似空白'); bad = true; }
if (!(blue > 0)) { console.error('  🔴 数不出 heyta 主蓝 ⇒ 不是我们的界面'); bad = true; }
if (bad) process.exit(1);
console.log(`PKG_PIXELS=OK PKG_BLUE_HITS=${blue} PKG_SNAPSHOT=${st.width}x${st.height}`);
JS
  cat "$PIXLOG"
  if [ "$prc" -ne 0 ]; then
    echo "PKG_PIXELS=FAIL"
    echo "PKG_RESULT=FAIL（像素判据）"
    exit 1
  fi
else
  echo "PKG_PIXELS=skipped"
  echo "  ⚠️ 没有 packaged-first-run.png（窗口那一档被跳过或没截到）⇒ 这一轮只回答「打出包了」"
fi

# 判据行落一份 ASCII 事实文件：`check:shell-surfaces` 的 Linux D 档读它（与 windows 的
# dist/windows/install-capture.txt 同构）。⚠️ 只写 ASCII 键值，中文说明留在本文件的注释里。
FACTS="$OUT_DIR/package-facts.txt"
{
  echo "PKG_TARGET=$TARGET"
  echo "PKG_DEB=$(basename "$DEB_PATH")"
  echo "PKG_DEB_BYTES=$DEB_BYTES"
  grep -oE "(PKG_FRESHNESS|PKG_FRESHNESS_INPACKAGE|PKG_INDEX_SHA|PKG_SANDBOX|PKG_RUN_RC|PKG_SHELL_UI|PKG_SETTLED|PKG_SNAPSHOT_TAKEN|PKG_WINDOW)=[A-Za-z0-9._-]+" "$LOG" || true
  grep -oE "^M2_SETTLED_AFTER=[0-9]+" "$LOG" | head -1 || true
  if [ -f "${PIXLOG:-}" ]; then
    grep -oE "PKG_(PIXELS|BLUE_HITS|SNAPSHOT)=[A-Za-z0-9._-]+" "$PIXLOG" || true
  fi
  echo "PKG_RESULT=OK"
} >"$FACTS"
echo "  ✅ 判据行写进 $FACTS"
echo ""
echo "PKG_RESULT=OK"
