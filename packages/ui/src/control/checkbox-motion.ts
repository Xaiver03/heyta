/**
 * 勾选动效：**什么时候播、播成什么样**（纯函数，宿主无关）
 * ========================================================
 *
 * ## 它解决的两件事
 *
 * 1. **该不该播。** 长列表里"已完成"的行一进视口就弹一下，是噪音而不是反馈。
 *    所以动画只在"用户刚刚改了状态"这一帧才成立 —— 首次挂载一律不播。
 * 2. **勾上和取消不对称。** 勾完是仪式，撤销不是。两个方向用同一套动画会让
 *    连续勾选/取消读起来像抽搐。这里的真值表把这件不对称**钉成数据**，
 *    而不是散在组件里的三个 `if`。
 *
 * ## 🔴 为什么是纯函数（不直接写进 `TaskRow.tsx`）
 *
 * `packages/ui` 的 vitest 是 **node 环境**，解析不了 RN 的 Flow 源码
 * （见 `packages/ui/vitest.config.ts` 与 `tests/overlay-spring-physics.spec.ts`
 * 文件头）。所以任何"值得用测试钉住"的判据都必须住在 RN 之外。
 *
 * 这个文件里没有任何 `react-native` import —— 它只吐出一个描述，
 * 由 `TaskRow.tsx` 拿去驱动 `Animated`。
 *
 * ## 参数从哪来
 *
 * 弹簧本身不在这里：它走 `springFor('move', tokens)`（ζ=1 临界阻尼，
 * response 0.4），也就是**全仓唯一**的那条换算。本文件只决定"播哪个方向"，
 * 不决定"多快"—— 多快是设计系统的语义，不是这个控件的偏好。
 *
 * ## 那条笔记给的第 5 条（复选框）在这里变成了什么
 *
 * 笔记原文是「方框从 0.8 弹性放大填充，对勾 300ms 描边画出」。
 * 落到 RN 上只保留前半句：
 *
 *   - **0.8 → 1 的弹性放大：保留**，它正是"被按下去又弹回来"的读感。
 *   - **300ms 描边：不照搬。** 本仓的勾是用 `<Text>✓</Text>` 画的一个字形
 *     （`TaskRow.tsx` 明确写了"避免为它引入一个图标依赖"），字形没有路径可描。
 *     要描边就得为一个 20px 的勾引入 SVG - 那是为了动效改渲染层，代价不值。
 *     取而代之的是**勾的淡入 + 轻微放大**，观感上同样是"它长出来了"。
 */

import { springFor, springTokensOf, type SpringConfig, type SpringTokens } from '../overlay/spring-physics.js';

/** 一帧勾选状态里，动画要做的事。 */
export type CheckboxMotion =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'check';
      /** 起手缩放：先"被压一下"，再弹回 1 —— 这是笔记里 0.8 那半句的落点。 */
      readonly fromScale: number;
      readonly toScale: number;
      readonly tickFrom: number;
      readonly tickTo: number;
    }
  | {
      readonly kind: 'uncheck';
      readonly fromScale: number;
      readonly toScale: number;
      readonly tickFrom: number;
      readonly tickTo: number;
    };

/** 勾上时的起手缩放。 */
export const CHECK_FROM_SCALE = 0.8;

/**
 * 决定这一次状态变化要不要播、播哪个方向。
 *
 * @param previous  变化前的值
 * @param next      变化后的值
 * @param mounted   这个行是不是**已经在屏幕上**（首次挂载传 `false`）
 * @param reducedMotion 宿主的减动效偏好
 */
export function planCheckboxMotion(
  previous: boolean,
  next: boolean,
  mounted: boolean,
  reducedMotion: boolean,
): CheckboxMotion {
  // 首次挂载不播：已完成的行滚进视口时不该弹。这条最容易漏 ——
  // 它不表现为报错，只表现为"列表滚到哪都在抖"。
  if (!mounted) return { kind: 'none' };
  if (previous === next) return { kind: 'none' };
  // 减动效下不是"播得快一点"，而是**不播**：状态本身已经由颜色与字形表达，
  // 位移只会让前庭敏感的用户难受（与 tokens.css 把 duration 压到 1ms 同一条规则）。
  if (reducedMotion) return { kind: 'none' };

  if (next) {
    return {
      kind: 'check',
      fromScale: CHECK_FROM_SCALE,
      toScale: 1,
      tickFrom: 0,
      tickTo: 1,
    };
  }
  // 撤销：**不缩放**，只把勾淡出。勾完有仪式，撤销没有 —— 这是刻意的。
  return {
    kind: 'uncheck',
    fromScale: 1,
    toScale: 1,
    tickFrom: 1,
    tickTo: 0,
  };
}

/**
 * 勾选动画用哪一档弹簧。
 *
 * 🔴 走 `move` 档而不是新开一档：0.8→1 的位移只有 4px，`response 0.4` 已经是
 * "快到几乎看不见过程"；再快就只能靠新 token，而新 token 需要回答
 * "它服务哪个面" —— 一个 20px 的圆角方框答不了这个问题。
 */
export const CHECKBOX_SPRING_PRESET = 'move' as const;

/**
 * 取这一档的物理三件套。
 *
 * 🔴 内部**不写公式**：转发给 `springFor`，而 `springFor` 转发给
 * `@heyta/design-system` 的 `toSpringPhysics`。这里曾经写过一次
 * `ω₀ = 2π / response` 的手工展开 —— 那正是第二个权威。
 */
export function checkboxSpring(tokens: SpringTokens): SpringConfig {
  return springFor(CHECKBOX_SPRING_PRESET, tokens);
}
