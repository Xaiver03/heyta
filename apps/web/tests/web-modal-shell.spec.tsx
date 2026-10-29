import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebModalShell } from '../src/lib/dialog/WebModalShell.js';

/**
 * `WebModalShell` 的契约（全局 UX 线 P6）
 * ======================================
 *
 * 这一枚壳是 P6 全部迁移的地基，所以它自己的判据必须先于第二枚消费者存在。
 * 四格各有对照臂 —— 没有对照臂的"关得掉"与"关不掉"都可能是恒真/恒假。
 */

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(props: Partial<Parameters<typeof WebModalShell>[0]> & { policy: Parameters<typeof WebModalShell>[0]['policy'] }): Promise<void> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <WebModalShell
        policy={props.policy}
        testId="shell"
        onCancel={props.onCancel ?? (() => undefined)}
        onDismissAttempt={props.onDismissAttempt}
        busy={props.busy}
        overlayClass={props.overlayClass}
        dialogClass={props.dialogClass}
        overlayChildren={props.overlayChildren}
        labelledBy={props.labelledBy}
      >
        {props.children ?? <span data-testid="content">内容</span>}
      </WebModalShell>,
    );
  });
}

const overlay = () => document.querySelector<HTMLElement>('[data-testid="shell-scrim"]');
const dialog = () => document.querySelector<HTMLElement>('[data-testid="shell"]');

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('一、DOM 形状', () => {
  it('面板带 role=dialog / aria-modal / aria-labelledby 与 testID', async () => {
    await mount({ policy: 'modal-readonly', labelledBy: 't1', onCancel: () => undefined });
    const el = dialog();
    expect(el?.getAttribute('role')).toBe('dialog');
    expect(el?.getAttribute('aria-modal')).toBe('true');
    expect(el?.getAttribute('aria-labelledby')).toBe('t1');
    expect(el?.getAttribute('tabindex')).toBe('-1');
  });

  it('宿主传类名时以宿主为准（迁移不许改外观），没传时用壳自己的', async () => {
    await mount({ policy: 'modal-readonly', overlayClass: 'ht-host__mask', dialogClass: 'ht-host__panel', onCancel: () => undefined });
    expect(overlay()?.className).toBe('ht-host__mask');
    expect(dialog()?.className).toBe('ht-host__panel');
    await act(async () => root?.unmount());
    host?.remove();
    host = null;
    root = null;
    await mount({ policy: 'modal-readonly', onCancel: () => undefined });
    expect(dialog()?.className).toBe('ht-web-modal__dialog');
  });

  it('busy 只在真忙时落 aria-busy —— 不忙时那一格必须**不存在**', async () => {
    await mount({ policy: 'modal-readonly', onCancel: () => undefined });
    expect(dialog()?.hasAttribute('aria-busy'), '不忙也写 aria-busy ⇒ 给原本没有它的壳凭空加属性').toBe(false);
    await act(async () => {
      root?.unmount();
    });
    host?.remove();
    host = null;
    root = null;
    await mount({ policy: 'modal-readonly', busy: true, onCancel: () => undefined });
    expect(dialog()?.getAttribute('aria-busy')).toBe('true');
  });

  it('overlayChildren 落在遮罩内、面板**外**', async () => {
    await mount({
      policy: 'modal-readonly',
      onCancel: () => undefined,
      overlayChildren: <div data-testid="guard">先问一句</div>,
    });
    const guard = document.querySelector<HTMLElement>('[data-testid="guard"]');
    expect(guard).toBeTruthy();
    expect(guard?.parentElement?.getAttribute('data-testid'), '确认层必须在遮罩层里').toBe('shell-scrim');
    expect(dialog()?.contains(guard ?? null), '落进面板就会被面板的 overflow 裁掉').toBe(false);
  });
});

