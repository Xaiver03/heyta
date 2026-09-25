/**
 * 移动端基础组件
 * ==============
 *
 * 🔴 规矩与 Web 端完全一致（AGENTS.md §5）：**这里一个裸 hex / px / ms 都不许有。**
 *
 * ⚠️ 但"用 token"在 RN 里**不是**把 token 值直接塞进 style —— 那是踩过的坑：
 *
 * | 直接塞 | 实际后果 |
 * |---|---|
 * | `fontFamily: t['font.sans']` | 传的是 CSS 字体栈 → **不报错**，屏幕上是条纹乱码 |
 * | `lineHeight: t['line-height.normal']` | 传的是**倍数 1.5** → RN 当成 1.5pt，文字被裁 |
 * | `color: t['color.primary-foreground']` | token **不存在** → `undefined` → 文字不可见 |
 *
 * 所以这里一律走 `useTheme().native` 的归一化访问器与**存在**的语义色名。
 *
 * ---
 *
 * 🔴 2026-09 重写说明：本文件原本自带一张 `TEXT_VARIANT_TOKENS` 表，
 * 自己拼字号 + 字重 + 行高。那正是设计系统里最典型的**第二权威** ——
 * 语义文字样式层（`packages/design-system/src/typography.ts`）建好之后，
 * 同一套排版就有了两个定义处，改一处必然漏另一处且不报错。
 *
 * 现在 `Text` 直接消费 `useText()` 的语义样式，本文件不再自己推导排版。
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text as RNText,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TextStyleName } from '@heyta/design-system';
import { useText, useTheme, useTokens } from '../theme';
import { Icon, type IconName } from './icons';

// ─────────────────────────────────────────────────────────────
// 文字
// ─────────────────────────────────────────────────────────────

/** **语义**色名。不许传颜色值。 */
export type TextTone =
  | 'default'
  | 'muted'
  | 'subtle'
  | 'primary'
  | 'danger'
  | 'success'
  | 'on-primary';

const TONE_TOKENS = {
  default: 'color.foreground',
  muted: 'color.foreground-muted',
  subtle: 'color.foreground-subtle',
  primary: 'color.primary',
  danger: 'color.danger',
  success: 'color.success',
  'on-primary': 'color.on-primary',
} as const satisfies Record<TextTone, string>;

export interface TextProps {
  children: React.ReactNode;
  /**
   * 语义文字样式名。**直接来自设计系统**，不是本文件自己定义的变体 ——
   * 见文件头的"第二权威"说明。
   */
  variant?: TextStyleName;
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** 允许长按选中 —— 给错误详情这类"用户要复制去反馈"的文字用。 */
  selectable?: boolean;
}

export function Text({
  children,
  variant = 'row-title',
  tone = 'default',
  style,
  numberOfLines,
  selectable,
}: TextProps): React.JSX.Element {
  const t = useTokens();
  const text = useText();
  const { native } = useTheme();

  return (
    <RNText
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[
        // 字号 / 字重 / 行高 / 字距 / 等宽**全部**由这一个对象决定。
        text[variant],
        { color: t[TONE_TOKENS[tone]], fontFamily: native.fontSans },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}

// ─────────────────────────────────────────────────────────────
// 顶部应用栏
// ─────────────────────────────────────────────────────────────

export interface AppBarAction {
  icon: IconName;
  label: string;
  onPress: () => void;
}

/**
 * 顶部应用栏。
 *
 * 高度取 `nav.app-bar-height`（56）。**刻意不用大标题**：
 * 大标题（`screen-title`）属于**内容区**，会随内容滚动 ——
 * 放在这里会让标题区跟着滚走，且"标题该多大"变成两处决定。
 * 内容区要强调时，在内容里用 `screen-title`。
 */
export function AppBar({
  title,
  actions,
}: {
  title: string;
  actions?: ReadonlyArray<AppBarAction>;
}): React.JSX.Element {
  const t = useTokens();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: t['color.surface'],
        borderBottomWidth: t['border-width.thin'],
        borderBottomColor: t['color.border'],
      }}
    >
      <View
        style={{
          height: t['nav.app-bar-height'],
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: t['screen.gutter'],
          gap: t['space.2'],
        }}
      >
        {/* 标题区 flex:1 且**不加 numberOfLines 限制**会让长标题把操作挤掉；
            这里限 1 行并允许收缩。 */}
        <View style={{ flex: 1 }}>
          <Text variant="headline" numberOfLines={1}>
            {title}
          </Text>
        </View>
        {actions?.map((a) => (
          <IconButton key={a.label} icon={a.icon} label={a.label} onPress={a.onPress} />
        ))}
      </View>
    </View>
  );
}

