import { defineConfig } from 'vitest/config';

export default defineConfig({
  /**
   * 🔴 这里**不用 jsdom，也不 render 组件** —— 这是刻意的，不是没做。
   *
   * 本仓库没有引入 `@testing-library/*`（`apps/web` 与 `apps/mobile` 都是
   * 只测纯函数）。为了测一个组件而引入整套 DOM 测试栈，代价是长期的
   * 维护面和许可证登记，收益却可疑 —— 组件树渲染得对不对，
   * 真正的判据是**三个平台上的实际渲染**，那由 M1-5 的
   * `scripts/verify-universal-slice.sh` 负责。
   *
   * 所以这里的边界是：**把有判断的逻辑放进 model.ts，用 node 环境测穿它**；
   * TaskList.tsx 只留"把 model 的输出摆到 RN 原语上"这一层。
   * 这样组件里剩下的代码是**没有分支的**，不需要靠快照测试来兜。
   *
   * ⚠️ 顺带一个硬约束：node 环境**解析不了 `react-native`**（它是 Flow 源码）。
   * 一旦有人在 `src/task-list/model.ts` 里 import 了 RN，
   * 这个测试会立刻失败 —— 等于免费钉住了"model 必须保持宿主无关"。
   */
  test: { globals: true, environment: 'node', include: ['tests/**/*.spec.ts'] },
});
