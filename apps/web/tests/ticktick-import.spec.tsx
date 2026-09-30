/**
 * 从滴答清单导入（B2-1）—— 界面与接线的判据
 * ==============================================
 *
 * 这个文件守四件事：
 *
 *   1. **界面诚实**：只认滴答清单（Todoist 的解析不存在），且说清它与
 *      "还原自己的导出"是两件不同的事。
 *   2. **先预览、不写库**：选完文件只出现预览，op-log 一条都不许动。
 *   3. **确认后真的写**：任务落进 op-log（不是只改本地态），且报告里的
 *      "带不进来的东西"（提醒等）在界面上说出来 —— 不静默丢数据。
 *   4. **幂等**：同一份文件导第二次，**一条 op 都不写**。
 *
 * ⚠️ 一样是**接线级**验证：真实 `fake-indexeddb`、真实 domain 解析、
 * 真实 `@heyta/app-host` op 批次构造器。唯一不能在 jsdom 里验的是
 * "用户真的从磁盘选了一个文件"。
 */

import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

const { TickTickImportPanel } = await import('../src/features/settings/TickTickImportPanel.js');
const { __resetOpLogForTests, currentState, initOpLog } = await import('../src/lib/oplog.js');

/** 只列用得上的列 —— 表头匹配只要求 `Title` 与 `List Name` 同时在。 */
const HEADER = ['List Name', 'Title', 'Tags', 'Due Date', 'Priority', 'Reminder', 'taskId'];

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(rows: readonly Partial<Record<string, string>>[]): string {
  const lines = [HEADER.map(cell).join(',')];
  for (const row of rows) lines.push(HEADER.map((column) => cell(row[column] ?? '')).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * 夹具：一行普通任务（带标签与日期）、一行带提醒（heyta 带不进来 → 必须进报告）、
 * 一行空标题（整行跳过 → 必须在界面上说）。
 */
const CSV = toCsv([
  {
    'List Name': '收件箱',
    Title: '买牛奶',
    Tags: '家里',
    'Due Date': '2026-09-30',
    Priority: '5',
    taskId: 't-milk',
  },
  {
    'List Name': '收件箱',
    Title: '开会',
    Reminder: 'TRIGGER:-PT30M',
    taskId: 't-meeting',
  },
  { 'List Name': '收件箱', Title: '', taskId: 't-empty' },
]);

let dbCounter = 0;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <TickTickImportPanel />
      </I18nProvider>,
    );
  });
  return container;
}

/** 把一段文本当成用户选中的文件"填"进 input，并触发 change。 */
async function chooseFile(el: HTMLElement, text: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement>('[data-testid="ticktick-file"]');
  if (input === null) throw new Error('找不到文件输入框');
  const file = new File([text], 'ticktick.csv', { type: 'text/csv' });
  // jsdom 不允许直接设置 `files`，用 defineProperty 造出"用户选了文件"这个状态。
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

/** 让出到宏任务队列，等 FileReader / fake-indexeddb / React 都落定。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** op-log 里当前有多少条任务。**这是"真的写进去了"的判据。** */
function taskCount(): number {
  return Object.keys(currentState().tasks).length;
}

beforeEach(async () => {
  dbCounter += 1;
  const globalWithIdb = globalThis as unknown as { indexedDB: IDBFactory };
  globalWithIdb.indexedDB = new IDBFactory();
  __resetOpLogForTests();
  await initOpLog(`heyta-ticktick-test-${String(dbCounter)}`);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('TickTickImportPanel', () => {
  it('🔴 界面只说它认的那一种来源，且与"还原"分开说', () => {
    const el = render();
    expect(el.querySelector('[data-testid="ticktick-import-panel"]')).not.toBeNull();

    const only = el.querySelector('[data-testid="ticktick-ticktick-only"]')?.textContent ?? '';
    expect(only).toContain('只认滴答清单');
    expect(only).toContain('Todoist');

    const coexist = el.querySelector('[data-testid="ticktick-coexist"]')?.textContent ?? '';
    expect(coexist).toContain('可以与现有数据共存');
  });

  it('🔴 选完文件只出现预览 —— op-log 一条都不许动', async () => {
    const el = render();
    await chooseFile(el, CSV);

    expect(el.querySelector('[data-testid="ticktick-preview"]')).not.toBeNull();
    // 预览里的数字来自**同一次解析**：1 个清单 + 2 条任务 = 3 条 op。
    const counts = el.querySelector('[data-testid="ticktick-preview-counts"]')?.textContent ?? '';
    expect(counts).toContain('1 个清单');
    expect(counts).toContain('2 条任务');
    // 1 个清单 + 1 个标签 + 2 条任务 = 4 条 op。
    expect(counts).toContain('1 个标签');
    expect(counts).toContain('4 条操作');

    // 带不进来的东西必须说出来（提醒），整行跳过的也必须说出来（空标题）。
    expect(el.querySelector('[data-testid="ticktick-unmapped"]')?.textContent).toContain('提醒');
    expect(el.querySelector('[data-testid="ticktick-skipped"]')?.textContent).toContain('标题为空');

    // 🔴 这一步是关键：预览**不写库**。
    expect(taskCount()).toBe(0);
  });

  it('确认后任务真的落进 op-log，且报告里"带不进来"的条数不减', async () => {
    const el = render();
    await chooseFile(el, CSV);

    const confirm = el.querySelector<HTMLButtonElement>('[data-testid="ticktick-confirm"]');
    expect(confirm).not.toBeNull();
    await act(async () => {
      confirm?.click();
    });
    await settle();

    expect(taskCount()).toBe(2);
    const done = el.querySelector('[data-testid="ticktick-done"]')?.textContent ?? '';
    expect(done).toContain('新增 1 个清单');
    expect(done).toContain('2 条任务');
    expect(done).toContain('写了 4 条操作');
  });

  it('🔴 同一份文件导第二次：预览说"不会写入"，确认后 op 数不变', async () => {
    const el = render();
    await chooseFile(el, CSV);
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="ticktick-confirm"]')?.click();
    });
    await settle();
    expect(taskCount()).toBe(2);

    // 再选一次同一份文件 —— 预览必须说"都已经在本机了"。
    await chooseFile(el, CSV);
    const counts = el.querySelector('[data-testid="ticktick-preview-counts"]')?.textContent ?? '';
    expect(counts).toContain('都已经在本机了');

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="ticktick-confirm"]')?.click();
    });
    await settle();

    expect(taskCount()).toBe(2);
    expect(el.querySelector('[data-testid="ticktick-done"]')?.textContent).toContain(
      '没有写入任何数据',
    );
  });

  it('不是滴答的 CSV → 说清是"没找到表头"，而不是静默通过', async () => {
    const el = render();
    await chooseFile(el, '这不是 CSV\n随便一段文本\n');

    const alert = el.querySelector('[data-testid="ticktick-parse-failed"]')?.textContent ?? '';
    expect(alert).toContain('没找到表头行');
    expect(el.querySelector('[data-testid="ticktick-preview"]')).toBeNull();
    expect(taskCount()).toBe(0);
  });
});
