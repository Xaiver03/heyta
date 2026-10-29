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

describe('关闭策略表：可延后的意思表示层', () => {
  /*
   * 这一档是为"隐私单独同意 / 条款再确认"这两层新加的（全局 UX 线 P6 的最后一格）。
   * 它存在的**唯一理由**是背景点击与 Esc 的差别：
   *   · 误点遮罩是**无意**动作 ⇒ 不许把一次法律表态推掉（deny）；
   *   · 按 Esc / 点那枚写着「以后再说」的 × 是**有意**动作 ⇒ 允许退出，
   *     且退出**不记成同意**（闸门保持关闭，下一次要出门的动作会再问）。
   * 所以它既不是 `modal-readonly`（那一档背景也算退出），也不是
   * `modal-forced-read`（那一档三条通道全 deny、不给 ×，等于逼用户当场表态）。
   */
  it('背景 deny、Esc 与返回键 dismiss、给 ×（三件事必须同时成立）', () => {
    const policy = closePolicyOf('modal-deferrable');
    expect(policy.scrim, '可延后层的背景点击必须不响应').toBe('deny');
    expect(policy.escape, 'Esc 必须能延后（它是有意动作）').toBe('dismiss');
    expect(policy.systemBack, '系统返回键必须能延后').toBe('dismiss');
    expect(policy.explicitCloseButton, '必须有一枚具名出口（「以后再说」）').toBe(true);
    expect(policy.autoDismiss, '这一类绝不能自动消失').toBe(false);
  });

  it('🔴 它必须与左右两档都不同形（同形就等于这一档不存在）', () => {
    const mine = closePolicyOf('modal-deferrable');
    expect(mine, '与只读层同形 ⇒ 不必新增这一档').not.toEqual(closePolicyOf('modal-readonly'));
    expect(mine, '与强制阅读同形 ⇒ 这一档没有把"延后"和"必须表态"分开').not.toEqual(
      closePolicyOf('modal-forced-read'),
    );
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
