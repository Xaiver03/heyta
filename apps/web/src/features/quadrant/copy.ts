/**
 * 四象限的文案（Web 壳）
 * ========================
 *
 * 与 `features/categories/copy.ts` 同一个形状：**结构已经搬进 `@heyta/ui`**，
 * 这里只剩"把语义结果映射到本端词条"这一层 —— 所以它现在是
 * `QuadrantBoardLabels` 的一个构造器，字段与共享层一一对应，
 * 少给一个编译期就会报（共享层的 `labels` 是必填的）。
 *
 * 🔴 **复用已有的 `web.quadrant.*`**，一条新词条都不加
 * （`packages/i18n` 不在本刀白名单；两端复用同一组词条在本仓库有先例 ——
 * landing 复用 `web.shell.*`）。
 *
 * ⚠️ 标题与说明的**分工沿用迁移前的写法**：大标题是「马上做 / 计划做 /
 * 交给别人 / 先不做」，说明是「重要且紧急 / 重要不紧急 / …」。
 * 这一处**不是**本刀要改的东西 —— 顺手改文案会让"迁移"变成"改版"，
 * 而两者混在一起就没人能说清界面变了是因为哪一件。
 *
 * 拖动手柄使用独立的动作名；进行时文案只留给 live region，避免读屏把
 * “正在拖拽”误当成一个可执行动作。
 */

import type { QuadrantBoardLabels } from '@heyta/ui';
import { Quadrant } from '@heyta/domain';
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
 *
 * @param options.firstEmptyQuadrant 展示顺序里**第一个**空象限。
 *   W5（四象限空态减重）之前的写法是四个空格各显示一遍「拖任务到这里」
 *   （审计证据 02-quadrant.png：同屏 3 次）。现在只有**第一个**空象限
 *   显示这句引导（"空态必须有下一步提示"由它守住）；其余空象限给
 *   **空串** —— 共享 `TaskList` 对空串仍渲染那个带内边距的占位块
 *   （轻量视觉占位、无文案），只是不再念引导句。
 *   哪一个是"第一个"由宿主（feature 层）用 `toQuadrantCards` 算，
 *   这里只管按它选词。
 */
export function quadrantBoardLabels(
  t: I18nValue['t'],
  options?: { readonly firstEmptyQuadrant?: Quadrant },
): QuadrantBoardLabels {
  const firstEmpty = options?.firstEmptyQuadrant;
  return {
    title: (quadrant) => t(QUADRANT_TITLE_KEY[quadrant]),
    hint: (quadrant) => t(QUADRANT_HINT_KEY[quadrant]),
    /**
     * 整格给屏幕阅读器的那一句。
     *
     * ⚠️ 模板只用 `title` / `hint`（`web.quadrant.a11y.cell` 就是这两个占位符）。
     * 计数**不**进这句：一格里有多少条，读屏用户往下走就会听到，
     * 而把它塞进格名会让"进这一格"这件事从"听一句"变成"听一串"。
     * 计数的无障碍名在徽标自己身上（见 {@link quadrantCountA11y}）。
     */
    cellA11y: ({ title, hint }) => t('web.quadrant.a11y.cell', { title, hint }),
    /** 空格不是"什么都没有"，它说的是"这一类现在没有要处理的事"。 */
    empty: (quadrant) =>
      quadrant === firstEmpty ? t('web.quadrant.dropHere') : '',
    // footnote 不在这里给：W5 起底部规则说明由 web 宿主收进 <details> 折叠帮助
    // （summary 用 `web.shell.nav.help`，正文仍是 `web.quadrant.footnote`，
    // 一条词条都不加）。共享板收不到 footnote 就不渲染那一行。
  };
}

/**
 * 计数徽标的无障碍名（W5）：**现有象限名词条 + 数字**的组合
 * （如「马上做 2」）—— 零新增词条的硬约束下唯一合法的拼法。
 */
export function quadrantCountA11y(
  t: I18nValue['t'],
  quadrant: Quadrant,
  count: number,
): string {
  return `${t(QUADRANT_TITLE_KEY[quadrant])} ${String(count)}`;
}

/** 拖拽手柄的无障碍名（见文件头的诚实记账）。 */
export function dragHandleLabel(t: I18nValue['t']): string {
  return t('web.quadrant.a11y.handle');
}
