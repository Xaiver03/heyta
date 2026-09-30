/**
 * 「我的」—— 身份 · 同步状态 · 入口
 * ===================================
 *
 * 🔴 这个屏幕之所以存在，是因为**移动端此前一条数据都同步不出去**。
 *
 * 症状不是崩溃、不是报错，而是"建了任务、勾了完成、删了任务，全都只落在本机"。
 * 界面上完全正常 —— 没有服务端也照样能建任务（本地优先本来就该这样），
 * 所以**没有任何一处会提示"你没配上同步"**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **2026-09-29 起，设置内容搬进了独立的第二层表面**（`SettingsScreen`）
 *
 * 对标滴答 §11.5 的规律：次级表面（设置）独立成面，不与主内容混流。
 * 在这之前，本屏是 899 行的"什么都塞"：凭据表单、小组件旅程、语言胶囊
 * 全部内联在滚动流里。现在：
 *
 *   · 本屏只留**身份**（账号卡 + 注册/登录）、**同步状态**（状态卡 +
 *     「立即同步」）、**入口行**（设置 / 成长 / 习惯 / 回收站 / 导出）、
 *     清单/标签/便签管理；
 *   · 凭据表单 / 小组件 / 语言 / 清除凭据在 `SettingsScreen`（RN Modal）里；
 *   · **表单状态仍活在本屏**（`useSyncCredentialForm`）—— 设置面是 Modal，
 *     `visible={false}` 时 children 整体卸载，状态放那边会在每次关闭时丢字。
 *     注册/登录成功后的回填也因此仍能直达 setters（`onSignedIn`）。
 *
 * 注入判据（goal M1–M3）：把上面任何一段塞回本屏的滚动流，
 * `pnpm check:mobile-settings` 会红。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **凭据只放内存，刻意不落盘。** 理由见 `sync/config.ts`；
 *    "输入即写活配置"的守卫与 `notifyConfigured()` 的边界在
 *    `sync/credential-form.ts`（原样搬自本文件，逻辑没有变）。
 *
 * 🔴 **冲突解决界面已补完**（见 `ConflictSheet.tsx`）：关掉界面不会清掉冲突
 *    —— 冲突在 `status.kind === 'conflict'` 里，本屏的状态卡会一直提示。
 *
 * 🔴 **「待上传三态」与「锁屏隐私可用性」的判定都在共享层**
 *    （`@heyta/ui` 的 `resolvePendingUploadPresentation` / `resolveSettingAvailability`，
 *    有单测）：`undefined` = 还没读到、`0` = 全传完了，两者不能合并；
 *    隐私开关 `null`（平台没有这一项）→ 整行不渲染，`false` 是"用户关着"。
 *    （隐私开关那一行随小组件旅程搬进了 `SettingsScreen`，判定仍在共享层。）
 *
 * ⚠️ **成长 / 回收站 / 导出 / 注册登录 / 习惯仍是"整屏替换"式的第二层页面**
 *    （early return）—— 它们与设置不同：那是**阅读/操作另一个全景**，
 *    不是"盖在当前上下文上的浮层"，与 §11.5 的规律不冲突。
 */

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { SyncStatus } from '@heyta/sync-client';
import { useI18n } from '@heyta/i18n';
import { isArgon2SlowBackend } from '@heyta/sync-core';
import {
  SettingsRow,
  resolvePendingUploadPresentation,
  shouldRenderSettingsRow,
  type SettingsRowModel,
} from '@heyta/ui';

