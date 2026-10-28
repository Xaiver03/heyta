/**
 * 交互控件的**色调**与**状态** —— 两端共用的那一份判断
 * ====================================================
 *
 * ## 这一枚补的是什么洞（立项现量，2026-10-28，全部可复跑）
 *
 * `pnpm check:rn-aria` 已经把"共享层不许用对象形态 `accessibilityState`"钉住了，
 * `check:focus-single-source` 把焦点环收成了一个所有者，`check:selection-single-source`
 * 把"当前选中了哪一条"的**数据**收成了一个 store。
 * **唯独"一个控件该长什么样、该把状态发成什么属性"这件事，从来没有过所有者。**
 * 于是它按端、按文件、按组件各答各的：
 *
 * 1. 🔴 **同一个 `danger` 在两端是相反的画法。**
 *    Web：`apps/web/src/styles/app/controls.css` 里 `.ht-btn--danger` 是
 *    **透明底 + danger 文字**；Mobile：`apps/mobile/src/ui/kit.tsx` 的
 *    `palette.danger` 是 **`color.danger` 实底 + `foreground-inverse` 白字**。
 *    同一个用户意图（"这条会丢"）在两端重量不同 —— 而两边各自都有道理，
 *    所以这不是"哪边写错了"，是**没有那一份权威表**可参照。
 * 2. 🔴 **Web 根本没有 `secondary`**（`grep -c 'ht-btn--secondary' apps/web/src` 现量 0），
 *    而 Mobile 的 `Button` **默认那一档就是 `secondary`**。缺口的后果留在仓里：
 *    `className="ht-btn"` 这种**不带任何色调**的裸按钮现量 18 处（AI 面板、
 *    隐私同意层、`DangerConfirmDialog` 的「取消」都在内），它们没有底、没有 hover 底，
 *    读起来就是说明文字；而 `apps/web/src/styles/app/sheets.css:150` 那段注释
 *    自己写了同一件事的另一个症状 —— "它在设置页里常常是这一块唯一的动作，
 *    于是看图时那几枚读成了说明文字"，于是**在那个文件里现造了一个凹陷底**。
 *    ⇒ "次要按钮长什么样"有三份答案（Web 没有、sheets.css 局部造、Mobile 有一份），
 *    没有一份是别人参照的。
 * 3. 🔴 **同一个 disabled 在两端是两个数**：Mobile 读 token
 *    `state.disabled-opacity`（`--ht-state-disabled-opacity: 0.38`），
 *    Web 的 `.ht-btn:disabled` 写死 **`opacity: 0.5`**。同一个"点不动"，重量不一样，
 *    而 0.5 还是一枚 §5 禁止的裸值。
 * 4. 🔴 **同一个"按下即反馈"在同一个文件里有三种机制**：`kit.tsx` 里
 *    `Button` 用裸 `opacity: 0.85`，`IconButton` 用 `color.hover` 换底，
 *    `Checkbox`/`Fab` 用 token `motion.press-scale` 缩放 —— Web 走的是缩放那一档。
 *    裸 `0.85` 没有任何 token 覆盖它，所以没有任何判据量得到它。
 * 5. ⚠️ **状态发出去的属性也是各写各的**，而且"为什么这么写"被重新推导了三遍
 *    （`CalendarBoard.tsx`、`CalendarViewTabs.tsx` 文件头、`CalendarYearBoard.tsx`
 *    各自都有一段"平铺 `aria-*`，对象形态在 RNW 上会被整个丢掉"）。
 *    `tab` 用 `aria-selected`、导航用 `aria-current="page"`、日历"今天"用
 *    `aria-current="date"` 这三档本身**都对**；坏的是没有一处把"哪一档该发哪一个、
 *    off 态要不要显式写"讲清，于是 `NavButton.tsx:38` 那格直接把布尔递给了
 *    `aria-current`（发成 `"true"`/`"false"`），而其余各处 off 态是**不写**。
 *
 * ## 这里放判断、不放渲染
 *
 * 表里的值是 **token 名**（`color.danger`），不是色值也不是 CSS。理由有三条，
 * 缺一条这份表就会在半年内变成长第二份样式的地方：
 *   · 亮/暗两档的值由 `tokens.css` 一处决定，组件与这张表都不许知道十六进制；
 *   · Mobile 拿名字直接索 `t[name]`（`HeytaNativeTokens` 的键就是这些名字），
 *     Web 拿名字拼 `var(--ht-…)` —— **同一条语义，两种渲染**，这正是 AGENTS §3.5
 *     要求的"业务语义只许出现在共享层"；
 *   · 拼错一个名字**会红**：契约测试逐枚拿真表（`lightTokens`/`darkTokens`）解析。
 *     这一条不是防"打错字"，它防的是本仓已经付过学费的那件事 ——
 *     `kit.tsx:766` 的注释记着"色名必须真实存在，`color.danger-foreground`
 *     这两个名字是我一开始想当然编的，于是按钮文字是 undefined"。
 *
 * ⚠️ `'transparent'` 是这张表里**唯一**允许的非 token 值，而且只在 `bg` 那一格出现。
 * 它表达的不是某个颜色，是"这一档没有填充"这个语义 —— 换成一个 token 名反而会让人
 * 以为有一层可改的底色。前景（`fg`）永远必须是 token，因为没有"没有颜色"这个前景。
 *
 * ## 实底危险按钮这一档为什么长这样
 *
 * 弹层里那枚"确认彻底删除"必须比它的「取消」更重，所以需要一档**实底** danger，
 * 而实底需要一个前景 token —— `color.on-danger` 就是为它加的，连同 `AA_PAIRS` 里
 * `danger` / `danger-strong` 两条配对（暗色档 `danger` 是提亮后的浅红，白字压上去
 * 只有 2.77:1，所以那一档的前景要换深；两个值都由对比度套件现算，不是散文）。
 *
 * 🔴 但**默认档仍是行内**（透明底 + 危险色文字）：回收站每一行都有「彻底删除」，
 * 让默认变实底会把整屏染红。"这一枚站在哪个位置"由调用方显式写 `commit` 来表达。
 * 覆盖表里也只有 `danger` 有条目 —— 其余三档的重量已经由色调本身表达，给它们各建
 * 一条"和原来一样"的覆盖就是零消费者槽位。判据在 `control-states.spec.ts` 的
 * 「commit 覆盖表里只有 danger」那一枚：它按**键的存在性**判，不按配方是否不同判
 * （实测按相等判时，注入 `primary: CONTROL_PALETTE.primary` 那种空槽位 38 条全绿）。
 *
 * ## 与另外三把尺的分工（不重复、也不互相顶替）
 *
 *   · `check:rn-aria` 断言 B 扫的是**写法**（共享层不许出现对象形态）；
 *     这里给的是**该发哪些属性、off 态写不写**的判断。它红它的，我管我这份。
 *   · `check:focus-single-source` 管焦点环，本文件一个 `ring` 都不提。
 *   · `check:selection-single-source` 管"哪一条被选中"的数据归属；
 *     本文件管"选中这一条之后控件对外说什么、长什么样"。
 *
 * 🔴 本文件不许出现任何一端的名字（`.ht-btn`、`Pressable`、`button`）：
 * 它一旦被某一端的形状污染，另一端就只能再写一份 —— 那正是上面五条的成因。
 */

