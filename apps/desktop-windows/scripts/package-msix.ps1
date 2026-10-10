# Package the heyta WinUI 3 shell into a signed, installable MSIX -- and prove it
# actually installs and renders.
#
#   invoked by apps/desktop-windows/scripts/package-msix.sh
#
# ASCII ONLY -- deliberately. PowerShell 5.1 decodes a UTF-8 script WITHOUT a BOM
# as ANSI, which corrupts non-ASCII string literals and produces parse errors far
# from the real cause. Keeping this file ASCII removes that whole failure mode.
#
# Pipeline:
#   1. dotnet publish (self-contained; the project sets WindowsAppSDKSelfContained
#      so no framework package dependency is needed in the manifest)
#      + restore the XBF/PRI that publish drops (see the note in step 1)
#   2. build AppxManifest.xml -- Publisher MUST byte-match the signing cert subject
#   3. generate the logo assets makeappx requires
#   4. makeappx pack  -> heyta.msix
#   5. New-SelfSignedCertificate + signtool sign
#   6. trust the cert (LocalMachine\TrustedPeople)
#   7. hand install + launch + screenshot to install-and-capture.ps1, which runs in
#      the user's INTERACTIVE, NON-ELEVATED desktop session via schtasks /it
#
# NOTE: self-signed means "this package is intact and matches the cert", NOT
# "a publicly trusted publisher". A self-signed MSIX needs the cert trusted on
# each machine first. That is stated plainly instead of being called "signed".

$ErrorActionPreference = 'Continue'

$repo    = 'C:\src\heyta'
$proj    = Join-Path $repo 'apps\desktop-windows\HeytaWindows\HeytaWindows.csproj'
$build   = 'C:\src\heyta-msix'
$pubDir  = Join-Path $build 'publish'
$stage   = Join-Path $build 'stage'
$msix    = Join-Path $build 'heyta.msix'
$cerPath = Join-Path $build 'heyta-selfsigned.cer'
$pfxPath = Join-Path $build 'heyta-selfsigned.pfx'
$pfxPass = 'heyta-msix-local'
$manifestOut = Join-Path $build 'facts.txt'
$facts = @()

$identityName = 'cloud.finlaw.heyta.desktop'
$publisher    = 'CN=heyta local build'
$displayName  = 'heyta'
$version      = '1.0.0.0'

Remove-Item $build -Recurse -Force -EA SilentlyContinue
New-Item -ItemType Directory -Path $build, $stage -Force | Out-Null

# ---- 1. publish -------------------------------------------------------------
$facts += '=== 1. dotnet publish ==='
# NuGet audit is an advisory HTTP lookup. The Windows packaging host may have the
# required packages cached while the advisory endpoint is unavailable; treating
# that lookup as a build dependency turns a complete local restore into NU1900.
# Package restore itself remains strict: missing packages still fail publish.
$pub = dotnet publish $proj -c Release -p:Platform=x64 -p:RuntimeIdentifier=win-x64 -p:NuGetAudit=false --ignore-failed-sources --self-contained true -o $pubDir 2>&1
$pub | Select-String -Pattern 'error|Build succeeded|warning' | Select-Object -First 6 | ForEach-Object { $facts += ('  ' + $_.Line) }
$exe = Join-Path $pubDir 'HeytaWindows.exe'
if (-not (Test-Path $exe)) { $facts += 'RESULT=PUBLISH_FAILED'; $facts | Set-Content $manifestOut -Encoding ASCII; $facts | Write-Output; exit 1 }
$facts += ('  exe = ' + (Get-Item $exe).Length + ' bytes')
$facts += ('  publish files = ' + (Get-ChildItem $pubDir -Recurse -File | Measure-Object).Count)

# The shell loads native-bridge.js next to the exe; publish must carry it.
$bundle = Join-Path $pubDir 'native-bridge.js'
$facts += ('  native-bridge.js=' + (Test-Path $bundle))
if (-not (Test-Path $bundle)) {
  $facts += 'RESULT=BUNDLE_MISSING'
  $facts | Set-Content $manifestOut -Encoding ASCII; $facts | Write-Output; exit 1
}

