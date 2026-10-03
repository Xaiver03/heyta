/**
 * 共享 `EventBoard`（倒数日卡片网格）的**宿主组合契约**（W5 判据）
 * ================================================================
 *
 * 🔴 为什么挂共享 composer 而不是挂真 `<App />`：倒数日模块**默认关**
 * （`SHELL_MODULES.countdown.defaultOn === false`），真 App 里它不进 DOM，
 * 于是"卡片怎么排、逾期是什么颜色、保存发了几个 op"在 App 级测试里
 * **恰好都看不到**。这里用可控 props 把契约逐条钉住。
 * App 级那条（"开了模块之后界面真的画出来"）由 `e2e/tests/countdown.spec.ts`
 * 用真浏览器 + 截图负责，不在这里假充。
 *
 * 钉住的八条（每条都做过"能不能失败"，见文件末）：
 *   1. **顺序只有一份**：渲染顺序 = `sortEventsForDisplay` 的顺序
 *      （置顶 → 距今天数 → id 兜底），本层不再排一次。
 *   2. **逾期不飘红**（§2.7）：逾期卡与未逾期卡那个数字的**颜色逐字相同**。
 *   3. **档位没有"节假日"**（§2.2）：筛选条恰是 5 档，`holiday` 一个都不许出现。
 *   4. **归档 ≠ 删除**（§2.5）：点归档只发 `onArchive`，不发 `onRemove`。
 *   5. **一次保存 = 一个 op**：改一项 ⇒ `onPatch` 调**一次**且只带那一项。
 *   6. **没改就不发**：一条 op 都不该产生（空 op 会让对端时钟白进一格）。
 *   7. **日期与历法同一条 op**：只翻「农历」开关时，`date` 必须一起带上
 *      （`event-actions` 文件头第 1 条；拆开写会让"锚点是否按农历重算"分两条 op）。
 *   8. **失败不清草稿**（便签那条高危不复制）：`onAdd` 回 `false` 时文字仍在，
 *      而且 `error` 画出来了。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 「能不能失败」是这么问的（每条都在本轮实跑过，读数写在计划文档 W5 节）：
 *   ① 给 `sortEventsForDisplay` 追加第二个排序字段（`title` 字典序）⇒ 第 1 条红；
 *   ② 把 `pin` 那一段从三段里拿掉 ⇒ 第 1 条红；
 *   ③ 让 `face === 'since'` 走 `color.danger` ⇒ 第 2 条红；
 *   ④ 把归档实现成改 `deletedAt` ⇒ 第 4 条红
 *      （同时 `packages/app-host/tests/event-actions.spec.ts` 的「归档只写 archivedAt」也红）；
 *   ⑤ 让编辑器每个字段各发一次 setter（`onPatch` 被调多次）⇒ 第 5 条红；
 *   ⑥ 让"全都没改"也提交 ⇒ 第 6 条红；
 *   ⑦ 让 `isLunar` 单独出现在 patch 里 ⇒ 第 7 条红；
 *   ⑧ 让 `onAdd` 无条件清草稿 ⇒ 第 8 条红。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CountdownEvent } from '@heyta/domain';
import { translate, type I18nValue } from '@heyta/i18n';
import { EventBoard, HeytaUiProvider, type EventBoardProps, type EventEditPatch } from '@heyta/ui';

import { eventBoardLabels } from '../src/features/countdown/CountdownView.js';

/** 冻结的"今天"：2026-10-03。倒数日的天数全靠这一天，绝不让测试跟着墙上时钟走。 */
const TODAY = '2026-10-03';

const t: I18nValue['t'] = (key, vars) => translate('zh-CN', key, vars);

let seq = 0;
function ev(over: Partial<CountdownEvent> & { id: string }): CountdownEvent {
  seq += 1;
  return {
    title: `日子 ${String(seq)}`,
    date: '2026-12-31',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  seq = 0;
});

