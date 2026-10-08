using System.Collections.ObjectModel;
using Heyta.Windows.Host;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.System;
using Microsoft.Web.WebView2.Core;

namespace Heyta.Shell;

/// <summary>
/// 壳的代码后置。**这里只有"把界面事件转成 AppApi 调用"这一件事。**
///
/// 🔴 纪律：任何业务规则（排序、完成态判定、派生视图）都不许写进这个文件。
/// 它们全在 `packages/app-host/src/native-bridge.ts` 里 —— 那份代码
/// web / mobile / macOS / Linux 用的是同一套。写在这里就等于分叉出第二份实现。
/// 详见 apps/desktop-windows/README.md。
/// </summary>
public sealed partial class MainWindow : Window
{
    private readonly ObservableCollection<TaskItem> _tasks = new();
    private AppApi? _api;
    private string _dbPath = string.Empty;
    private WindowsDataPaths? _dataPaths;

    public MainWindow()
    {
        InitializeComponent();
        TaskList.ItemsSource = _tasks;

        AddButton.Click += (_, _) => AddCurrentTask();
        NewTaskTitle.KeyDown += (_, e) =>
        {
            if (e.Key == VirtualKey.Enter) AddCurrentTask();
        };

        // 存储宿主（B）：`app` 模式 + 显式开关才开。**默认关**的理由见字段注释。
        /**
         * 🔴 **默认开**（2026-09-30 翻）：存储宿主已经是产品行为，不再是试验开关。
         *
         * 翻的前提已经满足：**OPFS → 壳的一次性导入**做完并验通
         * （判据链与注入验证见 `apps/desktop-windows/evidence/storage-host/`）——
         * 少了它翻这个开关，已装用户会看到**一个空应用**。
         *
         * 逃生门：`HEYTA_SHELL_STORAGE=0` 显式关掉（排查"是不是存储宿主引起的"时用）。
         * ⚠️ 翻完之后 `heyta.sqlite` 是**唯一**事实来源；OPFS 只在首次导入时被读一次，且**不删**。
         */
        _storageHostEnabled =
            _webMode == "app" && Environment.GetEnvironmentVariable("HEYTA_SHELL_STORAGE") != "0";

        // 🔴 存储宿主接管存储时**不打开壳自己的引擎** —— 引擎归页侧的真应用。
        //    两个引擎同库会各自为政（向量时钟与 appliedOpIds 漂移）。
        TryInitialize(openHost: !_storageHostEnabled);

        // 🔴 M2-A spike：共享 UI 的宿主。**失败必须显示出来**，不吞。
        _ = MountSharedUiAsync();
    }

    /// <summary>
    /// 当前加载模式。**在构造函数里就定下来**（不再等 `MountSharedUiAsync()`）——
    /// 因为 `app` + 存储宿主时，壳**不能**建自己的引擎，而 `TryInitialize()`
    /// 就在模式判定之后一行；顺序反了会在同一个库上多出一个引擎。
    ///
    /// | 值 | 加载什么 | 回答什么问题 |
    /// |---|---|---|
    /// | `shell` | `?shell=1` —— 只验"读+写通道"的最小入口 | M2-A/B/C 的机制 |
    /// | `app` | **`apps/web` 的真应用**（无 query） | 桌面端的**用户旅程**是否完整 |
    ///
    /// 🔴 默认值由"有没有 `web-dist`"决定（不再无条件 `shell`）：打包脚本会把
    /// `apps/web/dist` 装成 exe 旁边的 `web-dist` —— **那才是产品**。
    /// </summary>
    private string _webMode = Environment.GetEnvironmentVariable("HEYTA_WEB_MODE")
        ?? (Directory.Exists(Path.Combine(AppContext.BaseDirectory, "web-dist")) ? "app" : "shell");

    /// <summary>
    /// **存储宿主**（B）：`app` 模式里把页侧真应用的存储接到**壳自己的 SQLite**。
    ///
    /// 打开时：壳给页侧注入 `window.__heytaHostStoragePort`，把页侧发来的消息转给
    /// TS 的 `handleHostMessage`，并把返回的每一串原样发回去。
    /// 壳**不解析**消息内容（协议在 TS 侧一份实现，见 `AppApi.HandleHostMessage`）。
    ///
    /// 🔴 **默认关**：它还缺"OPFS → 壳的一次性导入"。只接线不迁移会让已装用户
    /// 看到**一个空应用**（比崩溃更难挽回的一类故障），所以要先用
    /// `HEYTA_SHELL_STORAGE=1` 显式打开；等导入落地再默认开。见 `BLOCKED.md` 第 3 项。
    /// </summary>
    private readonly bool _storageHostEnabled;

    /// <summary>页侧实际用上的存储后端（`__heytaStorage.backend`），写进证据供人核对。</summary>
    private string _storageBackend = "";

