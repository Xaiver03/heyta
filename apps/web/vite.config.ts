import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
