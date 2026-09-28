#!/bin/bash
# Windows（WinUI 3）原生壳的窗口取证：推源码 → 构建 → 交互式会话里起窗口 → 截图 → 落 evidence。
#
#   bash apps/desktop-windows/scripts/capture-window.sh [主机]
#
# 默认主机 `windows-pc`。前置：那边**有人登录着**（`Get-Process explorer` 非空），
# 且 `dotnet SDK ≥ 10`。⚠️ **不需要 Visual Studio**，`dotnet build` 就够。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WIN_DIR="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$WIN_DIR/../.." && pwd)"
HOST="${1:-windows-pc}"
REMOTE_REPO='C:/src/heyta'

ps() {  # 把本地 PS1 以 base64(UTF-16LE) 送过去执行，绕开引号与编码问题
  local b64
  b64="$(iconv -f UTF-8 -t UTF-16LE "$1" | base64 | tr -d '\n')"
  ssh -o ConnectTimeout=10 "$HOST" "powershell -NoProfile -EncodedCommand $b64"
}

echo "=== ① 打包源码 + bundle（COPYFILE_DISABLE 防 AppleDouble）==="
TARBALL="$(mktemp -t heyta-win).tgz"
COPYFILE_DISABLE=1 tar czf "$TARBALL" \
  --exclude='*/bin' --exclude='*/obj' --exclude='._*' --exclude='*/.DS_Store' \
  -C "$REPO" \
  apps/desktop-windows/HeytaWindows \
  apps/desktop-windows/Heyta.Windows.Core \
  apps/desktop-windows/smoke \
  packages/app-host/bridge-bundle/native-bridge.js
echo "  $(stat -f%z "$TARBALL") 字节；包内 ._* 文件 $(tar tzf "$TARBALL" | grep -c '\._' || true) 个"

echo ""
echo "=== ② 推送并清理旧的 AppleDouble ==="
cat > /tmp/heyta-win-clean.ps1 <<'PS1'
Get-ChildItem C:\src\heyta\apps\desktop-windows -Recurse -Force -Filter '._*' -EA SilentlyContinue |
  ForEach-Object { Remove-Item $_.FullName -Force }
PS1
cat "$TARBALL" | ssh -o ConnectTimeout=10 "$HOST" "tar -xzf - -C $REMOTE_REPO && echo EXTRACT_OK" | awk '{print "  " $0}'
ps /tmp/heyta-win-clean.ps1 >/dev/null

echo ""
echo "=== ③ 构建（Release x64）==="
cat > /tmp/heyta-win-build.ps1 <<'PS1'
Set-Location C:\src\heyta
dotnet build apps\desktop-windows\HeytaWindows\HeytaWindows.csproj -c Release -p:Platform=x64 2>&1 |
  Select-String -Pattern 'error|Build succeeded' | Select-Object -First 8 | ForEach-Object { Write-Output $_.Line }
PS1
ps /tmp/heyta-win-build.ps1 | awk '{print "  " $0}'

echo ""
echo "=== ④ 推取证脚本并在交互式会话里执行 ==="
scp -q "$HERE/capture-window.ps1" "$HOST:C:/src/heyta-capture.ps1"
printf '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File C:\\src\\heyta-capture.ps1 > C:\\src\\heyta-capture.log 2>&1\r\n' \
  > /tmp/heyta-capture.cmd
scp -q /tmp/heyta-capture.cmd "$HOST:C:/src/heyta-capture.cmd"

cat > /tmp/heyta-win-sched.ps1 <<'PS1'
schtasks /delete /tn heyta-window-capture /f 2>&1 | Out-Null
schtasks /create /tn heyta-window-capture /tr C:\src\heyta-capture.cmd /sc once /st 00:00 /ru $env:USERNAME /it /f 2>&1 | Out-Null
schtasks /run /tn heyta-window-capture 2>&1 | Out-Null
Start-Sleep -Seconds 30
if (Test-Path C:\src\heyta-window.txt) { Get-Content C:\src\heyta-window.txt | ForEach-Object { Write-Output $_ } }
PS1
ps /tmp/heyta-win-sched.ps1 | awk '{print "  " $0}'

echo ""
echo "=== ⑤ 取回证据 ==="
mkdir -p "$WIN_DIR/evidence"
scp -q "$HOST:C:/src/heyta-window.png" "$WIN_DIR/evidence/window-first-run.png"

echo ""
echo "=== ⑥ 校验 ==="
cd "$REPO"
node - "$WIN_DIR/evidence/window-first-run.png" <<'JS'
import { inspectPng, looksBlank, looksSmeared } from './scripts/screenshots/png-stats.mjs';
const st = inspectPng(process.argv[2]);
console.log(`  ${st.width}x${st.height}  内容 ${(st.contentRatio * 100).toFixed(1)}%  色阶 ${st.colorSpan}`);
let bad = false;
if (st.hasTransparency) { console.error('  🔴 含实际透明像素'); bad = true; }
if (looksBlank(st)) { console.error('  🔴 疑似空白'); bad = true; }
if (looksSmeared(st)) console.error('  ⚠️ 启发式提示疑似渲染坏了 —— 请人眼看一眼');
if (bad) process.exit(1);
console.log('  ✅ 通过');
JS