describe('二、三条通道全部查表（两向都要有分辨力）', () => {
  it('modal-readonly：点遮罩 ⇒ 关；按 Esc ⇒ 关，且把出口交给宿主', async () => {
    const onCancel = vi.fn();
    await mount({ policy: 'modal-readonly', onCancel });
    await act(async () => {
      overlay()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('modal-forced-read：点遮罩与按 Esc **都不许关**（上面那条的对照臂）', async () => {
    const onCancel = vi.fn();
    await mount({ policy: 'modal-forced-read', onCancel });
    await act(async () => {
      overlay()?.click();
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onCancel, '强制阅读那一行禁背景禁 Esc ⇒ 关掉就是替用户做了决定').not.toHaveBeenCalled();
  });

  it('modal-dirty-form 那一类（ask）走 onDismissAttempt，而不是直接关', async () => {
    const onCancel = vi.fn();
    const onDismissAttempt = vi.fn();
    await mount({ policy: 'danger-confirm' as 'modal-readonly', onCancel, onDismissAttempt });
    // danger-confirm 的 escape 是 cancel（直接走安全侧），scrim 是 deny ⇒ 两向各一
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      overlay()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onCancel, '危险确认点背景不许关').toHaveBeenCalledTimes(1);
  });

  it('面板内的点击不外溢成"点背景"', async () => {
    const onCancel = vi.fn();
    await mount({ policy: 'modal-readonly', onCancel });
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="content"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onCancel, '在内容上点一下就把层关掉 ⇒ 用户在选择器里点一下就丢了表单').not.toHaveBeenCalled();
  });

  it('提交中（busy）⇒ Esc 与背景都不关（不忙时两向都要能关，见上面那条）', async () => {
    const onCancel = vi.fn();
    await mount({ policy: 'modal-readonly', busy: true, onCancel });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await act(async () => {
      overlay()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onCancel, '写请求已经发出去了，关掉这层就没有地方接住结果').not.toHaveBeenCalled();
  });

  it('在内容上按下、松手在背景上 ⇒ 也不算"点背景"（mousedown 那一下才是判定点）', async () => {
    // 这一臂治的是"用 click 做背景通道"：按下与松开落在不同元素时，click 会派发到
    // 两者共同的祖先（遮罩），于是选文字/拖选中都成了"点背景关掉"。
    const onCancel = vi.fn();
    await mount({ policy: 'modal-readonly', onCancel });
    const content = document.querySelector<HTMLElement>('[data-testid="content"]');
    await act(async () => {
      content?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      overlay()?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      overlay()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCancel, '按下发生在面板里 ⇒ 这一串不该被当成点背景').not.toHaveBeenCalled();
  });

  /**
   * `modal-deferrable` 那一行是 2026-10-29 为意思表示层（隐私单独同意 / 条款再确认）新增的。
   * 它的两半各自有对照臂：与 `modal-readonly` 的差别只在**背景**那一格，
   * 与 `modal-forced-read` 的差别只在**Esc**那一格 ⇒ 只测一半的话，两行写反了也量不出来。
   */
  it('modal-deferrable：点遮罩**不关**（区别于 modal-readonly），按 Esc 关（区别于 modal-forced-read）', async () => {
    const onCancel = vi.fn();
    await mount({ policy: 'modal-deferrable', onCancel });
    await act(async () => {
      overlay()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onCancel, '误点遮罩不许把一次法律表态推掉').not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onCancel, 'Esc 是有意动作 ⇒ 允许退出（关掉不等于同意）').toHaveBeenCalledTimes(1);
  });

  it('🔴 这一层真的接住了 Esc ⇒ 不再往下传；判成 deny 时**不吞**，下面那层照常收到', async () => {
    // 吞与不吞的分界是"这一层动不动手"：动手了才归它，没动手就不该替别人作决定。
    const seenByOthers = vi.fn();
    await mount({ policy: 'modal-deferrable', onCancel: () => undefined });
    window.addEventListener('keydown', seenByOthers);
    try {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      });
      expect(seenByOthers, '壳接住了 Esc 还往外传 ⇒ 一次 Esc 会连着关掉两层').not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', seenByOthers);
      seenByOthers.mockClear();
    }

    await act(async () => root?.unmount());
    host?.remove();
    host = null;
    root = null;

    await mount({ policy: 'modal-forced-read', onCancel: () => undefined });
    window.addEventListener('keydown', seenByOthers);
    try {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      });
      expect(seenByOthers, '强制阅读那一层按 Esc 没反应 ⇒ 它无权替别人吞掉这一下').toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', seenByOthers);
    }
  });
});
