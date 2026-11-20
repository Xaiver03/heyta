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

/* ── 第三批：替换剩余 55 个 lucide 图标（自绘，24 网格 / 2px / 圆角端点） ── */

/** 柱状图：基线 + 三根递增竖条。 */
export function ChartColumnGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Line x1="4" y1="20" x2="20" y2="20" />
      <Line x1="6.5" y1="20" x2="6.5" y2="14" />
      <Line x1="12" y1="20" x2="12" y2="9" />
      <Line x1="17.5" y1="20" x2="17.5" y2="4.5" />
    </Base>
  );
}

/** 火苗：外焰 + 内焰。 */
export function FlameGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M12 3c2.6 3 5 5.2 5 8.8a5 5 0 0 1-10 0C7 8.4 9.6 6 12 3Z" />
      <Path d="M12 12.2c1 1.2 2 2.1 2 3.5a2 2 0 0 1-4 0c0-1.4 1-2.3 2-3.5Z" />
    </Base>
  );
}

/** 日历 + 时钟：任务截止。 */
export function CalendarClockGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M21 11V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" />
      <Line x1="8" y1="2.6" x2="8" y2="6" />
      <Line x1="16" y1="2.6" x2="16" y2="6" />
      <Line x1="3" y1="9.6" x2="21" y2="9.6" />
      <Circle cx="17.5" cy="16.5" r="4.2" />
      <Path d="M17.5 14.4v2.4l1.7 1" />
    </Base>
  );
}

/** 回形针。 */
export function PaperclipGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7" />
    </Base>
  );
}

/** 图片 + 加号。 */
export function ImagePlusGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M17.5 12V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8" />
      <Circle cx="8.5" cy="9.2" r="1.5" />
      <Path d="m3.4 17.4 4.6-4.6 3.5 3.5" />
      <Line x1="17.5" y1="15" x2="17.5" y2="21" />
      <Line x1="14.5" y1="18" x2="20.5" y2="18" />
    </Base>
  );
}

/** 三角警告：三角 + 感叹号。 */
export function TriangleAlertGlyph(props: GlyphProps): React.JSX.Element {
  const c = props.color ?? '#334155';
  return (
    <Base {...props}>
      <Path d="M10.3 4.4 2.8 17.5a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z" />
      <Line x1="12" y1="9.6" x2="12" y2="14" />
      <Circle cx="12" cy="17" r="0.95" fill={c} stroke="none" />
    </Base>
  );
}

/** 循环：两个首尾相接的箭头。 */
export function RepeatGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M17 2.6 20.4 6 17 9.4" />
      <Path d="M3.6 11V9.5A3.5 3.5 0 0 1 7.1 6h13" />
      <Path d="M7 21.4 3.6 18 7 14.6" />
      <Path d="M20.4 13v1.5A3.5 3.5 0 0 1 16.9 18h-13" />
    </Base>
  );
}

/** 逆时针圆圈箭头（取消完成）。 */
export function RotateCcwGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M3.6 12a8.4 8.4 0 1 0 2.6-6.1L3.6 8.4" />
      <Path d="M3.6 3.7v4.7h4.7" />
    </Base>
  );
}

/** 铃铛。 */
export function BellGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M6 8.5a6 6 0 0 1 12 0c0 6 2.2 7.8 2.2 7.8H3.8S6 14.5 6 8.5Z" />
      <Path d="M10.2 19.6a2 2 0 0 0 3.6 0" />
    </Base>
  );
}

/** 旗标（优先级 / 标记）。 */
export function FlagGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Line x1="5" y1="3" x2="5" y2="21" />
      <Path d="M5 4.3c4-2 8 2 12 0v8.4c-4 2-8-2-12 0Z" />
    </Base>
  );
}

/** 右上箭头（打开）。 */
export function ArrowUpRightGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M7 17 17 7" />
      <Path d="M9 7h8v8" />
    </Base>
  );
}

/** 图钉。 */
export function PinGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Line x1="12" y1="16" x2="12" y2="21.5" />
      <Path d="M9.6 7h4.8v5l2 4H7.6l2-4Z" />
      <Line x1="8" y1="7" x2="16" y2="7" />
    </Base>
  );
}

