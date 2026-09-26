# heyta Windows build host - toolchain installer (idempotent)
#
# Purpose: turn a clean Windows 11 box into a heyta Android / Windows-desktop build host.
# Every step checks first and skips if already present, so it is safe to re-run.
#
# Usage (on Windows, elevated PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\setup-build-host.ps1
#   ... -Step base            # git / node / pnpm / JDK
#   ... -Step proxy           # git + gradle proxy (github.com and services.gradle.org are slow/blocked direct)
#   ... -Step android-studio  # Android Studio + SDK + cmdline-tools
#   ... -Step vs-buildtools   # Visual Studio Build Tools + C++ workload
#   ... -Step verify          # health check only
#   ... -Step all -CloneRepo  # everything, then clone the repo
#
# Steps: all | base | proxy | android-studio | vs-buildtools | verify
#
# Proxy measurement (2026-09, this host, services.gradle.org):
#   direct 61 KB/s   vs   via the Mac proxy 7.8 MB/s   (~128x)
# On a clean host, run -Step proxy BEFORE the first Gradle build, or the Gradle
# distribution download alone takes the better part of an hour.
#
# Notes:
#   - Android does NOT need a separate JDK: Android Studio ships its own JBR and the
#     script points JAVA_HOME at it. -Step base still installs OpenJDK 21 as a fallback.
#   - sdkmanager is not installed by the Android Studio GUI; Ensure-CmdlineTools adds it.
#   - Machine identity (IP / user / ZeroTier network) lives in
#     docs/reference/build-matrix.md. Do not hardcode IPs or passwords in this script
#     beyond the -Proxy default, which is a LAN address documented in that file.
#
# IMPORTANT: keep this file ASCII-only. Windows PowerShell 5.1 reads BOM-less files as
# ANSI, so non-ASCII characters corrupt parsing. Chinese docs belong in the runbook.

[CmdletBinding()]
param(
  [ValidateSet('all', 'base', 'proxy', 'android-studio', 'vs-buildtools', 'verify')]
  [string]$Step = 'all',

  # Where the repo lives on Windows.
  [string]$RepoRoot = 'C:\src\heyta',

  # Clone the heyta repo into $RepoRoot (needs github.com reachable).
  [switch]$CloneRepo,

  # HTTP proxy for git only. github.com is blocked on direct connection in mainland
  # China, while the npm registry is reachable directly, so only git gets a proxy.
  # Pass '' to skip. Default is the Mac proxy, reachable over ZeroTier.
  [string]$Proxy = 'http://10.111.127.246:7890'
)

$ErrorActionPreference = 'Stop'

function Write-Section($text) {
  Write-Host ''
  Write-Host ('=' * 72) -ForegroundColor DarkGray
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host ('=' * 72) -ForegroundColor DarkGray
}