    /// <summary>
    /// 注入给页侧的宿主存储端口 shim。
    ///
    /// 形状必须与 `oplog-worker-bridge.ts` 期望的端口一致（`postMessage` +
    /// `addEventListener`）—— 页侧据此把它当成一个**普通端口**，桥一行不改。
    ///
    /// ⚠️ 它**不编解码**：线码由页侧的 `createOpLogWirePort` 与壳侧的
    /// `handleHostMessage` 成对处理。在这里顺手包一层就会变成第三处。
    /// </summary>
    private const string HostStorageShim = """
        window.__heytaHostStoragePort = {
          postMessage: function (message) { window.chrome.webview.postMessage(message); },
          addEventListener: function (type, listener) {
            window.chrome.webview.addEventListener('message', listener);
          }
        };
        """;

    /// <summary>
    /// M2-A spike：把 `packages/ui` 的共享 UI 挂进这个原生壳。
    ///
    /// 三个刻意的决定：
    ///
    /// 1. **用虚拟主机名映射，不用 `file://`** —— `file://` 下没有正常的 origin，
    ///    service worker / fetch / module 的行为都会与真浏览器不同，
    ///    那样测出来的"能渲染"不能代表真实部署形态。
    ///    `SetVirtualHostNameToFolderMapping` 是 WebView2 官方的本地内容服务方式。
    ///
    /// 2. **页面走 `?slice=1`** —— 那是仓库既有的 M1 垂直切片入口
    ///    （`apps/web/src/dev/universal-slice.tsx`），它用**固定种子数据**渲染
    ///    `packages/ui` 的 `TaskList`，刻意不碰数据层。
    ///    所以这一步只回答 **M2-A：共享 UI 能不能在这个壳里渲染出来**；
    ///    "真数据"是 M2-B，不在这一步里假装做到。
    ///
    /// 3. **渲染结果用 JS 求值取回来，写进状态栏与证据文件** ——
    ///    "窗口出来了"不等于"共享 UI 渲染出来了"。本仓反复吃过
    ///    "截图看起来有东西、其实不对"的亏，所以这里取**组件自己打的 testID** 计数。
    /// </summary>
    /// <summary>
    /// 按模式决定窗口的**形态**：`shell` = 原生切片 + 共享 UI **并排**（M2 的试验台）；
    /// `app` = 只留共享 UI，原生那一半整块收起。
    ///
    /// 🔴 为什么 app 模式必须收起：那一半（标题/采集框/状态行/手写 ListView/页脚）
    /// 是 M2-A/B/C **通道实验**的场地，它靠 `HeytaApp.listTaskEntities` +
    /// `window.__heytaSetTasks` 这套契约跟页面说话 —— 而真应用**没有**这套契约。
    /// 不收起的话，装出来的"heyta"会是：上面一块印着报错的原生切片、下面才是真应用
    /// （2026-09-30 实测形态）。那既不是产品，也让人分不清哪半是对的。
    /// </summary>
    private void ApplyShellModeChrome()
    {
        if (_webMode == "app")
        {
            Root.Padding = new Thickness(0);
            // 隐藏实验面板不会移除 Grid 行间距：WebView 前仍有四段空隙。
            // 产品模式只留共享 UI，行距必须一起归零（125% 缩放时原空带为 60px）。
            Root.RowSpacing = 0;
            NativeRow.Height = new GridLength(0);
            ShellTitle.Visibility = Visibility.Collapsed;
            ShellComposer.Visibility = Visibility.Collapsed;
            StatusText.Visibility = Visibility.Collapsed;
            TaskList.Visibility = Visibility.Collapsed;
            FooterText.Visibility = Visibility.Collapsed;
        }
    }

