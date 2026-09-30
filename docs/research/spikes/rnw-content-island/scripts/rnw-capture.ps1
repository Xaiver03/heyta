# Capture the RNW app window from inside the interactive desktop session.
# ASCII ONLY -- PowerShell 5.1 decodes UTF-8-without-BOM as ANSI and corrupts literals.
$ErrorActionPreference = 'Continue'

$exe     = 'C:\src\heyta-rnw-spike\HeytaRnwSpike\windows\x64\Debug\HeytaRnwSpike.exe'
$pngPath = 'C:\src\rnw-window.png'
$txtPath = 'C:\src\rnw-window.txt'
$lines   = @()
$lines  += ('=== session ' + (Get-Process -Id $PID).SessionId + ' user=' + $env:USERNAME + ' ===')
$lines  += ('EXE_EXISTS=' + (Test-Path $exe))

Get-Process HeytaRnwSpike -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$proc = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
$lines += ('PID=' + $proc.Id)

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
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 750
  $proc.Refresh()
  if ($proc.HasExited) { $lines += ('EXITED_EARLY code=' + $proc.ExitCode); break }
  if ($proc.MainWindowHandle -ne 0 -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
    $hwnd = $proc.MainWindowHandle
    break
  }
}

if ($hwnd -eq [IntPtr]::Zero) {
  $lines += 'MAIN_WINDOW_HANDLE=0'
  $lines += 'RESULT=NO_WINDOW'
} else {
  # let the RN first frame paint (JS bundle comes over Metro)
  Start-Sleep -Seconds 12
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

$lines += ('PROC_STILL_ALIVE=' + (-not $proc.HasExited))
$lines | Set-Content -Path $txtPath -Encoding ASCII
$lines | ForEach-Object { Write-Output $_ }
Get-Process HeytaRnwSpike -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue