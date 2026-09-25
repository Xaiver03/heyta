#!/usr/bin/env bash
# 跨语言加解密互操作测试
#
# 目的：证明 sync-core 的加密契约是语言无关的 —— 用 Python 的独立实现
#       解密 TypeScript 实现产出的密文。
#
# 这照搬了上游 Super Productivity 的做法：
#   tools/generate-android-crypto-fixtures.mjs + LiveJsEncryptRoundTripTest.kt
#   （他们用 Kotlin 验证，我们用 Python 验证）
#
# 用法：
#   1. 先构建独立的 sync-core（见 README）
#   2. bash run.sh <sync-core-dist 目录>
#
# 契约（来自 sync-core/src/encryption/）：
#   base64( SALT(16) | IV(12) | AES-256-GCM ciphertext+tag(16) )
#   key = Argon2id(password, salt, p=1, t=3, m=64 MiB, len=32)

set -euo pipefail

DIST_DIR="${1:-../standalone/sync-core/dist}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ ! -f "$DIST_DIR/index.mjs" ]; then
  echo "❌ 找不到 $DIST_DIR/index.mjs"
  echo "   请先构建 sync-core："
  echo "     cp -R <repo>/packages/sync-core /tmp/sync-core"
  echo "     cd /tmp/sync-core && npm install --no-package-lock --legacy-peer-deps && npm run build"
  exit 1
fi

echo "=== 1. TS 端生成密文 ==="
cd "$WORK"
cp "$HERE/gen-fixture.mjs" .
sed -i.bak "s|'./sync-core/dist/index.mjs'|'$DIST_DIR/index.mjs'|" gen-fixture.mjs
node gen-fixture.mjs > fixture.json
echo "  ✓ 已生成 fixture.json"

echo
echo "=== 2. Python 端独立解密 ==="
cp "$HERE/verify-python.py" .
PYTHONPATH="${PYLIBS:-$WORK/pylibs}" python3 verify-python.py

echo
echo "=== 完成 ==="
