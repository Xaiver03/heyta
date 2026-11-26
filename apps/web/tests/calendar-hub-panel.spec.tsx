/**
 * 「飞书日程」面板的最小渲染判据（已配置 / 空态 / 标签）
 * ======================================================
 *
 * 这一条挡的是"入口过浅"与"功能在、入口不在"：
 *
 *   · **未连接时侧栏整块不渲染** —— 配置（Hub 地址 / 令牌）在「设置 → 数据与同步」，
 *     不该常驻在日历侧栏这一层。这里断言侧栏既没有面板也没有表单。
 *   · 已配置时画「今天 / 最近 7 天」与按天分组；一条日程都没有时是一句话。
 *   · 点一条才展开详情（时间 / 地点 / 描述 / 参会人 / 来源），标签勾选**真的落库**
 *     —— 而且它写的是 `CALENDAR_EVENT` 的 `tagIds`，不是别处。
 *
 * 🔴 挂的是**真面板 + 真 op-log**（indexeddb 后端，`tests/setup.ts` 提供），
 *    不是把 store 塞成假状态：`useHubConnection()` 走的是 `requireStore()`，
 *    假状态会让"凭据到底存没存进去"变成测一个假实现。
 */

import { OpType } from '@heyta/sync-core';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { CalendarHubPanel } = await import('../src/features/calendar/CalendarHubPanel.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, currentState, dispatchIntent, initOpLog } = await import(
  '../src/lib/oplog.js'
);
const { saveHubConnection } = await import('../src/features/calendar/hub-connection.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');
const { useProjectStore } = await import('../src/features/projects/store.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let caseSeq = 0;

/** 今天 09:00–10:00（本地时间，与面板的"今天"同一份）。 */
function todayAt(hour: number, minute = 0): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute).getTime();
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * 等到某个选择器出现。
 *
 * 🔴 `flush()` 只等一个宏任务；`useHubConnection()` 的 `loadHubConnection()` 要连读
 * 两个 META 键（IndexedDB 的异步不止一个 tick），一次 flush 之后**可能还停在
 * 「未就绪」**。
 */
async function waitFor(selector: string): Promise<Element> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = container?.querySelector(selector);
    if (found !== null && found !== undefined) return found;
    await flush();
  }
  throw new Error(`等不到元素：${selector}`);
}

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LocaleHost>
        <CalendarHubPanel />
      </LocaleHost>,
    );
  });
  await flush();
}

async function dispatchMeeting(over: Record<string, unknown> = {}): Promise<string> {
  const entityId = `cev-ui-${String(caseSeq)}`;
  await dispatchIntent({
    entityType: 'CALENDAR_EVENT',
    entityId,
    opType: OpType.Create,
    payload: {
      id: entityId,
      accountId: 'foundu',
      calendarId: 'primary',
      sourceEventId: 'evt-9',
      summary: '产品评审',
      start: todayAt(9),
      end: todayAt(10),
      ...over,
    },
  });
  return entityId;
}

beforeEach(async () => {
  __resetOpLogForTests();
  localStorage.clear();
  caseSeq += 1;
  await initOpLog(`calendar-hub-panel-${String(caseSeq)}`);
  useTaskStore.setState({ entities: currentState(), now: Date.now() });
  useProjectStore.setState({ projects: [], tags: [], trashed: [] });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('CalendarHubPanel', () => {
  it('未连接：侧栏不渲染任何配置界面（配置收在设置里）', async () => {
    await mount();
    // 等量两次：连接读取是异步的；未配置 ⇒ 面板始终返回 null。
    await flush();
    await flush();
    expect(container!.querySelector('[data-testid="calendar-hub-panel"]')).toBeNull();
    expect(container!.querySelector('[data-testid="calendar-hub-form"]')).toBeNull();
    expect(container!.querySelector('[data-testid="calendar-hub-base-url"]')).toBeNull();
    expect(container!.querySelector('[data-testid="calendar-hub-token"]')).toBeNull();
  });

  it('已配置但没有日程：画范围档与空态，不画表单、不画凭据编辑', async () => {
    await saveHubConnection('http://127.0.0.1:8787', 'token-1');
    await mount();

    await waitFor('[data-testid="calendar-hub-range-today"]');
    expect(container!.querySelector('[data-testid="calendar-hub-form"]')).toBeNull();
    expect(container!.querySelector('[data-testid="calendar-hub-edit"]')).toBeNull();
    expect(container!.querySelector('[data-testid="calendar-hub-range-today"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="calendar-hub-range-next7"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="calendar-hub-empty"]')?.textContent).toContain(
      '这几天没有日程',
    );
  });

  it('已配置且今天有一条：按天分组列出；展开后是只读详情', async () => {
    await saveHubConnection('http://127.0.0.1:8787', 'token-1');
    const entityId = await dispatchMeeting({
      location: '3 楼会议室',
      description: '带原型来',
      attendees: [{ id: 'u-1', name: '张三' }],
    });
    await mount();

    await waitFor(`[data-testid="calendar-hub-event-${entityId}"]`);
    const row = container!.querySelector(`[data-testid="calendar-hub-event-${entityId}"]`);
    expect(row, '今天那条日程没出现在面板里').not.toBeNull();
    expect(row?.textContent).toContain('产品评审');
    expect(container!.querySelector('[data-testid="calendar-hub-empty"]')).toBeNull();

    // 列表态只有摘要：详情区不该提前渲染。
    expect(container!.querySelector(`[data-testid="calendar-hub-detail-${entityId}"]`)).toBeNull();
    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    const detail = container!.querySelector(`[data-testid="calendar-hub-detail-${entityId}"]`);
    expect(detail, '点开之后没有详情').not.toBeNull();
    const text = detail?.textContent ?? '';
    expect(text).toContain('3 楼会议室');
    expect(text).toContain('带原型来');
    expect(text).toContain('张三');
    expect(text).toContain('foundu');
    // 只读镜像：这一屏不许出现任何"完成 / 改期"的入口。
    expect(detail?.querySelector('input[type="datetime-local"]')).toBeNull();
  });

  it('🔴 勾选标签写出 CALENDAR_EVENT 的 tagIds（一条 UPD，不是改内容）', async () => {
    await saveHubConnection('http://127.0.0.1:8787', 'token-1');
    const entityId = await dispatchMeeting();
    await useProjectStore.getState().addTag('工作');
    await flush();
    const tag = useProjectStore.getState().tags[0];
    expect(tag, '夹具前提：标签没建出来').toBeDefined();

    await mount();
    await waitFor(`[data-testid="calendar-hub-event-${entityId}"]`);
    const row = container!.querySelector(`[data-testid="calendar-hub-event-${entityId}"]`);
    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    const checkbox = container!.querySelector<HTMLInputElement>(
      `[data-testid="calendar-hub-detail-${entityId}"] input[type="checkbox"]`,
    );
    expect(checkbox, '详情里没有标签复选框').not.toBeNull();
    expect(checkbox!.checked).toBe(false);

    await act(async () => {
      checkbox!.click();
    });
    // 写入走真引擎（IndexedDB），落库与界面刷新都需要几个 tick。
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (useTaskStore.getState().entities.calendarEvents[entityId]?.tagIds !== undefined) break;
      await flush();
    }

    const event = useTaskStore.getState().entities.calendarEvents[entityId];
    expect(event?.tagIds).toEqual([tag!.id]);
    // 勾选没有改内容：标题与时间仍是同步来的那一份。
    expect(event?.summary).toBe('产品评审');
  });
});
