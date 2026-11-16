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

import React, { useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  buttonStretchesByDefault,
  contentMeasureMaxFor,
  CONTROL_STATE_TOKENS,
  DEFAULT_CONTROL_EMPHASIS,
  DEFAULT_CONTROL_TONE,
  controlPaletteOf,
  type ControlEmphasis,
  type ControlTone,
} from '@heyta/ui';
import {
  CHOICE_ROW_SHAPE,
  CHOICE_ROW_TEXT,
  SPACING_ROLE,
  TYPE_ROLE,
  type TextStyleName,
} from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import {
  StateIllustration,
  resolveFieldChrome,
  toEmptyStateViewModel,
  type StateIllustrationVariant,
} from '@heyta/ui';
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
  success: 'color.success-strong',
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
  /**
   * 原生 id。**只给 `aria-describedby` 这类关联用**（RN 的 `nativeID` 就是那个 id）。
   * 加它是因为字段的"说明/错误"要能被输入框按 id 指到 —— 那正是
   * `@heyta/ui#fieldDescribedById` 算出来的东西。
   */
  nativeID?: string;
  /**
   * 读屏播报策略。`'polite'` = 等当前朗读结束后再念出来 ——
   * 就地错误必须带它，否则读屏用户**永远不知道**那次提交失败了
   * （视觉上有红字，无声世界什么都没有）。
   */
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
  /** 允许长按选中 —— 给错误详情这类"用户要复制去反馈"的文字用。 */
  selectable?: boolean;
  /**
   * 在横向行里占满剩余宽度（`flex: 1`）。
   *
   * 🔴 它是 `HStack` 的配套：行里"标题靠左、元信息靠右"是最常见的形状，
   * 而这件事以前只能写 `style={{ flex: 1 }}` —— 一个纯布局意图，
   * 却要每处开一条内联样式（`check:l4` 的棘轮数它）。
   */
  grow?: boolean;
  /**
   * 设备级验收的锚点 id（真模拟器 AX 探针按它找控件；`Button`/`Chip` 同一通道）。
   * 🔴 不参与样式或逻辑，纯透传给 `RNText`（M6-3a 的共享屏需要把状态句钉给载体）。
   */
  testID?: string;
}

