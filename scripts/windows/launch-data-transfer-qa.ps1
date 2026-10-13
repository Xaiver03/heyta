# Launch and finalize Windows data-transfer QA without publishing or installing.
# WebView2 ignores WEBVIEW2_USER_DATA_FOLDER and --user-data-dir here. Copying
# the Debug output makes its default <exe>.WebView2 profile disposable.

param(
  [string]$Repo = 'C:\src\heyta',
  [string]$QaRoot = '',
  [int]$CdpPort = 9222,
  [string]$Manifest = '',
  [switch]$Finalize,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'

function NormalizeAbsolutePath([string]$path) {
  if ([string]::IsNullOrWhiteSpace($path)) { throw 'A path is required.' }
  if (-not [IO.Path]::IsPathRooted($path)) { throw "Path must be absolute: $path" }
  $full = [IO.Path]::GetFullPath($path)
  $root = [IO.Path]::GetPathRoot($full)
  if ($full.Length -gt $root.Length) { $full = $full.TrimEnd([char]'\') }
  return $full
}

function SamePath([string]$left, [string]$right) {
  return [string]::Equals((NormalizeAbsolutePath $left), (NormalizeAbsolutePath $right), [StringComparison]::OrdinalIgnoreCase)
}

function IsPathBelow([string]$path, [string]$parent) {
  $childFull = NormalizeAbsolutePath $path
  $parentFull = NormalizeAbsolutePath $parent
  return $childFull.StartsWith(($parentFull.TrimEnd([char]'\') + '\'), [StringComparison]::OrdinalIgnoreCase)
}

function AssertNoReparseAncestors([string]$path) {
  $current = NormalizeAbsolutePath $path
  while ($true) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "QA path crosses a reparse point: $current"
      }
    }
    $parent = Split-Path -Parent $current
    if ([string]::IsNullOrWhiteSpace($parent) -or (SamePath $parent $current)) { break }
    $current = $parent
  }
}

function AssertSafeFreshQaRoot([string]$path, [string]$defaultDir) {
  $root = NormalizeAbsolutePath $path
  $driveRoot = [IO.Path]::GetPathRoot($root)
  if (SamePath $root $driveRoot) { throw "QA root must not be a drive root: $root" }
  if ((SamePath $root $defaultDir) -or (IsPathBelow $root $defaultDir) -or (IsPathBelow $defaultDir $root)) {
    throw "QA root must be separate from the default data directory: $root"
  }
  if (Test-Path -LiteralPath $root) {
    throw "QA root already exists; refusing to delete or reuse it: $root"
  }
  $parent = Split-Path -Parent $root
  if ([string]::IsNullOrWhiteSpace($parent) -or -not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw "QA root parent must already exist: $parent"
  }
  AssertNoReparseAncestors $parent
  return $root
}

function AssertManifestPath([string]$path, [string]$qaRoot, [bool]$mustBeNew) {
  $full = NormalizeAbsolutePath $path
  if (-not (IsPathBelow $full $qaRoot)) {
    throw "Manifest must be inside the QA root: $full"
  }
  if ($mustBeNew -and (Test-Path -LiteralPath $full)) {
    throw "Manifest already exists; refusing to overwrite it: $full"
  }
  return $full
}

function HashOpen([string]$path) {
  $fs = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return ((([BitConverter]::ToString($sha.ComputeHash($fs))) -replace '-', '').ToLowerInvariant())
  } finally {
    $sha.Dispose()
    $fs.Dispose()
  }
}

function SnapshotDefaultFiles([string]$dir) {
  $rows = @()
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return @() }
  $prefix = (NormalizeAbsolutePath $dir).TrimEnd([char]'\') + '\'
  Get-ChildItem -LiteralPath $dir -Recurse -File -Force | Sort-Object FullName | ForEach-Object {
    $rows += [ordered]@{
      path = $_.FullName.Substring($prefix.Length)
      length = $_.Length
      sha256 = (HashOpen $_.FullName)
      lastWriteUtc = $_.LastWriteTimeUtc.ToString('o')
    }
  }
  return @($rows)
}

function SnapshotSqliteFiles([string]$dir) {
  $rows = @()
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return @() }
  Get-ChildItem -LiteralPath $dir -Recurse -File -Filter 'heyta.sqlite*' -Force | Sort-Object FullName | ForEach-Object {
    $rows += [ordered]@{
      path = $_.FullName
      length = $_.Length
      sha256 = (HashOpen $_.FullName)
      lastWriteUtc = $_.LastWriteTimeUtc.ToString('o')
    }
  }
  return @($rows)
}

function SnapshotMap($rows) {
  $map = @{}
  foreach ($row in @($rows)) { $map[[string]$row.path] = $row }
  return $map
}

function CompareSnapshots($before, $after) {
  $beforeMap = SnapshotMap $before
  $afterMap = SnapshotMap $after
  $differences = @()
  $paths = @($beforeMap.Keys + $afterMap.Keys | Sort-Object -Unique)
  foreach ($path in $paths) {
    $hasBefore = $beforeMap.ContainsKey($path)
    $hasAfter = $afterMap.ContainsKey($path)
    if (-not $hasBefore) {
      $differences += [ordered]@{ type = 'added'; path = $path; after = $afterMap[$path] }
    } elseif (-not $hasAfter) {
      $differences += [ordered]@{ type = 'removed'; path = $path; before = $beforeMap[$path] }
    } else {
      $old = $beforeMap[$path]
      $new = $afterMap[$path]
      if ($old.length -ne $new.length -or $old.sha256 -ne $new.sha256 -or $old.lastWriteUtc -ne $new.lastWriteUtc) {
        $differences += [ordered]@{ type = 'changed'; path = $path; before = $old; after = $new }
      }
    }
  }
  return [ordered]@{
    unchanged = ($differences.Count -eq 0)
    differences = @($differences)
  }
}

function SetManifestProperty($object, [string]$name, $value) {
  if ($object -is [Collections.IDictionary]) {
    $object[$name] = $value
    return
  }
  $property = $object.PSObject.Properties[$name]
  if ($null -eq $property) {
    $object | Add-Member -MemberType NoteProperty -Name $name -Value $value
  } else {
    $property.Value = $value
  }
}

function WriteManifest($object, [string]$path) {
  $object | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $path -Encoding UTF8
}

function QuotePsLiteral([string]$value) { return ($value -replace "'", "''") }

if ($Finalize -and $ValidateOnly) { throw '-Finalize and -ValidateOnly cannot be used together.' }
if ($CdpPort -lt 1024 -or $CdpPort -gt 65535) { throw "Invalid CDP port: $CdpPort" }

$defaultDir = NormalizeAbsolutePath (Join-Path $env:LOCALAPPDATA 'heyta')

if ($Finalize) {
  if ([string]::IsNullOrWhiteSpace($QaRoot)) { throw '-Finalize requires -QaRoot.' }
  $QaRoot = NormalizeAbsolutePath $QaRoot
  if ([string]::IsNullOrWhiteSpace($Manifest)) { $Manifest = Join-Path $QaRoot 'data-transfer-qa-manifest.json' }
  $Manifest = AssertManifestPath $Manifest $QaRoot $false
  if (-not (Test-Path -LiteralPath $Manifest -PathType Leaf)) { throw "Manifest missing: $Manifest" }
  AssertNoReparseAncestors $QaRoot

  $manifestObject = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
  if (-not (SamePath ([string]$manifestObject.qaRoot) $QaRoot)) { throw 'Manifest QA root does not match -QaRoot.' }
  if ([string]$manifestObject.lifecycle -ne 'running') { throw "Manifest is not running: $($manifestObject.lifecycle)" }
  $data = NormalizeAbsolutePath ([string]$manifestObject.dataDirectory)
  $exe = NormalizeAbsolutePath ([string]$manifestObject.executablePath)
  if (-not (IsPathBelow $data $QaRoot) -or -not (IsPathBelow $exe $QaRoot)) { throw 'Manifest paths escaped the QA root.' }
  if (-not (SamePath ([string]$manifestObject.defaultDataDirectory) $defaultDir)) { throw 'Manifest default data directory does not match this user.' }
  $pidPath = Join-Path $data 'qa-heyta-process-id.txt'
  $qaPid = [int]$manifestObject.processId
  if ($qaPid -le 0) { throw 'Manifest processId is missing or invalid.' }
  if ((Test-Path -LiteralPath $pidPath -PathType Leaf) -and ([int](Get-Content -LiteralPath $pidPath -Raw).Trim() -ne $qaPid)) {
    throw "QA process PID evidence does not match the manifest: $pidPath"
  }

  $processState = 'already-exited'
  $process = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $qaPid) | Select-Object -First 1
  if ($process) {
    if ($process.Name -ine 'HeytaWindows.exe' -or [string]::IsNullOrWhiteSpace($process.ExecutablePath) -or -not (SamePath $process.ExecutablePath $exe)) {
      throw "Recorded PID does not belong to this QA executable; refusing to stop PID $qaPid."
    }
    Stop-Process -Id $qaPid -Force
    $processState = 'stopped'
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Seconds 1
      if (-not (Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $qaPid))) { break }
    }
    if (Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $qaPid)) { throw "QA process did not exit: $qaPid" }
  }

  $profile = [string]$manifestObject.webviewUserDataFolder
  if (-not [string]::IsNullOrWhiteSpace($profile) -and -not (IsPathBelow $profile $QaRoot)) { throw 'Manifest WebView2 profile escaped the QA root.' }
  $portToken = 'remote-debugging-port=' + [string]$manifestObject.cdpPort
  if (-not [string]::IsNullOrWhiteSpace($profile)) {
    Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object {
      $_.CommandLine -and $_.CommandLine.IndexOf($portToken, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $_.CommandLine.IndexOf($profile, [StringComparison]::OrdinalIgnoreCase) -ge 0
    } | ForEach-Object { Stop-Process -Id ([int]$_.ProcessId) -Force -ErrorAction SilentlyContinue }
  }

  $defaultAfter = SnapshotDefaultFiles $defaultDir
  $qaAfter = SnapshotSqliteFiles $data
  $comparison = CompareSnapshots $manifestObject.defaultFilesBefore $defaultAfter
  SetManifestProperty $manifestObject 'lifecycle' 'finalized'
  SetManifestProperty $manifestObject 'finalizedUtc' ([DateTime]::UtcNow.ToString('o'))
  SetManifestProperty $manifestObject 'processStop' ([ordered]@{ pid = $qaPid; state = $processState })
  SetManifestProperty $manifestObject 'defaultFilesAfter' $defaultAfter
  SetManifestProperty $manifestObject 'qaFilesAfter' $qaAfter
  SetManifestProperty $manifestObject 'defaultComparison' $comparison
  WriteManifest $manifestObject $Manifest
  if (-not $comparison.unchanged) { throw "Default data directory changed; see defaultComparison in $Manifest" }
  Write-Output ('MANIFEST=' + $Manifest)
  Write-Output 'DEFAULT_DATA_UNCHANGED=True'
  Write-Output 'RESULT=OK'
  exit 0
}

