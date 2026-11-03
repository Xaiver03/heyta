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
 *   · 本屏呈现只读身份、近期回顾、简短同步状态与功能入口；
 *   · 唯一个人资料编辑器、同步详情、数据管理与安全在 `SettingsScreen`（RN Modal）里；
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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
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
  AssistantMark,
  SettingsRow,
  resolvePendingUploadPresentation,
  type SettingsRowModel,
} from '@heyta/ui';

import { Button, Card, Divider, HStack, Screen, SectionHeader, Stack, Text, TextField } from '../ui/kit';
import { Icon, type IconName } from '../ui/icons';
import { MOBILE_PROFILE_ENTRIES, type MobileProfileEntryKey } from '../nav/feature-entries';
import { AssistantScreen } from '../ai/AssistantScreen';
import { AiToolboxScreen } from '../ai/AiToolboxScreen';
import { AvatarBadge } from '../ui/avatar';
import { prepareAvatarFromUri, type AvatarPrepareError } from '../lib/avatar-prepare';
import { AccountClosureScreen } from './AccountClosureScreen';
import { AuthScreen, type SavedAuthSession } from './AuthScreen';
import { ConflictSheet } from './ConflictSheet';
import { CountdownScreen } from './CountdownScreen';
import { EmailChangeSection } from './EmailChangeSection';
// 托管同步的续费入口（与 web 的 RenewPanel 共用 @heyta/app-host 那一份接线）。
import { ExportScreen } from './ExportScreen';
import { GrowthScreen } from './GrowthScreen';
import { ProfileProgressSummary } from './ProfileProgressSummary';
import { HabitsScreen } from './HabitsScreen';
// M6：共享屏是**默认导出**（第三枚并行代理交付，契约名固定）。
import ShareSpaceScreen from './ShareSpaceScreen';
import { ListsSection } from './ListsSection';
import { NotesSection } from './NotesSection';
import { NotificationsScreen } from './NotificationsScreen';
import {
  shareActivityUnreadCount,
  subscribeShareActivityFeed,
} from '../share/share-activity-notify';
import { SecurityScreen } from './SecurityScreen';
import { SettingsScreen, type SettingsSectionKey } from './SettingsScreen';
import { TagsSection } from './TagsSection';
import { TrashScreen } from './TrashScreen';
import { AbandonedScreen } from './AbandonedScreen';
import { formatStamp } from '../lib/date';
import { useTokens } from '../theme';
import { useSyncCredentialForm } from '../sync/credential-form';
import { DEFAULT_SERVER_URL, readSyncConfig, writeSyncConfig } from '../sync/config';
import { describeSyncStatus, statusTone } from '../sync/status-text';
import { useMobileSync, refreshPendingUpload } from '../sync/store';
import { currentSignedInEmail, forgetSignedInUser } from '../auth/session';
import { retryServerRevocation, signOutCurrentDevice } from '../auth/sign-out-flow';
import { privacyConsent, subscribePrivacyConsent } from '../privacy/consent-gate';
import { wipeCredentialsAndWidgets } from '../widgets/credential-wipe';
import { clearWidgetState } from '../widgets/widget-bridge';
import {
  type VaultSecureStorageScope,
} from '../lib/vault-secure-storage';
import { clearMobileVaultSession } from '../lib/vault-session-cleanup';
import { useMobileNavigation } from '../nav/navigation';
import { isProfileAssistantVisible } from '../nav/navigation-state';

