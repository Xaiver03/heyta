# 多端 UI 审美方向与设计系统覆盖度审计（玻璃拟态专项）

> 元信息
> - 日期：2026-10-01
> - 基线：`main @ 77a75081` + 当前工作树（含未提交改动）
> - 性质：**只读审计**。本文给证据与建议，不改动任何规则与实现；方向拍板后应另立 ADR。
> - 方法：设计系统核心文件精读（tokens.css / MASTER.md / typography.ts / 生成器与门禁）；四路全仓探查（web+共享 UI、移动端、三原生壳+Electron、落地页+生成链路）；9 张真实截图的视觉分析（见附录 A）。文中"截图观感"均来自对已入库截图的逐张视觉分析，"代码事实"均带 file:line。

---

## 0. 结论速览

**审美方向（玻璃拟态）**：

1. **"全部做成玻璃"是错的方向；"材质系统"是对的方向。** Apple 自己从不把内容面做成玻璃——材质只给悬浮功能层（侧栏/工具条/浮层），内容永远实底，因为文字不能坐在不可控的背景上。heyta 的 MASTER.md §2 已经画了这条边界，本审计的结论是：**这条边界不用推翻，要的是把它执行得更系统、更彻底**。
2. **玻璃的原料和管道已经存在且质量很高**：`blur.*` / `material.*` token 已注册、已生成到 Swift/ArkTS/JSON/RN 四端（亮暗两套）；落地页导航是正确的参考实现；web 搜索浮层已接 backdrop-filter。**缺的不是规范，是消费与配方。**
3. 本次审计最有含金量的一条审美发现：**当前应用内的玻璃是"隐形的"**。搜索浮层技术上加了 `blur(20px)+saturate(180%)`，但截图观感是"一张实色白卡"——因为 72% 白 tint 盖在浅色列表上，玻璃透不透几乎没差别。**玻璃是关系，不是属性**：它需要背后有可折射的东西（滚动的彩色内容、色块、深色面、hero 光晕）。落地页导航的玻璃好看，正是因为背后有 hero 的光晕。这直接决定了下面"哪里该做玻璃"的裁决。
4. 玻璃必须与**动效**一起落地才有生命感。当前移动端零动画（无动画库、motion 弹簧 token 全部空转）、web 只有 7 组 transition + 1 个 keyframe——静态玻璃只是"更贵的实色"。

**设计系统覆盖度**：

5. 总体判定：**JS/UI 层的纪律实测优秀，好于文档的自述**——`packages/ui` 36 个组件零裸 hex、零原始色阶；移动端裸数字实测仅 2 类；TEXT_STYLES 覆盖 35/38 个共享组件；registry ↔ CSS 双向对账零孤儿。MASTER.md §14 担心的"RN 裸数字失控"当前并未发生。
6. 真实的覆盖缺口是结构性的四条（详见 §4）：**三个原生壳在门禁语言之外**（Windows/Linux 连 token 管道都没有，Linux 是唯一"壳即产品"却零 token 的端）；**web 壳层文字排版"有 token 无语义档"**；**门禁正则四个盲区**（.html 不扫、相对单位豁免、同行豁免、RN 窄属性集）；**少量漂移实例**（`blur(0.25rem)` 字面量、icon `size={16}` 类 prop 裸数字 66 处）。

---

## 1. 审计范围

| 端 | 载体 | 视觉责任在哪 |
|---|---|---|
| Web | react-native-web（`apps/web`） | 自有 CSS（app.css 3105 行）+ 共享 `packages/ui` |
| 移动 | React Native 0.84（`apps/mobile`） | 共享 Board 组件 + 端内 kit/TabBar（约 1900 行壳层 + 约 2500 行自建屏） |
| macOS | SwiftUI 壳 + WKWebView（`apps/desktop-macos`） | 用户看到的 = web UI；壳 chrome 实色 |
| Windows | WinUI 3 + WebView2（`apps/desktop-windows`） | app 模式下 = web UI 全屏；壳 chrome 实色 |
| Linux | GTK4 纯原生（`apps/desktop-linux`） | **壳即产品**：274 行手写 GTK 界面 |
| 落地页 | Vite + React + Motion（`apps/landing`） | 独立视觉体系，唯一"真玻璃"表面 |
| （参照）服务端凭据页 | 服务端渲染 | 独立门禁 `check:server-design`，在管内 |

