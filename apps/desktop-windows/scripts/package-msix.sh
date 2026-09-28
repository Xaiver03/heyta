#!/bin/bash
# Windows（WinUI 3）打包成**可安装、已签名、且验证过真的能起来**的 MSIX。
#
#   bash apps/desktop-windows/scripts/package-msix.sh [主机] [输出目录]
#
# 默认主机 `windows-pc`，输出到 `dist/windows`。
#
# ── 全流程（远端 PowerShell 里逐步做，任一步失败都如实报并停下）────────────
#
#   1. dotnet publish（self-contained —— 工程里有 WindowsAppSDKSelfContained=true，
#      所以 MSIX **不需要**框架包依赖，换台没装运行时机器也能起）
#   2. 生成 AppxManifest.xml  ← **Publisher 必须与签名证书 Subject 逐字节一致**，
#      不一致 makeappx 会直接拒（而且报错不长这样，很难猜）
#   3. 生成 makeappx 要求的 4 个 logo 尺寸
#   4. makeappx pack
#   5. New-SelfSignedCertificate + signtool sign
#   6. 把证书装进 LocalMachine\TrustedPeople + Add-AppxPackage
#   7. **启动它并截图** —— 「装上了」不等于「跑得起来」
#
# 🔴 关于"自签名"这个词要说清楚：
#   自签名只证明"包没被改动、且与这张证书匹配"，**不**等于"公开可信的发布者"。
#   别人机器上必须先信任这张证书才能装。所以本脚本**不会**把它说成"已签名可分发"，
#   而是明确报为 `self-signed`。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WIN_DIR="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$WIN_DIR/../.." && pwd)"
HOST="${1:-windows-pc}"
OUT_DIR="${2:-$REPO/dist/windows}"

mkdir -p "$OUT_DIR"

echo "=== ① 推送打包脚本（纯 ASCII，避开 PowerShell 5.1 的编码坑）==="
if LC_ALL=C grep -q '[^ -~	]' "$HERE/package-msix.ps1"; then
  echo "  🔴 package-msix.ps1 含非 ASCII —— PowerShell 5.1 会按 ANSI 解码并拆坏字符串"
  exit 1
fi
echo "  ✅ 纯 ASCII"
scp -q "$HERE/package-msix.ps1" "$HOST:C:/src/heyta-package-msix.ps1"

echo ""
echo "=== ② 远端执行（publish → pack → sign → install → launch）==="
# 🔴 用 `-File` 而不是 `-EncodedCommand`：脚本约 9KB，UTF-16LE + base64 之后
#    超过了命令行长度上限，远端只会回一句（GBK 乱码的）「命令行太长」，
#    完全指不到真正的原因。文件已经 scp 过去了，直接按路径跑即可。
ssh -o ConnectTimeout=10 "$HOST" \
  "powershell -NoProfile -ExecutionPolicy Bypass -File C:/src/heyta-package-msix.ps1" \
  2>&1 | grep -viE "warning: connection|post-quantum|store now|openssh|^#< CLIXML" | awk '{print "  " $0}'

echo ""
echo "=== ③ 取回 MSIX 与验证截图 ==="
scp -q "$HOST:C:/heyta-msix/heyta.msix" "$OUT_DIR/" || { echo "  🔴 取不到 heyta.msix"; exit 1; }
scp -q "$HOST:C:/heyta-msix/heyta-selfsigned.cer" "$OUT_DIR/" || true
scp -q "$HOST:C:/heyta-msix/packaged-first-run.png" "$OUT_DIR/" || echo "  ⚠️ 没有验证截图（说明没跑到"启动并截图"那步）"
ls -la "$OUT_DIR" | awk '{print "  " $0}'

echo ""
echo "=== ④ 校验打包后的界面 ==="
SHOT="$OUT_DIR/packaged-first-run.png"
if [ ! -f "$SHOT" ]; then
  echo "  🔴 没有截图 —— 不能声称「打包后能起来」"
  exit 1
fi
cd "$REPO"
node - "$SHOT" <<'JS'
import { inspectPng, looksBlank, looksSmeared } from './scripts/screenshots/png-stats.mjs';
const st = inspectPng(process.argv[2]);
console.log(`  ${st.width}x${st.height}  内容 ${(st.contentRatio * 100).toFixed(1)}%  色阶 ${st.colorSpan}  边缘 ${st.edgeOnContent.toFixed(3)}`);
let bad = false;
if (st.hasTransparency) { console.error('  🔴 含实际透明像素'); bad = true; }
if (looksBlank(st)) { console.error('  🔴 疑似空白'); bad = true; }
if (looksSmeared(st)) console.error('  ⚠️ 启发式提示疑似渲染坏了 —— 请人眼看一眼');
if (bad) process.exit(1);
console.log('  ✅ 装完的 MSIX 能起来、界面有真实内容');
JS
