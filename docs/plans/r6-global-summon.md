# R6 全局唤出 —— 现状清单、选型、实现与验收

分包交付（2026-11-06）。任务书来自 [PRD R6](ticktick-parity-prd-2026-11.md) §P1「R6 全局唤出：托盘 + 全局热键 + 快速添加」。

> **边界**：本轮只动 `apps/desktop*` 与 `packages/app-host` 的注册层。没碰 `packages/domain`、
> `packages/storage`、`packages/shared-schema`，没 bump `CURRENT_SCHEMA_VERSION`，没提交。
> PRD 那句代价写的是「三端壳各自接线」，任务书要求**只挑一个壳做端到端**，其余只登记 ——
> 选型与代价见 §2 与 §7。

---

## 0. 一句话

桌面端原来只有 ⌘, 一个组合键，且只在主窗口聚焦时收得到；现在有了**系统级**的两条键
（显示/隐藏、快速添加）、一枚菜单栏图标、以及一个**不开主窗也能落库**的输入面板。
落点在 Electron 壳（`apps/desktop`），因为它是本机唯一能被 Playwright 附着的桌面载体。

---

## 1. 现状清单（四个桌面壳，逐格带 `file:line`）

全仓 grep 的现量（本轮复核过，只算源码，`.build/` 里的 SDK 头文件不算）：

```bash
grep -rn --exclude-dir={node_modules,dist,build,.build,obj,bin} -e 'globalShortcut' -e 'new Tray' \
  -e 'NSStatusItem' -e 'NotifyIcon' -e 'RegisterEventHotKey' apps packages | grep -v '\.pcm\|\.h-'
# → 源码 0 命中（只有 docs/research 与 docs/plans 里在讲它）
```

| 壳 | 技术 / 入口 | 托盘 | 全局热键 | 关窗后驻留 | 非全局快捷键 | op 写入通道 | 壳侧偏好存储 |
|---|---|---|---|---|---|---|---|
| `apps/desktop` | Electron 44.4.5 / [src/main.ts:521](../../apps/desktop/src/main.ts) `app.whenReady` | ❌ 无（[main.ts:18](../../apps/desktop/src/main.ts) 的 import 里没有 `Tray`） | ❌ 无 | ⚠️ **半个**：macOS 关窗不退（[main.ts:590-593](../../apps/desktop/src/main.ts)），点 Dock 重开（[main.ts:570-581](../../apps/desktop/src/main.ts)），但没有图标可点 | ⌘,/Ctrl+, 走 `before-input-event`（[main.ts:466-471](../../apps/desktop/src/main.ts)），判断在 [settings-shortcut.ts:20-28](../../apps/desktop/src/settings-shortcut.ts) | IPC 白名单 [ipc-contract.ts:115](../../apps/desktop/src/ipc-contract.ts) `case 'addTask'` → `host.addTask` | ❌ 壳侧零持久化（[package.json](../../apps/desktop/package.json) 无 store 类依赖，`main.ts` 不写窗口位置） |
| `apps/desktop-macos` | SwiftUI/SwiftPM（macOS 14+）/ [HeytaMacApp.swift:23](../../apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift) | ❌ `NSStatusItem` 源码 0 命中 | ❌ 无 | ⚠️ `NSApp.setActivationPolicy(.regular)`（[HeytaMacApp.swift:197](../../apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift)）；`applicationShouldTerminateAfterLastWindowClosed` 未实现 ⇒ 关窗后**是否驻留未核实** | `.commands` 里 `Button("设置…").keyboardShortcut(",", modifiers: .command)`（[HeytaMacApp.swift:76](../../apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift)） | 页侧消息 → `handleHostMessage` → `native-bridge.js` → op-log（[HeytaMacApp.swift:1038-1071](../../apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift)） | ❌ `UserDefaults` / `SceneStorage` / `frameAutosave` 源码 0 命中 |
| `apps/desktop-linux` | GTK4 + WebKitGTK（C11）/ [main.c:371](../../apps/desktop-linux/src/main.c) `int main`，`gtk_application_new`（[:384](../../apps/desktop-linux/src/main.c)） | ❌ 无（`AppIndicator` 0 命中） | ❌ 无 | ❌ 常规 `GtkApplication` 生命周期，无 hold | ❌ **壳侧一个组合键都没有**；`openSettings` 那枚跳的是系统通知设置（[heyta_web.c:662](../../apps/desktop-linux/src/heyta_web.c)） | `heytaStorage` → `heyta_api_handle_host_message` → 同一份 `native-bridge.js` | ❌ 无（只读环境变量） |
| `apps/desktop-windows` | WinUI 3 / C# / [App.xaml.cs:17](../../apps/desktop-windows/HeytaWindows/App.xaml.cs) `OnLaunched` | ❌ 无（`NotifyIcon` 0 命中） | ❌ 无 | 未核实（代码里没有 hold 逻辑） | ⚠️ **Ctrl+, 只是显示、没有绑定**：[MainWindow.xaml:11-20](../../apps/desktop-windows/HeytaWindows/MainWindow.xaml) 写明 `KeyboardAccelerator Key=","` 不可靠故放弃，[:46](../../apps/desktop-windows/HeytaWindows/MainWindow.xaml) 用 `KeyboardAcceleratorTextOverride` | WebView2 消息 → TS `handleHostMessage` → op-log（[MainWindow.xaml.cs:452-457](../../apps/desktop-windows/HeytaWindows/MainWindow.xaml.cs)） | ⚠️ 唯一成型先例是小组件那套 JSON（[WindowsWidgetStore.cs:45-49](../../apps/desktop-windows/Heyta.Windows.Core/WindowsWidgetStore.cs)），窗口/快捷键没有 |

