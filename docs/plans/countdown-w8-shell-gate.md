# W8 · 三端接线与壳级门禁 —— 落地结论

> 工单：`docs/plans/countdown-anniversary.md` 的 `#### ⏹ W8 · 三端接线与门禁`
> 交接：批次二交接文档的 W8 行（那份还住在 `feat/countdown-batch2` 上，**尚未进本分支**，
> 所以这里只点名不引路径 —— 引了就是死链）
> 载体：分支 `feat/countdown-w8`（worktree `heyta-wt-w8`），**未 push、未 merge**
> 本文是 W8 那一格的**唯一结论落点**（工单文档与交接文档本单不许改，见任务书地界）。

## 1. 状态

| 项 | 状态 | 一条读数 |
|---|---|---|
| 1 倒数日进 web `SHELL_MODULES` | ✅ **本单核实为"已落地"**，不是本单新做 | 由 W5 的 `a9529a59` 落进开关表；`b8f39cae` 把 key 类型收进共享词表 |
| 2 移动端那一处重复的裁决 | ✅ 裁决已定 + 已登记 + **有门禁** | `packages/domain/src/feature-modules.ts`（词表一份）+ 两端各自摆放表 |
| 3 壳级门禁 | ✅ 新增 `check:shell-surfaces`，已接进 `pnpm check` | `node scripts/check-shell-surfaces.mjs` **rc=0**，5 格绿 / 2 栏明写未取证 |
| 4 判据能红 | ✅ 变异 **10 臂**，逐臂读数见 §5 | 无存活臂 |
| Linux 那一端 | 🟡 **登记为缺口 `W8-GAP-L1`**，不假装覆盖 | 见 §6 |

⚠️ 本单**没有**新增任何产品行为：web 与移动端的倒数日界面在 `b8f39cae` 之前/之时就已存在。
本单的产物是**一条门禁 + 一份裁决登记 + 四端 reachable 的现量**。

## 2. 四端各自 reachable：量到了什么（不写"应该有"）

门禁 `check:shell-surfaces` 的台账形状：**每个（面 × 端）恰好一条声明**，
`reachable` 或 `gap(编号, 理由)`；两个方向都会红 —— 声明 reachable 而锚点没了 ⇒ 红，
声明 gap 而那条通道其实已经有了 ⇒ 也红（**声明过期**）。缺一格 = 红。

### web —— 量到了字节，也量到了界面

| 层 | 量到什么 |
|---|---|
| 开关表 | `SHELL_MODULES` 8 项里有 `countdown`，`defaultOn: false` 是**显式字面量**（门禁 W1） |
| rail | `MODULE_VIEW_TABS` 含 `countdown` ⇒ 按钮**来自常量**，不是 JSX 硬编码（W2）；rail 词条 `web.shell.views.countdown` 在 `apps/web/src` 里**只在 view-tabs.ts 一处**被消费（W4） |
| 不进 DOM 的机制 | `App.tsx:1015-1024` 的 `visibleMainTabs` 过 `enabledModules.has(`（W3）—— 这是"关掉的模块**不进 DOM**"的唯一机制 |
| **产物** | `apps/web/dist/assets/index-*.js` 里搜得到 `countdown-view`（W5），且 `dist` 不早于 `apps/web/src` |
| **真浏览器** | `e2e/tests/{countdown,motivation,smoke}.spec.ts` **15 passed / 0 failed**（33.8s，本机 22:47） |
| **人看过图** | `e2e/test-results/countdown-board.png`：页标题「倒数纪念日」、筛选条 5 档 + 已归档、两列两张卡（`还有 29 天` / `已经 31 天`）、**两张卡都有日期行**、rail 上沙漏项是主蓝激活态 |

### mobile —— 量到了注册表与那张屏，没量到真机

| 层 | 量到什么 |
|---|---|
| 入口 | `MOBILE_FEATURE_ENTRIES` 3 项含 `countdown`（M1） |
| 那张屏 | `apps/mobile/src/screens/CountdownScreen.tsx` 存在、含 `openTaskHost()`（读物化状态，不是占位）、含 `onBack`（M2） |
| 没长成第 6 个 tab | `TabBar.tsx` 的 `TABS` 仍是 5 个：tasks / calendar / focus / categories / profile（M3，ADR-0015 §4 / P10） |
| 词条 | `mobile.countdown.entry{,.hint}` 中英四条都取到字，且中文含汉字 / 英文不含（`apps/mobile/tests/feature-entries.spec.ts`） |

🟡 **本单没有跑移动端真机/模拟器**（`verify:mobile-*` 那一族需要模拟器独占 + 负载门）。
⇒ "移动端**装出来的产物**里有这一屏"仍是**主张不是取证**。要补：`pnpm verify:mobile-*` 里
加一条指 `profile-entry-countdown` 的点击腿，或 `pnpm reinstall:mobile`。