    private async Task MountSharedUiAsync()
    {
        try
        {
            if (_dataPaths is null)
            {
                // TryInitialize already surfaced the path validation error.
                // Do not let WebView2 fall back to its default profile after a
                // failed QA-path setup: that would mix a QA run with user data.
                return;
            }

            if (_dataPaths.IsQaOverride)
            {
                var webViewEnvironment = await CoreWebView2Environment.CreateAsync();
                await SharedUi.EnsureCoreWebView2Async(webViewEnvironment);
                // The WinAppSDK projection only exposes the parameterless
                // factory. Record the profile WebView2 actually selected so
                // the QA runner can reject a fallback to the user's profile.
                File.WriteAllText(
                    Path.Combine(_dataPaths.DataDirectory, "qa-webview2-user-data-folder.txt"),
                    webViewEnvironment.UserDataFolder);
            }
            else
            {
                // Preserve the product's existing WebView2 profile resolution
                // when no QA override is requested.
                await SharedUi.EnsureCoreWebView2Async();
            }

            // Public help, pricing and changelog pages belong in the system
            // browser. Keep the workspace mounted in this window and only
            // hand off absolute HTTP(S) URLs; the local heyta host stays inside.
            SharedUi.CoreWebView2.NavigationStarting += OnNavigationStarting;
            SharedUi.CoreWebView2.NewWindowRequested += OnNewWindowRequested;

            // 共享 UI 的产物目录：优先环境变量（spike 用），否则找 exe 旁边的 web-dist。
            var root = Environment.GetEnvironmentVariable("HEYTA_WEB_ROOT");
            if (string.IsNullOrEmpty(root))
            {
                root = Path.Combine(AppContext.BaseDirectory, "web-dist");
            }
            if (!Directory.Exists(root))
            {
                SharedUiHostNote = $"未找到共享 UI 产物目录：{root}";
                StatusText.Text = SharedUiHostNote;
                return;
            }

            SharedUi.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "heyta.local", root, CoreWebView2HostResourceAccessKind.Allow);

            /**
             * 🔴 **存储宿主（B）：在页侧加载之前注入端口 shim。**
             *
             * 必须是"文档创建时"注入 —— 晚一步，应用已经在启动时选定了存储后端
             * （`resolveStorageBackend()` 只看这个端口在不在），那时再注入就晚了。
             */
            if (_storageHostEnabled)
            {
                await SharedUi.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                    HostStorageShim);
            }

            // 🔴 **写方向**：页面里的共享 UI 点了勾选框 → 这里 → 壳的 SQLite。
            //    用 WebView2 自己的 `WebMessageReceived`，不自造通道。
            //
            //    ⚠️ 与读方向对称：**这一层不判断任何业务规则** ——
            //    它只把 op 转成 `AppApi` 调用（而 AppApi 背后是四端共用的 app-host）。
            //    在这里写"该不该变、变成什么"就等于分叉出第二份实现。
            SharedUi.CoreWebView2.WebMessageReceived += async (_, args) =>
            {
                /**
                 * 🔴 **存储宿主接管时，页侧所有消息都是 op-log 请求或交握** ——
                 * 交给 TS 的 `handleHostMessage`，C# 只把返回的每一串**原样发出去**。
                 *
                 * 它**不解析消息内容**：不认 `hello`、不认 `ready`、不认任何协议字段
                 * （那是"壳不许多业务/schema 知识"的落点）。"回几条"由 TS 决定，
                 * 所以页侧可以反复催 ready 而 C# 不需要知道这件事。
                 *
                 * ⚠️ 这条分支只在存储宿主模式下走：`shell` 模式下页侧发的是
                 * M2-C 的 `setTaskDone` 契约，两套消息形状不同，不能混着转发。
                 */
                if (_storageHostEnabled)
                {
                    try
                    {
                        foreach (var outbound in _api!.HandleHostMessage(args.WebMessageAsJson))
                        {
                            SharedUi.CoreWebView2.PostWebMessageAsJson(outbound);
                        }
                    }
                    catch (Exception error)
                    {
                        // 失败必须**说出来** —— 静默会让页侧永远等一个不来的响应。
                        StatusText.Text = $"存储宿主转发失败：{error.Message}";
                    }
                    return;
                }

                try
                {
                    var raw = args.TryGetWebMessageAsString();
                    using var doc = System.Text.Json.JsonDocument.Parse(raw);
                    var op = doc.RootElement.GetProperty("op").GetString();
                    if (op != "setTaskDone")
                    {
                        StatusText.Text = $"未知的宿主操作：{op}";
                        return;
                    }
                    var id = doc.RootElement.GetProperty("id").GetString()!;
                    var done = doc.RootElement.GetProperty("done").GetBoolean();
                    _api?.SetTaskDone(id, done);
                    WriteHandled++;
                    // 🔴 **两个渲染器必须一起刷新。**
                    //    实测踩过：只推 WebView、不刷原生列表，于是同一次写之后
                    //    上方手写 ListView 显示"全未完成"、下方共享 UI 显示"完成 1 条" ——
                    //    **同一份数据、同一屏、两个相反的答案**。
                    //    （那条路本来要被 M2 替换掉，但在它被删掉之前，它不许说谎。）
                    Refresh();
                    // 写完**把新列表推回去**（页面刻意不做乐观更新，见 shell-host.tsx）。
                    await PushTasksAsync();
                }
                catch (Exception error)
                {
                    // 写失败必须**说出来** —— 静默失败会表现为"点了没反应"。
                    StatusText.Text = $"写回失败：{error.Message}";
                }
            };

