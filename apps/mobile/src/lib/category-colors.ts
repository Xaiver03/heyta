/**
 * 色槽 → 颜色的映射（移动壳）
 * ==============================
 *
 * Web 端的对应物是 `apps/web/src/lib/category-colors.ts`，它返回**CSS 变量字符串**
 * （`var(--ht-color-category-3)`）。移动端没有 CSS 变量 —— 它从主题 context 里
 * 取**已经解析好的取值**，于是这里的映射是 色槽 → token 名。
 *
 * 🔴 两张映射表（Web 的 CSS 变量名 / 这里的 token 名）都必须与
 * `packages/design-system` 的 `CATEGORY_SLOT_TOKENS` 逐项一致，
 * 而**设计系统那边的测试已经在钉这件事**（`category-colors.spec.ts` 里
 * "registry 与常量逐项相同"那一条）。这里靠类型再钉一次：
 * `Record<CategorySlot, keyof HeytaNativeTokens>` 是穷尽的 —— 漏一个槽位、
 * 或写错一个 token 名，都是**编译期错误**，不是运行时的一块空白。
 *
 * ⚠️ 没有"未设色"的槽位进来：调用方用 `undefined` 表达它，颜色取
 * `color.foreground-muted`（中性灰，**刻意不属于那 8 个槽位** ——
 * 让"没设色"看起来像第 9 种颜色，用户会以为那是可以选的）。
 */

import type { HeytaNativeTokens } from '@heyta/design-system';
import type { CategorySlot } from '@heyta/domain';

/**
 * 槽位号 → 原生 token 名。穷尽 1–8，写错即编译期报错。
 *
 * ⚠️ 必须写成 `as const satisfies`（而不是 `: Record<…, keyof HeytaNativeTokens>`）：
 * token 表里既有颜色（`string`）也有间距、圆角（`number`），所以
 * `tokens[某个宽泛的 key]` 的类型是 `string | number`，喂给
 * `backgroundColor` 这种收 `string` 的地方就是编译错误。
 * `as const` 把取值钉成**字面量**，`satisfies` 仍然保证名字合法。
 */
export const SLOT_TOKEN = {
  1: 'color.category-1',
  2: 'color.category-2',
  3: 'color.category-3',
  4: 'color.category-4',
  5: 'color.category-5',
  6: 'color.category-6',
  7: 'color.category-7',
  8: 'color.category-8',
} as const satisfies Record<CategorySlot, keyof HeytaNativeTokens>;

/** 取色。`tokens` 来自 `useTokens()`（已按当前主题解析，暗色也在内）。 */
export function slotColor(slot: CategorySlot, tokens: HeytaNativeTokens): string {
  return tokens[SLOT_TOKEN[slot]];
}

/** 未设色那一行的颜色：中性灰，不参与 8 槽色板。 */
export function unsetColor(tokens: HeytaNativeTokens): string {
  return tokens['color.foreground-muted'];
}

/** 泳道格子的强度档位 → 原生 token 名（0 = 这周没记录，用中性的 heat-0）。 */
export const HEAT_TOKENS = [
  'color.heat-0',
  'color.heat-1',
  'color.heat-2',
  'color.heat-3',
  'color.heat-4',
] as const satisfies ReadonlyArray<keyof HeytaNativeTokens>;

export function heatColor(level: 0 | 1 | 2 | 3 | 4, tokens: HeytaNativeTokens): string {
  return tokens[HEAT_TOKENS[level]];
}