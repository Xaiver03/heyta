using Heyta.Windows.Host;

namespace Heyta.Shell;

/// <summary>
/// 列表里的一行。**只是界面数据的搬运工** —— 没有排序、没有完成态推导，
/// 那些都在 TS 的 facade 里做完才过来（见 native-bridge.ts）。
/// </summary>
public sealed class TaskItem
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public bool Done { get; init; }

    public static TaskItem From(TaskView view) =>
        new() { Id = view.Id, Title = view.Title, Done = view.Done };
}
