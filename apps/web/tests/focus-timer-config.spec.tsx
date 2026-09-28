/**
 * 番茄钟时长设置**真的接到了界面上**
 * ====================================
 *
 * 🔴 这个文件钉的不是"一个组件能渲染"，而是一处**接线**。
 *
 * `useFocusStore.setConfig()` 一直存在、一直正确，但**零调用点** ——
 * 时长永远 25/5/15。这是本仓库最高发的一类失效：**零件全在、最后一米没接**
 * （见 `docs/research/dida365-feature-benchmark.md` §3 的 13 项同类）。
 *
 * 所以这里断言的是**从用户动作出发**的整条链：
 * 在输入框里打字 → 失焦 → `setConfig` 被调用 → 持久化层读得回新值。
 * 纯逻辑测试（`focus-config.spec.ts`）覆盖不到"界面到底有没有调它"。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_FOCUS_CONFIG } from '@heyta/domain';
import { I18nProvider } from '@heyta/i18n';
// M3 第二刀之后，`FocusTimer` 的计时核心来自 `@heyta/ui` 的共享 `FocusPanel`，
// 而共享组件从 context 取 token —— 所以这里必须挂 `HeytaUiProvider`。
// 应用里它是挂在 `App.tsx` 最外层的（`check:ui-provider` 盯着这件事）。
import { HeytaUiProvider } from '@heyta/ui';

// 只替换任务 store（时长设置与它无关，但 FocusTimer 会读它渲染"关联任务"下拉）。
// 其余跑真实实现 —— 尤其 **focus store 是真的**，否则这条测试就只是在验证 mock。
vi.mock('../src/features/tasks/store.js', () => ({
  useTaskStore: () => ({ entities: { tasks: {} } }),
}));

const { __clearFocusConfigForTests, loadFocusConfig } = await import('../src/lib/focus-config.js');
const { __resetFocusForTests, useFocusStore } = await import('../src/features/focus/store.js');
const { FocusTimer } = await import('../src/features/focus/FocusTimer.js');

const MINUTE_MS = 60_000;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  __clearFocusConfigForTests();
  __resetFocusForTests();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <HeytaUiProvider>
          <FocusTimer />
        </HeytaUiProvider>
      </I18nProvider>,
    );
  });
  return container;
}

/** 按时长设置里那一项的可访问名找输入框（不用 CSS 类，类名会漂移）。 */
function durationInput(el: HTMLElement, label: string): HTMLInputElement {
  const input = el.querySelector<HTMLInputElement>(`input[aria-label^="${label}"]`);
  expect(input, `没找到「${label}」的输入框 —— 时长设置没渲染出来`).not.toBeNull();
  return input!;
}

function type(el: HTMLInputElement, value: string): void {
  act(() => {
    // React 的受控输入靠原生 setter + input 事件，直接改 `.value` 不会触发 onChange
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function blur(el: HTMLInputElement): void {
  act(() => {
    /**
     * 🔴 派发的是 **`focusout`**，不是 `blur`。
     *
     * React 17 起把 `onBlur` 挂在原生的 **`focusout`**（冒泡）上，而不是
     * 不冒泡的 `blur`。派发 `blur` 不会触发 `onBlur`，症状是"测试里改了输入框
     * 但什么都没发生" —— 而真实浏览器里是好的，所以很容易被误读成组件有 bug。
     */
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

describe('番茄钟时长设置', () => {
  it('🔴 四个时长都在界面上（在此之前一个都没有，时长永远 25/5/15）', async () => {
    const el = await mount();
    expect(durationInput(el, '专注').value).toBe('25');
    expect(durationInput(el, '短休息').value).toBe('5');
    expect(durationInput(el, '长休息').value).toBe('15');
    expect(durationInput(el, '长休息间隔').value).toBe('4');
  });

  it('🔴 改「专注」到 40 分钟：store 变了、下一轮按 40 走、并且落了盘', async () => {
    const el = await mount();
    const input = durationInput(el, '专注');

    type(input, '40');
    blur(input);

    expect(useFocusStore.getState().config.workMs).toBe(40 * MINUTE_MS);

    // "真的生效"的判据取 `plannedMs` —— 进度环与落盘的 FocusSession 都用它。
    act(() => {
      useFocusStore.getState().start();
    });
    expect(useFocusStore.getState().state.plannedMs).toBe(40 * MINUTE_MS);

    // 刷新后还在：等价于下一次冷启动时 store 初始化读到的东西
    expect(loadFocusConfig().workMs).toBe(40 * MINUTE_MS);
  });

  it('🔴 打越界值被夹到边界，而不是被拒绝或原样写进去', async () => {
    const el = await mount();
    const input = durationInput(el, '专注');

    type(input, '0');
    blur(input);
    expect(useFocusStore.getState().config.workMs).toBe(1 * MINUTE_MS);

    type(input, '99999');
    blur(input);
    expect(useFocusStore.getState().config.workMs).toBe(180 * MINUTE_MS);
    // 夹取后的值必须回显到输入框 —— 夹了但不告诉用户，等于悄悄改了他的输入
    expect(durationInput(el, '专注').value).toBe('180');
  });

  it('🔴 清空输入框保留原值，而不是把它重置成默认值', async () => {
    const el = await mount();
    const input = durationInput(el, '专注');

    type(input, '40');
    blur(input);
    expect(useFocusStore.getState().config.workMs).toBe(40 * MINUTE_MS);

    type(input, '');
    blur(input);
    expect(useFocusStore.getState().config.workMs).toBe(40 * MINUTE_MS);
    expect(durationInput(el, '专注').value).toBe('40');
  });

  it('🔴 计时进行中：输入框禁用，并且**说明为什么**（不是静默灰掉）', async () => {
    const el = await mount();

    act(() => {
      useFocusStore.getState().start();
    });

    /**
     * 🔴 判据是 `:disabled`，**不是 `input.disabled`**。
     *
     * 禁用是加在 `<fieldset>` 上的，而 `input.disabled` 是**元素自己的**
     * IDL 属性 —— fieldset 继承过来的禁用状态不会写进它，于是
     * `input.disabled` 仍然是 `false`。用 `:disabled` 才是"用户能不能操作它"
     * 这个真实判据（jsdom 的 nwsapi 支持它）。
     */
    expect(durationInput(el, '专注').matches(':disabled')).toBe(true);
    expect(el.textContent ?? '').toContain('计时进行中不能改时长');
    // 值没有被改动
    expect(useFocusStore.getState().config.workMs).toBe(DEFAULT_FOCUS_CONFIG.workMs);
  });
});
