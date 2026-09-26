# verify-apk.ps1 - prove an APK is really the thing you think it is.
#
# The runbook (docs/runbooks/multi-platform-build.md section 1.3) says not to trust
# "BUILD SUCCESSFUL" on its own. This script does the mechanical part of that check
# on Windows, where the artifact is produced.
#
# ASCII only - Windows PowerShell 5.1 mis-parses non-ASCII bytes outside a BOM.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\verify-apk.ps1
#   ... -Apk <path to .apk>
#   ... -ExpectCleartext      # release builds: assert usesCleartextTraffic=true

param(
  [string]$Apk = '',
  [switch]$ExpectCleartext,
  [switch]$ExpectBundle,
  [string]$SdkRoot = "$env:LOCALAPPDATA\Android\Sdk",
  [string]$RepoRoot = 'C:\src\heyta'
)

$ErrorActionPreference = 'Stop'

if (-not $Apk) {
  $Apk = Join-Path $RepoRoot 'apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk'
}

if (-not (Test-Path $Apk)) {
  throw "APK not found: $Apk"
}

$failures = @()
function Check($name, $ok, $detail) {
  $status = if ($ok) { '[ok]' } else { '[--]' }
  $color  = if ($ok) { 'Green' } else { 'Red' }
  Write-Host ("  {0} {1,-34} {2}" -f $status, $name, $detail) -ForegroundColor $color
  if (-not $ok) { $script:failures += $name }
}

Write-Host ''
Write-Host '=== APK verification ===' -ForegroundColor Magenta
Write-Host "  path: $Apk"

$file = Get-Item $Apk
$hash = (Get-FileHash $Apk -Algorithm SHA256).Hash
Write-Host ("  size: {0:N0} bytes" -f $file.Length)
Write-Host ("  mtime: {0}" -f $file.LastWriteTime)
Write-Host ("  sha256: {0}" -f $hash)
Write-Host ''

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($Apk)
try {
  $names = @{}
  foreach ($e in $zip.Entries) { $names[$e.FullName] = $e.Length }

  Check 'AndroidManifest.xml' $names.ContainsKey('AndroidManifest.xml') 'binary manifest'
  Check 'classes.dex' ($names.ContainsKey('classes.dex') -and $names['classes.dex'] -gt 0) `
    ("{0:N0} bytes" -f $names['classes.dex'])
  Check 'resources.arsc' $names.ContainsKey('resources.arsc') `
    $(if ($names.ContainsKey('resources.arsc')) { "{0:N0} bytes" -f $names['resources.arsc'] } else { '' })

  # The JS bundle is what makes this a React Native app rather than a bare shell.
  # A missing or tiny bundle is exactly the stale/empty-package failure mode the
  # runbook warns about - but only for RELEASE builds.
  #
  # React Native's gradle config defaults `debuggableVariants` to ["debug",
  # "debugOptimized"] and skips bundling for those, so a debug APK legitimately has
  # no assets/index.android.bundle (it loads JS from Metro instead). Demanding the
  # bundle there would produce a false alarm on every debug build.
  $expectBundle = $ExpectBundle.IsPresent -or ($Apk -match '\\release\\')
  $bundleName = 'assets/index.android.bundle'
  if ($names.ContainsKey($bundleName)) {
    # Assert a real size floor, not mere presence: a truncated bundle means Metro
    # ran but produced nothing usable.
    Check $bundleName ($names[$bundleName] -gt 100000) ("{0:N0} bytes" -f $names[$bundleName])
  } elseif ($expectBundle) {
    Check $bundleName $false 'MISSING - Metro output never made it into the APK'
  } else {
    Write-Host ("  [ok] {0,-34} {1}" -f $bundleName, 'absent by design (debug loads JS from Metro)') `
      -ForegroundColor Green
  }

  $abis = @{}
  foreach ($n in $names.Keys) {
    if ($n -like 'lib/*/*.so') {
      $abi = ($n -split '/')[1]
      if (-not $abis.ContainsKey($abi)) { $abis[$abi] = 0 }
      $abis[$abi]++
    }
  }
  foreach ($abi in ($abis.Keys | Sort-Object)) {
    Check "native libs $abi" ($abis[$abi] -gt 0) ("{0} .so files" -f $abis[$abi])
  }
  if ($abis.Count -eq 0) {
    Check 'native libs' $false 'no lib/<abi>/*.so found (newArch native code missing)'
  }

  if ($ExpectCleartext) {
    # Binary AndroidManifest.xml cannot be grepped. aapt2 from build-tools is the
    # supported way to dump it as text.
    $aapt2 = Get-ChildItem (Join-Path $SdkRoot 'build-tools\*\aapt2.exe') -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending | Select-Object -First 1 -Expand FullName
    if (-not $aapt2) {
      Check 'usesCleartextTraffic' $false "aapt2 not found under $SdkRoot\build-tools"
    } else {
      $dump = & $aapt2 dump xmltree --file AndroidManifest.xml $Apk 2>&1 | Out-String
      # aapt2 prints the boolean as a literal:
      #   A: http://schemas.android.com/apk/res/android:usesCleartextTraffic(0x010104ec)=true
      # (aapt v1 prints `=(type 0x12)0xffffffff` instead, which is why a regex copied
      #  from an aapt-era doc silently never matches here.)
      $hasTrue = $dump -match 'usesCleartextTraffic\(0x[0-9a-f]+\)=true'
      if (-not $hasTrue) {
        $line = ($dump -split "`n" | Where-Object { $_ -match 'usesCleartextTraffic' }) -join ' | '
        $detail = if ($line) { "found but not true: $line" } else { 'attribute absent from the packaged manifest' }
      } else {
        $detail = "via $aapt2"
      }
      Check 'usesCleartextTraffic=true' $hasTrue $detail
    }
  }
} finally {
  $zip.Dispose()
}

Write-Host ''
if ($failures.Count -gt 0) {
  Write-Warning ("FAILED checks: " + ($failures -join ', '))
  exit 1
}
Write-Host '[ok] APK looks structurally sound.' -ForegroundColor Green
exit 0
