#!/usr/bin/env bash
#
# 安装 idb（facebook/idb，MIT）—— iOS 验收用来**从设备内部**驱动界面。
#
# 为什么走"直接下预编译包"而不是 brew：
#   本机的 brew 报 `Your Command Line Tools are too outdated`，
#   而它给的修法是 `sudo rm -rf /Library/Developer/CommandLineTools` 再重装 ——
#   那是**破坏性的系统改动**，不该为了一个验收工具去动。
#   idb 的 release 里本来就有 `idb-companion.macos-arm64.tar.gz` 和 Python wheel，
#   直接取来用即可，还顺带把版本钉死（brew 的版本会漂）。
#
# 装到 ~/.heyta-tools/idb/（不是 /tmp —— /tmp 会被系统清掉，
# 而"工具没了"会伪装成"验收失败"，正是本仓库反复吃亏的那种假红）。
#
# 用法：bash scripts/install-idb.sh [版本]
#
set -eu

VERSION=${1:-v1.6.2}
DEST="${HEYTA_IDB_HOME:-$HOME/.heyta-tools/idb}"

echo "════ 安装 idb $VERSION 到 $DEST ════"
mkdir -p "$DEST"

need_download=1
if [ -x "$DEST/idb_companion" ] && [ -x "$DEST/venv/bin/idb" ]; then
  echo "   已存在。要重装就先 rm -rf \"$DEST\"。"
  need_download=0
fi

if [ "$need_download" = 1 ]; then
  command -v gh >/dev/null 2>&1 || {
    echo "   ❌ 需要 gh（GitHub CLI）来下载 release 资产。" >&2
    echo "      或者手动从 https://github.com/facebook/idb/releases 下载这两个文件到 ${DEST}：" >&2
    echo "        idb-companion.macos-arm64.tar.gz   fb_idb-${VERSION#v}-py3-none-any.whl" >&2
    exit 1
  }

  echo "   → 下载 companion 与 sha256"
  gh release download "$VERSION" --repo facebook/idb \
    --pattern 'idb-companion.macos-arm64.tar.gz*' --dir "$DEST" --clobber

  # 🔴 校验哈希。下载"成功"和"拿到正确的二进制"是两件事。
  if [ -f "$DEST/idb-companion.macos-arm64.tar.gz.sha256" ]; then
    want=$(python3 -c "
import re,sys
s=open('$DEST/idb-companion.macos-arm64.tar.gz.sha256',encoding='utf-8').read()
m=re.search(r'[0-9a-f]{64}', s)
print(m.group(0) if m else '')
")
    got=$(shasum -a 256 "$DEST/idb-companion.macos-arm64.tar.gz" | awk '{print $1}')
    if [ -n "$want" ] && [ "$want" != "$got" ]; then
      echo "   ❌ sha256 不一致：期望 ${want}，实际 $got" >&2
      exit 1
    fi
    echo "      ✅ sha256 一致（${got%"${got#???????}"}…）"
  else
    echo "      ⚠️ 没有 .sha256 文件，跳过校验" >&2
  fi

  echo "   → 解包 companion"
  tar xzf "$DEST/idb-companion.macos-arm64.tar.gz" -C "$DEST"
  chmod +x "$DEST/idb_companion" 2>/dev/null || true

  echo "   → 下载 Python 客户端 wheel"
  gh release download "$VERSION" --repo facebook/idb \
    --pattern "fb_idb-${VERSION#v}-py3-none-any.whl" --dir "$DEST" --clobber

  echo "   → 建 venv 并安装客户端"
  python3 -m venv "$DEST/venv"
  "$DEST/venv/bin/pip" install --quiet --upgrade pip
  "$DEST/venv/bin/pip" install --quiet "$DEST/fb_idb-${VERSION#v}-py3-none-any.whl"
fi

echo ""
echo "════ 自检（装完了 ≠ 能用）════"
"$DEST/idb_companion" --version 2>&1 | head -2 | sed 's/^/   /'
"$DEST/venv/bin/idb" --version 2>&1 | head -2 | sed 's/^/   /' || true
echo ""
echo "   ✅ 装好了。验收脚本会自动在下面两个位置找它："
echo "        $HOME/.heyta-tools/idb/{venv/bin/idb,idb_companion}"
echo "        /tmp/idb/{venv/bin/idb,idb_companion}"
