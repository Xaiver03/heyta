/**
 * 判据：**行元信息只有一份实现，而且那份是共享的**
 * =================================================
 *
 * 这一刀收的是错误类 F（「抽出了共享实现，但旧那份没删」）。改之前 web 的
 * `App.tsx` 里 `renderTaskMeta` 是手写的 `<span data-testid="task-meta">` +
 * `<DueBadge/>` + `P{数字}`，而移动端早就走共享 `TaskBadges`。于是"同一件信息"
 * 有两份字形规则、两套颜色规则、两种语言行为（`P3` 中英都是个没解释的数字）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 四道判据，各挡一种回归
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **A. 逐字节等于共享 `TaskBadges` 的输出。**
 *   参考侧的 props 在本文件里**逐字写死**（「明天」「高优先级」、危险色直接取
 *   `resolveHeytaUiTheme().tokens`），不经过被测代码 —— 所以这一条同时钉住了
 *   文案、颜色槽、逾期标志（字形会从日历换成警告三角）与**徽章顺序**。
 *   web 换回手写的一份 ⇒ 立刻不等。
 *   ⚠️ 和 `quadrant-row-parity.spec.tsx` 一样，它抓不到"把共享组件的输出
 *   逐字复制过来" —— 那是 C 的职责。
 *
 * **B. 锚点仍在行内。** 通过真 `TaskList` + web 的插槽渲染一次，断言
 *   `task-item-<id>` 里能找到 `[data-testid="task-meta"]`。
 *   🔴 这条防的是最阴的那种失败：组件搬家时锚点跟着消失，判据不是变红而是
 *   **再也不测**（`docs/plans/ui-review-fill-zh-timeline.md` §6.6 里
 *   "白屏锚点跟着搬家"是同一条教训）。`e2e/tests/helpers.ts:281` 就是按它定位的。
 *
 * **C. 源码级：这一槽不许有第二份。** 扫 `apps/web/src`（去注释、排除测试）：
 *   不许出现手写的 `data-testid="task-meta"`；`task-meta` 这个字面只允许出现在
 *   `features/tasks/row-meta.tsx` 的 `testID=` 一处；`App.tsx` 必须渲染
 *   `<TaskRowMeta`（断言"用了它"，不是"import 了它"—— `check:row-single-source`
 *   与 `quadrant-row-parity` 都实测过"只看 import 会照样绿"）。
 *   另加一条 `P[0-9]`：那个从不对用户解释的数字就是这次要修的 bug 的形状。
 *   ⚠️ **窄到只看这一槽**：整行有没有第二份由 `check:row-single-source` 管，
 *   这里不重复它（重复的门禁会漂移，AGENTS §3.5 记过两次）。
 *
 * **D. 与移动端逐档对账。** `packages/ui` 依赖不了 `@heyta/i18n`（要过
 *   AGENTS §3.1–3.2 两道门并动 `packages/ui/package.json`），所以"档位→词条 key"
 *   这张表在 web 是**第二份**。镜像可以，漂移不行：逐档比两边的 key，
 *   任何一边换了词条来源都会红。
 *
 * ⚠️ 本测试用 `@heyta/ui` 的 **`dist/`**（package exports）。改完 `packages/ui`
 *    源码必须先 `pnpm --filter @heyta/ui build`，否则看到的是上一次构建的结果。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { DAY_MS, Priority, type Task } from '@heyta/domain';
import { I18nProvider, translate } from '@heyta/i18n';
import {
  HeytaUiProvider,
  resolveHeytaUiTheme,
  TaskBadges,
  TaskList,
  toTaskRow,
  type TaskRow as SharedTaskRow,
} from '@heyta/ui';

const { TaskRowMeta } = await import('../src/features/tasks/row-meta.js');
const { priorityBadgeText, priorityColorToken } = await import(
  '../src/features/tasks/priority-display.js'
);

const zh = translate.bind(null, 'zh-CN');
const en = translate.bind(null, 'en');

/** 主题显式传进 Provider：两边的参考必须用**同一份** token，否则差异不来自实现。 */
const THEME = resolveHeytaUiTheme({ scheme: 'light', reducedTransparency: false });

