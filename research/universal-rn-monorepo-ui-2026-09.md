# 通用 React Native 单 UI 代码库：2025–2026 生产决策研究

> 🔴 **这是 AI 子代理产出的调研原料，本仓库没有逐条核实。**
> 产出时间：2026-09-27。它自带证据分级（【一手】/【案例】/【片段】/【子代理】）——
> **那些分级是它对自己的判断，不构成本仓库的背书。**
>
> 已被 [ADR-0024](../docs/adr/0024-desktop-shell-and-ui-convergence.md) §2.6 引用。
> 其中**只有「鸿蒙第三方库基线滞后」那一条**由 ADR 作者用 npm registry **独立复核并成立**；
> 其余结论 —— 尤其是「RNW 作者 Gallagher 反对 DOM→RNW 迁移」——
> **引用前必须自己读原文**。
>
> 用途：作为 [多端融合调研](../docs/research/multi-platform-ui-fusion.md) 的**输入原料**，
> 不是结论。它位于 `research/` 原料区，**不在 `docs/` 文档体系内**。

- **检索日期**：2026-09-27
- **检索方法**：`web_search`（Tavily）本次全程 HTTP 432 不可用；改用 AnySearch CLI + `web_fetch` 逐页取正文，版本类事实一律以 **npm registry JSON** 为权威源。
- **证据标记**：
  - 【一手】= 官方文档 / 官方博客 / 包注册表元数据，我逐字读过
  - 【案例】= 具名工程博客，我逐字读过
  - 【片段】= 仅搜索摘要，**未**验证正文
  - 【子代理】= 由并行子代理全文抓取并回报，我抽查了其中最关键的三条
- **本项目基线（读自仓库）**：`apps/mobile` = 裸 RN 0.84.1 + React 19.2.3（**非 Expo**，`@react-native/metro-config` 0.84.1）；`apps/web` = React 19.2 + Vite 7.1 + vitest 5；pnpm 默认 isolated；已有 396 行规模的门禁脚本（`check:tokens` / `check:design` / `check:arkts` / `check:native-deps` / `check:mobile-bundle` / `verify:harmony-rnoh`）。

## 0. 版本基线（全部来自 npm registry / 官方发布说明）

| 包 | 最新版 | 发布日 | 关键约束 |
|---|---|---|---|
| `react-native` | 0.87.1 | 2026-08-26 | peer `react ^19.2.3` |
| **`react-native`（本项目）** | **0.84.1** | 2026-02-11（0.84 发布） | peer `react ^19.2.3`；Hermes V1 默认；Node ≥ 22.11 |
| `react-native-web` | 0.21.3 | 2026-09-25 | peer `react ^18\|\|^19`、`react-dom ^18\|\|^19` |
| `@react-native-oh/react-native-harmony` | **0.84.4** | 2026-09-24 | peer `react-native 0.84.1` |
| `expo` | 57.0.25 | 2026-09-24 | SDK 57 = RN 0.86 + React 19.2 |
| `expo-router` | 57.0.23 | 2026-09-24 | 仅 Expo CLI + Metro |
| `@react-navigation/native` | 7.4.1 | 2026-09-15 | 8.0 仍在 alpha |
| `@testing-library/react-native` | 14.0.1 | 2026-06-23 | peer `react >=19`、`test-renderer ^1`；`jest` **可选** |
| `jest-expo` | 57.0.5 | 2026-08-26 | peer `@react-native/jest-preset ^0.86.3` |
| `@react-native/jest-preset` | 0.87.1 | 2026-08-26 | RN 0.85 起从 `react-native` 拆出 |
| `vitest-native` | 0.13.0 | 2026-08-18 | Beta；RN 0.81–0.86/0.87（自述不一致） |
| `detox` | 20.51.4 | 2026-06-16 | 官方声明支持 RN **0.77.x–0.84.x** |
| `vitest` | 5.0.2 | 2026-09-25 | peer `vite ^6.4\|\|^7\|\|^8` |
| `style-dictionary` | 5.5.5 | 2026-09-20 | Node ≥ 22，ESM |