import type { TokenName } from '@heyta/design-system';

/* ── 一、色调：四个名字，一份配方 ──────────────────────────── */

/**
 * 控件的语义色调。**只有这四个**，且每个都必须有配方（契约测试逐条遍历
 * `CONTROL_TONES`，加一个名字不给配方就红 —— 不是靠 TS 类型，TS 类型在
 * `Record` 上是编译期的，而这条判据要能在 `pnpm -r test` 里独立红）。
 */
export type ControlTone = 'primary' | 'secondary' | 'ghost' | 'danger';

export const CONTROL_TONES: readonly ControlTone[] = ['primary', 'secondary', 'ghost', 'danger'];

/**
 * 表里出现的**颜色** token 名。
 *
 * 🔴 为什么不是裸 `TokenName`：移动端的原生 token 表是"一个键一种值"的形状
 * （`color.*` 是串、`state.*`/`motion.*`/`duration.*` 是数）。拿 `TokenName` 去索引它，
 * 类型上得到的是 `string | number`，于是 `backgroundColor: t[recipe.bg]` 在 RN 的
 * `ColorValue` 上**过不去** —— 而绕过它（`as string`）就等于把"这一格必须是颜色"
 * 这件事从类型里删掉。收窄成 `color.*` 之后，各端索引出来就是它真正的那个类型。
 */
