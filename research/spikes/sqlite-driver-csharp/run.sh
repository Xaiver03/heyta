#!/usr/bin/env bash
#
# W0-2 spike 的一键复现：**C# 的同步 SqliteDriver + 真正的 TS SqliteAdapter**。
#
# 问的问题：
#   D2 路线（C# UI + 内嵌 JS 引擎跑同一份 TS）落到**存储层**成不成立？
#
#   `packages/storage` 的 SqliteDriver 接口是同步的（exec/run/all/close），
#   而 Windows 侧过去被判定"要自己写一个同步实现、且这是全计划的门槛"
#   （ADR-0032 的 C1）。拆开看其实是两件事：
#     ① .NET 上有没有同步 SQLite ？ —— 有，Microsoft.Data.Sqlite 是 ADO.NET
#     ② 跨语言同步调用 + 类型映射能不能撑住那套契约？ —— **本脚本验的就是这个**
#
# 前置：node、dotnet SDK ≥ 8
#
# 用法：bash research/spikes/sqlite-driver-csharp/run.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

OUT_DIR="${SQLITE_SPIKE_OUT:-$(mktemp -d -t heyta-sqlite-spike.XXXXXX)}"
BUNDLE="$OUT_DIR/storage.iife.js"
DB="$OUT_DIR/probe.sqlite"

echo "▸ 输出目录：$OUT_DIR"

# 🔴 esbuild 只装在 packages/domain 自己的 node_modules 里（pnpm 隔离布局，
# 根目录没有 .bin/esbuild）。不能用 `npx esbuild`。
ESBUILD="$ROOT/packages/domain/node_modules/.bin/esbuild"
if [ ! -x "$ESBUILD" ]; then
  echo "找不到 esbuild：$ESBUILD" >&2
  echo "先在仓库根跑一次：pnpm install --store-dir .pnpm-store" >&2
  exit 1
fi

echo "▸ 1/2 打包真正的 TS 存储栈 + 原样契约（--platform=neutral：不注入 Node/浏览器垫片）"

# 🔴 `--alias:vitest=…` 是契约重放能成立的关键：两个 `*.contract.ts` 都写着
#    `import { describe, expect, it } from 'vitest'`，把它们指到 `vitest-shim.ts`
#    （一个几十行的替身），就能让**同一份契约源码、一个字不改**在 Jint 里跑。
#    如果改成"照着契约另写一套断言"，那测的就是实现者的假设，不是接口本身 ——
#    而 contract.spec.ts 的文件头明确禁止那种做法。
"$ESBUILD" "$HERE/entry.ts" \
  --bundle --format=iife --global-name=HeytaStorage \
  --alias:vitest="$HERE/vitest-shim.ts" \
  --outfile="$BUNDLE" --platform=neutral --target=es2020 --log-level=warning

# 每次从零开始：否则上一轮的库会被复用，"建表"这一步就白验了。
rm -f "$DB" "$DB-wal" "$DB-shm"
rm -rf "$OUT_DIR/db"
mkdir -p "$OUT_DIR/db"

echo "▸ 2/2 C# 宿主 + Jint 跑 probe + 契约重放"
SQLITE_SPIKE_BUNDLE="$BUNDLE" \
  SQLITE_SPIKE_DBDIR="$OUT_DIR/db" \
  SQLITE_SPIKE_PROBE="$HERE/probe.js" \
  SQLITE_SPIKE_DB="$DB" \
  DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 \
  dotnet run -c Release --project "$HERE/cs/DriverSpike.csproj"

echo
echo "证据留在：$OUT_DIR"
