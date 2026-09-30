/**
 * 任务的重复规则（B2-3 的 Web 入口 + 自定义 RRULE）
 * =====================================================
 *
 * 🔴 这个文件钉的是一处**两端不一致**：移动端的任务详情早就能设重复，
 * 而 Web 一个入口都没有 —— 同一个用户在手机上设的规则，到 Web 上连"看得见"
 * 都做不到。本刀补 web 入口 + **移动端也还没有的**自定义 RRULE。
 *
 * 要保证的五件事，缺一件这个功能就是假的：
 *   1. **真的写进 op-log**（不是只改本地 store —— 那样刷新就没了、也同步不出去）；
 *   2. **预设走 app-host 的规则串**（"每天" = `FREQ=DAILY`，不在界面里手拼）；
 *   3. **非法自定义规则就地报错，且一条 op 都不写**（不靠一次失败来发现串不合法）；
 *   4. **合法自定义规则真的写进去**；
 *   5. **不是预设的规则要看得见** —— 否则面板看上去像"这条任务不重复"，
 *      用户一点「每天」就把另一台设备设的规则悄悄换掉了。
 *
 * 用的是**真的 op-log 与真的 store**（`fake-indexeddb`），不是 mock：
 * 第 1 条只有真的落盘才验得了。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyState } from '@heyta/op-log';
import { I18nProvider } from '@heyta/i18n';
import { IndexedDbAdapter, IndexedDbOpLogStore } from '@heyta/storage';
import type { Operation } from '@heyta/sync-core';

import { App } from '../src/App.js';
import { LocaleHost } from '../src/lib/locale-host.js';
import { __resetOpLogForTests, initOpLog, useTaskStore } from '../src/features/tasks/store.js';

const { TaskRepeat } = await import('../src/features/tasks/TaskRepeat.js');

let dbName: string;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

/**
 * 最近一次由界面触发的写入。
 *
 * 🔴 **必须攥住这个 promise 并 await 它。** `dispatchIntent` 是
 * "await 引擎 → notify()"，而 `notify()` 会去读引擎；如果写入还在飞的时候
 * 下一条用例的 `beforeEach` 把引擎重置了，`notify()` 就会抛
 * "op-log 引擎尚未初始化" —— 一条与断言无关的 Unhandled Rejection。
 * `act()` 只管 React 的更新，不会去等一个被 `void` 丢掉的 IndexedDB 写入。
 */
let pendingWrite: Promise<void> | undefined;

async function allOps(): Promise<Operation<string>[]> {
  const db = new IndexedDbAdapter(dbName);
  await db.init();
  const store = new IndexedDbOpLogStore<Operation<string>>(db);
  const rows = await store.getAllOps();
  db.close();
  return rows.map((r) => r.op);
}

beforeEach(async () => {
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof IDBKeyRange;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;

  dbName = `repeat-test-${Math.random().toString(36).slice(2)}`;
  __resetOpLogForTests();
  useTaskStore.setState({
    entities: emptyState(),
    filter: { kind: 'all' },
    now: Date.now(),
    ready: false,
  });
  await initOpLog(dbName);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

/** 建一条任务，返回它的 id。 */
async function seedTask(title: string): Promise<string> {
  await useTaskStore.getState().addTask(title);
  const tasks = Object.values(useTaskStore.getState().entities.tasks).filter(
    (task) => task.deletedAt === undefined && task.title === title,
  );
  expect(tasks.length, '夹具任务没建出来').toBe(1);
  return tasks[0]!.id;
}

/** 挂一个**真的接在 store 上**的重复控件。 */
async function mountFor(taskId: string): Promise<HTMLDivElement> {
  act(() => {
    root?.unmount();
  });
  container?.remove();

  const task = useTaskStore.getState().entities.tasks[taskId];
  expect(task, '夹具任务不存在').toBeDefined();

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <TaskRepeat
          task={task!}
          now={useTaskStore.getState().now}
          onSetRepeat={(rule) => {
            // 攥住 promise（见 `pendingWrite` 的说明），不要 `void` 掉。
            pendingWrite = useTaskStore.getState().setRepeat(taskId, rule);
          }}
        />
      </I18nProvider>,
    );
  });
  return container;
}

/** 等界面触发的那次写入真的落盘，然后清掉句柄。 */
async function settleWrite(): Promise<void> {
  await act(async () => {
    await pendingWrite;
    pendingWrite = undefined;
  });
}

