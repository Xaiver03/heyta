$ErrorActionPreference = 'Continue'

Write-Output '=== WER report text (names the faulting stack if present) ==='
$wer = Get-ChildItem 'C:\ProgramData\Microsoft\Windows\WER\ReportArchive' -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like '*HeytaRnwSpike*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($wer) {
  Write-Output ('REPORT_DIR=' + $wer.FullName)
  Get-ChildItem $wer.FullName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
  $rep = Get-ChildItem $wer.FullName -Filter 'Report.wer' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($rep) { Get-Content $rep.FullName | Select-String -Pattern 'AppPath|Sig\[|DynamicSig|OsInfo|FriendlyEventName|LoadedModule' | Select-Object -First 60 | ForEach-Object { Write-Output ('  ' + $_.Line) } }
} else { Write-Output 'NO_WER_REPORT' }

Write-Output ''
Write-Output '=== files next to the exe (bootstrap dll?) ==='
$dir = 'C:\src\heyta-rnw-spike\HeytaRnwSpike\windows\x64\Debug'
Get-ChildItem $dir -ErrorAction SilentlyContinue | Select-Object Name, Length | Format-Table -AutoSize | Out-String

Write-Output ''
Write-Output '=== what WinAppSDK framework version does RNW require? ==='
$runtimePkg = Join-Path $env:USERPROFILE '.nuget\packages\microsoft.windowsappsdk.runtime'
Get-ChildItem $runtimePkg -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Output ('RUNTIME_NUGET_VERSION=' + $_.Name)
  Get-ChildItem $_.FullName -Recurse -Include '*.props','*.targets' -ErrorAction SilentlyContinue | ForEach-Object {
    $hits = Select-String -Path $_.FullName -Pattern 'FrameworkPackageVersion|WindowsAppSDKVersion|MinVersion|Bootstrapper' -ErrorAction SilentlyContinue
    if ($hits) { $hits | Select-Object -First 6 | ForEach-Object { Write-Output ('   ' + $_.Filename + ':' + $_.LineNumber + ' ' + $_.Line.Trim()) } }
  }
}

Write-Output ''
Write-Output '=== installed 1.8 runtime version vs requirement ==='
Get-AppxPackage -Name 'Microsoft.WindowsAppRuntime.1.8' -ErrorAction SilentlyContinue | Select-Object Name,Version,Architecture | Format-Table -AutoSize | Out-String
Write-Output '=== WindowsAppSDK runtime redist installed? ==='
Get-ChildItem 'C:\Program Files\WindowsApps' -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like '*WindowsAppRuntime*1.8*' -or $_.Name -like '*WindowsAppRuntime*2*' } |
  Select-Object -First 12 -ExpandProperty Name