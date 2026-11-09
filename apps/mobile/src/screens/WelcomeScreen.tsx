/**
 * 欢迎页（移动端 · 规范 §3.1）
 * =============================
 *
 * 冷启动第一屏，也是「注册 / 登录」在旅程上的**前置落点**：
 * 规范 §3.1 的判据是"冷启动后**不超过 1 次点击**就能看到注册/登录"。
 *
 * ## 🔴 2026-10-26 第三版：整屏动效 + 底部动作区 + 几乎不写字
 *
 * 产品负责人的原话（连着四句，按说的顺序）：
 *
 * > 「你能看得到二者的差距吗？我们完全可以更加有创意一点。」
 * > 「把那个注册登录放到最底部，然后以背景作为动效……用那种滚动的动效去展示各个功能。」
 * > 「还是要有文字跟着动效走，不然都不知道这个图标是什么意思。」
 * > 「为什么是左右相同的内容在这儿滚动呢？」「上下是割裂的……注册登录那个地方背景是完全黑色的，
 * >   这不应该。整个动效都应该作为背景图，包括注册登录按钮的背景图。」
 *
 * 于是这一屏只有**一层背景 + 一层动作区**：
 *
 *   1. **背景**：四个功能面（任务 / 日历 / 专注 / 统计）的生成图**铺满整屏**，
 *      每 3.6 秒交叉淡入换一张，同时整层极缓慢地放大（Ken Burns）。
 *      它**一路铺到按钮下面** —— 上一版在底部叠了四段压暗，于是上下像两块屏拼的，
 *      而按钮区是纯黑。现在压暗只到"文字读得清"为止（最深处 0.45，不是 0.95）。
 *   2. **功能标题 + 圆点**：文字**跟着当前这张图**走（产品负责人：没有文字就不知道
 *      图标是什么）。标题只用已有的短标签（任务 / 日历 / 专注 / 统计），不新写文案 ——
 *      这一屏"文字只要一点点"，说明性内容属于落地页与文档中心。
 *   3. **底部动作区**：`注册 / 登录` + `先离线使用`，浮在背景上，**不铺黑底**。
 *      点登录时认证面板从底部升起（覆盖背景，但仍能看到顶部的一条缝）。
 *
 * ⚠️ 素材是**生成图**（`gpt-image-2`，创业OS 路由），四张 512px JPEG 共 77 KB；
 * 提示词、出处与后处理写在 `assets/illustrations/onboarding/provenance.json`。
 * 图里**没有文字**是提示词硬约束：一张带字的图会在两种语言下同时错。
 *
 * ## 它不是登录墙
 *
 * 「先离线使用」必须一直可达（ADR-0003：不联网也能开始用）。面板升起之后它仍在
 * 面板内容底部。这一屏**不进 tab**（规范 §2-A8，底部 5 个标签不变）。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { MessageKey } from '@heyta/i18n';
import { useI18n } from '@heyta/i18n';

import { Button, Text } from '../ui/kit';
import { AuthScreen, type SavedAuthSession } from './AuthScreen';
import { useTheme, useTokens } from '../theme';

/** 四个功能面：图 + **跟随它的**短标题（借用已存在的 tab 标签，不新增文案）。 */
const SLIDES = [
  { art: require('../../../../assets/illustrations/onboarding/bg-tasks.jpg'), titleKey: 'mobile.tab.tasks' },
  { art: require('../../../../assets/illustrations/onboarding/bg-calendar.jpg'), titleKey: 'mobile.tab.calendar' },
  { art: require('../../../../assets/illustrations/onboarding/bg-focus.jpg'), titleKey: 'mobile.tab.focus' },
  { art: require('../../../../assets/illustrations/onboarding/bg-stats.jpg'), titleKey: 'mobile.tab.categories' },
] as const satisfies ReadonlyArray<{ art: number; titleKey: MessageKey }>;

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: tokens['color.background'], overflow: 'hidden' },
    /**
     * 背景层：整屏铺满，`cover` 裁切。
     * ⚠️ 它是**氛围**不是内容 —— `pointerEvents="none"` + 无障碍隐藏。
     */
    bgLayer: { ...StyleSheet.absoluteFillObject },
    /**
     * 底部渐隐：**六级平滑上升**（0 → 0.72），不是原来那三级大跳（0.05/0.12/0.45）。
     * 🔴 三级大跳在屏幕上看得见**两条横带**，那正是"上下割裂"的来源：
     * 相邻两级的差值越大，交界处越像一条线。六级、每级 ≤0.15，眼睛读成渐变。
     */
    fade: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
    fadeStep: { height: '8%' },
    /** 功能标题 + 圆点：跟着当前那张图走，位置在下方三分之一，眼睛从图滑到按钮的路上。 */
    caption: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      gap: tokens['space.3'],
      paddingHorizontal: tokens['screen.gutter'],
    },
    dots: { flexDirection: 'row', gap: tokens['space.2'] },
    dot: {
      width: tokens['space.2'],
      height: tokens['space.2'],
      borderRadius: tokens['radius.full'],
      backgroundColor: tokens['color.border-strong'],
      opacity: 0.5,
    },
    dotOn: { backgroundColor: tokens['color.primary'], opacity: 1 },
    /**
     * 底部动作区：**浮在背景上**，不铺黑底（上一版正是那块黑底把屏幕切成两半）。
     * 两枚按钮自己带底色（`primary` / `ghost`），所以不需要给容器加底色。
     */
    dock: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: tokens['screen.gutter'],
      gap: tokens['space.2'],
    },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '88%',
      borderTopLeftRadius: tokens['radius.xl'],
      borderTopRightRadius: tokens['radius.xl'],
      backgroundColor: tokens['color.background'],
      borderTopWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
    },
    sheetBody: {
      paddingHorizontal: tokens['screen.gutter'],
      paddingTop: tokens['space.4'],
      gap: tokens['space.4'],
    },
    grabber: {
      alignSelf: 'center',
      width: tokens['space.10'],
      height: tokens['border-width.thick'] * 2,
      borderRadius: tokens['radius.full'],
      backgroundColor: tokens['color.border-strong'],
      marginTop: tokens['space.2'],
    },
    offline: { alignSelf: 'center', padding: tokens['space.2'] },
  });
}

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
  const { reducedMotion, native } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const insets = useSafeAreaInsets();

  const [authOpen, setAuthOpen] = useState(false);
  const [slide, setSlide] = useState(0);

  /**
   * 换页节奏与交叉淡入时长都从 token 推，不写裸毫秒。
   * `reducedMotion` 时**不自动轮播**（停在第 0 张），而不是"切快一点"。
   */
  const fade = tokens['duration.slow'] * 4;
  const hold = tokens['duration.slow'] * 12;
  useEffect(() => {
    if (reducedMotion) return undefined;
    const timer = setInterval(() => {
      setSlide((current) => (current + 1) % SLIDES.length);
    }, hold);
    return () => {
      clearInterval(timer);
    };
  }, [hold, reducedMotion]);

  /**
   * 四张图层**常驻**、只切不透明度：这样交叉淡入时两张同时在，不会闪一帧黑。
   * 每层一个 `Animated.Value`，由 `slide` 驱动。
   */
  const opacities = useRef(SLIDES.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;
  useEffect(() => {
    // 🔴 曲线走 token，和 `StateIllustration` / `SwipeReveal` 同一条取法
    // （`native.easing(key)`），不再硬编码 `Easing.inOut(Easing.quad)`。
    //
    // 选 `ease.standard`（`cubic-bezier(0.2, 0, 0.2, 1)`）：这一格是**对称**动作 ——
    // 循环里对每一层都跑一遍，`i === slide` 的那层 0→1、其余层 1→0，
    // 同一时刻既有"淡入"又有"淡出"，没有单向的进/出语义可挑，
    // 而 `ease.standard` 正是 token 表里为"两向都说得通"准备的那条。
    // 形状上也最贴合原来的 `Easing.inOut(Easing.quad)`：两者都是两端缓、
    // 中间快的 ease-in-out 族；换 `ease.enter`（ease-out）或 `ease.exit`（ease-in）
    // 都会把一次对称交叉淡入变成偏斜的。
    const easing = native.easing('ease.standard');
    SLIDES.forEach((_, i) => {
      const to = i === slide ? 1 : 0;
      if (reducedMotion) {
        opacities[i]?.setValue(to);
        return;
      }
      Animated.timing(opacities[i] as Animated.Value, {
        toValue: to,
        duration: fade,
        // 回退到 `Easing.linear`（与 `SwipeReveal` / `StateIllustration` 同一条）：
        // 解析不出来 = token 被改成 RN 不认的形状，属**配置缺陷**，不该在调用点掩盖。
        easing: easing === null ? Easing.linear : Easing.bezier(...easing),
        useNativeDriver: true,
      }).start();
    });
  }, [fade, native, opacities, reducedMotion, slide]);

  /*
    🔴 **不要加无限循环的装饰动画**（2026-10-26 实测）。
    这里原来有一层 Ken Burns（整层缓慢放大再回落，`Animated.loop`），看起来更"活"，
    但它让窗口**永远不会进入 idle** —— `adb shell uiautomator dump` 直接报
    `could not get idle state`，于是设备腿的**每一条**基于 dump 的断言都拿不到界面，
    报出来是"拿不到真实界面（环境失败）"。一屏永远在动 = 天然不可自动化，
    而这条验收恰恰是这一屏唯一的真机回归网。
    换页的交叉淡入是**有终点**的（几百毫秒后静止），所以留着；常驻循环去掉。
  */

  /** 面板升起：位移 + 淡入。 */
  const rise = useRef(new Animated.Value(authOpen ? 1 : 0)).current;
  const panelDuration = tokens['duration.normal'];
  useEffect(() => {
    if (reducedMotion) {
      rise.setValue(authOpen ? 1 : 0);
      return;
    }
    // 🔴 曲线走 token，与上面两处同一条取法。
    //
    // 选 `ease.enter`（`cubic-bezier(0, 0, 0.2, 1)`，token 里标着"ease-out：进入"）：
    // 同一个 `Animated.Value` 两个方向都跑（`authOpen ? 1 : 0`），但**升起面板**
    // 才是用户盯着看的那一次，收起是它的反动作 —— 以"进入"这个主语义取值，
    // 与 `AuthScreen` 的入场淡入同一口径。
    // 形状上它也正是原来 `Easing.out(Easing.cubic)` 的同族（起步快、收尾慢）；
    // ⚠️ 收起时它会表现为"起步快"（原来的 cubic 同样如此），所以这次替换
    // **没有引入新的不对称**，只是数值略有差别。
    const easing = native.easing('ease.enter');
    Animated.timing(rise, {
      toValue: authOpen ? 1 : 0,
      duration: panelDuration,
      // 回退到 `Easing.linear`，理由同上（token 形状不可解析 = 配置缺陷，不掩盖）。
      easing: easing === null ? Easing.linear : Easing.bezier(...easing),
      useNativeDriver: true,
    }).start();
  }, [authOpen, native, panelDuration, reducedMotion, rise]);

  return (
    <View style={styles.root}>
      {/*
        背景就是**一张连续的竖版整屏图**（`bg-*.jpg`，主体在上 2/3、底部 1/3 自带渐隐），
        四张交叉淡入 + 整层极缓慢放大。

        🔴 这一版之前的两次错法，都记在这里免得再犯：
          · 拿**方形卡片图** `cover` 铺满整屏 —— 方图下半部是空的，屏幕上必然出现
            "上半截有东西、下半截纯黑"，压暗怎么调都救不回来；
          · 把图画成一块**浮在中间的卡** —— 那又变回"上下两块"，正是产品负责人说的割裂。
        素材侧的正解是"生成时就按竖版整屏构图"，代码侧只负责铺满与切换。
      */}
      <Animated.View
        style={styles.bgLayer}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {SLIDES.map((item, index) => (
          <Animated.View key={item.titleKey} style={[styles.bgLayer, { opacity: opacities[index] }]}>
            <Image source={item.art} style={styles.bgLayer} resizeMode="cover" />
          </Animated.View>
        ))}
      </Animated.View>

      {/* 底部渐隐：六级平滑（理由与"横带"的关系写在 `styles.fade` 上）。 */}
      <View style={styles.fade} pointerEvents="none">
        {[0, 0.04, 0.1, 0.2, 0.36, 0.55].map((opacity) => (
          <View
            key={opacity}
            style={[styles.fadeStep, { backgroundColor: tokens['color.background'], opacity }]}
          />
        ))}
      </View>

      {/* 功能标题 + 圆点：**跟着当前这张图**。 */}
      {authOpen ? null : (
        <View style={[styles.caption, { paddingBottom: insets.bottom + tokens['space.16'] * 2 }]} pointerEvents="none">
          <Text variant="row-title">{t((SLIDES[slide] ?? SLIDES[0]).titleKey)}</Text>
          <View style={styles.dots}>
            {SLIDES.map((item, index) => (
              <View key={item.titleKey} style={[styles.dot, index === slide ? styles.dotOn : null]} />
            ))}
          </View>
        </View>
      )}

      {/* 底部动作区：浮在背景上，不铺黑底。 */}
      {authOpen ? null : (
        <View style={[styles.dock, { paddingBottom: insets.bottom + tokens['space.4'] }]}>
          {/*
            🔴 这里**不放品牌标识**（2026-10-26 产品负责人：「heyta 这几个字不需要出现在
            产品界面。我都是在 APP 当中点进去的……所以产品界面不需要留这个品牌标识」）。
            这一屏是**应用内部**的登录入口，不是落地页 —— 品牌名只属于后者的首屏。
          */}
          <Button
            label={t('mobile.welcome.signIn')}
            onPress={() => {
              setAuthOpen(true);
            }}
            tone="primary"
            testID="welcome-signin"
          />
          {/* 🔴 testID 不是给用户看的：设备腿按它定位（`content-desc` 在 MIUI 上
              会被合成的字符串顶掉，精确匹配会落空，而失败信息只会说"入口不在第一屏"）。 */}
          <Button label={t('mobile.welcome.offline')} onPress={onUseOffline} testID="welcome-offline" />
        </View>
      )}

      {/* 认证面板：从底部升起；背景仍露一条缝，所以它读起来是"抽屉"而不是"另一个页面"。 */}
      {authOpen ? (
        <Animated.View
          style={[
            styles.sheet,
            {
              transform: [
                { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [tokens['space.16'] * 6, 0] }) },
              ],
              opacity: rise,
            },
          ]}
        >
          <View style={styles.grabber} />
          <ScrollView
            contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + tokens['space.6'] }]}
            keyboardShouldPersistTaps="handled"
          >
            <AuthScreen
              embedded
              initialServerUrl={initialServerUrl}
              initialPassword=""
              onBack={() => {
                setAuthOpen(false);
              }}
              onSignedIn={onSignedIn}
            />
            <Pressable accessibilityRole="button" onPress={onUseOffline} style={styles.offline}>
              <Text variant="caption" tone="muted">{t('mobile.welcome.offline')}</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      ) : null}
    </View>
  );
}
