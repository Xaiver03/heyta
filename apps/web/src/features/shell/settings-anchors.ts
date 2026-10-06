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
 */
export type SettingsAnchor = 'profile' | 'sync' | 'help';

export interface SettingsAnchorTarget {
  /** 那一节在 DOM 里的锚点 id。 */
  readonly id: string;
  /**
   * 滚完之后把焦点给谁（CSS 选择器）。`undefined` = 只滚不给焦点。
   *
   * 🔴 为什么大多数档都要给：只滚不聚焦，键盘用户滚完了还得自己 Tab 十几下
   * 才回到输入框，而读屏用户根本不知道自己到了哪儿。
   */
  readonly focus?: string;
}

export const SETTINGS_ANCHORS: Record<SettingsAnchor, SettingsAnchorTarget> = {
  profile: { id: 'settings-profile', focus: '#profile-nickname' },
  sync: { id: 'settings-sync', focus: '[data-testid="sync-server-url"]' },
  help: { id: 'settings-help' },
};