if ([string]::IsNullOrWhiteSpace($QaRoot)) { $QaRoot = Join-Path $env:TEMP ('heyta-data-transfer-qa-' + [guid]::NewGuid().ToString('N')) }
$QaRoot = AssertSafeFreshQaRoot $QaRoot $defaultDir
if ([string]::IsNullOrWhiteSpace($Manifest)) { $Manifest = Join-Path $QaRoot 'data-transfer-qa-manifest.json' }
$Manifest = AssertManifestPath $Manifest $QaRoot $true
if ($ValidateOnly) {
  Write-Output ('QA_ROOT=' + $QaRoot)
  Write-Output ('MANIFEST=' + $Manifest)
  Write-Output 'VALIDATION=OK'
  exit 0
}

$Repo = NormalizeAbsolutePath $Repo
$app = Join-Path $QaRoot 'app'
$data = Join-Path $QaRoot 'data'
$profileRoot = Join-Path $app 'HeytaWindows.exe.WebView2'
$exe = Join-Path $app 'HeytaWindows.exe'
$build = Join-Path $Repo 'apps\desktop-windows\HeytaWindows\bin\x64\Debug\net10.0-windows10.0.19041.0'
$web = Join-Path $Repo 'apps\web\dist'
if (-not (Test-Path -LiteralPath (Join-Path $build 'HeytaWindows.exe') -PathType Leaf)) { throw "Debug exe missing: $build" }
if (-not (Test-Path -LiteralPath (Join-Path $web 'index.html') -PathType Leaf)) { throw "web-dist missing: $web" }

