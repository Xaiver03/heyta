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

    /// <summary>
    /// 🔴 **完整任务实体的原样 JSON**（不经 C# 建模）。
    ///
    /// 共享 UI（`packages/ui` 的 `TaskList`）要的是完整 `Task`（优先级/截止/标签/…），
    /// 而 `TaskView` 是**为手写 ListView 裁出来的窄视图**。窄视图驱动不了共享 UI ——
    /// 这就是方案 §4.4 的 G4 在实测里的样子。
    ///
    /// ⚠️ 刻意**不在 C# 侧为它建模**：多一层模型就多一处会与 TS 漂移的定义。
    /// 壳只负责把这段 JSON 送到 WebView 里（`apps/desktop-windows/README.md` 的纪律）。
    /// </summary>
    public string ListTaskEntitiesJson() => _host.Call("listTaskEntities");

    public IReadOnlyList<TaskView> ListTasks() =>
        JsonSerializer.Deserialize<TaskListEnvelope>(_host.Call("listTasks"), Options)!.Tasks;

    public string AddTask(string title) =>
        JsonSerializer.Deserialize<IdEnvelope>(
            _host.Call("addTask", JsonSerializer.Serialize(new { title })), Options)!.Id;

    public void SetTaskDone(string id, bool done) =>
        _host.Call("setTaskDone", JsonSerializer.Serialize(new { id, done }));

    public void RemoveTask(string id) =>
        _host.Call("removeTask", JsonSerializer.Serialize(new { id }));

    /// <summary>
    /// 打开**给页侧真应用用的**那份存储（**无引擎**），返回库里给出的 clientId。
    ///
    /// 🔴 与 <see cref="Open"/> 是**两条路，不能同时走**：`Open` 会建 `OpLogEngine`，
    /// 而 `app` 模式里引擎属于**页侧的真应用**。两个引擎同库会各自为政
    /// （向量时钟与 appliedOpIds 漂移），所以壳在 `app` 模式下只调这一个。
    /// </summary>
    public string OpenOpLog() =>
        JsonSerializer.Deserialize<ClientIdEnvelope>(
            _host.Call("openOpLog", JsonSerializer.Serialize(new { dbPath = string.Empty })), Options)!
            .ClientId;

    /// <summary>
    /// 把页侧发来的**一条消息**转给 TS，拿回**要发回去的那些消息**。
    ///
    /// 🔴 为什么是"收一条、回多条"：`ready` 交握是**推**给页侧的，而推的时机
    /// 壳控制不了（页侧可能还没挂上监听）—— 所以页侧会反复发 `oplog-hello` 来催，
    /// 壳每次回一条 ready。把"回什么"交给 TS，C# 就只需把返回的每一串**原样发出去**，
    /// 于是它**不必认识任何协议字段**（不解析、不改写、不建模）。
    /// </summary>
    public IReadOnlyList<string> HandleHostMessage(string messageJson) =>
        JsonSerializer.Deserialize<OutboundEnvelope>(
            _host.Call("handleHostMessage", JsonSerializer.Serialize(new { messageJson })), Options)!
            .OutboundJson;

    public void Dispose() => _host.Dispose();
}

internal sealed record OutboundEnvelope(
    [property: JsonPropertyName("outboundJson")] List<string> OutboundJson);
