/**
 * Apple 弹簧参数 → 二阶系统物理三件套
 * =====================================
 *
 * ## 🔴 这是**唯一**的一处换算实现
 *
 * `tokens.css` §3c 用 Apple 的「阻尼比 ζ + 响应」定义了这一仓的弹簧
 * （`--ht-motion-spring-damping-*` / `--ht-motion-spring-response-*`），
 * 并在注释里写明"这一组**故意不是时长**"。但下游的动画 API 都不认这两个量：
 *
 *   - Web（`apps/landing`）走 Motion，要的是 `bounce` / `duration` 或
 *     `useSpring` 的 `{ stiffness, damping, mass }`；
 *   - RN（`packages/ui`）的 `Animated.spring` 要的是 `{ stiffness, damping, mass }`。
 *
 * 换算公式与参数**同源**，所以它住在定义 token 的这个包里 ——
 * 这正面回答了"为什么不是放在某个消费方"：放任何一边都会让另一边去 import
 * 应用层（依赖方向反了），或者抄一份（第二个权威）。
 *
 * ## 换算是一条数学恒等式，不是拟合值
 *
 * 二阶系统的标准参数化（质量单位化到 1）：
 *
 *   ω₀ = 2π / response      无阻尼角频率；响应就是无阻尼周期，**不是 duration**
 *   stiffness = ω₀²
 *   damping   = 2ζω₀
 *
 * ## 为什么质量固定为 1
 *
 * RN 的 `SpringAnimation.js` 源码里：`zeta = damping / (2√(stiffness·mass))`、
 * `omega0 = √(stiffness/mass)` —— **运动轨迹只由 (ζ, ω₀) 决定**，
 * `mass` 单独不可观测。所以把任意 `(k, c, m)` 归一化成 `mass: 1` 时，
 * 必须**同时**令 `k' = k/m`、`c' = c/m`（除以 m，不是乘以 m）。
 *
 * ## 两个消费方的**差异只在形状**，不在物理
 *
 * 两边的核心式子逐字相同，差别只是外层包装，因此**只共享这一层**：
 *
 *   | 消费方 | 入口 | 输出 | 语义档位从哪来 |
 *   |---|---|---|---|
 *   | `apps/landing` | `toSpringOptions(ζ, response)` | `{ mass, stiffness, damping }` | 读 CSS 变量（`readNumberToken`） |
 *   | `packages/ui` | `springFor(preset, tokens, { momentum })` | `{ stiffness, damping, mass }` | 由宿主经 `useHeytaTokens()` 注入 |
 *
 * ⚠️ **不要**把 `springFor` 的 `SpringPreset` 语义档也搬到这里：那一层的
 * "哪一档该配哪个 token" 属于 RN 组件的消费约定，而 landing 是直接读 CSS
 * 变量的。这里只负责**唯一的那个数学映射**。
 */

/** iOS / Apple 的二阶系统物理三件套：`mass` 恒为 1（见文件头）。 */
export interface SpringPhysics {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

/**
 * 把 Apple 的「阻尼比 ζ + 响应」换算成二阶系统的物理三件套。
 *
 * 🔴 **这是全仓唯一的换算实现。** 消费方一律 import 它，不要再抄一份式子：
 * 抄一份的失败方式是设计系统调参后只有一份跟着动，而**没有任何一处会报错**。
 * 判据：`packages/design-system/tests/spring-physics.spec.ts`。
 */
export function toSpringPhysics(dampingRatio: number, response: number): SpringPhysics {
  const omega = (2 * Math.PI) / response;
  return {
    mass: 1,
    stiffness: omega * omega,
    damping: 2 * dampingRatio * omega,
  };
}
