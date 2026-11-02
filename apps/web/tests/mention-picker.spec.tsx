/**
 * `@` 候选与芯片条
 * =================
 *
 * 这里只测**展示契约**：纯逻辑（语法 / 候选 / 消歧 / 投影）已经在
 * `@heyta/domain` 的 23 + 32 + 13 条测试里钉住，重复测一遍不会多拦住任何东西。
 *
 * 三条本文件的判据：
 * 1. 高亮项由调用方给（`activeIndex`），组件不许自己记 —— 键盘在面板那一层。
 * 2. **用 `mousedown` 而不是 `click`**：textarea 的 blur 先于 click，
 *    click 永远收不到（这是这行的存在理由，不是风格）。
 * 3. 对不上的 @ **必须画出来**，并标 `data-resolved="false"` —— 不渲染等于替用户删字。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MentionTaskCandidate } from '@heyta/domain';

const { MentionPicker, MentionChips } = await import('../src/features/ai/MentionPicker.js');

const CANDIDATES: readonly MentionTaskCandidate[] = [
  { taskId: 'a', title: '买牛奶', label: '买牛奶' },
  { taskId: 'b', title: '开会', label: '开会（08-15）', suffix: '08-15' },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactNode): void {
  act(() => root.render(node));
}

describe('候选列表', () => {
  it('渲染每个候选；有后缀的显示后缀', () => {
    render(<MentionPicker candidates={CANDIDATES} activeIndex={0} onPick={() => {}} onHover={() => {}} />);
    const options = container.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toContain('买牛奶');
    expect(options[1]?.textContent).toContain('08-15');
  });

  it('高亮跟着 activeIndex 走（组件自己不许记状态）', () => {
    render(<MentionPicker candidates={CANDIDATES} activeIndex={1} onPick={() => {}} onHover={() => {}} />);
    const options = container.querySelectorAll('[role="option"]');
    expect(options[0]?.getAttribute('aria-selected')).toBe('false');
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('🔴 mousedown 就选中（click 在这里永远收不到）', () => {
    const onPick = vi.fn();
    render(<MentionPicker candidates={CANDIDATES} activeIndex={0} onPick={onPick} onHover={() => {}} />);
    const option = container.querySelectorAll('[role="option"]')[0];
    act(() => {
      option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]?.[0]).toEqual(CANDIDATES[0]);
  });

  it('空候选不渲染（一个空浮层挡住输入框比不弹更难用）', () => {
    render(<MentionPicker candidates={[]} activeIndex={0} onPick={() => {}} onHover={() => {}} />);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('鼠标悬停把高亮交给调用方', () => {
    const onHover = vi.fn();
    render(<MentionPicker candidates={CANDIDATES} activeIndex={0} onPick={() => {}} onHover={onHover} />);
    const option = container.querySelectorAll('[role="option"]')[1];
    act(() => {
      // ⚠️ React 把 `onMouseEnter` 实现成 `mouseover` 的委托，**不监听**真实的
      // `mouseenter`：直接派发 `mouseenter` 在 jsdom 里永远不触发。
      option?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(onHover).toHaveBeenCalledWith(1);
  });
});

describe('芯片条', () => {
  const text = '提醒我 @买牛奶 和 @已删除的';

  it('对上的显示标题、对不上的也画出来并标 false', async () => {
    const { findMentions, mentionSegments } = await import('@heyta/domain');
    const segments = mentionSegments(text, findMentions(text));
    render(
      <MentionChips
        segments={segments}
        resolve={(label) => (label === '买牛奶' ? '买牛奶' : undefined)}
      />,
    );

    const chips = container.querySelectorAll('[data-testid="ai-mention-chip"]');
    expect(chips).toHaveLength(2);
    expect(chips[0]?.getAttribute('data-resolved')).toBe('true');
    expect(chips[1]?.getAttribute('data-resolved')).toBe('false');
    // 文本被保留，不是被抹掉
    expect(chips[1]?.textContent).toContain('已删除的');
  });

  it('没有提及时整条不渲染', async () => {
    const { findMentions, mentionSegments } = await import('@heyta/domain');
    render(<MentionChips segments={mentionSegments('没有提及', findMentions('没有提及'))} resolve={() => undefined} />);
    expect(container.querySelector('[data-testid="ai-mention-chips"]')).toBeNull();
  });
});
