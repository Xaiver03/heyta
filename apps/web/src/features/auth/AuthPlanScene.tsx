/**
 * 登录对话框左侧的插画栏（电脑端）。
 *
 * 2026-11-27：从"抽象计划示意 + 一段文案"换成**整块插画**，与移动端首启页同一套
 * 纸感漫画（`assets/illustrations/onboarding/bg-*.jpg`，同一份素材，不复制）。
 *
 * - 只做氛围，`aria-hidden`；不承载信息，也不放说明文字（界面只用排版/画面表达）。
 * - 手机/窄屏由 CSS `@media` 整块隐藏（`.ht-sheet__auth-plan { display:none }`），
 *   所以这次只影响电脑端。
 * - 素材用 `new URL(..., import.meta.url)` 让 Vite 打包，不在 public 里另存一份。
 */
export function AuthPlanScene(): React.JSX.Element {
  const art = new URL('../../../../../assets/illustrations/onboarding/bg-tasks.jpg', import.meta.url).href;
  return (
    <aside className="ht-sheet__auth-plan" aria-hidden="true" data-testid="auth-plan-scene">
      <img className="ht-auth-plan-illustration" src={art} alt="" aria-hidden="true" draggable={false} />
    </aside>
  );
}
