/**
 * 快速捕获（Web 壳）界面判据
 * ============================
 *
 * 出处：`docs/plans/multi-platform-adaptation.md` 的 M3「每轮的固定流程」
 * 第 1–2 步，以及 §判据 A「该特性在 `apps/web` 与 `apps/mobile` 下
 * **不再各有一份实现**」。
 *
 * 迁移前这个文件断言的是 `.ht-capture__chip` 那套 DOM 类名 —— 也就是说它
 * **只能测 web 那一份实现**。现在渲染的是共享 `@heyta/ui` 的
 * `CaptureComposer`（经 web 宿主接线），所以下面一律用 `testID`
 * （RNW → `data-testid`）寻址，**与 mobile 将来能断的是同一批契约**。
 *
 * 纯解析逻辑已经在 `packages/domain/tests/capture.spec.ts` 里测了 42 条，
 * 共享判断在 `packages/ui/tests/capture-model.spec.ts` 里测了 27 条。
 * 这里只测**界面契约** —— 也就是"预览有没有真的起作用"：
 *
 *   1. 识别结果**必须显示**（看得见"我读懂了什么"）
 *   2. 每条**可以单独取消**，取消 = 把那几个字放回输入（**输入框一个字都不少**）
 *   3. 未被采纳的匹配**必须显式标出**，因为它其实还在标题里
 *
 * ⚠️ 本测试用 `@heyta/ui` 的 **`dist/`**（package exports）。
 * 改完 `packages/ui` 源码必须先 `pnpm --filter @heyta/ui build`，
 * 否则看到的是**上一次构建**的结果（本 Goal 因此误判过两次）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Priority } from '@heyta/domain';

/** 记录 addTask 收到的参数。写入路径本身由 app-host 的测试覆盖，这里只关心参数对不对。 */
const addTask = vi.fn(() => Promise.resolve());

// 只替换写入动作，UI 其余部分跑真实实现（包括真实的 parseCapture 与共享组件）。
vi.mock('../src/features/tasks/store.js', () => ({
  useTaskStore: (selector: (s: { addTask: typeof addTask }) => unknown) =>
    selector({ addTask }),
}));

const { CaptureComposer } = await import('../src/features/capture/CaptureComposer.js');

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * 判据要读的源码根。
 *
 * ⚠️ 三个环境变量是**只读接缝**，只给故障注入用（把目录复制到 `/tmp`、改一处、
 * 指过去，证明"真实现漂了 → 红"），与 `habits-board.spec.tsx` 的
 * `HEYTA_HABITS_*` 同一约定。不设它们时就是真实路径。
 */
const WEB_SRC = process.env.HEYTA_CAPTURE_WEB_SRC ?? resolve(HERE, '../src');
const UI_SRC = process.env.HEYTA_CAPTURE_UI_SRC ?? resolve(HERE, '../../../packages/ui/src');

/** jsdom 里 RNW 偶尔会问 `ResizeObserver` —— 给个空实现，与别的 spec 一致。 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
});

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
  const input = el.querySelector('[data-testid="capture-input"]')! as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 芯片本体（`capture-chip-0`、`capture-chip-1`…），**不含** value/toggle/hint 三个子节点。 */
function chips(el: HTMLDivElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('[data-testid]')].filter((node) =>
    /^capture-chip-\d+$/u.test(node.getAttribute('data-testid') ?? ''),
  );
}

function chipValue(chip: HTMLElement): string {
  return chip.querySelector('[data-testid="capture-chip-value"]')?.textContent ?? '';
}

function inputValue(el: HTMLDivElement): string {
  return (el.querySelector('[data-testid="capture-input"]') as HTMLInputElement).value;
}

function submit(el: HTMLDivElement): HTMLElement {
  return el.querySelector<HTMLElement>('[data-testid="capture-submit"]')!;
}