/** 正午的"现在"：跨零点与夏令时都不会把它挪到别的日子。 */
const NOW = new Date(2026, 8, 25, 12, 0, 0).getTime();

function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: '写周报', createdAt: 0, updatedAt: 0, ...over };
}

function rowOf(t: Task): SharedTaskRow {
  return toTaskRow(t);
}

let roots: Root[] = [];
let containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode, locale: 'zh-CN' | 'en' = 'zh-CN'): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <HeytaUiProvider value={THEME}>
        <I18nProvider locale={locale}>{node}</I18nProvider>
      </HeytaUiProvider>,
    );
  });
  roots.push(root);
  containers.push(container);
  return container;
}

afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  for (const container of containers) container.remove();
  roots = [];
  containers = [];
});

/** 取元信息槽的 HTML；没有则 `null`（共享 `TaskBadges` 在空槽时返回 null）。 */
function metaHtml(el: HTMLElement): string | null {
  const node = el.querySelector('[data-testid="task-meta"]');
  return node === null ? null : node.outerHTML;
}

// ── A. 逐字节等于共享 TaskBadges ───────────────────────────────

describe('A. web 的行元信息槽渲染出的就是共享 TaskBadges', () => {
  it('明天到期 + 高优先级（中文）：与手写 props 的共享徽章逐字节相同', () => {
    const t = task({ dueDate: NOW + DAY_MS, priority: Priority.High });
    const actual = mount(<TaskRowMeta row={rowOf(t)} mode="countdown" now={NOW} />);

    // 🔴 参考侧的文案**在本文件里逐字写死**，颜色从共享 token 取 ——
    //    它不经过被测代码，所以"相等"证明的是组合方式对了，不是"两边调了同一个函数"。
    const expected = mount(
      <TaskBadges
        testID="task-meta"
        due={{ text: '明天', overdue: false }}
        priority={{ text: '高优先级', color: THEME.tokens['color.priority-high'] }}
      />,
    );

    expect(metaHtml(actual), 'web 的元信息槽与共享 TaskBadges 渲染不同 ⇒ 那一槽有第二份实现').toBe(
      metaHtml(expected),
    );
  });

  it('逾期 3 天（英文）：逾期标志交出去了（字形与危险色都在共享层）', () => {
    const t = task({ dueDate: NOW - 3 * DAY_MS, priority: Priority.Medium });
    const actual = mount(<TaskRowMeta row={rowOf(t)} mode="countdown" now={NOW} />, 'en');
    const expected = mount(
      <TaskBadges
        testID="task-meta"
        due={{ text: '3 days overdue', overdue: true }}
        priority={{ text: 'Medium priority', color: THEME.tokens['color.priority-medium'] }}
      />,
      'en',
    );

    expect(metaHtml(actual)).toBe(metaHtml(expected));
    // 逾期那条的色必须是危险色 —— 参考侧写死的是它，实际侧拿不到就等于没传标志。
    expect(THEME.tokens['color.danger']).not.toBe(THEME.tokens['color.foreground-subtle']);
  });

  it('只有截止时间：不产出优先级徽章', () => {
    const t = task({ dueDate: NOW + 5 * DAY_MS });
    const actual = mount(<TaskRowMeta row={rowOf(t)} mode="countdown" now={NOW} />);
    const expected = mount(
      <TaskBadges testID="task-meta" due={{ text: '还剩 5 天', overdue: false }} />,
    );
    expect(metaHtml(actual)).toBe(metaHtml(expected));
  });

  it('`date` 呈现同样走共享层（两种呈现读同一个 dueDate）', () => {
    const t = task({ dueDate: NOW + DAY_MS });
    const actual = mount(<TaskRowMeta row={rowOf(t)} mode="date" now={NOW} />);
    const expected = mount(
      <TaskBadges testID="task-meta" due={{ text: '09-26', overdue: false }} />,
    );
    expect(metaHtml(actual)).toBe(metaHtml(expected));
  });

  it('🔴 没有截止、没有优先级 ⇒ 这一槽整个不存在（不是渲染一个空 View 占 gap）', () => {
    const t = task();
    const el = mount(<TaskRowMeta row={rowOf(t)} mode="countdown" now={NOW} />);
    expect(metaHtml(el)).toBeNull();
  });
});