export type ControlColorToken = Extract<TokenName, `color.${string}`>;

/** 填充：一个颜色 token 名，或者"没有填充"。 */
export type ControlFill = ControlColorToken | 'transparent';

export interface ControlPalette {
  /** 静止态的填充。 */
  readonly bg: ControlFill;
  /** 静止态的文字/图标前景。必须是**颜色** token。 */
  readonly fg: ControlColorToken;
  /** 悬停（Web）/按下换底（Mobile 若无缩放档）的填充。 */
  readonly hoverBg: ControlFill;
  /** 悬停态前景。 */
  readonly hoverFg: ControlColorToken;
  /**
   * 按下那一档**换底**的颜色 —— 只有 `primary` 有。
   *
   * 🔴 其余三档这里是 `undefined`，这不是"还没做"：它们靠
   * `CONTROL_STATE_TOKENS.pressScale` 的缩放表达按下，**不再叠加换底**。
   * 契约测试钉这一格，因为"按下到底是换底还是缩放"正是现量里三种机制并存的那件事。
   */
  readonly activeBg?: ControlFill;
}

const CONTROL_PALETTE: Readonly<Record<ControlTone, ControlPalette>> = {
  /* 主操作。两端本来就一致，原样收编（`color.on-primary` 已在 `AA_PAIRS` 登记）。 */
  primary: {
    bg: 'color.primary',
    fg: 'color.on-primary',
    hoverBg: 'color.primary-hover',
    hoverFg: 'color.on-primary',
    activeBg: 'color.primary-active',
  },
  /*
   * 次要动作 —— **有填充、无描边**那一档。
   *
   * 🔴 填充选 `surface-sunken` 而不是 `surface`：次要按钮坐在 `color.surface` 的
   * 卡片上时，同色填充等于没画，那正是 sheets.css 那次现造的成因。
   * `surface-sunken` 与 `surface` 在两端都有实测值，且比 `hover` 那一档更稳
   * （`color.hover` 是带 alpha 的，叠在不同底上会得到两种深浅）。
   * ⚠️ 边界（在册）：`foreground-subtle` 放在 `surface-sunken` 上是 4.34:1、
   * 够不到 4.5（`tokens.ts` 的注释明写这一条没登记、也没人管），
   * 所以这一档的前景**必须是 `foreground`**，不许降到 subtle。
   */
  secondary: {
    bg: 'color.surface-sunken',
    fg: 'color.foreground',
    hoverBg: 'color.hover',
    hoverFg: 'color.foreground',
  },
  /* 工具条里那些图标/文字动作：无底，悬停才出现底。 */
  ghost: {
    bg: 'transparent',
    fg: 'color.foreground-muted',
    hoverBg: 'color.hover',
    hoverFg: 'color.foreground',
  },
  /* 行内危险动作（列表行、设置项里那种"会丢东西"）。 */
  danger: {
    bg: 'transparent',
    fg: 'color.danger',
    hoverBg: 'color.danger-subtle',
    hoverFg: 'color.danger-strong',
  },
};