架构前提（[ADR-0036](../adr/0036-main-battlefield-and-rn-single-source-ui.md) / [ADR-0037](../adr/0037-desktop-ui-falls-back-to-webview.md)）：UI 单源 = RN；桌面 = 原生壳内嵌共享 Web UI。**这条前提对玻璃方向是决定性的：多端玻璃的能力差异越大，"UI 单源"被撕开的面就越大**（见 §3.6）。

---

## 2. 现状审美审计（逐端）

### 2.1 Web + 共享 UI：干净、克制，但"没有记忆点"

**做得好的**（这些是资产，玻璃改造不许破坏）：

- token 纪律是真的：`app.css` 零裸 hex，px 仅存于被明示豁免的 `1px` 发丝线；内联样式全部经 `cssVar()`。
- 三层外壳（rail 图标栏 / 侧栏 / main）信息架构清晰，截图观感"结构清楚、密度合理"。
- 暗色是深蓝灰系（`#0d1526` 家族），不是反色——方向正确，且有 2026-09-30 的对比度审计兜底。
- 对比度是**测试实算**的，不是文档承诺（`tests/tokens.spec.ts` 亮暗两套逐对计算）。

**审美短板**（截图证据）：

- 整体观感是"**精致的后台系统**"：干净、规矩、但没有一个元素让人记住它。任务视图的构图是标准三栏，番茄钟待机态是一个空环 + 中轴对称，都正确而平淡。
- **动效近乎缺席**：全 web 只有 7 组 transition（hover 换色、按压、淡入）和 1 个 `@keyframes`（sheet 入场）。没有视图切换过渡、没有列表重排、没有完成勾选的满足感瞬间。界面因此显得"静"。
- 搜索浮层的玻璃配方太实（见 §0.3 与 §3.5）。
- 设置面板里"本机 API"的红字警告框在浅色界面里显得突兀（截图观感；危险色语义正确但视觉重量过载）。
- ⚠️ 自我纠错一条：截图分析曾把四象限判为"纵向条带卡片、不是 2×2"——**这是响应式行为不是设计**：容器低于 768px 断点时四象限降级单列（`--ht-layout-two-column-min`，[tokens.css](../../packages/design-system/src/tokens.css)）。审计不采信该批评，但它提示另一件事：**四象限的核心视觉（十字分区 + 四色语义）在桌面宽窗口下也没有被强调到"一眼记住"的程度**。

### 2.2 移动端：纪律最好的一端，但"存在感"问题在导航

- token 纪律全仓最佳（§4.1），9 个屏幕视觉 100% 来自共享 Board。
- **tab 栏是当前最值得做的审美改造点**：实色 + 1px 边框（[TabBar.tsx](../../apps/mobile/src/nav/TabBar.tsx) 代码事实），截图观感"与内容区无材质区分、存在感弱"。文件头记录了当时的决策——"宁可诚实不透明，不要假装半透明"（72% 白不模糊盖在文字上会糊成一片）。**这个决策在'不透明 vs 假半透明'之间是对的，但它跳过了第三个选项：真材质**（见 §3.4 移动端）。
- 动效为零是刻意约束（kit.tsx 注释明说），但代价已经可见：tab 切换硬切、勾选完成瞬时变色、FAB 无进出场。`motion.*` 弹簧 token（阻尼比/响应）定义完整且带着 Apple WWDC 依据，**零消费者**。
- 侧滑操作不存在：`size.swipe-action` token 有值 72，全仓 0 消费——token 先行、交互未做。

### 2.3 macOS / Windows 壳：视觉责任外包给了 WebView，壳自己零材质

- macOS：`.hiddenTitleBar`，`NSVisualEffectView` / `.ultraThinMaterial` 全仓 0 命中。讽刺的是 `HeytaTokens.swift` 里玻璃 token 已生成（`blurChrome=20`、`materialChromeTint #ffffffb8` 等）——**原料齐备、零消费**，且颜色 token 是 hex 字符串、壳里没有 `Color` 解析器，"可读不可用"。
- Windows：标准系统标题栏，`MicaBackdrop`/`AcrylicBackdrop` 0 命中；**不存在任何 C#/XAML token 生成物**（生成器只有 swift/ets/json/native.ts 四个目标）。
- 好消息：用户看到的界面是 WebView 里的 web UI，所以**页面内的玻璃在这两个壳里已经可见**；壳窗口级的材质（Mica / sidebar vibrancy）是增量改造，不需要推翻 M2 架构。

