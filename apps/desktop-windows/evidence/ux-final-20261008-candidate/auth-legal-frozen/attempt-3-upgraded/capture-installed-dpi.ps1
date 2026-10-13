$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$out='C:\src\heyta-msix'
$p=Get-AppxPackage -Name 'cloud.finlaw.heyta.desktop'
Add-Type @'
using System; using System.Runtime.InteropServices;
public class NativeFullCapture {
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out R r);
 [StructLayout(LayoutKind.Sequential)] public struct R {public int Left,Top,Right,Bottom;}
}
'@
$dpi=[NativeFullCapture]::SetProcessDpiAwarenessContext([IntPtr](-4))
if(-not $dpi){$dpi=[NativeFullCapture]::SetProcessDPIAware()}
Start-Process ('shell:appsFolder\'+$p.PackageFamilyName+'!App')
$proc=$null
for($i=0;$i -lt 60;$i++){
 Start-Sleep -Milliseconds 500
 $proc=Get-Process HeytaWindows -EA SilentlyContinue | Where-Object {$_.Path -and $_.Path.StartsWith($p.InstallLocation+'\',[StringComparison]::OrdinalIgnoreCase)} | Select-Object -First 1
 if($proc){$proc.Refresh();if($proc.MainWindowHandle -ne 0){break}}
}
if(-not $proc -or $proc.MainWindowHandle -eq 0){throw 'INSTALLED_WINDOW_MISSING'}
Start-Sleep -Seconds 12
$proc.Refresh()
[void][NativeFullCapture]::SetForegroundWindow($proc.MainWindowHandle)
Start-Sleep -Seconds 2
$r=New-Object NativeFullCapture+R
[void][NativeFullCapture]::GetWindowRect($proc.MainWindowHandle,[ref]$r)
Add-Type -AssemblyName System.Drawing
$bmp=New-Object Drawing.Bitmap(($r.Right-$r.Left),($r.Bottom-$r.Top))
$g=[Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left,$r.Top,0,0,$bmp.Size)
$png=Join-Path $out 'installed-dpi-full.png'
$bmp.Save($png,[Drawing.Imaging.ImageFormat]::Png)
$g.Dispose();$bmp.Dispose()
@{identity=$p.Name;version=$p.Version.ToString();processPathMatchesInstalled=$proc.Path.StartsWith($p.InstallLocation+'\',[StringComparison]::OrdinalIgnoreCase);pid=$proc.Id;dpiAware=$dpi;width=$r.Right-$r.Left;height=$r.Bottom-$r.Top;pngBytes=(Get-Item $png).Length;qaCount=@(Get-CimInstance Win32_Process -Filter "Name='HeytaWindows.exe'"|Where-Object{$_.ExecutablePath -like '*heyta-qa-20261008-profile-final*'}).Count} | ConvertTo-Json -Compress | Set-Content (Join-Path $out 'installed-dpi-full.json') -Encoding ASCII
Stop-Process -Id $proc.Id -Force
