// `globalThis.__heytaReminderPort` 的 Windows 实现 —— 操作系统通知中心那半边界的"怎么弹"。
//
// 🔴 方法名必须与 JS 侧的属性名**逐字一致**（`authorizationStatus` / `requestAuthorization` /
//    `show` / `openSettings`）：Jint 的对象包装按名字精确匹配，`SqliteBridge.exec` 是同一个约定。
// 🔴 这里没有任何一行在决定"业务上该怎么做"：哪条提醒到点、弹过没有、`firedAt` 回执怎么记，
//    全在 `packages/app-host/src/reminder-foreground.ts`（经 bundle 的 `deliverReminders`）。
//    本文件只回答两个平台问题：**能不能弹**、**怎么弹**。
//
// 通道选择（零新增 NuGet 包；API 形状是对 Microsoft.WindowsAppSDK 2.5.1 实际随带的
// `Microsoft.Windows.AppNotifications.Projection.dll`（foundation 2.3.12）做反射探针钉死的，
// 不是照文档记忆写的）：
//   · 静态入口是 `AppNotificationManager.Default`（**没有** `Current`，也**没有**
//     `IsDefaultInstanceSupported()`，`Show` 返回 **void** —— 这个投影里压根没有
//     `AppNotificationResult` 类型）。
//   · MSIX 包装态有包身份（package-msix.ps1 生成 AppxManifest，`runFullTrust`），
//     `Default` 按身份可用 ⇒ 走 `AppNotificationManager.Default.Show(...)`。
//   · 开发态是 unpackaged（csproj `WindowsPackageType=None`、app.manifest 无身份、
//     全仓没有任何 `AppNotificationManager.Register()` 调用 —— 而那条路要求先登记
//     AppUserModelID）⇒ **如实报 unsupported**（见构造函数），不许谎报 granted。

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Windows.AppNotifications;
using Windows.ApplicationModel;
using Windows.Data.Xml.Dom;

namespace Heyta.Shell;

/// <summary>
/// 注入给桥的提醒端口。所有返回值都是可 JSON 化的基元（字符串/布尔），
/// 与 <see cref="Heyta.Windows.Host.ScriptHost"/> 的注入约定一致。
/// </summary>
public sealed class ReminderPort
{
    /// <summary>给证据文件看的 ASCII 通道判定（"这台机器上通知通道探到了什么"），不是业务状态。</summary>
    public string Channel { get; }

    /// <summary>探到可用才非 null。取 <c>Default</c> 本身在老 OS / 异常宿主下就可能抛，所以只探一次。</summary>
    private readonly AppNotificationManager? _manager;

    public ReminderPort()
    {
        if (!HasPackageIdentity())
        {
            // 🔴 未打包态刻意报 unsupported，而不是悄悄 no-op、更不是假装 granted：
            //    Windows 的 toast 需要一个**注册过的 AppUserModelID** 才有归属。
            //    unpackaged 开发产物（`dotnet publish` 的 exe）既没有包身份，本壳也
            //    **不调** `AppNotificationManager.Register()` —— 那条已文档记在案的路要求
            //    宿主先登记 AUMID，而做这件事的 API 在本仓今天并不存在（widgets 那条路
            //    同样只在 packaged 才开，见 MainWindow.TryConfigureWindowsWidgetStore）。
            //    谎报 granted 的后果是 JS 把"什么都没弹"记成已投递 —— 比不响更糟。
            _manager = null;
            Channel = "unpackaged-no-aumid";
            return;
        }
        try
        {
            _manager = AppNotificationManager.Default;
            Channel = "packaged-appnotification";
        }
        catch (Exception)
        {
            // 包身份有了但默认实例起不来（OS 太老：该投影面在 Win10 较早版本上没有；
            // 或测试宿主下的异常环境）⇒ fail closed，报 unsupported。
            _manager = null;
            Channel = "packaged-appnotification-init-failed";
        }
    }

    /// <summary>`'granted' | 'denied' | 'unsupported'`（与 `ReminderAuthorization` 同一词表）。</summary>
    public string authorizationStatus()
    {
        if (_manager is null) return "unsupported";
        try
        {
            // Windows 没有"从没问过（default）"这一档：通知默认开着，用户按应用在
            // 设置→通知 里拨开关；`DisabledForPeriod`（专注助手暂停）也按 denied 处理，
            // 因为那个窗口内 toast 根本不会显示 —— 报 granted 会导致误记账。
            return _manager.Setting == AppNotificationSetting.Enabled ? "granted" : "denied";
        }
        catch (Exception)
        {
            return "unsupported";
        }
    }