            /**
             * 🔴 **两种模式**（`HEYTA_WEB_MODE`）：
             *
             * | 值 | 加载什么 | 回答什么问题 |
             * |---|---|---|
             * | `shell` | `?shell=1` —— 只验"读+写通道"的最小入口 | M2-A/B/C 的机制 |
             * | `app` | **`apps/web` 的真应用**（无 query） | 🔴 桌面端的**用户旅程**是否完整：身份入口 + 头像菜单 IA + 应用壳 |
             *
             * 两者分开是因为它们**回答的问题不同**：
             * 通道要一个**确定性的最小场地**（混进真实数据层只会让失败原因变模糊）；
             * 而旅程要的就是**真应用本身**。
             *
             * 🔴 **2026-09-30 起默认值由"有没有 web-dist"决定**（不再无条件 `shell`）：
             * 打包脚本会把 `apps/web/dist` 装成 exe 旁边的 `web-dist`
             *（见 `package-msix.ps1` 的 `=== 1b. web-dist`）—— **那才是产品**。
             * 此时若不设环境变量仍跑 `shell`，装出来的"heyta"就只是一个
             * M2-B 通道试验页：窗口能开、截图非空白、装包判据全绿，
             * 而**用户看到的不是应用**（2026-09-30 实测就是这个形态，
             * 见 `dist/windows/packaged-first-run.png` 里那三行「M2-B 真数据」）。
             * spike 场景（没有 web-dist、靠 `HEYTA_WEB_ROOT` 指过去）仍然显式设
             * `HEYTA_WEB_MODE=shell`，行为不变。
             */
            // 模式已在构造函数里定下（见 `_webMode` 字段）—— 这里不再重算。
            ApplyShellModeChrome();
            var url = _webMode == "app"
                ? "https://heyta.local/index.html"
                : "https://heyta.local/index.html?shell=1";
            SharedUi.CoreWebView2.Navigate(url);