### 2.4 Linux 壳：离设计系统最远的一端

274 行手写 GTK 界面：无 CSS provider、无 token 接入、外观跟随 Adwaita 系统主题，无模糊能力。**它界面上没有任何一个像素来自设计系统，也没有任何门禁管它**，且它是唯一没有 WebView 兜底的"壳即产品"端。按主计划它"同架构但不做专项功能"，但至少颜色应该回到设计系统（§4.2 建议）。

### 2.5 落地页：唯一"真玻璃"的表面，且做法正确——这是 heyta 玻璃的参考实现

- 悬浮胶囊导航 = `material.chrome-tint` + `backdrop-filter: blur(var(--ht-blur-chrome)) saturate(180%)` + 顶边高光 + `shadow-md`（[landing.css](../../apps/landing/src/styles/landing.css)），且有 `prefers-reduced-transparency` 降级为实色。
- 全站动效从 token 弹簧参数换算（有数学恒等式测试），5 条动效审计全部 DONE。
- 审美评价仍偏"模板感"（约 60%）：hero 的排版和留白没问题，缺的是**记忆点与深度线索**——玻璃用对了地方（导航），但 hero 主视觉的构图密度低。这是营销页的事，与应用侧玻璃方向互相独立。
- 一处真实漂移：文档站顶栏 `blur(0.25rem)` 是字面量（landing.css:2451），与同文件三处 `var(--ht-blur-chrome)` 不一致——4px 与 20px 是两种完全不同的模糊度，属于"token 在手却没接"的实证。

---

## 3. 玻璃拟态方向的裁决

### 3.1 先把"拟态"这个词拆开

"各种东西都希望做成拟态的设计"，按 Apple 的品味拆成三个不同的东西：

| 名词 | 是什么 | 判定 |
|---|---|---|
| **玻璃拟态（glassmorphism）** | 半透明 tint + 背景模糊 + 发丝边缘 + 高光 | ✅ 方向本身成立，但要分区 |
| 新拟态（neumorphism） | 双向软阴影做出"凸起/凹陷"的塑料感 | 🔴 否决：对比度天生不达标，与可访问性测试体系正面冲突 |
| **材质系统（Materials）** | Apple HIG / Win11 的做法：按**层级**给不同重量的材质，内容面永远实色 | ✅ **这才是"Apple Design Taste"意义上的正确目标** |

结论：把需求从"全部玻璃"翻译成"**heyta 的材质系统**"——三级材质（chrome / panel / modal），玻璃只出现在悬浮功能层，内容面保持实色。这与 MASTER.md §2 的既有边界一致，**不需要改规则，需要的是把规则从"文档"升级为"token + 组件 + 测试"**。

### 3.2 玻璃成立的三条物理前提（Apple 的实际做法）

1. **背后要有可折射的内容。** Apple 的玻璃好看，因为背后是壁纸、照片、彩色内容。任务应用的界面大片是白纸——玻璃透白纸等于白纸。所以玻璃的适用面由**布局关系**决定：**"内容会从它下面滚过去吗"**（MASTER.md §2 已有这条判据，完全正确）。滚 → 材质是它表达层级的手段；不滚 → 玻璃是浪费的。
2. **文字永远坐在可控的底上。** 玻璃 tint 的对比度必须按**最坏情况背景**计算（下层是什么内容不可控）。落地页导航成立是因为它只遮 hero；应用内浮层要定义"允许透出的内容类型"。
3. **材质要能退让。** `prefers-reduced-transparency` / 系统"增强对比度"时退为实色。落地页已做（landing.css:553-559），应用侧应把它升格为 tokens.css 的全局策略。

### 3.3 逐平台可行性矩阵

