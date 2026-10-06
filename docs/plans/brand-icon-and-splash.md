# 品牌图标与首屏动画（各端统一）

> 状态：🔄 **进行中**（图标：各端已落地并有门禁；首屏动画：web / Android / iOS 已落地，
> RN 内容层与桌面壳那一层**未做**；设备端取证**未做**）。
> 本文是这一轮的**唯一入口**：需求原话、普查、调研、判据、剩余边界都在下面。

## 1. 需求（产品负责人原话）

> 「把那个桌面的 logo 都换一下，我要求三个应用的 logo 必须是快捷方式，包括各种应用的
> logo 都应用上去。我发现完全没有，现在目前完全没有，包括那个首屏动画也需要统一。
> 我觉得你可以弄个首屏动画吧。搜索调研一下首屏动画应该怎么做。」

拆成两件可判定的事：

- **A 图标**：用户点开的那个方块（桌面/启动器/任务栏/快捷方式/主屏）必须是**我们自己的
  mark**，判据分三段 —— 文件存在 · 尺寸/格式对 · **被清单引用**。
- **B 首屏动画**：各端同一套设计语言的启动帧，且**不许挡住应用**。

## 2. 图标普查（三段判据，2026-10-04 现量）

| 端 | 引用它的清单 | 现状 |
|---|---|---|
| Web / PWA | `apps/web/public/manifest.webmanifest` 的 `icons[]`、`apple-touch-icon.png` | ✅ 品牌 mark（`gen-pwa` 从 token 生成） |
| 落地页 | `apps/landing/public/favicon.svg`、`og-card{,-en}.png` | ✅ 同一枚几何（原先是**另一枚**：圆底描边 h） |
| Android | `AndroidManifest.xml` 的 `android:icon="@mipmap/ic_launcher"` + `mipmap-anydpi-v26/ic_launcher.xml` | ✅ 五档位图 + 自适应图标（前景层按 66dp 保留圆）+ `monochrome` 层；改前是 RN 脚手架那张青色机器人 |
| iOS | `AppIcon.appiconset/Contents.json` | ✅ 同一入口生成（满幅不透明方底，圆角交给系统遮罩） |
| Windows | `Package.appxmanifest` 的 `Logo` + `.lnk` 的 `IconLocation` + csproj `<ApplicationIcon>` | ✅ 贴图改成提交物 + 打包时校验 IHDR；改前**桌面快捷方式那颗从来没有图标**（`Test-Path` 不成立就静默不设，而所有安装判据照样绿） |
| macOS | `package-app.sh` 用 `icon-512` 生成 `Heyta.icns` | ✅ |

唯一生成入口：`scripts/gen-app-icons.mjs`（几何来自 `packages/design-system/src/brand-mark.ts`，
色值来自 token）。产物**提交进仓库**，构建机不需要 `rsvg-convert`。

### 🔴 这一轮抓到的真缺陷：提交物里少了 Android 前景层

`c9fe6f56` 把 `foreground android:drawable="@mipmap/ic_launcher_foreground"` 写进了
自适应图标 XML 并提交，但**五档前景层 PNG 从没被提交**：

```sh
git ls-tree -r --name-only HEAD -- apps/mobile/android/app/src/main/res | grep -c foreground   # → 0
```

工作树里文件在、`gen-app-icons --check` 全绿、`pnpm check` 全绿 —— 因为它扫的是**工作树**
不是**提交物**。干净检出打 APK 会在 AAPT 阶段直接失败。本轮把这五枚补进提交，
并由 `scripts/check-brand-assets.mjs` 钉住（"在树上"用 `existsSync` 判工作树，
但引用关系判的是清单文件本身，见 §6）。

## 3. 首屏动画调研（结论 + 来源）

**三类做法，只有一类站得住：**

1. **加载型**（遮真实延迟）—— heyta 属于这类：冷启动要开 IndexedDB/SQLite、回放 op-log、
   可能还要解锁保险库，那些是**真延迟**。
2. **营销型**（卖内容 / 喊口号 / 放广告）—— Android 官方**明确劝退**：
   `windowSplashScreenBrandingImage` 存在，但文档写"不建议按设计指南使用品牌图"。
3. **假延迟型**（本来很快，硬撑 2 秒）—— 三家平台都反对。

**平台事实（决定了各端能做什么，别按 web 的想象设计）：**