/**
 * 同一色调里的**重量**档。
 *
 *   · `inline` —— 列表行、设置项、工具条里那枚："会丢东西"要说清楚，
 *     但不许把一屏染成一片红（现量：回收站每一行都有「彻底删除」）。
 *   · `commit` —— 确认层里那枚**唯一**要按下去的按钮：它必须比同一层里的
 *     「取消」更重，否则危险确认只是两句并排的文字。
 *
 * 🔴 这不是"多加一个维度好看"。立项现量是两端各选了不同的重量：
 * Web 的 `.ht-btn--danger` 恒为透明底红字（连 AlertDialog 里那枚也是），
 * Mobile 的 `palette.danger` 恒为实底白字（连列表行里那枚也是）。
 * 两端各对一半 —— 缺的是"这一枚站在哪个位置"这一格判断。
 *
 * ⚠️ 今天只有 `danger` 有两档。`primary`/`secondary`/`ghost` 的 `commit`
 * 就等于它们自己（重量已经由色调本身表达），所以覆盖表里**不给**它们条目 ——
 * 给了就是"槽位建了、界面上没有这个功能"（`check:selection-single-source`
 * 判据 D 罚的正是那种）。
 */
export type ControlEmphasis = 'inline' | 'commit';

/** 默认档：不写就不加重 —— 现有调用方不许被这次改动静默换成实底。 */
export const DEFAULT_CONTROL_EMPHASIS: ControlEmphasis = 'inline';

/**
 * `commit` 那一档的覆盖配方。
 *
 * 🔴 **只有 `danger` 有条目**，这是刻意的：另外三档的重量已经由色调本身表达
 *（primary 就是实底主色），给它们各写一条"和原来一样"的覆盖，就是建了
 * 三个零消费者的槽位。加一档之前要先有界面真的用它。
 *
 * 这一档要 `color.on-danger` 当前景 —— 那个 token 是本期为它加的，
 * 且 `AA_PAIRS` 里登记了两条配对（`danger` 与 `danger-strong` 各一条，
 * 亮暗两档都由 `tokens.spec.ts` 现算）。
 * ⚠️ 不许换成 `color.foreground-inverse`：那一格今天恰好也是白/黑，
 * 但它的语义是"反色前景"，danger 提亮时它会跟着变，而这一格不该跟着变。
 */
const CONTROL_COMMIT_OVERRIDES: Partial<Record<ControlTone, ControlPalette>> = {
  danger: {
    bg: 'color.danger',
    fg: 'color.on-danger',
    hoverBg: 'color.danger-strong',
    hoverFg: 'color.on-danger',
  },
};

/**
 * 这一色调是否有**自己独立的** commit 配方（= 覆盖表里有它的条目）。
 *
 * 🔴 判"有没有槽位"只能按**条目在不在**判，不能按"两档配方是否不同"判：
 * 后者对 `primary: CONTROL_PALETTE.primary` 这种"建一条和行内一模一样的覆盖"
 * 永远返回"没有"，而那正是要罚的零消费者槽位（实测：那种注入下按相等判的臂
 * 38 条全绿）。所以这一枚把键的存在性单独暴露出去给契约测试比。
 */
export function hasCommitOverride(tone: ControlTone): boolean {
  return Object.prototype.hasOwnProperty.call(CONTROL_COMMIT_OVERRIDES, tone);
}

/**
 * 色调的**语义默认**：一枚不带色调的按钮该长成什么样。
 *
 * 🔴 这一格在两端原本答案是相反的：Mobile 的 `Button` 默认 `tone='secondary'`，
 * 而 Web **根本没有 secondary 那一档**（`grep -c 'ht-btn--secondary' apps/web/src`
 * 立项现量 0），于是 Web 只能让 18 枚 `className="ht-btn"` 停在"没有底、没有
 * hover 底"的形状上 —— 图上读起来就是说明文字。
 * 这一枚把"默认是哪个"也收成一处：各端的默认值从这里取，不许各写一个。
 */
export const DEFAULT_CONTROL_TONE: ControlTone = 'secondary';

/**
 * 取某一色调的配方；**词表外的一律 `undefined`**。
 *
 * 🔴 调用方不许把 `undefined` 兜成任何一档默认值（包括 `secondary`）：
 * 那样"新加一个 tone 名"会静默画成次要按钮，而这是本文件要消灭的那类毛病 ——
 * 与 `receiptTimingOf` 同一个保守方向（查不到策略就不自消，查不到配方就不画）。
 */
