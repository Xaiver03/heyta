#!/bin/bash
#
# 鸿蒙工具链验收：本机到底能不能产出**真正的 HAP**
# ================================================
#
# 🔴 为什么需要它
#
# 计划文档里有一条悬了很多轮的说法：「**没有编译过一行 C++，没有生成过 HAP，
# 没有在设备或模拟器上跑起来**」。已确认的只是"零件齐全且取得到"。
#
# 这条说法没法靠"我们有 DevEco Studio"来反驳 —— 装了 IDE 不等于能出包。
# 所以这里把"出包"这件事**变成一个每次都能重跑的判据**。
#
# ── 它验什么
#
#   0. 前置：DevEco Studio、SDK、NDK、cmake、ninja、ohpm、hvigorw、node 都在位；
#      并把实际 SDK API 版本**读出来**（不是假设）。
#   1. 用 DevEco **自带的官方模板**建一个最小 ArkTS 工程（不手写脚手架：
#      手写的会和真实工程漂移，而漂移的脚手架比没有脚手架更危险）。
#   2. `ohpm install` → `hvigorw assembleHap`。
#   3. 🔴 **验证产物本身**：`.hap` 存在、是真 zip、里面有 `module.json`
#      与 `ets/modules.abc`（真编译出来的 ArkTS 字节码）。
#      只看 `BUILD SUCCESSFUL` 不算 —— 退出码不携带"产物长什么样"的信息。
#
# ── 它**不**验什么（诚实边界）
#
#   - **不验 RN**。「RN 能不能在鸿蒙上编译/跑」是另一个更关键的问题，
#     见 `scripts/verify-harmony-rnoh.sh`。
#   - **不验能安装/运行**：本机没有签名配置，产物是 `*-unsigned.hap`。
#     能装进设备还差签名 + 设备。
#
# 用法：
#   pnpm verify:harmony-toolchain
#
# 需要 DevEco Studio 装在 /Applications/DevEco-Studio.app（可用 DEVECO_HOME 覆盖）。

set -u
cd "$(dirname "$0")/.." || exit 1

DEVECO_HOME="${DEVECO_HOME:-/Applications/DevEco-Studio.app/Contents}"
# 🔴 必须用**短路径**：hvigor 内部 pnpm 会拿插件 tarball 的绝对路径当 store 文件名，
#    macOS 的 ${TMPDIR}（/var/folders/5n/...）会把它顶到 255 字节上限（见 §7 第 62 条）。
WORK="${HEYTA_HARMONY_WORK:-/tmp/heyta-harmony-toolchain}"

