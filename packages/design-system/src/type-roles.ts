/**
 * 排版角色表 —— **每一个「位置」只对应一个文字档**
 * ================================================
 *
 * ## 这个文件解决的是什么问题
 *
 * 2026-11-14 产品负责人看着设置页说：「『外观』这两个字的标题，还没有下面
 * 『跟随系统』大」「界面上我见过最丑的之一」。
 *
 * 真机量出来的原因是：**同一个语义在档位表里有两档，用的时候随手选**。
 *
 * | 位置 | 当时用的档 | 字号 | 颜色 |
 * |---|---|---|---|
 * | 设置页组标题「外观」 | `section-title` | 16px semibold | `foreground`（主文字色） |
 * | 选项「跟随系统」 | `row-title` | 16px medium | `foreground` |
 *
 * ⇒ 同字号、同颜色、只差一档字重。组标题读起来是"一行加粗的正文"。
 *
 * 而仓库里**早有一档专为组标题设计的样式** `group-label`（13px + semibold + muted），
 * 它的注释写着「这一档是被产品负责人的一句『为什么标题比下面的说明还小』逼出来的」。
 * 也就是说：**同一个错犯过两次，第二次是因为没有一张"位置 → 档位"的表** ——
 * `TEXT_STYLES` 只规定了"有哪些档"，没规定"哪个位置用哪档"。
 *
 * ## 这张表怎么用
 *
 * 消费点**只许从这张表取**，不许自己写 `variant="xxx"`：
 *
 * ```tsx
 * import { TYPE_ROLE } from '@heyta/design-system';
 * <Text variant={TYPE_ROLE['section-heading']}>{title}</Text>
 * ```
 *
 * 门禁 `check:type-roles` 会拦两件事：
 * 1. 表里的某个角色**没有任何消费点**（孤儿角色）；
 * 2. 这三个"位置明确的组件"（`SectionHeader` / `SettingsSection` /
 *    `ChoiceRows`）内部绕过这张表、直接写死了 `variant`。
 *
 * ## 为什么角色名不用字号（`text-sm` 那种）
 *
 * 用字号命名的话，"组标题"和"小字"会被当成同一件事，而它们不是 ——
 * `group-label` 是 **13px + semibold + muted** 三条一起定义"这是索引，
 * 不是内容"。名字要说的是**它在页面里的职分**，不是它多大。
 */

import type { TextStyleName } from './typography.js';

/**
 * 位置 → 文字档。
 *
 * 顺序按**视觉层级从高到低**排（扫一眼就知道谁该压谁）。
 */
export const TYPE_ROLE = {
  /**
   * 分组标题（「近期状态」「外观」「语言」）。
   *
   * 🔴 13px + semibold + **muted**。它比行文字**小一档**是刻意的：
   * 组标题是**索引**，不是内容。iOS 设置页就是这个形状。
   * 而 heyta 里这条纪律的书面依据在 `typography.ts#group-label` 的注释里
   * （中文没有大小写线索，"小字 + 大写 + 宽字距"的眉标写法不成立，
   * 必须靠**字重 + 弱色**赢）。
   */
  'section-heading': 'group-label',

  /** 行主文字（任务标题、设置项名字、单选行选项）。全应用最高频。 */
  'row-title': 'row-title',

  /** 屏幕大标题。一屏只应有一个（法务文档那类整屏阅读页）。 */
  'screen-title': 'screen-title',

  /** 面板标题（底部面板、搜索面板的分组标题、AI 面板头）。 */
  'panel-title': 'panel-title',
} as const satisfies Record<string, TextStyleName>;

/**
 * 内容类型 → 文字档（与上面的「位置」是**两类**，不要混）
 *
 * 🔴 为什么分成两张表：`row-meta` 出现在几十处，每一处都是"这一行右侧的元信息"——
 * 它是**内容类型**，不是"页面的某个位置"。把它塞进 `TYPE_ROLE` 会让表混杂两种语义，
 * 而混着的表最后没人看（这正是那次事故的形状）。
 *
 * 两张表**都查孤儿**：定义了没人用就腐烂，不管它属于哪一类。
 *
 * ⚠️ `detail-title`（20px medium）在 `typography.ts` 里定义了却**一个消费点都没有**
 * （详情页标题走的是 `TextField`，自带样式）。它是死档，已从这张表移出。
 * 删不删 `typography.ts` 那一档是另一件事（要扫全仓），先在这里登记。
 */
export const TYPE_ROLE_CONTENT = {
  /** 行元信息（日期、计数、次要说明）。比行主文字小且弱。 */
  'row-meta': 'row-meta',
  /** 读数（`0/17`、`25:00`、统计数字）。等宽，不能因为位数变化而跳动。 */
  value: 'numeric-body',
  /** 说明 / 脚注（组下面那句"只影响这台设备"）。 */
  note: 'caption',
} as const satisfies Record<string, TextStyleName>;

export type TypeRole = keyof typeof TYPE_ROLE;

/**
 * 这张表刻意**不长**。
 *
 * 每多一个角色，就多一个"这个位置该用哪个"的模糊地带 —— 而那正是
 * 2026-11-14 那次事故的形状。要加角色，先问：它和表里现有的哪个角色
 * **在排版意图上真的不同**（不只是字号不同）？答不出来就别加。
 */
export const TYPE_ROLE_NAMES = Object.keys(TYPE_ROLE) as readonly TypeRole[];

/** `TYPE_ROLE_CONTENT` 的内容类型名。 */
export const TYPE_ROLE_CONTENT_NAMES = Object.keys(
  TYPE_ROLE_CONTENT,
) as readonly (keyof typeof TYPE_ROLE_CONTENT)[];

export type ContentTypeRole = keyof typeof TYPE_ROLE_CONTENT;