/** 顶栏里的图标按钮。触控 44×44，视觉图标居中。 */
export function IconButton({
  icon,
  label,
  onPress,
  color,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
}): React.JSX.Element {
  const t = useTokens();
  const { reducedMotion } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: t['touch-target.min'],
        height: t['touch-target.min'],
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: t['radius.full'],
        // 按下即反馈（Apple：反馈必须在 pointer-down 上出现）。
        backgroundColor: pressed && !reducedMotion ? t['color.hover'] : 'transparent',
      })}
    >
      <Icon name={icon} size="md" color={color ?? t['color.foreground']} />
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────
// 屏幕骨架
// ─────────────────────────────────────────────────────────────

/**
 * 屏幕骨架：顶栏 + 滚动内容 + 底部预留。
 *
 * 🔴 `screen.bottom-inset` 不能省。滚动内容若不在底部留出标签栏的高度，
 * 最后一条会被标签栏**永久遮住** —— 用户看得见它存在，但永远点不到。
 */
export function Screen({
  title,
  actions,
  children,
  scroll = true,
}: {
  title: string;
  actions?: ReadonlyArray<AppBarAction>;
  children: React.ReactNode;
  scroll?: boolean;
}): React.JSX.Element {
  const t = useTokens();
  const body = (
    <View style={{ paddingHorizontal: t['screen.gutter'], gap: t['space.4'] }}>
      {children}
      <View style={{ height: t['screen.bottom-inset'] }} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t['color.background'] }}>
      <AppBar title={title} actions={actions} />
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: t['space.4'] }}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingTop: t['space.4'] }}>{body}</View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// 分组标题
// ─────────────────────────────────────────────────────────────

/**
 * 区块标题（今天 / 已过期 / 收集箱 / 已完成）。
 *
 * 用图标 + 文字 + 计数。**计数用 `numeric-body`**，等宽 ——
 * 否则任务数从 9 变 10 时整行会横向抖动。
 */
