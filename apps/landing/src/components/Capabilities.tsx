/**
 * 能力（bento 网格）
 * ===================
 *
 * 🔴 **格子数 = 内容数，一个不多一个不少。** 6 项能力 → 6 个格子。
 * 中间或末尾留一个空格子是最常见的 bento 错误：它读起来像"还没做完"。
 *
 * 🔴 **必须有节奏，不能全是"白底文字卡"。** 这里有三个格子带真实视觉：
 *   四象限（迷你矩阵） / 习惯（热力图条） / 番茄钟（进度环）——
 *   其余三格是纯文字，形成疏密对比。全白卡片的 bento 是 AI 默认产物。
 *
 * 版面（4 列）：
 *   ┌────────────┬────────────┐
 *   │  四象限     │  习惯       │   ← 四象限 2×2，习惯 2×1
 *   │  (2×2)     ├──────┬─────┤
 *   │            │ 番茄 │ AI  │
 *   ├────────────┴──────┴─────┤
 *   │  重复任务      │  离线   │   ← 各 2×1
 *   └───────────────┴─────────┘
 */

import { useMemo } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, CloudOff, Repeat, Sparkles, Zap } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

import { revealVariants, staggerContainer, useMotionPreset, VIEWPORT } from '../lib/motion.js';

/** 迷你四象限。用与真实界面同一套象限 token。 */
function MiniQuadrant(): React.JSX.Element {
  const { t } = useI18n();
  const cells = [
    { label: t('landing.quadrant.do'), swatch: 'mk-swatch--q1' },
    { label: t('landing.quadrant.plan'), swatch: 'mk-swatch--q2' },
    { label: t('landing.quadrant.delegate'), swatch: 'mk-swatch--q3' },
    { label: t('landing.quadrant.drop'), swatch: 'mk-swatch--q4' },
  ];
  return (
    <div className="lp-mini-quad" aria-hidden="true">
      {cells.map((cell) => (
        <div key={cell.label} className="lp-mini-quad__cell">
          <span className={`mk-swatch ${cell.swatch}`} />
          {cell.label}
        </div>
      ))}
    </div>
  );
}

/** 迷你热力图条：用与真实习惯视图同一套 heat token。 */
function MiniHeat(): React.JSX.Element {
  // 固定的档位序列（**不用随机** —— 随机会让每次刷新都不一样，看着像数据在跳）
  const levels = [0, 1, 2, 3, 2, 4, 1, 0, 2, 3, 4, 3, 1, 2, 0, 3, 4, 2, 1, 3, 0, 2, 4, 3];
  return (
    <div className="lp-mini-heat" aria-hidden="true">
      {levels.map((level, index) => (
        <span
          key={index}
          className={`mk-heat__cell${level > 0 ? ` mk-heat__cell--${String(level)}` : ''}`}
        />
      ))}
    </div>
  );
}

/** 迷你进度环：番茄钟。 */
function MiniRing(): React.JSX.Element {
  const size = 72;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = 0.62;

  return (
    <svg
      className="lp-mini-ring"
      width="4.5rem"
      height="4.5rem"
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      aria-hidden="true"
      style={{ transform: 'rotate(-90deg)' }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--ht-color-border)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--ht-color-focus-work)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
      />
    </svg>
  );
}

interface Capability {
  title: string;
  body: string;
  span: string;
  visual?: React.ReactNode;
  icon?: React.ReactNode;
}

export function Capabilities(): React.JSX.Element {
  const preset = useMotionPreset();
  const { t } = useI18n();

  // 数据挪进组件内是文案迁移的硬要求（模块级拿不到 `t`）。取舍见 `Landing.tsx` 文件头。
  const capabilities = useMemo<Capability[]>(
    () => [
      {
        title: t('landing.feature.quadrant'),
        body: t('landing.capabilities.quadrant.body'),
        span: 'lp-bento__cell--tall',
        visual: <MiniQuadrant />,
      },
      {
        title: t('landing.capabilities.habits.title'),
        body: t('landing.capabilities.habits.body'),
        span: 'lp-bento__cell--wide',
        visual: <MiniHeat />,
      },
      {
        title: t('landing.feature.focus'),
        body: t('landing.capabilities.focus.body'),
        span: '',
        visual: <MiniRing />,
      },
      {
        title: t('landing.capabilities.breakdown.title'),
        body: t('landing.capabilities.breakdown.body'),
        span: '',
        icon: <Sparkles size={18} />,
      },
      {
        title: t('landing.capabilities.repeat.title'),
        body: t('landing.capabilities.repeat.body'),
        span: 'lp-bento__cell--half',
        icon: <Repeat size={18} />,
      },
      {
        title: t('landing.capabilities.offline.title'),
        body: t('landing.capabilities.offline.body'),
        span: 'lp-bento__cell--half',
        icon: <CloudOff size={18} />,
      },
    ],
    [t],
  );

  return (
    <section className="lp-section" id="capabilities">
      <div className="lp-wrap">
        <motion.header
          className="lp-section__head"
          variants={revealVariants(preset.reduced, preset.ui)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
        >
          <h2 className="lp-h2">{t('landing.capabilities.title')}</h2>
          <p className="lp-section__lede">
            {t('landing.capabilities.lede')}
          </p>
        </motion.header>

        <motion.div
          className="lp-bento"
          variants={staggerContainer(preset.reduced)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
        >
          {capabilities.map((capability) => (
            <motion.article
              key={capability.title}
              className={`lp-bento__cell ${capability.span}`}
              variants={revealVariants(preset.reduced, preset.ui)}
            >
              {capability.visual !== undefined && (
                <div className="lp-bento__visual">{capability.visual}</div>
              )}

              <div className="lp-bento__body">
                <h3 className="lp-bento__title">
                  {capability.icon !== undefined && (
                    <span className="lp-bento__icon">{capability.icon}</span>
                  )}
                  {capability.title}
                </h3>
                <p className="lp-bento__text">{capability.body}</p>
              </div>
            </motion.article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/** 供其他区块复用的小图标组（避免各处重复 import 同一个集合）。 */
export const CapabilityIcons = { CheckCircle2, Zap };