**一句话总结**：托盘、全局热键、快速添加浮窗，**四个壳现状全部为零**；
唯一存在的组合键是 ⌘,，而它只在主窗口聚焦时收得到 —— 这正是
[ticktick-keyboard-and-menus.md](../research/ticktick-keyboard-and-menus.md) §5.3 说的分水岭。

---

## 2. 选了哪个壳，为什么

**选了 `apps/desktop`（Electron）。** 三条判据，按权重排：

1. **判据必须常驻才会红。** Electron 是 macOS 上唯一能被 Playwright 直接附着的桌面载体
   （[e2e/tests/desktop-window.spec.ts:48](../../e2e/tests/desktop-window.spec.ts) `_electron`、
   `:232` `electron.launch`）。Swift 壳那边 WKWebView 不暴露 CDP、Playwright 也没有 WebKit
   附着 API，验收只能靠 `evaluateJavaScript` 探针 + 自截屏
   （[HeytaMacApp.swift:1680-1685](../../apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift) 自述）。
   全局热键这件事**必须从系统外面按键**才算数，没有附着通道就只能人肉点一次 ——
   而"人肉点一次"不是判据（AGENTS.md §6 第 2 条）。
2. **op 写入口在这个壳是主进程单例。** 第二个窗口天然复用同一条通道，
   不需要回答"谁持引擎"。Swift 壳在 `app` 模式下**页侧持引擎**，壳侧只 `openOpLog()`
   且明写「只开 store、**不建引擎** —— 两个引擎同库会各自为政」
   （[HeytaMacApp.swift:1054](../../apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift)、
   [AppApi.swift:59-81](../../apps/desktop-macos/Sources/HeytaShellCore/AppApi.swift)）。
   那边 `AppApi.addTask` 走的是**有引擎**的另一条路（`:47`），在此模式下不可用。
   要在 Swift 壳做快速添加，得先决定壳侧那条写路径归谁 —— 那是数据语义那一格，**不在我边界内**。
3. **零新依赖。** `Tray` / `globalShortcut` 是 Electron 运行时自带的，
   不用过 §3.1 可维护性 + §3.2 许可证那两道门。

### 🔴 代价，说在前面

