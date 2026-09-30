$ErrorActionPreference = 'Continue'
$app = 'C:\src\heyta-m2\apps\desktop-windows\HeytaWindows\HeytaWindows.csproj'
Set-Location 'C:\src\heyta-m2\apps\desktop-windows'
$sw=[System.Diagnostics.Stopwatch]::StartNew()
$out = & dotnet build $app -c Debug -p:Platform=x64 --nologo 2>&1
$code = $LASTEXITCODE
$out | Select-Object -Last 14
Write-Output ('DOTNET_EXIT=' + $code + ' elapsed_s=' + [math]::Round($sw.Elapsed.TotalSeconds,1))
$out | Select-String -Pattern ': error' | Select-Object -First 8 | ForEach-Object { Write-Output ('  ERR ' + $_.Line.Trim()) }
Get-ChildItem 'C:\src\heyta-m2\apps\desktop-windows\HeytaWindows\bin' -Recurse -Filter 'HeytaWindows.exe' -ErrorAction SilentlyContinue | Select-Object -First 2 -ExpandProperty FullName