export function SectionHeader({
  icon,
  title,
  count,
  tone = 'muted',
}: {
  icon: IconName;
  title: string;
  count?: number;
  tone?: 'muted' | 'danger' | 'primary';
}): React.JSX.Element {
  const t = useTokens();
  const color =
    tone === 'danger'
      ? t['color.danger']
      : tone === 'primary'
        ? t['color.primary']
        : t['color.foreground-muted'];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t['space.2'],
        paddingTop: t['space.2'],
      }}
    >
      <Icon name={icon} size="sm" color={color} strokeWidth={2} />
      <Text variant="section-title" style={{ color, flex: 1 }}>
        {title}
      </Text>
      {count !== undefined ? (
        <Text variant="numeric-body" tone="subtle">
          {String(count)}
        </Text>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// 勾选框
// ─────────────────────────────────────────────────────────────

/**
 * 任务勾选框。
 *
 * 🔴 视觉尺寸 22（`size.checkbox`）但**触控区是 44** —— 这两个数必须分开：
 * 把视觉圆画成 44 会让每一行都笨重；把触控区做成 22 会点不准。
 * 做法：外层 44 的 Pressable 包住 22 的圆。
 */
export function Checkbox({
  checked,
  onToggle,
  busy,
}: {
  checked: boolean;
  onToggle: () => void;
  busy?: boolean;
}): React.JSX.Element {
  const t = useTokens();
  const { reducedMotion } = useTheme();
  const size = t['size.checkbox'];

  return (
    <Pressable
      onPress={onToggle}
      disabled={busy}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: busy === true }}
      accessibilityLabel={checked ? '取消完成' : '标记完成'}
      hitSlop={t['gesture.hit-slop']}
      style={({ pressed }) => ({
        width: t['touch-target.min'],
        height: t['touch-target.min'],
        alignItems: 'center',
        justifyContent: 'center',
        // 按下时整块轻微缩放 —— Apple 的 press 反馈。
        transform: [{ scale: pressed && !reducedMotion ? t['motion.press-scale'] : 1 }],
      })}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: t['radius.full'],
          borderWidth: checked ? 0 : t['border-width.thick'],
          borderColor: t['color.border-strong'],
          backgroundColor: checked ? t['color.primary'] : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Icon name="task.done" size="xs" color={t['color.on-primary']} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────
// 角标
// ─────────────────────────────────────────────────────────────

export interface BadgeProps {
  /**
   * 计数。**`0` 与 `undefined` 都不渲染** —— 一个写着「0」的角标不传达
   * 任何需要行动的信息，它只是把"这里没问题"也变成一个要读的字。
   *
   * 超过 `max` 时显示 `99+`：三位数会把 18px 的圆撑变形，
   * 而"很多"这个信息量在 99 和 137 之间没有差别。
   */
  count?: number;
  /** 上限，默认 99。 */
  max?: number;
  /** 只表示"有"、不表示"多少"时用点状角标。 */
  dot?: boolean;
  tone?: 'danger' | 'primary';
}

/**
 * 计数角标。
 *
 * 🔴 两个非显然的细节：
 *
 * 1. **外圈必须与所在底色同色**（`color.surface`）。图标是**线性描边**的，
 *    数字直接压在笔画上会糊在一起 —— 那一圈不是装饰，是把两者切开的。
 *
 * 2. **必须等宽数字**（`badge` 样式已设 `tabular-nums`）。否则计数从 9 变 10
 *    时角标变宽，压在图标上的位置跟着挪 —— 整个标签看起来在抖。
 */
export function Badge({ count, max = 99, dot, tone = 'danger' }: BadgeProps): React.JSX.Element | null {
  const t = useTokens();
  const text = useText();
  const { native } = useTheme();

  if (dot !== true && (count === undefined || count <= 0)) return null;

  const bg = tone === 'primary' ? t['color.primary'] : t['color.danger'];
  const label = count !== undefined && count > max ? `${max}+` : String(count ?? '');

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={dot === true ? '有新内容' : `${label} 项`}
      style={{
        minWidth: dot === true ? t['size.badge-dot'] : t['size.badge-min-width'],
        height: dot === true ? t['size.badge-dot'] : t['size.badge-height'],
        borderRadius: t['radius.full'],
        backgroundColor: bg,
        // 与所在底色同色的外圈，把角标从图标笔画上"切"出来。
        borderWidth: t['size.badge-ring'],
        borderColor: t['color.surface'],
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: dot === true ? 0 : t['space.1'],
      }}
    >
      {dot === true ? null : (
        <RNText
          numberOfLines={1}
          style={[text.badge, { color: t['color.on-primary'], fontFamily: native.fontSans }]}
        >
          {label}
        </RNText>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// 卡片与按钮
// ─────────────────────────────────────────────────────────────

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, style }: CardProps): React.JSX.Element {
  const t = useTokens();
  return (
    <View
      style={[
        {
          backgroundColor: t['color.surface'],
          borderRadius: t['radius.lg'],
          borderWidth: t['border-width.thin'],
          // 扁平风格用边框表达层次，阴影只给真正的浮层（AGENTS.md §5）。
          borderColor: t['color.border'],
          padding: t['space.4'],
          gap: t['space.2'],
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  /** 可选的左侧图标。用图标时按钮变成"图标 + 文字"，不要 emoji。 */
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  tone = 'secondary',
  icon,
  disabled,
  loading,
  style,
}: ButtonProps): React.JSX.Element {
  const t = useTokens();
  const text = useText();
  const { native, reducedMotion } = useTheme();

  // 🔴 色名必须**真实存在**。`color.primary-foreground` / `color.danger-foreground`
  // 这两个名字是我一开始想当然编的，表里没有 —— 于是按钮文字是 undefined，
  // 在深色背景下完全看不见。正确的名字是 `color.on-primary` /
  // `color.foreground-inverse`。
  const palette: Record<ButtonTone, { bg: string; fg: string; border: string }> = {
    primary: { bg: t['color.primary'], fg: t['color.on-primary'], border: t['color.primary'] },
    secondary: { bg: t['color.surface'], fg: t['color.foreground'], border: t['color.border'] },
    ghost: { bg: 'transparent', fg: t['color.foreground-muted'], border: 'transparent' },
    danger: { bg: t['color.danger'], fg: t['color.foreground-inverse'], border: t['color.danger'] },
  };
  const c = palette[tone];
  const isDisabled = disabled === true || loading === true;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading === true }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          // 🔴 触控目标不小于 44×44（UIX Pro 第 2 条），这个值来自 token。
          minHeight: t['touch-target.min'],
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: t['space.2'],
          paddingHorizontal: t['space.4'],
          borderRadius: t['radius.md'],
          backgroundColor: c.bg,
          borderWidth: tone === 'ghost' ? 0 : t['border-width.thin'],
          borderColor: c.border,
          // disabled 用 token 的不透明度，不写死 0.5。
          opacity: isDisabled
            ? t['state.disabled-opacity']
            : pressed && !reducedMotion
              ? 0.85
              : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <>
          {icon !== undefined ? <Icon name={icon} size="sm" color={c.fg} /> : null}
          <RNText style={[text.headline, { color: c.fg, fontFamily: native.fontSans }]}>
            {label}
          </RNText>
        </>
      )}
    </Pressable>
  );
}

/**
 * 悬浮主操作按钮（FAB）。
 *
 * 🔴 用 `shadow.lg` 是**正确**的例外：AGENTS.md 说"阴影只给真正的浮层"，
 * 而 FAB 就是浮层 —— 它悬在内容之上，没有边框可以表达这个层级。
 */
export function Fab({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  const t = useTokens();
  const { native, reducedMotion } = useTheme();
  const size = t['size.fab'];
  const shadow = native.shadow('shadow.lg');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          position: 'absolute',
          right: t['screen.gutter'],
          // 抬到标签栏之上：标签栏高 + 一段呼吸。
          bottom: t['nav.tab-bar-height'] + t['space.4'],
          width: size,
          height: size,
          borderRadius: t['radius.full'],
          backgroundColor: t['color.primary'],
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale: pressed && !reducedMotion ? t['motion.press-scale'] : 1 }],
        },
        shadow ?? undefined,
      ]}
    >
      <Icon name={icon} size="md" color={t['color.on-primary']} strokeWidth={2.5} />
    </Pressable>
  );
}

