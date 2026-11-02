/**
 * 截图转任务：捕获框的图片附件（Web 壳）
 * =======================================
 *
 * 这里测的是**接线**，不是编码：`encodeImageForEgress` 被替换成桩，
 * 因为 jsdom 没有 canvas / `createImageBitmap`（真实编码由
 * `pnpm verify:ai-vision-live` 在真端点链路上验，那才是它的判据）。
 *
 * 四条不变量，每条都对应一个"看起来正常其实坏了"的版本：
 *
 * 1. **没打字也要能开始**：原来 AI 面板的门是 `draft.trim() === ''`，
 *    于是"贴一张截图、一个字不打"这条路**永远不可能开始** —— 界面正常，只是没反应。
 * 2. **附件出现时能看见它**：缩略图 + 尺寸/体积 + 移除。
 * 3. **张数上限在界面就拦住**（超了说一句，而不是等出境层抛错）。
 * 4. **粘贴只在捕获框里生效**：在别处粘贴不该被吃掉（判据是 `data-heyta-capture-root`）。
 */

import type { AiRoutingConfig } from '@heyta/ai';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const STUB = {
  mediaType: 'image/png' as const,
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  bytes: 70,
  width: 96,
  height: 48,
  source: { width: 480, height: 240 },
};

/**
 * 只替换编码。`imagesFromClipboard` 用**真实实现** —— 粘贴归属判据正是要测的东西，
 * 把它一起换成桩就等于把被测对象删掉了。
 */
vi.mock('../src/features/ai/image-encode.js', async () => {
  const actual = await vi.importActual<typeof import('../src/features/ai/image-encode.js')>(
    '../src/features/ai/image-encode.js',
  );
  return {
    ...actual,
    encodeImageForEgress: vi.fn(async () => ({ ok: true as const, image: STUB })),
  };
});

vi.mock('../src/features/tasks/store.js', () => ({
  useTaskStore: (selector: (s: { addTask: () => Promise<void> }) => unknown) =>
    selector({ addTask: () => Promise.resolve() }),
}));

const { CaptureComposer } = await import('../src/features/capture/CaptureComposer.js');

const ROUTING: AiRoutingConfig = {
  enabled: true,
  allowRemote: false,
  endpoints: [
    {
      id: 'local',
      label: '本机',
      endpoint: 'http://localhost:11434/v1',
      model: 'qwen3:8b',
      capabilities: ['structured_output', 'vision'],
    },
  ],
  routes: { capture: [{ endpointId: 'local' }] },
};

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  // Radix/React 19 里的 act 环境标记：不设会在控制台刷警告，但不影响断言。
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<CaptureComposer routing={ROUTING} consents={[]} />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function q<T extends Element>(testId: string): T | null {
  return container.querySelector<T>(`[data-testid="${testId}"]`);
}

/**
 * 把若干图"填"进隐藏的 file input 并触发 change。
 *
 * 🔴 **必须 `await act(async …)`**：`accept()` 里逐张 `await encode(...)`，
 * 同步 `act()` 只冲得到第一批微任务，断言会在编码落地之前跑 ——
 * 表现是"列表是空的"，而代码其实是对的。第一版就是这么假红的。
 */
async function attachFiles(files: readonly File[]): Promise<void> {
  const input = q<HTMLInputElement>('capture-attach-input');
  if (input === null) throw new Error('找不到图片输入框');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const png = (name = 'shot.png'): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

describe('入口该在什么时候出现', () => {
  it('一个字都没打时也有附件入口', () => {
    expect(q('capture-attach')).not.toBeNull();
    expect(q('capture-attach-pick')).not.toBeNull();
  });

  it('🔴 没打字时 AI 面板不出现（没有可解析的内容）', () => {
    expect(q('capture-ai')).toBeNull();
  });
});

describe('🔴 只有图、没有字也能开始（这条原来结构上做不到）', () => {
  it('贴一张图之后，AI 面板出现了', async () => {
    await attachFiles([png()]);
    expect(q('capture-attach-list')).not.toBeNull();
    expect(q('capture-ai')).not.toBeNull();
  });

  it('附件项显示尺寸与体积', async () => {
    await attachFiles([png()]);
    const meta = q('capture-attach-meta');
    expect(meta?.textContent).toContain('96');
    expect(meta?.textContent).toContain('48');
    expect(q('capture-attach-sum')?.textContent).toContain('1');
  });

  it('可以移除，移除后 AI 面板跟着消失（没有内容了）', async () => {
    await attachFiles([png()]);
    const remove = q<HTMLButtonElement>('capture-attach-remove-0');
    if (remove === null) throw new Error('找不到移除按钮');
    await act(async () => {
      remove.click();
    });
    expect(q('capture-attach-list')).toBeNull();
    expect(q('capture-ai')).toBeNull();
  });
});

describe('张数上限在界面就拦住', () => {
  it('一次给 3 张：只收 2 张，并且明说超了', async () => {
    await attachFiles([png('a.png'), png('b.png'), png('c.png')]);
    expect(container.querySelectorAll('[data-testid="capture-attach-meta"]')).toHaveLength(2);
    expect(q('capture-attach-error')?.textContent).toContain('2');
  });
});

describe('🔴 粘贴归属：只在捕获框里生效', () => {
  function pasteWithImage(): boolean {
    const file = png();
    const data = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    } as unknown as DataTransfer;
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: data, configurable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    return event.defaultPrevented;
  }

  it('焦点在捕获框里 ⇒ 收下并阻止默认粘贴', () => {
    const rootEl = container.querySelector('[data-heyta-capture-root]');
    expect(rootEl).not.toBeNull();
    const area = document.createElement('textarea');
    rootEl?.append(area);
    area.focus();
    expect(document.activeElement).toBe(area);

    expect(pasteWithImage()).toBe(true);
  });

  it('焦点在捕获框外 ⇒ 不碰它（不抢用户的粘贴）', () => {
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    expect(pasteWithImage()).toBe(false);
    outside.remove();
  });
});
