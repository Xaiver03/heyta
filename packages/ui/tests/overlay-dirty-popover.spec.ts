/**
 * P1「脏表单关闭保护」的共享模型钉子
 * =================================
 *
 * 本仓的关闭策略表里原来只有**模态**那一档会先问「放弃修改？」
 * （`modal-dirty-form`），而**锚定层**那一档（`popover`）写的是三条通道全 `dismiss`。
 * 于是"填了一半的浮层点外面就没了"在模型层面**是合法的** —— 这不是某个页面写漏了，
 * 是表里少了一类。日历快速捕获那一格就是这么丢内容的（草稿住在组件本地
 * `useState`，卸载即丢：`packages/ui/src/capture/CaptureComposer.tsx`）。
 *
 * 🔴 这一档存在的唯一条件是**真的会丢**：判据不写"浮层要有确认"，
 * 写"有未保存输入的锚定层必须走 `popover-dirty-form`"。
 * 没有输入的锚定层仍然用 `popover`（三条通道全 `dismiss`）——
 * 下面那条对照用例就是钉住"新档没有把旧档稀释掉"。
 *
 * 细则见 `docs/plans/global-ux-system-remediation.md` §P1 与
 * `docs/agents/overlay-feedback.md`。
 */

import { describe, expect, it } from 'vitest';

import {
  CLOSED_OVERLAYS,
  closePolicyOf,
  dismissActionFor,
  hasExplicitClose,
} from '../src/overlay/dismissal.js';

describe('脏锚定层：表里有这一类，且三条通道都先问', () => {
  it('`popover-dirty-form` 已登记进类别清单（漏登记 ⇒ 这一层静默吃到 undefined）', () => {
    expect(CLOSED_OVERLAYS).toContain('popover-dirty-form');
  });

  it('scrim / Esc / 系统返回三条通道全部 `ask-discard`', () => {
    const policy = closePolicyOf('popover-dirty-form');
    expect(policy.scrim, '点背景不得静默丢弃未保存内容').toBe('ask-discard');
    expect(policy.escape, 'Esc 不得静默丢弃未保存内容').toBe('ask-discard');
    expect(policy.systemBack, '系统返回不得静默丢弃未保存内容').toBe('ask-discard');
  });

  it('不自消，且给得出显式出口（× 本身也走"先问"那一格）', () => {
    const policy = closePolicyOf('popover-dirty-form');
    expect(policy.autoDismiss).toBe(false);
    expect(hasExplicitClose(policy), '锚定层也要有关闭 affordance，否则键盘用户出不去').toBe(true);
  });

  it('原语把三条通道都判成 `ask`，而不是 `close`', () => {
    const policy = closePolicyOf('popover-dirty-form');
    for (const outcome of [policy.scrim, policy.escape, policy.systemBack] as const) {
      expect(dismissActionFor(policy, outcome)).toBe('ask');
    }
  });
});

describe('对照臂：没有未保存内容的锚定层没有被这一档稀释', () => {
  it('`popover` 仍然是三条通道全 `dismiss`', () => {
    const policy = closePolicyOf('popover');
    expect([policy.scrim, policy.escape, policy.systemBack]).toEqual([
      'dismiss',
      'dismiss',
      'dismiss',
    ]);
    expect(dismissActionFor(policy, policy.scrim)).toBe('close');
  });
});
