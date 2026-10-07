/**
 * 设置面（**独立的第二层表面**）
 * ================================
 *
 * 🔴 **为什么是 Modal，而不是成长 / 回收站那种"整屏替换"（early return）：**
 *
 * 对标滴答 §11.5 的规律（`docs/research/dida-capture/INTERFACE-NOTES.md`）：
 * 次级表面独立成面，但**下层的上下文不断掉**。整屏替换会让「我的」整棵
 * 子树卸载 —— 打开设置的那段时间里，"账号卡片还在吗"这个 goal 判据（M2）
 * 就答不上来。RN `Modal` 是本仓已有的浮层先例（`ConflictSheet` /
 * `TaskDetailSheet`）：「我的」照常挂着，设置盖在上面，关掉回去什么都不重置。
 *
 * 🔴 **表单状态不在这里。** `Modal` 在 `visible={false}` 时 children **整体卸载**
 * —— 凭据表单的状态若放在这里，关一次设置面就丢一次打到一半的输入
 * （只改了服务器地址、还没填令牌时，写盘守卫不会落盘，重开就是空的）。
 * 状态在常驻的 `ProfileScreen`（`useSyncCredentialForm`，理由见它的文件头）；
 * 本组件只负责**把值画出来、把点击接回去**。
 *
 * 🔴 小组件旅程与语言胶囊的**界面状态**放在这里反而是对的：
 *   · 锁屏隐私开关在挂载时从原生重读 —— 每次打开设置都拿到**最新值**；
 *   · 语言读的是 `LocalePreferenceProvider`（常驻在 App 根上，不受本组件卸载影响）。
 *
 * ⚠️ 顶部内边距用 `useSafeAreaInsets()` 而不是 kit 的 `Screen`：
 * `Screen`/`AppBar` 是给**页面**的（它带 `screen.bottom-inset` 预留标签栏，
 * 而 Modal 里没有标签栏）；头部骨架照 `TaskDetailSheet` 的手写先例。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LOCALES, useI18n } from '@heyta/i18n';
import {
  SettingsSection,
  resolveSettingAvailability,
  type SettingsRowModel,
} from '@heyta/ui';
import { formatPrivacyDecisionTime, type PrivacyConsentRecord } from '@heyta/app-host';

import {
  Button,
  Card,
  Chip,
  IconButton,
  SectionHeader,
  Stack,
  Text,
  TextField,
} from '../ui/kit';
import { Icon } from '../ui/icons';
import { useLocalePreference } from '../i18n/locale-preference';
import { useTokens } from '../theme';
import { useMobileNavigation } from '../nav/navigation';
import type { SyncCredentialForm } from '../sync/credential-form';
import { DEFAULT_SERVER_URL } from '../sync/config';
import { VaultSettingsSection } from './VaultSettingsSection';
import { AiSettingsSection } from '../ai/AiSettingsSection';
import {
  privacyConsent,
  privacyConsentActions,
  subscribePrivacyConsent,
} from '../privacy/consent-gate';
import { openPrivacySheet } from '../privacy/consent-ui';
import {
  isWidgetBridgeAvailable,
  readWidgetPrivacy,
  setWidgetPrivacy,
} from '../widgets/widget-bridge';
import {
  WIDGET_CARD_KEYS,
  resolveWidgetPlatform,
  shouldShowWidgetJourney,
  widgetAddSteps,
} from '../widgets/widget-journey';

/**
 * 这台设备该显示哪套"如何添加"步骤。
 *
 * ⚠️ **在模块级算一次**，不在渲染里算：`Platform.OS` 在一次进程生命周期内不会变。
 */
const WIDGET_ADD_STEPS = widgetAddSteps(resolveWidgetPlatform(Platform.OS));

/** 一级目录的稳定语义 key。父屏可以用它把“从哪一组进入”传回设置面。 */
export type SettingsSectionKey = 'profile' | 'general' | 'sync' | 'ai' | 'data' | 'security';

