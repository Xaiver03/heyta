#!/usr/bin/env bash
# heyta Linux 载体 —— 工具链安装与体检（幂等，可反复跑）
#
# 用途：把一枚干净的 Ubuntu 24.04 变成能跑 `check:linux-shell`（Linux 原生壳的
# C ↔ TS 那一层）与 `apps/desktop-linux/scripts/capture-window.sh`（Xvfb 起窗口取证）
# 的载体。形状对齐 scripts/windows/setup-build-host.ps1：每步先检查、已就位就跳过。
#
# 用法（在那台机上，普通用户）：
#   bash scripts/linux/setup-build-host.sh --step verify     # 只体检，不动系统
#   sudo bash scripts/linux/setup-build-host.sh --step all   # 装齐
#   sudo bash scripts/linux/setup-build-host.sh --step gtk   # 只装壳的编译依赖
#
# 步骤：all | base | gtk | gui | verify
#
# 🔴 壳的编译依赖**不在本文件里列清单**：模块名从 `apps/desktop-linux/Makefile` 的 `PKGS` 现读，
#   `-dev` 包名从 `scripts/linux/shell-modules.mjs` 的映射表取（同一份真源也喂给 check:linux-shell）。
#   改之前这里是三处各抄一遍；P2 给壳加 WebKitGTK 时，只有"加进 Makefile + 加进映射表"这一条路，
#   漏掉映射表会被那枚文件的自检 A3 当场抓住。
#   许可侧：WebKitGTK 与 JavaScriptCoreGTK 是 LGPL-2.1+ —— 放行它的不是本脚本，
#   是 [ADR-0057]（"系统运行时库的动态链接"那一类）与 `docs/reference/native-library-licenses.md`
#   的逐项登记；**登记与 `.deb` 的 Depends 接线必须同批**，否则双向对账两头都会红。
#
# 机器身份（主机名 / 用户 / 地址 / ZeroTier）一律住 docs/reference/build-matrix.md，
# 本脚本不钉任何具体主机。
#
# ⚠️ 非交互 SSH 会话不读 ~/.profile，而 Node 常装在 ~/.local/bin ⇒
#    `command -v node` 会读成 MISSING 而登录 shell 里有。先 `bash -lc` 再判，
#    否则会把"PATH 没带上"误读成"这台机没装 Node"（docs/runbooks/linux-dev-box.md §2）。

set -uo pipefail

# 🔴 这枚脚本要 bash 4+（用了 mapfile）。macOS 自带的是 3.2 —— 在 3.2 上 `mapfile` 根本不存在，
#   于是读清单那一步不报错、只留下一个空数组，最后打出「模块清单取到 0 条」这种**误导性红**：
#   真相是"这台机的 shell 太老"，不是"这棵树的壳没有依赖"。所以在这里先响亮地把版本挡在前面。
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  echo "❌ 需要 bash 4+（本脚本用 mapfile），当前是 ${BASH_VERSION:-未知}。" >&2
  echo "   这台机不是本脚本的目标平台 —— 目标是一台 Linux 载体（docs/runbooks/linux-dev-box.md §1）。" >&2
  exit 1
fi

STEP='verify'
while [ $# -gt 0 ]; do
  case "$1" in
    --step)
      STEP="${2:-}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,26p' "$0"
      exit 0
      ;;
    *)
      echo "❌ 未知参数：$1（用 --step base|gtk|gui|verify|all）" >&2
      exit 64
      ;;
  esac
done

case "$STEP" in
  all|base|gtk|gui|browser|verify) ;;
  *) echo "❌ --step 只接受 all|base|gtk|gui|browser|verify，收到 '${STEP}'" >&2; exit 64 ;;
esac

# 需要 sudo 的步骤却没用 root 跑时，响亮失败而不是装一半。
# 壳依赖清单的唯一入口（模块名来自 apps/desktop-linux/Makefile，包名来自那份映射表）。
# ⚠️ 调用方必须自己判"0 条"：空清单与"这枚壳不需要任何依赖"在输出上长得一样，而只有后者该绿。
shell_modules() {
  local script
  script="$(dirname "${BASH_SOURCE[0]}")/shell-modules.mjs"
  if ! have_cmd node; then
    echo "❌ 没有 node ⇒ 取不到壳的依赖清单（${script}）。这一格判红，不按「无依赖」放行。" >&2
    return 1
  fi
  if [ ! -f "$script" ]; then
    echo "❌ 清单脚本不在位：$script" >&2
    return 1
  fi
  node "$script" "$@" || return 1
}

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "❌ --step ${STEP} 要写系统包，必须用 root 跑：sudo bash $0 --step ${STEP}" >&2
    exit 1
  fi
}

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# "不在 PATH 上"和"这台机没装"是两件事，读数必须分开报。
# 非交互 SSH 不读 ~/.profile，而 ~/.local/bin 那类用户级安装恰恰只在那里出现。
probe_cmd() {
  local c="$1"
  if have_cmd "$c"; then
    printf '  ✅ %-12s %s\n' "$c" "$(command -v "$c")"
    return 0
  fi
  if [ -x "$HOME/.local/bin/$c" ]; then
    printf '  ❌ %-12s 没在 PATH 上，但 %s 存在 ⇒ 这是 PATH 问题，不是没装\n' "$c" "$HOME/.local/bin/$c"
    printf '     用 bash -lc 跑，或 export PATH="$HOME/.local/bin:$PATH"\n'
  else
    printf '  ❌ %-12s 不在 PATH 上\n' "$c"
  fi
  return 1
}

