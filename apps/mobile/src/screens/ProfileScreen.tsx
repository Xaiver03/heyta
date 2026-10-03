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

import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { pick } from '@react-native-documents/picker';
import type { SyncStatus } from '@heyta/sync-client';
import { useI18n } from '@heyta/i18n';
import { isArgon2SlowBackend } from '@heyta/sync-core';
import {
  deleteAccountAvatar,
  fetchAccountNotifications,
  getAccountProfile,
  planDisplayNameWrite,
  resolveAccountAvatarImage,
  updateAccountDisplayName,
  uploadAccountAvatar,
  type AccountAvatarImage,
} from '@heyta/app-host';
import {
  ACCOUNT_AVATAR_CONTENT_TYPES,
  ACCOUNT_AVATAR_MAX_SOURCE_BYTES,
  ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS,
  avatarDataUri,
  displayNameCodePoints,
} from '@heyta/shared-schema';
import {
  SettingsRow,
  resolvePendingUploadPresentation,
  shouldRenderSettingsRow,
  type SettingsRowModel,
} from '@heyta/ui';

import { Button, Card, Divider, HStack, Screen, SectionHeader, Text, TextField } from '../ui/kit';
import { AvatarBadge } from '../ui/avatar';
import { prepareAvatarFromUri, type AvatarPrepareError } from '../lib/avatar-prepare';
import { AuthScreen, type SavedAuthSession } from './AuthScreen';
import { ConflictSheet } from './ConflictSheet';
import { EntitlementSection } from './EntitlementSection';
import { ExportScreen } from './ExportScreen';
import { GrowthScreen } from './GrowthScreen';
import { HabitsScreen } from './HabitsScreen';
import { ListsSection } from './ListsSection';
import { NotesSection } from './NotesSection';
import { NotificationsScreen } from './NotificationsScreen';
import { SecurityScreen } from './SecurityScreen';
import { SettingsScreen } from './SettingsScreen';
import { TagsSection } from './TagsSection';
import { TrashScreen } from './TrashScreen';
import { formatStamp } from '../lib/date';
import { useTokens } from '../theme';
import { useSyncCredentialForm } from '../sync/credential-form';
import { clearSyncConfig, readSyncConfig } from '../sync/config';
import { describeSyncStatus, statusTone } from '../sync/status-text';
import { useMobileSync, refreshPendingUpload } from '../sync/store';
import { currentSignedInEmail, forgetSignedInUser } from '../auth/session';
import { privacyConsent, subscribePrivacyConsent } from '../privacy/consent-gate';
import { wipeCredentialsAndWidgets } from '../widgets/credential-wipe';
import { clearWidgetState } from '../widgets/widget-bridge';
import {
  disableVaultRootAutoUnlock,
  removeVaultRootKey,
  type VaultSecureStorageScope,
} from '../lib/vault-secure-storage';
import { invalidateTaskHostVaultSession } from '../db/open-host';

