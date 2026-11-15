/**
 * 动效试验台的数据层：把「笔记的 (stiffness, damping)」翻译成设计系统的语言
 * ======================================================================
 *
 * 这个文件存在的唯一理由：笔记里的 6 条动效给的是 **物理三件套**，
 * 而本仓 `tokens.css` §3c 用的是 **Apple 的（阻尼比 ζ + 响应）**。
 * 两套参数不能直接比大小 —— `刚度 260` 到底"弹不弹"，只有在换算成
 * 阻尼比之后才有答案（260/12 → ζ=0.372 → 28.4% 过冲）。
 *
 * ## 🔴 反向换算不是第二权威
 *
 * 这里有一次 `k, c → ζ, response` 的**逆运算**。它看起来像在抄公式，
 * 但区别在于：本仓唯一的**权威换算**是 `toSpringPhysics(ζ, response)`
 * （`packages/design-system/src/spring-physics.ts`），它负责"设计系统 → 下游动画 API"。
 * 这里做的是**验收方向的翻译**："别人给我的参数，等于我们的哪一档"。
 *
 * 为了证明它不是凭感觉写的，`noteToDesignSystem()` 会**回代验证**：
 * 用 `toSpringPhysics` 把算出的 (ζ, response) 再正算回去，必须还原出
 * 笔记的 (k, c)。这个回环断言在 `lab.spec.ts` 里被钉住 ——
 * 逆运算一旦写错（比如把 2π 当成 π），测试立刻红。
 *
 * ## 为什么过冲量要单独算
 *
 * 「边长 0.94 → 回 1，略带过冲」这种描述无法判断"略"是多少。
 * 二阶系统的过冲只由 ζ 决定：`exp(−πζ / √(1−ζ²))`。
 * 28.4% 与 1.5% 的差别不是审美，是**"这个按钮在颤"和"这个按钮很稳"的差别**。
 */

import { toSpringPhysics, type SpringPhysics } from '@heyta/design-system';

/** 笔记给出的参数形态：物理三件套的质量恒为 1（与 notebook 的常见写法一致）。 */
export interface NoteSpring {
  readonly stiffness: number;
  readonly damping: number;
}

/** 换算到设计系统的语言。 */
export interface DesignSystemSpring {
  /** 阻尼比：1 = 临界阻尼不过冲，越小越弹。 */
  readonly dampingRatio: number;
  /** 响应（秒）：到达目标的速度，**不是** duration。 */
  readonly response: number;
  /** 由 ζ 推出的过冲百分比（0–100）。 */
  readonly overshootPercent: number;
}

/**
 * `(k, c) → (ζ, response)`，并算过冲。
 *
 * ⚠️ 公式与 `toSpringPhysics` 同源但**方向相反**，这里的正确性由
 * `noteToDesignSystem` 的回代断言保证，不要单独修改任何一边。
 */
export function noteSpringToDesignSystem(note: NoteSpring): DesignSystemSpring {
  const omega = Math.sqrt(note.stiffness);
  const dampingRatio = note.damping / (2 * omega);
  const response = (2 * Math.PI) / omega;
  return { dampingRatio, response, overshootPercent: overshootOf(dampingRatio) };
}

/** 二阶系统的阶跃过冲只由阻尼比决定。ζ ≥ 1 时不过冲。 */
export function overshootOf(dampingRatio: number): number {
  if (dampingRatio >= 1) return 0;
  const root = Math.sqrt(1 - dampingRatio * dampingRatio);
  return Math.exp((-Math.PI * dampingRatio) / root) * 100;
}

/**
 * 把笔记的物理三件套翻译成设计系统档位的**同时**做回代验证。
 *
 * 回代失败意味着"这组参数根本不在我们的参数化空间里"（例如笔记给了
 * 质量 m≠1 的写法），那时不该静默取近似值，而应该让调用方看见。
 */
export function noteToDesignSystem(note: NoteSpring): {
  readonly designSystem: DesignSystemSpring;
  readonly sameFactory: boolean;
  readonly roundTrip: SpringPhysics;
} {
  const designSystem = noteSpringToDesignSystem(note);
  const roundTrip = toSpringPhysics(designSystem.dampingRatio, designSystem.response);
  const sameFactory =
    Math.abs(roundTrip.stiffness - note.stiffness) < 0.01 &&
    Math.abs(roundTrip.damping - note.damping) < 0.01;
  return { designSystem, sameFactory, roundTrip };
}

/** 判定档：这六条对当前设计系统意味着什么。 */
export type Verdict = 'fits' | 'adapt' | 'reject' | 'worth';

