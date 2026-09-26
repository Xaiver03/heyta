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

import { motion } from 'motion/react';
import { CheckCircle2, CloudOff, Repeat, Sparkles, Zap } from 'lucide-react';

import { revealVariants, staggerContainer, useMotionPreset, VIEWPORT } from '../lib/motion.js';

/** 迷你四象限。用与真实界面同一套象限 token。 */
function MiniQuadrant(): React.JSX.Element {
  const cells = [
    { label: '马上做', swatch: 'mk-swatch--q1' },
    { label: '计划做', swatch: 'mk-swatch--q2' },
    { label: '交给别人', swatch: 'mk-swatch--q3' },
    { label: '先不做', swatch: 'mk-swatch--q4' },
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

const CAPABILITIES: Capability[] = [
  {
    title: '四象限',
    body: '重要与紧急拆成两轴，任务拖进哪一格就归哪一类。紧急程度由截止时间推导，不由你手填。',
    span: 'lp-bento__cell--tall',
    visual: <MiniQuadrant />,
  },
  {
    title: '习惯打卡',
    body: '热力图只用一个色阶的深浅表达强度，不靠颜色区分档位，色觉差异下一样读得出来。',
    span: 'lp-bento__cell--wide',
    visual: <MiniHeat />,
  },
  {
    title: '番茄钟',
    body: '专注会话记进本地日志，和任务关联。',
    span: '',
    visual: <MiniRing />,
  },
  {
    title: '智能拆解',
    body: '一句话拆成可执行清单。可用自己的密钥，也可整条关掉。',
    span: '',
    icon: <Sparkles size={18} />,
  },
  {
    title: '重复任务',
    body: '按规则顺延：勾掉这一轮，下一轮自动出现，跨设备结果一致。',
    span: 'lp-bento__cell--half',
    icon: <Repeat size={18} />,
  },
  {
    title: '离线可用',
    body: '断网照常读写。恢复连接后自动补传，冲突交给你判断而不是替你选。',
    span: 'lp-bento__cell--half',
    icon: <CloudOff size={18} />,
  },
];

export function Capabilities(): React.JSX.Element {
  const preset = useMotionPreset();

  return (
    <section className="lp-section" id="capabilities">
      <div className="lp-wrap">
        <motion.header
          className="lp-section__head"
          variants={revealVariants(preset.reduced)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
        >
          <h2 className="lp-h2">订阅制把六件事打包卖，我们把它拆开重做</h2>
          <p className="lp-section__lede">
            清单、日历、四象限、习惯打卡、番茄钟、重复任务。每一块都有成熟做法，
            难的是让它们共用同一份数据、同一套同步规则。
          </p>
        </motion.header>

        <motion.div
          className="lp-bento"
          variants={staggerContainer(preset.reduced, 0.06)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
        >
          {CAPABILITIES.map((capability) => (
            <motion.article
              key={capability.title}
              className={`lp-bento__cell ${capability.span}`}
              variants={revealVariants(preset.reduced)}
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