New-Item -ItemType Directory -Path $QaRoot | Out-Null
New-Item -ItemType Directory -Path $app | Out-Null
New-Item -ItemType Directory -Path $data | Out-Null
Copy-Item -Path (Join-Path $build '*') -Destination $app -Recurse -Force

$defaultBefore = SnapshotDefaultFiles $defaultDir
$qaBefore = SnapshotSqliteFiles $data
$task = 'heyta-data-transfer-qa-' + [guid]::NewGuid().ToString('N')
$launcher = Join-Path $QaRoot 'launch.ps1'
$pidPath = Join-Path $data 'qa-heyta-process-id.txt'
$launcherBody = @"
`$env:HEYTA_QA_DATA_DIR = '$(QuotePsLiteral $data)'
`$env:HEYTA_WEB_ROOT = '$(QuotePsLiteral $web)'
`$env:HEYTA_WEB_MODE = 'app'
`$env:HEYTA_SHELL_STORAGE = '1'
`$env:HEYTA_M2_EVIDENCE = '$(QuotePsLiteral (Join-Path $data 'm2-evidence'))'
`$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=$CdpPort'
`$p = Start-Process -FilePath '$(QuotePsLiteral $exe)' -WorkingDirectory '$(QuotePsLiteral $app)' -PassThru
`$p.Id | Set-Content -LiteralPath '$(QuotePsLiteral $pidPath)' -Encoding ASCII
"@
Set-Content -LiteralPath $launcher -Value $launcherBody -Encoding ASCII

