$ErrorActionPreference = 'Continue'
$cap = 'C:\src\heyta-m2-inject-cap.ps1'
@'
$ErrorActionPreference = "Continue"
$exe = "C:\src\heyta-m2\apps\desktop-windows\HeytaWindows\bin\x64\Debug\net10.0-windows10.0.19041.0\HeytaWindows.exe"
$out = "C:\src\heyta-m2-inject"
# INJECTED FAULT: 指到一个空目录 —— 共享 UI 的产物不存在，断言必须转红
$env:HEYTA_WEB_ROOT = "C:\src\empty-web-root"
$env:HEYTA_M2_EVIDENCE = $out
New-Item -ItemType Directory -Force -Path $env:HEYTA_WEB_ROOT | Out-Null
"=== injection: empty web root ===" | Out-File "$out.txt" -Encoding utf8
$p = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
Start-Sleep -Seconds 30
if ($p.HasExited) { "EXITED code=$($p.ExitCode)" | Out-File "$out.txt" -Append -Encoding utf8 }
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
'@ | Set-Content -Path $cap -Encoding UTF8
& schtasks /Create /TN heyta-m2-inject /TR "powershell -NoProfile -ExecutionPolicy Bypass -File $cap" /SC ONCE /ST 00:00 /RL HIGHEST /F | Out-Null
& schtasks /Run /TN heyta-m2-inject | Out-Null
Start-Sleep -Seconds 40
Write-Output '--- injection result ---'
Get-Content 'C:\src\heyta-m2-inject.txt' -ErrorAction SilentlyContinue
Get-Content 'C:\src\heyta-m2-inject.txt.txt' -ErrorAction SilentlyContinue
Get-Process -Name HeytaWindows -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