# ---- 1b. web-dist: the REAL shared UI ---------------------------------------
# The shell serves the real app from `web-dist` next to the exe, and defaults to
# `app` mode only when that folder exists (see MainWindow.xaml.cs).
#
# MEASURED 2026-09-30: the first MSIX produced by `pnpm reinstall:all` carried no
# web-dist AND was built from a two-day-old C:\src\heyta, so the installed app
# showed the shell-host spike page ("M2-B real data 1/2/3") while every install
# criterion stayed green. Assert the payload here so a package that cannot show
# the product fails at package time instead of passing as "installed".
$facts += '=== 1b. web-dist (real shared UI) ==='
$webSrc = Join-Path $repo 'apps\web\dist'
if (-not (Test-Path (Join-Path $webSrc 'index.html'))) {
  $facts += 'RESULT=WEB_DIST_MISSING (build it first: pnpm --filter @heyta/web build)'
  $facts | Set-Content $manifestOut -Encoding ASCII; $facts | Write-Output; exit 1
}
$webTarget = Join-Path $pubDir 'web-dist'
Remove-Item $webTarget -Recurse -Force -EA SilentlyContinue
Copy-Item $webSrc $webTarget -Recurse -Force
$facts += ('  web-dist files = ' + (Get-ChildItem $webTarget -Recurse -File | Measure-Object).Count)
$facts += ('  web-dist index.html = ' + (Get-Item (Join-Path $webTarget 'index.html')).Length + ' bytes')

# MEASURED: `dotnet publish` drops the app's OWN XAML resources. Its output has
# none of App.xbf / MainWindow.xbf / HeytaWindows.pri, while the build output has
# all three. A package built from that publish folder starts, then dies inside
# Microsoft.UI.Xaml.dll with
#   Exception 0xc000027b (stowed exception), faulting module combase.dll,
#   exception code 80004005 (E_FAIL)
# before it can open a window -- because InitializeComponent() cannot load
# ms-appx:///App.xaml. Copy the missing files in from the build output and assert
# them here, so the defect surfaces at package time instead of as a silent crash.
$priSrc = Get-ChildItem (Join-Path $repo 'apps\desktop-windows\HeytaWindows\bin') -Recurse -File -Filter 'HeytaWindows.pri' -EA SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($priSrc) {
  $facts += ('  build output for XAML resources = ' + $priSrc.DirectoryName)
  $copied = @()
  foreach ($pat in @('*.xbf', '*.pri')) {
    Get-ChildItem (Join-Path $priSrc.DirectoryName $pat) -File -EA SilentlyContinue | ForEach-Object {
      Copy-Item $_.FullName (Join-Path $pubDir $_.Name) -Force
      $copied += $_.Name
    }
  }
  $facts += ('  restored into publish: ' + (($copied | Sort-Object) -join ', '))
} else {
  $facts += '  WARNING: no HeytaWindows.pri found under the build output'
}
if (-not (Test-Path (Join-Path $pubDir 'HeytaWindows.pri'))) {
  $facts += 'RESULT=XAML_RESOURCES_MISSING (publish dropped the app PRI and it was not found in the build output)'
  $facts | Set-Content $manifestOut -Encoding ASCII; $facts | Write-Output; exit 1
}

# ---- 2. logos ---------------------------------------------------------------
# makeappx requires these exact names/sizes.
#
# RED -- these are NO LONGER drawn here. They used to be: System.Drawing cleared a
# canvas with FromArgb(37, 99, 235) -- a second copy of the brand colour and a
# second copy of the glyph, both outside the design system -- and it squashed the
# 512 square straight into 310x150, so the wide tile showed a ~2:1 flattened "h".
# The single source is packages/design-system/src/brand-mark.ts; the committed
# bitmaps under apps/desktop-windows/assets are generated from it by
# `node scripts/gen-app-icons.mjs`. This step now only copies and verifies.
$facts += '=== 2. logo assets ==='
Copy-Item $pubDir\* $stage -Recurse -Force

$assetSrc = Join-Path $repo 'apps\desktop-windows\assets'
$assetDst = Join-Path $stage 'Assets'
New-Item -ItemType Directory -Path $assetDst -Force | Out-Null

