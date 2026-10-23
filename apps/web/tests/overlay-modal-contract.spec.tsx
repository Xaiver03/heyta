/**
 * 浮层原语的关闭契约（真 DOM 断言）
 * =================================
 *
 * 判据的正文在全局 Skill `overlay-feedback-patterns` →
 * `references/dismissal-and-timing.md` §1（矩阵与三条不变量）；
 * 表在代码里的唯一实现是 `packages/ui/src/overlay/dismissal.ts`，
 * 组件侧只问 `dismissActionFor`（不在组件里内联比较策略值）。
 *
 * 本用例证的不是"表写得对不对"（那由
 * `packages/ui/tests/overlay-dismissal-model.spec.ts` 钉），
 * 而是**原语真的按表接线** —— 危险确认关不掉、脏表单点背景先去问、
 * 强制阅读按 Esc 什么也不发生、重档的主按钮在逐字匹配前是禁用态。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 正/负**成对**写，因为"没调用"单独写会空转
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `expect(spy).not.toHaveBeenCalled()` 在"事件根本没送达"时**照样绿** ——
 * 那是一条永远不会红的判据（AGENTS §6 工作流第 2 条：新增门禁先确认它真会红）。
 * 所以每条负断言都配一条同通道的正断言作对照臂：
 *
 * · P1 只读模态点背景 → `onDismiss` **被调用** ⇒ 证明 jsdom 里这条按压通道是通的；
 * · N1 危险确认点背景 → 连这条通道**都不存在** ⇒ 有了 P1 才不是空转；
 * · P2 危险确认按 Esc → `onCancel` **被调用** ⇒ 证明 Esc 真能送达；
 * · N2 强制阅读按 Esc → 两个回调**都没被调用** ⇒ 有了 P2 才有效。
 *
 * 实测这条对账真有用：把 `dismissal.ts` 里 `danger-confirm` 的 scrim 从 `deny`
 * 改成 `dismiss`，N1 立刻红（而它单独写时永远绿）。
 *
 * ⚠️ jsdom 证不到的那一半写清楚：Tab 循环与焦点归还由 react-native-web 的
 * `ModalFocusTrap` 在真浏览器里做（`role="dialog"`、`aria-modal`、`aria-labelledby`
 * 在这里断言得到，Tab 出不出得去断言不到）—— 那一半归 `e2e/` 用真键盘验。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { DangerDialog, HeytaUiProvider, OverlayModal } from '@heyta/ui';
import type { ReactNode } from 'react';

/**
 * 🔴 卸载集中在 `afterEach`，不在各条用例里手写 `unmount()`。
 * 原先每条用例末尾自己卸载，一旦某条断言在卸载**之前**就失败，
 * 那一层的 portal 就留在 `document.body` 上 —— 于是后面每条用例都被同一条
 * "读不到 probe-scrim"的断言拖红：红是真红，理由却是错的。
 * 这种级联会让人开始怀疑红色本身。
 */
let live: { root: Root; container: HTMLDivElement } | null = null;

function mount(node: ReactNode): void {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  live = { root, container };
  act(() => {
    root.render(<HeytaUiProvider>{node}</HeytaUiProvider>);
  });
}

afterEach(() => {
  if (live !== null) {
    const { root, container } = live;
    act(() => {
      root.unmount();
    });
    container.remove();
    live = null;
  }
});

/**
 * 按一个元素。RNW 的 `Pressable` 走 pointer 事件，jsdom 里要按整串发才有响应；
 * **这条通道是否真的通，由 P1/P2 两条正断言自证**。
 */
function press(el: Element): void {
  const init = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerover', init));
  el.dispatchEvent(new PointerEvent('pointerdown', init));
  el.dispatchEvent(new PointerEvent('pointerup', init));
  el.dispatchEvent(new MouseEvent('click', init));
}

/** Esc：RNW 的 ModalContent 监听 **document 的 `keyup`**（`ModalContent.js:42`）。 */
function pressEscape(): void {
  const init = { bubbles: true, cancelable: true, key: 'Escape' };
  document.dispatchEvent(new KeyboardEvent('keydown', init));
  document.dispatchEvent(new KeyboardEvent('keyup', init));
}

function byTestId(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
}

