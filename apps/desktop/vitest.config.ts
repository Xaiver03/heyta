import { defineConfig } from 'vitest/config';

export default defineConfig({
  /**
   * 桌面宿主：**不用 jsdom**。
   *
   * 这里测的是 IPC 契约与真实 SQLite 往返，全都发生在主进程侧 ——
   * 需要 jsdom 才能测的东西属于渲染进程，而渲染进程在 M1（共享 UI 切片）之后才有。
   * 若哪天这里必须加 jsdom，先问一句：那是不是说明**业务逻辑漏进渲染进程了**？
   */
  test: { globals: true, environment: 'node', include: ['tests/**/*.spec.ts'] },
});