/** 拔掉图钉（图钉 + 斜杠）。 */
export function PinOffGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Line x1="3" y1="3" x2="21" y2="21" />
      <Line x1="12" y1="16" x2="12" y2="21.5" />
      <Path d="M9.6 7h4.8v5l2 4H7.6l2-4Z" />
      <Line x1="8" y1="7" x2="16" y2="7" />
    </Base>
  );
}

/** 归档盒。 */
export function ArchiveGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Rect x="3" y="4" width="18" height="4.5" rx="1.4" />
      <Path d="M4.5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V8.5" />
      <Line x1="10" y1="12.5" x2="14" y2="12.5" />
    </Base>
  );
}

/** 归档还原（盒子里向上的箭头）。 */
export function ArchiveRestoreGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Rect x="3" y="4" width="18" height="4.5" rx="1.4" />
      <Path d="M4.5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V8.5" />
      <Line x1="12" y1="16.5" x2="12" y2="11.5" />
      <Path d="M9.6 13.6 12 11.2 14.4 13.6" />
    </Base>
  );
}

/** 方框里打勾（多选）。 */
export function SquareCheckGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Rect x="3.5" y="3.5" width="17" height="17" rx="3.4" />
      <Path d="M8 12.2 10.8 15 16.2 9.4" />
    </Base>
  );
}

/** 标签。 */
export function TagGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M3.5 4.5a1 1 0 0 1 1-1h7.2a2 2 0 0 1 1.4.6l7.8 7.8a2 2 0 0 1 0 2.8l-6.1 6.1a2 2 0 0 1-2.8 0L4.1 12.9a2 2 0 0 1-.6-1.4Z" />
      <Circle cx="7.9" cy="7.9" r="1.3" />
    </Base>
  );
}

/** 便签（右上折角 + 两条横线）。 */
export function StickyNoteGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H14l6 5.5v11A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5Z" />
      <Path d="M14 3v6h6" />
      <Line x1="8" y1="13" x2="15" y2="13" />
      <Line x1="8" y1="16.5" x2="13" y2="16.5" />
    </Base>
  );
}

/** 带勾的清单（今天）。 */
export function ListTodoGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M3 6.2 4.4 7.6 6.8 4.6" />
      <Line x1="10" y1="6.2" x2="20.5" y2="6.2" />
      <Line x1="3" y1="12" x2="6.2" y2="12" />
      <Line x1="10" y1="12" x2="20.5" y2="12" />
      <Line x1="3" y1="17.8" x2="6.2" y2="17.8" />
      <Line x1="10" y1="17.8" x2="20.5" y2="17.8" />
    </Base>
  );
}

/** 收件盘（收集箱）。 */
export function InboxGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M3 12h4.5l1.6 2.6h5.8L16.5 12H21" />
      <Path d="M5.4 5.2 3 12v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5l-2.4-6.8A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.9 1.2Z" />
    </Base>
  );
}

/** 带勾的大圆（已完成）。 */
export function CircleCheckBigGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M8 12.2 10.8 15 16 9.2" />
    </Base>
  );
}

/** 手机。 */
export function SmartphoneGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
      <Line x1="11" y1="18.3" x2="13" y2="18.3" />
    </Base>
  );
}

/** 显示器。 */
export function MonitorGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Rect x="2.5" y="4" width="19" height="13" rx="2.2" />
      <Line x1="8" y1="21" x2="16" y2="21" />
      <Line x1="12" y1="17" x2="12" y2="21" />
    </Base>
  );
}

/** 同心圆靶心（专注）。 */
export function TargetGlyph(props: GlyphProps): React.JSX.Element {
  const c = props.color ?? '#334155';
  return (
    <Base {...props}>
      <Circle cx="12" cy="12" r="9" />
      <Circle cx="12" cy="12" r="5" />
      <Circle cx="12" cy="12" r="1.4" fill={c} stroke="none" />
    </Base>
  );
}

/** 咖啡杯（休息）。 */
export function CoffeeGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M17 8.5h1.2a3 3 0 0 1 0 6H17" />
      <Path d="M3.5 8.5h13.5V15a4.5 4.5 0 0 1-4.5 4.5H8A4.5 4.5 0 0 1 3.5 15Z" />
      <Line x1="3" y1="21.5" x2="21" y2="21.5" />
      <Path d="M7.3 2.5c-.5.7-.5 1.5 0 2.2M11.3 2.5c-.5.7-.5 1.5 0 2.2" />
    </Base>
  );
}

