/**
 * 日历「显示范围」面板（移动端）
 * ==============================
 *
 * 出处：滴答清单的双层日历页 —— `⋯ → 显示范围` 打开一页**整屏清单选择**：
 * 顶部 `✕ / 显示范围 / ✓`，下面两组卡片（「所有」「指派给我」），再下面
 * 是全部清单（每行一个 emoji + 名称）。
 *
 * 产品负责人 2026-11-16：「日历界面的筛选组件和筛选 UX，我觉得滴答清单做得好太多了」。
 * 实测那份面板的三条关键形状（照结构，不抄参数）：
 *
 * 1. **不是即时生效**：勾选只是暂存，右上 ✓ 才落定、左上 ✕ 取消。
 *    这条比"点一下立刻筛"重要 —— 多选清单时用户会连续点几个，即时生效会让
 *    日历在他手底下反复重排（翻月的位置会跳）。
 * 2. **「所有」与具体清单互斥**：选了「所有」就没有具体项，选了具体项就离开「所有」。
 * 3. **一行一个清单，行高一致**；选中的行右侧一枚勾（与菜单同一个选中语汇）。
 *
 * 我们这一版没有「指派给我」（heyta 没有"指派"这个语义），其余照做。
 */

import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useI18n } from '@heyta/i18n';

import { Icon } from '../ui/icons';
import { Text } from '../ui/kit';
import { useTokens } from '../theme';

/**
 * 「收集箱」在筛选里是一个**伪清单**：它是"没有清单"的那些任务（`projectId === undefined`）。
 * 用一个不可能与真清单 id 撞的保留值，避免在 `scope` 里多存一个 `undefined` 语义。
 */
export const SCOPE_INBOX = '__inbox__';

/**
 * 「按象限筛」在同一个 `scope` 数组里的编码：`q:1` … `q:4`。
 *
 * 🔴 为什么不把 `scope` 改成 `{ projects, quadrants }` 对象：
 * 那要同步改菜单的"当前值"文案、过滤、以及将来持久化的形状，
 * 而两者在**语义上本来就是同一件事**（"我只看这些"的并集）。
 * 用前缀编码，过滤处一次 `startsWith('q:')` 就分得开。
 */
export const SCOPE_QUADRANT_PREFIX = 'q:';

/** 一个可显示的清单（面板只关心 id / 名称 / 颜色点）。 */
export interface ScopeProject {
  readonly id: string;
  readonly name: string;
}

export interface CalendarScopeSheetProps {
  readonly visible: boolean;
  readonly projects: readonly ScopeProject[];
  /** `undefined` = 所有清单（不筛）。 */
  readonly selected: readonly string[] | undefined;
  /** 四个象限的名字（按 `Quadrant` 的顺序给出，值与 `SCOPE_QUADRANT_PREFIX` 拼）。 */
  readonly quadrants: readonly { readonly id: string; readonly label: string }[];
  readonly onCancel: () => void;
  readonly onConfirm: (next: readonly string[] | undefined) => void;
}

