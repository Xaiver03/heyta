/**
 * 共享按钮原语 `@heyta/ui` 的 `Button`
 * ====================================
 *
 * 这个文件守四件事（都是"看起来对、其实没接线"的高危格）：
 *
 *   1. **色调真的换了底** —— 只断言"渲染出一个 role=button" 等于什么都没测：
 *      `.ht-btn` 那 210 处手写类名之所以能活这么久，正是因为"看起来是按钮"
 *      从不需要任何判据。所以这里按 `CONTROL_PALETTE` 的两档比较**算出来的底色**。
 *   2. **禁用真的吞掉点击** —— 视觉上的灰可以用 CSS 假装，行为不行。
 *   3. **状态真的发到了 `aria-*`** —— `controlAria()` 那套平铺映射是
 *      RNW 0.21 上唯一有效的写法（对象形态会被整个丢掉），所以按属性断言。
 *   4. **`busy` 与 `disabled` 不是一回事** —— 前者还在动，后者不会回来；
 *      两者都不许把点击送出去。
 *
 * ⚠️ 真实像素与按下缩放的最终观感**不在这里**：jsdom 没有布局。那是
 * `scripts/verify-universal-slice.sh` 与 web 验收的事。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Button, HeytaUiProvider } from '@heyta/ui';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(ui: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(<HeytaUiProvider>{ui}</HeytaUiProvider>);
  });
}

function button(): HTMLElement {
  const element = container.querySelector<HTMLElement>('[role="button"]');
  if (element === null) throw new Error('没有渲染出 role="button"');
  return element;
}

/**
 * RNW 0.21 把 `StyleSheet` 编译成**原子类**（不是内联 style），
 * 所以底色要读计算值 —— 读 `element.style` 会永远得到空串，
 * 而"永远得到空串"的断言只会测出自己。
 */
function background(element: HTMLElement): string {
  return getComputedStyle(element).backgroundColor;
}

describe('Button', () => {
  it('渲染出 role=button、判据钩子与可见文字', async () => {
    await render(<Button label="保存" testID="save" onPress={() => {}} />);

    expect(button().getAttribute('data-testid')).toBe('save');
    expect(button().textContent).toBe('保存');
  });

  it('色调不同 ⇒ 底色不同（证明接的是 CONTROL_PALETTE，不是写死的灰）', async () => {
    await render(
      <>
        <Button label="主" tone="primary" testID="p" />
        <Button label="次" tone="secondary" testID="s" />
        <Button label="幽灵" tone="ghost" testID="g" />
      </>,
    );

    const primary = container.querySelector<HTMLElement>('[data-testid="p"]')!;
    const secondary = container.querySelector<HTMLElement>('[data-testid="s"]')!;
    const ghost = container.querySelector<HTMLElement>('[data-testid="g"]')!;

    expect(background(primary)).not.toBe('');
    expect(background(primary)).not.toBe(background(secondary));
    // `transparent` 在浏览器里算出来是 `rgba(0, 0, 0, 0)`，两种写法都认。
    expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(background(ghost));
  });

  it('disabled 发 aria-disabled 且不触发 onPress', async () => {
    const onPress = vi.fn();
    await render(<Button label="删" tone="danger" disabled testID="d" onPress={onPress} />);

    expect(button().getAttribute('aria-disabled')).toBe('true');
    button().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('busy 发 aria-busy 且吞掉点击（它与 disabled 不是同一件事）', async () => {
    const onPress = vi.fn();
    await render(<Button label="重试" busy testID="b" onPress={onPress} />);

    expect(button().getAttribute('aria-busy')).toBe('true');
    /*
      🔴 `aria-disabled` 在这一条上**不**作断言：`busy` 期间 RNW 会把一个
      `disabled` 的 Pressable 标成 `aria-disabled="true"` —— 那是它对的判断
      （这一刻确实按不动），不是我们要修的东西。要钉的是"点击被吞掉"。
    */
    button().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('pressed / selected 走 controlAria 的平铺属性', async () => {
    await render(
      <>
        <Button label="开关" pressed testID="t" />
        <Button label="页签" selected selection="tab" testID="tab" />
        <Button label="导航" selected selection="nav" testID="nav" />
      </>,
    );

    expect(container.querySelector('[data-testid="t"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="tab"]')!.getAttribute('aria-selected')).toBe('true');
    // nav 那一档发 `aria-current="page"`，不是 `aria-selected`。
    expect(container.querySelector('[data-testid="nav"]')!.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('[data-testid="nav"]')!.getAttribute('aria-selected')).toBeNull();
  });

  it('可点时真的会回吐 onPress（正向对照 —— 否则上面几条"没调用"永远为真）', async () => {
    const onPress = vi.fn();
    await render(<Button label="好" testID="ok" onPress={onPress} />);

    button().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
