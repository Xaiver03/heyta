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
 *   · **底部弹层外壳** —— 现在是共享原语 `@heyta/ui` 的 `BottomSheet`（适配层 §4 **T7**）；
 *   · **说明文字与词条**（`labels`）—— 共享层不许 import `@heyta/i18n`；
 *   · **把点击接到 `resolveConflictNow`**（见下面 `pick` 的注释）。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ## 🔴 2026-11 迁移：外壳从自绘「`Modal` + 遮罩 + 居中卡片」换成 `BottomSheet`
 *
 * 迁移前这枚面板的名字是 Sheet，几何上是**居中弹窗**（遮罩 `justifyContent:'center'`
 * + 卡片 `maxHeight:'90%'`，把手 / 分档 / 档位记忆 0 处）—— 那正是
 * `packages/ui/src/overlay/sheet-detents.ts` 文件头记着的那个实测形状。
 *
 * ### 类别判定：`bottom-sheet`（不是 `modal-deferrable`，也不是 `modal-forced-read`）
 *
 * 判据逐条走 `dismissal.ts`，**依据是这个面板自己的语义**，不是抄邻居：
 *
 * · **它不是意思表示层。** `modal-deferrable` 那一格存在的理由是"误点一下遮罩就把
 *   表态推掉，而用户会以为它记成了没决定"（隐私单独同意 / 条款再确认）——
 *   这枚面板**不记录任何表态**：解决动作只在点「保留这一版」时发生。
 * · **随手关无代价。** 文件头那条纪律说的是这件事：关掉不清冲突状态，
 *   `status` 仍是 `conflict`，「我的」屏照样提示还剩几处，随时能回来继续。
 *   `bottom-sheet` 那一格给的是「背景 / 下拉 / × 三条随手出口 + 不响应 Esc」，
 *   成立条件就是"丢弃无代价" ⇒ 对得上。
 * · **也不是 `modal-forced-read`。** 那一格三条通道全 `deny`，等于逼用户此刻表态；
 *   冲突可以以后处理（出口文案 `mobile.conflict.close` 写的就是「稍后再处理」），
 *   拦着人不让走是反向的。
 *
 * ⚠️ **两条随迁移而来的变化**（都是原语的既定行为，不是顺手改的）：
 *   · 点背景 / 下拉**现在会关**（迁移前遮罩是一个没有 `onPress` 的 `View`，
 *     那一格是复制隐私面板的形状留下的，不是拍过板的决策 —— 隐私面板**必须**
 *     禁背景，那是 PIPL 那条；这里没有那条理由）；
 *   · 压暗从 `color.overlay`（0.5）变成 `material.scrim`（0.32）：底部面板的
 *     全部意义是底下还看得见上下文，这一格由原语统一给（`BottomSheet.tsx:355-368`）。
 *
 * ### 档位：单档 `large`，把手暂时不响应
 *
 * `DETENT_FRACTION.large = 0.9` 与迁移前的 `maxHeight:'90%'` **逐字同一格**，
 * 而这里的内容是变长清单（N 处冲突 × 两侧并排摘要），矮一档就只能滚动看全，
 * 所以取 `large`。多档要 `labels.expand` / `labels.collapse` 两枚新词条
 * （`packages/i18n` 不在本次可改范围），未入库前**不开把手**：
 * `allowed.length === 1` 时原语的 `draggable` 为假，把手画出来但不接手势
 * （否则变成"拖了没反应"），那两格文案也永不被人读到。
 *
 * 🔴 迁移后**刻意不变**的三条：
 *   · 出口只有一个 `onClose`：背景 / × 都走 `onDismiss={onClose}`，
 *     返回键走同一条（`onBack` 不给 ⇒ 原语按定义与 `onDismiss` 同义，
 *     等价于迁移前的 `onRequestClose={onClose}`）；
 *   · `summaryLines={3}` 与共享版按钮这两处**有意的端差异**原样保留；
 *   · 「点了之后不 await 就报已解决」的纪律不变（见 `pick`）。
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

import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { HeytaNativeTokens } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import type { ConflictInfo } from '@heyta/sync-client';
import { compareConflictFreshness, summarizeConflictPayload } from '@heyta/sync-client';
import {
  BottomSheet,
  ConflictResolutionView,
  conflictLookupCode,
  conflictReasonLabelOf,
  entityLabelOf,
  type ConflictChoice,
  type ConflictResolutionLabels,
} from '@heyta/ui';

