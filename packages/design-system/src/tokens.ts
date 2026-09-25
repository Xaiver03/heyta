/**
 * 设计系统 —— 类型化 token 层
 * ============================
 *
 * 解决什么问题：CSS 变量在 TypeScript 里是**无类型**的。写错一个变量名
 * （`--ht-color-primry`）不会有任何编译错误，只会在浏览器里静默失效 ——
 * 元素变成透明或继承色，而且极难定位。
 *
 * 做法：把 token 名做成**数据**（registry），再从中派生类型。
 * 这样：
 *   1. 拼错 token 名 → 编译期报错
 *   2. 组件里可以用 `cssVar('color.primary')` 拿到 `var(--ht-color-primary)`
 *   3. token 清单可被测试遍历（见 tests/tokens.spec.ts 的对比度校验）
 *
 * ⚠️ **registry 与 tokens.css 必须同步。** 这是唯一的漂移风险点，
 * 因此 tests/tokens.spec.ts 会解析真实的 tokens.css 并断言
 * 「registry 里的每个 token 都真实存在」，反向也检查。
 */

/** token 分组：与 tokens.css 的结构一致。 */
export const TOKEN_GROUPS = {
  /** 语义颜色（组件主要消费这一组） */
  color: [
    'primary',
    'primary-hover',
    'primary-active',
    'primary-subtle',
    'primary-subtle-hover',
    'on-primary',
    'background',
    'surface',
    'surface-raised',
    'surface-sunken',
    'foreground',
    'foreground-muted',
    'foreground-subtle',
    'foreground-inverse',
    'border',
    'border-strong',
    'border-subtle',
    'ring',
    'hover',
    'active',
    'disabled-bg',
    'disabled-fg',
    'success',
    'success-strong',
    'success-subtle',
    'warning',
    'warning-strong',
    'warning-subtle',
    'danger',
    'danger-strong',
    'danger-subtle',
    'info',
    'info-strong',
    'info-subtle',
    'quadrant-1',
    'quadrant-1-subtle',
    'quadrant-2',
    'quadrant-2-subtle',
    'quadrant-3',
    'quadrant-3-subtle',
    'quadrant-4',
    'quadrant-4-subtle',
    'priority-high',
    'priority-medium',
    'priority-low',
    'priority-none',
    'heat-0',
    'heat-1',
    'heat-2',
    'heat-3',
    'heat-4',
    'focus-work',
    'focus-break',
    /** 弹窗遮罩。半透明，故与前景配对不参与对比度检查。 */
    'overlay',
  ],
  space: ['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16'],
  'font-size': ['2xs', 'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'],
  'font-weight': ['regular', 'medium', 'semibold', 'bold'],
  'line-height': ['tight', 'normal', 'relaxed'],
  /** 组名用 `font` 而非 `font-family`，以匹配 `--ht-font-sans` 的实际写法。 */
  font: ['sans', 'mono'],
  radius: ['none', 'sm', 'md', 'lg', 'xl', 'full'],
  shadow: ['none', 'sm', 'md', 'lg', 'xl', 'focus'],
  duration: ['instant', 'fast', 'normal', 'slow', 'exit'],
  ease: ['standard', 'enter', 'exit', 'spring'],
  z: ['base', 'sticky', 'dropdown', 'overlay', 'modal', 'popover', 'toast', 'tooltip'],
  icon: ['xs', 'sm', 'md', 'lg', 'xl'],
  /** 触控目标下限（44px 硬性可访问性要求）。 */
  'touch-target': ['min'],
  /** 焦点环宽度。 */
  'focus-ring': ['width'],
  /** 布局尺寸。组件布局应消费它们，而不是写死宽度。 */
  layout: ['sidebar-width', 'header-height', 'content-max', 'prose-max'],
} as const;

export type TokenGroup = keyof typeof TOKEN_GROUPS;

/** 所有合法 token 名的联合类型，形如 `color.primary`。 */
export type TokenName = {
  [G in TokenGroup]: `${G}.${(typeof TOKEN_GROUPS)[G][number]}`;
}[TokenGroup];

const ALL_TOKENS: ReadonlySet<string> = new Set(
  (Object.entries(TOKEN_GROUPS) as [TokenGroup, readonly string[]][]).flatMap(
    ([group, names]) => names.map((n) => `${group}.${n}`),
  ),
);

/**
 * 把 token 名转成 CSS `var(...)` 表达式。
 *
 * 拼错会在**编译期**失败，而不是在浏览器里静默失效。
 *
 * @example
 *   cssVar('color.primary')      // 'var(--ht-color-primary)'
 *   cssVar('space.4')            // 'var(--ht-space-4)'
 */
