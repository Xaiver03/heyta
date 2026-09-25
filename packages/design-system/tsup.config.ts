import { defineConfig } from 'tsup';

export default defineConfig({
  // generate-cli 是 token 生成器入口：`pnpm generate` 先 build 再执行它。
  // 不在 package exports 里暴露 —— 它只写 generated/，不是运行时 API。
  // native.ts 单列一个入口：RN 通过子路径 `@heyta/design-system/native` 消费。
  // ⚠️ 它 import 生成产物，因此**不能**进 generate-cli 的构建图 —— 见 package.json 的 generate 脚本。
  entry: ['src/index.ts', 'src/generate-cli.ts', 'src/native.ts'],
  format: ['esm', 'cjs'],
  tsconfig: 'tsconfig.build.json',
  dts: { tsconfig: 'tsconfig.build.json' },
  sourcemap: true,
  clean: true,
});
