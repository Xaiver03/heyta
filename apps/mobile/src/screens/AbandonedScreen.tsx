/**
 * 「已放弃」出口 —— ADR-0083 §4.3 要求的那一档
 * ============================================
 *
 * ## 为什么必须有这一张屏
 *
 * 「放弃」被做成了**第五态**：任务还活着、没被删除，但不出现在任何列表里
 * （隐藏由动作层的分裂出口负责，不归调用方 filter —— ADR-0048 的 I5）。
 *
 * 🔴 一个只进不出的抽屉是**缺陷**，不是极简设计。没有这一屏，用户点过「放弃」
 * 之后想反悔，唯一的办法是改本地数据库 —— 而"放弃"这个词本身就承诺了
 * "我先不要它，但它还在"。所以那条 ADR 把出口和状态**同批**交付。
 *
 * ## 为什么它不长成回收站那样
 *
 * `TrashScreen` 列的是**墓碑**（`deletedAt`），动作是"还原"与"彻底删除"；
 * 这一屏列的是**活着但被隐藏**的任务，动作只有一个：恢复
 * （`setAbandoned(id, false)`）。两件事塞进一张屏的代价是用户得自己分辨
 * "我上次是删了还是放弃了"，而它们的后果完全不同（前者有窗口，后者一直在那儿）。
 * 所以这里**不给删除**：要删就回到那条任务自己的行菜单或详情里去 ——
 * 一个目的地只允许一个控件。
 *
 * ## 🔴 取数只有一条路
 *
 * 这一屏读 `taskActions.listAbandonedTasks()`，**不是** `listTasks()` 再自己
 * filter 一遍。后者正是 I5 拦的形状，症状是"同一份数据两端给出不同答案，
 * 且都不报错"：动作层哪天改动"什么算已放弃"，这里这份 filter 就成了第二份裁决。
 */

import { createTaskActions, type AppHost, type TaskActions } from '@heyta/app-host';
import type { Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { openTaskHost } from '../db/open-host';
import { formatStamp } from '../lib/date';
import { useMobileSync } from '../sync/store';
import { Button, EmptyState, HStack, Screen, Stack, Text } from '../ui/kit';

const growStyle = { flex: 1 };

export function AbandonedScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 🔴 与回收站同一条：`dataRevision` 是**本地写入 / 同步完成**的信号。
   * 少了它，在另一台设备上恢复一条之后切回本屏，列表还停在旧的那一份上，
   * 用户看到的是"我明明恢复了，它还在这儿"。
   */
  const { dataRevision } = useMobileSync();

  const [host, setHost] = useState<AppHost | null>(null);
  const [items, setItems] = useState<Task[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    openTaskHost()
      .then((next) => {
        if (alive) setHost(next);
      })
      .catch((cause: unknown) => {
        // 打不开本地库要说出来。静默的空列表会被读成"没有被放弃的任务" ——
        // 那是把一次故障念成一条关于用户数据的结论。
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      alive = false;
    };
  }, []);

  const taskActions = useMemo<TaskActions | null>(
    () => (host === null ? null : createTaskActions(host)),
    [host],
  );

  const refresh = useCallback(() => {
    if (taskActions === null) {
      setItems([]);
      return;
    }
    // 分裂出口：一次调用就拿到"只含已放弃（且未删除）"的那一路，顺序也由它定。
    setItems(taskActions.listAbandonedTasks());
  }, [taskActions]);

  useEffect(() => {
    refresh();
  }, [refresh, dataRevision]);

  const restore = (id: string): void => {
    if (taskActions === null) return;
    setBusyId(id);
    setError(undefined);
    void taskActions
      .setAbandoned(id, false)
      .then(refresh)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setBusyId(null);
      });
  };

  return (
    <Screen
      title={t('mobile.abandoned.title')}
      actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
    >
      <Stack gap="default">
        {error === undefined ? null : (
          <Text variant="caption" tone="danger" selectable testID="abandoned-error">
            {error}
          </Text>
        )}

        {items.length === 0 ? (
          // 🔴 空态走共享的 `EmptyState`，不在这里手写骨架与文案
          // （`check:empty-state` 的断言 B：新的手写空态会红；"空态只有一个"）。
          // 第二句说的是"东西怎么进来的"，不是再说一遍"这里空着"。
          <EmptyState
            icon="task.abandon"
            title={t('mobile.abandoned.empty')}
            hint={t('mobile.abandoned.emptyHint')}
            testID="abandoned-empty"
          />
        ) : (
          <>
            {/* 有内容时那句解释才有意义：它说的是"这一屏里的东西没被删除"，
                空着的时候没有东西可解释。 */}
            <Text variant="caption" tone="subtle" testID="abandoned-hint">
              {t('mobile.abandoned.hint')}
            </Text>
            <Text variant="caption" tone="subtle" testID="abandoned-count">
              {t('mobile.abandoned.count', { count: items.length })}
            </Text>
          </>
        )}

        {items.map((task) => (
          <HStack key={task.id} align="center" gap="default">
            <View style={growStyle}>
              <Text variant="row-title" numberOfLines={2}>
                {task.title}
              </Text>
              {/* 放弃的时刻用来认出是哪一个。`abandonedAt` 在这一路上恒有值
                  （分裂出口保证的），那个 `=== undefined` 分支是给类型看的，
                  不是给"可能没有"留的余地。 */}
              {task.abandonedAt === undefined ? null : (
                <Text variant="row-meta" tone="subtle">
                  {t('mobile.abandoned.at', { date: formatStamp(task.abandonedAt) })}
                </Text>
              )}
            </View>
            <Button
              label={t('mobile.trash.restore')}
              tone="secondary"
              disabled={busyId === task.id}
              testID={`abandoned-restore-${task.id}`}
              onPress={() => {
                restore(task.id);
              }}
            />
          </HStack>
        ))}
      </Stack>
    </Screen>
  );
}
