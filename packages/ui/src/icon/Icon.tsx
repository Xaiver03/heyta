/**
 * 图标层（共享）
 * ==============
 *
 * ## 为什么共享层需要自己渲染图标
 *
 * 各端原本各自登记图标：mobile 用 `lucide-react-native`，web / landing 用
 * `lucide-react`。这在"每个应用各画各的"时没问题，但共享组件一旦要画一个
 * 带图标的徽章就撞墙了 —— 共享层不能 import 任何一个平台专属的图标包
 * （`lucide-react` 依赖 DOM，`lucide-react-native` 依赖 RN 原生视图），
 * 于是徽章只能靠宿主注入，而"一行长什么样"就被拆到了四个端。
 *
 * 🔴 解法：**把图标数据与图标渲染分开**。
 *
 * Lucide 官方有一个**框架无关**的包 `lucide` —— 它只导出图标数据
 * （`IconNode` = `[标签名, 属性][]`），**不依赖任何框架、零运行时依赖**。
 * 于是：
 *
 * | 层 | 谁提供 | 内容 |
 * |---|---|---|
 * | 图标**数据** | `lucide`（ISC，零依赖） | 路径 `d`、圆心半径… |
 * | 图标**渲染** | 本文件 | 把数据喂给 `react-native-svg` |
 *
 * `react-native-svg` 在 iOS / Android / 鸿蒙（`@react-native-oh-tpl/react-native-svg`）
 * 以及 web（自带的 `ReactNativeSVG.web.js`）上都有实现，所以**同一份源码**
 * 四个端都能画。这正是 `apps/mobile/src/ui/icons.tsx` 里那条既有结论
 * （"优先用 Lucide 而不是自己画"）的延伸 —— 只是把消费点从"各端各一个包"
 * 换成了"共享层用数据包"。
 *
 * ⚠️ **不要在这里自己手写 `<path d="…">`。** 手写路径等于脱离 24×24 网格与
 * 统一的描边权重，而且必然与无障碍/视觉基线漂移。要新图标就从 `lucide` 里取。
 *
 * ⚠️ 本文件**不 import 任何平台的图标包**，也**不 import `@heyta/i18n`**
 * （后者会拖进第二份 React，见 `TaskList.tsx` 顶部那段）。文案一律由宿主注入。
 */

import React, { useMemo } from 'react';
import {
  Circle,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
  Svg,
  type NumberProp,
} from 'react-native-svg';
import { useHeytaTokens } from '../theme.js';

/**
 * 图标数据的一条子元素。
 *
 * 刻意**自己定义**而不是 `import type { IconNode } from 'lucide'`：
 * `lucide` 的 `package.json` 里没有 `types` / `exports` 字段（只有 `main` + `module`），
 * 类型能否解析取决于消费方的 `moduleResolution` —— 让共享包的类型入口
 * 依赖这么一个隐式约定，会在某个端上突然断掉。四个字段的形状很简单，
 * 自己声明反而更稳，也顺带把"我们只用到这些"写清楚了。
 */
type IconChild = readonly [
  string,
  // Lucide 的 `SVGProps` 是 `Record<string, string | number | undefined>` ——
  // **必须含 `undefined`**，某些图标会把可选属性显式写成 `undefined`。
  // 漏掉它的话 `IconNode` 赋给本类型会报 "not assignable"，
  // 而错误信息只会指向"图标常量那一行"，看不出是属性类型的问题。
  Readonly<Record<string, string | number | undefined>>,
  // Lucide 的元组还有**可选的第三项**（嵌套子元素）。我们用不到它，
  // 但必须留出位置 —— 否则同样会因为"源有 3 项、目标只允许 2 项"而报错。
  ...readonly unknown[],
];

/** 一个图标 = 若干条 SVG 子元素。 */
export type HeytaIconData = readonly IconChild[];

/** Lucide 的属性形状：属性名与取值由它的数据保证。 */
type SvgChildProps = Record<string, string | number | undefined>;

/**
 * 标签名 → `react-native-svg` 组件。
 *
 * ⚠️ 这里有一次**必要的类型转换**，而且全文件只有这一处。
 *
 * 原因：Lucide 给的是 `Record<string, string | number | undefined>`，
 * 而各元素组件的 props 是精确类型（`d?: NumberProp`、`cx?: NumberProp`…）。
 * 想让它类型完全吻合，就得在我们这边把整个 SVG 属性表抄一遍 ——
 * 那份副本迟早会和 `react-native-svg` 漂移，而且漂移的表现是
 * "某个图标少画了一块"，不是编译错误。
 *
 * 转换**收在这一个常量上**，而不是散在每个图标、每次渲染里：
 * 要审"我们到底把哪些属性交给了 SVG"时，只看这一行。
 *
 * ⚠️ 只登记**实际用到**的标签。缺一个的表现是图标静默少画一块，
 * 所以下面的渲染循环对未知标签会**抛错**而不是悄悄跳过。
 */
const ELEMENTS = {
  path: Path,
  circle: Circle,
  line: Line,
  rect: Rect,
  polyline: Polyline,
  polygon: Polygon,
} as unknown as Readonly<Record<string, React.ComponentType<SvgChildProps>>>;

export interface HeytaIconProps {
  readonly data: HeytaIconData;
  /** 边长。默认取 `icon.sm` token —— 图标基准尺寸属于设计系统。 */
  readonly size?: NumberProp;
  /** 描边色。默认继承正文色。 */
  readonly color?: string;
  /**
   * 无障碍名。**给了才会被读屏念到。**
   *
   * 装饰性图标（旁边已经有文字说明）应当**不传** —— 传了会让读屏把同一件事
   * 念两遍（"优先级 高 优先级 高"）。需要单独表意的图标才传。
   */
  readonly label?: string;
  readonly strokeWidth?: NumberProp;
  readonly testID?: string;
}

export function HeytaIcon({
  data,
  size,
  color,
  label,
  strokeWidth = 2,
  testID,
}: HeytaIconProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const resolvedSize = size ?? tokens['icon.sm'];
  const resolvedColor = color ?? tokens['color.foreground'];

  const children = useMemo(
    () =>
      data.map((child, index) => {
        const tag = child[0];
        const attrs = child[1];
        const Element = ELEMENTS[tag];
        if (Element === undefined) {
          throw new Error(
            `HeytaIcon 不认识的 SVG 标签「${tag}」。` +
              '要新增请先在 packages/ui/src/icon/Icon.tsx 的 ELEMENTS 里登记，' +
              '否则这个图标会静默地少画一块。',
          );
        }
        // Lucide 的子元素顺序即绘制顺序，index 做 key 是稳定的 ——
        // 同一个图标的数据是常量，不会重排。
        return <Element key={`${tag}-${String(index)}`} {...attrs} />;
      }),
    [data],
  );

  return (
    <Svg
      width={resolvedSize}
      height={resolvedSize}
      // Lucide 的网格固定 24×24。**不要**改成别的值：路径是按这个网格画的。
      viewBox="0 0 24 24"
      fill="none"
      stroke={resolvedColor}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label === undefined ? {} : { accessibilityLabel: label, accessibilityRole: 'image' as const })}
      {...(testID === undefined ? {} : { testID })}
    >
      {children}
    </Svg>
  );
}
