# 麒麟 / 统信 UOS 原生 GTK3 窗口壳（heyta-gtk3）

> 状态：**已交付 0.2.0**（2026-11-23）。GTK3 + WebKit2GTK-4.0 原生窗口 + **原生 SQLite 数据桥**；
> 在 deepin20（UOS20 同源，webkit2gtk-4.0 2.38）`install ok installed`，界面完整渲染、数据落本地 sqlite。

## 结论

- 源码：`apps/desktop-linux-gtk3/`（见其 `README.md`）。
- 产物：`heyta-gtk3_0.2.0+20261123_amd64.deb`（`Depends: libgtk-3-0, libwebkit2gtk-4.0-37, libjavascriptcoregtk-4.0-18, libsqlite3-0, python3`）。
- 数据桥复用 `apps/desktop-linux` 的 `heyta_host/heyta_driver/heyta_api/heyta_notify` + `packages/app-host` 的 `native-bridge.js`，页面走 **sqlite 后端**（`~/.local/share/heyta/heyta.sqlite`），不依赖 WebView 的 OPFS。

## 为什么是 GTK3 + WebKit2GTK-4.0

`apps/desktop-linux` 是 GTK4 + WebKitGTK 6.0，UOS20（无 GTK4）跑不了。deepin `apricot`(≈UOS20)、openKylin 都带 **GTK3 + webkit2gtk-4.0**，原生栈统一落到这一档。

## 形态

原生 GTK3 窗口 + 系统 WebKitGTK 4.0 渲染 `apps/web` 共享 UI；本地静态源由本进程 fork `python3 -m http.server` 提供（http 同源，避免自定义 scheme 的 CORS 差异）。

## 数据桥

1. 文档开始注入 `window.__heytaHostStoragePort` → `window.webkit.messageHandlers.heytaStorage`。
2. 首封存储消息时**懒初始化** `HeytaApi`（JSC + `native-bridge.js` + 原生 SQLite 驱动）并开 store。
3. 响应批用 `window.postMessage` 回推页侧。

> 惰性初始化：启动阶段只初始化 WebKit；`JSGlobalContext` 延后到首封消息再建，避免与 WebKit web 进程初始化抢占。

## 构建（可复跑）

在 glibc ≤ 2.28 的 GTK3 环境（deepin 20 镜像 `docker.1panel.live/linuxdeepin/apricot`，glibc 2.28.21）内：

```bash
printf 'deb [trusted=yes] http://mirrors.aliyun.com/deepin apricot main\n' > /etc/apt/sources.list
apt-get -o Acquire::Check-Valid-Until=false update -q
apt-get install -y --allow-unauthenticated --no-install-recommends \
  build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.0-dev \
  libjavascriptcoregtk-4.0-dev libsqlite3-dev
cd <repo>/apps/desktop-linux-gtk3 && make      # 产出 heyta-linux-gtk3
ldd heyta-linux-gtk3 | grep -E 'gtk-3|webkit2gtk|javascriptcore|sqlite'
```

## 打包布局（可复跑）

```
/opt/apps/heyta/heyta-linux-gtk3                 原生二进制
/opt/apps/heyta/native-bridge.js                 门面 bundle（packages/app-host/bridge-bundle/）
/opt/apps/heyta/web-dist/**                       共享 UI
/usr/bin/heyta-gtk3                               wrapper：export HEYTA_WEB_DIST=/opt/apps/heyta/web-dist; exec /opt/apps/heyta/heyta-linux-gtk3
/usr/share/applications/heyta-gtk3.desktop
/usr/share/icons/hicolor/512x512/apps/heyta-gtk3.png
/usr/share/metainfo/heyta-gtk3.metainfo.xml
```