export function controlPaletteOf(
  tone: ControlTone,
  emphasis: ControlEmphasis = DEFAULT_CONTROL_EMPHASIS,
): ControlPalette | undefined {
  if (!Object.prototype.hasOwnProperty.call(CONTROL_PALETTE, tone)) return undefined;
  const override = emphasis === 'commit' ? CONTROL_COMMIT_OVERRIDES[tone] : undefined;
  return override ?? CONTROL_PALETTE[tone];
}

/* ── 二、状态外观：三枚 token 名，两端同读 ─────────────────── */

/**
 * 控件状态外观的**唯一**三个入口。
 *
 * 立项现量：Web 的 `.ht-btn:disabled` 写死 `0.5`，Mobile 读 `state.disabled-opacity`
 * （0.38）；按下反馈 Mobile 一处裸 `0.85`、一处换底、两处读 `motion.press-scale`。
 * ⇒ 这三格**只许**从这里取值，门禁 `check:control-semantics` 按此扫两端。
 */
export const CONTROL_STATE_TOKENS = {
  /** 点不动的视觉重量。两端同一个数，因为它是同一个"点不动"。 */
  disabledOpacity: 'state.disabled-opacity',
  /** 按下的缩放。两端一致走缩放，不走裸不透明度。 */
  pressScale: 'motion.press-scale',
  /** 按下反馈的时长（`prefers-reduced-motion` 下被压到 1ms）。 */
  pressDuration: 'duration.press',
} satisfies Record<'disabledOpacity' | 'pressScale' | 'pressDuration', TokenName>;

/* ── 三、状态轴 → 对外发布什么 ─────────────────────────────── */

/**
 * 一个控件可能携带的三根状态轴。
 *
 * 🔴 只有这三根：`disabled` / `busy` 不走这里 —— 它们由 `disabled` 属性与
 * `loading` 直接表达，两端本来就有唯一的写法，再造一个别名就是第四份所有者。
 *
 * 🔴 `selected` 与 `selection` 是**绑在一起**的：写了"这一格被选中"却不写场景，
 * 编译器就拦住。这不是洁癖 —— 现量里"选中"发成 `aria-selected`、`aria-current="page"`、
 * `"date"`、`"true"` 四种都有，而给一个默认档等于**由这枚函数替每一屏决定语义**，
 * 那正是本文件要消灭的那类多头判断。
 */
export type ControlStateAxes = { readonly pressed?: boolean; readonly expanded?: boolean } & (
  | { readonly selected?: undefined }
  | { readonly selected: boolean; readonly selection: SelectionContext }
);

/**
 * "选中"所在的场景，决定发哪一个属性、发什么值。
 *
 *   · `tab`  —— `role="tab"` 那一组里：**发 `aria-selected`，off 态显式写 `"false"`**。
 *     tablist 里不写 `aria-selected` 的那几个，读屏会当它们不可选，
 *     而不是当它们"没被选中"。
 *   · `nav`  —— 导航目的地：**发 `aria-current="page"`，off 态不写**。
 *   · `date` —— 日历里"今天"那一格：**发 `aria-current="date"`，off 态不写**。
 *
 * ⚠️ 这里没有 `aria-current="true"` 那一档。它不是非法，是**不说场景**：
 * 一个泛化的 "current" 让读屏用户知道"这是当前那个"，却不知道该把它念成
 * 当前页、当前日期还是当前选项。仓里那一格（`LanguageSwitcher.tsx:118`）
 * 归 P7 一起按场景重发，不在这里顺手改语义。
 */
export type SelectionContext = 'tab' | 'nav' | 'date';

/** 各场景发哪个属性。穷尽：加一档场景不给配方就红。 */
export const SELECTION_ATTRIBUTES: Readonly<Record<SelectionContext, 'aria-selected' | 'aria-current'>> =
  {
    tab: 'aria-selected',
    nav: 'aria-current',
    date: 'aria-current',
  };

