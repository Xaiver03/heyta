# W7 · 纪念卡片导出为成品图 —— 设备渲染与零出网判据

> 工单定义在 [`countdown-anniversary.md`](countdown-anniversary.md) §3 的
> `#### ⏹ W7 · 纪念卡片导出为成品图`；交接状态在
> [`countdown-batch2-handoff.md`](countdown-batch2-handoff.md) §0.5 的 W7 那一行。
> **本文只记 W7 这一单的实现状态、取证读数与缺口编号**，不替代那两份。
>
> 载体分支：`feat/countdown-w7`（worktree `heyta-wt-w7`）。
> 起点 `581bdb99` = 线协议契约（`packages/shared-schema/src/card-export-contract.ts`）
> + `packages/ui/src/countdown/model.ts` 的 `cardTextsFor`（卡片与成品图**共用**的措辞映射）。

---

## 1. 状态总览

| # | 工单要求 | 状态 | 读数在哪 |
|---|---|---|---|
| 1 | **先取证 RN 能不能出图**，再决定移动端形状 | ✅ 取证完成 ⇒ 结论是"**能栅格化、不能落盘**"，与工单前提不同；落盘那一环后来用**自建 60 行原生模块**闭合（当初估的两条代价都没兑现） | §2 |
| 2 | web 侧真的导出成品图（复用 `avatar-encode.ts` 的 canvas 形状与平台边界） | ✅ 代码 + 单测 + e2e 五条件证跑绿（1080×1440 真落盘、图人看过），六条变异臂全红 | §3 §4.3 §6.3 |
| 3 | 判据：导出全程**零网络请求**（真浏览器 + 正向对照） | ✅ 5 passed / rc=0：双计数器同时为零 + 页面自发的 `/api/*` 各 +1 + 载体 `SW=NONE` 实测 | §4 |
| 4 | "零法务变更"的**现量**复核（不是引用那句话） | ✅ 完成：`uses-permission` 声明数**前后都是 1（INTERNET）**、iOS plist/Podfile 零 diff、`NSPhotoLibrary*` 键 0 条，两条既有对账门禁 rc=0 | §5 |
| 5 | 移动端也真导出（原工单的"成品图"不分端） | ✅ **两端真机 IHDR 读数都取到了**（Android 04 13:20 `RC_ANDROID=0`；iOS 04 17:13:17 `RC_PROBE=0` ⇒ `1080×1440`，W7-G2 那条"折算仍是推的"随之闭合）；🔴 **Android 那趟当场过期**：让帧修复改了 `card-export-units.ts`，要在新树上重取 —— ⚠️ **04 18:1x 重取已开跑并以环境无效收口**：装包 `RC_REINSTALL_ANDROID=0`（17:57:21）／探针 `RC_ANDROID=3`（18:12:23，等满**默认 900s**、负载 164），补跑在链 T2（显式 3600s + 先重装）。**这一行在补跑取到读数前只能算"iOS 端已到最终态、Android 端装包绿而出图未取到"**，缘由见 `countdown-anniversary.md` §8.4 ㊢ | §2.4 §7 |


---

## 2. 🔴 取证：RN 出图能 / 不能（结论比工单前提更细，而且方向相反）

工单原文写的是「缺的是**栅格化**（全仓无 `toDataURL`/`toBlob`/`react-native-view-shot`/Skia）」。
前半句（全仓没有）是真的，后半句（所以缺栅格化）**被现量否证**：
**已装的 `react-native-svg@15.15.5` 自带双端原生栅格化出口**，不需要新依赖。
真正缺的是**把字节落盘 / 交出去**那一环。两条都要报，所以取证分三小节的命令与读数。

### 2.1 [A] 全仓（排除 `node_modules`）的栅格化 API 现量

```bash
grep -rn "toDataURL\|toBlob\|react-native-view-shot\|captureScreen\|takeSnapshot\|react-native-skia\|PageRenderer" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" \
  --include="*.swift" --include="*.java" --include="*.kt" --include="*.mm" --include="*.m" \
  packages apps server scripts | grep -v node_modules
```

读数（命中 13 行，去掉 landing 测试的 `PageRenderer` 噪声后是这些）：

| 位置 | 是什么 |
|---|---|
| `apps/web/src/features/settings/avatar-encode.ts:85` | `canvas.toDataURL(contentType, …)` —— **全仓唯一一条产品级栅格化通道**（Web） |
| `apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift:214` | `webView.takeSnapshot(with:config)` —— macOS 壳，**目前只在验收探针里用** |
| `scripts/check-macos-window.mjs:242` | 同上（门禁侧的注释） |
| `apps/landing/tests/*` | `installPageRenderer`，与本单无关的同词命中 |

⇒ `packages/**` 与 `apps/mobile/src/**` 里**一条栅格化调用都没有**：工单这句成立。

### 2.2 [C] `react-native-svg` 的原生 `toDataURL`：**双端都在**

