/**
 * 空态微场景（共享 · 六种语义）
 * ================================
 *
 * 空态需要一点“这里是什么”的视觉线索，但不能用一张巨大的插画把空白
 * 页面变成宣传页。默认使用离线内嵌的六种 AI 纸艺插画；加载失败时，
 * 用 Lucide 官方图标数据与少量 RN 图层恢复六种
 * 不同的紧凑场景：任务是清单，笔记是叠纸，习惯是记录点，日历是日期格，
 * 搜索是结果页，完成是成功勾选。文案仍由 `EmptyState` 单独负责。
 *
 * 动效只负责首次出现时把状态变化变得不突兀：一次、短、只动图形本身。
 * `motion="none"` 给搜索等频繁重挂载的空态使用，系统减弱动效时也直接
 * 呈现终态。卸载时停止动画，避免导航切换后仍回调旧节点。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Leaf,
  Search,
  StickyNote,
} from 'lucide';
import { HeytaIcon, type HeytaIconData } from '../icon/Icon.js';
import { useHeytaTokens, useHeytaUiTheme, useHeytaUiLocale } from '../theme.js';
import { selectStateArtwork, type StateIllustrationLocale } from './artwork.js';

export type { StateIllustrationLocale } from './artwork.js';

export type StateIllustrationVariant =
  | 'tasks'
  | 'notes'
  | 'habits'
  | 'calendar'
  | 'search'
  | 'complete';

export type StateIllustrationMotion = 'enter' | 'none';

export interface StateIllustrationProps {
  readonly variant: StateIllustrationVariant;
  /** 宿主把 `useI18n().locale` 传入；无文字图在两种语言下可共享同一 PNG。 */
  readonly locale?: StateIllustrationLocale;
  /** 搜索等高频空态可以关闭入场动画，避免每次输入重播。 */
  readonly motion?: StateIllustrationMotion;
  readonly testID?: string;
}

const ICONS: Record<StateIllustrationVariant, HeytaIconData> = {
  tasks: ClipboardList,
  notes: StickyNote,
  habits: Leaf,
  calendar: CalendarDays,
  search: Search,
  complete: CheckCircle2,
};