/**
 * `aria-current` 按场景取哪个值。
 *
 * 🔴 这一格里没有布尔：现量里 `apps/web/src/features/shell/NavButton.tsx:38` 写的是
 * `aria-current={active}`，它发出去的是 `"true"`/`"false"` —— 类型上挡不住，
 * 因为 `boolean` 在 React 的属性表里是合法的。所以"不许把布尔递给 aria-current"
 * 这条判据落在这里（值只有两个档位）与契约测试（断言值恒为这两个字符串之一），
 * 不是落在类型上。
 */
export const ARIA_CURRENT_VALUES: Readonly<
  Record<Extract<SelectionContext, 'nav' | 'date'>, 'page' | 'date'>
> = {
  nav: 'page',
  date: 'date',
};

/**
 * 共享层 / Web 用的**平铺** `aria-*` 映射表。
 *
 * 平铺是**硬性要求**，理由不在这里重述（见 `check:rn-aria`：对象形态的
 * `accessibilityState` 在 react-native-web 0.21.3 上被整个丢掉，而共享层是四端
 * 共用的那一份）。这里把它做成"唯一的出口形状"，让调用方**没法**写出对象形态。
 *
 * off 态的两种写法照上面 `SelectionContext` 的表：`pressed`/`expanded`/`tab`
 * 显式写 `"false"`，`nav`/`date` 直接不出现（返回的对象里那把键都不在）。
 */
export function controlAria(axes: ControlStateAxes): Record<string, string> {
  const out: Record<string, string> = {};
  if (axes.pressed !== undefined) out['aria-pressed'] = String(axes.pressed);
  if (axes.expanded !== undefined) out['aria-expanded'] = String(axes.expanded);
  if (axes.selected !== undefined) {
    // 场景被 `as` 绕过去时**什么都不发**，而不是替调用方猜一个。
    // 猜 = 那一屏的"选中"会被念成"当前页"，而它可能是日历里的一格 ——
    // 这类错在界面上没有痕迹，只在读屏里发生，所以没人会发现（§7 那条元规则的形状）。
    const scene: SelectionContext | undefined = axes.selection;
    const attribute = scene === undefined ? undefined : SELECTION_ATTRIBUTES[scene];
    if (attribute === 'aria-selected') {
      out['aria-selected'] = String(axes.selected);
    } else if (attribute === 'aria-current' && axes.selected) {
      // `aria-current` 的取值照 `ARIA_CURRENT_VALUES`（off 态不写，见上面那段）。
      out['aria-current'] = scene === 'date' ? ARIA_CURRENT_VALUES.date : ARIA_CURRENT_VALUES.nav;
    }
  }
  return out;
}

/**
 * 原生那一端的对应形态：`accessibilityState` 的**键名**判断。
 *
 * 🔴 为什么原生可以保留对象形态而共享层不行：`apps/mobile` 只跑在真 RN 上，
 * 对象形态在那里是正确的写法（`check:rn-aria` 因此刻意只扫 `packages/ui`）。
 * 这里给的仍是判断 —— "三根轴各自对应 `accessibilityState` 的哪一个键"，
 * RN **没有 `pressed` 这一格**，开关的 on/off 在原生上落 `selected`；
 * 而"选中"在原生上也是 `selected`。⇒ 同一根轴在两端可以是不同属性，
 * 这件事必须由一处说清，否则每个组件都会自己猜一次。
 */
export interface ControlAccessibilityState {
  readonly selected?: boolean;
  readonly expanded?: boolean;
}

export function controlAccessibilityState(axes: ControlStateAxes): ControlAccessibilityState {
  const out: { selected?: boolean; expanded?: boolean } = {};
  if (axes.pressed !== undefined || axes.selected !== undefined) {
    // 一根轴上两个来源：开关的"拨上了"和组里的"当前那个"在原生上是同一个 trait，
    // 取**任一为真**——它们是同一个"这一格是活的"信号，不存在需要区分的时候，
    // 因为一个控件不会既是开关又是 tab（要区分就分两个控件，那不是这里的形状）。
    out.selected = axes.pressed === true || axes.selected === true;
  }
  if (axes.expanded !== undefined) out.expanded = axes.expanded;
  return out;
}
