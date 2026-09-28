// Jint 引擎宿主：加载 bundle、注入同步驱动、**按名字调 facade 函数**。
//
// 设计取舍（都可维护性相关）：
//
//   · C# 只认识"函数名 + 一个 JSON 参数 + 一个 JSON 结果"这一种调用形状。
//     新增能力 = 在 TS 那边加一个导出函数，**C# 不用改**（AppApi 只加一行）。
//   · 参数与结果都过 JSON 文本 ⇒ 跨语言类型映射只有一处。
//   · 引擎**不设内存上限**：`Options.LimitMemory` 是**累计分配预算**、不是峰值上限
//     （官方文档："allocation between two checks is irreversible"），拿它当 RSS 上限
//     会得到错误判断。⚠️ 而约束在 JS 里 **catch 不住** —— 一旦触发就直接掀掉进程，
//     W1 的 TODO 里记着"要么做隔离，要么显式接受"。

using Jint;
using Jint.Native;

namespace Heyta.Windows.Host;

public sealed class ScriptHost : IDisposable
{
    private readonly Engine _engine;
    private readonly SqliteBridge _driver;
    private readonly string _source;

    public ScriptHost(string bundlePath, string dbPath)
    {
        _source = File.ReadAllText(bundlePath);
        _driver = new SqliteBridge(dbPath);

        _engine = new Engine(options => options
            .TimeoutInterval(TimeSpan.FromSeconds(30))
            // 🔴 默认会把 CLR 异常**冒泡给宿主、中断脚本**。而 heyta 的存储契约
            //    整个建立在异常上（驱动抛错 → 适配器回滚 → isUniqueViolation 吸收冲突），
            //    不打开这个开关，一条重复写入就会**杀掉整个进程**。
            .CatchClrExceptions(_ => true));

        // 宿主注入同步驱动 —— facade 不自己实现驱动，存储引擎仍是 packages/storage 那一份。
        _engine.SetValue("__heytaDriverFactory", new Func<SqliteBridge>(() => _driver));

        _engine.Execute(_source, "native-bridge.js");
        if (_engine.GetValue("HeytaApp").IsUndefined())
        {
            throw new InvalidOperationException("bundle 里没有 HeytaApp —— 打包入口/globalName 不对");
        }
    }

    /// <summary>
    /// 调 `HeytaApp.&lt;fn&gt;(JSON.parse(argJson))`，返回结果的 JSON 文本。
    ///
    /// 结果与错误分别落在 `__r` / `__e`：**错误必须能回到 C# 并显示出来**，
    /// 否则失败就只剩一个空白窗口。
    /// </summary>
    public string Call(string functionName, string argJson = "{}")
    {
        var script = $$"""
            globalThis.__done = false;
            globalThis.__r = null;
            globalThis.__e = null;
            globalThis.__es = null;
            (async () => {
              try { globalThis.__r = JSON.stringify(await HeytaApp.{{functionName}}(JSON.parse({{Json(argJson)}}))); }
              catch (error) {
                globalThis.__e = String((error && error.message) || error);
                // 🔴 **必须连堆栈一起带回 C#。** 只带 message 的话，
                //    TS 里任何一处 JSON.parse / 断言失败都会变成一个
                //    没有位置的字符串，排查等于从零开始 —— 第一版就是这么卡住的。
                globalThis.__es = String((error && error.stack) || '');
              }
              globalThis.__done = true;
            })();
            """;

        _engine.Execute(script, $"{functionName}.js");

        // 驱动是**同步**的，所以所有 await 都只在微任务队列里排队，
        // 不需要真的事件循环 —— ProcessTasks 把它推完即可。
        var spins = 0;
        while (!_engine.GetValue("__done").AsBoolean() && spins < 200_000)
        {
            _engine.Advanced.ProcessTasks();
            spins++;
        }
        if (!_engine.GetValue("__done").AsBoolean())
        {
            throw new TimeoutException($"{functionName} 未在 {spins} 次微任务泵内完成 —— 有真正的异步 IO 在等");
        }

        var error = _engine.GetValue("__e");
        if (!error.IsNull() && !error.IsUndefined())
        {
            var stack = _engine.GetValue("__es");
            var detail = stack.IsNull() || stack.IsUndefined() ? string.Empty : $"\n{stack.AsString()}";
            throw new InvalidOperationException($"HeytaApp.{functionName} 失败：{error.AsString()}{detail}");
        }

        var result = _engine.GetValue("__r");
        return result.IsNull() || result.IsUndefined() ? "null" : result.AsString();
    }

    public void Dispose()
    {
        _engine.Execute("try { HeytaApp.close(); } catch (e) {}");
        _driver.Dispose();
    }

    /// <summary>把一个 C# 字符串安全地嵌成 JS 字面量（JSON 字符串正好是合法 JS 字面量）。</summary>
    private static string Json(string value) =>
        System.Text.Json.JsonSerializer.Serialize(value);
}
