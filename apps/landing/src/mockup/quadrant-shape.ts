/**
 * 四象限看板的**形状登记处**（纯数据，不 import React）
 * ======================================================
 *
 * 复现对象：`packages/ui/src/quadrant/QuadrantBoard.tsx` +
 * `packages/ui/src/quadrant/model.ts`（共享实现，web 与 mobile 共用），
 * 以及 `apps/web/src/features/quadrant/copy.ts`（宿主注入的文案）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它
 *
 * `apps/landing/src/mockup/QuadrantGrid.tsx` 是**手抄的**四象限复刻，而手抄会漂移。
 * 这一块比外壳更晚才被补上判据（M3 第六刀落下时明确记了「landing 第 3.5 步未做」），
 * 于是有一段时间它画的四象限**没有任何东西会因为它抄错而变红**：
 *
 *   | 会悄悄漂的东西 | 抄错了会怎样 |
 *   |---|---|
 *   | 四格的**顺序** | 真实现改成别的顺序，复刻还按老顺序排 —— 谁也不会发现 |
 *   | 象限 → **颜色 token** | 真实现把 q1 指到 `quadrant-3`，复刻仍是红/蓝互换 |
 *   | 每格的**标题 / 说明词条** | web 改名后复刻仍引用旧 key（中文可能逐字相同，看不出来） |
 *   | **空格占位** | 真实现的空态是纯文字，复刻自己加了个图标 |
 *
 * 所以本文件把「四象限长什么样」提成**一份登记**，
 * `apps/landing/tests/mockup-quadrant-shape.spec.tsx` 把它与真实现的
 * **源码文本**逐项对账（顺序 / 颜色 token / 词条 key），并与**领域层实算**对账
 * （每格有哪些卡、什么顺序、计数多少）。真实现改了而复刻没跟 → 红。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么不直接把复刻件换成真组件（这是**永久判决**，不是本次的取舍）
 *
 * `docs/research/dida-view-unification.md` §9.1：`apps/landing/src/mockup/**`
 * 静态 import `@heyta/ui` 会让首屏 **+61.9 kB gzip（+31%）**，懒加载孤岛也救不了
 * （实测数字见 `TaskList.tsx` 文件头）。落在 landing 的替代约束就是
 * 「**纯数据登记处 + 会红判据**」—— 与 `app-shell-shape.ts` / `task-row-shape.ts`
 * 同一个模式。**不要**为了"更真"把它换成真组件。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这里**不放**什么
 *
 * · **不放计数、不放卡里的任务** —— 那些从 `showcase-data.ts` 的唯一一份样例任务
 *   派生（`showcaseTasksByQuadrant()`），判据用领域层 `bucketByQuadrant()` 重算。
 * · **不放行（卡片）的几何** —— 行是另一个契约（`task-row-shape.ts`）的事。
 * · **不放颜色取值** —— 只登记"用哪一族语义 token"，取值在 `tokens.css`。
 */

import type { MessageKey } from '@heyta/i18n';

import type { ShowcaseQuadrant } from './showcase-data.js';

/**
 * 四象限看板里的一格。对应共享 `model.ts` 的一张 `QuadrantCardModel`。
 *
 * 🔴 `slot` 是**展示槽位号**（1…4），与共享 `model.ts` 的 `quadrantSlot()` 同源 ——
 * 判据会从 `QUADRANT_ORDER` / `QUADRANT_SLOT` 的源码文本重算它与 `quadrant` 的对应，
 * 所以这里不是"又抄了一份顺序"，而是一份**待对账的登记**。
 */
export interface MockQuadrantShape {
  /** 象限 id，与 `@heyta/domain` 的 `Quadrant` 一一对应（q1=重要且紧急）。 */
  readonly quadrant: ShowcaseQuadrant;
  /** 展示槽位号（= `Quadrant` 枚举值，也是真实现的 `quadrant-cell-N`）。 */
  readonly slot: 1 | 2 | 3 | 4;
  /** 色块类名后缀。与侧栏 `SHELL_QUADRANT_NAV` 的 `swatch` 同源。 */
  readonly swatch: ShowcaseQuadrant;
  /** 大标题（行动指令）的词条 key。 */
  readonly titleKey: MessageKey;
  /** 一句说明（象限定义）的词条 key。 */
  readonly hintKey: MessageKey;
}

/**
 * 四格的**展示顺序**（Q1 → Q2 → Q3 → Q4）。
 *
 * 🔴 顺序是产品语义（紧急且重要排最前），不是对象键的偶然顺序 ——
 * 与共享 `model.ts` 的 `QUADRANT_ORDER` 是同一条。判据会重算比对。
 *
 * 标题 / 说明用**应用自己的 key**（`web.quadrant.*`，来源
 * `features/quadrant/copy.ts`）—— 复刻原来走的是 `landing.quadrant.*`，
 * 两边中文逐字相同，那正是最舒服的漂移藏身处。
 */
export const MOCK_QUADRANT_SHAPE: readonly MockQuadrantShape[] = [
  {
    quadrant: 'q1',
    slot: 1,
    swatch: 'q1',
    titleKey: 'web.quadrant.do',
    hintKey: 'web.quadrant.q1',
  },
  {
    quadrant: 'q2',
    slot: 2,
    swatch: 'q2',
    titleKey: 'web.quadrant.plan',
    hintKey: 'web.quadrant.q2',
  },
  {
    quadrant: 'q3',
    slot: 3,
    swatch: 'q3',
    titleKey: 'web.quadrant.delegate',
    hintKey: 'web.quadrant.q3',
  },
  {
    quadrant: 'q4',
    slot: 4,
    swatch: 'q4',
    titleKey: 'web.quadrant.drop',
    hintKey: 'web.quadrant.q4',
  },
];

/**
 * 面板上与象限无关的三条文案 key。对应 `features/quadrant/copy.ts` 的
 * `cellA11y` / `empty` / `footnote`。
 *
 * 🔴 `cellA11y` 是**整格给屏幕阅读器的一句话**（模板 `象限：{title}，{hint}`）——
 * 复刻原来**完全没有**这一层，于是"格叫什么"只有肉眼可得。判据会逐格比对。
 */
export const MOCK_QUADRANT_KEYS = {
  cellA11y: 'web.quadrant.a11y.cell',
  empty: 'web.quadrant.dropHere',
  footnote: 'web.quadrant.footnote',
} as const satisfies Record<string, MessageKey>;

/**
 * 空格占位**有没有图标**。
 *
 * 🔴 真实现的空态就是 `TaskList` 的 `ListEmptyComponent`：一个 `View` 包一句
 * `Text`，**没有任何图标**（`packages/ui/src/task-list/TaskList.tsx`）。
 * 复刻曾经自己加了一只 `CheckCircle2` 并注释成"与真应用同一个图标"——
 * 那是一句**错的**自述：产品里没有那只图标。
 *
 * 值是 `false` 而不是"不登记"：判据要能同时守住"图标不许回来"与
 * "将来真实现加了图标，这里要跟着改"。
 */
export const MOCK_QUADRANT_EMPTY_HAS_ICON = false;
