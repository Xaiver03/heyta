/**
 * 进度横条 —— 激励体系里**唯一**一处横条实现
 * ==============================================
 *
 * 抽出来的理由不是"少写几行"，而是把一条**容易做错的规则**收敛到一个地方：
 *
 * 🔴 **首次渲染不播动画，只有挂载后的变化才播。**
 * Apple 的物理动效是对"用户刚才做了某事"的回应。页面刚打开时用户什么都没做，
 * 此刻横条从 0 长到 60% 是在演一个不存在的操作，它会让"我刚点了什么"变模糊 ——
 * 而这个错误**在截图里完全看不出来**，只有真的盯着看才会发现。
 *
 * 如果每个用到横条的组件各写一遍，这条规则一定会在某一份里漏掉。
 *
 * 🔴 **动 `transform: scaleX`，不动 `width`。**
 * 宽度动画每帧触发布局与重绘，`transform` 只走合成。取值为 0–1 的比例，
 * 正好是 `scaleX` 的定义域，所以这里不需要换算成百分比。
 *
 * ⚠️ `prefers-reduced-motion` 由 tokens.css 统一降级（`--ht-duration-*` → 1ms），
 * 本组件不重复写 media query —— 第二条降级策略就是第二个事实源。
 */

import { useEffect, useState } from 'react';

import { text } from '../../lib/text.js';

export interface ProgressBarProps {
  /** 0–1。超出范围会被夹住 —— 依赖调用方先夹是不可靠的。 */
  ratio: number;
  /** 读屏用的一句话。**必填**：一根没有名字的横条对读屏用户等于不存在。 */
  label: string;
  tone?: 'primary' | 'success' | 'muted';
  /** 数值的可见文本（如 "3/5"）。给了就显示在横条右侧。 */
  valueText?: string;
}

export function ProgressBar({ ratio, label, tone = 'primary', valueText }: ProgressBarProps) {
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    // 空依赖：只在挂载后跑一次。它之后的所有变化才会带上过渡。
    setAnimated(true);
  }, []);

  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  const percent = Math.round(clamped * 100);

  return (
    <div className="ht-bar">
      <div
        className="ht-bar__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={label}
      >
        <div
          className={`ht-bar__fill ht-bar__fill--${tone}${animated ? ' ht-bar__fill--animated' : ''}`}
          style={{ transform: `scaleX(${String(clamped)})` }}
        />
      </div>
      {valueText !== undefined && (
        <span className="ht-bar__value" style={text('caption')}>
          {valueText}
        </span>
      )}
    </div>
  );
}