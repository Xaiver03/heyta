# Install the packed MSIX and prove it renders -- INSIDE the user's interactive
# desktop session.
#
#   Dispatched by package-msix.ps1 with:
#     schtasks /create /tn heyta-msix-install /tr <this>.cmd `
#       /sc once /st 00:00 /ru <user> /it /f
#     schtasks /run /tn heyta-msix-install
#
# WHY A SCHEDULED TASK: AppX deployment is per-user. Running Add-AppxPackage from
# the elevated session that SSHD gives us fails with
#   HRESULT: 0x80070005, access denied  ("target volume C: ... Add ... failed")
# and the same script succeeds unchanged once it runs in the interactive desktop
# session, where the token is NOT elevated. Both halves were measured on the
# packaging machine; the elevated route is a dead end, not a retry to make.
#
# ASCII ONLY -- deliberately. PowerShell 5.1 decodes a UTF-8 script WITHOUT a BOM
# as ANSI, which corrupts non-ASCII string literals and produces parse errors far
# from the real cause. Keeping this file ASCII removes that whole failure mode.
#
# Writes:
#   C:\src\heyta-msix\packaged-first-run.png   the app window (not the desktop)
#   C:\src\heyta-msix\install-capture.txt      measured facts, last line DONE

$ErrorActionPreference = 'Continue'

$build        = 'C:\src\heyta-msix'
$msix         = Join-Path $build 'heyta.msix'
$identityName = 'cloud.finlaw.heyta.desktop'
$displayName  = 'heyta'
$png          = Join-Path $build 'packaged-first-run.png'
$factsFile    = Join-Path $build 'install-capture.txt'
$lines        = @()

$elevated = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$lines += ('CONTEXT IsAdmin=' + $elevated + ' SessionId=' + (Get-Process -Id $PID).SessionId)
$lines += ('MSIX_EXISTS=' + (Test-Path $msix))

# ---- install -----------------------------------------------------------------
Get-Process HeytaWindows -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-AppxPackage -Name $identityName -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

try {
  Add-AppxPackage -Path $msix -ForceApplicationShutdown -ErrorAction Stop
  $lines += 'ADD_APPX=OK'
} catch {
  $lines += 'ADD_APPX=FAILED'
  $lines += ('  message=' + $_.Exception.Message)
  $lines += ('  hresult=0x{0:X8}' -f $_.Exception.HResult)
  $lines += ('  activityId=' + $_.Exception.ActivityId)
}

$installed = Get-AppxPackage -Name $identityName -ErrorAction SilentlyContinue
if (-not $installed) {
  $lines += 'RESULT=INSTALL_FAILED'
  $lines += 'DONE'
  $lines | Set-Content $factsFile -Encoding ASCII
  $lines | ForEach-Object { Write-Output $_ }
  exit 1
}
$lines += ('INSTALLED_VERSION=' + $installed.Version)
$lines += ('INSTALL_LOCATION=' + $installed.InstallLocation)

# The packaged payload MUST carry the app's own XAML resources. `dotnet publish`
# drops them (see step 1 of package-msix.ps1); without them the shell dies inside
# Microsoft.UI.Xaml.dll with E_FAIL before it can open a window. Asserting here
# turns a 40-second mystery crash into a one-line diagnosis.
$loc = $installed.InstallLocation
$lines += ('PAYLOAD_PRI=' + (Test-Path (Join-Path $loc 'HeytaWindows.pri')))
$lines += ('PAYLOAD_XBF=' + (@(Get-ChildItem $loc -Filter '*.xbf' -File -ErrorAction SilentlyContinue).Count))

# MEASURED 2026-09-30: the packaged app serves the REAL shared UI from `web-dist`
# next to the exe, and defaults to `app` mode only when that folder exists
# (see MainWindow.xaml.cs). The first MSIX produced by `pnpm reinstall:all`
# carried no web-dist and no current sources, so the window showed the M2-B
# shell-host spike page ("M2-B real data 1/2/3") while every install criterion was
# green. Assert the payload here so "installed" means "installed the product".
$webDist = Join-Path $loc 'web-dist'
$lines += ('PAYLOAD_WEBDIST=' + (Test-Path (Join-Path $webDist 'index.html')))

