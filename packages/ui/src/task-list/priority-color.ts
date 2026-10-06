/**
 * 优先级 → 语义色 token 名：**全仓唯一的一份**
 * =============================================
 *
 * 出处：`docs/plans/detail-pane-alignment.md` W5（调研 A2 / 主计划 §5.3 第 3 条
 * "最值得抄"）。在那之前这个判断有**两份逐字相同的实现**：
 * `apps/web/src/features/tasks/priority-display.ts` 与
 * `apps/mobile/src/lib/priority.ts`。两份都只把颜色算到"徽章文字"上，
 * 于是"复选框描边即优先级"谁都没做 —— 而四端各自要用的时候，它会变成四份。
 *
 * ## 为什么搬得动，而文案那一半搬不动
 *
 * 两份镜像当年的理由（写在 web 那份的文件头）是"`packages/ui` 依赖不了
 * `@heyta/i18n`"。**那句话只对文案那一半成立**：
 *
 * | 半边 | 需要 | 能不能共享 |
 * |---|---|---|
 * | 档位 → **词条 key** | `MessageKey` 类型（`@heyta/i18n`） | 🔴 不能（新增依赖要过 §3.1–3.2 两道门） |
 * | 档位 → **色 token 名** | 只需要 `Priority`（`@heyta/domain`） | ✅ 本包已经依赖 domain（`package.json`） |
 *
 * 所以这一刀只搬后者，并且**把旧的两份删掉**（AGENTS §3.5：抽取的收尾动作是
 * 删掉旧的那份并加门禁，不是再写一份更好的）。那条门禁在
 * `packages/ui/tests/task-row-priority.spec.ts` 与
 * `apps/web/tests/row-meta-shared.spec.tsx` 的 D 组里。
 *
 * ## 为什么这里给的是**名字**而不是取值
 *
 * `AGENTS.md` §5 第 2 条：语义名，不用外观名。取值由
 * `packages/design-system/src/tokens.css` 唯一决定，裸 hex 会被 `check:design` 判红。
 *
 * ## 🔴 `undefined` 与 `Priority.None` 是同一件事
 *
 * 判据写在**这里**而不是各调用点：抽取之前 `?? Priority.None` 在两个宿主的行元信息里
 * 各写了一遍（`apps/web/src/features/tasks/row-meta.tsx`、
 * `apps/mobile/src/screens/TasksScreen.tsx`），而共享的行组件本身没有兜底 ——
 * 于是"行上的颜色"和"徽章上的颜色"收敛点不在同一处。
 * 数值枚举的"漏一个分支"表现成**静默无色彩**，所以这两者必须在一处收敛。
 */

import { Priority } from '@heyta/domain';

/** 语义色 token 名（**名字**，取值由 `useHeytaTokens()` 给）。 */
export type PriorityColorToken =
  | 'color.priority-none'
  | 'color.priority-low'
  | 'color.priority-medium'
  | 'color.priority-high';

/**
 * 档位 → 语义色 token 名。
 *
 * 🔴 **穷尽判断，没有 default 兜一个"看起来对"的值**：`Priority` 是数值枚举
 * （`None = 0 … High = 3`），新增一档时如果忘了登记，TS 会在
 * `PRIORITY_COLOR_TOKENS` 的 `Record<Priority, …>` 上直接报错 ——
 * 而 `switch` + `default` 会把它**静默当成"无优先级"**，
 * 症状是新档位和老档位一个颜色，没有任何一层会红。
 */
const PRIORITY_COLOR_TOKENS: Record<Priority, PriorityColorToken> = {
  [Priority.None]: 'color.priority-none',
  [Priority.Low]: 'color.priority-low',
  [Priority.Medium]: 'color.priority-medium',
  [Priority.High]: 'color.priority-high',
};

/** 档位 → 语义色 token 名。`undefined` 与 `Priority.None` 同值。 */
export function priorityColorToken(priority: Priority | undefined): PriorityColorToken {
  return PRIORITY_COLOR_TOKENS[priority ?? Priority.None];
}
