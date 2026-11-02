/**
 * 设置浮层里的**落位锚点**（工单 H9 第 3 刀，2026-10-06）
 *
 * 「从别处点一下，要落在设置里的哪一节」这件事原本有两份各写一遍的 boolean
 * （`scrollToHelp`、`scrollToProfile`）。加第三档（同步）时把它们收成这一张表：
 * **一条规则一份实现**，落点与要不要给焦点都在数据里写清楚。
 *
 * ⚠️ `id` 是渲染出来的 DOM 锚点，不是文案键。加一档必须同时在设置那一侧
 * 挂上对应 `id` 的容器 —— 只加表项的话，`getElementById` 拿到 `null`
 * 而调用点是 `?.`，**不会报错**（症状是"点了没反应，页面停在设置顶部"）。
 *
 * ⚠️ 加一档还必须写清 `section`（落在左栏的哪一组）。2026-10 七组同构之后，
 * "锚点名 == 分组名后缀"这条隐含约定已经不成立，理由见下面 `SettingsAnchorSection`。
 */
export type SettingsAnchor = 'profile' | 'sync' | 'help';

/**
 * 落点属于**哪一个分组**。
 *
 * 🔴 为什么这一档要写死在表里，而不是继续用「`settings-group-${anchor}`」推出来：
 * 2026-10 三端同构之后，分组从 8 变 7 —— 「同步与隐私」并进了「数据与同步」
 * （`settings-group-sync` ⇒ `settings-group-data`）、「账号与安全」并进了「账号」。
 * 而**锚点 id 不能跟着变**（`settings-sync` / `settings-profile` / `settings-help`
 * 是 `SyncSettingsPanel` / `ProfilePanel` / `HelpPanel` 里那几个容器的 DOM id），
 * 于是"锚点名 == 分组名后缀"这条隐含约定**已经不成立**。
 *
 * 继续用字符串拼接的后果与上一段那条同族、而且更坏：拼出来的 id 会是一个
 * **合法但不存在于导航里**的值 ⇒ 每一节都 `hidden` ⇒ 用户看到一张空白设置页，
 * 而 TS 一个字都不会说。所以分成两个字段，且这里的字面量与
 * `App.tsx` 的 `SETTINGS_NAV_ITEMS` 逐字相同、由类型（`SettingsAnchorSection`
 * 必须是 `SettingsSectionId` 的子集）兜住。
 */
export type SettingsAnchorSection =
  | 'settings-group-profile'
  | 'settings-group-data'
  | 'settings-group-help';

export interface SettingsAnchorTarget {
  /** 那一节在 DOM 里的锚点 id。 */
  readonly id: string;
  /** 这个请求要**选中**左边目录里的哪一组。 */
  readonly section: SettingsAnchorSection;
  /**
   * 滚完之后把焦点给谁（CSS 选择器）。`undefined` = 只滚不给焦点。
   *
   * 🔴 为什么大多数档都要给：只滚不聚焦，键盘用户滚完了还得自己 Tab 十几下
   * 才回到输入框，而读屏用户根本不知道自己到了哪儿。
   */
  readonly focus?: string;
}

export const SETTINGS_ANCHORS: Record<SettingsAnchor, SettingsAnchorTarget> = {
  profile: {
    id: 'settings-profile',
    section: 'settings-group-profile',
    focus: '#profile-nickname, [data-testid="profile-signin-required-action"]',
  },
  sync: {
    id: 'settings-sync',
    section: 'settings-group-data',
    focus: '[data-testid="sync-signin-required-action"], [data-testid="sync-unlock-and-sync"]',
  },
  help: { id: 'settings-help', section: 'settings-group-help' },
};
