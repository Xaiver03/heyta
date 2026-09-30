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
    /**
     * 活动分类的 8 个色槽位（用户自己赋义，见
     * `docs/plans/activity-categories-and-colors.md`）。
     *
     * 🔴 **只能当图形色用**：它们保证的是与 surface 的 3:1（WCAG 1.4.11），
     * **不保证**正文的 4.5:1。要当文字色就得先单独过 AA —— 现在没有这个需求，
     * 界面上的分类名一律用 `foreground`。
     */
    'category-1',
    'category-2',
    'category-3',
    'category-4',
    'category-5',
    'category-6',
    'category-7',
    'category-8',
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
  duration: ['instant', 'fast', 'normal', 'slow', 'exit', 'press'],
  ease: ['standard', 'enter', 'exit', 'spring'],
  z: ['base', 'sticky', 'dropdown', 'overlay', 'modal', 'popover', 'toast', 'tooltip'],
  icon: ['xs', 'sm', 'md', 'lg', 'xl'],
  /** 触控目标下限（44px 硬性可访问性要求）。 */
  'touch-target': ['min'],
  /** 焦点环宽度。 */
  'focus-ring': ['width'],
  /** 布局尺寸。组件布局应消费它们，而不是写死宽度。 */
  layout: [
    /* 视图导航（rail）。2026-09-29 加：外壳从"顶栏平铺视图 tab"改成
       "rail 放视图 + sidebar 放当前视图的范围"（`dida-view-unification.md` §4.4）。 */
    'rail-width',
    'sidebar-width',
    'header-height',
    'content-max',
    'prose-max',
    'quadrant-min-height',
    'panel-max-height',
    /* 响应式断点与输入约束。2026-09-29 加：排版此前只管"值从哪来"，
       不管"窗口变化后排版塌不塌"——这两个值是布局判据的锚点。 */
    'two-column-min',
    'input-min',
    /* 居中浮层（搜索）的卡片最大宽度。2026-09-30 加：搜索从"整页"改回
       滴答 §11.5 的"居中浮层"——宽度是它的 IA 判据之一（留出透出下层的空隙）。 */
    'modal-max',
  ],
  'border-width': ['thin', 'thick'],

  /**
   * 导航与外壳。4 个 tab 页共享同一套尺寸 —— 外壳是产品结构，
   * 不是某个屏幕的局部实现。
   */
  nav: [
    'tab-bar-height',
    'tab-icon-size',
    'tab-label-size',
    'tab-item-min-width',
    'tab-indicator-inset',
    'tab-indicator-width',
    'tab-indicator-height',
    'app-bar-height',
    'app-bar-title-size',
    'safe-top-min',
    'safe-bottom-min',
  ],
  /** 屏幕级布局留白。 */
  screen: ['gutter', 'section-gap', 'bottom-inset'],
  /** 组件尺寸（"这个控件多大"），不是间距。 */
  size: [
    'checkbox',
    'row-min-height',
    'swipe-action',
    'avatar-sm',
    'avatar-md',
    'avatar-lg',
    'fab',
    'chip-height',
    'chip-padding-x',
    'divider-inset',
    'badge-min-width',
    'badge-height',
    'badge-dot',
    'badge-ring',
    'field-height',
    'field-padding-x',
    'progress-height',
    /**
     * 番茄钟进度环的直径与描边宽度。
     *
     * 🔴 为什么进 token 而不是让组件写两个数字：M3 第二刀把专注环收进了
     * `packages/ui`（四端同一份实现），而共享层里的裸数字没有任何约束力 ——
     * 一个端改了圆的大小，另外三个端不会有任何提示。
     */
    'focus-ring',
    'focus-ring-stroke',
  ],
  /**
   * 字距。Apple 规则：字距随字号变，一个固定值必然在某处是错的。
   * 单位 em，因此**不是长度**，不参与 rem→px 换算。
   */
  tracking: ['display', 'title', 'body', 'caption'],
  /**
   * 动效物理。🔴 故意不是时长：Apple 用「阻尼比 + 响应」描述弹簧，
   * 因为弹簧没有固定时长，且必须可被打断。
   */
  motion: [
    'spring-damping-default',
    'spring-damping-momentum',
    'spring-response-move',
    'spring-response-sheet',
    'spring-response-rotation',
    'press-scale',
    'deceleration-rate',
    'rubber-band-constant',
  ],
  /** 手势阈值与容错命中区。 */
  gesture: ['hysteresis', 'hit-slop'],
  /**
   * 状态层不透明度。用叠加层表达 pressed/hover，
   * 避免为每个组件各写一套变暗色（会随组件数量爆炸）。
   */
  state: ['pressed-opacity', 'hover-opacity', 'disabled-opacity'],
  /** 模糊半径。与 material 分开：一组只能有一种原生类型。 */
  blur: ['chrome', 'sheet'],
  /** 材质色（半透明层）。 */
  material: [
    'chrome-tint',
    'chrome-tint-strong',
    'edge-highlight',
    'sheet-tint',
    'scrim',
    'scrim-strong',
  ],
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
 * 分类色槽位的 token 名（`color.category-1` … `color.category-8`）。
 *
 * 🔴 **手写 8 个字面量 + `satisfies`，而不是从 registry 里 `filter` 派生**。
 * 派生看起来更"不会漂移"，但它拿到的是 `string[]`，于是拼错一个名字
 * （`category-9`、`category-one`）**编译期什么都不查** —— 要等运行时
 * `cssVar()` 抛错、或者根本没人引用而不报错。
 * 这里手写，`satisfies readonly TokenName[]` 会把拼错变成编译错误。
 *
 * ⚠️ 手写的代价是"加了 9 号槽位却忘了登记对比度"，那由
 * `tests/category-colors.spec.ts` 的**集合相等**断言兜住：
 * registry 里所有 `category-*` 必须与这 8 个逐项相同。
 */