| 平台 | 能力 | 现状 | 裁决 |
|---|---|---|---|
| Web（RNW/CSS） | `backdrop-filter` + `saturate`，Chromium/WebKit/Firefox 现代版均支持；无 blur 时已有降级（[material-surface.ts](../../packages/ui/src/material/material-surface.ts)） | 已局部实现（搜索浮层） | ✅ **第一战场**，零新依赖 |
| macOS 壳 | `NSVisualEffectView` / SwiftUI material 系统级最佳 | 0 使用；WKWebView 内页面玻璃已可见 | ✅ 窗口级材质做增量 spike（vibrancy + WebView 透明背景，需实测标注未核实项） |
| Windows 壳 | Mica（窗口底）/ Acrylic（浮层），一行 `SystemBackdrop` | 0 使用；无 C#/XAML token 管道 | ✅ 同上，且先补 XAML token 生成器（§4.2） |
| iOS/Android（RN） | iOS 系统 blur 优秀；**RN 无内置 backdrop blur**，需 `expo-blur` 或 `@react-native-community/blur`（要过 §3.1/§3.2 两道门，Android 性能有前科） | 无 blur 库；tab 栏"诚实不透明" | 🟡 **最难的一端**。首版用"高不透明 tint + 边缘高光"的伪材质；真 blur 等依赖门禁审查 |
| Linux（GTK4） | 无 backdrop blur，GTK4 无此能力 | 纯实色 | 🔴 放弃玻璃，保持实色（该端本就"不做专项功能"） |
| 鸿蒙（ArkTS） | ArkUI 有背景模糊属性（`backdropBlur`）⚠️ 未核实，壳未建 | token 已生成到 .ets | ⏸ 登记不裁决 |

**矩阵背后的结构性风险**：玻璃能力差异越大，共享组件里的 `Platform.OS` 分叉越多——`panel-surface.ts` 已经出现了第一处分叉。**必须把"端能力协商"封装进共享层**（扩展 `panel-surface.ts` 成通用的 MaterialSurface 抽象），否则每做一个玻璃面就多一处双轨，最终撕开"UI 单源"（ADR-0036 的核心承诺）。

### 3.4 逐表面裁决表（web 的 14 个浮层 + 导航面）

| 表面 | 现状 | 裁决 | 理由 |
|---|---|---|---|
| **tab 栏 / 移动端导航条** | 实色 + 边框 | 🟢 **玻璃候选 #1** | 内容从下面滚过（§3.2 前提 1）；这是"玻璃被看见"的唯一常驻场景 |
| **账号菜单 / 通知面板 / 清单标签下拉 / 重复规则下拉 / 捕获条下拉** | 实色 + shadow | 🟢 **玻璃候选 #2** | 悬浮层、小面积、web 上零成本；与现有 shadow 层级语言兼容 |
| **搜索浮层** | 已玻璃但观感近实 | 🟡 **调配方** | tint 72% 白盖浅色列表几乎不可见；降 tint / 加强边缘高光 / 配入场动效，以最坏背景对比度测试为准 |
| **toast（desktop-handoff 横幅）** | 实色 | 🟢 可选 | 小面积低风险 |
| rail hover 标签 | 实色 tooltip | 🟢 可选 | Apple 的 tooltip 本就是材质 |
| **模态（登录/隐私同意/同步设置/冲突/回收站确认）** | scrim + 实卡 | ⚪ **维持实卡** | 模态的任务是**聚焦**——玻璃漏注意力，方向相反；scrim 已有。可给实卡加边缘高光提质感 |
| 设置 sheet | 95% color-mix（刻意不用 blur） | ⚪ **维持** | 有 88% 事故前科（深色文字透上来叠字），决策记录在案且正确 |
| rail / 侧栏（web） | 实色 | 🔴 **不做** | 布局上内容不从它们下面滚过，玻璃隐形；桌面壳窗口级材质另算（§3.4 之外） |
| FAB | 主蓝实色 | 🔴 不做 | 操作锚点要稳、要快 |
| **内容面（任务行/卡片/表单/日历格/成长图表）** | 实色 | 🔴 **永远实色** | 文字密度最高、滚动最频繁、性能最敏感；这是 Apple 也不破的线 |
| **窗口 chrome（macOS 标题栏/侧栏、Windows Mica）** | 实色 | 🟢 **阶段 2 spike** | 系统材质的原生主场；属于壳改造，不动应用代码 |

