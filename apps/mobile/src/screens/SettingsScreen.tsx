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

import React, { useCallback, useEffect, useState } from 'react';
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

import {
  Button,
  Card,
  Chip,
  IconButton,
  SectionHeader,
  Text,
  TextField,
} from '../ui/kit';
import { Icon } from '../ui/icons';
import { useLocalePreference } from '../i18n/locale-preference';
import { useTokens } from '../theme';
import type { SyncCredentialForm } from '../sync/credential-form';
import { DEFAULT_SERVER_URL } from '../sync/config';
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

export function SettingsScreen({
  visible,
  onClose,
  form,
  onClearCredentials,
}: {
  /** 「我的」持有这个状态；关闭只是把它拨回 `false`，不卸载「我的」。 */
  visible: boolean;
  onClose: () => void;
  /** 状态活在「我的」（见文件头），这里只消费。 */
  form: SyncCredentialForm;
  /** 清凭据（磁盘 + 小组件 + 账号 + 表单状态）由「我的」按序组合，这里只触发。 */
  onClearCredentials: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const { locale, setLocale } = useLocalePreference();

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

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      // Android 返回键 / 读屏的"离开"动作都落到 onClose。
      accessibilityViewIsModal
      testID="settings-sheet"
    >
      <View
        style={{
          flex: 1,
          backgroundColor: tokens['color.background'],
          // Modal 不吃 kit `Screen` 的标签栏预留，但**必须**自己让出状态栏
          //（`statusBarTranslucent` 下内容会顶到状态栏底下）。
          paddingTop: insets.top,
        }}
      >
        {/* 头部：关闭 + 标题。骨架照 `TaskDetailSheet` 的手写先例 ——
            刻意不用 kit `AppBar`：它绑定了页面的 insets 语义。 */}
        <View
          style={{
            height: tokens['nav.app-bar-height'],
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: tokens['screen.gutter'],
            gap: tokens['space.2'],
            borderBottomWidth: tokens['border-width.thin'],
            borderBottomColor: tokens['color.border'],
            backgroundColor: tokens['color.surface'],
          }}
        >
          <IconButton
            icon="action.close"
            label={t('mobile.settings.close')}
            color={tokens['color.foreground-muted']}
            onPress={onClose}
          />
          <View style={{ flex: 1 }}>
            <Text variant="headline" numberOfLines={1}>
              {t('mobile.settings.title')}
            </Text>
          </View>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: tokens['screen.gutter'],
              gap: tokens['space.4'],
              paddingBottom: tokens['screen.gutter'] + insets.bottom,
            }}
          >
            {/*
              ── 同步凭据（手动兜底路径）───────────────────────────
              🔴 从「我的」搬进设置面的那段表单，一个字没改逻辑 ——
              改的只是"住在哪"（goal M3 的注入判据盯的就是这一点：
              搬回去，门禁红）。
            */}
            <SectionHeader icon="action.sync" title={t('mobile.profile.section.sync')} />
            <Text variant="caption" tone="subtle">
              {t('mobile.profile.sync.manualHint')}
            </Text>
            <Card>
              <View style={{ gap: tokens['space.4'] }}>
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
              </View>
            </Card>

            {/*
              清凭据必须**连小组件一起清**（决策 D6）—— 组合逻辑在
              「我的」（`onClearCredentials`），这里只有按钮。
            */}
            <Button
              label={t('mobile.profile.clearCredentials')}
              onPress={onClearCredentials}
              tone="ghost"
              disabled={form.token === '' && form.password === ''}
            />

            {/*
              桌面小组件 —— 应用内旅程。整段的判据是"原生桥在不在这台设备上"
              （不是平台名）；桥不在时整段不画。理由在 `widget-journey.ts` 文件头。
            */}
            {shouldShowWidgetJourney(widgetBridgeAvailable) ? (
              <SettingsSection
                variant="card"
                testID="widget-journey"
                title={t('mobile.widgetJourney.sectionTitle')}
                leading={
                  <Icon name="action.settings" size="sm" color={tokens['color.foreground-muted']} />
                }
                rows={widgetRows}
              />
            ) : null}

            <Text variant="caption" tone="subtle">
              {t('mobile.profile.footnote')}
            </Text>

            {/*
              语言。胶囊是移动端 L2 原语（`Chip`），走插槽注入 ——
              共享层只负责分组骨架、标题与说明。
              语言名永远用**它自己的语言**写（中文 / English），
              不跟着当前语言翻译。
            */}
            <SettingsSection
              variant="card"
              testID="profile-language"
              title={t('mobile.profile.section.language')}
              note={t('mobile.profile.language.hint')}
              leading={
                <Icon name="action.settings" size="sm" color={tokens['color.foreground-muted']} />
              }
            >
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.3'] }}>
                {LOCALES.map((code) => {
                  const label = code === 'zh-CN' ? t('common.lang.zh') : t('common.lang.en');
                  return (
                    <Chip
                      key={code}
                      label={label}
                      selected={locale === code}
                      onPress={() => {
                        setLocale(code);
                      }}
                    />
                  );
                })}
              </View>
            </SettingsSection>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
