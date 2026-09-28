$ErrorActionPreference = 'Continue'
$root = 'C:\src\heyta-winprobe'
if (Test-Path $root) { Remove-Item -Recurse -Force $root }
New-Item -ItemType Directory -Path $root | Out-Null
Set-Location $root

Write-Output ('DOTNET=' + (dotnet --version))
Write-Output ('VS_INSTALL_DIR=' + [bool](Test-Path 'C:\Program Files\Microsoft Visual Studio'))
Write-Output ('WINSDK_KITS=' + ((Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\Include' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ','))

$proj = @'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net10.0-windows10.0.19041.0</TargetFramework>
    <TargetPlatformMinVersion>10.0.17763.0</TargetPlatformMinVersion>
    <RootNamespace>HeytaWinProbe</RootNamespace>
    <ApplicationManifest>app.manifest</ApplicationManifest>
    <Platforms>x64</Platforms>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <UseWinUI>true</UseWinUI>
    <EnableMsixTooling>false</EnableMsixTooling>
    <WindowsPackageType>None</WindowsPackageType>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.WindowsAppSDK" Version="2.5.1" />
  </ItemGroup>
</Project>
'@
Set-Content -Path "$root\HeytaWinProbe.csproj" -Value $proj -Encoding UTF8

$appXaml = @'
<Application
    x:Class="HeytaWinProbe.App"
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
    <Application.Resources>
        <ResourceDictionary>
            <ResourceDictionary.MergedDictionaries>
                <XamlControlsResources xmlns="using:Microsoft.UI.Xaml.Controls" />
            </ResourceDictionary.MergedDictionaries>
        </ResourceDictionary>
    </Application.Resources>
</Application>
'@
Set-Content -Path "$root\App.xaml" -Value $appXaml -Encoding UTF8

$appCs = @'
using Microsoft.UI.Xaml;

namespace HeytaWinProbe;

public partial class App : Application
{
    private Window? _window;

    public App() => InitializeComponent();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }
}
'@
Set-Content -Path "$root\App.xaml.cs" -Value $appCs -Encoding UTF8

$winXaml = @'
<Window
    x:Class="HeytaWinProbe.MainWindow"
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
    <StackPanel Padding="24">
        <TextBlock Text="heyta Windows native probe" FontSize="24" />
    </StackPanel>
</Window>
'@
Set-Content -Path "$root\MainWindow.xaml" -Value $winXaml -Encoding UTF8

$winCs = @'
using Microsoft.UI.Xaml;

namespace HeytaWinProbe;

public sealed partial class MainWindow : Window
{
    public MainWindow() => InitializeComponent();
}
'@
Set-Content -Path "$root\MainWindow.xaml.cs" -Value $winCs -Encoding UTF8

$manifest = @'
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="1.0.0.0" name="HeytaWinProbe.app"/>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" />
    </application>
  </compatibility>
</assembly>
'@
Set-Content -Path "$root\app.manifest" -Value $manifest -Encoding UTF8

Write-Output '--- dotnet build ---'
dotnet build "$root\HeytaWinProbe.csproj" -c Debug 2>&1 | Select-Object -Last 45
Write-Output ('BUILD_EXIT=' + $LASTEXITCODE)

# 🔴 不写死输出路径。第一次探测把路径猜成 bin\x64\Debug\... 而实际是 bin\Debug\...
#    （`Platforms` 属性只在显式传 -p:Platform 时才参与输出路径），
#    于是 EXE_EXISTS 报了个假的 False。改成**找**，不猜。
Write-Output '--- 产物 ---'
Get-ChildItem -Path $root -Recurse -Include 'HeytaWinProbe.exe', 'HeytaWinProbe.dll' -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Output ("ARTIFACT=" + $_.FullName.Replace($root, '.') + " bytes=" + $_.Length) }

