/**
 * 便签编辑卡的**落点**（详情列 / 板子上方）
 * ==========================================
 *
 * 工单 C1 拍板 #1："选中某条 = 同一格换成该实体面单，不另开第三处"。
 * 这一格今天装的是**便签编辑卡**（`NoteEditorCard`）。它必须同时满足：
 *
 *   1. 详情列**看得见**时，编辑器在那一栏里，而板子上方那枚**不存在** ——
 *      不是"两处都有"（那就是第三处）；
 *   2. 看不见时（窄屏 / 太矮 / 用户主动收起）编辑器回到板子上方 ——
 *      🔴 不能只靠 CSS 藏：`display:none` 里那枚编辑器意味着"点了没反应，
 *      但选中态已经进模型"，那是界面在说谎；
 *   3. "看得见吗"这件事只有**一个**算法，且它与 `narrow.css` 那两条媒体规则同源。
 *
 * ⚠️ 落点的真浏览器读数在 `e2e/tests/detail-pane-note-editor.spec.ts`（N1–N4）；
 * 这一层管的是"规则本身对不对 + 宿主有没有把开关接上"，两层各管各的
 * （直接挂组件的测试看不见 `App.tsx` 漏接线 —— 这条在 `due-date-edit.spec.tsx` 里记过）。
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyState } from '@heyta/op-log';
import { I18nProvider } from '@heyta/i18n';

import { selection } from '../src/lib/selection.js';
import { __resetOpLogForTests, initOpLog, useTaskStore } from '../src/features/tasks/store.js';
import { useNoteStore } from '../src/features/notes/store.js';
import {
  DETAIL_FITS_QUERY,
  detailFitsViewport,
  useDetailColumnShown,
} from '../src/features/shell/detail-pane-visible.js';

const { NotesView } = await import('../src/features/notes/NotesView.js');
const { NoteEditorCard } = await import('../src/features/notes/NoteEditorCard.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const realMatchMedia = window.matchMedia;

/** 让 `matchMedia` 按**给定的查询串**返回真假，而不是恒假 —— jsdom 的默认桩只回 false。 */
function stubMedia(match: (query: string) => boolean): void {
  window.matchMedia = ((query: string) =>
    ({
      matches: match(query),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(async () => {
  const g = globalThis as unknown as { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;
  stubMedia(() => true);
  __resetOpLogForTests();
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' }, now: Date.now(), ready: false });
  useNoteStore.setState({ notes: [], error: undefined });
  selection.select('note', null);
  await initOpLog(`placement-${Math.random().toString(36).slice(2)}`);
  useNoteStore.setState({
    notes: [
      { id: 'n1', content: '第一条便签', pinned: false } as never,
      { id: 'n2', content: '第二条便签', pinned: false } as never,
    ],
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container = undefined;
  selection.select('note', null);
  window.matchMedia = realMatchMedia;
});

async function mount(node: React.JSX.Element): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<I18nProvider locale="zh-CN">{node}</I18nProvider>);
  });
  return container;
}

const editorsIn = (view: HTMLElement) =>
  Array.from(view.querySelectorAll<HTMLElement>('[data-testid="notes-editor"]'));

describe('P1 那一栏"放不放得下"只有一个算法', () => {
  it('查询串与 narrow.css 的三条隐藏规则同源', () => {
    expect(DETAIL_FITS_QUERY).toBe('(min-width: 1024px) and (min-height: 480px)');
    const css = readFileSync(join(process.cwd(), 'src/styles/app/narrow.css'), 'utf8');
    // 🔴 反向钉的是"那三条**各自**都藏了详情列"，不是"文件里有这三个串" ——
    // 只查串在不在，等于把判据写成一份会漂的抄件：别人加一条不藏详情列的同款媒体查询，
    // 这里照样绿。三条的并集 = 宽 ≤1023 或（宽 ≥1024 且高 ≤479）⇒ 看得见 = 宽 ≥1024 且高 ≥480。
    for (const q of [
      '@media (max-width: 768px)',
      '@media (min-width: 769px) and (max-width: 1023px)',
      '@media (min-width: 1024px) and (max-height: 479px)',
    ]) {
      const at = css.indexOf(q);
      expect(at, `narrow.css 里找不到 ${q}`).toBeGreaterThan(-1);
      const next = css.indexOf('@media', at + q.length);
      const block = css.slice(at, next === -1 ? css.length : next);
      expect(block, `${q} 这一块里没有隐藏详情列，那 JS 侧的"放不下"就是凭空写的`).toContain(
        '.ht-app__detail,',
      );
    }
  });

  it('窄屏 / 矮屏 ⇒ 放不下；两者都够 ⇒ 放得下', () => {
    stubMedia((q) => q !== DETAIL_FITS_QUERY);
    expect(detailFitsViewport(), '桩说"不匹配"时读数必须是 false').toBe(false);
    stubMedia((q) => q === DETAIL_FITS_QUERY);
    expect(detailFitsViewport()).toBe(true);
  });

  it('用户主动收起 ⇒ 看不见，但它不是几何问题（collapsed 是另一个输入）', async () => {
    stubMedia(() => true);
    const Probe = () => <span data-testid="probe">{String(useDetailColumnShown(true))}</span>;
    const view = await mount(<Probe />);
    expect(view.querySelector<HTMLElement>('[data-testid="probe"]')?.textContent).toBe('false');
  });
});

describe('P2 落点：DOM 里永远只有一枚编辑器', () => {
  beforeEach(() => {
    selection.select('note', 'n1');
  });

  it('`editorInColumn=true` ⇒ 板子上方那枚不存在', async () => {
    const view = await mount(<NotesView editorInColumn />);
    expect(editorsIn(view), '板子上方不该有编辑器').toHaveLength(0);
  });

  it('`editorInColumn=false` ⇒ 板子上方恰好一枚', async () => {
    const view = await mount(<NotesView editorInColumn={false} />);
    expect(editorsIn(view)).toHaveLength(1);
  });

  it('面单内容跟着选中走，与落点无关（W1b 第 2 条腿的规则半边）', async () => {
    const view = await mount(<NoteEditorCard inset={false} />);
    const textOf = () =>
      view.querySelector<HTMLTextAreaElement>('[data-testid="notes-editor-input"]')?.value ?? '';
    expect(textOf()).toContain('第一条便签');
    await act(async () => {
      selection.select('note', 'n2');
    });
    expect(textOf(), '换选中后面单还是旧那条').toContain('第二条便签');
    expect(editorsIn(view), '换选中时多出一枚编辑器').toHaveLength(1);
  });

  it('没选中 ⇒ 一枚都没有（不是一枚空面板）', async () => {
    selection.select('note', null);
    const view = await mount(<NoteEditorCard inset={false} />);
    expect(editorsIn(view)).toHaveLength(0);
  });

  /* 🔴 inset 那一档住在**生产者**里，不是装配处的 `<div>`：`check:detail-pane-slot` 的腿 A
     就是拦"槽里手写 DOM 标记"的（它把装配处包壳那一版判红了，实测 RC=1）。
     搬进来之后必须有一条判据钉住"两支的 inset 各是什么"，否则它会悄悄被两边共用。 */
  it('inset 只有栏里那一支拿到；回落那一支的 DOM 里不多一层壳', async () => {
    selection.select('note', 'n1');
    const inColumn = await mount(<NoteEditorCard inset />);
    const shell = inColumn.querySelector('.ht-app__detail-note');
    expect(shell, '栏里那一支没带详情列的内边距壳（⇒ 面单会贴住窗口右边缘）').not.toBeNull();
    expect(
      shell?.querySelector('[data-testid="notes-editor"]'),
      '内边距壳里装的不是编辑器',
    ).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    root = undefined;
    selection.select('note', 'n1');
    const fallback = await mount(<NoteEditorCard inset={false} />);
    expect(
      fallback.querySelector('.ht-app__detail-note'),
      '回落那一支也套了壳 ⇒ 板子上方的形状跟着变了（这一单不该改它）',
    ).toBeNull();
  });
});

describe('P3 宿主接线（App.tsx 源码形状，直接挂组件的用例看不见这一层）', () => {
  /* 🔴 先剥注释再匹配。第一版直接对原文匹配，结果**我自己写在注释里的那三个字面 `<div>`**
     把"槽里不许手写 div"那条判据弄红了 —— 一条会被注释内容改变的判据，量的不是代码。
     常驻门禁 `check:detail-pane-slot` 早就是"剥注释后再数"（它自己的输出里写着
     `扫描射程：3 段文本，剥注释后共 165 行`），这里跟它同一口径。
     行注释只认**行首**的：字符串里的 `//`（URL）不算注释，按行首判不会误伤。 */
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const app = stripComments(readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8'));
  // 切片按**结构**定位，不按"某个属性恰好写在同一行"。合并进 main 之后那一支多挂了一个
  // `ref={detailRef}`（`detailHasRoom` 由它量出来），JSX 于是被拆成多行 ——
  // 原来那串 `<aside className="ht-app__detail"` 整串一断，切片就静默变成空串，
  // 这条判据就从"验装配形状"退化成"验 JSX 排成一行"（本篇 §8 那一族：判据的载体替被测对象说话）。
  const asideOpen = app.search(/<aside\b[^>]*ht-app__detail[^>]*>/);
  const aside = asideOpen === -1 ? '' : app.slice(asideOpen, app.indexOf('</aside>', asideOpen));

  it('详情列里那一支带的是**几何 + 收起**两个条件，不是恒真', () => {
    // 先证明切片本身不是空的：空切片会让下面三条一起红，而红字只会说“组件没接上”。
    expect(aside, 'aside 切片为空 ⇒ 锚点没找到，别把它读成装配缺失').toContain('ht-app__detail');
    expect(aside, '详情列里找不到 NoteEditorCard').toContain('<NoteEditorCard inset');
    expect(aside).toContain('contentView === \'notes\' && detailColumnShown');
    // 槽里不许手写 DOM（`check:detail-pane-slot` 的腿 A 也管这个，两层各挡各的写法）。
    expect(aside, '装配处手写了 div ⇒ 内边距那一层壳该回到生产者里').not.toMatch(/<div\b/);
  });

  it('递给 NotesView 的是同一个布尔，而不是又算一遍 / 写死', () => {
    expect(app.match(/editorInColumn=\{detailColumnShown\}/g) ?? []).toHaveLength(1);
  });

  it('`editorInColumn` 是必填 prop（默认值等于原行为的那一档会把"宿主没接"伪装成"做完了"）', () => {
    const src = readFileSync(join(process.cwd(), 'src/features/notes/NotesView.tsx'), 'utf8');
    expect(src).toContain('editorInColumn: boolean');
    expect(src).not.toContain('editorInColumn?:');
  });
});
