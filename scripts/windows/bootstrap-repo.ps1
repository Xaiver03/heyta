# bootstrap-repo.ps1 - seed a Windows build host with a source snapshot.
#
# Why this exists:
#   The GitHub clone path needs credentials on the Windows box (PAT or deploy key).
#   Until that is set up, the fastest honest way to get a buildable tree there is to
#   archive the macOS working tree, copy it over, and lay it down as a local git repo
#   with `origin` already pointing at GitHub. Once credentials exist, a plain
#   `git fetch origin && git reset --hard origin/main` brings the host back in sync.
#
# ASCII only - Windows PowerShell 5.1 mis-parses non-ASCII bytes outside a BOM.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\src\bootstrap-repo.ps1 `
#     -Archive C:\src\heyta-src.tar.gz -RepoRoot C:\src\heyta `
#     -RemoteUrl git@github.com:Xaiver03/heyta.git

param(
  [string]$Archive  = 'C:\src\heyta-src.tar.gz',
  [string]$RepoRoot = 'C:\src\heyta',
  [string]$RemoteUrl = 'git@github.com:Xaiver03/heyta.git',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Write-Section($text) {
  Write-Host ''
  Write-Host "=== $text ===" -ForegroundColor Magenta
}

if (-not (Test-Path $Archive)) {
  throw "archive not found: $Archive"
}

Write-Section '1/4 prepare target'
if (Test-Path $RepoRoot) {
  if (-not $Force) {
    throw "$RepoRoot already exists; pass -Force to replace it"
  }
  Write-Host "  -> removing existing $RepoRoot" -ForegroundColor Yellow
  Remove-Item -Recurse -Force $RepoRoot
}
New-Item -ItemType Directory -Force -Path $RepoRoot | Out-Null
Write-Host "  [ok] $RepoRoot" -ForegroundColor Green

Write-Section '2/4 extract snapshot'
# bsdtar ships with Windows 10/11 as tar.exe and reads .tar.gz natively.
& tar -xzf $Archive -C $RepoRoot
if ($LASTEXITCODE -ne 0) { throw "tar exited with $LASTEXITCODE" }
$fileCount = (Get-ChildItem -Recurse -File $RepoRoot | Measure-Object).Count
Write-Host "  [ok] extracted $fileCount files" -ForegroundColor Green

Write-Section '3/4 init local git repo'
Push-Location $RepoRoot
try {
  & git init -b main 2>&1 | Out-Null

  # Do NOT run `git remote remove origin` unconditionally: with $ErrorActionPreference
  # = 'Stop', PowerShell 5.1 turns git's stderr ("No such remote") into a terminating
  # NativeCommandError and the script dies mid-way. Probe first instead.
  $remotes = & git remote
  if ($remotes -contains 'origin') { & git remote remove origin }
  & git remote add origin $RemoteUrl
  & git add -A

  # Commit identity is set per-command so we do not depend on host global config.
  & git -c user.name='heyta build host' -c user.email='build-host@localhost' `
      commit -q -m 'bootstrap: source snapshot from macOS working tree'
  if ($LASTEXITCODE -ne 0) { throw "git commit exited with $LASTEXITCODE" }

  $head = (& git rev-parse --short HEAD)
  $branch = (& git rev-parse --abbrev-ref HEAD)
  Write-Host "  [ok] $branch @ $head, origin = $RemoteUrl" -ForegroundColor Green
} finally {
  Pop-Location
}

Write-Section '4/4 next steps'
Write-Host '  The tree is present but this is a local baseline commit, not upstream history.'
Write-Host '  To rejoin upstream once credentials exist on this host:'
Write-Host '    git fetch origin'
Write-Host '    git reset --hard origin/main'
Write-Host ''
Write-Host '  Then install dependencies and build:'
Write-Host "    cd $RepoRoot"
Write-Host '    corepack pnpm install'
Write-Host '    corepack pnpm -r build'
Write-Host '    corepack pnpm build:android:debug'
