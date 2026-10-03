const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro 配置（pnpm monorepo 版）
 * ==============================
 *
 * 🔴 这里有一条**实测踩出来的**教训，写下来免得下次再踩：
 *
 * 网上（包括 RN 官方 monorepo 文档）推荐的配置里有
 * `resolver.disableHierarchicalLookup: true`。**在这个 pnpm 布局下它是错的。**
 *
 * 原因：pnpm 把 `react-native` 的依赖放在**它自己的同级目录**里，而不是提升到根：
 *
 *     node_modules/.pnpm/react-native@0.84.1_<hash>/node_modules/
 *         react-native/            ← 包本体
 *         @react-native/virtualized-lists/   ← 它的依赖，是**同级**不是子级
 *
 * 于是 `react-native/Libraries/Modal/Modal.js` 里那句
 * `require('@react-native/virtualized-lists')` 只能靠**向上逐级查找**命中。
 * 关掉层级查找后，Release 打包直接失败：
 *
 *     UnableToResolveError: Unable to resolve module @react-native/virtualized-lists
 *       from .../react-native/Libraries/Modal/Modal.js
 *
 * ⚠️ 症状的迷惑之处：**Debug 构建照常成功**（Debug 不从 Metro 打包，只连开发服务器），
 * 只有 Release 打包或真机跑才会炸。所以"能构建"不等于"能打包"。
 *
 * 那 `disableHierarchicalLookup` 想防的"两个 React 实例"怎么办？
 * 用 `nodeModulesPaths` 的**顺序**解决：本包优先，然后才是根。
 * 这已经足够 —— 不需要把层级查找整个关掉。
 */

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = {
  // 必须包含仓库根，否则看不到 `packages/*` 里的 workspace 依赖，
  // 报错会指向一个明明装好了的 `@heyta/*`。
  watchFolders: [workspaceRoot],
  resolver: {
    // 顺序有意义：本包在前。**不要**关 disableHierarchicalLookup，
    // 理由见文件头 —— react-native 的嵌套依赖靠它才能解析。
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    // 原生模块的产物里可能引用 .cjs/.mjs，Metro 默认不认。
    sourceExts: ['js', 'jsx', 'ts', 'tsx', 'json', 'cjs', 'mjs'],

    /**
     * 把 React 强制钉成**单实例**。
     *
     * 🔴 这里原本只靠 `nodeModulesPaths` 的顺序，**它不够** —— 实测证据：
     *    打进 release APK 的 bundle 里有**两份** React：
     *
     *      apps/mobile/node_modules/react     -> 19.2.3   （app 的依赖）
     *      packages/i18n/node_modules/react   -> 19.3.0   （i18n 的 devDependencies）
     *
     *    因为 `packages/i18n/dist/index.js` 位于**仓库根**下，
     *    Metro 从它出发**逐级向上查找**时命中的是 `packages/i18n/node_modules/react`，
     *    而**不是** `nodeModulesPaths` 里的那两份。
     *    （`nodeModulesPaths` 是"找不到时才去的地方"，本包自己有就不去。）
     *
     *    代价是应用**一启动就崩**，而且崩在**看起来毫不相干**的地方：
     *
     *      TypeError: Cannot read property 'useContext' of null
     *        at TasksScreen
     *
     *    因为 `@heyta/i18n` 的 `useContext` 来自 19.3.0 那份，
     *    而 `TasksScreen` 自己的 hook 来自 19.2.3 那份 ——
     *    两个 React 各有各的 dispatcher，i18n 那一侧就是 `null`。
     *
     * ⚠️ `extraNodeModules` **修不了这个**：它只是解析失败时的兜底，
     *    而 i18n 本地那份 React **存在**，正常解析会成功，兜底根本不会触发。
     *    所以必须在这里**硬改写** `originModulePath`，让这三个说明符
     *    一律从 app 根出发解析。
     *
     * ⚠️ 范围**刻意收窄**到 `react` 的三个入口：不要顺手把 `react-native`
     *    也拦进来 —— 它内部有大量相对/嵌套解析，改写起点会连带弄坏它们。
     */
    resolveRequest: (context, moduleName, platform) => {
      /** 只有这三个说明符需要唯一化。`react-dom` 在 RN 里用不到。 */
      const SINGLETONS = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'];

      if (SINGLETONS.includes(moduleName)) {
        return context.resolveRequest(
          // 把解析起点伪装成 app 根目录，于是必然命中 app 自己那份。
          { ...context, originModulePath: path.join(projectRoot, 'index.js') },
          moduleName,
          platform,
        );
      }

      /**
       * `react-native` 的**同一条洞**，只是上面那段刻意没管它。
       *
       * 🔴 实测（2026-10-03，移动端便签链真机验收 `pnpm verify:mobile-notes`）：
       *    同一个包里 `apps/mobile` 的输入框（凭据三个字段）填得进去，而
       *    `@heyta/ui` 的 `NotesBoard` composer 一提交就**整个应用崩**：
       *
       *      com.facebook.react.common.JavascriptException:
       *        Error: Unsupported top level event type "topSelectionChange" dispatched
       *
       *    根因是**两份 react-native 进了同一个 bundle**（同版本 0.84.1、不同 peer 解析），
       *    现量两条：
       *
       *      node -e 'console.log(require.resolve("react-native",{paths:["packages/ui/src"]}))'
       *        -> .../.pnpm/react-native@0.84.1_..._b5892f35.../node_modules/react-native/index.js
       *      node -e 'console.log(require.resolve("react-native",{paths:["apps/mobile/src"]}))'
       *        -> .../.pnpm/react-native@0.84.1_..._67cc6a65.../node_modules/react-native/index.js
       *
       *    两份各有各的事件表，于是一端创建、另一端派发 —— 报的就是那句
       *    「不支持的顶层事件」。**上面那段文件头把 react-native 排除在改写之外，
       *    理由是它内部大量相对/嵌套解析会被连坏**：那个顾虑是对的，但它可以绕开，
       *    不必因此留着两份。绕法是把改写的**触发面**收到最窄：
       *
       *      只处理**裸**说明符 `'react-native'`（带子路径的 `react-native/Libraries/…`
       *      一概不碰 —— 那正是原注释担心的那类），并且**跳过 react-native 自己**
       *      （它的内部 require 起点在 `node_modules/.pnpm/react-native@…` 下）。
       *
       * ✅ 判据（这条改动只有一处可观测后果，就数它）：
       *
       *      cd apps/mobile && npx react-native bundle --platform android --dev false \
       *        --entry-file index.js --bundle-output /tmp/p.js --sourcemap-output /tmp/p.map --reset-cache
       *      # 再数 sourcemap 里 `…/node_modules/react-native/` 的**实例前缀**个数
       *
       *    实测 2026-10-03：改之前 **2 个实例**（各 429 个模块 —— 整份 RN 打了两遍），
       *    改之后 **1 个实例**（648 个模块）。
       *
       * ⚠️ 这条洞一直存在，只是**以前没人从 `@heyta/ui` 里在真机上打过字**：
       *    `SearchPanel` / `NotesBoard` / `HabitBoard` 的输入框此前从未被任何
       *    `verify-mobile-*` 覆盖。定位靠的是同一趟里的 A/B —— `apps/mobile` 自己的
       *    凭据输入框（app 那份 RN）填得进去，`@heyta/ui` 的便签输入框（根那份）
       *    一点提交就崩。是这一批把移动端便签编辑接上时才照出来的。
       */
      if (
        moduleName === 'react-native' &&
        !context.originModulePath.includes(`${path.sep}.pnpm${path.sep}react-native@`)
      ) {
        return context.resolveRequest(
          { ...context, originModulePath: path.join(projectRoot, 'index.js') },
          moduleName,
          platform,
        );
      }

      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
