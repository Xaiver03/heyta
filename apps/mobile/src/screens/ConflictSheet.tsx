/**
 * 冲突解决界面
 * ==============
 *
 * 「我的」屏原来在冲突时显示的是一句死路：
 *
 *     需要你选择保留哪一边。解决界面尚未实现 —— 数据没有丢失，
 *     但它会一直停在待上传队列里。
 *
 * 这句话诚实，但用户**无处可选**。这个界面把它补完：
 * 把双方分别是什么摆出来，让用户点一下选一边。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 设计与 Web 端 `apps/web/src/features/sync/ConflictDialog.tsx` **对齐**
 *
 * 同一个产品问题在两个平台必须是同一个解法，否则用户会以为是两件事。
 * 具体对齐的是：
 *
 *   - **并排显示两边的「内容」**，不是只显示时间戳。
 *     时间戳谁新谁旧，用户判断不了"哪个才是我要的"——他改的是标题、
 *     备注还是完成状态，只有内容本身能告诉他。
 *   - **取不到对端时明说「取不到这一侧的版本」**，绝不留白。
 *     留白会让人以为"对端什么都没写"，从而做出相反的判断。
 *   - **自动解决的那些不会走到这里** —— 只有 `suggestConflictResolution`
 *     返回 `manual` 的才需要人决定。
 *
 * ⚠️ 移动端与 Web 端**唯一刻意的差异**是排布方式：手机上横向空间只有
 * 411dp 左右，两侧面板各占一半是这个尺寸下还能并排读的下限。
 * 面板内文字限制行数，避免一处长备注把整个界面撑成一条竖线。
 * ═════════════════════════════════════════════════════════════════════════
 *
 * 🔴 **关掉界面不会清掉冲突状态。** 冲突来自 `status`，`onClose` 只控制可见性；
 * 「我的」屏仍会提示还有几处待处理，用户随时能回来继续。
 */

import React, { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';

import type { ConflictInfo } from '@heyta/sync-client';

import { useTheme, useTokens } from '../theme';
import { useMobileSync, resolveConflictNow } from '../sync/store';
import {
  choiceBlockedReason,
  positionLabel,
  toConflictView,
  type ConflictChoice,
  type ConflictSideView,
  type ConflictView,
} from '../sync/conflict-view';
import { Button, IconButton, Text } from '../ui/kit';
// 🔴 `Icon` 不在 kit 里 —— 它在登记表 `ui/icons.tsx`。
// kit 只是**内部**用它，没有把它再导出。
import { Icon } from '../ui/icons';

/** 一侧的面板：内容 + 时间 + 「保留这一版」。 */
function Side({
  side,
  view,
  choice,
  busy,
  onPick,
}: {
  side: ConflictSideView;
  view: ConflictView;
  choice: ConflictChoice;
  busy: boolean;
  onPick: (choice: ConflictChoice) => void;
}): React.JSX.Element {
  const t = useTokens();
  const blocked = choiceBlockedReason(view, choice);
  const icon = choice === 'keep-local' ? 'device.local' : 'device.remote';

  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        gap: t['space.3'],
        padding: t['space.3'],
        borderRadius: t['radius.md'],
        borderWidth: t['border-width.thin'],
        // 较新的一侧用主色描边做视觉强调 —— 这只是帮用户建立直觉，
        // **不是裁决依据**（判定见 sync-client 的 compareConflictFreshness）。
        borderColor: side.isNewer ? t['color.primary'] : t['color.border'],
        backgroundColor: t['color.surface'],
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t['space.1'],
        }}
      >
        <Icon name={icon} size="xs" color={t['color.foreground-muted']} />
        <Text variant="caption" tone="muted">
          {side.label}
        </Text>
        {side.isNewer ? (
          <View style={{ marginLeft: 'auto' }}>
            <Text variant="badge" tone="primary">
              较新
            </Text>
          </View>
        ) : null}
      </View>

      {side.available && side.summary !== undefined ? (
        <Text variant="row-title" numberOfLines={3}>
          {side.summary}
        </Text>
      ) : (
        // 🔴 取不到就明说。显示成空白会让人以为对端什么都没写。
        <Text variant="caption" tone="muted" style={{ fontStyle: 'italic' }}>
          取不到这一侧的版本
        </Text>
      )}

      {side.time === undefined ? null : (
        <Text variant="numeric-body" tone="subtle">
          {side.time}
        </Text>
      )}

      <Button
        label="保留这一版"
        icon="action.keep"
        tone={side.isNewer ? 'primary' : 'secondary'}
        disabled={blocked !== undefined}
        loading={busy}
        onPress={() => {
          onPick(choice);
        }}
        style={{ marginTop: 'auto' }}
      />

      {blocked === undefined ? null : (
        <Text variant="caption" tone="warning">
          {blocked}
        </Text>
      )}
    </View>
  );
}

