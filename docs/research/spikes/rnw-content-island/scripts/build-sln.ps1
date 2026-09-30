$ErrorActionPreference = 'Continue'
$proj = 'C:\src\heyta-rnw-spike\HeytaRnwSpike'
$msb  = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\amd64\MSBuild.exe'
$sln  = "$proj\windows\HeytaRnwSpike.sln"
$logf = 'C:\src\msbuild-sln.log'
Remove-Item $logf -Force -ErrorAction SilentlyContinue
Set-Location $proj

Write-Output '=== BUILD app project inside solution context (SolutionDir defined) ==='
Write-Output ('sln=' + (Test-Path $sln))
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& $msb $sln -restore -t:HeytaRnwSpike -p:Configuration=Debug -p:Platform=x64 -v:minimal -nologo -m *>&1 |
  Tee-Object -FilePath $logf | Select-Object -Last 70
Write-Output ('MSBUILD_EXIT=' + $LASTEXITCODE + ' elapsed_s=' + [math]::Round($sw.Elapsed.TotalSeconds,1))

Write-Output ''
Write-Output '=== decisive errors ==='
Select-String -Path $logf -Pattern 'error |MSB[0-9]{4}|LNK[0-9]{4}|v145|MSVC' -ErrorAction SilentlyContinue |
  Select-Object -First 30 | ForEach-Object { Write-Output ('  ' + $_.Line.Trim()) }

Write-Output ''
Write-Output '=== exe produced? ==='
Get-ChildItem "$proj\windows" -Recurse -Filter 'HeytaRnwSpike.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName