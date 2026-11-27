/**
 * 日历「显示设置」弹窗（Web）—— 分组结构、接线与三条关闭通道
 * ============================================================
 *
 * 这一档的判据全部是**渲染出来的 DOM 与 store 读数**：
 *
 *   1. 四块分组卡片、每组的行数与顺序（颜色 / 样式 / 三个开关 / 四个开关 / 时区）；
 *   2. 类名逐条对应 `calendar-display.css`（拼错不会报错，只会悄悄没样式）；
 *   3. 分段选择写回 `colorMode` / `displayStyle`，开关写回各自字段；
 *   4. `?` 按钮翻转 `data-open`（提示气泡的显隐契约住在 CSS 里）；
 *   5. Esc / 点背景 / × 三条出口都能关掉 —— 走共享壳的 `modal-readonly` 策略。
 *
 * ⚠️ 不测颜色、圆角、间距：那些归 `check:design` 与对比度测试。
 * ⚠️ 也没有内联 `style`：`check:l4` 对 `features/**` 的判据是零容忍。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, translate } from '@heyta/i18n';

import { CalendarDisplaySettingsModal } from '../src/features/calendar/CalendarDisplaySettingsModal.js';
import { useCalendarViewStore } from '../src/features/calendar/store.js';

const ROOT = 'ht-content__calendar-display';
const t = (key: Parameters<typeof translate>[1]): string => translate('zh-CN', key);

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function resetStore(): void {
  useCalendarViewStore.setState({
    displaySettingsOpen: true,
    colorMode: 'project',
    displayStyle: 'classic',
    showCompleted: true,
    showChecklist: false,
    showAllRepeats: true,
    showHabits: true,
    showFocus: true,
    showCountdown: true,
    showCourses: true,
    secondaryTimezone: false,
  });
}

function render(): void {
  resetStore();
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container!);
    root.render(
      <I18nProvider locale="zh-CN">
        <CalendarDisplaySettingsModal />
      </I18nProvider>,
    );
  });
}

function modal(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="calendar-display-modal"]');
}

function byId(testId: string): HTMLElement | null {
  return modal()?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? null;
}

function click(el: Element | null): void {
  expect(el, '要点的控件不在 DOM 里').not.toBeNull();
  act(() => {
    (el as HTMLElement).click();
  });
}

function pressEscape(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

beforeEach(resetStore);

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('结构：四块白色圆角分组', () => {
  it('四组卡片、行数依次是 2 / 3 / 4 / 1，标题与关闭按钮都在', () => {
    render();
    const groups = modal()!.querySelectorAll(`.${ROOT}__group`);
    expect(groups).toHaveLength(4);
    expect([...groups].map((group) => group.querySelectorAll(`.${ROOT}__row`).length)).toEqual([
      2, 3, 4, 1,
    ]);
    expect(modal()!.querySelector(`.${ROOT}__title`)?.textContent).toBe(
      t('web.calendar.display.title'),
    );
    expect(byId('calendar-display-close')?.getAttribute('aria-label')).toBe(
      t('web.calendar.display.close'),
    );
    expect(modal()!.querySelector(`.${ROOT}__groups`)).not.toBeNull();
    expect(modal()!.querySelector(`.${ROOT}__header`)).not.toBeNull();
  });

  it('🔴 组内每一行都是「label + 控件」，没有一行只剩文字', () => {
    render();
    for (const row of modal()!.querySelectorAll(`.${ROOT}__row`)) {
      expect(row.querySelector(`.${ROOT}__label`), '这一行没有 label').not.toBeNull();
      const hasControl =
        row.querySelector(`.${ROOT}__segmented`) !== null ||
        row.querySelector('.hta-switch__control') !== null;
      expect(hasControl, '这一行没有可操作的控件').toBe(true);
    }
  });

  it('类名逐条来自 calendar-display.css（含遮罩与面板两层）', () => {
    render();
    expect(document.querySelector(`.${ROOT}-scrim`)).not.toBeNull();
    expect(modal()?.classList.contains(ROOT)).toBe(true);
    for (const name of [
      '__header',
      '__title',
      '__close',
      '__groups',
      '__group',
      '__row',
      '__label',
      '__segmented',
      '__segment',
      '__help-wrap',
      '__help',
      '__tip',
    ]) {
      expect(modal()!.querySelector(`.${ROOT}${name}`), `${name} 没渲染`).not.toBeNull();
    }
  });

  it('🔴 整层没有任何内联 style（check:l4 的判据）', () => {
    render();
    expect(modal()!.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('关掉时不挂载任何 DOM', () => {
    render();
    act(() => {
      useCalendarViewStore.getState().setDisplaySettingsOpen(false);
    });
    expect(modal()).toBeNull();
    expect(document.querySelector(`.${ROOT}-scrim`)).toBeNull();
  });
});

describe('组 1：颜色与样式', () => {
  it('颜色分段：默认按清单；点「按象限」写回 store 且选中态只有一枚', () => {
    render();
    const project = byId('calendar-display-color-project');
    const quadrant = byId('calendar-display-color-quadrant');
    expect(project?.getAttribute('aria-checked')).toBe('true');
    expect(quadrant?.getAttribute('aria-checked')).toBe('false');

    click(quadrant);
    expect(useCalendarViewStore.getState().colorMode).toBe('quadrant');
    expect(quadrant?.getAttribute('aria-checked')).toBe('true');
    expect(project?.getAttribute('aria-checked')).toBe('false');
    expect(quadrant!.parentElement!.querySelectorAll('[aria-checked="true"]')).toHaveLength(1);
  });

  it('样式分段：点「现代」写回 displayStyle', () => {
    render();
    click(byId('calendar-display-style-modern'));
    expect(useCalendarViewStore.getState().displayStyle).toBe('modern');
    expect(byId('calendar-display-style-modern')?.getAttribute('aria-checked')).toBe('true');
    expect(byId('calendar-display-style-classic')?.getAttribute('aria-checked')).toBe('false');
  });

  it('分段文案来自词条表，不是键名、也不是硬编码', () => {
    render();
    for (const [testId, key] of [
      ['calendar-display-color-project', 'web.calendar.display.colorByProject'],
      ['calendar-display-color-quadrant', 'web.calendar.display.colorByQuadrant'],
      ['calendar-display-style-classic', 'web.calendar.display.styleClassic'],
      ['calendar-display-style-modern', 'web.calendar.display.styleModern'],
    ] as const) {
      expect(byId(testId)?.textContent).toBe(t(key));
    }
  });
});

describe('组 2 / 组 3 / 组 4：开关', () => {
  const switches = [
    ['calendar-display-show-completed', 'showCompleted', true],
    ['calendar-display-show-checklist', 'showChecklist', false],
    ['calendar-display-show-all-repeats', 'showAllRepeats', true],
    ['calendar-display-show-habits', 'showHabits', true],
    ['calendar-display-show-focus', 'showFocus', true],
    ['calendar-display-show-countdown', 'showCountdown', true],
    ['calendar-display-show-courses', 'showCourses', true],
    ['calendar-display-secondary-timezone', 'secondaryTimezone', false],
  ] as const;

  it('🔴 每一枚开关都写回自己那个字段，且只写自己那个', () => {
    render();
    for (const [testId, field, initial] of switches) {
      const control = byId(testId)?.querySelector<HTMLElement>('[role="switch"]');
      expect(control, `${testId} 没渲染成开关`).not.toBeNull();
      expect(control!.getAttribute('aria-checked')).toBe(String(initial));
      const before = useCalendarViewStore.getState();
      click(control!);
      expect(useCalendarViewStore.getState()[field], `${field} 没有跟着开关走`).toBe(!initial);
      // 其余字段不许被顺手改掉（对照的是**这一次点击之前**的读数）。
      for (const [otherId, otherField] of switches) {
        if (otherField === field) continue;
        expect(useCalendarViewStore.getState()[otherField], `${otherId} 被误改`).toBe(
          before[otherField],
        );
      }
    }
  });

  it('开关的可及名就是那一行的文字', () => {
    render();
    for (const [testId, , , key] of [
      ['calendar-display-show-completed', 'showCompleted', true, 'web.calendar.more.showCompleted'],
      ['calendar-display-show-checklist', 'showChecklist', false, 'web.calendar.display.showChecklist'],
      ['calendar-display-show-all-repeats', 'showAllRepeats', true, 'web.calendar.display.showAllRepeats'],
      ['calendar-display-show-habits', 'showHabits', true, 'web.calendar.display.showHabits'],
      ['calendar-display-show-focus', 'showFocus', true, 'web.calendar.display.showFocus'],
      ['calendar-display-show-countdown', 'showCountdown', true, 'web.calendar.more.showCountdown'],
      ['calendar-display-show-courses', 'showCourses', true, 'web.calendar.display.showCourses'],
      [
        'calendar-display-secondary-timezone',
        'secondaryTimezone',
        false,
        'web.calendar.display.secondaryTimezone',
      ],
    ] as const) {
      expect(
        byId(testId)?.querySelector('[role="switch"]')?.getAttribute('aria-label'),
        `${testId} 的可及名不对`,
      ).toBe(t(key));
    }
  });
});

describe('`?` 按钮：提示气泡切换', () => {
  it('专注记录：点一次打开、再点一次收起，气泡文字来自词条表', () => {
    render();
    const wrap = byId('calendar-display-show-focus-help')!.parentElement!;
    expect(wrap.getAttribute('data-open')).toBe('false');
    expect(byId('calendar-display-show-focus-help')!.getAttribute('aria-expanded')).toBe('false');

    click(byId('calendar-display-show-focus-help'));
    expect(wrap.getAttribute('data-open')).toBe('true');
    expect(byId('calendar-display-show-focus-help')!.getAttribute('aria-expanded')).toBe('true');
    expect(modal()!.querySelector(`.${ROOT}__tip`)?.textContent).toBe(
      t('web.calendar.display.showFocusTip'),
    );

    click(byId('calendar-display-show-focus-help'));
    expect(wrap.getAttribute('data-open')).toBe('false');
  });

  it('辅助时区：自己那枚气泡独立切换；开第二枚时第一枚收起', () => {
    render();
    const focusWrap = byId('calendar-display-show-focus-help')!.parentElement!;
    const zoneWrap = byId('calendar-display-secondary-timezone-help')!.parentElement!;

    click(byId('calendar-display-show-focus-help'));
    expect(focusWrap.getAttribute('data-open')).toBe('true');

    click(byId('calendar-display-secondary-timezone-help'));
    expect(zoneWrap.getAttribute('data-open')).toBe('true');
    expect(focusWrap.getAttribute('data-open')).toBe('false');
    expect(
      modal()!.querySelector('#calendar-display-timezone-tip')?.textContent,
    ).toBe(t('web.calendar.display.secondaryTimezoneTip'));
  });
});

describe('三条关闭通道', () => {
  it('Esc 关掉，并把 store 的开关拨回 false', () => {
    render();
    pressEscape();
    expect(useCalendarViewStore.getState().displaySettingsOpen).toBe(false);
    expect(modal()).toBeNull();
  });

  it('点背景（遮罩）关掉', () => {
    render();
    const scrim = document.querySelector(`.${ROOT}-scrim`);
    expect(scrim).not.toBeNull();
    act(() => {
      scrim!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(useCalendarViewStore.getState().displaySettingsOpen).toBe(false);
    expect(modal()).toBeNull();
  });

  it('点面板内部**不**关（背景判定必须看 target === currentTarget）', () => {
    render();
    act(() => {
      modal()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(useCalendarViewStore.getState().displaySettingsOpen).toBe(true);
    expect(modal()).not.toBeNull();
  });

  it('× 按钮关掉', () => {
    render();
    click(byId('calendar-display-close'));
    expect(useCalendarViewStore.getState().displaySettingsOpen).toBe(false);
    expect(modal()).toBeNull();
  });
});
