/**
 * 语义文字样式层（Apple semantic typography）
 * ===========================================
 *
 * 解决什么问题：`font-size.base` 只说"多大"，不说"哪段文字该用多大"。
 * 于是每个界面各自拼 `{fontSize, fontWeight, lineHeight}`，拼法必然漂移 ——
 * 同一个"任务标题"在列表页是 16/400/24，在详情页变成 16/500/22，
 * 而没有任何一处会报错。
 *
 * 做法：像 Apple 的 semantic text styles 那样，把**字号 + 字重 + 行高 + 字距**
 * 作为一个不可分割的整体命名。组件只说"这是 row-title"，不说四个数字。
 *
 * 🔴 三条设计约束：
 *
 *   1. **不引入新取值。** 这里只**组合** tokens.css 里已有的 token。
 *      所以它不构成第二个事实源 —— 改 tokens.css 的值，这里跟着变。
 *
 *   2. **字距必须跟着字号。** Apple 的规则是字距**随字号变**：大字号收紧、
 *      小字号放宽。固定一个字距必然在某处是错的。因此每个样式都显式指定
 *      tracking，不允许有"没写字距所以是 0"的样式。
 *
 *   3. **数字必须等宽。** 计时器与统计数字不加 `tabular-nums` 时，
 *      每跳一秒整个版面都会横向抖动。这不是审美问题，是缺陷。
 *
 * ⚠️ 行高与字距在原生端要**乘字号**（见 native-values.ts）：
 *      CSS 的 `line-height: 1.5` 是无单位倍数，RN 的 `lineHeight` 是点值。
 *      直接传倍数会让行高塌成 1.5pt —— 不报错，只是文字挤成一团。
 */

import type { HeytaNativeTokens } from './native.js';
import { resolveLineHeight, resolveTracking } from './native-values.js';
import type { TokenName } from './tokens.js';

/** 一个语义文字样式的组成：四个 token 名 + 可选的等宽数字要求。 */
export interface TextStyleSpec {
  /** 字号 token。 */
  readonly size: TokenName;
  /** 字重 token。 */
  readonly weight: TokenName;
  /** 行高 token（**倍数**，消费时乘字号）。 */
  readonly leading: TokenName;
  /** 字距 token（**em 比例**，消费时乘字号）。 */
  readonly tracking: TokenName;
  /** `true` 表示数字必须等宽。计时/统计类样式必须设。 */
  readonly tabularNums?: true;
}

/**
 * heyta 的全部语义文字样式。
 *
 * 刻意**不多**：每多一个样式，就多一个"该用哪个"的模糊地带。
 * 只有在排版意图确实不同（而不只是字号不同）时才新增一个。
 */
export const TEXT_STYLES = {
  /** 屏幕大标题。一屏只应有一个 —— 两个大标题等于没有大标题。 */
  'screen-title': {
    size: 'font-size.3xl',
    weight: 'font-weight.bold',
    leading: 'line-height.tight',
    tracking: 'tracking.display',
  },
  /** 区块标题（如"今天""已完成""收集箱"）。用于分组，不用于页面主标题。 */
  'section-title': {
    size: 'font-size.lg',
    weight: 'font-weight.semibold',
    leading: 'line-height.tight',
    tracking: 'tracking.title',
  },
  /**
   * 强调正文。**导航栏标题与按钮标签共用这一个**。
   *
   * 我最初写成了两个样式（`nav-title` 与 `button`），测试立刻报
   * "两者解析结果完全相同"。它们确实相同 —— 因为按 Apple HIG，
   * 内联导航标题与按钮标签都是 `headline`（semibold + 紧行高）。
   *
   * 于是合并成一个**角色中立**的名字，而不是保留两个同值样式：
   * 两个同值样式不是分类，是没人删的冗余，而且下次调字重必然只改一处。
   * 命名用排版强调程度（headline）而非用途（nav-title），正是为了让它
   * 天然可以被多个角色复用。
   */
  headline: {
    size: 'nav.app-bar-title-size',
    weight: 'font-weight.semibold',
    leading: 'line-height.tight',
    tracking: 'tracking.body',
  },
  /** 任务行主文字。全应用最高频的样式。 */
  'row-title': {
    size: 'font-size.base',
    weight: 'font-weight.regular',
    leading: 'line-height.normal',
    tracking: 'tracking.body',
  },
  /** 任务行的次要信息：日期、清单名、标签、重复规则。 */
  'row-meta': {
    size: 'font-size.sm',
    weight: 'font-weight.regular',
    leading: 'line-height.normal',
    tracking: 'tracking.body',
  },
  /** 计数、徽标、辅助说明。 */
  caption: {
    size: 'font-size.xs',
    weight: 'font-weight.medium',
    leading: 'line-height.normal',
    tracking: 'tracking.caption',
  },
  /**
   * 标签栏文字。小字号下限（11px），因此字距放宽。
   * 字重直接引用 `font-weight.medium` —— 刻意不为标签栏单设一个字重 token，
   * 那会制造第二个权威（改一处漏一处且不报错）。
   */
  'tab-label': {
    size: 'nav.tab-label-size',
    weight: 'font-weight.medium',
    leading: 'line-height.tight',
    tracking: 'tracking.caption',
  },
  /**
   * 面板小标题（AI 面板的 `ht-ai__head` 那一行）。
   *
   * 🔴 它是从 web 的 `.ht-ai__head` 提取共享组件时**补出来的**：
   * 那条规则是"面板基础字号（xs）+ `font-weight: 600`"，
   * 而语义样式里最接近的 `row-title` 是 `font-size.base`（16px）——
   * 直接用会让面板标题明显变大。与其在共享组件里写裸的 `fontWeight`，
   * 不如把"小标题"这个**角色**命名出来：角色是稳定的，值可以调。
   */
  'panel-title': {
    size: 'font-size.xs',
    weight: 'font-weight.semibold',
    leading: 'line-height.tight',
    tracking: 'tracking.body',
  },
  /**
   * 角标数字（标签栏图标右上角的计数）。
   *
   * 与 `caption` **不合并**，尽管只差 1px：`caption` 是正文里的辅助说明，
   * 阅读距离 30–50cm；角标是 18px 圆里的一两个字符，要在图标笔画旁边被一眼读到。
   * 后者需要更重（semibold）才在那么小的尺寸下立得住 —— 这是排版意图的差别，
   * 不是字号的差别。合并会让其中一处必然是错的。
   *
   * 等宽是必须的：否则计数从 9 变 10 时，角标宽度会变，图标跟着抖动。
   */
  badge: {
    size: 'nav.tab-label-size',
    weight: 'font-weight.semibold',
    leading: 'line-height.tight',
    tracking: 'tracking.caption',
    tabularNums: true,
  },
  /** 番茄钟倒计时等**大**数字。必须等宽。 */
  'numeric-display': {
    size: 'font-size.4xl',
    weight: 'font-weight.bold',
    leading: 'line-height.tight',
    tracking: 'tracking.display',
    tabularNums: true,
  },
  /** 行内数字（时长、次数、日期跨度）。必须等宽。 */
  'numeric-body': {
    size: 'font-size.base',
    weight: 'font-weight.medium',
    leading: 'line-height.normal',
    tracking: 'tracking.body',
    tabularNums: true,
  },
} as const satisfies Record<string, TextStyleSpec>;

