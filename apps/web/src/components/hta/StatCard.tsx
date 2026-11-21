import type { ReactNode } from 'react';

import './hta.css';

export type StatTone = 'default' | 'warning' | 'success' | 'danger';

export interface StatCardProps {
  readonly label: ReactNode;
  readonly value: ReactNode;
  /** 可选趋势/补充行（负增长/占比等由宿主给内容与颜色语义）。 */
  readonly trend?: ReactNode;
  readonly tone?: StatTone;
  readonly testID?: string;
}

/** 单个指标卡。数字走 `tabular-nums`（增减时宽度不跳）。 */
export function StatCard({
  label,
  value,
  trend,
  tone = 'default',
  testID,
}: StatCardProps): React.JSX.Element {
  return (
    <div className={`hta-stat-card hta-stat-card--${tone}`} data-testid={testID}>
      <span className="hta-stat-card__value">{value}</span>
      <span className="hta-stat-card__label">{label}</span>
      {trend === undefined ? null : <span className="hta-stat-card__trend">{trend}</span>}
    </div>
  );
}

export interface MetricGridProps {
  readonly children: ReactNode;
  readonly testID?: string;
}

/** 多张统计卡的栅格：token 栅格 + 同行等高（grid 默认 stretch）。 */
export function MetricGrid({ children, testID }: MetricGridProps): React.JSX.Element {
  return (
    <div className="hta-metric-grid" data-testid={testID}>
      {children}
    </div>
  );
}
