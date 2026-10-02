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

import { describe, expect, it } from 'vitest';

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

describe('toEmptyStateViewModel —— size 两档', () => {
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
});
