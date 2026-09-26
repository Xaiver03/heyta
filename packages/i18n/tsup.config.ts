import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  /** `react` 是 peerDependency：三个外壳各自带自己的一份 React，
   *  绝不能把它打进产物，否则会出现两份 React 实例、
   *  context 跨不过去（`useI18n()` 拿到默认 locale 而不是 Provider 的）。 */
  external: ['react', 'react/jsx-runtime'],
  tsconfig: 'tsconfig.build.json',
  dts: { tsconfig: 'tsconfig.build.json' },
  sourcemap: true,
  clean: true,
});
