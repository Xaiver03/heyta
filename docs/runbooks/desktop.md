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
pnpm --filter @heyta/desktop build    # ① tsup：dist/main.cjs + dist/preload.cjs
                                      # ② vite：renderer-dist/（共享 UI 的浏览器产物）
pnpm --filter @heyta/desktop start    # 需要 §4.1 的二进制

# 真窗口 + 真截图（🔴 硬性规定：界面验收必须跑 Playwright 并**人眼看图**，见 AGENTS.md §6.2）
cd e2e && npx playwright test tests/desktop-window.spec.ts
#   → e2e/test-results/desktop-window-dev.png       （开发构建）
#   → e2e/test-results/desktop-window-packaged.png  （打包产物）
```

**为什么 `build` 里有两个构建器**：主进程（Node 侧）和渲染进程（浏览器侧）
是两套完全不同的运行时，一个 tsup 包不了两者。渲染进程走 **Vite + RNW**
（`apps/desktop/vite.config.ts`，与 `apps/web` 共用 `scripts/vite-rnw-resolve.mjs`
的解析规则）—— 这是"M1 判据第 4 条：桌面端与 web 端跑同一套 UI"的落点：
`renderer/main.tsx` 里 import 的就是 `@heyta/ui` 的共享 `TaskList`。

🔴 **加载的是 `renderer-dist/`（产物），不是 `renderer/`（源码）**。
源码目录里是 `.tsx` + `<script src="./main.tsx">`，Chromium **不认识 TSX** ——
直接 `loadFile` 源码目录会得到一个**白窗口**。

产物是 **CJS（`.cjs`）而不是 ESM**，这是被 preload 逼的：
`sandbox: true` 的 preload 必须是 CommonJS，Electron 不会以 ESM 加载它。
让两个入口同格式，可以避免"主进程 ESM、preload CJS"这种只在运行时才炸的错配。

### 4.2.1 🔴 两个"白窗口且不报错"的路径陷阱（都实测踩过）

Electron 的路径错**不会**崩、**不会**弹错、日志也基本干净，只是窗口全白。
下面两条各让桌面端白屏过一次，它们**在开发形态下都看不出来**：

| 写法 | 为什么错 |
|---|---|
| `join(app.getAppPath(), 'renderer-dist', …)` | `app.getAppPath()` 是**入口脚本所在目录**（`dist/`），**不是包根**。拼出来是 `dist/renderer-dist/`，不存在。 |
| `join(app.getAppPath(), '..', 'renderer-dist', …)` | 开发时是对的（`dist/..` = 包根），**打包后 `getAppPath()` 变成 `app.asar` 本身**，`'..'` 跑到 `Resources/` 去了。 |

**正确的是 `join(__dirname, '..', 'renderer-dist', 'index.html')`** ——
`__dirname` 就是 `main.cjs` 所在目录，开发时 `apps/desktop/dist`、
打包后 `app.asar/dist`，两种形态下 `'..'` 都恰好落在该在的地方。
preload 同理（`join(__dirname, 'preload.cjs')`），**少写一层**即可 ——
多写一层时 preload 静默不加载，界面显示
`宿主不可用：TypeError: Cannot read properties of undefined (reading 'request')`。

⚠️ 正因为这两条**只在打包后才现形**，`desktop-window.spec.ts` 才**同时**验证
开发构建与打包产物。只测开发端的话，把 `__dirname` 改回 `getAppPath()` 依然是全绿的。

### 4.3 打包（M2-4）

```bash
pnpm --filter @heyta/desktop run package       # 三平台全打
pnpm --filter @heyta/desktop run package:mac   # 只打 macOS（迭代时用）
```

产出在 `release/`（**已 gitignore**）：`heyta-darwin-arm64/`、`heyta-win32-x64/`、
`heyta-linux-x64/`。用 `@electron/packager`（BSD-2-Clause，白名单内自动登记）。

**选它而不是 `electron-builder` 的理由**：packager 做的是"应用包"这件核心的事，
一条命令交叉产出三平台、**在 macOS 上就能全部跑完**，于是"三平台产包"是
**当场可验证**的。builder 多出来的是安装器 / 签名 / 公证 / 自动更新 ——
这些**当前一个都做不了**（仓库没有 Apple Developer ID 与 Windows 代码签名证书），
引入一个用不上其核心能力的重依赖只会让依赖面和 `pnpm check` 一起变慢。

#### 🔴 打包能这么简单，是因为产物**自包含**

`tsup.config.ts` 里 `noExternal: [/^@heyta\//]` 把工作区依赖全打进了 `main.cjs`
（1.15 MB，只 `require` `electron` / `node:path` / `node:sqlite`），
所以打包**不需要带 `node_modules`**。

这不是顺手的小优化，而是**绕开了 pnpm + Electron 打包的经典死结**：
pnpm 用符号链接 + 嵌套 `node_modules`，打包器复制过去的是一堆断链的 symlink，
运行时 `MODULE_NOT_FOUND`。通行解法只有两个 —— 打成自包含，
或者改 `node-linker=hoisted`（会改掉整个仓库的依赖布局，影响所有人）。这里选前者。

#### 明确**没做**的事（不要误以为做了）

- ❌ **签名 / 公证**：产物是未签名的，macOS 上首次打开会被 Gatekeeper 拦。
- ❌ **安装器**：没有 `.dmg` / `.exe`(NSIS) / `.AppImage`，只有应用包本身。
- ❌ **自动更新**。
- ⚠️ **Windows 产物**：✅ 已实测**能启动并建出 op-log schema**（[§5.6](#56-打包产物在-windows-上真的跑起来了2026-09-28-实测-)）；
  ⏳ 它的**可见窗口**截图仍缺（无头 SSH 会话里截不到）。
- ⚠️ **Linux 产物**：❌ 仍未在 Linux 上运行过。
  🔴 **但"没有 Linux 机器"这个理由不成立** —— 团队自己的机器就在那里：
  `ubuntu-jcli`（124.223.13.226，Ubuntu 22.04.5）、`sanjiaozhou`（101.34.250.109，Ubuntu 24.04 8C/15G）
  实测 SSH 可达，清单与连通性见 [本地验证手册](local-server-verification.md) §0。
  所以这一条是**欠的活，不是缺的条件**。
  "打得出来"与"跑得起来"是两件事。

签名 / 公证 / 安装器 / 自动更新这四项都要等证书到位，届时的工具大概率是
`electron-builder`（它做安装器与签名）。
**在那之前不要写"三平台已验证可运行"。**

### 4.4 🔴 "Electron 总是意外退出" —— 先把退出**是谁触发的**分清 ✅实测

这个问题被问过一次，而**答案不是"应用有 bug"**。实测结论：

> **应用不会自己退出。** 无人干预时连跑 **60 秒全程存活、零输出**；
> 开两个实例也都能各自活下去（修单实例锁之前）。

真正会触发退出的只有三处，**全都是外部原因**：

| 触发者 | 场景 | 退出码 / 表现 |
|---|---|---|
| **`timeout N`** | 验证脚本用 `timeout` 包住 Electron | 是被 SIGTERM 收走，日志里只有一行 `exited with signal SIGTERM` |
| **Playwright `app.close()`** | `e2e/tests/desktop-window.spec.ts` 收尾 | 正常的测试拆卸，`pnpm check` 每跑一次就会开→关一次窗口 |
| **`src/smoke.ts` 的 `app.exit(code)`** | 跑的是 `dist/smoke.cjs`，**不是** `dist/main.cjs` | 冒烟脚本**设计上就是跑完即退**，它根本不是应用 |

**`dist/main.cjs` 与 `dist/smoke.cjs` 是两个入口，别搞混**：
前者是应用（常驻），后者是无头冒烟（跑完即退）。
`pnpm --filter @heyta/desktop smoke` 走的是后者 —— 看到它退出是**对的**。

判据：如果你看到窗口出现又消失，**先看是谁把它启动的**。
`main.ts` 里没有任何"非预期退出"的代码路径（`app.quit()` 只出现在
`window-all-closed` 的非 macOS 分支、启动失败回调和单实例锁三处）。

#### 4.4.1 单实例锁：修的是"两个 writer"，不是退出

实测发现应用**原本没有单实例锁**，而它**独占一个 SQLite 文件**。
两个实例能同时活着、谁也不报错 —— 所以问题不是"会不会崩"，
而是**两个 writer 悄悄写同一份数据**，等发现时数据已经不对了。

现在加了 `app.requestSingleInstanceLock()`，行为（✅实测）：

- 实例 1 常驻；实例 2 **立刻以退出码 0 退出**；实例 1 不受影响。
- 第二个实例**不静默消失**：它先把已有窗口拉到前台再退出。
  否则用户双击图标会得到"什么都没发生"，那看起来**正好像是应用意外退出了** ——
  一个正确的保护会被误读成 bug。
- 锁按 **userData 目录** 区分，所以 e2e 用 `--user-data-dir=<临时目录>`
  启动时**不受影响**（`e2e/tests/desktop-window.spec.ts` 本来就是这么做的），
  每个测试仍是独立实例。

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

### 5.5 开窗冒烟：`--window`（真 Windows 实测 ✅）

§5.3 那个冒烟**刻意不开窗**（所以 SSH 里能跑），代价是"窗口画出来了没有"
一直只能靠人眼。`--window` 补上这一环，而且**无头会话里也能截到图**：

```bash
# macOS
HEYTA_SMOKE_SHOT=/tmp/desktop.png pnpm --filter @heyta/desktop smoke -- --window
# Windows（真打包机）
set HEYTA_SMOKE_SHOT=C:\src\heyta-win-desktop.png
pnpm --filter @heyta/desktop smoke -- --window
```

输出是一行 JSON，关键是这三个字段：

| 字段 | 含义 |
|---|---|
| `bridge` | preload 真注入了。为 `false` 说明 preload 路径又错了，渲染进程是瞎的 |
| `rows` | 共享 `TaskList` 真渲染出的任务行数（判据是 `[data-testid^="task-row-"]`） |
| `hiddenBlank` / `colorBuckets` | 第一张（隐藏时截的）是否空白；颜色种类数。**空白就说明没合成出帧** |

真 Windows（`windows-pc`, `win32 x64`）实测：

```json
{"ok":true,…,"window":{"bridge":true,"rows":1,"docTitle":"heyta",
 "shotBytes":11081,"hiddenBlank":false,"hiddenColorBuckets":97,"usedVisible":false}}
```

截图已**肉眼确认**：标题「heyta」、副标题「桌面端 · 共享 UI 垂直切片」、
按钮「添加一条示例任务」、任务行「electron 运行时冒烟」都在，字体是 Windows 的。

#### 🔴 为什么不用 `--remote-debugging-port` + CDP（两条路都试过）

1. **端口可能早就被别人占着。** 实测那台 Windows 上 9222 被一个**完全无关的
   Tauri 应用**（`tauri.localhost`，标题"创业OS"）占着。CDP 探针连上去、
   拿到页面列表、**截了图**，输出一切正常 —— 而那是**别人的界面**。
   *没有任何一处会提示"你连错应用了"。*
2. 打包后的 Electron 在无桌面会话里未必起得来调试端口（实测 60s 内没开）。

`webContents.capturePage()` 走进程内 API：**没有端口、没有竞态、
拿到的一定是本进程这个窗口。**

#### 无头会话里的两条让步（如实记下）

| 让步 | 原因 |
|---|---|
| `app.disableHardwareAcceleration()`（仅开窗模式） | 无桌面会话里 GPU 进程会崩（`exit_code=34`），`capturePage` 随之抛 `UnknownVizError`。关掉后走软件合成 |
| 临时目录清理**失败不影响结论** | Windows 释放 SQLite 句柄是异步的，`rmSync` 抛 `EPERM`。打扫不该能否决证据 —— 退避重试后仍失败就打印警告放行 |

⚠️ 所以这个冒烟证明的是「这套 UI 在 Electron 的 Chromium 里能渲染出来」，
**不是**「GPU 加速路径在这台机器上健康」—— 后一条只有可见桌面上跑才算。

### 5.6 打包产物**在 Windows 上真的跑起来了**（2026-09-28 实测 ✅）

`release/heyta-win32-x64/heyta.exe` 送进真 Windows 机器启动后，它自己的
`userData`（`%APPDATA%\@heyta\desktop\`）里留下了：

```
heyta.sqlite        73,728 字节
Local Storage / Preferences / Network / ShaderCache / …
```

把库取回来看，**schema 是完整的**：

```
__heyta_seq   archive   meta   ops   ops__mt3   state        （6 张表）
SQLite 3.x, version-valid-for 13, written using SQLite 3.53.4
```

也就是说打包件**真的在 Windows 上启动了**：起了 Chromium、解开了 `app.asar`、
初始化了桌面宿主并建出了 op-log 的 schema。

📌 这条判据是**产物级**的（看它在自己机器上留下了什么），
不是"源码树上跑通了"—— 后者证明不了打包配置对不对。

## 6. 当前边界（明确**没做**的事）

| 项 | 状态 |
|---|---|
| 渲染页 | ✅ **已替换**：加载 `@heyta/ui` 的共享 `TaskList`（M1 判据第 4 条落点，见 [§4.2](#42-命令)） |
| **macOS 与 Windows 上的构建 + 11 个测试** | ✅ **已实测**（见 [§5.2](#52-在-windows-打包机上验证2026-09-27-实测-)） |
| **Electron 运行时冒烟（无窗口）** | ✅ **已实测**（真 Windows，见 [§5.3](#53-electron-运行时冒烟真-windows-实测-)）；**macOS 也已通过** |
| **GUI 窗口的真机冒烟** | ✅ **已做**（macOS arm64 实测）—— `desktop-window.spec.ts`，**开发构建与打包产物各跑一遍**，见 [§4.2](#42-命令)；截图见 `e2e/test-results/desktop-window-{dev,packaged}.png` |
| **开窗冒烟（`--window`，截图可看）** | ✅ **已实测**（真 Windows + macOS，见 [§5.5](#55-开窗冒烟--window真-windows-实测-)）—— 断言 `bridge`/`rows`/`colorBuckets`，截图**肉眼确认非空白** |
| 三平台**应用包** | ✅ **已产出**（`@electron/packager`，见 [§4.3](#43-打包m2-4)）· **Windows 打包件已在真 Windows 上启动并建库**（见 [§5.6](#56-打包产物在-windows-上真的跑起来了2026-09-28-实测-)） |
| ⚠️ 仍未做：**Windows 打包件的「可见窗口」截图** | 打包进程能起来并建库（§5.6），但无头 SSH 会话里截不到**它**的窗口；§5.5 那张图来自同一份渲染产物在 Windows 上的构建。要补这一条需要在**有桌面的会话**里跑一次 |
| ⚠️ 仍未做：**Linux 产物在 Linux 上运行** | **不是因为没有机器**（`ubuntu-jcli` / `sanjiaozhou` 实测 SSH 可达，见 [本地验证手册](local-server-verification.md) §0），是还没去做。三平台包此前都只在 macOS 上产出过 |
| 三平台**安装器**（dmg / nsis / AppImage） | 未做 |
| 代码签名 / 公证 | 未做 |
| 自动更新 | 未做 |
| 真实服务端同步 | 未在本层做 —— 复用 `@heyta/node-host` 的 `sync()`，见 [`multi-platform-build.md`](multi-platform-build.md) |

## 7. 设计门禁的覆盖范围 ✅实测

`check:design` 的 `SCAN_ROOTS` 已含 `apps/desktop/src`（M2 Spike S2）。

⚠️ **`renderer/` 还没有进扫描**：占位页时代的理由是"`.html` 不在 `SCAN_EXT` 里"，
但那个理由**现在过期了** —— 渲染层已经是 `.tsx`（`renderer/main.tsx`），
而 `SCAN_ROOTS` 里只有 `apps/desktop/src`。
**这是本轮留下的真实缺口**：桌面端渲染层目前**不受设计门禁覆盖**。

`.html` 之所以**刻意不在**扫描范围内，理由是风险不对称：打开它会让
web / landing / desktop 三处的 HTML 一次性进入检查，而 HTML 里合法存在大量
非设计尺度的值（`width="1100"`、`viewBox`、邮件模板内联样式等），
很可能先制造一批误报。而该脚本的原则是"**误报比漏报更致命**"。
这条留在"想做但要先量"的清单上 —— 与 M0-4 补 RN 规则时同样的做法：**先量命中数，再决定严格度**。
