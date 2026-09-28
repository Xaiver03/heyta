// W0-2 spike：**C# 提供的同步 `SqliteDriver`**，被真正的 TS `SqliteAdapter` 使用。
//
// 这一条是 D2 路线（C# UI + 内嵌 JS 引擎跑同一份 TS）落到存储层的关键：
//
//   packages/storage 的 `SqliteDriver` 接口是**同步**的（4 个方法：exec/run/all/close）。
//   在 .NET 上这不是难点 —— `Microsoft.Data.Sqlite` 是 ADO.NET，API 本来就全同步。
//   难点在于**跨语言**：JS 侧要能同步调到 C# 侧，且类型映射只有一处、可读懂。
//
// 所以这里刻意：
//   · 不把 CLR 对象直接编组进 JS —— 参数与行**都过 JSON 文本**。
//     理由：类型映射只有一处，能被人读懂；代价是编组开销（README 里列为未测项）。
//   · 自己写 SqliteDriver 适配而不是找个现成库 —— 因为契约里那几个可选钩子
//     （isUniqueViolation 的回退）才是真正会挂的地方。

using System.Text;
using System.Text.Json;
using Jint;
using Microsoft.Data.Sqlite;

var bundlePath = Require("SQLITE_SPIKE_BUNDLE");
var probePath = Require("SQLITE_SPIKE_PROBE");
var dbPath = Require("SQLITE_SPIKE_DB");

var engine = new Engine(options => options
    .LimitMemory(512_000_000)
    .TimeoutInterval(TimeSpan.FromSeconds(90))
    // 🔴 **W0-2 撞出来的第二个坑，而且是个会静默致命的默认值。**
    //
    // Jint 默认把 CLR 异常**冒泡给宿主、中断脚本**（官方 XML 文档原文：
    // "By default these exceptions are bubbled to the CLR host and interrupt the script
    //  execution. If handler returns true these exceptions are converted to JS errors that
    //  can be caught by the script."）。
    //
    // 而 heyta 的存储契约**依赖异常**：驱动抛错 → 适配器靠异常触发回滚 →
    // `isUniqueViolation` 把唯一冲突吸收成 `{ ok:false }`。
    // 不打开这个开关，一条重复写入就会**直接杀掉整个桌面进程**，
    // 而不是被 `try/catch` 接住 —— 实测就是这么炸的。
    .CatchClrExceptions(_ => true));

using (var host = new HostSqliteDriver(dbPath))
{
    engine.SetValue("host", host);

    engine.Execute(File.ReadAllText(bundlePath));
    if (engine.GetValue("HeytaStorage").IsUndefined())
    {
        throw new InvalidOperationException("HeytaStorage 未定义 —— bundle 不是 IIFE 或 global-name 不对");
    }

    engine.Execute(File.ReadAllText(probePath));

    // 🔴 微任务泵：驱动是**同步**的，所以所有 await 都只在微任务队列里排队，
    //    不需要真的事件循环。ProcessTasks 把它们推完即可。
    var spins = 0;
    while (!engine.GetValue("__done").AsBoolean() && spins < 200_000)
    {
        engine.Advanced.ProcessTasks();
        spins++;
    }

    if (!engine.GetValue("__done").AsBoolean())
    {
        throw new InvalidOperationException($"probe 未在 {spins} 次微任务泵内完成 —— 有真正的异步 IO 在等");
    }

    Console.WriteLine($"微任务泵次数：{spins}");

    var raw = engine.GetValue("__result");
    var json = raw.IsNull() || raw.IsUndefined() ? "null" : raw.AsString();
    Console.WriteLine("=== probe 结果 ===");
    using (var parsed = JsonDocument.Parse(json!))
    {
        var root = parsed.RootElement;
        if (root.GetProperty("ok").GetBoolean())
        {
            foreach (var step in root.GetProperty("steps").EnumerateArray())
            {
                var name = step.GetProperty("name").GetString();
                var value = step.TryGetProperty("value", out var v) ? v.ToString() : "(缺 value 键)";
                Console.WriteLine($"  · {name} = {value}");
            }
        }
        else
        {
            Console.WriteLine($"  ✗ {root.GetProperty("error").GetString()}");
            if (root.TryGetProperty("stack", out var stack))
            {
                Console.WriteLine(stack.GetString());
            }
        }
    }

    Console.WriteLine($"probe_ok={JsonDocument.Parse(json!).RootElement.GetProperty("ok").GetBoolean()}");
}

// ── 外部证据：不信 JS 的自述，自己开一个**新连接**看盘上的库 ──────────
Console.WriteLine("=== 盘上的 SQLite 文件（C# 侧独立复核）===");
using (var verify = new SqliteConnection($"Data Source={dbPath}"))
{
    verify.Open();

    using (var tables = verify.CreateCommand())
    {
        tables.CommandText = "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name";
        using var reader = tables.ExecuteReader();
        while (reader.Read())
        {
            Console.WriteLine($"  {reader.GetString(0),-6} {reader.GetString(1)}");
        }
    }

    foreach (var table in new[] { "meta", "state", "ops" })
    {
        using var count = verify.CreateCommand();
        count.CommandText = $"SELECT COUNT(*) FROM \"{table}\"";
        Console.WriteLine($"  行数 {table} = {count.ExecuteScalar()}");
    }
}

Console.WriteLine($"db_bytes={new FileInfo(dbPath).Length}");

