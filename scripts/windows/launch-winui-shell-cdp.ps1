# Publish the WinUI 3 shell and launch it in the INTERACTIVE desktop session
# with the WebView2 remote debugging port open, so Playwright can attach over CDP.
#
# Run this over SSH (it is NOT a GUI script itself). The GUI part is delegated to
# a scheduled task with /IT, because an SSH session has no desktop (session 0):
# a WinUI 3 window cannot come up there.
#
# ASCII ONLY. PowerShell 5.1 decodes BOM-less UTF-8 as ANSI, so any non-ASCII
# character here breaks parsing at a location far from the real cause.
#
# Facts written to -Result (key=value) are what the caller asserts on. The point
# of the identity facts is that a CDP port alone proves nothing: this repo has
# already been burned once by attaching to whatever else owned the port.

param(
  [string]$Repo = 'C:\src\heyta',
  [string]$Build = 'C:\src\heyta-win-journey',
  [int]$CdpPort = 9287,
  [string]$Result = 'C:\src\heyta-win-journey-result.txt',
  # B: hand the page's storage to the shell's SQLite (default OFF, see BLOCKED.md #3).
  [switch]$ShellStorage
)

$ErrorActionPreference = 'Continue'
$facts = New-Object System.Collections.Generic.List[string]
function Add-Fact([string]$line) { $facts.Add($line) | Out-Null }

Add-Fact '=== 1. publish (self-contained) ==='
$proj = Join-Path $Repo 'apps\desktop-windows\HeytaWindows\HeytaWindows.csproj'
$pubDir = Join-Path $Build 'app'
# Preserve WebView2's profile across the publish wipe.
#
# The profile lives at <pubDir>\HeytaWindows.exe.WebView2 and holds the page's
# OPFS -- i.e. the data the "legacy" (pre-storage-host) backend wrote. Wiping it
# every run makes the "OPFS -> shell SQLite import" impossible to test.
# An installed app keeps its profile across upgrades; this restores that property
# for the test harness without touching product code.
#
# MEASURED 2026-09-30: WEBVIEW2_USER_DATA_FOLDER does NOT relocate it here, and
# CoreWebView2Environment.CreateAsync is unavailable in this WinAppSDK project
# (CS1501) -- so preserving the directory is the approach that actually works.
$profileBackup = Join-Path $Build 'webview-profile-backup'
$profileInApp = Join-Path $pubDir 'HeytaWindows.exe.WebView2'
Remove-Item $profileBackup -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $profileInApp) { Copy-Item $profileInApp $profileBackup -Recurse -Force }
Remove-Item $pubDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $pubDir -Force | Out-Null

$pub = dotnet publish $proj -c Release -p:Platform=x64 -p:RuntimeIdentifier=win-x64 --self-contained true -o $pubDir 2>&1
$pub | Select-String -Pattern 'error|Build succeeded' | Select-Object -First 4 | ForEach-Object { Add-Fact ('  ' + $_.Line) }
$exe = Join-Path $pubDir 'HeytaWindows.exe'
if (-not (Test-Path $exe)) {
  Add-Fact 'RESULT=PUBLISH_FAILED'
  # Print as well as persist: a silent failure looks exactly like "nothing happened"
  # (measured 2026-09-30 -- a C# compile error produced no stdout at all).
  $facts | ForEach-Object { Write-Output $_ }
  $facts | Set-Content $Result -Encoding ASCII
  exit 1
}
$bundle = Join-Path $pubDir 'native-bridge.js'
Add-Fact ('  exe=' + (Get-Item $exe).Length + ' bytes native-bridge=' + (Test-Path $bundle))
if (-not (Test-Path $bundle)) {
  Add-Fact 'RESULT=BUNDLE_MISSING'
  # Print as well as persist: a silent failure looks exactly like "nothing happened"
  # (measured 2026-09-30 -- a C# compile error produced no stdout at all).
  $facts | ForEach-Object { Write-Output $_ }
  $facts | Set-Content $Result -Encoding ASCII
  exit 1
}

