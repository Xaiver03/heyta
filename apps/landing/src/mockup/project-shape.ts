/**
 * 清单 / 标签复刻件的**形状登记处**（纯数据，不 import React）
 * ============================================================
 *
 * 复现对象：`packages/ui/src/projects/OrganizerList.tsx`（M3 第九刀起，
 * 真实现是**共享 RN 原语组件**，web 侧栏与移动端「我的」页用的是同一份）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（与 `habit-shape.ts` / `quadrant-shape.ts` 同一理由）
 *
 * `docs/research/dida-view-unification.md` §9.1 是**永久判决**：
 * `apps/landing/src/mockup/**` 静态 import `@heyta/ui` 会让首屏
 * **+61.9 kB gzip（+31%）**。替代约束是「**纯数据登记处 + 会红判据**」——
 * 本文件是登记处，`tests/mockup-project-shape.spec.tsx` 是会红判据。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 落地页的清单/标签块是**部分复刻**，这一点必须被写下来
 *
 * 真实现的 `OrganizerList` 一行有**五个部件**（见 `ORGANIZER_ROW_PARTS`），
 * 而落地页侧栏只画了「分区标题 + 静态行 + `+`」——
 * 行上的计数、取色、删除**都没有**。这不是本刀引入的：迁移前的复刻件就是这样
 * （`showcase-fidelity-audit.md` §2 #3/#4 记过它的上一版）。
 *
 * 🔴 本刀做的是**把它变成"可被机器核对的部分复刻"**，不是假装它是完整复刻：
 * 每个部件的 `replicatedOnLanding` 是显式的，判据会读它，读的人不必猜。
 * 这也让"哪天真去补行 / 计数"变成一次**登记处 + 渲染 + 判据**的三处改动，
 * 而不是某天有人顺手在 `AppWindow.tsx` 里画三行静态名字（那正是 §2 的形状）。
 *
 * ⚠️ **分区标题与占位符的词条 key 不在这里**：它们的登记处是
 * `app-shell-shape.ts` 的 `SHELL_PANEL_SECTIONS`（复刻件从它渲染，
 * `mockup-shell-shape.spec.tsx` §4 与 `ProjectsPanel.tsx` 源码对账）。
 * 在这边再抄一份就是**第二份定义** —— 那正是本仓库反复吃过的漂移来源。
 */

/** 真实现一行里的一个部件。 */
export interface OrganizerRowPart {
  /** 部件名（报告里用）。 */
  readonly id: 'leading' | 'name' | 'count' | 'extra' | 'remove';
  /**
   * 判据锚点：这一段必须在共享 `OrganizerList.tsx` 的源码里出现。
   *
   * 🔴 它是**源码文本**而不是"渲染结果"——落地页的判据不 import `@heyta/ui`
   * （那正是 §9.1 要避免的字节代价）。所以这里钉的是"真实现还有这个部件"，
   * 与渲染对不对由 web / mobile 两侧的判据负责。
   */
  readonly anchor: string;
  /** 落地页复刻件画了它没有。 */
  readonly replicatedOnLanding: boolean;
}

/**
 * 真实现一行有**五个**部件。顺序即渲染顺序（左 → 右）。
 *
 * 🔴 `count` 那条的锚点钉的是"只在 > 0 时出现"这个**判据**，不是"有个计数位"
 * —— 迁移前 web 常驻 `0`、共享层改成非零才画，这条差别对复刻件无所谓
 * （它不画行），但对读这份登记的人是一个必须看见的事实。
 */
export const ORGANIZER_ROW_PARTS: readonly OrganizerRowPart[] = [
  {
    id: 'leading',
    anchor: 'renderLeading',
    replicatedOnLanding: false,
  },
  {
    id: 'name',
    anchor: "text['row-title']",
    replicatedOnLanding: false,
  },
  {
    id: 'count',
    anchor: 'count <= 0',
    replicatedOnLanding: false,
  },
  {
    id: 'extra',
    anchor: 'renderItemExtra',
    replicatedOnLanding: false,
  },
  {
    id: 'remove',
    anchor: 'labels.removeLabel',
    replicatedOnLanding: false,
  },
];

/**
 * 落地页侧栏在那两块里**真的画了**的东西。
 *
 * 现在画三件：分区标题、静态样例行、以及标题级创建入口。行上的计数、取色、删除
 * 一件没画 —— 与上面 `replicatedOnLanding` 全为 `false` 是同一件事的两种说法。
 */
export const MOCK_PROJECT_DRAWN_PARTS: readonly string[] = ['heading', 'rows', 'create-trigger'];
