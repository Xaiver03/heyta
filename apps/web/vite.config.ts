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

/**
 * 🔴 **把 `react-native-svg` 里那一个 CJS 文件补上 ESM 具名导出**
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么必须有这个插件（这是一个**只有 dev 会炸**的真 P0）
 * ─────────────────────────────────────────────────────────────
 *
 * 上游 `react-native-svg@15.15.5` 的 `lib/module`（ESM 构建）里**混了一个 CJS 文件**：
 *
 *   · `lib/extract/extractTransform.js:2` → `import { parse } from './transform';`（ESM 具名导入）
 *   · `lib/extract/transform.js`          → `module.exports = { SyntaxError, parse }`（CJS）
 *
 * 它**没有** `.web.js` 兄弟文件，所以上面那套后缀偏好救不了它。
 * 生产构建有 Rollup 的 commonjs 插件做 interop，dev **没有** ——
 * 而它又被 `optimizeDeps.exclude` 排除在预打包之外（那是为了躲开
 * `./elements` 被解析成原生实现那个坑，见下面的注释），于是浏览器拿到的是
 * 一个**原样的 CJS 文件**，具名导入直接失败：
 *
 *     The requested module '…/lib/extract/transform.js' does not provide an export named 'parse'
 *
 * ⇒ 表现是**整个 web 应用白屏**，而 `pnpm --filter @heyta/web test`（jsdom）、
 *   `pnpm -r typecheck`、以及全部静态门禁**都发现不了** ——
 *   只有真起 dev server 的验收脚本（`check:web-storage` / `check:web-migration`）会红。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么不是别的三种修法（三种都**实测试过**）
 * ─────────────────────────────────────────────────────────────
 *   · **整包改成预打包** → esbuild 解析 `./elements` 时抓到**原生**实现，
 *     一路拖进 `react-native/Libraries/...` 的 Flow 源码（`vite dev` 直接起不来）。
 *   · **`optimizeDeps.include` 指这个深路径** → 无效：那条 import 是**相对**的，
 *     优化器不接管它，文件仍然从 `@fs/` 原样提供（报错一字不变）。
 *   · **`optimizeDeps.needsInterop`** → 只对**被预打包**的依赖生效，而这个是排除项。
 *
 * ⇒ 只剩"在 Vite 的 transform 阶段把这一个文件翻成 ESM"这一条路。
 *   范围**只有一个文件**，不动别名、不动后缀偏好、不动 wasm 的排除。
 *
 * ⚠️ **形状变了就抛错，不许静默退回。** 上游改这个文件时（换 PEG 版本、
 *    改成真 ESM……），下面的 `indexOf` 会落空 —— 那时**必须红**，
 *    因为"静默无效"的代价是整个 web 应用白屏，而且只在真浏览器里看得见。
 */
