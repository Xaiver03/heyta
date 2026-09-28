/**
 * 展厅「今日进度卡」与共享 `TodayProgressCard` 的**会红约束**
 * ==========================================================
 *
 * 背景与分工，与 `tests/mockup-task-row.spec.tsx` 同一条：真组件**不进落地页**
 * （静态 import 会让首屏 main 包 +31%，见那份 spec 的数字），所以漂移改用
 * **契约**解决 —— 这里把共享组件源码里的每一个 `tokens['…']` 与
 * `mockup.css` 的 `.mk-today` 一节**逐项比对**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这一刀必须改复刻件（不是"顺手同步一下"）
 *
 * M3 第十一刀（motivation）之后 web 的今日卡来自 `@heyta/ui`，**不再有**
 * `apps/web/src/features/motivation/TodayProgressCard.tsx` 与 `.ht-today` CSS。
 * 复刻件原来照 `.ht-today` 手抄，于是结构与取值同时过期：
 *   · 旧卡有"今天"标签，共享卡**没有**；
 *   · 旧卡是"2xl 大数字 + base 小分母"，共享卡是**一整段** `2/5`（numeric-display）；
 *   · 旧卡提示在数字**下面**，共享卡 head 是**一行**（flex-end）；
 *   · 旧横条 `--ht-space-2` 高、`scaleX` 填充，共享横条 `size.progress-height`
 *     高、宽度插值（RN 的 scaleX 以中心为原点）。
 *
 * ⚠️ 与 `tests/mockup-task-row.spec.tsx` 同一个做法：**不 import 对面那个包**
 * （`@heyta/ui` 在 Node 里加载不了，它是 RN 包），比的是"两份源码里的 token 名
 * 一致"这件事本身。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cssVarName, type TokenName } from '@heyta/design-system';
import { I18nProvider, zhCN } from '@heyta/i18n';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppWindow } from '../src/mockup/AppWindow.js';
import { SHOWCASE_TODAY_PROGRESS } from '../src/mockup/showcase-data.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REPO = resolve(APP, '../..');

/**
 * 共享卡片的两个来源文件。`TodayProgressCard` 渲染 `MotivationProgressBar`，
 * 所以横条的 token 在第二个文件里 —— 只读第一个会漏掉整条横条。
 */
const SHARED_SOURCES = [
  'packages/ui/src/motivation/TodayProgressCard.tsx',
  'packages/ui/src/motivation/ProgressBar.tsx',
] as const;

/**
 * 共享卡里**复刻件刻意没画**的 token。这是一个显式白名单，每一项都要写理由 ——
 * 不是"算了吧"。白名单**不许悄悄长大**：下面有一条断言要求其中每一项都必须
 * 仍被共享组件真的用到（否则它已经死了）。
 */
const NOT_IN_REPRODUCTION = new Set([
  // 闭环徽章（`progress.closed`）：展厅样例数据里没有 closed 位。
  'color.success',
  // 横条的动画时长：展厅整块是 `pointer-events: none` 的静态展品，不播动画。
  'duration.normal',
]);

/**
 * `ProgressBar` 的色调走**查表**（`tokens[TONE_TOKEN[tone]]`），正则抓不到
 * `tokens['…']` 这种形状 —— 抓不到就必须显式补，这正是"不能只靠正则"的地方。
 */
const MANUAL_TOKENS = ['color.primary'] as const;

