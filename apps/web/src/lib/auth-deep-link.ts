/**
 * 「带参数进来就直接打开认证面板」这条深链的**唯一事实源**。
 * ============================================================================
 *
 * ## 为什么要有这条参数
 *
 * 落地页导航上的「登录」是一个**意图**（"我已经有账号了，我要进去"），
 * 它过去落在 `/signin/` 那张页面上，而那张页面第一屏是三段解释
 * （为什么认证在应用里、两种方式、找回通行密钥）。访客点"登录"却先读到一篇说明 ——
 * 2026-10-03 产品负责人实测后否掉了这个形状。
 *
 * 认证 UI 仍然**只在应用里**（这条没变，理由见 `apps/landing/src/pages/SigninPage.tsx`
 * 与 `docs/plans` 里"面板开在同步设置内部"那条：地址与令牌必须同源，否则会出现
 * "对着 A 登录、令牌存到 B"）。变的是**入口**：点「登录」= 进应用并把面板打开。
 *
 * ## 为什么消化点在壳的挂载处，不在 `AuthPanel` 里
 *
 * `AuthPanel` 也读一个参数（`?invite=`），但那是**表单字段的初值** —— 面板已经开着才有意义。
 * 而"面板该不该开"这件事的状态住在 store（`signInOpen`）：
 * 让一个"开了之后才存在"的组件去决定它自己该不该存在，读到的永远是上一帧。
 *
 * ⚠️ 落地页那边是**另一个包里抄的一份字面量**（`apps/landing/src/lib/app-url.ts`）。
 * 两处必须逐字相同 —— 钉这条的判据在 `apps/landing/tests/render.spec.tsx`
 * （它读回这个文件比对，所以漂移会在 CI 里红，而不是在用户的点击里红）。
 */
export const SIGNIN_QUERY_PARAM = 'signin';

/** 地址里有没有"直接打开认证面板"这个意图。SSR / 测试环境里没有 window 时为 false。 */
export function wantsSignInOnLoad(search: string | undefined = globalThis.window?.location.search): boolean {
  if (search === undefined) return false;
  return new URLSearchParams(search).has(SIGNIN_QUERY_PARAM);
}
