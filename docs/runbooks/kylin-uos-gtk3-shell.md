# 麒麟 / 统信 UOS 原生 GTK3 窗口壳（heyta-gtk3）

> 状态：**A 段已打通（2026-11-22）**：编译、打包、在 deepin20（glibc 2.28，UOS20 同源）环境 `install ok installed`，无头 Xvfb 下 WebView 成功加载 heyta。

## 结论

- 源码：`apps/desktop-linux-gtk3/`（GTK3 + WebKit2GTK-4.0，最小原生窗口壳）。
- 产物：`heyta-gtk3_0.1.0+20261122_amd64.deb`（`Depends: libgtk-3-0, libwebkit2gtk-4.0-37, python3`）。
- 在真实 deepin 20.8 镜像（glibc 2.28.21）里编译成功，`ldd` 链到 `libwebkit2gtk-4.0.so.37` / `libgtk-3.so.0`。
- `dpkg -i` → `Status: install ok installed`。
- 无头 Xvfb 启动 → `HEYTA_WEBVIEW_READY title=heyta`（WebView 已加载 heyta 界面）。

## 为什么是 GTK3 + WebKit2GTK-4.0

`apps/desktop-linux` 是 GTK4 + WebKitGTK 6.0，UOS20（无 GTK4）跑不了。deepin `apricot`(≈UOS20)、openKylin 各版本都带 **GTK3 + webkit2gtk-4.0**，所以原生栈统一落到这一档，能同时覆盖新旧信创系统。

## 形态

原生 GTK3 窗口 + 系统 WebKitGTK 4.0 渲染 `apps/web` 共享 UI。窗口内由本进程 fork `python3 -m http.server` 提供本地静态源（WebKit 需要 http 源；`file://` 下 SPA/模块会因同源策略失败）。数据存于 WebView 本地存储。

> 与 `apps/desktop-linux`（GTK4 全量壳含原生 SQLite 桥）不同：本壳不含原生数据桥，界面数据走 WebView 本地存储。作为「原生窗口可用」的第一步；接入原生 SQLite 桥是后续增强。

## 构建（可复跑）

需要一个 **glibc ≤ 2.28 的 GTK3 环境**（产物才能落到 UOS20）。实测用 deepin 20 镜像（`docker.1panel.live/linuxdeepin/apricot`，glibc 2.28.21）：

```bash
# 在 deepin20 容器内
printf 'deb [trusted=yes] http://mirrors.aliyun.com/deepin apricot main\n' > /etc/apt/sources.list
apt-get -o Acquire::Check-Valid-Until=false update -q
apt-get install -y --allow-unauthenticated --no-install-recommends \
  build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.0-dev
cd <repo>/apps/desktop-linux-gtk3 && make         # 产出 heyta-linux-gtk3
ldd heyta-linux-gtk3 | grep -E 'gtk-3|webkit2gtk'  # 确认链到 4.0 / gtk-3
```

## 打包（可复跑）

在装有 `dpkg-deb` 的机器上组包：

```
/opt/apps/heyta-web/web-dist/**                共享 UI（与 heyta-web 包同一份）
/usr/bin/heyta-gtk3                            原生二进制
/usr/share/applications/heyta-gtk3.desktop     桌面入口（Exec=/usr/bin/heyta-gtk3）
/usr/share/icons/hicolor/512x512/apps/heyta-gtk3.png
```

`control`：
```
Package: heyta-gtk3
Version: 0.1.0+20261122
Architecture: amd64
Depends: libgtk-3-0, libwebkit2gtk-4.0-37, python3
Section: utils
Priority: optional
Maintainer: heyta <dev@heyta.local>
Description: heyta 任务/习惯管理（麒麟/统信 Linux 原生 GTK3 窗口版）
```

打包：`dpkg-deb --build -Zxz <dir> heyta-gtk3_0.1.0+20261122_amd64.deb`（`-Zxz` 让 Debian 10 系可解）。

## 验证（可复跑）

```bash
# 安装
dpkg -i heyta-gtk3_0.1.0+20261122_amd64.deb
dpkg -s heyta-gtk3 | grep Status          # -> install ok installed

# 无头启动（需 xvfb + xauth）
mkdir -p /tmp/xdg && chmod 700 /tmp/xdg
XDG_RUNTIME_DIR=/tmp/xdg WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
  HEYTA_WEB_DIST=/opt/apps/heyta-web/web-dist HEYTA_EXIT_AFTER_MS=15000 \
  xvfb-run -a /usr/bin/heyta-gtk3
# 预期 stdout 出现：HEYTA_WEBVIEW_READY title=heyta
```

环境变量：`HEYTA_WEB_DIST`（默认 `/opt/apps/heyta-web/web-dist`）、`HEYTA_PORT`（默认 27190）、`HEYTA_EXIT_AFTER_MS`（无头自动退出）。

## 已知边界

- 只构建/验证了 **amd64**；arm64 / loongarch 需各自架构的 GTK3 工具链重编。
- **不含原生 SQLite 数据桥**，数据在 WebView 本地存储；需要与 `apps/desktop-linux` 同等的数据桥时要再接 native-bridge。
- 真实银河麒麟商业版 / UOS 专业版实机、应用商店兼容性认证仍未做。

## 实测结果（2026-11-22）

在 deepin 20.8 镜像（glibc 2.28，webkit2gtk-4.0 2.38.5）里实测：

- `make` 通过，`ldd` 链 `libwebkit2gtk-4.0.so.37` / `libgtk-3.so.0`。
- `dpkg -i` → `Status: install ok installed`。
- 无头 Xvfb 启动 → `HEYTA_WEBVIEW_READY title=heyta`，窗口截图为 heyta 界面；但界面显示 **"Could not initialize local storage"**。

原因：heyta 的 Web 版数据层用 **OPFS + SQLite(SAH)**（`navigator.storage.getDirectory` + Worker 里 `createSyncAccessHandle`）。WebKitGTK 2.38 在无桌面会话的容器环境里 OPFS-SAH 不可用 ⇒ 存储初始化失败。显式设置持久化 `WebKitWebsiteDataManager`、关闭沙箱均未解决。

去向：
- 本壳的「原生窗口 + 加载 heyta」成立；**要数据可用**，原生壳必须提供 `window.__heytaHostStoragePort`（原生 SQLite 桥，见 `apps/desktop-linux` 的 `heyta_host.c` / `heyta_driver.c` / `native-bridge.js`），或运行在支持 OPFS-SAH 的 WebKit 上。
- 纯浏览器路径（`heyta-web` deb + 系统 Chromium）不受此限：Chromium 支持 OPFS-SAH，是当前“装上即可用”的稳妥形态。
