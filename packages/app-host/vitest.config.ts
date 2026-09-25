import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 宿主无关层：**不用 jsdom**。这里需要 jsdom 就说明有浏览器依赖混进来了。
  test: { globals: true, environment: 'node', include: ['tests/**/*.spec.ts'] },
});