### desktop-macos / desktop-windows —— 判的是 **web-dist 通道**

🔴 为什么不是"原生有没有手写这一屏"：`multi-end-unified-strategy.md` §4.3 定案 **M2**
（原生壳 + 壳内 WebView 加载共享 UI 产物），§6.3-T3 第 1 条把三端手写的业务 UI 列为
**要删的对象**。⇒ 在原生壳里再手写一份倒数日是**违反既定决策**，
"这一面进桌面"当且仅当"它进了 `apps/web/dist`，而 dist 被打进了包"。

| 端 | D1 打包 | D2 壳认这个位置 | D3 脚本自断言 | D4 包里的字节 |
|---|---|---|---|---|
| macOS | ✅ `package-app.sh:81` `cp -R "$WEB_DIST" "$APP/Contents/Resources/web-dist"` | ✅ `HeytaMacApp.swift:1330` `Bundle.main.resourceURL?.appendingPathComponent("web-dist")` | ✅ 同文件 `[ -f ".../web-dist/index.html" ]` | ⚠️ **未取证**（见下） |
| Windows | ✅ `package-msix.ps1:82` `Copy-Item $webSrc $webTarget` | ✅ `MainWindow.xaml.cs:71` 按 `Directory.Exists(...web-dist)` 决定 `app` 模式 | ✅ 同文件有 `RESULT=WEB_DIST_MISSING` 失败断言 | ⚠️ **未取证**（包在 `windows-pc` 上） |

**D4 为什么报未取证而不是报绿**：`package-app.sh` 的默认输出目录 `/tmp/heyta-macos-dist`
是**同一台 Mac 上的共享位置**。本门禁第一轮就把**别的会话刚打的包**当成本轮产物判了红。
⇒ D4 现在先做 `index.html` 的 **sha256 对账**（vite 入口 HTML 里带的是内容哈希后的 chunk
文件名，所以 HTML 逐字相同 ⇒ 整张资源图相同），对不上就明说"那是别的检出／别的会话的包或
旧产物"。本轮实测读数：包里 `217cae2a252d` vs 本地 `594246a95995` ⇒ **不符 ⇒ 未取证**。
共享安装目录的所有者协调见 AGENTS §8.9。要取证：`pnpm reinstall:desktop`。

`HEYTA_REQUIRE_PACKAGED_ARTIFACT=1` 可把"未取证"收紧成红（发版前置用）。

### desktop-linux —— 缺口，且缺口本身是**被核对**的

见 §6。

## 3. 默认值的产品判断（工单明写"默认值是产品判断"）

**裁决：`countdown` 默认关。** 依据三条，不是"照抄滴答"：

1. 工单 §3 W8 的倾向就是默认关，且 `modules.ts:66-72` 已把口径写成规则：
   **"任务类"默认开**（改变"怎么看任务"），**"额外玩法"默认关**。
2. 倒数日与「日历」的区别**不是重不重要，而是用的频率**：rail 是每天点几十次的地方，
   倒数日一周点几次。滴答自己那一份也是关的（`modules.ts:17` 记的实测截图：
   `倒数纪念日 ✗`）。
3. 默认关**不损失可达性**：它在设置页「功能模块」里是一行开关节，开一次就常驻。

🔴 默认关之所以**安全**，前提是"关掉的模块不进 DOM"这条机制成立 —— 那由门禁 W3
（`enabledModules.has(` 还在过滤链上）+ §5 的臂 A 钉住。**如果哪天它被改成
`display:none`，默认关就变成"看不见但仍在导航里"**，那是另一种假可达。

⚠️ 门禁**刻意不钉 `defaultOn` 的具体真假**：那是产品判断，钉死它等于让门禁替产品负责人
拍板。门禁只要求"必须显式写出来"（W1）。

## 4. 移动端那一处重复：裁决与登记

工单 §7 第 5 条问的是：「移动端 tab 会重复一次 —— 该不该被 `check:layering` 拦，
还是它本来就是合法的平台差异？」

**裁决：都不该 —— 要把"重复"切成两半，两半各归一处。**

| 那一半 | 是什么 | 归哪 | 靠什么不漂 |
|---|---|---|---|
| **有哪些功能域**（词表本身） | 产品语义："倒数纪念日是一个功能域，不是一种颜色" | 🔴 **一份**：`packages/domain/src/feature-modules.ts` 的 `FEATURE_MODULE_KEYS` | 两端注册表的 `key` 都声明成 `FeatureModuleKey` ⇒ 移动端自己编一个词是**编译错误** |
| 每个功能域**在这一端摆几个、什么顺序、默认开不开** | 平台差异（屏宽、鼠标 vs 触摸、rail vs 底部标签 vs「我的」页第二层） | ✅ 每端一份：web `shell/modules.ts` + `shell/view-tabs.ts`；mobile `nav/feature-entries.ts` | 门禁 W1/W2/M1 + `feature-entries.spec.ts` 的**集合相等** |