`control`：
```
Package: heyta-gtk3
Version: 0.2.0+20261123
Architecture: amd64
Depends: libgtk-3-0, libwebkit2gtk-4.0-37, libjavascriptcoregtk-4.0-18, libsqlite3-0, python3
Section: utils
Priority: optional
Maintainer: heyta <dev@heyta.local>
Description: heyta 任务/习惯管理（麒麟/统信 Linux 原生 GTK3 窗口版）
```

打包：`dpkg-deb --build -Zxz <dir> heyta-gtk3_0.2.0+20261123_amd64.deb`（`-Zxz` 让 Debian 10 系可解）。

## 验证（可复跑）

```bash
dpkg -i heyta-gtk3_0.2.0+20261123_amd64.deb
dpkg -s heyta-gtk3 | grep Status           # -> install ok installed
mkdir -p /tmp/xdg && chmod 700 /tmp/xdg
Xvfb :99 -screen 0 1280x800x24 & sleep 2
XDG_RUNTIME_DIR=/tmp/xdg DISPLAY=:99 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 /usr/bin/heyta-gtk3
# 预期：HEYTA_WEBVIEW_READY title=heyta；STORAGE_HOST=on STORE_CLIENT_ID=…
# 本地 sqlite 出现表：ops / ops__mt3 / state / meta / archive / __heyta_seq
```

## 实测矩阵（2026-11-23）

| 环境 | WebKit 版本 | 安装 | 打开窗口/加载 | 数据落库 |
|---|---|---|---|---|
| deepin 20.8（UOS20 同源, amd64） | 2.38.5 | `install ok installed` | `HEYTA_WEBVIEW_READY`，界面完整渲染 | ✅ `STORAGE_HOST=on`，sqlite 建表 |
| Debian 10 arm64（qemu-user, glibc2.28） | 2.38.6 | `install ok installed` | `HEYTA_WEBVIEW_READY`，界面完整渲染 | ✅ `STORAGE_HOST=on`，sqlite 建表 |
| openKylin 3.0(huanghe) 容器 | 2.28.1 | `install ok installed` | `HEYTA_WEBVIEW_READY`，窗口打开 | ⚠️ 页面脚本不执行（见下） |

## 依赖版本下限

页面是面向现代浏览器的 ES bundle；**WebKitGTK 需 ≥ 2.38** 才能执行。2.28 下原生窗口可安装并打开，
但页面脚本不执行、`#root` 为空。解决：更新系统 WebKit，或使用较新内核的浏览器（`heyta-web` deb + Chromium）。

## arm64 构建（qemu-user 交叉，可复跑）

arm64 在 x86 宿主用 qemu-user(binfmt) + Debian 10 arm64（glibc 2.28，与 UOS/麒麟 arm64 对齐；其 webkit2gtk-4.0 为 2.38.6）：

```bash
sudo apt-get install -y qemu-user-static binfmt-support
docker run -d --name arm64build --platform linux/arm64 -v "$PWD":/mnt docker.m.daocloud.io/library/debian:10 sleep infinity
docker exec arm64build bash -lc 'printf "deb [trusted=yes] http://archive.debian.org/debian buster main\ndeb [trusted=yes] http://archive.debian.org/debian-security buster/updates main\n" > /etc/apt/sources.list; apt-get -o Acquire::Check-Valid-Until=false update -q; apt-get install -y --allow-unauthenticated --no-install-recommends build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.0-dev libjavascriptcoregtk-4.0-dev libsqlite3-dev'
docker exec arm64build bash -lc 'cp -a /mnt/apps /tmp/ab && cd /tmp/ab/desktop-linux-gtk3 && make clean && make'
```

打包同布局，`control` 的 `Architecture: arm64`，产出 `heyta-gtk3_0.2.0+20261123_arm64.deb`。

## 已知边界

- 已构建/验证 **amd64** 与 **arm64**（qemu-user 下 arm64 实测界面 + 落库）；**loongarch** 需 loongarch 工具链/rootfs，未做。
- 真实银河麒麟商业版 / UOS 专业版实机、应用商店兼容性认证未做（商用版范畴）。
