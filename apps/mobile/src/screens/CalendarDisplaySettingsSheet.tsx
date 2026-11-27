/**
 * 日历「显示设置」弹窗。
 * 四组圆角白色卡片：颜色维度、样式、显示内容、辅助时区。
 * 只有「显示专注记录」和「辅助时区」两行带 ? 按钮，提示按需展开。
 */
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@heyta/i18n';

import { Text } from '../ui/kit';
import { useTokens } from '../theme';
import {
  DEFAULT_MOBILE_DISPLAY_OPTIONS,
  setDisplayMode,
  toggleDisplayOption,
  type MobileCalendarColorMode,
  type MobileCalendarDisplayFlag,
  type MobileCalendarDisplayOptions,
  type MobileCalendarStyle,
} from './calendar-display-model';

type TipId = 'focus' | 'timezone';

interface ToggleRow {
  readonly flag: MobileCalendarDisplayFlag;
  readonly label: string;
  readonly tipId?: TipId;
  readonly tip?: string;
}

export interface CalendarDisplaySettingsSheetProps {
  readonly visible: boolean;
  readonly options?: MobileCalendarDisplayOptions;
  readonly onChange: (next: MobileCalendarDisplayOptions) => void;
  readonly onClose: () => void;
}

export function CalendarDisplaySettingsSheet({
  visible,
  options = DEFAULT_MOBILE_DISPLAY_OPTIONS,
  onChange,
  onClose,
}: CalendarDisplaySettingsSheetProps): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const [expandedTip, setExpandedTip] = useState<TipId | null>(null);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, justifyContent: 'flex-end' },
        backdrop: {
          ...StyleSheet.absoluteFillObject,
          backgroundColor: tokens['color.overlay'],
        },
        sheet: {
          maxHeight: '88%',
          backgroundColor: tokens['color.grouped-background'],
          borderTopStartRadius: tokens['radius.dialog'],
          borderTopEndRadius: tokens['radius.dialog'],
          paddingTop: tokens['space.2'],
        },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.2'],
          minHeight: tokens['touch-target.min'],
          paddingHorizontal: tokens['space.4'],
        },
        headerTitle: {
          flex: 1,
          color: tokens['color.foreground'],
        },
        close: {
          minHeight: tokens['touch-target.min'],
          justifyContent: 'center',
          paddingHorizontal: tokens['space.1'],
        },
        closeLabel: { color: tokens['color.primary'] },
        scroll: { flexShrink: 1 },
        content: {
          gap: tokens['space.3'],
          paddingHorizontal: tokens['space.4'],
          paddingTop: tokens['space.2'],
          paddingBottom: insets.bottom + tokens['space.4'],
        },
        card: {
          backgroundColor: tokens['color.surface'],
          borderRadius: tokens['radius.lg'],
          overflow: 'hidden',
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.3'],
          minHeight: tokens['touch-target.min'],
          paddingHorizontal: tokens['space.4'],
          paddingVertical: tokens['space.2'],
        },
        rowLabel: { flex: 1, color: tokens['color.foreground'] },
        divider: {
          height: tokens['border-width.thin'],
          backgroundColor: tokens['color.border-subtle'],
          marginStart: tokens['space.4'],
        },
        segments: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.1'],
          padding: tokens['space.1'],
          borderRadius: tokens['radius.md'],
          backgroundColor: tokens['color.grouped-background'],
        },
        segment: {
          minHeight: tokens['touch-target.min'],
          justifyContent: 'center',
          paddingHorizontal: tokens['space.3'],
          borderRadius: tokens['radius.md'],
        },
        segmentActive: { backgroundColor: tokens['color.primary'] },
        segmentLabel: { color: tokens['color.foreground-muted'] },
        segmentLabelActive: { color: tokens['color.on-primary'] },
        tipButton: {
          width: tokens['space.6'],
          height: tokens['space.6'],
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: tokens['radius.md'],
          backgroundColor: tokens['color.primary-subtle'],
        },
        tipMark: { color: tokens['color.primary'] },
        tip: {
          color: tokens['color.foreground-muted'],
          paddingHorizontal: tokens['space.4'],
          paddingBottom: tokens['space.3'],
        },
      }),
    [insets.bottom, tokens],
  );

  const close = (): void => {
    setExpandedTip(null);
    onClose();
  };

  const applyFlag = (flag: MobileCalendarDisplayFlag): void => {
    onChange(toggleDisplayOption(options, flag));
  };

  const chooseColorMode = (mode: MobileCalendarColorMode): void => {
    onChange(setDisplayMode(options, mode));
  };

  const chooseStyle = (style: MobileCalendarStyle): void => {
    onChange({ ...options, style });
  };

  const toggleTip = (tip: TipId): void => {
    setExpandedTip((current) => (current === tip ? null : tip));
  };

  const colorModes: readonly { readonly value: MobileCalendarColorMode; readonly label: string }[] = [
    { value: 'byProject', label: t('web.calendar.display.colorByProject') },
    { value: 'byQuadrant', label: t('web.calendar.display.colorByQuadrant') },
  ];

  const styleModes: readonly { readonly value: MobileCalendarStyle; readonly label: string }[] = [
    { value: 'classic', label: t('web.calendar.display.styleClassic') },
    { value: 'modern', label: t('web.calendar.display.styleModern') },
  ];

  const toggleRows: readonly ToggleRow[] = [
    { flag: 'showChecklist', label: t('web.calendar.display.showChecklist') },
    { flag: 'showAllRepeats', label: t('web.calendar.display.showAllRepeats') },
    { flag: 'showHabits', label: t('web.calendar.display.showHabits') },
    {
      flag: 'showFocus',
      label: t('web.calendar.display.showFocus'),
      tipId: 'focus',
      tip: t('web.calendar.display.showFocusTip'),
    },
    { flag: 'showCourses', label: t('web.calendar.display.showCourses') },
    { flag: 'showCompleted', label: t('web.calendar.more.showCompleted') },
    { flag: 'showCountdown', label: t('web.calendar.more.showCountdown') },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent
      testID="calendar-display-sheet-modal"
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t('web.calendar.display.close')}
          testID="calendar-display-backdrop"
        />
        <View style={styles.sheet} testID="calendar-display-sheet">
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('web.calendar.display.title')}</Text>
            <Pressable
              style={styles.close}
              onPress={close}
              accessibilityRole="button"
              testID="calendar-display-close"
            >
              <Text style={styles.closeLabel}>{t('web.calendar.display.close')}</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t('web.calendar.display.color')}</Text>
                <View style={styles.segments}>
                  {colorModes.map((mode) => {
                    const active = options.colorMode === mode.value;
                    return (
                      <Pressable
                        key={mode.value}
                        style={[styles.segment, active ? styles.segmentActive : null]}
                        onPress={() => chooseColorMode(mode.value)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        testID={`calendar-display-color-${mode.value}`}
                      >
                        <Text
                          style={[styles.segmentLabel, active ? styles.segmentLabelActive : null]}
                        >
                          {mode.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t('web.calendar.display.style')}</Text>
                <View style={styles.segments}>
                  {styleModes.map((mode) => {
                    const active = options.style === mode.value;
                    return (
                      <Pressable
                        key={mode.value}
                        style={[styles.segment, active ? styles.segmentActive : null]}
                        onPress={() => chooseStyle(mode.value)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        testID={`calendar-display-style-${mode.value}`}
                      >
                        <Text
                          style={[styles.segmentLabel, active ? styles.segmentLabelActive : null]}
                        >
                          {mode.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>

            <View style={styles.card}>
              {toggleRows.map((row, index) => {
                const expanded = row.tipId !== undefined && expandedTip === row.tipId;
                return (
                  <View key={row.flag}>
                    {index === 0 ? null : <View style={styles.divider} />}
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>{row.label}</Text>
                      {row.tipId === undefined ? null : (
                        <Pressable
                          style={styles.tipButton}
                          hitSlop={tokens['space.2']}
                          onPress={() => toggleTip(row.tipId as TipId)}
                          accessibilityRole="button"
                          accessibilityState={{ expanded }}
                          accessibilityLabel={row.label}
                          testID={`calendar-display-tip-${row.tipId}`}
                        >
                          <Text style={styles.tipMark}>?</Text>
                        </Pressable>
                      )}
                      <Switch
                        value={options[row.flag]}
                        onValueChange={() => applyFlag(row.flag)}
                        trackColor={{
                          false: tokens['color.border'],
                          true: tokens['color.primary'],
                        }}
                        thumbColor={tokens['color.surface']}
                        ios_backgroundColor={tokens['color.border']}
                        accessibilityLabel={row.label}
                        testID={`calendar-display-${row.flag}`}
                      />
                    </View>
                    {expanded && row.tip !== undefined ? (
                      <Text style={styles.tip}>{row.tip}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>

            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t('web.calendar.display.secondaryTimezone')}</Text>
                <Pressable
                  style={styles.tipButton}
                  hitSlop={tokens['space.2']}
                  onPress={() => toggleTip('timezone')}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: expandedTip === 'timezone' }}
                  accessibilityLabel={t('web.calendar.display.secondaryTimezone')}
                  testID="calendar-display-tip-timezone"
                >
                  <Text style={styles.tipMark}>?</Text>
                </Pressable>
                <Switch
                  value={options.secondaryTimezone}
                  onValueChange={() => applyFlag('secondaryTimezone')}
                  trackColor={{
                    false: tokens['color.border'],
                    true: tokens['color.primary'],
                  }}
                  thumbColor={tokens['color.surface']}
                  ios_backgroundColor={tokens['color.border']}
                  accessibilityLabel={t('web.calendar.display.secondaryTimezone')}
                  testID="calendar-display-secondaryTimezone"
                />
              </View>
              {expandedTip === 'timezone' ? (
                <Text style={styles.tip}>{t('web.calendar.display.secondaryTimezoneTip')}</Text>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