`apps/desktop` 在三份 README 里被定位为**过渡壳**：macOS 那份第 15 行、Linux 那份第 21 行都写「替换的是 `apps/desktop`（Electron）」，Windows 那份第 21 行写「`apps/desktop` 是 macOS/Linux 的过渡壳」
「替换的是 `apps/desktop`（Electron）」，而发布链路只带四个产物
（[app-distribution.md](../runbooks/app-distribution.md) §3：`macos=Heyta.dmg`、`windows=Heyta.msix`、
`linux=heyta.deb`、`android=apk`）——**Electron 产物不在发布清单里**。

所以本轮"用户能看到什么变化"目前**只在开发载体上成立**：
跑 `pnpm --filter @heyta/desktop start`（脚本键 `start` = `electron dist/main.cjs`）才看得到。
真正发给用户的 macOS `.dmg` 里还没有这一格，缺口登记在 §7。
这条不是"顺手做一半"，是任务书"只挑一个壳"与"发布物是原生壳"这两件事**现在确实冲突**，
冲突本身就是下一轮要拍的板。

---

## 3. 实现了什么

### 3a. 显示/隐藏（全局热键，可配置，不与 ⌘, 冲突）

- 一条系统级键 **⌘⌥⇧S**（Windows/Linux 是 Ctrl+Alt+Shift+S）：主窗可见就藏起来，不可见就唤出。
  落点在 [main.ts](../../apps/desktop/src/main.ts) 的 `toggleMainWindow()`。
- 键位来自 `<userData>/summon.json`，形状是 `{"showHide": "…", "quickAdd": "…"}`。
  读写、归一、校验全在 [summon-config.ts](../../apps/desktop/src/summon-config.ts)（纯函数，不起 Electron 就能测）。
- 🔴 默认值选**三修饰键**而不是两修饰键，理由写在那个文件的注释里：两修饰键的组合
  （⌘⌥A、Ctrl+Alt+T）在国内机器上被别的应用占走的概率很高，而
  `globalShortcut.register()` 抢占失败时**只返回 false，不报错也不解释**
  （Electron 官方行为）。抢不到会**如实说出来**：stdout 一行实况 + 托盘菜单里的禁用说明行。
- 校验会拒三种形状：没有修饰键的裸键（全局热键会吞掉用户打字）、
  两条命令撞同一个键、以及**与设置窗那条 ⌘,/Ctrl+, 冲突**（保留键从
  [settings-shortcut.ts:20-28](../../apps/desktop/src/settings-shortcut.ts) 的结论搬过来，见 `reservedSettingsAccelerator`）。

### 3b. 快速添加（不打开主窗即可落一条 op）

- 另一条系统级键 **⌘⌥⇧A** 打开一个无标题栏的小面板（[main.ts](../../apps/desktop/src/main.ts) `createQuickAddWindow()`），
  界面是 [renderer/quick-add.tsx](../../apps/desktop/renderer/quick-add.tsx)：一个输入框 + 一行提示 + 一条回执。
- 回车就存；存完面板留着、输入框清空，可以继续记下一条。Esc 关闭。
- 🔴 面板加载的是**本壳自己的**渲染产物（`renderer-dist/quick-add.html`），
  **不是** `apps/web` 那份共享 UI 产物。理由：`heyta://` 那个 origin 上跑的是页侧自带引擎的完整应用，
  同一个库里开第二个引擎就是两套向量时钟各写各的（§2 第 2 条那句同一件事）。
  面板只要"一句话进库"，而那条路主进程已经有一份 —— 走 IPC，不开第二个引擎。

### 3c. 托盘/菜单栏菜单

- 菜单栏一枚图标（**用代码画的** 16×16 模板图：圆角方框 + 一个勾）。
  不用位图素材的理由写在 [global-summon.ts](../../apps/desktop/src/global-summon.ts) 文件头：
  仓库里还没有桌面端图标（[package-desktop.mjs:188](../../scripts/package-desktop.mjs) 明写「不设 icon」），
  带一枚 PNG 进来会同时撞素材许可与设计系统那两条线。真图标属于设计系统线。
- 菜单四项：**今天 / 快速添加 / 显示主窗 / 退出**（`退出` 恒定排最后）。
  内容与"哪条命令叫哪个动作"是**数据**，在 [summon-commands.ts](../../apps/desktop/src/summon-commands.ts)；
  接线在 [global-summon.ts](../../apps/desktop/src/global-summon.ts)。