/** 播放（实心三角）。 */
export function PlayGlyph(props: GlyphProps): React.JSX.Element {
  const c = props.color ?? '#334155';
  return (
    <Base {...props}>
      <Path d="M7 4.6 19 12 7 19.4Z" fill={c} stroke="none" />
    </Base>
  );
}

/** 暂停（两条竖条）。 */
export function PauseGlyph(props: GlyphProps): React.JSX.Element {
  const c = props.color ?? '#334155';
  return (
    <Base {...props}>
      <Rect x="7" y="4.5" width="3.6" height="15" rx="1.2" fill={c} stroke="none" />
      <Rect x="13.4" y="4.5" width="3.6" height="15" rx="1.2" fill={c} stroke="none" />
    </Base>
  );
}

/** 停止（实心方）。 */
export function SquareGlyph(props: GlyphProps): React.JSX.Element {
  const c = props.color ?? '#334155';
  return (
    <Base {...props}>
      <Rect x="4.6" y="4.6" width="14.8" height="14.8" rx="2.6" fill={c} stroke="none" />
    </Base>
  );
}

/** 链接（链条）。 */
export function Link2Glyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M9.4 14.6 14.6 9.4" />
      <Path d="M11 6.8 12.9 4.9a3.8 3.8 0 0 1 5.4 5.4l-1.9 1.9" />
      <Path d="M13 17.2l-1.9 1.9a3.8 3.8 0 0 1-5.4-5.4l1.9-1.9" />
    </Base>
  );
}

/** 扳手（工具箱）。 */
export function WrenchGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M14.7 5.1a4.5 4.5 0 0 0-4.4 7.5l-6.2 6.2a2 2 0 1 0 2.8 2.8l6.2-6.2a4.5 4.5 0 0 0 7.5-4.4l-2.8 2.8-2.3-.4-.4-2.3Z" />
    </Base>
  );
}

/** 右尖（点进去还有一层）。 */
export function ChevronRightGlyph(props: GlyphProps): React.JSX.Element {
  return (<Base {...props}><Path d="M9 5 16 12 9 19" /></Base>);
}

/** 日历 + 日期点。 */
export function CalendarDaysGlyph(props: GlyphProps): React.JSX.Element {
  const c = props.color ?? '#334155';
  return (
    <Base {...props}>
      <Rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <Line x1="8" y1="2.8" x2="8" y2="6.4" />
      <Line x1="16" y1="2.8" x2="16" y2="6.4" />
      <Line x1="3.5" y1="10" x2="20.5" y2="10" />
      <Circle cx="8.3" cy="13.6" r="0.9" fill={c} stroke="none" />
      <Circle cx="12" cy="13.6" r="0.9" fill={c} stroke="none" />
      <Circle cx="15.7" cy="13.6" r="0.9" fill={c} stroke="none" />
      <Circle cx="8.3" cy="17.1" r="0.9" fill={c} stroke="none" />
      <Circle cx="12" cy="17.1" r="0.9" fill={c} stroke="none" />
    </Base>
  );
}

/** 日历 + 区间箭头（周 / 范围）。 */
export function CalendarRangeGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <Line x1="8" y1="2.8" x2="8" y2="6.4" />
      <Line x1="16" y1="2.8" x2="16" y2="6.4" />
      <Line x1="3.5" y1="10" x2="20.5" y2="10" />
      <Line x1="7.4" y1="14.8" x2="16.6" y2="14.8" />
      <Path d="M9.4 12.8 7.4 14.8 9.4 16.8" />
      <Path d="M14.6 12.8 16.6 14.8 14.6 16.8" />
    </Base>
  );
}

/** 九宫格。 */
export function LayoutGridGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Rect x="3.5" y="3.5" width="4.5" height="4.5" rx="1" />
      <Rect x="9.75" y="3.5" width="4.5" height="4.5" rx="1" />
      <Rect x="16" y="3.5" width="4.5" height="4.5" rx="1" />
      <Rect x="3.5" y="9.75" width="4.5" height="4.5" rx="1" />
      <Rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1" />
      <Rect x="16" y="9.75" width="4.5" height="4.5" rx="1" />
      <Rect x="3.5" y="16" width="4.5" height="4.5" rx="1" />
      <Rect x="9.75" y="16" width="4.5" height="4.5" rx="1" />
      <Rect x="16" y="16" width="4.5" height="4.5" rx="1" />
    </Base>
  );
}

