$ErrorActionPreference = 'Continue'
$proj = 'C:\src\heyta-rnw-spike\HeytaRnwSpike'
Set-Location $proj
$log = 'C:\src\rnw-init.log'
Remove-Item $log -Force -ErrorAction SilentlyContinue
function Log($m) { $m | Tee-Object -FilePath $log -Append }

Log ('=== PATH pwsh check ===')
$pw = Get-Command pwsh.exe -ErrorAction SilentlyContinue
Log ('pwsh=' + $pw.Source)
Log ('PATH=' + $env:Path)

Log ''
Log '=== require rnw config directly ==='
node -e "try{const c=require('react-native-windows/react-native.config.js'); console.log('OK commands=',(c.commands||[]).map(x=>x.name).join(',')); console.log('platforms=',Object.keys(c.platforms||{}).join(','));}catch(e){console.log('THREW:', e.message);}" 2>&1 | ForEach-Object { Log $_ }

Log ''
Log ('=== init-windows --overwrite ' + (Get-Date).ToString('s') + ' ===')
$out2 = & npx.cmd react-native init-windows --overwrite --no-telemetry --logging 2>&1
$out2 | ForEach-Object { Log $_ }
Log ('INIT_WINDOWS_EXIT=' + $LASTEXITCODE)

Log ''
Log '=== windows/ tree after init ==='
Get-ChildItem "$proj\windows" -Recurse -File -ErrorAction SilentlyContinue |
  Select-Object -First 45 -ExpandProperty FullName | ForEach-Object { Log $_ }

Log ''
Log '=== generated PlatformToolset ==='
Get-ChildItem "$proj\windows" -Recurse -Include '*.vcxproj','*.wapproj' -ErrorAction SilentlyContinue | ForEach-Object {
  Log ('FILE ' + $_.Name)
  Select-String -Path $_.FullName -Pattern 'PlatformToolset' | ForEach-Object { Log ('  ' + $_.Line.Trim()) }
}
Log ('=== done ' + (Get-Date).ToString('s') + ' ===')