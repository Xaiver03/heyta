namespace Heyta.Windows.Host;

/// <summary>
/// 独立设置窗口的**载荷**（纯逻辑，不含任何 Windows API）。
/// </summary>
/// <remarks>
/// 🔴 为什么这一层放在 Core 而不是 XAML 后面：
/// 2026-10-25 产品负责人要求「设置界面弄成单独的弹窗，网页端可以内嵌」。
/// macOS 壳已经那样做了（`HeytaMacApp.swift` 的 <c>SettingsWindow</c>），
/// 它把载荷写在 Swift 里 —— 那个决定当时是对的（只有一个壳）。
/// 到 Windows 这第二个壳时，如果再把
/// <c>index.html?settings=…&amp;standalone=1</c> 抄一遍，就出现了**两份会漂的载荷**：
/// 路径、参数名、默认分节、合法分节的清单，任何一处改动都得记得改两遍。
/// 所以「载荷长什么样」只有一份实现，放在能在 macOS / Linux 上构建和测试的库里。
///
/// 与网页端的关系：`standalone` 参数的含义由 `apps/web/src/lib/settings-deep-link.ts`
/// 定义（那边是唯一事实源）。这里**不复制**它的判断逻辑，只产出那个 URL；
/// 参数名与它对齐由 <see cref="SettingsQueryParam"/> / <see cref="StandaloneQueryParam"/>
/// 两个常量承担，并有测试盯住它们与被测字符串一致。
/// </remarks>
public static class SettingsSurface
{
    /// <summary>与 `apps/web/src/lib/settings-deep-link.ts` 的 `SETTINGS_QUERY_PARAM` 同名。</summary>
    public const string SettingsQueryParam = "settings";

    /// <summary>与同文件的 `SETTINGS_STANDALONE_PARAM` 同名。</summary>
    public const string StandaloneQueryParam = "standalone";

    /// <summary>
    /// 默认落在哪一节。「任务与显示」是产品负责人最先看的那一屏，
    /// 与 macOS 壳的 `defaultSection` 同一个值。
    /// </summary>
    public const string DefaultSection = "settings-group-appearance";

    /// <summary>
    /// 合法分节 id 的清单。**与 `apps/web/src/App.tsx` 的 `SETTINGS_NAV_ITEMS` 同源**。
    ///
    /// ⚠️ 这里是一份抄件，成因是它要跨语言（C# 读不到 TS 常量）。
    /// 所以它只允许有**一个**消费者：<see cref="BuildRelativeUrl"/> 的校验。
    /// 判据：`SettingsSurfaceTests` 用逐项相等盯住这张表；
    /// 网页端新增一节时，那条测试不会红（它读不到 TS），
    /// 但 `BuildRelativeUrl` 会**响亮拒绝**那个新 id ——
    /// 这正是要的：宁可窗口报"不认识这一节"，也不要它悄悄打开第一节。
    /// </summary>
    public static readonly string[] KnownSections =
    [
        "settings-group-profile",
        "settings-group-subscription",
        "settings-group-appearance",
        "settings-group-sync",
        "settings-group-ai",
        "settings-group-data",
        "settings-group-account",
        "settings-group-help",
    ];

    /// <summary>
    /// 组装这个窗口要载的相对地址（含查询串）。
    /// </summary>
    /// <param name="section">
    /// 目标分节；<c>null</c> / 空白 / 不在 <see cref="KnownSections"/> 里 ⇒ 退回
    /// <see cref="DefaultSection"/>。⚠️ 不抛异常：这是**窗口启动路径**，
    /// 一个手打的环境变量不该让设置窗口开不出来。
    /// </param>
    /// <returns>形如 <c>/index.html?settings=…&amp;standalone=1</c> 的相对地址。</returns>
    public static string BuildRelativeUrl(string? section)
    {
        var wanted = string.IsNullOrWhiteSpace(section) ? DefaultSection : section.Trim();
        if (Array.IndexOf(KnownSections, wanted) < 0) wanted = DefaultSection;

        return $"/index.html?{SettingsQueryParam}={Uri.EscapeDataString(wanted)}&{StandaloneQueryParam}=1";
    }
}