⇒ **`check:layering` 不新增规则**（它拦的是"外壳自己拼 op / 自己写业务判断"，
tab 数量与入口位置不是那一类；实测它现在 9 条规则、扫 330 文件，rc=0）。

🔴 **"抽出一个共享实现"不等于"重复被消除了"**（AGENTS §3.5 记过：`ids.ts` 抽出来了、
旧那份一直活着）。所以收尾动作是三件，缺一条这个裁决就不算落地：

1. **旧的那份没了**：`ShellModuleKey` 原来是手写的 8 项联合类型（`b8f39cae~1` 的
   `modules.ts:51-59`），现在是 `FeatureModuleKey` 的**别名** —— 手抄件被删了，不是并存；
2. **注册表是承重的**：`ProfileScreen` 的入口行由 `MOBILE_FEATURE_ENTRIES.map` 生成
   （`feature-entries.spec.ts` 钉），不是各写一遍字面量；
3. **有门禁**：`check:shell-surfaces` 的 M1 + spec 的「web 开关表 ⇄ 共享词表集合相等」。

⚠️ 一处**已登记的 §3.5 张力**（不是本单引入的）：`defaultOn` 是产品语义，却住在
`apps/web/`。搬进 `packages/domain` = 改动 web 的行为，不属于"接移动端"这一单，
`feature-modules.ts:30-35` 已把它写成缺口，另单处理。

⚠️ 还有**第三份**"摆放表"：`apps/landing/src/mockup/app-shell-shape.ts` 的
`SHELL_VIEW_TABS`（落地页那张外壳示意图）。它是**营销素材**不是某一端，
且已有自己的实时对账（`apps/landing/tests/mockup-shell-shape.spec.tsx` 按**源码文本**
读 `view-tabs.ts` 比对，`e2e/tests/helpers.ts:353-368` 那份"加视图要一起改的四处清单"
第 4 处就是它）⇒ 本单不动它，也不把它当"重复未清"。

## 5. 变异臂清单与读数（10 臂，无存活）

🔴 按 W10 那条教训办：**逐臂看红集，存活的那几条才是这单真正产出的判据。**

| 臂 | 改动 | 红在哪 | 读数 |
|---|---|---|---|
| **A** | `modules.ts` 的 `countdown.defaultOn: false → true` | ① `apps/web/tests/app-mount.spec.tsx` 的 DOM 级逐字对标签 ② `e2e` 两条 | ① **1 failed / 23 passed**，`expected [Array(8)] to deeply equal [Array(7)]`，多出的正是 `倒数纪念日`（插在「时间线」与「搜索」之间）② e2e **2 failed / 13 passed**：`countdown.spec.ts:109`「默认关着 ⇒ 这个 tab 根本不在 DOM」+ `motivation.spec.ts:159`「默认 rail 只有 7 个 tab」；`smoke.spec.ts` 的 `toHaveCount(11)` **不红**（那支走 `openApp`，全模块都开）—— 与 `smoke.spec.ts:24-27` 注释里写的分工一致 |
| **B1** | `SHELL_MODULES` 删掉 `countdown` 整项 | 门禁 W1 | rc=1：`🔴 W1 SHELL_MODULES 里没有 "countdown" 这一项` |
| **B2** | `feature-entries.ts` 的 `countdown → count-down`（把 entries 与词表拆开） | typecheck + mobile spec + 门禁 M1 | `pnpm --filter @heyta/mobile typecheck` **rc=2**，3 条错（TS2820 不是 `FeatureModuleKey` / ProfileScreen 的穷尽 switch 缺 return / TS2678 分支不可比）；`vitest feature-entries.spec.ts` **3 failed / 6 passed**；门禁 `🔴 M1 MOBILE_FEATURE_ENTRIES 里没有 "countdown"` |
| **C** | 删掉 `package-app.sh` 那条 `cp -R "$WEB_DIST" ...` | 门禁 D1 | rc=1：`🔴 D1 打包：… 这条通道在 apps/desktop-macos/scripts/package-app.sh 里没了` |
| **D** | 往 `apps/desktop-linux/Makefile` 塞一处假 `web-dist` 引用 | 门禁 L2（反向核对） | rc=1：`🔴 L2 反向核对失败：apps/desktop-linux 下出现了 web-dist 引用（apps/desktop-linux/Makefile）⇒ 台账仍写着 W8-GAP-L1，声明过期` |
| **E** | 台账里 Linux 那一格的 face 名改错（= 缺格） | 断言 A | rc=1：`· 台账缺 (面=countdown, 端=desktop-linux) 这一格 —— 不许用"没登记"当自动跳过` |
| **F** | `apps/web/dist` 里那个 `countdown-view` 改掉 | 门禁 W5（产物） | rc=1：`🔴 W5 已构建产物里搜不到 testID "countdown-view" ⇒ 这一面没进要发出去的字节` |
| **G1** | 造一份 sha256 **对得上**的包（`HEYTA_MACOS_WEB_DIST` 指过去） | D4 的正向腿 | rc=0：`D4 包里的 web-dist 有 "countdown-view"，且 index.html sha256 == 本地 apps/web/dist` —— 证明 D4 **不是**一条永远不跑的判据 |
| **G2** | 同一份包，把 testID 抹掉 | D4 的反向腿 | rc=1：`🔴 D4 包里的 web-dist 搜不到 "countdown-view"（sha256 已对上，确实是这份）` |
| **H** | （副产物）改 `apps/web/src` 而不重建 | 门禁 W5 的新鲜度腿 | rc=1：`🔴 W5 产物比源码旧（dist …Z < src …Z）⇒ 查的是上一个版本` —— 就是交接 §2.2 第 1 条那 19 枚红的形状 |