| 环节 | 文件:行 | 事实 |
|---|---|---|
| JS 侧 API | `apps/mobile/node_modules/react-native-svg/src/elements/Svg.tsx:84-93` | `toDataURL(callback, options)` → `RNSVGSvgViewModule.toDataURL(findNodeHandle(this.root), options, cb)` |
| TurboModule spec | `…/src/fabric/NativeSvgViewModule.ts:8-15` | `toDataURL(tag, options?, callback?(base64))`，`getEnforcing('RNSVGSvgViewModule')` |
| **Android 实现** | `…/android/src/main/java/com/horcrux/svg/SvgViewModule.java:36-74` → `SvgView.java:365-377` | `Bitmap.createBitmap(width, height, ARGB_8888)` → `drawChildren(new Canvas(bitmap))` → `CompressFormat.PNG, 100` → `Base64.NO_WRAP` |
| **iOS 实现** | `…/apple/RNSVGSvgViewModule.mm:41-55` → `apple/Elements/RNSVGSvgView.mm:384-408` | `UIGraphicsImageRenderer(initWithSize:bounds.size)` → `drawRect:` → `UIImagePNGRepresentation` → base64 |
| Web 实现 | `…/src/elements.web.ts:253-281` | `XMLSerializer` → `Image` → `canvas.toDataURL()`（**同一份 JS 三端都有出口**） |
| 依赖状态 | `apps/mobile/package.json`（`react-native-svg 15.15.5`）；`Podfile.lock` 已 pod 已链接；`pnpm` 实装路径 `apps/mobile/node_modules/react-native-svg` | ⇒ **不需要新过 AGENTS §3.1/§3.2 两道门** |

**Android 的读数恰好等于契约**：`createBitmap(width, height, …)` 用的是**像素**，
所以 `toDataURL({ width: EXPORT_CARD_EDGE_PX, height: EXPORT_CARD_HEIGHT_PX })` 出来就是
1080×1440，与 `EXPORT_CARD_SIZE` 逐字相同。

🔴 **iOS 不是**：`UIGraphicsImageRenderer -initWithSize:` 的默认 `scale` **是屏幕 scale**，
`bounds.size` 是 **point**。真机 3× 下同一句调用产出的是 **3240×4320 px**，
而契约里的 `EXPORT_CARD_SIZE` 是像素对账用的那一对数
（`card-export-contract.ts` 文件头明写"尺寸是判据要数的东西"）。
⇒ **同一份 JS 在两端导出不同尺寸的图**，而这一单要防的正是这个（AGENTS §3.5 的教训同型）。
这条不是"能不能做"，是"做出来的对不对" —— 登记成 **W7-G2**（§2.4）。

### 2.3 [F] 落盘 / 交出去：**当前依赖 + 本单地界内不存在这条通道**

| 探测 | 命令 | 读数 |
|---|---|---|
| 移动端全部原生方法 | `grep -rn "@ReactMethod" -A1 apps/mobile/android/app/src/main/java/com/heytamobile/` | 6 条：`WidgetModule` 5 条（小部件快照/意图队列，**不接受任意字节**）+ `LocalFsModule.kt:40 readTextUri` —— **只有一个"读"，没有任何"写"** |
| RN 核心有没有文件写入 | `ls apps/mobile/node_modules/react-native/Libraries/` | 46 个目录，**没有** `FileSystem`/`CameraRoll`（后者 RN 0.60 起已拆出核心） |
| `Share` 能不能直接吃 base64 | `apps/mobile/node_modules/react-native/Libraries/Share/Share.d.ts:13-25` | `ShareContent = { url: string } \| { message: string }`。`url` 要**真实文件 URI**；`message` 是纯文本 ⇒ base64 只能作为**文本**分享（不是成品图） |
| 现存的分享通道 | `apps/mobile/src/screens/ExportScreen.tsx:344` | `Share.share({ title, message: content })` —— 备份导出走的是**文本**分享面板，与本单不是同一件事 |
| 只读选择器 | `apps/mobile/package.json`：`@react-native-documents/picker 12.0.2` | 它是**选择器（读）**，不是保存器 |

⇒ 要闭合缺口需要**新增一个写文件的原生模块**（Android `FileProvider` + iOS pbxproj 里加 `.m/.swift`），
两件都**不在本单允许的文件面**（本单只允许 `apps/mobile/src/**`），
而且新增第三方 `react-native-fs` 一类要先过 AGENTS §3.1/§3.2 两道门并逐项登记 ——
**默认应该是"不加"**。

🔴 还有一条**必须先于代码存在**的闸门：成品图一旦写进系统相册，
`packages/legal/src/documents/permissions.ts` 那句「heyta **不申请** … **照片** … 权限」**当场变成假话**
（计划 §8.2 L' 第 1 条把这条明确登记为 **W7 的前置闸门**）。
本单**没有**申请任何权限、**没有**新增任何 manifest 项 —— 所以那句仍然逐字为真（现量见 §5）。

### 2.4 缺口登记（编号沿用文档里 `W4-UI` 的命名风格）