# MEASURED: `dotnet publish` drops the app's OWN XAML resources (App.xbf /
# MainWindow.xbf / HeytaWindows.pri) which the build output does have. Without
# them InitializeComponent() cannot load ms-appx:///App.xaml and the process
# starts then dies inside Microsoft.UI.Xaml.dll (0xc000027b / E_FAIL) with no
# window -- which looks exactly like "the shell did not launch".
Add-Fact '=== 2. restore XAML resources ==='
$priSrc = Get-ChildItem (Join-Path $Repo 'apps\desktop-windows\HeytaWindows\bin') -Recurse -File -Filter 'HeytaWindows.pri' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$copied = @()
if ($priSrc) {
  foreach ($pat in @('*.xbf', '*.pri')) {
    Get-ChildItem (Join-Path $priSrc.DirectoryName $pat) -File -ErrorAction SilentlyContinue | ForEach-Object {
      Copy-Item $_.FullName (Join-Path $pubDir $_.Name) -Force
      $copied += $_.Name
    }
  }
}
Add-Fact ('  restored: ' + (($copied | Sort-Object) -join ', '))
if (-not (Test-Path (Join-Path $pubDir 'HeytaWindows.pri'))) {
  Add-Fact 'RESULT=XAML_RESOURCES_MISSING'
  # Print as well as persist: a silent failure looks exactly like "nothing happened"
  # (measured 2026-09-30 -- a C# compile error produced no stdout at all).
  $facts | ForEach-Object { Write-Output $_ }
  $facts | Set-Content $Result -Encoding ASCII
  exit 1
}

# The shell serves the REAL app from web-dist next to the exe. Ship it and assert
# it, so a shell that can only show the spike page cannot pass as the product.
Add-Fact '=== 3. web-dist ==='
$webSrc = Join-Path $Repo 'apps\web\dist'
if (-not (Test-Path (Join-Path $webSrc 'index.html'))) {
  Add-Fact 'RESULT=WEB_DIST_MISSING'
  # Print as well as persist: a silent failure looks exactly like "nothing happened"
  # (measured 2026-09-30 -- a C# compile error produced no stdout at all).
  $facts | ForEach-Object { Write-Output $_ }
  $facts | Set-Content $Result -Encoding ASCII
  exit 1
}
$webTarget = Join-Path $pubDir 'web-dist'
Remove-Item $webTarget -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $webSrc $webTarget -Recurse -Force
Add-Fact ('  index.html=' + (Get-Item (Join-Path $webTarget 'index.html')).Length + ' bytes files=' + (Get-ChildItem $webTarget -Recurse -File | Measure-Object).Count)

# Restore the preserved WebView2 profile (see the note above step 1).
if (Test-Path $profileBackup) {
  Copy-Item $profileBackup $profileInApp -Recurse -Force
  Add-Fact ('  webview profile restored: ' + (Get-ChildItem $profileInApp -Recurse -File -EA SilentlyContinue | Measure-Object).Count + ' files')
} else {
  Add-Fact '  webview profile: (none yet -- first run)'
}