### 3.5 玻璃的配方纪律（做的时候必须带上）

1. **材质阶梯补全**：现有 `chrome-tint` / `sheet-tint` 两档，建议补一档 `panel`（浮层用，介于两者之间）并把"边缘高光"从可选变成材质配方的一部分——顶边高光是"光打在材料上"，没有它半透明面像"没画完"（tokens.css §3d 注释原文）。
2. **配方上移 token**：设置 sheet 的 `color-mix(95%)` 目前是组件里的"裸配方"——材质的组成（tint/blur/高光/边框）应该整体上移为 token 或 MaterialSurface 组件的档位，不许每个组件自己拼。
3. **对比度按最坏背景算**：测试矩阵里加一类"玻璃 tint 合成在最坏背景上"的对比度计算（现有 AA_PAIRS 是静态底色对，覆盖不了半透明面）。
4. **与动效绑定交付**：玻璃层的入场用已定义的 spring 参数（`motion.spring-response-sheet 0.3` / 阻尼 1.0），scrim 渐显跟随。没有动效的玻璃不交付。
5. **`prefers-reduced-transparency` 全局化**：从 landing.css 的局部实现升格为 tokens.css 全局媒体查询（与 `prefers-reduced-motion` 同款策略：压值不删属性）。
6. **暗色玻璃已有正确基础**（深蓝提升而非反相），补 panel 档时同步给暗色值。

### 3.6 对"全部玻璃"的正式反对意见

如果真的把任务行、卡片、表单全部玻璃化，会发生四件事，每件都能单独否决它：

1. **可读性崩**：文字下的文字透上来——设置 sheet 88% 事故就是预演，且这次是全应用规模。
2. **性能崩**：backdrop-filter 在滚动列表上是持续的合成开销；Android 的 RN blur 性能口碑更差。
3. **"UI 单源"崩**：五端 blur 能力差异导致共享组件五处分叉（§3.3），ADR-0036 的核心承诺被逐面撕开。
4. **GTK 端直接出局**：无模糊能力，多端一致性破产。

**玻璃是层级语言，不是风格皮肤。** 用对地方（悬浮层 + 导航）它是"最后 10% 的质感"；用错地方（内容面）它是四重灾难。

---

## 4. 设计系统覆盖度审计（"组件不能脱离设计系统的控制"）

### 4.1 先说好消息：纪律实测优秀（这些是证据，不是印象）

| 检查项 | 实测结果 |
|---|---|
| `packages/ui` 36 个组件的裸 hex / 原始色阶 | **0 处**；全部经 `useHeytaTokens()/useHeytaText()` |
| `apps/mobile` 裸数字（MASTER.md §14 担心的） | 仅 2 类：一处 `opacity: 0.85`（代码自注释承认）+ 图标 `strokeWidth` 几处 |
| `apps/web` 裸 hex / 裸 px | app.css 0 处（px 仅 `1px` 豁免）；TSX 0 处 |
| TEXT_STYLES 语义文字样式 | 共享层 35/38 文件消费（3 个不消费的：Icon/FocusRing 无文字、AiPanel 是字体基座）；移动端自己拼 fontSize 的 **0 处** |
| registry ↔ tokens.css 双向对账 | 200 个 token 全存在、零孤儿；未注册的 45 个全部是刻意不进 registry 的原始色阶 |
| `blur.*` / `material.*` 分发 | 已注册且 Swift/ArkTS/JSON/RN 四端产物齐全（亮暗两套） |
| `check:design` 扫描根 | 6 个，**包含 `packages/ui`**（刻意补上的，注释记录了"原本正好在范围外"的教训） |

**结论：JS/UI 层基本达成了"组件不脱离设计系统"。** 真正的缺口在下面四条，按严重度排序。

### 4.2 覆盖缺口清单（按严重度）

