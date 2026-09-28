#!/usr/bin/env bash
#
# W0-4 spike（D2 路线）的一键复现。
#
# 问的问题（这是多端原生构建计划里**唯一真正的未知数**）：
#
#   packages/domain 是 6603 行纯 TS 业务逻辑，被 web / mobile / 鸿蒙 / widget-core 共用。
#   Windows 要换成 C# 原生壳，C# 进程**跑不了 TS**。于是只有两条路：
#
#     D1  C# 移植 + golden fixture 校验  → 核心逻辑变成**两份源**（永久双份维护）
#     D2  C# UI + 内嵌 JS 引擎跑同一份 bundle → 领域逻辑仍是**单源**
#
#   本 spike 验的是 D2 的前半段是否成立：
#   **同一份 bundle 字节，在没有宿主能力的裸环境里跑得起来，且两台引擎结果一致。**
#
#   D2 成立则 D1 的"永久双份维护"可以避免；不成立就只能认 D1 的代价。
#
# 前置：node、npx（esbuild 由仓库 node_modules 提供）、dotnet SDK ≥ 8
#
# 用法：bash research/spikes/domain-single-source/run.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

OUT_DIR="${DOMAIN_SPIKE_OUT:-$(mktemp -d -t heyta-domain-spike.XXXXXX)}"
BUNDLE="$OUT_DIR/domain.iife.js"
BARE_REPORT="$OUT_DIR/bare-report.json"
CS_REPORT="$OUT_DIR/cs-report.json"

echo "▸ 输出目录：$OUT_DIR"
echo "▸ 1/4 构建自包含 bundle（--platform=neutral：不注入 Node/浏览器垫片）"

# 🔴 esbuild 只装在 packages/domain 自己的 node_modules 里（pnpm 的隔离布局，
# 根目录**没有** .bin/esbuild）。所以不能用 `npx esbuild` ——
# 实测那会以 `sh: esbuild: command not found` 失败（exit 127）。
ESBUILD="$ROOT/packages/domain/node_modules/.bin/esbuild"
if [ ! -x "$ESBUILD" ]; then
  echo "找不到 esbuild：$ESBUILD" >&2
  echo "先在仓库根跑一次：pnpm install --store-dir .pnpm-store" >&2
  exit 1
fi

# --platform=neutral 是关键：esbuild 不会替我们补 process/Buffer 之类的垫片。
# 于是"bundle 需要宿主能力"这件事会在**构建期**就暴露，而不是留到引擎里才炸。
"$ESBUILD" "$ROOT/packages/domain/src/index.ts" \
  --bundle --format=iife --global-name=HeytaDomain \
  --outfile="$BUNDLE" --platform=neutral --target=es2020 --log-level=warning

# TZ=UTC：领域层有大量本地日历日运算，两侧必须同一个时区才可比。
# （同一个坑已经踩过一次：packages/widget-core 的 golden fixture 就是因为时区而字节漂移。）
echo "▸ 2/4 裸 V8 上下文（无宿主全局）"
TZ=UTC node "$HERE/harness.mjs" "$BUNDLE" "$HERE/cases.json" "$BARE_REPORT"

echo "▸ 3/4 .NET + Jint"
DOMAIN_BUNDLE="$BUNDLE" DOMAIN_CASES="$HERE/cases.json" DOMAIN_OUT="$CS_REPORT" \
  TZ=UTC DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 \
  dotnet run -c Release --project "$HERE/cs/DomainSpike.csproj"

echo "▸ 4/4 比对"
node "$HERE/compare.mjs" "$BARE_REPORT" "$CS_REPORT"

echo
echo "证据留在：$OUT_DIR"
