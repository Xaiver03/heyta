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
#   <Desktop>\heyta.lnk                        the launch-a-user-can-reach icon

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

# W8-GAP-W1: `PAYLOAD_WEBDIST=True` only proves ONE file is there. The gate that
# reads this file has to answer "are the bytes the shell actually serves the ones
# this worktree built?", and a boolean cannot carry that. Three machine-readable
# facts instead, all MEASURED from the installed payload:
#   PAYLOAD_INDEX_SHA    - sha256 of the installed index.html. Vite writes
#                          content-hashed chunk names into it, so a matching hash
#                          means the same asset graph, not just the same file.
#   PAYLOAD_CHUNK_TOTAL  - how many /assets/... entries that index.html references
#   PAYLOAD_CHUNK_PRESENT- how many of those actually exist next to the exe
# The last two are the leg that catches "index.html shipped, chunks did not" -
# which renders a blank window while every existing criterion stays green.
$indexFile = Join-Path $webDist 'index.html'
$indexSha = 'NONE'
$chunkTotal = 0
$chunkPresent = 0
if (Test-Path $indexFile) {
  $indexSha = (Get-FileHash -Algorithm SHA256 -Path $indexFile).Hash
  $html = Get-Content -Raw -Path $indexFile
  foreach ($m in [regex]::Matches($html, '(?:src|href)="(/?assets/[^"]+)"')) {
    $chunkTotal += 1
    $rel = $m.Groups[1].Value -replace '^/', ''
    if (Test-Path (Join-Path $webDist ($rel -replace '/', '\'))) { $chunkPresent += 1 }
  }
}
$lines += ('PAYLOAD_INDEX_SHA=' + $indexSha)
$lines += ('PAYLOAD_CHUNK_TOTAL=' + $chunkTotal)
$lines += ('PAYLOAD_CHUNK_PRESENT=' + $chunkPresent)

# ---- desktop shortcut --------------------------------------------------------
# WHY THIS IS A SEPARATE CRITERION. An MSIX gets a Start Menu entry by itself
# (measured on the packaging machine: Get-StartApps lists
#   Name=heyta  AppID=cloud.finlaw.heyta.desktop_<hash>!App),
# but NOTHING puts an icon on the Desktop. A user who was told "it is installed"
# and sees no icon on the desktop will conclude it is not -- so "installed" has to
# include a way to launch it that does not require knowing the app exists.
#
# A packaged (MSIX) app cannot be pointed at by a normal .lnk TargetPath:
# WindowsApps is ACL-protected and the real exe is not user-launchable. The
# supported indirection is the AUMID through the shell namespace, i.e.
#   explorer.exe  shell:AppsFolder\<PackageFamilyName>!App
# which is exactly how this script launches it below, so the shortcut and the
# verification share one launch path -- a shortcut that works differently would
# prove nothing about the thing we screenshotted.
$startApp = Get-StartApps -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $displayName } | Select-Object -First 1
if ($startApp) {
  $aumid = $startApp.AppID
  $lines += ('SHORTCUT_STARTAPP=True  ' + $aumid)
} else {
  # Not listed yet (the Start Menu database is refreshed asynchronously after
  # deployment). Fall back to the documented identity form and say so --
  # silently using a guess would make a broken shortcut look correct.
  $aumid = $installed.PackageFamilyName + '!App'
  $lines += 'SHORTCUT_STARTAPP=False  fallback=' + $aumid
}

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'heyta.lnk'
$shortcutOk = $false
try {
  $wsh = New-Object -ComObject WScript.Shell
  $lnk = $wsh.CreateShortcut($lnkPath)
  $lnk.TargetPath = 'explorer.exe'
  $lnk.Arguments = 'shell:AppsFolder\' + $aumid
  $lnk.WorkingDirectory = $desktop
  # SHORTCUT ICON. Measured 2026-10-04: two separate bugs made the desktop tile
  # the generic Explorer glyph, and neither could fail anything --
  #   a) package-msix.ps1 never generated Square44x44Logo.targetsize-48_altform-unplated.png,
  #      so the Test-Path below was always false;
  #   b) even the logos it DID generate are staged under Assets\, while this looked
  #      at the install-location ROOT.
  # A silently-missing icon is precisely how "there is no app logo anywhere" survived
  # every green install criterion, so the choice is now printed and readability is
  # tested (a packaged path can exist yet not be openable from outside the package).
  # .ico is tried first because a .lnk's IconLocation only reliably renders
  # ICO/EXE/DLL; a PNG there shows as blank in Explorer even when it is readable.
  $candidates = @(
    (Join-Path $loc 'heyta.ico'),
    (Join-Path $loc 'Assets\Square44x44Logo.targetsize-48_altform-unplated.png'),
    (Join-Path $loc 'Square44x44Logo.targetsize-48_altform-unplated.png')
  )
  $iconChosen = ''
  foreach ($c in $candidates) {
    if (-not (Test-Path $c)) { continue }
    $readable = $true
    try { $fs = [System.IO.File]::OpenRead($c); $fs.Close() } catch { $readable = $false }
    if ($readable) { $iconChosen = $c; break }
    $lines += ('SHORTCUT_ICON_UNREADABLE=' + $c)
  }
  if ($iconChosen -ne '') { $lnk.IconLocation = $iconChosen }
  # A shortcut without the right icon is still a working shortcut; one without a target is not.
  $lines += ('SHORTCUT_ICON=' + $(if ($iconChosen -eq '') { 'NONE' } else { $iconChosen }))

  $lnk.Description = 'heyta'
  $lnk.Save()
  $lines += ('SHORTCUT_PATH=' + $lnkPath)
  $lines += ('SHORTCUT_CREATED=' + (Test-Path $lnkPath))
  # READ IT BACK. Creating a .lnk and trusting the call to have succeeded is the
  # same mistake as trusting an install exit code: verify the target that is
  # actually written in the file.
  $check = $wsh.CreateShortcut($lnkPath)
  $lines += ('SHORTCUT_ARGS=' + $check.Arguments)
  $lines += ('SHORTCUT_RESOLVES=' + ($check.Arguments -like '*shell:AppsFolder*'))
  $shortcutOk = ($check.Arguments -like '*shell:AppsFolder*') -and (Test-Path $lnkPath)
} catch {
  $lines += 'SHORTCUT_CREATED=False'
  $lines += ('  message=' + $_.Exception.Message)
}

# ---- launch ------------------------------------------------------------------
# Reuse the SAME AUMID the shortcut was written with (see above). Two lookups
# would mean the screenshot could prove a launch that the desktop icon does not
# perform -- the criterion would be about a different artifact than the product.
$appId = $aumid
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

$lines += ('SHORTCUT_OK=' + $shortcutOk)
$lines += 'DONE'
$lines | Set-Content $factsFile -Encoding ASCII
$lines | ForEach-Object { Write-Output $_ }
# The desktop shortcut is part of "installed", not a nicety: a packaged app the
# user can only start via a script is not something a person can use. So RESULT=OK
# AND a shortcut that reads back with an AppsFolder target are BOTH required.
if (($lines -contains 'RESULT=OK') -and $shortcutOk) { exit 0 } else { exit 1 }