export function SettingsScreen({
  visible,
  onClose: closeParent,
  form,
  onClearCredentials,
  vaultCleanupPending,
  onRetryVaultCleanup,
  onVaultCleanupPending,
  profileEditor,
  dataActions,
  securityActions,
  syncStatus,
  onOpenAuth,
  onUseOfficialSync,
  initialSection,
}: {
  /** 「我的」持有这个状态；关闭只是把它拨回 `false`，不卸载「我的」。 */
  visible: boolean;
  onClose: () => void;
  /** 状态活在「我的」（见文件头），这里只消费。 */
  form: SyncCredentialForm;
  /** 清凭据（磁盘 + 小组件 + 账号 + 表单状态）由「我的」按序组合，这里只触发。 */
  onClearCredentials: () => void;
  /** A failed native secure-store delete stays visible until it succeeds. */
  vaultCleanupPending?: boolean;
  onRetryVaultCleanup?: () => void;
  onVaultCleanupPending?: (scope: import('../lib/vault-secure-storage').VaultSecureStorageScope) => void;
  /** 资料编辑器由 ProfileScreen 持有；设置面只提供唯一入口，不复制表单。 */
  profileEditor?: React.ReactNode;
  /** 数据管理入口由父屏提供，避免在设置面复制整屏路由状态。 */
  dataActions?: readonly SettingsRowModel[];
  /** 账号安全入口由父屏提供，避免在设置面复制整屏路由状态。 */
  securityActions?: readonly SettingsRowModel[];
  /** 同步状态与重试动作由父屏提供，表单仍由父屏持有。 */
  syncStatus?: React.ReactNode;
  /** 从同步设置进入登录；参数为 true 时明确打开自托管认证路径。 */
  onOpenAuth?: (allowServerSelection?: boolean) => void;
  /** 切回官方同步时清理自托管凭据，避免把令牌带到另一个服务端。 */
  onUseOfficialSync?: () => void;
  /** 从个人资料直达“个人资料”二级分组，普通打开时留在目录。 */
  initialSection?: SettingsSectionKey;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const { locale, setLocale } = useLocalePreference();
  const navigation = useMobileNavigation();

  /**
   * W5-2 · 锁屏组件的"隐藏任务标题"开关。
   *
   * 🔴 `null` 有三重含义，**必须区分**：
   *   - `null` = **这个平台没有这一项**（安卓/鸿蒙）或还没读到 → **整段不渲染**；
   *   - `false` = 用户关着；
   *   - `true` = 用户开着。
   * 把 `null` 当成 `false` 会让安卓上出现一个**按了没反应的开关**。
   */
  const [hideTitles, setHideTitles] = useState<boolean | null>(null);
  const [widgetBridgeAvailable] = useState(() => isWidgetBridgeAvailable());
  const [privacyFailed, setPrivacyFailed] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [section, setSection] = useState<SettingsSectionKey | undefined>(initialSection);
  const [advancedSync, setAdvancedSync] = useState(
    () => form.token.trim() !== '' && form.serverUrl.trim() !== '' && form.serverUrl !== DEFAULT_SERVER_URL,
  );
  const sectionRef = useRef<SettingsSectionKey | undefined>(initialSection);
  const openSection = useCallback((next: SettingsSectionKey | undefined): void => {
    sectionRef.current = next;
    setSection(next);
  }, []);

  useEffect(() => {
    if (!visible) return;
    sectionRef.current = initialSection;
    setSection(initialSection);
  }, [initialSection, visible]);

  /*
    ── 隐私同意（PIPL 第 15 条那个"便捷的撤回方式"）───────────────
    🔴 **这里不存第二份"同意了吗"**：状态只有闸门那一份（`privacy/consent-gate.ts`）。
    本组件**订阅**它，不是挂载时读一次 —— 读一次的症状是"点了撤回、按钮还在那儿、
    字没改口"，而闸门其实已经关了。界面与事实不一致，正是这一类缺陷最难查的形状。

    ⚠️ `revokeNotPersisted` 是**界面态**（这一次点击有没有落盘），不是同意状态，
    所以它可以住在这里；落盘失败必须当场说出口，否则用户以为撤回是永久的。
  */
  const [consentRecord, setConsentRecord] = useState<PrivacyConsentRecord | null>(() =>
    privacyConsent.current(),
  );
  const [revokeNotPersisted, setRevokeNotPersisted] = useState(false);

  useEffect(() => subscribePrivacyConsent(() => setConsentRecord(privacyConsent.current())), []);

  useEffect(() => {
    let alive = true;
    void readWidgetPrivacy().then((value) => {
      if (alive) setHideTitles(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggleHideTitles = useCallback((): void => {
    if (hideTitles === null || privacyBusy) return;
    const next = !hideTitles;
    // 乐观：先动开关（让点击有即时反馈），失败了再改回来 + 提示。
    setHideTitles(next);
    setPrivacyFailed(false);
    setPrivacyBusy(true);
    void setWidgetPrivacy(next)
      .then((ok) => {
        if (!ok) {
          // 🔴 回滚。写不成的后果是"用户以为设了、其实没设"。
          setHideTitles(!next);
          setPrivacyFailed(true);
        }
      })
      .finally(() => {
        setPrivacyBusy(false);
      });
  }, [hideTitles, privacyBusy]);

  /**
   * 撤回同意。**只用 `secondary`，不用 `danger`。**
   *
   * 🔴 把撤回画成危险动作（红底），等于在视觉上劝用户别撤 —— PIPL 第 15 条要的
   * 是"便捷的撤回方式"，一个红色按钮正好相反。这不是审美选择。
   *
   * ⚠️ `persisted` 为 `false` 时**必须说出口**（与同意面板那条同一纪律）：本次会话
   * 里闸门确实关了，但下次冷启动磁盘上还是旧决定 —— 不说这一句，用户以为撤回是永久的。
   */
  const revokeConsent = useCallback((): void => {
    const { persisted } = privacyConsentActions.revoke();
    setRevokeNotPersisted(!persisted);
  }, []);

  /**
   * 「重新作出选择」：**先收设置面，再开同意面板**，不叠两层。
   *
   * 🔴 RN 的 `Modal` 每个开一个**原生窗口**，两个同时挂着时谁能收到触摸由平台决定；
   * 上面那个关掉后下面那个还在，用户会以为设置面"自己又弹回来了"。
   * web 那边是同屏叠一层 DOM，所以这一处是**真的平台差异**，不是偷懒。
   *
   * ⚠️ 开的是**同一张**面板（`privacy/consent-ui` 那一份），不是第二套"同意界面"
   * （§3.5）—— 两张面板就是两个裁决者，而它们对"同意长什么样"的理解会漂移。
   */
  const chooseAgain = useCallback((): void => {
    closeParent();
    openPrivacySheet('revoked');
  }, [closeParent]);

  /**
   * 当前状态那一行的措辞。**三分支而不是一个布尔**：
   * "明确选了只用本机"与"还没问过"在界面上必须读出不同的话 ——
   * 前者不该再弹面板（他已经答过了），后者必须弹（G-11）。
   */
  const consentStateKey =
    consentRecord === null
      ? 'common.privacy.settings.undecided'
      : consentRecord.decision === 'accepted'
        ? 'common.privacy.settings.accepted'
        : 'common.privacy.settings.localOnly';

  const widgetRows: readonly SettingsRowModel[] = [
    { kind: 'note', text: t('mobile.widgetJourney.intro') },
    { kind: 'note', text: WIDGET_CARD_KEYS.map((key) => t(key)).join(' · ') },
    { kind: 'heading', text: t('mobile.widgetJourney.howTo'), divider: true },
    ...WIDGET_ADD_STEPS.map((key, index) => ({
      kind: 'note' as const,
      // ⚠️ `testID` 用词条 key 而不是下标：插入步骤时不会让 React 复用错的行。
      testID: `widget-step-${key}`,
      index: index + 1,
      text: t(key),
    })),
    { kind: 'note', text: t('mobile.widgetJourney.cannotAutoAdd'), divider: true },
    { kind: 'note', text: t('mobile.widgetJourney.openOnce') },
    {
      kind: 'toggle',
      testID: 'widget-privacy-toggle',
      label: t('mobile.widgetJourney.privacyTitle'),
      hint: t('mobile.widgetJourney.privacyHint'),
      checked: hideTitles === true,
      onToggle: toggleHideTitles,
      disabled: privacyBusy,
      availability: resolveSettingAvailability(hideTitles),
    },
    ...(privacyFailed
      ? ([
          {
            kind: 'note',
            text: t('mobile.widgetJourney.privacyFailed'),
            tone: 'danger',
            role: 'alert',
          },
        ] as const)
      : []),
  ];

  const sectionLabels: Record<SettingsSectionKey, string> = {
    profile: t('mobile.settings.section.profile'),
    general: t('mobile.settings.section.general'),
    sync: t('mobile.settings.section.sync'),
    ai: t('mobile.settings.section.ai'),
    data: t('mobile.settings.section.data'),
    security: t('mobile.settings.section.security'),
  };

  const sectionIcons: Record<SettingsSectionKey, React.ComponentProps<typeof Icon>['name']> = {
    profile: 'tab.profile',
    general: 'action.settings',
    sync: 'action.sync',
    ai: 'action.more',
    data: 'action.share',
    security: 'privacy.consent',
  };

  const sectionRows: readonly SettingsRowModel[] = (
    Object.keys(sectionLabels) as SettingsSectionKey[]
  )
    .filter(
      (key) =>
        key !== 'profile' ||
        (profileEditor !== undefined && profileEditor !== null && profileEditor !== false),
    )
    .map((key): SettingsRowModel => ({
      kind: 'action',
      testID: `settings-section-${key}`,
      label: sectionLabels[key],
      leading: <Icon name={sectionIcons[key]} size="sm" color={tokens['color.foreground-muted']} />,
      onPress: () => openSection(key),
    }));

  const handleRequestClose = useCallback((): boolean => {
    const current = sectionRef.current;
    if (current !== undefined) {
      sectionRef.current = undefined;
      setSection(undefined);
    } else {
      closeParent();
    }
    return true;
  }, [closeParent]);
  // Keep the existing SettingsScreen close contract as the Modal callback. The
  // wrapper adds the directory -> section back step without changing the
  // outer ProfileScreen ownership of the sheet.
  const onClose = handleRequestClose;

  useEffect(() => {
    navigation.setBackHandler(visible ? handleRequestClose : null);
    return () => navigation.setBackHandler(null);
  }, [handleRequestClose, navigation, visible]);

  const renderPrivacy = (): React.JSX.Element => (
    <Stack gap="loose" testID="privacy-consent-section">
      <SectionHeader icon="privacy.consent" title={t('common.privacy.settings.title')} />
      <Card>
        <Stack>
          <Text variant="row-title">
            {t(consentStateKey)}
            {consentRecord === null
              ? null
              : ` · ${t('common.privacy.settings.decidedAt', {
                  time: formatPrivacyDecisionTime(consentRecord.decidedAt),
                })}`}
          </Text>
          <Text variant="caption" tone="subtle">
            {t('common.privacy.settings.revokeHint')}
          </Text>
        </Stack>
      </Card>
      {consentRecord === null ? (
        <Button label={t('common.privacy.settings.chooseAgain')} onPress={chooseAgain} tone="primary" />
      ) : (
        <Button label={t('common.privacy.settings.revoke')} onPress={revokeConsent} tone="secondary" />
      )}
      {revokeNotPersisted ? (
        <Text variant="caption" tone="warning">
          {t('common.privacy.consent.notPersisted')}
        </Text>
      ) : null}
    </Stack>
  );

  const renderSync = (): React.JSX.Element => (
    <>
      {syncStatus}
      {renderPrivacy()}
      <SectionHeader icon="action.sync" title={t('mobile.profile.section.sync')} />
      <Card>
        {advancedSync ? (
          <View style={{ gap: tokens['space.4'] }}>
            <Stack>
              <Text variant="row-title">{t('mobile.profile.sync.advancedTitle')}</Text>
              <Text variant="caption" tone="subtle">
                {t('mobile.profile.sync.advancedHint')}
              </Text>
            </Stack>
            <TextField
              label={t('mobile.profile.serverUrl.label')}
              value={form.serverUrl}
              onChangeText={form.setServerUrl}
              placeholder={DEFAULT_SERVER_URL}
              keyboard="url"
              hint={t('mobile.profile.serverUrl.hint')}
            />
            {form.transport === 'plaintext' ? (
              <Text variant="caption" tone="warning">
                {t('mobile.profile.transport.plaintext')}
              </Text>
            ) : null}
            {form.transport === 'plaintext-local' ? (
              <Text variant="caption" tone="warning">
                {t('mobile.profile.transport.plaintextLocal')}
              </Text>
            ) : null}
            <TextField
              label={t('mobile.profile.token.label')}
              value={form.token}
              onChangeText={form.setToken}
              placeholder={t('mobile.profile.token.placeholder')}
            />
            <TextField
              label={t('mobile.profile.password.label')}
              value={form.password}
              onChangeText={form.setPassword}
              secure
              hint={t('mobile.profile.password.hint')}
            />
            {onOpenAuth !== undefined ? (
              <Button
                label={form.configured ? t('mobile.profile.account.switchAccount') : t('mobile.profile.account.signIn')}
                tone="primary"
                onPress={() => onOpenAuth(true)}
              />
            ) : null}
            <Button
              label={t('mobile.profile.sync.advancedClose')}
              tone="ghost"
              onPress={() => {
                onUseOfficialSync?.();
                form.setServerUrl(DEFAULT_SERVER_URL);
                setAdvancedSync(false);
              }}
            />
          </View>
        ) : (
          <Stack>
            <Text variant="row-title">{t('mobile.profile.sync.officialTitle')}</Text>
            <Text variant="caption" tone="subtle">
              {t('mobile.profile.sync.officialHint')}
            </Text>
            <Text variant="caption" tone="subtle">
              {form.configured
                ? t('mobile.profile.account.signedInHint')
                : t('mobile.profile.account.signInHint')}
            </Text>
            {onOpenAuth !== undefined ? (
              <Button
                label={form.configured ? t('mobile.profile.account.switchAccount') : t('mobile.profile.account.signIn')}
                tone="primary"
                onPress={() => onOpenAuth()}
              />
            ) : null}
            <Button
              label={t('mobile.profile.sync.advancedOpen')}
              tone="ghost"
              onPress={() => setAdvancedSync(true)}
            />
          </Stack>
        )}
      </Card>
    </>
  );

  const renderGeneral = (): React.JSX.Element => (
    <>
      {shouldShowWidgetJourney(widgetBridgeAvailable) ? (
        <SettingsSection
          variant="card"
          testID="widget-journey"
          title={t('mobile.widgetJourney.sectionTitle')}
          leading={<Icon name="action.settings" size="sm" color={tokens['color.foreground-muted']} />}
          rows={widgetRows}
        />
      ) : null}
      <Text variant="caption" tone="subtle">
        {t('mobile.profile.footnote')}
      </Text>
      <SettingsSection
        variant="card"
        testID="profile-language"
        title={t('mobile.profile.section.language')}
        note={t('mobile.profile.language.hint')}
        leading={<Icon name="action.settings" size="sm" color={tokens['color.foreground-muted']} />}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.3'] }}>
          {LOCALES.map((code) => (
            <Chip
              key={code}
              label={code === 'zh-CN' ? t('common.lang.zh') : t('common.lang.en')}
              selected={locale === code}
              onPress={() => setLocale(code)}
            />
          ))}
        </View>
      </SettingsSection>
    </>
  );

  const renderSecurity = (): React.JSX.Element => (
    <>
      {securityActions !== undefined && securityActions.length > 0 ? (
        <SettingsSection
          variant="card"
          testID="settings-security-actions"
          title={sectionLabels.security}
          leading={<Icon name="privacy.consent" size="sm" color={tokens['color.foreground-muted']} />}
          rows={securityActions}
        />
      ) : null}
      <VaultSettingsSection onVaultCleanupPending={onVaultCleanupPending} />
      {vaultCleanupPending && onRetryVaultCleanup !== undefined ? (
        <Card>
          <Stack>
            <Text variant="caption" tone="danger">
              {t('mobile.vault.logoutCleanupFailed')}
            </Text>
            <Button label={t('mobile.vault.retryCleanup')} onPress={onRetryVaultCleanup} tone="ghost" />
          </Stack>
        </Card>
      ) : null}
      <Button
        label={t('mobile.profile.clearCredentials')}
        onPress={onClearCredentials}
        tone="ghost"
        disabled={form.token === '' && form.password === ''}
      />
    </>
  );

  const renderSection = (): React.JSX.Element => {
    switch (section) {
      case 'profile':
        return <>{profileEditor}</>;
      case 'general':
        return renderGeneral();
      case 'sync':
        return renderSync();
      case 'ai':
        return <AiSettingsSection />;
      case 'data':
        return (
          <SettingsSection
            variant="card"
            testID="settings-data-actions"
            title={sectionLabels.data}
            leading={<Icon name="action.share" size="sm" color={tokens['color.foreground-muted']} />}
            rows={dataActions ?? []}
          />
        );
      case 'security':
        return renderSecurity();
      case undefined:
        return (
          <SettingsSection
            variant="card"
            testID="settings-directory"
            title={t('mobile.settings.directory.title')}
            note={t('mobile.settings.directory.hint')}
            rows={sectionRows}
          />
        );
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
      testID="settings-sheet"
    >
      <View
        style={{
          flex: 1,
          backgroundColor: tokens['color.background'],
          paddingTop: insets.top,
        }}
      >
        <View
          style={{
            height: tokens['nav.app-bar-height'],
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: tokens['screen.gutter'],
            gap: tokens['space.2'],
            backgroundColor: tokens['color.surface'],
          }}
        >
          <IconButton
            icon={section === undefined ? 'action.close' : 'action.back'}
            label={section === undefined ? t('mobile.settings.close') : t('mobile.growth.back')}
            color={tokens['color.foreground-muted']}
            onPress={handleRequestClose}
          />
          <View style={{ flex: 1 }}>
            <Text variant="headline" numberOfLines={1}>
              {section === undefined ? t('mobile.settings.title') : sectionLabels[section]}
            </Text>
          </View>
          {section === undefined ? null : (
            <IconButton icon="action.close" label={t('mobile.settings.close')} onPress={closeParent} />
          )}
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView
            key={section ?? 'directory'}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: tokens['screen.gutter'],
              gap: tokens['space.4'],
              paddingBottom: tokens['screen.gutter'] + insets.bottom,
            }}
          >
            {renderSection()}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
