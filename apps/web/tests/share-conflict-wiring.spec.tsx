/**
 * 共享冲突进**现有**冲突界面（ADR-0067 裁决三落到 web 的那一步）
 * ==============================================================
 *
 * 裁决三的后半句是「同字段并发 ⇒ 恰好一枚具名冲突，且不静默丢内容」。
 * `packages/app-host/tests/share-conflicts.spec.tsx` 那批证的是**推导**：
 * 日志里确实能推出那一枚、裁完确实不再报。这一份证的是**用户够不够得着它**：
 *
 *   · 那一枚会不会渲染进界面（用的是既有 `ConflictResolutionView`，不新建视图）；
 *   · 点「保留这一版」时，走的是**共享通道**，而不是个人同步客户端；
 *   · 只有共享冲突、个人同步状态一切正常时，rail 那一枚**仍然是入口**。
 *
 * 🔴 为什么第三条必须单独钉：`syncStatusAffordances` 只看个人 `sync.status`，
 *    共享那批不在里面。不并这一源的话症状是"按钮 disabled，而它是打开对话框的
 *    唯一入口"——冲突推导得再对，用户也走不到它。那是把"必须可见"重新做成静默，
 *    也正是这一格要挡的东西。
 *
 * 🔴 为什么还要第五条（没有共享冲突时点击仍走同步）：只钉"有冲突时能点开对话框"，
 *    那么"永远把点击改成打开对话框"这一眼看上去能过的实现就混得过去。
 *    判据必须两头都有牙。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ShareConflict } from '@heyta/app-host';
import type { ConflictInfo } from '@heyta/sync-client';

/**
 * 这台浏览器那一份共享实例的替身（`use-share-conflicts.ts` 唯一的数据源）。
 * 只 mock 这一个模块，其余路径（hook、分流判定、对话框、rail）都走**真**代码。
 */
const holder = vi.hoisted(() => ({
  list: [] as ShareConflict[],
  conflicts: (): ShareConflict[] => [],
  resolveConflict: vi.fn(
    async (_conflict: ShareConflict, _choice: 'keep-local' | 'keep-remote') => undefined,
  ),
}));
holder.conflicts = () => holder.list;

vi.mock('../src/features/share/share-session.js', () => ({
  webShareSession: () => holder,
  ensureWebShareSession: async () => holder,
  armWebShareSession: () => undefined,
  resetWebShareSession: () => undefined,
}));

import { ConflictDialog } from '../src/features/sync/ConflictDialog.js';
import { SyncBar } from '../src/features/sync/SyncBar.js';
import { useSyncStore } from '../src/features/sync/store.js';

function shareConflict(): ShareConflict {
  return {
    id: 'share:s-1:TASK:t-1',
    shareId: 's-1',
    entityType: 'TASK',
    entityId: 't-1',
    reason: 'concurrent UPD on TASK:t-1 field title',
    errorCode: 'CONFLICT_CONCURRENT',
    fields: ['title'],
    local: {
      opId: 'op-a',
      clientId: 'device-A',
      timestamp: 1_700_000_000_000,
      opType: 'UPD',
      payload: { title: '我这边的标题' },
      clock: { 'device-A': 1 },
    },
    remote: {
      opId: 'op-b',
      clientId: 'device-B',
      timestamp: 1_700_000_000_500,
      opType: 'UPD',
      payload: { title: '搭档那边的标题' },
      clock: { 'device-B': 1 },
    },
  };
}

function personalConflict(id = 'op-p'): ConflictInfo {
  return {
    id,
    entityType: 'TASK',
    entityId: 't-9',
    reason: 'Concurrent modification detected for TASK:t-9',
    local: {
      opId: id,
      clientId: 'device-A',
      timestamp: 1_700_000_000_000,
      opType: 'UPD',
      payload: { title: '本机的标题' },
    },
    remote: {
      opId: `${id}-remote`,
      clientId: 'device-C',
      timestamp: 1_700_000_000_900,
      opType: 'UPD',
      payload: { title: '其他设备的标题' },
    },
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(node: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(node);
  });
  return container;
}

/** 一侧那一格里的「保留这一版」按钮（视图给每一侧都打了 `conflict-side-*`）。 */
function keepButtonsOf(el: HTMLElement, side: 'local' | 'remote'): HTMLButtonElement[] {
  return [...el.querySelectorAll<HTMLElement>(`[data-testid="conflict-side-${side}"]`)]
    .map((cell) => cell.querySelector('button'))
    .filter((b): b is HTMLButtonElement => b !== null);
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  holder.list = [];
  holder.resolveConflict.mockClear();
  vi.restoreAllMocks();
  useSyncStore.setState({
    status: { kind: 'idle' },
    conflictDialogOpen: false,
    baseUrl: '',
    token: undefined,
  });
});