# name -> required pixel size (WxH). targetsize-48_altform-unplated is what
# install-and-capture.ps1 hands to the desktop shortcut's IconLocation; it used
# to be missing, which is why the desktop tile was the generic Explorer glyph.
$need = @{
  'Square44x44Logo.png' = '44x44'
  'Square150x150Logo.png' = '150x150'
  'StoreLogo.png' = '50x50'
  'Wide310x150Logo.png' = '310x150'
  'Square44x44Logo.targetsize-24_altform-unplated.png' = '24x24'
  'Square44x44Logo.targetsize-48_altform-unplated.png' = '48x48'
}
$missing = @()
$wrongSize = @()
foreach ($name in $need.Keys) {
  $src = Join-Path (Join-Path $assetSrc 'msix') $name
  if (-not (Test-Path $src)) { $missing += $name; continue }
  $bytes = [System.IO.File]::ReadAllBytes($src)
  if ($bytes.Length -lt 24) { $missing += ($name + ' (truncated)'); continue }
  # PNG IHDR: width at byte 16, height at byte 20, both big-endian.
  $w = [int]$bytes[16] * 16777216 + [int]$bytes[17] * 65536 + [int]$bytes[18] * 256 + [int]$bytes[19]
  $h = [int]$bytes[20] * 16777216 + [int]$bytes[21] * 65536 + [int]$bytes[22] * 256 + [int]$bytes[23]
  if (("$w" + "x" + "$h") -ne $need[$name]) { $wrongSize += ($name + ' = ' + $w + 'x' + $h + ', want ' + $need[$name]); continue }
  Copy-Item $src (Join-Path $assetDst $name) -Force
}
$icoSrc = Join-Path $assetSrc 'heyta.ico'
if (Test-Path $icoSrc) {
  Copy-Item $icoSrc (Join-Path $stage 'heyta.ico') -Force
  $facts += '  heyta.ico copied (PE icon for the unpackaged exe is set in the csproj)'
} else {
  $missing += 'heyta.ico'
}

if ($missing.Count -gt 0 -or $wrongSize.Count -gt 0) {
  $facts += ('  MISSING = ' + ($missing -join ', '))
  $facts += ('  WRONG_SIZE = ' + ($wrongSize -join ', '))
  $facts += 'RESULT=ASSET_MISSING (run: node scripts/gen-app-icons.mjs, then re-sync the source tree)'
  $facts | Set-Content $manifestOut -Encoding ASCII; $facts | Write-Output; exit 1
}
$facts += ('  copied = ' + (($need.Keys | Sort-Object) -join ', ') + ' (all IHDR sizes verified)')


# ---- 3. manifest ------------------------------------------------------------
$facts += '=== 3. AppxManifest.xml ==='
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">

  <Identity Name="$identityName" Publisher="$publisher" Version="$version" ProcessorArchitecture="x64" />

  <Properties>
    <DisplayName>$displayName</DisplayName>
    <PublisherDisplayName>heyta</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>

  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26200.0" />
  </Dependencies>

  <Resources>
    <Resource Language="zh-CN" />
    <Resource Language="en-US" />
  </Resources>

  <Applications>
    <Application Id="App" Executable="HeytaWindows.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="$displayName"
        Description="heyta - local-first task manager (native WinUI 3 shell)"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png"
        AppListEntry="default">
        <uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>

  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
$manifest | Set-Content (Join-Path $stage 'AppxManifest.xml') -Encoding UTF8
$facts += '  written (Publisher must match the signing cert subject byte for byte)'
$facts += ('  Publisher = ' + $publisher)

# ---- 4. makeappx pack -------------------------------------------------------
$facts += '=== 4. makeappx pack ==='
$makeappx = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\makeappx.exe'
if (-not (Test-Path $makeappx)) {
  $facts += 'RESULT=MAKEAPPX_MISSING'
  $facts | Set-Content $manifestOut -Encoding ASCII; $facts | Write-Output; exit 1
}
$pack = & $makeappx pack /d $stage /p $msix /o 2>&1
$pack | Select-Object -Last 4 | ForEach-Object { $facts += ('  ' + $_) }
if (-not (Test-Path $msix)) { $facts += 'RESULT=PACK_FAILED'; $facts | Set-Content $manifestOut -Encoding ASCII; $facts | Write-Output; exit 1 }
$facts += ('  msix = ' + (Get-Item $msix).Length + ' bytes')