- 键位注册失败或配置文件写坏时，菜单里多几行**禁用的**说明（原文照抄问题），
  而不是画一枚点了没反应的命令 —— 同一条纪律见 [main.ts:73](../../apps/desktop/src/main.ts)。
- 「今天」不在壳里筛任务：主进程只推一条命令 `{kind:'showToday'}`（走新增的
  **主进程 → 渲染进程**频道 `heyta:shell:command`，只发意图不发数据；页面没加载完时
  命令先进 `pendingCommands` 队列、`did-finish-load` 再补发 —— 提前推的那一句
  不排队也不报错，就是没人听见），
  界面调共享层的 `filterTasks(tasks, {kind:'today'}, {now})`
  （[packages/domain/src/task-filter.ts:125](../../packages/domain/src/task-filter.ts)）。
  界面上同时给了「全部 / 今天」两颗按钮 + 一行「当前视图：…」，
  否则「今天」是一扇单向门（按得进去、看不出自己在哪、回不来）。

### 3d. 文件清单

| 文件 | 干什么 |
|---|---|
| [apps/desktop/src/summon-config.ts](../../apps/desktop/src/summon-config.ts) | 键位的形状、归一、冲突校验、文件读写（纯判断） |
| [apps/desktop/src/summon-commands.ts](../../apps/desktop/src/summon-commands.ts) | 菜单内容 + 「命令 → 动作」两张表（纯判断） |
| [apps/desktop/src/global-summon.ts](../../apps/desktop/src/global-summon.ts) | `globalShortcut` 注册、`Tray` 建出来、菜单装配（平台接线，零判断） |
| [apps/desktop/src/main.ts](../../apps/desktop/src/main.ts) | 窗口动作（藏/唤/焦点）、快速添加面板、命令推送、退出时撤键 |
| [apps/desktop/src/ipc-contract.ts](../../apps/desktop/src/ipc-contract.ts) | 新增**主进程 → 渲染进程**那一条命令频道（只发意图，不带载荷） |
| [apps/desktop/src/preload.ts](../../apps/desktop/src/preload.ts) | 暴露 `onCommand`（仍然不暴露 `ipcRenderer` 本身） |
| [apps/desktop/renderer/quick-add.tsx](../../apps/desktop/renderer/quick-add.tsx) + `quick-add.html` + [bridge.ts](../../apps/desktop/renderer/bridge.ts) | 面板界面；桥的形状两个页面共用一份 |
| [apps/desktop/renderer/main.tsx](../../apps/desktop/renderer/main.tsx) | 订阅命令 + 用共享筛选画「今天」那一档 |
| [apps/desktop/vite.config.ts](../../apps/desktop/vite.config.ts) | 两个页面入口（少了它 `quick-add.html` 根本不进产物，症状是白窗） |
| [apps/desktop/tests/summon-config.spec.ts](../../apps/desktop/tests/summon-config.spec.ts) · [tests/summon-commands.spec.ts](../../apps/desktop/tests/summon-commands.spec.ts) | 上面两张纯判断的 23 条单测 |
| [e2e/tests/desktop-global-summon.spec.ts](../../e2e/tests/desktop-global-summon.spec.ts) | 六条界面腿（下面 §5） |

---

## 4. 快速添加用的是哪个 action（逐跳）

```
renderer/quick-add.tsx 回车
  → window.heytaDesktop.request({ method: 'addTask', title })   // preload 白名单
  → ipcMain.handle('heyta:host:request')                        // apps/desktop/src/main.ts
  → handleDesktopRequest  case 'addTask' → host.addTask(title, over)
                                                              // apps/desktop/src/ipc-contract.ts
  → apps/node-host/src/host.ts        addTask: (title, over) => actions.create(title, over)
  → packages/app-host/src/actions.ts  createTaskActions().create → dispatchCreate
                                      → ctx.dispatch({ entityType: 'TASK', opType: OpType.Create, payload: {…} })
  → packages/op-log/src/engine.ts     store.appendLocal([persistedOp])   // 唯一写入口
```

