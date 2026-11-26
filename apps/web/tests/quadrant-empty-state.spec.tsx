/**
 * 判据：W5（四象限空态减重）
 * ============================
 *
 * 出处：`docs/research/product-level-ia-ux-audit.md` §4-5（整改路线图第 5 条）
 * 与 2026-10-06 的证据图 `apps/web/evidence/selection-projections/02-quadrant.png`
 * （四卡占约 95% 宽 / 70% 高、仅 2 条任务、「拖任务到这里」同屏 3 次、
 * 底部裸排长段规则说明）。
 *
 * 三道判据（对应工单的三项交付）：
 *
 * **a. 占位去重**：同类「拖任务到这里」的引导文案**同屏最多 1 处** ——
 *    只有展示顺序里第一个空象限显示它，其余空象限是轻量占位（无文案）。
 *    🔴 这一条同时守住反向规则「空态必须有下一步提示」：全空时第 1 格
 *    必须有引导（减重 ≠ 删光）。
 *
 * **b. 计数徽标**：每格标题行行尾都渲染任务计数（空格为 0）——
 *    "标题+颜色+数量为主层级"。徽标内容是纯数字；无障碍名是
 *    「现有象限名词条 + 数字」的组合（零新增词条的硬约束）。
 *
 * **c. 说明收进折叠帮助**：底部那段四象限规则说明改为 `<details>`，
 *    summary 用现成「帮助」词条（`web.shell.nav.help`），默认折叠
 *    （无 `open` 属性 ⇒ 浏览器不渲染正文）、可展开；正文沿用原文案
 *    与原 key（`web.quadrant.footnote`，一条词条都不加）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这些判据**抓不到**什么（如实记下，别当它是全覆盖）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * · **空格的高度上限**（共享层 `cellEmptyCompact` 的 `alignSelf`）在 jsdom
 *   里量不到 —— 没有布局，RNW 把样式编译成 class 而非内联。它的判据
 *   属于真浏览器截图验收（§6.2 规定一），本工单按约束不跑 e2e/不截图，
 *   该项**未验收**，见汇报。
 * · 折叠的"不可见"在 jsdom 里只能用 **`open` 属性**作 DOM 代理
 *   （浏览器对无 `open` 的 details 不渲染非 summary 子节点 ——
 *   这是平台行为，不是我们的实现）。
 *
 * ⚠️ 与 `quadrant-row-parity.spec.tsx` 同一个脚手架：宿主模块在顶层拉
 * store（要 IndexedDB），所以 `globalThis` 那两行必须先跑、宿主动态 import。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

import { Quadrant, type Task } from '@heyta/domain';
import { emptyState } from '@heyta/op-log';

import { useTaskStore } from '../src/features/tasks/store.js';

const { QuadrantBoard: WebQuadrantBoard } = await import(
  '../src/features/quadrant/QuadrantBoard.js'
);
const { quadrantBoardLabels } = await import('../src/features/quadrant/copy.js');
const { translate } = await import('@heyta/i18n');

/** 中文界面下的 `t` —— 与宿主渲染时用的是**同一套词条与同一个翻译函数**。 */
const t = (key: never, vars?: never) => translate('zh-CN', key, vars);

/** 稳定的"现在"：2026-10-06 10:00。**不读 `Date.now()`**（用例必须可复现）。 */
const NOW = new Date(2026, 9, 6, 10, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;

function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: '写方案', createdAt: 0, updatedAt: 0, ...over };
}

/**
 * 两条都落在第 1 格（重要且紧急：`important: true` + 截止在紧迫窗口内 ——
 * 与 `quadrant-row-parity.spec.tsx` 同一个造法）。于是：
 * 第 1 格 2 条，第 2/3/4 格全空 —— 复刻证据图"仅 2 条任务"的形状。
 */
function seedTwoInQ1(): void {
  useTaskStore.setState({
    entities: {
      ...emptyState(),
      tasks: {
        t1: task({ id: 't1', important: true, dueDate: NOW + HOUR }),
        t2: task({ id: 't2', important: true, dueDate: NOW + 2 * HOUR }),
      },
    },
    now: NOW,
  });
}

let roots: Root[] = [];
let containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  roots.push(root);
  containers.push(container);
  return container;
}

afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  for (const container of containers) container.remove();
  roots = [];
  containers = [];
});

describe('四象限空态：只写事实「没有任务」，不写任何操作说明', () => {
  it('空格只显示事实句「没有任务」—— 四格同一句，没有引导语', () => {
    // 2026-11-25 产品负责人：「不需要有任何说明文字，我们都已经用 UX 表达出来了」。
    const labels = quadrantBoardLabels(t as never);
    for (const q of [
      Quadrant.UrgentImportant,
      Quadrant.ImportantNotUrgent,
      Quadrant.UrgentNotImportant,
      Quadrant.Neither,
    ] as const) {
      expect(labels.empty(q), `${q} 的空态应是事实句`).toBe('没有任务');
    }
  });

  it('宿主渲染：没有计数数字、没有折叠帮助、没有任何拖拽说明文字', () => {
    seedTwoInQ1();
    const container = mount(<WebQuadrantBoard />);

    expect(container.querySelector('[data-testid^="quadrant-count-"]'), '不该显示计数数字').toBeNull();
    expect(container.querySelector('details[data-testid="quadrant-help"]'), '不该有折叠帮助').toBeNull();
    expect(container.textContent ?? '', '不该出现"拖任务到这里"这类说明').not.toContain('拖任务到这里');
    expect(container.textContent ?? '', '不该出现"拖动手柄"这类说明').not.toContain('拖动手柄');
    expect(container.textContent ?? '', '不该出现"帮助"入口').not.toContain('帮助');
  });
});
