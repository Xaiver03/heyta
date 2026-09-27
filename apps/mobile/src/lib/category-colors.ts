/**
 * 色槽 → 颜色的映射（移动壳）
 * ==============================
 *
 * 🔴 **取值不在这个文件里** —— 两类映射都来自 `@heyta/design-system`：
 * `CATEGORY_SLOT_TOKEN_BY_SLOT`（分类色槽）与 `HEAT_TOKENS`（强度色阶）。
 *
 * Web 端的对应物是 `apps/web/src/lib/category-colors.ts`，它返回**CSS 变量字符串**
 * （`var(--ht-color-category-3)`）。移动端没有 CSS 变量 —— 它从主题 context 里
 * 取**已经解析好的取值**，所以这里的函数多收一个 `tokens` 参数。
 * 两端共享的是**取值**，不同的只是各自的渲染适配。
 *
 * ⚠️ 这个文件以前手抄了 8 个槽位值 + 5 个 heat 值。那种写法有一个**不会失败的失败**：
 * 设计系统改掉一个槽位取值后，Web 从常量派生、跟着变了；移动端手抄、**静默保持旧色**；
 * 而没有任何测试会红。现在只剩下面两条 `satisfies`，它们钉的是
 * **本端与领域层 / 原生 token 表的契约**，取值则来自同一个单点。
 *
 * ⚠️ 没有"未设色"的槽位进来：调用方用 `undefined` 表达它，颜色取
 * `UNSET_CATEGORY_TOKEN`（中性灰，**刻意不属于那 8 个槽位** ——
 * 让"没设色"看起来像第 9 种颜色，用户会以为那是可以选的）。
 */

import {
  CATEGORY_SLOT_TOKEN_BY_SLOT,
  HEAT_TOKENS,
  UNSET_CATEGORY_TOKEN,
  type HeytaNativeTokens,
} from '@heyta/design-system';
import type { CategorySlot } from '@heyta/domain';

/**
 * 槽位号 → 原生 token 名。
 *
 * ⚠️ 必须是 `satisfies` 而不是 `: Record<…, keyof HeytaNativeTokens>`：
 * token 表里既有颜色（`string`）也有间距、圆角（`number`），
 * 写成类型标注会让 `CATEGORY_SLOT_TOKEN_BY_SLOT` 的字面量 key 被**拓宽**，
 * `tokens[宽泛的 key]` 于是变成 `string | number`，喂给收 `string` 的
 * `backgroundColor` 就是编译错误。`satisfies` 校验合法性但**保留字面量类型**。
 */
const SLOT_TOKEN = CATEGORY_SLOT_TOKEN_BY_SLOT satisfies Record<
  CategorySlot,
  keyof HeytaNativeTokens
>;

/** 取色。`tokens` 来自 `useTokens()`（已按当前主题解析，暗色也在内）。 */
export function slotColor(slot: CategorySlot, tokens: HeytaNativeTokens): string {
  return tokens[SLOT_TOKEN[slot]];
}

/** 未设色那一行的颜色：中性灰，不参与 8 槽色板。 */
export function unsetColor(tokens: HeytaNativeTokens): string {
  return tokens[UNSET_CATEGORY_TOKEN];
}

/** 强度档位 → 颜色。0 = 这周没记录，用中性的 `heat-0`（不是"没有颜色"）。 */
export function heatColor(level: 0 | 1 | 2 | 3 | 4, tokens: HeytaNativeTokens): string {
  return tokens[HEAT_TOKENS[level]];
}
