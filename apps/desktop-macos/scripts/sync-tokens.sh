#!/usr/bin/env bash
#
# 把设计系统生成的原生常量同步进 macOS 壳的 **UI 目标**源码目录
#
# ⚠️ 目标必须是 `HeytaMac`（UI target）而不是 `HeytaShellCore`：
#    生成物里的 `enum HeytaTokens` 是 **internal**，跨 SwiftPM target 不可见。
#    它服务的也正是 UI chrome。
# ==================================================
#
# ## 为什么需要这一步（而不是把生成物直接提交进来）
#
# `packages/design-system/generated/HeytaTokens.swift` 是**生成物** ——
# 唯一事实源是 `packages/design-system/src/tokens.css`。它住在
# `packages/design-system/` 下，而 SwiftPM 只编译**目标目录内**的源码，
# 所以壳编译不到它。
#
# 三条路里选了"构建期同步"：
#
# | 方案 | 为什么不选 |
# |---|---|
# | 把生成物**提交**到壳的源码目录 | 那是**第二份**颜色/尺寸值。改 tokens.css 后不同步更新它，就是本仓最忌讳的"两个真相源"，而且**没有任何编译错误** |
# | SwiftPM 符号链接到 packages/ | SwiftPM 对跨包 symlink 的行为不稳定（在不同版本上表现不一致），会变成"本机能编、干净检出编不了" |
# | ✅ **构建期复制 + 门禁断言一致** | 源码目录里那份是**派生物**（已 gitignore），每次构建都从唯一事实源生成；`check:macos-shell` 会断言它与真源**逐字节一致** |
#
# ## 用法
#
#   bash apps/desktop-macos/scripts/sync-tokens.sh          # 同步
#   bash apps/desktop-macos/scripts/sync-tokens.sh --verify # 只校验，不一致则退出 1
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SOURCE="$REPO_ROOT/packages/design-system/generated/HeytaTokens.swift"
DEST_DIR="$REPO_ROOT/apps/desktop-macos/Sources/HeytaMac/Generated"
DEST="$DEST_DIR/HeytaTokens.swift"

if [ ! -f "$SOURCE" ]; then
  echo "❌ 找不到设计系统生成物：$SOURCE" >&2
  echo "   先跑：pnpm --filter @heyta/design-system run generate" >&2
  exit 1
fi

if [ "${1:-}" = "--verify" ]; then
  if [ ! -f "$DEST" ]; then
    echo "❌ 壳里没有同步过的 token 生成物：$DEST" >&2
    echo "   跑：bash apps/desktop-macos/scripts/sync-tokens.sh" >&2
    exit 1
  fi
  if ! diff -q "$SOURCE" "$DEST" >/dev/null; then
    echo "❌ 壳里的 token 生成物与设计系统真源**不一致** —— 那是第二份设计变量。" >&2
    echo "   重新同步：bash apps/desktop-macos/scripts/sync-tokens.sh" >&2
    diff "$SOURCE" "$DEST" | head -20 >&2 || true
    exit 1
  fi
  echo "✅ 壳里的 token 生成物与 tokens.css 的产物逐字节一致。"
  exit 0
fi

mkdir -p "$DEST_DIR"
cp "$SOURCE" "$DEST"
echo "✅ 已同步 token 生成物 → $DEST"