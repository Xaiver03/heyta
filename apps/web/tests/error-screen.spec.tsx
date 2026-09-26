/**
 * 崩溃屏 `ErrorScreen` 的"无 Provider 也能渲染"契约
 * =====================================================
 *
 * 🔴 这是任务里单独点名的要求，值得一条测试钉住：
 * `ErrorScreen` 出现的时机正是**整个应用起不来**（`initOpLog()` 失败、
 * `main.tsx` 的 catch 分支）。那时如果它要求外面必须有 `I18nProvider`，
 * 就会因为缺 Provider 而二次崩溃 —— 用户连"发生了什么"都看不到。
 *
 * `@heyta/i18n` 的 context 默认值是 `DEFAULT_LOCALE`，所以 `useI18n()`
 * 在 Provider 之外**不抛**。这条测试把这个行为当成契约，而不是巧合。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import type { StorageFailure } from '@heyta/storage';

import { ErrorScreen } from '../src/features/shell/ErrorScreen.js';
import { storageHintKey } from '../src/features/shell/error-hint.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(node: React.ReactNode): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(node);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('ErrorScreen', () => {
  it('🔴 没有任何 Provider 也能渲染，回落到默认语言而不是抛错', () => {
    const el = render(<ErrorScreen titleKey="web.error.storage.title" message="boom" />);
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.textContent).toContain('无法初始化本地存储');
    // 原始错误文本是数据，原样显示。
    expect(el.textContent).toContain('boom');
  });

  it('在 Provider 内按当前语言渲染（含可选 hint）', () => {
    const el = render(
      <I18nProvider locale="en">
        <ErrorScreen
          titleKey="web.error.storage.title"
          message="boom"
          hintKey="web.error.storage.hint"
        />
      </I18nProvider>,
    );
    expect(el.textContent).toContain('Could not initialize local storage');
    expect(el.textContent).toContain('private mode');
  });
});

/**
 * 🔴 这一组钉的是**门禁扫不到的通道**。
 *
 * 崩溃屏渲染的是 `error.message` 的原文，而 `packages/storage` 抛的是中文；
 * 其中「升级被其它标签页阻塞」那条是**无条件**抛的（`onblocked` 事件没有 error 对象）。
 * 于是英文界面的用户会在应用启动失败时读到一句中文 ——
 * 门禁查的是字面量，这里渲染的是**变量**，它永远扫不到。
 *
 * 修法是来源给结构化原因（`StorageError.failure.kind`）+ 壳按 kind 取词条，
 * 并把原文**降级**成技术详情。下面第一条就是"降级"这件事的契约：
 * 谁把 `{message}` 挪回主文案，它必须变红。
 */
describe('崩溃屏按失败原因给建议（门禁扫不到的通道）', () => {
  const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

  /** 五种原因，一个都不能漏（`Record` 让编译器兜住漏项，这里兜住"渲染出来是什么"）。 */
  const KINDS: StorageFailure['kind'][] = [
    'upgrade-blocked',
    'programming-error',
    'open-failed',
    'request-failed',
    'transaction-failed',
  ];

  it('🔴 原始错误文本降级成"技术详情"，不再是主文案', () => {
    const raw = 'IndexedDB 升级被其它标签页阻塞 —— 请关闭该应用的其它窗口后重试';
    const el = render(
      <ErrorScreen
        titleKey="web.error.storage.title"
        message={raw}
        hintKey={storageHintKey({ kind: 'upgrade-blocked' })}
      />,
    );

    // 原文仍**在 DOM 里**（诊断价值，AGENTS.md §7：容器里看不到真错误时靠它）
    const details = el.querySelector('details[data-testid="error-details"]');
    expect(details).not.toBeNull();
    expect(details?.querySelector('[data-testid="error-message"]')?.textContent).toBe(raw);

    // 但它不在主文案位置上：第一眼看到的是本地化的建议，里面没有浏览器内部接口名
    const hint = el.querySelector('[data-testid="error-hint"]');
    expect(hint?.textContent).toContain('关掉这个应用的其它窗口');
    expect(hint?.textContent).not.toContain('IndexedDB');
  });

  it('「被其它标签页挡住」给的下一步与「浏览器禁用本地数据库」**不同**', () => {
    const el = render(
      <ErrorScreen
        titleKey="web.error.storage.title"
        message="boom"
        hintKey={storageHintKey({ kind: 'upgrade-blocked' })}
      />,
    );
    expect(el.querySelector('[data-testid="error-hint"]')?.textContent).toContain('其它窗口');
    expect(el.querySelector('[data-testid="error-hint"]')?.textContent).not.toContain('无痕模式');
  });

  it('编程错误明确告诉用户"这不是你操作错了"（用户对它无从下手）', () => {
    const el = render(
      <ErrorScreen
        titleKey="web.error.storage.title"
        message="事务未包含 store「ops」…"
        hintKey={storageHintKey({ kind: 'programming-error' })}
      />,
    );
    expect(el.querySelector('[data-testid="error-hint"]')?.textContent).toContain('不是你操作错了');
  });

  it('拿不到结构化原因时退回通用那句（`instanceof` 静默为假也安全）', () => {
    expect(storageHintKey(undefined)).toBe('web.error.storage.hint');
    const el = render(
      <ErrorScreen titleKey="web.error.storage.title" message="boom" hintKey={storageHintKey(undefined)} />,
    );
    expect(el.querySelector('[data-testid="error-hint"]')?.textContent).toContain('无痕模式');
  });

  for (const kind of KINDS) {
    it(`英文界面下 ${kind} 的建议全是英文（一个汉字都不许有）`, () => {
      const el = render(
        <I18nProvider locale="en">
          <ErrorScreen
            titleKey="web.error.storage.title"
            message="boom"
            hintKey={storageHintKey({ kind })}
          />
        </I18nProvider>,
      );
      const hint = el.querySelector('[data-testid="error-hint"]')?.textContent ?? '';
      expect(hint.length).toBeGreaterThan(0);
      expect(HAN.test(hint)).toBe(false);
      // 「技术详情」这个折叠标题也要跟着语言走
      expect(el.querySelector('summary')?.textContent).toBe('Technical details');
    });
  }
});
