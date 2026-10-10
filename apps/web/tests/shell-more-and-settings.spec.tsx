/**
 * W1「rail 更多菜单」与 W2「设置浮层遮蔽详情列」的外壳级判据
 * ============================================================
 *
 * 依据：`docs/research/product-level-ia-ux-audit.md` §8（2026-10-06 批）。
 *
 * - **W1**：rail 上段从"启用模块平铺"收敛为「主段（≤4）+ 更多」。纯函数
 *   `splitRailTabs` 的判据在 `rail-more-menu.spec.ts`；本文件钉的是**接线**——
 *   全开 8 个模块时 tablist 里真的只有 ≤4 枚 tab + 1 枚「更多」、菜单键盘可达
 *   （打开聚焦首项、Esc 关闭并归还焦点）、目的地不足时不渲染「更多」。
 * - **W2**：设置浮层开着时详情列**整根退场**（`hidden` + 轨道归零），关掉后
 *   原选中恢复。证据图 `evidence/detail-pane-overlay/settings-sheet.png`。
 *
 * 与 `rail-more-menu.spec.ts`（纯函数）的分工：那边改动快、这边保证
 * "App 真的把它接上了"（本仓最高发的失效形状：每段都绿、接起来断）。
 * 挂载方式与 `app-mount.spec.tsx` 同一条纪律：真 op-log、零 mock、线上同一个
 * `LocaleHost`。
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { LocaleHost } from '../src/lib/locale-host.js';
import { selection } from '../src/lib/selection.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { usePrivacyStore } from '../src/features/privacy/store.js';
import { openSettingsViaAvatar } from './open-settings-via-avatar.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const originalMatchMedia = window.matchMedia;

function mount(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** 打开「更多」并返回那枚按钮（找不到即红 —— 判据在空转）。 */
function moreButton(): HTMLButtonElement {
  const el = container?.querySelector<HTMLButtonElement>('.ht-rail__more button');
  if (el == null) throw new Error('rail 上没有「更多」按钮 ⇒ 判据在空转');
  return el;
}

const railTabs = (): string[] =>
  // 只数**上段产品目的地**：统一 AI Agent 入口不是模块目的地，
  // 回收站/设置带着 `--tool` 修饰住在同一条 tablist 里也不是目的地。
  [
    ...container!.querySelectorAll(
      '.ht-rail__tabs button[role="tab"]:not(.ht-rail__tab--tool):not([data-testid="rail-assistant"])',
    ),
  ].map((el) => el.textContent?.trim() ?? '');

