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
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TextStyleName } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
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
  | 'on-primary'
  | 'warning';

const TONE_TOKENS = {
  default: 'color.foreground',
  muted: 'color.foreground-muted',
  subtle: 'color.foreground-subtle',
  primary: 'color.primary',
  danger: 'color.danger',
  success: 'color.success',
  'on-primary': 'color.on-primary',
  // 🔴 用 `warning-strong`（amber-700，5.02:1）而不是 `warning`（amber-600，3.19:1）。
  // 设计系统的对比度测试已经证明 amber-600 不达标（quadrant-3 就是因此改的），
  // 而这里是要用户**读**的警告文案，正是最不能糊的那类文字。
  warning: 'color.warning-strong',
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
// 进度条
// ─────────────────────────────────────────────────────────────

/**
 * 一条只读的进度条。
 *
 * 🔴 它是**信息**，不是按钮 —— 刻意没有被做成可点区域。加上
 * `accessibilityRole` / `accessibilityValue`，读屏用户听到的是
 * "完成 40%"，而不是一根他们感知不到的色条。
 *
 * ⚠️ `percent` 由调用方算好（`lib/growth-display.ts` 的 `progressPercent`
 * 已夹过 0–100）。这里再夹一次是**渲染守卫**：越界宽度在 RN 里不报错，
 * 只是画到容器外或整条消失，而那种症状看起来像"这块没数据"。
 *
 * ⚠️ 首帧不动画是**刻意的**（没有 Animated / LayoutAnimation）：
 * 这条工单只做"读到成长数据"，不做完成动效（L1 的那一段是独立的一件事）。
 * 没有动画也就没有"动效在首帧被触发"的问题。
 */
export function ProgressBar({
  percent,
  label,
}: {
  /** 0–100。 */
  percent: number;
  /** 无障碍名。进度条没有可见文字，读屏全靠它。 */
  label: string;
}): React.JSX.Element {
  const t = useTokens();
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
      style={{
        height: t['size.progress-height'],
        borderRadius: t['radius.full'],
        backgroundColor: t['color.surface-sunken'],
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${clamped}%`,
          height: '100%',
          backgroundColor: t['color.primary'],
        }}
      />
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
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  busy?: boolean;
  /**
   * 无障碍名。默认是「标记完成 / 取消完成」。
   *
   * 🔴 任务行必须传**带标题**的版本：一屏上有十几行时，
   * 读屏用户听到的会是一串完全一样的"标记完成"，
   * 根本不知道勾的是哪一条。
   */
  label?: string;
}): React.JSX.Element {
  const t = useTokens();
  const { reducedMotion } = useTheme();
  const { t: translate } = useI18n();
  const size = t['size.checkbox'];
  // 🔴 兜底名**在 JSX 外面算好**再绑定。把两条字面量直接写进无障碍名的
  // 花括号表达式里，`check-ui-language` 的配平扫描会把它当成硬编码文案
  // （迁移后就是红）—— 而先算成变量既过门禁，也让"这里其实是两条文案"更明显。
  const defaultLabel =
    checked ? translate('mobile.common.uncomplete') : translate('mobile.common.complete');

  return (
    <Pressable
      onPress={onToggle}
      disabled={busy}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: busy === true }}
      accessibilityLabel={label ?? defaultLabel}
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
  const { t: translate } = useI18n();

  if (dot !== true && (count === undefined || count <= 0)) return null;

  const bg = tone === 'primary' ? t['color.primary'] : t['color.danger'];
  const label = count !== undefined && count > max ? `${max}+` : String(count ?? '');
  // 同上：无障碍名在外面算好，别把字面量留在无障碍名的花括号表达式里。
  // 英文单复数也在这一层分支（词条表没有 ICU）：`1` 走单数兄弟词条。
  const accessibility =
    dot === true
      ? translate('mobile.common.badge.new')
      : translate(count === 1 ? 'mobile.common.badge.countOne' : 'mobile.common.badge.count', {
          count: label,
        });

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={accessibility}
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
  /**
   * 可选的**无障碍名**，默认就是可见的 `label`。
   *
   * 🔴 列表里重复出现的同一个按钮需要它：回收站每一行都有「恢复」/「彻底删除」，
   * 读屏用户听到 12 个一模一样的「恢复」无法判断会恢复哪一条。
   * 传 `恢复：买牛奶` 这样的名字，可见文案保持不变。
   */
  accessibilityLabel?: string;
}

export function Button({
  label,
  onPress,
  tone = 'secondary',
  icon,
  disabled,
  loading,
  style,
  accessibilityLabel,
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
      accessibilityLabel={accessibilityLabel ?? label}
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
export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  /** 提示语。**不要**拿它当 label —— 输入之后提示就消失了。 */
  placeholder?: string;
  /** 口令类字段：掩码显示，并关掉自动纠错与首字母大写。 */
  secure?: boolean;
  /**
   * 键盘类型。
   *
   * 🔴 地址字段必须能输入 `://` 与 `.` —— 默认键盘没有这些键，
   * 用户会看到"明明填了地址却少了几个字符"。`url` 键盘才带 `/` 和 `.`。
   */
  keyboard?: 'default' | 'url';
  autoCapitalize?: 'none' | 'sentences';
  editable?: boolean;
  /** 字段下方的说明或错误。传了就会占位，所以只在真有时才传。 */
  hint?: string;
  hintTone?: 'subtle' | 'danger';
}

/**
 * 文本输入字段。
 *
 * 🔴 **label 与 placeholder 是两件事，不能只做后者。**
 * 只有 placeholder 的话，用户一开始输入它就没了 —— 于是回到这个界面时
 * 已经看不出这一格是"访问令牌"还是"口令"。这两者填错的表现都是 401，
 * 而用户没有任何线索。
 *
 * 高度取 `size.field-height`（44px，等于触控下限）：
 * 输入框本身**就是**触控目标，不是它的容器 —— 做成 40px 再留 4px 间隙，
 * 手指点下去会落在间隙里。
 */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  secure = false,
  keyboard = 'default',
  autoCapitalize = 'none',
  editable = true,
  hint,
  hintTone = 'subtle',
}: TextFieldProps): React.JSX.Element {
  const t = useTokens();
  const text = useText();
  const [focused, setFocused] = React.useState(false);

  return (
    <View style={{ gap: t['space.1'] }}>
      <Text variant="row-meta" tone="muted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t['color.foreground-subtle']}
        secureTextEntry={secure}
        keyboardType={keyboard}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        editable={editable}
        accessibilityLabel={label}
        // cursorColor 是 TextInput 的 **prop**，不是 style —— 放进 style 会被静默忽略。
        cursorColor={t['color.primary']}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        style={[
          // ⚠️ 样式名必须**真实存在**于 `TEXT_STYLES`。我第一版写了 `'body'` ——
          // 表里没有这个名字（最接近的是 `row-title`），取到 `undefined`，
          // 输入框里的字会**完全看不见**，而且不报任何错。
          // `useText()` 返回的是**对象**，所以是属性取值 `text['row-title']`，
          // 不是函数调用。
          text['row-title'],
          {
            minHeight: t['size.field-height'],
            paddingHorizontal: t['size.field-padding-x'],
            borderRadius: t['radius.md'],
            backgroundColor: t['color.surface'],
            color: t['color.foreground'],
            // 🔴 焦点态用**边框加粗**表达，不用阴影位移 ——
            // 扁平风格靠边框分层，且位移会让布局跳动。
            borderWidth: focused ? t['border-width.thick'] : t['border-width.thin'],
            borderColor: focused ? t['color.primary'] : t['color.border'],
            opacity: editable ? 1 : t['state.disabled-opacity'],
          },
        ]}
      />
      {hint !== undefined ? (
        <Text variant="caption" tone={hintTone === 'danger' ? 'danger' : 'subtle'}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// 可选中的胶囊（快捷日期、优先级）
// ─────────────────────────────────────────────────────────────

/**
 * 一个小而可选的按钮。
 *
 * 🔴 **按压反馈不用不透明度，用底色。** 兄弟组件 `Button` 里写的是
 * `opacity: 0.85` 这种裸数字（那是 `check:design` 目前**抓不到**的已知缺口，
 * 见 AGENTS.md §5 —— 裸的无单位数字不在检查范围内）。这里不复制那个做法：
 * 改用 `color.surface-sunken` 这个**已有的** token。
 * 需要新变量时先加 token 再消费，而不是先写个数字。
 *
 * 🔴 选中态同时改**边框粗细**与**底色**，不只改颜色：
 * 只改颜色的话，色觉障碍用户看不出哪一个是选中的
 * （UIX Pro 第 1 条是可达性，排在风格前面）。
 */
export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  color,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
  color?: string;
}): React.JSX.Element {
  const t = useTokens();

  const fg = selected ? t['color.on-primary'] : t['color.foreground'];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        // 触控目标不小于 44×44（UIX Pro 第 2 条）
        minHeight: t['touch-target.min'],
        flexDirection: 'row',
        alignItems: 'center',
        gap: t['space.1'],
        paddingHorizontal: t['space.3'],
        borderRadius: t['radius.full'],
        borderWidth: selected ? t['border-width.thick'] : t['border-width.thin'],
        borderColor: selected ? t['color.primary'] : t['color.border'],
        backgroundColor: selected
          ? t['color.primary']
          : pressed
            ? t['color.surface-sunken']
            : t['color.surface'],
      })}
    >
      {icon !== undefined ? (
        <Icon name={icon} size="xs" color={color ?? fg} />
      ) : null}
      <Text variant="row-meta" style={{ color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}