export const CATEGORY_SLOT_TOKENS = [
  'color.category-1',
  'color.category-2',
  'color.category-3',
  'color.category-4',
  'color.category-5',
  'color.category-6',
  'color.category-7',
  'color.category-8',
] as const satisfies readonly TokenName[];

/**
 * 槽位号 → 分类色 token。
 *
 * 🔴 **取值逐项来自 `CATEGORY_SLOT_TOKENS`，不手写第二份。**
 * 色板重排（换掉某个槽位的颜色）时这里自动跟随 —— 而"手抄一份"不会让任何测试失败：
 * Web 从常量派生、移动端抄了 8 个字面量，改常量后前者跟着变、**后者静默保持旧色**。
 *
 * 为什么用数字字面量做键而不是 `Record<CategorySlot, …>`：
 * design-system **不依赖 `@heyta/domain`**（它是更底层的包，加依赖会颠倒分层）。
 * 槽位号的穷尽性由各端自己的一条 `satisfies Record<CategorySlot, …>` 钉住 ——
 * 那是**各端与领域层的契约**，放在各端才是它该在的地方。
 *
 * 为什么 `CATEGORY_SLOT_TOKENS[n]` 索引不会丢掉类型：那个常量是
 * `as const satisfies readonly TokenName[]`，元素类型是**字面量**而不是 `string`，
 * 所以这里取到的仍是字面量 key —— RN 侧 `tokens[key]` 因此能窄化成 `string`
 * （颜色）而不是 `string | number`。派生与"字面量类型"在这里**不冲突**。
 */
export const CATEGORY_SLOT_TOKEN_BY_SLOT = {
  1: CATEGORY_SLOT_TOKENS[0],
  2: CATEGORY_SLOT_TOKENS[1],
  3: CATEGORY_SLOT_TOKENS[2],
  4: CATEGORY_SLOT_TOKENS[3],
  5: CATEGORY_SLOT_TOKENS[4],
  6: CATEGORY_SLOT_TOKENS[5],
  7: CATEGORY_SLOT_TOKENS[6],
  8: CATEGORY_SLOT_TOKENS[7],
} as const;

/**
 * 强度色阶 0–4 → heat token。**全仓库唯一一份。**
 *
 * 它编码的是"多少"（这周记录了几次），分类色编码的是"是谁" —— 两者不可混用。
 * 0 档是"没有记录"，用中性的 `heat-0` 而不是"没有颜色"：
 * 空白格与浅色格在界面上必须是两种不同的东西。
 *
 * 与 `CATEGORY_SLOT_TOKENS` 同一个理由手写：从 registry 派生会拿到 `string[]`，
 * 拼错 `heat-5` 在编译期什么都不查。
 */
export const HEAT_TOKENS = [
  'color.heat-0',
  'color.heat-1',
  'color.heat-2',
  'color.heat-3',
  'color.heat-4',
] as const satisfies readonly TokenName[];

/**
 * "没设过色"那一行用哪个 token。
 *
 * 🔴 **不是**某个分类色，也不是"1 号的浅色" —— 那会让"没设过色"看起来像是
 * 用户选过的某个类别。用中性的 `foreground-muted`：它在两种主题下都读得出来，
 * 且**不属于调色板**。
 */
export const UNSET_CATEGORY_TOKEN = 'color.foreground-muted' as const satisfies TokenName;

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
  // 分类色槽位只当**图形**用（色块 / 堆叠条的段），故走 3:1 这条线。
  // ⚠️ 它们**不**保证 4.5:1，所以不许拿去写正文（见 TOKEN_GROUPS 里的注释）。
  ...CATEGORY_SLOT_TOKENS.map((token) => ({
    fg: token,
    bg: 'color.surface' as const,
    min: 3,
    why: '分类色块（图形）',
  })),
];