describe('P1 对照臂：只读模态的点背景通道是通的', () => {
  it('点背景 → onDismiss 被调用一次', () => {
    const calls: string[] = [];
    mount(
      <OverlayModal
        labels={{ close: '关闭' }}
        onDismiss={() => calls.push('dismiss')}
        onDismissAttempt={(via) => calls.push(`attempt:${via}`)}
        overlay="modal-readonly"
        testID="probe"
        title="只读详情"
        visible
      >
        <p>内容</p>
      </OverlayModal>,
    );

    const scrim = byTestId('probe-scrim');
    expect(scrim).not.toBeNull();
    press(scrim!);
    // 🔴 这一条是整个文件的地基：它红了，所有"没被调用"的断言都不作数。
    expect(calls).toEqual(['dismiss']);
  });

  it('只读模态的语义齐备：role="dialog" + aria-modal + 标题被引用', () => {
    mount(
      <OverlayModal
        labels={{ close: '关闭' }}
        onDismiss={() => undefined}
        overlay="modal-readonly"
        testID="probe"
        title="只读详情"
        visible
      >
        <p>内容</p>
      </OverlayModal>,
    );
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    // 可访问名称：aria-labelledby 指的是标题那一枚 id（不是靠肉眼看到的字）。
    const labelledBy = dialog!.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('只读详情');
  });

  it('卸载后 portal 不残留（残留会让下一条用例读到上一条的层）', () => {
    mount(
      <OverlayModal
        labels={{ close: '关闭' }}
        onDismiss={() => undefined}
        overlay="modal-readonly"
        testID="probe"
        title="只读详情"
        visible
      >
        <p>内容</p>
      </OverlayModal>,
    );
    expect(byTestId('probe-panel')).not.toBeNull();
    const { root, container } = live!;
    act(() => {
      root.unmount();
    });
    container.remove();
    live = null;
    expect(byTestId('probe-panel')).toBeNull();
  });
});

