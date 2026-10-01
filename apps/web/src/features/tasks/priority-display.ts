/**
 * 任务行上的优先级徽章文案（Web 端）
 * ====================================
 *
 * 🔴 它修的是一个**看得见的错**：`App.tsx` 原先把优先级渲染成裸的
 * `P{row.source.priority}` —— 一个从不对用户解释的数字，而且**中英两边都是**
 * （数字没有语言）。共享层 `TaskBadges` 要的是"已本地化的文案 + 颜色"，
 * 所以这一层必须存在。
 *
 * ## 为什么这里是一份**镜像**而不是共享
 *
 * 同一套判断在移动端住在 `apps/mobile/src/lib/priority.ts`。理想形态是共享，
 * 但它要求 `packages/ui` 依赖 `@heyta/i18n`（`t` 与 `MessageKey` 的类型），
 * 而新增依赖要过 §3.1–3.2 两道门并逐项登记 —— 那需要动
 * `packages/ui/package.json`，本轮它正被另一条会话改。**不猜、不绕**：
 * 先按仓库既有 convention（"算数只有一份，说法各端各写"，见
 * `apps/web/src/lib/due-display.ts` 文件头）写第二份，
 * 并让 `apps/web/tests/row-meta-shared.spec.tsx` 逐档**与同一批词条对账** ——
 * 漂移当场红，而不是等某个端的用户看到不一样的字。
 *
 * 🔴 **用的词条与移动端逐字相同**（`mobile.priority.*`）。
 * 不选 `web.capture.priority.*`：那四个 key 服务的是 AI 捕获面板的
 * `<select>` 选项，将来为了下拉更紧凑而把"高优先级"缩成"高"是完全合理的，
 * 而行内徽章跟着变就不合理了。共用移动端的 badge key 才是"同一件信息"的登记。
 */

import { Priority } from '@heyta/domain';
import type { I18nValue, MessageKey } from '@heyta/i18n';

type T = I18nValue['t'];

/** 档位 → 词条 key（存的是 **key 不是文案**，硬编码中文会被 `check:ui-language` 判红）。 */
const PRIORITY_LABEL_KEYS: Record<Priority, MessageKey> = {
  [Priority.None]: 'mobile.priority.none',
  [Priority.Low]: 'mobile.priority.low',
  [Priority.Medium]: 'mobile.priority.medium',
  [Priority.High]: 'mobile.priority.high',
};

/** 语义色 token 名（**名字**，取值由 `useHeytaTokens()` 给 —— 裸 hex 会被 `check:design` 判红）。 */
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

/**
 * 行内优先级徽章的文案，与移动端 `priorityBadgeLabel` 同构。
 *
 * `undefined` 与 `None` 都给 `null` —— **"没有优先级"不是信息**：
 * 给它一个徽章只会让每一行多一个装饰，真的高优先级反而淹在里面。
 */
export function priorityBadgeText(priority: Priority | undefined, t: T): string | null {
  if (priority === undefined || priority === Priority.None) return null;
  return t('mobile.priority.badge', { level: t(PRIORITY_LABEL_KEYS[priority]) });
}