export function cssVar(name: TokenName): string {
  if (!ALL_TOKENS.has(name)) {
    // 运行时兜底：类型被 `as` 绕过时仍能报错
    throw new Error(
      `未知设计 token：${name}。请先在 tokens.css 与 TOKEN_GROUPS 中登记。`,
    );
  }
  return `var(${cssVarName(name)})`;
}

/**
 * token 名 → CSS 变量名。
 *
 * ⚠️ 分组分隔符不同：registry 用 `.`（`color.primary`）方便类型收窄，
 * CSS 变量用 `-`（`--ht-color-primary`）。这个转换点**必须只有一处**，
 * 否则两处写法迟早不一致。
 *
 * 我第一版写成 `--ht-${name}`，产出 `--ht-color.primary` —— 点号没转换成连字符。
 * 静态看完全合理，是契约测试把它抓出来的（45 个测试里 39 个报
 * "tokens.css 缺少 --ht-color.foreground"）。这正是「测试要能失败」的价值。
 */
export function cssVarName(name: TokenName): string {
  return `--ht-${name.replace(/\./g, '-')}`;
}

/** 全部 token 名，供测试遍历。 */
export function allTokenNames(): TokenName[] {
  const out: string[] = [];
  for (const [group, names] of Object.entries(TOKEN_GROUPS) as [
    TokenGroup,
    readonly string[],
  ][]) {
    for (const n of names) out.push(`${group}.${n}`);
  }
  return out as TokenName[];
}

/**
 * WCAG 对比度需要用到的前景/背景配对。
 *
 * 这不是装饰性列表 —— tests/tokens.spec.ts 会**逐个计算真实对比度**，
 * 低于 4.5:1 就测试失败。新增配色若不可访问，会在 CI 而非用户那里被发现。
 *
 * 只列**必须满足 AA 正文标准**的配对；装饰性/大字号配对另列。
 */
export const AA_PAIRS: ReadonlyArray<{
  fg: TokenName;
  bg: TokenName;
  min: number;
  why: string;
}> = [
  { fg: 'color.foreground', bg: 'color.surface', min: 4.5, why: '正文' },
  { fg: 'color.foreground', bg: 'color.background', min: 4.5, why: '正文（页面底）' },
  { fg: 'color.foreground-muted', bg: 'color.surface', min: 4.5, why: '次要文字' },
  { fg: 'color.foreground-muted', bg: 'color.background', min: 4.5, why: '次要文字（页面底）' },
  { fg: 'color.on-primary', bg: 'color.primary', min: 4.5, why: '主按钮文字' },
  { fg: 'color.on-primary', bg: 'color.primary-hover', min: 4.5, why: '主按钮 hover' },
  { fg: 'color.primary', bg: 'color.surface', min: 4.5, why: '蓝色文字/链接' },
  { fg: 'color.primary', bg: 'color.background', min: 4.5, why: '蓝色文字（页面底）' },
  // 状态色作为**文字**使用时必须达标
  { fg: 'color.danger-strong', bg: 'color.surface', min: 4.5, why: '错误文字' },
  { fg: 'color.success-strong', bg: 'color.surface', min: 4.5, why: '成功文字' },
  { fg: 'color.warning-strong', bg: 'color.surface', min: 4.5, why: '警告文字' },
  { fg: 'color.info-strong', bg: 'color.surface', min: 4.5, why: '信息文字' },
  // 四象限色要作为标签文字用
  { fg: 'color.quadrant-1', bg: 'color.surface', min: 4.5, why: 'Q1 标签' },
  { fg: 'color.quadrant-2', bg: 'color.surface', min: 4.5, why: 'Q2 标签' },
  { fg: 'color.quadrant-3', bg: 'color.surface', min: 4.5, why: 'Q3 标签' },
  { fg: 'color.quadrant-4', bg: 'color.surface', min: 4.5, why: 'Q4 标签' },
];

/**
 * 非文字配对的对比度门槛（WCAG 1.4.11：UI 组件与图形 3:1）。
 */
export const GRAPHIC_PAIRS: ReadonlyArray<{
  fg: TokenName;
  bg: TokenName;
  min: number;
  why: string;
}> = [
  { fg: 'color.border', bg: 'color.surface', min: 1.2, why: '分隔线（可见即可，非 3:1）' },
  { fg: 'color.ring', bg: 'color.background', min: 3, why: '焦点环' },
];