**按符号名锚，不按行号**（那几个文件不在本分包名下，行号会随别的会话漂）。现量：

```bash
grep -n "addTask: (title, over)" apps/node-host/src/host.ts
grep -n "async create(title\|const dispatchCreate" packages/app-host/src/actions.ts
grep -n "appendLocal(\[persistedOp\])" packages/op-log/src/engine.ts
```

- **action 名：`createTaskActions().create`**（内部经 `dispatchCreate` 发**一条** `OpType.Create`）。
  一个用户意图 = 一条 op（AGENTS.md §3.4）。
- **落点是收集箱**：这条链不传 `projectId`，而"无清单归属 = 收集箱"的定义在共享层
  （词条 `web.rowMenu.inbox` 的注释就是这么写的，[packages/i18n/src/locales/zh-CN.ts:826-827](../../packages/i18n/src/locales/zh-CN.ts)）。
  判据落在这个字段上：§5 那条腿断言新建行的 `projectId === undefined`，不靠"看着在那一列里"。
- 壳侧**没有**任何一行 SQL、也没有自己拼 op；`check:layering` 的
  `no-op-construction-in-apps` 那条规则覆盖这里。

---

## 5. 验收判据与读数

载体：本机 macOS（1728×1117 主屏）。跑法（**只跑这一支**，不跑整套 e2e）：

⚠️ **这一支进了 `check:ai-e2e` 的射程**（`testDir: tests`，没进那份 `testIgnore`），
但没有 GUI 的环境会**响亮跳过**（`HEYTA_DESKTOP_WINDOW` 没置、或不是 macOS、或 Electron 二进制没装），
跳过**不等于**这一格被验过 —— 与 `desktop-window.spec.ts` 同一道门、同一条理由
（[environment-traps](../reference/environment-traps.md) #580）。
所以"常驻门禁"这句话要说全：**在 macOS 会话上常驻**，CI（ubuntu）上目前是空档。

```bash
pnpm --filter @heyta/desktop build
cd e2e && HEYTA_DESKTOP_WINDOW=1 HEYTA_SUMMON_FOCUS_LEG=1 \
  npx playwright test tests/desktop-global-summon.spec.ts --retries=0
```

| # | 判据 | 怎么量的 | 读数（2026-11-06） |
|---|---|---|---|
| ① | 后台时热键能唤出 | 主窗先收起来，再从**系统外面**合成一次 ⌘⌥⇧S，读 `BrowserWindow.isVisible()` | 六条腿 `--retries=0` 连绿 3 轮；§3 那次队列改动后又复跑一轮 5 条全绿。读数「收起用了 1 次按键，唤出用了 1 次」 |
| ① 焦点 | 唤出后**窗口拿到焦点** | 同一动作，但不带 `NO_FOCUS`，且先让别的应用到前台，读 `isFocused()` | `focused=true`（前台原本是「DeepSeek Harness」，收场把它还回去） |
| ② | 不打开主窗也能落库 | 主窗收起后按 ⌘⌥⇧A → 断言面板可见**且主窗仍不可见** → 输入回车 → 重新读库 → 断言该行在、且 `projectId` 为空 → 唤出主窗断言行画出来了 | 通过；回执「已添加：R6 快速添加 1793968463667」，主窗里同一行可见 |
| ③ | 唤出过程不抢前台 | `ui-acceptance.md` §6.2 规定二：带 `HEYTA_DESKTOP_NO_FOCUS=1` 跑，前后各读一次 `System Events` 的前台应用名 | 按之前「DeepSeek Harness」→ 按之后「DeepSeek Harness」（未变），且窗口 `focused=false` |
| ④ | 键位可配置 + 重启保留 | 往 `<userData>/summon.json` 写 ⌘⌥⇧K / ⌘⌥⇧J → 新键能用；**换进程重启**读同一份文件，新键还能用 | 两条都通过；默认键失灵那句是**反向断言**，只当补充读数（理由写在 spec 注释里：合成按键被丢与键没绑上不可区分） |
| 托盘 | 菜单栏真的有一枚图标 | `screencapture -x -R` 只裁顶部那一条；另跑一次 off/on 对照 | 图标在（圆角方框 + 勾），插入位置在第三方图标簇最左边，整簇右移一格 |

