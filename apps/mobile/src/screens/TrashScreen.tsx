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
 * 所有写操作都经 `@heyta/app-host` 的 `TaskActions`。这里只做两件事：
 * 收集用户意图、以及把"要不要确认"这个纯交互状态摆在界面上。
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

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, View } from 'react-native';

import { createTaskActions, type AppHost, type TaskActions } from '@heyta/app-host';
import type { Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';

import { openTaskHost } from '../db/open-host';
import {
  deletedAtText,
  pendingPurge,
  purgeA11y,
  purgeConfirmCopy,
  restoreA11y,
} from '../lib/trash-display';
import { useMobileSync } from '../sync/store';
import { useTheme, useTokens } from '../theme';
import { Button, Card, Divider, EmptyState, Screen, Text } from '../ui/kit';
import { Icon } from '../ui/icons';

export function TrashScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  /**
   * 🔴 `dataRevision` 是**本地写入 / 同步完成**的信号。少了它，
   * 在另一台设备恢复条目后切回本屏会一直显示旧列表（与成长屏同一条）。
   */
  const { dataRevision } = useMobileSync();

  const [host, setHost] = useState<AppHost | null>(null);
  const [actions, setActions] = useState<TaskActions | null>(null);
  const [items, setItems] = useState<Task[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
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

  useEffect(() => {
    setActions(host === null ? null : createTaskActions(host));
  }, [host]);

  const refresh = useCallback(() => {
    // ⚠️ `listTrashed()` 是**同步**的（读的是已物化的内存状态），不是 Promise。
    setItems(actions === null ? [] : actions.listTrashed());
  }, [actions]);

  useEffect(() => {
    refresh();
  }, [refresh, dataRevision]);

  const pending = pendingPurge(items, confirmingId);

  /**
   * 条目在确认框开着时被恢复（比如另一台设备同步过来）→ 自动关掉，
   * 否则用户会对着一个指向已不存在任务的确认框点"彻底删除"。
   */
  useEffect(() => {
    if (confirmingId !== undefined && pending === undefined) setConfirmingId(undefined);
  }, [confirmingId, pending]);

  const run = (action: Promise<void>): void => {
    setBusy(true);
    setError(undefined);
    action
      .then(() => {
        refresh();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Screen
      title={t('mobile.trash.title')}
      actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: onBack }]}
    >
      <Text variant="row-meta" tone="subtle">
        {t('mobile.trash.intro')}
      </Text>

      {error !== undefined ? (
        <Text variant="caption" tone="danger" selectable>
          {error}
        </Text>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon="task.delete"
          title={t('mobile.trash.empty.title')}
          hint={t('mobile.trash.empty.hint')}
        />
      ) : (
        <Card style={{ gap: tokens['space.4'] }}>
          {items.map((task, index) => (
            <View key={task.id} style={{ gap: tokens['space.2'] }}>
              {index > 0 ? <Divider /> : null}
              {/* 用户自己的字：原样显示、不翻译。长标题折行而不是截断 —— 
                  回收站是用户来核对"删掉的是不是这条"的地方，看不全就等于没看见。 */}
              <Text variant="row-title">{task.title}</Text>
              <Text variant="numeric-body" tone="subtle">
                {deletedAtText(task, t)}
              </Text>
              <View style={{ flexDirection: 'row', gap: tokens['space.3'] }}>
                <Button
                  label={t('mobile.trash.restore')}
                  accessibilityLabel={restoreA11y(task, t)}
                  icon="task.reopen"
                  tone="secondary"
                  disabled={busy}
                  onPress={() => {
                    if (actions === null) return;
                    run(actions.restore(task.id));
                  }}
                  style={{ flex: 1 }}
                />
                {/* 🔴 这一下**不删**，只打开确认框 —— 不可逆动作必须二次确认。
                    真正调用 `purge()` 的地方只有下面 Modal 里的确认按钮。 */}
                <Button
                  label={t('mobile.trash.purge')}
                  accessibilityLabel={purgeA11y(task, t)}
                  icon="task.delete"
                  tone="danger"
                  disabled={busy}
                  onPress={() => {
                    setConfirmingId(task.id);
                  }}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ))}
        </Card>
      )}

      {pending === undefined ? null : (
        <ConfirmPurge
          copy={purgeConfirmCopy(pending.title, t)}
          busy={busy}
          onCancel={() => {
            setConfirmingId(undefined);
          }}
          onConfirm={() => {
            if (actions === null) return;
            // 先关确认框再写：写失败不该把确认框永远卡在屏幕上。
            const id = pending.id;
            setConfirmingId(undefined);
            run(actions.purge(id));
          }}
        />
      )}
    </Screen>
  );
}

/**
 * 彻底删除的二次确认。
 *
 * 🔴 三条独立的信息，**不能合并成一句**：
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
