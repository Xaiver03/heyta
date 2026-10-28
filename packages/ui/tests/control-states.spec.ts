/**
 * `control/states.ts` 的契约 —— 全局 UX 线 P4
 *
 * 这里测的不是"函数返回对不对"这种自证，而是**这个模块存在的理由**：
 * 色调配方只有一个所有者、每个 token 名在两张真表里都解析得到、
 * 三根状态轴发什么属性有唯一答案。
 *
 * 🔴 每条判据都标了它要拦住的那次真实事故或现量读数。判据写宽 = 没有判据
 *   （AGENTS §6 第 2 条：不能失败的检查没有价值），所以断言逐条分开设：
 *   hover 与 focus、`aria-selected` 与 `aria-current`、亮表与暗表各一条。
 */

import { darkTokens, lightTokens } from '@heyta/design-system';
import { describe, expect, it } from 'vitest';

import {
  ARIA_CURRENT_VALUES,
  CONTROL_STATE_TOKENS,
  CONTROL_TONES,
  DEFAULT_CONTROL_EMPHASIS,
  SELECTION_ATTRIBUTES,
  controlAccessibilityState,
  controlAria,
  controlPaletteOf,
  hasCommitOverride,
  type ControlPalette,
  type ControlStateAxes,
  type ControlTone,
  type SelectionContext,
} from '../src/control/states.js';

/**
 * token 名 → 真值。
 *
 * `'transparent'` 是配方里唯一允许的非 token（它表达"没有填充"），所以单独放行；
 * 除此之外任何一个名字在两表里索不到就红 —— 那正是 `kit.tsx:766` 记着的那次：
 * 想当然编的 `color.danger-foreground` 让按钮文字变成 `undefined`，
 * 在深色背景上**完全看不见**，而 TS 与构建都没报。
 */
function resolve(name: string): string | undefined {
  if (name === 'transparent') return 'transparent';
  return (lightTokens as unknown as Record<string, string | undefined>)[name];
}

function resolveDark(name: string): string | undefined {
  if (name === 'transparent') return 'transparent';
  return (darkTokens as unknown as Record<string, string | undefined>)[name];
}

/**
 * "这个名字在真表里索得到值"。
 *
 * ⚠️ 用 `typeof === 'string'` 而不是 `toBeString()`：本仓的 vitest 没装
 * jest-extended，那个匹配器在这里是 `Invalid Chai property`（实测），
 * 而一条**每次都炸**的断言与一条没有断言等价。
 */
function expectRealToken(resolved: string | undefined, label: string): void {
  expect(typeof resolved, label).toBe('string');
}

/**
 * "这个名字在真表里有值"，不判类型。
 *
 * 🔴 为什么单独一枚：`state.*` / `motion.*` / `duration.*` 这三组在原生表里是**数**
 *（`state.disabled-opacity` 实测 0.38、`motion.press-scale` 0.97），只有颜色是串。
 * 拿 `typeof === 'string'` 去量它们会**假红** —— 而一条假红的判据教人关掉整块。
 */
function expectTokenExists(resolved: unknown, label: string): void {
  expect(resolved, label).toBeDefined();
}

