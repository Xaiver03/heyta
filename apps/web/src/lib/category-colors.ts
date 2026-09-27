/**
 * 分类色槽位 → 设计 token（Web 壳）
 * ==================================
 *
 * 🔴 这里是一张**穷尽映射**：`Record<CategorySlot, TokenName>`。
 * 少一个槽位会编译失败，多一个也会 —— 所以"加了 9 号色槽但界面不认"
 * 或"界面引用了一个不存在的 token"这两种漂移都不可能出现。
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

import { CATEGORY_SLOT_TOKENS, cssVar, type TokenName } from '@heyta/design-system';
import { CATEGORY_SLOTS, type CategorySlot } from '@heyta/domain';

/**
 * 槽位号 → token 名。
 *
 * 🔴 **从设计系统的共享常量派生，不手写第二份。** 这份映射有三处消费者
 * （Web 的 CSS 变量、移动端的原生 token、设计系统的对比度配对），
 * 手写三份 = 三份会漂移的名单；而"抽出了一个共享实现"不等于"重复被消除了"
 * —— 收尾动作是**删掉旧的那份**（AGENTS.md §3.5）。
 *
 * ⚠️ 数组是 1 起始的槽位顺序：`SLOT_TOKENS[1]` 对应数组第 0 项。
 */
const SLOT_TOKENS = CATEGORY_SLOT_TOKENS.reduce<Record<CategorySlot, TokenName>>(
  (acc, token, index) => {
    const slot = index + 1;
    if (!CATEGORY_SLOTS.includes(slot as CategorySlot)) {
      throw new Error(`[category-colors] 色槽 ${slot} 不在 CATEGORY_SLOTS 里：常量与领域层漂移了`);
    }
    acc[slot as CategorySlot] = token;
    return acc;
  },
  {} as Record<CategorySlot, TokenName>,
);

/** 槽位号 → `var(--ht-color-category-N)`。 */
export function categorySlotColor(slot: CategorySlot): string {
  return cssVar(SLOT_TOKENS[slot]);
}

/**
 * 没设过色的行用什么？
 *
 * 🔴 **不是**某个分类色，也不是"1 号的浅色" —— 那会让"没设过色"看起来
 * 像是用户选过的某个类别。用中性的 `foreground-muted`：
 * 它在两种主题下都读得出来，且**不属于调色板**。
 */
export function unsetSlotColor(): string {
  return cssVar('color.foreground-muted');
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