**全部臂跑完后**：`node scripts/check-shell-surfaces.mjs` 复跑 **rc=0**、
`vitest app-mount` **23 passed**、`git status --porcelain` 无残留（变异用 `git checkout --`
还原，产物用 `pnpm --filter @heyta/web build` 重打）。

### 两条**只有写这个门禁才拿到**的事实

1. **`/tmp/heyta-macos-dist` 是共享位置** —— 第一轮把别人的包读成自己的产物并判红。
   ⇒ D4 加 sha256 对账（已落进门禁本体，不是注释）。
2. **反向核对的遍历漏了没有后缀的文件** —— 臂 D 第一次**没红**：`walkSources` 按扩展名
   过滤，而假通道恰好最可能改在 `Makefile` 上。⇒ 改用不按扩展名过滤的遍历（§7 元规则 1：
   "没扫到" ≠ "没发生"，先怀疑探针）。

## 6. 缺口台账（编号递增，本单新增两条）

| 编号 | 缺口 | 现量依据 | 补法 |
|---|---|---|---|
| **W8-GAP-L1** | **Linux 桌面没有 web-dist 通道** ⇒ 倒数日（以及任何共享 UI 的新界面）在 Linux 上不可达 | `apps/desktop-linux/` 下 `web-dist` / `WEB_DIST` **0 命中**（门禁 L2 每次核对）；它是 JSC + 手写 GTK UI，`src/*.c` 里没有 WebView | 🔴 **不是**给 Linux 手写一屏（§4.3 定案 M2、§6.3-T3 第 1 条把手写业务 UI 列为要删的对象），而是先给它一条 web-dist 通道 + 一个 WebView 宿主。补上时**必须同时翻台账那一格**，否则门禁 L2 红 |
| **W8-GAP-M1** | 移动端的**装出来的产物**里没有这一屏的取证（只证到源码接线 + 词条取到字） | 本单没跑 `verify:mobile-*` / `reinstall:mobile`（模拟器独占 + 负载门） | 在某一端设备验收里加一条点 `profile-entry-countdown` → 屏内断言的腿；或 `pnpm reinstall:mobile` 的截图判据里带上这一面 |

⚠️ 两条都**不是**"本单漏做"，是登记：L1 是外部结构（缺通道），M1 是载体（要独占模拟器）。

## 7. 复跑

```bash
node scripts/check-shell-surfaces.mjs                 # rc=0；--face=countdown 只跑一个面
HEYTA_REQUIRE_PACKAGED_ARTIFACT=1 node scripts/check-shell-surfaces.mjs   # 发版前置：未取证=红
pnpm check:shell-surfaces                             # 同一条，已接进 pnpm check（在 check:reachability 之后）
cd e2e && npx playwright test tests/countdown.spec.ts tests/motivation.spec.ts tests/smoke.spec.ts
```

相邻门禁实测都仍绿（新脚本没引入违规）：`check:ui-language` / `check:layering`（9 规则 330 文件）
/ `check:design` / `check:docs-voice` 各 **rc=0**。

⚠️ 本文**没有**被工单文档或批次二交接文档链接 —— 那两个文件在本单地界里**不许改**（且后者
还没进本分支）。⇒ 请 W8 的收口人把本文挂到工单 §8.2/§8.4 的 W8 行下，
否则它就是一份孤立证据（AGENTS §8.2）。同理，`AGENTS.md` §9 的 W8 行与
`docs/reference/environment-traps.md`（本文 §5 那两条事实够格入档）都由主检出所有者处理。