/** 只取 `.mk-today` 那一段 CSS（到「输入行」注释为止），并剥掉注释。 */
function todaySection(): string {
  const css = readFileSync(join(APP, 'src/mockup/mockup.css'), 'utf8');
  const start = css.indexOf('/* ── 今日进度卡');
  const end = css.indexOf('/* ── 输入行');
  if (start < 0 || end < start) throw new Error('mockup.css 里找不到今日进度卡那一节');
  return css.slice(start, end).replaceAll(/\/\*[\s\S]*?\*\//g, '');
}

/** 某个共享组件源码里出现的 `tokens['…']`。 */
function tokensOf(relativePath: string): string[] {
  const source = readFileSync(join(REPO, relativePath), 'utf8');
  return [...source.matchAll(/tokens\['([^']+)'\]/g)].map((match) => match[1] ?? '');
}

/** jsdom 不实现 `ResizeObserver`，而 `AppWindow` 用它算缩放比（测试环境缺口）。 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  if (root !== null) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
});

function renderMockup(): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <AppWindow view="tasks" />
      </I18nProvider>,
    );
  });
  return container;
}

describe('今日进度卡的形状 = 共享契约', () => {
  it('共享卡用到的每个 token 都出现在展厅复刻件的 CSS 里', () => {
    const css = todaySection();
    const tokens = [...new Set([...SHARED_SOURCES.flatMap(tokensOf), ...MANUAL_TOKENS])];

    // 判据锚点自检：抽不到 token 说明正则/路径坏了，而不是"很干净"。
    expect(tokens.length, '从共享组件里一个 token 都没抽到 —— 判据失效').toBeGreaterThan(10);

    for (const token of tokens) {
      if (NOT_IN_REPRODUCTION.has(token)) continue;
      // 🔴 用 design-system 自己的 `cssVarName()`，不手拼 `--ht-…`：
      // 拼错的话这条断言会"通过"，而页面上变量解析不到、静默塌成 0。
      // ⚠️ token 是从**源码文本**里抽出来的，类型只能是 string；这里 cast 成
      // `TokenName` 是刻意的 —— 真正的校验是 `cssVarName` 查得到那个 token。
      const name = cssVarName(token as TokenName);
      expect(css, `共享卡用了 ${token}（${name}），展厅复刻件没跟`).toContain(`var(${name})`);
    }

    // 白名单里的每一项都必须仍被共享组件用到 —— 否则它已经死了，该删。
    for (const token of NOT_IN_REPRODUCTION) {
      expect(tokens, `${token} 在共享组件里找不到了 —— 这条白名单该删掉`).toContain(token);
    }
  });

  it('渲染出来的是共享结构：没有"今天"标签、比例一整段、提示并排', () => {
    const view = renderMockup();
    const today = view.querySelector('.mk-today');
    expect(today, '每个"做事"的视图上都应有今日进度卡').not.toBeNull();

    // 🔴 共享卡片**没有**"今天"这个标签（迁移前 `.ht-today__label` 有）。
    expect(today?.querySelector('.mk-today__label')).toBeNull();
    expect(today?.textContent ?? '').not.toContain(zhCN['web.progress.today']);

    // 比例是 done/total **一整段**（`numeric-display`）。
    const count = today?.querySelector('.mk-today__count');
    expect(count?.textContent?.trim()).toBe(
      `${String(SHOWCASE_TODAY_PROGRESS.done)}/${String(SHOWCASE_TODAY_PROGRESS.total)}`,
    );

    // 提示就是共享层 remaining 那一句（同一份样例数据）。
    const hint = today?.querySelector('.mk-today__hint');
    expect(hint?.textContent?.trim()).toBe(
      zhCN['web.progress.hint.remaining'].replace(
        '{count}',
        String(SHOWCASE_TODAY_PROGRESS.remaining),
      ),
    );

    // 两者在**同一个 head 行**里（并排），而不是上下堆叠。
    expect(today?.querySelector('.mk-today__head > .mk-today__count')).not.toBeNull();
    expect(today?.querySelector('.mk-today__head > .mk-today__hint')).not.toBeNull();
  });

  it('横条填充宽度 = done/total（不再是 scaleX，与共享层一致）', () => {
    const view = renderMockup();
    const fill = view.querySelector('.mk-today__bar-fill');
    expect(fill).not.toBeNull();
    const percent = (SHOWCASE_TODAY_PROGRESS.done / SHOWCASE_TODAY_PROGRESS.total) * 100;
    const style = fill?.getAttribute('style') ?? '';
    expect(style, '填充必须用 width（RN 的 scaleX 以中心为原点，共享层已改宽度插值）').toContain(
      `width: ${String(percent)}%`,
    );
    expect(style).not.toContain('scaleX');
  });
});
