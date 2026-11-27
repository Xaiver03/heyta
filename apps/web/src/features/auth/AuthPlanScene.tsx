/**
 * 登录对话框左侧的插画栏（电脑端）。
 *
 * 2026-11-27：从"抽象计划示意 + 一段文案"换成**桌面端专用的一张横向纸感插画**。
 * 这张图是用本地 MOSS 文生图（ComfyUI）现画的，横版构图（1280×960），
 * 与首启页漫画同一套纸感/靛蓝/暖橙调性，但**不是**把 9:16 竖版漫画硬塞进横栏
 * （那样必然裁掉下半截 —— 就是"画显示不完整"的根因）。
 *
 * - 只做氛围，`aria-hidden`；不承载信息，也不放说明文字（界面只用排版/画面表达）。
 * - 手机/窄屏由 CSS `@media` 整块隐藏（`.ht-sheet__auth-plan { display:none }`），只影响电脑端。
 * - 素材用 `new URL(..., import.meta.url)` 让 Vite 打包，不在 public 里另存一份。
 * - 出处/提示词见同目录 `assets/illustrations/auth/provenance.json`。
 */
export function AuthPlanScene(): React.JSX.Element {
  const art = new URL('../../../../../assets/illustrations/auth/desktop-login.jpg', import.meta.url).href;
  return (
    <aside className="ht-sheet__auth-plan" aria-hidden="true" data-testid="auth-plan-scene">
      <img className="ht-auth-plan-illustration" src={art} alt="" aria-hidden="true" draggable={false} />
    </aside>
  );
}