| 编号 | 缺口 | 为什么现在不做 | 闭合判据 |
|---|---|---|---|
| ~~**W7-G1**~~ | ~~移动端成品图落盘/分享通道不存在~~ ⇒ **闭合**：`HeytaCardExport`（Android `CardExportModule.kt` + iOS `HeytaCardExportModule.swift`）接受 base64、写进**自己的缓存目录**、回一个 `content://`（Android）/ `file://`（iOS）URI，`card-export.tsx` 拿它接 `Share.share({url})`；**两端真机 IHDR 读数都取到了**（Android 04 13:20、iOS 04 17:13:17 ⇒ `1080×1440`） | —— 没有新依赖、没有新权限（现量见 §5 [E2]/[E3]/[E5]），所以当初写的"闭合代价"那两条（要过 §3.1/§3.2、要申请照片权限）**都被现量否证了**：自建一个 60 行的原生模块就够了 | 判据原文"真机点一次「导出成品图」，把那张 PNG 拉回宿主机，数出 IHDR 宽/高 == `EXPORT_CARD_SIZE`"：**两端各自达成**（读数在 `apps/mobile/evidence/card-export/README.md`，图都打开看过并与另一端并排比过） |
| ~~**W7-G2**~~ | ~~**iOS 那端的尺寸口径仍然没有真机读数**~~ ⇒ **04 17:13:17 闭合**：折算通道不只是"写进了代码"，它**画出来的字节就是契约值**。同一趟探针第 6 格打印 `W=1080 H=1440 BYTES=64619 TRANSPARENT=false BLANK=false SMEARED=false SHA=13e10d6cde3b`，与 `EXPORT_CARD_SIZE` 逐字相同（`rasterScaleFor(density) = EXPORT_CARD_SCALE / PixelRatio.get()` 这条推的公式**被量到了**，不再是推的） | 折算公式是从 §2.2 读到的 `UIGraphicsImageRenderer` 默认 `scale = screen scale` 推的，而**这一趟把它换成了实测**：探针 `scripts/verify-mobile-card-export-ios.sh` 在 iPhone 17 Pro 模拟器（`heyta-batch2-closeout`，`919C5F50-…`）上从设备沙盒拉回那串字节，用与 Android 同一台读数器数 IHDR；同一趟还带了一条**反向对照**（`probe-3x2.png` 读出 `3×2 BLANK=true`）证明读数器会区分，不是恒返回契约值 | 判据原文要求"两端各导一张，数出来的 IHDR 逐字等于 `EXPORT_CARD_SIZE`"：**iOS 这半已达成**；Android 那半 13:20 达成过，但让帧修复改了 `card-export-units.ts` ⇒ 那一趟在新树上过期，见 W7-G6b 的代价栏 |
| ~~**W7-G3**~~ | ~~本检出没有移动端倒数日界面~~ ⇒ **已不成立**：`apps/mobile/src/screens/CountdownScreen.tsx` 在本检出里存在（W8 移动半的产物），导出动作已挂进它的卡片二级操作 | 原判断的依据是当时 `ls apps/mobile/src/screens \| grep -i countdown` 0 命中；载体现在有了，那条前提原地作废 | 「导出成品图」出现在卡片菜单里（代码级已由 `apps/mobile/tests/card-export.spec.ts` 的 `CountdownScreen` 接线判据钉住）；剩下的仍是 G1 的真机读数 |
| **W7-G4** | **RN 侧的折行是估算的**：`react-native-svg` 没有同步文本测量 API，`<Text>` 也不接受 `numberOfLines`，所以共享层的 `wrapCardText` 在 RN 那一端拿到的 `measurer` 是 `estimateAdvance(fontSize)`（按"每个码点 ≈ 0.55 em"估） | 真要精确只能异步 `measure`（会把"点导出"变成两段异步），或引 Skia（新过 §3.1/§3.2 两道门）。本单选了"不加依赖 + 估算"，代价是把这条差异**登记出来**而不是藏进注释 | 量一次真机导出图上的标题是否被提前/延后截断（同一段文字与 web 那张逐行对比）；偏了就把 `estimateAdvance` 的系数按端量出来定标，或改成异步 `measure` |
| ~~**W7-G6**~~（**框架已被下面的 W7-G6b 改写**：那一格猜的"15 s 不够 ⇒ 高负载假红"在 04 16:44 被实测否证 —— 红的那趟回调**永远没来**，超时只是把它折成一句人话。这一格主张的"没有实测依据"仍然成立，但它担心的那个后果不是缺陷的形状） | **`RASTERIZE_SETTLE_MS = 15_000` 这个上限没有实测依据**（`apps/mobile/src/lib/card-export-units.ts:65`）：RNSVG 的 `toDataURL` 回调可以永远不来，那条等待被 `settleRasterize()` 折成一个值，但"等多久算等不到"这个数是拍的 | 拍的方向是**安全的**（超时报错而不是静默出一张空图 ⇒ 只会造成假红，不会造成假绿），所以它不是正确性缺陷；但它也不是一台真设备上量出来的，负载高的模拟器上 15 s 可能不够，那时会看到一条"导出失败"其实栅格化还在跑 | 从设备读数定这个值：`verify-mobile-card-export*` 打出**点击到落盘的实际耗时**（两端各若干次，含高负载那一档），把上限取成观测 P95 的一个倍数并在注释里写清是哪一趟；**⚠️ 本轮不动它**：改 `card-export-units.ts` = 改移动侧打包输入 ⇒ 已取到的 Android 设备读数（§8.4 ㊔ 那一行）当场失效，要连模拟器一起重跑，而模拟器正被另一条会话占着 |
| 🔴 **W7-G6b** | **W7-G6 的框架在 04 16:4x 被实测改写**：那一格猜的是"15 s 不够 ⇒ 高负载下假红"，今天 iOS 上量到的**不是不够，是回调永远不来** —— 设备日志 `Invalid svg returned from registry, expecting RNSVGSvgView, got: (null)`（`RNSVGSvgViewModule.mm:31` 那条 `RCTLogError + return` 不回调），界面上出的是那句诚实的 `rasterize-timeout` | 超时那条**按设计工作了**，它不是缺陷；缺陷在调用时机（effect 跑在原生挂载事务刷到主队列之前）。修法是"让出一帧再问原生要图"（`afterNextFrame`，调度器注入 + 三条判据），**不是**再拍一个更长的毫秒数 | ✅ **闭合（04 17:13:17 `RC_PROBE=0`，17/0）**：让帧之后同一台设备上那条 `(null)` 没有再出现，沙盒里写下 `heyta-w7ios-170457-10月11日 星期日.png`，IHDR = 契约。两次运行之间**唯一变化的就是那一次 `afterNextFrame`**（同设备、同签名态、同探针）⇒ 这是根因被证实，不是"再试一次碰巧绿"。⚠️ 代价按 W7-G6 自己写的规矩结算：改了 `card-export-units.ts` ⇒ **Android 那一趟读数（§8.4 ㊔）当场过期**，要在新树上重取一次才算两端 |
| **W7-G8** | **另两座 iOS 桥的 JS 名与类名不同名**：`HeytaWidget`（JS 名）/ `HeytaWidgetModule`（类名）、`HeytaReminder` / `HeytaReminderModule` —— 与 `HeytaCardExport` 那条已修的红是同一个 `RCT_EXTERN_MODULE` 展开形状（原登记时误占 **W7-G5**，与上面那条 tnum 缺口撞号，15:4x 改占 G8；四座桥里只有 `HeytaVaultSecureStorage` 因"JS 名 == 类名"侥幸对得上） | 各有所有者（小组件 / 提醒两条线），本批不跨线改；`check:card-export` 那条"模块名三处逐字相同"的判据只覆盖卡片这一座 | 逐座桥跑一次**只读取名探针**（JS 侧 `NativeModules[名] !== undefined`）；或由那条门禁扩成"扫全部 `RCT_EXTERN_*_MODULE` 并核对三处"，扩了就要按 §8.4 ㊱ 那三臂各量一次 |
| **W7-G5** | **RN 那一端没有等宽数位（`tabular-nums`）通道**：canvas 侧走 `fontFeatureSettings: '"tnum"'`（web 已实现），而 RNSVG 的 `Text` 不接受 `fontVariant`，也没有 `fontFeatureSettings` | 不是漏写，是**上游没有这个 prop**（读 `react-native-svg/src/elements/Svg.tsx` 与 `apple/RNSVGSvgViewTextAttributes.*` 现量：只有 `fontVariant`-系字重/族/字号，无 OpenType feature）。绕它要走 `textTransform`-式的自研排版 | 两端图上那行数字的位宽对得齐（实测同一串"888"与"111"的字宽差在阈值内），或接受差异并把差异写进契约注释 |