describe('一、色调配方：四档、每档都有、每个名字都真', () => {
  it('CONTROL_TONES 就是那四档，多一档少一档都红', () => {
    // 加一档而不给配方 → 下面 `controlPaletteOf` 那条红；
    // 改名单方（比如把 ghost 换成 text）→ 这条先红，逼人来这里改词表。
    expect([...CONTROL_TONES].sort()).toEqual(['danger', 'ghost', 'primary', 'secondary']);
  });

  it.each(CONTROL_TONES)('%s 有配方', (tone) => {
    expect(controlPaletteOf(tone)).toBeDefined();
  });

  it.each(CONTROL_TONES)('%s 的配方里每个 token 名在亮色表里解析得到', (tone) => {
    const palette = controlPaletteOf(tone)!;
    for (const value of [palette.bg, palette.fg, palette.hoverBg, palette.hoverFg, palette.activeBg]) {
      if (value === undefined) continue;
      expectRealToken(resolve(value), `${tone} 引用了亮色表里不存在的 token：${value}`);
    }
  });

  it.each(CONTROL_TONES)('%s 的配方里每个 token 名在暗色表里同样解析得到', (tone) => {
    // 暗色单独一条：历史上出过"亮表里有、暗表里靠继承"的形状，
    // 两表是生成产物，缺哪一档只在切到暗色时才发现。
    const palette = controlPaletteOf(tone)!;
    for (const value of [palette.bg, palette.fg, palette.hoverBg, palette.hoverFg, palette.activeBg]) {
      if (value === undefined) continue;
      expectRealToken(resolveDark(value), `${tone} 引用了暗色表里不存在的 token：${value}`);
    }
  });

  it('词表外的色调拿不到配方，且不许被兜成任何默认档', () => {
    // 判据的形状：`receiptTimingOf` 同一保守方向 —— 查不到就不画，不猜。
    expect(controlPaletteOf('warning' as unknown as ControlTone)).toBeUndefined();
    expect(controlPaletteOf(undefined as unknown as ControlTone)).toBeUndefined();
  });

  it('danger 是行内档（透明底 + 危险色文字），不是实底', () => {
    // 🔴 这一条把 P4 那次分叉钉死：Web 画文字红、Mobile 画实底红，同一个名字两种重量。
    // 要改成实底必须先有 `color.on-danger` 前景 token 并进 `AA_PAIRS`
    //（`tokens.ts` 那句"没被点名的 token 等于没被检查"就是现在的状态），
    // 不能靠借 `foreground-inverse` —— 那是"反色"，不是"危险底上的字"。
    const palette = controlPaletteOf('danger')!;
    expect(palette.bg).toBe('transparent');
    expect(palette.fg).toBe('color.danger');
    expect(palette.hoverBg).toBe('color.danger-subtle');
    expect(palette.hoverFg).toBe('color.danger-strong');
  });

  it('secondary 有填充且前景不许降到 subtle', () => {
    // Web 现量根本没有 `ht-btn--secondary`（`grep -c` 读数 0），于是 18 枚裸
    // `className="ht-btn"` 没有底、sheets.css 在局部现造了一个凹陷底。
    // subtle 那一格是 `tokens.ts` 里明写"够不到 4.5、没登记也没人管"的那条边界。
    const palette = controlPaletteOf('secondary')!;
    expect(palette.bg).toBe('color.surface-sunken');
    expect(palette.fg).toBe('color.foreground');
    expect(palette.hoverFg).toBe('color.foreground');
  });

  it('只有 primary 有按下换底档，其余档位走缩放', () => {
    // 现量：`kit.tsx` 里 `Button` 用裸 `opacity: 0.85`、`IconButton` 换 `color.hover` 底、
    // `Checkbox`/`Fab` 用 `motion.press-scale` 缩放 —— 一个文件三种"按下"。
    // 判据：换底档只属于 primary，其余档必须 undefined，按下统一走缩放。
    expect(controlPaletteOf('primary')!.activeBg).toBe('color.primary-active');
    for (const tone of ['secondary', 'ghost', 'danger'] as const) {
      expect(controlPaletteOf(tone)!.activeBg, `${tone} 不该有按下换底档`).toBeUndefined();
    }
  });

  it('三枚状态 token 都在真表里（裸值无处可藏的正面写法）', () => {
    // 反面就是现状：Web `.ht-btn:disabled` 写死 0.5，而表里的 `state.disabled-opacity`
    // 是 0.38 —— 同一个"点不动"两个重量。
    for (const [axis, name] of Object.entries(CONTROL_STATE_TOKENS)) {
      expectTokenExists(resolve(name), `${axis} 的 token 在亮色表里不存在：${name}`);
      expectTokenExists(resolveDark(name), `${axis} 的 token 在暗色表里不存在：${name}`);
    }
  });
});

