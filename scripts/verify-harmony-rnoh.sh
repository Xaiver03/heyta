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
# 鸿蒙 · RN 验收：**RNOH 的原生侧能不能在本机编译并打进 HAP**
# ============================================================
#
# 🔴 它回答的是 ADR-0004 里那个悬了很多轮、且**会改变决策**的问题
#
# ADR-0004 选了 React Native 做跨平台。这个选择在鸿蒙那一侧一直只有一个
# "零件齐全且取得到"的证据链：npm/ohpm 两侧包都能下、`ohpm install` 成功。
# 但计划文档里同时写着：
#
#     「🔴 **仍未验证**：没有跑过 `hvigorw assembleHap`，没有编译过一行 C++，
#       没有生成过 HAP，没有在设备或模拟器上跑起来。」
#
# 而 ADR-0004 自己写着：**若这一步失败，"跨平台"的结论需要重估**
#（可能退化成"RN 覆盖 iOS/Android + 鸿蒙单独用 ArkUI"）。
#
# 所以这条判据不是"锦上添花的覆盖率"，它是**决策的输入**。
#
# ── 它验什么
#
#   1. 从 **RNOH 官方 CLI 的模板**建工程（不手写脚手架）。
#   2. 加 RNOH 的 ohpm 依赖，`ohpm install`。
#   3. `hvigorw assembleHap` —— 这一步会真的用 NDK 的 cmake + ninja
#      编译 RNOH 的 C++（Hermes 是预编译的，其余 290MB 源码都要现编）。
#   4. 🔴 **验证产物**：HAP 里必须真的有
#        `librnoh_core.so`（RNOH 核心，本机编译）
#        `librnoh_app.so` （本应用的原生库，本机编译）
#        `libreactnative.so`（RN 的 C++）
#      并且构建日志里**真的跑过** `BuildNativeWithNinja`（不是把现成的拷进去）。
#
# ── 为什么用"桩"（这一点必须说清楚，否则"它过了"没有意义）
#
# RNOH 的 `@rnoh/hvigor-plugin` 负责 **codegen / autolinking**：它按 JS 侧的
# `package.json` 生成原生模块的注册代码。本脚本**不接 JS 侧**，因此：
#   - CMakeLists 的 `autolink_libraries(rnoh_app)` 用 no-op 顶替；
#   - `PackageProvider.cpp` 用空实现顶替（真货包含两个 codegen 头）。
#
# 🔴 这不是"绕过了难点"，而是**把难点隔离出来**：本脚本要回答的是
#    "RNOH 的 C++ 在本机能不能编译并打包"，代号生成的正确性属于 JS 侧那一环，
#    由 `scripts/verify-harmony-rnoh-js.sh` 用官方 CLI 的 codegen 验（已落地，见 §3.25）。
#    **本脚本不对"RN 应用能跑起来"下任何结论。**
#
# ── 它**不**验什么（诚实边界）
#
#   - 不验运行：需要 ① 模拟器系统镜像 ② 签名配置 ③ JS bundle。
#     本机**没有**任何已创建的模拟器实例/镜像（`~/.Huawei` 不存在），
#     产物是 `*-unsigned.hap`（本机无签名配置）→ 装不进设备。
#   - 不验 JS 侧 codegen / autolinking（见上）—— 那一环见 scripts/verify-harmony-rnoh-js.sh。
#
# 用法：
#   pnpm verify:harmony-rnoh
#
# 依赖：DevEco Studio（含 SDK/NDK）+ 本机 node（用于 `npm pack` 取官方模板）。

set -u
cd "$(dirname "$0")/.." || exit 1

DEVECO_HOME="${DEVECO_HOME:-/Applications/DevEco-Studio.app/Contents}"
# 🔴 必须用**短路径**（hvigor 内部 pnpm 的 ENAMETOOLONG，见 §7 第 62 条）。
WORK="${HEYTA_HARMONY_RN_WORK:-/tmp/heyta-harmony-rnoh}"
RNOH_VERSION="${RNOH_VERSION:-0.84.4}"   # CLI 模板版本；ohpm 侧的 har 用 0.84.3

