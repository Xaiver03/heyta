/**
 * 磁性按钮（CTA 的"靠近被吸"微交互）
 * =====================================
 *
 * 模式参考 Amicro（MIT，`registry/ui/hover/magnetic-button.tsx`），但有三处刻意不同：
 *
 * 1. **物理来自 tokens**：它硬编码 `{ stiffness: 150, damping: 15, mass: 0.6 }`；
 *    这里用 `preset.uiSpring` —— 设计系统哪天调弹簧参数，这里自动跟上，
 *    不制造第二个权威（见 `lib/motion.ts` 文件头）。
 * 2. **监听在静态外层，不在会动的按钮上**：Amicro 把 `mousemove` 绑在按钮自己
 *    身上，而指针在按钮外时按钮收不到任何 mousemove —— "隔着一点距离被吸过来"
 *    在它的实现里**永远不会发生**，实际效果只是 hover 内跟随。
 *    这里绑在外层（`.lp-magnetic` 带一圈透明触达区），指针进区的瞬间弹簧就起步。
 * 3. **幅度有上限**：吸偏量按指针偏移比例放大后**钳制**在几像素内 ——
 *    这是导航型落地页的 CTA，不是玩具；克制的标准是"注意到、说不清"。
 *
 * 🔴 位移（本组件）与按压缩放（`.lp-btn:active` 的 CSS scale）**分在两层元素**：
 * motion 的 `x`/`y` 会写内联 `transform`，若绑在 `.lp-btn` 自己身上，
 * `:active` 的 scale 永远被内联样式压住 —— 按下反馈会**无声消失**。
 * 与 `Hero.tsx` 文件头"入场与倾斜分两个元素"是同一条教训。
 *
 * 减动效下不接磁性（位移与前庭相关，且对理解内容毫无帮助，Apple §14：
 * 降级是"换成更温和的等价物"，按钮原有的 hover 变色仍然全在）。
 * 触控 / 粗指针设备也不接 —— 触屏上指针事件是"按下即点击"，
 * 没有可供吸附的连续悬停，白挂一对监听。
 */

import { useRef, useState } from 'react';
import { motion, useSpring } from 'motion/react';

import { useMotionPreset } from '../lib/motion.js';

/** 吸偏比例：指针相对按钮中心的偏移 × 这个系数 = 目标位移。 */
const PULL = 0.2;

/** 吸偏上限（px）。钳制把"磁性"压在克制的幅度里，见文件头第 3 条。 */
const MAX_SHIFT = 8;

export function Magnetic({ children }: { children: React.ReactNode }): React.JSX.Element {
  const preset = useMotionPreset();
  const frameRef = useRef<HTMLSpanElement>(null);

  // 挂载时判定一次即可：设备输入类别不会在一个会话中途变。
  // 🔴 matchMedia 必须守卫：jsdom（渲染测试）没有实现它，直接调用会抛。
  const [finePointer] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches,
  );

  const enabled = !preset.reduced && finePointer;

  const x = useSpring(0, preset.uiSpring);
  const y = useSpring(0, preset.uiSpring);

  function pullToward(event: React.PointerEvent<HTMLSpanElement>): void {
    const frame = frameRef.current;
    if (frame === null) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    // 先按比例放大、再按模长整体钳制 —— 两轴同缩，方向不失真。
    const pulled = Math.hypot(dx * PULL, dy * PULL);
    const scale = pulled > MAX_SHIFT ? MAX_SHIFT / pulled : 1;
    x.set(dx * PULL * scale);
    y.set(dy * PULL * scale);
  }

  function release(): void {
    // 弹簧从当前值回到 0 —— 中途再进来不会跳（Hero.tsx 同一条"可打断"）。
    x.set(0);
    y.set(0);
  }

  if (!enabled) {
    // 外层照常渲染：触达区的 padding 两种模式下占位一致，布局不许漂。
    return <span className="lp-magnetic">{children}</span>;
  }

  return (
    <motion.span
      ref={frameRef}
      className="lp-magnetic"
      style={{ x, y }}
      onPointerMove={pullToward}
      onPointerLeave={release}
    >
      {children}
    </motion.span>
  );
}