describe('一b、重量档（inline / commit）', () => {
  it('不写重量时就是行内档 —— 现有调用方不许被静默换成实底', () => {
    // 对照臂的形状与 P3 那枚 `kind="notice"` 同源：**默认值必须是可判红的断言**，
    // 否则"给默认档加了实底"这种改动只会让每一屏悄悄变重，没有一处会红。
    expect(DEFAULT_CONTROL_EMPHASIS).toBe('inline');
    expect(controlPaletteOf('danger')).toEqual(controlPaletteOf('danger', 'inline'));
  });

  it('commit 的 danger 是实底，前景用 on-danger', () => {
    const commit = controlPaletteOf('danger', 'commit')!;
    expect(commit.bg).toBe('color.danger');
    expect(commit.fg).toBe('color.on-danger');
    expect(commit.hoverBg).toBe('color.danger-strong');
    expect(commit.hoverFg).toBe('color.on-danger');
    // 与行内档**确实不同**（同配方还宣称分档＝那一档是空的）。
    expect(commit).not.toEqual(controlPaletteOf('danger', 'inline'));
  });

  it('commit 覆盖表里只有 danger —— 按**条目在不在**判，不按配方是否不同判', () => {
    // 这条是补出来的：原来只有下面那枚"其余三档等于自己"，而它比的是配方相等 ⇒
    // 注入 `primary: CONTROL_PALETTE.primary`（一条和行内一模一样的覆盖，正是
    // `check:selection-single-source` 判据 D 罚的零消费者槽位）时 38 条全绿。
    // 槽位在不在只能由键的存在性回答。
    expect(CONTROL_TONES.filter(hasCommitOverride)).toEqual(['danger']);
  });

  it('其余三档带上 commit 外观不变', () => {
    // 与上面那枚分工不同：上面罚"建了空槽位"，这一枚守"加了维度不许把现有
    // 界面静默换重"。两枚都要在 —— 只留下面这枚，槽位就没人管了。
    for (const tone of ['primary', 'secondary', 'ghost'] as const) {
      expect(controlPaletteOf(tone, 'commit'), `${tone} 不该有独立的 commit 配方`).toEqual(
        controlPaletteOf(tone),
      );
    }
  });

  it.each(CONTROL_TONES)('%s 两档配方里的每个 token 名在亮暗两表都解析得到', (tone) => {
    for (const emphasis of ['inline', 'commit'] as const) {
      const palette = controlPaletteOf(tone, emphasis)!;
      for (const value of [
        palette.bg,
        palette.fg,
        palette.hoverBg,
        palette.hoverFg,
        palette.activeBg,
      ]) {
        if (value === undefined) continue;
        expectRealToken(resolve(value), `${tone}/${emphasis} 亮色表里没有：${value}`);
        expectRealToken(resolveDark(value), `${tone}/${emphasis} 暗色表里没有：${value}`);
      }
    }
  });

  it('词表外的色调即使带上 commit 也拿不到配方', () => {
    expect(controlPaletteOf('warning' as unknown as ControlTone, 'commit')).toBeUndefined();
  });
});

