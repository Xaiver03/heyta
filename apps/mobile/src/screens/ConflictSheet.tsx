/**
 * 冲突解决界面（mobile 外壳）
 * ==============================
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
 * 🔴 M3 第四刀之后，这里**只剩 mobile 特有的那一层**
 *
 * 两个平台共有的部分已经收进 `@heyta/ui` 的 `ConflictResolutionView`
 * （web 的 `ConflictDialog` 渲染的是**同一份**）：
 * 逐条列出冲突、并排摆出两边的**内容**与时间、标出哪一侧较新、
 * 每一侧一个「保留这一版」、把"为什么点不了"说出来。
 *
 * 本文件只负责：
 *   · **底部弹层外壳**（`Modal` + 遮罩 + 圆角浮层 + 阴影）—— 那是 L3；
 *   · **标题 / 说明 / 关闭**（mobile 的 `IconButton` 与 kit `Text`）；
 *   · **词条**（`labels`）—— 共享层不许 import `@heyta/i18n`；
 *   · **把点击接到 `resolveConflictNow`**（见下面 `pick` 的注释）。
 *
 * ⚠️ 两处**有意的端差异**（与 web 不同，都写在共享层的文件头里）：
 *   · `summaryLines={3}` —— 手机横向只有 411dp 左右，一处长备注会把界面撑成竖线；
 *   · 用**共享版按钮**（`ConflictResolutionView` 的 `Pressable`）而不是 kit 的
 *     `Button`：RN 上 `disabled` 是普通属性，不需要 web 那条
 *     "真实 `<button disabled>`" 的绕路，所以这里直接用共享实现。
 *     代价是按钮外观从 kit 的样式变成共享样式（与 `FocusPanel` 同一取舍）。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ✅ 曾经的移动端重复实现（`apps/mobile/src/sync/conflict-view.ts`）**已删除**。
 *
 * 那两个查表函数（实体名 / 冲突原因）已经收进 `@heyta/ui` 的 `sync/model.ts`
 * （词条 key 落成共享的 `common.entity.*` / `common.conflict.reason.*`），
 * web 的 `ConflictDialog.tsx` 也从**同一张表**取 —— 于是"哪些实体/原因有名字"
 * 只有一份定义，加一个新实体只改一处，不会再出现"一端有名字、另一端漏英文代号"。
 * ═════════════════════════════════════════════════════════════════════════
 *
 * 🔴 **关掉界面不会清掉冲突状态。** 冲突来自 `status`，`onClose` 只控制可见性；
 * 「我的」屏仍会提示还有几处待处理，用户随时能回来继续。
 */