**G1（结构性，最大）：三个原生壳完全在门禁之外，其中两个连 token 管道都没有。**
- `check:design` 的 `SCAN_EXT` 只认 `.ts/.tsx/.js/.jsx/.css`（[check-hardcoded.mjs](../../design-system/heyta/check-hardcoded.mjs)），`.swift/.cs/.xaml/.c` 天然不覆盖；唯一补偿是 macOS 侧"token 消费点 ≥5"的计数门禁（防不了裸值）。
- Windows：无 C#/XAML 生成器，shell 模式的原生切片全裸值（`FontSize="28"`、`Opacity="0.7"` 等，[MainWindow.xaml](../../apps/desktop-windows/HeytaWindows/MainWindow.xaml)）。
- Linux：**零 token 接入 + 壳即产品**（无 WebView 兜底），界面没有一个像素来自设计系统，也无门禁（[main.c](../../apps/desktop-linux/src/main.c)）。
- macOS：token 已生成但颜色"可读不可用"（hex 字符串，无 `Color` 解析器），导致壳代码宁可用系统色。
- **补法**：① 生成器加第五个发射器（XAML `ResourceDictionary`）；② Linux 用现有 `tokens.json` 生成 GTK CSS provider（色板先接上）；③ macOS 生成物加 `Color(hex:)` 扩展；④ 给三种语言各配一条"裸 hex grep"级的最小门禁（能失败就行，方法照 §3.1 注入验证惯例）。

**G2：web 壳层文字排版"有 token、无语义档"。**
共享层消费 `row-title/caption` 等 11 个语义档，而 web 壳（app.css + 内联样式）自己拼 `font-size/font-weight` 约 20+ 处——字号是 token，但**档位**（字号+字重+行高+字距的整体）没有语义化，line-height/tracking 不随行携带，靠 reset.css 默认。两套口径并存，漂移无判据。
- **补法**：为 CSS 侧补 `.ht-type-*` 语义工具类（或一组 `--ht-type-*` 变量），让 web 壳与共享层消费**同一套档位名**；`check:design` 增加一条"web 壳不得新写裸 font-size 组合"的规则（先量命中数再定严格度，与 .html 的处理先例一致）。

**G3：门禁正则的四个盲区。**
- `.html` 不扫（理由记录在案，og-card 靠生成器注入兜底——可接受，但 web/landing/desktop 的手写 HTML 目前是裸奔状态）；
- **相对单位全豁免**（`%|vw|vh|ch|em` 在 MATCH_ALLOW，`rem` 干脆无规则）——实证漏网：landing.css:2451 的 `blur(0.25rem)`；
- `LINE_ALLOW` 的 `/--ht-/`：同一行只要出现一个 token，第二个裸值不查；
- RN 无单位裸数字只查窄属性集（§4.1 已证实当前利用率为零，风险低但规则在）。
- **补法**：`rem` 纳入扫描（它是 px 的替身，最该查）；`blur(` 函数值单独加规则；其余两条先登记量命中数。

**G4：漂移实例与"承诺未兑现"清单。**
- `blur(0.25rem)`（landing 文档顶栏）→ 改 `var(--ht-blur-chrome)`（这是视觉 bug 级不一致：4px ≠ 20px）；
- web 端 lucide 图标 `size={16|18|40}` prop 约 **66 处**裸数字——`icon.*` token 存在、共享 `Icon.tsx` 在用，web 未接。**补法**：prop 换算经 token（或统一走共享 Icon），门禁补 prop 级规则；
- `motion.*` 弹簧 token 与 `size.swipe-action` token **零消费者**——设计系统领先实现，属于"登记了但没兑现"，应挂到路线图（动效基建与侧滑交互）而不是留在 token 表里空转；
- `packages/ui` 组件零阴影消费（`native.shadow()` 访问器全仓无调用；移动端 FAB 的阴影走的是端内 kit）——共享浮层组件在 RN 端实际无阴影，跨端浮层质感不一致，随 MaterialSurface 抽象一并解决。

### 4.3 覆盖度总判定

> **JS/UI 层：达成（实测纪律 + 六个扫描根 + 结构性测试）。**
> **原生层：系统性脱离（语言外 + 管道缺）。**
> **CSS 语义层：文字档位缺一层。**
> 按"组件不能脱离设计系统控制"的字面标准：**web/移动/共享层合格，桌面三壳不合格，落地页合格但有一处漂移。**

---

## 5. 建议的落地顺序（每阶段附可失败的判据雏形）

