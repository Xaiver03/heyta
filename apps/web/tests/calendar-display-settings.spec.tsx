/**
 * 日历 ⋯ 菜单 → 「显示设置」/「日历订阅」入口的渲染判据（覆盖图谱 #40 / #41）
 * ==========================================================================
 *
 * 为什么要这一条（而不是只测模型）：覆盖图谱钉的是**用户点得到那个入口**。
 * 模型能算对配色，但入口若没接到 ⋯ 菜单里，用户根本点不到 —— 那是两件事。
 *
 * 只断言最小、最稳定的事实：
 * 1. ⋯ 菜单里有「显示设置」与「日历订阅」两项（C12 的靶子就是这两个入口）；
 * 2. 点「显示设置」真的打开抽屉，且抽屉里有配色单选（三档）+ 两个开关。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HeytaUiProvider } from '@heyta/ui';

const { CalendarHeaderToolbar } = await import('../src/features/calendar/CalendarHeaderToolbar.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(selector: string): Promise<Element> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = document.querySelector(selector);
    if (found !== null) return found;
    await flush();
  }
  throw new Error(`等不到元素：${selector}`);
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('日历 ⋯ 菜单的两个新入口', () => {
  it('菜单里有「显示设置」与「日历订阅」，点显示设置打开抽屉（含配色三档 + 两开关）', async () => {
    await act(async () => {
      root?.render(
        <LocaleHost>
          <HeytaUiProvider>
            <CalendarHeaderToolbar timelineEnabled={false} onOpenTimeline={() => {}} />
          </HeytaUiProvider>
        </LocaleHost>,
      );
    });
    await flush();

    // 打开 ⋯ 菜单（portal 到 body）。
    const trigger = container!.querySelector<HTMLButtonElement>('[data-testid="calendar-menu-open"]');
    expect(trigger, '找不到 ⋯ 按钮').not.toBeNull();
    await act(async () => {
      trigger!.click();
    });
    await flush();

    const displayEntry = await waitFor('[data-testid="calendar-open-display-settings"]');
    expect(displayEntry.textContent).toContain('显示设置');
    const subEntry = document.querySelector('[data-testid="calendar-open-subscriptions"]');
    expect(subEntry, '⋯ 菜单里没有「日历订阅」入口').not.toBeNull();
    expect(subEntry!.textContent).toContain('日历订阅');

    // 点「显示设置」→ 抽屉打开。
    await act(async () => {
      (displayEntry as HTMLElement).click();
    });
    await flush();

    const sheet = await waitFor('[data-testid="calendar-display-settings"]');
    expect(sheet, '显示设置抽屉没打开').not.toBeNull();
    // 配色：三档单选（Radix RadioGroup 渲染成 role="radio"，不是原生 input）。
    expect(document.querySelector('[data-testid="calendar-color-by"]')).not.toBeNull();
    const radios = document.querySelectorAll('[data-testid="calendar-color-by"] [role="radio"]');
    expect(radios.length).toBe(3);
    // 两个开关。
    expect(document.querySelector('[data-testid="calendar-display-show-completed"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="calendar-display-show-countdown"]')).not.toBeNull();
  });
});
