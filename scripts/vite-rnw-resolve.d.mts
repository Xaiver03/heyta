/**
 * `scripts/vite-rnw-resolve.mjs` 的类型声明。
 *
 * 🔴 为什么需要它：两个 Vite 配置（`apps/web`、`apps/desktop`）都是 **TypeScript**，
 * 而那个共享模块是 **`.mjs`** —— 没有声明文件时 `tsc` 会报
 *
 *     TS7016: Could not find a declaration file for module
 *     '../../scripts/vite-rnw-resolve.mjs'. ... implicitly has an 'any' type.
 *
 * 用 `@ts-ignore` 或把它改成 `.ts` 都不合适：前者会连**真实参数错误**一起吞掉，
 * 后者要求整个根 `scripts/` 目录进入某个 tsconfig 的 include ——
 * 而它是构建脚本，不该被应用的类型检查范围牵进来。
 * 单独一份 `.d.mts` 是代价最小的做法。
 */

import type { UserConfig } from 'vite';

/**
 * 两个 Vite 应用共用的解析配置。
 *
 * ⚠️ 返回类型**用 Vite 自己的** `UserConfig['resolve']`，不自己写一个结构等价的
 * 接口。第一版就是自己写的（`{extensions, alias, dedupe}`），结果
 * `defineConfig({ resolve: rnwResolve() })` 报 TS2769 ——
 * 手写的类型总会在某个字段上比真的更窄/更宽（比如 `alias` 的 `find`
 * 其实是 `string | RegExp`，而 readonly 数组也不等于可变数组）。
 * 引用真类型就不会有这种"看起来一样、其实不兼容"的偏差。
 *
 * ⚠️ `callerUrl` 是**调用方自己**的 `import.meta.url`：解析从它所在的位置开始走，
 * 而 `react-native-web` / `react-native-svg` 必须是那个 app 的直接依赖。
 * 传本 helper 自己的 URL 会解析失败 —— `scripts/` 下没有任何 node_modules 通道
 * （这正是把桌面端构建造成"配置都加载不完"的原因，见 `.mjs` 里那段）。
 */
export function rnwResolve(callerUrl: string): UserConfig['resolve'];

/**
 * 两个 Vite 应用共用的 `optimizeDeps`。
 *
 * 🔴 里面 `exclude: ['react-native-svg']` 是**必需**的 ——
 * dev 模式的 esbuild 预打包不认 `.web.*` 后缀，会把原生实现拖进来。
 */
export function rnwOptimizeDeps(): UserConfig['optimizeDeps'];

