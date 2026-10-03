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
#   6. 把证书装进 LocalMachine\TrustedPeople（这一步才真的需要管理员）
#   7. **安装 + 启动 + 截图** —— 但整段都通过 `schtasks ... /it` 投进
#      **非提权的交互式桌面会话**里跑。原因见下面 §关键。
#
# ── 关键：Add-AppxPackage 必须是非提权会话 ────────────────────────────────
#
#   AppX 部署是**按用户**的。在 SSHD 给的提权会话里跑 Add-AppxPackage 会得到
#     0x80070005 拒绝访问（"目标卷 C: 执行的 添加 操作失败"）
#   —— 实测；同一段代码在非提权的交互式会话里原封不动就成功。
#   所以「用管理员再跑一次」是**反方向**，不要试。
#
# ── 关键：publish 会丢掉应用自己的 XAML 资源 ──────────────────────────────
#
#   `dotnet publish` 的产物里**没有** App.xbf / MainWindow.xbf / HeytaWindows.pri，
#   而 build 产物里有。用它打出来的 MSIX 能装上、能启动，然后在
#   Microsoft.UI.Xaml.dll 里以 0xc000027b + 80004005(E_FAIL) 崩掉 ——
#   因为 InitializeComponent() 加载不到 ms-appx:///App.xaml。
#   package-msix.ps1 第 1 步会把这三个文件补回去并断言存在。
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
for f in package-msix.ps1 install-and-capture.ps1; do
  if LC_ALL=C grep -q '[^ -~	]' "$HERE/$f"; then
    echo "  🔴 $f 含非 ASCII —— PowerShell 5.1 会按 ANSI 解码并拆坏字符串"
    exit 1
  fi
done
echo "  ✅ 纯 ASCII"
scp -q "$HERE/package-msix.ps1" "$HOST:C:/src/heyta-package-msix.ps1"
# 安装+启动+截图那段由 package-msix.ps1 用 schtasks 投进交互式会话，所以
# 它必须是远端的一个独立文件（不能内联生成，否则要再踩一遍 PS 5.1 的编码坑）。
scp -q "$HERE/install-and-capture.ps1" "$HOST:C:/src/heyta-install-and-capture.ps1"

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
# 🔴 产物在 C:\src\heyta-msix\，不是 C:\heyta-msix\ —— 路径写错时会以
#    「取不到 heyta.msix」收场，看起来像打包失败，其实只是取件地址错了。
scp -q "$HOST:C:/src/heyta-msix/heyta.msix" "$OUT_DIR/" || { echo "  🔴 取不到 heyta.msix"; exit 1; }
scp -q "$HOST:C:/src/heyta-msix/heyta-selfsigned.cer" "$OUT_DIR/" || true
scp -q "$HOST:C:/src/heyta-msix/install-capture.txt" "$OUT_DIR/" || true
# 🔴 取证文件**必须判**。以前这里 `|| true` 之后就再没人看过它一眼，
#    而交互会话里那条 `install-and-capture.ps1` 的 `exit 1` 传不上来
#    （ssh 的输出走管道 ⇒ 尾命令的 rc 覆盖掉远端的；schtasks 又是异步投递）
#    ⇒ 装失败、快捷方式没建成，都能以 rc=0 收场。判据清单的单一所有者在
#    `scripts/lib/msix-install-facts.sh`（`reinstall-all.sh` 调的是同一份）。
source "$REPO/scripts/lib/msix-install-facts.sh"
if ! msix_fact_out=$(msix_check_facts "$OUT_DIR/install-capture.txt"); then
  echo "  🔴 远端安装取证不成立 —— ${msix_fact_out}"
  [ -f "$OUT_DIR/install-capture.txt" ] && sed 's/^/     /' "$OUT_DIR/install-capture.txt"
  exit 1
fi
echo "  ✅ 远端安装取证：${msix_fact_out}"
scp -q "$HOST:C:/src/heyta-msix/packaged-first-run.png" "$OUT_DIR/" || echo "  ⚠️ 没有验证截图（说明没跑到"启动并截图"那步）"
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