export function ProfileScreen(): React.JSX.Element {
  const { status, lastSyncedAt, pendingUpload, busy } = useMobileSync();
  const { t } = useI18n();
  const tokens = useTokens();

  /**
   * 凭据表单的状态与"输入即生效"接线 —— **活在本屏**（理由见
   * `credential-form.ts` 文件头）。设置面拿的是值与回调。
   */
  const form = useSyncCredentialForm();
  const [vaultCleanupPending, setVaultCleanupPending] = useState<VaultSecureStorageScope>();

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
    const config = readSyncConfig();
    const accountId = config?.accountId?.trim();
    let scope: VaultSecureStorageScope | undefined;
    if (config !== undefined && accountId !== undefined && accountId !== '') {
      try {
        scope = { serverOrigin: new URL(config.serverUrl).origin, accountId };
      } catch (error: unknown) {
        console.warn('[vault] logout secure root cleanup skipped for invalid server URL', error);
      }
    }

    // Fence remembered unlock before touching the live credentials. This is a
    // synchronous device-local write, so a failed native delete cannot make a
    // stale root usable during the next cold start.
    if (scope !== undefined) {
      try {
        disableVaultRootAutoUnlock(scope);
      } catch (error: unknown) {
        setVaultCleanupPending(scope);
        console.warn('[vault] logout remembered-unlock fence failed', error);
      }
    }
    // Only an already-open host may be invalidated. Logout must never await
    // opening it or perform a remote GET before clearing the token.
    invalidateTaskHostVaultSession();

    void (async () => {

      // `wipeCredentialsAndWidgets` clears sync config synchronously before
      // its first await, so no token remains usable while native cleanup runs.
      const wipePromise = wipeCredentialsAndWidgets({
        clearCredentials: clearSyncConfig,
        clearWidgets: clearWidgetState,
        onWidgetError: (error) => {
          console.warn('[widgets] 清除凭据时没能清掉小组件状态', error);
        },
      });
      form.clear();
      forgetSignedInUser();
      await wipePromise;

      if (scope !== undefined) {
        try {
          await removeVaultRootKey(scope);
          setVaultCleanupPending(undefined);
        } catch (error: unknown) {
          // Keep the scope in memory for an explicit retry. The auth material
          // is already gone, so a failed native delete cannot re-enable sync.
          setVaultCleanupPending(scope);
          console.warn('[vault] logout secure root cleanup failed', error);
        }
      }
    })();
  };

  const retryVaultCleanup = useCallback((): void => {
    const scope = vaultCleanupPending;
    if (scope === undefined) return;
    void removeVaultRootKey(scope)
      .then(() => setVaultCleanupPending(undefined))
      .catch((error: unknown) => {
        console.warn('[vault] retry secure root cleanup failed', error);
      });
  }, [vaultCleanupPending]);

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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);

  /**
   * 「通知」入口行的未读徽标（批二，多端覆盖审计 P0-2）。
   *
   * 数据源只有 inbox 的 `GET /api/notification`（未配置/未同意时**连请求都不发**
   * —— 出口闸的语义），读取时机三处：本屏挂载、从通知中心返回、同意状态变化
   * （首启点了同意之后徽标才可能出现 —— 不订阅就会记下"点了同意但没反应"）。
   */
  const [inboxUnread, setInboxUnread] = useState(0);
  const fetchInboxUnread = useCallback((): Promise<void> => {
    if (!privacyConsent.networkAllowed()) return Promise.resolve();
    const config = readSyncConfig();
    if (config === undefined || (config.token ?? '') === '') return Promise.resolve();
    return fetchAccountNotifications({
      baseUrl: config.serverUrl,
      getToken: async () => config.token,
    }).then((reading) => {
      if (reading.kind === 'ready') setInboxUnread(reading.unreadCount);
    });
  }, []);
  useEffect(() => {
    void fetchInboxUnread();
    return subscribePrivacyConsent(() => {
      void fetchInboxUnread();
    });
  }, [fetchInboxUnread]);

  /**
   * 昵称：服务端 `User` 上的**一列明文**，不是 op、不进 op-log。
   *
   * 🔴 读用 `getAccountProfile`、判用 `planDisplayNameWrite`、写用
   *   `updateAccountDisplayName` —— 三个函数与 web **同一份**（AGENTS §3.5）。
   *   "空框=清除不是空串""超长不发""没凭据不发""没改不发"这四条各写一遍
   *   就是四套裁决，而它们决定的正是"用户按下去到底发生了什么"。
   *
   * ⚠️ 出境同意闸门与徽标同一条：`networkAllowed()` 为假时**一个请求都不发**
   *   （不是"发出去再失败"）。所以这里没凭据/没同意 ⇒ 那一行不出现，
   *   而不是出现一个空的、点不动的昵称行。
   *
   * `savedName` 的三态是**有意的**：`undefined` = 还没读到（不渲染），
   * `null` = 读到了、用户确实没设（渲染那句「留空则显示邮箱」）。
   */
  const [savedName, setSavedName] = useState<string | null | undefined>(undefined);
  const [nameDraft, setNameDraft] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameNotice, setNameNotice] = useState<{ text: string; danger: boolean } | null>(null);

  const fetchDisplayName = useCallback((): Promise<void> => {
    if (!privacyConsent.networkAllowed()) return Promise.resolve();
    const config = readSyncConfig();
    const token = config?.token ?? '';
    if (config === undefined || config.serverUrl === '' || token === '') return Promise.resolve();
    return getAccountProfile({ baseUrl: config.serverUrl }, token).then((outcome) => {
      // 🔴 失败**不清空**已有读数：一次网络抖动不该让"你的昵称"在界面上凭空消失。
      if (!outcome.ok) return;
      setSavedName(outcome.displayName);
      // 同一次读取顺手带回 `avatarHash` —— 头像"有没有"的事实源就是这一行，
      // 不给它单开一次请求（多一次往返、还多一个可能不一致的读数）。
      setAvatarHash(outcome.avatarHash);
    });
  }, []);
  useEffect(() => {
    void fetchDisplayName();
  }, [fetchDisplayName]);

  const saveDisplayName = useCallback(async (): Promise<void> => {
    if (nameSaving) return;
    const config = readSyncConfig();
    const plan = planDisplayNameWrite({
      token: config === undefined || config.serverUrl === '' ? undefined : (config.token ?? ''),
      draft: nameDraft,
      saved: savedName,
    });
    if (plan.action === 'skip') {
      // 三种"不发"里只有超长需要说给用户：另外两种他看不出差别，说一句"没保存"
      // 反而是在暗示出过事。
      if (plan.reason === 'too-long') {
        setNameNotice({
          text: t('common.profile.nickname.toolong', {
            max: String(ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS),
            count: String(displayNameCodePoints(nameDraft)),
          }),
          danger: true,
        });
      }
      return;
    }
    setNameSaving(true);
    setNameNotice(null);
    const outcome = await updateAccountDisplayName(
      { baseUrl: config?.serverUrl ?? '' },
      plan.token,
      plan.value,
    );
    setNameSaving(false);
    if (!outcome.ok) {
      // 🔴 说的是**昵称**那句。web 这里曾经复用头像的失败文案（"头像没有传上去"），
      //    于是昵称没存上时界面在讲另一件事 —— 判据钉在 profile-panel 那一侧。
      setNameNotice({ text: t('common.profile.nickname.failed'), danger: true });
      return;
    }
    setSavedName(outcome.displayName);
    setNameEditing(false);
    setNameNotice({
      text:
        outcome.displayName === null
          ? t('common.profile.nickname.cleared')
          : t('common.profile.nickname.saved'),
      danger: false,
    });
    void fetchDisplayName();
  }, [fetchDisplayName, nameDraft, nameSaving, savedName, t]);

  /**
   * 头像：一张**端到端加密的图片**，读写都要那把同步口令。
   *
   * 🔴 读它分两步，而且这两步答的是**两个不同的问题**：
   * `getAccountProfile` 给的是 `avatarHash`（服务端只知道这个，它看不到内容），
   * 有了 hash 才去 `GET account/avatar` 取密文并用口令解开。
   * 所以"这台设备现在显示不出头像"有五种原因，而它们对应的**用户动作不同**：
   * 没有头像（想设就设）/ 本机没填口令（去填）/ 口令不对（去核对）/
   * 暂时取不到（稍后重试）/ 这台设备没有读图通道（先用网页版）。
   * 把这五种并成一句"头像没有传上去"，症状是界面在对着一件没发生过的事说话 ——
   * 这正是 web 那边已经钉过一次的那一族，所以这里从一开始就分开。
   * 判定住在 `resolveAccountAvatarImage`（app-host），界面只按状态出句子。
   *
   * ⚠️ `avatarHash` 的三态与 `savedName` 同一条理由：`undefined` = 还没读到
   * （那一整块不渲染），`null` = 读到了、确实没有头像。
   */
  const [avatarHash, setAvatarHash] = useState<string | null | undefined>(undefined);
  const [avatarImage, setAvatarImage] = useState<string | undefined>(undefined);
  const [avatarState, setAvatarState] = useState<AccountAvatarImage['state'] | undefined>(
    undefined,
  );
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarNotice, setAvatarNotice] = useState<{ text: string; danger: boolean } | null>(null);

  /** 读侧的那句话：只有"有头像却显示不出来"才需要说，`absent` 不是一件事。 */
  const avatarReadMessage =
    avatarState === 'undecryptable'
      ? t('common.profile.avatar.undecryptable')
      : avatarState === 'unreadable'
        ? t('common.profile.avatar.unreadable')
        : null;

  const fetchAvatarImage = useCallback((): Promise<void> => {
    // `null` = 服务端说没有 ⇒ **一个请求都不发**（这是契约前提，不是优化）。
    if (avatarHash === undefined || avatarHash === null) return Promise.resolve();
    if (!privacyConsent.networkAllowed()) return Promise.resolve();
    const config = readSyncConfig();
    const token = config?.token ?? '';
    if (config === undefined || config.serverUrl === '' || token === '') return Promise.resolve();
    return resolveAccountAvatarImage(
      { baseUrl: config.serverUrl },
      token,
      config.password,
      avatarHash,
    ).then((reading) => {
      setAvatarState(reading.state);
      // 🔴 失败**不清掉**上一次显示的那张图：一次取不到不该让已经看到的头像凭空消失，
      //    但它也不会被当成"最新的"——下一句 `avatarReadMessage` 会说明它可能不是最新。
      if (reading.state === 'ready') setAvatarImage(reading.dataUri);
      else if (reading.state === 'absent') setAvatarImage(undefined);
    });
  }, [avatarHash]);
  useEffect(() => {
    void fetchAvatarImage();
  }, [fetchAvatarImage]);

  /**
   * 需要口令的那句话只在**共享裁决**说"缺口令"时出现。
   *
   * ⚠️ 这里刻意不在渲染期读 `readSyncConfig()`：凭据是模块级可变状态，
   * 渲染期读它会在"用户刚在设置面填了口令"那一刻保持旧值，
   * 于是界面继续说"本机没有口令"。`avatarState` 是上一次真实读到的结论，
   * 而"去设置里填一次"这个动作完成后会重读资料 —— 它跟着事实走，不跟着猜测走。
   */
  const needsPassword = avatarState === 'needs-password';

  const prepareMessage = useCallback(
    (error: AvatarPrepareError): string =>
      error === 'bad-type'
        ? t('common.profile.avatar.badType', {
            types: ACCOUNT_AVATAR_CONTENT_TYPES.map((c) => c.replace('image/', '')).join(' / '),
          })
        : error === 'too-big'
          ? t('common.profile.avatar.tooBig', {
              max: `${Math.floor(ACCOUNT_AVATAR_MAX_SOURCE_BYTES / 1024)} KB`,
            })
          : error === 'no-channel'
            ? t('mobile.profile.avatar.noChannel')
            : t('common.profile.avatar.failed'),
    [t],
  );

  const changeAvatar = useCallback(async (): Promise<void> => {
    if (avatarBusy) return;
    const config = readSyncConfig();
    const token = config?.token ?? '';
    const password = config?.password ?? '';
    if (config === undefined || config.serverUrl === '' || token === '' || password === '') {
      // 说的是"为什么现在不能换"，不是"换失败了"——一次请求都没发出去。
      setAvatarNotice({ text: t('common.profile.avatar.needPassword'), danger: true });
      return;
    }
    setAvatarNotice(null);
    const picked = await pick({ allowMultiSelection: false }).catch((e: unknown) => {
      // 取消是正常路径（静默）；其他码不能说谎。
      if ((e as { code?: string }).code === 'OPERATION_CANCELED') return undefined;
      setAvatarNotice({ text: t('common.profile.avatar.failed'), danger: true });
      return undefined;
    });
    if (picked === undefined) return;
    const doc = picked[0];
    if (doc === undefined) {
      setAvatarNotice({ text: t('common.profile.avatar.failed'), danger: true });
      return;
    }
    setAvatarBusy(true);
    const prepared = await prepareAvatarFromUri(doc.uri, doc.type ?? doc.nativeType ?? '');
    if (!prepared.ok) {
      setAvatarBusy(false);
      setAvatarNotice({ text: prepareMessage(prepared.error), danger: true });
      return;
    }
    const outcome = await uploadAccountAvatar(
      { baseUrl: config.serverUrl },
      token,
      password,
      prepared.image,
    );
    setAvatarBusy(false);
    if (!outcome.ok) {
      setAvatarNotice({ text: t('common.profile.avatar.failed'), danger: true });
      return;
    }
    // 本地图立刻显示（不等下一次读），hash 换成服务端给的那一枚。
    setAvatarImage(avatarDataUri(prepared.image));
    setAvatarState('ready');
    setAvatarHash(outcome.avatarHash);
    setAvatarNotice({ text: t('common.profile.avatar.uploaded'), danger: false });
  }, [avatarBusy, prepareMessage, t]);

  const removeAvatar = useCallback(async (): Promise<void> => {
    if (avatarBusy) return;
    const config = readSyncConfig();
    const token = config?.token ?? '';
    if (config === undefined || config.serverUrl === '' || token === '') return;
    setAvatarBusy(true);
    const outcome = await deleteAccountAvatar({ baseUrl: config.serverUrl }, token);
    setAvatarBusy(false);
    if (!outcome.ok) {
      setAvatarNotice({ text: t('common.profile.avatar.failed'), danger: true });
      return;
    }
    setAvatarImage(undefined);
    setAvatarState('absent');
    setAvatarHash(null);
    setAvatarNotice({ text: t('common.profile.avatar.removed'), danger: false });
  }, [avatarBusy, t]);

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
      testID: 'profile-entry-notifications',
      label: t('mobile.inbox.trigger'),
      hint: t('mobile.inbox.entry.hint'),
      onPress: () => {
        setNotificationsOpen(true);
      },
      leading:
        inboxUnread > 0 ? (
          <View
            accessibilityLabel={t('mobile.inbox.badge.aria', { count: inboxUnread })}
            style={{
              minWidth: tokens['space.6'],
              paddingHorizontal: tokens['space.2'],
              paddingVertical: tokens['space.1'],
              borderRadius: tokens['radius.full'],
              backgroundColor: tokens['color.primary'],
              alignItems: 'center',
            }}
          >
            <Text variant="caption" style={{ color: tokens['color.on-primary'] }}>
              {inboxUnread}
            </Text>
          </View>
        ) : undefined,
    },
    {
      kind: 'action',
      testID: 'profile-entry-security',
      label: t('mobile.security.trigger'),
      hint: t('mobile.security.entry.hint'),
      onPress: () => {
        setSecurityOpen(true);
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
  if (securityOpen) {
    return (
      <SecurityScreen
        onBack={() => {
          setSecurityOpen(false);
        }}
        onPasswordChanged={(newToken) => {
          // 🔴 令牌轮换的落盘（批四变异靶）：不写活配置，下一次同步就 401 ——
          // "改个密码把自己这台设备也踢出去"（hosted-auth.ts 文件头原话）。
          // 写完立即重验同步，判据在 verify-mobile-account.sh 的步骤 5。
          form.setToken(newToken);
          form.submit();
        }}
      />
    );
  }

  if (notificationsOpen) {
    return (
      <NotificationsScreen
        onBack={() => {
          setNotificationsOpen(false);
          // 返回即重读未读数：自动已读发生在通知中心里，徽标在这里清零。
          void fetchInboxUnread();
        }}
        onUnreadCountChange={setInboxUnread}
      />
    );
  }

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

  /**
   * 头像那一行**一次只说一句**，优先级从"用户刚做的事"往"环境缺什么"排：
   * 刚上传/刚移除的结果 > 这台设备读不到头像 > 本机没有口令。
   *
   * 🔴 叠三句会被读成"出过三件事"，而这里三句互相排斥：
   * 上传成功后再说一句"缺口令"就是自相矛盾（他刚用完口令）。
   */
  const avatarLine =
    avatarNotice?.text ??
    avatarReadMessage ??
    (needsPassword ? t('common.profile.avatar.needPassword') : null);
  const avatarLineDanger =
    avatarNotice !== null ? avatarNotice.danger : avatarReadMessage !== null;

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
          {/*
            🔴 昵称行**只在真的读到之后**出现。没凭据 / 没同意出境 ⇒ 一个请求都不发，
            于是这里连行都不画 —— 画一行"昵称：（空）"会被读成"设置坏了"，
            而它其实是"你还没登录"。这两件事在界面上必须长得不一样。

            ⚠️ 这一段**一个 `style={{ }}` 都不许出现**：`check:l4` 的 mobile 段
            现量恰在基线 90、零余量（只减不增的棘轮）。行、输入框、按钮的样式
            全在 `SettingsRow` 与 `ui/kit` 里，这里只给模型与文案。
          */}
          {/*
            🔴 头像行与昵称行**同一次读取**才出现（`savedName === undefined` 就是不出现）。
            理由与昵称那条一样：没登录时画一个空的、点不动的头像圈，
            会被读成"设置坏了"，而它其实是"你还没登录"。

            ⚠️ 这一段同样**一个 `style={{ }}` 都不许有**：圈和图的样式在 `ui/avatar.tsx`
            （那是 `check:l4` mobile 段豁免的目录），这里只给数据与文案。
          */}
          {savedName === undefined ? null : (
            <>
              <HStack gap="default" align="center">
                <AvatarBadge dataUri={avatarImage} email={signedInEmail} />
                <Text variant="row-title" grow>
                  {t('common.profile.avatar.label')}
                </Text>
              </HStack>
              <HStack gap="tight">
                <Button
                  label={t('common.profile.avatar.change')}
                  onPress={() => {
                    void changeAvatar();
                  }}
                  tone="secondary"
                  loading={avatarBusy}
                />
                {avatarImage === undefined ? null : (
                  <Button
                    label={t('common.profile.avatar.remove')}
                    onPress={() => {
                      void removeAvatar();
                    }}
                    tone="ghost"
                    loading={avatarBusy}
                  />
                )}
              </HStack>
              {avatarLine === null ? null : (
                <Text variant="caption" tone={avatarLineDanger ? 'danger' : 'subtle'}>
                  {avatarLine}
                </Text>
              )}
            </>
          )}
          {savedName === undefined ? null : nameEditing ? (
            <>
              <TextField
                label={t('common.profile.nickname.label')}
                value={nameDraft}
                onChangeText={(next) => {
                  setNameDraft(next);
                  setNameNotice(null);
                }}
                placeholder={t('common.profile.nickname.placeholder')}
                hint={
                  nameNotice?.text ??
                  t('common.profile.nickname.hint', {
                    max: String(ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS),
                  })
                }
                hintTone={nameNotice?.danger === true ? 'danger' : 'subtle'}
                onSubmitEditing={() => {
                  void saveDisplayName();
                }}
                testID="profile-nickname-input"
              />
              <Button
                label={t('common.profile.nickname.save')}
                onPress={() => {
                  void saveDisplayName();
                }}
                tone="primary"
                loading={nameSaving}
              />
              <Button
                label={t('mobile.common.cancel')}
                onPress={() => {
                  setNameEditing(false);
                  setNameNotice(null);
                }}
                tone="ghost"
              />
            </>
          ) : (
            <>
              <SettingsRow
                row={{
                  kind: 'value',
                  label: t('common.profile.nickname.label'),
                  // 🔴 `null` 显示的是那句「留空则显示邮箱」，**不是空字符串**：
                  //    空值会被读成"没读到"，而那与"读到了、用户确实没设"是两件事。
                  value: savedName ?? t('common.profile.nickname.placeholder'),
                  tone: savedName === null ? 'subtle' : 'default',
                  onPress: () => {
                    setNameDraft(savedName ?? '');
                    setNameNotice(null);
                    setNameEditing(true);
                  },
                  valueTestID: 'profile-nickname-value',
                }}
              />
              <Text
                variant="caption"
                tone={nameNotice?.danger === true ? 'danger' : 'subtle'}
              >
                {nameNotice?.text ?? t('mobile.profile.nickname.hint')}
              </Text>
            </>
          )}
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

      {/*
        托管同步权益（「已开启」/「已到期」/「暂不可用」）。独立成组件有两个理由：
        ① 它要发一次出境探测，得跟着 `privacyConsent` 闸门走，不该混进这屏的
        凭据/头像状态机；② 本文件的冻结判据（`profile-nickname-entry.spec.ts:144`）
        要求这里**一个 web 前缀的词条调用都没有**，而那三条说明是 web 已有的真词条
        —— 复用它们、不复制第二份，所以引用只能落在这个独立文件里。
        没有权益可说时它自己返回 null（不占位）。
      */}
      <EntitlementSection />

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
        vaultCleanupPending={vaultCleanupPending !== undefined}
        onRetryVaultCleanup={retryVaultCleanup}
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
