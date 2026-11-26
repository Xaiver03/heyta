/**
 * 「这台设备是否已经看过首启导览」的唯一实现（Web 首启，#69）
 * ==========================================================
 *
 * 补的是首启格 #69：移动端有 `WelcomeScreen`，Web 此前**没有**任何首启导览
 * （冷启动直接进主界面）。这里只回答一个问题 —— **这台设备看过没有** ——
 * 不负责界面（界面在 `WelcomeTour.tsx`）。
 *
 * ## 判据是"这台设备看过"，不是"今天第一次打开"
 *
 * 看过一次就不再打扰。它是**设备属性**（[ADR-0085](../../../../docs/adr/0085-appearance-is-device-local-and-never-an-op.md) 的同类）：
 * 写本机、**零 op** —— "这台机器要不要再放一遍导览"不是数据变更。
 *
 * ⚠️ 与 `theme.ts` / `font-scale.ts` 同一条契约：隐私模式下 `localStorage`
 * 读写都可能抛错 —— 读失败当"没看过"（宁可多放一次，也不白屏），写失败静默。
 */

/** 存储键。🔴 只导出给判据用；产品代码走下面两个函数。 */
export const WELCOME_SEEN_STORAGE_KEY = 'heyta.onboarded';

/** 是否已经看过导览。读不到（隐私模式 / 脏值）一律当"没看过"。 */
export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** 记下"看过了"。写不上不致命（隐私模式）。 */
export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(WELCOME_SEEN_STORAGE_KEY, '1');
  } catch {
    // 写不上 → 下次可能再放一遍，不影响本次。
  }
}