/** 齿轮（设置）。 */
export function SettingsGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Circle cx="12" cy="12" r="3.4" />
      <Circle cx="12" cy="12" r="7" />
      <Line x1="19" y1="12" x2="21.2" y2="12" />
      <Line x1="16.95" y1="16.95" x2="18.5" y2="18.5" />
      <Line x1="12" y1="19" x2="12" y2="21.2" />
      <Line x1="7.05" y1="16.95" x2="5.5" y2="18.5" />
      <Line x1="5" y1="12" x2="2.8" y2="12" />
      <Line x1="7.05" y1="7.05" x2="5.5" y2="5.5" />
      <Line x1="12" y1="5" x2="12" y2="2.8" />
      <Line x1="16.95" y1="7.05" x2="18.5" y2="5.5" />
    </Base>
  );
}

/** 纸飞机（发送）。 */
export function SendGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M21.5 2.5 11 13" />
      <Path d="M21.5 2.5 14.5 21.5l-3.5-8.5L2.5 9.5Z" />
    </Base>
  );
}

/** 上下箭头（排序）。 */
export function ArrowUpDownGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M7 20V4" />
      <Path d="M4 7 7 4 10 7" />
      <Path d="M17 4v16" />
      <Path d="M14 17 17 20 20 17" />
    </Base>
  );
}

/** 皇冠（订阅 / 权益）。 */
export function CrownGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M4.5 18 3.2 6.5l4.9 4L12 4l3.9 6.5 4.9-4L19.5 18Z" />
      <Line x1="5" y1="21" x2="19" y2="21" />
    </Base>
  );
}

/** 圆圈里一个 i（信息）。 */
export function InfoGlyph(props: GlyphProps): React.JSX.Element {
  const c = props.color ?? '#334155';
  return (
    <Base {...props}>
      <Circle cx="12" cy="12" r="9" />
      <Line x1="12" y1="11" x2="12" y2="16.5" />
      <Circle cx="12" cy="7.6" r="0.95" fill={c} stroke="none" />
    </Base>
  );
}

/** 三个节点连线（分享）。 */
export function Share2Glyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Circle cx="18" cy="5.5" r="2.6" />
      <Circle cx="6" cy="12" r="2.6" />
      <Circle cx="18" cy="18.5" r="2.6" />
      <Line x1="8.3" y1="10.8" x2="15.7" y2="6.7" />
      <Line x1="8.3" y1="13.2" x2="15.7" y2="17.3" />
    </Base>
  );
}

/** 铅笔（改名）。 */
export function PencilGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z" />
      <Line x1="14.5" y1="6.5" x2="17.5" y2="9.5" />
    </Base>
  );
}

/** 奖杯（里程碑）。 */
export function TrophyGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M7.5 4.5h9V9a4.5 4.5 0 0 1-9 0Z" />
      <Path d="M7.5 5.5H4.6a3 3 0 0 0 3.3 3.2" />
      <Path d="M16.5 5.5h2.9a3 3 0 0 1-3.3 3.2" />
      <Line x1="12" y1="13.5" x2="12" y2="17.5" />
      <Line x1="9" y1="20.5" x2="15" y2="20.5" />
      <Path d="M9.6 17.5h4.8l.6 3h-6Z" />
    </Base>
  );
}

/** 徽章 + 勾（身份）。 */
export function BadgeCheckGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M8.4 3.5h7.2l4.9 4.9v7.2l-4.9 4.9H8.4L3.5 15.6V8.4Z" />
      <Path d="M8.6 12.2 11 14.6 15.6 9.4" />
    </Base>
  );
}

/** 两份重叠（复制）。 */
export function CopyGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Rect x="8.5" y="8.5" width="12" height="12" rx="2.4" />
      <Path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    </Base>
  );
}

/** 盾牌 + 勾（隐私同意）。 */
export function ShieldCheckGlyph(props: GlyphProps): React.JSX.Element {
  return (
    <Base {...props}>
      <Path d="M12 2.8 4.5 5.8v5.4c0 4.6 3 8.3 7.5 10 4.5-1.7 7.5-5.4 7.5-10V5.8Z" />
      <Path d="M8.7 11.8 11 14.1 15.4 9.7" />
    </Base>
  );
}
