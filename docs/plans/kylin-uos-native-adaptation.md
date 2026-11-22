# 麒麟 / 统信 UOS 原生壳适配专项方案

> 状态：**规划中**
> 立单：2026-11-22。目标系统事实与本仓库现状的取数时间均为 2026-11-22。
> 适用范围：heyta 原生 Linux 壳（`apps/desktop-linux`）在中国信创桌面系统（银河麒麟、统信 UOS）上的可用性。

---

## 结论（先看这里）

1. 现行原生 Linux 壳依赖 **GTK4 + WebKitGTK 6.0 + JavaScriptCore 4.1 + SQLite3**（`apps/desktop-linux/Makefile` 的 `PKGS`）。两个主流信创版本只带 **GTK 2/3、glibc 2.28–2.31，缺 GTK4 与 WebKitGTK 6.0**（取数 2026-11-22，出处见 §二）。壳在目标系统上不能直接构建，也不能直接运行。
2. 建议顺序：**先走路线 ①（Web / 自托管）**，不改代码、今天可用；**②（原生壳适配）与 ③（Flatpak / AppImage）** 作为后续专项，按 §六 的 M0–M4 推进。
3. 目标系统具体版本、CPU 架构集合、是否接受回填/降级依赖等尚未确定，见 §七「待确认项」。

---

## 一、目标与背景

**目标**：让 heyta 能在中国信创桌面系统（银河麒麟、统信 UOS）上可用。

两个系统的定义（取数 2026-11-22）：

| 系统 | 出品方 | 底座与桌面 |
|---|---|---|
| 银河麒麟 Kylin OS | 麒麟软件（中国电子 CEC） | 桌面版 V10 为 Debian/Ubuntu 系 + UKUI 桌面；高级服务器版 V10 为 RHEL/CentOS 系 |
| 统信 UOS | 统信软件 | Debian 系，有桌面版 / 服务器版；UOS 20 基于 Debian 10 |

两者都是信创主力，常见跑在飞腾 / 鲲鹏（ARM64）、龙芯（LoongArch）、兆芯 / 海光（x86）上。

---

## 二、目标系统事实（带出处）

| 系统 / 版本 | 关键组件实测版本 | 出处 |
|---|---|---|
| 银河麒麟桌面 V10 SP1 2403 | glibc 2.31 / 2.28（龙芯 3A5000）；GTK 2.24 / 3.24；**无 GTK4** | 官方发布说明核心组件表：<https://www.kylinos.cn/upload/product/20240703/3c23ce555ba7573852b21cdbc09c364b.pdf> |
| 统信 UOS V20 | 基于 Debian 10，glibc 2.28；社区实测 **GTK4 不支持、webkit2gtk-4.1 缺失**（需 Debian 12） | <https://bbs.chinauos.com/zh/post/23747> 、 <https://bbs.deepin.org/post/298890> |

**结论一句话**：这两个主流信创版本只带 GTK 2/3、glibc 2.28–2.31，缺 GTK4 与 WebKitGTK 6.0。（取数 2026-11-22）

---

## 三、我们现状（本仓库事实）

| 事实 | 出处 |
|---|---|
| 原生 Linux 壳为 **GTK4 + WebKitGTK 6.0 + JavaScriptCore 4.1 + SQLite3**（`PKGS := gtk4 javascriptcoregtk-4.1 sqlite3 webkitgtk-6.0`） | `apps/desktop-linux/Makefile` 的 `PKGS`；`apps/desktop-linux/README.md` |
| `.deb` 由打包脚本产出，**仅在 Ubuntu 24.04 x86_64 验证**；**未签名**、**未做系统级 `dpkg -i` 安装**那一档；22.04 未实测（22.04 上 GTK4 为 4.6.9，本壳用到稳定 API，但没实测） | `apps/desktop-linux/scripts/package-deb.sh`；`apps/desktop-linux/README.md` §6「已知缺口」 |
| Linux 端现状与裁决 | [Linux 端适配计划](linux-adaptation.md) |
| `apps/desktop-linux/` 一行的定位与边界 | [仓库地图](../agents/repo-map.md)（`apps/desktop-linux/` 那一行） |

---

## 四、差距分析

| 维度 | 我们现状 | 目标系统 | 差距 |
|---|---|---|---|
| GTK 版本 | GTK4 | GTK 2 / 3（**无 GTK4**） | 需把壳降到 GTK3，或在目标机回填 GTK4 |
| WebKit 版本 | WebKitGTK 6.0（GTK4 原生档） | 缺 WebKitGTK 6.0；UOS 社区实测缺 webkit2gtk-4.1 | 目标机没有可用的 WebKitGTK 6.0；需替换为 4.0 档或回填 6.0 |
| glibc | 构建机较新（Ubuntu 24.04） | glibc 2.28（UOS V20）/ 2.31、2.28（麒麟桌面 V10 SP1） | 构建产物可能引用新符号，需在目标 glibc 下重构建或自带运行时 |
| CPU 架构 | 仅 x86_64 | 可能 ARM64（飞腾 / 鲲鹏）、LoongArch（龙芯）、x86（兆芯 / 海光） | 需按实际架构分别交叉构建与真机验收 |
| 打包与签名 | 未签名；未做系统级 `dpkg -i` | 需按上架规范签名与集成 | 需补签名、桌面入口 / 图标 / MIME 等系统集成 |

---

## 五、可行路线

### ① Web / 自托管优先

