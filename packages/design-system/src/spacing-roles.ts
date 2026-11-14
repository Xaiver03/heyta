/**
 * 间距角色表 —— **每两个东西之间只有一档间距**
 * ==============================================
 *
 * ## 这个文件解决的是什么问题
 *
 * 2026-11-14 真机量「我的」页，组间距是这些值：
 *
 * ```
 * 29 / 40 / 52 / 54 / 60 / 64 / 69 / 72 / 80 / 88 dp
 * ```
 *
 * **十种值，没有一档是刻意定的。** 它们由三处相加而来：
 * `SectionHeader` 的 `paddingTop`、`SettingsSection` 的 note 间距、
 * 以及各屏 `<Stack gap>` 自己的值。三处各自有理由，加起来没有意义。
 *
 * 同一个页面里还量到组标题到它管辖的第一行是 **48dp** ——
 * 比"组内行距"（8dp）大 6 倍，于是组标题看起来浮在两组中间，
 * 而不是"属于下面那一组"。
 *
 * ## 这张表怎么用
 *
 * 间距不写在消费点，**按关系取**：
 *
 * ```tsx
 * import { SPACING_ROLE } from '@heyta/design-system';
 * <View style={{ gap: tokens[SPACING_ROLE['group-inner']] }}>
 * ```
 *
 * ## 三档必须拉开的理由
 *
 * 人眼判断归属靠**距离的对比**，不是靠绝对距离。所以只要
 * 「标签→控件」和「组间」用了同一档，归属就会读错 —— 这一轮修过的
 * 新建面板就是：
 *
 * ```
 * 标题底 842 → 描述 878   12dp
 * 描述底 1010 → 落点标签 1046  12dp   ← 两个 12 相等，归属读不出来
 * ```
 *
 * 现在 4 / 12 / 24 三档，比值 1 : 3 : 6。
 */

import type { TokenName } from './tokens.js';

/**
 * 关系 → 间距档。
 *
 * 按**从紧到松**排。相邻两档至少差 2 倍 —— 差 4dp 的两档人眼分不出，
 * 那种"分不出"会让归属变成抛硬币。
 */
export const SPACING_ROLE = {
  /** 同一组内相邻两行之间。`0`：行与行靠分隔线/背景分组，不靠空隙。 */
  'group-inner': 'space.0',

  /** 标签 → 它**控制的东西**（「外观」组标题 → 三行选项、「清单名称」→ 输入框）。 */
  'label-to-control': 'space.1',

  /** 行与行之间（没有分隔线时）。也用于"同一块里两个输入"。 */
  'row-gap': 'space.2',

  /** 块与块之间（同组内：输入行 → 落点那一块）。 */
  'block-gap': 'space.3',

  /** **组与组之间**（上一组最后一行 → 下一组标题）。 */
  'group-gap': 'space.6',

  /** 页面大区块之间（顶部卡片 → 第一组）。 */
  'section-gap': 'space.8',
} as const satisfies Record<string, TokenName>;

export type SpacingRole = keyof typeof SPACING_ROLE;

/**
 * 三档必须**互不相等**，而且要拉开。
 *
 * 这条不是注释，是断言：`spacing-roles.spec.ts` 会读 token 的实际 px 值，
 * 验证 `label-to-control < row-gap < group-gap` 且相邻比值 ≥ 2。
 * 一旦有人把 `label-to-control` 调成 8（与 `row-gap` 同值），测试就红。
 */
export const SPACING_ROLE_ORDER = [
  'group-inner',
  'label-to-control',
  'row-gap',
  'block-gap',
  'group-gap',
  'section-gap',
] as const satisfies readonly SpacingRole[];