截图（`apps/desktop/evidence/`，人看过了）：
`r6-global-summon-1-before-hide.png` · `2-after-summon.png` · `3-focus-leg.png` ·
`4-quick-add-panel.png` · `5-quick-add-receipt.png` · `6-main-sees-it.png` ·
`7-custom-key.png` · `8-menu-bar-tray.png` · `9-today-view.png` · `10-back-to-all.png`。

### 5.1 判据能红（变异取证）

变异打在**构建产物** `apps/desktop/dist/main.cjs` 上（源码不动，避免污染工作树），
从 `.mut-bak` 还原，还原后 `shasum -a 256` 与变异前**逐字节相同**，
并且**还原后重跑了一趟干净腿**（6 passed）—— 变异那一趟会写脏截图。

| 变异 | 改法 | 结果 |
|---|---|---|
| M1 把热键注册注掉 | `globalShortcut.register(…)` → `ok = false`（产物里 `globalShortcut.register` 现量 0 次） | **3 failed**（①②④ 全红）：`按了 3 次「CommandOrControl+Alt+Shift+S」，状态仍停在 true` |
| M2 把 op 写入注掉 | `dispatchCreate` 里 `await ctx.dispatch({…})` → `await Promise.resolve({…})`（只这一处，`node --check` 过） | **② 红**：`快速添加的那条没进库（前 0 条 / 后 0 条）`；① 作为对照**仍绿** |

⚠️ M2 那一趟里**回执照样说"已添加"**，而库里什么都没有 —— 这正是判据②为什么要重新读库、
而不是信界面那行字。（第一版变异还打偏过一次：按 `entityType: "TASK"` 匹配命中了别的 dispatch 点，
两条腿都绿。已把改法收紧到 `dispatchCreate` 那一句，并把这条记在 §8。）

### 5.2 单测

```bash
pnpm --filter @heyta/desktop test
```
现量：`Test Files 7 passed (7) / Tests 66 passed (66)`，其中本轮新增两份文件 **23 条**
（`summon-config.spec.ts` 15 条、`summon-commands.spec.ts` 8 条；条数现量
`grep -c '^it(' apps/desktop/tests/summon-*.spec.ts`）。
纯判断层里已经红过、被修掉的三处：裸键归一成 `+s` 让"必须有修饰键"那条判断**恒不成立**；
macOS 的修饰键投给人时要按 ⌃⌥⇧⌘ 这个规定顺序；按字母序会写出 `⌥⌘⇧S` 这种系统菜单里不存在的写法，非 mac 平台还少拼了一个 `+`。

---

## 6. 门禁读数

基线是**本轮动手前**在同一棵树上量的（同一棵树里还有别的会话在改
`packages/ui`、`packages/op-log`、`packages/storage`、`packages/design-system`，
所以下面两枚红**不是**本轮引入的，逐条写明归属）。

| 门禁 | 改动前基线 | 改动后 | 判读 |
|---|---|---|---|
| `pnpm typecheck` | rc=**2** | rc=**2** | 🔴 基线就是红的：`pnpm -r` 停在 `packages/ui`，135 处 `Cannot find module 'react-native'`（那是别线的装机态，`packages/ui/node_modules/react-native` 在，而 tsc 解析不到）。差额 0 |
| `pnpm --filter @heyta/desktop typecheck` | rc=0 | rc=**0** | 本壳两份 tsconfig（`src`+`tests` / `renderer`）全绿，这才是本轮那批文件真正过的那把尺 |
| `pnpm check:ui-language` | rc=0 | rc=**0** | 新代码里的中文常量与本壳既有形状一致（`main.ts` 的 `title: '设置'`、`renderer/main.tsx:16-19` 写明桌面端不引 i18n 的理由） |
| `pnpm check:layering` | rc=**1** | rc=**1** | 🔴 基线就是红的：唯一一处违规是 `apps/web/src/features/tasks/saved-filters.ts:35` 的 `crypto.randomUUID()`，不在我改的文件里。差额 0（我的文件一条都没进违规集合） |
| `pnpm check:reachability` | rc=0 | rc=**0** | — |
| `pnpm --filter @heyta/desktop test` | rc=0 | rc=**0** | 66 条，见 §5.2 |