**桌面原生壳不是缺口**：macOS / Windows / Linux 壳加载的是**同一个** `apps/web/dist`
（W8 事实：`MainWindow.xaml.cs:67-71`「有 `web-dist` 就是 `app` 模式」、macOS `HeytaMacApp.swift:361` 自定义 scheme 服务 `web-dist`）
⇒ §3 的 web 导出**自动**进这三个壳，不需要原生重写。macOS 的 `takeSnapshot` 那条通道**本单不用**：
它截的是**整个 WebView**（含 rail 与顶栏），不是契约要的那张 3:4 卡。

### 2.5 取证命令（可复跑）

```bash
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-w7"
# [F6] 本检出有没有移动端倒数日界面
ls apps/mobile/src/screens/ | grep -i countdown; echo "rc=$?"          # 期望：无输出、rc=1
# [F5] 移动端原生方法全集（找"写"）
grep -rn "@ReactMethod" -A 1 apps/mobile/android/app/src/main/java/com/heytamobile/ | grep "fun "
# [C] react-native-svg 的原生栅格化（三端）
grep -rn "toDataURL" apps/mobile/node_modules/react-native-svg/src/elements/Svg.tsx \
  apps/mobile/node_modules/react-native-svg/android/src/main/java/com/horcrux/svg/SvgView.java \
  apps/mobile/node_modules/react-native-svg/apple/Elements/RNSVGSvgView.mm
```

---

## 3. web 半：把成品图真的导出来（✅ 代码与单测半闭合）

形状沿用 `avatar-encode.ts` 的分界：**数字住契约、版面住共享层、怎么画住壳**。

| 文件 | 职责 | 状态 |
|---|---|---|
| `packages/ui/src/countdown/card-export-layout.ts` | **唯一的版面生产者**：`buildCardExportLayout(request, rasterScale)` 产出绘制指令 `ops`，加 `wrapCardText`（按 measurer 折行）、`estimateAdvance`（RN 那端的估算尺子，缺口 W7-G4）、`cardExportFileStem/Name` | ✅ |
| `packages/ui/src/node.ts` | **免 RN 的边界入口**：只 re-export 无 `react-native` 的那几项（`@heyta/ui` 主入口在 `theme.tsx:46` 运行时 import RN，node 里 import 会撞 `RolldownError: Flow is not supported` ⇒ 纯布局模块"在库里却进不去"） | ✅ |
| `apps/web/src/features/countdown/card-export.ts` | **画师**：`ops` → `<canvas>` → `toBlob(EXPORT_CARD_CONTENT_TYPE)` → `<a download>` 点击。`rasterScale` 传 `EXPORT_CARD_SCALE`（canvas 1 单位 == 1 px），**一个裸值都不写** | ✅ |
| `apps/web/src/features/countdown/CountdownView.tsx` | 宿主接线：`onExportCard` → 从 `useHeytaUiTheme()` 交**整套** `tokens`/`text` + 强调色（模板 = 分类色板那一格，没选过就是 `color.surface-sunken`）+ `dateStem: texts.date` | ✅ |

三条实现纪律（都是本仓既有裁决，不是新发明）：

1. **不重新发明排版**：字号/行高/间距/圆角全部取主题表的语义样式，再乘 `rasterScale`
   ⇒ 成品图与屏幕卡是**同一套 token 的整倍放大**，暗色主题跟着走（判据在 §4 那条"暗色"用例）。
