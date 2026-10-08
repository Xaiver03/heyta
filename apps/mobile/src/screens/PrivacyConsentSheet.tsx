/**
 * 首启隐私同意面板（移动端外壳）
 * ==============================
 *
 * web 那边是 `apps/web/src/features/privacy/PrivacyConsentSheet.tsx`，这一份是它在
 * RN 上的同级实现。**两边共用判定与持久化**（`@heyta/app-host` 的 consent 模块），
 * 只有外壳不同 —— 那是 AGENTS.md §3.5 的分界线：「同不同意」是产品语义，
 * 「怎么摆」才是平台差异。
 *
 * ## 它补的是哪一条
 *
 * 计划里的 **G-11**：「首次启动没有向用户征求过隐私同意」。在此之前移动端只有
 * 注册勾选框旁边那一句「我同意该服务端提供的服务条款与隐私政策」——
 * **只有正在注册的人才会看到条款**，而冷启动的头几秒里
 * `startAutoSync()` 的前台同步与实时通道已经可能发过请求了（**G-12**）。
 *
 * ## 🔴 为什么「只用本机」是一条能走完的路，而不是一堵墙
 *
 * PIPL 第 16 条禁止「因个人不同意处理其个人信息……拒绝提供产品或者服务」
 * （处理该信息不构成提供产品或服务所必需的除外）。heyta 是本地优先的：
 * 数据先落本机，云端只是同步通道 —— 所以「只用本机」**不是降级模式**，
 * 是同一个完整产品的另一种用法。这个结构性理由是这条要求能被满足的唯一原因；
 * 少了它，下面那句「一个功能都不少」就是假话。
 *
 * ## 三条界面纪律（与 web 同一份理由）
 *
 * 1. **两个动作并排、同等可达**。《认定方法》把「不同意即无法使用」与诱导同意
 *    列为违规，Apple 4.2 / PIPL 16 要求拒绝与同意一样容易点。
 *    「只用本机」用 `secondary` 而**不是** `danger`：它不是一个惩罚选项。
 * 2. **链接必须点开就有内容**，所以分流交给 `resolveLegalLinks()`：官方托管实例
 *    指向落地页 `/legal/*`，自建实例指向那台服务端自己的 `/terms.html`、
 *    `/privacy.html`。⚠️ 这里**不发任何探测请求**去「看看存不存在」——
 *    那正是本面板要拦的行为，用一个违规去换一个健壮性是错的。
 * 3. **决定没能落盘时必须说出口**（`notPersisted`）。移动端的落盘位置是
 *    op-sqlite 里那张偏好表，它可能整个不可用（数据库打不开）；
 *    而「点了同意、下次又问一遍」如果不说，用户读到的是「这应用在骗我」。
 *    🔴 因此 `consent-ui.ts` 在这种情况下**不收起面板**，
 *    并把两个决定按钮换成一个确认出口。
 *
 * ## RN 特有的两点
 *
 * · 关闭走 `onRequestClose`（Android 返回手势 / iOS 的可访问性退出）。
 *   关掉**不等于同意**：闸门保持关闭，决定仍是「没问过」，
 *   所以下次冷启动还会问一次 —— 词条 `common.privacy.consent.close`
 *   写的就是「以后再说」，不是「关闭」或「拒绝」。
 * · 条款链接不是 `<a>` 而是 `Linking.openURL()`：壳里没有第二个渲染器，
 *   系统浏览器是唯一合理的载体。⚠️ 和 `AuthScreen` 同一条口径 ——
 *   **不用** `canOpenURL()` 预检（iOS 13+ 没在 Info.plist 登记 scheme 时它恒为
 *   false，会把「能不能打开」变成一台设备的 plist 决定的假红），
 *   打开失败再如实说出来。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useI18n } from '@heyta/i18n';
import { resolveLegalLinks } from '@heyta/app-host';
import type { HeytaNativeTokens } from '@heyta/design-system';

import { useTheme, useTokens } from '../theme';
import { Button, IconButton, Text } from '../ui/kit';
import { Icon } from '../ui/icons';
import {
  acceptNetworkConsent,
  acknowledgeNotPersisted,
  chooseLocalOnly,
  closePrivacySheet,
  usePrivacySheet,
} from '../privacy/consent-ui';

/**
 * 面板样式：模块级工厂 + `useMemo`（与 `packages/ui/src/settings/Settings.tsx`
 * 同一惯用法）。🔴 静态样式不写 `style={{…}}` 内联 —— 内联对象每次渲染
 * 都是新建的（RN 官方样式指南与社区共识：`StyleSheet.create` 让样式以
 * ID 引用并进原生优化路径，内联只留给真动态值）；而取值经 tokens 表，
 * 不写裸数字（`check:design` 与 `check:l4` 双门禁盯）。
 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    scrim: {
      flex: 1,
      justifyContent: 'center',
      padding: tokens['screen.gutter'],
      backgroundColor: tokens['color.overlay'],
    },
    card: {
      maxHeight: '90%',
      gap: tokens['space.4'],
      padding: tokens['space.5'],
      borderRadius: tokens['radius.lg'],
      backgroundColor: tokens['color.surface-raised'],
    },
    headRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: tokens['space.2'],
    },
    headText: {
      flex: 1,
      minWidth: 0,
      gap: tokens['space.1'],
    },
    scrollContent: {
      gap: tokens['space.4'],
    },
    bulletList: {
      gap: tokens['space.2'],
    },
    bulletRow: {
      flexDirection: 'row',
      gap: tokens['space.2'],
    },
    bulletDot: {
      width: tokens['size.badge-dot'],
      height: tokens['size.badge-dot'],
      borderRadius: tokens['radius.full'],
      backgroundColor: tokens['color.foreground-muted'],
      marginTop: tokens['space.2'],
    },
    bulletText: {
      flex: 1,
    },
    linksBlock: {
      gap: tokens['space.2'],
    },
    linksRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: tokens['space.4'],
    },
    link: {
      minHeight: tokens['touch-target.min'],
      justifyContent: 'center',
      borderRadius: tokens['radius.sm'],
    },
    linkActive: {
      backgroundColor: tokens['color.primary-subtle'],
    },
    actionsRow: {
      flexDirection: 'row',
      gap: tokens['space.2'],
    },
    action: {
      flex: 1,
    },
  });
}

export interface PrivacyConsentSheetProps {
  /**
   * 条款链接指向**哪台服务端**。
   *
   * 🔴 由宿主传进来，而不是在这里读活配置：一次渲染里读一遍配置，
   * 面板就会跟着别处的配置写入改地址 —— 而用户正在读的可能是另一家的条款。
   * 宿主（`App.tsx`）与注册表单用的是**同一个值**，两个界面不会出现
   * 「同意的是 A、登录的是 B」。
   */
  serverUrl: string;
}

