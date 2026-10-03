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

import { dueDateToEpoch, parseLocalDate, type LocalDate, type Task } from '@heyta/domain';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OpType } from '@heyta/sync-core';

import { I18nProvider } from '@heyta/i18n';
import { HeytaUiProvider } from '@heyta/ui';

import { __resetOpLogForTests, initOpLog, requireEngine } from '../src/lib/oplog.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { DueEditor, panelTopFor } from '../src/features/tasks/DueEditor.js';

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
            onSetDueDate={(due) => {
              void useTaskStore.getState().setDueDate(task.id, due);
            }}
          />
        </HeytaUiProvider>
      </I18nProvider>,
    );
  });
}

/** 拿**当前**实体（store 是可变引用，每次都重新读）。 */
function taskOf(id: string): Task {
  const task = useTaskStore.getState().entities.tasks?.[id];
  expect(task, '实体表里应有这条任务').toBeTruthy();
  return task!;
}

/** 在所有 role="button" 里按可见文案找（快捷项 / 清除 chip 的定位钩子）。 */
function buttonByText(text: string): HTMLDivElement | null {
  const nodes = container.querySelectorAll<HTMLDivElement>('[role="button"]');
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

    const cell = container.querySelector<HTMLDivElement>('[role="button"][aria-label="10月18日"]');
    expect(cell, '月历里应有 10月18日 这格（无障碍名 = 完整日期）').not.toBeNull();
    act(() => {
      cell!.click();
    });

    const ops = await engine.getOpsForEntity('TASK', taskId);
    expect(ops).toHaveLength(before.length + 1);
    const last = ops[ops.length - 1]!;
    expect(last.opType).toBe(OpType.Update);
    // 🔴 `toEqual` 钉死"**只有** dueDate"：多带一个字段（比如顺手写 priority）
    // 就是把一个意图拆成半个意图，这里必须红。
    expect(last.payload).toEqual({ dueDate: dueDateToEpoch('2026-10-18') });

    // 物化状态（引擎重放）：离线刷新后 due 还在的机制就是它。
    expect(taskOf(taskId).dueDate).toBe(dueDateToEpoch('2026-10-18'));
  });

  it('清除 ⇒ +1 条 UPD、payload 是 { dueDate: null }（清除要能穿过 JSON）', async () => {
    await useTaskStore.getState().setDueDate(taskId, dueDateToEpoch('2026-10-18'));
    renderEditor(taskOf(taskId));
    openPanel();

    const engine = requireEngine();
    const before = await engine.getOpsForEntity('TASK', taskId);

    const clear = buttonByText('清除');
    expect(clear, '有 due 时才出现「清除」').not.toBeNull();
    act(() => {
      clear!.click();
    });

    const ops = await engine.getOpsForEntity('TASK', taskId);
    expect(ops).toHaveLength(before.length + 1);
    expect(ops[ops.length - 1]!.opType).toBe(OpType.Update);
    expect(ops[ops.length - 1]!.payload).toEqual({ dueDate: null });
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
    // setDueDate 是 async：await 一次 engine 查询把写入链冲完（同上两个用例）。
    const ops = await engine.getOpsForEntity('TASK', taskId);

    expect(ops).toHaveLength(before.length + 1);
    expect(ops[ops.length - 1]!.payload).toEqual({ dueDate: dueDateToEpoch(TODAY) });
    expect(taskOf(taskId).dueDate).toBe(dueDateToEpoch(TODAY));
  });

  it('已有 due 时触发器反映当前值（扫一眼列表就知道这条定在哪天）', async () => {
    await useTaskStore.getState().setDueDate(taskId, dueDateToEpoch('2026-10-18'));
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
  // 估高与边距来自实现；这里**不抄常数**，只按"面板高 500 / 边距 8"的形状给坐标，
  // 真正的兜底判据是下面每一条都断的 `top + 500 <= 视口高`。
  const PANEL = 500;

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
    // 行在 y≈500、视口 720：下面要 1004、上面要 -4，两边都放不下。
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
 * ── 变异台账（判据 ③）────────────────────────────────────────────
 * 2026-10-02 执行：把 DueEditor 的 `onChange` 改成 no-op（`void date`）⇒
 * 「点月历日子格」「清除」「快捷项今天」三条**恰好**转红，
 * 「触发器在」「触发器反映当前值」两条不碰写路径的保持绿；恢复后全绿。
 * e2e 侧（App 漏挂）由 `e2e/tests/due-date-edit.spec.ts` 的触发器可见断言管。
 */
