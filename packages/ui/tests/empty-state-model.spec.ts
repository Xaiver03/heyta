/**
 * 空态共享模型的测试
 * ====================
 *
 * 挑的都是**不报错、只会画错**的边界 —— 与 `focus-model.spec.ts` 同一个取舍：
 *
 *   · `hint = ''` / `detail = '   '` —— 词条没翻译、后端没填时给的就是这个。
 *     直接渲染会多出一行**看不见但占高度**的空隙，把标题挤歪；
 *   · `icon = []` —— `HeytaIcon` 会画一个 32×32 的空白方块；
 *   · `detailTone` 的默认值"借"到一个**不存在的** detail 上，于是读屏在
 *     没有错误的时候报错。
 *
 * ⚠️ 这里**不渲染组件**（RN 是 Flow 源码，node 环境加载不了它 ——
 * `vitest.config.ts` 文件头记了理由）。所以判据是"有判断的逻辑"，
 * 而 `EmptyState.tsx` 里剩下的代码刻意没有分支。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import { nonBlank, toEmptyStateViewModel } from '../src/empty-state/model.js';

/** 一个最小的 lucide 形状图标（真实数据不是这个，但形状一致：`[标签, 属性][]`）。 */
const ICON = [['path', { d: 'M4 4h16' }]] as const;

describe('nonBlank', () => {
  it('把空串与纯空白归一成 undefined —— 否则会渲染出一行看不见但占高度的空隙', () => {
    expect(nonBlank(undefined)).toBeUndefined();
    expect(nonBlank('')).toBeUndefined();
    expect(nonBlank('   ')).toBeUndefined();
    expect(nonBlank('\n\t ')).toBeUndefined();
  });

  it('有内容的字符串**原样**保留（不 trim）—— 首尾空白属于文案自己', () => {
    expect(nonBlank('没有任务')).toBe('没有任务');
    expect(nonBlank(' 没有任务 ')).toBe(' 没有任务 ');
  });
});

describe('toEmptyStateViewModel —— 槽位归一', () => {
  it('title 必填；纯空白的 title 当场响，不静默渲染一片空白', () => {
    expect(() => toEmptyStateViewModel({ title: '' })).toThrow(/title/);
    expect(() => toEmptyStateViewModel({ title: '   ' })).toThrow(/title/);
    // 有内容的 title 正常通过。
    expect(toEmptyStateViewModel({ title: '没有任务' }).title).toBe('没有任务');
  });

  it('hint / detail 缺失或纯空白 → undefined（§1.6 的"居中一句"是合法形态）', () => {
    const onlyTitle = toEmptyStateViewModel({ title: '没有任务' });
    expect(onlyTitle.hint).toBeUndefined();
    expect(onlyTitle.detail).toBeUndefined();

    const blanks = toEmptyStateViewModel({
      title: '没有任务',
      hint: '',
      detail: '   ',
    });
    expect(blanks.hint).toBeUndefined();
    expect(blanks.detail).toBeUndefined();
  });

  it('icon 为空数组 → 视为没有图标（否则画出 32×32 的空白方块）', () => {
    expect(toEmptyStateViewModel({ title: 'x', icon: [] }).icon).toBeUndefined();
    expect(toEmptyStateViewModel({ title: 'x' }).icon).toBeUndefined();
    // 有内容的图标原样透传（同一个引用，不做拷贝）。
    expect(toEmptyStateViewModel({ title: 'x', icon: ICON }).icon).toBe(ICON);
  });
});

describe('toEmptyStateViewModel —— detail 的语义色与无障碍 role', () => {
  it('detailTone 默认 danger，只有 danger **且** detail 存在时才给 alert', () => {
    const danger = toEmptyStateViewModel({ title: 'x', detail: '连接超时' });
    expect(danger.detailTone).toBe('danger');
    expect(danger.detailRole).toBe('alert');

    const subtle = toEmptyStateViewModel({
      title: 'x',
      detail: '此功能尚未实现',
      detailTone: 'subtle',
    });
    expect(subtle.detailTone).toBe('subtle');
    // 🔴 说明性文字声明成 alert = 读屏在**没错的时候**报错。
    expect(subtle.detailRole).toBeUndefined();
  });

  it('没有 detail 时 detailRole 一定是 undefined —— tone 的默认值不该借到不存在的节点上', () => {
    expect(toEmptyStateViewModel({ title: 'x' }).detailRole).toBeUndefined();
    expect(toEmptyStateViewModel({ title: 'x', detail: '' }).detailRole).toBeUndefined();
    // 显式传 danger 也一样：节点不渲染，就没有 role 可声明。
    expect(
      toEmptyStateViewModel({ title: 'x', detail: '  ', detailTone: 'danger' }).detailRole,
    ).toBeUndefined();
  });
});