export function Text({
  children,
  variant = 'row-title',
  tone = 'default',
  style,
  numberOfLines,
  selectable,
  grow = false,
  testID,
  nativeID,
  accessibilityLiveRegion,
}: TextProps): React.JSX.Element {
  const t = useTokens();
  const text = useText();
  const { native } = useTheme();

  return (
    <RNText
      testID={testID}
      nativeID={nativeID}
      accessibilityLiveRegion={accessibilityLiveRegion}
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[
        // 字号 / 字重 / 行高 / 字距 / 等宽**全部**由这一个对象决定。
        text[variant],
        { color: t[TONE_TOKENS[tone]], fontFamily: native.fontSans },
        // 顺序有意：`grow` 在调用方的 `style` **之前**，
        // 所以极端情况下显式样式还能覆盖它 —— 反过来就变成组件替调用方做主。
        grow ? { flex: 1 } : null,
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
  /** 请求仍在执行时，顶栏动作必须显式进入禁用态，而不是静默吞掉点击。 */
  disabled?: boolean;
  /** 设备级验收（真模拟器 AX 探针）按它定位控件。 */
  testID?: string;
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
  titleLeading,
  onTitlePress,
}: {
  title: string;
  actions?: ReadonlyArray<AppBarAction>;
  titleLeading?: React.ReactNode;
  /**
   * 🔴 2026-11-16：**标题本身可以是一个控制器**。
   *
   * 出处：Canonical 的日历重构（`solving multiple calendar views`）把
   * "切换视图"做成点标题，而不是再加一枚图标；滴答是"额外一枚图标 + 下拉菜单"。
   * 对这一屏来说标题就是**当前时间范围**（「2026年11月」），点它换档比找图标直。
   *
   * ⚠️ 只有真会给菜单的屏才传：传了却没反应比不传更糟。
   */
  onTitlePress?: () => void;
}): React.JSX.Element {
  const t = useTokens();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: t['color.surface'],
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
        {titleLeading}
        <View style={{ flex: 1 }}>
          {onTitlePress === undefined ? (
            <Text variant="headline" numberOfLines={1}>
              {title}
            </Text>
          ) : (
            <Pressable
              onPress={onTitlePress}
              accessibilityRole="button"
              accessibilityLabel={title}
              testID="app-bar-title-press"
              style={{ flexDirection: 'row', alignItems: 'center', gap: t['space.1'] }}
            >
              <Text variant="headline" numberOfLines={1}>
                {title}
              </Text>
              <Icon name="action.disclose-down" size="sm" color={t['color.foreground-subtle']} />
            </Pressable>
          )}
        </View>
        {actions?.map((a) => (
          <IconButton
            key={a.label}
            icon={a.icon}
            label={a.label}
            testID={a.testID}
            onPress={a.onPress}
            disabled={a.disabled}
          />
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
  testID,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  testID?: string;
  disabled?: boolean;
}): React.JSX.Element {
  const t = useTokens();
  const { reducedMotion } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      disabled={disabled === true}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      style={({ pressed }) => ({
        width: t['touch-target.min'],
        height: t['touch-target.min'],
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: t['radius.full'],
        // 按下即反馈（Apple：反馈必须在 pointer-down 上出现）。
        // 🔴 原来这一格是**换底**（`color.hover`），而 `Button` 是压暗、`Checkbox`/`Fab`
        // 是缩放 —— 同一个"按下"在同一个文件里三种机制。收成触屏那一档：缩放，读 token。
        backgroundColor: 'transparent',
        opacity: disabled === true ? t['state.disabled-opacity'] : 1,
        transform: [
          {
            scale: pressed && !reducedMotion && disabled !== true ? t[CONTROL_STATE_TOKENS.pressScale] : 1,
          },
        ],
      })}
    >
      {/* 前景默认值来自共享表的 `ghost` 档（与 Web 工具条图标同一个静止态），
          调用方仍可用 `color` 覆盖（例如那枚真的表示危险的图标）。 */}
      <Icon name={icon} size="md" color={color ?? t[controlPaletteOf('ghost')!.fg]} />
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
  titleLeading,
  children,
  scroll = true,
  fixedControls,
  bottomInset = true,
  chrome = 'page',
  barCollapsed,
  onTitlePress,
}: {
  title: string;
  actions?: ReadonlyArray<AppBarAction>;
  titleLeading?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  /** Contextual controls remain reachable while the content scrolls. */
  fixedControls?: React.ReactNode;
  /** 固定输入区由调用方管理底部留白，避免重复预留滚动空间。 */
  bottomInset?: boolean;
  /**
   * 这一屏属于哪一档 **chrome（外壳）**。
   *
   * 🔴 2026-11-15 立的抽象。此前每一屏都在自己决定"要不要 gutter、顶栏放几枚
   * 按钮"，于是同一件事有 N 份答案：表单页 16dp 边距 + 三枚顶栏动作，看板页也
   * 照抄同一套 —— 四象限四周各留一圈白（真机对照滴答：人家的格子直接顶到边缘）。
   * 现在只有三档，选一档由视图**是什么**决定，不由作者口味决定：
   *
   * - `page`（默认）：内容页 / 表单页。左右 16dp gutter，顶栏 1–3 枚**高频**动作。
   * - `board`：看板（四象限 / 时间线 / 日历）。内容在**响应式 gutter 之内铺满**宽度
   *   （手机 16 / 平板及更宽 24，见下方 `boardGutter`）；顶栏只留
   *   全局搜索与「更多」，低频动作（手动同步、排序…）进「更多」菜单。
   * - `immersive`：全屏消费内容（专注计时、阅读）。顶栏默认不画；退出靠返回手势。
   *   ⚠️ 本档**尚未有实现**，先在类型里占位，避免到时候又加第四个名字。
   *
   * 判据：`pnpm check:nav-chrome` 会按这一档校验"顶栏动作是否超过预算"。
   */
  chrome?: 'page' | 'board' | 'immersive';
  /**
   * 顶栏是否收起（**受控**）。宿主自己监听滚动时（如 `FlatList` 屏）传这一格，
   * 内部那条 `onScroll` 就不再生效 —— 两条同时驱动会让栏在两帧之间来回跳。
   */
  barCollapsed?: boolean;
  /** 标题可点（见 `AppBar` 的 `onTitlePress`）。 */
  onTitlePress?: () => void;
}): React.JSX.Element {
  const t = useTokens();

  /**
   * 🔴 2026-11-16：`board` 档的页边距**不再归零**，改成随宽度变化的响应式 gutter。
   *
   * 之前的形状是 `chrome === 'board' ? 0 : gutter` —— 于是日历这种"网格 + 内容卡"
   * 的屏，网格铺满是对的，但**下面那张「这一天没有到期的任务」卡和脚注一起贴到屏幕两边**
   *（真机 iPad/iPhone 都是"根本没留边距"的观感）。11-15/11-16 只能在脚注、整块板
   * 各补一条 16dp —— 补丁式，且 16dp 在 iPad（820–1366dp）上≈没有留白。
   *
   * 正确层次：gutter 由**外壳**统一给（手机 16 / 平板及更宽 24），内容卡自然继承；
   * 网格仍在 gutter 之内铺满，不再各自补 16dp。只在**日历**一屏在用 `board`，
   * 所以这条不会波及四象限/时间线（它们不走 `Screen` 的 board 档）。
   */
  const { width: screenWidth } = useWindowDimensions();
  const boardGutter = screenWidth >= 768 ? t['space.6'] : t['screen.gutter'];

  /**
   * 🔴 2026-11-15：**顶栏的出现时机**。
   *
   * 到这一轮为止，三档 chrome 只决定了"内容铺不铺满、顶栏放几枚"，
   * 顶栏本身**永远挂在上面**：列表滚到第二屏，标题还把一行高度占着。
   * 产品负责人原话：「我觉得我们顶层的顶部导航栏……出现的时机根本没有出现出来」。
   *
   * 形状：向下滚过一屏后收起、向上滚立刻回来。三条阈值都读 token / 只判方向：
   *   · 位移超过 `space.3`（12dp）才算"在滚"，避免手抖把栏切来切去；
   *   · 已离开顶部一段（`space.3`）才开始收 —— 顶部那 12dp 内永远看得见标题；
   *   · 回到 `y <= 0` 无条件展开（滚到顶还藏着栏就是丢导航）。
   *
   * ⚠️ 只在**没有 `fixedControls`** 时启用：那一块是批量选择等常驻控件，
   * 它要跟着顶栏一起移动才算对，而那条布局这一轮没做（登记在台账）。
   */
  /**
   * 🔴 2026-11-15：收起**不再只在 `board` 档**。
   *
   * 第一次只给 board 时，真机日志（`[uxtest]`）打出 `collapses=true` 但 `y` 最大只有
   * 47px —— 日历这种"内容刚好一屏多一点"的页面本来就滚不到 `barHeight`，
   * 于是看上去永远是"没生效"。而产品负责人要的是**所有会长滚动的屏**都收起顶栏。
   * 所以：除 `immersive`（它本来就不画栏）外，凡是有 `scroll`、且没有常驻控件
   *（`fixedControls`，如批量选择条）的屏都接这条。
   */
  /**
   * 🔴 三档 chrome 只决定默认行为；**宿主受控时（`barCollapsed !== undefined`）一律接**。
   *
   * 列表档是 `scroll={false}`（滚动宿主是 `FlatList`），若还按 `scroll` 判，
   * `collapses` 恒为 false ⇒ 顶栏的高度包装根本不渲染 ⇒ 宿主怎么传都收不起来
   *（真机验证过：列表滚了、栏没动）。
   */
  const collapses =
    barCollapsed !== undefined ||
    (chrome !== 'immersive' && fixedControls === undefined && scroll);
  /**
   * 🔴 顶栏的出现时机：滚过一段收起、往回滚立刻回来。
   *
   * 实现走**高度收缩**（`height: 0` + `overflow: hidden`），不走 `translateY` 绝对定位：
   *   · 绝对定位要自己留 `paddingTop`，还会盖住内容（真机实测：分段控件被栏压掉一半）；
   *   · `Animated.event` + `useNativeDriver` 那一版**在真机上直接崩溃**（退回桌面，
   *     无 JS 日志）⇒ 这条路不再试。
   *
   * 判据仍是三条：位移过 `space.3` 才算"在滚"、已离开顶部过 `space.3` 才收、
   * 回到顶部无条件展开（滚到顶还藏着栏就是丢导航）。
   */
  const [barHiddenState, setBarHidden] = React.useState(false);
  const barHidden = barCollapsed ?? barHiddenState;

  /**
   * 🔴 2026-11-16：收起/展开走**高度动画**，不再一帧跳变。
   *
   * 上一版是 `height: barHidden ? 0 : undefined` —— 每一帧之间高度从 56dp 直接变 0，
   * 内容整块上跳一次。真机观感就是产品负责人说的「向上滑动时会有滚屏屏闪」。
   * 现在 150ms 内从整栏高度过渡到 0，内容连续上移。
   */
  const insets = useSafeAreaInsets();
  const collapseHeight = insets.top + t['nav.app-bar-height'];
  const collapseAnim = useRef(new Animated.Value(barHidden ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(collapseAnim, {
      toValue: barHidden ? 1 : 0,
      duration: t['duration.fast'],
      useNativeDriver: false,
    }).start();
  }, [barHidden, collapseAnim, t]);
  const lastY = useRef(0);
  const onScrollY = useCallback(
    (y: number) => {
      if (!collapses) return;
      const dy = y - lastY.current;
      lastY.current = y;
      /**
       * 🔴 `dy` 是**每帧增量**（16ms 一次），不是"这一段的位移"。
       * 拿 `space.3`（12dp）当方向阈值时，每帧只有 10px 左右 ⇒ 永远不满足
       *（真机日志：`y` 从 15 涨到 47，`dy` 始终 < 36）。方向判据必须用**符号**：
       * 向下哪怕 1px 就是"在往下滚"，向上就展开；另外用 `space.3` 守"别在顶部那一段就收"。
       */
      if (y <= 0) setBarHidden(false);
      else if (dy > 0.5 && y > t['space.3']) setBarHidden(true);
      else if (dy < -0.5) setBarHidden(false);
    },
    [collapses, t],
  );

  const body = (
    /**
     * 🔴 `flexGrow: 1` 是**共享层那条"铺满"契约在这端的落地**（R2 / 类 C）。
     *
     * `QuadrantBoard` 自己声明了 `flexGrow`，但 `ScrollView` 的 content container
     * **高度由内容决定** ⇒ 那一层拿不到剩余空间，`flexGrow` 就什么都分配不到
     * （和 web 上"内容列是块容器"是同一个断点的 RN 面目）。
     * 标准解法是**两层都声明**：content container 先长到视口高，body 再长满它。
     *
     * ⚠️ 视觉效果对**内容已经比一屏高**的屏是零变化（没有剩余空间可分，
     * 且 RN 的 `View` 默认 `flexShrink: 0` ⇒ 不会被压），多余空间只会落在
     * 最后一个子节点之后（`justifyContent` 默认 `flex-start`）—— 所以这不是
     * "给所有屏加了一条高度约束"，只是把"母层给不给确定高度"这一环补上。
     */
    <View style={{ paddingHorizontal: chrome === 'board' ? boardGutter : t['screen.gutter'], gap: t['space.4'], flexGrow: 1, ...(contentMeasureMaxFor(chrome) !== undefined ? { width: '100%' as const, maxWidth: contentMeasureMaxFor(chrome), alignSelf: 'center' as const } : {}), ...(scroll ? {} : { flex: 1, minHeight: 0 }) }}>
      {children}
      {bottomInset ? <View style={{ height: t['screen.bottom-inset'] }} /> : null}
    </View>
  );

  const appBar = (
    <AppBar
      title={title}
      actions={actions}
      titleLeading={titleLeading}
      {...(onTitlePress === undefined ? {} : { onTitlePress })}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: t['color.background'] }}>
      {collapses ? (
        <Animated.View
          style={{
            height: collapseAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [collapseHeight, 0],
            }),
            overflow: 'hidden',
          }}
        >
          {appBar}
        </Animated.View>
      ) : (
        appBar
      )}
      {fixedControls ? (
        <View style={{ paddingHorizontal: t['screen.gutter'], paddingTop: t['space.2'] }}>
          {fixedControls}
        </View>
      ) : null}
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: t['space.4'], flexGrow: 1 }}
          onScroll={
            collapses
              ? (e) => {
                  onScrollY(e.nativeEvent.contentOffset.y);
                }
              : undefined
          }
          scrollEventThrottle={collapses ? 16 : undefined}
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
/**
 * 分组标题（「近期状态」「整理与记录」…）。
 *
 * ## 🔴 2026-11-14：去掉图标、换回 `group-label`、收紧间距
 *
 * 改前（真机 `heyta-profile.xml`）：
 *   · 组标题「近期状态」在 **x=120**，而它管辖的行在 **x=96** —— 被前面那枚图标
 *     推右了 24dp（`icon.sm` 16 + `space.2` 8）。**组标题比它管的东西更靠右。**
 *   · 文字档是 `section-title`（16px semibold），与行文字 `row-title`（16px）
 *     **同字号同颜色**，只差一档字重 ⇒ 看起来是一行"加粗的正文"，不是分组。
 *
 * 改后：不吃图标、用 `group-label`（13px semibold `muted`）、与行同一条左缘。
 *
 * 为什么组标题该比行**小**：这是 iOS 设置页的做法，而 heyta 里
 * `group-label` 那一档的注释早论证过 —— 中文没有大小写线索，
 * 「小字 + 大写 + 宽字距」那套眉标写法不成立，**必须靠字重与弱色赢**。
 * 于是"组标题比内容小一档"不是失误，是这条纪律的既定形状。
 *
 * ⚠️ 组标题**不放图标**：图标是"行"的属性（这一行是什么类的东西），
 *    组标题是索引（这里开始新的一组）。给索引配图标会让它读起来像一行。
 */
