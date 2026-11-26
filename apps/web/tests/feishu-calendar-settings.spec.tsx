/**
 * 设置 ·「飞书日程」连接卡片的最小渲染判据
 * ========================================
 *
 * 挡的是"连接配置搬进设置后丢了入口"：这一节必须给出 Hub 地址（url）、
 * 访问令牌（**password**，不能明文）与「保存并同步」。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { FeishuCalendarSettingsCard } = await import(
  '../src/features/settings/FeishuCalendarSettingsCard.js'
);
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let caseSeq = 0;

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
  caseSeq += 1;
  await initOpLog(`feishu-calendar-settings-${String(caseSeq)}`);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('FeishuCalendarSettingsCard', () => {
  it('在设置里给出 Hub 地址 + password 令牌 + 保存并同步', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <LocaleHost>
          <FeishuCalendarSettingsCard />
        </LocaleHost>,
      );
    });
    await flush();

    await waitFor('[data-testid="feishu-calendar-settings"]');
    const baseUrl = container.querySelector<HTMLInputElement>('[data-testid="feishu-hub-base-url"]');
    const token = container.querySelector<HTMLInputElement>('[data-testid="feishu-hub-token"]');
    expect(baseUrl?.type).toBe('url');
    // 🔴 token 必须是 password：这一格在屏幕上就是凭据。
    expect(token?.type).toBe('password');
    expect(container.querySelector('[data-testid="feishu-hub-connect"]')?.textContent).toContain(
      '保存并同步',
    );
  });
});