# ---- 5. self-signed cert + signtool ----------------------------------------
$facts += '=== 5. sign (self-signed) ==='
Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $publisher } | Remove-Item -Force -EA SilentlyContinue
$cert = New-SelfSignedCertificate -Type Custom -Subject $publisher `
  -KeyUsage DigitalSignature -FriendlyName 'heyta msix local' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
$facts += ('  thumbprint = ' + $cert.Thumbprint)
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
$sec = ConvertTo-SecureString -String $pfxPass -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $sec | Out-Null

$signtool = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe'
$sign = & $signtool sign /fd SHA256 /a /f $pfxPath /p $pfxPass $msix 2>&1
$sign | Select-Object -Last 3 | ForEach-Object { $facts += ('  ' + $_) }

# ---- 6. trust the cert ------------------------------------------------------
# Must happen BEFORE `signtool verify /pa`, otherwise the check reports a
# meaningless non-zero exit code purely because the chain is not trusted yet.
$facts += '=== 6. trust the self-signed cert ==='
$elevated = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$facts += ('  packager session elevated = ' + $elevated)
if ($elevated) {
  Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
  $facts += '  cert trusted in LocalMachine\TrustedPeople'
} else {
  $facts += '  WARNING: not elevated -- skipped; the cert must already be trusted for the install to work'
}
$verify = & $signtool verify /pa /v $msix 2>&1
$facts += ('  signtool verify exit = ' + $LASTEXITCODE)

# ---- 7. install + launch + capture, in the interactive session ---------------
# AppX deployment is PER-USER. Running Add-AppxPackage from the elevated session
# that SSHD hands us fails with 0x80070005 "access denied" -- measured, and the
# same command succeeds unchanged in the non-elevated interactive session. So the
# install, the launch and the screenshot all move into that session; the elevated
# session only does what genuinely needs admin (trusting the cert above).
$facts += '=== 7. install + launch + capture (interactive, non-elevated) ==='
$childFacts = Join-Path $build 'install-capture.txt'
$childPs1   = 'C:\src\heyta-install-and-capture.ps1'
$childLog   = Join-Path $build 'install-capture.log'
Remove-Item $childFacts -Force -EA SilentlyContinue
Remove-Item $childLog -Force -EA SilentlyContinue

if (-not (Test-Path $childPs1)) {
  $facts += ('RESULT=CHILD_SCRIPT_MISSING (' + $childPs1 + ')')
  $facts | Set-Content $manifestOut -Encoding ASCII; $facts | Write-Output; exit 1
}

if ($elevated) {
  $cmdPath = Join-Path $build 'install-and-capture.cmd'
  Set-Content -Path $cmdPath -Encoding ASCII -Value @(
    '@echo off',
    ('powershell -NoProfile -ExecutionPolicy Bypass -File ' + $childPs1 + ' > ' + $childLog + ' 2>&1')
  )
  schtasks /delete /tn heyta-msix-install /f 2>&1 | Out-Null
  $create = schtasks /create /tn heyta-msix-install /tr $cmdPath /sc once /st 00:00 /ru $env:USERNAME /it /f 2>&1
  $facts += ('  schtasks create exit = ' + $LASTEXITCODE)
  $run = schtasks /run /tn heyta-msix-install 2>&1
  $facts += ('  schtasks run exit = ' + $LASTEXITCODE)
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    if (Test-Path $childFacts) {
      $t = Get-Content $childFacts -Raw -EA SilentlyContinue
      if ($t -and $t.Contains('DONE')) { break }
    }
  }
} else {
  $facts += '  running the child script directly (already non-elevated)'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $childPs1 2>&1 | Out-Null
}

if (Test-Path $childFacts) {
  $facts += '--- install-and-capture (interactive session) ---'
  Get-Content $childFacts | Where-Object { $_ -ne 'DONE' } | ForEach-Object { $facts += ('  ' + $_) }
} else {
  $facts += 'RESULT=INSTALL_FAILED (no evidence file from the interactive session)'
  if (Test-Path $childLog) {
    $facts += '--- child log (tail) ---'
    Get-Content $childLog -Tail 15 | ForEach-Object { $facts += ('  ' + $_) }
  }
}

$facts | Set-Content $manifestOut -Encoding ASCII
$facts | ForEach-Object { Write-Output $_ }