/** 列表分隔线。左缩进与主文字对齐，视觉上"线从文字开始"。 */
export function Divider({ inset = true }: { inset?: boolean }): React.JSX.Element {
  const t = useTokens();
  return (
    <View
      style={{
        height: t['border-width.thin'],
        backgroundColor: t['color.border'],
        marginLeft: inset ? t['size.divider-inset'] : 0,
      }}
    />
  );
}

/** 空状态。不是"暂无数据"四个字就完事 —— 它得说明下一步能做什么。 */
export function EmptyState({
  icon,
  title,
  hint,
  detail,
  detailTone = 'danger',
}: {
  icon?: IconName;
  title: string;
  hint: string;
  /** 补充说明。技术细节给错误用，step 说明给"还没做"用。 */
  detail?: string;
  /**
   * 🔴 `detail` 的语义色**不是固定的**。
   * 默认 `danger`（错误详情，用户要复制去反馈）；但"此功能尚未实现"这类
   * **说明性**文字染成红色会读成"出错了" —— 颜色在表达一个不存在的问题。
   */
  detailTone?: 'danger' | 'subtle';
}): React.JSX.Element {
  const t = useTokens();
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: t['space.16'],
        paddingHorizontal: t['space.8'],
        gap: t['space.2'],
      }}
    >
      {icon !== undefined ? (
        <Icon name={icon} size="xl" color={t['color.foreground-subtle']} strokeWidth={1.5} />
      ) : null}
      <Text variant="section-title" tone="muted" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      <Text variant="row-meta" tone="subtle" style={{ textAlign: 'center' }}>
        {hint}
      </Text>
      {detail !== undefined ? (
        <Text
          variant="caption"
          tone={detailTone}
          selectable={detailTone === 'danger'}
          style={{ textAlign: 'center' }}
        >
          {detail}
        </Text>
      ) : null}
    </View>
  );
}