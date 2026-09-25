import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 宿主无关：**不用 jsdom**。如果哪天这里需要 jsdom，
  // 就说明有浏览器依赖混进来了，而那正是这个包不该有的东西。
  test: { globals: true, environment: 'node', include: ['tests/**/*.spec.ts'] },
});
