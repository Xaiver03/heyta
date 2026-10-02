/**
 * 账号级"重新确认"面板（移动端外壳，G-27）
 * ======================================
 *
 * 视觉形态沿用同目录的 `PrivacyConsentSheet.tsx`（`Modal` + 遮罩 + 卡片 +
 * 链接排在按钮**外面** + `ScrollView`），但**动作集不同**，而那处不同是全部的要点：
 *
 * ## 🔴 一个主操作 + 一条从属的「稍后再说」，没有「不同意」
 *
 * 隐私面板那两块按钮必须同等可达（"不同意"是合法决定，PIPL 第 16 条）；
 * 这里没有那个方向 —— 见 `legal-recheck/reconfirm-ui.ts` 文件头。
 * 「稍后再说」用 `tone="ghost"`：它比主按钮**明显轻一档**，
 * 但仍然是**能点到的**（离线时确认发不出去，一个不可关的面板就是把整个应用锁死，
 * 而 heyta 的立场是本地数据永远可读可用）。它的措辞自带后果（"继续不同步"），
 * 否则它会读起来像"不同意"。
 *
 * ## 🔴 「稍后再说」只是推迟，不放开闸门
 *
 * 它接的是 `deferLegalReconfirm()`（收面板），**不是** `confirmLegalReconfirm()`。
 * 行为判据在 `tests/legal-recheck-mobile.spec.ts`：收起来之后
 * `legalRecheck.dataEgressAllowed()` 必须仍然是 `false`。
 * 系统返回手势（`onRequestClose`）同义 —— 关闭与推迟是一件事，同意不是。
 *
 * ## 为什么确认失败时面板不收起
 *
 * 与隐私面板那句"落盘失败不许静默"同一条纪律：闸门仍然拦着时
 * `reconfirm-ui.ts` 会**保持** `open`，并把结构化的失败原因翻成一句人话摆在这块上。
 * 收起来就等于"点了没反应"。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useI18n } from '@heyta/i18n';
import { resolveLegalLinks } from '@heyta/app-host';
import type { HeytaNativeTokens } from '@heyta/design-system';

import { useTheme, useTokens } from '../theme';
import { Button, Text } from '../ui/kit';
import { Icon } from '../ui/icons';
import { legalRecheck } from '../legal-recheck/gate';
import {
  confirmLegalReconfirm,
  deferLegalReconfirm,
  useLegalReconfirmSheet,
} from '../legal-recheck/reconfirm-ui';

/**
 * 样式：模块级工厂 + `useMemo`（与 `PrivacyConsentSheet.tsx` 同一惯用法）。
 * 🔴 静态样式不写内联对象，取值一律经 tokens 表（`check:design` / `check:l4`）。
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
    linksBlock: {
      gap: tokens['space.2'],
    },
    linksRow: {
      flexDirection: 'row',
      gap: tokens['space.4'],
    },
    linkText: {
      textDecorationLine: 'underline',
    },
    /**
     * 🔴 主按钮**独占一行**、从属的那条在它下面：这不是排版偏好，是两种语义
     * （一个决定 / 一条推迟）在视觉上就不能等宽 —— 等宽会读成"二选一"，
     * 而这里没有"另一个选择"。
     */
    primaryRow: {
      gap: tokens['space.2'],
    },
  });
}

export function LegalReconfirmSheet(): React.JSX.Element | null {
  const { t, locale } = useI18n();
  const tokens = useTokens();
  const { native } = useTheme();
  const shadow = native.shadow('shadow.lg');
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const { open, reason, submitting, serverUrl } = useLegalReconfirmSheet();

  /**
   * 闸门的状态在这里**不是** React state，它是订阅式的。
   *
   * 🔴 不订阅的话，"点了确认、服务端回了一句拒绝"这一刻界面上什么都不会变 ——
   * 而那正是这条机制唯一要说出口的一句"没有提交成功"。
   */
  const [failure, setFailure] = useState(legalRecheck.current().confirmFailure);
  useEffect(
    () => legalRecheck.subscribe(() => setFailure(legalRecheck.current().confirmFailure)),
    [],
  );

  const links = resolveLegalLinks(serverUrl, locale);

  const openLegalLink = (href: string): void => {
    Linking.openURL(href).catch(() => {
      // 与隐私面板同一条口径：**不用** `canOpenURL()` 预检（iOS 未登记 scheme 时它恒
      // false，会把真链接判死），打开失败就如实打出来，不静默。
      console.warn('[legal-recheck] 打不开条款链接：', href);
    });
  };

  if (!open) return null;

  const failureLine =
    failure === 'network'
      ? t('common.legal.reconfirm.failNetwork')
      : failure === 'unauthorized'
        ? t('common.legal.reconfirm.failUnauthorized')
        : failure === 'rejected'
          ? t('common.legal.reconfirm.failRejected')
          : null;

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={deferLegalReconfirm}
      accessibilityViewIsModal
    >
      <View style={styles.scrim}>
        <View style={[styles.card, shadow ?? undefined]}>
          <View style={styles.headRow}>
            {/* 🔴 复用隐私面板那个盾牌字形：两块面板说的是同一族的事
                （"这份数据能不能出去"是一个法律决定），另起一个字形只会让人
                以为这是两件不相干的提示。 */}
            <Icon name="privacy.consent" size="md" color={tokens['color.primary']} />
            <View style={styles.headText}>
              <Text variant="section-title">{t('common.legal.reconfirm.title')}</Text>
              {reason === 'required-for-action' ? (
                // 用户刚点了同步，界面却拦下来 —— 不解释为什么，那看起来像坏了。
                <Text variant="caption" tone="muted">
                  {t('common.sync.error.legalReconfirmRequired')}
                </Text>
              ) : null}
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent}>
            <Text variant="row-title">{t('common.legal.reconfirm.intro')}</Text>
            <Text variant="caption" tone="muted">
              {t('common.legal.reconfirm.localDataSafe')}
            </Text>

            {links === null ? null : (
              <View style={styles.linksBlock}>
                <Text variant="caption" tone="muted">
                  {t('common.legal.reconfirm.readFirst')}
                </Text>
                {/* 🔴 链接与两个按钮**分家**：链在按钮触控区里时，
                    "我想先读条款"会变成"我已经同意了"（与隐私面板同一处判据）。 */}
                <View style={styles.linksRow}>
                  <Pressable
                    accessibilityRole="link"
                    hitSlop={tokens['gesture.hit-slop']}
                    onPress={() => {
                      openLegalLink(links.terms);
                    }}
                  >
                    <Text variant="caption" tone="primary" style={styles.linkText}>
                      {t('common.privacy.consent.termsLink')}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    hitSlop={tokens['gesture.hit-slop']}
                    onPress={() => {
                      openLegalLink(links.privacy);
                    }}
                  >
                    <Text variant="caption" tone="primary" style={styles.linkText}>
                      {t('common.privacy.consent.privacyLink')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {failureLine === null ? null : (
              <Text variant="caption" tone="warning">
                {failureLine}
              </Text>
            )}
          </ScrollView>

          <View style={styles.primaryRow}>
            <Button
              label={
                submitting
                  ? t('common.legal.reconfirm.pending')
                  : t('common.legal.reconfirm.action')
              }
              onPress={() => {
                void confirmLegalReconfirm();
              }}
              tone="primary"
              // 🔴 在途时禁用：连点会打两次 POST，而第二次带的版本未必还是界面展示的那一版。
              disabled={submitting}
            />
            <Button
              label={t('common.legal.reconfirm.later')}
              onPress={deferLegalReconfirm}
              tone="ghost"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