export function PrivacyConsentSheet({
  serverUrl,
}: PrivacyConsentSheetProps): React.JSX.Element | null {
  const { t, locale } = useI18n();
  const tokens = useTokens();
  const { native } = useTheme();
  const shadow = native.shadow('shadow.lg');
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const { open, reason, notPersisted } = usePrivacySheet();

  const links = resolveLegalLinks(serverUrl, locale);
  const [linkFailed, setLinkFailed] = useState(false);
  const [focusedLink, setFocusedLink] = useState<string | null>(null);
  const linkRequest = useRef(0);
  useEffect(() => {
    if (!open) {
      linkRequest.current += 1;
      setFocusedLink(null);
      setLinkFailed(false);
    }
    return () => { linkRequest.current += 1; };
  }, [open]);

  /**
   * 「required-for-action」时多说一句**为什么现在又弹一次**：
   * 用户刚点了同步，界面却跳出一个隐私面板 —— 不解释的话，那看起来像弹窗广告。
   */
  const whyNow =
    reason === 'required-for-action'
      ? t('common.privacy.consent.whyRequiredForAction')
      : reason === 'revoked'
        ? t('common.privacy.consent.whyRevoked')
        : null;

  const openLegalLink = (href: string): void => {
    const request = ++linkRequest.current;
    setLinkFailed(false);
    void Linking.openURL(href).catch(() => {
      if (request === linkRequest.current) setLinkFailed(true);
    });
  };

  if (!open) return null;

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={closePrivacySheet}
      accessibilityViewIsModal
    >
      <View style={styles.scrim}>
        <View style={[styles.card, shadow ?? undefined]}>
          <View style={styles.headRow}>
            <Icon name="privacy.consent" size="md" color={tokens['color.primary']} />
            <View style={styles.headText}>
              <Text variant="section-title">{t('common.privacy.consent.title')}</Text>
              {whyNow === null ? null : (
                <Text variant="caption" tone="muted">
                  {whyNow}
                </Text>
              )}
            </View>
            <IconButton
              icon="action.close"
              label={t('common.privacy.consent.close')}
              onPress={closePrivacySheet}
            />
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent}>
            <Text variant="row-title">{t('common.privacy.consent.intro')}</Text>

            {/* 两条对照着摆：不同意保住什么、同意才会发出什么。
                分成两段而不是合成一句，是因为用户要比较的是两个选项，不是一段说明。
                RN 没有 `<ul>`，所以每行前面摆一个圆点 —— 圆点是装饰，
                不进无障碍朗读（`importantForAccessibility="no"`）。 */}
            <View style={styles.bulletList}>
              {[
                t('common.privacy.consent.localOnlyGuarantee'),
                t('common.privacy.consent.acceptedGuarantee'),
              ].map((line) => (
                <View key={line} style={styles.bulletRow}>
                  <View importantForAccessibility="no" style={styles.bulletDot} />
                  <Text variant="caption" tone="muted" style={styles.bulletText}>
                    {line}
                  </Text>
                </View>
              ))}
            </View>

            {links === null ? null : (
              <View style={styles.linksBlock}>
                <Text variant="caption" tone="muted">
                  {t('common.privacy.consent.readFirst')}
                </Text>
                {/* 🔴 与决定按钮**分开的一行**：链接落在按钮/勾选行的触控区里时，
                    「我想先读条款」会变成「我已经同意了」（web 的 M3 变异抓的就是这个）。 */}
                <View style={styles.linksRow}>
                  <Pressable
                    accessibilityRole="link"
                    style={({ pressed }) => [styles.link, (pressed || focusedLink === 'terms') && styles.linkActive]}
                    onFocus={() => setFocusedLink('terms')}
                    onBlur={() => setFocusedLink(null)}
                    onPress={() => {
                      openLegalLink(links.terms);
                    }}
                  >
                    <Text variant="caption" tone="primary">
                      {t('common.privacy.consent.termsLink')}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    style={({ pressed }) => [styles.link, (pressed || focusedLink === 'privacy') && styles.linkActive]}
                    onFocus={() => setFocusedLink('privacy')}
                    onBlur={() => setFocusedLink(null)}
                    onPress={() => {
                      openLegalLink(links.privacy);
                    }}
                  >
                    <Text variant="caption" tone="primary">
                      {t('common.privacy.consent.privacyLink')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {notPersisted ? (
              <Text variant="caption" tone="warning">
                {t('common.privacy.consent.notPersisted')}
              </Text>
            ) : null}
            {linkFailed && (
              <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite">
                <Text variant="caption" tone="warning">{t('mobile.auth.link.unopenable')}</Text>
              </View>
            )}
          </ScrollView>

          {notPersisted ? (
            // 🔴 决定已经生效（本次会话内闸门该开就开、该关就关），只是这台设备记不住它。
            // 这时**不再摆两个决定按钮** —— 再点一次「同意」会被读成「刚才那下没生效」，
            // 而它确实生效了。这里要的是一次确认，不是一次重新选择。
            <Button
              label={t('common.privacy.consent.acknowledge')}
              onPress={acknowledgeNotPersisted}
              tone="primary"
            />
          ) : (
            <View style={styles.actionsRow}>
              {/* 等宽（`flex: 1`）而不是"主按钮撑满、次按钮一行小字"。 */}
              <View style={styles.action}>
                <Button
                  label={t('common.privacy.consent.accept')}
                  onPress={acceptNetworkConsent}
                  tone="primary"
                />
              </View>
              <View style={styles.action}>
                <Button
                  label={t('common.privacy.consent.localOnly')}
                  onPress={chooseLocalOnly}
                  tone="secondary"
                />
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