describe('N1 危险确认：背景与 × 都不许是出口', () => {
  it('点背景这一条通道**根本不存在**（不是"点了没反应"）', () => {
    const calls: string[] = [];
    mount(
      <DangerDialog
        labels={{ cancel: '取消', confirm: '永久删除 12 条' }}
        onCancel={() => calls.push('cancel')}
        onConfirm={() => calls.push('confirm')}
        testID="probe"
        tier="alert"
        title="永久删除这 12 条凭证？"
        visible
      />,
    );

    // 遮罩带的是另一个 testID：可点击那一枚才叫 `…-scrim`。
    expect(byTestId('probe-scrim')).toBeNull();
    expect(calls).toEqual([]);
    // × 也不许出现：出口必须是具名动作。
    expect(byTestId('probe-close')).toBeNull();
    expect(document.body.textContent).toContain('永久删除这 12 条凭证？');
  });

  it('🔴 键盘顺序：取消在前、危险动作在后，且「取消」真的可点', () => {
    const calls: string[] = [];
    mount(
      <DangerDialog
        labels={{ cancel: '取消', confirm: '永久删除 12 条' }}
        onCancel={() => calls.push('cancel')}
        onConfirm={() => calls.push('confirm')}
        testID="probe"
        tier="alert"
        title="永久删除这 12 条凭证？"
        visible
      />,
    );
    const cancel = byTestId('probe-cancel');
    const confirm = byTestId('probe-confirm');
    expect(cancel).not.toBeNull();
    expect(confirm).not.toBeNull();
    // DOM 顺序决定 react-native-web 焦点陷阱的落点（ModalFocusTrap 聚焦第一个
    // 可聚焦后代）：顺序反了，症状就是"打开确认框直接回车 = 已删除"。
    expect(
      (cancel as Node).compareDocumentPosition(confirm as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    press(cancel!);
    expect(calls).toEqual(['cancel']);
  });
});

describe('P2 / N2 Esc 通道的归属', () => {
  it('P2 危险确认按 Esc → onCancel 被调用，且**只有**取消被调用', () => {
    const calls: string[] = [];
    mount(
      <DangerDialog
        labels={{ cancel: '取消', confirm: '永久删除 12 条' }}
        onCancel={() => calls.push('cancel')}
        onConfirm={() => calls.push('confirm')}
        testID="probe"
        tier="alert"
        title="永久删除这 12 条凭证？"
        visible
      />,
    );
    pressEscape();
    // 不变量一：Esc 永远落在安全那一边。出现 'confirm' 就是 Esc 绑到了主按钮。
    expect(calls).toEqual(['cancel']);
  });

  it('N2 强制阅读按 Esc → 两个回调都没被调用（P2 已证 Esc 送达得了）', () => {
    const calls: string[] = [];
    mount(
      <OverlayModal
        labels={{ close: '关闭' }}
        onDismiss={() => calls.push('dismiss')}
        onDismissAttempt={(via) => calls.push(`attempt:${via}`)}
        overlay="modal-forced-read"
        testID="probe"
        title="请阅读处理个人信息规则"
        visible
      >
        <p>正文</p>
      </OverlayModal>,
    );
    pressEscape();
    expect(calls).toEqual([]);
    // 强制阅读没有 ×：出口只有「同意 / 不同意」。
    expect(byTestId('probe-close')).toBeNull();
  });
});

describe('脏表单：点背景是「先去问」，不是直接丢', () => {
  it('scrim → onDismissAttempt("scrim")；Esc → onDismissAttempt("escape")；onDismiss 一次都不许', () => {
    const calls: string[] = [];
    mount(
      <OverlayModal
        labels={{ close: '关闭' }}
        onDismiss={() => calls.push('dismiss')}
        onDismissAttempt={(via) => calls.push(`attempt:${via}`)}
        overlay="modal-dirty-form"
        testID="probe"
        title="新建清单"
        visible
      >
        <p>填了一半</p>
      </OverlayModal>,
    );

    press(byTestId('probe-scrim')!);
    expect(calls).toEqual(['attempt:scrim']);

    pressEscape();
    expect(calls).toEqual(['attempt:scrim', 'attempt:escape']);
    // 🔴 `dismiss` 一次都不许出现：出现了就是"已填内容被静默丢弃"。
    expect(calls).not.toContain('dismiss');
  });

  it('宿主没给 onDismissAttempt 时按**不关**处理（安全侧默认）', () => {
    const calls: string[] = [];
    mount(
      <OverlayModal
        labels={{ close: '关闭' }}
        onDismiss={() => calls.push('dismiss')}
        overlay="modal-dirty-form"
        testID="probe"
        title="新建清单"
        visible
      >
        <p>填了一半</p>
      </OverlayModal>,
    );
    press(byTestId('probe-scrim')!);
    pressEscape();
    expect(calls).toEqual([]);
  });
});

describe('重档的输入名称闸门', () => {
  it('🔴 逐字匹配前主按钮一直禁用，按它也不许触发 onConfirm', () => {
    const calls: string[] = [];
    mount(
      <DangerDialog
        confirmPhrase="个人工作区"
        labels={{
          cancel: '取消',
          confirm: '永久注销这个账号',
          confirmPhrasePrompt: '逐字键入工作区名称',
          confirmPhraseField: '工作区名称',
        }}
        onCancel={() => calls.push('cancel')}
        onConfirm={() => calls.push('confirm')}
        testID="probe"
        tier="typed-alert"
        title="注销账号后无法找回任何数据？"
        visible
      />,
    );

    const confirm = byTestId('probe-confirm');
    expect(confirm).not.toBeNull();
    expect(confirm!.getAttribute('aria-disabled')).toBe('true');
    press(confirm!);
    expect(calls).toEqual([]);
    // 名称输入框在场，且它是这一档唯一能把主按钮解锁的通道。
    expect(byTestId('probe-phrase')).not.toBeNull();
  });

  it('busy 时主按钮禁用，且给出的是 loading 而不是假反馈', () => {
    const calls: string[] = [];
    mount(
      <DangerDialog
        busy
        labels={{ cancel: '取消', confirm: '永久删除 12 条' }}
        onCancel={() => calls.push('cancel')}
        onConfirm={() => calls.push('confirm')}
        testID="probe"
        tier="alert"
        title="永久删除这 12 条凭证？"
        visible
      />,
    );
    const confirm = byTestId('probe-confirm');
    press(confirm!);
    expect(calls).toEqual([]);
    expect(confirm!.getAttribute('aria-disabled')).toBe('true');
  });
});