# ---- launch ------------------------------------------------------------------
$app = Get-StartApps -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $displayName } | Select-Object -First 1
if ($app) {
  $appId = $app.AppID
} else {
  $appId = $identityName + '!App'
  $lines += 'NOTE Get-StartApps did not list it; using <identity>!App'
}
$lines += ('APP_ID=' + $appId)

# The shell writes its M2-D verdict into <LocalAppData>\heyta\m2-evidence.txt.
# MEASURED 2026-09-30: a full-trust packaged app does NOT get the UWP-style
# LocalAppData redirection, so the file lands in the plain LocalAppData -- but
# keep the package LocalCache path as a second candidate in case that changes.
# Delete BOTH before launching: reading a previous run's file would let a stale
# OK pass as this run's evidence (the same class of mistake as a stale source tree).
$m2Candidates = @(
  (Join-Path $env:LOCALAPPDATA 'heyta\m2-evidence.txt'),
  (Join-Path $env:LOCALAPPDATA ('Packages\' + $installed.PackageFamilyName + '\LocalCache\Local\heyta\m2-evidence.txt'))
)
foreach ($p in $m2Candidates) { Remove-Item $p -Force -ErrorAction SilentlyContinue }

Start-Process ('shell:appsFolder\' + $appId)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WCAP {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RC r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RC { public int Left, Top, Right, Bottom; }
}
"@

$seen   = $false
$hwnd   = [IntPtr]::Zero
$fail   = $null
$procId = 0
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 750
  $proc = Get-Process HeytaWindows -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($proc) {
    $seen = $true
    $procId = $proc.Id
    $proc.Refresh()
    if ($proc.MainWindowHandle -ne 0) { $hwnd = $proc.MainWindowHandle; break }
  } elseif ($seen) {
    $fail = 'RUN_FAILED (process appeared then exited before showing a window)'
    break
  }
}
if (-not $seen) { $fail = 'RUN_FAILED (no HeytaWindows process after launch)' }
elseif ($hwnd -eq [IntPtr]::Zero -and -not $fail) { $fail = 'NO_WINDOW (process alive but no top-level window)' }

if ($fail) {
  $lines += ('PID=' + $procId)
  $lines += ('RESULT=' + $fail)
} else {
  # Wait for the shell's OWN M2-D verdict before screenshotting: the probe runs
  # after the WebView finishes loading (click avatar -> check the menu IA), which
  # is later than the window appearing. Poll every candidate path (see above).
  $m2 = ''
  for ($i = 0; $i -lt 60; $i++) {
    foreach ($m2Path in $m2Candidates) {
      if (Test-Path $m2Path) {
        $txt = Get-Content $m2Path -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
        if ($txt -match 'M2D=(OK|FAIL)') { $m2 = $Matches[1]; break }
      }
    }
    if ($m2 -ne '') { break }
    Start-Sleep -Milliseconds 500
  }
  $lines += ('M2D=' + $(if ($m2 -eq '') { 'MISSING' } else { $m2 }))
  # Screenshot AFTER the verdict: the menu is open by then, so the image shows it.
  [void][WCAP]::SetForegroundWindow($hwnd)
  Start-Sleep -Seconds 3
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc) { $proc.Refresh() }
  $lines += ('PID=' + $procId)
  $lines += ('WINDOW_TITLE=' + $proc.MainWindowTitle)
  $rect = New-Object WCAP+RC
  [void][WCAP]::GetWindowRect($hwnd, [ref]$rect)
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top
  $lines += ('WINDOW_RECT=' + $w + 'x' + $h)
  if ($w -le 0 -or $h -le 0) {
    $lines += 'RESULT=NO_WINDOW (window rect is empty)'
  } else {
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
    $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    $lines += ('PNG_SAVED=' + (Test-Path $png) + ' bytes=' + (Get-Item $png).Length)
    $lines += 'RESULT=OK'
  }
  Get-Process HeytaWindows -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

$lines += 'DONE'
$lines | Set-Content $factsFile -Encoding ASCII
$lines | ForEach-Object { Write-Output $_ }
if ($lines -contains 'RESULT=OK') { exit 0 } else { exit 1 }