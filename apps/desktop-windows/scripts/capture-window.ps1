# Capture the heyta WinUI window from inside the interactive desktop session.
#
#   schtasks /create /tn heyta-window-capture /tr C:\src\heyta-capture.cmd `
#     /sc once /st 00:00 /ru <user> /it /f
#   schtasks /run /tn heyta-window-capture
#
# ASCII ONLY -- deliberately. PowerShell 5.1 decodes a UTF-8 script WITHOUT a BOM
# as ANSI, which corrupts non-ASCII string literals and produces parse errors far
# from the real cause. Keeping this file ASCII removes that whole failure mode;
# the Chinese explanation lives in the companion .txt / .sh instead.
#
# Writes:
#   C:\src\heyta-window.png       the captured window (app window only, not the desktop)
#   C:\src\heyta-window.txt       measured facts

$ErrorActionPreference = 'Continue'

$repo    = 'C:\src\heyta'
$exeDir  = Join-Path $repo 'apps\desktop-windows\HeytaWindows\bin\x64\Release\net10.0-windows10.0.19041.0'
$exe     = Join-Path $exeDir 'HeytaWindows.exe'
$bundle  = Join-Path $repo 'packages\app-host\bridge-bundle\native-bridge.js'
$pngPath = 'C:\src\heyta-window.png'
$txtPath = 'C:\src\heyta-window.txt'
$lines   = @()
$lines  += ('=== capture in session ' + (Get-Process -Id $PID).SessionId + ' ===')

# The app loads native-bridge.js from AppContext.BaseDirectory, so it must sit next to the exe.
Copy-Item $bundle (Join-Path $exeDir 'native-bridge.js') -Force
$lines += ('BUNDLE_COPIED=' + (Test-Path (Join-Path $exeDir 'native-bridge.js')))

Get-Process HeytaWindows -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$proc = Start-Process -FilePath $exe -WorkingDirectory $exeDir -PassThru
$lines += ('PID=' + $proc.Id)

# Wait for a top-level window owned by the process to appear.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 750
  $proc.Refresh()
  if ($proc.MainWindowHandle -ne 0 -and $proc.MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $proc.MainWindowHandle; break }
}

if ($hwnd -eq [IntPtr]::Zero) {
  $lines += 'MAIN_WINDOW_HANDLE=0'
  $lines += 'RESULT=NO_WINDOW'
} else {
  Start-Sleep -Seconds 3   # let the first frame settle
  $proc.Refresh()
  $rect = New-Object W+RECT
  [void][W]::GetWindowRect($hwnd, [ref]$rect)
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top
  $lines += ('MAIN_WINDOW_HANDLE=' + $hwnd)
  $lines += ('MAIN_WINDOW_TITLE=' + $proc.MainWindowTitle)
  $lines += ('WINDOW_RECT=' + $rect.Left + ',' + $rect.Top + ',' + $w + 'x' + $h)

  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
  $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  $lines += ('PNG_SAVED=' + (Test-Path $pngPath) + ' bytes=' + (Get-Item $pngPath).Length)
  $lines += 'RESULT=OK'
}

$db = Join-Path $env:LOCALAPPDATA 'heyta\heyta.sqlite'
$lines += ('DB_EXISTS=' + (Test-Path $db))

Start-Sleep -Seconds 1
Get-Process HeytaWindows -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$lines | Set-Content -Path $txtPath -Encoding ASCII
$lines | ForEach-Object { Write-Output $_ }
