/**
 * 移动端的**功能域入口注册表**（「我的」页那几行）
 * ==============================================
 *
 * ## 为什么要有这一份（W8 / `docs/plans/countdown-anniversary.md` §7 第 5 条）
 *
 * 工单里那个问题是：「移动端把 web 的开关表重复了一遍，该不该被 `check:layering` 拦？」
 * 裁决是把"重复"切成两半：
 *
 *   · **有哪些功能域**（词表）= 产品语义 ⇒ 唯一一份在 `@heyta/domain` 的
 *     `FEATURE_MODULE_KEYS`。这里每一项的 `key` 都声明成 `FeatureModuleKey`，
 *     所以移动端自己编一个 web 没有的词（或把 `countdown` 拼成 `count-down`）
 *     是**编译错误**，不是"两份注册表悄悄漂移"。
 *   · **这一端摆几个、什么顺序、放在哪一层**= 平台差异 ⇒ 每端一份（就是这里）。
 *     `check:layering` 因此**不需要**新增规则：它拦的是"外壳自己拼 op / 自己写业务判断"，
 *     而 tab 数量与入口位置不是那一类。
 *
 * ## 🔴 这份注册表是**承重的**，不是一张说明
 *
 * 只写一份"其实没人读的清单"正是 AGENTS.md §3.5 记过的那个错
 * （`ids.ts` 抽出来了、旧那份一直活着）。所以：
 *
 *   1. `ProfileScreen` 的入口行**由这里生成**（不再各写一份字面量）；
 *   2. 打开哪一屏走 `featureScreen()` 的**穷尽 switch** ——
 *      加一项而不接屏，`apps/mobile` 的 typecheck 直接红；
 *   3. `tests/feature-entries.spec.ts` 逐条查"key 在共享词表里 / 中英词条都取得到 /
 *      `ProfileScreen` 里真的有那张屏"。
 *
 * ## 🔴 这里只登记**功能域**，不登记导航表面
 *
 * 设置 / 通知 / 安全 / 回收站 / 导出 / 注册登录 **不在**这张表里 ——
 * 它们不是"heyta 有哪几个功能域"的成员（`settings`、`trash` 在 web 那边也不给关），
 * 强行登记会让词表变成"两端所有页面"的副本，那才是真的会漂。
 */

import type { FeatureModuleKey } from '@heyta/domain';
import type { MessageKey } from '@heyta/i18n';

/** 一个功能域在移动端第二层入口的登记项。 */
export interface MobileFeatureEntry {
  /** 🔴 共享词表里的 key（编一个不存在的 = 编译错误）。 */
  readonly key: FeatureModuleKey;
  /** 入口行的标题。**存 key 不存文案**（同 `nav/TabBar.tsx`：写中文就是硬编码）。 */
  readonly labelKey: MessageKey;
  readonly hintKey: MessageKey;
  /** 稳定测试锚点：设备验收脚本与本壳的判据都指它，改名要一起改。 */
  readonly testID: string;
  /**
   * 这一项打开的是哪张屏（组件名）。
   *
   * 🔴 是**字符串**而不是组件引用：本壳没有 RN 组件测试栈，而这张表要被
   * `tests/feature-entries.spec.ts` 在 node 里**值导入** —— import 组件会把
   * `react-native` 一起拉进来，整个 spec 文件转译失败
   * （`tests/habit-goal-entry.spec.ts` 文件头记的就是这个坑）。
   * 组件本体由 `ProfileScreen` 的 `featureScreen()` 接，接不上编译就红。
   */
  readonly screen: string;
}

/**
 * 移动端露出的功能域。**数组顺序 = 「我的」页那几行的顺序**
 * （成长 → 习惯 → 倒数纪念日：先回顾自己，再打卡，再看日子）。
 *
 * 🔴 **倒数日这一项是 W8 的产品承诺**，不是"顺手加的一个入口"：
 * 在它之前 `EVENT` 实体（W2）、共享卡片面（W5）、AI 工具（W10）**全都在**，
 * 而移动端**一个入口都没有** —— 这正是本仓反复记过的那类失效
 * （"零件都在、线没接"，AGENTS §3.5 末尾两段与 `docs/plans/roadmap.md` §5.1
 * 的 P0/P2 都是同一形状）。所以它由
 * `tests/feature-entries.spec.ts` 的「移动端必须露出这三个功能域」钉住：
 * **删掉这一项会红**，而不是静默地少一个入口。
 */
export const MOBILE_FEATURE_ENTRIES = [
  {
    key: 'growth',
    labelKey: 'mobile.growth.entry',
    hintKey: 'mobile.growth.entry.hint',
    testID: 'profile-entry-growth',
    screen: 'GrowthScreen',
  },
  {
    key: 'habits',
    labelKey: 'mobile.habits.entry',
    hintKey: 'mobile.habits.entry.hint',
    testID: 'profile-entry-habits',
    screen: 'HabitsScreen',
  },
  {
    // 词条是**本端新增的两条**（`mobile.countdown.entry{,.hint}`）：入口行要说的是
    // "在这台手机上打开它"，与 web 开关表那句模块说明（`web.shell.modules.countdown.*`）
    // 不是同一句话，复用它会让 rail 的开关与「我的」的入口共享一条措辞。
    // 🔴 而**屏内**的全部文案复用 `web.countdown.*`（见 `lib/countdown-display.ts`），
    //    与 `lib/habits-display.ts` 复用 `web.habits.*` 是同一条先例（命名残差已登记）。
    key: 'countdown',
    labelKey: 'mobile.countdown.entry',
    hintKey: 'mobile.countdown.entry.hint',
    testID: 'profile-entry-countdown',
    screen: 'CountdownScreen',
  },
] as const satisfies readonly MobileFeatureEntry[];

/** 这张表里出现过的 key（穷尽 switch 的联合类型就从这个推）。 */
export type MobileFeatureEntryKey = (typeof MOBILE_FEATURE_ENTRIES)[number]['key'];

/** 按 key 取登记项；不在表里返回 `undefined`（不抛 —— 读的是本地状态）。 */
export function mobileFeatureEntry(
  key: MobileFeatureEntryKey,
): (typeof MOBILE_FEATURE_ENTRIES)[number] | undefined {
  return MOBILE_FEATURE_ENTRIES.find((entry) => entry.key === key);
}
