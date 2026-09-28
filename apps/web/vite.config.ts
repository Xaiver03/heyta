import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);

/**
 * 🔴 为什么别名要指向**绝对路径**，而不是直接写 `'react-native-web'`
 *
 * 第一版写的就是 `replacement: 'react-native-web'`，构建直接失败：
 *
 *     Could not load react-native-web (imported by ../../packages/ui/dist/index.js):
 *     ENOENT: no such file or directory, open 'react-native-web'
 *
 * 根因是 pnpm 的隔离布局 + 解析**从导入方所在位置开始**：
 * `@heyta/ui` 是 workspace 包，Vite 解析到它的真实路径 `packages/ui/dist/`，
 * 于是从 `packages/ui/` 往上找 `react-native-web` —— 而它只装在
 * `apps/web/node_modules/` 下（它是 web 端的依赖），根 `node_modules` 里没有。
 *
 * 换成绝对路径就绕开了"从谁的位置找"这个变量：无论谁 import `react-native`，
 * 都落到同一个真实目录。
 *
 * ⚠️ `react-native-web` **没有 `exports` 字段**，所以可以解析
 * `react-native-web/package.json` 来定位包根。哪天它加了 `exports` 而没放行
 * `./package.json`，这里会抛 `ERR_PACKAGE_PATH_NOT_EXPORTED` ——
 * 报错会直接指向这一行，不会伪装成别的故障。
 */
const reactNativeWebDir = dirname(require.resolve('react-native-web/package.json'));

/**
 * 🔴 `react-native-svg` 也要指向它的 **web 实现**（M1 徽章）
 *
 * 共享组件 `@heyta/ui` 现在会用 `react-native-svg` 画图标（图标数据来自
 * 框架无关的 `lucide` 包，见 `packages/ui/src/icon/Icon.tsx`）。
 * `react-native-svg` 的 `main` 是**原生**实现，web 端必须走它自带的
 * `ReactNativeSVG.web.js`，否则会在 import 阶段就崩在原生桥接上。
 *
 * ⚠️ Vite 的默认 `resolve.extensions` 里**没有** `.web.js`，所以
 * "让打包器自己按平台挑后缀"这条不成立 —— 必须显式指到文件。
 * 这也是这里直接要求 `.js` 全路径、而不是解析 `package.json` 的原因。
 */
const reactNativeSvgWeb = require.resolve(
  'react-native-svg/lib/module/ReactNativeSVG.web.js',
);