describe('toEmptyStateViewModel —— 根节点 role 是固定的 summary', () => {
  it('四个槽位怎么组合都不影响它（它不是由 props 决定的）', () => {
    expect(toEmptyStateViewModel({ title: 'x' }).a11yRole).toBe('summary');
    expect(
      toEmptyStateViewModel({ title: 'x', icon: ICON, hint: 'h', detail: 'd' }).a11yRole,
    ).toBe('summary');
  });
});

describe('toEmptyStateViewModel —— size 四档', () => {
  it('省略 = page，且现有站点该拿到的还拿到（图标不被这一档误伤）', () => {
    const v = toEmptyStateViewModel({ title: 'x', icon: ICON });
    expect(v.size).toBe('page');
    expect(v.icon).toEqual(ICON);
  });

  it('section 档明确把图标归一成 undefined —— 而不是渲染端静默丢弃入参', () => {
    const v = toEmptyStateViewModel({ title: 'x', icon: ICON, size: 'section' });
    expect(v.size).toBe('section');
    expect(v.icon).toBeUndefined();
  });

  it('两档只差"图标 + 居中/占高"，其余槽位的归一规则逐字相同', () => {
    const page = toEmptyStateViewModel({ title: 'x', hint: '  ', detail: '', size: 'page' });
    const section = toEmptyStateViewModel({ title: 'x', hint: '  ', detail: '', size: 'section' });
    expect(page.hint).toBeUndefined();
    expect(page.detail).toBeUndefined();
    expect(section.hint).toBeUndefined();
    expect(section.detail).toBeUndefined();
    expect(section.detailRole).toBe(page.detailRole);
    expect(section.a11yRole).toBe(page.a11yRole);
  });

  it('section 档不豁免 title 必填 —— 空白空态仍然当场响', () => {
    expect(() => toEmptyStateViewModel({ title: '  ', size: 'section' })).toThrow(/title/);
  });

  /**
   * `line` 档存在的理由（写在 `model.ts` 的档注释里）是**不改视觉就收编不了**：
   * 它比 `section` 还轻一档。所以这一档最容易被后来者"顺手"画成 `page` 的形状
   * —— 而那种错**不会让任何一条既有断言变红**，只会让侧栏里那行灰色占位
   * 撑出一块居中的大空隙。这三条钉的就是它自己的三条承诺。
   */
  it('line 档把图标与插画都归一成 undefined —— 一行里塞不下 32 的字形', () => {
    const v = toEmptyStateViewModel({
      title: '今天没有会话',
      icon: ICON,
      illustration: 'notes',
      size: 'line',
    });
    expect(v.size).toBe('line');
    expect(v.icon).toBeUndefined();
    expect(v.illustration).toBeUndefined();
  });

  it('line 档不豁免 title 必填', () => {
    expect(() => toEmptyStateViewModel({ title: '   ', size: 'line' })).toThrow(/title/);
  });

  it('四档只差图标/插画/居中，其余槽位的归一逐字相同（含 detailRole 与 a11yRole）', () => {
    const slots = { title: 'x', hint: '  ', detail: '', icon: ICON, illustration: 'tasks' } as const;
    const page = toEmptyStateViewModel({ ...slots });
    for (const size of ['section', 'line', 'card'] as const) {
      const v = toEmptyStateViewModel({ ...slots, size });
      expect([v.hint, v.detail, v.detailTone, v.detailRole, v.a11yRole, v.locale]).toEqual([
        page.hint,
        page.detail,
        page.detailTone,
        page.detailRole,
        page.a11yRole,
        page.locale,
      ]);
    }
  });

  it('页面档可以挂一枚语义微场景，并默认只播放一次入场动效', () => {
    const v = toEmptyStateViewModel({ title: '没有任务', icon: ICON, illustration: 'tasks' });
    expect(v.illustration).toBe('tasks');
    expect(v.illustrationMotion).toBe('enter');
    expect(v.icon).toBeUndefined();
  });

  it('搜索空态可以关闭入场动效，避免每次输入重播', () => {
    const v = toEmptyStateViewModel({
      title: '没有匹配结果',
      illustration: 'search',
      illustrationMotion: 'none',
    });
    expect(v.illustration).toBe('search');
    expect(v.illustrationMotion).toBe('none');
  });

  it('空态把宿主传入的 i18n locale 原样交给插画层，省略时使用中文默认值', () => {
    expect(toEmptyStateViewModel({ title: 'No tasks', illustration: 'tasks', locale: 'en' }).locale).toBe('en');
    expect(toEmptyStateViewModel({ title: '没有任务', illustration: 'tasks' }).locale).toBe('zh-CN');
  });

  it('section 档不渲染微场景，避免卡片级空态抢走区块标题的重心', () => {
    const v = toEmptyStateViewModel({
      title: '还没有笔记',
      size: 'section',
      illustration: 'notes',
    });
    expect(v.illustration).toBeUndefined();
  });
});

