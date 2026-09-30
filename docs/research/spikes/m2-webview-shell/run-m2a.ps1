$ErrorActionPreference = 'Continue'
$cap = 'C:\src\heyta-m2-cap.ps1'
@'
$ErrorActionPreference = "Continue"
$exe = "C:\src\heyta-m2\apps\desktop-windows\HeytaWindows\bin\x64\Debug\net10.0-windows10.0.19041.0\HeytaWindows.exe"
$out = "C:\src\heyta-m2-window"
$env:HEYTA_WEB_ROOT = "C:\src\heyta-web-dist\dist"
$env:HEYTA_M2_EVIDENCE = $out
"=== session 2 user=$env:USERNAME ===" | Out-File "$out.txt" -Encoding utf8
"EXE_EXISTS=$(Test-Path $exe)" | Out-File "$out.txt" -Append -Encoding utf8
"WEB_ROOT_EXISTS=$(Test-Path $env:HEYTA_WEB_ROOT)" | Out-File "$out.txt" -Append -Encoding utf8
$p = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
Start-Sleep -Seconds 30
if ($p.HasExited) {
  "EXITED_EARLY code=$($p.ExitCode)" | Out-File "$out.txt" -Append -Encoding utf8
  "RESULT=NO_WINDOW" | Out-File "$out.txt" -Append -Encoding utf8
} else {
  "ALIVE pid=$($p.Id)" | Out-File "$out.txt" -Append -Encoding utf8
  Add-Type -AssemblyName System.Drawing
  Add-Type @"
using System;using System.Runtime.InteropServices;
public class W3 { [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R3 r);
public struct R3 { public int L,T,Rr,B; } }
"@
  $h = $p.MainWindowHandle
  "HWND=$h" | Out-File "$out.txt" -Append -Encoding utf8
  if ($h -ne 0) {
    $r = New-Object W3+R3
    [void][W3]::GetWindowRect($h, [ref]$r)
    $w = $r.Rr - $r.L; $ht = $r.B - $r.T
    "WINDOW_RECT=$($r.L),$($r.T),${w}x${ht}" | Out-File "$out.txt" -Append -Encoding utf8
    $bmp = New-Object System.Drawing.Bitmap $w, $ht
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
    $bmp.Save("$out.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    "PNG_SAVED=True bytes=$((Get-Item "$out.png").Length)" | Out-File "$out.txt" -Append -Encoding utf8
    "RESULT=WINDOW_OK" | Out-File "$out.txt" -Append -Encoding utf8
  } else { "RESULT=NO_HWND" | Out-File "$out.txt" -Append -Encoding utf8 }
}
'@ | Set-Content -Path $cap -Encoding UTF8
& schtasks /Create /TN heyta-m2 /TR "powershell -NoProfile -ExecutionPolicy Bypass -File $cap" /SC ONCE /ST 00:00 /RL HIGHEST /F | Out-Null
& schtasks /Run /TN heyta-m2 | Out-Null
Start-Sleep -Seconds 45
Write-Output '--- window receipt ---'
Get-Content 'C:\src\heyta-m2-window.txt' -ErrorAction SilentlyContinue
Write-Output '--- M2-A evidence (probe) ---'
Get-Content 'C:\src\heyta-m2-window.txt.txt' -ErrorAction SilentlyContinue
Write-Output ('PNG_EXISTS=' + (Test-Path 'C:\src\heyta-m2-window.png'))
& schtasks /End /TN heyta-m2 2>&1 | Out-Null
Get-Process -Name HeytaWindows -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
