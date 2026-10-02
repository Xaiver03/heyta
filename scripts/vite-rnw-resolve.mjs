/**
 * React Native Web 的 Vite 解析配置（**唯一一份**）
 * =================================================
 *
 * 为什么单独抽出来：`apps/web`（浏览器）与 `apps/desktop`（Electron 渲染进程）
 * 是**两个独立的 Vite 应用**，但它们必须用**逐字相同**的一套解析规则 ——
 * 因为共享包 `@heyta/ui` 写的是 `from 'react-native'`，谁家的规则错一点，
 * 谁就崩，而崩法极难定位（见下）。
 *
 * 复制一份的代价不是"多 50 行"，而是**漂移**：`.web.*` 的后缀顺序只错一边时，
 * 另一边照样绿。所以这里只留一份，两个配置都 import 它。
 */

import { createRequire } from 'node:module';
import { dirname } from 'node:path';

/**
 * 🔴 解析锚点**必须是调用方（那个 app 的 vite.config）的 URL**，不能是本文件。
 *
 * 上一版在模块顶层写 `createRequire(import.meta.url)` —— 那个 URL 是
 * `<repo>/scripts/vite-rnw-resolve.mjs`，而 pnpm 的隔离布局里
 * `scripts/` **没有任何 node_modules 通道**（根 `node_modules` 也不会有
 * `react-native-web`，它只装在各 app 自己的 `node_modules/` 下）。
 * 于是 `require.resolve('react-native-web/package.json')` 在**求值期**就抛
 * `MODULE_NOT_FOUND`，Vite 连配置都加载不完：
 *
 *     Require stack: .../scripts/vite-rnw-resolve.mjs
 *
 * 而 `pnpm -r build` 里 `apps/web` 那一段**照样绿** —— 因为它用的还是自己那份
 * 内联副本（这个 helper 当初只搬了桌面端）。也就是说"抽一份共享"之后，
 * **唯一消费它的那一端从来没构建成功过**，而仓库里没有任何一条命令会因此失败
 * （`pnpm check` 不做打包）。
 *
 * ⚠️ 本文件所在的 `scripts/` 不是包，没有 `package.json` 可以锚，
 * 所以锚点只能由调用方给 —— 传错（例如传本文件自己的 URL）就是上面那个症状，
 * 这里不替调用方兜底：让它响亮地失败，比静默解析到别人家的副本好。
 */
function resolveFrom(callerUrl) {
  const require = createRequire(callerUrl);
  return {
    webDir: dirname(require.resolve('react-native-web/package.json')),
    svgWeb: require.resolve('react-native-svg/lib/module/ReactNativeSVG.web.js'),
  };
}

/**
 * 🔴 别名要指向**绝对路径**，不能直接写 `'react-native-web'`。
 *
 * 第一版写的就是 `replacement: 'react-native-web'`，构建直接失败：
 *
 *     Could not load react-native-web (imported by ../../packages/ui/dist/index.js):
 *     ENOENT: no such file or directory, open 'react-native-web'
 *
 * 根因是 pnpm 的隔离布局 + 解析**从导入方所在位置开始**：
 * `@heyta/ui` 是 workspace 包，Vite 解析到它的真实路径 `packages/ui/dist/`，
 * 于是从 `packages/ui/` 往上找 `react-native-web` —— 而它只装在各个 app 自己
 * 的 `node_modules/` 下，根 `node_modules` 里没有。
 *
 * 换成绝对路径就绕开了"从谁的位置找"这个变量。
 *
 * ⚠️ `react-native-web` **没有 `exports` 字段**，所以可以解析
 * `react-native-web/package.json` 来定位包根。哪天它加了 `exports` 而没放行
 * `./package.json`，这里要换成解析入口再取 dirname。
 *
 * 🔴 `react-native-svg` 也要指向它的 **web 实现**（M1 徽章）。
 *
 * 共享组件 `@heyta/ui` 用 `react-native-svg` 画图标（图标数据来自框架无关的
 * `lucide` 包，见 `packages/ui/src/icon/Icon.tsx`）。`react-native-svg` 的
 * `main` 是**原生**实现，web 端必须走它自带的 `ReactNativeSVG.web.js`，
 * 否则会在 import 阶段就崩在原生桥接上。
 *
 * @param {string} callerUrl 调用方 vite.config 的 `import.meta.url`
 */
