$ErrorActionPreference = 'Continue'
$env:HEYTA_BRIDGE_BUNDLE = 'C:\src\heyta-m2\packages\app-host\bridge-bundle\native-bridge.js'
$shellDb = Join-Path $env:LOCALAPPDATA 'heyta\heyta.sqlite'

Write-Output '=== 1. seed the SHELL db (via the smoke tool, not the shell) ==='
Remove-Item $shellDb -Force -ErrorAction SilentlyContinue
$env:HEYTA_SEED_DB = $shellDb
$env:HEYTA_SEED_COUNT = '3'
Set-Location 'C:\src\heyta-m2\apps\desktop-windows'
& dotnet run --project 'smoke\Smoke.csproj' -c Debug 2>&1 | Select-String -Pattern 'SEED_' | ForEach-Object { Write-Output ('  ' + $_.Line.Trim()) }

Write-Output ''
Write-Output '=== 2. clear stale receipts ==='
Remove-Item 'C:\src\heyta-m2-window.png','C:\src\heyta-m2-window.txt','C:\src\heyta-m2-window.txt.txt' -Force -ErrorAction SilentlyContinue

Write-Output ''
Write-Output '=== 3. launch + capture (M2-B) ==='
& powershell -NoProfile -ExecutionPolicy Bypass -File C:\src\heyta-m2-run.ps1 2>&1 | Select-String -NotMatch -Pattern 'CategoryInfo|FullyQualified|^\s*\+|/ST ' | Select-Object -Last 14