上面这一列是**最终代码状态**（含 §3 那条补发队列的改动）上复量的；

顺手扫过、都绿的：`check:design` · `check:design-token-refs` · `check:e2e-specs-parse` ·
`check:e2e-helper-exports` · `check:gate-wiring` · `check:shell-surfaces` · `check:ux-coverage` ·
`check:overlay` · `check:form-anatomy` · `check:dirty-form-policy` · `check:capture-shape` ·
`check:control-semantics` · `check:focus-single-source` · `check:z-ladder` · `check:ui-provider` ·
`check:theme` · `check:text-color` · `check:native-bare` · `check:crosslang-contract` ·
`check:repo-cache-paths` · `check:evidence-hygiene` · `check:md-tables` · `check:doc-citations` ·
`check:traps-index-coverage`（各 rc=0）。

两枚**与本轮无关**的红：`check:docs` rc=1 与 `check:doc-command-claims` rc=1，
命中集合现量只有 `docs/adr/0084-local-library-ownership-and-signout-erasure.md`（两处死链）与
`docs/plans/package-a-data-trust-2026-11.md:187`（`check:schema-version` 不是真键）——
都是分包 A 名下的文件，**不代改**（判据口径归负责人）。

⚠️ 没跑 `pnpm check:ai-e2e`：那一把尺的射程是整个 e2e 套，会重写别人名下已入库的证据图。
本轮只按文件跑那一支（`npx playwright test tests/desktop-global-summon.spec.ts`）。

---

## 7. 其余三个壳：只登记，没铺开

| 壳 | 要做什么 | 具体拦路格（先量过再说做不做） |
|---|---|---|
| `apps/desktop-macos`（Swift，**这才是发出去的 .dmg**） | `NSStatusItem` 菜单栏 + Carbon `RegisterEventHotKey` + 快速添加面板 + 偏好落盘 | 🔴 **引擎归属**：`app` 模式下引擎在页侧，壳侧 `AppApi.addTask` 那条路需要引擎（[AppApi.swift:47](../../apps/desktop-macos/Sources/HeytaShellCore/AppApi.swift)），而壳实际只 `openOpLog()`（[HeytaMacApp.swift:1054](../../apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift)）。快速添加要么把面板做成**页侧**的第二窗口（同库第二个引擎，明令禁止），要么给壳侧新增一条走 store 的写通道 —— 后者是 `packages/app-host` 的注册层决定，**要人拍板**。另外这壳**没有任何偏好存储 API**（`UserDefaults` 0 命中），键位落盘要从零定 |
| `apps/desktop-windows`（WinUI 3） | `NotifyIcon` + 全局热键（NHotkey 一类，或 `RegisterHotKey` P/Invoke）+ 面板 | 该壳连 Ctrl+, 都**没有真绑定**（[MainWindow.xaml:13-20](../../apps/desktop-windows/HeytaWindows/MainWindow.xaml) 写明 `KeyboardAccelerator Key=","` 不可靠而放弃）；全局键那一步要先解决同一个 API 的可靠性。偏好落盘有现成先例可借（[WindowsWidgetStore.cs:45-49](../../apps/desktop-windows/Heyta.Windows.Core/WindowsWidgetStore.cs)）。构建与验收都在 Windows 载体上，不在本机 |
| `apps/desktop-linux`（GTK4） | `AyatanaAppIndicator`/`AppIndicator` + `GtkApplication` 的 accels | [multi-end-unified-strategy.md:273](multi-end-unified-strategy.md) 把「托盘、通知、`.desktop` 集成」列为该端**应有而未做**，且注明"是否投入待定"；Wayland 下全局热键要 `libei`/portal，不是同一个做法。构建在 linux-dev 载体 |