export function rnwResolve(callerUrl) {
  const { webDir, svgWeb } = resolveFrom(callerUrl);
  return {
    /**
     * 🔴 `.web.*` 必须排在普通后缀**前面** —— 这是 `react-native-svg` 能跑起来的必要条件。
     *
     * 只把裸包名 `react-native-svg` 指到 `ReactNativeSVG.web.js` **不够**：
     * 那个文件内部写的是 `export * from './elements'`，而 Vite 默认的
     * `resolve.extensions` 里没有 `.web.js`，于是 `./elements` 解析到了
     * **原生**的 `elements.js`，一路拖进 `react-native/Libraries/...` 的
     * Flow 源码，最终报成一句和根因毫无关系的语法错误：
     *
     *     Expected ',', got '{' in react-native/Libraries/Utilities/codegenNativeComponent.js
     *
     * 那句报错会让人以为是 RN 版本或 babel 配置的问题，而真正的原因只是
     * "后缀没配对"。
     */
    extensions: [
      '.web.mjs',
      '.web.js',
      '.web.mts',
      '.web.ts',
      '.web.jsx',
      '.web.tsx',
      '.mjs',
      '.js',
      '.mts',
      '.ts',
      '.jsx',
      '.tsx',
      '.json',
    ],
    alias: [
      /**
       * 🔴 把 `react-native` 指向 `react-native-web`。
       *
       * 共享包的源码写的是 `import { View } from 'react-native'` ——
       * 那是**正确的写法**（在 iOS/Android/鸿蒙上它就该解析到 RN 本体）。
       * Web 端没有 RN 运行时，所以在这里做一次映射，而不是让共享组件
       * 反过来去判断"我在哪个端" —— 那种分支一旦开了头，
       * 每个组件都会长出一个平台判断，代码就不再是同一份了。
       *
       * ⚠️ 用**正则精确匹配**，不用字符串 key：`@rollup/plugin-alias` 的
       * 字符串 key 是**前缀**匹配，写成 `'react-native/'` 会把所有
       * `react-native-` 开头的包一起改写。
       */
      { find: /^react-native$/, replacement: webDir },
      { find: /^react-native-svg$/, replacement: svgWeb },
    ],
    /**
     * 🔴 `dedupe` 是**防第二份 React 的那道闸**（M1 判据第 3 条）。
     *
     * 仓库已经因为第二份 React 崩过一次 —— `@heyta/i18n` 自带了一份，
     * APK 启动即崩。Web/桌面端同样会中招，只是症状不同：hooks 报
     * Invalid hook call、或 context 读不到。
     *
     * ⚠️ 这与判据第 3 条是**两个方向**：那条管 Metro（iOS/Android/鸿蒙），
     * 由 `check:mobile-bundle` 盯着；这条管 Vite。两边都要防。
     */
    dedupe: ['react', 'react-dom'],
  };
}

/**
 * 两个 Vite 应用共用的 `optimizeDeps` 配置。
 *
 * 🔴 `react-native-svg` **必须排除预打包**，否则只有 `vite dev` 会炸。
 *
 * 生产构建（走 Rollup + 上面那套别名/后缀）完全正常，但 dev 模式先用
 * **esbuild 做依赖预打包**，而它解析不了 `react-native-svg` 内部的
 * `./elements` —— 于是抓到原生实现，一路拖进 RN 的 Flow 源码：
 *
 *     ✘ [ERROR] Expected "from" but found "{"
 *       react-native/Libraries/Utilities/codegenNativeComponent.js:13:12
 *
 * 这个坑最难受的地方是**两边不一致**：`vite build` 绿、e2e（起的是
 * dev server）红，而报错指向 React Native，完全看不出根因是我们自己的配置。
 *
 * @returns {import('vite').UserConfig['optimizeDeps']}
 */
export function rnwOptimizeDeps() {
  return { exclude: ['react-native-svg'] };
}
