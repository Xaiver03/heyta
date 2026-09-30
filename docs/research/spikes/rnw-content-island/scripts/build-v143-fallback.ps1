$ErrorActionPreference = 'Continue'
$proj = 'C:\src\heyta-rnw-spike\HeytaRnwSpike'
$msb  = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\amd64\MSBuild.exe'
$sln  = "$proj\windows\HeytaRnwSpike.sln"
$vcx  = "$proj\windows\HeytaRnwSpike\HeytaRnwSpike.vcxproj"
$logf = 'C:\src\msbuild-v143.log'

Write-Output '=== is VS 2026 / v145 obtainable via winget? ==='
& winget search "Visual Studio 2026" 2>&1 | Out-String
& winget search MSVC 2>&1 | Out-String

Write-Output ''
Write-Output '=== available MSBuild platform toolsets (v143 only?) ==='
Get-ChildItem 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Platforms\x64\PlatformToolsets' -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty Name

Write-Output ''
Write-Output '=== PATCH generated vcxproj: v145 -> v143 (experiment only) ==='
$before = Select-String -Path $vcx -Pattern '<PlatformToolset>v145</PlatformToolset>'
Write-Output ('v145_occurrences_before=' + $before.Count)
(Get-Content $vcx -Raw) -replace '<PlatformToolset>v145</PlatformToolset>', '<PlatformToolset>v143</PlatformToolset>' |
  Set-Content $vcx -NoNewline -Encoding UTF8
Write-Output ('v143_now=' + (Select-String -Path $vcx -Pattern '<PlatformToolset>v143</PlatformToolset>').Count)

Write-Output ''
Write-Output '=== REBUILD with v143 ==='
Remove-Item $logf -Force -ErrorAction SilentlyContinue
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& $msb $sln -restore -t:HeytaRnwSpike -p:Configuration=Debug -p:Platform=x64 -v:minimal -nologo -m *>&1 |
  Tee-Object -FilePath $logf | Select-Object -Last 60
Write-Output ('MSBUILD_EXIT=' + $LASTEXITCODE + ' elapsed_s=' + [math]::Round($sw.Elapsed.TotalSeconds,1))

Write-Output ''
Write-Output '=== decisive errors ==='
Select-String -Path $logf -Pattern 'error |MSB[0-9]{4}|LNK[0-9]{4}|_MSC_VER|mismatch' -ErrorAction SilentlyContinue |
  Select-Object -First 30 | ForEach-Object { Write-Output ('  ' + $_.Line.Trim()) }

Write-Output ''
Write-Output '=== exe produced? ==='
Get-ChildItem "$proj\windows" -Recurse -Filter 'HeytaRnwSpike.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName