$ErrorActionPreference = 'Continue'

Write-Output '=== winget install Microsoft.PowerShell ==='
$out = & winget install --id Microsoft.PowerShell --exact --silent --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | Out-String
Write-Output $out
Write-Output ('winget_exit=' + $LASTEXITCODE)

Write-Output ''
Write-Output '=== locate pwsh.exe ==='
$cands = @()
$cands += (Get-Command pwsh.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
$cands += (Get-ChildItem 'C:\Program Files\PowerShell' -Recurse -Filter 'pwsh.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
$cands = $cands | Where-Object { $_ }
if ($cands.Count -eq 0) { Write-Output 'PWSH_NOT_FOUND' } else { $cands | ForEach-Object { Write-Output ('FOUND ' + $_) } }

Write-Output ''
Write-Output '=== machine PATH contains PowerShell? ==='
[Environment]::GetEnvironmentVariable('Path','Machine') -split ';' | Where-Object { $_ -like '*PowerShell*' }
Write-Output '=== user PATH contains PowerShell? ==='
[Environment]::GetEnvironmentVariable('Path','User') -split ';' | Where-Object { $_ -like '*PowerShell*' }