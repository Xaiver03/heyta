/**
 * 「回收站」—— 移动端的删除后悔药
 * ==================================
 *
 * 删除一直是**软删除 + 墓碑**（`DEL` op → `deletedAt`），所以数据从来没丢 ——
 * 丢的是**看见它的入口**。任务页的删除按钮旁边没有任何恢复途径，
 * 用户误删之后只能看着它从所有视图里消失，而墓碑还在往每台设备同步。
 *
 * 这一屏补两件事：
 *   1. **看见 + 恢复** —— 走 `TaskActions.restore`，它写一条
 *      `UPD { deletedAt: null }`，所以恢复是**可同步的**：另一台设备回放后
 *      条目也回来，不是只改了本地的界面。
 *   2. **彻底删除** —— 一个**二次确认**后的不可逆动作（`purgedAt` 标记）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这一屏**不拼 op**、也不直接改 `entities`（AGENTS.md §3.5 / D4）：
 * 所有写操作都经 `@heyta/app-host` 的 `TaskActions` 与 `NoteActions`。
 * 这里只做两件事：收集用户意图、以及把"要不要确认"这个纯交互状态摆在界面上。
 *
 * 🔴 W4 之后这一屏有**四路数据源**（任务 / 便签 / 清单 / 习惯），而"怎么并、
 * 怎么排、每行显示什么字"不在这份文件里判 —— 那是共享的 `toTrashItems()`
 *（Web 同一份）。这里只按 `kind` 把动作路由到对应的动作层，
 * 而且路由表是 `Record<TrashKind, …>`：少一路**编译不过**，
 * 不像原先那个 `kind === 'NOTE' ? … : …` 的三元 —— 它会安静地把新增的
 * 那两类变成"列表里有它、点还原什么都不发生"。
 *
 * 🔴 **诚实条款**：`purge` 只追加 `purgedAt`，墓碑与 op 载荷都留着
 * （`packages/op-log/src/state.ts`），本地与云端的历史里仍然有这条记录。
 * 也就是说它关闭的是"恢复"这条路和"回收站里继续看得到"，
 * **不是物理擦除历史**。确认框里那一句（`mobile.trash.confirm.notErasure`）
 * 是承重的，不是装饰 —— Web 端现在的措辞没有它，这里刻意不照抄。
 *
 * ⚠️ 本屏是「我的」下面的**第二层**，不是第 6 个底部标签：标签栏必须保持 5 个
 * （与 `GrowthScreen` 同一条纪律）。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, View } from 'react-native';

import {
  createHabitActions,
  createNoteActions,
  createProjectActions,
  createTaskActions,
  type AppHost,
  type HabitActions,
  type NoteActions,
  type ProjectActions,
  type TaskActions,
} from '@heyta/app-host';
import {
  liveTaskCountOfProject,
  toTrashItems,
  type TrashItem,
  type TrashKind,
} from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  entityLabelOf,
  TrashBoard,
  type TrashBoardLabels,
} from '@heyta/ui';

import { openTaskHost } from '../db/open-host';
import {
  deletedAtText,
  pendingPurge,
  purgeA11y,
  purgeConfirmCopy,
  purgeImpactText,
  restoreA11y,
} from '../lib/trash-display';
import { useMobileSync } from '../sync/store';
import { useTheme, useTokens } from '../theme';
import { Button, Screen, Text } from '../ui/kit';
import { Icon } from '../ui/icons';

export function TrashScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 🔴 `dataRevision` 是**本地写入 / 同步完成**的信号。少了它，
   * 在另一台设备恢复条目后切回本屏会一直显示旧列表（与成长屏同一条）。
   */
  const { dataRevision } = useMobileSync();

  const [host, setHost] = useState<AppHost | null>(null);
  const [items, setItems] = useState<TrashItem[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    openTaskHost()
      .then((next) => {
        if (alive) setHost(next);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const taskActions = useMemo<TaskActions | null>(
    () => (host === null ? null : createTaskActions(host)),
    [host],
  );
  const noteActions = useMemo<NoteActions | null>(
    () => (host === null ? null : createNoteActions(host)),
    [host],
  );
  const projectActions = useMemo<ProjectActions | null>(
    () => (host === null ? null : createProjectActions(host)),
    [host],
  );
  const habitActions = useMemo<HabitActions | null>(
    () => (host === null ? null : createHabitActions(host)),
    [host],
  );

  const refresh = useCallback(() => {
    if (taskActions === null || noteActions === null || projectActions === null || habitActions === null) {
      setItems([]);
      return;
    }
    // ⚠️ 两个 `listTrashed()` 都是**同步**的（读的是已物化的内存状态），不是 Promise。
    // 🔴 并成一路 + 排序**不在这里做**：规则在 `@heyta/domain` 的 `toTrashItems()`，
    // 与 Web 端同一份（两端各排一次就是"手机上任务在前、网页上便签在前"）。
    setItems(
      toTrashItems({
        tasks: taskActions.listTrashed(),
        notes: noteActions.listTrashed(),
        projects: projectActions.listTrashedProjects(),
        habits: habitActions.listTrashedHabits(),
      }),
    );
  }, [taskActions, noteActions, projectActions, habitActions]);

  useEffect(() => {
    refresh();
  }, [refresh, dataRevision]);

  const pending = pendingPurge(items, confirmingId);

  /**
   * 条目在确认框开着时被恢复（比如另一台设备同步过来）→ 自动关掉，
   * 否则用户会对着一个指向已不存在条目的确认框点"彻底删除"。
   */
  useEffect(() => {
    if (confirmingId !== undefined && pending === undefined) setConfirmingId(undefined);
  }, [confirmingId, pending]);

  /**
   * 一次回收站动作：置忙 → 写 → 失败要说出来 → 刷新 → 收忙。
   *
   * `kind` 决定走哪一路（这是**显示路由**，不是产品判断 —— 判断在动作层，
   * 而 `kind` 由共享的 `toTrashItems()` 标好）。
   *
   * 🔴 `error` 原来只被 `setError` 写过、**从没渲染过**：宿主层的失败
   * （"已被彻底删除，无法恢复"这类）在界面上就是"点下去没反应"。
   * 与 Web 端这次一起补上。
   */
  /**
   * 四路的穷尽表（键 = `TrashKind`）。见文件头：加一类忘接线在这里是**编译错误**。
   */
  const byKind = useMemo(
    () =>
      taskActions === null ||
      noteActions === null ||
      projectActions === null ||
      habitActions === null
        ? null
        : {
            TASK: {
              restore: (id: string) => taskActions.restore(id),
              purge: (id: string) => taskActions.purge(id),
            },
            NOTE: {
              restore: (id: string) => noteActions.restoreNote(id),
              purge: (id: string) => noteActions.purgeNote(id),
            },
            PROJECT: {
              restore: (id: string) => projectActions.restoreProject(id),
              purge: (id: string) => projectActions.purgeProject(id),
            },
            HABIT: {
              restore: (id: string) => habitActions.restoreHabit(id),
              purge: (id: string) => habitActions.purgeHabit(id),
            },
          } satisfies Record<
            TrashKind,
            { restore: (id: string) => Promise<unknown>; purge: (id: string) => Promise<unknown> }
          >,
    [taskActions, noteActions, projectActions, habitActions],
  );

  const run = (item: TrashItem, action: 'restore' | 'purge'): void => {
    if (byKind === null) return;
    setBusyId(item.id);
    setError(undefined);
    Promise.resolve(byKind[item.kind][action](item.id))
      .then(() => {
        refresh();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusyId(null);
      });
  };

  /** 共享板的文案：本层负责取词，共享层一个字都不带。 */
  // 🔴 标注成共享契约类型：不标的话下面那几个回调的参数会**隐式 any**
  //（错一个形状构建期不会报，界面画出来才发现）。
  const labels: TrashBoardLabels = {
    intro: t('mobile.trash.intro'),
    emptyTitle: t('mobile.trash.empty.title'),
    emptyHint: t('mobile.trash.empty.hint'),
    kindLabel: (kind) => entityLabelOf(kind, t),
    deletedAt: (item: TrashItem) => deletedAtText(item, t),
    restore: (item: TrashItem) => restoreA11y(item, t),
    purge: (item: TrashItem) => purgeA11y(item, t),
  };

  return (
    <Screen
      title={t('mobile.trash.title')}
      actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
    >
      {error === undefined ? null : (
        <Text variant="caption" tone="danger" selectable>
          {error}
        </Text>
      )}
      {/*
        🔴 **列表本身来自共享 `TrashBoard`**（与 Web 同一份）。
        在此之前两端各写了一份回收站行 —— 而它们的漂移不会报错，
        只会让"网页上能还原、手机上找不到那个按钮"变成常态。
        ⚠️ 确认弹窗**不共享**：它是真的平台差异（这里是原生 `Modal`），
        而本板只把 `onPurge` 交出来。
      */}
      <TrashBoard
        items={items}
        labels={labels}
        onRestore={(id) => {
          const item = items.find((it) => it.id === id);
          if (item === undefined) return;
          run(item, 'restore');
        }}
        // 🔴 这一下**不删**，只打开确认框 —— 不可逆动作必须二次确认。
        // 真正调用 `purge()` 的地方只有下面 Modal 里的确认按钮。
        onPurge={(id) => {
          setConfirmingId(id);
        }}
        busyId={busyId}
        testID="trash-board"
      />

      {pending === undefined ? null : (
        <ConfirmPurge
          // 🔴 影响面那一句：清单要数"里面还有几条活的任务"，数法在共享层
          //（`liveTaskCountOfProject`），本文件不自己写一遍（两端各数一遍 = 两份口径）。
          // ⚠️ 传的必须是 `listTasks()`（未删除的那一路）—— 用整张原始表会把已删的
          //    任务也算进"它们不会被删除"这句话里，那是一句假话。
          copy={purgeConfirmCopy(
            pending.title,
            t,
            purgeImpactText(
              pending,
              t,
              taskActions === null ? 0 : liveTaskCountOfProject(taskActions.listTasks(), pending.id),
            ),
          )}
          busy={busyId !== null}
          onCancel={() => {
            setConfirmingId(undefined);
          }}
          onConfirm={() => {
            // 先关确认框再写：写失败不该把确认框永远卡在屏幕上 —— 失败由上面的
            // `trash-error` 说给用户。
            const item = pending;
            setConfirmingId(undefined);
            run(item, 'purge');
          }}
        />
      )}
    </Screen>
  );
}

/**
 * 彻底删除的二次确认。
 *
 * 🔴 四条独立的信息，**不能合并成一句**：
 *   0. 影响面（`impact`，只有清单 / 习惯有）—— 删容器不删内容；
 *   1. 删的是哪一条（用户点错行的机会是存在的）；
 *   2. 后果 —— 从回收站消失、无法恢复；
 *   3. **这不是物理擦除**（`notErasure`，用 warning 色单独一行）。
 * 合并之后最容易被删掉的就是第 3 条，而删掉它界面**照样渲染**。
 */
function ConfirmPurge({
  copy,
  busy,
  onCancel,
  onConfirm,
}: {
  copy: ReturnType<typeof purgeConfirmCopy>;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const tokens = useTokens();
  const { native } = useTheme();
  const shadow = native.shadow('shadow.lg');

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel} accessibilityViewIsModal>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: tokens['screen.gutter'],
          backgroundColor: tokens['color.overlay'],
        }}
      >
        <View
          style={[
            {
              gap: tokens['space.4'],
              padding: tokens['space.5'],
              borderRadius: tokens['radius.lg'],
              backgroundColor: tokens['color.surface-raised'],
            },
            shadow ?? undefined,
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: tokens['space.2'] }}>
            <Icon name="conflict.warning" size="md" color={tokens['color.warning-strong']} />
            <View style={{ flex: 1, minWidth: 0, gap: tokens['space.2'] }}>
              <Text variant="section-title">{copy.title}</Text>
              <Text variant="caption" tone="muted">
                {copy.body}
              </Text>
              {/*
                影响面那一句（W4）：只在清单 / 习惯这两类上有。`undefined` 时**整行不进
                树**，而不是渲染一个空串 —— 空行会让"这一类没有影响面"看起来像文案丢了。
              */}
              {copy.impact === undefined ? null : (
                <Text variant="caption" tone="muted" selectable>
                  {copy.impact}
                </Text>
              )}
              {/* 🔴 诚实条款单独一行、用 warning 色：它是这段话里唯一
                  用户会做出错误前提的那一句（以为"数据没了"）。 */}
              <Text variant="caption" tone="warning">
                {copy.notErasure}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: tokens['space.3'] }}>
            <Button label={copy.cancel} tone="secondary" onPress={onCancel} style={{ flex: 1 }} />
            <Button
              label={copy.submit}
              tone="danger"
              disabled={busy}
              onPress={onConfirm}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
