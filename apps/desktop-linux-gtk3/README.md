# heyta Linux 原生窗口壳（GTK3 + WebKit2GTK-4.0 + 原生 SQLite 数据桥）

在只带 GTK3 / WebKit2GTK-4.0 的国产信创 Linux（统信 UOS 20 / Debian 10 系、银河麒麟等）上，
用系统 WebKit 渲染 `apps/web` 的共享 UI，并提供**原生窗口**与**原生 SQLite 数据桥**（数据落本地库，
不依赖 WebView 的 OPFS）。

## 结构

- `src/main.c`：GTK3 窗口 + WebKit2GTK-4.0 视图 + 数据桥 + 本地静态服务（`python3 -m http.server`）。
- `Makefile`：复用 `../desktop-linux/src` 的引擎层（`heyta_host/heyta_driver/heyta_api/heyta_notify`，
  JavaScriptCore + SQLite 驱动 + native-bridge 门面），只替换 GTK/WebKit 层（GTK4/webkitgtk-6.0 → GTK3/webkit2gtk-4.0）。

## 数据桥（页 ↔ 原生）

1. 本壳在文档开始注入 `window.__heytaHostStoragePort`（`postMessage` 转发到 `window.webkit.messageHandlers.heytaStorage`）。
2. WebView 收到存储消息 → C 侧**首次**收到时懒初始化 `HeytaApi`（JSC + `native-bridge.js` + 原生 SQLite 驱动），
   打开 store（`~/.local/share/heyta/heyta.sqlite`），交给 `heyta_api_handle_host_message`。
3. 原生侧把响应批用 `window.postMessage` 回推页侧。

惰性初始化的必要性：启动阶段只保留 WebKit 初始化；把 `JSGlobalContext` 放到首封存储消息时创建，
避免与 WebKit 的 web 进程初始化抢占导致页面不触发 `load`。

## 构建

```sh
sudo apt-get install -y build-essential pkg-config libgtk-3-dev \
    libwebkit2gtk-4.0-dev libjavascriptcoregtk-4.0-dev libsqlite3-dev
# 生成 native-bridge.js（产物在 packages/app-host/bridge-bundle/native-bridge.js）
node ../../packages/app-host/scripts/build-native-bridge.mjs
make        # 产出 heyta-linux-gtk3
```

## 运行期环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `HEYTA_WEB_DIST` | `/opt/apps/heyta/web-dist` | 共享 UI 目录 |
| `HEYTA_BRIDGE_BUNDLE` | `<exe 目录>/native-bridge.js` | 门面 bundle |
| `HEYTA_DB` | `$HOME/.local/share/heyta/heyta.sqlite` | 原生数据库 |
| `HEYTA_PORT` | `27190` | 本地静态服务端口 |
| `HEYTA_EXIT_AFTER_MS` | 0 | 非零则到点退出（无头验证） |

## 验收判据

- 无头：`HEYTA_WEBVIEW_READY title=heyta` 表示 WebView 已加载 heyta。
- 数据：`STORAGE_HOST=on STORE_CLIENT_ID=<id>` + 本地 sqlite 出现表
  `ops / ops__mt3 / state / meta / archive / __heyta_seq` 表示数据桥已落库。

## 依赖版本下限

页面是面向现代浏览器的 ES bundle；WebKitGTK 需 **≥ 2.38** 才能执行。版本过旧的 WebKit（如 2.28）
下，原生窗口可安装并打开，但页面脚本不执行。公开系统更新或改用较新的浏览器内核可解决。
