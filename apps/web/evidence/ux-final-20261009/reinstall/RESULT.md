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
