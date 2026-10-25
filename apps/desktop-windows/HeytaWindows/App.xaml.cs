using Microsoft.UI.Xaml;

namespace Heyta.Shell;

public partial class App : Application
{
    private Window? _window;

    public App() => InitializeComponent();

    /// <summary>
    /// 独立设置窗口的入口（与 macOS 壳的 <see cref="MainWindow"/> 之外那个
    /// <c>SettingsWindow.open()</c> 同构）。主窗口菜单/快捷键与取证开关都走这里。
    /// </summary>
    public static void ShowSettings(string? section = null) => SettingsWindow.Show(section);

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        // 壳**只做窗口**。数据、排序、完成态、持久化全在 TS 那一侧
        // （见 apps/desktop-windows/README.md 的分层说明）。
        _window = new MainWindow();
        _window.Activate();

        /*
         * 取证开关（与 macOS 壳同名同义）：`HEYTA_OPEN_SETTINGS=1` 启动即打开设置窗口。
         *
         * 🔴 为什么必须有它：`check:windows-shell` 的那条链是"跑起来 → 判读数"，
         * 没有键盘那一步；而设置窗口正常只能靠菜单/快捷键打开。
         * 默认值就是产品行为 —— 这个变量只为取证存在。
         * `HEYTA_SETTINGS_STANDALONE=<section>` 可指定落在哪一节（缺省「任务与显示」）。
         */
        if (Environment.GetEnvironmentVariable("HEYTA_OPEN_SETTINGS") == "1")
        {
            ShowSettings(Environment.GetEnvironmentVariable("HEYTA_SETTINGS_STANDALONE"));
        }
    }
}
