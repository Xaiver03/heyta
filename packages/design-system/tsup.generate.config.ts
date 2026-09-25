import { defineConfig } from 'tsup';

/**
 * 生成器专用的 tsup 配置
 * ======================
 *
 * 为什么不能复用主 `tsup.config.ts`：
 *
 * 🔴 主配置是 `clean: true` + 多入口。用它来跑生成器，一次
 * `pnpm generate` 就会把 `dist/` 清空、只留下 `generate-cli.js` ——
 * 于是 `@heyta/design-system` 的 `"."` 入口（`dist/index.js`）消失，
 * 所有 `import { cssVar } from '@heyta/design-system'` 全部解析失败。
 * 而生成器**看起来是成功的**（它确实写出了产物），错误直到别处构建才炸。
 *
 * 所以这里：
 *   - `clean: false` —— 生成器只允许**新增**文件，绝不删别人的。
 *   - 只构建生成器自身，因此它不 import `src/native.ts`，
 *     也就不会与"它自己要产出的 `src/generated/tokens.native.ts`"形成循环依赖。
 */
export default defineConfig({
  entry: ['src/generate-cli.ts'],
  format: ['esm'],
  clean: false,
  tsconfig: 'tsconfig.build.json',
  sourcemap: false,
});
