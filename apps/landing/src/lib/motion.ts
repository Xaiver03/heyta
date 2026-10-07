/**
 * 动效物理：把设计系统的弹簧 token 接进 Motion
 * ==============================================
 *
 * 🔴 **这里的取值不是写死的，是从 tokens.css 读出来的。**
 *
 * 理由：tokens.css §3c 已经用 Apple 的「阻尼比 + 响应」定义了这套物理
 * （`--ht-motion-spring-damping-*` / `--ht-motion-spring-response-*`），
 * 而 `MASTER.md` §11 明确说这套参数是设计系统的一部分。
 * 如果落地页自己再写一份 `{ bounce: 0.2, duration: 0.4 }`，就等于
 * **制造第二个权威** —— 哪天设计系统把响应从 0.4 调成 0.35，
 * 落地页会静默地留在旧手感上，而且没有任何一处会报错。
 *
 * 换算关系（Apple → Motion）：
 *   Motion 的 `bounce` 就是「1 − 阻尼比」：ζ=1.0 → bounce 0（不过冲），
 *   ζ=0.8 → bounce 0.2（轻微过冲）。这正是 Apple 的语义。
 *   Motion 的 `duration` 在 spring 下就是「响应」（秒），不是固定时长。
 *
 * ⚠️ `prefers-reduced-motion` 由两条独立通道保证：
 *   1. tokens.css 已把全部 `--ht-duration-*` 压到 1ms（CSS 过渡自动降级）；
 *   2. 本文件导出的 `useMotionPreset()` 会把**位移类**动效换成纯淡入
 *      （Motion 的弹簧不受 CSS 变量影响，必须单独处理）。
 *   只做第 1 条是不够的 —— 弹簧照样会把元素甩来甩去。
 */

import { useMemo } from 'react';
import { useReducedMotion, type Transition, type Variants } from 'motion/react';

/**
 * 二阶系统的三个参数。
 *
 * 🔴 刻意**不用** Motion 的 `SpringOptions` 当返回类型：那个类型三个字段都是
 * 可选的（`number | undefined`），于是任何消费方都得处理 `undefined`，
 * 而本函数**保证**三个都返回。用这个精确类型，测试里 `Math.sqrt(stiffness)`
 * 不需要断言、也不需要 `?? 0`。
 *
 * 它在结构上可赋给 `SpringOptions`，所以 `useSpring` 照样接受。
 */
export interface SpringPhysics {
  mass: number;
  stiffness: number;
  damping: number;
}

