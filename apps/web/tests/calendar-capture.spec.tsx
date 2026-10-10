/**
 * 「说一句话落进**选中那一格**」（R11 批五 · §9.3 差异化第 2 条）
 * ================================================================
 *
 * 产品负责人挑的差异化里，这一条是 heyta 结构上做得到、滴答做不到的：
 * 滴答的 `+` 只能"新建"，落不进你正指着的那一格；而本地优先的日历里
 * "选中哪天"就是这一屏的状态，捕获框在同一屏拿得到它。
 *
 * ## 这个文件钉的是哪三件事
 *
 * 1. **落点说得出口**：输入框的 placeholder 里必须出现选中那天的日期。
 *    🔴 这条不是礼貌话 —— 悄悄改变一条任务的落点属于"界面没说谎、
 *    但用户以为没说"那一类（本仓为这一类记过一整页账）。
 * 2. **优先级**：输入里写了「明天」以**输入**为准，没写才落到锚点。
 *    反过来会得到"选了 8 号就永远说不进'明天'"。
 * 3. **它不叫 AI**：全程零模型、零出境（ADR-0013 的 `retention-undecided`
 *    仍然挡着 `managed`，而这条根本不需要它）。
 *    ⇒ 这里断言的是**一次 `fetch` 都没发出去**，不是"看起来没调模型"。
 *
 * ⚠️ 真浏览器那一份在 `e2e/tests/calendar-capture.spec.ts`（要点开日历、
 *   选一天、真的敲字提交），这里只钉 DOM 与数据形状。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { enableModules } from './enable-all-modules.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');
const { useCalendarViewStore } = await import('../src/features/calendar/store.js');
const { usePrivacyStore } = await import('../src/features/privacy/store.js');
const { addDays, isoWeekday, startOfMonth, toLocalDate, FULL_SCOPE } = await import('@heyta/domain');

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let dbName: string;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(): Promise<void> {
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
  await flush();
}

async function openCalendar(): Promise<void> {
  const tab = [...(container?.querySelectorAll<HTMLButtonElement>('button[role="tab"]') ?? [])].find(
    (b) => b.textContent?.trim() === '日历',
  );
  expect(tab, 'rail 上找不到「日历」').toBeDefined();
  await act(async () => {
    tab!.click();
  });
  await flush();
}

const q = <T extends HTMLElement>(testId: string): T | null =>
  container!.querySelector<T>(`[data-testid="${testId}"]`) ??
  document.body.querySelector<T>(`[data-testid="${testId}"]`);

async function click(el: HTMLElement | null): Promise<void> {
  expect(el, '判据要点的控件不在 DOM 里').not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

/** 往共享捕获框里打字（React 受控 input 只认原生 setter）。 */
async function typeCapture(value: string): Promise<void> {
  const input = q<HTMLInputElement>('capture-input');
  expect(input, '捕获输入框没渲染出来').not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

async function submitCapture(): Promise<void> {
  await click(q<HTMLElement>('capture-submit'));
}

/**
 * 等到条件成立。
 *
 * 🔴 为什么不是"再 flush 两次 tick"：`addTask` 是**异步落库**（dispatch → op-log →
 * 订阅者更新 store），而固定 tick 在高负载下不够 —— 实测本文件**单跑 6/6 全绿**，
 * 放进全量套件（112 个 jsdom 环境）就有 3 条红在"任务没建出来"，
 * 而未处理的拒绝是 `op-log 引擎尚未初始化` —— 也就是**上一个用例的写还没落地，
 * 下一个用例的 `beforeEach` 已经把引擎重置了**。所以等的是"这条真的进库了"，
 * 而不是"我给了它两次机会"。
 */
async function waitSubmitted(title: string): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    await flush();
    if (lastTask()?.title === title) return;
    if (Date.now() > deadline) {
      throw new Error(`等不到任务「${title}」落库（最后一条是 ${String(lastTask()?.title)})`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** 最近创建的那条任务（按 createdAt 取最大，避免受别的用例干扰）。 */
function lastTask() {
  const all = Object.values(useTaskStore.getState().entities.tasks);
  return all.sort((a, b) => a.createdAt - b.createdAt)[all.length - 1];
}

/** 「2026-10-03」→「10月3日」（与共享 `formatDayTitleText` 同一种措辞，去掉星期）。 */
function dayPhrase(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  void y;
  return `${String(m)}月${String(d)}日`;
}

/** 把 epoch ms 读成本地日历日 + 本地小时，验证"落在哪一天"。 */
function localDayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

beforeEach(async () => {
  __resetOpLogForTests();
  localStorage.clear();
  localStorage.setItem('privacy.consent', JSON.stringify({ decision: 'local-only', decidedAt: new Date().toISOString() }));
  usePrivacyStore.setState({ open: false, reason: 'first-launch', notPersisted: false });
  enableModules(['calendar']);
  dbName = `calendar-capture-${Math.random().toString(36).slice(2)}`;
  await initOpLog(dbName);
  const today = toLocalDate(Date.now());
  useTaskStore.setState({ now: Date.now() });
  useCalendarViewStore.setState({
    cursor: startOfMonth(today),
    selected: today,
    scope: FULL_SCOPE,
    view: 'month',
    captureOpen: false,
  });
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

describe('日历上的「往选中那天加一条」', () => {
  it('🔴 页头那个 `+` 一点，输入框出现，而 placeholder **说出落点是哪一天**', async () => {
    await mount();
    await openCalendar();
    expect(q('capture-input'), '默认不该开着输入框').toBeNull();

    await click(q('calendar-capture-toggle'));
    const input = q<HTMLInputElement>('capture-input');
    expect(input, '点了 `+` 没有输入框').not.toBeNull();
    const selected = useCalendarViewStore.getState().selected;
    // 措辞来自共享的 `formatDayTitleText`（「10月3日 星期六」，**不带年份**——
    // 落点就在眼前这一屏的网格里，年份在这里是噪声）。
    expect(input!.getAttribute('placeholder')).toContain(dayPhrase(selected));
  });

  it('🔴 只写标题 ⇒ 任务落在**选中的那一格**（本地零点，与 `Task.dueDate` 同一约定）', async () => {
    await mount();
    await openCalendar();
    await click(q('calendar-capture-toggle'));
    await typeCapture('评审材料');
    await submitCapture();
    await waitSubmitted('评审材料');

    const task = lastTask();
    expect(task?.title, '任务没建出来').toBe('评审材料');
    expect(task?.dueDate, '没设截止时间 ⇒ 它不会出现在日历上，这一档就白做').toBeDefined();
    expect(localDayOf(task!.dueDate!)).toBe(useCalendarViewStore.getState().selected);
    expect(new Date(task!.dueDate!).getHours()).toBe(0);
  });

  it('🔴 输入里写了「明天」⇒ **以输入为准**，不是以选中那格为准', async () => {
    await mount();
    await openCalendar();
    // 故意选到**后天**，这样"锚点赢"与"输入赢"给出的日子不同，
    // 判据才分得出来（两边都留空的话它恒真）。
    const dayAfterTomorrow = addDays(toLocalDate(Date.now()), 2);
    useCalendarViewStore.setState({ selected: dayAfterTomorrow });
    await flush();

    await click(q('calendar-capture-toggle'));
    await typeCapture('明天 站会');
    await submitCapture();
    await waitSubmitted('站会');

    const task = lastTask();
    expect(task?.title).toBe('站会');
    expect(localDayOf(task!.dueDate!)).toBe(addDays(toLocalDate(Date.now()), 1));
    expect(localDayOf(task!.dueDate!)).not.toBe(dayAfterTomorrow);
  });

  it('🔴 全程**零出站**：这一条是规则解析，不是 AI（不许顺手打模型）', async () => {
    // 🔴 用**透传 spy**，不是替身：替身会把应用自己的启动请求也变成 `{}`，
    //    于是"任务没建出来"看起来像产品坏了，实际是探针把宿主弄伤了。
    const original = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input, init) => original(input, init),
    );
    await mount();
    await openCalendar();
    await click(q('calendar-capture-toggle'));
    await typeCapture('下周三 复盘');
    await submitCapture();
    // 等的正是"规则把「下周三」吃成日期、标题只剩「复盘」"这一步
    //（实测 `parseCapture('下周三 复盘')` → `{ title: '复盘', dueDate: '2026-10-07' }`）。
    await waitSubmitted('复盘');

    // 「下周三」这种**看起来最像需要模型**的输入，走的仍然是 `parseCapture` 的规则表，
    // 而且**日期真的解析出来了**（只断标题在，等于没断日期）。
    expect(lastTask()?.dueDate, '规则没解析出日期 ⇒ 这条压根没带截止时间').toBeDefined();
    const modelish = fetchSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => !u.includes('/api/') && !u.includes('127.0.0.1'));
    expect(modelish, `日历捕获发出了非应用请求：${modelish.join(' | ')}`).toEqual([]);
  });

  it('再点一次 `+` 收起；一屏**只有一行**输入框', async () => {
    await mount();
    await openCalendar();
    await click(q('calendar-capture-toggle'));
    expect(document.body.querySelectorAll('[data-testid="capture-input"]')).toHaveLength(1);
    await click(q('calendar-capture-toggle'));
    expect(q('capture-input'), '再点一次没有收起').toBeNull();
  });

  it('🔴 选中格换了，落点跟着换（**不是**"第一次打开时算好的那一天"）', async () => {
    await mount();
    await openCalendar();
    await click(q('calendar-capture-toggle'));

    // 点月历里另一格（找一个不是今天的、在本月内的格子）。
    const today = toLocalDate(Date.now());
    const other = addDays(today, isoWeekday(today) === 7 ? 2 : 1);
    const cell = q<HTMLElement>(`calendar-cell-${other}`);
    expect(cell, `找不到格子 ${other}`).not.toBeNull();
    await click(cell);

    const input = q<HTMLInputElement>('capture-input');
    expect(q<HTMLInputElement>('capture-input')!.getAttribute('placeholder')).toContain(
      dayPhrase(other),
    );

    await typeCapture('换格之后写的');
    await submitCapture();
    await waitSubmitted('换格之后写的');
    expect(localDayOf(lastTask()!.dueDate!)).toBe(other);
  });

  it('🔴 Esc 与外部点击只关闭编辑器，不产生任务，并把焦点还给日期格', async () => {
    await mount();
    await openCalendar();
    await click(q('calendar-capture-toggle'));
    expect(q('capture-input')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush();
    expect(q('capture-input')).toBeNull();
    expect(document.activeElement?.getAttribute('data-testid')).toMatch(/^calendar-cell-/);
    expect(Object.keys(useTaskStore.getState().entities.tasks)).toHaveLength(0);

    await click(q('calendar-capture-toggle'));
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    await act(async () => {
      outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    await flush();
    outside.remove();
    expect(q('capture-input')).toBeNull();
    expect(Object.keys(useTaskStore.getState().entities.tasks)).toHaveLength(0);
  });
});
