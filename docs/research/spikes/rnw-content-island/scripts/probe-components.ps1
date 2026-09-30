$ErrorActionPreference = 'Continue'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$ids = @(
  'Microsoft.Component.MSBuild',
  'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
  'Microsoft.VisualStudio.Component.VC.v143.x86.x64',
  'Microsoft.VisualStudio.Component.VC.ATL',
  'Microsoft.VisualStudio.Component.VC.ATLMFC',
  'Microsoft.VisualStudio.ComponentGroup.UWP.VC.v143',
  'Microsoft.VisualStudio.Component.Windows11SDK.26100',
  'Microsoft.VisualStudio.Component.Windows11SDK.22621',
  'Microsoft.VisualStudio.Component.Windows10SDK.19041',
  'Microsoft.VisualStudio.Workload.NativeDesktop',
  'Microsoft.VisualStudio.Workload.ManagedDesktop',
  'Microsoft.VisualStudio.Workload.VCTools',
  'Microsoft.VisualStudio.Workload.Universal',
  'Microsoft.VisualStudio.Component.VC.Tools.ARM64'
)
Write-Output '=== component presence in BuildTools instance ==='
foreach ($id in $ids) {
  $p = & $vswhere -all -products * -requires $id -property installationPath 2>$null
  if ($p) { Write-Output ("PRESENT  " + $id) } else { Write-Output ("MISSING  " + $id) }
}
Write-Output ''
Write-Output '=== all installed package ids (sorted) ==='
& $vswhere -all -products * -include packages -format json 2>$null |
  ConvertFrom-Json |
  ForEach-Object { $_.packages } |
  Where-Object { $_.type -eq 'Workload' -or $_.type -eq 'Component' -or $_.type -eq 'ComponentGroup' } |
  Select-Object -ExpandProperty id |
  Sort-Object -Unique
Write-Output ''
Write-Output '=== vcxproj / UWP targets present in MSBuild ==='
$bt = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools'
Get-ChildItem "$bt\MSBuild\Microsoft\VC" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
Write-Output ''
Write-Output '=== C++/WinRT nuget cache ==='
Get-ChildItem "$env:USERPROFILE\.nuget\packages" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like '*winrt*' -or $_.Name -like '*windowsappsdk*' -or $_.Name -like '*cppwinrt*' } |
  Select-Object -ExpandProperty Name