$ErrorActionPreference = 'Continue'
$env:CI = 'true'

function Log($m) { $m | Tee-Object -FilePath 'C:\src\rnw-scaffold.log' -Append }

Log ('=== STEP1 template-only ' + (Get-Date).ToString('s') + ' ===')
Set-Location 'C:\src\heyta-rnw-spike'
if (Test-Path '.\HeytaRnwSpike') { Remove-Item '.\HeytaRnwSpike' -Recurse -Force -ErrorAction SilentlyContinue }

$out = & npx.cmd --yes @react-native-community/cli@20.2.0 init HeytaRnwSpike `
  --version 0.84.1 --skip-install --skip-git-init --replace-directory true --pm npm 2>&1
$out | ForEach-Object { Log $_ }
Log ('STEP1_EXIT=' + $LASTEXITCODE)

Log ('=== STEP1 files ===')
Get-ChildItem '.\HeytaRnwSpike' -Force -ErrorAction SilentlyContinue | ForEach-Object { Log ('  ' + $_.Name) }

Log '=== STEP1 package.json ==='
Get-Content '.\HeytaRnwSpike\package.json' -Raw -ErrorAction SilentlyContinue | ForEach-Object { Log $_ }

Log ('=== STEP2 npm install start ' + (Get-Date).ToString('s') + ' ===')
Set-Location 'C:\src\heyta-rnw-spike\HeytaRnwSpike'
$out2 = & npm.cmd install --no-audit --no-fund --loglevel http 2>&1
$out2 | Select-Object -Last 40 | ForEach-Object { Log $_ }
Log ('STEP2_EXIT=' + $LASTEXITCODE)
Log ('node_modules count=' + (Get-ChildItem '.\node_modules' -ErrorAction SilentlyContinue | Measure-Object).Count)
Log ('=== done ' + (Get-Date).ToString('s') + ' ===')