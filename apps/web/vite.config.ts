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

export default defineConfig({
  plugins: [react()],
  resolve: {
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
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.spec.{ts,tsx}'],
    /**
     * jsdom 没有 CSSOM 的 `CSS.supports`，而热力图与成长页用的
     * `react-activity-calendar` 在渲染前会用它校验主题色 —— 不补就会崩在库里，
     * 报错完全指不到我们自己的代码。详见 `tests/setup.ts`。
     */
    setupFiles: ['./tests/setup.ts'],
  },
});