export function CalendarScopeSheet({
  visible,
  projects,
  quadrants,
  selected,
  onCancel,
  onConfirm,
}: CalendarScopeSheetProps): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  /** 暂存：面板里点什么都不落定，等 ✓ 才交给宿主。 */
  const [draft, setDraft] = useState<readonly string[] | undefined>(selected);

  /**
   * 🔴 每次重新打开都把草稿重置成宿主当前值。
   *
   * 不重置的后果：上次点了几个清单按 ✕ 取消，下次再打开仍是那几个勾 ——
   * 面板显示的东西和日历实际的筛选不一致，而这一层不会有任何报错。
   */
  const [lastVisible, setLastVisible] = useState(visible);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) setDraft(selected);
  }

  const all = draft === undefined;
  const toggle = (id: string): void => {
    if (all) {
      setDraft([id]);
      return;
    }
    const next = draft.includes(id) ? draft.filter((x) => x !== id) : [...draft, id];
    // 全部取消 = 回到「所有」（否则会剩一份"什么都不显示"的空日历，看着像坏了）。
    setDraft(next.length === 0 ? undefined : next);
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        scrim: { flex: 1, backgroundColor: tokens['color.background'] },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.3'],
          paddingHorizontal: tokens['space.4'],
          paddingTop: tokens['space.6'],
          paddingBottom: tokens['space.4'],
        },
        headerTitle: { flex: 1 },
        card: {
          backgroundColor: tokens['color.surface'],
          borderRadius: tokens['radius.lg'],
          marginHorizontal: tokens['space.4'],
          marginBottom: tokens['space.4'],
          overflow: 'hidden',
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.3'],
          minHeight: tokens['touch-target.min'],
          paddingHorizontal: tokens['space.4'],
          paddingVertical: tokens['space.3'],
        },
        rowLabel: { flex: 1 },
        divider: {
          height: StyleSheet.hairlineWidth,
          backgroundColor: tokens['color.border'],
          marginStart: tokens['space.4'],
        },
      }),
    [],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} accessibilityViewIsModal>
      <View style={styles.scrim}>
        <View style={styles.header}>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel={t('mobile.calendar.scope.cancel')}
            hitSlop={tokens['space.2']}
            testID="calendar-scope-cancel"
          >
            <Icon name="action.close" size="md" color={tokens['color.foreground']} />
          </Pressable>
          <View style={styles.headerTitle}>
            <Text variant="section-title">{t('mobile.calendar.scope.title')}</Text>
          </View>
          <Pressable
            onPress={() => {
              onConfirm(draft);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('mobile.calendar.scope.confirm')}
            hitSlop={tokens['space.2']}
            testID="calendar-scope-confirm"
          >
            <Icon name="action.keep" size="md" color={tokens['color.primary']} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: tokens['space.4'] }}>
          <View style={styles.card}>
            <Pressable
              style={styles.row}
              onPress={() => {
                setDraft(undefined);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: all }}
              testID="calendar-scope-all"
            >
              <Icon name="group.inbox" size="sm" color={tokens['color.foreground-subtle']} />
              <Text style={styles.rowLabel}>{t('mobile.calendar.scope.all')}</Text>
              {all ? (
                <Icon name="action.keep" size="sm" color={tokens['color.primary']} />
              ) : null}
            </Pressable>
          </View>

          <View style={styles.card}>
            {quadrants.map((quadrant, index) => {
              const on = draft?.includes(quadrant.id) === true;
              return (
                <View key={quadrant.id}>
                  {index === 0 ? null : <View style={styles.divider} />}
                  <Pressable
                    style={styles.row}
                    onPress={() => {
                      toggle(quadrant.id);
                    }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    testID={`calendar-scope-${quadrant.id}`}
                  >
                    <Text style={styles.rowLabel}>{quadrant.label}</Text>
                    {on ? (
                      <Icon name="action.keep" size="sm" color={tokens['color.primary']} />
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </View>

          <View style={styles.card}>
            {(() => {
              const on = draft?.includes(SCOPE_INBOX) === true;
              return (
                <Pressable
                  style={styles.row}
                  onPress={() => {
                    toggle(SCOPE_INBOX);
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  testID="calendar-scope-inbox"
                >
                  <Icon name="group.inbox" size="sm" color={tokens['color.foreground-subtle']} />
                  <Text style={styles.rowLabel}>{t('mobile.tasks.group.inbox')}</Text>
                  {on ? <Icon name="action.keep" size="sm" color={tokens['color.primary']} /> : null}
                </Pressable>
              );
            })()}
            {projects.map((project, index) => {
              const on = draft?.includes(project.id) === true;
              return (
                <View key={project.id}>
                  <View style={styles.divider} />
                  <Pressable
                    style={styles.row}
                    onPress={() => {
                      toggle(project.id);
                    }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    testID={`calendar-scope-project-${project.id}`}
                  >
                    <Text style={styles.rowLabel}>{project.name}</Text>
                    {on ? (
                      <Icon name="action.keep" size="sm" color={tokens['color.primary']} />
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