2. **措辞不许再写一遍**：那四段话来自共享层 `cardTextsFor`。
3. **零网络**：画布、`Blob`、`URL.createObjectURL` 全在本机；不引 `html2canvas` 一类。
4. 🔴 **两端共一张版面**：`check:card-export` 的 A2/A3 钉的就是这个 ——
   布局定义在 `packages/ui` 下**恰好一处**，两份画师都必须 import 它、且不许自定义
   `CardExportDrawOp`。第二张版面只有人眼看得出，而"预览一套导出另一套"正是本单要防的事故。

---

## 4. 判据：导出全程零网络请求（✅ 载体已落地）

### 4.1 载体选择（🔴 这条决定了"零"是不是恒真）

`apps/web/src/pwa/register.ts` 在 `!import.meta.env.PROD` 时直接 return ⇒
**dev 载体里根本没有 SW**。这不是缺陷而是要件：本单要证的是"**导出这条路不发请求**"，
需要的是**分类器抓得到**；以"会被拦掉"作载体等于让"零"预先成立。
所以这一支跑在主配置（`vite dev` @ 4318），并把 SW 状态**实测打印**出来当载体证据。

🔴 探针**抽成了单一所有者** `e2e/tests/net-egress.ts`（`trackEgress` + `installInPageNetCounter`
+ `readInPageNetCounts` + `swState`），并把 `privacy-consent-zero-egress.spec.ts` 里那两份本地副本
**删掉改 import**。理由：两侧要用**同一套**分类规则数"零"，抄两份的话一侧加了类别
（比如又冒出一条走 `/api/` 的路径），另一侧继续按旧规则数出"零" —— 那是承诺悄悄变宽。

### 4.2 🔴 §7 第 4 条的回答：**SW 拦掉的那部分不算"浏览器真发出去的"，但必须被单列**

- **判据的载体是"浏览器真发出去的"**（`page.on('request')`，CDP Network 域），**不是**页面
  `fetch` 调用数 —— 调用数会被 SW/`page.route` 消化，拿它自证清白等于用一层会被拦截器
  改写的计数当事实源。
- **但"零"不许因为看不见就算成立**：另挂一支**页内**计数器（`addInitScript` 包
  `fetch` / `XMLHttpRequest.open` / `WebSocket` 构造 / `navigator.sendBeacon`），
  两支**同时**要求为零。页内不为零而分类器为零 ⇒ 有东西把请求吞了 ⇒ 判**红**。
- **正向对照**（承重的 `:16-30`）：页面主动 `fetch('/api/card-export-probe')`，
  要求分类器与页内计数器**各 +1**；少任何一个，前面那些"零"都不成立。
- `WebSocket` 用 `Proxy` 的 `construct` 而不是自写构造函数：后者要手工搬
  `CONNECTING/OPEN/CLOSING/CLOSED`，漏一个就把 vite 的 HMR 客户端弄成"永远不等于 OPEN" ——
  探针把被测对象弄坏是最难查的一类假红。
- `readInPageNetCounts` **读不到就抛**，不返回 0：返回 0 会把"探针没装上"读成最干净的读数。

### 4.3 用例与读数（`e2e/tests/countdown-export.spec.ts`，5 条）

| # | 用例 | 数什么 |
|---|---|---|
| 1 | 🔴 尺子先自检 | 浏览器现做一张 3×2 洋红 PNG → `inspectPng` 必须数出 3×2；同一支 `countColor` 命中色=6 个采样点、"只差一个通道"的颜色=0（容差判据自己不能有牙口缝） |
| 2 | 🔴 正向对照 | 页面自己发一条 `/api/*` ⇒ 分类器 ≥1 **且** 页内 `fetch` 恰好 +1；顺带打印并断言载体 SW = `NONE`（dev 无拦截器） |
| 3 | 导出这张图 | 点击→落盘这一趟：新请求 `[]`、页内调用差 `0`、新 socket `[]`；`suggestedFilename() == heyta-<标题>-<屏上那行日期>.png`；IHDR 逐字 == 契约；`looksBlank`/`looksSmeared` 为假、无透明像素；底色与卡面两格命中**这台浏览器解析出来的** token 色，洋红命中 0 |
| 4 | 暗色主题跟着走 | 先量"切了暗色而底色 token 真的变了"（前提），再导一张：暗色底命中 > 0、亮色底命中 **0**、两文件 sha256 不同 |
| 5 | 导不出来必须上屏 | `getContext` 按开关返回 `null`（只给导出这块画布下绊子）：`event-export-error` 出现且文字 == i18n 真源那条、**没有** download 事件、失败路径两支计数器仍为零 —— 那句措辞"也没有发出任何请求"是对行为的承诺，由计数器核 |

跑法与读数（2026-10-04 00:41 与 00:5x 两趟，载体 = `feat/countdown-w7`）：

```bash
cd e2e && NO_COLOR=1 npx playwright test tests/countdown-export.spec.ts --reporter=list
```

- 第一趟 **2 红 3 绿**，两条红都不是产品坏了：① 正向对照那台设备选了「只用本机」，
  而 `consent-gate.ts:179` 把 `globalThis.fetch` 换成带闸门的实现、闸门装在页内计数器
  **外面** ⇒ 对照那条请求根本没出去；② 同一张卡**连导两次**时第二次点 `⋯` 把已经开着的
  菜单**关掉**了（那个按钮是 `onPress={() => onOpenMenu(!menuOpen)}` 一个开关）。
  两条都当场修掉：对照走「同意并联网」，`openCardMenu` 改成**按 `aria-expanded` 决定点不点**
  （回显已展开时断言"动作真在"，不盲点）。
