/**
 * 习惯热力图复刻件的**形状登记处**（纯数据，不 import React）
 * ==========================================================
 *
 * 复现对象：`packages/ui/src/habits/HabitBoard.tsx` 的热力图那一段
 * （M3 第七刀起，真实现是 **RN 原语自绘**，不再是 `react-activity-calendar`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（与 `quadrant-shape.ts` / `app-shell-shape.ts` 同一理由）
 *
 * `docs/research/dida-view-unification.md` §9.1 是**永久判决**：
 * `apps/landing/src/mockup/**` 静态 import `@heyta/ui` 会让首屏
 * **+61.9 kB gzip（+31%）**。替代约束是「**纯数据登记处 + 会红判据**」——
 * 本文件是登记处，`tests/mockup-habit-shape.spec.tsx` 是会红判据。
 *
 * 没有登记处时，"5 档强度 + 一个少/多图例"会在 JSX 里被手抄成
 * **四段散落的类名**（`mk-heat__cell--1..4` + 一个基础格），
 * 而任何一处漏掉/重复都**不会报错** —— 图例会变成 4 格或 6 格，
 * 看起来仍然"像一个图例"。这类漂移 `showcase-fidelity-audit.md` §2
 * 记过一次（五项同时漂，无人发现）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这里是**示意**，不是 90 天读数
 *
 * `MOCK_HABIT_HEAT_WEEKS = 26`：营销页的静态插图刻意比真实现的 90 天窗口
 * （`HABIT_HEATMAP_DAYS`）长，图案是**固定种子**生成的假数据。
 * 两者不同**不是漂移** —— 复刻件从不声称自己是"最近 90 天"的读数，
 * 硬对齐只会让插图变难看。判据里对此有显式说明（不许把它当缺口来"修"）。
 */

import type { MessageKey } from '@heyta/i18n/provider';

/** 复刻件热力图的列数（周）。**示意图案**，见文件头。 */
export const MOCK_HABIT_HEAT_WEEKS = 26;

/**
 * 强度档位（0 = 没记录 … 4 = 最多）。**顺序即图例顺序**。
 *
 * 🔴 显式数组而不是 `[0,1,2,3,4]` 散在 JSX 里：图例的格数由此推导，
 * 少一档/多一档会让判据红，而不是悄悄画成 4 格或 6 格。
 */
export const MOCK_HABIT_HEAT_LEVELS = [0, 1, 2, 3, 4] as const;

export type MockHabitHeatLevel = (typeof MOCK_HABIT_HEAT_LEVELS)[number];

/** 格子的基础类名（`mockup.css` 里定义；0 档只有它）。 */
export const MOCK_HABIT_HEAT_CELL_CLASS = 'mk-heat__cell';

/**
 * 档位 → 格子类名。
 *
 * ⚠️ 与真实现的 `heatmapLevelToken(level)` **同构**（那里返回 `color.heat-N`，
 * 这里返回 `mk-heat__cell--N`），但两者不是同一个东西：
 * 真实现产出的是 **token 名**（同一个组件四个端都能用），
 * 复刻件产出的是 **CSS 类名**（只有浏览器里的营销页用）。
 * 对应关系由判据钉住：类名里那个 `N` 必须命中 `mockup.css` 的
 * `--ht-color-heat-N` 规则。
 */
export function mockHeatCellClass(level: MockHabitHeatLevel): string {
  return level === 0
    ? MOCK_HABIT_HEAT_CELL_CLASS
    : `${MOCK_HABIT_HEAT_CELL_CLASS} ${MOCK_HABIT_HEAT_CELL_CLASS}--${String(level)}`;
}

/** 图例两端的词条 key（**不是文案**：模块级拿不到 `t`）。 */
export const MOCK_HABIT_KEYS: { readonly less: MessageKey; readonly more: MessageKey } = {
  less: 'landing.mock.heat.less',
  more: 'landing.mock.heat.more',
};