/** 从 `<html>` 的计算样式读一个数值型 token。 */
function readNumberToken(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * 把 Apple 的「阻尼比 ζ + 响应」换算成 Motion 的物理三件套。
 *
 * 为什么需要两条通道：Motion 有两个不同的入口 ——
 *   - `transition={{ type: 'spring', bounce, duration }}`（声明式，tween 风格的配置）
 *   - `useSpring(value, { stiffness, damping, mass })`（命令式，跟踪一个 MotionValue）
 * 后者**不接受** `bounce`/`duration`。如果只提供前一种，写倾斜跟随时就得
 * 自己拍一组 stiffness/damping —— 那又变成"第二个权威"了。
 *
 * 换算（质量取 1，单位化）：
 *   ω₀ = 2π / response        —— 响应就是无阻尼周期
 *   stiffness = ω₀²
 *   damping   = 2ζω₀
 * 这是标准的二阶系统参数化，不是拟合出来的经验值。
 *
 * 导出是为了让 `tests/motion.spec.ts` 能直接验证这个换算 ——
 * 它是一条**数学恒等式**（临界阻尼时 `damping === 2√stiffness`），
 * 值得用测试钉住，而不是靠读代码相信它。
 */
export function toSpringOptions(dampingRatio: number, response: number): SpringPhysics {
  const omega = (2 * Math.PI) / response;
  return {
    mass: 1,
    stiffness: omega * omega,
    damping: 2 * dampingRatio * omega,
  };
}

export interface MotionPreset {
  /** 大部分 UI 的默认：临界阻尼，不过冲。 */
  ui: Transition;
  /** 抽屉 / 面板：响应更快。 */
  sheet: Transition;
  /**
   * 旋转（如主题图标翻转）。
   *
   * 🔴 单独一条，读的是 `--ht-motion-spring-response-rotation`。
   * 取值今天恰好与 `ui` 相同（都是 0.4），所以换过去**没有任何视觉变化** ——
   * 但如果不读它，设计系统哪天调了旋转响应，落地页会静默地留在旧手感上，
   * 而且没有任何一处会报错。这正是本文件开头警告的那种漂移。
   */
  rotation: Transition;
  /** **只有手势本身带了速度**才用（甩、扔、拖拽释放）。 */
  momentum: Transition;
  /** 与 `ui` 同物理，供 `useSpring` 用（跟踪指针等连续值）。 */
  uiSpring: SpringPhysics;
  /** 与 `momentum` 同物理，供 `useSpring` 用。 */
  momentumSpring: SpringPhysics;
  /** 位移类动效是否应被降级为纯淡入。 */
  reduced: boolean;
}

export function useMotionPreset(): MotionPreset {
  const reduced = useReducedMotion() === true;

  return useMemo<MotionPreset>(() => {
    const dampingDefault = readNumberToken('--ht-motion-spring-damping-default', 1);
    const dampingMomentum = readNumberToken('--ht-motion-spring-damping-momentum', 0.8);
    const responseMove = readNumberToken('--ht-motion-spring-response-move', 0.4);
    const responseSheet = readNumberToken('--ht-motion-spring-response-sheet', 0.3);
    const responseRotation = readNumberToken('--ht-motion-spring-response-rotation', 0.4);

    return {
      ui: {
        type: 'spring',
        bounce: 1 - dampingDefault,
        duration: responseMove,
      },
      sheet: {
        type: 'spring',
        bounce: 1 - dampingDefault,
        duration: responseSheet,
      },
      rotation: {
        type: 'spring',
        bounce: 1 - dampingDefault,
        duration: responseRotation,
      },
      momentum: {
        type: 'spring',
        bounce: 1 - dampingMomentum,
        duration: responseMove,
      },
      uiSpring: toSpringOptions(dampingDefault, responseMove),
      momentumSpring: toSpringOptions(dampingMomentum, responseMove),
      reduced,
    };
  }, [reduced]);
}

/**
 * 进入视口的错峰浮现。
 *
 * 🔴 `reduced` 时**只保留 opacity**：位移是前庭不适的主要来源，
 * 而 Apple《Materials》那条"减少动效不是没有反馈"要求保留可读的过渡。
 * 不是 `animation: none` —— 那会让"这里发生了状态变化"这条信息一起消失。
 *
 * 🔴 `transition` 是**必填**参数，这不是形式主义。
 *
 * `y` 属于 Motion 的 transform 键：只要不传 `transition`，Motion 就会回落到
 * 库内置的 `underDampedSpring`（`motion-dom` 的
 * `animation/utils/default-transitions.mjs`：stiffness 500 / damping 25）——
 * 换算成 Apple 的阻尼比是 ζ≈0.56，也就是 **bounce≈0.44**，明显过冲，
 * 而且完全绕开了 `tokens.css`。
 *
 * 这个函数是全页用得最多的入场动效（能力区、英雄区事实条、自建、末尾 CTA 都走它），
 * 所以「忘了传 transition」的代价是**整页的入场人格都跑在库默认值上**，
 * 而设计系统改任何弹簧参数都不会生效 —— 且没有任何一处会报错。
 * 做成必填，就从类型上堵死了这条路。
 */
export function revealVariants(
  reduced: boolean,
  transition: Transition,
  distance = '1.5rem',
): Variants {
  if (reduced) {
    return {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: { duration: 0.2 } },
    };
  }
  return {
    hidden: { opacity: 0, y: distance },
    visible: { opacity: 1, y: 0, transition },
  };
}

/**
 * 遮罩式标题显现（keynote 风格的"从槽里升起来"）
 * ================================================
 *
 * 模式参考 Amicro（MIT，`registry/ui/text/text-reveal.tsx`）——但物理是**我们的**：
 * 它用 easeOutExpo 的 tween，这里用设计系统换算出来的弹簧。理由与文件头相同：
 * 再引一条缓动曲线就是第二个权威，设计系统调参时它会静默留在旧手感上。
 *
 * 结构：外层 `overflow: hidden`（遮罩槽）+ 内层块级元素 `y` 从槽底升到 0。
 * 与 `revealVariants` 的淡入上浮不同，遮罩在位移开始前就把内容**裁掉**了，
 * 所以正常模式下 hidden 不需要 opacity —— "看不见"由裁剪表达，
 * "文字是从一条缝里长出来的"由遮罩边缘表达。这正是 keynote 标题的读感。
 *
 * 🔴 `hidden` 的 y 是 **112%** 而不是 100%：h1 的行高是 1.08、`em` 还带
 * `padding-block-end: 0.08em` 的降部余量 —— 内层块的高度比可见字形高出一点，
 * 100% 只走到"字形完全出槽"的临界点，斜体降部（英文页的 g/j/y）会先露一条头。
 * ≥112% 保证任何字形都完全在槽外。移动端折成两行时百分比按**整块高度**算，
 * 一样盖得住 —— 这也是选整块遮罩而不是逐行拆分的原因：行数由视口决定，
 * 拆行就是要把排版决策抄进组件里。
 *
 * 🔴 减动效下降级为**纯淡入**（与 `revealVariants` 同一条 Apple《Materials》规则：
 * 减少动效不是没有反馈）。此时遮罩仍在，但内容从不位移。
 */
