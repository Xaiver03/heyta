/**
 * heyta 自有线性图标（基于 MOSS 候选形状重绘成 SVG）。
 *
 * 为什么自己画而不是继续用 Lucide：产品负责人要求"一套完全属于我们自己的 icon"。
 * 形状参考本机 ComfyUI/MOSS 的候选（`.local/icon-gen/20261120/`），但**按 24px 网格、
 * 统一 2px 描边、圆角端点重绘**——MOSS 出的是白底无透明的位图、线宽有微抖，不能直接投产。
 *
 * 约定：每个组件吃 `{ size, strokeWidth, color }`，与 `icons.tsx` 里 lucide 组件同形，
 * 于是可以进同一张 `ICONS` 映射表、走同一个 `<Icon/>`。
 */
import React from 'react';
import { Circle, Ellipse, Line, Path, Rect, Svg } from 'react-native-svg';

interface GlyphProps {
  readonly size?: number;
  readonly strokeWidth?: number;
  readonly color?: string;
}

function Base({
  size = 24,
  strokeWidth = 2,
  color = '#334155',
  children,
}: GlyphProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

/** 任务：圆角方框 + 对勾。 */
export function TaskCheckGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Rect x="4" y="4" width="16" height="16" rx="4.2" />
      <Path d="M8.3 12.3 10.8 14.8 15.8 9.2" />
    </Base>
  );
}

/** 日历：圆角框 + 两只吊环 + 中间格线。 */
export function CalendarGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <Line x1="8" y1="2.8" x2="8" y2="6.4" />
      <Line x1="16" y1="2.8" x2="16" y2="6.4" />
      <Line x1="3.5" y1="10" x2="20.5" y2="10" />
      <Line x1="8" y1="13.5" x2="8" y2="17" />
      <Line x1="12" y1="13.5" x2="12" y2="17" />
      <Line x1="16" y1="13.5" x2="16" y2="17" />
    </Base>
  );
}

/** 专注：秒表（圆 + 指针 + 顶钮）。 */
export function TimerGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Circle cx="12" cy="13.5" r="8" />
      <Line x1="12" y1="2.8" x2="12" y2="5.5" />
      <Line x1="9.5" y1="3.2" x2="14.5" y2="3.2" />
      <Line x1="12" y1="13.5" x2="12" y2="9.5" />
      <Line x1="12" y1="13.5" x2="15" y2="14.8" />
    </Base>
  );
}

/** AI：四角星 + 小星。 */
export function AiSparkGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M11 4c.5 4 1.8 5.3 5.8 5.8-4 .5-5.3 1.8-5.8 5.8-.5-4-1.8-5.3-5.8-5.8C9.2 9.3 10.5 8 11 4Z" />
      <Path d="M18 13.5c.25 2 .9 2.65 2.9 2.9-2 .25-2.65.9-2.9 2.9-.25-2-.9-2.65-2.9-2.9 2-.25 2.65-.9 2.9-2.9Z" />
    </Base>
  );
}

/** 我的：圆内头肩像。 */
export function PersonGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Circle cx="12" cy="12" r="9" />
      <Circle cx="12" cy="9.6" r="3" />
      <Path d="M6.3 19.2c.7-3 3-4.7 5.7-4.7s5 1.7 5.7 4.7" />
    </Base>
  );
}

/** 搜索：放大镜（单描边）。 */
export function SearchGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Circle cx="10.8" cy="10.8" r="6.2" />
      <Line x1="15.3" y1="15.3" x2="20" y2="20" />
    </Base>
  );
}

/** 新增：圆角方框 + 加号。 */
export function AddGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Rect x="4" y="4" width="16" height="16" rx="4.2" />
      <Line x1="12" y1="8.4" x2="12" y2="15.6" />
      <Line x1="8.4" y1="12" x2="15.6" y2="12" />
    </Base>
  );
}

/** 更多：三个空心圆点。 */
export function MoreGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Circle cx="5.5" cy="12" r="1.7" />
      <Circle cx="12" cy="12" r="1.7" />
      <Circle cx="18.5" cy="12" r="1.7" />
    </Base>
  );
}

/* ── 第二批：高频动作图标（自绘，24 网格 / 2px / 圆角端点） ── */

/** AI 助手标记：原子/轨道（非星芒、非机器人、非气泡）。 */
export function AiMarkGlyph(props: GlyphProps): React.JSX.Element {
  const c = props.color ?? '#334155';
  return (
    <Base {...props}>
      <Ellipse cx="12" cy="12" rx="9" ry="3.7" transform="rotate(-32 12 12)" />
      <Circle cx="12" cy="12" r="2" fill={c} stroke="none" />
    </Base>
  );
}

/** 返回（左尖括号）。 */
export function BackGlyph(props: GlyphProps): React.JSX.Element {
  return (<Base {...props}><Path d="M15 5 8 12 15 19" /></Base>);
}
/** 关闭（叉）。 */
export function CloseGlyph(props: GlyphProps): React.JSX.Element {
  return (<Base {...props}><Path d="M6 6 18 18M18 6 6 18" /></Base>);
}
/** 展开（下尖）。 */
export function ChevronDownGlyph(props: GlyphProps): React.JSX.Element {
  return (<Base {...props}><Path d="M6 9.5 12 15.5 18 9.5" /></Base>);
}
/** 收起（上尖）。 */
export function ChevronUpGlyph(props: GlyphProps): React.JSX.Element {
  return (<Base {...props}><Path d="M6 14.5 12 8.5 18 14.5" /></Base>);
}
/** 加号。 */
export function PlusGlyph(props: GlyphProps): React.JSX.Element {
  return (<Base {...props}><Line x1="12" y1="5" x2="12" y2="19" /><Line x1="5" y1="12" x2="19" y2="12" /></Base>);
}
/** 勾。 */
export function CheckGlyph(props: GlyphProps): React.JSX.Element {
  return (<Base {...props}><Path d="M5 12.5 10 17.5 19 6.5" /></Base>);
}
/** 垃圾桶。 */
export function TrashGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Line x1="4" y1="7" x2="20" y2="7" />
      <Path d="M6.5 7 7.4 19.2h9.2L17.5 7" />
      <Path d="M9 7V4.6h6V7" />
      <Line x1="10.2" y1="11" x2="10.2" y2="16.5" />
      <Line x1="13.8" y1="11" x2="13.8" y2="16.5" />
    </Base>
  );
}
/** 同步（双箭头环）。 */
export function SyncGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M4 12a8 8 0 0 1 13.4-5.9L20 8.5" />
      <Path d="M20 4.2V9h-4.8" />
      <Path d="M20 12a8 8 0 0 1-13.4 5.9L4 15.5" />
      <Path d="M4 19.8V15h4.8" />
    </Base>
  );
}
/** 文件夹。 */
export function FolderGlyph(props: GlyphProps): React.JSX.Element {
  return (<Base {...props}><Path d="M3 7.2a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></Base>);
}
