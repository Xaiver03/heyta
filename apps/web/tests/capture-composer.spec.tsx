/**
 * 捕获输入框（含解析预览）界面测试
 * ==================================
 *
 * 纯解析逻辑已经在 `packages/domain/tests/capture.spec.ts` 里测了 42 条。
 * 这里只测**界面契约** —— 也就是"预览有没有真的起作用"。
 *
 * 🔴 为什么界面这一层必须单独测（和 `conflict-dialog.spec.tsx` 同一个理由）：
 * 一个解析正确的函数，配一个不显示结果的界面，等于**用户写的字被悄悄改掉了**。
 * 函数层的绿灯完全说明不了这件事。本文件钉住三条界面不变量：
 *
 *   1. 识别结果**必须显示**（看得见"我读懂了什么"）
 *   2. 每条**可以单独取消**，取消 = 把那几个字放回输入
 *   3. 未被采纳的匹配**必须显式标出**，因为它其实还在标题里
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Priority } from '@heyta/domain';

/** 记录 addTask 收到的参数。写入路径本身由 app-host 的测试覆盖，这里只关心参数对不对。 */
const addTask = vi.fn(() => Promise.resolve());

// 只替换写入动作，UI 其余部分跑真实实现（包括真实的 parseCapture）。
vi.mock('../src/features/tasks/store.js', () => ({
  useTaskStore: (selector: (s: { addTask: typeof addTask }) => unknown) =>
    selector({ addTask }),
}));

const { CaptureComposer } = await import('../src/features/capture/CaptureComposer.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<CaptureComposer />);
  });
  return container;
}

