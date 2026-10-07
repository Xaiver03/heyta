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

import type { Task } from '@heyta/domain';
import { emptyState } from '@heyta/op-log';

import { useTaskStore } from '../src/features/tasks/store.js';

const { QuadrantBoard: WebQuadrantBoard } = await import(
  '../src/features/quadrant/QuadrantBoard.js'
);

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

/** 全空：一个任务都没有 —— 「空态必须有下一步提示」的判据在这个形状下量。 */
function seedNothing(): void {
  useTaskStore.setState({ entities: emptyState(), now: NOW });
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

/** 哪几格里出现了引导文案（按格号返回，格号 = `quadrant-cell-N` 的 N）。 */
function cellsWithDropHint(container: HTMLElement): string[] {
  return ['1', '2', '3', '4'].filter((n) =>
    container
      .querySelector(`[data-testid="quadrant-cell-${n}"]`)
      ?.textContent?.includes('拖任务到这里'),
  );
}

describe('W5 四象限空态减重', () => {
  describe('a. 占位去重：引导文案同屏最多 1 处', () => {
    it('三个空象限时，「拖任务到这里」只在第一个空象限（第 2 格）出现一次', () => {
      seedTwoInQ1();
      const container = mount(<WebQuadrantBoard />);

      const cells = cellsWithDropHint(container);
      expect(
        cells,
        `引导文案应只出现在第 2 格（第一个空象限），实际出现在：${cells.join('、')}`,
      ).toEqual(['2']);
    });

    it('🔴 反向规则：全空时第 1 格必须有引导（空态必须有下一步提示，减重 ≠ 删光）', () => {
      seedNothing();
      const container = mount(<WebQuadrantBoard />);

      expect(cellsWithDropHint(container)).toEqual(['1']);
    });
  });

  describe('b. 计数徽标：每格标题行都有计数', () => {
    it('第 1 格计 2，空格计 0 —— 四格全有', () => {
      seedTwoInQ1();
      const container = mount(<WebQuadrantBoard />);

      const counts = ['1', '2', '3', '4'].map(
        (n) => container.querySelector(`[data-testid="quadrant-count-${n}"]`)?.textContent,
      );
      expect(counts).toEqual(['2', '0', '0', '0']);
    });

    it('徽标在标题行里（与象限名同一行），不在任务区', () => {
      seedTwoInQ1();
      const container = mount(<WebQuadrantBoard />);

      const badge = container.querySelector('[data-testid="quadrant-count-1"]');
      expect(badge, '第 1 格没有计数徽标').not.toBeNull();
      /**
       * 象限名在 RNW 里是一个 textContent **恰好等于**「马上做」的节点；
       * 它的父节点就是标题行。徽标必须在**那一行**里 —— 放到任务区/
       * 卡片脚上的话，`contains` 在这里就是 false（不是"往上总能找到"）。
       */
      const title = Array.from(
        container.querySelectorAll('[data-testid="quadrant-cell-1"] div'),
      ).find((el) => el.textContent === '马上做');
      expect(title, '第 1 格里没找到象限名「马上做」').not.toBeUndefined();
      expect(
        title?.parentElement?.contains(badge ?? container),
        '计数徽标不在象限名所在的那一行',
      ).toBe(true);
    });

    it('无障碍名 = 现有象限名词条 + 数字（零新增词条）', () => {
      seedTwoInQ1();
      const container = mount(<WebQuadrantBoard />);

      expect(
        container.querySelector('[data-testid="quadrant-count-1"]')?.getAttribute('aria-label'),
      ).toBe('马上做 2');
      expect(
        container.querySelector('[data-testid="quadrant-count-2"]')?.getAttribute('aria-label'),
      ).toBe('计划做 0');
    });
  });

  describe('c. 说明收进折叠帮助', () => {
    it('默认折叠：无 open 属性，summary 是「帮助」', () => {
      seedTwoInQ1();
      const container = mount(<WebQuadrantBoard />);

      const details = container.querySelector('details[data-testid="quadrant-help"]');
      expect(details, '底部没有折叠帮助 <details>').not.toBeNull();
      // 🔴 jsdom 没有布局，"正文不可见"的 DOM 代理是 `open` 属性：
      // 浏览器对无 `open` 的 details 不渲染非 summary 子节点（平台行为）。
      expect(details?.hasAttribute('open'), '说明默认应该是折叠的').toBe(false);
      expect(details?.querySelector('summary')?.textContent).toBe('拖动手柄或使用「移动」调整象限');
    });

    it('正文沿用原文案与原 key（收进折叠 ≠ 删除），展开后 open 属性出现', () => {
      seedTwoInQ1();
      const container = mount(<WebQuadrantBoard />);

      const details = container.querySelector<HTMLDetailsElement>(
        'details[data-testid="quadrant-help"]',
      );
      expect(details).not.toBeNull();
      // 原文案开头（`web.quadrant.footnote` 的 zh-CN 值）—— 证明正文还是那一段。
      expect(details?.textContent).toContain('紧急程度由截止时间推导');

      act(() => {
        details?.querySelector('summary')?.click();
      });
      expect(details?.hasAttribute('open'), '点 summary 后应该展开').toBe(true);
    });
  });
});
