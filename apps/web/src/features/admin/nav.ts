import {
  CalendarDays,
  ChartColumn,
  CreditCard,
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
}

/**
 * 后台的**导航清单**（分区 → 词条 + 图标）。
 *
 * 🔴 一份清单，两个壳：设置页里那排横向 tab（`AdminPanel` 的
 * `chrome="settings"`）与 `/admin` 那个独立后台页的侧栏
 * （`AdminConsolePage`）。抄两份的后果不是重复代码，是**两处会不一致**：
 * 加一格只改一处，另一个界面就永远少一格 —— 而两边都是合法的
 * `AdminTab` 子集，typecheck 抓不到，只有人工点得出来。
 *
 * 清单与 `AdminTab` 那个联合类型**必须逐格对齐**。加一格而没有对应的
 * `case` 会红在这一处的类型上（`key` 是 `AdminTab`，反过来不会），
 * 所以真要加分区：先加 `AdminTab` 成员与拉数据的 `case`，再在这里登记。
 */
export const ADMIN_TABS: readonly AdminNavEntry[] = [
  { key: 'overview', labelKey: 'web.admin.tab.overview', icon: LayoutDashboard },
  { key: 'users', labelKey: 'web.admin.tab.users', icon: Users },
  { key: 'subscriptions', labelKey: 'web.admin.tab.subscriptions', icon: CreditCard },
  { key: 'orders', labelKey: 'web.admin.tab.orders', icon: Receipt },
  { key: 'coupons', labelKey: 'web.admin.tab.coupons', icon: TicketPercent },
  { key: 'invites', labelKey: 'web.admin.tab.invites', icon: UserPlus },
  { key: 'revenue', labelKey: 'web.admin.tab.revenue', icon: ChartColumn },
  { key: 'announcements', labelKey: 'web.admin.tab.announcements', icon: Megaphone },
  { key: 'holidays', labelKey: 'web.admin.tab.holidays', icon: CalendarDays },
  { key: 'refunds', labelKey: 'web.admin.tab.refunds', icon: Undo2 },
];
