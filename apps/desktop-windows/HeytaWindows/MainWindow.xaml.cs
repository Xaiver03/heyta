using System.Collections.ObjectModel;
using Heyta.Windows.Host;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.System;

namespace Heyta.Shell;

/// <summary>
/// 壳的代码后置。**这里只有"把界面事件转成 AppApi 调用"这一件事。**
///
/// 🔴 纪律：任何业务规则（排序、完成态判定、派生视图）都不许写进这个文件。
/// 它们全在 `packages/app-host/src/windows-bridge.ts` 里 —— 那份代码
/// web / mobile / macOS / Linux 用的是同一套。写在这里就等于分叉出第二份实现。
/// 详见 apps/desktop-windows/README.md。
/// </summary>
public sealed partial class MainWindow : Window
{
    private readonly ObservableCollection<TaskItem> _tasks = new();
    private AppApi? _api;
    private string _dbPath = string.Empty;

    public MainWindow()
    {
        InitializeComponent();
        TaskList.ItemsSource = _tasks;

        AddButton.Click += (_, _) => AddCurrentTask();
        NewTaskTitle.KeyDown += (_, e) =>
        {
            if (e.Key == VirtualKey.Enter) AddCurrentTask();
        };

        TryInitialize();
    }

    /// <summary>
    /// 初始化。**失败必须显示出来** —— 一个空白窗口是这类壳最难排查的失败形态，
    /// 所以这里把异常原文放进状态栏，而不是吞掉。
    /// </summary>
    private void TryInitialize()
    {
        try
        {
            var bundle = Path.Combine(AppContext.BaseDirectory, "app-bridge.js");
            _dbPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "heyta",
                "heyta.sqlite");
            Directory.CreateDirectory(Path.GetDirectoryName(_dbPath)!);

            _api = new AppApi(bundle, _dbPath);
            var clientId = _api.Open(_dbPath);

            FooterText.Text = $"库：{_dbPath}　设备：{clientId}";
            StatusText.Text = string.Empty;
            Refresh();
        }
        catch (Exception error)
        {
            StatusText.Text = $"初始化失败：{error.Message}";
            AddButton.IsEnabled = false;
            NewTaskTitle.IsEnabled = false;
        }
    }

    private void Refresh()
    {
        if (_api is null) return;
        try
        {
            _tasks.Clear();
            foreach (var view in _api.ListTasks())
            {
                _tasks.Add(TaskItem.From(view));
            }
            StatusText.Text = _tasks.Count == 0 ? "还没有任务。上面写一条试试。" : string.Empty;
        }
        catch (Exception error)
        {
            StatusText.Text = $"读取失败：{error.Message}";
        }
    }

    private void AddCurrentTask()
    {
        if (_api is null) return;
        var title = NewTaskTitle.Text;
        if (string.IsNullOrWhiteSpace(title)) return;   // 交互决策：空回车什么都不做
        try
        {
            _api.AddTask(title);
            NewTaskTitle.Text = string.Empty;
            Refresh();
        }
        catch (Exception error)
        {
            StatusText.Text = $"添加失败：{error.Message}";
        }
    }

    private void OnToggleDone(object sender, RoutedEventArgs e)
    {
        if (_api is null || sender is not CheckBox box || box.Tag is not string id) return;
        try
        {
            _api.SetTaskDone(id, box.IsChecked == true);
            Refresh();
        }
        catch (Exception error)
        {
            StatusText.Text = $"更新失败：{error.Message}";
            Refresh();
        }
    }

    private void OnDelete(object sender, RoutedEventArgs e)
    {
        if (_api is null || sender is not Button button || button.Tag is not string id) return;
        try
        {
            _api.RemoveTask(id);
            Refresh();
        }
        catch (Exception error)
        {
            StatusText.Text = $"删除失败：{error.Message}";
        }
    }
}
