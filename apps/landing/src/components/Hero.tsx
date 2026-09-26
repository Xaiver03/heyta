/**
 * 英雄区
 * ========
 *
 * 版面：**非对称 5/7 分栏**（左文右景）。taste skill 的规则 ——
 * `DESIGN_VARIANCE > 4` 时避免居中英雄区；居中版会立刻读成"模板"。
 *
 * 3D 倾斜（本页第一处"炫酷"）：
 *   用指针位置驱动 `rotateX` / `rotateY`，**X 与 Y 各用一个独立弹簧**。
 *   依据 Apple《Designing Fluid Interfaces》§3：二维运动必须拆成两个独立弹簧 ——
 *   用一个"到目标的二维距离"弹簧，在 X 与 Y 速度不同时两轴会失步。
 *
 *   松手（指针离开）时**从当前值弹回中心**，而不是跳回 ——
 *   这就是"可打断"：指针还在动的时候再进来，弹簧从当前位置重新起步，
 *   不会有可见的跳变。CSS transition 做不到这件事（它只能等上一段跑完）。
 *
 * `prefers-reduced-motion` 下**完全不接倾斜**：位移与前庭不适直接相关，
 * 而且倾斜对理解内容没有任何帮助（Apple §14：减动效是"换成更温和的等价物"，
 * 不是"什么都不动"—— 所以入场淡入仍然保留）。
 */

import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { Check, Github, WifiOff } from 'lucide-react';

import { AppWindow } from '../mockup/AppWindow.js';
import { revealVariants, staggerContainer, useMotionPreset, VIEWPORT } from '../lib/motion.js';
import { GITHUB_URL } from './Nav.js';

/** 倾斜幅度（度）。刻意小 —— 大角度会让界面文字变形到读不清。 */
const TILT_Y = 11;
const TILT_X = 8;

export function Hero(): React.JSX.Element {
  const preset = useMotionPreset();
  const stageRef = useRef<HTMLDivElement>(null);

  // 0..1 的归一化指针位置，初始在正中
  const pointerX = useMotionValue(0.5);
  const pointerY = useMotionValue(0.5);

  // X / Y 各自独立弹簧（见文件头）
  const rotateY = useSpring(
    useTransform(pointerX, [0, 1], [TILT_Y, -TILT_Y]),
    preset.uiSpring,
  );
  const rotateX = useSpring(
    useTransform(pointerY, [0, 1], [-TILT_X, TILT_X]),
    preset.uiSpring,
  );
  // 整卡轻微平移，让"它是浮着的"更可信（Apple §8：中间帧要指向结果）
  const shiftX = useSpring(useTransform(pointerX, [0, 1], [-12, 12]), preset.uiSpring);
  const shiftY = useSpring(useTransform(pointerY, [0, 1], [-8, 8]), preset.uiSpring);

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (preset.reduced) return;
    const stage = stageRef.current;
    if (stage === null) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    pointerX.set((event.clientX - rect.left) / rect.width);
    pointerY.set((event.clientY - rect.top) / rect.height);
  }

  function handlePointerLeave(): void {
    if (preset.reduced) return;
    // 弹回中心 —— 从**当前值**起步，所以中途再进来也不会跳（Apple §3）
    pointerX.set(0.5);
    pointerY.set(0.5);
  }

  const copy = revealVariants(preset.reduced, '1rem');

  return (
    <section className="lp-hero" id="top">
      <motion.div
        className="lp-hero__copy"
        variants={staggerContainer(preset.reduced, 0.08)}
        initial="hidden"
        animate="visible"
      >
        <motion.span className="lp-eyebrow" variants={copy}>
          本地优先 · 端到端加密 · 可自建
        </motion.span>

        <motion.h1 className="lp-h1" variants={copy}>
          任务管理，<em>数据归你</em>
        </motion.h1>

        <motion.p className="lp-lede" variants={copy}>
          数据先落本地，服务端看不到明文；也可以完全跑在你自己的服务器上。
        </motion.p>

        <motion.div className="lp-hero__ctas" variants={copy}>
          <a className="lp-btn lp-btn--primary lp-btn--lg" href="#selfhost">
            开始自建
          </a>
          <a className="lp-btn lp-btn--secondary lp-btn--lg" href="#showcase">
            看看真实界面
          </a>
        </motion.div>
      </motion.div>

      <div
        ref={stageRef}
        className="lp-hero__stage"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <div className="lp-hero__glow" aria-hidden="true" />

        <motion.div
          className="lp-hero__card"
          style={
            preset.reduced
              ? undefined
              : { rotateX, rotateY, x: shiftX, y: shiftY }
          }
          initial={preset.reduced ? { opacity: 0 } : { opacity: 0, y: '2rem', scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...preset.sheet, delay: preset.reduced ? 0 : 0.12 }}
        >
          {/* 真实界面的复现。见 mockup/ 的文件头：这是复现，不是应用本身。 */}
          <AppWindow view="tasks" />

          {/*
            两片浮层。它们给 3D 纵深提供**参照物** ——
            一张平卡旋转时读不出深度，有了不同 Z 值的浮片，纵深立刻可见。
          */}
          <div
            className="lp-float lp-float--sync"
            style={{ '--lp-float-z': '4rem' } as React.CSSProperties}
          >
            <Check className="lp-float__icon--ok" size={14} aria-hidden="true" />
            已同步到 3 台设备
          </div>
          <div
            className="lp-float lp-float--offline"
            style={{ '--lp-float-z': '7rem' } as React.CSSProperties}
          >
            <WifiOff className="lp-float__icon--info" size={14} aria-hidden="true" />
            离线照常可用
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/** 供 CTA 区块复用，避免两处各写一遍仓库地址。 */
export const REPO_URL = GITHUB_URL;

/**
 * 事实条。**刻意不是 logo 墙。**
 *
 * taste skill 要求信任区用真实素材而不是文字伪装 —— 但这个项目还没有
 * 任何客户或合作方，编一排 logo 就是造假。所以这里放的是**可核实的事实**，
 * 每一条都能在仓库里查到出处。
 */
const FACTS = [
  {
    value: '本地',
    label: '数据先写本机，云端只是同步通道，不是事实源',
  },
  {
    value: '密文',
    label: '加密在客户端完成，服务端强制校验且没有开关可关',
  },
  {
    value: 'MIT',
    label: '许可证宽松，全部第三方依赖逐项登记、可审计',
  },
  {
    value: '自建',
    label: '一条命令起自己的服务端，不用把数据交给别人',
  },
];

export function Facts(): React.JSX.Element {
  const preset = useMotionPreset();

  return (
    <section className="lp-facts" aria-label="产品事实">
      <div className="lp-wrap">
        <motion.div
          className="lp-facts__grid"
          variants={staggerContainer(preset.reduced, 0.07)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
        >
          {FACTS.map((fact) => (
            <motion.div key={fact.value} className="lp-fact" variants={revealVariants(preset.reduced)}>
              <span className="lp-fact__value">{fact.value}</span>
              <span className="lp-fact__label">{fact.label}</span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
