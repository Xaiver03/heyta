// Windows 原生壳的**同步 SQLite 驱动**。
//
// 为什么自己写而不是找个现成库：`packages/storage` 的 `SqliteDriver` 接口是
// **同步**的四个方法（exec/run/all/close），而 `Microsoft.Data.Sqlite` 是 ADO.NET、
// 本来全同步 —— 这部分不难。**难的是跨语言那一层**，所以本文件里最值钱的是
// `RewritePositional`：契约用 `?` 位置占位符，而 Microsoft.Data.Sqlite 只认具名参数。
//
// 这两条都是 W0-2 spike 实测撞出来的（见 research/spikes/sqlite-driver-csharp/）：
//   1. `Microsoft.Data.Sqlite` 只认具名参数，`ParameterName must be set.` 直接抛；
//   2. 翻译必须**跳过字符串字面量**里的 `?`，否则 `WHERE title = 'a?b'` 会被静默改坏
//      —— 而且坏法是"多出一个参数"，报错点离现场很远。

using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Heyta.Windows.Host;

/// <summary>
/// 同步的 <c>SqliteDriver</c>，与 <c>packages/storage/src/sqlite/sqlite-driver.ts</c> 同形。
/// 参数与行都过 **JSON 文本** —— 这是跨语言边界的类型映射唯一存在的地方。
/// </summary>
public sealed class SqliteBridge : IDisposable
{
    private readonly SqliteConnection _connection;

    /// <summary>
    /// 打开时用的路径原样留着 —— <see cref="removeDatabase" /> 报的 `target`
    /// 必须是**真的那个文件**，而不是一个便于实现的占位串。
    /// </summary>
    private readonly string _path;

    public SqliteBridge(string path)
    {
        _path = path;
        _connection = new SqliteConnection($"Data Source={path}");
        _connection.Open();

        // 与其它端一致的开关。内存库不支持 WAL（SQLite 自己留在 memory 模式，不报错）。
        using var pragma = _connection.CreateCommand();
        pragma.CommandText = path == ":memory:"
            ? "PRAGMA foreign_keys=ON;"
            : "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;";
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
        return JsonSerializer.Serialize(ReadRows(command));
    }

    /// <summary>关闭连接。必须幂等。</summary>
    public void close()
    {
        if (_connection.State != System.Data.ConnectionState.Closed)
        {
            _connection.Close();
        }
    }

    /// <summary>
    /// 移除库文件本身（不是清空表）。返回**跨边界的 JSON 文本** ——
    /// <c>exec</c> / <c>run</c> / <c>all</c> 已经是字符串过界，这一个同一条形状。
    ///
    /// 🔴 **不抛**，也不走 <c>{"__heytaDriverError":…}</c> 信封：调用方是
    /// <c>SqliteAdapter.destroy()</c>，从这儿抛出去会让**整次销毁**失败，
    /// 于是剩下几类存储一条都不被清 —— 而"删不掉"本来就是允许的结果。
    /// </summary>
    public string removeDatabase()
    {
        try
        {
            // 适配器已经调过一次 close()；这里只是幂等兜底。
            close();
            if (_path != ":memory:")
            {
                // 🔴 实测：`Close()` 之后**进程仍然持有这个库的文件句柄**
                // （`lsof` 看得见，`ClearPool()` 之后才消失）—— `Microsoft.Data.Sqlite`
                // 默认开连接池。POSIX 上带着句柄也删得掉，所以本机看不出任何问题；
                // Windows 上那是 ERROR_SHARING_VIOLATION：报告写"已删除"而明文还在，
                // 正是这条契约存在的理由。
                SqliteConnection.ClearPool(_connection);
            }
        }
        catch (Exception)
        {
            // 关不掉也继续删：真正的失败由下面的 reason 报出去。
        }

        return SqliteContainer.Remove(_path);
    }

    /// <summary>高精度时钟（微秒）。Jint 里没有 <c>performance.now()</c>，计时走宿主。</summary>
    public double nowMicros() => Stopwatch.GetTimestamp() * 1_000_000.0 / Stopwatch.Frequency;

    public void Dispose() => _connection.Dispose();

    private static List<Dictionary<string, object?>> ReadRows(SqliteCommand command)
    {
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
        return rows;
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

    /// <summary>
    /// `?` 位置占位符 → `$p0..$pN` 具名参数。
    ///
    /// 🔴 **跳过字符串字面量**里的 `?`（并处理 SQLite 的 `''` 转义）。
    /// 不跳的话 `WHERE title = 'a?b'` 会被改坏，而且坏法是**多出一个参数**，
    /// 报错点离现场很远。
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
        var placeholders = 0;
        var inString = false;
        for (var i = 0; i < sql.Length; i++)
        {
            var c = sql[i];
            if (inString)
            {
                builder.Append(c);
                if (c != '\'') continue;
                if (i + 1 < sql.Length && sql[i + 1] == '\'') { builder.Append('\''); i++; }
                else inString = false;
                continue;
            }
            if (c == '\'') { inString = true; builder.Append(c); continue; }
            if (c == '?') { builder.Append("$p").Append(placeholders); placeholders++; continue; }
            builder.Append(c);
        }

        if (placeholders != values.Count)
        {
            throw new InvalidOperationException(
                $"SQL 里的占位符数（{placeholders}）与参数个数（{values.Count}）不一致：{sql}");
        }
        return (builder.ToString(), values);
    }
}
