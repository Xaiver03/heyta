/**
 * 优先级文案与语义色
 * ==================
 *
 * 🔴 这个文件存在的理由：`Priority` 是**数值枚举**（`High = 3`），
 * 而数值枚举最容易写出"永远为假"的条件。
 *
 * 实测过的形状：任务行里写 `task.priority === 'high'` ——
 * TS 会报"两个类型没有重叠"，但如果那一步没有类型检查兜住，
 * 它的行为是**高优先级任务不显示任何标记，而且不报错**。
 * 所以"数值 → 文案"的映射只写在这里一次，并配可失败的测试。
 *
 * 颜色**只给语义 token 名，不给取值** —— 取值由设计系统唯一决定
 * （`AGENTS.md` §5 第 2 条：语义名，不用外观名）。
 */

import { Priority } from '@heyta/domain';
import type { MessageKey } from '@heyta/i18n';

import type { Translate } from '../i18n/translate';

/**
 * 档位 → 词条 key。
 *
 * ⚠️ 这里存的是 **key 不是文案**：模块级拿不到 `t`，而把中文写在这里
 * 就是硬编码 —— 门禁在迁移模式下会直接判红。
 */
const PRIORITY_LABEL_KEYS: Record<Priority, MessageKey> = {
  [Priority.None]: 'mobile.priority.none',
  [Priority.Low]: 'mobile.priority.low',
  [Priority.Medium]: 'mobile.priority.medium',
  [Priority.High]: 'mobile.priority.high',
};

/**
 * 选择器里的展示顺序：无 → 低 → 中 → 高。
 *
 * 🔴 **显式写出来，不靠 `Object.keys` 或枚举反向映射。**
 * 数值枚举的反向映射（`Priority[3] === 'High'`）看起来能自动得到顺序，
 * 但它依赖"枚举值恰好连续从 0 开始"这一实现细节；
 * 哪天有人在中间插一个 `Urgent = 4`，顺序会**静默错位**。
 */
export const PRIORITY_ORDER: readonly Priority[] = [
  Priority.None,
  Priority.Low,
  Priority.Medium,
  Priority.High,
];

/** 语义色 token 名（**名字**，不是取值）。 */
export type PriorityColorToken =
  | 'color.priority-none'
  | 'color.priority-low'
  | 'color.priority-medium'
  | 'color.priority-high';

/** 档位 → 语义色 token 名。 */
export function priorityColorToken(priority: Priority): PriorityColorToken {
  switch (priority) {
    case Priority.High:
      return 'color.priority-high';
    case Priority.Medium:
      return 'color.priority-medium';
    case Priority.Low:
      return 'color.priority-low';
    default:
      return 'color.priority-none';
  }
}

/** 档位 → 当前语言的名称。 */
export function priorityLabel(priority: Priority, t: Translate): string {
  return t(PRIORITY_LABEL_KEYS[priority]);
}

/**
 * 任务行上的优先级徽标文案。
 *
 * `undefined` 与 `None` 都返回 `null` —— **"没有优先级"不是信息**，
 * 给它一个"无优先级"的徽标只会让每一行都多一个装饰，
 * 真正的高优先级反而淹没在里面。
 */
export function priorityBadgeLabel(priority: Priority | undefined, t: Translate): string | null {
  if (priority === undefined || priority === Priority.None) return null;
  return t('mobile.priority.badge', { level: priorityLabel(priority, t) });
}