- 第二趟 **5 passed / rc=0**（14.3s）。载体读数：`SW=NONE`、
  `sockets=1 ["ws://127.0.0.1:4318/?token=…"]` —— 🔴 那个 socket 是 vite 的 HMR，
  它被 `page.on('websocket')` 数到了，所以"导出这一趟新增 socket = 0"不是恒真，
  探针看得见 socket 这件事**是量出来的**，不是假设的。
- 成品图两张（1080×1440，亮/暗各一）+ 界面两张 + 失败上屏一张，**人都看过**
  （`/tmp/heyta-card-export-results/`，另附一张 1:1 裁切的标题带，用来排除
  "看图时以为字是重影的" —— 那是查看器降采样，1:1 下笔画干净）。
- 🔴 顺带修掉一条**本分支自己带进来的门禁红**：`check:ui-language` 在 `en.ts` 上报
  "看起来像词条的行有 2886 行，只解析出 2885 条" —— 原因是 `79e116cf` 把
  `web.countdown.export.failed` 那条英文写成了**跨行**，而那张表要求"一行一条"。
  全文件只有这一条跨行（现量：`grep -n "':$" en.ts` 只命中它）。收成一行后 rc=0。
  这条值得留着是因为形状：`pnpm -r test` 与 `typecheck` 都抓不到它，
  只有那道"解析器不许静默漏行"的门禁抓得到 —— 而那正是它存在的理由。

- 看图另抓到一条**措辞缺陷**：失败那一句写的是「**任务**数据没有丢」，而这一屏是倒数日。
  已改成「倒数日没有丢」，与移动侧 `mobile.countdown.export.rasterize` 同一口径
  （zh 一处，en 那句本来没带名词）。


---

## 5. ✅ "零法务变更"的现量复核（读数 2026-10-04 00:3x，载体 = `feat/countdown-w7` @ `220bfa0c`+）

```bash
cd "/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-w7"
# [E0] 本单的文件面（三笔 W7 提交）
git show --name-only --pretty=format: 3b143953 79e116cf 220bfa0c | sort -u | grep -v '^$'   # 29 个文件，无 packages/legal
# [E1] 导出路径上零网络 API —— 由门禁现量
node scripts/check-card-export.mjs            # rc=0；A4 逐个点名 10 个源文件，同趟喂一条 3 命中样本
# [E2] Android 权限声明：**按声明形状**数，不按"提到 uses-permission 的行"数
git show 3b143953^:apps/mobile/android/app/src/main/AndroidManifest.xml | grep -c '<uses-permission android:name'   # 1
grep -c '<uses-permission android:name' apps/mobile/android/app/src/main/AndroidManifest.xml                          # 1（INTERNET）
# [E3] iOS：Info.plist / Podfile / Podfile.lock / .entitlements 零 diff；只新增了两个源文件 + pbxproj 的 8 行
git diff --stat 3b143953^..HEAD -- apps/mobile/ios/Heyta/Info.plist apps/mobile/ios/Podfile apps/mobile/ios/Podfile.lock
git diff --name-only 3b143953^..HEAD -- apps/mobile/ios
# [E4] 两条既有对账门禁
node scripts/check-legal-permissions.mjs      # rc=0
pnpm check:legal-copy                         # rc=0
```

读数（每条都是这一趟现量，不是引用工单那句话）：

| 项 | 读数 |
|---|---|
| [E2] Android `<uses-permission>` 声明条数 | 本单**前 1 条 / 后 1 条**，清单仍是 `[INTERNET]`。🔴 第一版命令写成 `grep -c '^+.*uses-permission'` 数出 **1** —— 那是我自己那段注释里的 `<uses-permission>` 字样，**声明形状**（`<uses-permission android:name`）才是 0 新增。注释会骗人，这条按形状数 |
| [E3] iOS `Info.plist` / `Podfile` / `Podfile.lock` | `git diff --stat` **零输出**；iOS 侧改动只有 `HeytaCardExportModule.swift` + `HeytaCardExportModuleBridge.m` + pbxproj 那 8 行 |
| [E5] 相册类**声明形状** | `uses-permission READ_MEDIA*/ACCESS_MEDIA*/WRITE_EXTERNAL*` = **0**；`NSPhotoLibrary*` 键在 `Info.plist` = **0**。正向对照：同一条正则喂确实存在的 `INTERNET` 声明数出 **1**（不是恒 0）。⚠️ 按"词在不在文件里"数会得 **2** —— 那两行是新文件里解释"为什么不走相册"的注释 |
| [E4] `check-legal-permissions` | rc=0，原文打印：`Android 声明 1 条 [INTERNET]、NS…UsageDescription 0 条、句子项数 zh=9 en=9、登记表 9 项、REVIEWED_REQUESTED 0 项、通知授权 未声明（六个承诺位置命中 6/6）` |
| [E4] `check:legal-copy` | rc=0（`法律文本站点文案与 @heyta/legal 一致`） |

⇒ `packages/legal/src/documents/permissions.ts` 那句「heyta **不申请** … **照片** … 权限」
在本单之后**仍然逐字为真**，而且这不是靠"我没改那个文件"成立的：声明面（Android 1 条 / iOS 0 条）
与那九项"不申请"由门禁**对账**。W7 那条前置闸门（计划 §8.2 L' 第 1 条）到此有答案了 —— **不变**。

---

## 6. 变异臂清单（每条判据都要能失败）

### 6.1 ✅ 门禁 `check:card-export` 四臂（2026-10-04 00:1x，载体 = 本 worktree）