/** 所有回调都记下来；默认 `onAdd` 接受（第 8 条自己把它改成拒绝）。 */
function render(over: Partial<EventBoardProps> = {}): {
  el: HTMLElement;
  calls: {
    add: [string, string][];
    /**
     * 🔴 直接写 `EventEditPatch`，**不要**从 `EventBoardProps['onPatch']` 的参数位
     * `infer`：`strictFunctionTypes` 下逆变位置推出的是 `never`，于是 `push` 一条
     * 真 patch 就是 TS2345（本轮实测：`pnpm --filter @heyta/web typecheck` rc=2
     * 只红在这一行，而 vitest 不做类型检查 ⇒ 用例照绿，只有 typecheck 看得见）。
     */
    patch: [string, EventEditPatch][];
    pin: [string, boolean][];
    archive: string[];
    remove: string[];
  };
} {
  const calls = {
    add: [] as [string, string][],
    patch: [] as [string, EventEditPatch][],
    pin: [] as [string, boolean][],
    archive: [] as string[],
    remove: [] as string[],
  };
  const props: EventBoardProps = {
    events: [],
    today: TODAY,
    view: 'active',
    filter: 'all',
    columns: 1,
    onAdd: async (title, date) => {
      calls.add.push([title, date]);
      return true;
    },
    onPatch: (entityId, patch) => {
      calls.patch.push([entityId, patch]);
    },
    onTogglePinned: (entityId, pinned) => {
      calls.pin.push([entityId, pinned]);
    },
    onArchive: (entityId) => {
      calls.archive.push(entityId);
    },
    onUnarchive: vi.fn(),
    onRemove: (entityId) => {
      calls.remove.push(entityId);
    },
    onViewChange: vi.fn(),
    onFilterChange: vi.fn(),
    datePickerLabels: {
      weekdays: ['一', '二', '三', '四', '五', '六', '日'],
      monthTitle: () => '2026年10月',
      clear: '清除',
      prevMonth: '上个月',
      nextMonth: '下个月',
      dayLabel: (month, day) => `${String(month)}月${String(day)}日`,
    },
    labels: eventBoardLabels(t),
    ...over,
  };
  act(() => {
    root = createRoot(container as HTMLDivElement);
    root.render(
      <HeytaUiProvider>
        <EventBoard {...props} />
      </HeytaUiProvider>,
    );
  });
  return { el: container as HTMLElement, calls };
}

function byTestId(el: HTMLElement, id: string): HTMLElement | null {
  return el.querySelector(`[data-testid="${id}"]`);
}

/** 卡片渲染的先后（= 界面上的顺序）。 */
function cardOrder(el: HTMLElement): string[] {
  return [...el.querySelectorAll('[data-testid^="event-card-"]')].map(
    (node) => (node as HTMLElement).dataset.testid?.replace('event-card-', '') ?? '',
  );
}

