/**
 * 导入 / 还原面板
 * ==================
 *
 * 这个文件守三件事：
 *
 *   1. **界面诚实**：本轮只支持"还原到空库"，面板必须直说，
 *      并且给出"不会清空/覆盖现有数据"的承诺 —— 而不是一句万能的"导入"。
 *   2. **真的能还原**：选文件 → 读文本 → 写进本地 op-log → 状态变了，
 *      且**墓碑仍然是墓碑**（已删数据不许复活）。
 *   3. **目标非空时拒绝**：本机已有数据时必须拒绝，且一个字节都不写。
 *
 * ⚠️ 一样是**接线级**验证：真实 `fake-indexeddb`、真实 `@heyta/app-host` 还原路径。
 * 唯一不能在 jsdom 里验的是"用户真的从磁盘选了一个文件"。
 */

import {
  buildExportDocument,
  serializeExportDocument,
  type ExportDocument,
} from '@heyta/app-host';
import { IDBFactory } from 'fake-indexeddb';
import { emptyState, replayOperations } from '@heyta/op-log';
import { OpType, type Operation } from '@heyta/sync-core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

const { ImportPanel } = await import('../src/features/settings/ImportPanel.js');
const { __resetOpLogForTests, currentState, dispatchIntent, initOpLog } =
  await import('../src/lib/oplog.js');

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

let opCounter = 0;

/** 造一条合法 op。id / 时间 / 时钟都由计数器派生 —— 避免随机 id 造成 flaky。 */
function makeOp(input: {
  entityType: 'TASK' | 'PROJECT';
  entityId: string;
  opType?: OpType;
  payload?: unknown;
}): Operation<string> {
  opCounter += 1;
  const opType = input.opType ?? OpType.Create;
  return {
    id: `op-${String(opCounter).padStart(4, '0')}`,
    opType,
    actionType: `${opType}_${input.entityType}`,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: input.payload ?? {},
    // 导入的 op 带着**别的设备**的 clientId（这正是还原的真实形状）。
    clientId: 'device-a',
    vectorClock: { 'device-a': opCounter },
    timestamp: 2_000_000_000_000 + opCounter,
    schemaVersion: 1,
  };
}

/** 一份"有活着的、也有已删除的"完整导出。 */
function fixtureDocument(): ExportDocument {
  opCounter = 0;
  const ops = [
    makeOp({ entityType: 'TASK', entityId: 'task-alive', payload: { title: '活着的任务' } }),
    makeOp({ entityType: 'TASK', entityId: 'task-doomed', payload: { title: '会被删掉的任务' } }),
    makeOp({ entityType: 'TASK', entityId: 'task-doomed', opType: OpType.Delete }),
  ];
  return buildExportDocument({
    state: replayOperations(emptyState(), ops),
    ops,
    exportedAt: 2_000_000_000_000,
    host: 'test',
  });
}

let dbCounter = 0;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(locale?: 'zh-CN' | 'en'): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const panel = <ImportPanel />;
  act(() => {
    root?.render(
      locale === undefined ? panel : <I18nProvider locale={locale}>{panel}</I18nProvider>,
    );
  });
  return container;
}

/** 把一段文本当成用户选中的文件"填"进 input，并触发 change。 */
async function chooseFile(el: HTMLElement, text: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement>('[data-testid="import-file"]');
  if (input === null) throw new Error('找不到文件输入框');
  const file = new File([text], 'backup.json', { type: 'application/json' });
  // jsdom 不允许直接设置 `files`，用 defineProperty 造出"用户选了文件"这个状态。
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** 让出到宏任务队列，等 FileReader / fake-indexeddb / React 都落定。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(async () => {
  dbCounter += 1;
  const globalWithIdb = globalThis as unknown as { indexedDB: IDBFactory };
  globalWithIdb.indexedDB = new IDBFactory();
  __resetOpLogForTests();
  await initOpLog(`heyta-import-test-${String(dbCounter)}`);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('ImportPanel', () => {
  it('🔴 界面只说它支持的那一种模式：还原到空库、且不动现有数据', () => {
    const el = render();
    expect(el.querySelector('[data-testid="import-panel"]')).not.toBeNull();

    const emptyOnly = el.querySelector('[data-testid="import-empty-only"]')?.textContent ?? '';
    expect(emptyOnly).toContain('只支持还原到空库');
    expect(emptyOnly).toContain('不会清空或覆盖');

    // 第二条诚实条款：还原只作用在本机（导入的 op 服务端不会收）。
    const localOnly = el.querySelector('[data-testid="import-local-only"]')?.textContent ?? '';
    expect(localOnly).toContain('只作用在本机');

    // 还没选文件时不能点。
    expect(
      el.querySelector<HTMLButtonElement>('[data-testid="import-run"]')?.disabled,
    ).toBe(true);
  });

  it('英文界面下词条真的翻了，且不露中文', () => {
    const el = render('en');
    const text = el.textContent ?? '';
    expect(text).toContain('Import / restore');
    expect(text).toContain('Read and restore');
    expect(text).not.toMatch(CJK);
  });

  it('🔴 还原到空库：数据回来了，已删的那条仍然是墓碑（不复活）', async () => {
    const el = render();
    await chooseFile(el, serializeExportDocument(fixtureDocument()));

    const button = el.querySelector<HTMLButtonElement>('[data-testid="import-run"]');
    expect(button?.disabled).toBe(false);
    await act(async () => {
      button?.click();
      await settle();
    });

    const success = el.querySelector('[data-testid="import-success"]')?.textContent ?? '';
    expect(success).toContain('2'); // 2 条记录
    expect(success).toContain('1'); // 其中 1 条已删除

    const state = currentState();
    expect(state.tasks['task-alive']?.title).toBe('活着的任务');
    // 🔴 关键：墓碑活着回来了 —— `deletedAt` 在，且 ops 里的 DEL 被重放了。
    expect(state.tasks['task-doomed']?.deletedAt).toBeTypeOf('number');
  });

  it('🔴 本机已有数据时拒绝，且现有数据一个字节都没动', async () => {
    await dispatchIntent({
      entityType: 'TASK',
      entityId: 'mine',
      opType: OpType.Create,
      payload: { title: '本机原有的任务' },
    });
    const before = Object.keys(currentState().tasks);

    const el = render();
    await chooseFile(el, serializeExportDocument(fixtureDocument()));
    const button = el.querySelector<HTMLButtonElement>('[data-testid="import-run"]');
    await act(async () => {
      button?.click();
      await settle();
    });

    const refused = el.querySelector('[data-testid="import-refused"]')?.textContent ?? '';
    expect(refused).toContain('本机已经有数据');
    expect(refused).toContain('一个字节都没动');

    // 现有数据没被清空，也没被导入的东西污染。
    expect(Object.keys(currentState().tasks)).toEqual(before);
    expect(currentState().tasks['mine']?.title).toBe('本机原有的任务');
    expect(currentState().tasks['task-alive']).toBeUndefined();
  });

  it('不是 JSON 的文件被拒绝，且界面给出原因', async () => {
    const el = render();
    await chooseFile(el, '这不是 JSON');
    const button = el.querySelector<HTMLButtonElement>('[data-testid="import-run"]');
    await act(async () => {
      button?.click();
      await settle();
    });

    const refused = el.querySelector('[data-testid="import-refused"]')?.textContent ?? '';
    expect(refused).toContain('不是合法 JSON');
    expect(Object.keys(currentState().tasks)).toHaveLength(0);
  });
});
