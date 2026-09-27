# 桌面端（Electron）操作手册

> 状态：**骨架已在 macOS 与 Windows 上双双验证通过；GUI 窗口本身仍未真机冒烟**。
> 最后实测：**2026-09-27**（macOS 本机 + `windows-pc` 真机）。
> 相关：[ADR-0024](../adr/0024-desktop-shell-and-ui-convergence.md)（桌面端选型）、
> [多端适配计划](../plans/multi-platform-adaptation.md) M2。

---

## 0. 一句话

桌面端 = **Electron 窗口** + **`@heyta/node-host`**。
**业务能力一行都不在 `apps/desktop/` 里** —— 它只有 5 个小文件，
运行时依赖只有 `@heyta/node-host` 一个。

## 0.1 证据标记

沿用 [`deployment.md` §0.1](deployment.md) 的约定：

| 标记 | 含义 |
|---|---|
| ✅ **实测** | 本文写作时当场跑过，命令在 [§5](#5-不装-electron-也能验证-实测)。 |
| 📋 **引用** | 来自官方文档或本仓库其它文档，本次未独立复核。 |
| ⚪ **未核实** | 明确没验证。**不要当结论用。** |

---

## 1. 它由什么组成 ✅实测

```
apps/desktop/
  src/host.ts          库文件定位（userData）+ 转发 openNodeHost    ← 唯一"平台差异"
  src/ipc-contract.ts  渲染进程 ↔ 主进程的白名单（唯一入口）
  src/main.ts          Electron 主进程：开窗口、装 IPC、管生命周期
  src/preload.ts       contextBridge 暴露一层包装函数
  src/index.ts         不含 electron 的程序化入口（测试直接 import 它）
  renderer/index.html  ⚠️ 临时占位页，M1 会换成共享 UI
  tests/*.spec.ts      11 个用例，真实 SQLite 文件、无 mock
```

`host.ts` 的判据与 `@heyta/node-host` 共用同一句话：

> **这个文件里有没有任何一行在决定"业务上该怎么做"？** 有，就说明提取得不够。

## 2. Spike S1 结论：**主进程持库** ✅实测（决定）

ADR-0024 §5 把它列为未核实项，这里给出结论与理由：

| 方案 | 结论 |
|---|---|
| 渲染进程直接 `new NodeSqliteDriver(path)` | ❌ 不用。渲染进程被 `contextIsolation` + `sandbox` 隔离，本来就不该碰文件系统 |
| **主进程持库 + IPC**（本实现） | ✅ **采用**。主进程是 Node 环境，`node:sqlite` 的 `DatabaseSync` 是**同步**的，与仓库既有的 `SqliteDriver` 窄接口天然相容 |

**关键点：`@heyta/node-host` 与 `NodeSqliteDriver` 一行都没改就被复用了。**
这不是巧合 —— 那是"驱动必须同步"这个接口决定换来的（见 ADR-0024 §2.4）。

## 3. 库文件在哪 ✅实测

`<userData>/heyta.sqlite`，其中 `userData` 由 Electron 按平台决定：

| 平台 | 路径 📋引用 |
|---|---|
| macOS | `~/Library/Application Support/<appName>/` |
| Windows | `%APPDATA%\<appName>\` |
| Linux | `~/.config/<appName>/` |

⚠️ **不要**改成可执行文件旁边：安装目录通常不可写（macOS `/Applications`、
Windows `Program Files`），且升级会整个替换它 —— 数据放那里等于每次升级都丢数据。

⚠️ **不要**改 `DESKTOP_DB_FILENAME`：改了等于让既有用户的本地数据"消失"
（新建空库，旧库还在磁盘上但没人读）。

## 4. 怎么跑 GUI

### 4.1 前置：Electron 二进制要用 `install.js` 单独取（**不是 postinstall**）

> 🔴 **这一节的内容推翻过一个错误结论，先把错的写在这里免得重犯：**
>
> 我最初以为"`allowBuilds` 没放行 electron，所以二进制没下下来"，
> 还据此在 `pnpm-workspace.yaml` 里加了 `electron: true`。**那是错的。**
> 2026-09-27 实测：**electron 44.4.5 的 `package.json` 里没有 `scripts` 字段** ——
> 它**根本没有 postinstall**（已装的包与 npm registry 两处读到的结果一致）。
> 放行它什么也不会发生，那是一条**死配置**（已从仓库移除）。

真正的机制：

| 事实 | 值 |
|---|---|
| `pnpm install` 装到的体积 | **1.1 MB**（只有类型与 JS 入口） |
| 有没有 postinstall | ❌ **没有**（`scripts` 字段为空） |
| 二进制怎么取 | `node node_modules/.pnpm/electron@*/node_modules/electron/install.js` |
| 能不能 `pnpm exec install-electron` | ❌ 不行 —— 该 bin 没有链接进 `.bin` |
| 判据 | `path.txt` 与 `dist\electron.exe` 是否存在 |

**取二进制必须显式给代理**，否则报 `TypeError: fetch failed`：

```powershell
$env:HTTP_PROXY        = 'http://127.0.0.1:7890'   # 那台 Windows 本机的代理
$env:HTTPS_PROXY       = 'http://127.0.0.1:7890'
$env:NODE_USE_ENV_PROXY = '1'   # 🔴 关键：Node 的 fetch 默认**不读**这两个环境变量
node "$dir\node_modules\electron\install.js"
```

> 🔴 `NODE_USE_ENV_PROXY=1` 是最容易被漏掉的一步。没有它，Node 的 `fetch`（undici）
> 会直连 GitHub 并失败，而**报错只有 `TypeError: fetch failed` 四个字** —— 完全看不出
> 是代理问题。更坑的是同一台机器上 PowerShell 的 `Invoke-WebRequest` 能返回 200
> （它走 WinINET 系统代理），于是看起来"网络明明是通的"。
> 完整的误判链与判据记在 [`../reference/build-matrix.md` §1.2](../reference/build-matrix.md)。

实测结果：装上后 `electron.exe` **234.6 MB**，落在包目录内（不进仓库、不占仓库体积）。

> ⚠️ 这台 Windows 机器同时是 Android 打包机，**它的二进制要单独装**：
> 同步源码之后在那台上另跑一次上面的 `install.js`。

### 4.2 命令

```bash
pnpm --filter @heyta/desktop build    # 产出 dist/main.cjs + dist/preload.cjs
pnpm --filter @heyta/desktop start    # 需要 §4.1 的二进制
```

产物是 **CJS（`.cjs`）而不是 ESM**，这是被 preload 逼的：
`sandbox: true` 的 preload 必须是 CommonJS，Electron 不会以 ESM 加载它。
让两个入口同格式，可以避免"主进程 ESM、preload CJS"这种只在运行时才炸的错配。

## 5. 不装 Electron 也能验证 ✅实测

这是本骨架**最重要**的可验证性设计：`main.ts` 与测试**走同两个函数**
（`openDesktopHost` + `handleDesktopRequest`）。测试另接一套的话，测的就不是应用了。

```bash
pnpm --filter @heyta/desktop test     # 11 个用例
pnpm --filter @heyta/desktop typecheck
```

覆盖的东西：

| 用例 | 证明了什么 |
|---|---|
| 库文件落在 `userData` 下 | 路径规则本身 |
| 打开宿主后磁盘上**真的**出现 `.sqlite` | 不是内存库 |
| 写 → 关 → **重开新引擎** → 任务仍在 | 经 op-log 落盘，不是进程内缓存 |
| 改名 / 完成状态经白名单生效 | IPC 转发链路 |
| `close` **不在**白名单里 | 渲染进程不能关主进程的库连接 |
| 伪造 `dbPath` 不改变库位置 | 无路径注入（断言的是"位置不受影响"，不是"请求被拒"——见下方坑） |
| 依赖面白名单 | **"复用而非复制"的机器判据** |

### 5.1 "复用而非复制"是怎么被证明的 ✅实测

`tests/reuse.spec.ts` 断言桌面壳的**依赖面**：

- `src/` 里每个 import 只能是 `electron` / `node:*` / `@heyta/node-host` / 自己人
- **不得**直接 import `@heyta/domain`、`@heyta/app-host`、`@heyta/storage`、`@heyta/op-log`、
  `@heyta/sync-*`、`@heyta/ai`、`@heyta/local-api`
- `package.json` 的运行时依赖**恰好只有** `@heyta/node-host` 一个

对照：`apps/node-host` **允许**直接 import 那些包 —— 因为它**就是**宿主。
桌面壳是宿主的**用户**，不是另一个宿主。这个区别如果不写成断言，下一个人
加一行 `import { Task } from '@heyta/domain'` 不会有任何东西变红。

**已证伪**：注入 `import type { Task } from '@heyta/domain'` 后，
上面前两条**同时变红**并报出 `index.ts → @heyta/domain`；移除后 11 个用例全绿。

### 5.2 在 Windows 打包机上验证（2026-09-27 实测 ✅）

桌面端不是"写完就算"——它必须**在真正的 Windows 上**也能构建与通过，
否则"多端"就只是口号。已在 `windows-pc` 上实测：

```bash
# Mac 侧：同步当前工作树（叠加式解包，保留 node_modules）
git archive HEAD -- . ':(exclude)research/standalone/.npm-cache' | gzip -1 > /tmp/heyta-src.tar.gz
scp /tmp/heyta-src.tar.gz windows-pc:C:/src/
# Windows 侧：tar.exe -xzf C:\src\heyta-src.tar.gz -C C:\src\heyta
pnpm install && pnpm -r build && pnpm --filter @heyta/desktop test
```

| 项 | macOS 本机 | `windows-pc` |
|---|---|---|
| `pnpm -r build` | ✅ | ✅ **exit 0**（整个 monorepo） |
| `apps/desktop` tsup 产物 | `main.cjs` 3.23 KB<br>`preload.cjs` 1.44 KB | **同上，字节级一致** |
| `apps/desktop` 测试 | 11/11 ✅ | **11/11 ✅** |
| `typecheck` | ✅ | ✅ |

Windows 那 11 个用例含"写 → 关 → 重开新引擎 → 数据仍在"——
也就是说 `node:sqlite` 经 `NodeSqliteDriver` 在 **Windows 上真的落了盘**，
不是只在 macOS 上能跑。

> ⚠️ 同步用 `git archive HEAD`（**只含已提交内容**），**不要**照抄
> [`multi-platform-build.md`](multi-platform-build.md) §1.2 里的 `git add -A && git write-tree`：
> 那会改动共享工作区的暂存区。桌面端已在提交里，`git archive HEAD` 足够。
>
> ⚠️ 也**不要**用 `scripts/windows/bootstrap-repo.ps1 -Force` 做这件事：它会
> `Remove-Item -Recurse -Force` **整棵 `C:\src\heyta`**（连 node_modules 一起删）。
> 那台机器同时是 Android 打包机，没必要为了更新源码毁掉它的安装。
> 叠加式 `tar -xzf ... -C` 只增/改文件，实测 `node_modules` 原样保留。

> ⚠️ `pnpm install` 在 Windows 上会复用 pnpm store，实测 **14.4s**（不是几分钟）。
> 输出里有 `Lockfile is up to date, resolution step is skipped` 与
> `Lockfile passes supply-chain policies` —— **同一份 lockfile、零改写**，
> 这正是"临时同步过去的树没和上游漂移"的判据。

⚠️ **还没有做的事**：GUI 窗口本身仍**未真机冒烟**（没在那台机器上启动过 Electron 窗口）。
测过的是主进程侧的全部逻辑路径。见 [§6](#6-当前边界明确没做的事)。

### 5.3 Electron **运行时**冒烟（真 Windows 实测 ✅）

`tests/` 的 11 个用例跑在**纯 Node** 里，证明不了"应用真正跑在 Electron 主进程里"这件事 ——
那是另一个运行时（Electron 用自己的 Node 构建）。`src/smoke.ts` 补上这一环：

```bash
pnpm --filter @heyta/desktop build     # 产物含 dist/smoke.cjs
pnpm --filter @heyta/desktop smoke     # 需要 §4.1 的二进制
```

2026-09-27 在 `windows-pc` 上实测通过（**无窗口**，所以能在 SSH 里跑）：

```json
{"ok":true,"electron":"44.4.5","node":"24.21.0","chrome":"152.0.7977.130",
 "platform":"win32","arch":"x64","taskCount":1}
```

它证明的是**纯 Node 测不出来的那部分**：

| 断言 | 为什么重要 |
|---|---|
| `node":"24.21.0"` ≠ 系统 `node v24.19.0` | **Electron 用自己的 Node 构建** —— 原生模块必须在这个构建里 load 成功 |
| `taskCount":1` 且 `ok":true` | `node:sqlite` 经 `NodeSqliteDriver` 在 **Electron 运行时内真的读写了 SQLite 文件** |
| `platform":"win32"` | 上面两条是在**真 Windows** 上成立的 |

⚠️ 它**不覆盖**"窗口真的画出来了" —— 那需要人眼或截图，见 [§6](#6-当前边界明确没做的事)。

### 5.4 途中踩到的坑（留档）

写测试时我先断言了 `{ completed: true }`，测试**红了才发现**领域模型用的是
**`completedAt: number` 时间戳**，不是布尔值。

这事值得记：桌面壳把 `completed: true` 原样透传给 `setCompleted`，由领域层决定
落成哪个字段。**壳猜字段名就会猜错**，而领域层本来就该是唯一说话的人 ——
这正是"壳要薄"的实证。

## 6. 当前边界（明确**没做**的事）

| 项 | 状态 |
|---|---|
| 渲染页 | ⚠️ **临时占位页**，M1（共享 UI 垂直切片）会整个替换 |
| **macOS 与 Windows 上的构建 + 11 个测试** | ✅ **已实测**（见 [§5.2](#52-在-windows-打包机上验证2026-09-27-实测-)） |
| **Electron 运行时冒烟（无窗口）** | ✅ **已实测**（真 Windows，见 [§5.3](#53-electron-运行时冒烟真-windows-实测-)） |
| GUI 窗口的真机冒烟 | ⬜ **未做** —— 二进制已装好（§4.1），但还没在任何机器上真的启动过窗口 |
| Windows / macOS / Linux 三平台安装包 | 未做（`electron-builder` 或等价物） |
| 代码签名 / 公证 | 未做 |
| 自动更新 | 未做 |
| 真实服务端同步 | 未在本层做 —— 复用 `@heyta/node-host` 的 `sync()`，见 [`multi-platform-build.md`](multi-platform-build.md) |

## 7. 设计门禁的覆盖范围 ✅实测

`check:design` 的 `SCAN_ROOTS` 已含 `apps/desktop/src`（M2 Spike S2）。

**如实说明**：目前这条**基本是空的** —— 桌面壳只有主/preload/契约三个文件（无样式值），
而占位页是 `.html`，`SCAN_EXT` 不含 `.html`。
它的价值在于：M1 往这里放共享组件时，**覆盖从第一天就成立**。

`.html` 之所以**刻意不在**扫描范围内，理由是风险不对称：打开它会让
web / landing / desktop 三处的 HTML 一次性进入检查，而 HTML 里合法存在大量
非设计尺度的值（`width="1100"`、`viewBox`、邮件模板内联样式等），
很可能先制造一批误报。而该脚本的原则是"**误报比漏报更致命**"。
这条留在"想做但要先量"的清单上 —— 与 M0-4 补 RN 规则时同样的做法：**先量命中数，再决定严格度**。