const reactNativeSvgCjsInterop = {
  name: 'heyta:rns-svg-cjs-interop',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    /**
     * ⚠️ 正则**不能**用 `$` 锚定：带 `?v=` 的文件（被缓存失效重写的那些）
     * 会把查询串带进 id，`$` 就匹配不上了 —— 而失败方式是**插件静默不生效**，
     * 症状与"插件没写"完全一样。这是实测踩出来的（第一版就是 `$` 锚定，
     * 结果报错一字不变，看起来像"插件根本没用"）。
     *
     * ─────────────────────────────────────────────────────────────
     * 🔴 **包白名单**（而不是"任意 CJS 文件"）
     * ─────────────────────────────────────────────────────────────
     * 这个插件本质是在 dev 阶段补 Rollup commonjs 插件缺的那一步。对**任何** CJS
     * 都生效会改变第三方包的加载语义（有的包依赖 CJS 的循环引用/延迟求值），
     * 而收益只在 RNW 这一族上。
     *
     * ⚠️ **这份名单会随着主包的 import 图增长而变长。** 每多一个 RNW 生态的共享
     * 组件被接进 web 主包，就可能多一个这样的包。判断依据很机械：
     * `pnpm check:web-storage` 报 `does not provide an export named …`，
     * **报错 URL 里的包名就是该加进来的下一个**（实测就是这么走过来的：
     * `react-native-svg` → `@react-native/assets-registry`）。
     */
    const CJS_INTEROP_PACKAGES = ['react-native-svg', '@react-native/assets-registry'];
    if (!CJS_INTEROP_PACKAGES.some((name) => id.includes(`/${name}/`))) return null;
    if (!/\.js(\?|$)/.test(id)) return null;

    /**
     * 🔴 **是"一族"文件，不是一个**（实测）。
     *
     * 只按第一个报错去修会连着踩三次：修好 `lib/extract/transform.js` 之后，
     * 浏览器立刻改报 `lib/extract/transformToRn.js`，再之后是
     * `filter-image/extract/extractFiltersString.js`。三个都是 PEG.js 生成的
     * 解析器，都是 `module.exports = { StartRules, SyntaxError, parse }`
     * —— **同一个上游打包缺陷的三个副本**。
     * ⇒ 所以这里按**目录**匹配，不按文件名；`module.exports = {` 找不到就返回
     * `null`（那才是"这个文件没问题"）。
     */
    const marker = 'module.exports = {';
    const at = code.indexOf(marker);
    if (at < 0) return null;

    /** 对象字面量的正文（到第一个 `};` 为止 —— 这三个文件都是这个形状）。 */
    const end = code.indexOf('};', at);
    if (end < 0) {
      throw new Error(
        `react-native-svg 的 ${id} 里 \`module.exports = {\` 没有对应的 \`};\` —— 形状变了。\n` +
          '见 apps/web/vite.config.ts 的 `heyta:rns-svg-cjs-interop`：请核对上游产物并同步注释。',
      );
    }
    const body = code.slice(at + marker.length, end);

    /**
     * 从对象字面量里取具名导出的**键**。
     *
     * 🔴 **不能只按"行首的 `名字:`"去匹配**（第一版就是那样）—— 实测漏掉了一整个形状：
     * `@react-native/assets-registry/registry.js` 写的是**单行简写**
     *   `module.exports = {registerAsset, getAssetByID};`
     * 键既不在行首、也没有冒号，于是 `keys` 为空 ⇒ 抛错 ⇒ **Vite 把它记进自己的日志、
     * 页面继续拿到原样的 CJS**，而浏览器报的还是那句 "does not provide an export named"。
     * （排查时教训：我用 `grep -v '[vite]'` 看探针输出，正好把 Vite 的那条错误滤掉了 ——
     *  **读 OUTPUT 不能只读过滤后的那一半**。）
     *
     * ⇒ 改成"按顶层逗号切分，取冒号左边（没有冒号就是简写）"，并先剥掉方括号里的内容
     *   （数组字面量里的逗号不是分隔符）。
     *
     * 🔴 取不到就必须抛错，**不许静默返回原文**。
     */
    const stripped = body.replace(/\[[^\]]*\]|\{[^}]*\}/g, '');
    const keys = stripped
      .split(',')
      .map((part) => {
        const name = (part.includes(':') ? part.slice(0, part.indexOf(':')) : part).trim();
        return name;
      })
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
    if (keys.length === 0) {
      throw new Error(
        `react-native-svg 的 ${id} 里解析不出任何导出键（形状变了）。\n` +
          '见 apps/web/vite.config.ts 的 `heyta:rns-svg-cjs-interop`。',
      );
    }

    /**
     * 🔴 **必须用"别名导出"，不能写 `export const parse = __rnsSvgExports.parse;`。**
     *
     * 后者会声明一个与文件里**已有绑定同名**的新绑定，于是：
     *   `SyntaxError: Identifier 'registerAsset' has already been declared`
     * （`@react-native/assets-registry/registry.js` 里就有 `function registerAsset`，
     * 而它同时又出现在 `module.exports` 的对象里 —— 实测撞到过。）
     * 换成 `const __rnsE0 = …; export { __rnsE0 as registerAsset }` 就没有新同名绑定。
     */
    const locals = keys.map((key, i) => `const __rnsE${String(i)} = __rnsSvgExports[${JSON.stringify(key)}];`);
    const exportClause = `export { ${keys
      .map((key, i) => `__rnsE${String(i)} as ${key}`)
      .join(', ')} };`;
    return {
      code:
        `${code.slice(0, at)}const __rnsSvgExports = {` +
        body +
        '};\n' +
        'export default __rnsSvgExports;\n' +
        `${locals.join('\n')}\n` +
        `${exportClause}\n` +
        code.slice(end + 2),
      map: null,
    };
  },
};