async function tap(el: HTMLElement, id: string): Promise<void> {
  const node = byTestId(el, id);
  expect(node, `找不到 testID「${id}」`).not.toBeNull();
  await act(async () => {
    node?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function type(el: HTMLElement, id: string, value: string): Promise<void> {
  const input = byTestId(el, id) as HTMLInputElement | null;
  expect(input, `找不到输入框「${id}」`).not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('EventBoard（W5 卡片网格与二级操作）', () => {
  it('① 顺序只有一份：置顶在前 → 距今天数 → id 兜底（同一天两条按 id 字典序）', () => {
    const { el } = render({
      events: [
        ev({ id: 'c-same-b', date: '2026-10-10' }),
        ev({ id: 'a-same-a', date: '2026-10-10' }),
        ev({ id: 'z-pinned', date: '2026-12-31', pinnedAt: 1 }),
        ev({ id: 'm-near', date: '2026-10-05' }),
      ],
    });
    // 置顶那条永远第一；剩下按距今天数；**同一天**的两条靠 id 分段（缺第三段时
    // 这一对会随输入顺序变，正是"两台设备画出不同顺序"的形状）。
    expect(cardOrder(el)).toEqual(['z-pinned', 'm-near', 'a-same-a', 'c-same-b']);
  });

  it('② 逾期不飘红：那个数字的颜色与未逾期那条**逐字相同**', () => {
    const { el } = render({
      events: [ev({ id: 'future', date: '2026-12-31' }), ev({ id: 'past', date: '2026-01-01' })],
    });
    const future = byTestId(el, 'event-days-future');
    const past = byTestId(el, 'event-days-past');
    expect(future).not.toBeNull();
    expect(past).not.toBeNull();
    expect(past?.textContent).toBe('已经 275 天');
    expect(past?.getAttribute('style')).toBe(future?.getAttribute('style'));
    // 阳性对照：这条判据不是恒真 —— 颜色值确实被写进了 style，两处都非空。
    expect(past?.getAttribute('style') ?? '').toContain('color');
  });

  it('③ 筛选档位是 5 个，且没有「节假日」（§2.2：它不是用户实体）', () => {
    const { el } = render();
    const filters = [...el.querySelectorAll('[data-testid^="event-filter-"]')].map(
      (node) => (node as HTMLElement).dataset.testid ?? '',
    );
    expect(filters).toEqual([
      'event-filter-all',
      'event-filter-countdown',
      'event-filter-anniversary',
      'event-filter-birthday',
      'event-filter-festival',
    ]);
    expect(el.innerHTML).not.toContain('event-filter-holiday');
  });

  it('④ 归档 ≠ 删除：`⋯` 里点归档只发 archive，不发 remove', async () => {
    const { el, calls } = render({ events: [ev({ id: 'one' })] });
    await tap(el, 'event-menu-one');
    await tap(el, 'event-archive-one');
    expect(calls.archive).toEqual(['one']);
    expect(calls.remove).toEqual([]);
  });

  it('⑤ 一次保存 = 一个 op，只带改过的那几项', async () => {
    const { el, calls } = render({ events: [ev({ id: 'one', title: '原名', date: '2026-12-31' })] });
    await tap(el, 'event-menu-one');
    await tap(el, 'event-edit-open-one');
    await type(el, 'event-editor-title-one', '改名');
    await tap(el, 'event-editor-kind-birthday-one');
    await tap(el, 'event-editor-save-one');
    // 🔴 **改两项**才有牙：只改一项时"合并成一条"与"每个字段各发一条"的
    // 调用次数都是 1，这条判据会一样绿（本轮实测出来的形状）。
    expect(calls.patch).toHaveLength(1);
    expect(calls.patch[0]?.[1]).toEqual({ title: '改名', kind: 'birthday' });
  });

  it('⑥ 什么都没改就点保存 ⇒ 一条 op 都不发', async () => {
    const { el, calls } = render({ events: [ev({ id: 'one', title: '原名' })] });
    await tap(el, 'event-menu-one');
    await tap(el, 'event-edit-open-one');
    await tap(el, 'event-editor-save-one');
    expect(calls.patch).toEqual([]);
  });

  it('⑦ 只翻「农历」开关 ⇒ date 必须一起带上（同一条 op）', async () => {
    const { el, calls } = render({
      events: [ev({ id: 'one', date: '2026-12-31', isLunar: false })],
    });
    await tap(el, 'event-menu-one');
    await tap(el, 'event-edit-open-one');
    await tap(el, 'event-editor-lunar-one');
    await tap(el, 'event-editor-save-one');
    expect(calls.patch[0]?.[1]).toEqual({ date: '2026-12-31', isLunar: true });
  });

  it('⑧ 新建失败：草稿一个字都不清，而且错误画得出来', async () => {
    const { el, calls } = render({
      onAdd: async (title, date) => {
        calls.add.push([title, date]);
        return false;
      },
    });
    await tap(el, 'event-pick-date');
    await tap(el, 'event-date-picker');
    // 选日期：共享 DatePicker 的格子有完整日期的无障碍名，直接点"31"那天。
    const day = el.querySelector('[aria-label="10月31日"]') as HTMLElement | null;
    expect(day).not.toBeNull();
    await act(async () => {
      day?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await type(el, 'event-title-input', '只想写一半');
    await tap(el, 'event-add');
    expect(calls.add).toHaveLength(1);
    // 🔴 失败之后输入框里**还是那句话**（便签的旧行为是把字吃掉）。
    expect((byTestId(el, 'event-title-input') as HTMLInputElement | null)?.value).toBe(
      '只想写一半',
    );
  });

  it('⑧b 动作层报的错误必须看得见（不静默）', () => {
    const { el } = render({ error: '倒数日标题不能为空（空白也算空）' });
    expect(byTestId(el, 'event-error')?.textContent).toContain('倒数日标题不能为空');
  });

  it('⑨ 两列时末行补等宽占位，一张孤卡不会横铺整行', () => {
    const { el } = render({ columns: 2, events: [ev({ id: 'x' }), ev({ id: 'y' }), ev({ id: 'z' })] });
    const secondRow = byTestId(el, 'event-row-1');
    expect(secondRow?.querySelectorAll('[data-testid^="event-cell-"]')).toHaveLength(1);
    // 占位格数 = 2 - 1 = 1；它没有 testID（只有 flex:1 的空 View），所以按子节点数算。
    expect(secondRow?.childElementCount).toBe(2);
  });

  it('⑩ 归档视图里只给「还原 / 删除」，不给编辑与归档', async () => {
    const { el, calls } = render({
      view: 'archived',
      events: [ev({ id: 'gone', archivedAt: 1 })],
    });
    expect(byTestId(el, 'event-card-gone')).not.toBeNull();
    await tap(el, 'event-menu-gone');
    expect(byTestId(el, 'event-unarchive-gone')).not.toBeNull();
    expect(byTestId(el, 'event-edit-open-gone')).toBeNull();
    await tap(el, 'event-remove-gone');
    expect(calls.remove).toEqual(['gone']);
  });
});
