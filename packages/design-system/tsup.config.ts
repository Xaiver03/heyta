import { defineConfig } from 'tsup';

export default defineConfig({
  // generate-cli 是 token 生成器入口：`pnpm generate` 先 build 再执行它。
  // 不在 package exports 里暴露 —— 它只写 generated/，不是运行时 API。
  entry: ['src/index.ts', 'src/generate-cli.ts'],
  format: ['esm', 'cjs'],
  tsconfig: 'tsconfig.build.json',
  dts: { tsconfig: 'tsconfig.build.json' },
  sourcemap: true,
  clean: true,
});
