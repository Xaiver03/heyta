// Windows 壳的**无头冒烟**：不开窗，只验"跨语言那一层 + 真的落盘"。
//
// 为什么值得单独存在：壳里最容易错的东西（同步 SqliteDriver、`?`→`$pN` 翻译、
// Jint 的微任务泵、JSON 编组、以及和 TS facade 的契约）**一点 Windows API 都不需要**。
// 把 Core 拆出来就是为了让这些能在任意 OS 上跑 —— 于是它们能进 CI，
// 而不是"只有那台 Windows 机器上的那个人知道它能不能用"。
//
// 断言是**真的断言**（失败即非零退出），不是打印给人看：
// 一个只打印的冒烟脚本会在没人读输出时悄悄变成"一直绿"。
//
// 用法：
//   HEYTA_BRIDGE_BUNDLE=<path/native-bridge.js> dotnet run --project apps/desktop-windows/smoke
//
// 前置：先跑 `node packages/app-host/scripts/build-native-bridge.mjs`。

using System.Text.Json;

using Heyta.Windows.Host;

var bundle = Environment.GetEnvironmentVariable("HEYTA_BRIDGE_BUNDLE")
    ?? Path.Combine(AppContext.BaseDirectory, "native-bridge.js");
if (!File.Exists(bundle))
{
    Console.Error.WriteLine($"❌ 找不到 bundle：{bundle}");
    Console.Error.WriteLine("   先跑：node packages/app-host/scripts/build-native-bridge.mjs");
    return 1;
}

// ─────────────────────────────────────────────────────────────────────
// 🔴 播种模式：给**别的验收**准备一个非空的库。
//
//   HEYTA_SEED_DB=<path>  HEYTA_SEED_COUNT=<n>  → 往那个库里塞 n 条任务后退出
//
// 为什么放在 smoke 而不是壳里：**这是测试工具的事，不是产品行为**。
// 壳里多一个只服务于验收的分支，就是一处会烂掉的残留。
//
// 它存在的理由（实测需求）：M2-B 要验"共享 UI 渲染**壳自己的真数据**"，
// 而壳的库默认是空的 —— 空库下 `rows>0` 这条断言恒假，
// 于是"数据通路断了"与"库里本来就没东西"分不出来。
// ─────────────────────────────────────────────────────────────────────
var seedDb = Environment.GetEnvironmentVariable("HEYTA_SEED_DB");
if (!string.IsNullOrEmpty(seedDb))
{
    var count = int.TryParse(Environment.GetEnvironmentVariable("HEYTA_SEED_COUNT"), out var n) ? n : 3;
    Directory.CreateDirectory(Path.GetDirectoryName(seedDb)!);
    using var seedApi = new AppApi(bundle, seedDb);
    seedApi.Open(seedDb);
    for (var i = 0; i < count; i++)
    {
        seedApi.AddTask($"M2-B 真数据 {i + 1}");
    }
    Console.WriteLine($"SEED_DB={seedDb} SEED_COUNT={count} SEEDED={count}");
    Console.WriteLine($"SEED_VERIFY={seedApi.ListTasks().Count}");
    return 0;
}

var workDir = Path.Combine(Path.GetTempPath(), $"heyta-smoke-{Guid.NewGuid():N}");
Directory.CreateDirectory(workDir);
var dbPath = Path.Combine(workDir, "smoke.sqlite");

var failures = new List<string>();
void Check(bool ok, string what)
{
    Console.WriteLine($"  {(ok ? "✅" : "❌")} {what}");
    if (!ok) failures.Add(what);
}

Console.WriteLine($"bundle：{bundle}（{new FileInfo(bundle).Length} 字节）");
Console.WriteLine($"db：{dbPath}");
Console.WriteLine();

