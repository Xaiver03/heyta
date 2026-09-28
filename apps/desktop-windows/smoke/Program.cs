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
//   HEYTA_BRIDGE_BUNDLE=<path/app-bridge.js> dotnet run --project apps/desktop-windows/smoke
//
// 前置：先跑 `node apps/desktop-windows/scripts/build-bridge.mjs`。

using Heyta.Windows.Host;

var bundle = Environment.GetEnvironmentVariable("HEYTA_BRIDGE_BUNDLE")
    ?? Path.Combine(AppContext.BaseDirectory, "app-bridge.js");
if (!File.Exists(bundle))
{
    Console.Error.WriteLine($"❌ 找不到 bundle：{bundle}");
    Console.Error.WriteLine("   先跑：node apps/desktop-windows/scripts/build-bridge.mjs");
    return 1;
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
        "按 (createdAt, id) 升序 —— 与 TaskActions 文档一致");

    // ── 4. 完成态 ───────────────────────────────────────────────────
    api.SetTaskDone(first, true);
    var afterDone = api.ListTasks();
    Check(afterDone.Count(a => a.Done) == 1, "只有一条被标成完成");
    Check(afterDone.First(t => t.Id == first).Done, "被标完成的是第一条");
    Check(afterDone.First(t => t.Id == first).CompletedAt is not null, "完成时间真的写进去了");

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
