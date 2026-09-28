/**
 * 应用内的小组件旅程 —— **纯逻辑，没有任何 React Native 依赖**。
 * ==============================================================
 *
 * 这个文件回答一个问题：**"我要怎么让用户知道 heyta 有桌面小组件，并且真的把它加上去？"**
 *
 * ## 🔴 最重要的一条产品事实：**我们无法替用户添加小组件**
 *
 * iOS、Android、鸿蒙**都不允许**应用以编程方式把小组件放到桌面上
 * （这是系统的隐私/安全边界，不是 API 不好找）。所以这一段旅程**只能是引导**，
 * 不能是一个"添加小组件"按钮 —— 一个按下去什么都不会发生的按钮，
 * 比一段说明文字糟糕得多。
 *
 * 界面上那句 `cannotAutoAdd` 就是为此存在的：**先说清"这件事得你自己做"**，
 * 用户才不会去找那个不存在的按钮。
 *
 * ## 为什么"打开一次 Heyta"必须写进旅程
 *
 * 卡片读的是**应用写下的快照**（四条不变量第一条：单一写入者）。
 * 一个刚装完应用、**从没打开过**就去加卡片的用户，卡片上是空的 ——
 * 它只会显示占位态「打开 Heyta 以显示小组件」。
 * 不说这一句，用户会以为小组件坏了。
 *
 * ## 为什么平台是三分支而不是两分支
 *
 * RN 的 `Platform.OS` 是 `'ios' | 'android'`，而鸿蒙走 RNOH 时**报什么并不确定**
 * （不是"以后再说"—— 是**当下就不知道**）。所以 `other` 是一个**真实的第三分支**，
 * 给一条通用且诚实的两步说明，而不是把 iOS 的步骤硬套给鸿蒙用户。
 * ⚠️ **不要把 `other` 写成"兜底的 iOS"** —— 那会给鸿蒙用户一条走不通的路径。
 */

import type { MessageKey } from '@heyta/i18n';

/** 三端。⚠️ 见文件头：`other` 是真实分支，不是兜底。 */
export type WidgetPlatform = 'ios' | 'android' | 'other';

/**
 * RN 的 `Platform.OS` → 我们的三分支。
 *
 * ⚠️ **大小写与空白都要容错**：这个值来自运行时而非常量，
 * 而一个 `'iOS'`（大写 I）如果落到 `other`，用户会拿到鸿蒙版的说明 ——
 * 这类错误在开发机上永远看不到。
 */
export function resolveWidgetPlatform(os: string | null | undefined): WidgetPlatform {
  const normalized = typeof os === 'string' ? os.trim().toLowerCase() : '';
  if (normalized === 'ios') return 'ios';
  if (normalized === 'android') return 'android';
  return 'other';
}

/**
 * 某个平台把小组件加到桌面的步骤（按顺序）。
 *
 * 每一步只是一个词条 key —— 文案在 `@heyta/i18n`，这个文件不持有任何界面文字。
 */
export function widgetAddSteps(platform: WidgetPlatform): readonly MessageKey[] {
  switch (platform) {
    case 'ios':
      return [
        'mobile.widgetJourney.ios.step1',
        'mobile.widgetJourney.ios.step2',
        'mobile.widgetJourney.ios.step3',
        'mobile.widgetJourney.ios.step4',
      ];
    case 'android':
      return [
        'mobile.widgetJourney.android.step1',
        'mobile.widgetJourney.android.step2',
        'mobile.widgetJourney.android.step3',
      ];
    default:
      return ['mobile.widgetJourney.other.step1', 'mobile.widgetJourney.other.step2'];
  }
}

/**
 * 这一段旅程该不该出现在界面上。
 *
 * 🔴 **判据是"这台设备上小组件真的能不能用"，而不是"平台叫什么"。**
 *
 * 用平台名判断会在两种情况下出错，而且**方向相反**：
 *   - 鸿蒙上报成 `'android'` → 我们画了 Android 的说明，但那段说明在鸿蒙上走不通；
 *   - 某个平台关了原生模块（`isWidgetBridgeAvailable()` 为假）→ 我们仍然画了整段旅程，
 *     用户照着做完，桌面上多出一张**永远显示占位**的卡片。
 *
 * 所以唯一的判据是**原生桥在不在这台设备上**。这与"一个点了没反应的开关比没有更糟"
 * 是同一条纪律：**画不出来的东西，就不要画。**
 */
export function shouldShowWidgetJourney(bridgeAvailable: boolean): boolean {
  return bridgeAvailable;
}

/**
 * 四张卡片的名字（按推荐顺序）。
 *
 * ⚠️ **`today` 排第一是决策 D2**（"四款都在 v1，今日任务优先"），
 * 不是为了好看 —— 用户最可能想放上桌面的就是今天要做什么。
 */
export const WIDGET_CARD_KEYS: readonly MessageKey[] = [
  'mobile.widgetJourney.card.today',
  'mobile.widgetJourney.card.quadrant',
  'mobile.widgetJourney.card.habits',
  'mobile.widgetJourney.card.focus',
] as const;
