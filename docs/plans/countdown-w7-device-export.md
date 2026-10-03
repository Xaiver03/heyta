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
| 1 | **先取证 RN 能不能出图**，再决定移动端形状 | ✅ 取证完成 ⇒ 结论是"**能栅格化、不能落盘**"，与工单前提不同 | §2 |
| 2 | web 侧真的导出成品图（复用 `avatar-encode.ts` 的 canvas 形状与平台边界） | 🔄 进行中 | §3 |
| 3 | 判据：导出全程**零网络请求**（真浏览器 + 正向对照） | 🔄 进行中 | §4 |
| 4 | "零法务变更"的**现量**复核（不是引用那句话） | ⏹ | §5 |

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
| **W7-G1** | **移动端成品图落盘/分享通道不存在**：可栅格化（§2.2）但 base64 无处可去（§2.3） | 需要新的原生写文件模块 + `FileProvider` authority；两者都在本单地界外；引入 `react-native-fs` 类依赖要新过 §3.1/§3.2 | 一个 `@ReactMethod writeBase64Png(name, b64) → uri`（或等价）落地并在**真机**上把导出的 PNG 分享出去；判据 = 分享面板收到的那张图 `file` 的 IHDR 尺寸 == 契约值 |
| **W7-G2** | **iOS 与 Android 的导出尺寸口径不同**（iOS 的 `toDataURL` 走 point × screenScale） | 修法要么在调用侧按 `PixelRatio.get()` 折算（**未实测**，且折算本身就是一次平台判断，按 AGENTS §3.5 不许出现在 `apps/`），要么给契约加"像素 vs 逻辑"的第二对数 —— 后者是改契约，本单不顺手改 | 两端各导一张，**数出来的 IHDR 宽/高逐字等于 `EXPORT_CARD_SIZE`**；做不到就把尺寸判据写成"契约 × 该端 scale"并**在契约层**给出那个乘数 |
| **W7-G3** | **本检出没有移动端倒数日界面**（W8 移动半在另一条分支） | `ls apps/mobile/src/screens \| grep -i countdown` ⇒ **0 命中**（现量见 §2.5 命令 [F6]）。就算 G1/G2 都解决，这一单在移动端也没有可挂动作的宿主 | W8 的 `CountdownScreen` 落地后，卡片二级操作里出现「导出成品图」，并且**它真的能导出**（G1） |

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

## 3. web 半：把成品图真的导出来（⏹ 进行中）

形状沿用 `avatar-encode.ts` 的分界：**数字住契约、怎么画住壳**。

| 文件 | 职责 |
|---|---|
| `apps/web/src/features/countdown/card-export.ts` | 平台层：`<canvas>` 画一张 `EXPORT_CARD_SIZE` 的 PNG → `toBlob(EXPORT_CARD_CONTENT_TYPE)` → 浏览器下载。边长/比例/内容类型/文件名上限**全部从契约读**，一个裸值都不写 |
| `apps/web/src/features/countdown/card-export-action.ts` | 宿主接线：从 store 取卡片 → `cardTextsFor` 出措辞 → 交给上面的渲染器 |

三条实现纪律（都是本仓既有裁决，不是新发明）：

1. **不重新发明排版**：字号/行高/间距/圆角全部取 `useHeytaUiTheme()` 的 `text` 与 `tokens`，
   再乘 `EXPORT_CARD_SCALE`（= `EDGE_PX / REF_WIDTH_DP`，**推导值**）。
   ⇒ 成品图与屏幕卡是**同一套 token 的整倍放大**，暗色主题跟着走。
2. **措辞不许再写一遍**：那四段话来自共享层 `cardTextsFor`（`581bdb99` 加它的理由原文是
   "卡片与导出成品图共用这一份措辞映射"）。
3. **零网络**：画布、`Blob`、`URL.createObjectURL` 全在本机；不引 `html2canvas` 一类
   （它要新过 §3.1/§3.2，而且会顺手 `fetch` 外链字体）。

---

## 4. 判据：导出全程零网络请求（⏹）

### 4.1 载体选择（🔴 这条决定了"零"是不是恒真）

`apps/web/src/pwa/register.ts` 在 `!import.meta.env.PROD` 时直接 return ⇒
**dev 载体里根本没有 SW**，于是"SW 会拦掉请求"这件事在 dev 里既不可能发生、也不可能被测到。
但反过来：本单要证的是"**导出这条路不发请求**"，需要的是**分类器抓得到** ——
所以载体用主配置（`vite dev` @ 4318）并把 **正向对照**做成"页面自己发一条 `/api/*`，分类器必须数得出 1 条"。

### 4.2 🔴 §7 第 4 条的回答：**SW 拦掉的那部分不算"浏览器真发出去的"，但必须被单列**

工单要的是一个明确口径。裁决与理由：

- **判据的载体是"浏览器真发出去的"**，用 Playwright 的 `page.on('request')`（CDP Network 域），
  **不是**页面的 `fetch` 调用数。理由：`fetch` 调用数会被 SW/`page.route` 之类的拦截器"消化"，
  而 AGENTS §7 第 87 条与本仓实测的坑正是"SW 接管后 `page.route` 收不到 `/app/` 的 `/api/*`" ——
  以调用数当"零"，等于用一层会被拦截器改写的计数自证清白。
- **但"零"不许因为看不见就算成立**：所以除了 `request` 分类器，再挂一个**页内 `fetch` 计数器**
  （`addInitScript` 包一层 `window.fetch` / `XMLHttpRequest` / `WebSocket` / `navigator.sendBeacon`）。
  两个计数器**同时**要求为零：
  - `request` 为零而页内调用不为零 ⇒ 说明**有东西把请求吞了**（SW 命中缓存、`page.route`）——
    这不是"零出网"，这是"探针看不见"，按 §7 元规则 1 判**红**，不许静默通过。
  - 页内调用为零而 `request` 不为零 ⇒ 请求来自**页面之外**（SW 自身的脚本取回、浏览器预取），
    那一条按口径不计入"导出发的"，但**必须打印出来让人看**。
- **正向对照**（承重的 `:16-30`）：跑完之后由页面主动 `fetch('/api/card-export-probe')`，
  要求 `request` 分类器与页内计数器**各 +1**。少任何一个，前面那些"零"都不成立。
- 载体本身的 SW 状态也**实测报出来**（`navigator.serviceWorker.getRegistration()`）：
  dev 下应当是 `'NONE'`，这既是"本载体没有拦截器"的证据，也是"两个计数器本应一致"的理由。

---

## 5. "零法务变更"的现量复核（⏹）

命令与读数在 §5.1（执行中回填）。要证的是三件事，不是引用"零出网所以不改条款"那句话：

1. 导出路径上**没有**任何网络 API（`grep` 现量，按文件逐条列出）。
2. 导出路径上**没有**新增任何权限声明（manifest / Info.plist / AndroidManifest 逐项 diff）。
3. 既有的两条对账门禁仍然成立：`node scripts/check-legal-permissions.mjs`、`pnpm check:legal-copy`。

---

## 6. 变异臂清单（每条判据都要能失败）

（执行中回填：每臂 = 改哪一行 ⇒ 哪条判据红 ⇒ rc 与失败条数 ⇒ 逐字节还原的 md5 对照）