# dpkg 查询在未装时退 1；--step verify 要在 set -u 下也能问完所有格。
have_pkg() { dpkg -s "$1" >/dev/null 2>&1; }

apt_install() {
  # 已装的不重复下载（幂等）；全都在位时连 apt 都不叫。
  local missing=()
  local p
  for p in "$@"; do
    have_pkg "$p" || missing+=("$p")
  done
  if [ ${#missing[@]} -eq 0 ]; then
    echo "  · 已就位，跳过：$*"
    return 0
  fi
  echo "  · 待装：${missing[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}" || return 1
  for p in "${missing[@]}"; do
    have_pkg "$p" || { echo "  ❌ apt 说装了但 dpkg 查不到 ${p}" >&2; return 1; }
  done
}

step_base() {
  echo "[base] 编译器与 pkg-config"
  need_root
  apt_install build-essential pkg-config
}

step_gtk() {
  echo "[gtk] Linux 原生壳的编译依赖（模块清单与 apps/desktop-linux/Makefile 的 PKGS 同源）"
  need_root
  local -a debs=()
  mapfile -t debs < <(shell_modules --debs)
  if [ "${#debs[@]}" -eq 0 ]; then
    echo "❌ 取不到 -dev 包清单（上面已点名原因）⇒ 不装、不放行。"
    return 1
  fi
  echo "     本次要装的：${debs[*]}"
  apt_install "${debs[@]}"
}

step_gui() {
  echo "[gui] 无头窗口取证（capture-window.sh：Xvfb + ImageMagick 的 import）"
  need_root
  apt_install xvfb imagemagick
}

# Playwright 那一族门禁（check:ai-e2e / privacy-consent-e2e / landing-e2e）在 Linux 上
# 缺的不是脚本、是 Chromium 的运行时库。二进制本身由 pnpm 自己拉，见 runbook §4。
step_browser() {
  echo "[browser] Chromium 运行时库（e2e 那三族门禁）"
  need_root
  apt_install \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2t64 fonts-liberation libnspr4
}

# 体检：每一格都要能单独把整体判红 —— 一条永远绿的自检等于没有自检。
step_verify() {
  echo "[verify] 只读体检（不写系统）"
  local fail=0
  local -a cmds=(git node pnpm corepack make gcc pkg-config dpkg-deb Xvfb import sha256sum)
  local -a pkgs=()
  mapfile -t pkgs < <(shell_modules)
  if [ "${#pkgs[@]}" -eq 0 ]; then
    echo '  ❌ 壳的模块清单取到 0 条 ⇒ 判红（空清单不等于"这枚壳不需要依赖"）'
    fail=1
  fi
  local c
  for c in "${cmds[@]}"; do
    probe_cmd "$c" || fail=1
  done
  local p
  for p in "${pkgs[@]}"; do
    if have_cmd pkg-config && pkg-config --exists "$p"; then
      printf '  ✅ %-22s %s\n' "$p" "$(pkg-config --modversion "$p")"
    elif have_cmd pkg-config; then
      printf '  ❌ %-22s 缺 -dev 包（pkg-config 查不到）\n' "$p"
      fail=1
    else
      # 🔴 不要把"查询工具本身不在"报成"这几枚包都缺" —— 那是一枚会骗人的读数：
      #    真实缺的只有上一行点名的 pkg-config，装完它这几格可能全是绿的。
      printf '  ❔ %-22s 无法判断（这台机没有 pkg-config）\n' "$p"
      fail=1
    fi
  done
  # Node 版本门：根 package.json 的 engines 是唯一权威，这里不抄数字。
  if have_cmd node; then
    local want
    want=$(node -e 'process.stdout.write(String(require("./package.json").engines.node||""))' 2>/dev/null || echo '')
    if [ -z "$want" ]; then
      echo '  ❌ 读不到 package.json 的 engines.node —— 无法判断版本门'
      fail=1
    else
      printf '  · engines.node = %s；本机 node %s\n' "$want" "$(node -v)"
      node -e 'const m=process.versions.node.split(".").map(Number);if(m[0]<22)process.exit(1)' \
        || { echo '  ❌ node 主版本低于 engines 要求'; fail=1; }
    fi
  fi

  if [ "$fail" -ne 0 ]; then
    echo
    echo "❌ 体检不通过 ⇒ 这台机还不能当 heyta 的 Linux 载体。"
    echo "   装齐：sudo bash scripts/linux/setup-build-host.sh --step all"
    echo "   （--step 可单跑：base / gtk / gui / browser）"
    exit 1
  fi
  echo
  echo "✅ 体检通过：可跑 pnpm check:linux-shell（严格档加 HEYTA_REQUIRE_LINUX_SHELL=1）。"
}

case "$STEP" in
  base) step_base ;;
  gtk) step_gtk ;;
  gui) step_gui ;;
  all) step_base && step_gtk && step_gui && step_browser ;;
  verify) step_verify ;;
esac