export function ProfileScreen(): React.JSX.Element {
  const { status, lastSyncedAt, pendingUpload, busy } = useMobileSync();
  const { t } = useI18n();
  const tokens = useTokens();
  const navigation = useMobileNavigation();

  /**
   * 凭据表单的状态与"输入即生效"接线 —— **活在本屏**（理由见
   * `credential-form.ts` 文件头）。设置面拿的是值与回调。
   */
  const [vaultCleanupPending, setVaultCleanupPending] = useState<VaultSecureStorageScope>();
  /** 小组件清理失败必须留在界面上，直到一次显式重试成功。 */
  const [widgetCleanupPending, setWidgetCleanupPending] = useState(false);
  const [widgetCleanupRetrying, setWidgetCleanupRetrying] = useState(false);
  const form = useSyncCredentialForm(setVaultCleanupPending);

  // 🔴 冲突界面的可见性只是**界面状态**，不进 store。
  const [conflictsOpen, setConflictsOpen] = useState(false);

  /** 设置面是当前 tab 的二级栈页面；返回优先 pop 回个人页。 */
  const settingsOpen = navigation.tab === 'profile' && navigation.stack.at(-1)?.key === 'settings';
  const [settingsSection, setSettingsSection] = useState<SettingsSectionKey>();

  // The profile screen stays mounted while tabs switch. Drop a pending
  // shortcut section when leaving the profile tab so returning to a retained
  // settings entry always opens the directory, never a stale child page.
  useEffect(() => {
    if (navigation.tab !== 'profile') setSettingsSection(undefined);
  }, [navigation.tab]);

  /**
   * 注册 / 登录面板（W3 · 规范 §3.1 的「前置」落点）。
   *
   * 🔴 它是**第二层页面**，不是第 6 个 tab —— 规范 §2-A8 与 ADR-0015 §4
   * 都把"底部标签保持 5 个"写成硬约束。入口在**本屏顶部的账号卡片**下
   * （一级可见），所以"前置"兑现为"冷启动 ≤1 次点击"而不是"多一个标签"。
   */
  const authOpen = navigation.tab === 'profile' && navigation.stack.at(-1)?.key === 'profile:auth';
  const [authAllowServerSelection, setAuthAllowServerSelection] = useState(false);
  const setAuthOpen = (open: boolean): void => {
    if (open) navigation.push('profile:auth');
    else {
      setAuthAllowServerSelection(false);
      navigation.pop();
    }
  };
  /** 普通账号入口只连官方服务；自托管登录必须从同步设置的高级路径进入。 */
  const openAuth = (allowServerSelection = false): void => {
    if (!allowServerSelection) {
      form.setServerUrl(DEFAULT_SERVER_URL);
    }
    setAuthAllowServerSelection(allowServerSelection);
    setAuthOpen(true);
  };
  /** 登录/切换账号后，个人资料摘要必须按新账号重新读，不能沿用旧账号的投影。 */
  const [profileRevision, setProfileRevision] = useState(0);
  const profileGeneration = useRef(0);

  /**
   * 登录成功之后把令牌 / 地址 / 口令**回填到表单**。
   *
   * 🔴 回填不是外观问题：表单的 `token` 是本屏的状态（初值取自
   * `readSyncConfig()`），不回填的话用户随后点「立即同步」会用**空输入框**
   * 把刚拿到的令牌覆盖掉 —— 症状是"明明登录成功了，一同步就说未配置"。
   */
  const onSignedIn = (saved: SavedAuthSession): void => {
    // 先让旧账号的资料请求失效，再回填新凭据；慢请求返回时不能把旧头像/昵称写回来。
    profileGeneration.current += 1;
    setProfileRevision((revision) => revision + 1);
    // The form is already mounted while AuthScreen is open.  Replaying its
    // three controlled values can run its input effect between React commits;
    // that effect intentionally omits accountId because ordinary manual edits
    // must not invent an authenticated binding.  Re-assert the complete
    // authenticated tuple here so a login cannot leave VaultSettingsSection
    // with a token but no account scope.
    writeSyncConfig({
      serverUrl: saved.serverUrl,
      token: saved.token,
      password: saved.password,
      ...(saved.accountId === undefined ? {} : { accountId: saved.accountId }),
    });
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
    profileGeneration.current += 1;
    setProfileRevision((revision) => revision + 1);
    const config = readSyncConfig();
    const accountId = config?.accountId?.trim();
    setWidgetCleanupPending(false);
    setWidgetCleanupRetrying(false);
    let scope: VaultSecureStorageScope | undefined;
    if (config !== undefined && accountId !== undefined && accountId !== '') {
      try {
        scope = { serverOrigin: new URL(config.serverUrl).origin, accountId };
      } catch (error: unknown) {
        console.warn('[vault] logout secure root cleanup skipped for invalid server URL', error);
      }
    }

    void (async () => {
      // This shared helper fences remembered unlock, invalidates the already
      // open host, clears live credentials synchronously, and removes the
      // native root key. Device revocation uses the same sequence.
      const cleanupPromise = clearMobileVaultSession(scope);

      // Credentials were already cleared by the shared helper. Keep the
      // widget wipe in this existing composition point; it is unrelated to
      // the vault security boundary and must still happen if secure cleanup
      // later reports a native deletion failure.
      const wipePromise = wipeCredentialsAndWidgets({
        clearCredentials: () => undefined,
        clearWidgets: clearWidgetState,
        onWidgetError: (error) => {
          console.warn('[widgets] 清除凭据时没能清掉小组件状态', error);
        },
      });
      form.clear();
      forgetSignedInUser();
      const wipe = await wipePromise;
      // 账号凭据已经清掉，但小组件可能仍留着上一个账号的快照。
      // 这条状态与 Vault 清理分开呈现，且必须保留到重试成功。
      setWidgetCleanupPending(!wipe.widgetsCleared);
      const cleanup = await cleanupPromise;
      if (cleanup.secureStorageError !== undefined) {
        setVaultCleanupPending(scope);
        console.warn('[vault] logout secure root cleanup failed', cleanup.secureStorageError);
      } else {
        setVaultCleanupPending(undefined);
      }
    })();
  };

  const retryWidgetCleanup = useCallback((): void => {
    if (!widgetCleanupPending || widgetCleanupRetrying) return;
    setWidgetCleanupRetrying(true);
    void clearWidgetState()
      .then(() => {
        setWidgetCleanupPending(false);
      })
      .catch((error: unknown) => {
        setWidgetCleanupPending(true);
        console.warn('[widgets] 重试清理小组件状态失败', error);
      })
      .finally(() => {
        setWidgetCleanupRetrying(false);
      });
  }, [widgetCleanupPending, widgetCleanupRetrying]);

  const retryVaultCleanup = useCallback((): void => {
    const scope = vaultCleanupPending;
    if (scope === undefined) return;
    void clearMobileVaultSession(scope, {
      // Retry only the native item; credentials are already gone and the host
      // fence is harmless but must not be replaced with a weaker direct call.
      clearCredentials: () => undefined,
    }).then((cleanup) => {
      if (cleanup.secureStorageError === undefined) setVaultCleanupPending(undefined);
      else console.warn('[vault] retry secure root cleanup failed', cleanup.secureStorageError);
    });
  }, [vaultCleanupPending]);

  /**
   * 「我的成长」是**第二层**页面，不是第 6 个底部标签。
   *
   * 🔴 底部标签必须保持 5 个（任务 / 日历 / 专注 / 分类 / 我的）。成长是
   * "关于我"的回顾视图，与设置同居一处才符合心智；挤进标签栏会让每个标签
   * 都读不清。返回靠那一屏顶栏的返回键（各自的 `onBack`）。
   *
   * 🔴 **2026-10-04（W8）：功能域那一档入口改由 `nav/feature-entries.ts` 生成。**
   * 原来是 `growthOpen` / `habitsOpen` 两个布尔 + 两段手写行 —— 那就是
   * "同一个判断写两遍"，加第三个功能域（倒数纪念日）会写成第三遍，
   * 而漏掉一处**不会报错**（少一个 setState 调用点 = 点了没反应）。
   * 现在是一张表 + 一条栈路由 + 一个穷尽 switch：**加一项不接屏 = 编译错误**。
   *
   * 功能域二级页使用当前 tab 的轻量导航栈，而不是本屏的局部状态。这样 Android
   * 硬件返回会先 pop 回「我的」，不会因为 ProfileScreen 仍是持久挂载的隐藏实例而
   * 直接把用户带回「任务」。`navigation.tab` 的判断也很关键：ProfileScreen 在
   * 切换 tab 时不会卸载，不能把其他 tab 的栈项解释成自己的页面。
   */
  const activeProfileRoute = navigation.tab === 'profile' ? navigation.stack.at(-1)?.key : undefined;
  const openFeature = featureKeyFromRoute(activeProfileRoute);
  const trashOpen = navigation.tab === 'profile' && navigation.stack.at(-1)?.key === 'profile:trash';
  const setTrashOpen = (open: boolean): void => {
    if (open) navigation.push('profile:trash');
    else navigation.pop();
  };
  /**
   * 「已放弃」与回收站同一个形状：第二层**整屏**，不是第 6 个 tab。
   * 它登记的唯一理由在 ADR-0083 §4.3 —— 放弃必须有看得见的出口。
   */
  const abandonedOpen =
    navigation.tab === 'profile' && navigation.stack.at(-1)?.key === 'profile:abandoned';
  const setAbandonedOpen = (open: boolean): void => {
    if (open) navigation.push('profile:abandoned');
    else navigation.pop();
  };
  const exportOpen = navigation.tab === 'profile' && navigation.stack.at(-1)?.key === 'profile:export';
  const setExportOpen = (open: boolean): void => {
    if (open) navigation.push('profile:export');
    else navigation.pop();
  };
  const closureOpen = navigation.tab === 'profile' && navigation.stack.at(-1)?.key === 'profile:closure';
  const setClosureOpen = (open: boolean): void => {
    if (open) navigation.push('profile:closure');
    else navigation.pop();
  };
  const notificationsOpen = navigation.tab === 'profile' && navigation.stack.at(-1)?.key === 'profile:notifications';
  const setNotificationsOpen = (open: boolean): void => {
    if (open) navigation.push('profile:notifications');
    else navigation.pop();
  };
  const securityOpen = navigation.tab === 'profile' && navigation.stack.at(-1)?.key === 'profile:security';
  const setSecurityOpen = (open: boolean): void => {
    if (open) navigation.push('profile:security');
    else navigation.pop();
  };

  /**
   * 「退出登录」= **撤销手上这一枚** + 一定清本机。
   *
   * 🔴 在这一笔之前移动端没有"退出登录"这个动作，只有设置面里那颗
   * 「清除本机保存的凭据」—— 它**什么都不撤销**，而那枚访问令牌在服务端
   * 还能用一整年（`packages/shared-schema/src/session-contract.ts` 文件头记的就是
   * 这件事）。在共享电脑上，那枚令牌加上"我已经退出了"这句界面就是一句谎。
   *
   * 状态为什么挂在**本屏**而不是挂在 `SecurityScreen`：
   *   · 退出之后「账号与安全」那屏要关掉（它已经没有凭据可管），
   *     而那句"服务器上那一枚还没撤成"必须**活过**这次关闭 ——
   *     放在子屏里就是随它一起卸载，正好把唯一需要被看见的东西藏起来。
   *   · 重试要用**发起时那枚**令牌与地址；本屏清完凭据后 `readSyncConfig()`
   *     已经是空的，从那里读会拼出一个"对着空地址重试"的死循环。
   */
  const [pendingRevocation, setPendingRevocation] = useState<
    { baseUrl: string; token: string } | null
  >(null);
  const [signedOutEverywhere, setSignedOutEverywhere] = useState(false);

  const runSignOut = useCallback(async (): Promise<void> => {
    const baseUrl = form.serverUrl;
    const currentToken = form.token;
    // 🔴 `onClearCredentials` 在**请求回来之后**被调用，而且两条分支都会调用一次
    //    （成功、失败都算）。判据在 `tests/sign-out-flow.spec.ts`。
    const plan = await signOutCurrentDevice({
      options: { baseUrl },
      token: currentToken,
      clearLocal: onClearCredentials,
    });
    setSignedOutEverywhere(false);
    setPendingRevocation(plan.serverRevocationPending ? { baseUrl, token: currentToken } : null);
    setSecurityOpen(false);
  }, [form.serverUrl, form.token, onClearCredentials, setSecurityOpen]);

  const retryRevocation = useCallback(async (): Promise<void> => {
    const pending = pendingRevocation;
    if (pending === null) return;
    const stillPending = await retryServerRevocation({
      options: { baseUrl: pending.baseUrl },
      token: pending.token,
    });
    // 🔴 只有服务端**不再认这枚令牌**（`unauthorized`）或撤销成功才算摘掉；
    // 网络类失败继续挂着，否则这句实话会在一次没做成的重试之后自己消失。
    if (!stillPending) setPendingRevocation(null);
  }, [pendingRevocation]);

  /**
   * 「退出所有设备」成功之后：服务端已经删掉全部会话行并 bump 了 `tokenVersion`，
   * **手上这一枚一起死了** ⇒ 走与「退出登录」同一条本机清理路径，
   * 只是不再有"服务器还没撤成"这句话可说。
   */
  const runSignOutEverywhere = useCallback((): void => {
    onClearCredentials();
    setPendingRevocation(null);
    setSignedOutEverywhere(true);
    setSecurityOpen(false);
  }, [onClearCredentials, setSecurityOpen]);

  /**
   * 单一对话助手，与个人中心共用已有导航栈。
   *
   * 🔴 它是**第二层屏**，不是第 6 个标签 —— 与成长 / 回收站 / 导出同一条纪律。
   * 入口常驻，与 Web 的单一助手一致。未配置远端时仍可执行本地读取，
   * 需要模型的请求由共享层返回设置提示；可见入口本身不授予出境权限。
   */
  // Keep the assistant mounted while another root tab is visible so an in-flight
  // proposal/draft survives tab switching.  Visibility is separate: the hidden
  // instance must not register an Android Back handler (see AssistantScreen).
  const assistantOpen = navigation.stacks.profile.at(-1)?.key === 'profile:assistant';
  const setAssistantOpen = (open: boolean): void => {
    if (open) navigation.push('profile:assistant');
    else navigation.pop();
  };

  const toolboxOpen = navigation.stacks.profile.at(-1)?.key === 'profile:ai-toolbox';
  const setToolboxOpen = (open: boolean): void => {
    if (open) navigation.push('profile:ai-toolbox');
    else navigation.pop();
  };

  /**
   * 「功能与 AI」枢纽页（5 个功能域的第二层入口）。
   *
   * 🔴 它和成长 / 回收站 / 导出同一条纪律：**第二层整屏**，不是第 6 个 tab
   *    （ADR-0015 §4 / P10：底部标签保持 5 个）。走上层那条 `navigation` 栈，
   *    所以返回键与 Android 硬件返回是同一条路径（不是本屏的局部状态）。
   */
  const featuresOpen = navigation.stacks.profile.at(-1)?.key === 'profile:features';

  /**
   * 「通知」入口行的未读徽标（批二，多端覆盖审计 P0-2）。
   *
   * 这一格只取 inbox 的 `GET /api/notification`（未配置/未同意时**连请求都不发**
   * —— 出口闸的语义），读取时机三处：本屏挂载、从通知中心返回、同意状态变化
   * （首启点了同意之后徽标才可能出现 —— 不订阅就会记下"点了同意但没反应"）。
   * ⚠️ 画在入口上的是它**加上**下面那格（共享动态的未读数）之后的数，见 `inboxBadge`。
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
   * 共享动态的未读数（本机内存那一份，零请求）—— 和上面那格**相加**成同一枚徽标。
   *
   * 这一格存在的理由不是"多个数字好看"：移动端的系统横幅今天做不到（原因登记在
   * `share/share-activity-notify.ts` 文件头），所以产品定义里"按本机偏好打扰用户"
   * 落到界面上的**唯一**一处回执就是这个数。少了它，投递面写进动态的每一条都得用户
   * 自己想到去点开通知中心第三档才看得见 —— 那是"投了没人看"，不是"打扰"。
   * 🔴 初始值用惰性初始化读当下那一份：动态可能在本屏挂载之前就已经攒上了。
   */
  const [shareUnread, setShareUnread] = useState(shareActivityUnreadCount);
  useEffect(
    () =>
      subscribeShareActivityFeed(() => {
        setShareUnread(shareActivityUnreadCount());
      }),
    [],
  );
  const inboxBadge = inboxUnread + shareUnread;

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
  const [profileReadState, setProfileReadState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [profileNetworkAllowed, setProfileNetworkAllowed] = useState(() => privacyConsent.networkAllowed());
  const [nameDraft, setNameDraft] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameNotice, setNameNotice] = useState<{ text: string; danger: boolean } | null>(null);

  const fetchDisplayName = useCallback((): Promise<void> => {
    const generation = profileGeneration.current;
    if (!privacyConsent.networkAllowed()) return Promise.resolve();
    const config = readSyncConfig();
    const token = config?.token ?? '';
    if (config === undefined || config.serverUrl === '' || token === '') return Promise.resolve();
    setProfileReadState('loading');
    return getAccountProfile({ baseUrl: config.serverUrl }, token).then((outcome) => {
      if (generation !== profileGeneration.current) return;
      // 🔴 失败**不清空**已有读数：一次网络抖动不该让"你的昵称"在界面上凭空消失。
      setProfileReadState(outcome.ok ? 'idle' : 'failed');
      if (!outcome.ok) return;
      setSavedName(outcome.displayName);
      // 同一次读取顺手带回 `avatarHash` —— 头像"有没有"的事实源就是这一行，
      // 不给它单开一次请求（多一次往返、还多一个可能不一致的读数）。
      setAvatarHash(outcome.avatarHash);
    });
  }, []);
  useEffect(() => subscribePrivacyConsent(() => {
    profileGeneration.current += 1;
    setProfileNetworkAllowed(privacyConsent.networkAllowed());
    setNameSaving(false);
    setAvatarBusy(false);
    setProfileReadState('idle');
    void fetchDisplayName();
  }), [fetchDisplayName]);
  useEffect(() => {
    // 账号切换后先清除上一账号的投影，直到新账号读取完成再显示。
    setSavedName(undefined);
    setAvatarHash(undefined);
    setAvatarImage(undefined);
    setAvatarState(undefined);
    setAvatarNotice(null);
    setNameNotice(null);
    setNameEditing(false);
    setNameSaving(false);
    setAvatarBusy(false);
    setNameDraft('');
    setProfileReadState('idle');
    void fetchDisplayName();
  }, [fetchDisplayName, profileRevision]);

  const saveDisplayName = useCallback(async (): Promise<void> => {
    if (nameSaving) return;
    const generation = profileGeneration.current;
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
    if (generation !== profileGeneration.current) return;
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
   * 头像：**基础资料**，明文读写，只需要登录令牌（ADR-0079）。
   *
   * 🔴 读它分两步：`getAccountProfile` 给的是 `avatarHash`（缓存键），
   * 有了 hash 才去 `GET account/avatar` 取明文图片。
   * 所以"这台设备现在显示不出头像"只剩两种原因：
   * 没有头像（想设就设）/ 暂时取不到（稍后重试）。
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
    avatarState === 'unreadable' ? t('common.profile.avatar.unreadable') : null;

  const fetchAvatarImage = useCallback((): Promise<void> => {
    const generation = profileGeneration.current;
    // `null` = 服务端说没有 ⇒ **一个请求都不发**（这是契约前提，不是优化）。
    if (avatarHash === undefined || avatarHash === null) return Promise.resolve();
    if (!privacyConsent.networkAllowed()) return Promise.resolve();
    const config = readSyncConfig();
    const token = config?.token ?? '';
    if (config === undefined || config.serverUrl === '' || token === '') return Promise.resolve();
    return resolveAccountAvatarImage(
      { baseUrl: config.serverUrl },
      token,
      avatarHash,
    ).then((reading) => {
      if (generation !== profileGeneration.current) return;
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

  // 头像明文（ADR-0079）：读它只需要令牌，不需要口令或 vault 钥匙。

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
    const generation = profileGeneration.current;
    const config = readSyncConfig();
    const token = config?.token ?? '';
    if (config === undefined || config.serverUrl === '' || token === '') {
      // 说的是"现在没有登录凭据"，不是"换失败了"——一次请求都没发出去。
      setAvatarNotice({ text: t('common.profile.avatar.failed'), danger: true });
      return;
    }
    setAvatarNotice(null);
    const picked = await pick({ allowMultiSelection: false }).catch((e: unknown) => {
      // 取消是正常路径（静默）；其他码不能说谎。
      if ((e as { code?: string }).code === 'OPERATION_CANCELED') return undefined;
      setAvatarNotice({ text: t('common.profile.avatar.failed'), danger: true });
      return undefined;
    });
    if (generation !== profileGeneration.current || picked === undefined) return;
    const doc = picked[0];
    if (doc === undefined) {
      setAvatarNotice({ text: t('common.profile.avatar.failed'), danger: true });
      return;
    }
    setAvatarBusy(true);
    const prepared = await prepareAvatarFromUri(doc.uri, doc.type ?? doc.nativeType ?? '');
    if (generation !== profileGeneration.current) return;
    if (!prepared.ok) {
      setAvatarBusy(false);
      setAvatarNotice({ text: prepareMessage(prepared.error), danger: true });
      return;
    }
    const outcome = await uploadAccountAvatar(
      { baseUrl: config.serverUrl },
      token,
      prepared.image,
    );
    if (generation !== profileGeneration.current) return;
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
    const generation = profileGeneration.current;
    const config = readSyncConfig();
    const token = config?.token ?? '';
    if (config === undefined || config.serverUrl === '' || token === '') return;
    setAvatarBusy(true);
    const outcome = await deleteAccountAvatar({ baseUrl: config.serverUrl }, token);
    if (generation !== profileGeneration.current) return;
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
  const accountHasCredential = signedInEmail !== undefined || form.token.trim() !== '';

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
   * AI 助手那一格在不在树上。
   *
   * 🔴 判据是**本机的四道闸之一**（总开关 + 至少一个端点），纯本机读取、零请求。
   * 为什么不是"永远显示"：web 那边"配置关着时入口仍然在，点了会说明该去开什么"
   * 成立，是因为它把 AI 面板挂在**任务详情里**、那句话有地方说；
   * 本端这一屏是**五个功能的唯一入口**，开着一条空链路等用户点，
   * 就是本仓反复登记过的那个形状（"设置里能授权、授权了什么都不发生"）。
   * 而"关掉的功能不进树"是本壳模块开关的既有口径。
   */

  /**
   * 同步**只留一行摘要**（§5.2 的「同步一行」）。
   *
   * 🔴 判据是"异常才展开"。`error` / `conflict` 是**需要用户做一件事**的两种状态
   *    （核对地址或口令 / 逐条选一个），其余（`idle` / `syncing` / `synced` /
   *    `offline`）都能用一句话说完 —— 把它们也画成状态卡，就是让 90% 的时间
   *    为 10% 的情况占版面。
   *
   * ⚠️ 时间用 `formatStamp` 的**绝对**戳，不用"N 分钟前"：词条表里没有相对时间
   *    模板（加了就得动 `packages/i18n`，不在本轮文件白名单里）。绝对戳不会说谎。
   */
  const syncDetailVisible = status.kind === 'error' || status.kind === 'conflict';
  const syncSummaryValue =
    status.kind === 'synced' && lastSyncedAt !== undefined
      ? `${describeSyncStatus(status, t)} · ${formatStamp(lastSyncedAt)}`
      : describeSyncStatus(status, t);
  const syncSummaryRow: SettingsRowModel = {
    kind: 'value',
    label: t('mobile.profile.section.sync'),
    value: syncSummaryValue,
    tone: statusTone(status) === 'muted' ? 'subtle' : 'default',
    valueTestID: 'profile-sync-summary',
  };

  /**
   * 通知是**首屏唯一的收件入口**（§5.5：移动端没有 web 那种顶栏铃铛位）。
   *
   * 🔴 它从 `entryRows` 里**搬出来单独定义**，因为 `entryRows` 现在的语义是
   *    "定义在「我的」、但渲染在**别的表面**上的行"（设置面的 data/security 两组、
   *    以及「功能与 AI」二级页）。通知渲染在首屏，混进那张表就又是
   *    "定义在哪一屏 ≠ 用户在哪一屏看见它"。
   */
  const notificationsRow: SettingsRowModel = {
    kind: 'action',
    testID: 'profile-entry-notifications',
    label: t('mobile.inbox.trigger'),
    onPress: () => {
      setNotificationsOpen(true);
    },
    leading: (
      <HStack gap="tight" align="center">
        <Icon name="task.reminder" size="sm" color={tokens['color.foreground-muted']} />
        {inboxBadge > 0 ? (
          <View
            accessibilityLabel={t('mobile.inbox.badge.aria', { count: inboxBadge })}
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
              {inboxBadge}
            </Text>
          </View>
        ) : null}
      </HStack>
    ),
  };

  /**
   * 功能域那几行**由注册表生成**（`nav/feature-entries.ts`）。
   *
   * 🔴 这里不许再出现一份手写的 `{ key: 'habits', label: t('…') }`：
   * 同一件事写两遍，迟早只改一遍（AGENTS §3.5 的那条教训）。
   */
  /*
    🔴 2026-10-26 产品负责人：「tooltip 有点泛滥了……用户能够凭借 UX 和名字直接理解的东西，
    就不要用这种东西来加重认知负担了。」

    所以这几行**不再挂 tooltip**（`hint` 整条删掉，不是换成内联说明 ——
    内联说明是 `check:settings-prose` 明令禁止的，禁令仍然有效）。

    判据是"这行点开之后，名字本身能不能说明它是什么"：
      · 设置 / 消息 / 安全 / 回收站 / 导入导出 / AI 工具箱 / 成长 / 习惯 / 倒计时 / 分享
        ⇒ 名字已经说完，删；
      · **删号**（不可逆）、**反馈**（会打开邮件应用）、**锁屏小组件**（会改变锁屏上看得见什么）、
        **设密码 / 找回通行密钥**（做与不做分别会发生什么）⇒ 说的是**后果**，
        名字说不出来，留（它们是这一页仅剩的 tooltip 的主要用途）。
  */
  const featureRows: readonly SettingsRowModel[] = MOBILE_PROFILE_ENTRIES.map(
    (entry): SettingsRowModel => ({
      kind: 'action',
      testID: entry.testID,
      label: t(entry.labelKey),
      leading: <Icon name={FEATURE_ENTRY_ICONS[entry.key]} size="sm" color={tokens['color.foreground-muted']} />,
      onPress: () => {
        navigation.push(featureRouteKey(entry.key));
      },
    }),
  );

  /**
   * 设置是身份卡后的高频配置入口；其余行才是低频的"关于我 / 我的数据"动作。
   * AI 助手仍按本机配置闸门决定是否进入低频入口列表。
   */
  const settingsRow: SettingsRowModel = {
    kind: 'action',
    testID: 'profile-entry-settings',
    label: t('mobile.profile.entry.settings'),
    leading: <Icon name="action.settings" size="sm" color={tokens['color.foreground-muted']} />,
    onPress: () => {
      setSettingsSection(undefined);
      navigation.push('settings');
    },
  };

  /**
   * 订阅：**一行**，不是一组（§5.2 / §3.7 批评的正是"一个商业入口独占一块"）。
   *
   * ⚠️ 行尾**不带**"本地版 / 托管 · 到期日"那个状态 —— §5.2 想要它，
   *    但拿到它唯一的路是 `fetchHostedEntitlementReading`（`EntitlementSection` 的
   *    探测）。那会变成"同一件事第二个请求方"：每进一次「我的」发一次带 Bearer 的
   *    探测，而设置里那一份还要再探一次。本地没有权益快照，所以这一行今天只承诺
   *    "去哪"，不承诺"现在是什么"——**宁可少说一句，不说一句过期的**。
   */
  const subscriptionRow: SettingsRowModel = {
    kind: 'action',
    testID: 'profile-entry-subscription',
    label: t('mobile.settings.section.subscription'),
    leading: <Icon name="action.more" size="sm" color={tokens['color.foreground-muted']} />,
    onPress: () => {
      setSettingsSection('subscription');
      navigation.push('settings');
    },
  };

  /**
   * 「功能与 AI」枢纽：习惯 / 倒数纪念日 / 共享清单 / AI 助手 / AI 工具箱的落点。
   *
   * 🔴 为什么是**一条入口 + 一个二级页**，而不是五个功能域各占「我的」一行：
   *    那五行是**导航**（去另一张屏），不是"关于我"；把导航和身份、同步、整理
   *    混在一列，正是 §3.2 说的"找不到设置"的主因。§7.4 把"移出后去哪"留成了
   *    待拍板项，三个候选各有代价（任务页溢出菜单 / 枢纽二级页 / 模块开关）。
   *    本轮选**枢纽页**，因为它要动的只有本文件：
   *      · 溢出菜单要改 `apps/web` 与 `check:share-entry-visible`（不在本轮白名单）；
   *      · 模块开关与 `account-information-architecture.md` §4 那句
   *        "不虚构跨端已同步的开关语义"冲突；
   *      · 而"删掉不显示"是硬禁令 —— 五条都必须仍然可达。
   *    代价是**多一次点击**（我的 → 功能与 AI → 习惯），换来首屏少 4 行；
   *    这条代价写在交付报告里，产品可以随时推翻（那时改的是本文件的一处 filter）。
   *
   * ⚠️ 标题复用 `mobile.settings.section.features`（"功能与 AI"）**是刻意的**：
   *    设置目录里 G6 也叫这个名字，而两者确实是同一个用户意图（这台 App 开了哪些能力）。
   *    更好的做法是新增一条 `mobile.profile.entry.features`（"全部功能"），
   *    但那要动 `packages/i18n`（本轮禁改），所以先复用同一句，别造一句新话。
   */
  const featuresHubRow: SettingsRowModel = {
    kind: 'action',
    testID: 'profile-entry-features',
    label: t('mobile.settings.section.features'),
    leading: <Icon name="tab.focus" size="sm" color={tokens['color.foreground-muted']} />,
    onPress: () => {
      navigation.push('profile:features');
    },
  };

  /**
   * 定义在「我的」、**渲染在别的表面上**的那些行（不是首屏那 12 行）。
   *
   * | 行 | 用户在哪一屏看见它 |
   * |---|---|
   * | 账号与安全 / 注销账号 | 设置 → G1 账号（`securityActions`） |
   * | 备份与迁移 / 回收站 | 设置 → G3 数据与同步（`dataActions`） |
   * | 习惯 / 倒数纪念日 / 共享清单 / AI 助手 / AI 工具箱 | **「功能与 AI」二级页**（`hubRows`） |
   *
   * 🔴 定义与渲染分居两处**不是**这次的发明（现状就是），但它有一个代价：
   *    "定义在哪一屏"与"用户在哪一屏看见它"不一致时，信息架构就没有唯一归属
   *    （计划 §2.1 末尾那段就是这条诊断）。首屏那 12 行**不从这里生成**，
   *    它们是本文件里具名的行（`settingsRow` / `subscriptionRow` / …），
   *    所以"首屏多了几行"这件事在源码里数得出来（`profile-settings-ia.spec.ts` 钉着）。
   */
  const entryRows: readonly SettingsRowModel[] = [
    {
      kind: 'action',
      testID: 'profile-entry-security',
      label: t('mobile.security.trigger'),
      leading: <Icon name="privacy.consent" size="sm" color={tokens['color.foreground-muted']} />,
      onPress: () => {
        setSettingsSection('account');
        setSecurityOpen(true);
      },
    },
    ...featureRows,
    {
      kind: 'action',
      testID: 'profile-entry-assistant',
      label: t('mobile.ai.entry'),
      // 🔴 2026-10-26 的 tooltip 禁令扫到这里还剩最后一条：`mobile.ai.entry.hint`
      //    说的是"让一个助手帮你记录、安排、拆解或回顾任务"。而这一行点开之后
      //    第一屏就是助手自己，那句话是在用一句解释去替代一次点击 —— 删。
      //    （tooltip 只留给"名字说不出后果"的那几项：注销、反馈、锁屏小组件。）
      leading: <AssistantMark size={tokens['icon.sm']} color={tokens['color.foreground-muted']} />,
      onPress: () => setAssistantOpen(true),
    },
    {
      kind: 'action',
      testID: 'profile-entry-ai-toolbox',
      label: t('mobile.ai.toolbox.entry'),
      leading: <AssistantMark size={tokens['icon.sm']} color={tokens['color.foreground-muted']} />,
      onPress: () => setToolboxOpen(true),
    },
    {
      kind: 'action',
      testID: 'profile-entry-trash',
      label: t('mobile.trash.entry'),
      leading: <Icon name="task.delete" size="sm" color={tokens['color.foreground-muted']} />,
      onPress: () => {
        setSettingsSection('data');
        setTrashOpen(true);
      },
    },
    {
      kind: 'action',
      testID: 'profile-entry-abandoned',
      label: t('mobile.abandoned.entry'),
      // 🔴 这一行是 ADR-0083 §4.3 的出口：放弃之后必须看得见回来的路。
      // 字形用 `task.unabandon`（ArchiveRestore）而不是 `task.abandon`：
      // 这一屏要做的是"把它取回来"，图标说反了会比少一个图标更贵。
      leading: <Icon name="task.unabandon" size="sm" color={tokens['color.foreground-muted']} />,
      onPress: () => {
        setSettingsSection('data');
        setAbandonedOpen(true);
      },
    },
    {
      kind: 'action',
      testID: 'profile-entry-export',
      label: t('mobile.export.entry'),
      leading: <Icon name="action.share" size="sm" color={tokens['color.foreground-muted']} />,
      onPress: () => {
        setSettingsSection('data');
        setExportOpen(true);
      },
    },
    {
      kind: 'action',
      // 🔴 就排在「导出数据」的**下面一格**，不是随手追加在末尾：注销那道屏要求的
      // 第一步恰恰是"先导出留一份"。两格相邻，那句话才有一个抬眼就够得着的出口。
      testID: 'profile-entry-close-account',
      label: t('common.accountClosure.title'),
      hint: t('common.accountClosure.entryHint'),
      leading: <Icon name="privacy.consent" size="sm" color={tokens['color.foreground-muted']} />,
      onPress: () => {
        setSettingsSection('account');
        setClosureOpen(true);
      },
    },
  ];

  const HUB_ROW_TEST_IDS = [
    'profile-entry-habits',
    'profile-entry-countdown',
    'profile-entry-share',
    'profile-entry-assistant',
    'profile-entry-ai-toolbox',
  ] as const;
  const hubRows: readonly SettingsRowModel[] = entryRows.filter((row) =>
    (HUB_ROW_TEST_IDS as readonly string[]).includes(row.testID ?? ''),
  );

  /**
   * 🔴 提前 return **必须在所有 hook 之后**。
   * 功能域二级屏各自带顶栏返回，但返回动作必须 pop 当前 tab 的栈，才能与
   * Android 硬件返回保持同一条路径。
   */
  const managementPage = navigation.tab === 'profile' ? navigation.stack.at(-1)?.key : undefined;
  if (managementPage === 'profile:lists' || managementPage === 'profile:tags' || managementPage === 'profile:notes') {
    const titleKey = managementPage === 'profile:lists' ? 'mobile.profile.section.lists' : managementPage === 'profile:tags' ? 'mobile.profile.section.tags' : 'notes.title';
    return (
      <Screen title={t(titleKey)} actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: () => { navigation.pop(); } }]}>
        {managementPage === 'profile:lists' ? <ListsSection /> : managementPage === 'profile:tags' ? <TagsSection /> : <NotesSection />}
      </Screen>
    );
  }

  if (featuresOpen) {
    /*
      「功能与 AI」：习惯 / 倒数纪念日 / 共享清单 / AI 助手 / AI 工具箱。

      🔴 这 5 行**曾经各占「我的」一行**（16 行里占 5 行）。它们不是"关于我"的东西，
      是**去另一张屏的导航**；和身份卡、同步状态、整理入口混在一列，就是"找不到设置"
      的主因（计划 §3.2）。搬到这一页之后首屏少 4 行（成长那一行并进了「近期状态」卡），
      代价是多一次点击 —— 这条代价是**产品可以推翻的**（§7.4 仍是待拍板项）。

      ⚠️ 返回动作走 `navigation.pop()`，与上面那批二级页同一个形状：
      本壳没有导航库，返回只靠这条线（`feature-entries.spec.ts` 钉着"屏里必须有 onBack"）。
    */
    return (
      <Screen
        title={t('mobile.settings.section.features')}
        actions={[{ icon: 'action.back', label: t('mobile.growth.back'), onPress: () => { navigation.pop(); } }]}
      >
        <Card>
          {hubRows.map((row) => (
            <SettingsRow key={row.testID ?? row.kind} row={row} />
          ))}
        </Card>
      </Screen>
    );
  }

  if (securityOpen) {
    return (
      <SecurityScreen
        baseUrl={form.serverUrl}
        token={form.token}
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
        // 🔴 退出登录的两条出口都在**本屏**编排（清本机那一大套顺序在
        // `onClearCredentials` 里，只有这里够得到）。判据：失败也清一次、
        // 成功也清一次，见 `tests/sign-out-flow.spec.ts`。
        onSignOutCurrentDevice={() => {
          void runSignOut();
        }}
        onSignedOutEverywhere={runSignOutEverywhere}
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

  if (assistantOpen) {
    return (
      <AssistantScreen
        onOpenPrivacy={() => {
          setSettingsSection('data');
          navigation.push('settings');
        }}
        onOpenSettings={() => {
          setSettingsSection('features');
          navigation.push('settings');
        }}
        visible={isProfileAssistantVisible(navigation.tab, navigation.stacks)}
        onBack={() => {
          setAssistantOpen(false);
        }}
      />
    );
  }

  if (toolboxOpen) {
    return (
      <AiToolboxScreen
        onOpenSettings={() => {
          setSettingsSection('features');
          navigation.push('settings');
        }}
        onBack={() => {
          setToolboxOpen(false);
        }}
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

  if (abandonedOpen) {
    return (
      <AbandonedScreen
        onBack={() => {
          setAbandonedOpen(false);
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

  if (closureOpen) {
    return (
      <AccountClosureScreen
        onBack={() => {
          setClosureOpen(false);
        }}
        onClosed={onClearCredentials}
      />
    );
  }

  if (authOpen) {
    return (
      <AuthScreen
        initialServerUrl={form.serverUrl}
        initialPassword={form.password}
        allowServerSelection={authAllowServerSelection}
        onBack={() => {
          setAuthOpen(false);
        }}
        onSignedIn={onSignedIn}
      />
    );
  }

  if (openFeature !== null) {
    /**
     * 🔴 功能域那几屏**整屏替换**（第二层），返回由那一屏自己的顶栏给。
     * 组件由穷尽 switch 决定：注册表加一项而不在这儿接上 = `apps/mobile` 编译红
     * （这条就是"入口存在但点了没反应"那类失效的编译期版本）。
    */
    return featureScreen(
      openFeature,
      () => {
        navigation.pop();
      },
      () => {
        navigation.push(featureRouteKey('habits'));
      },
    );
  }

  /**
   * 头像那一行**一次只说一句**：刚上传/刚移除的结果 > 这台设备读不到头像。
   *
   * 头像明文（ADR-0079）之后不再有"本机没有口令"这一档。
   */
  const avatarLine = avatarNotice?.text ?? avatarReadMessage;
  const avatarLineDanger =
    avatarNotice !== null ? avatarNotice.danger : avatarReadMessage !== null;

  const syncStatus = (<>
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
        style={{ alignSelf: 'flex-start' }}
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

  </>);

  const profileEditor = accountHasCredential ? (
    <Stack>
      {!profileNetworkAllowed ? (
        <Text variant="caption" tone="subtle">{t('mobile.profile.localOnly')}</Text>
      ) : savedName === undefined ? (
        <>
          <Text variant="caption" tone="subtle">{t(profileReadState === 'failed' ? 'common.profile.loadFailed' : 'mobile.profile.loading')}</Text>
          {profileReadState === 'loading' ? null : <Button label={t('mobile.profile.retry')} tone="secondary" onPress={() => { void fetchDisplayName(); }} />}
        </>
      ) : null}
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
          {savedName === undefined ? null : !profileNetworkAllowed ? null : (
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
          {savedName === undefined ? null : !profileNetworkAllowed ? null : nameEditing ? (
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
      <SettingsRow row={{ kind: 'value', label: t('common.profile.email.label'), value: signedInEmail ?? t('mobile.profile.account.offline') }} />
      <Text variant="caption" tone="subtle">{t('common.profile.email.hint')}</Text>
      {/*
        🔴 「更换登录邮箱」紧接在只读的邮箱行**下面** —— `common.profile.email.hint`
        那句"请用下面的「更换登录邮箱」"指的就是这里。那句指引指不到东西时，
        比留着空白更糟（用户会去别处找那个"不能改"的理由）。
        表单**不许**进「我的」的滚动流（`check:mobile-settings` R3 +
        `profile-settings-ia.spec.ts`），所以它是一个自带卡片的外挂组件，
        由这里的 `profileEditor` 摆进设置面的 `profile` 分组。
      */}
      <EmailChangeSection baseUrl={form.serverUrl} token={form.token} currentEmail={signedInEmail} />
    </Stack>
  ) : undefined;

  return (
    <Screen title={t('mobile.profile.title')}>
      {/*
        ══════════════════════════════════════════════════════════════════════
        「我的」首屏 = **6 块 / 12 行**（2026-10-27 重排，计划 §5.2 的 16 → 10）
        ══════════════════════════════════════════════════════════════════════

        | # | 块 | 行 |
        |---|---|---|
        | ① | 账号卡 | 1（整卡可点 → 设置·账号组）|
        | ② | 配置入口 | 2：订阅 / 设置 |
        | ③ | 近期状态 | 4：本周任务 / 专注 / 成就 / 查看完整成长 |
        | ④ | 同步 | 1（异常才展开成状态卡）|
        | ⑤ | 通知与功能 | 2：通知 / 功能与 AI（枢纽）|
        | ⑥ | 整理与记录 | 3：清单 / 标签 / 便签 |

        行数口径与 §5.6 的 B4 判据同一条：**可见 `SettingsRow` 的条数**
        （账号卡是 `Card`，不计数）。重排前是 **16**：设置 1 + 近期状态 4 +
        入口列 7 + 订阅 1 + 整理 3。重排后 **12** = 少掉的 7 行里，5 个功能域进了
        ⑤ 的枢纽页、成长并进 ③、通知从"入口列"挪进 ⑤；同时 ④ 从状态卡压成一行。

        ⚠️ §5.2 的字面目标是 **10**。差的 2 行正是**计划自己没定去处**的两行：
        通知（§5.5 要求移动端必须在「我的」有一行，因为没有 web 那种顶栏铃铛位）
        与枢纽入口（不删功能域 ⇒ 必须留一条路）。要落到 10，需要产品在这两条上拍板；
        两条都不在我能改的文件里，所以这里如实留 12 并登记（见交付报告）。
      */}
      {/*
        ── ① 账号卡 ────────────────────────────────────────────────────────
        🔴 **整张卡就是账号组的入口**（§5.2 的"账号卡 + 右箭头 → account"）。
        在这一刀之前，卡片本身是只读的，旁边还有一个「编辑」幽灵按钮 ——
        同一个目的地两枚控件（§3.1 的重复入口），而且那个按钮说的是"编辑"、
        点下去却是"账号组"，名字和后果不一致。现在只剩卡片这一处。

        ⚠️ 少了 §5.2 说的**右箭头**：`SettingsRow` 的 `action` 行没有 trailing 槽，
        而移动端的图标注册表里也没有一枚 `action.disclose`（语义名）——
        借 `action.next-month`（ChevronRight）会把"翻月"和"进下一层"混成一个字形，
        那正是 `ui/icons.tsx` 里那条注释禁止的事。两处都不在本轮可改范围，
        所以这一版用"整卡可点 + 无障碍 role=button"表达可进，箭头登记为欠账。
      */}
      <Pressable
        testID="profile-account-value"
        accessibilityRole="button"
        accessibilityLabel={t('mobile.profile.edit')}
        onPress={() => {
          setSettingsSection('account');
          navigation.push('settings');
        }}
      >
        <Card>
          <HStack gap="default" align="center">
            {signedInEmail === undefined ? null : <AvatarBadge dataUri={avatarImage} email={signedInEmail} />}
            <Text variant="row-title" grow>
              {savedName ?? signedInEmail ?? t('mobile.profile.account.offline')}
            </Text>
          </HStack>
          {savedName && signedInEmail ? <Text variant="caption" tone="subtle">{signedInEmail}</Text> : null}
        </Card>
      </Pressable>
      {/*
        注册 / 登录（W3 · 规范 §3.1 的「前置」）。
        🔴 保留为一枚**按钮**而不是一行入口：未登录时设置里那一组整块不渲染
        （`account` 组要 `profileEditor` 才出现），所以这里是冷启动唯一的一击入口。
      */}
      <Button
        label={
          accountHasCredential
            ? t('mobile.profile.account.switchAccount')
            : t('mobile.profile.account.signIn')
        }
        onPress={openAuth}
        tone={accountHasCredential ? 'secondary' : 'primary'}
      />
      {/*
        🔴 这两条实话**必须**由常驻的本屏来说，而不是由「账号与安全」那屏：
        退出之后那屏就关掉了，而"服务器上那一枚还没撤成"恰恰是在那之后
        才需要被看见的一句话。放在子屏里就是随它一起卸载。
        （顺序：待撤销排在"已退出所有设备"之前 —— 后者是一次成功的说明，
        前者是一次**没做完**的说明，冲突时先说没做完的那件。）
      */}
      {pendingRevocation === null ? null : (
        <Card gap="loose">
          <Stack gap="tight" testID="sign-out-pending">
            <Text variant="row-meta" tone="danger" selectable>
              {t('common.signOut.pending')}
            </Text>
            <Button
              label={t('common.signOut.retry')}
              onPress={() => {
                void retryRevocation();
              }}
              tone="secondary"
              testID="sign-out-retry"
            />
          </Stack>
        </Card>
      )}
      {!signedOutEverywhere ? null : (
        <Card>
          <Stack testID="sign-out-all-done">
            <Text variant="row-meta" tone="default">
              {t('common.sessions.logoutAllDone')}
            </Text>
          </Stack>
        </Card>
      )}

      {/*
        ── ② 配置入口：订阅 / 设置 ────────────────────────────────────────
        🔴 设置**紧跟在账号卡之后**（`profile-settings-ia.spec.ts` 钉着这个位置）：
        它是这一屏唯一的高频配置入口。订阅与它同一张卡 —— 订阅原来独占一个
        `SectionHeader` + `Card`（§3.7 批评的正是"一个商业入口独占一块"）。
      */}
      <Card>
        <SettingsRow row={subscriptionRow} />
        <SettingsRow row={settingsRow} />
      </Card>

      {/*
        ── ③ 近期状态（由 `ProfileProgressSummary` 画）────────────────────
        🔴 4 行：本周任务 / 专注 / 成就 + 「查看完整成长」。成长**只在这里**——
        原来「我的」上有两处到同一张屏（`profile-progress-growth` 与
        `profile-entry-growth`），§5.3 明写"收进近期状态卡内，删掉重复那一行"。
      */}
      <ProfileProgressSummary
        onOpenGrowth={() => {
          navigation.push(featureRouteKey('growth'));
        }}
      />

      {/*
        ── ④ 同步：**一行**（§5.2）────────────────────────────────────────
        判据见 `syncDetailVisible`：`error` / `conflict` 才展开成今天的状态卡
        （失败要说清是哪一种、冲突要给出口），其余状态一句话说完。
        `StatusRow` 这时只画**细节**（`detailOnly`），标题已经在上面那一行里 ——
        同一张卡里说两遍同一句话是本仓 §7 明令禁止的形状。
      */}
      <Card>
        <SettingsRow row={syncSummaryRow} />
        {syncDetailVisible ? (
          <>
            <Divider />
            <StatusRow
              status={status}
              busy={busy}
              detailOnly
              onOpenConflicts={() => {
                setConflictsOpen(true);
              }}
            />
          </>
        ) : null}
      </Card>
      {/*
        「立即同步」只在**有事可做**时出现（未同步 / 离线 / 出错 / 正在进行）。
        🔴 一切正常时这一块就只剩那一行 "已是最新 · 时间" —— §4「同屏一个主任务」：
        一个永远在那儿的实底按钮，会让人以为"同步"就是这一屏要他做的那件事。
        ⚠️ 这一枚是**新加的**（重排前「我的」上没有任何触发同步的控件，只能进设置面点）。
        加它的理由：异常态现在只展开细节、不再常驻一整张卡，失败时需要有就地重试的路。
      */}
      {form.configured && status.kind !== 'synced' ? (
        <Button
          label={busy ? t('mobile.profile.sync.busy') : t('mobile.profile.sync.now')}
          onPress={form.submit}
          tone="primary"
          icon="action.sync"
          loading={busy}
          style={{ alignSelf: 'flex-start' }}
        />
      ) : null}
      {form.configured && slowKdf && status.kind !== 'synced' ? (
        <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {t('mobile.profile.sync.slowKdf')}
        </Text>
      ) : null}

      {/*
        ── ⑤ 通知与功能 ──────────────────────────────────────────────────
        通知：§5.5 要求它在「我的」有一行（移动端没有 web 那种顶栏铃铛位），
        而且徽标是共享动态"打扰到了"的唯一回执 —— 所以它留在首屏，只是从
        "入口列"挪进了这一块，视觉上不再与功能域并列。
        功能与 AI：5 个功能域的枢纽（理由见 `featuresHubRow` 上方）。
      */}
      <Card>
        <SettingsRow row={notificationsRow} />
        <SettingsRow row={featuresHubRow} />
      </Card>

      {/* 清单 / 标签 / 便签管理（⑥）。顺序是**清单在标签前**（与任务详情页一致），
          便签排最后（它读的是 NOTE，与任务的组织维度无关）。 */}
      <SectionHeader icon="task.project" title={t('mobile.profile.tools')} />
      <Card>
        <SettingsRow row={{ kind: 'action', label: t('mobile.profile.section.lists'), testID: 'profile-entry-lists', leading: <Icon name="task.project" size="sm" color={tokens['color.foreground-muted']} />, onPress: () => { navigation.push('profile:lists'); } }} />
        <SettingsRow row={{ kind: 'action', label: t('mobile.profile.section.tags'), testID: 'profile-entry-tags', leading: <Icon name="task.tag" size="sm" color={tokens['color.foreground-muted']} />, onPress: () => { navigation.push('profile:tags'); } }} />
        <SettingsRow row={{ kind: 'action', label: t('notes.title'), testID: 'profile-entry-notes', leading: <Icon name="note.sticky" size="sm" color={tokens['color.foreground-muted']} />, onPress: () => { navigation.push('profile:notes'); } }} />
      </Card>

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
        initialSection={settingsSection}
        profileEditor={profileEditor}
        syncStatus={syncStatus}
        onOpenAuth={openAuth}
        onUseOfficialSync={onClearCredentials}
        dataActions={entryRows.filter((row) => ['profile-entry-export', 'profile-entry-trash', 'profile-entry-abandoned'].includes(row.testID ?? ''))}
        securityActions={entryRows.filter((row) => ['profile-entry-security', 'profile-entry-close-account'].includes(row.testID ?? ''))}
        // Shell 保留各 tab 的屏幕实例；设置是 profile 的二级 surface，
        // 离开 profile 时必须隐藏 Modal，回到 profile 再恢复原栈位置。
        visible={navigation.tab === 'profile' && settingsOpen}
        onClose={() => {
          // Clear the source section when the sheet is dismissed. Otherwise a
          // profile shortcut can leave a stale child section in the mounted
          // SettingsScreen while the user changes tabs and returns later.
          setSettingsSection(undefined);
          navigation.pop();
        }}
        form={form}
        onClearCredentials={onClearCredentials}
        vaultCleanupPending={vaultCleanupPending !== undefined}
        onRetryVaultCleanup={retryVaultCleanup}
        onVaultCleanupPending={setVaultCleanupPending}
        widgetCleanupPending={widgetCleanupPending}
        widgetCleanupRetrying={widgetCleanupRetrying}
        onRetryWidgetCleanup={retryWidgetCleanup}
      />
    </Screen>
  );
}

const FEATURE_ROUTE_PREFIX = 'feature:';

function featureRouteKey(key: MobileProfileEntryKey): string {
  return `${FEATURE_ROUTE_PREFIX}${key}`;
}

function featureKeyFromRoute(routeKey: string | undefined): MobileProfileEntryKey | null {
  if (routeKey === undefined || !routeKey.startsWith(FEATURE_ROUTE_PREFIX)) return null;
  const candidate = routeKey.slice(FEATURE_ROUTE_PREFIX.length);
  for (const entry of MOBILE_PROFILE_ENTRIES) {
    if (entry.key === candidate) return entry.key;
  }
  return null;
}

/**
 * 注册表里的功能域 → 本端那张屏。
 *
 * 🔴 **穷尽 switch，没有 `default`**：`MobileFeatureEntryKey` 是从
 * `MOBILE_FEATURE_ENTRIES` 推出来的联合类型，所以往注册表里加一项、
 * 而忘了在这儿接上屏，这个函数就"所有分支之外还可能走到结尾"——
 * 返回类型 `React.JSX.Element` 立刻不成立 ⇒ **编译错误**。
 *
 * 为什么要花一个函数换掉两段 `if (xxxOpen)`：入口失效最常见的形状是
 * "行在、点了没反应"，而它**不报错、界面也不难看**（AGENTS §7 那类）。
 * 让它在编译期就站不住，比给它写一条运行时判据更便宜。
 */
const FEATURE_ENTRY_ICONS: Record<MobileProfileEntryKey, IconName> = {
  growth: 'growth.week',
  habits: 'focus.streak',
  countdown: 'task.due',
  share: 'action.share',
};

function featureScreen(key: MobileProfileEntryKey, onBack: () => void, onOpenHabits: () => void): React.JSX.Element {
  switch (key) {
    case 'growth':
      return <GrowthScreen onBack={onBack} onOpenHabits={onOpenHabits} />;
    case 'habits':
      return <HabitsScreen onBack={onBack} />;
    // 🔴 注册表里加了 `countdown` 而这一行没接上 ⇒ 本函数"所有分支之外还可能走到结尾"，
    //    返回类型立刻不成立 = **编译错误**。这就是"入口在、点了没反应"那类失效的
    //    编译期版本（`nav/feature-entries.ts` 文件头第 2 条说的就是这件事）。
    case 'countdown':
      return <CountdownScreen onBack={onBack} />;
    // M6：共享那一行同理 —— 注册了 `share` 而不接屏，编译期就站不住。
    case 'share':
      return <ShareSpaceScreen onBack={onBack} />;
  }
}

/**
 * 同步状态那一行。**它必须说清是哪一种失败**，不能只写"同步失败"。
 *
 * `detailOnly` 是 2026-10-27 重排加的：首屏的同步块现在**先有一行摘要**
 * （`syncSummaryRow`，值就是 `describeSyncStatus` 那句），异常时才在下面展开
 * 细节。同一个失败句如果在同一张卡里念两遍，用户会以为那是两件事
 * （本仓 §7「同一行只说一句话」）。所以展开态只要**细节**：
 * 失败原因原文 / 冲突说明 + 「逐条处理」那颗按钮。
 *
 * ⚠️ 设置面（`syncStatus`）**不用**这个开关：那儿没有摘要行，标题必须自己说。
 */
function StatusRow({
  status,
  busy,
  onOpenConflicts,
  detailOnly = false,
}: {
  status: SyncStatus;
  busy: boolean;
  onOpenConflicts: () => void;
  /** 标题已在别处说过（首屏摘要行）—— 只画细节。 */
  detailOnly?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  return (
    <View style={{ gap: tokens['space.1'] }}>
      {detailOnly ? null : (
        <Text variant="row-title" tone={busy ? 'muted' : statusTone(status)}>
          {describeSyncStatus(status, t)}
        </Text>
      )}
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