export interface MotionSpec {
  readonly id: string;
  /** 笔记里的叫法。 */
  readonly title: string;
  /** 笔记原文。 */
  readonly note: string;
  /** 放在 heyta 里的真实落点（没有落点就写"无"）。 */
  readonly scene: string;
  readonly verdict: Verdict;
  /** 一句话结论。 */
  readonly reasoning: string;
  /** 对应的既有 token（有就写，证明不是新发明）。 */
  readonly token?: string;
}

/**
 * 六条动效的判定。
 *
 * 🔴 判定依据只有三份：`tokens.css` §3c（弹簧语义）、`design-system.md`
 * （禁止裸值）、以及仓库里**已经在跑**的实现。没有"我觉得好看"这一档 ——
 * 每条下面都写清楚它撞的是哪一条。
 */
export const MOTION_SPECS: readonly MotionSpec[] = [
  {
    id: 'press',
    title: '1. 按压回弹',
    note: '按下缩至 0.94，松手弹簧回 1，刚度 260、阻尼 12，略带过冲',
    scene: '所有可点元素的第一帧反馈',
    verdict: 'adapt',
    token: '--ht-motion-press-scale / --ht-duration-press / --ht-motion-spring-*',
    reasoning:
      '思路对，参数要换：0.94 比我们的 0.97 更"陷"，而 ζ=0.372 的 28.4% 过冲在 100ms 的按下反馈里会读成"抖"。仓库已在跑 0.97 + 100ms + ease-standard。',
  },
  {
    id: 'switch',
    title: '2. 弹性开关',
    note: '滑块拉伸 1.35 倍，刚度 200、阻尼 14，底色 280ms 渐变',
    scene: '设置页开关（当前是 RN Animated，见 packages/ui/src/settings）',
    verdict: 'adapt',
    token: '--ht-duration-normal / --ht-motion-spring-*',
    reasoning:
      '拉伸 1.35 是"果冻"语言，与临界阻尼的克制冲突；实测切到右端时滑块会被轨道裁掉一角（origin 在左侧，向右长出 9.8px，而右侧只剩 2px）。280ms 正好卡在 normal(200) 与 slow(300) 中间，是裸值。',
  },
  {
    id: 'ripple',
    title: '3. 波纹跟手',
    note: '以点击点为圆心，450ms 扩至 2.4 倍，初始透明度 0.28',
    scene: '无（Material 语言）',
    verdict: 'reject',
    token: '--ht-state-pressed-opacity（0.08）',
    reasoning:
      '这是 Material 的交互语言，本仓是 Apple 语言：按下用叠加层 8% 表达，不起波纹。450ms > slow(300) 会拖慢每一次点击；0.28 的不透明度也比我们的 0.08 重三倍半。',
  },
  {
    id: 'like',
    title: '4. 点赞反馈',
    note: '爱心缩至 1.3 再弹回，散开 8 个小圆点，刚度 300、阻尼 10',
    scene: '改造为「勾完一条任务」的庆祝',
    verdict: 'worth',
    token: '--ht-motion-spring-damping-momentum（0.8）',
    reasoning:
      'heyta 没有"点赞"，但有更高频的等价动作：勾完任务。ζ=0.289 的 38.8% 过冲不能直接搬到勾选框（每勾一次都颤），但"完成后有一记明确的回应"值得做。',
  },
  {
    id: 'checkbox',
    title: '5. 复选框动画',
    note: '方框从 0.8 弹性放大填充，对勾 300ms 描边画出',
    scene: '任务行勾选框（TaskRow，今天勾上只换一个静态 ✓）',
    verdict: 'fits',
    token: '--ht-duration-slow（300ms）/ --ht-motion-spring-response-*',
    reasoning:
      '六条里唯一开箱就对的：300ms 描边正好是 slow 档，0.8→1 的弹性放大用 ζ=1 / response=0.3 就能成立，不需要新 token。这是最值得先上的一条。',
  },
  {
    id: 'magnetic',
    title: '6. 磁吸按钮',
    note: '指针进入 120px 范围偏移 0.35 强度，刚度 150、阻尼 15',
    scene: '落地页 CTA（已有 Magnetic.tsx）',
    verdict: 'fits',
    token: '--ht-motion-spring-*（读 token，见 lib/motion.ts）',
    reasoning:
      '仓库已经有了，而且比笔记更克制：吸偏比例 0.2（笔记 0.35）、位移上限 8px（笔记按比例无限放大）。ζ=0.612 的 8.8% 过冲接近我们的动量档。产品内不需要。',
  },
];

/** 试验台左侧的「笔记原参数」—— 只用于对照展示，不许进入产品代码。 */
export const NOTE_SPRINGS: Readonly<Record<string, NoteSpring>> = {
  press: { stiffness: 260, damping: 12 },
  switch: { stiffness: 200, damping: 14 },
  like: { stiffness: 300, damping: 10 },
  magnetic: { stiffness: 150, damping: 15 },
};
