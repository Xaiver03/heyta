/**
 * Radix 组件壳语义测试
 * ====================
 *
 * 只有一件事要证明：**这 4 个壳真的换成了 Radix 的语义实现**，而不是又一个手写
 * `role`/`aria-*` 的仿件。判据全部读 Radix 才会自动产出的那些属性：
 *
 *   · Switch  → `role="switch"` + `aria-checked` 随点击翻转
 *   · Checkbox→ `role="checkbox"` + `aria-checked` 随点击翻转
 *   · Tabs    → `role="tablist"` / `role="tab"` + 选中项 `aria-selected="true"`（且随点击移动）
 *   · Tooltip → 触发后真的出现 `role="tooltip"`
 *
 * 每条断言都能失败：把组件换回手写实现时，`aria-checked`/`aria-selected` 的翻转
 * 或 `role="tooltip"` 的出现就会落空。
 */

import { useState, type ReactElement, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Checkbox, Popover, RadioGroup, Switch, Tabs, Tooltip } from '../src/components/hta/index.js';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

/** jsdom 没有 ResizeObserver，而 Radix 的 Popper 浮层（Tooltip/Popover）会用它做定位。 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
});

function render(node: ReactNode): void {
  act(() => {
    root!.render(node);
  });
}

/**
 * 一次「点」。Radix 的激活点不同：Switch / Checkbox 走 `onClick`，
 * Tabs 触发器走 `onMouseDown`，所以两个事件都发一遍（真实点击本来也是
 * mousedown → mouseup → click 这一串）。
 */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function SwitchHarness(): ReactElement {
  const [checked, setChecked] = useState(false);
  return <Switch checked={checked} onChange={setChecked} label="即时开关" />;
}

function CheckboxHarness(): ReactElement {
  const [checked, setChecked] = useState(false);
  return <Checkbox label="记住我" checked={checked} onChange={setChecked} />;
}

function TabsHarness(): ReactElement {
  const [value, setValue] = useState('one');
  return (
    <Tabs
      label="切换面"
      value={value}
      onChange={setValue}
      tabs={[
        { key: 'one', label: '第一个' },
        { key: 'two', label: '第二个' },
      ]}
    />
  );
}

function RadioHarness(): ReactElement {
  const [value, setValue] = useState('a');
  return (
    <RadioGroup
      name="pick"
      legend="选一个"
      value={value}
      onChange={setValue}
      options={[
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
      ]}
    />
  );
}

describe('Radix 组件壳语义', () => {
  it('Switch：role="switch"，aria-checked 从 false 变 true', () => {
    render(<SwitchHarness />);
    const sw = container!.querySelector('[role="switch"]');
    expect(sw).not.toBeNull();
    expect(sw!.getAttribute('aria-checked')).toBe('false');

    click(sw!);

    expect(sw!.getAttribute('aria-checked')).toBe('true');
  });

  it('Checkbox：role="checkbox"，aria-checked 从 false 变 true', () => {
    render(<CheckboxHarness />);
    const box = container!.querySelector('[role="checkbox"]');
    expect(box).not.toBeNull();
    expect(box!.getAttribute('aria-checked')).toBe('false');

    click(box!);

    expect(box!.getAttribute('aria-checked')).toBe('true');
  });

  it('Tabs：tablist / tab 语义齐备，aria-selected 随点击移动', () => {
    render(<TabsHarness />);
    expect(container!.querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = Array.from(container!.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(2);

    // 初始选中第一枚
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('false');

    click(tabs[1]!);

    expect(tabs[0]!.getAttribute('aria-selected')).toBe('false');
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
  });

  it('RadioGroup：radiogroup / radio 语义齐备，aria-checked 随点击移动', () => {
    render(<RadioHarness />);
    expect(container!.querySelector('[role="radiogroup"]')).not.toBeNull();
    const radios = Array.from(container!.querySelectorAll('[role="radio"]'));
    expect(radios).toHaveLength(2);

    expect(radios[0]!.getAttribute('aria-checked')).toBe('true');
    expect(radios[1]!.getAttribute('aria-checked')).toBe('false');

    click(radios[1]!);

    expect(radios[0]!.getAttribute('aria-checked')).toBe('false');
    expect(radios[1]!.getAttribute('aria-checked')).toBe('true');
  });

  it('Tooltip：触发后出现 role="tooltip"', () => {
    render(
      <Tooltip content="这是提示" delayDuration={0}>
        <button type="button">触发</button>
      </Tooltip>,
    );

    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

    const trigger = container!.querySelector('button');
    expect(trigger).not.toBeNull();
    act(() => {
      (trigger as HTMLElement).focus();
    });

    const tip = document.body.querySelector('[role="tooltip"]');
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toContain('这是提示');
  });

  it('Popover：点开触发出现挂到 body 的浮层内容（data-state="open"）', () => {
    render(
      <Popover trigger={<button type="button">打开</button>}>
        <p>浮层正文</p>
      </Popover>,
    );

    const trigger = container!.querySelector('button');
    expect(trigger).not.toBeNull();

    act(() => {
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const panel = document.body.querySelector('.hta-popover');
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('data-state')).toBe('open');
    expect(panel!.textContent).toContain('浮层正文');
  });
});