function makeStyles(tokens: ReturnType<typeof useHeytaTokens>) {
  const panel = {
    position: 'absolute' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: tokens['radius.lg'],
    borderWidth: tokens['border-width.thin'],
  };

  return StyleSheet.create({
    root: { width: tokens['space.16'], height: tokens['space.16'], alignItems: 'center', justifyContent: 'center' },
    panel,
    sheetBack: {
      ...panel,
      width: tokens['space.12'],
      height: tokens['space.8'],
      backgroundColor: tokens['color.surface-sunken'],
      borderColor: tokens['color.border'],
      transform: [{ translateX: tokens['space.2'] }, { translateY: tokens['space.1'] }],
    },
    sheetFront: {
      ...panel,
      width: tokens['space.12'],
      height: tokens['space.10'],
      backgroundColor: tokens['color.primary-subtle'],
      borderColor: tokens['color.primary'],
    },
    taskPanel: {
      ...panel,
      width: tokens['space.16'],
      height: tokens['space.12'],
      alignItems: 'stretch',
      padding: tokens['space.2'],
      backgroundColor: tokens['color.surface'],
      borderColor: tokens['color.border'],
    },
    taskRows: { gap: tokens['space.1'] },
    taskRow: { flexDirection: 'row', alignItems: 'center', gap: tokens['space.1'] },
    checkbox: {
      width: tokens['space.2'],
      height: tokens['space.2'],
      borderRadius: tokens['radius.sm'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.primary'],
    },
    line: { height: tokens['border-width.thick'], flex: 1, borderRadius: tokens['radius.full'], backgroundColor: tokens['color.border-strong'] },
    noteBack: {
      ...panel,
      width: tokens['space.12'],
      height: tokens['space.10'],
      backgroundColor: tokens['color.surface-sunken'],
      borderColor: tokens['color.border'],
      transform: [{ translateX: -tokens['space.2'] }, { translateY: tokens['space.2'] }],
    },
    noteFront: {
      ...panel,
      width: tokens['space.12'],
      height: tokens['space.10'],
      backgroundColor: tokens['color.primary-subtle'],
      borderColor: tokens['color.primary'],
      transform: [{ translateX: tokens['space.2'] }, { translateY: -tokens['space.1'] }],
    },
    habitPanel: {
      ...panel,
      width: tokens['space.16'],
      height: tokens['space.12'],
      flexDirection: 'row',
      gap: tokens['space.2'],
      backgroundColor: tokens['color.surface'],
      borderColor: tokens['color.border'],
    },
    habitRecords: { gap: tokens['space.1'] },
    habitRecordRow: { flexDirection: 'row', gap: tokens['space.1'] },
    habitDot: { width: tokens['space.2'], height: tokens['space.2'], borderRadius: tokens['radius.full'], backgroundColor: tokens['color.primary'] },
    habitDotMuted: { width: tokens['space.2'], height: tokens['space.2'], borderRadius: tokens['radius.full'], backgroundColor: tokens['color.primary-subtle-hover'] },
    calendarPanel: {
      ...panel,
      width: tokens['space.16'],
      height: tokens['space.12'],
      backgroundColor: tokens['color.surface'],
      borderColor: tokens['color.border'],
    },
    calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', width: tokens['space.12'], gap: tokens['space.1'], justifyContent: 'center' },
    calendarCell: { width: tokens['space.2'], height: tokens['space.2'], borderRadius: tokens['radius.sm'], backgroundColor: tokens['color.surface-sunken'] },
    calendarCellActive: { width: tokens['space.2'], height: tokens['space.2'], borderRadius: tokens['radius.sm'], backgroundColor: tokens['color.primary'] },
    searchBack: {
      ...panel,
      width: tokens['space.12'],
      height: tokens['space.10'],
      backgroundColor: tokens['color.surface-sunken'],
      borderColor: tokens['color.border'],
      transform: [{ translateX: -tokens['space.2'] }, { translateY: tokens['space.2'] }],
    },
    searchFront: {
      ...panel,
      width: tokens['space.12'],
      height: tokens['space.10'],
      backgroundColor: tokens['color.surface'],
      borderColor: tokens['color.primary'],
      transform: [{ translateX: tokens['space.2'] }, { translateY: -tokens['space.1'] }],
    },
    searchLine: { width: tokens['space.8'], height: tokens['border-width.thick'], borderRadius: tokens['radius.full'], backgroundColor: tokens['color.border-strong'], marginTop: tokens['space.1'] },
    completePanel: {
      ...panel,
      width: tokens['space.16'],
      height: tokens['space.12'],
      backgroundColor: tokens['color.success-subtle'],
      borderColor: tokens['color.success-strong'],
    },
    particle: { position: 'absolute', width: tokens['space.2'], height: tokens['space.2'], borderRadius: tokens['radius.full'], backgroundColor: tokens['color.success-strong'] },
    particleOne: { transform: [{ translateX: -tokens['space.8'] }, { translateY: -tokens['space.6'] }] },
    particleTwo: { transform: [{ translateX: tokens['space.8'] }, { translateY: -tokens['space.2'] }] },
    particleThree: { transform: [{ translateX: tokens['space.6'] }, { translateY: tokens['space.6'] }] },
  });
}

function TaskScene({ styles }: { styles: ReturnType<typeof makeStyles> }): React.JSX.Element {
  return (
    <View style={styles.taskPanel}>
      <View style={styles.taskRows}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={styles.taskRow}>
            <View style={styles.checkbox} />
            <View style={[styles.line, row === 2 ? { flex: 0.55 } : undefined]} />
          </View>
        ))}
      </View>
    </View>
  );
}

function NoteScene({ styles, tokens }: { styles: ReturnType<typeof makeStyles>; tokens: ReturnType<typeof useHeytaTokens> }): React.JSX.Element {
  return <View style={styles.root}><View style={styles.noteBack} /><View style={styles.noteFront}><HeytaIcon data={ICONS.notes} size={tokens['icon.lg']} color={tokens['color.primary']} strokeWidth={1.5} /></View></View>;
}