用 `apps/web` 的静态产物在浏览器打开，或部署自托管服务端后经浏览器访问。

- **成本**：最低。不改壳代码，今天可用。
- **风险**：需在目标机真机上验证浏览器内核能否承载共享 UI 产物。
- **前置**：目标机浏览器可用（`apps/web/dist` 静态产物或自托管服务端其一）。

### ② 原生壳适配

把壳依赖降到 **GTK3 + webkit2gtk-4.0**；或在目标系统回填 **GTK4 / WebKitGTK 6.0**（回填需连同依赖一起打包，否则换机不可用）。按 x86_64 / arm64 / loongarch 分别交叉构建并真机验收。

- **成本**：高，是一项专项。
- **风险**：回填依赖体积大、随系统变动；降级要改壳代码并重跑跨语言冒烟与窗口验收。

### ③ Flatpak / AppImage

把 GTK4 / WebKit 运行时一起打包，绕开系统 glibc 较老的问题。

- **成本**：中。
- **风险**：需确认目标机是否预装 flatpak，或是否可接受 AppImage 的免安装形态。

**推荐顺序**：**先 ①**；**② / ③ 作为后续专项**，按 §六 里程碑推进。

---

## 六、专项里程碑（M0–M4）

每个阶段给「可复跑命令方向」，读数以当次真机输出为准，本文不写死具体数值。

| 阶段 | 产出 | 判据方向 | 可复跑命令方向 |
|---|---|---|---|
| **M0 真机 / 容器探测** | 目标发行版版本号、CPU 架构、`gtk4` / `webkitgtk-6.0` 是否存在、glibc 版本 | 每条命令 exit 0 且有可复读输出，结果落盘到证据目录 | `cat /etc/os-release`；`uname -m`；`pkg-config --modversion gtk4 webkitgtk-6.0`（缺失时记录报错原文）；`ldd --version` |
| **M1 选路线并定依赖策略** | 路线选型结论 + 依赖策略（降级 GTK3 vs 回填 GTK4） | 结论与 §四 差距逐项对应，选型写明理由 | 汇总 M0 读数，对照 §五 的 ①②③ |
| **M2 多架构构建出包** | x86_64 / arm64 / loongarch 的构建产物（按实际架构取舍） | 每个架构出包成功，`dpkg-deb -I` 可读且依赖由 `NEEDED` 反查 | 用 `apps/desktop-linux/scripts/package-deb.sh` 走各架构构建宿主；交叉构建工具按 M1 结论定 |
| **M3 打包与签名** | 签名后的 `.deb`；桌面入口 / 图标 / MIME；上架规范符合项 | 签名可校验；桌面入口能被系统识别 | `dpkg-sig` / `debsigs` 其一按 M1 结论选定；`desktop-file-validate` 校验 `.desktop` |
| **M4 真机验收** | 目标真机上的启动、渲染、任务读写闭环证据（截图 / 窗口证据） | 目标真机上 exit 0 + 窗口证据 + 共享 UI 渲染 + 任务读写闭环 | 在目标机运行壳可执行文件并截图；按 §八 判据记录 |

---

## 七、待确认项

| 项 | 状态 |
|---|---|
| 目标发行版具体版本号（如麒麟桌面 V10 SP1 的 SP 与构建号、UOS V20 具体版本） | 待确认 |
| 目标机器 CPU 架构集合（是否含 ARM64 / LoongArch） | 待确认 |
| 是否接受回填 GTK4 / WebKitGTK 6.0，或降级到 GTK3 / webkit2gtk-4.0 | 待确认 |
| 是否需要进入麒麟 / 统信应用商店与兼容性认证 | 待确认 |
| 签名证书来源 | 待确认 |
| 是否需要单实例 / MIME 等系统集成 | 待确认 |

---

## 八、验收判据（方向性）

- 以**目标真机**上的 `exit 0` 与**截图 / 窗口证据**为准。
- 不以「本机（构建机）能跑」代替目标机证据。
- 证据至少覆盖：窗口能起、共享 UI 能渲染、任务读写闭环。

---

## 九、进展（2026-11-22 · 免费链路）

- **"至少装上"已打通**：产出 `heyta-web_0.1.0+20261122_all.deb`（`Architecture: all`，`Depends: python3, xdg-utils`），在 debian:10 + UOS20(deepin apricot) 仓库（glibc 2.28）与 ubuntu:20.04（glibc 2.31，麒麟 V10 代理）上 `dpkg -i` 均 `install ok installed`，装后本地静态服务返回 heyta 首页。构建与复跑见 [runbook](../runbooks/kylin-uos-web-deb.md)。
- **技术结论（实测仓库元数据，取数 2026-11-22）**：deepin `apricot`(≈UOS20) 无 GTK4、有 GTK3 + webkit2gtk-4.0；openKylin `huanghe` 有 GTK4 4.22 但无 webkitgtk-6.0；`nile` 有 webkitgtk-6.0 但 main 未带 GTK4。三套都**没有可用的 GTK4 + WebKitGTK 6.0 组合**，现有 `apps/desktop-linux` 原生壳跑不了。
- **原生栈的统一落点**：**GTK3 + webkit2gtk-4.0**（三套目标都具备）——这是能同时覆盖新旧信创系统的原生窗口方案，列为下一步。
- 本次为 Web UI 打包形态（本地静态服务 + 浏览器），不依赖 GTK4/WebKit；真实商业版/专业版实机、arm64/loongarch、商店认证仍在待办。
