using Microsoft.UI.Xaml;

namespace Heyta.Shell;

public partial class App : Application
{
    private Window? _window;

    public App() => InitializeComponent();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        // 壳**只做窗口**。数据、排序、完成态、持久化全在 TS 那一侧
        // （见 apps/desktop-windows/README.md 的分层说明）。
        _window = new MainWindow();
        _window.Activate();
    }
}
