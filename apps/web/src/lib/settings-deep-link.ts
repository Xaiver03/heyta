/**
 * 「带参数进来就直接打开设置里的某一节」这条深链的**唯一事实源**。
 * ==========================================================================
 *
 * ## 为什么要这条参数（2026-10-24）
 *
 * 落地页的付费两档要变成**真能买**的入口。落地页是营销站，它**不**该自己拉一份收银台
 * （那是第二份实现，AGENTS §3.5）；它能做的最诚实的一件事是：把访客送进应用里
 * **已经存在**的那一节 —— 设置 → 订阅（`SubscriptionPanel` 里 `RenewPanel` 调
 * `@heyta/app-host` 的 `startCheckout`）。
 *
 * 没有这条参数时，"立即购买"只能把人送到应用首页，然后让他自己找「设置 → 订阅」。
 * 那不是购买按钮，是一个"去找找看"。
 *
 * ## 形状照抄 `auth-deep-link.ts`（同一个包里的先例）
 *
 * 那个文件消化 `?signin`，本文件消化 `?settings=<section-id>`。两条都是
 * 「URL 表达意图 → 壳在挂载处消化 → store 拿初值」，而不是让面板自己读参数
 * （理由同 `auth-deep-link.ts`：状态住 store，后开的组件读到的是上一帧）。
 *
 * ## 🔴 为什么值是 `SETTINGS_NAV_ITEMS` 里的 id 字面量，而不是另起一套短名
 *
 * 短名（`?settings=subscription`）看着好看，但它会**长出第二套命名**：
 * 设置壳里那张表叫 `settings-group-subscription`，落地页写 `subscription`
 * ⇒ 两边一旦漂移，症状是"点了没反应"（参数不认，退回默认节），而不是报错。
 * 所以这里只认**那张表里的 id**，把漂移面压到零。
 *
 * ⚠️ 落地页那边是**另一个包里抄的一份字面量**（`apps/landing/src/lib/app-url.ts`
 * 的 `SUBSCRIPTION_SETTINGS_SECTION`）。两处必须逐字相同 —— 钉这条的判据
 * 与 `?signin` 那条同族（`apps/landing/tests/render.spec.tsx` 读回本文件比对）。
 */

/** 参数名。落地页抄一份，两处必须逐字相同。 */
export const SETTINGS_QUERY_PARAM = 'settings';

/**
 * 「订阅」那一节的 id —— 与 `apps/web/src/App.tsx` 的 `SETTINGS_NAV_ITEMS` 里那一条相同。
 *
 * 🔴 这里再导出一次而不是让调用方自己写字面量：落地页那个"立即购买"的链接
 * 由 `apps/landing` 拼，它拼错时**没有任何类型会红**（跨包字面量）。
 * 把值放在一个具名常量上，至少让"要改就改这两处"变成一次 grep 能查完的事。
 */
export const SUBSCRIPTION_SETTINGS_SECTION = 'settings-group-subscription';

/**
 * 地址里要求的设置节；没有这个意图、或参数为空时返回 `null`。
 *
 * SSR / 测试环境里没有 `window` 时为 `null`（默认节），与 `wantsSignInOnLoad` 同一取舍。
 */
export function settingsSectionOnLoad(
  search: string | undefined = globalThis.window?.location.search,
): string | null {
  if (search === undefined) return null;
  const value = new URLSearchParams(search).get(SETTINGS_QUERY_PARAM)?.trim() ?? '';
  return value === '' ? null : value;
}

/**
 * `standalone=1`：这一页只画设置，不画应用壳。
 *
 * 为什么需要它：桌面端要把设置做成**独立窗口**（macOS `Settings` 场景 / WinUI 新窗 /
 * Electron 第二个 BrowserWindow），窗口里只有一个 `web-dist` 的 URL。若那个 URL 仍然
 * 渲染"侧栏 + 任务区"，窗口里就是"整个应用 + 一个模态挡在上面" —— 那不叫设置窗口。
 *
 * 与 `?settings=` 的关系：`standalone` **只在带 `settings` 时才有意义**（单开一个
 * 只画设置的页面而没有指向哪一节，等于把用户丢进一个没有上下文的表单）。
 */
export const SETTINGS_STANDALONE_PARAM = 'standalone';

/** 只认 `1` / `true`：写错的值不猜（与本文件其它参数同一条纪律）。 */
export function settingsStandaloneOnLoad(search: string = window.location.search): boolean {
  const value = new URLSearchParams(search).get(SETTINGS_STANDALONE_PARAM);
  return value === '1' || value === 'true';
}

/**
 * 这一页是不是"独立设置窗口"的载荷（`?settings=…&standalone=1`）。
 *
 * 之所以要单独一个函数：判断在**两个地方**都要用 —— `App` 决定收起壳，
 * `AccountMenu` 决定**压根不渲染**自己。第二处是必须的：那个菜单渲染在 `.ht-app`
 * **之外**（portal），CSS 选择器够不着它；2026-10-25 实测在窗口里它就是展开的、
 * 盖住分类栏前三项，看起来像"设置坏了"。
 */
export function isSettingsStandaloneSurface(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get(SETTINGS_QUERY_PARAM) !== null && settingsStandaloneOnLoad(search);
}