$manifestObject = [ordered]@{
  schemaVersion = 2
  lifecycle = 'running'
  generatedUtc = [DateTime]::UtcNow.ToString('o')
  startedUtc = [DateTime]::UtcNow.ToString('o')
  qaRoot = $QaRoot
  dataDirectory = $data
  sqlitePath = Join-Path $data 'heyta.sqlite'
  executablePath = $exe
  launcherPath = $launcher
  scheduledTask = $task
  cdpPort = $CdpPort
  webviewUserDataFolder = ''
  webviewProcessCommandLine = ''
  defaultDataDirectory = $defaultDir
  defaultFilesBefore = $defaultBefore
  qaFilesBefore = $qaBefore
  steps = @('validate fresh isolated QA root', 'copy Debug output to qaRoot\app', 'set HEYTA_QA_DATA_DIR and HEYTA_M2_EVIDENCE to qaRoot\data', 'launch interactive task', 'wait for heyta.local CDP target', 'read CoreWebView2.Environment.UserDataFolder', 'finalize with exact PID and compare all default files')
}
WriteManifest $manifestObject $Manifest

# The task is a one-shot interactive launcher, not a second scheduled launch.
# Put the fallback date far enough ahead and remove our own task immediately
# after /Run; deleting a task does not stop its already-running process.
$start = (Get-Date).AddDays(1)
try {
  & schtasks.exe /Create /TN $task /TR ("powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$launcher`"") /SC ONCE /SD $start.ToString('yyyy/MM/dd') /ST $start.ToString('HH:mm') /RU $env:USERNAME /IT /F 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not create scheduled task: $task" }
  & schtasks.exe /Run /TN $task 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not run scheduled task: $task" }
} finally {
  & schtasks.exe /Delete /TN $task /F 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not remove one-shot QA task: $task" }
}

$target = $false
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 2
  try {
    $list = (Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:$CdpPort/json/list") -TimeoutSec 3).Content
    if ($list -match 'https://heyta\.local/') { $target = $true; break }
  } catch { }
}
if (-not $target) { throw 'QA WebView2 CDP target was not found.' }

for ($i = 0; $i -lt 30 -and -not (Test-Path -LiteralPath $pidPath -PathType Leaf); $i++) { Start-Sleep -Seconds 1 }
if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) { throw "QA process PID evidence missing: $pidPath" }
$qaPid = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
$process = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $qaPid) | Select-Object -First 1
if (-not $process -or $process.Name -ine 'HeytaWindows.exe' -or [string]::IsNullOrWhiteSpace($process.ExecutablePath) -or -not (SamePath $process.ExecutablePath $exe)) {
  throw "QA process evidence does not point at the copied executable: PID $qaPid"
}

$evidencePath = Join-Path $data 'qa-webview2-user-data-folder.txt'
for ($i = 0; $i -lt 30 -and -not (Test-Path -LiteralPath $evidencePath -PathType Leaf); $i++) { Start-Sleep -Seconds 1 }
if (-not (Test-Path -LiteralPath $evidencePath -PathType Leaf)) { throw "CoreWebView2 profile evidence missing: $evidencePath" }
$actualProfile = (Get-Content -LiteralPath $evidencePath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($actualProfile)) { throw 'CoreWebView2 profile evidence is empty.' }
if ($actualProfile.StartsWith($defaultDir, [StringComparison]::OrdinalIgnoreCase)) { throw "QA profile fell back to default: $actualProfile" }
if (-not (IsPathBelow $actualProfile $app) -and -not (SamePath $actualProfile $profileRoot)) { throw "QA profile escaped copied app root: $actualProfile" }

$proc = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object {
  $_.CommandLine -and $_.CommandLine.IndexOf(('remote-debugging-port=' + $CdpPort), [StringComparison]::OrdinalIgnoreCase) -ge 0
} | Select-Object -First 1
$webviewCommandLine = ''
if ($proc) { $webviewCommandLine = $proc.CommandLine }
SetManifestProperty $manifestObject 'processId' $qaPid
SetManifestProperty $manifestObject 'webviewUserDataFolder' $actualProfile
SetManifestProperty $manifestObject 'webviewProcessCommandLine' $webviewCommandLine
WriteManifest $manifestObject $Manifest
Write-Output ('QA_ROOT=' + $QaRoot)
Write-Output ('SQLITE=' + (Join-Path $data 'heyta.sqlite'))
Write-Output ('WEBVIEW_PROFILE=' + $actualProfile)
Write-Output ('MANIFEST=' + $Manifest)
Write-Output ('FINALIZE=powershell -NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Finalize -QaRoot "' + $QaRoot + '" -Manifest "' + $Manifest + '"')
Write-Output 'LIFECYCLE=running'
Write-Output 'RESULT=OK'
