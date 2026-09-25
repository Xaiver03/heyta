/**
 * 图标层
 * ======
 *
 * 🔴 存在的理由：**禁止 emoji 当图标**（AGENTS.md §5、UIX Pro Max、Taste 三条规则一致）。
 * emoji 的问题不是不好看，是**不受设计系统控制**：它在三端渲染成完全不同的字形，
 * 颜色不能跟随 `color.primary`，尺寸不能跟随 token，也没有描边权重可以统一。
 *
 * 做法：所有图标**集中在这里**登记。组件不许自己 import Lucide ——
 * 那样会出现同一个语义在不同界面用两个图标，而且没人发现。
 *
 * 为什么先查库而不是自己画：Lucide 是 ISC（宽松白名单内）、周更（1.48.0 发于 2026-09-24）、
 * 三端可用（底层 `react-native-svg`，鸿蒙侧 `@react-native-oh-tpl/react-native-svg` 提供
 * `harmony/svg.har`）。自己画 SVG 路径 = 重复造轮子，且必然与无障碍/网格不一致。
 *
 * ⚠️ 尺寸默认取 `icon.*` token，标签栏另有 `nav.tab-icon-size` —— 两者**刻意分开**：
 * 图标基准尺寸会变，而标签栏图标的视觉效果不该跟着变（它和 11px 的字标签一起看）。
 */

import React from 'react';
import {
  Bell,
  CalendarDays,
  CalendarClock,
  Check,
  CircleCheckBig,
  Flag,
  Inbox,
  ListTodo,
  Plus,
  RefreshCw,
  Repeat,
  Settings,
  Timer,
  TriangleAlert,
  Trash2,
  User,
  X,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTokens } from '../theme';

/**
 * 图标登记表。`name` 是**语义名**（`tab.tasks`），不是图标名（`ListTodo`）——
 * 与设计 token 同样的理由：换图标库时语义名不用改。
 */
const ICONS = {
  // 四个 tab
  'tab.tasks': ListTodo,
  'tab.calendar': CalendarDays,
  'tab.focus': Timer,
  'tab.profile': User,

  // 任务
  'task.add': Plus,
  'task.done': Check,
  'task.delete': Trash2,
  'task.due': CalendarClock,
  'task.repeat': Repeat,
  'task.reminder': Bell,
  'task.priority': Flag,

  // 分组
  'group.today': ListTodo,
  'group.inbox': Inbox,
  'group.overdue': TriangleAlert,
  'group.completed': CircleCheckBig,

  // 通用
  'action.close': X,
  'action.settings': Settings,
  'action.sync': RefreshCw,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** 尺寸档位：对应 `icon.*` token，外加标签栏专用的一档。 */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'tab';

export interface IconProps {
  name: IconName;
  /** 默认 `md`。标签栏用 `tab`。 */
  size?: IconSize;
  /** 描边色。不传则用 `color.foreground`。 */
  color?: string;
  /** 描边宽度。Lucide 默认 2；标签栏用 2 更清楚，正文旁用 1.75 更轻。 */
  strokeWidth?: number;
}

export function Icon({
  name,
  size = 'md',
  color,
  strokeWidth = 2,
}: IconProps): React.JSX.Element {
  const t = useTokens();
  const Glyph = ICONS[name];
  // 标签栏图标用 nav 组的 token（它与 11px 字标签同居，视觉尺寸是配套的），
  // 其余用 icon 组。
  const px = size === 'tab' ? t['nav.tab-icon-size'] : t[`icon.${size}`];

  return (
    <Glyph
      size={px}
      strokeWidth={strokeWidth}
      color={color ?? t['color.foreground']}
      // 🔴 Lucide 的图标是**线性**的：靠 stroke 上色，`fill` 默认是 'none'。
      // 选中态若要"实心"，不能只换 color（那是换个颜色的空心），
      // 得换一个实心的图标名或单独处理。这里统一保持线性 ——
      // 选中态用**颜色 + 指示条**表达，而不是实心，避免两种字形风格混用。
    />
  );
}