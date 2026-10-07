import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyState } from '@heyta/op-log';

import { App } from '../src/App.js';
import { privacyConsentActions } from '../src/features/privacy/consent-gate.js';
import { useTaskStore, initOpLog } from '../src/features/tasks/store.js';
import { __resetOpLogForTests } from '../src/lib/oplog.js';
import { LocaleHost } from '../src/lib/locale-host.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  localStorage.clear();
  privacyConsentActions.accept();
  __resetOpLogForTests();
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' }, ready: false });
  await initOpLog(`bulk-repeat-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('批量完成的重复任务保护', () => {
  it('混选重复任务时禁用批量完成并解释逐条完成规则', async () => {
    await act(async () => {
      await useTaskStore.getState().addTask('普通任务');
      await useTaskStore.getState().addTask('重复任务');
    });
    const repeatedId = Object.values(useTaskStore.getState().entities.tasks).find(
      (task) => task.title === '重复任务',
    )?.id;
    const normalId = Object.values(useTaskStore.getState().entities.tasks).find(
      (task) => task.title === '普通任务',
    )?.id;
    expect(repeatedId).toBeDefined();
    expect(normalId).toBeDefined();
    await act(async () => {
      await useTaskStore.getState().setRepeat(repeatedId!, 'FREQ=DAILY');
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <LocaleHost>
          <App />
        </LocaleHost>,
      );
    });
    await flush();

    const toolbar = container.querySelector('[data-testid="bulk-toolbar"]')!;
    (toolbar.querySelector('button') as HTMLButtonElement).click();
    await flush();
    (container.querySelector(`[data-testid="bulk-select-${repeatedId}"]`) as HTMLElement).click();
    (container.querySelector(`[data-testid="bulk-select-${normalId}"]`) as HTMLElement).click();
    await flush();

    const complete = container.querySelector<HTMLButtonElement>('[data-testid="bulk-complete"]');
    expect(complete?.disabled).toBe(true);
    expect(container.querySelector('[data-testid="bulk-repeat-warning"]')?.textContent).toContain(
      '重复任务，请逐条完成',
    );
    expect(useTaskStore.getState().entities.tasks[normalId!]?.completedAt).toBeUndefined();
    expect(useTaskStore.getState().entities.tasks[repeatedId!]?.completedAt).toBeUndefined();
  });
});
