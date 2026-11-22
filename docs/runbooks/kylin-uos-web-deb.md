# 麒麟 / 统信 UOS 可安装包（Web UI 版）

> 状态：**免费链路已打通（2026-11-22）**。本包已在模拟环境实装验证；真实商业版 / UOS 专业版镜像与商店认证不在本文件范围。

## 结论

- 产物：`heyta-web_0.1.0+20261122_all.deb`（`Architecture: all`，`Depends: python3, xdg-utils`）。
- 在两类目标环境 `dpkg -i` 均返回 `install ok installed`：
  - **debian:10 + UOS20（deepin `apricot`）仓库**，glibc 2.28 —— 统信侧代理；
  - **ubuntu:20.04**，glibc 2.31 —— 银河麒麟 V10 代理。
- 装后本地静态服务返回 heyta 首页（`HTTP 200` / `<title>heyta`）。
- 形态说明：这是 **Web UI 打包形态**（本地静态服务 + 默认浏览器打开），**不依赖 GTK4 / WebKitGTK 6.0**；原生 GTK 窗口版见「下一步」。

## 为什么先做 Web UI 包

目标系统缺少现有原生壳所需的 GTK4 + WebKitGTK 6.0（实测仓库元数据，取数 2026-11-22）：

| 系统 | glibc | GTK3 | GTK4 | webkit2gtk-4.0 | webkitgtk-6.0 |
|---|---|---|---|---|---|
| deepin `apricot`（≈ UOS20） | 2.28.19 | 3.24.5 | 无 | 有 | 无 |
| openKylin `huanghe`（2.0） | 2.43 | 3.24.52 | 4.22.2 | 有（2.28） | 无 |
| openKylin `nile`（3.0） | 2.38 | 3.24 | main 未带 | 有（4.1 2.44） | 有（2.44） |

`apps/desktop-linux` 需要 GTK4 + WebKitGTK 6.0，在 UOS20（无 GTK4）上无法运行。所以「至少装上」的最短路径是：把 `apps/web` 的静态产物打成**跨架构 `all` 包**，用本地静态服务 + 系统浏览器提供界面。该包不依赖任何 GTK/WebKit，天然可在只带 GTK3 的桌面上装。

## 安装布局（FHS）

```
/opt/apps/heyta-web/web-dist/**                                  共享 UI 静态产物
/usr/bin/heyta-web                                               启动器：起本地静态服务 + xdg-open
/usr/share/applications/heyta-web.desktop                        桌面入口
/usr/share/icons/hicolor/512x512/apps/heyta-web.png              图标
```

启动器监听 `127.0.0.1:27189`（已起则不重复），随后 `xdg-open` 默认浏览器打开。

## 构建（可复跑）

在仓库根，`apps/web/dist` 已存在时：

```bash
# 1) 组装包树
D=/tmp/heyta-web-deb
rm -rf "$D"; mkdir -p "$D/DEBIAN" "$D/opt/apps/heyta-web" "$D/usr/bin" \
  "$D/usr/share/applications" "$D/usr/share/icons/hicolor/512x512/apps"
cp -R apps/web/dist "$D/opt/apps/heyta-web/web-dist"
cp apps/web/dist/icons/icon-512.png "$D/usr/share/icons/hicolor/512x512/apps/heyta-web.png"
# control / heyta-web 启动器 / heyta-web.desktop 见本目录同名片段（见下“片段”）

# 2) 打包：🔴 必须 -Zxz —— Ubuntu 24.04 的 dpkg 默认 zstd，Debian 10（UOS20 底座）读不了
dpkg-deb --build -Zxz "$D" heyta-web_0.1.0+20261122_all.deb
```

> 构建机需有 `dpkg-deb`（Ubuntu 自带）。包内不得含 macOS 的 AppleDouble `._*` 文件（打包前 `find "$D" -name '._*' -delete`）。

**片段**

`DEBIAN/control`
```
Package: heyta-web
Version: 0.1.0+20261122
Section: utils
Priority: optional
Architecture: all
Depends: python3, xdg-utils
Maintainer: heyta <dev@heyta.local>
Description: heyta 任务/习惯管理（麒麟/统信 Linux 桌面版，Web UI）
 此包把 heyta 的 Web 界面装到本机，通过本地静态服务 + 默认浏览器打开。
```

`usr/bin/heyta-web`
```bash
#!/bin/bash
set -e
PORT=27189
DIR=/opt/apps/heyta-web/web-dist
if ! (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR" >/dev/null 2>&1 &
  sleep 1
fi
URL="http://127.0.0.1:$PORT/"
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
else echo "请用浏览器打开：$URL"; fi
```

`usr/share/applications/heyta-web.desktop`
```
[Desktop Entry]
Type=Application
Name=heyta
Name[zh_CN]=heyta 任务
Comment=本地优先的任务/习惯管理
Exec=/usr/bin/heyta-web
Icon=heyta-web
Terminal=false
Categories=Office;Utility;
```

## 验证（可复跑）

在 linux-dev（Ubuntu 24.04）上，用国内镜像拉官方基础镜像做真机式验证：

```bash
# 统信侧（UOS20 底座 + 真实 UOS20 仓库）
sudo docker run --rm -v "$PWD":/mnt docker.m.daocloud.io/library/debian:10 bash -c '
  export DEBIAN_FRONTEND=noninteractive
  printf "deb [trusted=yes] http://mirrors.aliyun.com/deepin apricot main\n" > /etc/apt/sources.list
  apt-get -o Acquire::Check-Valid-Until=false update -q
  apt-get install -y -q --no-install-recommends python3 xdg-utils
  dpkg -i /mnt/heyta-web_0.1.0+20261122_all.deb
  dpkg -s heyta-web | grep Status
'

# 麒麟侧代理（ubuntu:20.04）
sudo docker run --rm -v "$PWD":/mnt docker.m.daocloud.io/library/ubuntu:20.04 bash -c '
  export DEBIAN_FRONTEND=noninteractive
  sed -i "s|archive.ubuntu.com|mirrors.aliyun.com|g; s|security.ubuntu.com|mirrors.aliyun.com|g" /etc/apt/sources.list
  apt-get update -q && apt-get install -y -q python3 xdg-utils
  dpkg -i /mnt/heyta-web_0.1.0+20261122_all.deb
  dpkg -s heyta-web | grep Status
'
```

功能验证（装后起服务取首页）：`python3 -m http.server 27189 --bind 127.0.0.1 --directory /opt/apps/heyta-web/web-dist &`，再请求 `http://127.0.0.1:27189/`，应得到 `HTTP 200` 且页面含 heyta。

## 已知边界与下一步

- 本包是 **Web UI 形态**，不是原生 GTK 窗口。
- 未在**真实银河麒麟商业版 / UOS 专业版**实机验证（需试用申请 / 采购）。
- 未覆盖 **arm64 / loongarch** 实机（`Architecture: all` 理论可装，未实测；只有原生二进制才涉及架构）。
- 下一步：**原生 GTK3 + webkit2gtk-4.0 窗口壳**（两款目标都带 GTK3 + webkit2gtk-4.0，是能统一覆盖新旧信创系统的原生栈）；用 openKylin ISO 起桌面做窗口截图；商业版/专业版的商店兼容性认证。