// ── 语言与字形（A 的"看得见的错"那一半，单独钉以便失败信息指到事）──

describe('徽章文案是语言，不是数字', () => {
  it('🔴 英文界面里高优先级说 `High priority`，行内不出现 `P3` 这种数字', () => {
    const t = task({ dueDate: NOW + DAY_MS, priority: Priority.High });
    const el = mount(<TaskRowMeta row={rowOf(t)} mode="countdown" now={NOW} />, 'en');
    const text = el.querySelector('[data-testid="task-meta"]')?.textContent ?? '';
    expect(text).toContain('High priority');
    expect(text).not.toMatch(/P[0-9]/);
  });

  it('中文界面里高优先级说「高优先级」', () => {
    const t = task({ priority: Priority.High });
    const el = mount(<TaskRowMeta row={rowOf(t)} mode="countdown" now={NOW} />);
    expect(el.querySelector('[data-testid="task-meta"]')?.textContent).toBe('高优先级');
  });

  it('「没有优先级」不是信息：None 与 undefined 都不给徽章', () => {
    expect(priorityBadgeText(Priority.None, zh)).toBeNull();
    expect(priorityBadgeText(undefined, zh)).toBeNull();
    const none = mount(
      <TaskRowMeta row={rowOf(task({ priority: Priority.None }))} mode="countdown" now={NOW} />,
    );
    expect(metaHtml(none)).toBeNull();
  });

  it('四个档位的色槽各就各位（`undefined` 落到 none，不是 crash）', () => {
    expect(priorityColorToken(Priority.High)).toBe('color.priority-high');
    expect(priorityColorToken(Priority.Medium)).toBe('color.priority-medium');
    expect(priorityColorToken(Priority.Low)).toBe('color.priority-low');
    expect(priorityColorToken(Priority.None)).toBe('color.priority-none');
  });
});

// ── B. 锚点仍在行内（e2e 靠它定位）─────────────────────────────

describe('B. 迁移后 task-meta 锚点仍落在共享行里', () => {
  it('经真 TaskList + web 插槽：task-item-<id> 里能找到 [data-testid="task-meta"]', () => {
    const t = task({ dueDate: NOW + DAY_MS, priority: Priority.High });
    const el = mount(
      <TaskList
        tasks={[t]}
        onToggleTask={() => undefined}
        labels={{
          toggleOn: (row: SharedTaskRow) => `完成：${row.title}`,
          toggleOff: (row: SharedTaskRow) => `取消完成：${row.title}`,
        }}
        renderMeta={(row: SharedTaskRow) => (
          <TaskRowMeta row={row} mode="countdown" now={NOW} />
        )}
      />,
    );

    const row = el.querySelector('[data-testid="task-item-t1"]');
    expect(row, '共享 TaskList 没渲染出那一行').not.toBeNull();
    expect(row?.querySelector('[data-testid="task-meta"]'), '行里没有元信息锚点').not.toBeNull();
    expect(row?.querySelector('[data-testid="task-toggle-t1"]')).not.toBeNull();
  });
});

// ── C. 源码级：这一槽不许有第二份 ──────────────────────────────

