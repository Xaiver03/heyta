$ErrorActionPreference = 'Continue'
Write-Output '=== VSWHERE ==='
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
  & $vswhere -all -products * -format json
} else {
  Write-Output 'vswhere NOT FOUND'
}
Write-Output ''
Write-Output '=== VS INSTALL DIRS ==='
Get-ChildItem 'C:\Program Files\Microsoft Visual Studio\2022' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
Write-Output ''
Write-Output '=== MSBUILD ==='
$mb = & $vswhere -latest -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' 2>$null
if ($mb) { Write-Output $mb } else { Write-Output 'MSBUILD NOT FOUND' }
Write-Output ''
Write-Output '=== VC TOOLS ==='
$vc = & $vswhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'VC\Tools\MSVC\**\bin\Hostx64\x64\cl.exe' 2>$null
if ($vc) { Write-Output $vc } else { Write-Output 'VC TOOLS NOT FOUND' }
Write-Output ''
Write-Output '=== VC++ v143 dirs ==='
Get-ChildItem 'C:\Program Files\Microsoft Visual Studio\2022\*\VC\Tools\MSVC' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
Write-Output ''
Write-Output '=== Windows SDK Include versions ==='
Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\Include' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
Write-Output ''
Write-Output '=== Windows SDK Lib versions ==='
Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\Lib' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
Write-Output ''
Write-Output '=== WinAppSDK / NuGet ==='
Write-Output ('NUGET_PACKAGES=' + $env:NUGET_PACKAGES)
Get-ChildItem "$env:USERPROFILE\.nuget\packages\microsoft.windowsappsdk" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
Write-Output ''
Write-Output '=== winget ==='
winget --version
Write-Output ''
Write-Output '=== installed MSIX-ish runtimes ==='
Get-AppxPackage -Name 'Microsoft.WindowsAppRuntime*' -ErrorAction SilentlyContinue | Select-Object Name, Version | Format-Table -AutoSize | Out-String
Write-Output ''
Write-Output '=== free disk C: ==='
Get-PSDrive C | Select-Object Used, Free | Format-Table -AutoSize | Out-String
Write-Output ''
Write-Output '=== npm.cmd / npx.cmd ==='
& npm.cmd --version
& npx.cmd --version
Write-Output ''
Write-Output '=== git ==='
git --version