// ── 1. 打开：真的建库、真的拿到 clientId ────────────────────────────
string clientId;
using (var api = new AppApi(bundle, dbPath))
{
    clientId = api.Open(dbPath);
    Check(clientId.Length > 0, $"打开宿主并拿到 clientId（{clientId[..Math.Min(8, clientId.Length)]}…）");

    // ── 2. 空库 ─────────────────────────────────────────────────────
    Check(api.ListTasks().Count == 0, "新库列出来是空的");

    // ── 3. 新建 + 排序（排序在 TS 侧，这里只验结果）────────────────
    var first = api.AddTask("第一条");
    var second = api.AddTask("第二条");
    Check(first != second, "两条任务拿到不同的 id");

    var afterAdd = api.ListTasks();
    Check(afterAdd.Count == 2, "新建后列出 2 条");
    Check(
        afterAdd.Count == 2 && afterAdd[0].Title == "第一条" && afterAdd[1].Title == "第二条",
        "展示序：都未完成、都无截止 ⇒ 保持稳定序（与共享 sortTasksForDisplay 一致）");

    // ── 4. 完成态 ───────────────────────────────────────────────────
    api.SetTaskDone(first, true);
    var afterDone = api.ListTasks();
    Check(afterDone.Count(a => a.Done) == 1, "只有一条被标成完成");
    Check(afterDone.First(t => t.Id == first).Done, "被标完成的是第一条");
    Check(afterDone.First(t => t.Id == first).CompletedAt is not null, "完成时间真的写进去了");

    // 🔴 G5：完成之后顺序**必须变** —— 已完成沉到最后。
    // 这一条是**能失败**的：把门面改回按 (createdAt, id) 排，
    // `first` 会重新排到最前，于是这里立刻红。
    // ⚠️ 上面第 3 步那条**抓不到**这个回归 —— 那时两条都未完成，
    // 两种规则给出同一个顺序（这正是它当时看不出问题的原因）。
    Check(
        afterDone.Count == 2 && afterDone[0].Title == "第二条" && afterDone[1].Title == "第一条",
        "已完成沉到最后 —— 与共享 sortTasksForDisplay 一致");

    // ── 5. 错误必须能过边界（而不是静默）───────────────────────────
    var emptyTitleRejected = false;
    try
    {
        api.AddTask(string.Empty);
    }
    catch
    {
        emptyTitleRejected = true;
    }
    Check(emptyTitleRejected, "空标题被拒（TaskActions 的既定语义，跨语言之后仍然成立）");
}

// ── 6. 重开：真的落盘了（换一个宿主读同一个文件）────────────────────
using (var reopened = new AppApi(bundle, dbPath))
{
    reopened.Open(dbPath);
    var tasks = reopened.ListTasks();
    Check(tasks.Count == 2, "重开后仍然是 2 条（数据真的落盘）");
    Check(tasks.Count(t => t.Done) == 1, "重开后完成态还在");

    // ── 7. 软删除 ───────────────────────────────────────────────────
    reopened.RemoveTask(tasks[0].Id);
    Check(reopened.ListTasks().Count == 1, "软删除后只剩 1 条");
}

