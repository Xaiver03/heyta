/**
 * 四象限的文案接线（移动壳）
 * ============================
 *
 * 与 `apps/web/src/features/quadrant/copy.ts` 同一个形状：**结构在 `@heyta/ui`**
 * （`QuadrantBoard` + `model.ts`），这里只剩"把语义结果映射到本端词条"这一层 ——
 * 所以它是 `QuadrantBoardLabels` 的构造器，字段与共享层一一对应，
 * 少给一个编译期就会报（共享层的 `labels` 是必填的）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 已知命名残差：这些键本该叫 `common.quadrant.*`
 *
 * 标题 / 说明 / 无障碍名 / 空态复用的都是 **`web.quadrant.*`** ——
 * 与 `apps/landing` 复用 `web.shell.*` 是同一个先例（`packages/i18n` 不在
 * 本刀白名单，且新词条要中英同步）。但"四象限"这件事**四端完全同义**，
 * 它不属于任何一端：正确的命名空间是 `common.quadrant.*`。
 *
 * 之所以现在只能这样写，是因为词条表按壳分了命名空间，而象限是最没有壳差异的
 * 功能之一。**将来合并命名空间时，这一处是纯改名**（键名换、文案不动）。
 * ✅ 同义的 `mobile.quadrant.q1..q4` 曾经被 `TasksScreen` 的页内象限视图使用；
 * P10 收敛后那一档改用本文件（`web.quadrant.*`），那四条于是成了孤儿键 ——
 * **已在 2026-09-28 删除**（父 agent 执行，5 键 × 中英两表 = 10 条；
 * i18n 单测 10 绿 · `check:ui-language` 绿 · typecheck 0）。
 * ⚠️ 其中旧 `web.habits.heatmap` 的 zh 写 `{{count}}`、en 写 `{count}`，
 * **中英占位符本来就不一致**（复用会渲染字面 `{5}`）—— 这也是为什么当初新增了
 * `.a11y`/`.cell` 而不是改旧键。同批一并删除。
 * 本文件**刻意不再新增**第二条同义键 —— 否则会出现同一句话的三个键。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 两处与 web 有意不同（不是遗漏）
 *
 * 1. **空态不用 `web.quadrant.dropHere`**（它是「拖任务到这里」）。
 *    移动端**没有拖放**（`@dnd-kit` 是 DOM 库，且手机没有鼠标），照搬这句
 *    就是让界面承诺一个不存在的动作。改用已有的
 *    `mobile.tasks.quadrant.empty`（「这里还没有任务」）—— 它是一个**事实句**，
 *    与矩阵"空格也是信息"的语义一致。
 * 2. **不传 `footnote`。** web 的那句说明里有一半在讲"拖拽会改截止时间"，
 *    而在移动端拖不了、期限也不会因为任何手势被改。宁可整句不显示，
 *    也不要显示一句假话。
 *
 * 🔴 本文件不做任何领域判断：什么算紧急、什么算重要、怎么分桶、桶内怎么排序
 * 全在 `@heyta/domain`（`bucketByQuadrant` / `classifyQuadrant`）与
 * `@heyta/ui` 的 `quadrant/model.ts`。这里只搬字。
 */

import { Quadrant } from '@heyta/domain';
import type { QuadrantBoardLabels } from '@heyta/ui';
import type { I18nValue, MessageKey } from '@heyta/i18n';

/**
 * 象限 → 大标题词条。
 *
 * 🔴 显式表而不是三元链：`Quadrant` 是名义枚举，漏一项要让**编译期**说话
 * （`Record<Quadrant, MessageKey>` 会直接报缺键），而不是运行时显示空白。
 */
const QUADRANT_TITLE_KEY: Record<Quadrant, MessageKey> = {
  [Quadrant.UrgentImportant]: 'web.quadrant.do',
  [Quadrant.ImportantNotUrgent]: 'web.quadrant.plan',
  [Quadrant.UrgentNotImportant]: 'web.quadrant.delegate',
  [Quadrant.Neither]: 'web.quadrant.drop',
};

/** 象限 → 一句说明的词条。 */
const QUADRANT_HINT_KEY: Record<Quadrant, MessageKey> = {
  [Quadrant.UrgentImportant]: 'web.quadrant.q1',
  [Quadrant.ImportantNotUrgent]: 'web.quadrant.q2',
  [Quadrant.UrgentNotImportant]: 'web.quadrant.q3',
  [Quadrant.Neither]: 'web.quadrant.q4',
};

/**
 * 构造共享 `QuadrantBoard` 需要的全部文案。
 *
 * 共享层**不 import i18n**（见它的文件头），所以模板留在这里；
 * 字段名必须与 `QuadrantBoardLabels` 逐项对上 —— 漏了编译不过。
 */
export function quadrantBoardLabels(t: I18nValue['t']): QuadrantBoardLabels {
  return {
    title: (quadrant) => t(QUADRANT_TITLE_KEY[quadrant]),
    hint: (quadrant) => t(QUADRANT_HINT_KEY[quadrant]),
    /**
     * 整格给屏幕阅读器的那一句。
     *
     * ⚠️ 模板只用 `title` / `hint`（`web.quadrant.a11y.cell` 就是这两个占位符）。
     * 计数**不**进这句：一格里有多少条，读屏用户往下走就会听到。
     */
    cellA11y: ({ title, hint }) => t('web.quadrant.a11y.cell', { title, hint }),
    /** 空格不是"什么都没有"，它说的是"这一类现在没有要处理的事"（见文件头第 1 条）。 */
    empty: () => t('mobile.tasks.quadrant.empty'),
  };
}

/** 象限 → 大标题词条 key（测试与其它端对账时要能读到这张表）。 */
export const QUADRANT_TITLE_KEYS = QUADRANT_TITLE_KEY;

/** 象限 → 说明词条 key（同上）。 */
export const QUADRANT_HINT_KEYS = QUADRANT_HINT_KEY;
