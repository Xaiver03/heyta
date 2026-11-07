/**
 * `shell/EmptyState` 的**黄金 DOM**（R11 的 (B) 方案：判断走共享模型，markup 归本端）
 * ==================================================================================
 *
 * ## 这条判据守的是什么
 *
 * 2026-11 把这份空态的**槽位判断**换成了 `@heyta/ui` 的 `toEmptyStateViewModel`
 * （`docs/plans/r11-states-audit-2026-11.md` §7 的 (B) 方案）。
 * 换判断本身是安全的，**危险的是顺手把 markup 也换了** —— 一旦有人把这里的
 * `<div class="ht-empty">` 三件套换成共享组件 `<EmptyState/>`，屏幕上会同时出现
 * 6 条差异（§7.1）：根标签 `div→section[role=region]`、类名体系换掉、
 * 标题字重 500→600、提示字号 14→12、插画 testID 从 `state-illustration-tasks`
 * 变成 `empty-state-illustration`（**e2e 钩子直接断**）、多一层 `justifyContent`。
 *
 * 所以本 spec 断的是**逐字节的 outerHTML**，不是"渲染出来了没有"。
 *
 * ## 期望值从哪来（两条独立来源，都不是"跑一遍看现在是什么"）
 *
 *   · **结构**：来自**改动之前**那次探针的捕获（`filter='all'` 的 outerHTML，
 *     剥掉 `data:` URI 后原样留在下面）。也就是说它是"改之前长什么样"的凭证，
 *     不是"改之后又长什么样"的抄件。
 *   · **文案**：直接写 `packages/i18n/src/locales/zh-CN.ts:935-944` 的十个词条**字面量**。
 *     故意不从 `t()` 读 —— 从 `t()` 读会让"文案表改了"与"DOM 坏了"变成同一种红，
 *     而这两种红的处置完全不同。
 *
 * ## 唯一被剥掉的东西：`data:` URI
 *
 * 插画是内联的 base64 PNG（几十 KB，且随资源版本变化），逐字节比它会让这条 spec
 * 在**每次重导图**时都红一次 —— 那不是 DOM 坏了。所以 `url("data:…")` 归一成
 * `url(DATA)`、`src="data:…"` 归一成 `src=DATA`。
 * ⚠️ 代价：它不再能证明"插画是同一张图"。补偿是下面每个分支都断言
 * `data-testid="state-illustration-tasks"` 在其中 —— 这枚 testID **编码了 variant**
 * （`tasks`），换插画就会跟着变。
 *
 * ## 反向臂（这条 spec 会不会红）
 *
 * 把 `shell/EmptyState.tsx` 里 `size: 'page'` 改成 `'card'` ⇒ `view.illustration`
 * 变 `undefined` ⇒ 插画那一段整块消失 ⇒ 本 spec 精确红。
 * 2026-11 实测读数见交付报告。
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { EmptyState } from '../src/features/shell/EmptyState.js';

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

const renderHtml = async (node: React.ReactElement): Promise<string> => {
  const host = document.createElement('div');
  document.body.append(host);
  container = host;
  root = createRoot(host);
  await act(async () => {
    root?.render(node);
  });
  const html = host.firstElementChild?.outerHTML ?? '<none>';
  return html
    .replace(/url\(&quot;data:[^)]*&quot;\)/gu, 'url(DATA)')
    .replace(/src="data:[^"]*"/gu, 'src=DATA');
};

/**
 * 黄金结构 —— **从改动前的捕获里逐字抄来**。
 *
 * 只有两处是参数：标题与提示的文字节点。其余一个字符都不许动。
 */
