/**
 * 欢迎页（移动端 · 规范 §3.1）
 * =============================
 *
 * 冷启动的**第一屏**。它存在的唯一理由是让「注册 / 登录」在旅程上**前置**：
 * 规范 §3.1 的一致性判据是"任一端的用户，冷启动后**不超过 1 次点击**就能看到
 * 注册/登录表单"。
 *
 * ## 🔴 它不是登录墙 —— 用户永远有路可走
 *
 * 规范 §0 把"前置"定义成**第一屏可见 + 一步可达 + 首次启动有引导**，
 * 而**不是**"把本地功能锁在登录后面"。所以这一屏有**两个同级明确的出口**：
 *
 *   · 主按钮「注册 / 登录」   —— 前置的落点；
 *   · 次按钮「先离线使用」     —— 本地优先的出口。
 *
 * 少了后者，应用就从"本地优先"变成"必须联网才能开始用"，
 * 而那会同时违反 ADR-0003 与 e2e 里"未登录也能建任务"的既有断言。
 *
 * ## 不占 tab（规范 §2-A8）
 *
 * 它是 `App.tsx` 在**首次启动**时覆盖显示的一屏，不进 `TabBar`。
 * 底部标签必须保持 5 个（任务 / 日历 / 专注 / 分类 / 我的）。
 *
 * ## 何时不再出现
 *
 * 两条路都会记进**设备本地偏好**（`src/prefs/device-prefs.ts`），
 * 所以"不再自动出现"是**跨冷启动**成立的，不是只在本会话内成立：
 *   · 点「先离线使用」；
 *   · **登录成功** —— 用户已经有账号了，再给他看"注册/登录"是多余的
 *     （规范 §3.1 的原话就是"首次启动（本机从未登录过）"）。
 *
 * 从欢迎页返回但**没有**登录成功时，偏好**不写** —— 下次冷启动还会出现。
 * 这是对的：用户此时既没登录也没接受离线，什么都不记才是诚实的。
 */

import React, { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@heyta/i18n';

import { Button, Text } from '../ui/kit';
import { AuthScreen, type SavedAuthSession } from './AuthScreen';
import { useTokens } from '../theme';

export interface WelcomeScreenProps {
  /** 同步设置里已有的服务端地址（一般还没有，回落到默认值）。 */
  initialServerUrl: string;
  /** 点「先离线使用」。宿主负责**持久化**并离开本屏。 */
  onUseOffline: () => void;
  /** 登录成功（会话已写进活配置、同步已触发）。宿主据此离开本屏。 */
  onSignedIn: (saved: SavedAuthSession) => void;
}

export function WelcomeScreen({
  initialServerUrl,
  onUseOffline,
  onSignedIn,
}: WelcomeScreenProps): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  /**
   * 认证面板在这一屏里是**替换**而不是叠加。
   *
   * 理由：本屏没有标签栏、也没有返回栈，叠一层 Modal 会多出一层系统级的
   * 背景与关闭手势；而"替换"让返回键的行为只有一个可能（回到欢迎页）。
   */
  const [authOpen, setAuthOpen] = useState(false);

  if (authOpen) {
    return (
      <AuthScreen
        initialServerUrl={initialServerUrl}
        initialPassword=""
        onBack={() => {
          setAuthOpen(false);
        }}
        onSignedIn={onSignedIn}
      />
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens['color.background'],
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingHorizontal: tokens['screen.gutter'],
        justifyContent: 'center',
      }}
    >
      {/*
        🔴 主按钮与次按钮之间**必须留出层次**：主按钮在上面、用 primary 色，
        次按钮用 ghost。两个都做成 primary 的话，"先离线使用"就不再是出口，
        而变成一个看起来同样重要的推荐路径 —— 那与"本地优先"的定位不符。
      */}
      <View style={{ gap: tokens['space.4'] }}>
        <Text variant="screen-title">{t('mobile.welcome.title')}</Text>
        <Text variant="row-title" tone="muted">
          {t('mobile.welcome.tagline')}
        </Text>

        <View style={{ height: tokens['space.4'] }} />

        <Button
          label={t('mobile.welcome.signIn')}
          onPress={() => {
            setAuthOpen(true);
          }}
          tone="primary"
        />
        <Button label={t('mobile.welcome.offline')} onPress={onUseOffline} />
        <Text variant="caption" tone="subtle">
          {t('mobile.welcome.offlineHint')}
        </Text>
      </View>
    </View>
  );
}
