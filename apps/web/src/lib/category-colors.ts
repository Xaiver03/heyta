/**
 * 分类色槽位 → 设计 token（Web 壳）
 * ==================================
 *
 * 🔴 **取值不在这个文件里** —— 它们来自 `@heyta/design-system` 的
 * `CATEGORY_SLOT_TOKEN_BY_SLOT`（设计系统是分类色的唯一点）。
 * 这里只做两件 Web 特有的事：
 *
 *   1. 把 token 名包成 `var(--ht-color-…)` 字符串（RN 不需要这一步）；
 *   2. 用一条 `satisfies Record<CategorySlot, TokenName>` 钉住**本端与领域层的契约**。
 *
 * 为什么不让调用方拼字符串（`cssVar(\`color.category-${slot}\`)`）：
 * 那个写法在**编译期什么都不会查**，而 `cssVar` 的运行时兜底会抛错 ——
 * 于是症状是"整块界面白屏"，触发条件是"某个槽位号传进来"。
 * 类型能拦的东西不要让运行时兜。
 *
 * ⚠️ 颜色**只编码身份，不编码好坏**：槽位号是我们给的，含义是用户赋的。
 * 这个文件里永远不该出现 `danger` / `warning` 之类的名字
 * （见 `docs/plans/activity-categories-and-colors.md` §2）。
 */

import {
  CATEGORY_SLOT_TOKEN_BY_SLOT,
  UNSET_CATEGORY_TOKEN,
  cssVar,
  type TokenName,
} from '@heyta/design-system';
import type { CategorySlot } from '@heyta/domain';

/**
 * 槽位号 → token 名。
 *
 * 这条 `satisfies` 就是本端的契约：`CATEGORY_SLOTS` 增删一个槽位、
 * 或设计系统改了某个槽位的取值，这里会在**编译期**给出结论 ——
 * 而不是在界面上少一块颜色、或者多出一块没人认得的颜色。
 */
const SLOT_TOKENS = CATEGORY_SLOT_TOKEN_BY_SLOT satisfies Record<CategorySlot, TokenName>;

/** 槽位号 → `var(--ht-color-category-N)`。 */
export function categorySlotColor(slot: CategorySlot): string {
  return cssVar(SLOT_TOKENS[slot]);
}

/**
 * 没设过色的行用什么？
 *
 * 🔴 **这个选择本身在 `UNSET_CATEGORY_TOKEN` 里单点定义**（理由是"不能借用分类色，
 * 否则'没设过色'看起来像用户选过的某个类别"），这里只负责把它包成 CSS 变量。
 */
export function unsetSlotColor(): string {
  return cssVar(UNSET_CATEGORY_TOKEN);
}

/**
 * 槽位号在界面上的**文字**（用户看到的是这个，颜色只是加速器）。
 *
 * 「不许只用颜色表达信息」是设计系统硬规则，而分类恰恰是最容易违反它的地方：
 * 8 个色块对色觉障碍用户可能只是深浅不同的灰。
 * 所以每个色块里都画着它的编号，行首永远有名字。
 */
export function slotLabel(slot: CategorySlot): string {
  return String(slot);
}