/**
 * `card` 档（R11 的第四档）——「居中但紧凑」的那一格。
 *
 * 它要替换的站点是**住在别人卡片里**的那一批：24rem 的下拉面板、月历格、
 * 日档那条"带"、任务详情里的排程预览、看板列、四象限格。
 * 它们借 `page` 时会连 `space.16`×2（128px）的页面级留白一起借过去，
 * 于是"没有内容"被画成一整块空白 —— 而那种错**没有任何断言会红**。
 *
 * 这个 describe 分两半：
 *   · 前半钉**模型**（size / 图标 / 插画 / 其余槽位归一）；
 *   · 后半钉**组件的源码形状**（`rootCard` 的留白、`rootStyle` 的四支）。
 *     后者是因为 `packages/ui` 的测试跑在 node 环境、加载不了 RN 渲染树
 *     （`vitest.config.ts` 文件头），"有没有 128px 留白"在模型里量不到 ——
 *     而"把 card 注成 page"最可能的写法**恰好**是把 `rootStyle` 改回兜底。
 */
describe('toEmptyStateViewModel —— card 档（居中但紧凑）', () => {
  it('🔴 size:"card" 就是 card —— 注成 "page" 的第一秒就红', () => {
    expect(toEmptyStateViewModel({ title: 'x', size: 'card' }).size).toBe('card');
  });

  it('card 是"居中"那一支：与 page 同轴，与 section/line 不同轴', () => {
    // 模型不直接给 align，但"居中"这一支在组件里由 size 决定；
    // 这里钉的是**档本身**没有被折叠进 section/line（那会让它左对齐）。
    const card = toEmptyStateViewModel({ title: 'x', size: 'card' });
    expect(['page', 'card']).toContain(card.size);
  });

  it('card 不画图形：图标与插画都归一成 undefined（32 的字形会把紧凑版撑回 page 的高度）', () => {
    const v = toEmptyStateViewModel({
      title: '还没有通知',
      icon: ICON,
      illustration: 'notes',
      size: 'card',
    });
    expect(v.icon).toBeUndefined();
    // ③ 与 section 同行为：传了 illustration 也不渲染。
    expect(v.illustration).toBeUndefined();
  });

  it('card 不豁免 title 必填 —— 空白空态仍然当场响', () => {
    expect(() => toEmptyStateViewModel({ title: '   ', size: 'card' })).toThrow(/title/);
  });

  it('card 的 hint 可选（紧凑版也只有一句时是合法形态）', () => {
    expect(toEmptyStateViewModel({ title: 'x', size: 'card' }).hint).toBeUndefined();
    expect(toEmptyStateViewModel({ title: 'x', hint: '  ', size: 'card' }).hint).toBeUndefined();
  });

  /**
   * ② 默认仍是 `page`，现有站点**一个像素都不变**。
   *
   * 这里不用快照：快照把"现在是什么"腌进文件，改一个无关字段就整块重写，
   * 评审看不到"到底哪一格动了"。改成**逐字段列全**的深比较 ——
   * 任何一格变了，diff 直接指向那一行。
   */
  it('不传 size ⇒ 与加这一档之前**逐字段相同**（默认 page，其余槽位一个都不许动）', () => {
    expect(
      toEmptyStateViewModel({ title: '没有任务', icon: ICON, hint: '点右上角新建', detail: 'x' }),
    ).toStrictEqual({
      icon: ICON,
      title: '没有任务',
      hint: '点右上角新建',
      detail: 'x',
      detailTone: 'danger',
      size: 'page',
      illustration: undefined,
      illustrationMotion: 'enter',
      action: undefined,
      locale: 'zh-CN',
      detailRole: 'alert',
      a11yRole: 'summary',
    });
  });
});