| 臂 | 改哪一行 | rc | 打印出来的红 |
|---|---|---|---|
| 对照 | 什么都不改 | **0** | 四臂全过（红集为空） |
| A1 | 往 `packages/ui/src/node.ts` 引的文件链上加一个 import `react-native` 的模块 | **1** | `@heyta/ui/node 在 node 里加载不了 —— 这条入口被人加了带 react-native 的文件` |
| A2 | 把一份布局定义复制进 `apps/web/src/features/countdown/card-export.ts` | **1** | `定义点应是 1 个，实测 2 个：[packages/ui/src/countdown/card-export-layout.ts, apps/web/src/features/countdown/card-export.ts]` |
| A3 | 在 `apps/mobile/src/lib/card-export.tsx` 里自定义一个 `CardExportDrawOp` | **1** | `apps/mobile/src/lib/card-export.tsx 自己定义了 CardExportDrawOp（第二套版面形状）` |
| A4 | 在 web 画布里塞一条 `fetch(` | **1** | `apps/web/src/features/countdown/card-export.ts 里出现了网络/动态加载调用：["fetch("]` |

四臂之后被改文件**逐字节还原**（`md5 -q` 与变异前对照相同）。
A4 那条还带一支**尺子自检**：门禁自己数一条已知含 3 次命中的样本，数不出 3 就红。

### 6.2 ✅ 单测层的臂（`apps/mobile/tests/card-export.spec.ts`，21 条 —— ⚠️ 04 18:3x 现量已是 **29 条**：`Tests 1 failed | 28 passed (29)` 是从变异臂那一趟直接读到的分母，本行不重推 21→29 的差额构成）

密度折算那条量的是"三档 density（1 / 2 / 2.625 / 3）各自乘回去逐字等于契约"，
所以任何一侧改倍率而另一侧没改会红；`no-module` 那条把"这台设备没装组件"与"导出失败"
分开（`writeCardPng` 返回 `error: 'no-module'`）；两条 ledger 判据钉
`HeytaCardExport` 这个名字在 Kotlin / Swift / TS **三处一致**，以及
`DIR_NAME`（Swift）与 `card_export_paths.xml` 的 `path="card-export/"` 一致、
manifest 的 authority 与 Kotlin 拼出的 `${packageName}.fileprovider` 一致。

### 6.3 ✅ e2e 那五条件证的变异臂（2026-10-04 00:5x，rig = `research/tools/mutate-w7-e2e-arms.mjs`）

**未变异对照先立住**：`CONTROL rc=0 green=5`（五条件名逐条数得出来）。
少了这一条，下面每个 `red: []` 都可能只是"解析器没匹配上"—— 第一趟就正好撞上了这个：
list reporter 的 `✘` 前是**两个**空格而正则要求一个，加上没关 ANSI，五臂全被读成
"rc=1 但红集为空"（§7 第 163 条同一个坑的第三种面目）。

| 臂 | 改哪一行 | rc | 红的那条 | 打印出来的第一行报错 |
|---|---|---|---|---|
| M1 尺寸翻倍 | 画师里 `EXPORT_CARD_SCALE` → `* 2` | 1 | 导出这张图 | `导出的图是 2160×2880，契约要的是 1080×1440` |
| M2 路上发一条 XHR | `appendChild(anchor)` 前插 3 行 XHR | 1 | 导出这张图 | `导出这一趟浏览器真发出了请求：[{"url":"/api/mutated-into-export-path","method":"GET"}]` |
| M2b 路上 fetch 一条 | 同一处插一句 `void fetch(...)` | 1 | 导出这张图 | `pageerror: privacy-consent-not-granted: … 拒绝发起任何请求` |
| M3 页内计数器不装 | `installInPageNetCounter` 开头 `return;` | 1 | 正向对照 | `页内网络计数器没有装上（…）` —— 抛，而不是给一个 0 |
| M4 失败被当成成功 | `no-canvas` 那行改 `ok:true` | 1 | 导不出来必须上屏 | `拿不到画布时界面必须说话（失败静默吞掉是便签那条高危）` |
| M5 主题不参与绘制 | 宿主传的 `tokens['color.background']` 钉成亮色 | 1 | 暗色主题跟着走 | `暗色成品图里没有暗色底 —— 导出没跟着主题` |

六臂之后被改文件**逐字节还原**（`restored: true`），工作树现量残留 0 命中。

🔴 **M2b 把我自己写下的预期否证了**，而且否证的方向值得记：我预判"fetch 版会存活，
因为产品的同意闸门装在页内计数器外面，请求根本发不出去"。实测它**也红了** ——
但红在**另一条腿**：闸门抛的那个 `pageerror` 被用例里的控制台断言接住了。
⇒ 两条一般规律：**(a)** "变异会存活"是一个**关于判据集合**的断言，不关于单条断言，
预判之前要先问"这一趟还有谁在看"；**(b)** 想验"零出站"这条腿有没有牙，
必须用**不经产品闸门**的通道（XHR / beacon），fetch 版验的是闸门、不是腿 ——
所以 M2 与 M2b 是**两条不同的臂**，都要留。

### 6.4 ✅ "问原生要图之前先让出一帧"那三条判据的臂（04 18:32:30–18:32:34，负载 18）

这三条是 17:1x 那次 iOS `rasterize-timeout` 修完之后**新加**的（`c313914f`），§6.2 那句"21 条"也随之过期 ——
现在这个 spec 是 **29 条**。每条臂改一处、跑 `NO_COLOR=1 npx vitest run tests/card-export.spec.ts`，
读数都是 **`Test Files 1 failed (1)` + `Tests 1 failed | 28 passed (29)`**：