# 与共享库无关，本脚本自带最简 ok/bad，便于单独运行。
PASS=0; FAIL=0
step() { echo ""; echo "════ $1 ════"; }
ok()   { echo "   ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "   ❌ $1"; FAIL=$((FAIL+1)); }

echo ""
echo "=== 鸿蒙工具链验收（能不能产出真 HAP）==="
echo "  DevEco: $DEVECO_HOME"
echo "  工作目录: $WORK"

# ── 第 0 步：前置 ───────────────────────────────────────────

step "0. 工具链在位（缺任何一样，后面都无从谈起）"

if [ -d "$DEVECO_HOME" ]; then
  ok "DevEco Studio 存在"
else
  echo "   ❌ 找不到 DevEco Studio：$DEVECO_HOME"
  echo "      装好 DevEco Studio，或用 DEVECO_HOME 指定 Contents 目录。"
  exit 3
fi

export NODE_HOME="$DEVECO_HOME/tools/node"
export DEVECO_SDK_HOME="$DEVECO_HOME/sdk"
export PATH="$NODE_HOME/bin:$DEVECO_HOME/tools/ohpm/bin:$DEVECO_HOME/tools/hvigor/bin:$PATH"

for t in "$NODE_HOME/bin/node" "$DEVECO_HOME/tools/ohpm/bin/ohpm" \
         "$DEVECO_HOME/tools/hvigor/bin/hvigorw"; do
  if [ -x "$t" ]; then ok "$(basename "$t") 在位"; else bad "$t 不存在"; fi
done

# 🔴 SDK 版本**读出来**，不写死。写死的话，SDK 一升级脚本就开始骗人
#    （模板里还留着 5.0.0(12) 这种三年前的版本号）。
SDK_PKG="$DEVECO_HOME/sdk/default/sdk-pkg.json"
if [ -f "$SDK_PKG" ]; then
  API=$(python3 -c "import json;print(json.load(open('$SDK_PKG'))['data']['apiVersion'])" 2>/dev/null)
  # 🔴 两个坑都在这一行：
  #   1. 变量名叫 `SDK_NAME` 而不是 `DISPLAY` —— `DISPLAY` 是 X11 的环境变量，
  #      覆盖它会在任何用到它的下游工具上产生莫名其妙的行为。
  #   2. 引用必须写成 `${SDK_NAME}` —— **macOS 自带的 bash 3.2** 在非 UTF-8
  #      locale 下会把紧跟其后的全角字符（`（`）的字节当成变量名的一部分，
  #      于是 `${DISPLAY}（` 被解析成一个叫 `DISPLAY（` 的变量，
  #      在 `set -u` 下直接 `unbound variable` 退出。加花括号在**所有**版本上都是对的。
  SDK_NAME=$(python3 -c "import json;print(json.load(open('$SDK_PKG'))['data']['displayName'])" 2>/dev/null)
  ok "SDK: ${SDK_NAME}（API ${API}）"
else
  bad "读不到 sdk-pkg.json（SDK 没装全？）"
  API=""
fi

NDK="$DEVECO_HOME/sdk/default/openharmony/native"
CMK="$NDK/build-tools/cmake/bin/cmake"
NINJA="$NDK/build-tools/cmake/bin/ninja"
for t in "$CMK" "$NINJA" "$NDK/llvm" "$NDK/sysroot"; do
  if [ -e "$t" ]; then ok "NDK: $(basename "$t") 在位"; else bad "NDK 缺 $t"; fi
done

# ── 第 1 步：用官方模板建最小工程 ────────────────────────────

step "1. 从 DevEco 自带模板建最小 ArkTS 工程"
TEMPLATE="$DEVECO_HOME/plugins/codegenie-plugin/previewProjectTemplate"
if [ -d "$TEMPLATE" ]; then
  ok "官方模板已找到"
else
  echo "   ❌ 找不到官方模板：$TEMPLATE"
  echo "      不手写脚手架 —— 手写的会和真实工程漂移。"
  exit 3
fi

rm -rf "$WORK"
mkdir -p "$WORK"
cp -R "$TEMPLATE"/. "$WORK"/

# 模板里的 SDK 版本可能是旧的（例如 5.0.0(12)），按**实际** SDK 改写。
if [ -n "$API" ]; then
  python3 - "$WORK/build-profile.json5" "$API" "${SDK_NAME:-}" <<'PY'
import io, re, sys
path, api, display = sys.argv[1], sys.argv[2], sys.argv[3]
ver = display.replace('HarmonyOS ', '')          # "HarmonyOS 6.1.1" -> "6.1.1"
full = f"{ver}({api})"
s = io.open(path, encoding='utf-8').read()
before = s
s = re.sub(r'"compatibleSdkVersion"\s*:\s*"[^"]*"', f'"compatibleSdkVersion": "{full}"', s)
s = re.sub(r'"targetSdkVersion"\s*:\s*"[^"]*"', f'"targetSdkVersion": "{full}"', s)
if s == before:
    print(f"⚠️ 没改到版本号（模板格式变了？）——期望 {full}")
    sys.exit(4)
io.open(path, 'w', encoding='utf-8').write(s)
print(f"   SDK 版本已对齐: {full}")
PY
  if [ $? -ne 0 ]; then
    bad "改不动模板里的 SDK 版本 —— 模板格式变了，脚本需要跟进"
  else
    ok "SDK 版本已对齐到实际安装的 $API"
  fi
fi

# ── 第 2 步：出包 ───────────────────────────────────────────

step "2. ohpm install → hvigorw assembleHap"
cd "$WORK" || exit 1
if ohpm install > /tmp/heyta-harmony-ohpm.log 2>&1; then
  ok "ohpm install 成功"
else
  bad "ohpm install 失败（看 /tmp/heyta-harmony-ohpm.log）"
  tail -5 /tmp/heyta-harmony-ohpm.log | sed 's/^/      /'
fi

if hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon \
     > /tmp/heyta-harmony-hvigor.log 2>&1; then
  ok "hvigorw assembleHap 退出码 0"
else
  bad "hvigorw assembleHap 失败（看 /tmp/heyta-harmony-hvigor.log）"
  grep -E "ERROR|error:" /tmp/heyta-harmony-hvigor.log | head -8 | sed 's/^/      /'
fi

# ── 第 3 步：验证**产物**，不是退出码 ────────────────────────

step "3. 验证产物本身（退出码不携带「产物长什么样」的信息）"
HAP=$(find "$WORK" -name "*.hap" -not -path "*/oh_modules/*" 2>/dev/null | head -1)

if [ -n "$HAP" ]; then
  SZ=$(stat -f%z "$HAP" 2>/dev/null || stat -c%s "$HAP" 2>/dev/null)
  ok "产出 HAP: $(basename "$HAP")（${SZ} 字节）"

  if file "$HAP" | grep -q "Zip archive"; then
    ok "是真 zip（HAP 就是 zip 容器）"
  else
    bad "不是 zip —— 产物可疑"
  fi

  LIST=$(unzip -l "$HAP" 2>/dev/null)
  # `ets/modules.abc` 是**编译出来的 ArkTS 字节码**。它在，才说明真的编译过 ArkTS，
  # 而不是把源码原样打了包。
  if printf '%s' "$LIST" | grep -q "ets/modules.abc"; then
    ok "含 ets/modules.abc（真编译出的 ArkTS 字节码）"
  else
    bad "缺 ets/modules.abc —— ArkTS 没被编译"
  fi
  if printf '%s' "$LIST" | grep -q "module.json"; then
    ok "含 module.json（HAP 的模块清单）"
  else
    bad "缺 module.json"
  fi
else
  bad "没有任何 .hap 产出"
fi

# ── 汇总 ───────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════"
echo "  通过 $PASS 项，失败 $FAIL 项"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ 鸿蒙工具链：本机能产出真 HAP"
  echo "  ⚠️ 边界：产物是 unsigned（本机无签名），且**本脚本不验 RN** ——"
  echo "      RN 那一层见 scripts/verify-harmony-rnoh.sh"
  exit 0
fi
echo "  ❌ 有失败项"
exit 1