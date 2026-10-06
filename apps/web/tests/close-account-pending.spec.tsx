/**
 * 批次 E3 #73 —— Web 注销面板上那个**具体的数**（与移动端同一条计数通道）
 *
 * 判据只有一件事：那句"还有 N 条没同步出去"里的 N **必须是现读出来的**，
 * 而三种"读不到"（引擎没就绪、取数抛错、还没回来）都必须让**整句不进树**。
 * 这里刻意只 stub `oplog.ts` 那一层：面板到 `countPendingUpload()` 的接线是被测对象，
 * 而计数本身的语义由 `packages/app-host` 与 op-log 的测试钉。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { CloseAccountPanel } from '../src/features/settings/CloseAccountPanel.js';
import { useSyncStore } from '../src/features/sync/store.js';

const SERVER = 'https://sync.example.test';
const TOKEN = 'ui-token';

const eng = vi.hoisted(() => {
  const state = { ready: true, value: 0, fail: false };
  return {
    state,
    hasEngine: () => state.ready,
    requireEngine: () => ({
      countPendingUpload: () =>
        state.fail ? Promise.reject(new Error('读不到')) : Promise.resolve(state.value),
    }),
  };
});

vi.mock('../src/lib/oplog.js', () => ({
  hasEngine: eng.hasEngine,
  requireEngine: eng.requireEngine,
}));

let container: HTMLDivElement;
let root: Root;

async function renderPanel(): Promise<void> {
  await act(async () => {
    root.render(
      <I18nProvider locale="zh-CN">
        <CloseAccountPanel />
      </I18nProvider>,
    );
  });
  await act(async () => {});
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  eng.state.ready = true;
  eng.state.value = 0;
  eng.state.fail = false;
  useSyncStore.setState({ baseUrl: SERVER, token: TOKEN });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('Web 注销面板的未同步条数', () => {
  it('读到 3 条 ⇒ 句子里出现**这个数**，不是"可能有未同步数据"', async () => {
    eng.state.value = 3;
    await renderPanel();
    const line = container.querySelector('[data-testid="close-account-pending"]');
    expect(line, '有未同步数据时那句必须画出来').not.toBeNull();
    expect(line?.textContent).toContain('3');
  });

  it('读到 0 条 ⇒ 整句**不进树**（"还有 0 条"是一句假话）', async () => {
    eng.state.value = 0;
    await renderPanel();
    expect(container.querySelector('[data-testid="close-account-pending"]')).toBeNull();
  });

  it('取数抛错 ⇒ 整句不进树，且不落成一个 0', async () => {
    eng.state.fail = true;
    await renderPanel();
    expect(container.querySelector('[data-testid="close-account-pending"]')).toBeNull();
    expect(container.textContent).not.toContain('0 条');
  });

  it('引擎还没就绪 ⇒ 整句不进树（不许拿 0 冒充"没有未同步数据"）', async () => {
    eng.state.ready = false;
    await renderPanel();
    expect(container.querySelector('[data-testid="close-account-pending"]')).toBeNull();
  });
});