| 臂 | 改哪 | rc | 红的那一条 |
|---|---|---|---|
| A | `card-export-units.ts` 里把 `nextFrame(() => resolve())` 换成直接 `resolve()` | **1** | 「注入的调度器没跑 ⇒ 不结算」—— needle 命中 2 行 |
| B | `card-export.tsx` 里把 `afterNextFrame((run) => requestAnimationFrame(run))` 换成 `Promise.resolve(void 0)` | **1** | 「`toDataURL` 的调用点在让帧之后」—— needle 命中 2 行 |
| C | 把帧间卸载那一支的 `'svg-unmounted-in-frame'` 换成别的串 | **1** | 「让帧之后视图可能已经没了 ⇒ 出一句话，不许静默」—— needle 命中 3 行 |

三条各带一行 `已复原（git status 该路径为空）`，收尾对账两枚被改文件都干净。
🔴 **第一次起跑（链 T3 @ 18:31:01）三条臂全部 `PATCH_FAIL`**：我传的相对路径少了 `apps/mobile/` 这一层，
而**同一个错原样躺在链 T 的脚本里**，只因那三条臂从未走到 apply 那一步（全被负载门挡住）才没暴露 ⇒
**没跑过的取证代码本身也是未验证代码**。它是响亮失败且不动文件的，所以没有污染任何读数。
⚠️ 另记一条与预设相反的读数：**负载高只能让臂多红，不可能让一条变异臂少红**（"改了还全绿"与争抢无关），
所以红集若宽于点名那条就是**读数无效**而不是"有牙"；这次三条都恰好只红自己那条。
装置与逐臂原文：`/tmp/chain-T4.log`（改后）与 `/tmp/chain-T3.log`（那三条 `PATCH_FAIL` 的原文，留着当证据）。


---

## 7. ⏹ 还没闭合的（按代价从低到高排）

1. ✅ §6.3 那批 e2e 变异臂：六臂全跑（含一条把我自己的预期否证的 M2b），rig 已落
   `research/tools/mutate-w7-e2e-arms.mjs`（不住 `/tmp`，重启带不走）。
2. ✅ 移动端**真机**出图读数（G1 的闭合判据 / G2 的唯一硬证据）：**两端都取到了**。
   Android 装置 = `scripts/verify-mobile-card-export.sh`（+ 它的读数器
   `scripts/verify-mobile-card-export-read.mjs`，`pnpm verify:mobile-card-export`），
   iOS 装置 = `scripts/verify-mobile-card-export-ios.sh`（W7-G3 那条"只有 Android 有装置"的缺口
   由它补上，共用同一台读数器）。
   起 emulator → 「我的」→ 倒数日 → 卡片菜单 → 点导出 → 从沙盒拉回那张图数 IHDR。
   读数：Android 04 13:20 `RC_ANDROID=0`；**iOS 04 17:13:17 `RC_PROBE=0`（17 项 / 0 失败）
   ⇒ `W=1080 H=1440`，与 `EXPORT_CARD_SIZE` 逐字相同**。
   ⚠️ 原文把装置写成 `.mjs`（一个不存在的路径）—— 那是一句**先于实现写下的名字**，现已按真身改指；
   而"这一条是唯一能证伪'iOS 折算猜错'的东西"那句**已经跑过一轮真机了**：
   折算没猜错，但它当时**没有证到**的东西在另一处证到了 —— 第一次真机跑红的是**调用时机**（见 W7-G6b）。
   🔴 **两端现在各欠一趟**：Android 那趟（13:20）验的是让帧修复**之前**的 bundle（`card-export-units.ts` 改了
   ⇒ 按 W7-G6 自己写的规矩当场过期，要重取）；iOS 那趟装的是 `2a1fa25a` **加未提交的修复**
   ⇒ 在修复提交之前它不算"提交态绿"的读数。
   —— 🔴 **04 18:2x 这两句一条被现量升级、一条被量到收口姿势**：
   ① **iOS 那句作废**，它**是**提交态的读数 —— 不是靠"我记得内容一样"，而是两条可复跑的差异检查：
   `git diff --stat c313914f HEAD -- apps/mobile/src` ⇒ **空**（JS/TS 输入与修复提交逐字节相同），
   `git diff --name-only 6d78fa7e HEAD -- apps/mobile` ⇒ 只有 `evidence/card-export/README.md` 与那枚失败截图，
   按构建输入过滤（`ios/ | src/ | android/ | package.json | .podspec`）命中 **0**。
   ⇒ **修复提交比探针晚 4 分钟落地、字节是同一份**，这一档的正确说法是"提交在后、输入未变"，
   而不是"装的不是提交态"。⚠️ 这条更正有保质期：**下一次再动 `apps/mobile/` 的输入，它就得重取**（正是 Android 那一格的教训）。
   ② **Android 那一趟重取已经开跑并以环境无效收口**：`RC_REINSTALL_ANDROID=0`（17:57:21，装的是当前产物）
   → 探针 `RC_ANDROID=3`（18:12:23，`❌ 等满 900s 负载仍是 164`；那 900s 是 `wait-for-quiet-host.sh` 的**默认上限**，
   我的链脚本没传 `HEYTA_LOAD_GATE_WAIT`，阈值 12 没动）。补跑在链 T2：**显式 3600s + 先重装**
   （臂收尾的 `git checkout --` 会把源码 mtime 推到装进去的 bundle 之前，新鲜度门按规矩就该拒）。
   缘由与那条可迁移的坑在 `countdown-anniversary.md` §8.4 ㊢。
3. ⏹ iOS pbxproj 那 8 行的**构建级**验证（`plutil -lint` 只证 XML 合法，不证编译进 target）。
4. ⏹ 与 `feat/countdown-batch2` 合流（W7 三笔 + W8 那四笔），合流后 `pnpm reinstall:all` 四端重装。
