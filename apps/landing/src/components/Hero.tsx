import { ICON_SIZE } from '@heyta/design-system';
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

import { useMemo, useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { Check, WifiOff } from 'lucide-react';

import { useI18n } from '@heyta/i18n/provider';

import { AppWindow } from '../mockup/AppWindow.js';
import { Magnetic } from './Magnetic.js';
import {
  HERO_ENTRANCE_DELAY,
  maskedRevealVariants,
  revealVariants,
  staggerContainer,
  useMotionPreset,
  VIEWPORT,
} from '../lib/motion.js';

/** 倾斜幅度（度）。刻意小 —— 大角度会让界面文字变形到读不清。 */
const TILT_Y = 11;
const TILT_X = 8;

export function Hero(): React.JSX.Element {
  const preset = useMotionPreset();
  const { t } = useI18n();
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

  /**
   * 四个弹簧合成**一条** transform 字符串。
   *
   * AUDIT §5：`x`/`y`/`rotateX`/`rotateY` 这类简写会各写一次 style，
   * 目标是合成单条完整 transform —— 每帧只写一次，旋转顺序也显式可控。
   * 顺序必须是 translate → rotate：先平移再旋转，卡片才是"在原地转"；
   * 反过来平移会被旋转一起带偏。
   */
  const tilt = useTransform(
    [rotateX, rotateY, shiftX, shiftY],
    ([rx = 0, ry = 0, sx = 0, sy = 0]) =>
      `translate3d(${sx}px, ${sy}px, 0) rotateX(${rx}deg) rotateY(${ry}deg)`,
  );

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

  const copy = revealVariants(preset.reduced, preset.ui, '1rem');

  return (
    <section className="lp-hero" id="top">
      <motion.div
        className="lp-hero__copy"
        variants={staggerContainer(preset.reduced)}
        initial="hidden"
        animate="visible"
      >
        <motion.span className="lp-eyebrow" variants={copy}>
          {t('landing.hero.eyebrow')}
        </motion.span>

        {/*
          标题走遮罩式显现（maskedRevealVariants）：外层 h1 是裁剪槽，
          内层块从槽底升起 —— keynote 的"文字从缝里长出来"。
          h1 自身的 variants 是空壳，只为占住错峰序列的第二个节拍；
          视觉完全由内层承担（结构理由见 motion.ts 该函数的注释）。
        */}
        <motion.h1 className="lp-h1 lp-mask" variants={{ hidden: {}, visible: {} }}>
          <motion.span
            className="lp-mask__inner"
            variants={maskedRevealVariants(preset.reduced, preset.ui)}
          >
            {t('landing.hero.titleLead')}
            <em>{t('landing.hero.titleEmphasis')}</em>
          </motion.span>
        </motion.h1>

        <motion.p className="lp-lede" variants={copy}>
          {t('landing.hero.lede')}
        </motion.p>

        {/*
          主 CTA 指向界面、次 CTA 指向价格 —— 大众先问「好不好用」「多少钱」，
          不会先问「我怎么自建」。自建的入口留在 SelfHost 一节与底部，
          那是愿意往下读的人才到的地方（理由写在 i18n 的 hero 词条上）。
          磁性只给主 CTA：全页到处都"吸"就不是磁性了，是抖。
        */}
        <motion.div className="lp-hero__ctas" variants={copy}>
          <Magnetic>
            <a className="lp-btn lp-btn--primary lp-btn--lg" href="#showcase">
              {t('landing.hero.ctaShowcase')}
            </a>
          </Magnetic>
          <a className="lp-btn lp-btn--secondary lp-btn--lg" href="#pricing">
            {t('landing.hero.ctaPricing')}
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

        {/*
          🔴 入场与指针倾斜**必须分在两个元素上**。
          原来两者都绑在 `.lp-hero__card` 上：`style` 里给了 `y: shiftY`，
          而 `animate` 也想驱动 `y`。Motion 中 `style` 绑定的 MotionValue
          是该 key 的权威来源，于是入场的 `y: '2rem' → 0` **从未执行过** ——
          英雄卡本该"从下方升起"，实际只有淡入和放大，而且没有任何报错。
          拆开之后：外层只管入场，内层只管倾斜。
        */}
        <motion.div
          className="lp-hero__enter"
          initial={preset.reduced ? { opacity: 0 } : { opacity: 0, y: '2rem', scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...preset.sheet, delay: preset.reduced ? 0 : HERO_ENTRANCE_DELAY }}
        >
          <motion.div
            className="lp-hero__card"
            style={preset.reduced ? undefined : { transform: tilt }}
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
              <Check className="lp-float__icon--ok" size={ICON_SIZE.xs} aria-hidden="true" />
              {t('landing.hero.floatSynced')}
            </div>
            <div
              className="lp-float lp-float--offline"
              style={{ '--lp-float-z': '7rem' } as React.CSSProperties}
            >
              <WifiOff className="lp-float__icon--info" size={ICON_SIZE.xs} aria-hidden="true" />
              {t('landing.hero.floatOffline')}
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/**
 * 事实条。**刻意不是 logo 墙。**
 *
 * taste skill 要求信任区用真实素材而不是文字伪装 —— 但这个项目还没有
 * 任何客户或合作方，编一排 logo 就是造假。所以这里放的是**可核实的事实**，
 * 每一条都能在仓库里查到出处。
 *
 * 数据挪进组件内是文案迁移的硬要求（模块级拿不到 `t`）。取舍见 `Landing.tsx` 文件头。
 *
 * 🔴 选哪四条也是**受众排序**问题，不只是事实问题。这一条紧贴在首屏下面，
 * 所以放的是大众能用的理由（离线、不限设备、加密同步、一套数据）。
 * 「MIT 许可」和「一条命令自建」同样是可核实的事实，但它们只对开发者构成理由 ——
 * 那两条在 Footer 与 SelfHost，愿意读到那里的人才关心。
 */
export function Facts(): React.JSX.Element {
  const preset = useMotionPreset();
  const { t } = useI18n();

  const facts = useMemo(
    () => [
      {
        value: t('landing.facts.offline.value'),
        label: t('landing.facts.offline.label'),
      },
      {
        value: t('landing.facts.devices.value'),
        label: t('landing.facts.devices.label'),
      },
      {
        value: t('landing.facts.encrypted.value'),
        label: t('landing.facts.encrypted.label'),
      },
      {
        value: t('landing.facts.oneData.value'),
        label: t('landing.facts.oneData.label'),
      },
    ],
    [t],
  );

  return (
    <section className="lp-facts" aria-label={t('landing.facts.ariaLabel')}>
      <div className="lp-wrap">
        <motion.div
          className="lp-facts__grid"
          variants={staggerContainer(preset.reduced)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
        >
          {facts.map((fact) => (
            <motion.div key={fact.value} className="lp-fact" variants={revealVariants(preset.reduced, preset.ui)}>
              <span className="lp-fact__value">{fact.value}</span>
              <span className="lp-fact__label">{fact.label}</span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
