/**
 * 导出面板
 * ==========
 *
 * 这个文件守三件事：
 *
 *   1. **入口真的在设置页上** —— 在此之前全仓没有任何用户可见的导出入口，
 *      而 README 与订阅提示都已向用户承诺"能导出"。承诺必须有对应的界面。
 *   2. **诚实的边界**：这一轮不做导入，界面必须说清"不能导回来"，
 *      否则用户会把它当还原点用 —— 那等于没有备份。
 *   3. **按钮真的干了事**：点击 → 构造文档 → 交给浏览器下载。
 *
 * ⚠️ **真实的浏览器下载本身没有被自动化验证**（`<a download>` 是浏览器行为，
 * jsdom 里没有"下载"这件事）。这里用 spy 钉住的是"我们确实调用了下载接口、
 * 且传进去的是正确的 Blob 内容"——它证明接线没断，不等于文件真的落到了磁盘上。
 */

import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import { OpType } from '@heyta/sync-core';

const { ExportPanel } = await import('../src/features/settings/ExportPanel.js');
const { tasksMarkdownCopy } = await import('../src/features/settings/export-copy.js');
const { __resetOpLogForTests, dispatchIntent, initOpLog } =
  await import('../src/lib/oplog.js');

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

/** jsdom 的 `Blob` 没有 `.text()`，用 `FileReader` 读。 */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

let dbCounter = 0;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(locale?: 'zh-CN' | 'en'): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const panel = <ExportPanel />;
  act(() => {
    root?.render(locale === undefined ? panel : <I18nProvider locale={locale}>{panel}</I18nProvider>);
  });
  return container;
}

beforeEach(async () => {
  dbCounter += 1;
  const globalWithIdb = globalThis as unknown as { indexedDB: IDBFactory };
  globalWithIdb.indexedDB = new IDBFactory();
  __resetOpLogForTests();
  await initOpLog(`heyta-export-test-${String(dbCounter)}`);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
});

describe('ExportPanel', () => {
  it('设置页上有导出入口，且明说不能导回来（中文）', () => {
    const el = render();
    expect(el.querySelector('[data-testid="export-panel"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="export-json"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="export-markdown"]')).not.toBeNull();

    const text = el.textContent ?? '';
    expect(text).toContain('导出数据');
    expect(text).toContain('下载 JSON');
    expect(text).toContain('下载任务清单');

    // 🔴 诚实条款：这一轮不做导入，必须说清楚。
    const honest = el.querySelector('[data-testid="export-not-restore-point"]')?.textContent ?? '';
    expect(honest).toContain('不能导回来');
  });

  it('英文界面下词条真的翻了，且不露中文', () => {
    const el = render('en');
    const text = el.textContent ?? '';
    expect(text).toContain('Export data');
    expect(text).toContain('Download JSON');
    expect(text).not.toMatch(CJK);
  });

  it('点击 JSON 按钮：构造导出文档并交给浏览器下载', async () => {
    await dispatchIntent({
      entityType: 'TASK',
      entityId: 'task-1',
      opType: OpType.Create,
      payload: { title: '会被导出的任务' },
    });

    const createObjectURL = vi.fn((_blob: Blob) => 'blob:heyta-test');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const el = render();
    const button = el.querySelector<HTMLButtonElement>('[data-testid="export-json"]');
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
      // `run()` 会先 await 存储读取（fake-indexeddb 在宏任务里决议），
      // 所以这里必须让出到宏任务队列，否则断言会跑在下载之前。
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    // 下载接口被调用，且传进去的是一份 JSON Blob。
    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0];
    if (blob === undefined) throw new Error('createObjectURL 没有被调用');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/json');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:heyta-test');

    const doc = JSON.parse(await readBlob(blob)) as {
      formatVersion: number;
      entities: Record<string, unknown[]>;
      counts: { totalEntities: number };
    };
    expect(doc.formatVersion).toBeGreaterThan(0);
    expect(doc.entities['TASK']).toHaveLength(1);
    expect(doc.counts.totalEntities).toBe(1);

    // 导出之后界面展示可核对的计数（"导全了"不能只靠信）。
    expect(el.querySelector('[data-testid="export-counts"]')?.textContent).toContain('1');
  });
});

describe('tasksMarkdownCopy', () => {
  it('表头与页脚来自词条表，不是硬编码', () => {
    // 直接读词条表（不经 React），确认取到的是真词条。
    const copy = tasksMarkdownCopy((key) => key);
    expect(copy.heading).toBe('web.export.markdown.heading');
    expect(copy.columns.title).toBe('web.export.markdown.colTitle');
    expect(copy.footer).toBe('web.export.markdown.footer');
  });
});
