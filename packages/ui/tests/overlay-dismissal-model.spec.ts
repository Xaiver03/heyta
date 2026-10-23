/**
 * `closePolicyOf` 的语义钉子
 * ==========================
 *
 * 钉的是三条不能靠人记住的不变量（判据正文在全局 Skill
 * `overlay-feedback-patterns` → `references/dismissal-and-timing.md` §1）：
 *
 *   1. **本模型覆盖的每一类都不许自动消失** —— 它们全是第 3–5 级，
 *      自动消失等于"用户抬头时东西没了"；
 *   2. **危险确认与强制阅读不响应背景、不给 ×** —— 这两格的出口必须是具名动作；
 *   3. **`ask-discard` 不算可关闭** —— 原语只能判"能不能关"，
 *      "要不要先问一句"归宿主。读反了的形状是：填了一半的表单点背景就没了。
 *
 * 用例遍历 `CLOSED_OVERLAYS` 整份数组 ⇒ **加一个类别而忘了定策略，这里会红**，
 * 而不是让那一层静默吃到 `undefined`。
 */

import { describe, expect, it } from 'vitest';

import {
  CLOSED_OVERLAYS,
  closePolicyOf,
  dismissActionFor,
  hasExplicitClose,
  type DismissOutcome,
} from '../src/overlay/dismissal.js';

/** 类型系统写不出来的那个取值，运行时也必须不在读数里出现。 */
const OUTCOMES: readonly DismissOutcome[] = ['dismiss', 'cancel', 'ask-discard', 'deny'];

describe('关闭策略表：完整性', () => {
  it('每个类别都有一条完整策略（六个字段一个不缺）', () => {
    for (const overlay of CLOSED_OVERLAYS) {
      const policy = closePolicyOf(overlay);
      expect(policy, overlay).toBeDefined();
      expect(Object.keys(policy).sort()).toEqual([
        'autoDismiss',
        'escape',
        'explicitCloseButton',
        'scrim',
        'systemBack',
      ]);
    }
  });

  it('🔴 三条通道的取值只能是那四个 —— 表意"Esc 绑到主按钮"的取值不存在', () => {
    for (const overlay of CLOSED_OVERLAYS) {
      const policy = closePolicyOf(overlay);
      expect(OUTCOMES, `${overlay}.scrim`).toContain(policy.scrim);
      expect(OUTCOMES, `${overlay}.escape`).toContain(policy.escape);
      expect(OUTCOMES, `${overlay}.systemBack`).toContain(policy.systemBack);
    }
  });

  it('🔴 本模型覆盖的每一类一律不许自动消失', () => {
    for (const overlay of CLOSED_OVERLAYS) {
      expect(closePolicyOf(overlay).autoDismiss, overlay).toBe(false);
    }
  });
});

describe('关闭策略表：危险确认与强制阅读', () => {
  it('危险确认：禁背景、禁 ×、Esc 与返回键都落在「取消」', () => {
    const policy = closePolicyOf('danger-confirm');
    expect(policy.scrim).toBe('deny');
    expect(policy.escape).toBe('cancel');
    expect(policy.systemBack).toBe('cancel');
    expect(hasExplicitClose(policy)).toBe(false);
  });

  it('强制阅读：三条通道全 deny，且不给 ×（出口只有同意/不同意）', () => {
    const policy = closePolicyOf('modal-forced-read');
    expect(policy.scrim).toBe('deny');
    expect(policy.escape).toBe('deny');
    expect(policy.systemBack).toBe('deny');
    expect(hasExplicitClose(policy)).toBe(false);
    expect(dismissActionFor(policy, policy.escape)).toBe('none');
    expect(dismissActionFor(policy, policy.scrim)).toBe('none');
  });

  it('🔴 全表里没有任何一格的背景是「丢弃当前内容」以外的危险语义', () => {
    for (const overlay of CLOSED_OVERLAYS) {
      const { scrim } = closePolicyOf(overlay);
      // 背景要么是丢弃（只读层，无代价），要么是取消/先问/不响应。
      expect(['dismiss', 'cancel', 'ask-discard', 'deny'], overlay).toContain(scrim);
      // 而这两格绝不能是 dismiss。
      if (overlay === 'danger-confirm' || overlay === 'modal-forced-read') {
        expect(scrim, overlay).not.toBe('dismiss');
      }
    }
  });
});

describe('关闭策略表：三条通道问出来的是同一种答案', () => {
  it('ask-discard 的原语动作是**先去问**，不是直接关（宿主没给 onDismissAttempt 就什么都不做）', () => {
    const policy = closePolicyOf('modal-dirty-form');
    expect(policy.scrim).toBe('ask-discard');
    expect(dismissActionFor(policy, policy.scrim)).toBe('ask');
    expect(dismissActionFor(policy, policy.escape)).toBe('ask');
    expect(dismissActionFor(policy, policy.systemBack)).toBe('ask');
  });

  it('只读层与抽屉的背景是**直接关**（丢弃无代价）', () => {
    for (const overlay of ['modal-readonly', 'drawer', 'popover', 'menu', 'command'] as const) {
      const policy = closePolicyOf(overlay);
      expect(dismissActionFor(policy, policy.scrim), overlay).toBe('close');
    }
  });

  it('🔴 就地确认的背景是**取消**，而取消在动作上就等于关闭 —— 绝不能是"已执行"', () => {
    const policy = closePolicyOf('popconfirm');
    expect(policy.scrim).toBe('cancel');
    expect(dismissActionFor(policy, policy.scrim), 'popconfirm').toBe('close');
    // 危险确认的背景这一格根本没有这条通道。
    const danger = closePolicyOf('danger-confirm');
    expect(dismissActionFor(danger, danger.scrim)).toBe('none');
    // 而它的 Esc 有，且落在取消那一边。
    expect(dismissActionFor(danger, danger.escape)).toBe('close');
  });

  it('底部面板不接 Esc（关闭语言是把手/下滑），但接管系统返回', () => {
    const policy = closePolicyOf('bottom-sheet');
    expect(dismissActionFor(policy, policy.escape)).toBe('none');
    expect(dismissActionFor(policy, policy.systemBack)).toBe('close');
  });

  it('命令面板必须允许 Esc 直退', () => {
    const policy = closePolicyOf('command');
    expect(dismissActionFor(policy, policy.escape)).toBe('close');
  });
});