Expo SDK ↔ RN 映射（【一手】[SDK 55 更新日志](https://expo.dev/changelog/sdk-55) 2026-02-25、[SDK 57 更新日志](https://expo.dev/changelog/sdk-57) 2026-06-30）：

```
SDK 54 = RN 0.81（2025-09）
SDK 55 = RN 0.83 + React 19.2（2026-02-25）
SDK 56 = RN 0.85 + React 19.2
SDK 57 = RN 0.86 + React 19.2（2026-06-30）
```

**⚠️ 本项目落在 SDK 的缝里**：RN 0.84 **不属于任何稳定 Expo SDK**。SDK 55 更新日志原文：*"React Native 0.84 can be used today with Expo SDK 56 canaries."* 这不是小问题，见 §7 R1。

---

## 1. 单仓库布局（问题 1）

### 1.1 结论先行

**Expo 的 monorepo 支持在 SDK 52 之后才真正可用，SDK 56 才修好 symlink**。本项目是裸 RN，用不上 Expo 那层自动化 —— 也就是说 **Expo 文档里"你不用手动配 Metro"这句话对本项目不成立**，我们只能自己维护 `metro.config.js`。好消息是：本项目 `apps/mobile/metro.config.js` 里已经记录了比官方文档更准确的一手教训。

### 1.2 Expo 的官方立场（【一手】[Work with monorepos](https://docs.expo.dev/guides/monorepos/)，modificationDate 2026-09-25）

- Expo 自动检测 monorepo 并配置 Metro；**SDK 52+ 要求删掉手动加的 `watchFolders` / `resolver.nodeModulesPath` / `resolver.extraNodeModules` / `resolver.disableHierarchicalLookup`**。
- **isolated dependencies**：pnpm 默认就是 isolated。原文：*"From SDK 54, Expo supports isolated dependencies and isolated installations. With SDK 53, disabling isolated dependencies is recommended, or you may encounter native build errors and dependency conflicts."* 遇到问题可回退 `nodeLinker: hoisted`。
- **重复依赖是硬错误**（原文）：
  - *"Duplicate React Native versions in a single monorepo are not supported"*
  - *"Duplicate React versions in a single app will cause runtime errors"*
  - *"Duplicate versions of Turbo and Expo modules may cause runtime or build errors"*
- React 19 时代的修法：用 `resolutions`（yarn/pnpm）或 `overrides`（npm）**强制单实例**。
- **native 模块绝不能重复**：*"native modules should never be duplicated, because only one version of a native module can be compiled for an app build at a time."* SDK 54 起 `experiments.autolinkingModuleResolution: true` 可让 Metro 与 autolinking 对齐；**SDK 55 起在 monorepo 中自动开启**。
- 硬编码路径陷阱：模板里 `apply from: "../../node_modules/react-native/react.gradle"` 在 monorepo 下会因 hoisting 失效，正解是用 Node 解析：`require.resolve('react-native/package.json')`。

### 1.3 Metro 的解析语义（【一手】[Configuring Metro](https://metrobundler.dev/docs/configuration/)、[Module Resolution](https://metrobundler.dev/docs/resolution)，更新至 2026-09-14/09-26）

- `resolver.sourceExts` 默认 `['js','jsx','json','ts','tsx']`；**顺序即磁盘匹配优先级**。
- `resolver.resolverMainFields` 默认 `['browser','main']`；**在 React Native 下默认变为 `['react-native','browser','main']`**。这就是"`react-native` 字段"的真实作用面。
- `resolver.platforms` 默认 `['ios','android','windows','web']`。
- `preferNativePlatform: true`（Metro 写死）。
- `unstable_enablePackageExports` **自 Metro 0.82.0 起默认 `true`**，且原文警告：*"If a module is matched in `exports`, `sourceExts` and `platforms` will not be considered (i.e. platform-specific extensions will not be used)."* ← **这条是本次研究里最容易被忽视、后果最严重的坑，见 §2.3。**
- **symlink 的边界**（原文）：*"targets of any symlinks within your `watchFolders` must also be within `watchFolders`"* —— 即软链的**真实目标目录**也必须在 watch 范围内，光把链接本身放进去没用。
- 历史上曾有 `resolver.unstable_enableSymlinks`：**Metro 0.80 起成为默认，0.81 起被移除**（【一手】[react/metro#1142](https://github.com/react/metro/issues/1142) 评论）。⚠️ 网上 2025 年的 pnpm 教程（如 [dev.to「Surviving pnpm + React Native」](https://dev.to/heyradcode/surviving-pnpm-react-native-how-i-finally-stopped-metro-from-screaming-about-babelruntime-493i)，2025-10-30）仍在教 `unstable_enableSymlinks: true` —— **对 Metro 0.83（RN 0.84 所带版本）已经是无效配置**，照抄只会得到一个静默无操作的开关。

### 1.4 pnpm 的两个非直觉事实

1. **`disableHierarchicalLookup: true` 在 pnpm 布局下是错的**。网上（含 RN 官方 monorepo 文档）常推荐它来防"双 React"。本项目 `apps/mobile/metro.config.js` 已实测证伪并写下证据：pnpm 把 `react-native` 的依赖放在**同级**而非子级：
   ```
   node_modules/.pnpm/react-native@0.84.1_<hash>/node_modules/
       react-native/
       @react-native/virtualized-lists/   ← 同级
   ```
   于是 `react-native/Libraries/Modal/Modal.js` 里的 `require('@react-native/virtualized-lists')` **只能靠逐级向上查找命中**。关掉之后 **Debug 正常、Release 打包炸**：
   ```
   UnableToResolveError: Unable to resolve module @react-native/virtualized-lists
     from .../react-native/Libraries/Modal/Modal.js
   ```
   ⚠️ 迷惑点：Debug 不走 Metro 打包，所以"能跑"不等于"能打包"。
2. **`nodeModulesPaths` 的顺序挡不住双 React**。同理，本项目已实测：打进 release APK 的 bundle 里有**两份** React（`apps/mobile/node_modules/react@19.2.3` 与 `packages/i18n/node_modules/react@19.3.0`），因为 Metro 从 `packages/i18n/dist/index.js` 出发向上查找时命中的是 i18n 自己那份，而**本包自己有就不去 `nodeModulesPaths`**。症状是启动即崩在看似无关处（`TypeError: Cannot read property 'useContext' of null at TasksScreen`），因为两个 React 各有各的 dispatcher。
   正解是用 `resolveRequest` **硬改写 `originModulePath`**，并**刻意只拦 `react` / `react/jsx-runtime` / `react/jsx-dev-runtime`**（不要顺手拦 `react-native`，它内部有大量相对解析，会连带弄坏）。本项目已经这么做且写明了理由。

   > 结论：**这一类问题没有"照抄官方文档"的解法**，必须靠本仓库自己的配置 + 回归测试。这条本身就是"不要期待一次配好"的证据。

### 1.5 Vite 侧的对应项（【一手】[Vite Shared Options](https://vite.dev/config/shared-options)，v8.3.1）

- `resolve.dedupe`：官方用途原文就是 *"If you have duplicated copies of the same dependency in your app (likely due to hoisting or linked packages in monorepos)"* —— **Vite 侧的双 React 用 `dedupe: ['react','react-dom']` 就够**，不需要像 Metro 那样写自定义 resolver。两个打包器的解法**不对称**，这点必须接受。
- `resolve.extensions` 默认 `['.mjs','.js','.mts','.ts','.jsx','.tsx','.json']` —— **没有任何平台概念**。
- `resolve.mainFields` 默认 `['browser','module','jsnext:main','jsnext']` —— **不认 `react-native` 字段**。
- `resolve.conditions` 默认 `['module','browser','development|production']`。

### 1.6 版本错位的真实形状

- **React 版本不会冲突，因为 RN 单方面钉死了它**：RN 0.84.1 的 peer 是 `react ^19.2.3`；RNW 0.21.3 接受 `^18||^19`。所以只要去重成功，**web 和 native 都用 React 19.2.3** 即可，不存在"RNW 与 RN 要不同 React 大版本"的问题（这一条在 React 18 时代是真问题，现在不是了）。
- **真正错位的是 Metro 版本**：RN 0.84.1 通过 `@react-native/community-cli-plugin@0.84.1` 依赖 `metro ^0.83.3`；RN 0.85 是 `metro ^0.84.0`；RN 0.87 是 Metro 0.87。RNOH 0.84.4 依赖 `metro-runtime ^0.83.3` —— **与 RN 0.84.1 对齐**，这是他们刻意跟踪的结果。
- **RNW 明显落后于 RN 核心**：RNW 0.21.3 仍然依赖 `@react-native/normalize-colors ^0.74.1`，而 RN 已经是 0.84。且 RNW 的 `package.json` **只有 `main` 和 `module`，没有 `exports` 字段**（我直接读的 registry JSON）—— 这反而是好事：它不会触发 §2.3 那个 exports 关掉平台后缀的坑。

### 来源（Q1）
- https://docs.expo.dev/guides/monorepos/ (modificationDate 2026-09-25)
- https://docs.expo.dev/guides/customizing-metro/ (modificationDate 2026-09-17)
- https://metrobundler.dev/docs/configuration/ (更新 2026-09-14)
- https://metrobundler.dev/docs/resolution (更新 2026-09-26)
- https://github.com/react/metro/issues/1142
- https://reactnative.dev/blog/2026/02/11/react-native-0.84
- https://reactnative.dev/blog/2026/04/07/react-native-0.85
- https://expo.dev/changelog/sdk-55
- https://expo.dev/changelog/sdk-57
- https://registry.npmjs.org/react-native-web/latest · https://registry.npmjs.org/react-native/0.84.1 · https://registry.npmjs.org/@react-native/community-cli-plugin/0.84.1 · https://registry.npmjs.org/@react-native-oh/react-native-harmony/latest
- https://vite.dev/config/shared-options
- 本项目 `apps/mobile/metro.config.js`（一手证据，非外部源）

---

## 2. 平台特定代码约定（问题 2）

### 2.1 Metro 的解析顺序是**确定**的（【一手】[Module Resolution](https://metrobundler.dev/docs/resolution)）

文档给出的字面顺序（`platform=android`、`sourceExts=['js','jsx']`）：

```
1. moduleName + '.android.js'
2. moduleName + '.native.js'      （因 preferNativePlatform = true）
3. moduleName + '.js'
4. moduleName + '.android.jsx'
5. moduleName + '.native.jsx'
6. moduleName + '.jsx'
```

**关键语义**：
- `.native.*` 排在平台专属后缀**之后**、裸后缀**之前**。所以 `.android.tsx` > `.native.tsx` > `.tsx`。
- `.native.tsx` 是"所有 native 平台共用"的口子；`web` 永远**不会**命中 `.native.*`。
- **web 平台是 `platforms` 默认列表里的一个普通平台**，所以 `.web.tsx` 只在 web bundle 生效。
- 【一手】[RN 官方 Platform-Specific Code](https://reactnative.dev/docs/platform-specific-code)（更新 2026-08-12）明确建议：*"Configure your Web bundler to ignore `.native.js` extensions in order to avoid having unused code in your production bundle."* —— 这句是**给 web 打包器的行动项**，不是可选项。

### 2.2 Vite 完全不理解平台后缀

- Vite 的 `resolve.extensions` 是一个**纯字符串数组**，优先匹配靠前项，**没有任何平台推断**（【一手】Vite 文档，同上）。
- 因此 `.web.tsx` 在 Vite 里能生效，**纯粹因为你在 `resolve.extensions` 里把它排在了前面**；`.native.tsx` 不被匹配是因为它不在数组里。
- 可用的现成配方（【一手/案例】）：
  - **官方指引**（【一手】[RNW Multi-platform setup](https://necolas.github.io/react-native-web/docs/multi-platform/)）：webpack 为例，`alias: { 'react-native$': 'react-native-web' }` + `extensions: ['.web.js','.js']`；并建议用 `babel-plugin-react-native-web` 做 tree-shaking 剪枝（RN 的 Babel preset 会把 ESM 转 CJS，破坏 web 打包器的 tree-shaking）。
  - **RNW Setup 页**（【一手】https://necolas.github.io/react-native-web/docs/setup/）给出了 bundler / Babel / **Jest `moduleNameMapper`** / Flow / Node 五套别名法。
  - **真实 Vite + jsdom 配置**（【案例】[assistant-ui「Testing the native kit」](https://www.assistant-ui.com/docs/react-native/testing)，我逐字读过）：
    ```ts
    resolve: {
      extensions: [".web.tsx",".web.ts",".web.jsx",".web.js",
                   ".mjs",".js",".mts",".ts",".jsx",".tsx",".json"],
      alias: { "react-native": "react-native-web" },
    }
    ```
    注意其扩展名顺序**与 Vite 默认完全不同**，且 `server.deps.inline` 需要内联 `lucide-react-native` / `react-native-svg` 等（否则 Vitest 会在 transform 之前解析到 native 取向的模块格式）。
  - **维护中的插件**：`vite-plugin-rnw`（【一手】[README](https://github.com/dannyhw/vite-plugin-rnw)，npm 0.0.12，2026-07-20，peer vite `^4–^8`）与 `vite-plugin-react-native-web`（npm 3.2.0，2026-07-11）。⚠️ `vite-plugin-rnw` 的版本号是 **0.0.x**，作者自述这是 *"running React Native Web … outside of the 'normal' constraints"*（【子代理】引其博客）；把它作为 web 构建的**关键路径依赖**要先过本项目 §3.1–3.2 那两道门。

### 2.3 ⚠️ 最隐蔽的陷阱：`exports` 会让平台后缀彻底失效

Metro 文档原文（【一手】）：*"If a module is matched in `"exports"`, `sourceExts` and `platforms` will not be considered (i.e. platform-specific extensions will not be used). This is done for compatibility with Node."* 且 **Metro 0.82+ 默认开启 package exports**。

**后果**：如果共享 UI 包这样写：

```json
{ "exports": { ".": { "default": "./dist/index.js" } } }
```

那么 `import { Button } from '@heyta/ui'` 在 Metro 里**永远不会**去找 `index.native.tsx`，只会拿 `dist/index.js`。平台分歧**静默失效**——不报错，只是所有平台跑同一份代码，或者更糟：web 版本被打进 native bundle。

**对本项目是现成的**：`packages/design-system` 已经有 `exports` 字段，且已经**用显式子路径**（`"./native"`）而不是靠扩展名魔法：
```json
"exports": {
  ".":          { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./tokens.css": "./src/tokens.css",
  "./native":   { "types": "./dist/native.d.ts", "import": "./dist/native.js", "require": "./dist/native.cjs" }
}
```
**这个模式是对的，应当作为 `packages/ui` 的强制约定**：要么走显式子路径入口，要么**不要给共享 UI 包加 `exports`**（`main`/`module` 才会走平台后缀解析）。二者选一，不能混。

### 2.4 "单代码库 + 少量平台文件" vs "共享核心 + 瘦壳"：证据怎么说

**证据倾向于"单代码库 + 少量平台文件"，但前提是平台文件数量被严格压住。**

- **RNW 官方口径有明确分界**（【一手】[Multi-platform](https://necolas.github.io/react-native-web/docs/multi-platform/)）：*"Minor platform differences can use the `Platform` module. More significant platform differences should use platform-specific files."* 即**先 `Platform.select`，实在不行才开文件**。
- **Expo Router 给这条约定加了硬约束**（【一手】[Platform-specific extensions and module](https://docs.expo.dev/router/advanced/platform-specific-modules.md)，2026-02-26）：`src/app` 目录内的平台文件**必须同时存在非平台版本**，否则路由在不同平台上不完整（破坏 deep link）。原文：*"supported in the `src/app` directory only if a non-platform version also exists. This ensures that routes are universal across platforms for deep linking."* 组件目录（`src/components`）没有这个限制，然后由 `src/app/about.tsx` 一行 re-export。
- **Meta 的真实做法**就此一条最可信（【案例】[Nicolas Gallagher, "One React for Web and Native"](https://nicolasgallagher.com/one-react-for-web-and-native/)，2025-11-24）：*"Where distinct native behaviors are required, React Strict DOM relies on the platform-specific file extensions introduced by React Native. Developers can create different component implementations in `*.native.js` and `*.web.js` files with a shared props interface."* —— 注意**共享 props 接口**是前提，不是可选项。
- **Zalando 明确否定了"100% 共享"这个目标**（【案例】[Zalando Engineering](https://engineering.zalando.com/posts/2025/10/accelerating-mobile-app-development-at-zalando-with-rendering-engine-and-react-native.html)，2025-10-03）：*"It's important to accept that having 100% code shared between all platforms or even between iOS and Android, is not the goal."*
- **反面证据**：有代理公司记录的失败案例提到平台文件**失控增殖**——*"a proliferation of `.ios.tsx`/`.web.tsx` files"*（【案例】[Paisanos](https://www.paisanos.io/blog/the-universal-way-one-codebase-all-platforms)，2025-05-08）。也就是说：**平台文件是"处方药"，不是"维生素"**；一旦变成默认手段，"单代码库"就退化成了"一个仓库里的 N 个代码库"。

**可操作判据**（综合以上）：共享 props 接口 + `Platform.select` 覆盖 >80% 差异；平台文件只用于**真正不同的交互模型**（如 web 的 hover/focus-visible、原生手势）；平台文件总数设硬上限并纳入门禁。

### 来源（Q2）
- https://reactnative.dev/docs/platform-specific-code (更新 2026-08-12)
- https://metrobundler.dev/docs/resolution (更新 2026-09-26)
- https://metrobundler.dev/docs/configuration/ (更新 2026-09-14)
- https://necolas.github.io/react-native-web/docs/multi-platform/
- https://necolas.github.io/react-native-web/docs/setup/
- https://vite.dev/config/shared-options
- https://www.assistant-ui.com/docs/react-native/testing
- https://github.com/dannyhw/vite-plugin-rnw · https://www.npmjs.com/package/vite-plugin-react-native-web
- https://docs.expo.dev/router/advanced/platform-specific-modules.md (2026-02-26)
- https://nicolasgallagher.com/one-react-for-web-and-native/ (2025-11-24)
- https://engineering.zalando.com/posts/2025/10/accelerating-mobile-app-development-at-zalando-with-rendering-engine-and-react-native.html (2025-10-03)
- https://www.paisanos.io/blog/the-universal-way-one-codebase-all-platforms (2025-05-08)

---

## 3. 导航与应用外壳（问题 3）

### 3.1 三个严肃选项

| 方案 | web URL | native 栈 | 硬约束 |
|---|---|---|---|
| **React Navigation 7** | 靠 `linking` 配置手动映射 URL；官方明说**需要 RNW** | ✅ 原生栈（`react-native-screens`） | 需要自己写 linking 配置；8.0 尚在 alpha |
| **Expo Router** | 文件即路由，SSG + sitemap | ✅ 建在 React Navigation 之上 | **只能在 Expo CLI + Metro 项目中用** |
| **Solito** | Next.js 路由 | Expo Router / RN | 绑定 Next.js；Solito 5 起「web-first」并把 RNW 移出核心（【片段】[dev.to](https://dev.to/redbar0n/solito-5-is-now-web-first-but-still-unifies-nextjs-and-react-native-2lek)，2025-10-22） |

### 3.2 React Navigation 在 RNW 上**确实**能跑，但坏在具体的地方（【一手】[React Navigation on Web](https://reactnavigation.org/docs/web-support/)，7.x）

原文要点：
- 前置条件第 1 条就是 *"Configure linking"* —— **"This is crucial for web apps to have proper URLs for each screen."** 即：真 URL 不是免费的，必须维护一份 `linking` 配置。
- 第 2 条：*"avoid using `navigation.navigate` when supporting the web. Instead, use the `Link` or `Button` components … This ensures that an anchor tag is rendered"* —— **中键/Cmd+点击、SEO、无 JS 降级都依赖这一点**。用 `navigate` 就没有 `<a>`。
- 第 3 条：*"React Navigation works best with fully client-side rendered apps. Limited server-side rendering support is available."* → **纯 SPA**。
- 明确坏掉的：
  - **Native Stack**：*"On the Web, animations and gestures are not supported."*
  - **Stack**：*"Screen transition animations are disabled by default on the web"*，手势不支持（web 上要开动画得显式设 `animation`）。
  - **Drawer**：web 上动画走 **CSS transition**，手势不支持。
- 包体积：*"Since `react-native-gesture-handler` and `react-native-reanimated` are not used on the web, avoid importing them in your own code to reduce the bundle size unless you need them for your components. You can use `.native.js` or `.native.ts` extensions"* —— **这是 §2 的平台文件约定在导航层的直接落地**。
- 部署：SPA 需要把所有路由 rewrite 到 `index.html`（Netlify `[[redirects]]` / Vercel `rewrites` / GitHub Pages 需把 `index.html` 复制成 `404.html` 或按路由复制）——**否则刷新即 404**。

### 3.3 Expo Router 的硬约束（【一手】[Introduction to Expo Router](https://docs.expo.dev/router/introduction.md)，2026-09-16）

- 原文：*"Due to the deep connection between the router and the bundler, Expo Router is only available in Expo CLI projects with Metro."*
  → **对本项目是决定性否决**：web 是 Vite 7，Expo Router 用不了。要用它就得把 web 从 Vite 切到 Metro（或整体迁到 Expo SDK）。
- web 侧能力：build-time **static rendering（SSG）**支持；原文 *"Server-side rendering currently requires custom infrastructure to set up."*
- 其余卖点：typed routes、async routes（按路由切 bundle）、每个页面天然 deep link、原生 tabs 等。

### 3.4 ⚠️ 决定性问题：HarmonyOS 上目前**没有**可用的现代导航栈

这是我本次研究里**最重要的发现**，且是纯 registry + 官方支持矩阵事实，不依赖任何观点：

**(a) RNOH 本体是跟得上的。** `@react-native-oh/react-native-harmony@0.84.4`（2026-09-24）的 peer 是 **`react-native 0.84.1`** —— 与本项目**精确对齐**。RNOH 同时维护 4 条线：0.72（108 个版本）、0.77（16）、0.82（9）、**0.84（4）**。所以**"RN 0.84.1"这个选择极可能就是为 RNOH 而定的**，且成立。

**(b) 但 RNOH 的第三方库适配层严重滞后，且是 patch 模式而非上游合并。**【一手】[RNOH 第三方库总表](https://raw.githubusercontent.com/react-native-oh-library/usage-docs/master/en/README_EN.md)（共 **396** 条，其中 **52** 条标记 "In Progress"）明确说明：*"To avoid impacting other platforms of the third-party libraries, migration is performed using patching."* —— 即**打过补丁的固定基线版本**，不会随上游升级。

该表里导航相关的**基线版本**：

| 库 | RNOH 表里的基线 | 对应 `@react-native-oh-tpl/*` 最新版 | 发布日期 | 上游当前 |
|---|---|---|---|---|
| `@react-navigation/native` | **6.1.9** | — | — | 7.4.1 |
| `@react-navigation/stack` | **6.3.19** | — | — | 7.x |
| `@react-navigation/native-stack` | **6.9.26** | `@react-native-oh-tpl/native-stack` | — | 7.19.2 |
| `@react-navigation/bottom-tabs` | **6.5.11** | — | — | 7.x |
| `react-native-screens` | **3.29.0** | `3.34.0-0.0.1` | 2025-05-14 | 4.28.0 |
| `react-native-gesture-handler` | **2.14.1**（新架构支持列写 **No**） | `2.14.17-rc.0` | 2025-04-17 | ~2.3x |
| `react-native-reanimated` | **3.6.0** | `3.6.4-rc.1` | 2025-05-24 | 4.7.0 |
| `react-native-safe-area-context` | **4.7.4** | `4.7.4-0.2.1` | 2025-03-11 | 5.x |
| `@op-engineering/op-sqlite` | **8.0.2** | `8.0.2-0.0.2` | 2024-11-14 | 18.2.5 |

**(c) 与本项目现状的直接冲突（都已读自仓库 `apps/mobile/package.json`）：**
- `react-native-safe-area-context: ^5.5.2` ←→ RNOH 适配基线 **4.7.4**
- `@op-engineering/op-sqlite: ^18.2.5` ←→ RNOH 适配基线 **8.0.2**
- 而且 `@react-native-oh-tpl/stack` 的 peer 写死 `@react-navigation/native: ^6.0.0` —— **在 HarmonyOS 上用 React Navigation 6，在 iOS/Android 上用 7，等于导航层分裂**。

**(d) 背景确认**：Software Mansion 与华为合作移植的库正是 `reanimated` / `gesture-handler` / `screens` / `webview` / `svg` / `safe-area-context`（【一手】[SWM 官方博客](https://swmansion.com/blog/huawei-x-software-mansion-bringing-react-native-support-to-harmonyos-next-82e02bd75549/)，2026-01-14）。该文仍写 *"RNOH supports React Native 0.77 and 0.72, and we're currently working on adding support for 0.82"* —— **已被 registry 证伪/过时**（0.82 与 0.84 均已发布）。这说明**关于 RNOH 的中文/英文二手信息普遍滞后，只有 registry 和那份总表可信**。

**结论**：导航/动画/手势这些"app shell 级别"的依赖，是"ONE UI 代码库"在 HarmonyOS 上**最先撞墙**的地方，而且不是"努力就能解决"的类型——它取决于 RNOH 生态的移植进度。

### 来源（Q3）
- https://reactnavigation.org/docs/web-support/ (7.x)
- https://docs.expo.dev/router/introduction.md (2026-09-16)
- https://docs.expo.dev/router/migrate/from-react-navigation/
- https://reactnavigation.org/blog/2025/12/19/react-navigation-8.0-alpha/ (2025-12-19) · https://github.com/react-navigation/react-navigation/releases (8.0.0-alpha.57, 2026-09-22)
- https://registry.npmjs.org/@react-navigation/native · https://registry.npmjs.org/@react-navigation/native-stack · https://registry.npmjs.org/react-native-screens · https://registry.npmjs.org/react-native-reanimated
- https://raw.githubusercontent.com/react-native-oh-library/usage-docs/master/en/README_EN.md
- https://registry.npmjs.org/@react-native-oh/react-native-harmony · /@react-native-oh-tpl/react-native-screens · /@react-native-oh-tpl/react-native-gesture-handler · /@react-native-oh-tpl/react-native-reanimated · /@react-native-oh-tpl/react-native-safe-area-context · /@react-native-oh-tpl/stack · /@react-native-oh-tpl/op-sqlite
- https://swmansion.com/blog/huawei-x-software-mansion-bringing-react-native-support-to-harmonyos-next-82e02bd75549/ (2026-01-14)
- https://solito.dev/ · https://dev.to/redbar0n/solito-5-is-now-web-first-but-still-unifies-nextjs-and-react-native-2lek 【片段】

---

## 4. 增量迁移的真实案例（问题 4）

### 4.1 先说最重要的结论

**公开记录里找不到任何一个"把已有 DOM/CSS React web 应用逐路由迁到 RNW"的具名案例。** 我把这一点作为**发现**而非失败记录下来。所有真实案例都是**反方向**或**同时新建**的。因此：**不要把"RNW 能把我们的 web 应用接过来"当作已验证的前提。**

### 4.2 有据可查的案例

**Expensify —— 最接近"单 RNW 代码库跑全平台"的大规模生产案例**【案例】
- New Expensify 从**一个 RN 代码库**出 web + iOS + Android + 桌面（Electron）；`npm run web|ios|android`；桌面渲染层被描述为 *"the webpack-bundled version of our react-native-web app"*。用 Jest 单测 + Reassure 做性能回归。
  → https://raw.githubusercontent.com/Expensify/App/main/README.md
- 迁移方式是**明确缓慢的增量**：Classic 与 New 双应用并行、逐功能切换。原文口径：*"you can try it out right now at new.expensify.com or by downloading it in your app store of choice."*
  → https://use.expensify.com/blog/new-expensify-progress-update (2023-11-02)
- ⚠️ **未验证**：找不到任何一手代码共享百分比。网上"共享量巨大"的说法没有数字支撑。

**Meta（Facebook/Instagram VR）—— 反方向：web → native，且换掉了 RNW**【案例】
- RNW 的作者本人（2025-11-24）：*"Over 60% of the files used by the Facebook VR app were shared directly with facebook.com"*（含 news feed、评论、内容渲染、router）。
- 迁移靠 **Babel codemod 双向转换**，其自述目的是 *"adopt a unified approach incrementally rather than requiring a risky rewrite."*
- 分歧处理：`*.native.js` / `*.web.js` + **共享 props 接口**。
  → https://nicolasgallagher.com/one-react-for-web-and-native/ (2025-11-24)

**Zalando —— 评估了两个方案，**选择了 react-strict-dom 而不是 RNW**【案例】
- 90+ 屏幕的渐进迁移；原文：*"Rebuilding our entire app at once is out of scope… Migrating more than 90 screens at once is not an option."*
- 明确拒绝 RNW：*"Although both options were feasible, we ultimately opted for react-strict-dom. Our decision was driven by the desire to select the most future-proof solution."*
- 先在一个**低流量屏幕**上上线。
  → https://engineering.zalando.com/posts/2025/10/accelerating-mobile-app-development-at-zalando-with-rendering-engine-and-react-native.html (2025-10-03)

**Microsoft Office/Word —— web 功能增量搬到原生桌面（走 RN for Windows，不是 RNW）**【案例】
- 原文：*"the cost of rewriting an entire app would be very expensive. Instead, Office incrementally adopts new UI frameworks for some experiences while leaving others on legacy frameworks."*（服务 6 亿用户）
  → https://devblogs.microsoft.com/react-native/2025-05-09-office-modernize/ (2025-05-09)

**Bluesky —— 单 RN 代码库出 web + iOS + Android**（README 自述 *"This is a React Native application"*；Go 只用于一个返回 RNW 应用的 web service）【案例】
- https://raw.githubusercontent.com/bluesky-social/social-app/main/README.md

### 4.3 反面证据（必须读，因为它决定风险预算）

**RNW 的创造者本人已经在 2025 年公开论证这条路对 web-first 团队不划算**（【案例】，同一篇 2025-11-24）：
- *"Compromised web experiences. … When running on the web, these abstractions result in bundle size increases and some runtime performance overhead. And critically, the web experience itself is diminished because existing React Native code often lacks the accessibility and responsive design optimizations required on the web. The result is web apps that feel like compromised ports rather than first-class web experiences."*
- *"Swimming against the ecosystem. … It doesn't make sense for organizations already invested in React on the web to retrain developers and rewrite components libraries to use React Native. It would be a massive switching cost with questionable returns."*
- *"A stagnant alternative. React Native's UI components have changed little over the past decade and never gained meaningful adoption among web developers."*
- 他给出的替代方向是 **React Strict DOM**（web API 优先，`html.div` / `css.create`），并称 Meta 用 codemod 双向迁移。

**Shopify 从 RN 撤回 Swift/Kotlin**【案例】——**但请精确引用，别误用**：
- 原文关键句：*"React Native apps can be fast. Ours are."* 以及 *"LLMs changed one of the core assumptions behind our 2020 decision"*。
- 即：**驱动因素是 AI 让"写两遍"不再昂贵，不是 RN 失败，且与 web/mobile 共享 UI 毫无关系。** 把它当作"RN 不行"的证据是误读。
- 对我们**真正有启发的**是他们的迁移工程方法：*"business logic should be completely decoupled from the UI and be able to run headlessly on desktop"*，再通过 CLI 让 agent 毫秒级迭代而不是分钟级驱动模拟器；每个 checkpoint 必须"测试证明行为 + 视觉比对 + 两个对抗式 reviewer + 人工点头"。
  → https://shopify.engineering/back-to-native (2026-09-10)（另见 https://shopify.engineering/five-years-of-react-native-at-shopify, 2025-01-13）

**一个具名代理记录的"通用化失败后拆回"案例**（客户匿名）【案例】：
- *"They had tried to build a universal app but the result was bad, they had a lot of problems sharing code between platforms. The end result: they reworked everything in separate projects, leaving behind the idea of something universal."*
- 第二个案例的问题是 **web 打包体积压垮 Core Web Vitals 与 SEO**，以及平台文件失控增殖。
  → https://www.paisanos.io/blog/the-universal-way-one-codebase-all-platforms (2025-05-08)

**RNW 的功能缺口是一手可查的**（【一手】[React Native compatibility](https://necolas.github.io/react-native-web/docs/react-native-compatibility/)，更新 2026-09-25）。`✘` = 完全没实现：**`RefreshControl`、`Alert`、`Settings`、`TouchableNativeFeedback`**；`(✓)` = 空实现/mock：`KeyboardAvoidingView`、`StatusBar`、`Keyboard`、`BackHandler`、`NativeModules`、`AccessibilityInfo`、`I18nManager`、`LayoutAnimation`（缺到 web 动画的转换）；部分实现：`Animated` **缺 `useNativeDriver`**、`Text` 无 `onLongPress`、`TextInput` 无富文本/自动扩展、`Image` 无多源与 HTTP headers、`ScrollView` 无 momentum scroll 事件。文档标注 *"Best used with React Native >= 0.68"*。

> **对本项目最要命的两条**：`Alert`（确认/破坏性操作）和 `RefreshControl`（下拉刷新）。这两个在 web 上必须**自己写**，且要有 `.web.tsx` 或 adapter —— 这恰好是 §2.4 说的"处方药"场景。

### 4.4 有据可查的增量技法

1. **打包器别名，在现有 web 应用内逐组件引入**（【一手】[RNW Setup](https://necolas.github.io/react-native-web/docs/setup/) / [Multi-platform](https://necolas.github.io/react-native-web/docs/multi-platform/)）：webpack / Babel / Jest / Flow / Node 五套官方配方；Vite 侧用 `vite-plugin-rnw`。**这是唯一有官方文档背书的"不改架构就能试"的路径。**
2. **Storybook on RNW(Vite) 作为共享 UI 试验场**（【一手】[Storybook for React Native Web](https://storybook.js.org/docs/get-started/frameworks/react-native-web-vite/)）：要求 RN ≥ 0.72 / RNW ≥ 0.19 / Vite ≥ 5；支持**同一项目里同时**跑 web Storybook 与真机 Storybook。web 版优点原文：sharing / documentation / component+visual+a11y testing / 500+ addons；native 版优点：native features / 真机发布。**注意：Storybook 官方并不建议只靠 web 版验证 native 保真度。**
3. **Expo `'use dom'` DOM components —— 官方明确称之为增量迁移手段**（【一手】[Using React DOM in Expo native apps](https://docs.expo.dev/guides/dom-components/)）：*"This enables incremental migration for an entire website to a universal app by moving on a per-component basis."* ⚠️ 但它依赖 Expo 运行时，本项目是裸 RN，**不能直接用**；它的价值在于证明"逐组件、反方向（web 组件进 native 容器）"是被官方认可的迁移粒度。
4. **双向 codemod**（【案例】Meta，同上）：`div`→`html.div`、`createStyles`→`css.create`、`<View>`→`html.div`、`StyleSheet`→`css.create`。对我们当下不直接适用（目标是 RNW，不是 RSD），但"用 AST 迁移代替人肉重写"这个模式可复用。
5. **Office 式的"新框架只吃部分界面"**：不重写全应用，逐体验迁移（同上）。
6. **Expensify 式的双应用并行 + 逐功能切换**（同上）。

### 4.5 证据薄弱之处（明确标注）

- **零个**"已有 DOM/CSS React web 应用 → RNW"的具名案例。
- **零个**一手代码共享百分比（Expensify / Twitter Lite / Flipkart / Bluesky 都没有数字）。
- Twitter Lite 的原始官方博客 **403/429 取不到**；且该文**从未提及 RNW**，RNW↔Twitter Lite 的关联只有 RNW 文档和 Expo 文档的口径。
- "RNW 已进入维护模式"是**第三方博客的推断**（itnext.io，2026-01-13），Medium 403 无法验证；我检查了 RNW 仓库 README，**不存在**任何维护模式声明。可验证的事实只有三条：(a) 作者已转向 RSD；(b) 他称 RN 的 UI 层"停滞"；(c) RNW 文档与发版仍在继续（0.21.3，2026-09-25）。
- "很多公司在用 RNW"这个说法，追根溯源只有 RNW 官方文档里那**三个 logo**（Meta、Twitter、Flipkart）——**比看起来弱**。
- 没有任何 RNW vs 纯 React DOM 的**同应用性能基准**。

### 来源（Q4）
- https://nicolasgallagher.com/one-react-for-web-and-native/ (2025-11-24) ★核心
- https://engineering.zalando.com/posts/2025/10/accelerating-mobile-app-development-at-zalando-with-rendering-engine-and-react-native.html (2025-10-03)
- https://shopify.engineering/back-to-native (2026-09-10) · https://shopify.engineering/five-years-of-react-native-at-shopify (2025-01-13)
- https://raw.githubusercontent.com/Expensify/App/main/README.md · https://use.expensify.com/blog/new-expensify-progress-update (2023-11-02)
- https://www.paisanos.io/blog/the-universal-way-one-codebase-all-platforms (2025-05-08)
- https://devblogs.microsoft.com/react-native/2025-05-09-office-modernize/ (2025-05-09)
- https://raw.githubusercontent.com/bluesky-social/social-app/main/README.md
- https://necolas.github.io/react-native-web/docs/react-native-compatibility/ (更新 2026-09-25)
- https://necolas.github.io/react-native-web/docs/setup/ · https://necolas.github.io/react-native-web/docs/multi-platform/
- https://storybook.js.org/docs/get-started/frameworks/react-native-web-vite/
- https://docs.expo.dev/guides/dom-components/

---

## 5. 测试与门禁（问题 5）

### 5.1 单元/组件测试：现状（版本全部读自 registry）

- **`@testing-library/react-native@14.0.1`（2026-06-23）**：peer `react >=19`、`react-native >=0.78`、`test-renderer ^1.0.0`；**`jest` 标为 optional**（`peerDependenciesMeta.jest.optional = true`）。v14 的关键变化是渲染器换成了新的 **`test-renderer`**（不再用 `react-test-renderer`），且 `render`/`fireEvent`/`act` 变为**异步**（需要 `await`）。
  → https://registry.npmjs.org/@testing-library/react-native/latest
- **RNTL 不做的事**（【一手】RNTL FAQ / testing-env）：不覆盖原生能力，不跑设备/模拟器，看不到 native view 状态，v14 的树只有 host 组件。
- **vitest 路线已经真实存在**：`vitest-native@0.13.0`（2026-08-18，**Beta**），peer `vitest >=4 <6`、`vite ^6.4.2||^7.3.2||^8.0.5`、`@testing-library/react-native >=12 <15`，自述 *"Run real React Native tests under Vitest. One install, zero config."*，声称验证过 RN **0.81–0.87**（**⚠️ 其仓库根 README 说 0.87、包内 README 说 0.86，自相矛盾**）。
  → https://registry.npmjs.org/vitest-native/latest
- **Jest preset 在 RN 0.85 被拆包**（【一手】[RN 0.85 发布说明](https://reactnative.dev/blog/2026/04/07/react-native-0.85)，2026-04-07）：`preset: 'react-native'` → `preset: '@react-native/jest-preset'`。**本项目是 RN 0.84，仍用旧的 `react-native` preset**——意味着**升级到 0.85 时必须改这一行**，属于已知的、可提前写进 checklist 的破坏性变更。0.85 同时把 Metro 提到 `^0.84.0`。
- **`jest-expo@57.0.5`（2026-08-26）**：默认 preset 是 `jest-expo/universal`（iOS+Android+web+Node），支持用 Jest `projects` 混合各平台 runner；peer 已指向 `@react-native/jest-preset ^0.86.3`。**Expo 官方没有 vitest 路径**（【一手】Expo 单元测试文档是 Jest-only）。
- ⚠️ **`vitest-native` 与 `jest-expo` 都是"押注"**：前者是 Beta + 版本自述矛盾；后者要求引入 Expo。本项目已有 **vitest 5 + jsdom（web）与 vitest 5（mobile）** 且 396 行门禁，直接切换到 Jest 生态的**迁移成本要单独评估**。

### 5.2 能不能一套组件测试同时跑 web 和 native？——**不能，除了纯逻辑**

- **不可能的原因（结构性，不是工具问题）**：RNTL 走 Test Renderer（Node 环境，无 DOM），RTL 走 jsdom/React DOM。RNTL 文档明确说**不存在**"RN 的浏览器式环境"。
- **现实可行的"一套"只有两种形态**：
  1. **`jest-expo/universal` 或 Jest `projects: [ios, android, web]`**：测试**文件**共享，但断言要按平台条件化，快照按平台分目录。
  2. **别名法**：把 `react-native` 解析到 `react-native-web`，用 **jsdom + RTL** 渲染 RN 组件 —— 这样 web 与 native 组件走**同一个渲染路径**（都是 RNW），代价是**验证不到真 native 行为**。assistant-ui 就是这么做的（§2.2 的配置）。
- **必须接受的分工**：

| 层 | 可共享 | 必须重复 |
|---|---|---|
| 纯逻辑 / 计算 / 状态机 | ✅ 100% | — |
| **设计 token 取值** | ✅ 100%（token 包是唯一真源） | — |
| 组件**源码** | ✅ 100% | — |
| 组件**渲染与查询层** | ⚠️ 仅在"用 RNW 当唯一渲染目标"时 | 否则 RTL(jsdom) 与 RNTL(Test Renderer) 各一套 |
| 交互/手势/原生 API | ❌ | 必须真机/模拟器 |

- **⚠️ 零风险替代路线**（对现有测试体系改动最小，强烈建议）：把**尽可能多的被测物下沉到"不 import react-native"的纯函数**，在 `packages/*` 里用**现有 vitest** 跑 100% 覆盖；组件层只保留极薄的渲染测试。Shopify 的撤退文章恰好给出了这条原则的产业级表述：*"business logic should be completely decoupled from the UI and be able to run headlessly on desktop."*（【案例】）本项目 `packages/app-host`、`domain`、`sync-core` 的既有切分**已经**朝这个方向走了——**继续加深它，比引入第二套测试运行时更划算**。

### 5.3 E2E：每个目标怎么测

| 目标 | 工具 | 状态 / 版本 | 关键限制 |
|---|---|---|---|
| Web | **Playwright** | 1.63.0 | 本项目已有 `e2e/` + playwright + `playwright.multi-end.config.ts` |
| iOS / Android | **Detox 20.51.4**（2026-06-16） | 官方原文：*"RN `v0.77.x` - `v0.84.x`: Fully compatible with React Native's 'New Architecture'*. Newer RN versions might work with Detox, but they've not been thoroughly tested"* | **RN 0.84 正好是 Detox 官方支持区间的上界**——升到 0.85 就出了官方承诺范围 |
| iOS / Android（备选） | **Maestro**（CLI 2.10.0） | 官方支持列表：Android / iOS / React Native / Flutter / web | 新架构支持**无官方声明**（【子代理】：RN 平台页与 Known Issues 均无相关章节） |
| **HarmonyOS** | **无** | Detox 只有**未合入上游**的社区 fork（wix/detox#4968，2026-08-11，triage）；Maestro `--platform harmony` 直接报 `unsupported platform: harmony`（mobile-dev-inc/maestro#3196，2026-04-21，无维护者回复） | **目前不存在官方维护的 HarmonyOS E2E 门禁** |

- Detox 支持区间来源（【一手】我逐字读过）：https://wix.github.io/Detox/docs/introduction/environment-setup/
- **对本项目的直接含义**：`verify:harmony-rnoh` / `verify:harmony-rnoh-js` 这类**脚本式验证**在 HarmonyOS 上是**必需而非权宜**——因为 E2E 工具链缺位，只能靠"脚本能跑通 + 断言 JS 侧行为"来充当门禁。这恰好是本项目已有的做法，**应当把它当作长期资产而不是临时补丁**。

### 5.4 设计 token 门禁：跨 target 怎么卡

**先看本项目已经有的（读自仓库）**，这决定了建议的形态：
- `packages/design-system` 是**唯一真源**，已生成 web（CSS vars）、RN（`src/native.ts`）、Swift、ArkTS 多目标产物；有 `check:tokens`（`generate:check` 校验生成物与源一致）。
- `design-system/heyta/check-hardcoded.mjs` 已经拦：裸 hex、裸 px、裸 ms/s、裸 z-index、裸 rgb()/rgba()。**但其检查范围注释明确写的是 `apps/web` 下的组件代码**，且规则是"必须用 `var(--ht-*)`"。
- `design-system/heyta/check-arkts-compile.mjs` 已经做 ArkTS 编译检查。

**⚠️ 这就是门禁的真正缺口**：现有 `check-hardcoded` 的规则形态是 **CSS 变量**，而 **RN 没有 `var()` 也没有层叠**（本项目 `src/native.ts` 的文件头注释已经写明了这一点：*"RN 没有 `var()`，也没有层叠"*）。所以：
- 一旦 UI 代码迁到 RN 组件 + `StyleSheet.create`，"必须用 `var(--ht-* )`"这条规则**在新代码上失效**，且 `check-hardcoded` 不会报错——**静默失去保护**。
- 需要的第二条 token 规则是：**RN 样式里不得出现裸字面量，必须来自 `useTokens()` / token 产物**。

**现成可用的工具（版本读自 registry / 一手文档）**：
- `eslint-plugin-react-native@5.0.0`（2024-12-30）规则 **`no-color-literals`**：拦 `StyleSheet.create` 与 JSX `style` 里的颜色字面量。**只覆盖颜色，不覆盖间距/字号/时长。**
- **ESLint core `no-restricted-syntax`**：AST selector 原语，可以自定义拦"裸数字进 style 对象"，无需写插件。这是覆盖面最广的零依赖选项。
- `eslint-plugin-design-tokens` / Sitka 的 `eslint-plugin-sitka-tokens`（`token-usage`：拦硬编码 hex/px/radius/shadow）/ Kong 的 `@kong/stylelint-plugin-design-tokens`：能覆盖 hex+px，但都是**第三方小项目**（【子代理】），引入需过可维护性 + 许可证两道门。⚠️ `stylelint-react-native@2.7.0` 最后发布 **2024-01-21**，近两年未更新。
- `style-dictionary@5.5.5`（2026-09-20，Node ≥22，ESM）是跨平台 token 构建的产业默认选择——但**本项目已经有自己的生成器，没有必要切换**。

**建议形态（与现有门禁同构，不引入新生态）**：把 `check-hardcoded.mjs` 扩展成两个 target 感知的规则集——`target: web`（沿用 `var(--ht-*)` 规则）+ `target: native`（要求 token 取值来自 `@heyta/design-system/native`）——并把它挂到**已有的 `check` 聚合脚本**上。**零新依赖，且与 `check:tokens`（保证 token 产物本身没漂移）形成互补**：前者保证"用的是 token"，后者保证"token 本身是对的"。

### 来源（Q5）
- https://registry.npmjs.org/@testing-library/react-native/latest · /test-renderer/latest · /jest-expo/latest · /@react-native/jest-preset/latest · /vitest-native/latest · /detox/latest · /eslint-plugin-react-native/latest · /stylelint-react-native/latest · /style-dictionary/latest · /@playwright/test/latest
- https://reactnative.dev/blog/2026/04/07/react-native-0.85 （Jest preset 拆包 + Metro 0.84）
- https://wix.github.io/Detox/docs/introduction/environment-setup/ （RN 0.77.x–0.84.x 新架构）
- https://docs.maestro.dev/get-started/supported-platform/react-native.md · https://github.com/mobile-dev-inc/maestro/issues/3196 · https://github.com/wix/detox/issues/4968 【子代理】
- https://www.assistant-ui.com/docs/react-native/testing
- https://necolas.github.io/react-native-web/docs/setup/
- https://eslint.org/docs/latest/rules/no-restricted-syntax
- https://storybook.js.org/docs/get-started/frameworks/react-native-web-vite/
- 本项目 `packages/design-system/package.json`、`packages/design-system/src/native.ts`、`design-system/heyta/check-hardcoded.mjs`、`package.json`（一手证据）

---

## 6. 信心等级

### 6.1 强证据（一手文档 / 包注册表，我逐字读过或直接读的 JSON，可直接作为决策依据）

- **版本与兼容性矩阵**：RN 0.84.1 的 peer `react ^19.2.3`；RNW 0.21.3 peer 接受 `^18||^19`；Metro 0.83.3 随 RN 0.84.1；RN 0.85 拆出 `@react-native/jest-preset`；Expo SDK 55/56/57 = RN 0.83/0.85/0.86。全部来自 registry JSON 与官方发布说明。
- **RNOH 与 RN 0.84.1 精确对齐**：`@react-native-oh/react-native-harmony@0.84.4`，peer `react-native 0.84.1`。**这是好消息**，且推翻了 SWM 2026-01 博客与 daily.dev 二手摘要（两者都说只支持 0.72/0.77）。
- **RNOH 第三方库适配层严重滞后且为 patch 模式**：396 条总表 + 52 条 In Progress + 各 `@react-native-oh-tpl/*` 的发布日期与 peer 固定版本。**这是坏消息**，也是我本次最重要的发现。
- **Metro 的解析算法与语义**：平台后缀顺序、`preferNativePlatform`、`resolverMainFields` 在 RN 下的默认值、`unstable_enablePackageExports` 自 Metro 0.82 默认开启、**`exports` 命中时平台后缀不生效**、symlink 目标必须在 watchFolders 内。全部为 Metro 官方文档原文。
- **`unstable_enableSymlinks` 已移除**（0.80 默认 / 0.81 移除）→ 大量 2025 年 pnpm 教程已过期。
- **React Navigation 在 web 上的具体失效点**：无动画/无手势、必须用 `Link` 才能出 `<a>`、SSR 支持有限、SPA 需要 rewrite 规则。官方文档原文。
- **Expo Router 只能在 Expo CLI + Metro 下工作**。官方文档原文 → 与本项目 Vite 直接冲突。
- **RNW 的功能缺口表**（`Alert`/`RefreshControl`/`Settings`/`TouchableNativeFeedback` 完全缺失等）。官方文档原文（更新 2026-09-25）。
- **Detox 官方支持 RN 0.77.x–0.84.x 新架构**。官方文档原文——RN 0.84 恰好在区间上界。
- **HarmonyOS 无官方 E2E 工具**：Maestro 明确不支持、Detox 只有未合入的 fork。
- **RNW 作者本人 2025-11 的公开批评与转向 RSD**（我逐字读了原文，不是二手转述）。

### 6.2 中等证据（可信但需按条件使用）

- **Meta 的 ">60% 文件与 facebook.com 共享"**：出自 RNW 作者本人的一手文章，但我**无法独立复核**这个数字；且它是 **web→native + React Strict DOM**，**不是** RNW，也不是"现有 web 应用迁到 RNW"。引用时必须带上这两个限定。
- **Expensify 单 RNW 代码库跑全平台**：README + 公司博客可证，但**无代码共享百分比、无性能数据**。
- **Shopify 的全部数字**（启动时间 −23%/−50%、稳定性 99.5%→99.95%、体积 −37%）：一手且双文互证，但**与 web/native UI 共享无关**，且是 AI 驱动的一次性重构，外推性有限。
- **Zalando 的决策叙事**：一手、承认了被拒方案，但**没有给出量化结果**。
- **`vitest-native` 能跑 RNTL**：registry + 其 README 自述，但它是 **Beta**，且**官方 Expo 无 vitest 路径**，RN 版本范围自述矛盾。
- **`vite-plugin-rnw` / `vite-plugin-react-native-web`**：可用，但分别是 0.0.x 与 3.2.0，且 `vite-plugin-rnw` 作者自述处于"非正常约束"下运作。
- **设计 token lint 插件**（aiuxmasters / Sitka / Kong）：文档可读，但都是小项目、无生产使用证据。

### 6.3 薄证据 / 我**没能**验证的东西（**不要**拿这些做决策）

1. **零个**"已有 DOM/CSS React web 应用 → RNW"的具名案例。这是本次研究最重要的**空白**。
2. 任何采用者的一手代码共享百分比（Expensify / Twitter Lite / Flipkart / Bluesky 都没有）。
3. Twitter "How we built Twitter Lite" 原始博客：**403（线上）与 429（archive.org，两次）**均取不到；且该文**从不提及 RNW**。
4. "RNW 进入维护模式"：**第三方推断**（itnext.io，2026-01-13），Medium 403 无法验证；RNW 仓库 README 中**不存在**该声明。可验证的只有：作者已转向 RSD + 称 RN UI 层"停滞" + 文档与发版仍在继续。
5. **所有 Reddit 内容**：reddit.com 与 old.reddit.com 均 403 → 本报告中任何 Reddit 相关说法都只是搜索片段，**属传闻**。
6. Hacker News 讨论正文、GitHub discussions（RNW #2646、RSD #270）正文：抓取只得到导航框架，**仅片段**。
7. **Maestro 对新架构的支持状况**：无官方声明，无维护者回复 → 视为**未证实**。
8. **RNOH 的第三方库总表是否会随后续 RNOH 版本大幅更新**：我只能观测到当前快照（396 条 / 52 条 In Progress）；**没有找到 RNOH 官方的移植路线图或 SLA**。因此 §3.4 的结论有**时效风险**，必须定期重查。
9. `stylelint-react-native` 的 token 规则覆盖范围（最后发布 2024-01-21，未验证其规则细节）。
10. 任何 RNW vs 纯 React DOM 的**同应用性能基准**（不存在）。
11. Airbnb 2018 "Sunsetting React Native"：Medium 403。且属移动端撤回，与 web 无关，本报告未依赖它。
12. 我**没有**实地跑过 RNW + Vite 7 + React 19.2 的任何构建。"Vite 侧可跑"是基于官方别名配方与 assistant-ui 的公开配置推断的，**属于待验证假设**。

> **关于方法的一点透明度**：本报告有 5 条来源（Expo DOM components 的增量迁移定位、Maestro 不支持 HarmonyOS、Detox HarmonyOS fork 的 issue 状态、若干 lint 插件的规则细节、以及 assorted 二手来源的可达性）来自一个并行子代理的全文抓取（标记【子代理】）。其中**最关键的三条我做了独立复核**：Expo DOM components（我逐字读了原文）、Detox 官方支持区间（我逐字读了 environment-setup 页）、RN 0.85 Jest 拆包（我逐字读了发布说明）。**§3.4 的 RNOH 结论完全由我自己的 registry 查询与官方总表得出**，不依赖子代理。

---

## 7. 对本项目的直接含义

### 7.1 现状实测（读自仓库，非推测）

| 事实 | 位置 | 对本决策的意义 |
|---|---|---|
| 裸 RN 0.84.1，**非 Expo** | `apps/mobile/package.json` | Expo Router / `jest-expo` / `use dom` **全部不可直接用**；Expo monorepo 自动化也不适用 |
| RN 0.84.1 **不在任何稳定 Expo SDK 上** | SDK 55=0.83 / 56=0.85 | 若要走 Expo 路线，必然伴随 RN 升级（见 R1） |
| `react-native-safe-area-context: ^5.5.2` | `apps/mobile/package.json` | RNOH 适配基线是 **4.7.4** → 主版本冲突，**已存在的**落地风险 |
| `@op-engineering/op-sqlite: ^18.2.5` | `apps/mobile/package.json` | RNOH 适配基线是 **8.0.2**（2024-11）→ 10 个大版本差 |
| **没有任何导航库**（`apps/mobile/src/nav` 只有手写 `TabBar.tsx`） | 仓库 | Q3 是**尚未落地的决策**，现在调整成本最低 |
| `packages/design-system` 有 `exports` + `./native` 子路径 | `package.json` | 已是正确形态；`packages/ui` 必须沿用或干脆不加 `exports` |
| `check:design` / `check:tokens` / `check:arkts` / `verify:harmony-rnoh*` 已存在 | 根 `package.json` | **门禁文化已建立**；建议是扩展，不是新建 |
| `check-hardcoded.mjs` 规则基于 `var(--ht-*)`，范围是 `apps/web` | `design-system/heyta/` | 迁到 RN 组件后这条规则**静默失效**（RN 无 `var()`） |
| `metro.config.js` 已含双 React 的 `resolveRequest` 单例修补 + `disableHierarchicalLookup` 反例注释 | `apps/mobile/metro.config.js` | 本项目已有**比官方文档更准确**的一手知识；应写成 ADR，避免被"照抄官方"的建议覆盖 |
| web = Vite 7.1 + vitest 5 + jsdom；mobile = vitest 5 | 两个 `package.json` | 引入 Jest 生态（RNTL/jest-expo/Detox）是**跨生态迁移**，成本要单独立项 |
| 代码量：mobile 38 文件 / web 59 文件 | 实测 | 规模可逆，**现在做架构决策的代价远低于一年后** |

### 7.2 按风险排序的建议

**R1（最高风险｜必须先解决）：先锁定"目标 RN 版本"这一个数，因为它同时被 RNOH 和 Expo 夹住。**

当前 RN 0.84.1 是与 RNOH 0.84.4 精确对齐的，**这是本项目最宝贵的既成资产**。但 0.84.1 落在 Expo SDK 55(0.83) 与 56(0.85) 之间，意味着**"用 Expo 换自动化"和"保住 HarmonyOS 精确对齐"目前是互斥的**。

建议：**不要在本次迁移中动 RN 版本**。理由：RNOH 0.84 线只有 4 个发布（0.84.1→0.84.4，2026-07→09），是**刚起步的线**；同时 RNOH 只维护 0.72/0.77/0.82/0.84 四条线，**跳到 0.85/0.86 会直接掉出 RNOH 支持范围**（registry 上不存在 0.85/0.86 版本）。**接受"不用 Expo"这个代价**，把 Expo 从方案里划掉。这一步的价值是**消除了整份研究里最大的不确定性**。

**R2（高风险）：把"单一 UI 代码库"降级为"共享 UI 层 + 三个薄壳"，并且**在 web 上不要以 RNW 为唯一渲染路径**。**

证据：（a）RNW 的作者本人已公开论证 web-first 团队改 RNW 是 *"massive switching cost with questionable returns"*，并给出三条具体失效（体积、运行时开销、a11y/响应式缺失）；（b）Zalando 面对同样的选择选了 RSD 而不是 RNW；（c）**公开记录里零个"现有 web 应用迁到 RNW"的案例**。
建议：web **保留现有 DOM/CSS 实现**，把 `packages/ui` 写成**以 RN 为渲染目标的真源**，web 侧通过别名映射 RNW **逐组件**接入（§4.4 技法 1），而不是一次性替换 `apps/web/src/features/*`。**"消除重复"通过"web 逐 feature 换成 RNW 组件"实现，而不是通过"重写 web"实现。**

**R3（高风险）：导航先用 React Navigation 7，且**为 HarmonyOS 准备降级路径**；不要用 Expo Router。**

- Expo Router 直接出局：它要求 Expo CLI + Metro，而 web 是 Vite（官方原文）。
- React Navigation 7 **可以**用：`react-navigation/native@7.4.1` 与 RNW 是官方支持组合，且有完整的 web 失效清单可逐条规避。
- **但必须承认**：RNOH 的导航适配是 React Navigation **6.x**，且 `@react-native-oh-tpl/stack` 的 peer 写死 `@react-navigation/native: ^6.0.0`。所以建议：**把导航抽象成项目自己的极薄接口**（`apps/mobile/src/nav` 已有手写 TabBar 的基础），业务屏幕**只依赖该接口**不直接依赖 React Navigation 类型。这样 HarmonyOS 走 v6 适配、iOS/Android 走 v7 时，业务代码零改动。**这是本项目为"多目标"必须付出的架构税，早付比晚付便宜。**

**R4（高风险，但影响面被 R2 限制）：把 HarmonyOS 当作"独立目标"验证，不要假设单一代码库能自动覆盖。**

必须先跑通一个**最小可用性验证**：`react-native-screens@3.29/3.34 + gesture-handler@2.14.1 + reanimated@3.6.0 + safe-area-context@4.7.4` 这套**固定基线**在 RN 0.84.1 + RNOH 0.84.4 上能否构建并运行。**这一步必须最先做，因为它可能否掉整个"ONE UI 代码库"的前提。** 好消息是 `verify:harmony-rnoh` / `verify:harmony-rnoh-js` 已存在，可以直接扩展。

**R5（中风险）：立即处理两个**已存在**的版本冲突。**

- `react-native-safe-area-context: ^5.5.2` → 需要确认在 HarmonyOS 上如何降级到 4.7.4，或验证 5.x 是否有未记录的适配。
- `@op-engineering/op-sqlite: ^18.2.5` → RNOH 基线是 **8.0.2（2024-11）**。这是**数据库**，不是 UI，**它不应该成为 UI 迁移的阻塞项**。建议把 SQLite 访问完全封在 `packages/storage` 之后（如果已经如此，则只需在 HarmonyOS 构建里提供一个 op-sqlite 8.x 的适配实现），并**明确写成 ADR**：HarmonyOS 的性能/兼容上限由 RNOH 生态决定，不能拿 iOS/Android 的依赖版本去要求它。

**R6（中风险）：测试策略"加深纯逻辑测试，不引入第二套运行时"。**

- **不要**现在引入 Jest/jest-expo/RNTL —— 那是跨生态迁移，且要重写已有的 396 行 vitest 门禁。
- **要**做的是：把 UI 迁移中必然出现的逻辑（列表排序、分组、拖拽落点计算、日期解析、表单校验）**全部下沉到 `packages/*`**，用**现有 vitest** 覆盖。Shopify 的 *"business logic should be completely decoupled from the UI and be able to run headlessly"* 正是这个方向，且和本项目 `packages/app-host` / `domain` 的既有切分一致。
- 组件层测试**先薄后厚**：一期只对 `packages/ui` 用别名法（RNW + jsdom + 现有 vitest）跑冒烟级渲染测试。
- E2E：**HarmonyOS 只能靠脚本**（无 Detox/Maestro 支持）→ 把 `verify:harmony-rnoh*` 当作**长期门禁资产**，而不是临时脚本。iOS/Android 若要上 Detox，**注意 RN 0.84 是 Detox 官方支持区间的上界**（`v0.77.x`–`v0.84.x`），这也**反向支持 R1 的"不要动 RN 版本"**。

**R7（中风险）：扩展已有 token 门禁，而不是引入新 lint 生态。**

- `check-hardcoded.mjs` 现在是"web + CSS 变量"取向，**迁到 RN 组件后会静默失效**。必须新增 **native 规则集**：RN 样式对象里不得出现裸字面量，取值必须来自 `@heyta/design-system/native`。
- 优先用 **`no-restricted-syntax`**（ESLint core，零新依赖）而不是 `eslint-plugin-react-native`（只覆盖颜色）或小作者插件（需过两道门）。
- 与 `check:tokens`（保证 token 产物本身不漂移）**互补**：一个管"用的是 token"，一个管"token 本身是对的"。

**R8（低风险，但让 AI 协作显著变快）：把"UI 之外的一切可无头运行"作为硬性架构约束。**

Shopify 的核心教训不是"RN 好或不好"，而是：*"the core principle here is that business logic should be completely decoupled from the UI and be able to run headlessly on desktop"*，再通过 CLI 让 agent 毫秒级迭代而非分钟级驱动模拟器。对**单人 + AI agent** 的团队，这是**杠杆最大的一条**，且**与 UI 库选型完全正交**——无论最终选 RNW 还是 RSD，这条都成立。

### 7.3 第一个该做的东西（de-risk 顺序）

**第 0 步（1–2 天，纯验证，不写产品代码）：做一个"三目标空壳"spike。**

一个仓库内、一个 `packages/ui` 包，导出**一个**组件（`<Button>`，含 token 取值 + 一个平台分歧点）：

1. **iOS/Android**：`apps/mobile` 里渲染它，用**现有 vitest** 加一个渲染冒烟测试。
2. **Web**：在**现有 Vite 应用里逐组件接入**（`resolve.alias` + `.web.tsx` 优先 + `resolve.dedupe: ['react','react-dom']`），**不改变 `apps/web` 的其他任何部分**。
3. **HarmonyOS**：用 §7.2 R4 那套固定基线（screens 3.29/3.34 + gesture-handler 2.14.1 + reanimated 3.6.0 + safe-area-context 4.7.4）构建，跑通 `verify:harmony-rnoh`。

**判定标准（必须是可执行的，不是感觉）：**
- ✅ 三个目标都能渲染同一个 `<Button>`，且 token 值来自同一份生成产物。
- ✅ web bundle 里**没有** `react-native-gesture-handler` / `react-native-reanimated`（验证 §3.2 的剪枝要求真的生效）。
- ✅ bundle 里 **React 只有一个副本**（web 用 `resolve.dedupe`，native 用现有 `resolveRequest` 修补；这是本项目已经踩过的坑，必须回归）。
- ✅ `check-hardcoded` 的 native 规则能够**拦住**一个故意写死的 `#2563EB`（先证明门禁有效，再写代码）。

**为什么是"三目标空壳"而不是"先把 web 迁完"**：因为**唯一可能否掉整个方案的前提是 HarmonyOS 的第三方库基线**（R4）。它必须**在投入任何 UI 迁移工作量之前**被证伪或证实。web 迁移可以随时回退（R2 已保证这一点），但"HarmonyOS 上跑不起现代导航/动画"是不可回退的架构约束。

**明确不要做的事（基于本次证据）**：
- ❌ 不要为了用 Expo Router 而把 web 从 Vite 迁到 Metro。
- ❌ 不要在本轮迁移中升级 RN 版本（会掉出 RNOH 支持范围，也会掉出 Detox 官方支持区间）。
- ❌ 不要把 `apps/web/src/features/*`（59 文件）整体重写为 RNW —— 没有先例、没有性能数据、且 RNW 作者本人反对。
- ❌ 不要把"引入 Jest/RNTL/jest-expo"和"UI 统一"打包成同一个 PR。
- ❌ 不要在 `packages/ui` 里同时使用 `exports` 字段**和**依赖 `.native.tsx` 扩展名解析（§2.3，会静默失效）。