export default defineConfig({
  /**
   * 🔴 `global` 必须存在 —— 否则**成长页整棵 React 树会卸载成白屏**。
   *
   * 症状与根因（2026-10-05，由一位 agent 用真 Chromium 探针锁定并验证了修法）：
   * M3 motivation 那一刀把**全仓唯一一处 `react-native` 的 `Animated`** 引入了 web
   * （`packages/ui/src/motivation/ProgressBar.tsx`）。RNW 的动画实现在
   * `react-native-web/dist/vendor/react-native/Animated/animations/TimingAnimation.js` 里写的是
   *
   *     global.cancelAnimationFrame(this._animationFrame);
   *
   * （`SpringAnimation.js` / `DecayAnimation.js` 同形）。**浏览器只有 `window` / `globalThis`，
   * 没有 `global`** ⇒ 抛 `ReferenceError: global is not defined` ⇒ 组件抛错 ⇒ 整棵树卸载。
   *
   * 实测（workspace dev server + 真 Chromium）：
   * ```
   * 不加垫片：click 成长 → board=0  cells=0  bodyLen=0   errors=["ReferenceError: global is not defined" ×3]
   * 加  垫片：click 成长 → board=1  cells=365 bodyLen=597 errors=[]
   * ```
   *
   * ⚠️ **为什么这一处特别危险**：`pnpm --filter @heyta/web test`（jsdom）全绿、
   * `pnpm -r typecheck` 全绿、全部静态门禁全绿 —— 只有**真浏览器**会红。
   * 而 `check:web-storage` / `check:web-migration` **也发现不了**（它们不切到成长页）。
   * 唯一能抓到它的是 e2e（`pnpm --dir e2e run test`）。
   *
   * ⚠️ **`define` 两处都要给**：源码里的引用会被 Vite 的 `define` 替换，
   * 但 `react-native` 是**预打包**的（`node_modules/.vite/deps/react-native.js`），
   * 那份产物由 esbuild 生成 ⇒ 必须同时给 `optimizeDeps.esbuildOptions.define`，
   * 否则 dev 下预打包产物里仍然留着裸 `global`。
   */
  define: { global: 'globalThis' },
  plugins: [react(), reactNativeSvgCjsInterop],
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
     * 别名 + `.web.*` 后缀解析。
     *
     * ─────────────────────────────────────────────────────────────
     * 🔴 **更正：上面那句"与生产构建走同一条路"是错的**（2026-10-05 实测）
     * ─────────────────────────────────────────────────────────────
     * 生产构建除了别名与后缀解析，**还有 Rollup 的 commonjs 插件**做
     * CJS→ESM interop；而 dev 对被 `exclude` 的文件**没有**这一步。
     * 于是只要有 `.web.*` 路径走到一个**用 `module.exports` 写的文件**，
     * dev 就会在浏览器里抛：
     *
     *     The requested module '…/lib/extract/transform.js' does not
     *     provide an export named 'parse'
     *
     * 根因是上游 `react-native-svg@15.15.5` 的 `lib/module`（ESM 构建）里
     * **混了一个 CJS 文件**：
     *   · `lib/extract/extractTransform.js:2` → `import { parse } from './transform';`（ESM 具名导入）
     *   · `lib/extract/transform.js`          → `module.exports = { …, parse }`（CJS）
     * 它没有 `.web.js` 兄弟文件，所以后缀解析救不了它。
     *
     * ⇒ 修法是**让这一个文件单独走预打包**（`include`），由 esbuild 做 interop；
     * 包本身仍然 `exclude`，`.web.*` 后缀偏好不受影响。
     * 这条 `include` 是**必需的**，不是优化 —— 去掉它，
     * 只要主包里出现任何一个用 `HeytaIcon` 的共享组件就会白屏。
     * （本轮就是这么撞上的：便签板与提醒列表把 `HeytaIcon` 带进了 App 主包，
     * 在那之前只有 dev 切片用得到 `TaskBadges`。）
     */
    /**
     * 🔴 `@sqlite.org/sqlite-wasm` 同样必须排除 —— **同一类坑，第三次踩**
     *
     * 上面那条注释说"两边不一致"，而 wasm 这个更狠：它在**生产构建里也会炸**，
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
    // 🔴 见文件头 `define` 那段：预打包产物里也要把 `global` 换掉。
    esbuildOptions: { define: { global: 'globalThis' } },
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