function previewText(el: HTMLDivElement): string {
  return el.querySelector('[data-testid="capture-preview"]')?.textContent ?? '';
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
  it('无输入时不渲染任何 chip，也不渲染标题预览', () => {
    const el = render();
    expect(chips(el)).toHaveLength(0);
    expect(el.querySelector('[data-testid="capture-preview"]')).toBeNull();
  });

  it('🔴 日期与优先级都被显示出来，且给出人话解释', () => {
    const el = render();
    type(el, '明天交周报 !1');

    const cs = chips(el);
    expect(cs).toHaveLength(2);
    // 日期 chip：原文 → 日期 + 人话剩余时间
    expect(cs[0]!.textContent).toContain('明天');
    expect(chipValue(cs[0]!)).toContain('明天');
    // 优先级 chip
    expect(cs[1]!.textContent).toContain('!1');
    expect(chipValue(cs[1]!)).toContain('高优先级');
  });

  it('🔴 显示"实际标题"，让用户能确认自己写的字被怎么处理了', () => {
    const el = render();
    type(el, '明天交周报 !1');
    const preview = previewText(el);
    expect(preview).toContain('交周报');
    // 被识别的片段不该出现在实际标题里
    expect(preview).not.toContain('明天');
  });

  it('解析不出任何东西时既不显示 chip 也不显示标题预览（界面不该无中生有）', () => {
    const el = render();
    type(el, '写完那段不好解析的说明');
    expect(chips(el)).toHaveLength(0);
    expect(el.querySelector('[data-testid="capture-preview"]')).toBeNull();
  });

  it('识别结果那一组带无障碍名（屏幕阅读器能知道这是什么）', () => {
    const el = render();
    type(el, '明天交周报');
    expect(
      el.querySelector('[data-testid="capture-matches"]')?.getAttribute('aria-label'),
    ).toBe('识别出的字段');
  });
});

describe('CaptureComposer —— 每一条都能单独忽略', () => {
  it('🔴 忽略 = 那段文字**回到标题**，而不是被删掉', () => {
    const el = render();
    type(el, '明天交周报 !1');
    expect(inputValue(el)).toBe('明天交周报 !1');

    // 忽略日期那条
    const toggle = chips(el)[0]!.querySelector('[data-testid="capture-chip-toggle"]')!;
    act(() => {
      (toggle as HTMLElement).click();
    });

    // 🔴 输入框**一个字都不能少** —— 界面不许替用户删掉他写的东西
    expect(inputValue(el)).toBe('明天交周报 !1');
    // 两 chip 都还在：一条"已忽略"，一条仍生效
    expect(chips(el)).toHaveLength(2);
    expect(chipValue(chips(el)[0]!)).toContain('已忽略');
    expect(chipValue(chips(el)[1]!)).toContain('高优先级');
    // 关键：忽略的那段文字进入了实际标题
    expect(previewText(el)).toContain('明天交周报');
  });

  it('忽略后可以恢复', () => {
    const el = render();
    type(el, '明天交周报');
    act(() => {
      chips(el)[0]!.querySelector<HTMLElement>('[data-testid="capture-chip-toggle"]')!.click();
    });
    expect(previewText(el)).toContain('明天交周报');

    // 点恢复
    act(() => {
      chips(el)[0]!.querySelector<HTMLElement>('[data-testid="capture-chip-toggle"]')!.click();
    });
    expect(chipValue(chips(el)[0]!)).not.toContain('已忽略');
    expect(previewText(el)).not.toContain('明天');
  });

  it('忽略日期后提交，标题包含那段文字且**不带 dueDate**', () => {
    const el = render();
    type(el, '明天交周报');
    act(() => {
      chips(el)[0]!.querySelector<HTMLElement>('[data-testid="capture-chip-toggle"]')!.click();
    });
    act(() => {
      submit(el).click();
    });
    expect(addTask).toHaveBeenCalledWith('明天交周报', {});
  });

  it('每个忽略按钮都有 aria-label，且带上对应的原文', () => {
    const el = render();
    type(el, '明天交周报');
    const toggle = chips(el)[0]!.querySelector('[data-testid="capture-chip-toggle"]')!;
    const label = toggle.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label).toContain('明天');
  });
});