beforeEach(async () => {
  // jsdom 默认把详情列判成“放不下”；这组测试明确覆盖桌面三栏行为。
  window.matchMedia = ((query: string) => ({
    matches: query === '(min-width: 1024px) and (min-height: 480px)',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  localStorage.clear();
  localStorage.setItem('privacy.consent', JSON.stringify({ decision: 'local-only', decidedAt: new Date().toISOString() }));
  usePrivacyStore.setState({ open: false, reason: 'first-launch', notPersisted: false });
  __resetOpLogForTests();
  await initOpLog();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  selection.clear();
  window.matchMedia = originalMatchMedia;
});

describe('W1：rail 主段 + 更多菜单（接线层）', () => {
  it('🔴 8 个模块全开 ⇒ tablist 只有 ≤4 枚 tab + 1 枚「更多」（不平铺）', async () => {
    // 存显式覆盖（与 `saveEnabledModules` 同一形状）：四个默认关的模块全打开。
    localStorage.setItem(
      'heyta.shell.modules',
      JSON.stringify({ focus: true, growth: true, notes: true, countdown: true }),
    );
    mount();

    const tabs = railTabs();
    expect(
      tabs.length,
      `启用模块全开后主段应 ≤4 枚 tab，实际 ${tabs.length} 枚：${tabs.join('/')}`,
    ).toBeLessThanOrEqual(4);
    expect(moreButton()).toBeTruthy();
    // 「更多」是菜单入口，不是目的地本身 —— 它不该混进 role="tab" 里。
    expect(moreButton().getAttribute('aria-haspopup')).toBe('menu');
  });

  it('🔴 目的地不足五个 ⇒ 不渲染「更多」（没有空菜单）', async () => {
    localStorage.setItem(
      'heyta.shell.modules',
      JSON.stringify({ calendar: false, quadrant: false, habits: false, timeline: false }),
    );
    mount();

    expect(railTabs().length).toBeLessThanOrEqual(4);
    expect(
      container!.querySelector('.ht-rail__more'),
      '目的地不足五个时「更多」不该出现',
    ).toBeNull();
  });

  it('🔴 打开聚焦第一项；Esc 关闭并把焦点还给「更多」按钮；点菜单项切视图并收起', async () => {
    mount();
    const button = moreButton();

    await act(async () => {
      button.click();
    });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const items = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menu"] .ht-rail__more-item'),
    ];
    expect(items.length, '菜单里必须有可去的目的地').toBeGreaterThan(0);
    expect(document.activeElement, '打开后焦点应在第一项上').toBe(items[0]);

    // Esc（焦点在菜单项上发，冒泡到容器）⇒ 收起 + 焦点归还。
    await act(async () => {
      items[0]!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement, 'Esc 后焦点必须还给「更多」按钮').toBe(button);

    // 点一项 ⇒ 切视图 + 收起；且当前视图被提升进主段（"你在哪，哪就在台面上"）。
    await act(async () => {
      button.click();
    });
    const item = document.querySelector<HTMLButtonElement>('[role="menu"] .ht-rail__more-item');
    const chosen = item!.textContent?.trim();
    await act(async () => {
      item!.click();
    });
    await flush();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(railTabs(), '激活的低频视图应被提升进主段').toContain(chosen);
  });
});

describe('W2：设置浮层遮蔽详情列', () => {
  it('🔴 设置开着 ⇒ 详情列 hidden + 轨道归零属性；关闭 ⇒ 原选中恢复', async () => {
    mount();
    // 真建一条任务并选中：详情列里有面单，"退场"才有对照物。
    await act(async () => {
      await useTaskStore.getState().addTask('W2 判据的锚点任务');
    });
    await flush();
    const id = Object.keys(useTaskStore.getState().entities.tasks).find(
      (k) => useTaskStore.getState().entities.tasks[k]?.title === 'W2 判据的锚点任务',
    );
    expect(id).toBeDefined();
    act(() => {
      selection.select('task', id!);
    });
    await flush();

    const column = container!.querySelector<HTMLElement>('[data-testid="detail-column"]');
    expect(column, '详情列应该在场').not.toBeNull();
    expect(column!.hasAttribute('hidden'), '还没开设置，详情列不该 hidden').toBe(false);
    // "原选中"的诚实信号在 selection store：jsdom 里 `detailColumnShown` 的几何判定
    // 为假 ⇒ 面单走行尾回退、列里没有标题可断（那半由 W9 的 1440px 截图验）。
    expect(selection.get('task'), '锚点任务应已选中').toBe(id);

    await openSettingsViaAvatar(container!);
    expect(
      container!.querySelector('[data-testid="settings-sheet"]'),
      '设置浮层应该开着',
    ).not.toBeNull();
    const suppressed = container!.querySelector<HTMLElement>('[data-detail-suppressed]');
    expect(suppressed, '`.ht-app` 应带 data-detail-suppressed（轨道归零的信号）').not.toBeNull();
    expect(
      column!.hasAttribute('hidden'),
      '设置开着时详情列必须 hidden（不可见、不可聚焦、出 a11y 树）',
    ).toBe(true);

    // 关掉（真 ✕ 按钮）⇒ 详情列回来，选中还是原来那条（store 层判据）。
    const close = container!.querySelector<HTMLButtonElement>('[data-testid="settings-sheet-close"]');
    expect(close, '设置浮层得有 ✕（既有判据，别在 W2 里弄丢）').not.toBeNull();
    await act(async () => {
      close!.click();
    });
    await flush();

    expect(container!.querySelector('[data-testid="settings-sheet"]')).toBeNull();
    const restored = container!.querySelector<HTMLElement>('[data-testid="detail-column"]');
    expect(restored?.hasAttribute('hidden'), '关闭后详情列必须回来').toBe(false);
    expect(
      container!.querySelector('[data-detail-suppressed]'),
      '退场信号必须撤掉',
    ).toBeNull();
    expect(selection.get('task'), '关闭后原选中必须还在（store 从未被清）').toBe(id);
  });
});

describe('W3：任务视图只有一个 AI Agent / Chatbot 入口', () => {
  it('🔴 任务视图首屏：显示单一 Chatbot，工具调用不作为并列入口出现', async () => {
    mount();
    const agentSurface = container!.querySelector<HTMLElement>('[data-testid="ai-agent-surface"]');
    expect(agentSurface, '任务视图里应有单一 AI Agent surface').not.toBeNull();
    expect(
      container!.querySelectorAll('[data-testid="ai-agent-surface"]'),
      '任务视图只能挂载一枚 Agent surface',
    ).toHaveLength(1);
    expect(
      agentSurface!.querySelector('[data-testid="ai-assistant"]'),
      'Agent surface 内必须是 Chatbot 面板',
    ).not.toBeNull();
    expect(
      agentSurface!.querySelector('[data-testid="ai-assistant-input"]'),
      'Chatbot 面板必须提供统一对话输入框',
    ).not.toBeNull();
    expect(
      container!.querySelector('[data-testid="ai-drawer"]'),
      '旧的 AI 抽屉入口不应再出现',
    ).toBeNull();
    expect(
      container!.querySelector('[data-testid="ai-tool-input"]'),
      '工具调用输入不应作为独立产品入口出现',
    ).toBeNull();
  });
});
