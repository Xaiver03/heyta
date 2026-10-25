namespace Heyta.Windows.Host;

/// <summary>
/// 共享 UI 产物目录（<c>web-dist</c>）的解析：**只有这一处**。
/// </summary>
/// <remarks>
/// 🔴 抽出来的理由与 macOS 壳的 <c>SharedWebRoot</c> 相同：主窗口与独立设置窗口
/// 都载同一份产物。两处各写一遍"先看环境变量、再找 exe 旁边的 web-dist"，
/// 就是一份会漂的抄件 —— 而漂了之后的症状是"一个窗口能开、另一个白屏"。
///
/// ⚠️ 这一层不含任何 Windows API（只用 <see cref="AppContext.BaseDirectory"/>
/// 与环境变量），所以它进 `Heyta.Windows.Core`，在 macOS / Linux 上也能构建与测试。
/// </remarks>
public static class WindowsWebRoot
{
    /// <summary>spike / 取证用：直接把产物目录指过去。</summary>
    public const string RootOverrideVariable = "HEYTA_WEB_ROOT";

    /// <summary>产物装在 exe 旁边的目录名（打包脚本 `package-msix.ps1` 的约定）。</summary>
    public const string FolderName = "web-dist";

    /// <summary>
    /// 解析产物目录。**不检查存在性**（调用方自己判断并给出可读的错误），
    /// 因为"该找哪里"与"找到没有"是两件事，混在一起会让错误信息说不清。
    /// </summary>
    public static string Resolve()
    {
        var overridden = Environment.GetEnvironmentVariable(RootOverrideVariable);
        if (!string.IsNullOrWhiteSpace(overridden)) return overridden;

        return Path.Combine(AppContext.BaseDirectory, FolderName);
    }
}
