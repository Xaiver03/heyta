/**
 * 截止日期的**事后编辑**（多端覆盖审计 P0-3，goal 批一判据 ①）
 * ==============================================================
 *
 * 在这一刀之前：`setDueDate` 语义完整（app-host 动作层 + store 各就各位），
 * 但全 Web **零 UI 调用点** —— 想给任务设"周五截止"，没有任何直接办法
 * （唯一沾边的是 AI 捕获确认框的日期输入，那是建任务时，不是事后改）。
 * 桌面三壳继承同一份载荷 ⇒ 主战场的 macOS / Windows 同样改不了 due。
 *
 * 这份判据钉的是**出口**：点日子 → `DueEditor` → `store.setDueDate` →
 * `dispatch()` —— op-log 里必须出现**恰好一条**只带 `dueDate` 的 UPD。
 * 「状态变了」不算数（§7 元规则），证据是 **op 本身**。
 *
 * 🔴 变异靶（判据 ③，2026-10-02 执行见文件尾台账）：
 * 把 `DueEditor` 的 `onChange` 改成 no-op（绕过 `onSetDueDate`）⇒
 * 本文件「选日期」「清除」「快捷项」三组判据**恰好**转红。
 * 「App 行上挂没挂」由真浏览器 e2e 钉（`e2e/tests/due-date-edit.spec.ts`）——
 * jsdom 直接渲染 `DueEditor`，App 漏挂它看不见；两层各管各的。
 *
 * jsdom 已知的边界（写在这里，不是判据的漏洞）：
 *   - `<details>` 的 summary 点击展开 jsdom **不实现** —— 用例里直接置
 *     `details.open = true`。"点开"这个用户动作由 e2e 的真浏览器验证。
 *   - RNW `Pressable` 对原生 `click()` 有响应（`habits-board.spec.tsx` 已验证
 *     同一形状），日子格直接 `el.click()`。
 */

import { dueDateToEpoch, localTimeOf, parseLocalDate, type LocalDate, type Task } from '@heyta/domain';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OpType } from '@heyta/sync-core';

import { I18nProvider } from '@heyta/i18n';
import { HeytaUiProvider } from '@heyta/ui';

import { __resetOpLogForTests, initOpLog, requireEngine } from '../src/lib/oplog.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { DueEditor, DUE_PANEL_HEIGHT_ESTIMATE, panelTopFor } from '../src/features/tasks/DueEditor.js';

/** 冻结的"现在"：2026-10-02（周五）10:00 本地时。今天/日子格的期望值都从它推。 */
const NOW = parseLocalDate('2026-10-02').getTime() + 10 * 3_600_000;
const TODAY: LocalDate = '2026-10-02';

let container: HTMLDivElement;
let root: Root;
let taskId: string;

async function createTask(title: string): Promise<string> {
  await useTaskStore.getState().addTask(title);
  const entry = Object.values(useTaskStore.getState().entities.tasks ?? {}).find(
    (t) => t.title === title,
  );
  expect(entry, '建任务后实体表里应有它').toBeTruthy();
  return entry!.id;
}

function renderEditor(task: Task): void {
  act(() => {
    root.render(
      <I18nProvider locale="zh-CN">
        <HeytaUiProvider>
          <DueEditor
            task={task}
            now={NOW}
            onSetDueDate={(due, dueDateLocal) => {
              // 🔴 **记下这张凭据**，不要 `void` 掉。见下面 `drainWrites`。
              writes.push(useTaskStore.getState().setDueDate(task.id, due, dueDateLocal));
            }}
          />
        </HeytaUiProvider>
      </I18nProvider>,
    );
  });
}