import { useTokens } from '../theme';
import { useMobileSync, resolveConflictNow } from '../sync/store';
import { formatStamp } from '../lib/date';
import { Text } from '../ui/kit';
// 🔴 `Icon` 不在 kit 里 —— 它在登记表 `ui/icons.tsx`。
// kit 只是**内部**用它，没有把它再导出。
import { Icon } from '../ui/icons';

/**
 * 面板内**只剩这一块**自定义布局的样式：模块级工厂 + `useMemo`
 * （与 `PrivacyConsentSheet` / `AccountClosureScreen` 同一惯用法）。
 *
 * 🔴 L4 视图（`apps/mobile/src/screens`）的内联样式**只减不增**
 * （`scripts/check-l4-no-style.mjs` 断言 C）。迁移前的 `scrim` / `card` /
 * `headRow` / `headText` 四条与那句 `contentContainerStyle={{…}}` 一起没了 ——
 * 外壳的几何与压暗现在由 `BottomSheet` 与 tokens 决定，宿主不再自己算一份。
 * ⚠️ 取值一律经 tokens 表，不写裸值（`check:design` / `check:l4` 双盯）。
 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    introRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: tokens['space.2'],
    },
    introText: { flex: 1, minWidth: 0 },
  });
}

export function ConflictSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const tokens = useTokens();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const { t } = useI18n();
  // 🔴 安全区由宿主递进原语：共享层没有 `react-native-safe-area-context`
  //（它只在移动端），而 `BottomSheet` 要靠这个数把最后一行抬出手势条。
  const insets = useSafeAreaInsets();
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
    <BottomSheet
      visible={open}
      overlay="bottom-sheet"
      // 英文单复数：只有 1 处时走单数兄弟词条（词条表没有 ICU）。
      // 只在 JSX 子节点里分支，不放进属性 —— 属性里门禁只认
      // "字面量紧跟 `t(`"这一种形状。
      // 🔴 单数那一支**也要传 `{count}`**：`tests/plural-keys.spec.ts` 钉住了
      // 中文的单数兄弟词条与复数版**刻意逐字相同**（中文本来不分单复数），
      // 所以那句里就有 `{count}` 这个洞 —— 不传，用户看到"这 {count} 处"。
      title={
        conflicts.length === 1
          ? t('mobile.conflict.titleOne', { count: conflicts.length })
          : t('mobile.conflict.title', { count: conflicts.length })
      }
      // 单档 ⇒ 没有把手可拖，所以**不给** `expand` / `collapse`。
      // 原来这里拿 `mobile.conflict.close` 占位，是原语把两枚标签定成必填逼出来的
      // 假文案（无障碍树里会出现两句"稍后再处理"，其中一句的名字在说"展开"）。
      // 原语已改为可选；将来放开多档时补两枚真词条即可。
      labels={{
        close: t('mobile.conflict.close'),
        // G2：右上角那格现在是**看得见的字**「以后再说」，不是一个匿名 ×。
        // 这一族的关闭有后果（关掉 = 这批冲突留在这里没处理），
        // 所以后果要写在可点区域上，而不是让用户先猜符号。
        // ⚠️ `close` 仍然要给：它是"没有具名文字时"的无障碍名（原语两档都支持）。
        closeText: t('mobile.conflict.close'),
      }}
      // 三条随手关的通道（背景 / × / 返回键）共用这一个出口：
      // 关掉**不清冲突状态**，`status` 仍是 `conflict`，随时能回来继续。
      onDismiss={onClose}
      detents={['large']}
      bottomInset={insets.bottom}
      testID="conflict-sheet"
    >
      <View style={styles.introRow}>
        <Icon name="conflict.warning" size="md" color={tokens['color.warning-strong']} />
        <Text variant="caption" tone="muted" style={styles.introText}>
          {t('mobile.conflict.body')}
        </Text>
      </View>

      {/* 🔴 共享的那一段（与 web 同一份源码）。
          宿主不必自己挂 Provider —— 移动端整棵树都在
          `<ThemeProvider>`（= `HeytaUiProvider`）之内。
          滚动由 `BottomSheet` 自己的 body 承担，这里不再套第二层 `ScrollView`。 */}
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
    </BottomSheet>
  );
}
