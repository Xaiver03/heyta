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

# 🔴 用 `research/tools/bundle-spike.mjs`（esbuild 的 **JS API**），**不要**调 CLI。
#    原先这里写死 `packages/domain/node_modules/.bin/esbuild`，而那个链接是**主仓库的
#    陈旧状态** —— `packages/domain/package.json` 从没声明过 esbuild（它是 tsup 的依赖），
#    干净检出的树里没有它。于是"本机绿、CI 红"。
#    抓出它的是"在干净检出的 git worktree 里跑一遍完整 pnpm check"。
node "$ROOT/research/tools/bundle-spike.mjs" \
  --entry "$ROOT/packages/domain/src/index.ts" \
  --out "$BUNDLE" \
  --global HeytaDomain

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
