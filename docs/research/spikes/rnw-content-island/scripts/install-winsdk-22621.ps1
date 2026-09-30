$ErrorActionPreference = 'Continue'

Write-Output '=== vs-modify.log (if any) ==='
if (Test-Path 'C:\src\vs-modify.log') { Get-Content 'C:\src\vs-modify.log' | Select-Object -Last 20 } else { Write-Output 'no log (setup.exe does not write one)' }

Write-Output ''
Write-Output '=== Installer dir ==='
Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer" -Filter '*.exe' -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty Name

Write-Output ''
Write-Output '=== winget search Windows SDK ==='
& winget search Microsoft.WindowsSDK 2>&1 | Out-String

Write-Output ''
Write-Output '=== install standalone Windows 11 SDK 22621 ==='
$out = & winget install --id Microsoft.WindowsSDK.10.0.22621 --exact --silent --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | Out-String
Write-Output $out
Write-Output ('sdk_winget_exit=' + $LASTEXITCODE)

Write-Output ''
Write-Output '=== SDK 22621 present now? ==='
Write-Output ('include_22621=' + (Test-Path 'C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0'))
Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\Include' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name