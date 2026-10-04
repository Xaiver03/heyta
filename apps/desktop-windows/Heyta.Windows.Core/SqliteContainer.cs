// SQLite **持久容器的移除**（原生壳侧）。
//
// 契约在 `packages/storage/src/sqlite/sqlite-driver.ts` 的 `removeDatabase?`，
// 那一段解释了为什么这一层是**可选**的：驱动的实现方跨出 TypeScript，
// 把必填加在它们身上只会得到"改不动 → 整条契约被绕过"。
// 代价也写在同一处：**没有这个方法时销毁只做到"清空内容"，文件还在**。
//
// 🔴 **本函数绝不抛** —— 这条不是风格问题。抛出去会让 `SqliteAdapter.destroy()`
// 整体失败，于是剩下几类存储**根本不被执行**，而这条契约存在的理由恰恰是
// "漏了不会报错，只会继续留着明文"。删不掉就是一条 `containerRemoved:false`
// 加一个原因，交给调用方写成书面凭据。
//
// ⚠️ 只删主文件不够：`-wal` 里是能重放回明文的日志。实测（macOS，
// `Microsoft.Data.Sqlite` WAL 模式）连接关闭后 `-wal`/`-shm` **仍然留在原地**，
// 所以旁挂文件必须一起扫。

using System.Text.Json;

namespace Heyta.Windows.Host;

/// <summary>
/// 把库文件连同 WAL 旁挂文件从磁盘上抹掉，返回**跨边界的 JSON 文本**。
/// </summary>
public static class SqliteContainer
{
    /// <summary>
    /// SQLite 的旁挂文件后缀。主文件本身用空串表示，于是同一个循环管三处。
    /// </summary>
    private static readonly string[] Suffixes = ["", "-wal", "-shm"];

    /// <summary>
    /// Win32 错误码（HRESULT 的低 16 位）。写死成常量而不是取异常原文，
    /// 理由见下面的 <see cref="Reason" />。
    /// </summary>
    private const int FileNotFound = 2,
        PathNotFound = 3,
        AccessDenied = 5,
        SharingViolation = 32;

    /// <summary>
    /// 移除 <paramref name="path" /> 指向的库（含 `-wal` / `-shm`），
    /// 返回 <c>SqliteContainerRemoval</c> 形状的 JSON 文本。
    ///
    /// 三个实现在（node 驱动、sqlite-wasm 驱动、这里）保持同一套语义：
    /// 文件本来就不存在 = **成功**（幂等）；三处**都尝试**、只报第一个失败原因。
    /// </summary>
    public static string Remove(string path)
    {
        // 私有内存库没有磁盘容器 —— 与 node 驱动同一档处理，不是"假装删掉了"。
        if (path == ":memory:") return Json(path, true, null);

        var target = Path.GetFullPath(path);
        string? failure = null;
        foreach (var suffix in Suffixes)
        {
            try
            {
                // `File.Delete` 对"不存在"是静默成功，正是幂等要的形状。
                File.Delete(target + suffix);
            }
            catch (Exception error)
            {
                failure ??= Reason(error);
            }
        }

        return Json(target, failure is null, failure);
    }

    /// <summary>
    /// 失败原因：**纯 ASCII 的短码**。
    ///
    /// 🔴 刻意**不**取 `error.Message`：中文 Windows 上那些原文是本地化的
    /// （"另一个程序正在使用此文件…"），而这条 reason 会连同销毁报告落进
    /// 证据文件 —— 那边是用 `Set-Content -Encoding ASCII` 写的
    /// （`scripts/install-and-capture.ps1`），非 ASCII 会被写成 `?`。
    /// Win32 错误码既是纯 ASCII，也比一句随系统语言变的话可靠。
    /// </summary>
    private static string Reason(Exception error) =>
        (error.HResult & 0xFFFF) switch
        {
            PathNotFound => "path-parent-missing",
            FileNotFound => "file-missing",
            AccessDenied => "access-denied",
            SharingViolation => "file-in-use",
            // 认不出来也要给个能 grep 的东西，而不是留空。
            _ => $"delete-failed-0x{error.HResult:x8}",
        };

    /// <summary>
    /// 编成跨边界的 JSON。`reason` 为 null 时**整个键不出现** ——
    /// `parseContainerRemoval` 读的是 `typeof record.reason === 'string'`，
    /// 写成 `"reason":null` 会让"成功"也带上一条原因，读起来像失败。
    /// </summary>
    private static string Json(string target, bool containerRemoved, string? reason)
    {
        var payload = new Dictionary<string, object?> { ["target"] = target, ["containerRemoved"] = containerRemoved };
        if (reason is not null) payload["reason"] = reason;
        return JsonSerializer.Serialize(payload);
    }
}
