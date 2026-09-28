// 原生壳看到的**唯一** C# 侧 API。
//
// 它只是一层薄薄的类型化包装：把 JSON 结果解析成 record，把错误往上抛。
// **这里不许出现任何业务规则** —— 排序、完成态、派生视图都在 TS 的
// `packages/app-host/src/native-bridge.ts` 里。新增能力 = 那边加函数 + 这里加一行。

using System.Text.Json;
using System.Text.Json.Serialization;

namespace Heyta.Windows.Host;

/// <summary>原生列表真正需要的字段。字段与 TS 侧 <c>TaskView</c> 一一对应。</summary>
public sealed record TaskView(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("done")] bool Done,
    [property: JsonPropertyName("completedAt")] long? CompletedAt,
    [property: JsonPropertyName("note")] string? Note);

internal sealed record TaskListEnvelope(
    [property: JsonPropertyName("tasks")] List<TaskView> Tasks);

internal sealed record ClientIdEnvelope(
    [property: JsonPropertyName("clientId")] string ClientId);

internal sealed record IdEnvelope(
    [property: JsonPropertyName("id")] string Id);

public sealed class AppApi : IDisposable
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly ScriptHost _host;

    public AppApi(string bundlePath, string dbPath)
    {
        _host = new ScriptHost(bundlePath, dbPath);
    }

    /// <summary>打开应用宿主，返回设备 clientId。幂等。</summary>
    public string Open(string dbPath) =>
        JsonSerializer.Deserialize<ClientIdEnvelope>(
            _host.Call("open", JsonSerializer.Serialize(new { dbPath })), Options)!.ClientId;

    public IReadOnlyList<TaskView> ListTasks() =>
        JsonSerializer.Deserialize<TaskListEnvelope>(_host.Call("listTasks"), Options)!.Tasks;

    public string AddTask(string title) =>
        JsonSerializer.Deserialize<IdEnvelope>(
            _host.Call("addTask", JsonSerializer.Serialize(new { title })), Options)!.Id;

    public void SetTaskDone(string id, bool done) =>
        _host.Call("setTaskDone", JsonSerializer.Serialize(new { id, done }));

    public void RemoveTask(string id) =>
        _host.Call("removeTask", JsonSerializer.Serialize(new { id }));

    public void Dispose() => _host.Dispose();
}