export function maskedRevealVariants(reduced: boolean, transition: Transition): Variants {
  if (reduced) {
    return {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: { duration: 0.2 } },
    };
  }
  return {
    hidden: { y: '112%' },
    visible: { y: '0%', transition },
  };
}

/**
 * 全页统一的错峰步长（秒）。
 *
 * AUDIT §7：组入场用 **30–80ms** 的错峰。更重要的是这个值必须是**唯一**的 ——
 * 它原先作为字面量散落在六个文件里（0.06 / 0.07 / 0.08 / 0.16），
 * 于是自建区的终端成了全页最慢、最散的一次浮现（160ms，上限的两倍），
 * 而它本该是最紧凑的一块。和弹簧一样：散落的近似值就是漂移。
 */
export const STAGGER = 0.07;

/** 组内首个元素的额外延迟，让「一组」和「上一组」分得开。 */
export const STAGGER_DELAY_CHILDREN = 0.05;

/** 首屏英雄区入场的整体延迟 —— 一次性的，不属于错峰体系。 */
export const HERO_ENTRANCE_DELAY = 0.12;

/** 错峰容器：子元素依次浮现。 */
export function staggerContainer(reduced: boolean, stagger = STAGGER): Variants {
  return {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: reduced ? 0 : stagger,
        delayChildren: reduced ? 0 : STAGGER_DELAY_CHILDREN,
      },
    },
  };
}

/**
 * 展厅窗口的不透明度曲线
 * ========================
 *
 * 两个纯函数（不依赖 Motion），因为这条曲线有一个**能证伪的不变量**要钉住，
 * 而它只能在测试里钉：`apps/landing/tests/showcase-opacity.spec.ts`。
 *
 * ## 为什么不是 `1 - |o| * 1.05` 这个简单的对称淡出
 *
 * 旧版窗口是 `inset: 0` 的整屏元素、在 `perspective` + `preserve-3d` 的舞台里
 * 靠 `translateZ` 分前后。对称淡出在**换位的中点上**让前后两块同时半透明：
 * `|o| = 0.5` 时两块都是 47.6%。前面那块一旦不是不透明的，后面那块就会从它
 * 里面透出来 —— 中间那一片看起来像**双重曝光**（叠影/ghosting）。
 *
 * 根因不是"淡出太多"，而是**前面那块不该淡**：3D 排序本来就会让靠前的窗口
 * 遮住靠后的，不需要再用透明度表达遮挡。所以 3D 路径改成"平台 + 快速收尾"：
 *
 *   |o| ≤ 0.6 → 1（完全不透明，靠 3D 前后关系遮挡）
 *   |o| ≥ 1.0 → 0
 *   中间线性落到 0
 *
 * ⚠️ 这个曲线有个必须成立的性质：**任何滚动进度下都至少有一块窗口是完全不透明的**
 * （也就是"离自己那一格最近"的那块）。否则叠影会回来。测试逐点扫 p ∈ [0,1] 断言它。
 */

/** 3D 路径里窗口开始淡出的位置（`|offset|`）：之前保持完全不透明。 */
export const SHOWCASE_OPAQUE_PLATEAU = 0.6;

export function showcaseWindowOpacity(offset: number): number {
  const abs = Math.abs(offset);
  return Math.max(0, Math.min(1, (1 - abs) / (1 - SHOWCASE_OPAQUE_PLATEAU)));
}

/**
 * 减动效路径的不透明度：**纯交叉淡入**。
 *
 * 减动效下位移与旋转都被去掉，旧版窗口全部 `inset: 0` 直叠 ——
 * 这时候"前后关系"不存在了，遮挡只能由透明度表达，所以必须保留平滑淡出。
 * 把 3D 那条平台曲线用在这里会让换位变成一次**硬切**（两块都是 1，
 * 靠 DOM 顺序决定谁在上面）。
 */
export function showcaseWindowOpacityReduced(offset: number): number {
  return Math.max(0, 1 - Math.abs(offset) * 1.05);
}

/**
 * 视口触发的统一参数。
 *
 * `once: true` 是刻意的：反复进出视口就重放会让页面显得神经质，
 * 而且用户往下滚时视线已经过去了，重放只是在浪费合成帧。
 * `amount: 0.25` 让元素**真的进来了**才算数，避免只露一个边角就播完。
 */
export const VIEWPORT = { once: true, amount: 0.25 } as const;