/** 往受控 input 里输入。必须走原生 setter，否则 React 收不到变更。 */
function type(el: HTMLDivElement, value: string): void {
  const input = el.querySelector('input')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function chips(el: HTMLDivElement): HTMLLIElement[] {
  return [...el.querySelectorAll('.ht-capture__chip')] as HTMLLIElement[];
}

function inputValue(el: HTMLDivElement): string {
  return el.querySelector('input')!.value;
}

beforeEach(() => {
  addTask.mockClear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('CaptureComposer —— 识别结果必须可见', () => {
  it('无输入时不渲染任何 chip', () => {
    expect(chips(render())).toHaveLength(0);
  });

  it('🔴 日期与优先级都被显示出来，且给出人话解释', () => {
    const el = render();
    type(el, '明天交周报 !1');

    const cs = chips(el);
    expect(cs).toHaveLength(2);
    // 日期 chip：原文 → 日期 + 人话剩余时间
    expect(cs[0]!.textContent).toContain('明天');
    expect(cs[0]!.textContent).toContain('明天');
    // 优先级 chip
    expect(cs[1]!.textContent).toContain('!1');
    expect(cs[1]!.textContent).toContain('高优先级');
  });

  it('🔴 显示"实际标题"，让用户能确认自己写的字被怎么处理了', () => {
    const el = render();
    type(el, '明天交周报 !1');
    const preview = el.querySelector('.ht-capture__preview')!;
    expect(preview.textContent).toContain('交周报');
    // 被识别的片段不该出现在实际标题里
    expect(preview.textContent).not.toContain('明天');
  });

  it('解析不出任何东西时既不显示 chip 也不显示标题预览（界面不该无中生有）', () => {
    const el = render();
    type(el, '写完那段不好解析的说明');
    expect(chips(el)).toHaveLength(0);
    expect(el.querySelector('.ht-capture__preview')).toBeNull();
  });
});

describe('CaptureComposer —— 每一条都能单独忽略', () => {
  it('🔴 忽略 = 那段文字**回到标题**，而不是被删掉', () => {
    const el = render();
    type(el, '明天交周报 !1');
    expect(inputValue(el)).toBe('明天交周报 !1');

    // 忽略日期那条
    act(() => {
      chips(el)[0]!.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // 🔴 输入框**一个字都不能少** —— 界面不许替用户删掉他写的东西
    expect(inputValue(el)).toBe('明天交周报 !1');
    // 两 chip 都还在：一条"已忽略"，一条仍生效
    expect(chips(el)).toHaveLength(2);
    expect(chips(el)[0]!.textContent).toContain('已忽略');
    expect(chips(el)[1]!.textContent).toContain('高优先级');
    // 关键：忽略的那段文字进入了实际标题
    expect(el.querySelector('.ht-capture__preview')!.textContent).toContain('明天交周报');
  });

  it('忽略后可以恢复', () => {
    const el = render();
    type(el, '明天交周报');
    act(() => {
      chips(el)[0]!.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(el.querySelector('.ht-capture__preview')!.textContent).toContain('明天交周报');

    // 点恢复
    act(() => {
      chips(el)[0]!.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(chips(el)[0]!.textContent).not.toContain('已忽略');
    expect(el.querySelector('.ht-capture__preview')!.textContent).not.toContain('明天');
  });

  it('忽略日期后提交，标题包含那段文字且**不带 dueDate**', () => {
    const el = render();
    type(el, '明天交周报');
    act(() => {
      chips(el)[0]!.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const submit = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('添加'))!;
    act(() => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(addTask).toHaveBeenCalledWith('明天交周报', {});
  });
});

describe('CaptureComposer —— 未被采纳的匹配必须显式标出', () => {
  it('🔴 两个日期：第二条标成"未采用"，并说明它仍在标题中', () => {
    const el = render();
    type(el, '今天 明天 交周报');

    const cs = chips(el);
    expect(cs).toHaveLength(2);
    // 第二条是未采纳的 —— 必须有说明，否则用户以为它生效了
    expect(cs[1]!.className).toContain('ht-capture__chip--off');
    expect(cs[1]!.textContent).toContain('未采用');
    // 而且它没有取消按钮（因为没被采纳，没什么可取消的）
    expect(cs[1]!.querySelector('button')).toBeNull();
    // 关键：它确实还在标题里
    expect(el.querySelector('.ht-capture__preview')!.textContent).toContain('明天');
  });
});

describe('CaptureComposer —— 提交', () => {
  it('标题为空时禁用提交（只输入"明天"不算一个任务）', () => {
    const el = render();
    type(el, '明天');
    const submit = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('添加'))!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('提交时把解析出的字段一并交给写入动作', () => {
    const el = render();
    type(el, '明天交周报 !1');
    const submit = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('添加'))!;
    act(() => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(addTask).toHaveBeenCalledTimes(1);
    const [title, over] = addTask.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(title).toBe('交周报');
    expect(over['priority']).toBe(Priority.High);
    // dueDate 是 epoch ms（Task 的约定），且落在本地零点
    const due = new Date(over['dueDate'] as number);
    expect(due.getHours()).toBe(0);
    expect(due.getMinutes()).toBe(0);
  });

  it('提交后清空输入', () => {
    const el = render();
    type(el, '交周报');
    const submit = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('添加'))!;
    act(() => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(inputValue(el)).toBe('');
  });

  it('只有优先级没有日期时也要能提交', () => {
    const el = render();
    type(el, '交周报 p2');
    const submit = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('添加'))!;
    act(() => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(addTask).toHaveBeenCalledWith('交周报', { priority: Priority.Medium });
  });
});

describe('CaptureComposer —— 可访问性', () => {
  it('每个忽略按钮都有 aria-label，且带上对应的原文', () => {
    const el = render();
    type(el, '明天交周报');
    const x = chips(el)[0]!.querySelector('button')!;
    const label = x.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label).toContain('明天');
  });

  it('识别结果列表有 aria-label（屏幕阅读器能知道这是什么）', () => {
    const el = render();
    type(el, '明天交周报');
    expect(el.querySelector('.ht-capture')!.getAttribute('aria-label')).toBe('识别出的字段');
  });
});