function Test-Cmd($name) {
  $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

function Install-Winget($id, $label) {
  Write-Host "  -> install $label ($id)" -ForegroundColor Yellow
  winget install --id $id --exact --silent `
    --accept-source-agreements --accept-package-agreements `
    --disable-interactivity 2>&1 | ForEach-Object { Write-Host "     $_" }
}

function Set-GradleProperty {
  # Append or replace `key=value` in %USERPROFILE%\.gradle\gradle.properties,
  # preserving every unrelated line the user may already have there.
  # Written as ASCII because the rest of this script is ASCII-only.
  param([string]$Key, [string]$Value)

  $gradleDir = Join-Path $env:USERPROFILE '.gradle'
  if (-not (Test-Path $gradleDir)) {
    New-Item -ItemType Directory -Force -Path $gradleDir | Out-Null
  }
  $props = Join-Path $gradleDir 'gradle.properties'

  $kept = @()
  if (Test-Path $props) {
    Copy-Item $props "$props.bak" -Force
    # Drop our own previous key, and our own marker comment so repeated runs do not
    # grow the file one stale comment at a time.
    $kept = @(Get-Content $props | Where-Object {
      $_ -notmatch "^$([Regex]::Escape($Key))=" -and
      $_ -notmatch '^# Written by scripts/windows/setup-build-host\.ps1' -and
      $_ -notmatch '^# Gradle daemon traffic:'
    })
  }
  Set-Content -Path $props -Value ($kept + "$Key=$Value") -Encoding ASCII
  return $props
}

function Ensure-Proxy {
  if (-not $Proxy) {
    Write-Host '  (no proxy specified, skipping)'
    return
  }

  Write-Host "  -> configure git proxy $Proxy (git only; npm registry is direct)" -ForegroundColor Yellow
  git config --global http.proxy $Proxy
  git config --global https.proxy $Proxy

  # Keep local and non-GitHub traffic off the proxy.
  $noProxy = @('localhost', '127.0.0.1', '10.*', '192.168.*', 'registry.npmjs.org')
  git config --global http.noProxy ($noProxy -join ',')

  Write-Host "  [ok] git proxy = $(git config --global --get http.proxy)" -ForegroundColor Green
  Write-Host "       git noProxy = $(git config --global --get http.noProxy)"

  Ensure-GradleProxy
}

function Ensure-GradleProxy {
  # Gradle pulls from two places, and git's proxy does not cover either:
  #   1. the wrapper distribution (services.gradle.org) - fetched by the WRAPPER jvm
  #   2. plugins + dependencies (repo.maven.apache.org, dl.google.com) - fetched by the DAEMON
  #
  # Measured on this host (2026-09): direct 61 KB/s, through the Mac proxy 7.8 MB/s.
  # That is roughly 128x, i.e. the difference between a 40 minute wait and a 20 second one.
  #
  # (1) happens before Gradle starts, so it can only read JVM system properties:
  #     gradlew.bat passes %GRADLE_OPTS% to the wrapper JVM.
  # (2) is the daemon, which does read ~/.gradle/gradle.properties.
  $uri = [System.Uri]$Proxy
  $proxyHost = $uri.Host
  $proxyPort = $uri.Port
  $noProxyHosts = 'localhost|127.0.0.1|10.*|192.168.*'

  $gradleDir = Join-Path $env:USERPROFILE '.gradle'
  if (-not (Test-Path $gradleDir)) {
    New-Item -ItemType Directory -Force -Path $gradleDir | Out-Null
  }

  $props = Set-GradleProperty 'systemProp.http.proxyHost' $proxyHost
  Set-GradleProperty 'systemProp.http.proxyPort' $proxyPort | Out-Null
  Set-GradleProperty 'systemProp.https.proxyHost' $proxyHost | Out-Null
  Set-GradleProperty 'systemProp.https.proxyPort' $proxyPort | Out-Null
  Set-GradleProperty 'systemProp.http.nonProxyHosts' $noProxyHosts | Out-Null
  Set-GradleProperty 'systemProp.https.nonProxyHosts' $noProxyHosts | Out-Null
  Write-Host "  [ok] gradle daemon proxy -> $props" -ForegroundColor Green

  # The wrapper JVM cannot see gradle.properties, so pin the proxy in GRADLE_OPTS too.
  # Keep this value free of '|' and quotes: gradlew.bat expands %GRADLE_OPTS% on a cmd
  # command line, where a bare '|' is a pipe. nonProxyHosts therefore lives only in
  # gradle.properties, which is read as a Java property and never re-parsed by cmd.
  $opts = "-Dhttp.proxyHost=$proxyHost -Dhttp.proxyPort=$proxyPort " +
          "-Dhttps.proxyHost=$proxyHost -Dhttps.proxyPort=$proxyPort"
  [Environment]::SetEnvironmentVariable('GRADLE_OPTS', $opts, 'User')
  $env:GRADLE_OPTS = $opts
  Write-Host "  [ok] GRADLE_OPTS (wrapper distribution download) = $opts" -ForegroundColor Green
}

function Ensure-Base {
  Write-Section '1/5 base tools (git / node / pnpm / Java)'

  if (Test-Cmd git) { Write-Host "  [ok] git $((git --version))" -ForegroundColor Green }
  else { Install-Winget 'Git.Git' 'Git' }

  if (Test-Cmd node) {
    # Parse node -v directly. Do NOT use node -p with a quoted JS string here:
    # this script is commonly invoked through SSH -> PowerShell -> Start-Process,
    # and the nested quotes are stripped, producing `split(.)` and a SyntaxError.
    $nodeVersion = (node -v) -replace '^v', ''
    $nodeMajor = [int]($nodeVersion -split '\.')[0]
    Write-Host "  [ok] node v$nodeVersion" -ForegroundColor Green
    if ($nodeMajor -lt 22) {
      Write-Warning '  [warn] node < 22; heyta requires >= 22.11.0'
    }
  } else {
    Install-Winget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
  }

  Write-Host '  -> refresh PATH so newly installed tools are visible this session'
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')

  if (Test-Cmd pnpm) {
    Write-Host "  [ok] pnpm $(pnpm -v)" -ForegroundColor Green
  } else {
    Write-Host '  -> enable corepack to obtain pnpm' -ForegroundColor Yellow
    corepack enable 2>&1 | ForEach-Object { Write-Host "     $_" }
    corepack prepare pnpm@latest --activate 2>&1 | ForEach-Object { Write-Host "     $_" }
  }

  $jdkHome = Get-ChildItem 'C:\Program Files\Microsoft\jdk-21*' -Directory -ErrorAction SilentlyContinue
  if ($jdkHome) {
    Write-Host '  [ok] Microsoft OpenJDK 21 present' -ForegroundColor Green
  } else {
    Install-Winget 'Microsoft.OpenJDK.21' 'Microsoft OpenJDK 21'
  }

  Ensure-Jdk17
  Ensure-Proxy
}

function Ensure-Jdk17 {
  # RN 0.84 ships node_modules/@react-native/gradle-plugin, and its
  # settings-plugin/ and shared/ modules declare `kotlin { jvmToolchain(17) }`.
  # That included build is part of every Android build here.
  #
  # With no JDK 17 installed, Gradle falls back to the toolchain DOWNLOAD
  # resolver that the same plugin pins at `foojay-resolver-convention:0.5.0`,
  # and under Gradle 9.0.0 that resolver dies on:
  #
  #   NoSuchFieldError: Class org.gradle.jvm.toolchain.JvmVendorSpec does not
  #   have member field 'org.gradle.jvm.toolchain.JvmVendorSpec IBM_SEMERU'
  #
  # IBM_SEMERU was removed in Gradle 8.10, so the pinned plugin version simply
  # cannot run on Gradle 9. A locally installed JDK 17 is therefore not optional:
  # it is what stops the resolver from ever being consulted.
  # (Measured on this host: Android Studio's JBR is 25.0.3, the standalone
  #  Microsoft JDK is 21.0.12 - neither satisfies jvmToolchain(17).)
  $found = @()
  foreach ($pattern in @(
      'C:\Program Files\Eclipse Adoptium\jdk-17*',
      'C:\Program Files\Java\jdk-17*',
      'C:\Program Files\Microsoft\jdk-17*')) {
    $found += @(Get-ChildItem $pattern -Directory -ErrorAction SilentlyContinue)
  }

  if ($found.Count -gt 0) {
    $jdk17Home = $found[0].FullName
    Write-Host "  [ok] JDK 17 present: $jdk17Home" -ForegroundColor Green
  } else {
    Write-Host '  -> install JDK 17 toolchain (required by the react-native gradle-plugin)' -ForegroundColor Yellow
    Install-Winget 'EclipseAdoptium.Temurin.17.JDK' 'Temurin JDK 17'
    $found = @()
    foreach ($pattern in @(
        'C:\Program Files\Eclipse Adoptium\jdk-17*',
        'C:\Program Files\Java\jdk-17*',
        'C:\Program Files\Microsoft\jdk-17*')) {
      $found += @(Get-ChildItem $pattern -Directory -ErrorAction SilentlyContinue)
    }
    if ($found.Count -eq 0) {
      Write-Warning '  [warn] JDK 17 still not found; Android builds will hit the foojay crash'
      return
    }
    $jdk17Home = $found[0].FullName
  }

  # Tell Gradle where it is instead of relying on auto-detection. Auto-detection
  # missed this JDK on the first attempt on this host even though the directory is
  # in Gradle's documented scan list, so pin it explicitly.
  #
  # gradle.properties is a JAVA PROPERTIES file: a backslash is an escape character,
  # so 'C:\Program Files\...' arrives at Gradle as 'C:Program Files...'. Use forward
  # slashes; the JVM accepts them on Windows.
  $jdk17Posix = $jdk17Home -replace '\\', '/'
  $props = Set-GradleProperty 'org.gradle.java.installations.paths' $jdk17Posix
  Write-Host "       registered via org.gradle.java.installations.paths -> $props" -ForegroundColor Green
}

function Ensure-SdkRoot {
  # Android Studio defaults to %LOCALAPPDATA%\Android\Sdk
  $candidates = @(
    "$env:LOCALAPPDATA\Android\Sdk",
    "$env:USERPROFILE\AppData\Local\Android\Sdk"
  ) | Select-Object -Unique

  $sdk = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($sdk) {
    Write-Host "  [ok] Android SDK dir: $sdk" -ForegroundColor Green
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
  } else {
    Write-Warning "  [warn] Android SDK dir not found (expected $($candidates[0]))"
  }
  return $sdk
}

function Get-JavaHome {
  # Prefer a standalone JDK 21 over Android Studio's bundled JBR.
  #
  # Why the order matters: the Gradle daemon inherits JAVA_HOME, and on this host
  # the JBR is 25.0.3. On JDK 24+ a native library load from Java code is no longer
  # a warning, and the op-sqlite CMake configuration task fails with:
  #
  #   Execution failed for task ':op-engineering_op-sqlite:configureCMakeDebug[arm64-v8a]'
  #   > WARNING: A restricted method in java.lang.System has been called
  #
  # JDK 21 is also what apps/mobile/android is actually tested against, so this is
  # the supported configuration rather than a workaround.
  $jdk21 = Get-ChildItem 'C:\Program Files\Microsoft\jdk-21*' -Directory -ErrorAction SilentlyContinue |
    Select-Object -First 1 -Expand FullName
  if ($jdk21) { return $jdk21 }

  $jbr = 'C:\Program Files\Android\Android Studio\jbr'
  if (Test-Path $jbr) { return $jbr }
  return $null
}

function Use-JavaHome {
  # sdkmanager is a Java program. It must see JAVA_HOME in THIS session, not only in
  # the user-level env vars we persist for later shells. Without this, every package
  # install fails with "JAVA_HOME is not set" even though the var is written to disk.
  $javaHome = Get-JavaHome
  if ($javaHome) {
    $env:JAVA_HOME = $javaHome
    $env:Path = (Join-Path $javaHome 'bin') + ';' + $env:Path
    Write-Host "  [ok] this session JAVA_HOME = $javaHome" -ForegroundColor Green
  } else {
    Write-Warning '  [warn] no JBR / JDK 21 found; sdkmanager will likely fail'
  }
  return $javaHome
}

function Ensure-CmdlineTools {
  # sdkmanager is the CLI entry point for installing platforms/build-tools.
  $sdk = Ensure-SdkRoot
  if (-not $sdk) { return }

  Use-JavaHome | Out-Null

  $sdkmanager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
  if (Test-Path $sdkmanager) {
    Write-Host '  [ok] cmdline-tools/sdkmanager present' -ForegroundColor Green
  } else {
    Write-Host '  -> download Android commandline-tools' -ForegroundColor Yellow
    $zip = Join-Path $env:TEMP 'cmdline-tools.zip'
    $url = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
    $dest = Join-Path $sdk 'cmdline-tools'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Expand-Archive -Path $zip -DestinationPath $dest -Force
    # Archive extracts to cmdline-tools/cmdline-tools/*; move to cmdline-tools/latest/*
    $inner = Join-Path $dest 'cmdline-tools'
    if (Test-Path $inner) {
      $latest = Join-Path $dest 'latest'
      if (Test-Path $latest) { Remove-Item $latest -Recurse -Force }
      Move-Item $inner $latest
    }
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Write-Host '  [ok] sdkmanager installed' -ForegroundColor Green
  }

  Write-Host '  -> install platform-tools / platforms / build-tools / NDK' -ForegroundColor Yellow
  $yes = ('y' + [Environment]::NewLine) * 60
  # Versions must match apps/mobile/android/build.gradle:
  #   compileSdkVersion 36, buildToolsVersion 36.0.0, ndkVersion 27.1.12297006
  $pkgs = @(
    'platform-tools',
    'platforms;android-36',
    'build-tools;36.0.0',
    'ndk;27.1.12297006',
    'cmake;3.22.1'
  )
  foreach ($p in $pkgs) {
    $yes | & $sdkmanager --sdk_root=$sdk $p 2>&1 | ForEach-Object { Write-Host "     $_" }
  }
}

function Ensure-EnvVars {
  $sdk = Ensure-SdkRoot
  if (-not $sdk) { return }

  Write-Host '  -> write user-level ANDROID_HOME / JAVA_HOME' -ForegroundColor Yellow
  [Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdk, 'User')
  [Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $sdk, 'User')

  $javaHome = Get-JavaHome

  if ($javaHome) {
    [Environment]::SetEnvironmentVariable('JAVA_HOME', $javaHome, 'User')
    Write-Host "  [ok] JAVA_HOME = $javaHome" -ForegroundColor Green
  } else {
    Write-Warning '  [warn] neither JBR nor JDK 21 found; JAVA_HOME not set'
  }

  $pt = Join-Path $sdk 'platform-tools'
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath -notlike "*$pt*") {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$pt", 'User')
    Write-Host '  [ok] platform-tools added to user PATH (new shells only)' -ForegroundColor Green
  }
}