/*
 * 🔴 **写入的凭据表**：读 op 之前必须等它落干。
 *
 * 这条判据的证据是 op 本身，而组件的 `onSetDueDate` 是**异步**的。以前这里写的是
 * `void setDueDate(...)`，然后靠"await 一次 engine 查询"把写入链冲完 ——
 * 那是**赌引擎在一个微任务里把 op 落盘**。2026-10-03 实测赌输了：op-log 那边
 * 给 `dispatch` 加了一条串行队列（`serialize()`，在飞的那条线，不是本批的改动），
 * 落盘多排了一个 tick，于是同一份代码**当场 6 红**（`Expected 2, Received 1`）。
 *
 * ⚠️ 症状是"写入没发生"，真原因是"读取没等写入" —— 这两件事在界面上长得一样，
 *   而只有后者是这份判据能修的。修法不是加 `setTimeout`（那是换个赌法），
 *   是**拿着 store 返回的凭据 await 它**：写入完成这件事由被调方宣告，不由我数微任务。
 *
 * 反向的用处更大：「敲进去也不产生 op」「非法形状 0 条」这两条判的是 **0**，
 * 没有 drain 时"0"完全可能只是"还没写完" ⇒ **假绿**。drain 之后 0 才是 0。
 */
const writes: Promise<unknown>[] = [];

async function drainWrites(): Promise<void> {
  const pending = writes.splice(0, writes.length);
  await Promise.all(pending);
}

/**
 * 等到**条件**成立（最多 ~200 个宏任务），等不到就带着"它在等什么"失败。
 *
 * 🔴 为什么不是再多 `await` 两次：本仓的 `reminders-panel.spec.tsx` /
 *   `notes-view.spec.tsx` 文件头都记着同一件事 —— "固定刷 N 个宏任务"
 *   只在机器空的时候刚好够，全量并行时不够，而红的文件每次还可能不是同一个。
 *   那是**探针在猜时长**，不是产品行为漂了。
 */