| 阶段 | 内容 | 判据方向 |
|---|---|---|
| **P0 对齐收尾**（不动风格） | 修 `blur(0.25rem)`；icon size prop token 化；`rem` 进扫描；CSS 语义档工具类；XAML/GTK token 管道；macOS `Color(hex:)` | 新门禁规则用注入违规验证能红；五端生成产物对账 |
| **P1 玻璃第一波**（web，零新依赖） | MaterialSurface 共享抽象（扩展 panel-surface.ts，封装端能力协商）；账号菜单/通知/三个下拉升 chrome 材质 + spring 入场；搜索浮层配方调整 | 截图人眼看 + `prefers-reduced-transparency` 降级断言 + "tint × 最坏背景"对比度计算进测试矩阵 |
| **P2 窗口材质 spike** | macOS：NSVisualEffectView 侧栏 + WKWebView 透明背景（⚠️ 未核实，需实测）；Windows：`SystemBackdrop=Mica` + WebView2 透明背景（⚠️ 未核实） | 真窗口截图 + 主蓝判据 + 与实色版的 A/B 性能 |
| **P3 移动端** | tab 栏伪材质（高不透明 tint + 边缘高光）；`expo-blur`/community-blur 过 §3.1+3.2 门禁的评估报告；reanimated 评估（动效基建与玻璃一起还账） | 真机流畅度；`motion.*` token 从零消费者变为有消费者 |

P1 之前应先拍板一条方向决策（建议立 ADR）：**"玻璃只给悬浮功能层与导航，内容面永远实色"**，把 MASTER.md §2 的边界从规范文本升格为决策记录。

---

## 附录 A：视觉证据（截图清单）

| 截图 | 结论要点 |
|---|---|
| `screenshots/web-desktop/W01-任务.png` | 三栏结构清晰；"精致的后台系统"观感；无记忆点 |
| `screenshots/web-desktop/W02-四象限.png` | 窄窗降级单列（响应式，非缺陷）；宽窗下四色语义未被强调 |
| `screenshots/web-desktop/W04-番茄钟.png` | 待机空环平淡；中轴构图正确 |
| `screenshots/web-desktop/W08-设置.png` | 分区卡片组织尚可；红字警告框视觉重量过载 |
| `e2e/test-results/search-spotlight-results.png` | 玻璃配方太实，观感为实色白卡 |
| `e2e/test-results/inbox-dida-collapse-collapsed-dark.png` | 深蓝灰方向正确；底/面明度差小，层级靠边框硬撑 |
| `apps/mobile/evidence/android-release.png` | tab 栏存在感弱、无材质区分 |
| `screenshots/landing/L01-官网首屏.png` | 约 60% 模板感；导航玻璃是亮点 |

## 附录 B：关键代码证据索引

- 材质 token：`packages/design-system/src/tokens.css` §3d（:528-540）与暗色（:640-645）；四端产物：`generated/HeytaTokens.swift:238-245`、`HeytaTokens.ets:235-242`、`tokens.json:195-202`、`src/generated/tokens.native.ts:226-233`
- web 唯一应用内玻璃：`apps/web/src/styles/app.css:687,711-712`；降级判定：`packages/ui/src/material/material-surface.ts`（2026-10-01 落地时由 `search/panel-surface.ts` 升格迁入，见 ADR-0042）
- 设置 sheet 刻意不用 blur：`apps/web/src/styles/app.css:585-594`（含 88% 事故记录）
- 落地页参考实现：`apps/landing/src/styles/landing.css:77-108`（chrome 材质）、`:553-559`（reduced-transparency 降级）、`:2451`（漂移实例）
- 移动端 tab 栏决策：`apps/mobile/src/nav/TabBar.tsx:20-25,92-94`；动效刻意缺席：`apps/mobile/src/ui/kit.tsx:324`
- 壳零材质：`apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift`（grep 零命中）、`apps/desktop-windows/HeytaWindows/MainWindow.xaml`、`apps/desktop-linux/src/main.c`
- 门禁范围：`design-system/heyta/check-hardcoded.mjs:41-82`（SCAN_ROOTS）、`:184-195`（SCAN_EXT 与 .html 排除理由）
- 视觉测试矩阵：`packages/design-system/tests/{tokens,category-colors,generated,native,native-values,typography}.spec.ts`