function HabitScene({ styles, tokens }: { styles: ReturnType<typeof makeStyles>; tokens: ReturnType<typeof useHeytaTokens> }): React.JSX.Element {
  return (
    <View style={styles.habitPanel}>
      <View style={styles.habitRecords}>
        <View style={styles.habitRecordRow}><View style={styles.habitDot} /><View style={styles.habitDot} /></View>
        <View style={styles.habitRecordRow}><View style={styles.habitDot} /><View style={styles.habitDotMuted} /></View>
      </View>
      <HeytaIcon data={ICONS.habits} size={tokens['icon.sm']} color={tokens['color.primary']} strokeWidth={1.5} />
    </View>
  );
}

function CalendarScene({ styles, tokens }: { styles: ReturnType<typeof makeStyles>; tokens: ReturnType<typeof useHeytaTokens> }): React.JSX.Element {
  return <View style={styles.calendarPanel}><HeytaIcon data={ICONS.calendar} size={tokens['icon.sm']} color={tokens['color.primary']} strokeWidth={1.5} /><View style={styles.calendarGrid}>{[0, 1, 2, 3, 4, 5].map((cell) => <View key={cell} style={cell === 3 ? styles.calendarCellActive : styles.calendarCell} />)}</View></View>;
}

function SearchScene({ styles, tokens }: { styles: ReturnType<typeof makeStyles>; tokens: ReturnType<typeof useHeytaTokens> }): React.JSX.Element {
  return <View style={styles.root}><View style={styles.searchBack} /><View style={styles.searchFront}><HeytaIcon data={ICONS.search} size={tokens['icon.lg']} color={tokens['color.primary']} strokeWidth={1.5} /><View style={styles.searchLine} /></View></View>;
}

function CompleteScene({ styles, tokens }: { styles: ReturnType<typeof makeStyles>; tokens: ReturnType<typeof useHeytaTokens> }): React.JSX.Element {
  return <View style={styles.root}><View style={[styles.particle, styles.particleOne]} /><View style={[styles.particle, styles.particleTwo]} /><View style={[styles.particle, styles.particleThree]} /><View style={styles.completePanel}><HeytaIcon data={ICONS.complete} size={tokens['icon.lg']} color={tokens['color.success-strong']} strokeWidth={1.5} /></View></View>;
}

/** 语义空态插画：只画图形层，文案由 `EmptyState` 单独负责。 */
export function StateIllustration({ variant, locale, motion = 'enter', testID }: StateIllustrationProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const { reducedMotion, native } = useHeytaUiTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const progress = useRef(new Animated.Value(1)).current;
  const [failedVariant, setFailedVariant] = useState<StateIllustrationVariant | null>(null);
  const animate = motion === 'enter' && !reducedMotion;
  const inheritedLocale = useHeytaUiLocale();
  const artwork = selectStateArtwork(locale ?? inheritedLocale, variant);

  useEffect(() => {
    if (!animate) {
      progress.stopAnimation();
      progress.setValue(1);
      return undefined;
    }

    const easing = native.easing('ease.enter');
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: tokens['duration.fast'],
      easing: easing === null ? Easing.linear : Easing.bezier(...easing),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [animate, native, progress, tokens]);

  let scene: React.JSX.Element;
  switch (variant) {
    case 'tasks': scene = <TaskScene styles={styles} />; break;
    case 'notes': scene = <NoteScene styles={styles} tokens={tokens} />; break;
    case 'habits': scene = <HabitScene styles={styles} tokens={tokens} />; break;
    case 'calendar': scene = <CalendarScene styles={styles} tokens={tokens} />; break;
    case 'search': scene = <SearchScene styles={styles} tokens={tokens} />; break;
    case 'complete': scene = <CompleteScene styles={styles} tokens={tokens} />; break;
  }

  return (
    <Animated.View
      aria-hidden={true}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID ?? `state-illustration-${variant}`}
      style={[styles.root, {
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [tokens['space.2'], 0] }) },
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [tokens['motion.press-scale'], 1] }) },
        ],
      }]}
    >
      {failedVariant === variant ? scene : (
        <Image
          source={{ uri: artwork }}
          style={styles.root}
          resizeMode="contain"
          accessible={false}
          onError={() => setFailedVariant(variant)}
          testID={`state-artwork-${variant}`}
        />
      )}
    </Animated.View>
  );
}
