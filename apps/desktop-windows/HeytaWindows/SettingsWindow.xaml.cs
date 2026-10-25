using Heyta.Windows.Host;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;

namespace Heyta.Shell;

/// <summary>
/// 独立设置窗口：一个 WebView2 载"只画设置"的那一页。
/// </summary>
/// <remarks>
/// 与 macOS 壳的 <c>SettingsWindow</c> 同构（那边是 NSWindow + WKWebView）。
/// **载荷不在这里拼**：`SettingsSurface.BuildRelativeUrl` 才是唯一实现，
/// 它在 `Heyta.Windows.Core` 里，可以在 macOS / Linux 上构建和测试。
/// 本文件只做三件壳才能做的事：建窗口、映射本地产物目录、导航。
/// </remarks>
public sealed partial class SettingsWindow : Window
{
    private static SettingsWindow? _instance;

    private SettingsWindow(string? section)
    {
        InitializeComponent();
        Title = "设置";

        // 与主窗口同一套尺寸观：900 宽足够放下"标签 + 控件"两列，
        // 再窄就会触发共享 UI 的窄档（那是给手机用的）。
        AppWindow.Resize(new Windows.Graphics.SizeInt32(900, 640));

        _ = LoadAsync(section);
    }

    /// <summary>
    /// 打开（或唤回）设置窗口。单个实例：再点一次 ⌘,/Ctrl+, 只是把它提到前面，
    /// 而不是开出第五个窗口 —— 与 macOS 壳的 `SettingsWindow.open()` 同一条纪律。
    /// </summary>
    public static void Show(string? section = null)
    {
        if (_instance is not null)
        {
            _instance.Activate();
            return;
        }

        _instance = new SettingsWindow(section);
        _instance.Closed += (_, _) => _instance = null;
        _instance.Activate();
    }

    private async Task LoadAsync(string? section)
    {
        var root = WindowsWebRoot.Resolve();
        if (!Directory.Exists(root))
        {
            // 产物缺席时**说清楚缺什么**，不要留一个白窗口
            // （macOS 那边白窗排查花了两轮，教训记在交接文档里）。
            Title = $"设置（未找到 web-dist：{root}）";
            return;
        }

        await Web.EnsureCoreWebView2Async();
        Web.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "heyta.local", root, CoreWebView2HostResourceAccessKind.Allow);
        Web.CoreWebView2.Navigate("https://heyta.local" + SettingsSurface.BuildRelativeUrl(section));
    }
}
