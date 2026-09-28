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
#   2. build AppxManifest.xml -- Publisher MUST byte-match the signing cert subject
#   3. generate the logo assets makeappx requires
#   4. makeappx pack  -> heyta.msix
#   5. New-SelfSignedCertificate + signtool sign
#   6. trust the cert (LocalMachine\TrustedPeople) + Add-AppxPackage
#   7. launch it and screenshot the window -- installing is not the same as running
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
$pub = dotnet publish $proj -c Release -p:Platform=x64 -p:RuntimeIdentifier=win-x64 --self-contained true -o $pubDir 2>&1
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

# ---- 2. logos ---------------------------------------------------------------
# makeappx requires these exact names/sizes.
$facts += '=== 2. logo assets ==='
Copy-Item $pubDir\* $stage -Recurse -Force
Add-Type -AssemblyName System.Drawing
$srcPng = Join-Path $repo 'apps\web\public\icons\icon-512.png'
$sizes = @{ 'Square44x44Logo.png' = 44; 'Square150x150Logo.png' = 150; 'StoreLogo.png' = 50; 'Wide310x150Logo.png' = $null }
foreach ($name in $sizes.Keys) {
  $out = Join-Path $stage ('Assets\' + $name)
  New-Item -ItemType Directory -Path (Split-Path $out) -Force | Out-Null
  if ($name -eq 'Wide310x150Logo.png') {
    $bmp = New-Object System.Drawing.Bitmap(310, 150)
  } else {
    $s = $sizes[$name]
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
  }
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(37, 99, 235))
  if (Test-Path $srcPng) {
    $img = [System.Drawing.Image]::FromFile($srcPng)
    $g.DrawImage($img, 0, 0, $bmp.Width, $bmp.Height)
    $img.Dispose()
  }
  $g.Dispose()
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
$facts += ('  generated = ' + ($sizes.Keys -join ', '))

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
$verify = & $signtool verify /pa /v $msix 2>&1
$facts += ('  signtool verify exit = ' + $LASTEXITCODE)

# ---- 6. trust + install -----------------------------------------------------
$facts += '=== 6. install ==='
Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
$facts += '  cert trusted in LocalMachine\TrustedPeople'

Get-AppxPackage -Name $identityName | Remove-AppxPackage -EA SilentlyContinue
$add = Add-AppxPackage -Path $msix -ForceApplicationShutdown 2>&1
$add | ForEach-Object { $facts += ('  ' + $_) }
$installed = Get-AppxPackage -Name $identityName
if (-not $installed) {
  $facts += 'RESULT=INSTALL_FAILED'
  $facts | Set-Content $manifestOut -Encoding ASCII; $facts | Write-Output; exit 1
}
$facts += ('  installed version = ' + $installed.Version)
$facts += ('  install location  = ' + $installed.InstallLocation)

# Installing is NOT the same as running. Launch it and screenshot the window.
$facts += '=== 7. launch + capture ==='
$app = Get-StartApps | Where-Object { $_.Name -eq $displayName } | Select-Object -First 1
if (-not $app) { $facts += '  WARNING: Get-StartApps did not list it'; $appId = $identityName + '!App' } else { $appId = $app.AppID }
$facts += ('  appId = ' + $appId)
Start-Process ('shell:appsFolder\' + $appId)
Start-Sleep -Seconds 18

$proc = Get-Process HeytaWindows -EA SilentlyContinue | Select-Object -First 1
if (-not $proc) {
  $facts += 'RESULT=RUN_FAILED (process not found after launch)'
} else {
  $facts += ('  pid = ' + $proc.Id)
  $proc.Refresh()
  $h = $proc.MainWindowHandle
  $facts += ('  MainWindowHandle = ' + $h)
  if ($h -ne 0 -and $h -ne [IntPtr]::Zero) {
    $facts += ('  MainWindowTitle = ' + $proc.MainWindowTitle)
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WR {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RC r);
  [StructLayout(LayoutKind.Sequential)] public struct RC { public int Left, Top, Right, Bottom; }
}
"@
    $r = New-Object WR+RC
    [void][WR]::GetWindowRect($h, [ref]$r)
    $w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
    $facts += ('  WINDOW_RECT=' + $w + 'x' + $ht)
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap($w, $ht)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
    $shot = Join-Path $build 'packaged-first-run.png'
    $bmp.Save($shot, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    $facts += ('  PNG_SAVED=' + (Test-Path $shot) + ' bytes=' + (Get-Item $shot).Length)
    $facts += 'RESULT=OK'
  } else {
    $facts += 'RESULT=NO_WINDOW (packaged app launched but no window)'
  }
}

$facts | Set-Content $manifestOut -Encoding ASCII
$facts | ForEach-Object { Write-Output $_ }
