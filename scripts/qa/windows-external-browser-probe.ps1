# Windows interactive UI Automation probe used by windows-installed-widget-help.mjs.
# ASCII only: Windows PowerShell 5.1 parses UTF-8 without a BOM as ANSI.

param(
  [ValidateSet('before', 'after')]
  [string]$Stage = 'after',
  [string]$OutFile = 'C:\src\heyta-widget-help-after.json'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class HeytaWidgetHelpWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

$browserNames = @('msedge', 'chrome', 'firefox', 'brave', 'arc', 'opera')
$editCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Edit
)

function Get-BrowserRecord($window) {
  $processId = $window.Current.ProcessId
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $null }
  $name = $process.ProcessName.ToLowerInvariant()
  if ($browserNames -notcontains $name) { return $null }

  $url = ''
  try {
    $edits = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
    foreach ($edit in $edits) {
      $valuePattern = $null
      if ($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
        $value = [string]$valuePattern.Current.Value
        if ($value -match '^https?://') { $url = $value; break }
        # Chromium hides the scheme in an unfocused address bar.
        if ($value -match '^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}([/:?#]|$)') { $url = 'https://' + $value; break }
      }
      $nameValue = [string]$edit.Current.Name
      if ($url -eq '' -and $nameValue -match '^https?://') { $url = $nameValue; break }
    }
  } catch {
    $url = ''
  }

  $handle = [int64]$window.Current.NativeWindowHandle
  $tabCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::TabItem
  )
  $tabCount = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition).Count
  [ordered]@{
    isBrowser = $true
    process = $name
    processId = $processId
    hwnd = $handle
    title = [string]$window.Current.Name
    url = $url
    tabCount = $tabCount
  }
}

function Get-ForegroundRecord {
  $handle = [HeytaWidgetHelpWin32]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) { return [ordered]@{ isBrowser = $false; url = ''; title = '' } }
  try {
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $record = Get-BrowserRecord $window
    if ($null -ne $record) { return $record }
    return [ordered]@{
      isBrowser = $false
      processId = $window.Current.ProcessId
      hwnd = [int64]$window.Current.NativeWindowHandle
      title = [string]$window.Current.Name
      url = ''
    }
  } catch {
    return [ordered]@{ isBrowser = $false; url = ''; title = ''; error = $_.Exception.Message }
  }
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.Condition]::TrueCondition
)
$browsers = @()
foreach ($window in $windows) {
  $record = Get-BrowserRecord $window
  if ($null -ne $record) { $browsers += $record }
}

$result = [ordered]@{
  stage = $Stage
  capturedAt = [DateTime]::UtcNow.ToString('o')
  foreground = Get-ForegroundRecord
  browsers = $browsers
  evidence = 'Windows UI Automation foreground browser address-bar value'
}
$json = $result | ConvertTo-Json -Compress -Depth 6
$json | Set-Content -Path $OutFile -Encoding UTF8
Write-Output $json
