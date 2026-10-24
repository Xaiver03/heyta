<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「仓库地图」的完整规则（原文 §2 仓库地图）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

## 2. 仓库地图

| 路径 | 内容 | 能不能改 |
|---|---|---|
| `packages/sync-core/` | 同步内核（加密、向量时钟、冲突判定）。**vendored 自 Super Productivity，MIT** | ⚠️ 尽量不改，改了要更新 `PROVENANCE.md` |
| `packages/shared-schema/` | 实体清单、schema 版本、HTTP 线协议契约（zod） | ✅ heyta 已改造，是**不可逆层** |
| `packages/storage/` | 存储适配层接口 + **三套实现**（IndexedDB / SQLite / 内存）（`DbAdapter` / `OpLogStore`） | ✅ |
| `packages/op-log/` | op-log 引擎与 reducer（物化状态、向量时钟闸门、墓碑） | ✅ |
| `packages/domain/` | 领域实体与 `EntityModelMap`（哪些实体真的被物化） | ✅ |
| `packages/sync-client/` | 宿主无关的同步编排（上传/下载/冲突上报） | ✅ |
| `packages/design-system/` | 设计变量唯一事实源 + 三端生成器（Swift / ArkTS / RN） | ✅ |
| `packages/i18n/` | **中英词条表**（自研零依赖）。🔴 它是**唯一文案事实源** —— 界面里不许出现硬编码文案，由 `check:ui-language` 拦 | ⚠️ 改词条**必须中英同步** |
| `packages/app-host/` | **宿主无关的应用接线与写入动作**（见下文 §3.5）。含 **AI 工具路径**：`ai-tool-selection.ts`（自然语言→工具，纯规则）+ `ai-tool-run.ts`（读即执行 / 写**只产出提案**，确认才 `submit`） | ✅ |
| `packages/ai/` | **出站 AI**：供给模式 / **出境闸门** / provider 端口 / 配置路由 / 健康熔断。🔴 **只产出建议，类型上产生不了 op**；零厂商 SDK | ✅ 零运行时依赖 |
| `packages/local-api/` | **入站 AI 接口**：本机 API / MCP 的工具契约 + 授权判定 + JSON-RPC 处理器。默认关、只监听回环、逐工具授权；🔴 **不构造 op**。⚠️ 它的**工具目录/授权/执行器与内置 AI 共用**（`isToolGranted` / `runReadTool` / `toWriteIntent`），**不要另建一份**（[`ADR-0035`](../../docs/adr/0035-ai-tool-calling-reuses-local-api.md)） | ✅ 零运行时依赖 |
| `packages/ui/` | **UI 单源**：一份 React Native 组件实现，各端由自己的 RN 平台渲染（web 走 react-native-web）。`src/` 按域分目录（task-list / timeline / calendar / search / settings / sync / auth …），宿主只消费它的 `dist` 与 barrel。⚠️ **组件里禁止裸值**（裸 hex/px/ms），见 [`design-system.md`](design-system.md)；🔴 **系统小组件不在这层**（那是 `widget-core` + 三份原生 UI，[ADR-0024](../../docs/adr/0024-desktop-shell-and-ui-convergence.md) 的显式例外） | ✅ |
| `packages/widget-core/` | **小组件的共享纯层**：`v:1` 快照信封 + 选择器（从物化状态投影）+ 意图队列语义。**类型上产生不了 op**、零第三方运行时依赖。🔴 快照**机密性 = 设备密钥加密**（[ADR-0025](../../docs/adr/0025-widget-snapshot-confidentiality.md)），原生壳只做一次 AES-GCM，**不在组件里跑 KDF** | ✅ |
| `packages/legal/` | **对外法律文本的唯一事实源**（用户协议 / 隐私政策 / 收集清单 / 权限清单 / 第三方清单 / 未成年人 / AI 与出境 / 订阅退款 / 权利行使）。🔴 **不在 `i18n` 里**（理由见其 `src/types.ts`），中英结构由测试对账；`check:legal-closure-truth` 守着「代码动了、文本没动」那类谎 | ⚠️ 对外法律表征，改文本要产品负责人过目 |
| `packages/inbound-core/` | **付费自动收集（inbound）的可移植纯层**：信封解封 / webhook 请求原语 / 权益契约 / 解析器。🔴 不碰 op、不碰数据库 —— 落库与授权判定在 `app-host` 与 `server` | ✅ |
| `server/` | 同步服务端 + **计费**（Fastify + Prisma + PostgreSQL）。**vendored，MIT** | ✅ 已改造 |
| `apps/` | 客户端外壳。**只允许放平台差异与 UI 绑定** | ✅ |
| `apps/web/` | Web 壳（IndexedDB + 浏览器 fetch） | ✅ |
| `apps/landing/` | **落地页**（Vite，独立于应用）。入口由构建期 `VITE_APP_URL` 决定 —— **未配置时整条入口不渲染**（默认构建就是未配置，这是故意的）。别再把 `href` 全是页内锚点当成断点：那取决于构建时给没给这个变量 | ✅ |
| `apps/mobile/` | 移动壳（React Native 0.84.1 + op-sqlite）。**Android 实机跑通；iOS 模拟器已跑通到交互级（真点击 → 真 op 落库 → 真同步到另一台设备，`pnpm verify:mobile-ios`）**。🔴 **2026-10-24 以码为准改口**：鸿蒙工程**已建并入库**（`apps/mobile/harmony/`，`git ls-files` 现量 **52 个**跟踪文件，2026-09-28 起，`8d2356ba9`「Android / iOS / 鸿蒙三端小组件落地」那批）—— `entryability/EntryAbility.ets` + `pages/Index.ets`（小组件写入 / 意图队列 drain / 清态的诊断页）+ 6 张 ArkTS 卡片（`FocusCard` / `QuadrantCard` / `HabitsCard` / `TodayCard` …）与 `WidgetStore` / `WidgetParse` / `WidgetIntents`。⇒ **旧写的「没有鸿蒙工程（壳未建）」是漂移，勿再引用**。⚠️ **真正没接的是共享 UI**：`entry/oh-package.json5` 的 `dependencies` 为**空**、`src/main/ets/` 里 **0 处** `rnoh` / `RNApp` 引用 ⇒ 应用内跑的是原生 ArkTS 小组件页，**不是** `packages/ui` 那套任务界面。RNOH 那条「JS 源码 → unsigned release HAP」的构建链仍是**树外探针**打通（`verify:harmony-toolchain` / `-rnoh` / `-rnoh-js`），缺模拟器系统镜像与签名 → §3.24 | ✅ |
| `apps/node-host/` | 非 Web 验证壳（真 SQLite 文件）。**接线已全部来自 `app-host`** | ✅ |
| `apps/desktop/` | **Electron 壳**（`@heyta/desktop`，17 文件 / 10 MB）。ADR-0024 的原选型，现降级为**过渡壳 + 唯一自动化桌面 GUI 门禁**（`e2e/tests/desktop-window.spec.ts`，经 `check:ai-e2e` 进 `pnpm check`）。🔴 **退役时点已定：等三个原生壳的壳级门禁替换它的断言之后** —— 见 [`docs/plans/multi-end-unified-strategy.md`](../../docs/plans/multi-end-unified-strategy.md) §6.3-T3 | ⚠️ 待退役 |
| `apps/desktop-macos/` | **macOS 原生壳**（SwiftPM：`HeytaShellCore` + `HeytaMac` + `heyta-smoke`）。**JavaScriptCore + libsqlite3 均为 macOS 自带 ⇒ 零第三方依赖**；加载**同一个** `native-bridge.js`。冒烟 **14/14**，窗口自截屏入库（`evidence/`）。🔴 **2026-10-24 以码为准改口**：形态**已是 M2**（`HeytaMacApp.swift` 用 WKWebView 挂自定义 scheme `heyta-local://app/index.html`，读 `Contents/Resources/web-dist`）⇒ **手写原生 UI 那一句已过期**（2026-09-29 因"同窗两份任务列表各读各的库"被否掉并删除，见 ADR-0037），勿再按"手写原生 UI"理解这一端 | ✅ 可运行 |
| `apps/desktop-linux/` | **Linux 原生壳**（C + GTK4 + `javascriptcoregtk-4.1` + `webkitgtk-6.0` + `libsqlite3`；清单同源 `apps/desktop-linux/Makefile` 的 `PKGS`，门禁读同一份）。`-Werror` 下 0 警告；跨语言冒烟**条数由产物自报**（`./heyta-smoke` 打 `HEYTA_LINUX_SMOKE=OK n/n`，`check:linux-shell` 读回它并拒绝 `0/0` 与缺行 —— 本文件不写这个数）；Xvfb 那一档也进了门禁（`check:linux-shell` 步骤④：真起窗口并判 `SHELL_UI=web-dist` + 页侧落定行 + 快照非空白且主蓝命中，载体读数见 [`runbook §5.7`](../../docs/runbooks/linux-dev-box.md)）。✅ **`.deb` 已进包并免 root 取过证**（`apps/desktop-linux/scripts/package-deb.sh`，入口 `pnpm build:linux <目标机>`（就在本机打包时那一格填 `local`；`apps/web/dist` 装成包内 `/usr/share/heyta/web-dist`，缺席就 `RESULT=WEB_DIST_MISSING` 拒绝产出，另有**两道**字节对账：目标机↔发起方与包内↔本工作树 `PKG_INDEX_SHA`；取证走 `dpkg-deb -x` 的临时根 + 解包态真跑一次窗口，读数在 [`runbook §5.9`](../../docs/runbooks/linux-dev-box.md)）。⚠️ 两格边界：装进系统（`dpkg -i`）那格**没做**（默认远端是生产机，那条档已整个拿掉），沙箱档要 root；`Depends` 由 `objdump -p` 的 **`NEEDED`** 反查（`ldd` 给的是传递闭包，实测 110 枚 vs 6 枚），且 `check:linux-shell` 在**所有平台分支之前**跑原生系统库的许可登记对账（[`ADR-0057`](../../docs/adr/0057-native-system-library-linking.md)）—— 登记册与 `.deb` 的 `Depends` 是**双向对账**，与平台无关 ⇒ 这一半在 macOS/Windows 上也照样执行（只有"编译 + 冒烟"那一半按平台**响亮跳过**并印出该跑哪条命令）；它能红的证明是 `node research/tools/check-native-lib-registry.mjs --self-test`（臂数由它自己打印）。⚠️ **仍然没有 Linux 桌面用户的证据**（这是当初不做它的原理由，未被推翻）。定位（2026-10-06 由产品负责人指令改掉）：**Linux 同时是一等开发载体与第五个交付端**，驱动是载体机 + 自托管，不是用户证据；最大缺口**不再是**"没走 M2（壳内 WebView 载共享 `web-dist`）"—— M2 的代码与运行取证都已成立（07 03:5x 载体读数在 runbook §5.7），🔴 **2026-10-24 以码为准改口**：上面那一格**已不是缺口** —— 装出来的 `.deb` 里那份共享 UI 产物**已有四道对账判据**（均在 `apps/desktop-linux/scripts/package-deb.sh`：`RESULT=WEB_DIST_MISSING` 缺席即拒绝产出、`PKG_FRESHNESS` 目标机↔发起方 sha256、`PKG_FRESHNESS_INPACKAGE` + `PKG_INDEX_SHA` 包内↔本工作树、`PKG_SHELL_UI=web-dist` 与解包态真跑一次窗口），与 [`linux-adaptation.md`](../../docs/plans/linux-adaptation.md) P4 行"三格全落"一致 ⇒ **本文件旧写的"还没有对账判据（计划 P4）"是漂移，勿再引用**。缺口换成 **装进系统（`dpkg -i`）那一档没做**（取证走 `dpkg-deb -x` 的免 root 临时根） | ✅ 可运行 |
| `apps/desktop-windows/` | **Windows 原生壳**（WinUI 3 / Windows App SDK，C#）。拆成 `Heyta.Windows.Core`（任意 OS 可构建可测）+ `HeytaWindows`（仅 Windows）。🔴 **实测更正**：界面**已渲染**（`MainWindow.xaml`），MSIX **已打包、已 `Add-AppxPackage` 成功、装上能跑**（`evidence/packaged-first-run.txt`：`ADD_APPX=OK` / `RESULT=OK`）。✅ **`check:macos-shell` / `check:windows-shell` / `check:linux-shell` 已接进 `pnpm check`**（2026-09-29；非本机平台响亮跳过） | ✅ 可运行，有门禁 |
| `docs/` | 产品文档。**分层规则见 [`docs/README.md`](../../docs/README.md)** | ✅ |
| `research/` | 调研原料：上游克隆、原始报告、一次性脚本。**不是产品文档** | ⚠️ 归档性质 |
| `scripts/` | 仓库级脚本与**门禁**（全部 `check:*` 的实现，以及各 `verify:*` 验收脚本） | ✅ |

---