describe('二、状态轴 → 平铺 aria（共享层唯一的出口形状）', () => {
  it('开关与展开在 off 态显式写 "false"', () => {
    // 缺席不等于"否"：读屏拿到没有 `aria-pressed` 的一枚按钮，判断不出
    // "这是个开关、现在是关的"还是"这根本是个普通按钮"。
    expect(controlAria({ pressed: false })).toEqual({ 'aria-pressed': 'false' });
    expect(controlAria({ pressed: true })).toEqual({ 'aria-pressed': 'true' });
    expect(controlAria({ expanded: false })).toEqual({ 'aria-expanded': 'false' });
    expect(controlAria({ expanded: true })).toEqual({ 'aria-expanded': 'true' });
  });

  it('没有任何状态轴时不发任何属性', () => {
    // 防的是"顺手给每枚按钮补个 aria-pressed=false"，那会把普通按钮全变成开关。
    expect(controlAria({})).toEqual({});
  });

  it('tab 场景发 aria-selected，两态都写', () => {
    expect(controlAria({ selected: true, selection: 'tab' })).toEqual({ 'aria-selected': 'true' });
    expect(controlAria({ selected: false, selection: 'tab' })).toEqual({ 'aria-selected': 'false' });
  });

  it('不写场景就带 selected —— 编译期拦住（这条是运行时的对偶）', () => {
    // 判据的形状来自 P3 那条教训：**没有默认档**。给 `selected` 兜一个 'tab'
    // 等于由这枚函数替每一屏决定语义，而"选中"在本仓现量发成过四种属性。
    // TS 那一面由 `ControlStateAxes` 的联合类型挡（这一格**不写 `selection` 就过不了
    // typecheck**，实测：`Property 'selection' is missing`）；`as unknown as` 是把
    // 编译器按住之后，看运行时会画成什么 —— 答案是"什么都不发"。
    const withoutScene = { selected: true } as unknown as ControlStateAxes;
    expect(controlAria(withoutScene)).toEqual({});
    const withScene = { selected: true, selection: 'tab' as const };
    expect(controlAria(withScene)).toEqual({ 'aria-selected': 'true' });
  });

  it('nav 场景发 aria-current="page"，off 态整把键都不在', () => {
    expect(controlAria({ selected: true, selection: 'nav' })).toEqual({ 'aria-current': 'page' });
    expect(controlAria({ selected: false, selection: 'nav' })).toEqual({});
  });

  it('date 场景发 aria-current="date"，off 态整把键都不在', () => {
    // 日历"今天"那一格：`CalendarYearBoard` 现量就是这个写法，收编而不是改写。
    expect(controlAria({ selected: true, selection: 'date' })).toEqual({ 'aria-current': 'date' });
    expect(controlAria({ selected: false, selection: 'date' })).toEqual({});
  });

  it('aria-current 的值永远是那两个字面量，不可能是布尔', () => {
    // `NavButton.tsx:38` 现量写 `aria-current={active}`，发出去是 "true"/"false"。
    // React 的属性表允许布尔，类型挡不住，所以这条断言替它挡。
    for (const selected of [true, false]) {
      for (const selection of ['nav', 'date'] as const) {
        const value = controlAria({ selected, selection })['aria-current'];
        if (value === undefined) continue;
        expect(typeof value).toBe('string');
        expect(['page', 'date']).toContain(value);
      }
    }
    expect(ARIA_CURRENT_VALUES).toEqual({ nav: 'page', date: 'date' });
  });

  it('SELECTION_ATTRIBUTES 对每一档场景都给了答案', () => {
    // 穷尽判据：加一档 `SelectionContext` 而不在这里给配方 → 这条红。
    const contexts: readonly SelectionContext[] = ['tab', 'nav', 'date'];
    for (const context of contexts) {
      expect(typeof SELECTION_ATTRIBUTES[context], `${context} 没有配属性`).toBe('string');
    }
    expect(Object.keys(SELECTION_ATTRIBUTES).sort()).toEqual([...contexts].sort());
  });

  it('三根轴同时在场时都发出来，互不吞', () => {
    // 现量形状：折叠式的导航项（`CompactRailNavigation.tsx:73` 那格）同时有
    // `aria-expanded` 与 `aria-current`，一处判断不能只认第一根轴。
    expect(controlAria({ pressed: true, expanded: true, selected: true, selection: 'tab' })).toEqual({
      'aria-pressed': 'true',
      'aria-expanded': 'true',
      'aria-selected': 'true',
    });
  });
});

describe('三、状态轴 → 原生 accessibilityState 的键名', () => {
  it('开关与选中都落 selected，展开落 expanded', () => {
    // RN 没有 `pressed` 这一格：原生上"这一枚是拨上的"用 `selected` 表达。
    expect(controlAccessibilityState({ pressed: true })).toEqual({ selected: true });
    expect(controlAccessibilityState({ pressed: false })).toEqual({ selected: false });
    expect(controlAccessibilityState({ selected: true, selection: 'tab' })).toEqual({
      selected: true,
    });
    expect(controlAccessibilityState({ expanded: true })).toEqual({ expanded: true });
  });

  it('不产出 pressed 键', () => {
    // 写了原生不认的键＝静默失效，与 `kit.tsx:766` 那次编造 token 名同一类事故。
    const state = controlAccessibilityState({
      pressed: true,
      selected: true,
      selection: 'tab',
      expanded: true,
    });
    expect(Object.keys(state).sort()).toEqual(['expanded', 'selected']);
  });

  it('没有轴时不产出键', () => {
    expect(controlAccessibilityState({})).toEqual({});
  });
});