    /// <summary>
    /// Windows 没有应用内弹窗式的通知授权请求（不像 iOS/macOS）—— 用户唯一的"询问"
    /// 是系统设置里那个开关。所以这一条只回当前状态，**绝不为了变成 granted 而说谎**。
    /// </summary>
    public string requestAuthorization() => authorizationStatus();

    /// <summary>
    /// 投一条 toast。**投不出去必须返回 false**（契约红线：false ⇒ JS 不写 `firedAt`，
    /// 下一轮还会再试；true 而实际没弹 = 把提醒记成已投，比不响更糟）。
    ///
    /// ⚠️ 如实写出这一路的诚实边界：这个投影里 `Show` 是 **void**，OS 不回执。
    /// 于是"没被拒"的信号只有两个 —— 投之前 `Setting` 必须是 `Enabled`，
    /// 且 `Show` 不得抛异常。两者都成立时按 OS 语义即已入队。真机上要复核
    /// "Setting=Enabled 但通知中心实际吞掉"是否存在（见本轮报告的待验清单）。
    /// </summary>
    public bool show(string requestJson)
    {
        if (_manager is null) return false;
        try
        {
            string title = "heyta";
            string body = string.Empty;
            string? group = null;
            using (var json = JsonDocument.Parse(requestJson))
            {
                var root = json.RootElement;
                if (root.TryGetProperty("title", out var t) && t.ValueKind == JsonValueKind.String)
                    title = t.GetString() ?? title;
                if (root.TryGetProperty("body", out var b) && b.ValueKind == JsonValueKind.String)
                    body = b.GetString() ?? body;
                if (root.TryGetProperty("occurrenceId", out var o) && o.ValueKind == JsonValueKind.String)
                    group = o.GetString();
            }

            // 权限可能在 authorizationStatus() 与这一行之间被撤回 —— 再读一次，
            // 不是 Enabled 就直接 false，绝不"投了再说"。
            if (_manager.Setting != AppNotificationSetting.Enabled) return false;

            // ToastGeneric 是 OS 现代自适应模板；文本一律走 CreateTextNode，
            // 转义由 XML DOM 负责（手写字符串拼接会被任务标题里的尖括号咬）。
            var xml = new XmlDocument();
            xml.LoadXml("<toast><visual><binding template=\"ToastGeneric\"></binding></visual></toast>");
            var binding = xml.GetElementsByTagName("binding").Item(0)
                ?? throw new InvalidOperationException("ToastGeneric 模板节点丢失");
            var titleNode = xml.CreateElement("text");
            titleNode.AppendChild(xml.CreateTextNode(title));
            var bodyNode = xml.CreateElement("text");
            bodyNode.AppendChild(xml.CreateTextNode(body));
            binding.AppendChild(titleNode);
            binding.AppendChild(bodyNode);

            // AppNotification 的构造入参就是 toast XML 载荷（Payload 是只读的）；
            // Tag 放发生次标识，同一次重投会替换而非叠加。
            var notification = new AppNotification(xml.GetXml())
            {
                Tag = group ?? string.Empty,
            };
            _manager.Show(notification);
            return true;
        }
        catch (Exception)
        {
            // 任何异常都等价于"没弹出去"：返回 false，让回执留在未记账状态。
            return false;
        }
    }

    /// <summary>打开系统通知设置页。起不了进程就返回 false（不许假装打开了）。</summary>
    public bool openSettings()
    {
        try
        {
            // ShellExecute 路径处理 ms-settings: URI 协议；Process.Start 返回 null
            // 意味着"没有可归属的启动"，按没打开算。
            using var process = Process.Start(new ProcessStartInfo("ms-settings:notifications")
            {
                UseShellExecute = true,
            });
            return process is not null;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>
    /// 包身份判定。与 <see cref="MainWindow"/> 里 widgets 那条路同一个约定：
    /// unpackaged 时 <c>Package.Current</c> 抛 InvalidOperationException（或测试宿主下的 COMException），
    /// 一律按"无身份"处理。
    /// </summary>
    private static bool HasPackageIdentity()
    {
        try
        {
            return !string.IsNullOrWhiteSpace(Package.Current.Id.FamilyName);
        }
        catch (InvalidOperationException)
        {
            return false;
        }
        catch (COMException)
        {
            return false;
        }
    }
}
