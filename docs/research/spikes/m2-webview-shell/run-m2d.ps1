$ErrorActionPreference = 'Continue'
$cap = 'C:\src\heyta-m2d-cap.ps1'
@'
$ErrorActionPreference = "Continue"
$exe = "C:\src\heyta-m2\apps\desktop-windows\HeytaWindows\bin\x64\Debug\net10.0-windows10.0.19041.0\HeytaWindows.exe"
$out = "C:\src\heyta-m2d-window"
$env:HEYTA_WEB_ROOT = "C:\src\heyta-web-dist\dist"
$env:HEYTA_WEB_MODE = "app"
$env:HEYTA_M2_EVIDENCE = $out
Remove-Item "$out.png","$out.txt","$out.txt.txt" -Force -ErrorAction SilentlyContinue
"=== M2-D: app mode ===" | Out-File "$out.txt" -Encoding utf8
$p = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
Start-Sleep -Seconds 40
if ($p.HasExited) { "EXITED code=$($p.ExitCode)" | Out-File "$out.txt" -Append -Encoding utf8 }
else {
  Add-Type -AssemblyName System.Drawing
  Add-Type @"
using System;using System.Runtime.InteropServices;
public class W4 { [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R4 r);
public struct R4 { public int L,T,Rr,B; } }
"@
  $h = $p.MainWindowHandle
  $r = New-Object W4+R4
  [void][W4]::GetWindowRect($h, [ref]$r)
  $w = $r.Rr - $r.L; $ht = $r.B - $r.T
  "WINDOW_RECT=$($r.L),$($r.T),${w}x${ht}" | Out-File "$out.txt" -Append -Encoding utf8
  $bmp = New-Object System.Drawing.Bitmap $w, $ht
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
  $bmp.Save("$out.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  "PNG_SAVED=True bytes=$((Get-Item "$out.png").Length)" | Out-File "$out.txt" -Append -Encoding utf8
}
'@ | Set-Content -Path $cap -Encoding UTF8
& schtasks /Create /TN heyta-m2d /TR "powershell -NoProfile -ExecutionPolicy Bypass -File $cap" /SC ONCE /ST 00:00 /RL HIGHEST /F | Out-Null
& schtasks /Run /TN heyta-m2d | Out-Null
Start-Sleep -Seconds 55
Get-Content 'C:\src\heyta-m2d-window.txt' -ErrorAction SilentlyContinue
Write-Output '--- shell evidence ---'
Get-Content 'C:\src\heyta-m2d-window.txt.txt' -ErrorAction SilentlyContinue
Write-Output ('PNG_EXISTS=' + (Test-Path 'C:\src\heyta-m2d-window.png'))
Get-Process -Name HeytaWindows -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
