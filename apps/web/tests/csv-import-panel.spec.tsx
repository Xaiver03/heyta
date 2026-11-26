/**
 * CSV / Todoist 导入面板渲染判据
 * ==============================
 * 必须有来源选择（通用 CSV / Todoist）与文件选择入口。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { CsvImportPanel } = await import('../src/features/settings/CsvImportPanel.js');
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

beforeEach(async () => {
  __resetOpLogForTests();
  localStorage.clear();
  seq += 1;
  await initOpLog(`csv-import-panel-${String(seq)}`);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('CsvImportPanel', () => {
  it('渲染来源选择与文件入口', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <LocaleHost>
          <CsvImportPanel />
        </LocaleHost>,
      );
    });
    await flush();

    expect(container.querySelector('[data-testid="csv-import-panel"]')).not.toBeNull();
    const select = container.querySelector<HTMLSelectElement>('[data-testid="csv-import-kind"]');
    expect(select?.value).toBe('generic');
    expect(select?.options).toHaveLength(2);
    expect(container.querySelector('[data-testid="csv-import-file"]')).not.toBeNull();
  });
});
