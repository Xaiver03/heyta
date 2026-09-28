// W0-4 spike（D2 路线）· 第二台引擎：**.NET + Jint**。
//
// 跑的是**同一份 bundle 字节**与**同一份用例源码**（cases.json），
// 产出一份可与裸 V8 那份逐条比对的报告。
//
// 这一条如果过了，D2（C# UI + 内嵌 JS 引擎跑同一份 TS bundle）就在
// "同一份字节、两台引擎、结果一致"这个意义上被证明可行。
//
// 注意：这里刻意**不**给引擎注入任何宿主对象（不 SetValue process/window 之类）——
// 内嵌引擎的默认环境本来就是裸的，与 harness.mjs 的空沙箱等价。
//
// 用法（由 run.sh 调用）：
//   DOMAIN_BUNDLE=… DOMAIN_CASES=… DOMAIN_OUT=… TZ=UTC dotnet run -c Release

using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jint;

var bundlePath = Environment.GetEnvironmentVariable("DOMAIN_BUNDLE")
    ?? throw new InvalidOperationException("缺少 DOMAIN_BUNDLE");
var casesPath = Environment.GetEnvironmentVariable("DOMAIN_CASES")
    ?? throw new InvalidOperationException("缺少 DOMAIN_CASES");
var outPath = Environment.GetEnvironmentVariable("DOMAIN_OUT")
    ?? throw new InvalidOperationException("缺少 DOMAIN_OUT");

var bundle = File.ReadAllText(bundlePath);
var cases = JsonNode.Parse(File.ReadAllText(casesPath))!["cases"]!.AsObject();

var engine = new Engine(options => options
    .LimitMemory(512_000_000)
    .TimeoutInterval(TimeSpan.FromSeconds(30)));

engine.Execute(bundle);

var domain = engine.GetValue("HeytaDomain");
if (domain.IsUndefined())
{
    throw new InvalidOperationException("HeytaDomain 未定义 —— bundle 不是 IIFE 或 global-name 不对");
}
engine.SetValue("D", domain);

var results = new Dictionary<string, object>();
var failures = new List<string>();
foreach (var entry in cases)
{
    var name = entry.Key;
    var source = entry.Value!.GetValue<string>();
    try
    {
        // 与 harness.mjs 逐字相同的一段 JS 源码。
        var evaluated = engine.Evaluate($"JSON.stringify({source})");
        var value = evaluated.IsUndefined() ? "__undefined__" : evaluated.AsString();
        results[name] = new { ok = true, value };
    }
    catch (Exception error)
    {
        results[name] = new { ok = false, error = error.Message };
        failures.Add($"{name}: {error.Message}");
    }
}

var report = new Dictionary<string, object?>
{
    ["engine"] = $".NET {Environment.Version} / Jint {typeof(Engine).Assembly.GetName().Version}",
    ["tz"] = Environment.GetEnvironmentVariable("TZ") ?? "(未设置)",
    ["bundle"] = bundlePath,
    ["bundleBytes"] = Encoding.UTF8.GetByteCount(bundle),
    ["exportCount"] = engine.Evaluate("Object.keys(D).length").AsNumber(),
    ["caseCount"] = cases.Count,
    ["results"] = results,
};

File.WriteAllText(
    outPath,
    JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }) + "\n");

Console.WriteLine($"engine={report["engine"]}");
Console.WriteLine($"bundle 字节={report["bundleBytes"]} 导出={report["exportCount"]}");
Console.WriteLine($"用例 {report["caseCount"]} 条，失败 {failures.Count} 条");
foreach (var failure in failures)
{
    Console.WriteLine($"  ✗ {failure}");
}
Console.WriteLine($"→ {outPath}");
return failures.Count == 0 ? 0 : 1;