describe('C. 行元信息在 web 只有一份实现（源码级）', () => {
  /**
   * ⚠️ 用 `process.cwd()`：本套件跑在 jsdom，`import.meta.url` 不是 `file:`，
   * 配 `readFileSync` 会报 `The URL must be of scheme file`（实测）。
   */
  const SRC = resolve(process.cwd(), 'src');

  /** 🔴 先去注释：这些文件会在注释里**引用**要禁的形态来讲解判据。 */
  function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }

  function* walk(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const full = resolve(dir, name);
      if (statSync(full).isDirectory()) {
        yield* walk(full);
      } else if (/\.(?:tsx?|jsx?)$/.test(name) && !/\.(?:spec|test)\.[cm]?tsx?$/.test(name)) {
        yield full;
      }
    }
  }

  const files = [...walk(SRC)].map((file) => ({
    rel: relative(SRC, file),
    code: stripComments(readFileSync(file, 'utf8')),
  }));

  it('没有任何手写的 `data-testid="task-meta"`', () => {
    const hit = files.filter((f) => f.code.includes('data-testid="task-meta"'));
    expect(
      hit.map((f) => f.rel),
      '锚点被手写回壳里 ⇒ 那一槽又有第二份实现了',
    ).toEqual([]);
  });

  it('`task-meta` 这个锚点只由 row-meta.tsx 以 testID 交给共享组件', () => {
    const hit = files.filter((f) => f.code.includes('task-meta'));
    expect(hit.map((f) => f.rel)).toEqual(['features/tasks/row-meta.tsx']);
    expect(hit[0]?.code).toContain('testID="task-meta"');
  });

  it('App.tsx 渲染 <TaskRowMeta（用了它，不是只 import 了它）', () => {
    const app = files.find((f) => f.rel === 'App.tsx');
    expect(app?.code).toContain('<TaskRowMeta');
  });

  it('🔴 行内不再出现 `P{数字}` 那种没解释的优先级字形', () => {
    const hit = files.filter((f) => /P\{|\bP\$\{/.test(f.code));
    expect(hit.map((f) => f.rel)).toEqual([]);
  });
});

// ── D. 与移动端逐档对账 ────────────────────────────────────────

describe('D. web 的优先级镜像与移动端同一批词条', () => {
  /**
   * 🔴 为什么是"镜像 + 对账"而不是共享：`packages/ui` 依赖不了 `@heyta/i18n`
   * （新增依赖要过 AGENTS §3.1–3.2 两道门并逐项登记）。仓库既有 convention 是
   * **"算数只有一份，说法各端各写"**（`apps/web/src/lib/due-display.ts` 文件头）。
   * 镜像可以，**悄悄换词条来源**不行 —— 那正是下面这条要抓的。
   */
  const webSource = strip(readFileSync(resolve(process.cwd(), 'src/features/tasks/priority-display.ts'), 'utf8'));
  const mobileSource = strip(
    readFileSync(resolve(process.cwd(), '../../apps/mobile/src/lib/priority.ts'), 'utf8'),
  );

  function strip(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }

  /** 档位 → 期望的词条 key（两边必须是同一组，逐字）。 */
  const LEVELS: readonly [Priority, string][] = [
    [Priority.None, 'mobile.priority.none'],
    [Priority.Low, 'mobile.priority.low'],
    [Priority.Medium, 'mobile.priority.medium'],
    [Priority.High, 'mobile.priority.high'],
  ];

  it('🔴 逐档：web 与 mobile 的映射行逐字相同', () => {
    for (const [level, key] of LEVELS) {
      const name = Priority[level];
      const line = `[Priority.${name}]: '${key}'`;
      expect(mobileSource, `移动端没有 ${line}`).toContain(line);
      expect(webSource, `web 镜像与移动端不同 ⇒ 同一个档位在两端会说两句话：${line}`).toContain(
        line,
      );
    }
  });

  it('徽章整句用的是同一个 badge 词条（不是各自拼的）', () => {
    expect(mobileSource).toContain("t('mobile.priority.badge'");
    expect(webSource).toContain("t('mobile.priority.badge'");
  });

  it('语义色 token 名两边一致（色值仍由设计系统给，这里比的是名字）', () => {
    for (const token of [
      'color.priority-none',
      'color.priority-low',
      'color.priority-medium',
      'color.priority-high',
    ]) {
      expect(webSource, token).toContain(token);
      expect(mobileSource, token).toContain(token);
    }
  });

  it('中英两边的 badge 都真的解析出文字（词条缺失时 t() 会回吐 key）', () => {
    for (const [, key] of LEVELS.slice(1)) {
      for (const t of [zh, en]) {
        const out = t(key as Parameters<typeof zh>[0]);
        expect(out).not.toContain(key);
        expect(out.trim().length).toBeGreaterThan(0);
      }
    }
    expect(zh('mobile.priority.badge', { level: zh('mobile.priority.high') })).toBe('高优先级');
    expect(en('mobile.priority.badge', { level: en('mobile.priority.high') })).toBe('High priority');
  });
});
