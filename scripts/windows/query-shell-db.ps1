# Read the shell's own SQLite file(s) from OUTSIDE the app, looking for a datum
# the page wrote. Dependency-free on purpose (no sqlite3 CLI on that box):
# SQLite stores TEXT and the schema SQL literally, so a byte-level UTF-8 scan
# answers both "is the datum in this file" and "does the ops table exist".
#
# Two measured details (2026-09-30, Windows):
#   1. The app holds the DB open, so a plain ReadAllBytes fails with a sharing
#      violation -> open with FileShare.ReadWrite.
#   2. SQLite may still have the newest commit in the -wal file. Scan BOTH and
#      report separately: "in the wal" and "in the main file" are different
#      durability claims, and only the main file survives a checkpoint-less copy.
#
# Usage (from macOS):
#   scp scripts/windows/query-shell-db.ps1 windows-pc:C:/src/heyta-query-shell-db.ps1
#   ssh windows-pc "powershell -NoProfile -ExecutionPolicy Bypass -File C:/src/heyta-query-shell-db.ps1 -Title <title>"
param([Parameter(Mandatory=$true)][string]$Title)

function Probe([string]$path) {
  if (-not (Test-Path $path)) { return 'MISSING' }
  $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  try {
    $len = $fs.Length
    $bytes = New-Object byte[] $len
    [void]$fs.Read($bytes, 0, [int]$len)
  } finally { $fs.Close() }
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  return ('bytes={0} title={1} ops_table={2}' -f $len, $text.Contains($Title), $text.Contains('CREATE TABLE "ops"'))
}

$dir = Join-Path $env:LOCALAPPDATA 'heyta'
Write-Output ('TITLE=' + $Title)
Write-Output ('MAIN ' + (Probe (Join-Path $dir 'heyta.sqlite')))
Write-Output ('WAL  ' + (Probe (Join-Path $dir 'heyta.sqlite-wal')))