// ── 8. 页侧存储宿主（B）：op-log 经宿主边界落到**壳自己的 SQLite** ──
//
// 这一段验的是 B（桌面端真应用的存储接到壳的 SQLite）的壳侧：
// 页侧会把 op-log 请求经宿主边界发过来，壳侧用**同一份** `DbOpLogStore`
// （`packages/storage`）跑在**原生 SQLite** 上，并把响应发回去。
//
// 🔴 判据刻意选"**从 C# 独立读那个 .sqlite 文件**"：界面说"已保存"不算证据，
//    数据真的在那个文件里才算。用 `SqliteBridge` 直查 `ops` 表，
//    不经过 TS 栈 —— 于是它同时证明了"跨语言"与"真落盘"。
//
// ⚠️ 用**另一个库文件**：`openOpLog` 只建 store、**不建引擎**，
//    而同库再跑一个引擎会各自为政（见 AppApi.OpenOpLog 的说明）。
var opLogDb = Path.Combine(workDir, "oplog.sqlite");
{
    using var opApi = new AppApi(bundle, opLogDb);
    var opClientId = opApi.OpenOpLog();
    Check(opClientId.Length > 0, $"openOpLog 拿到库里给出的 clientId（{opClientId[..Math.Min(8, opClientId.Length)]}…）");

    static string Request(int id, string method, object args) =>
        JsonSerializer.Serialize(new { id, method, args });

    static (bool Ok, JsonElement Value) Parse(string responseJson)
    {
        using var doc = JsonDocument.Parse(responseJson);
        var root = doc.RootElement;
        // Value 要先克隆：doc 释放之后它的子元素不可再用。
        return (root.GetProperty("ok").GetBoolean(), root.GetProperty("value").Clone());
    }

    // ── 🔴 交握：页侧发 `oplog-hello` 催 ready，壳回一条 ready ──────────
    //
    // 这一条钉的是**页侧不会被永久卡住**：ready 是推给页侧的，而页侧可能在
    // 壳推之后才挂上监听（那条就丢了）。所以页侧会反复催，壳每次都要回。
    var helloSent = opApi.HandleHostMessage("{\"type\":\"oplog-hello\"}");
    Check(helloSent.Count == 1, "oplog-hello ⇒ 壳回且只回一条消息");
    var readyOk = false;
    var readyClientIdMatches = false;
    if (helloSent.Count == 1)
    {
        using var readyDoc = JsonDocument.Parse(helloSent[0]);
        var ready = readyDoc.RootElement;
        readyOk = ready.GetProperty("type").GetString() == "ready";
        readyClientIdMatches = ready.GetProperty("clientId").GetString() == opClientId;
    }
    Check(readyOk, "那条消息是 ready 交握");
    Check(readyClientIdMatches, "ready 里的 clientId 与库里那个**逐字相同**（页侧不能自己算一个）");

    var empty = Parse(opApi.HandleHostMessage(Request(1, "getAllOps", new object[] { }))[0]);
    Check(
        empty.Ok && empty.Value.GetArrayLength() == 0,
        "空库经宿主边界 getAllOps ⇒ ok 且 0 条");

    var opId = "op-from-page-1";
    var append = Parse(
        opApi.HandleHostMessage(
            Request(
                2,
                "appendLocal",
                new object[]
                {
                    new object[]
                    {
                        new
                        {
                            id = opId,
                            entityType = "TASK",
                            entityId = "task-1",
                            opType = "CRT",
                            // ⚠️ 中文 + 需要转义的字符都放进去：宿主边界是**字符串**，
                            //    编码错一层的症状是"某些标题变成乱码"，而不是报错。
                            payload = new { title = "穿过宿主边界 \"quoted\" ✓" },
                            clientId = opClientId,
                            timestamp = 1,
                            vectorClock = new Dictionary<string, int> { [opClientId] = 1 },
                            schemaVersion = 1,
                        },
                    },
                }))[0]);
    Check(
        append.Ok && append.Value.GetArrayLength() == 1 && append.Value[0].GetInt32() == 1,
        "appendLocal 经宿主边界 ⇒ 返回 seq [1]");

    var afterAppend = Parse(opApi.HandleHostMessage(Request(3, "getAllOps", new object[] { }))[0]);
    Check(
        afterAppend.Ok && afterAppend.Value.GetArrayLength() == 1 &&
            afterAppend.Value[0].GetProperty("op").GetProperty("id").GetString() == opId,
        "再经宿主边界 getAllOps ⇒ 正是刚写的那条（读回来的形状没被边界改坏）");

    // 🔴 独立读库：**不经过 TS 栈**，直接问那个 SQLite 文件。
    using (var raw = new SqliteBridge(opLogDb))
    {
        var rows = raw.all("select count(*) as n from ops", "[]");
        using var doc = JsonDocument.Parse(rows);
        var n = doc.RootElement[0].GetProperty("n").GetInt32();
        Check(n >= 1, $"C# 独立读壳的 .sqlite ⇒ ops 表里有 {n} 行（数据真的在壳的库里）");
    }

    // ⚠️ 如实记边界：`markUploaded` 的 `ReadonlyMap` 过不了**裸 JSON**，
    //    必须有线码。那一格由 `packages/storage/tests/contract.spec.ts` 的
    //    「宿主边界（裸 JSON + 两侧线码）」契约项在本机判（252/252），
    //    这里不重复造一套断言 —— 而 C# 只搬字符串，不会改坏载荷。
}

try
{
    Directory.Delete(workDir, recursive: true);
}
catch (IOException)
{
    // 临时目录清不掉不影响结论。
}

Console.WriteLine();
if (failures.Count > 0)
{
    Console.Error.WriteLine($"❌ 冒烟失败 {failures.Count} 条：");
    foreach (var failure in failures) Console.Error.WriteLine($"   · {failure}");
    return 1;
}

Console.WriteLine("✅ 跨语言那一层 + 落盘 全部通过。");
return 0;