static string Require(string name) =>
    Environment.GetEnvironmentVariable(name)
    ?? throw new InvalidOperationException($"缺少环境变量 {name}");

/// <summary>
/// 同步的 <c>SqliteDriver</c>，与 <c>packages/storage/src/sqlite/sqlite-driver.ts</c> 同形。
/// 方法签名用 <c>string</c> 收 JSON，是为了让跨语言类型映射只有一处。
/// </summary>
internal sealed class HostSqliteDriver : IDisposable
{
    private readonly SqliteConnection _connection;

    public HostSqliteDriver(string path)
    {
        _connection = new SqliteConnection($"Data Source={path}");
        _connection.Open();

        // 与其它端一致的开关：外键约束打开、WAL 让"多读一写"不至于互相堵。
        using var pragma = _connection.CreateCommand();
        pragma.CommandText = "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;";
        pragma.ExecuteNonQuery();
    }

    /// <summary>执行一段（可含多条语句的）SQL，不返回结果。DDL / BEGIN / COMMIT 走这里。</summary>
    public void exec(string sql)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    /// <summary>执行一条写入语句。</summary>
    public void run(string sql, string paramsJson)
    {
        using var command = CreateCommand(sql, paramsJson);
        command.ExecuteNonQuery();
    }

    /// <summary>执行一条查询，取回全部行（JSON 文本，键是列名）。</summary>
    public string all(string sql, string paramsJson)
    {
        using var command = CreateCommand(sql, paramsJson);

        using var reader = command.ExecuteReader();
        var rows = new List<Dictionary<string, object?>>();
        while (reader.Read())
        {
            var row = new Dictionary<string, object?>();
            for (var i = 0; i < reader.FieldCount; i++)
            {
                row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            }
            rows.Add(row);
        }
        return JsonSerializer.Serialize(rows);
    }

    /// <summary>关闭连接。必须幂等。</summary>
    public void close()
    {
        if (_connection.State != System.Data.ConnectionState.Closed)
        {
            _connection.Close();
        }
    }

    public void Dispose()
    {
        _connection.Dispose();
    }

    /// <summary>
    /// 🔴 **W0-2 真正撞出来的那个坑。**
    ///
    /// heyta 的 <c>SqliteDriver</c> 契约是 **<c>?</c> 位置占位符**
    /// （`packages/storage/src/sqlite/sqlite-driver.ts` §29：
    /// "`?:` 占位符按位置绑定 `params`"），而 **`Microsoft.Data.Sqlite` 只认具名参数**
    /// （`$name` / `@name` / `:name`）—— 直接 <c>Parameters.Add(new SqliteParameter{Value=...})</c>
    /// 会当场抛 `ParameterName must be set.`（实测）。
    ///
    /// 所以任何 Windows 侧的真驱动都必须做这一层翻译：`?` → `$p0..$pN`。
    /// 翻译要**跳过字符串字面量**里的 `?`，否则像 <c>WHERE title = 'a?b'</c> 这样的
    /// 语句会被改坏 —— 而且改坏的方式是静默多的一个参数，报错点离现场很远。
    /// </summary>
    private static (string Sql, List<object> Values) RewritePositional(string sql, string paramsJson)
    {
        using var document = JsonDocument.Parse(paramsJson);
        var values = new List<object>();
        foreach (var element in document.RootElement.EnumerateArray())
        {
            values.Add(element.ValueKind switch
            {
                JsonValueKind.Null => DBNull.Value,
                JsonValueKind.String => element.GetString()!,
                JsonValueKind.True => 1L,
                JsonValueKind.False => 0L,
                // 🔴 整数绑成 long 而不是 double —— 否则 SQLite 的比较与索引会退化。
                JsonValueKind.Number => element.TryGetInt64(out var l) ? l : element.GetDouble(),
                _ => throw new NotSupportedException($"不支持的参数类型：{element.ValueKind}"),
            });
        }

        var builder = new StringBuilder(sql.Length + (values.Count * 4));
        var placeholderCount = 0;
        var inString = false;
        for (var i = 0; i < sql.Length; i++)
        {
            var c = sql[i];
            if (inString)
            {
                builder.Append(c);
                if (c != '\'')
                {
                    continue;
                }
                // SQLite 里 '' 是转义的单引号，不算收尾。
                if (i + 1 < sql.Length && sql[i + 1] == '\'')
                {
                    builder.Append('\'');
                    i++;
                }
                else
                {
                    inString = false;
                }
                continue;
            }

            if (c == '\'')
            {
                inString = true;
                builder.Append(c);
                continue;
            }

            if (c == '?')
            {
                builder.Append("$p").Append(placeholderCount);
                placeholderCount++;
                continue;
            }

            builder.Append(c);
        }

        if (placeholderCount != values.Count)
        {
            throw new InvalidOperationException(
                $"SQL 里的占位符数（{placeholderCount}）与参数个数（{values.Count}）不一致：{sql}");
        }

        return (builder.ToString(), values);
    }

    private SqliteCommand CreateCommand(string sql, string? paramsJson)
    {
        var command = _connection.CreateCommand();
        if (string.IsNullOrEmpty(paramsJson) || paramsJson == "[]")
        {
            command.CommandText = sql;
            return command;
        }

        var (rewritten, values) = RewritePositional(sql, paramsJson);
        command.CommandText = rewritten;
        for (var i = 0; i < values.Count; i++)
        {
            command.Parameters.Add(new SqliteParameter($"$p{i}", values[i]));
        }
        return command;
    }
}