# The launcher runs INSIDE the interactive session, so it sets the env vars the
# shell reads. WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is the documented override
# for CoreWebView2EnvironmentOptions.AdditionalBrowserArguments; it must be set
# before the WebView2 environment is created (we set it before the process starts,
# which is the earliest possible point).
Add-Fact '=== 4. launcher (interactive session) ==='
$launchPs1 = Join-Path $Build 'launch.ps1'
# The shell writes its own M2-D verdict here (HEYTA_M2_EVIDENCE gets ".txt").
$out = Join-Path $Build 'shell-evidence'
$launcher = @'
$exe = '__EXE__'
$out = '__OUT__'
$env:HEYTA_WEB_ROOT = '__WEBROOT__'
$env:HEYTA_WEB_MODE = 'app'
$env:HEYTA_M2_EVIDENCE = $out
# Keep WebView2's profile OUTSIDE the publish dir (which step 1 wipes).
# Two reasons: (a) it mirrors an installed app, where the profile is stable;
# (b) the OPFS-backed legacy store must survive a relaunch, otherwise the
# "OPFS -> shell SQLite import" can never be tested end to end.
#
# MEASURED 2026-09-30: setting WEBVIEW2_USER_DATA_FOLDER does NOT work here --
# the WebView2 process still pointed at <exe>.WebView2\EBWebView. So the shell
# creates the environment explicitly from HEYTA_WEBVIEW_PROFILE instead
# (see MainWindow.xaml.cs).
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=__PORT__'
__STORAGELINE__
Get-Process -Name HeytaWindows -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) | Out-Null
'@
# Single-quoted on purpose: a double-quoted string would INTERPOLATE
# $env:HEYTA_SHELL_STORAGE here (unset) and emit a broken line " = '1'".
# Measured 2026-09-30: that is exactly what happened, and the shell's own
# STORAGE= evidence is what caught it.
$storageLine = if ($ShellStorage) { '$env:HEYTA_SHELL_STORAGE = ''1''' } else { '# storage host OFF (HEYTA_SHELL_STORAGE not set)' }
$launcher = $launcher.Replace('__EXE__', $exe).Replace('__OUT__', $out).Replace('__WEBROOT__', $webTarget).Replace('__PORT__', [string]$CdpPort).Replace('__STORAGELINE__', $storageLine)
Set-Content -Path $launchPs1 -Value $launcher -Encoding ASCII

Remove-Item $Result -Force -ErrorAction SilentlyContinue
& schtasks /Delete /TN heyta-win-journey /F 2>&1 | Out-Null
& schtasks /Create /TN heyta-win-journey /TR "powershell -NoProfile -ExecutionPolicy Bypass -File $launchPs1" /SC ONCE /ST 00:00 /RU $env:USERNAME /IT /F 2>&1 | Out-Null
& schtasks /Run /TN heyta-win-journey 2>&1 | Out-Null

# Wait for the CDP endpoint AND for it to actually be OUR app.
$found = $false
$last = ''
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:$CdpPort/json/list") -TimeoutSec 4
    $last = $r.Content
    if ($r.Content -match 'https://heyta\.local/') { $found = $true; break }
  } catch {
    $last = $_.Exception.Message
  }
}
Add-Fact ('  cdp_listen=' + (@(Get-NetTCPConnection -LocalPort $CdpPort -State Listen -ErrorAction SilentlyContinue).Count))
$hv = $null
try { $hv = (Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:$CdpPort/json/version") -TimeoutSec 4).Content } catch { }
Add-Fact ('  cdp_browser=' + $(if ($hv -match '"Browser"\s*:\s*"([^"]+)"') { $Matches[1] } else { 'UNKNOWN' }))
Add-Fact ('  target_heyta_local=' + $found)
# Name it as the SWITCH, not the outcome: the shell now defaults the storage
# host ON, so 'shell_storage=False' here would read as 'feature off' (wrong).
Add-Fact ('  shell_storage_switch=' + $ShellStorage + ' (default is ON now; =0 disables)')
$pr = Get-Process -Name HeytaWindows -ErrorAction SilentlyContinue | Select-Object -First 1
Add-Fact ('  window_title=' + $(if ($pr) { $pr.MainWindowTitle } else { 'NO_PROCESS' }))

if (-not $found) {
  Add-Fact ('  last_cdp=' + ($last -replace '\s+', ' '))
  Add-Fact 'RESULT=CDP_TARGET_MISSING'
  # Print as well as persist: a silent failure looks exactly like "nothing happened"
  # (measured 2026-09-30 -- a C# compile error produced no stdout at all).
  $facts | ForEach-Object { Write-Output $_ }
  $facts | Set-Content $Result -Encoding ASCII
  exit 1
}

Add-Fact 'RESULT=OK'
$facts | Set-Content $Result -Encoding ASCII
$facts | ForEach-Object { Write-Output $_ }