import React, { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';

import { useI18n } from '@heyta/i18n';
import type { ConflictInfo } from '@heyta/sync-client';
import { compareConflictFreshness, summarizeConflictPayload } from '@heyta/sync-client';
import {
  ConflictResolutionView,
  conflictLookupCode,
  conflictReasonLabelOf,
  entityLabelOf,
  type ConflictChoice,
  type ConflictResolutionLabels,
} from '@heyta/ui';

import { useTheme, useTokens } from '../theme';
import { useMobileSync, resolveConflictNow } from '../sync/store';
import { formatStamp } from '../lib/date';
import { IconButton, Text } from '../ui/kit';
// 🔴 `Icon` 不在 kit 里 —— 它在登记表 `ui/icons.tsx`。
// kit 只是**内部**用它，没有把它再导出。
import { Icon } from '../ui/icons';

export function ConflictSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const tokens = useTokens();
  const { t } = useI18n();
  // 🔴 `shadow.lg` 在 token 里是 **CSS 字符串**（`0 8px 24px rgb(...)`），
  // RN 不认，展开它也不是对象。必须经 `native.shadow()` 归一化成 RN 的
  // shadowColor/shadowOffset/... 一组属性 —— 与 kit 里 `Fab` 的用法一致。
  const { native } = useTheme();
  const shadow = native.shadow('shadow.lg');
  const { status, busy } = useMobileSync();
  const [pending, setPending] = useState<string | null>(null);

  const conflicts = status.kind === 'conflict' ? status.conflicts : [];
  const open = visible && conflicts.length > 0;

  /**
   * 面板全部文案。**每一项都由宿主注入**（共享层不 import i18n）。
   *
   * 实体名与冲突原因由共享 `sync/model.ts` 的查表函数产出词条 key ——
   * "哪些实体/原因有名字"因此只有一份定义（web 与这里同一份）。
   */
  const labels: ConflictResolutionLabels = {
    position: (index, total) => t('mobile.conflict.position', { index: index + 1, total }),
    entity: (entityType) => entityLabelOf(entityType, t),
    // 🔴 `errorCode ?? reason` 由共享 model 的 `conflictLookupCode` 定顺序；
    // 查不到走共享兜底句（`common.conflict.reason.fallback`），**绝不回落成
    // 服务端那句英文诊断**。
    reason: (conflict) => conflictReasonLabelOf(conflictLookupCode(conflict), t),
    side: (side) =>
      t(side === 'local' ? 'mobile.conflict.side.local' : 'mobile.conflict.side.remote'),
    newer: t('mobile.conflict.newer'),
    remoteUnavailable: t('mobile.conflict.remoteUnavailable'),
    keepThis: t('mobile.conflict.keepThis'),
    emptyPayload: t('mobile.conflict.payload.empty'),
    // 词条表没有 ICU：1 个字段走单数兄弟词条，否则英文是 "1 fields changed"。
    payloadFields: (count) =>
      count === 1
        ? t('mobile.conflict.payload.fieldsOne', { count })
        : t('mobile.conflict.payload.fields', { count }),
    blocked: () => t('mobile.conflict.blocked.remoteMissing'),
    time: (ms) => formatStamp(ms),
  };

  if (!open) return null;

  const pick = (conflict: ConflictInfo, choice: ConflictChoice): void => {
    if (busy) return;
    setPending(conflict.id);
    /**
     * 🔴 传的是**原始的 `ConflictInfo`**，不是任何视图模型 ——
     * `ConflictResolutionView` 的 `onResolve` 交回来的就是清单里那个真对象
     * （它把 `conflict` 放进了 `renderSideAction` 的入参与回调里）。
     *
     * `resolveConflictNow` → `SyncClient.resolveConflict` 要用
     * `conflict.local.opId` 去 op-log 里取回那条 op 并重新派发/丢弃。
     * 拿一个字段齐全但值是编的对象去凑，会让解决**必然失败**：
     * `getOpById('')` 取不到，报"本地那条改动已经不在队列里了"。
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
          padding: tokens['screen.gutter'],
          backgroundColor: tokens['color.overlay'],
        }}
      >
        <View
          style={[
            {
              maxHeight: '90%',
              gap: tokens['space.4'],
              padding: tokens['space.5'],
              borderRadius: tokens['radius.lg'],
              backgroundColor: tokens['color.surface-raised'],
            },
            // 阴影只给真正的浮层（AGENTS.md §5），而对话框就是浮层。
            shadow ?? undefined,
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: tokens['space.2'] }}>
            <Icon name="conflict.warning" size="md" color={tokens['color.warning-strong']} />
            <View style={{ flex: 1, minWidth: 0, gap: tokens['space.1'] }}>
              <Text variant="section-title">
                {/* 英文单复数：只有 1 处时走单数兄弟词条（词条表没有 ICU）。
                    只在 JSX 子节点里分支，不放进属性 —— 属性里门禁只认
                    "字面量紧跟 `t(`"这一种形状。 */}
                {conflicts.length === 1
                  ? t('mobile.conflict.titleOne')
                  : t('mobile.conflict.title', { count: conflicts.length })}
              </Text>
              <Text variant="caption" tone="muted">
                {t('mobile.conflict.body')}
              </Text>
            </View>
            <IconButton
              icon="action.close"
              label={t('mobile.conflict.close')}
              onPress={onClose}
            />
          </View>

          <ScrollView contentContainerStyle={{ gap: tokens['space.5'] }}>
            {/* 🔴 共享的那一段（与 web 同一份源码）。
                宿主不必自己挂 Provider —— 移动端整棵树都在
                `<ThemeProvider>`（= `HeytaUiProvider`）之内。 */}
            <ConflictResolutionView
              conflicts={conflicts}
              labels={labels}
              freshnessOf={(conflict) =>
                compareConflictFreshness(conflict.local, conflict.remote)
              }
              summarize={summarizeConflictPayload}
              summaryLines={3}
              busy={busy || pending !== null}
              onResolve={pick}
              testID="conflict-resolution"
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