PASS=0; FAIL=0
step() { echo ""; echo "════ $1 ════"; }
ok()   { echo "   ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "   ❌ $1"; FAIL=$((FAIL+1)); }

echo ""
echo "=== 鸿蒙 RN 验收（RNOH 原生侧 → HAP）==="
echo "  DevEco: $DEVECO_HOME"
echo "  工作目录: $WORK"
echo "  RNOH CLI 模板版本: $RNOH_VERSION"

# ── 第 0 步：前置 ───────────────────────────────────────────

step "0. 前置"
for t in "$DEVECO_HOME/tools/ohpm/bin/ohpm" "$DEVECO_HOME/tools/hvigor/bin/hvigorw"; do
  [ -x "$t" ] && ok "$(basename "$t") 在位" || { bad "$t 缺失"; exit 3; }
done
NDK="$DEVECO_HOME/sdk/default/openharmony/native"
for t in "$NDK/build-tools/cmake/bin/cmake" "$NDK/build-tools/cmake/bin/ninja" "$NDK/llvm"; do
  [ -e "$t" ] && ok "NDK: $(basename "$t")" || { bad "NDK 缺 $t"; exit 3; }
done
command -v npm >/dev/null 2>&1 && ok "npm 在位（用来取官方模板）" || { bad "缺 npm"; exit 3; }

export NODE_HOME="$DEVECO_HOME/tools/node"
export DEVECO_SDK_HOME="$DEVECO_HOME/sdk"
export PATH="$NODE_HOME/bin:$DEVECO_HOME/tools/ohpm/bin:$DEVECO_HOME/tools/hvigor/bin:$PATH"

SDK_PKG="$DEVECO_HOME/sdk/default/sdk-pkg.json"
API=$(python3 -c "import json;print(json.load(open('$SDK_PKG'))['data']['apiVersion'])" 2>/dev/null)
SDK_NAME=$(python3 -c "import json;print(json.load(open('$SDK_PKG'))['data']['displayName'])" 2>/dev/null)
[ -n "${API:-}" ] && ok "SDK: ${SDK_NAME}（API ${API}）" || { bad "读不到 SDK 版本"; exit 3; }
SDK_VER=$(printf '%s' "${SDK_NAME:-}" | sed 's/HarmonyOS //')
SDK_FULL="${SDK_VER}(${API})"

# ── 第 1 步：取官方 CLI 模板 ────────────────────────────────

step "1. 取 RNOH 官方 CLI 里的工程模板（不手写脚手架）"
CLI_DIR="$WORK/_cli"
rm -rf "$CLI_DIR"; mkdir -p "$CLI_DIR"
cd "$CLI_DIR" || exit 1
if npm pack "@react-native-oh/react-native-harmony-cli@$RNOH_VERSION" >/dev/null 2>&1; then
  ok "npm pack 成功"
else
  bad "取不到 @react-native-oh/react-native-harmony-cli@$RNOH_VERSION"
  exit 3
fi
tar xzf ./*.tgz
TEMPLATE="$CLI_DIR/package/src/init/templates/harmony"
if [ -d "$TEMPLATE" ]; then
  ok "官方模板就位（$(find "$TEMPLATE" -type f | wc -l | tr -d ' ') 个文件）"
else
  bad "CLI 包里没有 harmony 模板"
  exit 3
fi

# ── 第 2 步：建工程 ─────────────────────────────────────────

step "2. 建工程（官方模板 + 两个 codegen 桩）"
PROJ="$WORK/proj"
rm -rf "$PROJ"; mkdir -p "$PROJ"
cp -R "$TEMPLATE"/. "$PROJ"/
find "$PROJ" -name "gitignore" -delete

python3 - "$PROJ" "$SDK_FULL" <<'PY'
import io, os, re, sys
proj, full = sys.argv[1], sys.argv[2]

# SDK 版本对齐实际安装值（模板里留着旧版本号）
bp = os.path.join(proj, 'build-profile.json5')
s = io.open(bp, encoding='utf-8').read()
s = re.sub(r"compatibleSdkVersion:\s*'[^']*'", f"compatibleSdkVersion: '{full}'", s)
s = re.sub(r"targetSdkVersion:\s*'[^']*'", f"targetSdkVersion: '{full}'", s)
io.open(bp, 'w', encoding='utf-8').write(s)

# bundleName：模板里是 `com.example`（两段，过不了 hvigor 的 schema 校验 —— 真货由 CLI 填）
aj = os.path.join(proj, 'AppScope/app.json5')
s = io.open(aj, encoding='utf-8').read()
s = s.replace('"bundleName": "com.example"', '"bundleName": "com.heyta.harmony"')
s = s.replace('"vendor": "example"', '"vendor": "heyta"')
io.open(aj, 'w', encoding='utf-8').write(s)

# 根 oh-package.json5：模板没有这个文件（由 CLI 的 OhPackageJson5Template 生成）
io.open(os.path.join(proj, 'oh-package.json5'), 'w', encoding='utf-8').write('''{
  "modelVersion": "5.0.0",
  "description": "heyta HarmonyOS shell",
  "dependencies": {
    "@rnoh/react-native-openharmony": "0.84.3"
  },
  "devDependencies": {}
}
''')

# 去掉 `@rnoh/hvigor-plugin`（它做 codegen/autolinking，本脚本用桩）
io.open(os.path.join(proj, 'hvigorfile.ts'), 'w', encoding='utf-8').write(
    "import { appTasks } from '@ohos/hvigor-ohos-plugin';\n"
    "export default { system: appTasks, plugins: [] };\n")
io.open(os.path.join(proj, 'entry/hvigorfile.ts'), 'w', encoding='utf-8').write(
    "import { hapTasks } from '@ohos/hvigor-ohos-plugin';\n"
    "export default { system: hapTasks, plugins: [] };\n")

# codegen 桩 ①：cmake 的 autolink
cpp = os.path.join(proj, 'entry/src/main/cpp')
os.makedirs(os.path.join(cpp, 'generated'), exist_ok=True)
io.open(os.path.join(cpp, 'autolinking.cmake'), 'w', encoding='utf-8').write(
    "function(autolink_libraries target)\n"
    "  message(STATUS \"[probe] autolink ${target} -> no-op\")\n"
    "endfunction()\n")
# codegen 桩 ②：原生包注册
io.open(os.path.join(cpp, 'PackageProvider.cpp'), 'w', encoding='utf-8').write(
    '#include "RNOH/PackageProvider.h"\n'
    '#include <memory>\n#include <vector>\n'
    'using namespace rnoh;\n'
    'std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context) {\n'
    '  return {};\n}\n')

# codegen 桩 ③④：ets 侧的包工厂 + 入口页
ets = os.path.join(proj, 'entry/src/main/ets')
os.makedirs(os.path.join(ets, 'pages'), exist_ok=True)
io.open(os.path.join(ets, 'RNOHPackagesFactory.ets'), 'w', encoding='utf-8').write(
    "import type { RNPackageContext, RNOHPackage } from '@rnoh/react-native-openharmony';\n"
    "export function createRNOHPackages(_ctx: RNPackageContext): RNOHPackage[] { return []; }\n")
io.open(os.path.join(ets, 'pages/Index.ets'), 'w', encoding='utf-8').write('''
@Entry
@Component
struct Index {
  build() {
    Column() { Text('heyta RNOH') }.width('100%').height('100%')
  }
}
''')
print("   codegen 桩已写入（autolinking / PackageProvider / 包工厂 / 入口页）")
PY

# ── 第 3 步：装依赖并出包 ───────────────────────────────────

step "3. ohpm install → hvigorw assembleHap（会真编 C++）"
cd "$PROJ" || exit 1
if ohpm install > /tmp/heyta-rnoh-ohpm.log 2>&1; then
  ok "ohpm install 成功（RNOH har $(du -sh oh_modules 2>/dev/null | cut -f1)）"
else
  bad "ohpm install 失败"; tail -5 /tmp/heyta-rnoh-ohpm.log | sed 's/^/      /'
fi

LOG=/tmp/heyta-rnoh-hvigor.log
if hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon > "$LOG" 2>&1; then
  ok "hvigorw assembleHap 退出码 0"
else
  bad "hvigorw assembleHap 失败"
  grep -E "ERROR|error:" "$LOG" | head -8 | sed 's/^/      /'
fi

# 🔴 "编译过 C++"这件事，日志里有直接证据 —— 退出码里没有。
NINJA_LINE=$(grep -oE "BuildNativeWithNinja\.\.\. after [^ ]+ [^ ]+" "$LOG" | head -1)
if [ -n "$NINJA_LINE" ]; then
  ok "日志确认跑过原生编译：$NINJA_LINE"
else
  bad "日志里没有 BuildNativeWithNinja —— C++ 可能根本没编（只是拷了现成的？）"
fi

# ── 第 4 步：验证产物 ──────────────────────────────────────

step "4. 验证 HAP 里的原生库（退出码不携带这个信息）"
HAP=$(find "$PROJ" -name "*.hap" -not -path "*/oh_modules/*" 2>/dev/null | head -1)
if [ -z "$HAP" ]; then
  bad "没有产出任何 .hap"; echo ""; echo "  通过 ${PASS}，失败 $FAIL"; exit 1
fi
ok "产出 $(basename "$HAP")（$(ls -lh "$HAP" | awk '{print $5}')）"

unzip -l "$HAP" > /tmp/heyta-rnoh-haplist.txt 2>/dev/null
# 这三个 .so 是"RNOH 原生侧真的编出来了"的证据：
#   librnoh_core  —— RNOH 核心（本机编译）
#   librnoh_app   —— 本应用的原生库（本机编译，链了 rnoh）
#   libreactnative—— RN 的 C++（本机编译）
for lib in librnoh_core.so librnoh_app.so libreactnative.so; do
  if grep -q "$lib" /tmp/heyta-rnoh-haplist.txt; then
    SZ=$(grep "$lib" /tmp/heyta-rnoh-haplist.txt | head -1 | awk '{print $1}')
    ok "含 ${lib}（${SZ} 字节）"
  else
    bad "缺 $lib —— RNOH 原生侧没进包"
  fi
done

# ArkTS 侧：RNOH 的 ets 也在包里。纯 ArkTS 空工程的 modules.abc 约 12KB，
# 带 RNOH 的约 900KB —— 用"比一个空工程大得多"当旁证（不是判据的主要部分）。
ABC=$(grep "ets/modules.abc" /tmp/heyta-rnoh-haplist.txt | awk '{print $1}')
if [ -n "$ABC" ] && [ "$ABC" -gt 200000 ] 2>/dev/null; then
  ok "ets/modules.abc ${ABC} 字节（RNOH 的 ArkTS 已编入）"
else
  bad "ets/modules.abc 偏小或缺失（${ABC:-无}）—— RNOH 的 ArkTS 似乎没进包"
fi

# ── 汇总 ───────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════"
echo "  通过 $PASS 项，失败 $FAIL 项"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ RNOH 原生侧：本机能编译并打进 HAP"
  echo ""
  echo "  ⚠️ 本脚本的边界（别把它读成「RN 在鸿蒙上能跑」）："
  echo "     · 不验运行 —— 缺模拟器镜像 + 签名，产物是 unsigned"
  echo "     · 不验 JS 侧 codegen/autolinking（本脚本用桩顶替）"
  exit 0
fi
echo "  ❌ 有失败项"
exit 1