还有一格**跨壳共同**的缺口：`<userData>/summon.json` 这个键位**没有设置界面**。
界面在 `packages/ui` / `apps/web`，不在我的边界内；本轮只保证"能配、会校验、重启还在"，
并把入口留成两个函数（`readSummonConfigFile` / `writeSummonConfigFile`）——
后者写之前先校验，校验不过**不落盘**，所以接界面时不会写出一个注册不上的键位。

---

## 8. 已知边界与未核实

- 🔴 **发出去的 macOS `.dmg` 里还没有这一格**（§2 末）。本轮的可见变化在 Electron 载体上。
- **托盘菜单项没有被自动化点过**。macOS 上程序化点开一个 `NSStatusItem` 菜单没有稳定通道，
  所以整条路拆成两段各自钉：菜单**内容 + 命令→动作**由单测钉（§5.2），
  **命令→界面**由 e2e 钉（§5 最后一条腿）。中间那一跳"Electron 的 `MenuItem.click` 调到我的函数"
  是框架保证，**未核实**。
- 由此带出一格同样**只有推理、没有自动化**的分支：主窗口已被关闭时按托盘「今天」，
  命令要先进队列、等新窗口加载完再补发。队列本身被 §5 那条快速添加的腿走过
  （窗口销毁 → `reloadTasks` 入队 → 唤出时补发），但它**不区分**"补发"与"挂载时本来就会重读"；
  真正只有队列才救得回来的是 `showToday`，而它只能从托盘进。
  要把它变成会红的判据，得先有一枚能触发托盘动作的测试入口（或走 AX 点状态项）。
- 面板 `frame: false` 且**没有拖拽区**：出现位置是系统默认居中，用户挪不动它。
  要挪得动得加 `-webkit-app-region: drag` 并把输入框标成 `no-drag`，这属于界面那一档的事，本轮没做。
- Windows / Linux 上 `Tray` 与 `globalShortcut` 的行为**未在本机验证**（载体不对）；
  代码里对托盘建不出来（Linux 无 appindicator）的分支会如实写进说明行而不是崩。
- 焦点那条腿（① 焦点）**会短暂把 heyta 拿到前台** —— 它测的就是这件事。
  所以它默认不跑，要 `HEYTA_SUMMON_FOCUS_LEG=1`，且收场把前台还给原来的应用。
- macOS 上关掉主窗后应用仍在（靠 `window-all-closed` 的平台分支），
  但**非 macOS 平台关窗即退、托盘随之消失**：这一格本轮没改（改它等于替 Windows/Linux
  决定"关窗是不是退出"，那是产品语义，归各自壳那一轮）。
- 变异打偏过一次（§5.1），说明"打偏的变异两条腿都绿"是真实风险：
  以后做这类取证，**必须先看命中数，再看是不是命中在想的那一句**。

---

## 9. 复跑

```bash
pnpm --filter @heyta/desktop build      # 主进程 + 两个渲染页（少这一步，面板那页根本不进产物）
pnpm --filter @heyta/desktop test       # 23 条纯判断（条数现量：grep -c '^it(' apps/desktop/tests/summon-*.spec.ts）
cd e2e && HEYTA_DESKTOP_WINDOW=1 \
  npx playwright test tests/desktop-global-summon.spec.ts --retries=0   # 焦点那条要再加 HEYTA_SUMMON_FOCUS_LEG=1
```

手动体验：`pnpm --filter @heyta/desktop start`，然后按 **⌘⌥⇧S**（藏/唤主窗）与
**⌘⌥⇧A**（快速添加面板），菜单栏那枚圆角方框 + 勾就是托盘。

改键位：往 `app.getPath('userData')` 下那份 `summon.json` 写两个键，重启生效。
本机实测未打包形态那个目录是 `~/Library/Application Support/Electron`，
与本地库 `heyta.sqlite` **同一个目录**；应用每次启动都会往 stdout 打一行
`HEYTA_SUMMON {"configPath": …}`，那串里的路径就是当前这一份。