describe('共享冲突进现有对话框', () => {
  it('🔴 个人状态 idle、只有一枚共享冲突时，它也渲染出来，且两侧内容都在', () => {
    holder.list = [shareConflict()];
    useSyncStore.setState({ conflictDialogOpen: true });
    const el = render(<ConflictDialog />);

    // 用的是既有视图（不新建第二套冲突界面）
    expect(el.querySelector('[data-testid="conflict-resolution"]')).not.toBeNull();
    // 这个界面存在的全部理由：用户得看见两边分别是什么才能选
    expect(el.textContent).toContain('我这边的标题');
    expect(el.textContent).toContain('搭档那边的标题');
    // 措辞来自既有词条（`common.conflict.reason.concurrent`），没有新建词表 ——
    // 共享那一批确实是"两台设备在对方不知情时都改了它"，各自属于一位成员。
    expect(el.textContent).toContain('两台设备在对方不知情的时候都改了它');
  });

  it('🔴 点「保留这一版」走共享通道，个人 resolveConflict 一次都不敲', async () => {
    holder.list = [shareConflict()];
    const personal = vi.fn(async () => ({ kind: 'synced' as const, at: 1 }));
    useSyncStore.setState({ conflictDialogOpen: true, resolveConflict: personal });
    const el = render(<ConflictDialog />);

    act(() => {
      keepButtonsOf(el, 'local')[0]!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(holder.resolveConflict).toHaveBeenCalledTimes(1);
    expect(holder.resolveConflict.mock.calls[0]![0]).toMatchObject({ shareId: 's-1' });
    expect(holder.resolveConflict.mock.calls[0]![1]).toBe('keep-local');
    expect(personal).not.toHaveBeenCalled();
  });

  it('两源混列时各走各的通道（分流判据互斥）', async () => {
    holder.list = [shareConflict()];
    const personal = vi.fn(async () => ({ kind: 'synced' as const, at: 1 }));
    useSyncStore.setState({
      status: { kind: 'conflict', conflicts: [personalConflict()] },
      conflictDialogOpen: true,
      resolveConflict: personal,
    });
    const el = render(<ConflictDialog />);

    // 个人那枚在前、共享那枚在后（与合并顺序一致）
    const locals = keepButtonsOf(el, 'local');
    expect(locals).toHaveLength(2);
    act(() => {
      locals[0]!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(personal).toHaveBeenCalledTimes(1);
    expect(holder.resolveConflict).not.toHaveBeenCalled();

    act(() => {
      locals[1]!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(personal).toHaveBeenCalledTimes(1);
    expect(holder.resolveConflict).toHaveBeenCalledTimes(1);
  });
});

describe('只有共享冲突时，rail 那一枚仍然是入口', () => {
  /** rail 要走到"要人来定"那一档，得先有登录上下文（否则点击语义是去登录）。 */
  function signIn(): void {
    useSyncStore.setState({ baseUrl: 'https://sync.test', token: 'tok' });
  }

  it('🔴 个人 idle + 一枚共享冲突 ⇒ 按钮可点、状态警示、点击 = 打开对话框而不是同步', () => {
    holder.list = [shareConflict()];
    signIn();
    const openConflictDialog = vi.fn();
    const syncNow = vi.fn(async () => ({ kind: 'synced' as const, at: 1 }));
    useSyncStore.setState({ openConflictDialog, syncNow });

    const el = render(<SyncBar />);
    const rail = el.querySelector<HTMLButtonElement>('[data-testid="sync-rail-action"]')!;

    expect(rail.disabled).toBe(false);
    expect(el.querySelector('[data-testid="sync-rail"]')?.getAttribute('data-severity')).toBe(
      'attention',
    );
    // 状态句要说得出这是**共享**的那批，否则只剩一个没有解释的警示点
    expect(el.textContent).toContain('共享清单有 1 处改动等你定');

    act(() => {
      rail.click();
    });
    expect(openConflictDialog).toHaveBeenCalledTimes(1);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('🔴 没有共享冲突时，同一枚点击照旧走同步（入口条件不是永远打开对话框）', () => {
    holder.list = [];
    signIn();
    const openConflictDialog = vi.fn();
    const syncNow = vi.fn(async () => ({ kind: 'synced' as const, at: 1 }));
    useSyncStore.setState({ openConflictDialog, syncNow });

    const el = render(<SyncBar />);
    act(() => {
      el.querySelector<HTMLButtonElement>('[data-testid="sync-rail-action"]')!.click();
    });
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(openConflictDialog).not.toHaveBeenCalled();
  });

  it('正在同步时不被共享冲突抢走反馈（progress 那一档优先）', () => {
    holder.list = [shareConflict()];
    signIn();
    useSyncStore.setState({ status: { kind: 'syncing', phase: 'upload' } });
    const el = render(<SyncBar />);
    expect(el.querySelector('[data-testid="sync-rail"]')?.getAttribute('data-severity')).toBe(
      'progress',
    );
    expect(el.textContent).not.toContain('共享清单有');
  });
});