describe('CaptureComposer —— 未被采纳的匹配必须显式标出', () => {
  it('🔴 两个日期：第二条标成"未采用"，并说明它仍在标题中', () => {
    const el = render();
    type(el, '今天 明天 交周报');

    const cs = chips(el);
    expect(cs).toHaveLength(2);
    // 第二条是未采纳的 —— 必须有说明，否则用户以为它生效了
    const hint = cs[1]!.querySelector('[data-testid="capture-chip-hint"]');
    expect(hint?.textContent).toContain('未采用');
    // 而且它没有取消按钮（因为没被采纳，没什么可取消的）
    expect(cs[1]!.querySelector('[data-testid="capture-chip-toggle"]')).toBeNull();
    // 它仍然给出确切的日期 —— 用户要确认的是"系统把'明天'理解成了哪一天"
    expect(chipValue(cs[1]!)).toContain('09-29');
    // 关键：它确实还在标题里
    expect(previewText(el)).toContain('明天');
  });
});

describe('CaptureComposer —— 提交', () => {
  it('标题为空时禁用提交（只输入"明天"不算一个任务）', () => {
    const el = render();
    type(el, '明天');
    // RNW 的 `Pressable` 渲染成 div，`disabled` 体现在 `aria-disabled`。
    expect(submit(el).getAttribute('aria-disabled')).toBe('true');
  });

  it('提交时把解析出的字段一并交给写入动作', () => {
    const el = render();
    type(el, '明天交周报 !1');
    act(() => {
      submit(el).click();
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
    act(() => {
      submit(el).click();
    });
    expect(inputValue(el)).toBe('');
  });

  it('只有优先级没有日期时也要能提交', () => {
    const el = render();
    type(el, '交周报 p2');
    act(() => {
      submit(el).click();
    });
    expect(addTask).toHaveBeenCalledWith('交周报', { priority: Priority.Medium });
  });

  it('🔴 回车也走同一条提交路（共享 `TextInput` 的 `onSubmitEditing`）', () => {
    // 迁移前这是 `<input onKeyDown={Enter}>`；共享层换成 RN 的 `onSubmitEditing`，
    // 在 react-native-web 上它由 Enter 键触发（实测：走同一条 `submit()`）。
    const el = render();
    type(el, '交周报');
    act(() => {
      el.querySelector('[data-testid="capture-input"]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    expect(addTask).toHaveBeenCalledWith('交周报', {});
  });
});

describe('CaptureComposer —— web 不再有第二份实现（源码级判据）', () => {
  const hostSource = (): string =>
    readFileSync(resolve(WEB_SRC, 'features/capture/CaptureComposer.tsx'), 'utf8');
  const boardSource = (): string =>
    readFileSync(resolve(UI_SRC, 'capture/CaptureComposer.tsx'), 'utf8');
  const modelSource = (): string => readFileSync(resolve(UI_SRC, 'capture/model.ts'), 'utf8');

  it('web 宿主从 `@heyta/ui` 取共享组件，且不再有手写的芯片 DOM 骨架', () => {
    const host = hostSource();
    expect(host).toContain('@heyta/ui');
    expect(host).toContain('SharedCaptureComposer');
    // 🔴 DOM 类名不许回潮：它们正是"web 自己又画了一份"的痕迹。
    //    ⚠️ 只盯**字符串字面量里的**类名，不盯"文件里出现过这个词" ——
    //    文件头的说明文字里就写着这几个类名（实测第一版因此假红，
    //    与 `habits-board.spec.tsx` 踩的是同一个坑）。
    expect(host).not.toMatch(/['"`]ht-capture/);
    expect(host).not.toMatch(/['"`]ht-compose/);
    // 解析也不许回到宿主：它必须在共享层 / 领域层。
    expect(host).not.toContain('parseCapture(');
  });

  it('芯片骨架在共享层（`toCaptureChips`），不在 web 的 JSX 里', () => {
    expect(boardSource()).toContain('toCaptureChips');
    expect(modelSource()).toContain('export function toCaptureChips');
    expect(hostSource()).not.toContain('toCaptureChips');
  });

  it('文案一律由宿主注入：共享层不 import `@heyta/i18n`', () => {
    // 盯 import 语句，不盯"文件里出现过这个词"（文件头正是这么写的）。
    expect(boardSource()).not.toMatch(/from\s+['"]@heyta\/i18n/);
    expect(modelSource()).not.toMatch(/from\s+['"]@heyta\/i18n/);
  });

  it('共享 model 不 import `react-native`（node 单测解析不了它 —— 这是免费的分层护栏）', () => {
    expect(modelSource()).not.toMatch(/from\s+['"]react-native['"]/);
  });
});
