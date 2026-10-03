/**
 * heyta 的**功能域词表**（跨端唯一一份）
 * ======================================
 *
 * ## 这条文件判的是 W8 的那个问题（`docs/plans/countdown-anniversary.md` §7 第 5 条）
 *
 * 「移动端把 web 的开关表重复了一遍，该不该被 `check:layering` 拦？」
 *
 * 裁决：**都不该 —— 但要把"重复"切成两半。**
 *
 * | 那一半 | 是什么 | 该不该共享 |
 * |---|---|---|
 * | **有哪些功能域**（词表本身） | 产品语义：倒数纪念日是一个功能域，不是一种颜色 | 🔴 **一份**（就是这里） |
 * | 每个功能域**在这一端放在哪里**、有几个、什么顺序、默认开不开 | 平台差异（屏幕宽度、鼠标 vs 触摸、rail vs 底部标签） | ✅ 每端一份 |
 *
 * 于是 `check:layering` 不新增规则（它拦的是"外壳自己拼 op / 自己写业务判断"，
 * 而 tab 数量与入口位置不是那一类），改由**类型**来拦：两端各自的注册表
 * 都把自己的 key 声明成 `FeatureModuleKey`，
 * 移动端自己编一个 web 没有的词（或把 `countdown` 拼成 `count-down`）
 * 是**编译错误**，不是"两份注册表悄悄漂移"。
 *
 * 🔴 **这条守卫能不能失败，只靠变异回答**（本文 §7 元规则 2）。三臂实测：
 *
 *   | 臂 | 改动 | 红在哪 |
 *   |---|---|---|
 *   | A | `MOBILE_FEATURE_ENTRIES` 里把 `countdown` 写成 `count-down` | `pnpm --filter @heyta/mobile typecheck` 红（`key` 不是 `FeatureModuleKey`），**且** `apps/mobile/tests/feature-entries.spec.ts` 的「注册表里每个 key 都在共享词表里」运行时也红 |
 *   | B | 把 `ShellModuleKey` 的别名换回手写的 8 项联合类型，并从 `SHELL_MODULES` 删掉 `countdown` | `feature-entries.spec.ts` 的「web 的开关表与共享词表**集合相等**」红 |
 *   | C | 把 `MobileFeatureEntry.key` 的类型放宽成 `string` | A 那臂的编译期部分失效，但运行时那臂照样红 —— 这就是上面两条各管一件事的原因 |
 *
 * ## 🔴 这里**没有**默认开关值
 *
 * `apps/web/src/features/shell/modules.ts` 里那个 `defaultOn`（倒数日默认关）
 * 是**产品负责人拍的**（同一份计划的 §3 W8），它现在仍住在那一端 —— 本批不搬。
 * ⚠️ 那是一处已知的 §3.5 张力（默认值是产品语义，却住在 `apps/`），
 * 搬它 = 改动 web 的行为，不属于"接移动端"这一单，已登记成缺口。
 *
 * ## 为什么在 `packages/domain` 而不是 `packages/app-host`
 *
 * ① 它和 `ENTITY_TYPES` / `TASK_SORT_KEYS` / `CATEGORY_SLOTS` 是同一类东西
 * —— **封闭词表**，不是接线也不是写入口；
 * ② `@heyta/app-host` 不依赖 `@heyta/i18n`，而这个词表的消费方两端都要能
 * 在 node 里**值导入**它做运行时断言（移动端的单测跑在 node，见
 * `apps/mobile/tests/habit-goal-entry.spec.ts` 文件头那条"不能 import react-native"）——
 * `@heyta/domain` 已经是这个形状（`growth-display.spec.ts` 就直接值导入它）。
 */

/**
 * 全部功能域的 key。**顺序无意义**（各端的显示顺序在各端自己那里）。
 *
 * ⚠️ 这一份与 web 开关表的 key 集合**刻意等价**：
 * `apps/web/src/features/shell/modules.ts` 的 `ShellModuleKey` 就是
 * `FeatureModuleKey` 的别名，所以加一项 = 两端同时看见，
 * 少一处 = 编译不过。新增功能域时**先加这里**，再让两端各自决定放哪儿。
 */
export const FEATURE_MODULE_KEYS = [
  'calendar',
  'quadrant',
  'habits',
  'timeline',
  'focus',
  'growth',
  'notes',
  'countdown',
] as const;

/** 功能域 key 的封闭联合类型。 */
export type FeatureModuleKey = (typeof FEATURE_MODULE_KEYS)[number];

/**
 * 运行时判定：**字符串**（来自存储、来自线协议、来自用户偏好）能不能算一个功能域。
 *
 * 类型守卫而不是 `includes` 的调用方自己 cast ——
 * 读 `localStorage` 那种地方拿到的就是 `string`，没有这一项就会有人写 `as FeatureModuleKey`。
 */
export function isFeatureModuleKey(value: string): value is FeatureModuleKey {
  return (FEATURE_MODULE_KEYS as readonly string[]).includes(value);
}