import { Button, Card, Divider, Screen, SectionHeader, Text } from '../ui/kit';
import { AuthScreen, type SavedAuthSession } from './AuthScreen';
import { ConflictSheet } from './ConflictSheet';
import { ExportScreen } from './ExportScreen';
import { GrowthScreen } from './GrowthScreen';
import { HabitsScreen } from './HabitsScreen';
import { ListsSection } from './ListsSection';
import { NotesSection } from './NotesSection';
import { SettingsScreen } from './SettingsScreen';
import { TagsSection } from './TagsSection';
import { TrashScreen } from './TrashScreen';
import { formatStamp } from '../lib/date';
import { useTokens } from '../theme';
import { useSyncCredentialForm } from '../sync/credential-form';
import { clearSyncConfig } from '../sync/config';
import { describeSyncStatus, statusTone } from '../sync/status-text';
import { useMobileSync, refreshPendingUpload } from '../sync/store';
import { currentSignedInEmail, forgetSignedInUser } from '../auth/session';
import { wipeCredentialsAndWidgets } from '../widgets/credential-wipe';
import { clearWidgetState } from '../widgets/widget-bridge';

export function ProfileScreen(): React.JSX.Element {
  const { status, lastSyncedAt, pendingUpload, busy } = useMobileSync();
  const { t } = useI18n();
  const tokens = useTokens();

  /**
   * 凭据表单的状态与"输入即生效"接线 —— **活在本屏**（理由见
   * `credential-form.ts` 文件头）。设置面拿的是值与回调。
   */
  const form = useSyncCredentialForm();

  // 🔴 冲突界面的可见性只是**界面状态**，不进 store。
  const [conflictsOpen, setConflictsOpen] = useState(false);

  /** 设置面（`SettingsScreen`）的可见性 —— 同样只是界面状态。 */
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * 注册 / 登录面板（W3 · 规范 §3.1 的「前置」落点）。
   *
   * 🔴 它是**第二层页面**，不是第 6 个 tab —— 规范 §2-A8 与 ADR-0015 §4
   * 都把"底部标签保持 5 个"写成硬约束。入口在**本屏顶部的账号卡片**下
   * （一级可见），所以"前置"兑现为"冷启动 ≤1 次点击"而不是"多一个标签"。
   */
  const [authOpen, setAuthOpen] = useState(false);

  /**
   * 登录成功之后把令牌 / 地址 / 口令**回填到表单**。
   *
   * 🔴 回填不是外观问题：表单的 `token` 是本屏的状态（初值取自
   * `readSyncConfig()`），不回填的话用户随后点「立即同步」会用**空输入框**
   * 把刚拿到的令牌覆盖掉 —— 症状是"明明登录成功了，一同步就说未配置"。
   */
  const onSignedIn = (saved: SavedAuthSession): void => {
    form.setServerUrl(saved.serverUrl);
    form.setToken(saved.token);
    form.setPassword(saved.password);
    setAuthOpen(false);
  };

  // 🔴 进屏就真去读一次队列。
  // 不读的话 `pendingUpload` 一直是 `undefined`，界面只能显示"未知" ——
  // 而之前初值是 `0`，于是直接显示"已全部上传"，**本地一条没传也这么说**。
  useEffect(() => {
    void refreshPendingUpload();
  }, []);

  /**
   * 清凭据 = **四件事按序做完**（按钮在设置面上，组合在这里 ——
   * 因为它要同时够到磁盘、小组件、账号与会话状态）：
   *
   * 1. 🔴 清凭据必须**连小组件一起清**（决策 D6）。小组件那份快照是
   *    **设备密钥**加密的，不是凭据加密的 —— 所以"清了凭据"绝不等于
   *    "小组件读不到数据"。不一起清的话，主屏和锁屏上会**继续显示上一个
   *    账号的任务**，而且没有任何报错。顺序与"抛异常也要清"的理由写在
   *    `credential-wipe.ts` 文件头；`void` 是安全的 —— 那个函数**永不抛**。
   * 2. 表单状态归零（只清 token/口令，服务器地址保留 —— 与搬动前一致）。
   * 3. 🔴 一并忘掉账号邮箱。留着它的后果是：凭据已清空、界面却还写着
   *    "当前账号：x@y" —— 一句与实际同步状态矛盾的话。
   */
  const onClearCredentials = (): void => {
    void wipeCredentialsAndWidgets({
      clearCredentials: clearSyncConfig,
      clearWidgets: clearWidgetState,
      onWidgetError: (error) => {
        // ⚠️ 组件没清干净是这里**唯一真正危险**的失败，
        //    所以必须留下痕迹，而不是退化成没人知道的 false。
        console.warn('[widgets] 清除凭据时没能清掉小组件状态', error);
      },
    });
    form.clear();
    forgetSignedInUser();
  };

  /**
   * 「我的成长」是**第二层**页面，不是第 6 个底部标签。
   *
   * 🔴 底部标签必须保持 5 个（任务 / 日历 / 专注 / 分类 / 我的）。成长是
   * "关于我"的回顾视图，与设置同居一处才符合心智；挤进标签栏会让每个标签
   * 都读不清。返回靠成长屏顶栏的返回键（`GrowthScreen` 的 `onBack`）。
   *
   * ⚠️ 这些 `useState` 与下面的提前 return 必须**在所有 hook 之后** ——
   * 提前 return 会让后面没跑到的 hook 数量在两次渲染间变化，React 会直接报错。
   */
  const [growthOpen, setGrowthOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [habitsOpen, setHabitsOpen] = useState(false);

  /**
   * 本会话内登录过的账号邮箱（**只放内存**，见 `auth/session.ts`）。
   *
   * 🔴 它**不**等于 `form.configured`：后者是"有没有令牌"，而手动粘贴令牌
   * 这条兜底路径也会让 `configured` 为真、却没有邮箱。两者混用会让界面
   * 显示"当前账号：还没登录"而同步其实配好了 —— 一句自相矛盾的话。
   */
  const signedInEmail = currentSignedInEmail();

  // 🔴 为什么要把"慢"提前说出来。
  //
  // Hermes 没有 WebAssembly，Argon2id 只能走纯 JS 路径。**实测**：这台模拟器上
  // 一次派生约 30–40 秒，而同一会话内的第二次派生是 1–2 秒 ——
  // `sync-core` 的 session cache 把**同一个 salt** 的结果缓存住了。
  //
  // ⚠️ 但"只付一次"是**错的**说法。派生次数不取决于"同步了几次"，也不取决于
  // op 条数，而取决于**历史里出现过多少个不同的 salt**（加密侧一个会话一个；
  // 解密侧 ≈ 历史上不同"加密会话/口令世代"的个数）。实测 `user:37`（8 个
  // 客户端）首次同步 290 秒；空账号约 30–40 秒。文案因此给区间 + 说明原因。
  const slowKdf = isArgon2SlowBackend();

  /**
   * 「待上传」的三态判定在**共享层**（有单测）：`undefined` 是"还没读到"、
   * `0` 是"全传完了"，两者**绝不能合并**。英文单复数也归它判。
   *
   * ⚠️ 词条仍在这里选：门禁只认"字面量紧跟在 `t(` 之后"这一种形状，
   * 所以每个分支都写完整的 `t('key')`。
   */
  const pending = resolvePendingUploadPresentation(pendingUpload);
  const pendingValue =
    pending.kind === 'unknown'
      ? t('mobile.profile.pending.loading')
      : pending.kind === 'none'
        ? t('mobile.profile.pending.allUploaded')
        : t(pending.plural ? 'mobile.profile.pending.count' : 'mobile.profile.pending.countOne', {
            count: pending.count,
          });

  /** 同步状态卡里的**值行**（骨架来自共享 `SettingsRow`）。 */
  const statusRows: readonly SettingsRowModel[] = [
    {
      kind: 'value',
      label: t('mobile.profile.pending.label'),
      value: pendingValue,
      tone: pending.kind === 'count' ? 'default' : 'muted',
      valueTestID: 'profile-pending-value',
    },
    {
      kind: 'value',
      label: t('mobile.profile.lastSync.label'),
      value:
        lastSyncedAt === undefined
          ? t('mobile.profile.lastSync.never')
          : formatStamp(lastSyncedAt),
      tone: lastSyncedAt === undefined ? 'subtle' : 'muted',
      valueTestID: 'profile-last-sync-value',
    },
  ];

  /**
   * 「关于我 / 我的数据」的入口行。
   *
   * 🔴 **「设置」排第一**（goal M1：入口要在首屏一眼可见）—— 它是这组里
   * 唯一"配置类"的动作，也是搬动后凭据表单的新家；其余四项是"关于我"的
   * 回顾与后悔药，频率都低于它。骨架来自共享动作行。
   */
  const entryRows: readonly SettingsRowModel[] = [
    {
      kind: 'action',
      testID: 'profile-entry-settings',
      label: t('mobile.profile.entry.settings'),
      hint: t('mobile.profile.entry.settings.hint'),
      onPress: () => {
        setSettingsOpen(true);
      },
    },
    {
      kind: 'action',
      testID: 'profile-entry-growth',
      label: t('mobile.growth.entry'),
      hint: t('mobile.growth.entry.hint'),
      onPress: () => {
        setGrowthOpen(true);
      },
    },
    {
      kind: 'action',
      testID: 'profile-entry-habits',
      label: t('mobile.habits.entry'),
      hint: t('mobile.habits.entry.hint'),
      onPress: () => {
        setHabitsOpen(true);
      },
    },
    {
      kind: 'action',
      testID: 'profile-entry-trash',
      label: t('mobile.trash.entry'),
      hint: t('mobile.trash.entry.hint'),
      onPress: () => {
        setTrashOpen(true);
      },
    },
    {
      kind: 'action',
      testID: 'profile-entry-export',
      label: t('mobile.export.entry'),
      hint: t('mobile.export.entry.hint'),
      onPress: () => {
        setExportOpen(true);
      },
    },
  ];

  /**
   * 🔴 提前 return **必须在所有 hook 之后**（见 `growthOpen` 的注释）。
   * 成长屏自带顶栏返回，所以这里不需要任何导航库。
   */
  if (trashOpen) {
    return (
      <TrashScreen
        onBack={() => {
          setTrashOpen(false);
        }}
      />
    );
  }

  if (exportOpen) {
    return (
      <ExportScreen
        onBack={() => {
          setExportOpen(false);
        }}
      />
    );
  }

  if (authOpen) {
    return (
      <AuthScreen
        initialServerUrl={form.serverUrl}
        initialPassword={form.password}
        onBack={() => {
          setAuthOpen(false);
        }}
        onSignedIn={onSignedIn}
      />
    );
  }

  if (growthOpen) {
    return (
      <GrowthScreen
        onBack={() => {
          setGrowthOpen(false);
        }}
      />
    );
  }

  if (habitsOpen) {
    return (
      <HabitsScreen
        onBack={() => {
          setHabitsOpen(false);
        }}
      />
    );
  }

  return (
    <Screen title={t('mobile.profile.title')}>
      {/*
        🔴 **账号卡片（顶部，一级可见）** —— W3 · 规范 §3.1 的「前置」落点。
        在这一刀之前，本屏**只有**三个手填输入框，而没有任何地方告诉用户
        访问令牌从哪来。现在注册/登录是这一屏的**第一条**内容。
      */}
      <SectionHeader icon="action.settings" title={t('mobile.profile.section.account')} />
      <Card>
        <View style={{ gap: tokens['space.3'] }}>
          <SettingsRow
            row={{
              kind: 'value',
              label: t('mobile.profile.account.signedInLabel'),
              // 🔴 没登录时显示「还没登录」，**不是**空字符串：空值会被读成
              //    "读取中"或"界面坏了"，而这两件事的处置完全不同。
              value: signedInEmail ?? t('mobile.profile.account.offline'),
              tone: signedInEmail === undefined ? 'subtle' : 'default',
              valueTestID: 'profile-account-value',
            }}
          />
          <Text variant="caption" tone="subtle">
            {signedInEmail === undefined
              ? t('mobile.profile.account.offlineHint')
              : t('mobile.profile.account.signedInHint')}
          </Text>
        </View>
      </Card>
      <Button
        label={t('mobile.profile.account.signIn')}
        onPress={() => {
          setAuthOpen(true);
        }}
        tone="primary"
      />

      {/*
        同步状态。🔴 手动凭据表单已搬进设置面（上面的入口行第一项）；
        这里留的是**状态的呈现与手动重试** —— 用户看的是结果，
        改配置去设置面，两件事不再挤在一段滚动流里。
      */}
      <SectionHeader icon="action.sync" title={t('mobile.profile.section.status')} />
      <Card>
        <View style={{ gap: tokens['space.3'] }}>
          <StatusRow
            status={status}
            busy={busy}
            onOpenConflicts={() => {
              setConflictsOpen(true);
            }}
          />
          <Divider />
          {/* 值行的骨架来自共享 `SettingsRow`（`statusRows` 见上）。 */}
          {statusRows.map((row) => (
            <SettingsRow key={row.testID ?? row.kind} row={row} />
          ))}
        </View>
      </Card>

      <Button
        label={busy ? t('mobile.profile.sync.busy') : t('mobile.profile.sync.now')}
        onPress={form.submit}
        tone="primary"
        icon="action.sync"
        disabled={!form.configured}
        loading={busy}
      />
      {!form.configured ? (
        <Text variant="caption" tone="subtle" style={{ textAlign: 'center' }}>
          {t('mobile.profile.sync.notConfigured')}
        </Text>
      ) : null}
      {form.configured && slowKdf && status.kind !== 'synced' ? (
        <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {t('mobile.profile.sync.slowKdf')}
        </Text>
      ) : null}

      {/*
        「关于我 / 我的数据」的入口行（`entryRows` 见上，设置排第一）。
        🔴 成长**不是第 6 个底部标签**：标签栏必须保持 5 个（P10 / ADR-0015 §4）。
      */}
      <View style={{ gap: tokens['space.3'] }} testID="profile-entries">
        {entryRows.filter(shouldRenderSettingsRow).map((row) => (
          <SettingsRow key={row.testID ?? row.kind} row={row} />
        ))}
      </View>

      {/* 清单 / 标签 / 便签管理。顺序是**清单在标签前**（与任务详情页一致），
          便签排最后（它读的是 NOTE，与任务的组织维度无关）。 */}
      <ListsSection />
      <TagsSection />
      <NotesSection />

      <ConflictSheet
        visible={conflictsOpen}
        onClose={() => {
          setConflictsOpen(false);
        }}
      />

      {/*
        🔴 设置面 = **独立 surface（RN Modal）**，不是本屏滚动流的一段
        （goal M2）。本屏（含账号卡与表单状态）在它打开期间**照常挂着**。
      */}
      <SettingsScreen
        visible={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
        form={form}
        onClearCredentials={onClearCredentials}
      />
    </Screen>
  );
}

/** 同步状态那一行。**它必须说清是哪一种失败**，不能只写"同步失败"。 */
function StatusRow({
  status,
  busy,
  onOpenConflicts,
}: {
  status: SyncStatus;
  busy: boolean;
  onOpenConflicts: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  return (
    <View style={{ gap: tokens['space.1'] }}>
      <Text variant="row-title" tone={busy ? 'muted' : statusTone(status)}>
        {describeSyncStatus(status, t)}
      </Text>
      {status.kind === 'error' ? (
        <Text variant="caption" tone="danger" selectable>
          {status.message}
        </Text>
      ) : null}
      {status.kind === 'conflict' ? (
        <View style={{ gap: tokens['space.2'] }}>
          <Text variant="caption" tone="danger">
            {t('mobile.profile.conflict.body')}
          </Text>
          <Button
            label={t('mobile.profile.conflict.open')}
            icon="conflict.warning"
            onPress={onOpenConflicts}
          />
        </View>
      ) : null}
    </View>
  );
}
