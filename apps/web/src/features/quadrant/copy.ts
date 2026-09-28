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
 * ⚠️ 没有一个"拖动手柄"的专门词条（`packages/i18n` 不在白名单）。
 * 手柄的无障碍名**临时复用** `web.quadrant.dragging`（它语义上是进行时，
 * 作为手柄名略勉强）。最小一步：在 `packages/i18n` 加
 * `web.quadrant.a11y.handle`（中英同步）后替换。
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
 */
export function quadrantBoardLabels(t: I18nValue['t']): QuadrantBoardLabels {
  return {
    title: (quadrant) => t(QUADRANT_TITLE_KEY[quadrant]),
    hint: (quadrant) => t(QUADRANT_HINT_KEY[quadrant]),
    /**
     * 整格给屏幕阅读器的那一句。
     *
     * ⚠️ 模板只用 `title` / `hint`（`web.quadrant.a11y.cell` 就是这两个占位符）。
     * 计数**不**进这句：一格里有多少条，读屏用户往下走就会听到，
     * 而把它塞进格名会让"进这一格"这件事从"听一句"变成"听一串"。
     */
    cellA11y: ({ title, hint }) => t('web.quadrant.a11y.cell', { title, hint }),
    /** 空格不是"什么都没有"，它说的是"这一类现在没有要处理的事"。 */
    empty: () => t('web.quadrant.dropHere'),
    footnote: t('web.quadrant.footnote'),
  };
}

/** 拖拽手柄的无障碍名（见文件头的诚实记账）。 */
export function dragHandleLabel(t: I18nValue['t']): string {
  return t('web.quadrant.dragging');
}