function ruleOf(taskId: string): string | undefined {
  return useTaskStore.getState().entities.tasks[taskId]?.repeatRule;
}

/** 打自定义 RRULE 并点「应用」。 */
async function applyCustom(el: HTMLElement, rule: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement>('[data-testid="task-repeat-custom-input"]');
  expect(input, '自定义规则输入框没渲染出来').not.toBeNull();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, rule);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    el.querySelector<HTMLButtonElement>('[data-testid="task-repeat-custom-apply"]')?.click();
  });
}

describe('预设：走 app-host 的规则串，不是界面手拼', () => {
  it('🔴 点「每天」→ op-log 里真的出现 FREQ=DAILY', async () => {
    const taskId = await seedTask('每天喝水');
    const el = await mountFor(taskId);

    const daily = el.querySelector<HTMLInputElement>(
      'input[aria-label="把任务「每天喝水」设为「每天」"]',
    );
    expect(daily, '找不到「每天」这一项').not.toBeNull();
    await act(async () => {
      daily!.click();
    });
    await settleWrite();

    expect(ruleOf(taskId)).toBe('FREQ=DAILY;INTERVAL=1');
    // 真的落进了 op-log（不是只改本地 store）。
    const ops = await allOps();
    expect(ops.some((op) => op.entityId === taskId)).toBe(true);
  });

  it('🔴 点「不重复」→ 规则被清掉（而不是留一个空串）', async () => {
    const taskId = await seedTask('临时任务');
    await useTaskStore.getState().setRepeat(taskId, 'FREQ=DAILY');
    const el = await mountFor(taskId);

    const none = el.querySelector<HTMLInputElement>(
      'input[aria-label="把任务「临时任务」设为「不重复」"]',
    );
    expect(none).not.toBeNull();
    await act(async () => {
      none!.click();
    });
    await settleWrite();

    expect(ruleOf(taskId)).toBeUndefined();
  });
});

describe('自定义 RRULE', () => {
  it('🔴 非法规则：就地报错，且**一条 op 都不写**', async () => {
    const taskId = await seedTask('手写规则');
    const el = await mountFor(taskId);
    const before = (await allOps()).length;

    await applyCustom(el, '随便写的');

    const error = el.querySelector('[data-testid="task-repeat-error"]');
    expect(error, '非法规则没有报错').not.toBeNull();
    expect(ruleOf(taskId)).toBeUndefined();
    expect((await allOps()).length).toBe(before);
  });

  it('空输入也报错，且不写', async () => {
    const taskId = await seedTask('空规则');
    const el = await mountFor(taskId);

    await applyCustom(el, '   ');

    expect(el.querySelector('[data-testid="task-repeat-error"]')).not.toBeNull();
    expect(ruleOf(taskId)).toBeUndefined();
  });

  it('🔴 合法规则：写进去，且与输入逐字相同', async () => {
    const taskId = await seedTask('双周会');
    const el = await mountFor(taskId);

    const rule = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO';
    await applyCustom(el, rule);
    await settleWrite();

    expect(ruleOf(taskId)).toBe(rule);
    expect(el.querySelector('[data-testid="task-repeat-error"]')).toBeNull();
  });

  it('🔴 不是预设的规则**看得见**（否则面板像"不重复"，一点就被覆盖）', async () => {
    const taskId = await seedTask('另一台设备设的');
    const el = await mountFor(taskId);

    const rule = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO';
    await applyCustom(el, rule);
    await settleWrite();

    // 🔴 **重新挂一次**：本组件拿的是 `task` prop，而测试里那个 prop 在挂载时
    // 就固定了（真 App 里行会随 store 重渲染）。重挂才等价于"用户下次看到它"。
    const after = await mountFor(taskId);
    const chip = after.querySelector('[data-testid="task-chip-repeat"]')?.textContent ?? '';
    expect(chip).toContain('自定义');
    expect(chip).toContain(rule);
  });
});

describe('🔴 接线：重复控件的入口真的挂在任务行上', () => {
  it('挂真 App，任务行上能找到重复入口', async () => {
    await seedTask('挂载检查');

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <LocaleHost>
          <App />
        </LocaleHost>,
      );
    });

    expect(
      container.querySelector('[data-testid="task-repeat-summary"]'),
      '任务行上缺少重复入口 —— B2-3 的 Web 入口没有调用点',
    ).not.toBeNull();
  });
});
