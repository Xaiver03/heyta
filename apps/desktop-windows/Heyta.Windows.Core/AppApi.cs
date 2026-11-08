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

    /// <summary>
    /// `ScriptHost.Call` 的结果反序列化，**null 一律显式失败**。
    ///
    /// 🔴 为什么不能再用 `Deserialize(...)!`（崩溃审计 2026-11-08 · U18 第 7 条）：
    /// `ScriptHost.Call` 在 JS 结果是 `undefined`/`null` 时返回字符串 `"null"`
    /// （`ScriptHost.cs` 的落定协议如此）。`JsonSerializer.Deserialize<ClientIdEnvelope>("null")`
    /// **合法地**返回 `null`，而 `!` 只是压掉编译器的可空警告 —— 下一行 `.ClientId`
    /// 立刻 NullReferenceException。
    ///
    /// 后果不只是"崩"：它把一句可诊断的"门面返回了 null"降级成一句 NRE，
    /// 而调用方（`MainWindow.xaml.cs`）只能把它包成"存储宿主转发失败"。
    /// 这里改成带原始载荷的显式异常，日志里就能直接看出是哪一次调用没返回值。
    /// </summary>
    private static T DeserializeRequired<T>(string raw, string method)
    {
        T? parsed = JsonSerializer.Deserialize<T>(raw, Options);
        if (parsed is null)
        {
            throw new InvalidOperationException(
                $"门面 {method} 返回了 null（原始载荷：{Truncate(raw)}）。这通常意味着 JS 侧抛错但未被转成错误回执。");
        }
        return parsed;
    }

    /// <summary>截断超长载荷，避免把整份 JSON 灌进异常消息。</summary>
    private static string Truncate(string value) =>
        value.Length <= 200 ? value : value[..200] + "…";

    /// <summary>打开应用宿主，返回设备 clientId。幂等。</summary>
    public string Open(string dbPath) =>
        DeserializeRequired<ClientIdEnvelope>(
            _host.Call("open", JsonSerializer.Serialize(new { dbPath })), "open").ClientId;

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
        DeserializeRequired<TaskListEnvelope>(_host.Call("listTasks"), "listTasks").Tasks;

    public string AddTask(string title) =>
        DeserializeRequired<IdEnvelope>(
            _host.Call("addTask", JsonSerializer.Serialize(new { title })), "addTask").Id;

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
        DeserializeRequired<ClientIdEnvelope>(
            _host.Call("openOpLog", JsonSerializer.Serialize(new { dbPath = string.Empty })),
            "openOpLog").ClientId;

    /// <summary>
    /// 把页侧发来的**一条消息**转给 TS，拿回**要发回去的那些消息**。
    ///
    /// 🔴 为什么是"收一条、回多条"：`ready` 交握是**推**给页侧的，而推的时机
    /// 壳控制不了（页侧可能还没挂上监听）—— 所以页侧会反复发 `oplog-hello` 来催，
    /// 壳每次回一条 ready。把"回什么"交给 TS，C# 就只需把返回的每一串**原样发出去**，
    /// 于是它**不必认识任何协议字段**（不解析、不改写、不建模）。
    /// </summary>
    public IReadOnlyList<string> HandleHostMessage(string messageJson) =>
        DeserializeRequired<OutboundEnvelope>(
            _host.Call("handleHostMessage", JsonSerializer.Serialize(new { messageJson })),
            "handleHostMessage").OutboundJson;

    public void Dispose() => _host.Dispose();
}

internal sealed record OutboundEnvelope(
    [property: JsonPropertyName("outboundJson")] List<string> OutboundJson);
