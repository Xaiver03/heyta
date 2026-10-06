/**
 * 任务行上的优先级徽章文案（Web 端）
 * ====================================
 *
 * 🔴 它修的是一个**看得见的错**：`App.tsx` 原先把优先级渲染成裸的
 * `P{row.source.priority}` —— 一个从不对用户解释的数字，而且**中英两边都是**
 * （数字没有语言）。共享层 `TaskBadges` 要的是"已本地化的文案 + 颜色"，
 * 所以这一层必须存在。
 *
 * ## 为什么这里是一份**镜像**而不是共享 —— 只管文案那一半
 *
 * 同一套判断在移动端住在 `apps/mobile/src/lib/priority.ts`。理想形态是共享，
 * 但它要求 `packages/ui` 依赖 `@heyta/i18n`（`t` 与 `MessageKey` 的类型），
 * 而新增依赖要过 §3.1–3.2 两道门并逐项登记。所以**文案**仍按仓库既有
 * convention（"算数只有一份，说法各端各写"，见 `apps/web/src/lib/due-display.ts`
 * 文件头）各写一份，并由 `apps/web/tests/row-meta-shared.spec.tsx` 的 D 组
 * 逐档**与移动端对账** —— 漂移当场红，而不是等某个端的用户看到不一样的字。
 *
 * ⚠️ **那句话曾经被当成"整个文件都不能共享"的理由，而它只对文案成立。**
 * 档位 → 语义色 token 名只需要 `Priority`（`@heyta/domain`，`packages/ui`
 * 已经依赖它），2026-10-04 已抽到 `packages/ui/src/task-list/priority-color.ts`
 * —— 因为 W5 要把优先级色画到**共享层的勾选框**上，那份颜色留在两个宿主里
 * 就没法被行组件用。颜色在本文件里**不再出现**，行元信息直接从 `@heyta/ui` 取。
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

/**
 * 行内优先级徽章的文案，与移动端 `priorityBadgeLabel` 同构。
 *
 * `undefined` 与 `None` 都给 `null` —— **"没有优先级"不是信息**：
 * 给它一个徽章只会让每一行多一个装饰，真的高优先级反而淹在里面。
 * （勾选框的描边是另一条通道：它由共享层按 `priorityColorToken` 上色，
 * 与这里"不画徽章"并不矛盾 —— 描边是**本来就在**的元素，不是新增装饰。）
 */
export function priorityBadgeText(priority: Priority | undefined, t: T): string | null {
  if (priority === undefined || priority === Priority.None) return null;
  return t('mobile.priority.badge', { level: t(PRIORITY_LABEL_KEYS[priority]) });
}