const goldenHtml = (title: string, hint: string): string =>
  '<div class="ht-empty" data-testid="empty-state">' +
  '<div aria-hidden="true" class="css-view-g5y9jx r-alignItems-1awozwy r-height-sga3zk r-justifyContent-1777fci r-width-7a29px" style="opacity: 1; transform: translateY(0px) scale(1);" data-testid="state-illustration-tasks">' +
  '<div class="css-view-g5y9jx r-flexBasis-1mlwlqe r-overflow-1udh08x r-zIndex-417010 r-alignItems-1awozwy r-height-sga3zk r-justifyContent-1777fci r-width-7a29px" data-testid="state-artwork-tasks">' +
  '<div class="css-view-g5y9jx r-backgroundColor-1niwhzg r-backgroundPosition-vvn4in r-backgroundRepeat-u6sd8q r-bottom-1p0dtai r-height-1pi2tsx r-left-1d2f490 r-position-u8s1d r-right-zchlnj r-top-ipm5af r-width-13qz1uu r-zIndex-1wyyakw r-backgroundSize-ehq7j7" style="background-image: url(DATA);">' +
  '</div>' +
  '<img alt="" draggable="false" class="css-accessibilityImage-9pa8cd" src=DATA>' +
  '</div>' +
  '</div>' +
  `<p class="ht-empty__title">${title}</p>` +
  `<p class="ht-empty__hint">${hint}</p>` +
  '</div>';

/**
 * 五个有自己文案的分支 + 三个**落到 `all` 兜底**的分支。
 *
 * 后三个（`tomorrow` / `project` / `tag`）是 >「不能留一片空白」那条规则的落点：
 * 它们不在 `messages` 表里，必须拿到 `all` 的文案 —— 这正是 `?? messages['all']!`
 * 那一行的判据。**兜底分支尤其要钉**：如果有人把 `??` 去掉，只有它们会变空。
 */
const BRANCHES: readonly {
  readonly label: string;
  readonly filter: Record<string, unknown>;
  readonly title: string;
  readonly hint: string;
}[] = [
  {
    label: 'all（兜底本身）',
    filter: { kind: 'all' },
    title: '收集箱是空的',
    hint: '在上面输入框添加第一个任务',
  },
  {
    label: 'today',
    filter: { kind: 'today' },
    title: '今天没有到期任务',
    hint: '给任务设个截止时间，它会出现在这里',
  },
  {
    label: 'next7Days',
    filter: { kind: 'next7Days' },
    title: '未来 7 天没有安排',
    hint: '给任务设一个这几天内的截止时间，它会出现在这里',
  },
  {
    label: 'completed',
    filter: { kind: 'completed' },
    title: '还没有完成的任务',
    hint: '完成一个任务试试',
  },
  {
    label: 'quadrant',
    filter: { kind: 'quadrant', quadrant: 'q1' },
    title: '这个象限是空的',
    hint: '给任务标记重要程度与截止时间',
  },
  {
    label: 'tomorrow（无自有文案 ⇒ 兜底到 all）',
    filter: { kind: 'tomorrow' },
    title: '收集箱是空的',
    hint: '在上面输入框添加第一个任务',
  },
  {
    label: 'project（无自有文案 ⇒ 兜底到 all）',
    filter: { kind: 'project', projectId: 'p1' },
    title: '收集箱是空的',
    hint: '在上面输入框添加第一个任务',
  },
  {
    label: 'tag（无自有文案 ⇒ 兜底到 all）',
    filter: { kind: 'tag', tagId: 't1' },
    title: '收集箱是空的',
    hint: '在上面输入框添加第一个任务',
  },
];

describe('shell/EmptyState 的黄金 DOM（markup 逐字节不变）', () => {
  for (const branch of BRANCHES) {
    it(`${branch.label}：outerHTML 与改动前逐字节相同`, async () => {
      const html = await renderHtml(<EmptyState filter={branch.filter as never} />);
      expect(html).toBe(goldenHtml(branch.title, branch.hint));
    });
  }

  it('插画仍是 tasks 那一版（data: URI 被剥掉之后，靠 testID 钉住 variant）', async () => {
    const html = await renderHtml(<EmptyState filter={{ kind: 'all' } as never} />);
    expect(html).toContain('data-testid="state-illustration-tasks"');
    expect(html).toContain('data-testid="state-artwork-tasks"');
  });

  it('`.ht-empty` 一族仍然是这一屏的骨架（根节点与两枚 <p>）', async () => {
    const html = await renderHtml(<EmptyState filter={{ kind: 'all' } as never} />);
    expect(html.startsWith('<div class="ht-empty" data-testid="empty-state">')).toBe(true);
    expect(html).toContain('<p class="ht-empty__title">');
    expect(html).toContain('<p class="ht-empty__hint">');
  });
});
