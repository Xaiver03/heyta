/**
 * 设置 ·「日历订阅」卡片的渲染判据
 * ================================
 * 挡的是「订阅管理搬进设置后丢了入口」：必须有 ICS 链接输入（url）、名称输入、
 * 以及「添加订阅」按钮。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { CalendarSubscriptionsCard } = await import('../src/features/settings/CalendarSubscriptionsCard.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let seq = 0;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(selector: string): Promise<Element> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = container?.querySelector(selector);
    if (found !== null && found !== undefined) return found;
    await flush();
  }
  throw new Error(`等不到元素：${selector}`);
}

beforeEach(async () => {
  __resetOpLogForTests();
  localStorage.clear();
  seq += 1;
  await initOpLog(`calendar-subscriptions-settings-${String(seq)}`);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('CalendarSubscriptionsCard', () => {
  it('渲染 ICS 链接 + 名称 + 添加订阅', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <LocaleHost>
          <CalendarSubscriptionsCard />
        </LocaleHost>,
      );
    });
    await flush();

    await waitFor('[data-testid="calendar-subscriptions-settings"]');
    const url = container.querySelector<HTMLInputElement>('[data-testid="calendar-sub-url"]');
    const name = container.querySelector<HTMLInputElement>('[data-testid="calendar-sub-name"]');
    expect(url?.type).toBe('url');
    expect(name?.type).toBe('text');
    expect(container.querySelector('[data-testid="calendar-sub-add"]')?.textContent).toContain('添加订阅');
  });
});
