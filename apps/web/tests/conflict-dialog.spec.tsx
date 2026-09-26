/**
 * 冲突解决界面测试
 * ==================
 *
 * E2E 覆盖的是 `resolveConflict` 这个 API 的行为；这里覆盖的是**界面本身**：
 * 双方内容有没有真的渲染出来、两个按钮有没有接对方向。
 *
 * 🔴 为什么这两件事必须分开测：
 * 一个"能解决冲突"的 API 配一个渲染不出双方内容的界面，等于没解决问题 ——
 * 用户看不见两边分别是什么，就没法选。API 层的绿灯说明不了界面可用。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConflictDialog } from '../src/features/sync/ConflictDialog.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { summarizeConflictPayload, type ConflictInfo } from '@heyta/sync-client';

function makeConflict(): ConflictInfo {
  return {
    id: 'op-a',
    entityType: 'TASK',
    entityId: 't1',
    reason: 'Concurrent modification detected for TASK:t1',
    local: {
      opId: 'op-a',
      clientId: 'device-a',
      timestamp: 1_700_000_000_000,
      opType: 'UPD',
      payload: { title: '本机的标题' },
    },
    remote: {
      opId: 'op-b',
      clientId: 'device-b',
      timestamp: 1_700_000_100_000,
      opType: 'UPD',
      payload: { title: '其他设备的标题' },
    },
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ConflictDialog />);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
  useSyncStore.setState({ status: { kind: 'idle' }, conflictDialogOpen: false });
});

describe('冲突载荷摘要：判断在 sync-client，措辞在界面', () => {
  it('优先取可读标题字段（用户自己的字，不翻译）', () => {
    expect(summarizeConflictPayload({ title: '写周报' })).toEqual({ kind: 'text', text: '写周报' });
    expect(summarizeConflictPayload({ name: '项目 A' })).toEqual({ kind: 'text', text: '项目 A' });
  });

  it('🔴 没有标题时只报"有多少个字段"，字段名本身不进界面', () => {
    const summary = summarizeConflictPayload({ completedAt: 123, dueDate: '2026-03-02' });
    expect(summary.kind).toBe('fields');
    if (summary.kind === 'fields') expect(summary.fields).toHaveLength(2);
    // 界面只显示数量 —— 下面那条渲染断言钉住字段名绝不出现。
  });

  it('空载荷是 `empty`，不是「一个空对象」', () => {
    expect(summarizeConflictPayload(null)).toEqual({ kind: 'empty' });
    expect(summarizeConflictPayload({})).toEqual({ kind: 'empty' });
  });
});

describe('ConflictDialog', () => {
  it('没有冲突时不渲染任何东西', () => {
    const el = render();
    expect(el.textContent).toBe('');
  });

  it('有冲突但用户没打开对话框时也不渲染', () => {
    useSyncStore.setState({
      status: { kind: 'conflict', conflicts: [makeConflict()] },
      conflictDialogOpen: false,
    });
    const el = render();
    expect(el.textContent).toBe('');
  });

  it('🔴 必须**同时**渲染出双方的载荷内容', () => {
    useSyncStore.setState({
      status: { kind: 'conflict', conflicts: [makeConflict()] },
      conflictDialogOpen: true,
    });
    const el = render();

    // 这是这个界面存在的全部理由：用户得看见两边分别是什么才能选
    expect(el.textContent).toContain('本机的标题');
    expect(el.textContent).toContain('其他设备的标题');

    // 两侧的标签也要在，否则用户分不清哪个是哪台
    expect(el.textContent).toContain('本机');
    expect(el.textContent).toContain('其他设备');
  });

  it('有可访问的对话框语义', () => {
    useSyncStore.setState({
      status: { kind: 'conflict', conflicts: [makeConflict()] },
      conflictDialogOpen: true,
    });
    const el = render();
    const dialog = el.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    // 标题要能被读屏软件关联上
    const labelledBy = dialog!.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(el.querySelector(`#${labelledBy!}`)).not.toBeNull();
  });

  it('🔴 两个按钮接到相反的方向（接错方向 = 用户选了 A 却保留 B）', () => {
    const resolveConflict = vi.fn().mockResolvedValue({ kind: 'synced', at: 1 });
    useSyncStore.setState({
      status: { kind: 'conflict', conflicts: [makeConflict()] },
      conflictDialogOpen: true,
      resolveConflict,
    });
    const el = render();

    const buttons = [...el.querySelectorAll('button')].filter((b) =>
      b.textContent?.includes('保留这一版'),
    );
    expect(buttons).toHaveLength(2);

    // 第一个是本机，第二个是其他设备（与渲染顺序一致）
    act(() => {
      buttons[0]!.click();
    });
    expect(resolveConflict).toHaveBeenCalledWith(expect.anything(), 'keep-local');

    act(() => {
      buttons[1]!.click();
    });
    expect(resolveConflict).toHaveBeenCalledWith(expect.anything(), 'keep-remote');
  });

  it('取不到对端版本时明确说明，而不是留白', () => {
    const conflict = makeConflict();
    useSyncStore.setState({
      status: {
        kind: 'conflict',
        conflicts: [{ ...conflict, remote: undefined }],
      },
      conflictDialogOpen: true,
    });
    const el = render();

    // 留白会让人以为"对端什么都没写"，从而做出相反的判断
    expect(el.textContent).toContain('取不到这一侧的版本');
    const buttons = [...el.querySelectorAll('button')].filter((b) =>
      b.textContent?.includes('保留这一版'),
    );
    // 取不到的那一侧按钮必须是禁用的 —— 不能让人点一个必然失败的动作
    expect(buttons.filter((b) => b.hasAttribute('disabled'))).toHaveLength(1);
  });

  it('关闭对话框**不清掉冲突状态**（否则问题从"没法解决"变成"看不见了"）', () => {
    useSyncStore.setState({
      status: { kind: 'conflict', conflicts: [makeConflict()] },
      conflictDialogOpen: true,
    });
    const el = render();

    const closeBtn = el.querySelector('[aria-label="稍后再处理"]');
    expect(closeBtn).not.toBeNull();
    act(() => {
      (closeBtn as HTMLButtonElement).click();
    });

    // 对话框关了，但冲突本身还在 —— SyncBar 仍能提示并再次打开
    expect(useSyncStore.getState().conflictDialogOpen).toBe(false);
    expect(useSyncStore.getState().status.kind).toBe('conflict');
  });

  it('🔴 结构化载荷只显示字段数量，绝不泄漏内部字段名', () => {
    const base = makeConflict();
    const remoteSide = base.remote;
    if (remoteSide === undefined) throw new Error('fixture 必须带 remote');
    useSyncStore.setState({
      status: {
        kind: 'conflict',
        conflicts: [
          {
            ...base,
            local: { ...base.local, payload: { completedAt: 123, dueDate: '2026-03-02' } },
            remote: { ...remoteSide, payload: { completedAt: 999 } },
          },
        ],
      },
      conflictDialogOpen: true,
    });
    const el = render();

    expect(el.textContent).toContain('2 个字段有改动');
    expect(el.textContent).toContain('1 个字段有改动');
    // `completedAt` / `dueDate` 是内部标识符，出现在用户可见文案里正是要修的泄漏。
    expect(el.textContent).not.toContain('completedAt');
    expect(el.textContent).not.toContain('dueDate');
  });
});