async function waitUntil(label: string, done: () => boolean, limit = 200): Promise<void> {
  for (let i = 0; i < limit; i += 1) {
    if (done()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  throw new Error(`等待「${label}」超时（${limit} 个宏任务）`);
}

/**
 * 播种"已有截止"的状态，并等到它**真的物化**。
 *
 * 🔴 只 await 写入的 promise 不够：`setDueDate` 入队之后就返回，而组件拿的是
 *   物化后的快照。实测（2026-10-03 16:33）本文件单跑 15/15、`pnpm --filter web test`
 *   全量 1 红，红的正是「有 due 时才出现『清除』」那条 —— 快照还没有 due，
 *   于是面板按"没有截止"画，按钮当然不在。
 */
async function seedDue(due: number): Promise<void> {
  const before = await useTaskStore.getState().setDueDate(taskId, due);
  await before;
  await waitUntil(`dueDate 物化成 ${due}`, () => taskOf(taskId).dueDate === due);
}

/** 拿**当前**实体（store 是可变引用，每次都重新读）。 */
function taskOf(id: string): Task {
  const task = useTaskStore.getState().entities.tasks?.[id];
  expect(task, '实体表里应有这条任务').toBeTruthy();
  return task!;
}

/**
 * 🔴 面板里的东西一律从 **`document`** 取，不从 `container` 取。
 *
 * 理由不是风格，是实测：`DueEditor` 的面板有**两副身体**（`details` 内的在流卡 /
 * Portal 到 `body` 的 fixed 卡），换身体由 `toggle` 事件 + 一帧 `requestAnimationFrame`
 * 置位的 `anchor` 决定。组件注释里那句"jsdom 不触发 `toggle`"**在 jsdom 27 上已被否证**
 * （探针 `/tmp/jsdom-toggle-probe.js`：`details.open = true` 之后一个宏任务里
 * `toggle` 计数 = 1，正向对照是同刻手动派发 = 2；`raf-leg.js`：rAF 在第 17ms 回调）。
 * 于是用例里那句 `await engine.getOpsForEntity(...)` 一旦跨过一个宏任务边界，
 * 格子就已经不在 `container` 里了 —— 机器空的时候等得短就绿、负载高的时候等得长就红，
 * 症状是"月历里应有 10 月 18 日 这格：expected null not to be null"，
 * 而**产品行为完全没变**（2026-10-04 05:21 全量 `pnpm -r test` 就是这个形状红的）。
 * 同文件的 R14 那几条早就改成从 `document` 找了；这两条是漏改的那两条腿。
 */
function buttonByAriaLabel(label: string): HTMLDivElement | null {
  for (const node of document.querySelectorAll<HTMLDivElement>('[role="button"]')) {
    if (node.getAttribute('aria-label') === label) return node;
  }
  return null;
}

/** 在所有 role="button" 里按可见文案找（快捷项 / 清除 chip 的定位钩子）。 */
function buttonByText(text: string): HTMLDivElement | null {
  const nodes = document.querySelectorAll<HTMLDivElement>('[role="button"]');
  for (const node of nodes) {
    if (node.textContent === text) return node;
  }
  return null;
}

function openPanel(): void {
  const details = container.querySelector('details');
  expect(details, 'DueEditor 应该是行尾的一个 disclosure').not.toBeNull();
  // jsdom 不实现 summary 的展开切换；"点开"由真浏览器 e2e 钉。
  (details as HTMLDetailsElement).open = true;
  // open 切换后 React 子树已经在 DOM 里（details 的子节点一直渲染）。
}

beforeEach(async () => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  localStorage.clear();
  __resetOpLogForTests();
  writes.length = 0;
  await initOpLog();

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  taskId = await createTask('要定截止的任务');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('🔴 批一判据 ①：选截止日 → 恰好一条只带 dueDate 的 UPD op', () => {
  it('rule date-only survives a different device timezone and an edit round trip', async () => {
    await useTaskStore.getState().setDueDate(taskId, Date.UTC(2026, 9, 7, 16), '2026-10-08');
    renderEditor(taskOf(taskId));
    expect(container.querySelector('[data-testid="due-editor-summary"]')?.textContent).toContain('10月8日');
    openPanel();
    const cell = buttonByAriaLabel('10月18日');
    expect(cell).not.toBeNull();
    act(() => cell!.click());
    await drainWrites();
    expect(taskOf(taskId).dueDateLocal).toBe('2026-10-18');
  });
  it('触发器在（行尾 disclosure），没有 due 时不显示日期', () => {
    renderEditor(taskOf(taskId));
    const summary = container.querySelector('[data-testid="due-editor-summary"]');
    expect(summary, '行尾应有「截止」触发器').not.toBeNull();
    expect(summary!.textContent).toContain('截止');
    expect(summary!.textContent!.includes('10月2日'), '没设 due 时触发器不显示日期').toBe(false);
  });

  it('点月历日子格 ⇒ +1 条 UPD、payload 只有 dueDate、物化状态到位', async () => {
    renderEditor(taskOf(taskId));
    openPanel();

    const engine = requireEngine();
    const before = await engine.getOpsForEntity('TASK', taskId);

    const cell = buttonByAriaLabel('10月18日');
    expect(cell, '月历里应有 10月18日 这格（无障碍名 = 完整日期）').not.toBeNull();
    act(() => {
      cell!.click();
    });

await drainWrites();
    const ops = await engine.getOpsForEntity('TASK', taskId);
    expect(ops).toHaveLength(before.length + 1);
    const last = ops[ops.length - 1]!;
    expect(last.opType).toBe(OpType.Update);
    // 🔴 `toEqual` 钉死"只有截止日及其 date-only 语义"：多带业务字段必须红。
    // 就是把一个意图拆成半个意图，这里必须红。
    expect(last.payload).toEqual({ dueDate: dueDateToEpoch('2026-10-18'), dueDateLocal: '2026-10-18' });

    // 物化状态（引擎重放）：离线刷新后 due 还在的机制就是它。
    expect(taskOf(taskId).dueDate).toBe(dueDateToEpoch('2026-10-18'));
  });

  it('清除 ⇒ +1 条 UPD、payload 是 { dueDate: null }（清除要能穿过 JSON）', async () => {
    await seedDue(dueDateToEpoch('2026-10-18'));
    renderEditor(taskOf(taskId));
    openPanel();

    const engine = requireEngine();
    const before = await engine.getOpsForEntity('TASK', taskId);

    const clear = buttonByText('清除');
    expect(clear, '有 due 时才出现「清除」').not.toBeNull();
    act(() => {
      clear!.click();
    });

await drainWrites();
    const ops = await engine.getOpsForEntity('TASK', taskId);
    expect(ops).toHaveLength(before.length + 1);
    expect(ops[ops.length - 1]!.opType).toBe(OpType.Update);
    expect(ops[ops.length - 1]!.payload).toEqual({ dueDate: null, dueDateLocal: null });
    expect(taskOf(taskId).dueDate).toBeUndefined();
  });

  it('快捷项「今天」⇒ +1 条 UPD、dueDate = 今天的本地零点', async () => {
    renderEditor(taskOf(taskId));
    openPanel();

    const engine = requireEngine();
    const before = await engine.getOpsForEntity('TASK', taskId);

    const today = buttonByText('今天');
    expect(today, '快捷项应有「今天」').not.toBeNull();
    act(() => {
      today!.click();
    });
await drainWrites();
    const ops = await engine.getOpsForEntity('TASK', taskId);

    expect(ops).toHaveLength(before.length + 1);
    expect(ops[ops.length - 1]!.payload).toEqual({ dueDate: dueDateToEpoch(TODAY), dueDateLocal: TODAY });
    expect(taskOf(taskId).dueDate).toBe(dueDateToEpoch(TODAY));
  });

  it('已有 due 时触发器反映当前值（扫一眼列表就知道这条定在哪天）', async () => {
    await seedDue(dueDateToEpoch('2026-10-18'));
    renderEditor(taskOf(taskId));
    const summary = container.querySelector('[data-testid="due-editor-summary"]');
    expect(summary!.textContent).toContain('10月18日');
  });
});

/*
 * ── 弹层**放置**（2026-10-03 补）─────────────────────────────────
 * 起因是全量 e2e 里 `e2e/tests/due-date-edit.spec.ts` **确定性地**红在
 * `element is outside of the viewport`（单跑也红，不是负载 flake）。
 * 截图量的到的形状：行在 y≈500、视口 720、面板估高 500 ⇒
 * **下面放不下、上面也放不下**，而旧逻辑在这种情况下写的是"宁低不遮列表头"
 * ⇒ 面板朝下开、最后两周被视口底裁掉 ⇒ **那个日期在界面上根本选不到**。
 * 纯函数抽出来是为了把三个分支各自钉住（e2e 只能钉到"这一格点得到"那一个形状）。
 */
describe('弹层放置：三种情形都必须把面板留在视口内', () => {
  /*
   * ⚠️ 2026-10-03 更正：这里原来是**手抄一个 500**（注释写着"不抄常数"），
   * 而实现里的估高随 R14 加了时刻那一行改成 540 —— 四条**照样全绿**。
   * 那就是"测试对着自己抄的旧值打分"：面板变高这件事完全没被量到。
   * 现在从实现导出的常数推，估高一旦再变这四条会立刻跟着变判。
   */
  const PANEL = DUE_PANEL_HEIGHT_ESTIMATE;

  it('下面放得下 ⇒ 贴着锚点下沿开', () => {
    const top = panelTopFor({ top: 100, bottom: 120 }, 1200);
    expect(top).toBeGreaterThan(120);
    expect(top).toBeLessThan(140);
    expect(top + PANEL).toBeLessThanOrEqual(1200);
  });

  it('下面放不下、上面放得下 ⇒ 翻到锚点上方', () => {
    const top = panelTopFor({ top: 600, bottom: 620 }, 900);
    expect(top + PANEL).toBeLessThanOrEqual(600 - 8);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  it('🔴 两头都放不下（实测那个形状）⇒ **夹进视口**，不许裁掉面板', () => {
    // 行在 y≈500、视口 720：朝下要 518+8+估高（540）+边距 = 1074、
    // 朝上要 500-8-540 = -48，两边都放不下（数字按 `PANEL` 推，不写死）。
    const top = panelTopFor({ top: 500, bottom: 518 }, 720);
    expect(top).toBeGreaterThanOrEqual(8);
    // 这条就是"18 号点得到"的算术形式：面板整块在视口里。
    expect(top + PANEL).toBeLessThanOrEqual(720);
  });

  it('视口比面板还矮 ⇒ 至少贴顶，不产生负顶边（也不产生 NaN）', () => {
    const top = panelTopFor({ top: 100, bottom: 118 }, 400);
    expect(top).toBe(8);
  });
});

/*
 * ── R14：时刻那一栏（判据与上面同一套：证据是 **op 本身**，不是"状态变了"）──
 */
describe('🔴 R14 时刻：输入、搬运、全天、无日期四档', () => {
  /** 往 RNW 的 TextInput 里"打字"。React 的 onChange 走原生 `input` 事件，
   *  而直接改 `.value` 会被 React 自己的 value tracker 当成"没有变化"吞掉 ——
   *  必须用原型上的 setter 走一次，事件才带得上正确的新旧值。 */
  function typeTime(text: string): void {
    // 从 `document` 找：面板有**两副身体**（details 内的在流卡 / Portal 的 fixed 卡），
    // 写入之后切到 Portal 那副就不在 `container` 里了 —— 在 container 里找会得到
    // `null`，看起来像"那一栏消失了"。
    const input = document.querySelector<HTMLInputElement>('[data-testid="date-picker-time-input"]');
    expect(input, '面板里应有时刻输入框').not.toBeNull();
    if (input === null) throw new Error('面板里应有时刻输入框');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    act(() => {
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function clickByTestId(testID: string): void {
    const node = document.querySelector<HTMLElement>(`[data-testid="${testID}"]`);
    expect(node, `界面上应有 ${testID}`).not.toBeNull();
    act(() => {
      node!.click();
    });
  }

  /** 播种一条"10月18日 16:00"的任务，并把写完后的 op 数拿回来。 */
  async function seedTimedTask(): Promise<number> {
    await seedDue(dueDateToEpoch('2026-10-18', '16:00'));
    renderEditor(taskOf(taskId));
    openPanel();
    return (await requireEngine().getOpsForEntity('TASK', taskId)).length;
  }

  it('触发器上写着**这条截止的精度**（10月18日 16:00，不是只剩日子）', async () => {
    await seedDue(dueDateToEpoch('2026-10-18', '16:00'));
    renderEditor(taskOf(taskId));
    const summary = container.querySelector('[data-testid="due-editor-summary"]');
    expect(summary!.textContent).toContain('10月18日');
    expect(
      summary!.textContent,
      '触发器要写出精度 —— 否则"这条定在 16:00"只有点开面板才知道',
    ).toContain('16:00');
  });

  it('🔴 在输入框敲 16:00 ⇒ 恰好一条 UPD，payload 落在**本地 16:00**', async () => {
    await seedTimedTask();
    // 先改回全天（否则"敲进去 16:00"可能与播种值巧合相同，那条断言就没牙了）。
    clickByTestId('date-picker-time-all-day');
await drainWrites();
    const cleared = await requireEngine().getOpsForEntity('TASK', taskId);
    expect(cleared[cleared.length - 1]!.payload).toEqual({ dueDate: dueDateToEpoch('2026-10-18'), dueDateLocal: '2026-10-18' });
    /*
     * 重新渲染。`task` 是**快照 prop**（宿主在任务行上传的是当前实体），
     * 不重 render 组件就还以为时刻是 16:00 —— 于是"敲进 16:00"变成写同一个值，
     * op 层判重 ⇒ 没有新 op ⇒ 这条会假红（2026-10-03 实测就是这个形状）。
     */
    renderEditor(taskOf(taskId));
    openPanel();

    typeTime('16:00');
await drainWrites();
    const ops = await requireEngine().getOpsForEntity('TASK', taskId);
    expect(ops).toHaveLength(cleared.length + 1);
    expect(ops[ops.length - 1]!.opType).toBe(OpType.Update);
    expect(ops[ops.length - 1]!.payload).toEqual({
      dueDate: dueDateToEpoch('2026-10-18', '16:00'),
      dueDateLocal: null,
    });
    expect(new Date(taskOf(taskId).dueDate!).getHours()).toBe(16);
  });

  it('🔴 换日子**搬运时刻**：18日16:00 → 点 25 号 ⇒ 25日16:00，不是 25日零点', async () => {
    const before = await seedTimedTask();
    const cell = buttonByAriaLabel('10月25日');
    expect(cell, '月历里应有 10月25日 这格').not.toBeNull();
    act(() => {
      cell!.click();
    });
await drainWrites();
    const ops = await requireEngine().getOpsForEntity('TASK', taskId);
    expect(ops).toHaveLength(before + 1);
    expect(ops[ops.length - 1]!.payload).toEqual({
      dueDate: dueDateToEpoch('2026-10-25', '16:00'),
      dueDateLocal: null,
    });
  });

  it('点「全天」⇒ payload 回到那一天的**本地零点**（清除时刻是写出来的，不是留空）', async () => {
    const before = await seedTimedTask();
    clickByTestId('date-picker-time-all-day');
await drainWrites();
    const ops = await requireEngine().getOpsForEntity('TASK', taskId);
    expect(ops).toHaveLength(before + 1);
    expect(ops[ops.length - 1]!.payload).toEqual({ dueDate: dueDateToEpoch('2026-10-18'), dueDateLocal: '2026-10-18' });
    expect(taskOf(taskId).dueDate).toBe(dueDateToEpoch('2026-10-18'));
    // 读回来必须是"全天"（与时间线那侧同一个判定，不是这里自己再算一遍时分）。
    expect(localTimeOf(taskOf(taskId).dueDate!)).toBeUndefined();
  });

  it('🔴 没有日子就没有"几点"：时刻输入框不可编辑，敲进去也不产生 op', async () => {
    renderEditor(taskOf(taskId));
    openPanel();
await drainWrites();
    const before = await requireEngine().getOpsForEntity('TASK', taskId);
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="date-picker-time-input"]',
    );
    expect(input, '没有 due 时那一行照样画出来（让用户看得见这一栏）').not.toBeNull();
    expect(input!.disabled, '没有 due 时必须是不可编辑的').toBe(true);
    typeTime('16:00');
await drainWrites();
    const after = await requireEngine().getOpsForEntity('TASK', taskId);
    expect(after).toHaveLength(before.length);
  });

  it('🔴 非法形状不写库：敲 25:00 ⇒ 一条新 op 都不产生', async () => {
    /*
     * 判的是产品结论（**没写进库**），不是框里显示什么 —— 草稿的回显形状
     * 属于显示形态（"断言产品结论不断言显示形态"），而且实测它会被
     * 面板换身体（details 卡 ↔ Portal 卡）时的重挂载牵动，拿它当判据会测到脚手架。
     *
     * "打字确实送到了组件"这件事由同一个 describe 里
     * 「敲 16:00 ⇒ 恰好一条 UPD」那条正着钉住（同一条通道、同一个寻址方式），
     * 所以这里的 0 不是"通道根本没通"的 0。
     */
    const before = await seedTimedTask();
    const input = document.querySelector<HTMLInputElement>('[data-testid="date-picker-time-input"]');
    expect(input, '面板里应有时刻输入框').not.toBeNull();
    expect(input!.disabled, '已有日子时必须可编辑（否则"0 条"可能只是没送到）').toBe(false);

    typeTime('25:00');
await drainWrites();
    const after = await requireEngine().getOpsForEntity('TASK', taskId);
    expect(after).toHaveLength(before);
    expect(taskOf(taskId).dueDate, '库里还是播种那一条 09:30 之前的值').toBe(
      dueDateToEpoch('2026-10-18', '16:00'),
    );
  });
});

/*
 * ── 变异台账（判据 ③）────────────────────────────────────────────
 * 2026-10-02 执行：把 DueEditor 的 `onChange` 改成 no-op（`void date`）⇒
 * 「点月历日子格」「清除」「快捷项今天」三条**恰好**转红，
 * 「触发器在」「触发器反映当前值」两条不碰写路径的保持绿；恢复后全绿。
 * e2e 侧（App 漏挂）由 `e2e/tests/due-date-edit.spec.ts` 的触发器可见断言管。
 */
