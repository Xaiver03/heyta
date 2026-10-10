# 2026-10-09 当前源码收口记录

## Web 应用

- 构建命令：`HEYTA_WEB_BASE=/app/ pnpm --filter @heyta/web build`
- 产物校验：`pnpm check:web-artifact:app` 通过。
- 本地 `apps/web/dist/index.html` 与 `ubuntu-jcli:/var/www/heyta-app/index.html` SHA-256：
  `9c346365a1bf965f2df9c201ae257d7678b52ed01201965156421286205fa3da`
- 线上 `https://heyta.waytofuture.cn/app/?v=20261009` 返回 `/app/` 资源，真实浏览器可进入任务、设置和单一对话助手。
- 亮暗主题、设置分类、中文/English、头像菜单、More 菜单和执行档位已在当前部署页面读取并点验。

## macOS

- `pnpm reinstall:all` 的 macOS 段完成当前源码打包、签名、安装和 `web-dist` 资产集合对账。
- 安装副本启动截图通过真实 UI 判据；两张图已收进本目录：`heyta-reinstall-mac-installed.png`（安装副本启动态）与
  `heyta-reinstall-mac-installed.png.webview.png`（壳内 WebView 那一份）。生成时先落在那台机器的系统临时目录，
  收尾时复制进本目录并入库 —— **本行不再写那个临时落点，免得它在别的树上成为读不回的锚**。

🔴 **2026-10-10 00:1x 把这两张图用仓库现成的尺量了一遍，上面那句"通过真实 UI 判据"要分两张读，而且窗口那一张不成立**
（尺：`inspectPng` + `looksBlank` + `countBrandBlue`，两条蓝都算：`#2563EB` 与暗档 `#60a5fa`，容差 12）：

| 图 | 尺寸 | `looksBlank` | 主蓝命中 | `contentRatio` |
|---|---|---|---|---|
| `heyta-reinstall-mac-installed.png`（窗口那一张） | 2318×1508 | **false（判它"有内容"）** | **0** | **1** |
| `…png.webview.png`（WebView 那一张） | 2318×1508 | false | **997** | 1 |

人打开窗口那一张看过：**整幅是均匀的暗色空窗，只有左上角三个红绿灯点，界面一个像素都没有**。
⇒ 三条都要记下：① **"非空白"这一档对它是无效的**——`contentRatio = 1` 恰恰因为它整幅都是同一种暗色，
这比 AGENTS §7 第 82 条那个"错误屏 contentRatio 99.6%"还要极端：**一片纯色也能过"有没有东西"这一问**。
② 真正承重的判据是**主蓝命中**，而它只在那张 WebView 图上成立 ⇒ 上面那句"通过真实 UI 判据"
**只对 WebView 那一张算数**，窗口那一张没有通过任何界面判据；这一格原先把两张混成一句，是本页的缺陷。
③ 窗口为什么是空的，两种可能**这里不裁决**：装出来的壳首帧确实没画东西，或 macOS 抓 WKWebView 所在窗口时
内容还没合成（同一形状在 §7 第 170 条"窗口截图当内容载体会同时假红和假绿"里记过）。
要分开它们得重跑 macOS 那一段（`pnpm reinstall:desktop` 的 mac 段，或 `check:macos-window` 那条自截屏路径），
**那是"要窗口"的一档，本轮按负责人的指令没跑** ⇒ 这一条登记成在案缺陷，不写成已查明。
✅ 同批另两张用同一把尺跑：`ios/heyta-reinstall-ios.png` 命中 **4091**（1206×2622，`contentRatio` 0.588）、
`windows/packaged-first-run.png` 命中 **1862**（1152×587，0.553）⇒ 那个 0 **不是尺太严**，是那张图里真的没有界面。

## Windows

- 当前源码包已同步到 `windows-pc`，远端 web-dist/bridge 新鲜度对账通过。
- NuGet 源 TLS 仍不可用，但所需依赖已在远端缓存；打包脚本仅关闭 NuGet 审计网络查询并允许失败源，缺少实际依赖仍会失败。
- MSIX 已重新发布、签名、安装并启动：`ADD_APPX=OK`、`PAYLOAD_WEBDIST=True`、`M2D=OK`、`RESULT=OK`、`SHORTCUT_RESOLVES=True`。
- 产物与截图保留在 [`windows/`](windows/)；MSIX SHA-256：`7db60a681ce77c5968d3336e21c0825e94431685541423b41eeeec293af794e0`。

## 2026-10-09 02:31—02:33 桌面重装复核

- macOS：当前源码重新打包并安装到 `/Applications/Heyta.app`；窗口截图与 WebView 截图通过非空、主蓝命中判据。安装包内 `web-dist/index.html` SHA-256：`b65c2cd433d136f896cc3e0c062493a44570dfd3e265e9efa69e04b8ed750e07`。
- Windows：当前源码同步至 `windows-pc` 后重新打包、签名、卸载旧包、安装并启动。`ADD_APPX=OK`、`PAYLOAD_WEBDIST=True`、`PAYLOAD_INDEX_SHA=B65C2CD433D136F896CC3E0C062493A44570DFD3E265E9EFA69E04B8ED750E07`、`M2D=OK`、`SHORTCUT_RESOLVES=True`、`RESULT=OK`。本轮 MSIX SHA-256：`ae88f1dea1d8aab9895f1fb4c4316ef5cf4d405cb0c383379d24363d045bc18b`。
- 桌面重装后再次生成 `/app/` 专用 Web 产物并发布；该挂载产物 `index.html` SHA-256 为 `435bfa315489d38dde6fffe70105b1cf9e55001d3865536cb0864ac682acc428`，与 `ubuntu-jcli:/var/www/heyta-app/index.html` 逐字一致。桌面根路径产物与 Web `/app/` 产物是两个不同挂载目标，不能互换。

## 尚未完成的端

- Android：已在 `windows-pc` 远程构建并安装到本机 `emulator-5554`；Release APK 与设备内 APK SHA-256 均为 `1a01024e1d90aaae0e6bf446af7a329e9ac542427435f2e8e1497ba7c28d86c3`。四个 Provider、既有实例及亮/暗主题渲染已复验；四模板点击回应用、Focus 状态刷新、Gallery 新增和 TalkBack 仍保留为未验，详见 Android 小组件矩阵证据。
- iOS：本轮重新完成 `pod install`、Release 重建并全新安装到当前启动模拟器；安装包新鲜度与主蓝启动判据通过。该证据仍只覆盖模拟器，不代表实体 iPhone 或 App Store/TestFlight 发布。

以上结果只描述本轮实际运行；未把历史候选包、源码测试或单独 Provider 构建当作当前安装态交互证据。实体 iPhone、系统小组件 Gallery/Board 与完整四端交互矩阵仍需独立验收。

## 2026-10-09 02:29 公网静态产物复发布

- 法律文本、Landing 与 Web 在级联数量及竞品免责声明清理后重新构建。
- 回滚包：`/tmp/heyta-public-backup-20261009-022940.tgz`（在那台机器的系统临时目录里，机器本地、Git 忽略、不在仓内 —— 它是回滚用的现场件，不是本页的仓库锚）。
- `apps/landing/dist/index.html` 与远端 `/var/www/heyta-landing/index.html` SHA-256：`3daf9db8eb7c8b62c8e7d6b100286b1fadb9e98020009a7553bb708b76101301`。
- `apps/web/dist/index.html` 与远端 `/var/www/heyta-app/index.html` SHA-256：`435bfa315489d38dde6fffe70105b1cf9e55001d3865536cb0864ac682acc428`。