export function SectionHeader({
  title,
  count,
  tip,
  tone = 'muted',
}: {
  title: string;
  count?: number;
  /**
   * 标题右侧的「?」。**必须挂在标题这一行**，不能塞进卡片。
   *
   * 🔴 2026-11-14 加：把「提醒送达」那段 81 字说明从正文收进「?」之后，
   * `?` 落到了卡片左上角 —— 一个没有归属的孤立问号（`check:tip-adjacency`
   * 登记的就是这个形状）。问号的意义是"解释**旁边这个东西**"，
   * 旁边没有东西，它就只是装饰。
   */
  tip?: React.ReactNode;
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
        alignItems: 'baseline',
        gap: t['space.2'],
        /*
         * 上方 24dp（分隔上一组），下方由调用方的 Stack gap 给 8dp（紧贴它管的第一行）。
         * 改前是 `space.2`(8dp) —— 与"组内间距"同值，于是"上一组结束了"和
         * "这一组内部换了一行"看起来一样。
         */
        paddingTop: t[SPACING_ROLE['group-gap']],
      }}
    >
      <Text variant={TYPE_ROLE['section-heading']} style={{ color, flex: 1 }}>
        {title}
      </Text>
      {tip === undefined ? null : tip}
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
  caption,
  testID,
}: {
  checked: boolean;
  onToggle: () => void;
  busy?: boolean;
  testID?: string;
  /**
   * 无障碍名。默认是「标记完成 / 取消完成」。
   *
   * 🔴 任务行必须传**带标题**的版本：一屏上有十几行时，
   * 读屏用户听到的会是一串完全一样的"标记完成"，
   * 根本不知道勾的是哪一条。
   */
  label?: string;
  /**
   * 可见的说明文字（勾选框右侧）。
   *
   * 🔴 2026-11-15 加：`label` 只进无障碍树，界面里**不画**。当一枚复选框
   * 旁边没有任何字时（「创建加密数据钥匙」卡里那枚"记住解锁"），
   * 用户看到的是一个不知道勾什么的白圈 —— 那是形状缺陷，不是无障碍问题。
   * 传了 `caption` 就把文字画出来，整行可点；不传则保持原来 44×44 的纯方框。
   */
  caption?: string;
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
      testID={testID}
      disabled={busy}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: busy === true }}
      accessibilityLabel={label ?? defaultLabel}
      hitSlop={t['gesture.hit-slop']}
      style={({ pressed }) => ({
        ...(caption === undefined
          ? { width: t['touch-target.min'], height: t['touch-target.min'] }
          : { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t['space.3'] }),
        alignItems: caption === undefined ? 'center' : undefined,
        justifyContent: caption === undefined ? 'center' : undefined,
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
      {caption === undefined ? null : (
        <Text variant="row-meta" tone="default">
          {caption}
        </Text>
      )}
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
  // 视觉上用 `max+` 保持角标紧凑，但无障碍树必须读出真实数量；
  // 否则 137 会被错误地报告成 99+，用户无法得到准确计数。
  const accessibilityCount = String(count ?? '');
  // 同上：无障碍名在外面算好，别把字面量留在无障碍名的花括号表达式里。
  // 英文单复数也在这一层分支（词条表没有 ICU）：`1` 走单数兄弟词条。
  const accessibility =
    dot === true
      ? translate('mobile.common.badge.new')
      : translate(count === 1 ? 'mobile.common.badge.countOne' : 'mobile.common.badge.count', {
          count: accessibilityCount,
        });

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={accessibility}
      style={{
        ...(dot === true
          ? {
              width: t['size.badge-dot'],
              height: t['size.badge-dot'],
            }
          : {
              minWidth: t['size.badge-min-width'],
              minHeight: t['size.badge-height'],
            }),
        borderRadius: t['radius.full'],
        backgroundColor: bg,
        // 与所在底色同色的外圈，把角标从图标笔画上"切"出来。
        borderWidth: t['size.badge-ring'],
        borderColor: t['color.surface'],
        // 宽度由内容决定；由宿主决定对齐方向，不覆盖角标右锚点。
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: dot === true ? 0 : t['space.1'],
      }}
    >
      {dot === true ? null : (
        <RNText
          numberOfLines={1}
          maxFontSizeMultiplier={2}
          style={[
            text.badge,
            {
              color: t['color.on-primary'],
              fontFamily: native.fontSans,
              flexShrink: 0,
            },
          ]}
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

/**
 * 间距档位（L4 视图里唯一该出现的"间距决定"是**选哪一档**，不是写数值）。
 *
 * 🔴 为什么要有这一档：`check:l4-no-style` 的断言 C 把视图里每一处 `style={{…}}`
 * 记成一笔债，而它给出的修法原文是"这个值该搬到 L1/L2"。在此之前移动端没有地方
 * 可以搬 —— `Card` 只收 `style`，所以视图只能自己写 `{ gap: tokens['space.3'] }`，
 * 于是同一个值在 `ExportScreen` 一个文件里就写了四遍。
 */
export type GapTier = 'tight' | 'default' | 'loose';

function gapValue(t: ReturnType<typeof useTokens>, gap: GapTier): number {
  if (gap === 'tight') return t['space.1'];
  return gap === 'loose' ? t['space.3'] : t['space.2'];
}

/**
 * 只负责纵向排间距的容器。给那些**不在卡片里**、却需要一档间距的片段用
 * （比如浮层里"说明 + 按钮"两行）。卡片内请直接依赖 `Card` 自己的 `gap`。
 */
export function Stack({
  gap = 'default',
  children,
  style,
  ...rest
}: {
  gap?: GapTier;
  children: React.ReactNode;
} & ViewProps): React.JSX.Element {
  const t = useTokens();
  return (
    <View {...rest} style={[{ gap: gapValue(t, gap) }, style]}>
      {children}
    </View>
  );
}

/**
 * 横向版 `Stack`：一行里放几样东西（标题 + 元信息、两个按钮并排）。
 *
 * 🔴 `align` **默认不给** —— 这很重要：`alignItems` 缺省是 `stretch`，
 * 而"标题与右侧日期基线对齐"这类行要的是 `center`。把默认值定成
 * `center` 会让所有没写 `align` 的调用点悄悄改布局，
 * 而定成 `undefined` 时它和以前的 `<View style={{ flexDirection: 'row' }}>` 逐字节等价。
 */
export function HStack({
  gap = 'default',
  align,
  children,
  style,
  ...rest
}: {
  gap?: GapTier;
  align?: 'center';
  children: React.ReactNode;
} & ViewProps): React.JSX.Element {
  const t = useTokens();
  return (
    <View
      {...rest}
      style={[
        { flexDirection: 'row', gap: gapValue(t, gap) },
        align === 'center' ? { alignItems: 'center' } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: GapTier;
}

export function Card({ children, style, gap = 'default' }: CardProps): React.JSX.Element {
  const t = useTokens();
  return (
    <View
      style={[
        {
          backgroundColor: t['color.surface'],
          borderRadius: t['radius.lg'],
          padding: t['space.4'],
          gap: gapValue(t, gap),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * 移动端按钮的色调名 = 共享词表的**别名**，这里不再自己列一遍四档。
 *
 * 🔴 以前这是第二份清单（与 `packages/ui/src/control/states.ts` 各写一遍），
 * 于是"加一档"可以只加在一端 —— 那正是 P4 立项要消灭的形状。
 */
export type ButtonTone = ControlTone;

export interface ButtonProps {
  label: string;
  onPress: () => void;
  /** 色调。默认值取自共享表（`DEFAULT_CONTROL_TONE`），不在这一端另写一个。 */
  tone?: ButtonTone;
  /**
   * 重量档：`inline`（默认）/ `commit`。
   *
   * 🔴 只有**确认层里那枚唯一要按下去的**按钮该写 `commit`。列表行与设置项里那枚
   * 永远是行内档 —— 默认给实底会把整屏染红（回收站每一行都有「彻底删除」）。
   */
  emphasis?: ControlEmphasis;
  /** 可选的左侧图标。用图标时按钮变成"图标 + 文字"，不要 emoji。 */
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  /** 展开/收起状态，供无边框的渐进展开按钮向读屏器暴露。 */
  expanded?: boolean;
  /**
   * 是否**撑满**父容器宽度。默认 `false`（Apple HIG：避免全宽按钮）。
   * 🔴 只有「单一主操作 + 强引导」的 CTA（登录 / 提交 / 空状态主按钮）才显式 `fullWidth`。
   * 竖排列容器里默认按内容宽度、靠左对齐；**行内按钮靠 flex 定宽，不受这一项影响**。
   */
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * 设备级验收的锚点 id（真模拟器 AX 探针按它找控件）。
   * 🔴 它不参与样式或逻辑：可见文案换词条时它要跟着想清楚，用例找的是"那个按钮"。
   */
  testID?: string;
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
  tone = DEFAULT_CONTROL_TONE,
  emphasis = DEFAULT_CONTROL_EMPHASIS,
  icon,
  disabled,
  loading,
  expanded,
  fullWidth = buttonStretchesByDefault(),
  style,
  testID,
  accessibilityLabel,
}: ButtonProps): React.JSX.Element {
  const t = useTokens();
  const text = useText();
  const { native, reducedMotion } = useTheme();

  /**
   * 配方**只从共享表取**（`packages/ui/src/control/states.ts`）。
   *
   * 这里原来有一份 `Record<ButtonTone, …>` 的本地抄件，三格都是第二个答案：
   *   · `secondary` 用 `color.surface`（Web 那一端没有这一档，设置页又在 `sheets.css`
   *     里现造了个凹陷底 ⇒ 同一语义三份答案）；
   *   · `danger` 恒为实底（Web 恒为透明底红字 ⇒ 两端各对一半，缺的是"这一枚站在
   *     哪个位置"的判断，现在由 `emphasis` 显式表达）；
   *   · `border` 那一格**从来没被读过**（样式里恒为 `borderWidth: 0`）——
   *     一份没人消费的抄件字段，删。
   *
   * ⚠️ `hoverBg`/`hoverFg`/`activeBg` 在触屏上不存在，这一端**故意不读**：
   * 按下反馈在两端各用自己的那一档（Web 换底、触屏缩放），
   * 而不是每一端各发明三种机制。
   */
  const recipe = controlPaletteOf(tone, emphasis);
  if (recipe === undefined) {
    // 词表外的色调名（只有绕过类型系统才拿得到）⇒ **不画**。
    // 兜成任何一档默认值都会让"新加一个 tone 名"静默画成次要按钮，
    // 那正是这张表要消灭的毛病（与 `receiptTimingOf` 同一个保守方向）。
    return <></>;
  }
  const c = {
    bg: recipe.bg === 'transparent' ? ('transparent' as const) : t[recipe.bg],
    fg: t[recipe.fg],
  };
  const isDisabled = disabled === true || loading === true;

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading === true, expanded }}
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
          borderWidth: 0,
          // 🔴 宽度策略：默认按内容宽度、靠左（HIG 避免全宽按钮）；只有单一 CTA 传 fullWidth 才拉满。
          alignSelf: fullWidth ? ('stretch' as const) : ('flex-start' as const),
          // disabled 用 token 的不透明度，不写死 0.5。
          opacity: isDisabled ? t['state.disabled-opacity'] : 1,
          // 🔴 按下反馈原来是**裸 `0.85`**（`check:design` 抓不到数字裸值的那一格），
          // 而同一文件里 `Checkbox`/`Fab` 用的是 `motion.press-scale`、`IconButton`
          // 用的是换底 —— 同一个"按下"三种机制。收成触屏那一档：缩放，读 token。
          transform: [
            { scale: pressed && !reducedMotion && !isDisabled ? t[CONTROL_STATE_TOKENS.pressScale] : 1 },
          ],
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
  testID = 'fab',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** 设备腿落点（同一个理由：`Pressable` 才进 AX 树）。 */
  testID?: string;
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
      testID={testID}
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
  illustration,
  title,
  hint,
  detail,
  detailTone = 'danger',
  testID,
}: {
  icon?: IconName;
  illustration?: StateIllustrationVariant;
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
  /**
   * 根节点的 `testID`。加它是因为"不是成员"这一类终态**需要被判据点到**
   * （`share-not-member` 就是 web 与移动端同名的那一枚）。
   */
  testID?: string;
}): React.JSX.Element {
  const t = useTokens();
  /**
   * 🔴 **判断走共享模型，markup 归本端**（R11 的 (B) 方案）。
   *
   * `toEmptyStateViewModel` 是"空态该画什么"的唯一判断（`title` 必填、空串
   * 归一成省略、档位决定要不要图形）；`<View>/<Text variant=…>` 这一套是
   * 本端的渲染器。与 `ux-principles.md` §1「判断只有一份，渲染器有两个」同形。
   *
   * ⚠️ **`size` 只能传 `page`**：它是唯一**允许**图形的档，而 kit 现状就画
   * 插画/图标。传 `section`/`line` 会让 `view.illustration` 变 `undefined`
   * ⇒ 图形那一段消失 ⇒ 9 个调用点的 DOM 变。
   *
   * ⚠️ **kit 的几何不属于任何一档**（`paddingHorizontal: space.8`=32、
   * `gap: space.2`=8，而 `page` 是 24/12）—— 这是**已知且接受**的：档位只驱动
   * 槽位判断，几何归各端渲染器。实测记在
   * `docs/plans/r11-states-audit-2026-11.md` §7.2。别把它"顺手对齐"到 24/12：
   * 那会一次改 9 屏的留白，且**没有任何判据会红**。
   *
   * ⚠️ **图标槽位仍由本端判"有没有"**：kit 收 `IconName`（名字），共享模型收
   * `HeytaIconData`（字形数据），两套词汇表不同（§7.2 第 4 条）。模型能判的
   * "这一档允不允许画图形"已经通过 `size` 传入；"具体画哪个字形"属于渲染器，
   * 所以下面那支 `icon !== undefined` 是**有意留下**的，不是漏收。
   */
  const view = toEmptyStateViewModel({
    title,
    hint,
    ...(detail === undefined ? {} : { detail }),
    ...(illustration === undefined ? {} : { illustration }),
    detailTone,
    size: 'page',
  });
  return (
    <View
      testID={testID}
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: t['space.16'],
        paddingHorizontal: t['space.8'],
        gap: t['space.2'],
      }}
    >
      {view.illustration !== undefined ? (
        <StateIllustration variant={view.illustration} />
      ) : icon !== undefined ? (
        <Icon name={icon} size="xl" color={t['color.foreground-subtle']} strokeWidth={1.5} />
      ) : null}
      <Text variant="section-title" tone="muted" style={{ textAlign: 'center' }}>
        {view.title}
      </Text>
      {/* `hint` 可省略 —— 模型把空串/纯空白归一成 `undefined`，那一行就不画。 */}
      {view.hint === undefined ? null : (
        <Text variant="row-meta" tone="subtle" style={{ textAlign: 'center' }}>
          {view.hint}
        </Text>
      )}
      {view.detail === undefined ? null : (
        <Text
          variant="caption"
          tone={view.detailTone}
          selectable={view.detailTone === 'danger'}
          style={{ textAlign: 'center' }}
        >
          {view.detail}
        </Text>
      )}
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
   *
   * `email-address` 是给换绑邮箱那几格加的：iOS 上它把 `@` 与 `.` 放在主键盘区，
   * 而默认键盘要用户去第二层找 —— 邮箱是唯一**不能填错**的那个字段（填错了
   * 收到的那封信就落在别人的地址里，而那张换绑请求两边都不生效）。
   * 这一档是纯追加：现有调用点一个都不改行为。
   */
  /**
   * 键盘类型。
   *
   * `number-pad` 是 2026-10-24 加的：数字字段（习惯目标、番茄钟时长）此前
   * **各屏手写 `<TextInput keyboardType="number-pad">`** —— 于是它们绕过了字段解剖
   * （没有标签、没有错误位、没有 `accessibilityLabel` 的统一写法）。
   * 把键盘类型收进这里之后，"数字字段"也是同一个 `TextField`。
   */
  keyboard?: 'default' | 'url' | 'email-address' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences';
  editable?: boolean;
  /** 字段下方的说明。传了就会占位，所以只在真有时才传。 */
  hint?: string;
  hintTone?: 'subtle' | 'danger';
  /**
   * 就地错误（2026-10-24 加）。
   *
   * 🔴 与 `hint` 的区别是**语义**不是颜色：错误出现时说明**让位**
   * （同一行只说一句话），并且它会带 `accessibilityLiveRegion="polite"`，
   * 读屏会念出来。判断来自共享层 `@heyta/ui#resolveFieldChrome` ——
   * 与 web 的 `FormField` 同一个函数，所以"错误优先"在两端不可能各说一套。
   *
   * ⚠️ 以前移动端的做法是把 `hint` 的色调改成 danger，那是**外观**层面的模拟：
   * 读屏不会播报，而且"说明"和"错误"会同时占两行。
   */
  error?: string;
  /**
   * 单行字段的**提交**通道：给了就在键盘上出现「完成」并回调一次。
   *
   * ⚠️ 不传时 `returnKeyType` 保持 RN 默认 —— 现有调用点（登录、凭据表单）
   * 一个都不许因为这次加参数而改变键盘形状。
   */
  onSubmitEditing?: () => void;
  /**
   * 失焦回调。**给"离开即提交"的字段用**（任务标题、备注都是这个模型：
   * 不打确认键，点别处就存）。
   */
  onBlur?: () => void;
  /** 这一格的可发现性标识（自动化取证用）。默认不出现。 */
  testID?: string;
  /**
   * 多行输入（粘贴 CSV、写长备注）。
   *
   * ⚠️ 单行输入框贴一大段多行文本时，**看得见的只有最后一行**，
   * 而用户会以为"粘进去的只有这一点" —— 这正是"导入只进来几条"的经典误判。
   */
  multiline?: boolean;
  /** 多行时的可见行数。只影响**最小高度**；内容更多时仍可滚动。 */
  lines?: number;
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
  error,
  onSubmitEditing,
  onBlur,
  testID,
  multiline = false,
  lines = 6,
}: TextFieldProps): React.JSX.Element {
  const t = useTokens();
  const text = useText();
  // 🔴 三件判断（错误优先 / 说明让位 / 必填星号）住在 `@heyta/ui#resolveFieldChrome`，
  //    与 web 的 `FormField` 共用同一个函数。这里只负责把它摆到 RN 原语上。
  const chrome = resolveFieldChrome({ hint, error }, 'stacked');

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
        multiline={multiline}
        // 只给多行时传：给单行传 numberOfLines 在 Android 上会把它变成多行。
        numberOfLines={multiline ? lines : undefined}
        accessibilityLabel={label}
        // 显式 `false` 而不是缺省：读屏不会替你清掉上一次的 invalid 状态。
        aria-invalid={chrome.invalid}
        aria-describedby={hint === undefined && error === undefined ? undefined : `${testID ?? 'field'}-message`}
        testID={testID}
        onSubmitEditing={onSubmitEditing}
        onBlur={onBlur}
        // 只有声明了提交通道才改键盘形状（现有调用点保持 RN 默认）。
        returnKeyType={onSubmitEditing === undefined ? undefined : 'done'}
        // cursorColor 是 TextInput 的 **prop**，不是 style —— 放进 style 会被静默忽略。
        cursorColor={t['color.primary']}
        style={[
          // ⚠️ 样式名必须**真实存在**于 `TEXT_STYLES`。我第一版写了 `'body'` ——
          // 表里没有这个名字（最接近的是 `row-title`），取到 `undefined`，
          // 输入框里的字会**完全看不见**，而且不报任何错。
          // `useText()` 返回的是**对象**，所以是属性取值 `text['row-title']`，
          // 不是函数调用。
          text['row-title'],
          {
            minHeight: multiline ? t['size.field-height'] * lines : t['size.field-height'],
            paddingHorizontal: t['size.field-padding-x'],
            // 多行时文字从**顶部**开始，并给一点上内边距；
            // 不设的话多行内容会在框里垂直居中，长文本看起来像"只有中间那几行"。
            ...(multiline
              ? { paddingTop: t['space.2'], textAlignVertical: 'top' as const }
              : {}),
            borderRadius: t['radius.md'],
            backgroundColor: t['color.surface'],
            color: t['color.foreground'],
            // 文本输入以光标表示编辑位置，不再叠加焦点边框。
            borderWidth: 0,
            opacity: editable ? 1 : t['state.disabled-opacity'],
          },
        ]}
      />
      {chrome.invalid ? (
        <Text
          variant="caption"
          tone="danger"
          nativeID={`${testID ?? 'field'}-message`}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : null}
      {chrome.showHint ? (
        <Text
          variant="caption"
          tone={hintTone === 'danger' ? 'danger' : 'subtle'}
          nativeID={`${testID ?? 'field'}-message`}
        >
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
 * 🔴 选中态使用主色底与反色文字表达，不再叠加边框：
 * `accessibilityState.selected` 同步保留给读屏，视觉上避免框中框。
 */
export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  color,
  tone = 'filled',
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
  color?: string;
  tone?: 'filled' | 'quiet';
  /**
   * 定位钩子。🔴 它必须**透到 Pressable 那一层**，不能留在包装节点上：
   * 真机载体是按无障碍节点找 id 的（iOS 走 `AXUniqueId`），挂在非可点的那一层
   * 会得到"元素在树里、按下去什么都不发生"。`verify-mobile-ios-ai.sh:185` 早就
   * 按这条通道写了 `ai-route-<功能>-<下标>`，而本组件当时**根本没有这个 prop**
   * （2026-10-16 现量：载体注释承诺的通道与实现不一致）—— 补的是实现，不是注释。
   */
  testID?: string;
}): React.JSX.Element {
  const t = useTokens();

  /**
   * 🔴 2026-11-15：选中态从**实心主色块**改成浅底 + 主色字。
   *
   * 产品负责人看专注屏的类型选择（专注 / 短休息 / 长休息）：选中那一枚是
   * 一整块 `color.primary`，与旁边的「开始专注」主按钮同色同重 —— 一屏两枚
   * "主按钮"，而它们一个是状态、一个是动作。日历档位那一组是同一个毛病
   *（`CalendarViewTabs` 同步改了）。
   *
   * 规则统一成一条：**选中 = 浅底 + 主色字；实心主色只给主操作。**
   * 同一屏里的 `TaskChoice` 选中行本来就是这个形状（`primary-subtle` 底）。
   */
  const fg = selected ? t['color.primary'] : t['color.foreground'];

  return (
    <Pressable
      testID={testID}
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
        borderWidth: 0,
        backgroundColor: tone === 'quiet'
          ? (pressed ? t['color.surface-sunken'] : 'transparent')
          : selected
          ? t['color.primary-subtle']
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

/**
 * 单选行列表（从 N 个里选 1 个）
 * ================================
 *
 * 🔴 **本文件里"选一个"只有这一个实现。** 想加第二种形态之前先读
 * `packages/design-system/src/choice-row-shape.ts` 顶部的事故记录：
 * 同一张面板里同时长出了圆形 Chip 与"选中就换 `tone` 的通栏 Button"，
 * 两组的左缘、行高、选中记号全都不一样，而三层门禁没有一层看得见。
 *
 * 形态（每一格都来自 `CHOICE_ROW_SHAPE` 契约，不是这里现编的）：
 *
 *   ┌ 16dp ─────────────────────────────── 16dp ┐
 *   │ 组标签（group-label）                      │
 *   │ 选项文字 ……………………………………… ✓（选中才有）│  ← 行高 touch-target.min
 *   │ 选项文字 ………………………………………          │
 *   └────────────────────────────────────────────┘
 *
 * 🔴 **选中态只许改"颜色 + 右侧记号"，不许改行高、底色、对齐、控件类型。**
 * 判据是 `scripts/check-selection-form.mjs`（选中态换形态 ⇒ 红）。
 *
 * ## 为什么行高是 44 而不是 60
 *
 * 60（`size.row-min-height`）是任务行：勾选框 + 标题 + 元信息，可能换行。
 * 单选行只有一行文字，44 是触控下限。用 60 会让 4 个选项吃掉半屏 ——
 * 「每屏都要滚」本身就是这一类排版问题的另一半。
 */
export function ChoiceRows<T extends string>({
  groupLabel,
  options,
  value,
  onChange,
  disabled = false,
  testID,
}: {
  /** 组标签（「视图」「日期显示」「排序方式」）。**同一张面板里要么都有、要么都没有。** */
  groupLabel?: string;
  /**
   * 选项。`color` 是**文字色**（例如优先级那四档各有自己的色槽）——
   * 它不改变行高、不换底色：颜色的唯一职责是"这一项属于哪个类别"，
   * 选中记号仍然是右侧的勾（§6b：选中态只许改颜色 + 记号）。
   */
  options: readonly { readonly key: T; readonly label: string; readonly color?: string }[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  testID?: string;
}): React.JSX.Element {
  const t = useTokens();

  return (
    <View
      testID={testID}
      style={{
        // 组标签属于它下面那一组，所以贴得近；组与组的间隔由**容器**给（groupGap）。
        gap: t[CHOICE_ROW_SHAPE.labelGap],
      }}
    >
      {groupLabel !== undefined ? (
        <Text variant={CHOICE_ROW_TEXT.groupLabel} tone="muted">
          {groupLabel}
        </Text>
      ) : null}
      <View
        accessibilityRole="radiogroup"
        style={{ gap: t[CHOICE_ROW_SHAPE.rowGap] }}
      >
        {options.map((option) => {
          const selected = option.key === value;
          return (
            <Pressable
              key={option.key}
              onPress={() => onChange(option.key)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={option.label}
              style={({ pressed }) => ({
                minHeight: t[CHOICE_ROW_SHAPE.minHeight],
                flexDirection: 'row',
                alignItems: 'center',
                gap: t[CHOICE_ROW_SHAPE.inlineGap],
                paddingHorizontal: t[CHOICE_ROW_SHAPE.rowInset],
                borderRadius: t['radius.sm'],
                backgroundColor: pressed ? t['color.surface-sunken'] : 'transparent',
                opacity: disabled ? t['state.disabled-opacity'] : 1,
              })}
            >
              <Text
                variant={CHOICE_ROW_TEXT.option}
                style={{
                  flex: 1,
                  // 选中优先级最高：它表达"当前是哪一档"。
                  // 有 `color` 的选项（优先级）在未选中时用自己的色槽，
                  // 选中时仍然让位给主色 —— 两个颜色通道同时说话，用户读不出哪个是选中。
                  color: selected ? t['color.primary'] : (option.color ?? t['color.foreground']),
                }}
              >
                {option.label}
              </Text>
              {selected ? (
                <Icon name="task.done" size={CHOICE_ROW_SHAPE.markerSize} color={t['color.primary']} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
