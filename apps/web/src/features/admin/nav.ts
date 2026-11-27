import {
  CalendarDays,
  ChartColumn,
  Bot,
  CreditCard,
  Gift,
  LayoutDashboard,
  Megaphone,
  Receipt,
  TicketPercent,
  Undo2,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { MessageKey } from '@heyta/i18n';

import type { AdminTab } from './store.js';

/** 侧栏分组：控制台（置顶不分组）/ 用户 / 收入与订阅 / 内容 / 系统。 */
export type AdminNavGroupId = 'console' | 'users' | 'revenue' | 'content' | 'system';

export interface AdminNavEntry {
  key: AdminTab;
  /**
   * 文案**键**，不是文案本身。
   *
   * 🔴 与 `features/shell/view-tabs.ts` 的 `NavEntry` 同一条纪律：模块级常量里
   * 不能有句子 —— `t` 是渲染期的（跟随语言变化），把成品文案存进常量会让
   * 切语言时这一格还停在旧语言。
   */
  labelKey: MessageKey;
  /** 侧栏用的图标。设置页那一排横向 tab 不放图标，忽略这一格。 */
  icon: LucideIcon;
  /** 归属分组（见 `ADMIN_NAV_GROUPS`）。 */
  group: AdminNavGroupId;
}

/**
 * 后台的**导航清单**（分区 → 词条 + 图标 + 分组）。
 *
 * 🔴 一份清单，两个壳：设置页里那排横向 tab（`AdminPanel` 的
 * `chrome="settings"`）与 `/admin` 那个独立后台页的分组侧栏
 * （`AdminConsolePage`）。抄两份的后果不是重复代码，是**两处会不一致**：
 * 加一格只改一处，另一个界面就永远少一格 —— 而两边都是合法的
 * `AdminTab` 子集，typecheck 抓不到，只有人工点得出来。
 *
 * 清单与 `AdminTab` 那个联合类型**必须逐格对齐**。加一格而没有对应的
 * `case` 会红在这一处的类型上（`key` 是 `AdminTab`，反过来不会），
 * 所以真要加分区：先加 `AdminTab` 成员与拉数据的 `case`，再在这里登记。
 *
 * 分组只影响 `/admin` 侧栏的呈现（11 个扁平 tab 折成 4 组）；`ADMIN_TABS`
 * 的**顺序与成员不变**，设置页那排横向 tab 与按 `tab` 拉数据的 `switch` 都不受分组影响。
 */
export const ADMIN_TABS: readonly AdminNavEntry[] = [
  { key: 'overview', labelKey: 'web.admin.tab.overview', icon: LayoutDashboard, group: 'console' },
  { key: 'users', labelKey: 'web.admin.tab.users', icon: Users, group: 'users' },
  { key: 'subscriptions', labelKey: 'web.admin.tab.subscriptions', icon: CreditCard, group: 'revenue' },
  { key: 'grants', labelKey: 'web.admin.tab.grants', icon: Gift, group: 'revenue' },
  { key: 'orders', labelKey: 'web.admin.tab.orders', icon: Receipt, group: 'revenue' },
  { key: 'coupons', labelKey: 'web.admin.tab.coupons', icon: TicketPercent, group: 'revenue' },
  { key: 'invites', labelKey: 'web.admin.tab.invites', icon: UserPlus, group: 'revenue' },
  { key: 'revenue', labelKey: 'web.admin.tab.revenue', icon: ChartColumn, group: 'revenue' },
  { key: 'announcements', labelKey: 'web.admin.tab.announcements', icon: Megaphone, group: 'content' },
  { key: 'holidays', labelKey: 'web.admin.tab.holidays', icon: CalendarDays, group: 'system' },
  { key: 'refunds', labelKey: 'web.admin.tab.refunds', icon: Undo2, group: 'revenue' },
  { key: 'ai-gateway', labelKey: 'web.admin.tab.aiGateway', icon: Bot, group: 'system' },
];

export interface AdminNavGroup {
  id: AdminNavGroupId;
  headerKey?: MessageKey;
  entries: readonly AdminNavEntry[];
}

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  { id: 'console', entries: ADMIN_TABS.filter((e) => e.group === 'console') },
  { id: 'users', entries: ADMIN_TABS.filter((e) => e.group === 'users') },
  { id: 'revenue', headerKey: 'web.admin.nav.revenue', entries: ADMIN_TABS.filter((e) => e.group === 'revenue') },
  { id: 'content', headerKey: 'web.admin.nav.content', entries: ADMIN_TABS.filter((e) => e.group === 'content') },
  { id: 'system', headerKey: 'web.admin.nav.system', entries: ADMIN_TABS.filter((e) => e.group === 'system') },
];
];
