/**
 * R7：设置 → 同步 的「我的数据到哪了」三行读数
 * ============================================
 *
 * 判据只看**界面上的字**，不看 store 里的字段：`pendingUpload` 存在但没人渲染，
 * 用户看到的就是"已同步"。三态（未读 / 0 / N）必须各自有各自的句子 ——
 * 把 `undefined` 和 `0` 压成同一句，等于在还没读到的时候说"全都传上去了"。
 *
 * 🔴 故障注入：把 `SyncSettingsPanel` 里那个三元表达式换成常量 `0`，
 * 「3 条待上传」那一条必须红。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { SignOutNotice } from '../src/features/settings/SignOutNotice.js';
import { SyncBar } from '../src/features/sync/SyncBar.js';
import { SyncSettingsPanel } from '../src/features/sync/SyncSettingsPanel.js';
import { useSyncStore } from '../src/features/sync/store.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  act(() => {
    useSyncStore.setState({
      baseUrl: 'https://sync.example.test',
      token: 'token',
      status: { kind: 'idle' },
      pendingUpload: undefined,
      lastSyncedAt: undefined,
      libraryOwnerConflict: undefined,
      syncNow: async () => ({ kind: 'idle' }),
      startRealtime: () => undefined,
    });
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(): void {
  act(() => {
    root.render(
      <I18nProvider locale="zh-CN">
        <SyncSettingsPanel />
      </I18nProvider>,
    );
  });
}

const textOf = (id: string): string =>
  container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

describe('R7 数据状态读数', () => {
  it('待上传 3 条 ⇒ 界面上出现数字 3（不是"已同步"）', () => {
    render();
    act(() => useSyncStore.setState({ pendingUpload: 3 }));
    expect(textOf('sync-pending-count')).toContain('3');
    expect(textOf('sync-pending-count')).toContain('没上传');
  });

  it('待上传 0 条与"还没读到"是两句不同的话', () => {
    render();
    act(() => useSyncStore.setState({ pendingUpload: 0 }));
    expect(textOf('sync-pending-count')).toContain('都已经上传');
    act(() => useSyncStore.setState({ pendingUpload: undefined }));
    expect(textOf('sync-pending-count')).toContain('正在读取');
  });

  it('上次同步：从没成功过与一个具体时刻是两句不同的话', () => {
    render();
    expect(textOf('sync-last-synced')).toContain('还没有成功同步过');
    act(() => useSyncStore.setState({ lastSyncedAt: Date.UTC(2026, 10, 6, 12, 0, 0) }));
    expect(textOf('sync-last-synced')).toContain('上次成功同步');
    expect(textOf('sync-last-synced')).not.toContain('还没有成功同步过');
  });

  it('rail 上也说得出「N 项还没上传」（读屏与 hover 标签同一句）', () => {
    act(() => {
      root.render(
        <I18nProvider locale="zh-CN">
          <SyncBar />
        </I18nProvider>,
      );
    });
    act(() => useSyncStore.setState({ pendingUpload: 3, status: { kind: 'offline', since: 1 } }));
    const action = container.querySelector('[data-testid="sync-rail-action"]');
    expect(action).not.toBeNull();
    // 离线与"有 3 条没上传"是两件事：只报前者的界面会让用户以为"等网络就好"。
    expect(action!.getAttribute('aria-label')).toContain('3 项还没上传');
    expect(container.querySelector('.ht-rail__sync__status')?.textContent ?? '').toContain('3 项还没上传');
  });

  it('🔴 归属冲突时给的是清除出口，不是同步状态句', () => {
    // 这条走的是全局那条提示（`SignOutNotice` 同址），不是同步面板里的一行字：
    // 归属不符是**阻断性**的，必须出现在主区顶部，而不是藏在设置里。
    act(() => {
      root.render(
        <I18nProvider locale="zh-CN">
          <SignOutNotice />
        </I18nProvider>,
      );
    });
    act(() => useSyncStore.setState({
      libraryOwnerConflict: { accountId: 'acct-a', serverOrigin: 'https://sync.example.test' },
    }));
    const notice = container.querySelector('[data-testid="library-owner-conflict"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain('acct-a');
    expect(container.querySelector('[data-testid="library-owner-clear"]')).not.toBeNull();
  });
});