describe('EmptyState.tsx 的源码形状 —— card 档的"无页面级留白"只能在这里量', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const FILE = resolve(here, '../src/empty-state/EmptyState.tsx');

  /**
   * 🔴 去掉注释再判 —— 与 `settings-hint-through-tip.spec.ts` 同一条纪律。
   *
   * `rootCard` 的注释里**必须**能写"别抄 `page` 那 128px 留白"，
   * 而那句话里就会出现 token 名。不掩码的话，照纪律写注释的人会得到一条
   * **假红**，而假红的终局永远是"有人来放宽这条判据"（本仓反复吃过的形状）。
   */
  const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/[^\n]*/gu, '$1');

  const source = stripComments(readFileSync(FILE, 'utf8'));

  /** 取 `key: { … }` 那一块（按花括号配平，不靠正则的贪婪/懒惰去猜）。 */
  const styleBlock = (key: string): string => {
    const at = source.indexOf(`${key}: {`);
    expect(at, `EmptyState.tsx 里找不到样式键 ${key} —— 判据的锚点失效了`).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = source.indexOf('{', at); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(at, i + 1);
      }
    }
    throw new Error(`${key} 的花括号没有闭合`);
  };

  it('锚点：page 档确实拿着那 128px 留白（不然下面那条"card 没有"就是空断言）', () => {
    expect(styleBlock('root')).toContain("tokens['space.16']");
  });

  it('① card 档一级上下留白都不给 —— 衬 `space.16` 就是又借了页面档的留白', () => {
    const card = styleBlock('rootCard');
    expect(card).not.toContain("tokens['space.16']");
    // 只保留行距；外框 padding 归所在卡片。
    expect(card).toContain("tokens['space.2']");
    // 居中这一条要继承（它是"居中但紧凑"）。
    expect(card).toContain("alignItems: 'center'");
  });

  it('① rootStyle 必须是**显式四支**，不许"落到兜底"—— 兜底就是 styles.root（带 128px）', () => {
    const at = source.indexOf('const rootStyle =');
    expect(at, 'rootStyle 不见了').toBeGreaterThan(-1);
    const end = source.indexOf(';', at);
    const expr = source.slice(at, end);

    // 四支齐全。
    expect(expr).toContain("size === 'page'");
    expect(expr).toContain("size === 'card'");
    expect(expr).toContain("size === 'section'");
    expect(expr).toContain('styles.rootCard');
    // 🔴 最后不得收在 `styles.root` 上：那是把"没写到的档"都当成页面档。
    expect(expr.trimEnd()).not.toMatch(/:\s*styles\.root\s*$/u);
  });
});

describe('动作槽（P7）—— 它只有"给/不给"两个方向，没有默认值', () => {
  it('宿主给了动作 ⇒ 模型原样带过去，不替宿主判断该不该画', () => {
    const action = { type: 'button' } as unknown as ReactNode;
    expect(toEmptyStateViewModel({ title: '还没有习惯', action }).action).toBe(action);
  });

  it('🔴 对照臂：没给动作 ⇒ `undefined`，一格都不画（"纯无内容态不制造假动作"靠的就是这个省略方向）', () => {
    expect(toEmptyStateViewModel({ title: '还没有习惯' }).action).toBeUndefined();
  });

  it('给了 `hint` 没给动作也**不许**凭空造一枚控件', () => {
    const view = toEmptyStateViewModel({ title: '还没有习惯', hint: '添加一个习惯，从今天开始记录。' });
    expect(view.hint).toBe('添加一个习惯，从今天开始记录。');
    expect(view.action).toBeUndefined();
  });
});