export default defineConfig({
  plugins: [react()],
  resolve: {
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
     * "后缀没配对"。把 `.web.*` 放前面，`react-native-svg`（以及将来任何
     * 采用同一约定的 RNW 生态包）内部的相对 import 才会自动走 web 实现。
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
       * 🔴 把 `react-native` 指向 `react-native-web`（M1-3）。
       *
       * 共享包 `@heyta/ui` 的源码写的是 `import { View } from 'react-native'` ——
       * 那是**正确的写法**（在 iOS/Android/鸿蒙上它就该解析到 RN 本体）。
       * Web 端没有 RN 运行时，所以在这里做一次映射，而不是让共享组件
       * 反过来去判断"我在哪个端" —— 那种分支一旦开了头，
       * 每个组件都会长出一个平台判断，代码就不再是同一份了。
       *
       * ⚠️ 用**正则精确匹配**，不用字符串 key。
       * `@rollup/plugin-alias` 的字符串 key 是**前缀**匹配：
       * 写成 `'react-native'` 时 `react-native-web` 侥幸不受影响（下一个字符是
       * `-` 不是 `/`），但写成 `'react-native/'` 就会把所有 `react-native-`
       * 开头的包一起改写。正则 `/^react-native$/` 只命中裸包名，没有这种歧义。
       */
      { find: /^react-native$/, replacement: reactNativeWebDir },
      /**
       * ⚠️ 顺序无关（两条正则互不重叠）：`/^react-native$/` 只命中裸包名，
       * `/^react-native-svg$/` 只命中这一个包，不会互相吃掉。
       */
      { find: /^react-native-svg$/, replacement: reactNativeSvgWeb },
    ],
    /**
     * 🔴 `dedupe` 是**防第二份 React 的那道闸**（M1 判据第 3 条）。
     *
     * 仓库已经因为第二份 React 崩过一次 —— `@heyta/i18n` 自带了一份，
     * APK 启动即崩（`phase-2-multi-platform.md` §2.23）。Web 端同样会中招，
     * 只是症状不同：hooks 报 Invalid hook call、或 context 读不到。
     *
     * `react-native-web` 声明的是 `react` / `react-dom` 的 **peer** 而不是
     * dependency，所以正常情况下不会自带；但 pnpm 的 workspace 链接加上
     * 嵌套的 node_modules 完全可能解析出第二个副本。`dedupe` 强制它们
     * 都走根上那一份。
     *
     * ⚠️ 这与判据第 3 条是**两个方向**：那条管 Metro（iOS/Android/鸿蒙），
     * 由 `check:mobile-bundle` 盯着；这条管 Vite。两边都要防。
     */
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 5173 },
  optimizeDeps: {
    /**
     * 🔴 `react-native-svg` **必须排除预打包**，否则只有 `vite dev` 会炸。
     *
     * 生产构建（`vite build`，走 Rollup + 上面那套别名/后缀）完全正常，
     * 但 dev 模式先用 **esbuild 做依赖预打包**，而它解析不了
     * `react-native-svg` 内部的 `./elements` —— 于是抓到**原生**实现，
     * 一路拖进 `react-native/Libraries/...` 的 Flow 源码：
     *
     *     ✘ [ERROR] Expected "from" but found "{"
     *       react-native/Libraries/Utilities/codegenNativeComponent.js:13:12
     *
     * 这个坑最难受的地方是**两边不一致**：`vite build` 绿、
     * `pnpm check` 的 e2e（起的是 dev server）红，而报错指向 React Native
     * 的 Flow 文件，完全看不出根因是我们自己的别名配置。
     *
     * 排除之后 `react-native-svg` 不再进预打包，交给上面那套
     * 别名 + `.web.*` 后缀解析 —— 与生产构建走同一条路。
     *
     * ─────────────────────────────────────────────────────────────
     * 🔴 `@sqlite.org/sqlite-wasm` 同样必须排除 —— **同一类坑，第三次踩**
     * ─────────────────────────────────────────────────────────────
     * 上面这条注释说"两边不一致"，而 wasm 这个更狠：它在**生产构建里也会炸**，
     * 只是炸得更晚 —— 直到用户第一次真的用存储。
     *
     * 症状（探针里已完整记录过一次，见 `packages/storage/probe/vite.config.mjs`）：
     *
     *     CompileError: WebAssembly.instantiate(): expected magic word 00 61 73 6d,
     *     found 3c 21 64 6f @+0
     *
     * `3c 21 64 6f` 是 `<!do` —— wasm 的 URL 拿回来的是 **HTML**。
     * 原因是 esbuild 预打包把这个包复制进 `node_modules/.vite/deps/`，
     * 而它**内部按相对路径找 `sqlite3.wasm`**，路径不会跟着搬。
     *
     * ⚠️ 真正的教训（已经写进 ADR-0027 §6.1 的代价清单）：
     * **任何"运行时按相对路径加载自身资源"的依赖，都要先怀疑预打包。**
     * `react-native-svg`（内部相对路径 import）与 `@sqlite.org/sqlite-wasm`
     * （内部相对路径找 .wasm）是同一个根因的两次发作。
     */
    exclude: ['react-native-svg', '@sqlite.org/sqlite-wasm'],
  },
  /**
   * 🔴 **`worker.format` 必须是 `'es'`。**
   *
   * 默认值是 `'iife'`，而存储 Worker **会代码分割**
   * （它动态 import `@sqlite.org/sqlite-wasm`），于是生产构建直接失败：
   *
   *     [vite:worker-import-meta-url] Invalid value "iife" for option
   *     "worker.format" - UMD and IIFE output formats are not supported
   *     for code-splitting builds.
   *
   * ⚠️ **dev 完全正常，只有 `vite build` 会炸** —— 因为 dev 把 worker 当 ESM 直接提供，
   * 从不走这条路。这与 `react-native-svg` 那次**方向相反、性质相同**：
   * 都是"两条构建路径不一致"，而且报错都停在离根因很远的地方。
   *
   * `'es'` 能成立的前提是调用侧的 `{ type: 'module' }`
   * （见 `src/lib/oplog.ts` 里 new Worker 的那一行）—— 两处必须同时改。
   */
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    globals: true,
    /**
     * 🔴 **必须把存储后端切到 `indexeddb`。**
     *
     * `oplog.ts` 的默认后端是 SQLite，而它由**一个 Worker** 承载 ——
     * jsdom 没有 `Worker`，于是 45 个测试文件里有 12 个死在
     * `ReferenceError: Worker is not defined`，报错停在离根因很远的地方。
     *
     * 这里用真实存在的**另一条**路径（`IndexedDbAdapter`，由 `tests/setup.ts`
     * 的 `fake-indexeddb/auto` 提供实现）跑测试。
     * ⚠️ **不是**给 jsdom 塞一个假 Worker —— 那会让"任务真的写进了 op-log"
     * 这类断言变成**测一个假实现**。
     */
    env: { VITE_HEYTA_STORAGE: 'indexeddb' },
    include: ['tests/**/*.spec.{ts,tsx}'],
    /**
     * jsdom 没有 CSSOM 的 `CSS.supports`，而热力图与成长页用的
     * `react-activity-calendar` 在渲染前会用它校验主题色 —— 不补就会崩在库里，
     * 报错完全指不到我们自己的代码。详见 `tests/setup.ts`。
     */
    setupFiles: ['./tests/setup.ts'],
  },
});
