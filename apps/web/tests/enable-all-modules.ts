/**
 * 把一个测试里需要的**功能模块**打开
 * ======================================
 *
 * 🔴 为什么测试需要它：2026-09-29 加了「功能模块」开关（`features/shell/modules.ts`），
 * **关掉的模块根本不进 DOM**。于是任何"点开成长视图看它画得对不对"的测试，
 * 在默认配置下会**找不到那个 tab** —— 而报错是 `expect(undefined).toBeDefined()`，
 * 看起来像"tab 被删了"，不像"模块没开"。
 *
 * ⚠️ **不要**在这里一律"全开"了事：那会让"默认关掉的那几个"在整套 web 测试里
 * **永远测不到默认状态**。所以它是个显式动作 —— 用例自己声明它需要什么
 *（`test:tests/app-mount.spec.tsx` 那组 IA 断言就刻意**不调**它）。
 */
export function enableModules(keys: readonly string[]): void {
  const overrides: Record<string, boolean> = {};
  for (const key of keys) overrides[key] = true;
  localStorage.setItem('heyta.shell.modules', JSON.stringify(overrides));
}
