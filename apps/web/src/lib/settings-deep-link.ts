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
 * 旧分节 id → 现在那一组（**三端同构后，分组变少、id 一个没改**）。
 * ==========================================================================
 *
 * 2026-10 起 Web / 桌面的设置左栏按移动端已落地的那套七组重排
 * （`docs/plans/settings-information-architecture.md` §5.1/§5.5）：
 * **账号 / 订阅 / 数据与同步 / 提醒与通知 / 外观与语言 / 功能与 AI / 关于与帮助**。
 *
 * 🔴 分组从 8 变 7，但 `settings-group-*` 的 id **一个都没改**（产品裁决，见那份计划 §7 第 1 条）。
 * 代价是内部 id 与显示名不再逐字对应（`settings-group-profile` 显示成「账号」），
 * 换来的是这些**不该跟着 IA 变**的东西一个字都不用动：落地页购买链接、桌面三壳的
 * 默认载荷与合法节清单（`apps/desktop` / `desktop-windows` / `desktop-macos`）、
 * QA 装置的选择器、以及别人发出去的旧链接。
 *
 * 所以"旧 id 还认不认"这件事必须有**唯一一张表**：认不出的 id 不等于报错，
 * 它等于"点了没反应"（`App.tsx` 的 `isSettingsSectionId` 会把设置压根不打开）——
 * 那是最难查的一种坏。表在下面，`canonicalSettingsSection()` 是唯一入口。
 *
 * 左边那一列的两种来源：
 *   - **Web 自己的旧 id**：`settings-group-account`（账号与安全）、`settings-group-sync`（同步与隐私）。
 *     它们各自被并进了同一个意图的组（账号 / 数据与同步）。
 *   - **移动端的 key 空间**：移动端的 `SettingsSectionKey` 与 `LEGACY_SECTION`
 *     （`apps/mobile/src/screens/SettingsScreen.tsx`）用的是 `appearance` / `features` / `about`，
 *     并且把「常规」拆成了三组（`general` ⇒ 提醒与通知）。三端同构之后，
 *     一条从移动端口径写出来的 `?settings=…` 也该落对地方 —— 否则同一句话在两端
 *     落到两个组，正是这次迁移要治的病。
 */
export const LEGACY_SETTINGS_SECTIONS: Readonly<Record<string, string>> = {
  /** Web 旧「账号与安全」→ G1 账号。 */
  'settings-group-account': 'settings-group-profile',
  /** 移动端旧「账号安全」→ G1 账号（与上一条同一个意图，两个端各有一个旧名）。 */
  'settings-group-security': 'settings-group-profile',
  /** Web 旧「同步与隐私」→ G3 数据与同步。 */
  'settings-group-sync': 'settings-group-data',
  /** 移动端旧「常规」→ G4 提醒与通知（「常规」那个桶拆成的三组里，它的入口意图是提醒）。 */
  'settings-group-general': 'settings-group-notifications',
  /** 移动端 key「功能与 AI」→ G6（Web 这一组的 id 沿用 `-ai`）。 */
  'settings-group-features': 'settings-group-ai',
  /** 移动端 key「关于与帮助」→ G7（Web 这一组的 id 沿用 `-help`）。 */
  'settings-group-about': 'settings-group-help',
};

/**
 * 把任意一个深链 id 折成**现行**的分组 id。
 *
 * 认不出的值原样返回 —— 判断"这不合法"仍然只有一处（`App.tsx` 的
 * `isSettingsSectionId`），这里**不**吞掉错误、也不猜一个默认组：
 * 猜默认组的症状是"点了订阅，落到了外观"，比不打开更让人困惑。
 */
export function canonicalSettingsSection(value: string): string {
  return LEGACY_SETTINGS_SECTIONS[value] ?? value;
}

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