| 平台 | 事实 | 出处 |
|---|---|---|
| Android 12+ | 启动屏由**系统**画，应用代码插不进去；只能配 `windowSplashScreenBackground` / `AnimatedIcon` / `AnimationDuration` 三个主题项；入场动画系统控制、**不可定制**；图标被自动遮成圆（圆外内容不显示）；**应用画第一帧时自动关闭** | [Splash screens \| Views](https://developer.android.com/develop/ui/views/launch/splash-screen) |
| Android 12+ | 动画时长**建议 ≤ 1000ms**（手机），起始延迟 ≤ 166ms；启动超过 1000ms 就**改用循环动画**，而不是把时长拍长 | 同上，"动画要求"一节 |
| iOS | 启动帧是 **launch storyboard**，在进程起来之前由系统渲染并截图缓存 ⇒ **静态图，做不出动画**；动效只能放在它**之后**那一层（RN 内容层） | [Responding to the launch of your app](https://developer.apple.com/documentation/uikit/responding-to-the-launch-of-your-app) |
| Web | `tokens.css` 打进 JS bundle ⇒ bundle 到货之前一个 `var(--ht-*)` 都解析不了；首屏那一帧的样式必须**自带字面值** | 本仓库实测（`main.tsx` 第一条 import 就是 tokens.css） |
| 无障碍 | 必须遵守 `prefers-reduced-motion`：压到 1ms 停在"画满的那一帧"，而不是循环 | WCAG 2.2.2 / tokens.css 已有的那条媒体查询 |

**由此定下的统一设计语言（各端同一套，不是各端各拍）：**

- 内容：**只有 mark，零文案**。启动帧在任何语言的 i18n 之前渲染 ⇒ 写任何文字都等于硬编码。
  （旧 iOS `LaunchScreen.storyboard` 正是反例：RN 脚手架留的 `Powered by React Native`
  + `boldSystem` 36pt 的 "heyta"。）
- 构图：主蓝圆角底板 + 白色「h」三道字形，与图标**同一枚几何** ⇒ 用户眼里
  "快捷方式那颗方块"和"打开时那一帧"是同一个东西在不同时刻的样子。
- 动效：三道字形依次"升起"（`scaleY`，各自包围盒为原点），入场后整块轻微呼吸循环。
- 时长：`enter 420 + stagger 90×2 + hold 200 = 800ms`，**由 Android 那条 ≤1000ms 推出来**，
  不是拍的；超过一个循环不延长时长而是循环。退场 260ms（退出比进入快）。

## 4. token（先加 token 再消费）

`packages/design-system/src/tokens.css` 新增，全部进 `TOKEN_GROUPS`：

| token | 值 | 为什么单独立档 |
|---|---|---|
| `duration.splash-enter / -stagger / -hold / -exit` | 420 / 90 / 200 / 260 ms | 受两条外部约束夹住（≤1000ms 上限、~300ms 可读下限），不是手感参数 |
| `z.splash` | 900 | 必须压得住首启的隐私同意面板与 Modal ⇒ 在阶梯**之上**，不插在中间 |
| `layout.splash-mark` | 6rem（96px） | 一帧**构图**的尺寸，不是功能图标尺寸，所以属 layout 不属 icon |

`prefers-reduced-motion` 块里四档时长各压到 1ms。
生成产物（`tokens.json` / `HeytaTokens.swift` / `.ets` / `.xaml` / `tokens.native.ts`）已重跑，
`pnpm check:tokens` ✅。

## 5. 各端落地

| 端 | 落点 | 形态 |
|---|---|---|
| Web | `apps/web/index.html` 的 `HEYTA-BOOT-SPLASH` 区（生成物）+ `apps/web/src/boot-splash.ts`（退场接线） | 完整入场/退场动画 |
| Android | `values-v31/styles.xml` 三个 `windowSplashScreen*` 项 + `values/heyta_splash.xml`（底色/时长来自 token）；主题拆成 `AppTheme.Base` + 叠加，避免同一个 `AppTheme` 两份逐字拷贝 | 系统帧（图标复用自适应前景层） |
| iOS | `LaunchScreen.storyboard`（生成物：mark 居中 + `HeytaSplashBackground` colorset 亮/暗两档） | **静态帧**（平台限制） |
| RN 内容层 | — | ⛔ **未做**（见 §7） |
| 桌面壳 | macOS / Windows 壳加载的就是 `apps/web/dist` ⇒ 随 web 那一帧一起生效 | 未单独取证 |

生成入口：`node scripts/gen-boot-splash.mjs`（`--check` 逐字节对账）。
它读的是 **tokens.css 的字面 CSS 值**（复用 design-system 自己那份解析器，
新导出 `extractVars / extractReducedMotion / resolveAllVars`），
不另写正则 —— 第二套解析器坏的方式是"静默搬错值"。

## 6. 判据与读数（本轮实测）

| 判据 | 载体 | 读数 |
|---|---|---|
| 产物 == token 生成物 | `gen-app-icons.mjs --check` | ✅ 31 份（尺寸 + 采样像素 / 文本逐字节） |
| 同上（首屏） | `gen-boot-splash.mjs --check` | ✅ 5 份，循环 800ms 由四档推导 |
| **被清单引用 / 被代码消费** | `scripts/check-brand-assets.mjs` | ✅ 23 条（含"退场已接线"、"接线早于任何一次 `root.render`"、"五档前景层**在提交物里**"、"iOS 启动帧零文案且不含 `Powered by`"、"刻意不设 brandingImage"） |
| ⚠️ 更正（2026-10-05，`5b67c944`）：本表原来那行写的是"22 条含**五档前景层在树上**"，而那条判据用的是 `existsSync` —— **标签量的是另一棵树**，它放行的正是 §2 举的那个事故（XML 已提交、PNG 从没提交）。现改走 `git ls-tree -r HEAD`，并加一条"资产目录里不许有未跟踪文件" | 同一个事故状态，两版判据各跑一趟（载体 = 隔离检出） | 旧实现 `RC=0 / 22 条 ✅`（放行了它）；新实现 `RC=1`，恰好两条：`前景层 xxxhdpi …不在 HEAD 里` + `资产：生成物全部已跟踪：1 个未跟踪资产文件` |
| 首屏那一帧真画得出来 | `e2e/tests/boot-splash.spec.ts` A（探针按住 `/src/main.tsx`） | ✅ 底板 `rgb(37,99,235)`、三道字形齐全、`animation-name: heyta-boot-rise`、`z-index: 900`；截图 `e2e/test-results/boot-splash-frame.png` **人已看** |
| 遮罩**从 DOM 摘掉**（不是隐藏） | 同 B（零拦截真实启动） | ✅ `#heyta-boot` 计数归 0；截图 `boot-splash-after.png` **人已看** |
| 变异：摘掉 `armBootSplashDismiss(container)` | 同上 | 🔴 **两条同时红**：门禁报"找不到调用点"、e2e B 在 `toHaveCount(0)` 上 16.5s 超时（遮罩盖住整屏） |
| 设计变量 / 文案 / 分层 | `check:design` `check:ui-language` `check:layering` | ✅ 无裸值；文案 3103/3103 成对；分层 9 条规则 |
| web 类型 | `pnpm --filter @heyta/web typecheck` | ✅ exit 0 |

### 🔴 看图照出来的一个真缺陷（已修）

第一版 `@keyframes heyta-boot-rise` 的 from 是 `opacity: 0; scaleY(0.2)`。
t=0 截图上**三道字形全透明**，画面只剩一块空蓝底板 —— 用户投诉的"完全没有 logo"
在我们自己生成的第一帧上原样复现，而 CSS 断言 22 条全绿（断的是"在不在、色对不对"，
不是"这一帧看不看得见"）。改成不透明度全程 1、只用 `scaleY(0.62 → 1)` 表达"正在被写出来"。

**可迁移的判据**：首屏这类"存在性"判据挡不住**不可见**—— 遮罩/入场的第一帧要按
"这一帧人眼读得出什么"来判，只能靠看图。

## 7. 剩余边界（没做的，别读成做了）

1. **设备端未取证**：本轮没有动模拟器/真机（5 台 booted 设备被别的会话占着）。
   Android 12+ 系统帧、iOS 静态帧**只有静态产物与代码级判据**，没有装机截图。
2. **RN 内容层的首屏动画未做**：iOS 的动效按平台事实只能落在 storyboard **之后**那一层，
   那一层需要一个宿主无关的 RN 组件（消费同一批 token 的 `duration.splash-*`）。
   本轮刻意没做：它要改 `apps/mobile/src/**`，那片正被并行会话重写。
3. ~~**`check-brand-assets` 还没有自动消费者**~~ ✅ **已接线（2026-10-04，`2b116072`）**：
   `package.json` 里加了 `"check:brand-assets": "node scripts/check-brand-assets.mjs"`，并把
   `pnpm check:brand-assets &&` 插在 `check:tokens` 之后（生成物对账紧跟 token 真源）。
   🔴 **当时那句"待接线的一行"本身是这条缺口存在的原因**：`pnpm check:gate-wiring` 抓不到
   "文件在、别名从来没写过"这种形态 —— 它枚举的是 **package.json 里定义过的门禁**，
   没定义过的目标根本不在它的枚举集合里，于是链外门禁可以既没有别名、也没有消费者，
   还让它自己报绿（§7 第 191 条同族）。现量：`--pkg <那笔的 package.json>` ⇒ 定义 80→81、
   链 83→84、rc=0。
4. ~~**`docs/plans/README.md` 的入口行**~~ ✅ 已补（同一批）；那条"该文件正被别人改着"的
   理由对**提交动作**成立、对**能不能写这一行**不成立 —— 混合文件按 hunk 取，
   别人那一行留在工作树里没被带走。
5. **暗色启动帧未实测**：`HeytaSplashBackground.colorset` 写了亮/暗两档（值来自
   `tokens.json` 的 dark 覆盖），但"暗色模式下不先闪亮板"要真机/模拟器切换外观才能判，属第 1 条。
6. **鸿蒙**：`apps/mobile` 下没有鸿蒙工程（壳未建），谈不上启动帧。
7. **PWA 挂载路径**：`/app/` 下 `manifest.webmanifest` 的根绝对路径图标在线上拿回的是
   落地页 HTML（AGENTS §9 已登记的未修项）。首屏这一帧因为**内联**不受它影响，
   但"装成 PWA 后图标对不对"仍被那条挡着。