            // 等首帧 + 组件挂载，再取数。用轮询而不是固定 sleep：
            // 固定 sleep 在慢机器上会假失败，在快机器上会白等。
            for (var attempt = 0; attempt < 40; attempt++)
            {
                await Task.Delay(500);

                // 断言取**共享 UI 自己打的 testID**，不是"界面上有字"。
                //    `ExecuteScriptAsync` 返回的是**被 JSON 编码过一次**的字符串，
                //    所以必须走 ProbeRows 的结构化解析 —— 用 `Contains` 会恒假，
                //    而症状是"界面明明渲染了，状态栏却说没有"（第一版就是这么翻车的）。
                // 🔴 探测**取组件自己打的 testID**，不取"界面上有字"。
                //    两个模式要看的锚点不同，所以一次拿到、由模式决定用哪个。
                var probe = await SharedUi.CoreWebView2.ExecuteScriptAsync(
                    """
                    JSON.stringify({
                      host: document.querySelectorAll('[data-testid="shell-host"]').length,
                      rows: document.querySelectorAll('[data-testid^="task-item-"]').length,
                      identity: document.querySelectorAll('[data-testid="account-menu-avatar"]').length,
                      capture: document.querySelectorAll('input[placeholder^="添加任务"]').length,
                      note: (document.querySelector('[data-testid="shell-host-source"]')||{}).textContent || ''
                    })
                    """);
                var rows = ProbeRows(probe);

                // ── app 模式：验**桌面端的用户旅程**（身份入口 + 头像菜单 IA + 应用壳）──
                //
                // 🔴 **2026-09-30 判据改锚点**（与 macOS 侧 `HeytaMacApp.swift` 逐字相同）：
                //    产品负责人拍板"应该是点击头像出来注册、登录"之后，
                //    `sync-signin-entry` 不再常驻首屏（它在头像菜单里）。
                //    首屏锚点改成**身份入口本身**（`account-menu-avatar`），
                //    登录入口在打开菜单后再验 —— 判据没有放松，反而更严：
                //    未登录时菜单第一项必须是登录/注册，且**不得**出现「退出登录」。
                if (_webMode == "app")
                {
                    if (ProbeField(probe, "identity") > 0 && ProbeField(probe, "capture") > 0)
                    {
                        // ① 点头像（菜单是**点开才渲染**的，所以必须分两步）。
                        await SharedUi.CoreWebView2.ExecuteScriptAsync(
                            """
                            (function(){
                              var a = document.querySelector('[data-testid="account-menu-avatar"]');
                              if (!a) return 'NO_AVATAR';
                              a.click();
                              return 'CLICKED';
                            })()
                            """);
                        // ② 等 React 把菜单渲染出来，再验**身份菜单的 IA**。
                        await Task.Delay(400);
                        var menu = await SharedUi.CoreWebView2.ExecuteScriptAsync(
                            """
                            (function(){
                              var items = document.querySelectorAll('[role="menuitem"]');
                              var first = items.length > 0 ? (items[0].getAttribute('data-testid') || '') : '';
                              return JSON.stringify({
                                first: first,
                                signin: document.querySelectorAll('[data-testid="sync-signin-entry"]').length,
                                settings: document.querySelectorAll('[data-testid="account-menu-settings"]').length,
                                signout: document.querySelectorAll('[data-testid="account-menu-signout"]').length
                              });
                            })()
                            """);
                        var identity = ProbeField(probe, "identity");
                        var capture = ProbeField(probe, "capture");
                        var firstItem = ProbeText(menu, "first");
                        var menuSignin = ProbeField(menu, "signin");
                        var menuSettings = ProbeField(menu, "settings");
                        var menuSignout = ProbeField(menu, "signout");

                        /**
                         * 🔴 **读出页侧实际用上的存储后端**，写进证据（`STORAGE=`）。
                         *
                         * 为什么必须记：`app` 模式到底在用壳的 SQLite 还是 WebView
                         * 自己的 OPFS，**从界面上看不出来** —— 两条路都能让所有断言绿。
                         * 少了这一格，"这次到底用了哪条路"就不可知了
                         * （这正是 `resolveStorageBackend()` 破例允许探测的前提条件）。
                         */
                        _storageBackend = ProbeText(
                            await SharedUi.CoreWebView2.ExecuteScriptAsync(
                                "JSON.stringify({ backend: (globalThis.__heytaStorage||{}).backend || '' })"),
                            "backend");

                        if (menuSignin > 0 && menuSettings > 0 && menuSignout == 0 &&
                            firstItem == "sync-signin-entry")
                        {
                            _m2dVerdict = "OK";
                            SharedUiHostNote =
                                $"M2-D ✅ 身份入口成立（头像 {identity} 个、采集框 {capture} 个）；" +
                                $"**身份菜单合规**（第一项 {firstItem}、登录入口 {menuSignin} 个、" +
                                $"退出登录 {menuSignout} 个）";
                            StatusText.Text = SharedUiHostNote;
                            WriteEvidence(menu);
                            return;
                        }
                        _m2dVerdict = "FAIL";
                        SharedUiHostNote =
                            $"M2-D 🔴 **身份菜单不合规**：未登录时菜单第一项必须是 sync-signin-entry、" +
                            $"必须有设置项、且**不得**有退出登录 —— 实测 {menu}";
                        StatusText.Text = SharedUiHostNote;
                        WriteEvidence(menu);
                        return;
                    }
                    if (attempt == 39)
                    {
                        // 20 秒都没画出来 ⇒ 身份菜单判据**没成立**（不是"没跑"）。
                        // 写成 FAIL 而不是留空：留空在门禁里与"证据文件还没生成"
                        // 长得一样，而这两件事的处置完全不同。
                        _m2dVerdict = "FAIL";
                        SharedUiHostNote = $"M2-D 🔴 真应用没画出来（或没有身份入口/采集框）：{probe}";
                        StatusText.Text = SharedUiHostNote;
                        WriteEvidence(probe);
                    }
                    continue;
                }

                // ① M2-B（**只在 shell 模式**）：把壳自己的真数据推进页面。
                //
                // 🔴 app 模式**不能**走这一条：真应用自带存储与数据层，页面里
                //    没有 `HeytaApp.listTaskEntities` / `window.__heytaSetTasks`
                //    这套契约 —— 推了就是 `M2-A 失败：… is not a function`，
                //    而那行红字会**印在产品的窗口里**（2026-09-30 实测，
                //    见 `dist/windows/packaged-first-run.png`）。
                var pushed = _webMode == "app" ? 0 : await PushTasksAsync();

                if (pushed == 1 && rows > 0)
                {
                    // ② 读方向成立 ⇒ 接着验**写方向**：在共享 UI 里点一下勾选框，
                    //    看**壳自己的库**变没变。
                    //
                    //    🔴 判据取的是 `_api.ListTasks()`（壳读自己的 SQLite），
                    //    **不是**页面里的 DOM 状态 —— DOM 变了只说明共享 UI 重画了，
                    //    那与"数据真的写下去了"是两件事（本仓最忌讳的那种混淆）。
                    var doneBefore = _api?.ListTasks().Count(x => x.Done) ?? -1;

                    await SharedUi.CoreWebView2.ExecuteScriptAsync(
                        """
                        (function(){
                          var el = document.querySelector('[data-testid^="task-toggle-"]');
                          if (!el) return 'no-toggle';
                          el.click();
                          return 'clicked';
                        })()
                        """);

                    // 等宿主收到消息并写完（轮询，别用固定 sleep）。
                    for (var w = 0; w < 20 && WriteHandled == 0; w++)
                    {
                        await Task.Delay(250);
                    }

                    var doneAfter = _api?.ListTasks().Count(x => x.Done) ?? -1;
                    var writeOk = WriteHandled > 0 && doneAfter == doneBefore + 1;

                    SharedUiHostNote = writeOk
                        ? $"M2-C ✅ 读+写都成立：{probe}；写处理 {WriteHandled} 次，库里已完成 {doneBefore}→{doneAfter}"
                        : $"M2-C 🔴 写方向没成立：{probe}；写处理 {WriteHandled} 次，库里已完成 {doneBefore}→{doneAfter}";
                    StatusText.Text = SharedUiHostNote;
                    WriteEvidence(probe);
                    return;
                }
                if (attempt == 39)
                {
                    SharedUiHostNote = $"M2-B：20 秒内没渲染出共享行（pushed={pushed}），最后一次探测={probe}";
                    StatusText.Text = SharedUiHostNote;
                    WriteEvidence(probe);
                }
            }
        }
        catch (Exception error)
        {
            SharedUiHostNote = $"M2-A 失败：{error.Message}";
            StatusText.Text = SharedUiHostNote;
            WriteEvidence($"ERROR {error.Message}");
        }
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs args)
    {
        if (!IsExternalHttpUri(args.Uri)) return;
        args.Cancel = true;
        _ = OpenExternalUriAsync(args.Uri);
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs args)
    {
        if (IsExternalHttpUri(args.Uri))
        {
            args.Handled = true;
            _ = OpenExternalUriAsync(args.Uri);
            return;
        }

        // Keep links back into the packaged app in the current workspace too.
        // Leaving this request unhandled lets WebView2 create a second window,
        // which would split the shell even though the URL is ours.
        if (!IsInternalShellUri(args.Uri)) return;
        args.Handled = true;
        SharedUi.CoreWebView2.Navigate(args.Uri);
    }

    private static bool IsExternalHttpUri(string raw)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri)) return false;
        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        // The packaged app itself is served from this virtual host. It must
        // remain in the WebView while public-site links leave for the browser.
        return !IsInternalShellUri(uri);
    }

    private static bool IsInternalShellUri(string raw)
    {
        return Uri.TryCreate(raw, UriKind.Absolute, out var uri) && IsInternalShellUri(uri);
    }

    private static bool IsInternalShellUri(Uri uri)
    {
        return string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            && string.Equals(uri.Host, "heyta.local", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task OpenExternalUriAsync(string raw)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri)) return;
        try
        {
            await Launcher.LaunchUriAsync(uri);
        }
        catch
        {
            // A failed handoff must not navigate or close the current workspace.
        }
    }

    /// <summary>
    /// 从 `ExecuteScriptAsync` 的返回值里取一个**数值**字段。
    ///
    /// 与 `ProbeRows` 同一个理由（返回值是 JSON 编码过的字符串），
    /// 只是字段名可变 —— 两个模式看的锚点不同。
    /// </summary>
    private static int ProbeField(string raw, string field)
    {
        try
        {
            var json = System.Text.Json.JsonSerializer.Deserialize<string>(raw);
            if (string.IsNullOrEmpty(json)) return 0;
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty(field, out var v) ? v.GetInt32() : 0;
        }
        catch
        {
            return 0;
        }
    }

    /// <summary>已被处理的写操作条数（供证据读取）。</summary>
    private int WriteHandled { get; set; }

    /// <summary>
    /// 把壳的**真数据**推进页面。读方向（初始加载）与写方向（改完之后刷新）共用这一条。
    ///
    /// 🔴 壳**不解析**这段 JSON —— 原样转发（窄视图驱动不了共享 UI，见 `AppApi` 的注释）。
    /// </summary>
    private async Task<int> PushTasksAsync()
    {
        if (_api is null) return 0;
        var entitiesJson = _api.ListTaskEntitiesJson();
        // 要把它当**字符串字面量**注入，所以再序列化一层。
        await SharedUi.CoreWebView2.ExecuteScriptAsync(
            "window.__heytaSetTasks(" + System.Text.Json.JsonSerializer.Serialize(entitiesJson) + ")");
        return 1;
    }

    /// <summary>
    /// 从 `ExecuteScriptAsync` 的返回值里取 `rows`。
    ///
    /// 🔴 **它返回的是 JSON 编码过的字符串**（content 是一段 JSON 文本，
    /// 外层又套了一层 JSON 字符串转义）。所以两步：先反序列化成 string，
    /// 再把它当 JSON 解析。任何一步失败都返回 0（= 还没渲染），
    /// **而不是抛** —— 探测期间的正常状态就是"还没好"。
    /// </summary>
    private static int ProbeRows(string raw)
    {
        try
        {
            var json = System.Text.Json.JsonSerializer.Deserialize<string>(raw);
            if (string.IsNullOrEmpty(json)) return 0;
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("rows", out var rows) ? rows.GetInt32() : 0;
        }
        catch
        {
            return 0;
        }
    }

    /// <summary>M2-A 的宿主结论（供截图/证据读取）。</summary>
    private string SharedUiHostNote { get; set; } = string.Empty;

    /// <summary>
    /// M2-D（身份入口 + 头像菜单 IA）的**机器可读**结论：`OK` / `FAIL` / 空（还没跑）。
    ///
    /// 🔴 为什么单独要一个 ASCII 词：`install-capture.txt` 是 **ASCII** 的
    ///（`Set-Content -Encoding ASCII` —— 中文进去会变成乱码），
    /// 而判据本体是中文说明。所以人读的说明留在证据文件里，
    /// 门禁读的是这一个词（见 `install-and-capture.ps1` 的 `M2D=` 行）。
    /// </summary>
    private string _m2dVerdict = string.Empty;

    /// <summary>
    /// 取一个**字符串**字段（`ProbeField` 只管数值）。
    ///
    /// 身份菜单要读**第一项的 testID**（`sync-signin-entry`）——
    /// 那是个字符串，用 `ProbeField` 读会恒为 0，而症状是"菜单明明对了却说不对"
    /// （与 `ProbeRows` 用 `Contains` 恒假同一个坑，见 `MainWindow.xaml.cs` 上面那段）。
    /// </summary>
    private static string ProbeText(string raw, string field)
    {
        try
        {
            var json = System.Text.Json.JsonSerializer.Deserialize<string>(raw);
            if (string.IsNullOrEmpty(json)) return string.Empty;
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty(field, out var v) ? (v.GetString() ?? string.Empty) : string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    /// <summary>
    /// 把探测结果写一份到磁盘。
    ///
    /// 🔴 与 `HEYTA_SELF_CAPTURE` 同一个模式：**证据必须自述它是怎么来的**，
    /// 所以这里把宿主结论与产物目录一起写下来。
    ///
    /// 🔴 **打包态没有 `HEYTA_M2_EVIDENCE` 可设**（MSIX 是 app 模型启动的，
    /// 打包脚本设的环境变量传不进去），所以回退到
    /// `LocalApplicationData\heyta\m2-evidence.txt`。
    /// ⚠️ **实测修正（2026-09-30）**：`runFullTrust` 的打包应用**没有** UWP 那套
    /// LocalAppData 重定向 —— 文件落在 `C:\Users\<user>\AppData\Local\heyta\`
    /// 本身，而不是 `...\Packages\<PFN>\LocalCache\Local\...`（第一版按后者去读，
    /// 于是"判据明明成立"却一直读到 `M2D=MISSING`）。
    /// `install-and-capture.ps1` 现在**两个候选路径都查**，并且启动前先把它们删掉
    /// （读到上一轮的文件 = 拿旧证据冒充这一轮）。
    /// 不这样接的话，"装上的这个包是不是真应用、身份菜单对不对"在 Windows 端
    /// **永远验不到**（只能验到"窗口开出来了"）。
    /// </summary>
    private void WriteEvidence(string probe)
    {
        string path;
        try
        {
            path = M2EvidencePath();
        }
        catch
        {
            return;
        }
        /**
         * 🔴 **存储宿主模式下壳这边的引擎没打开**（引擎归页侧），所以壳**数不出**库里的条数。
         *
         * 少了这个守卫会出一次很难查的事故（2026-09-30 实测）：
         * `_api.ListTasks()` 在"宿主还没打开"时抛错，而它被下面的 `catch { }` 吞掉 ——
         * 结果是**整个证据文件一个字都不写**，看起来像"探针根本没跑"，
         * 而实际上应用渲染得好好的。**"没有证据"与"探针没跑"长得一模一样**，
         * 正是本仓最忌讳的那种形态。
         */
        var dbDone = _storageHostEnabled ? -1 : (_api?.ListTasks().Count(t => t.Done) ?? -1);
        var dbTotal = _storageHostEnabled ? -1 : (_api?.ListTasks().Count ?? -1);

        try
        {
            File.WriteAllText(path,
                $"WINDOW=heyta{Environment.NewLine}" +
                $"M2D={_m2dVerdict}{Environment.NewLine}" +
                $"M2A_NOTE={SharedUiHostNote}{Environment.NewLine}" +
                $"PROBE={probe}{Environment.NewLine}" +
                $"WEB_ROOT={Environment.GetEnvironmentVariable("HEYTA_WEB_ROOT")}{Environment.NewLine}" +
                $"WEB_MODE={_webMode}{Environment.NewLine}" +
                // 🔴 页侧实际用上的存储后端：`shell` = 数据落在**壳的 SQLite**，
                //    其它 = 落在 WebView 自己的存储里。**界面上看不出来，只此一处说真话。**
                $"STORAGE={_storageBackend}{Environment.NewLine}" +
                // 存储宿主模式下这一格按设计就是 -1（壳没有引擎）—— 不是"读失败"。
                $"STORAGE_HOST={(_storageHostEnabled ? "on" : "off")}{Environment.NewLine}" +
                $"WRITE_HANDLED={WriteHandled}{Environment.NewLine}" +
                $"DB_DONE={dbDone}{Environment.NewLine}" +
                $"DB_TOTAL={dbTotal}{Environment.NewLine}" +
                $"WRITE_NOTE={SharedUiHostNote}{Environment.NewLine}");
        }
        catch (Exception error)
        {
            // 写证据失败不该让应用崩 —— 但它**不许沉默**：留一行到状态栏，
            // 否则"证据没了"与"探针没跑"在下一个人眼里完全一样。
            StatusText.Text = $"写证据失败：{error.Message}";
        }
    }

    /// <summary>证据文件路径：显式环境变量优先，否则包内可写的 LocalApplicationData。</summary>
    private static string M2EvidencePath()
    {
        var configured = Environment.GetEnvironmentVariable("HEYTA_M2_EVIDENCE");
        if (!string.IsNullOrEmpty(configured)) return configured + ".txt";
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "heyta");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "m2-evidence.txt");
    }

    /// <summary>
    /// 初始化。**失败必须显示出来** —— 一个空白窗口是这类壳最难排查的失败形态，
    /// 所以这里把异常原文放进状态栏，而不是吞掉。
    /// </summary>
    private void TryInitialize(bool openHost = true)
    {
        try
        {
            var bundle = Path.Combine(AppContext.BaseDirectory, "native-bridge.js");
            _dataPaths = WindowsDataPaths.Resolve(
                Environment.GetEnvironmentVariable("HEYTA_QA_DATA_DIR"));
            Directory.CreateDirectory(_dataPaths.DataDirectory);
            _dbPath = _dataPaths.DatabasePath;

            _api = new AppApi(bundle, _dbPath);

            /**
             * 🔴 **存储宿主接管时，壳不打开引擎**（`openHost: false`）。
             *
             * `_api.Open()` 会建 `OpLogEngine`；而 `app` 模式里引擎属于**页侧的真应用**。
             * 两个引擎同库会各自为政 —— 向量时钟与 `appliedOpIds` 漂移，
             * 冲突判定随即失真（本仓反复记过同一件事）。
             *
             * 壳在那种模式下只做两件事：把库打开给页侧用（`openOpLog`，由页侧
             * 第一条消息触发）、以及转发消息。所以这里既不 `Open()` 也不 `Refresh()`。
             */
            if (!openHost)
            {
                FooterText.Text = $"库：{_dbPath}　（存储宿主模式：引擎归页侧）";
                StatusText.Text = string.Empty;
                return;
            }

            var clientId = _api.Open(_dbPath);

            FooterText.Text = $"库：{_dbPath}　设备：{clientId}";
            StatusText.Text = string.Empty;
            Refresh();
        }
        catch (Exception error)
        {
            StatusText.Text = $"初始化失败：{error.Message}";
            AddButton.IsEnabled = false;
            NewTaskTitle.IsEnabled = false;
        }
    }

    private void Refresh()
    {
        if (_api is null) return;
        try
        {
            _tasks.Clear();
            foreach (var view in _api.ListTasks())
            {
                _tasks.Add(TaskItem.From(view));
            }
            StatusText.Text = _tasks.Count == 0 ? "还没有任务。上面写一条试试。" : string.Empty;
        }
        catch (Exception error)
        {
            StatusText.Text = $"读取失败：{error.Message}";
        }
    }

    private void AddCurrentTask()
    {
        if (_api is null) return;
        var title = NewTaskTitle.Text;
        if (string.IsNullOrWhiteSpace(title)) return;   // 交互决策：空回车什么都不做
        try
        {
            _api.AddTask(title);
            NewTaskTitle.Text = string.Empty;
            Refresh();
        }
        catch (Exception error)
        {
            StatusText.Text = $"添加失败：{error.Message}";
        }
    }

    private void OnToggleDone(object sender, RoutedEventArgs e)
    {
        if (_api is null || sender is not CheckBox box || box.Tag is not string id) return;
        try
        {
            _api.SetTaskDone(id, box.IsChecked == true);
            Refresh();
        }
        catch (Exception error)
        {
            StatusText.Text = $"更新失败：{error.Message}";
            Refresh();
        }
    }

    private void OnDelete(object sender, RoutedEventArgs e)
    {
        if (_api is null || sender is not Button button || button.Tag is not string id) return;
        try
        {
            _api.RemoveTask(id);
            Refresh();
        }
        catch (Exception error)
        {
            StatusText.Text = $"删除失败：{error.Message}";
        }
    }
}