function Ensure-AndroidStudio {
  Write-Section '2/5 Android Studio (ships Android SDK + JBR)'

  $installed = Test-Path 'C:\Program Files\Android\Android Studio'
  if ($installed) {
    Write-Host '  [ok] Android Studio already installed' -ForegroundColor Green
  } else {
    Install-Winget 'Google.AndroidStudio' 'Android Studio'
  }

  # Make sure the SDK dir exists even before the GUI has run once.
  $sdk = "$env:LOCALAPPDATA\Android\Sdk"
  if (-not (Test-Path $sdk)) {
    New-Item -ItemType Directory -Force -Path $sdk | Out-Null
  }

  Ensure-CmdlineTools
  Ensure-EnvVars
}

function Ensure-VsBuildTools {
  Write-Section '3/5 Windows desktop toolchain (VS Build Tools + C++ workload)'
  Write-Host '  Note: only needed to build the Windows desktop target.' -ForegroundColor DarkGray
  Write-Host '        Large download (roughly 3-7 GB).' -ForegroundColor DarkGray

  $vsWhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
  $hasCpp = $false
  if (Test-Path $vsWhere) {
    $installs = & $vsWhere -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    $hasCpp = [bool]$installs
  }

  if ($hasCpp) {
    Write-Host '  [ok] VS install with C++ toolchain detected' -ForegroundColor Green
    return
  }

  Install-Winget 'Microsoft.VisualStudio.2022.BuildTools' 'VS 2022 Build Tools'
  Write-Host '  -> add C++ desktop workload (elevated, takes a while)' -ForegroundColor Yellow
  $vsInstaller = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe'
  if (Test-Path $vsInstaller) {
    & $vsInstaller modify `
      --installPath 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools' `
      --add Microsoft.VisualStudio.Workload.VCTools `
      --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
      --includeRecommended --quiet --norestart 2>&1 | ForEach-Object { Write-Host "     $_" }
  } else {
    Write-Warning '  [warn] vs_installer.exe not found; install the C++ workload manually'
  }
}

function Invoke-CloneRepo {
  Write-Section '4/5 clone heyta repo'
  if (Test-Path (Join-Path $RepoRoot '.git')) {
    Write-Host "  [ok] repo already present: $RepoRoot" -ForegroundColor Green
    Push-Location $RepoRoot
    git fetch --all --prune 2>&1 | ForEach-Object { Write-Host "     $_" }
    Pop-Location
    return
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $RepoRoot) | Out-Null
  git clone https://github.com/Xaiver03/heyta.git $RepoRoot 2>&1 | ForEach-Object { Write-Host "     $_" }
  Write-Host "  [ok] cloned to $RepoRoot" -ForegroundColor Green
}

function Invoke-Verify {
  Write-Section '5/5 health check'

  # NOTE: must be $script:rows, not $rows. Add-Row is a nested function, so a plain
  # $rows inside it would create a NEW local each call and `+=` would then try to add
  # a PSCustomObject to a PSCustomObject -> "op_Addition" is not defined.
  $script:rows = @()
  function Add-Row($name, $ok, $detail) {
    $script:rows += [pscustomobject]@{ Item = $name; Status = if ($ok) { '[ok]' } else { '[--]' }; Detail = $detail }
  }

  Add-Row 'git' (Test-Cmd git) $(if (Test-Cmd git) { (git --version) } else { 'missing' })
  Add-Row 'node' (Test-Cmd node) $(if (Test-Cmd node) { (node -v) } else { 'missing' })
  Add-Row 'pnpm' (Test-Cmd pnpm) $(if (Test-Cmd pnpm) { (pnpm -v) } else { 'missing' })

  $sdk = Ensure-SdkRoot
  Add-Row 'ANDROID_HOME' ([bool]$sdk) $(if ($sdk) { $sdk } else { 'not found' })

  $javaHome = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'User')
  $hasJava = $javaHome -and (Test-Path (Join-Path $javaHome 'bin\java.exe'))
  Add-Row 'JAVA_HOME' ([bool]$hasJava) $(if ($javaHome) { $javaHome } else { 'not set' })

  $jdk17 = @()
  foreach ($pattern in @(
      'C:\Program Files\Eclipse Adoptium\jdk-17*',
      'C:\Program Files\Java\jdk-17*',
      'C:\Program Files\Microsoft\jdk-17*')) {
    $jdk17 += @(Get-ChildItem $pattern -Directory -ErrorAction SilentlyContinue)
  }
  Add-Row 'JDK 17 toolchain' ($jdk17.Count -gt 0) `
    $(if ($jdk17.Count -gt 0) { $jdk17[0].FullName } else { 'missing - foojay 0.5.0 will crash under Gradle 9' })

  $sdkmanager = if ($sdk) { Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat' } else { '' }
  Add-Row 'sdkmanager' (Test-Path $sdkmanager) $sdkmanager

  $platform36 = if ($sdk) { Test-Path (Join-Path $sdk 'platforms\android-36') } else { $false }
  Add-Row 'platforms;android-36' $platform36 'RN 0.84 target platform'

  $bt = if ($sdk) { Test-Path (Join-Path $sdk 'build-tools\36.0.0') } else { $false }
  Add-Row 'build-tools;36.0.0' $bt ''

  $ndk = if ($sdk) { Test-Path (Join-Path $sdk 'ndk\27.1.12297006') } else { $false }
  Add-Row 'ndk;27.1.12297006' $ndk 'newArch / op-sqlite native code'

  $cmake = if ($sdk) { Test-Path (Join-Path $sdk 'cmake\3.22.1') } else { $false }
  Add-Row 'cmake;3.22.1' $cmake ''

  $adb = if ($sdk) { Test-Path (Join-Path $sdk 'platform-tools\adb.exe') } else { $false }
  Add-Row 'adb' $adb ''

  $vsWhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
  $hasCpp = $false
  if (Test-Path $vsWhere) {
    $hasCpp = [bool](& $vsWhere -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null)
  }
  Add-Row 'VS C++ toolchain' $hasCpp 'Windows desktop target only'

  $repoOk = Test-Path (Join-Path $RepoRoot '.git')
  Add-Row 'heyta repo' $repoOk $RepoRoot

  $script:rows | Format-Table -AutoSize | Out-String | Write-Host

  $hardFail = $script:rows | Where-Object { $_.Status -eq '[--]' -and $_.Item -notin @('VS C++ toolchain', 'heyta repo') }
  if ($hardFail) {
    Write-Warning 'Required items still missing (see table above).'
  } else {
    Write-Host '[ok] all items required for Android builds are ready.' -ForegroundColor Green
  }
}

# ---- main ----
Write-Host "heyta Windows build host setup - step=$Step" -ForegroundColor Magenta
Write-Host "time=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  host=$env:COMPUTERNAME"

switch ($Step) {
  'base' { Ensure-Base }
  'proxy' { Ensure-Proxy }
  'android-studio' { Ensure-AndroidStudio }
  'vs-buildtools' { Ensure-VsBuildTools }
  'verify' { Invoke-Verify }
  'all' {
    Ensure-Base
    Ensure-AndroidStudio
    if ($PSBoundParameters.ContainsKey('CloneRepo')) { Invoke-CloneRepo }
    Ensure-VsBuildTools
    Invoke-Verify
  }
}

Write-Host ''
Write-Host 'done.' -ForegroundColor Magenta