export type TextStyleName = keyof typeof TEXT_STYLES;

/** 解析后的样式：可直接展开进 React Native 的 `Text` style。 */
export interface RnTextStyle {
  readonly fontSize: number;
  /**
   * RN 的 `fontWeight` 是字符串联合（`'400' | '500' | …`），
   * 而 design token 里存的是数字。这里显式转换 —— 传数字在部分 RN 版本上
   * 会被忽略并静默回退到 regular。
   */
  readonly fontWeight: '400' | '500' | '600' | '700';
  readonly lineHeight: number;
  readonly letterSpacing: number;
  /**
   * 等宽数字。`tabular-nums` 是唯一需要的字形特性。
   *
   * ⚠️ 用**可变元组**而不是 `readonly ['tabular-nums']`：RN 的 `TextStyle.fontVariant`
   * 类型是 `FontVariant[]`（可变数组），readonly 元组**不能**赋给它 ——
   * 于是 `style={text['numeric-display']}` 会在每个消费点报类型错。
   * 一开始我写成 readonly，`tsc` 在四个文件里同时报出来。
   */
  readonly fontVariant?: ['tabular-nums'];
}

/**
 * 把语义样式解析成 RN 可直接消费的**具体数值**。
 *
 * 做三件事，每件都对应一个"不报错的失败"：
 *   1. 行高倍数 → 绝对点值（否则行高塌成 1.5pt）
 *   2. 字距 em 比例 → 点值（否则字距小到等于没有）
 *   3. 字重数字 → 字符串（否则可能被静默忽略）
 */
export function resolveTextStyle(
  name: TextStyleName,
  tokens: HeytaNativeTokens,
): RnTextStyle {
  const spec: TextStyleSpec = TEXT_STYLES[name];
  const fontSize = tokens[spec.size];
  const weightNum = tokens[spec.weight];

  if (typeof fontSize !== 'number') {
    throw new TypeError(`${name}: 字号 token ${spec.size} 不是数值（实际 ${typeof fontSize}）`);
  }
  if (typeof weightNum !== 'number') {
    throw new TypeError(`${name}: 字重 token ${spec.weight} 不是数值（实际 ${typeof weightNum}）`);
  }

  const fontWeight = String(weightNum) as RnTextStyle['fontWeight'];
  if (!/^[1-9]00$/.test(fontWeight)) {
    throw new RangeError(`${name}: 字重 ${fontWeight} 不是合法的 100–900 档位`);
  }

  return {
    fontSize,
    fontWeight,
    lineHeight: resolveLineHeight(tokens[spec.leading] as number, fontSize),
    letterSpacing: resolveTracking(tokens[spec.tracking] as number, fontSize),
    ...(spec.tabularNums === true ? { fontVariant: ['tabular-nums'] as ['tabular-nums'] } : {}),
  };
}

/** 一次性解析全部样式。组件通常在模块级调用一次并缓存。 */
export function resolveAllTextStyles(
  tokens: HeytaNativeTokens,
): Record<TextStyleName, RnTextStyle> {
  const out = {} as Record<TextStyleName, RnTextStyle>;
  for (const name of Object.keys(TEXT_STYLES) as TextStyleName[]) {
    out[name] = resolveTextStyle(name, tokens);
  }
  return out;
}