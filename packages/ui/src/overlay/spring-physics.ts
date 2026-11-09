/**
 * Apple 弹簧参数 → RN `Animated.spring` 的物理三件套（纯函数，宿主无关）
 * ==================================================================
 *
 * ## 它补的那一格
 *
 * `packages/design-system/src/tokens.css` §3c 用 **Apple 的「阻尼比 ζ + 响应」**
 * 定义了这一仓的弹簧（`motion.spring-damping-*` / `motion.spring-response-*`），
 * 并在注释里写明"这一组**故意不是时长**"。但 RN 的 `Animated.spring` 只认
 * **物理三件套** `stiffness / damping / mass` —— 不认 `dampingRatio` / `response`。
 *
 * 中间这一层换算此前**只存在于 `apps/landing/src/lib/motion.ts`**（Web 侧、
 * 走 Motion 的 `transition`）。共享层要用同一组 token，就必须把这条换算
 * 也带进来；否则 `BottomSheet` 只能像 2026-11-05 之前那样写一组裸的
 * `320 / 32 / 0.7` —— 那正是"token 定义了却没人消费、两套物理模型并存"。
 *
 * ## 🔴 换算是一条数学恒等式，不是拟合值
 *
 * 二阶系统的标准参数化（质量单位化到 1）：
 *
 *   ω₀ = 2π / response      无阻尼角频率；响应就是无阻尼周期，**不是 duration**
 *   stiffness = ω₀²
 *   damping   = 2ζω₀
 *
 * 与 `apps/landing/src/lib/motion.ts` 的 `toSpringOptions()` **同一组式子** ——
 * 这不是巧合：两者的目标是同一个物理系统，只是落地到不同的动画 API。
 * 把它抄成两份会立刻制造第二个权威（设计系统调参时只有一份会跟着动），
 * 但 `apps/landing` 是 Web 应用、`packages/ui` 是共享层，两者的依赖方向
 * （见 `packages/ui/src/index.ts` 文件头的边界）不允许共享层反向 import 应用。
 * 因此这里保留同一组式子，并用**同一条恒等式**把它钉住
 * （`packages/ui/tests/overlay-spring-physics.spec.ts`）：
 * 临界阻尼时必然有 `damping === 2√stiffness`，这在数学上只能有一种写法。
 *
 * ## 为什么 mass 固定为 1，而不是沿用原来的 0.7
 *
 * RN 的 `SpringAnimation.js` 源码里：
 *
 *   zeta   = damping / (2 * sqrt(stiffness * mass))
 *   omega0 = sqrt(stiffness / mass)
 *
 * 可见**运动轨迹只由 (ζ, ω₀) 决定**，`mass` 单独不可观测 —— 它只通过这两个
 * 组合量起作用。要把 `(k=320, c=32, m=0.7)` 换成 `mass: 1` 而不改变物理，
 * 就必须**同时**令 `k' = k/m`、`c' = c/m`（除以 m，不是乘以 m —— 乘 m 会把
 * ζ 和 ω₀ 都改掉，实测从 1.069 掉到 0.748）。这样两个组合量逐字不变。
 * 归一化到 1 的好处是换算式子恒等、可验证，且与落地页那一份逐字一致。
 *
 * ## 🔴 实测校准读数（2026-11-05）
 *
 * 把原来那组硬编码 `stiffness: 320, damping: 32, mass: 0.7` 按上式反解，
 * 得到等效 `ζ = 1.069`、`response = 0.2939s`；而 token 给出的
 * `damping-default(1) + response-sheet(0.3)` 是 `ζ = 1.000`、`response = 0.300s`：
 *
 *   指标        硬编码(原)      token 换算      差异
 *   response    0.2939 s       0.3000 s       -2.04%
 *   zeta        1.0690         1.0000          当前略过阻尼
 *   收敛(2%)    0.5917 s       0.6000 s       -1.39%
 *   过冲        无             无              一致
 *
 * 差异 2% 小于人眼可辨阈值，且**方向是"硬编码一直略快于设计系统"** ——
 * 换成 token 后慢 1.4%，是设计系统本来就要的那个手感。所以这一组数值
 * 不是"刻意的特调"，而是对 `response-sheet` 的一次粗略近似。
 */

/**
 * 从 token 组名拼出的弹簧语义档。
 *
 * 🔴 刻意**不**暴露原始数值、也不提供"自定义 ζ"的口子：调用方能选的是
 * **交互的语义**（移动 / 面板 / 旋转），不是物理参数。给一个 `(zeta, response)`
 * 的自由入口，等于把"这仓的弹簧由 tokens.css 决定"重新打开成"谁都能再定一套"。
 */
export type SpringPreset = 'move' | 'sheet' | 'rotation';

/** RN `Animated.spring` 需要的三个参数。`mass` 恒为 1（见文件头）。 */
export interface SpringConfig {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

/**
 * 消费方要提供的 token 读数。
 *
 * 🔴 用**显式入参**而不是在模块里 import token：共享层不 import i18n / 宿主
 * （`packages/ui/src/index.ts` 文件头的边界），token 一律经
 * `useHeytaTokens()` 由宿主注入。这也让本函数能在 node 环境下被纯函数测试
 * 直接喂数（`packages/ui/vitest.config.ts` 的 node 环境解析不了 react-native）。
 */
export interface SpringTokens {
  readonly dampingDefault: number;
  readonly dampingMomentum: number;
  readonly responseMove: number;
  readonly responseSheet: number;
  readonly responseRotation: number;
}

/**
 * 两层弹簧语义之间的映射表 —— **一张表 + 一组纯函数**，与
 * `sheet-detents.ts` / `dismissal.ts` 同形状。
 *
 * `damping` 一列是 Apple 的原始规则（tokens.css §3c）：
 * **默认临界阻尼 1.0（不过冲）；只有手势本身带了速度（甩、扔、拖拽释放）
 * 才用 0.8**。菜单淡入却过冲是错的，甩出去的卡片回弹才对。
 */
const PRESET_SOURCE = {
  move: { damping: 'dampingDefault', response: 'responseMove' },
  sheet: { damping: 'dampingDefault', response: 'responseSheet' },
  rotation: { damping: 'dampingDefault', response: 'responseRotation' },
} as const satisfies Record<SpringPreset, { damping: keyof SpringTokens; response: keyof SpringTokens }>;

/**
 * 把 Apple 的「阻尼比 ζ + 响应」换算成 RN 的物理三件套。
 *
 * 导出是为了让测试能直接验证这条恒等式，而不是靠读代码相信它。
 */
export function toSpringConfig(dampingRatio: number, response: number): SpringConfig {
  const omega = (2 * Math.PI) / response;
  return {
    mass: 1,
    stiffness: omega * omega,
    damping: 2 * dampingRatio * omega,
  };
}

/**
 * 按**语义档**取弹簧，数值全部来自 token。
 *
 * `momentum = true` 时改用 `damping-momentum`（ζ=0.8，允许过冲）。
 * 默认 `false` —— 临界阻尼是安全默认，要过冲必须显式点名。
 */
export function springFor(
  preset: SpringPreset,
  tokens: SpringTokens,
  options?: { readonly momentum?: boolean },
): SpringConfig {
  const source = PRESET_SOURCE[preset];
  const zeta = options?.momentum === true ? tokens.dampingMomentum : tokens[source.damping];
  return toSpringConfig(zeta, tokens[source.response]);
}