export function ConflictSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const t = useTokens();
  // 🔴 `shadow.lg` 在 token 里是 **CSS 字符串**（`0 8px 24px rgb(...)`），
  // RN 不认，展开它也不是对象。必须经 `native.shadow()` 归一化成 RN 的
  // shadowColor/shadowOffset/... 一组属性 —— 与 kit 里 `Fab` 的用法一致。
  const { native } = useTheme();
  const shadow = native.shadow('shadow.lg');
  const { status, busy } = useMobileSync();
  const [pending, setPending] = useState<string | null>(null);

  const conflicts = status.kind === 'conflict' ? status.conflicts : [];
  const open = visible && conflicts.length > 0;
  if (!open) return null;

  const pick = (conflict: ConflictInfo, choice: ConflictChoice): void => {
    if (busy) return;
    setPending(conflict.id);
    /**
     * 🔴 传的是**原始的 `ConflictInfo`**，不是上面那个视图模型。
     *
     * `resolveConflictNow` → `SyncClient.resolveConflict` 要用
     * `conflict.local.opId` 去 op-log 里取回那条 op 并重新派发/丢弃。
     * 视图模型里没有 `opId`，拿它去凑一个对象（哪怕字段齐全但值是我编的）
     * 会让解决**必然失败**：`getOpById('')` 取不到，报"本地那条改动已经不在队列里了"。
     * 所以 `pick` 的第一个参数必须是 list 里那个真对象。
     *
     * ⚠️ 同理，这里**不 await 之后报"已解决"** —— store 放进去的是**解决之后的真实状态**
     * （可能还剩别的冲突，也可能又出了别的错）。界面下一帧会跟着 `status` 更新。
     */
    void resolveConflictNow(conflict, choice).finally(() => {
      setPending(null);
    });
  };

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: t['screen.gutter'],
          backgroundColor: t['color.overlay'],
        }}
      >
        <View
          style={[
            {
              maxHeight: '90%',
              gap: t['space.4'],
              padding: t['space.5'],
              borderRadius: t['radius.lg'],
              backgroundColor: t['color.surface-raised'],
            },
            // 阴影只给真正的浮层（AGENTS.md §5），而对话框就是浮层。
            shadow ?? undefined,
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t['space.2'] }}>
            <Icon name="conflict.warning" size="md" color={t['color.warning-strong']} />
            <View style={{ flex: 1, minWidth: 0, gap: t['space.1'] }}>
              <Text variant="section-title">
                {`这 ${String(conflicts.length)} 处改动两边都改过`}
              </Text>
              <Text variant="caption" tone="muted">
                heyta 不会替你决定保留哪一版——自动挑一个会悄悄丢掉另一边的改动。每一处都请你看一眼再选；没选的那些会一直留在本地，不会丢。
              </Text>
            </View>
            <IconButton icon="action.close" label="稍后再处理" onPress={onClose} />
          </View>

          <ScrollView contentContainerStyle={{ gap: t['space.5'] }}>
            {conflicts.map((conflict, index) => {
              const view = toConflictView(conflict);
              return (
                <View key={view.id} style={{ gap: t['space.2'] }}>
                  <Text variant="caption" tone="muted">
                    {`${positionLabel(index, conflicts.length)} · ${view.entityLabel} · ${view.reasonLabel}`}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: t['space.3'], alignItems: 'stretch' }}>
                    <Side
                      side={view.local}
                      view={view}
                      choice="keep-local"
                      busy={busy || pending !== null}
                      onPick={() => {
                        pick(conflict, 'keep-local');
                      }}
                    />
                    <Side
                      side={view.remote}
                      view={view}
                      choice="keep-remote"
                      busy={busy || pending !== null}
                      onPick={() => {
                        pick(conflict, 'keep-remote');
                      }}
                    />
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
