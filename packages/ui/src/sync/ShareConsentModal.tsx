/**
 * `ShareConsentModal` —— PIPL 23 单独同意的模态（方案 a，见
 * `share-consent-model.ts`；条款清单 `SHARE_CONSENT_SCOPE_KEYS`）。
 *
 * 🔴 文案由宿主 `t()` 解析后传入（`labels`）；本包不 import `@heyta/i18n`。
 * 「确认」把 `accepted/dontAskAgain` 交回宿主落盘（模型 `applyShareConsent`
 * 负责状态）；「取消」原样返回 `accepted: false`——取消不是同意。
 * 勾选框**默认不勾**（`useState(false)`）——这两条是 PIPL 的红线，重排界面时不许丢。
 *
 * 无障碍：模态角色 + 标题关联（`accessibilityLabelledBy` 平铺写法）；
 * 复选框是真 `Pressable` + 平铺 `aria-checked`（`rn-aria` 纪律，同 `AuthForm`）。
 *
 * ## 形状（2026-10-27 按负责人的两条令重做，见计划 §9.38）
 *
 * 原来到场面前是一块常驻的三行披露面加一句长说明，读起来像一份说明书。两条原话：
 * ①「直接说『分享清单』『加入清单』就可以了，干嘛搞那么复杂呢」⇒ 标题**按语境分叉**，
 * 分享侧与加入侧两颗键；②「各种东西应该放在一个 tool tip 里面，而不是放一大段说明文字」
 * ⇒ 四行条款收进 ⓘ 提示，面板正文只留一句短话（也是两颗键）。
 * 条款的**内容**一个字没减，减的是它常驻占的那块面。
 *
 * ## 🔴 提示层的开合：**只有按压**（键盘 Enter/Space 走同一发 `onPress`），且那一叠排在动作区下面
 *
 * ⚠️ 这一格翻掉了 §9.38 写的"网页＝悬停 ⓘ 气泡"。不是省事——悬停在**这个**容器里拿不到
 * 一个不跳的形状，两种形状都是真浏览器量出来的：
 *
 * · **悬停 + 行内展开** ⇒ 展开把卡片撑高 ~140px，而对话框是**垂直居中**的 ⇒ 上面那两颗
 *   按钮往上跳、ⓘ 自己往下跳出指针 ⇒ 收起 ⇒ 又跳回来 ⇒ 开了收收了开地振荡。读数：旅程里
 *   点「确认共享」`waiting for element to be visible, enabled and stable` **333 次**直到
 *   测试结束，`share-panel` 那一格 30s 等不到。同意面上"看见的那一格"与"按下去的那一格"
 *   不是同一格，这是产品事故，不是测试噪音。
 * · **悬停 + 浮层**（`position:absolute`）⇒ 那一叠压在「不再提示」与按钮上、还溢出对话框
 *   下沿（`02b-owner-consent-details.png` 第 1 版看图看出来的）；而 web 的对话框写着
 *   `overflowY:'auto'`（`ShareFeature.tsx` 的 `styles.dialog`）⇒ 溢出部分不是"探出去"，
 *   是被它自己的滚动容器裁掉。
 *
 * 于是两壳**同一形**：ⓘ 是一枚真按钮，按下去（触屏与鼠标同一条路）或 Enter/Space
 * （RN 把键盘激活也映射成 `onPress`）展开，再按一次收回。判据仍不许并成"有 tooltip"
 * 一句合取：这里钉的是"按压能开"＋"那一叠排在动作区下面"＋"收起时内容还在树里"三发，
 * 各挡一种坏法（摘掉 `onPress`／把它挪回按钮上面／把卸载当成收起）。`#598` 那一族是同一课。
 *
 * 条款**内容**常驻树里、收起时 `display:none` —— 与
 * `apps/web/src/features/settings/SettingsInfoTip.tsx` 同一个理由：判据不必先"打开"
 * 才读得到条款文字，读屏用户也能经 `aria-describedby` 拿到它。
 *
 * ## 视觉层级（2026-10-11 按最佳实践定稿，不是"补样式"）
 *
 * 这一层此前**一条样式都没有**：控件都是能用、能读的真 `Pressable`，但条款行
 * 与两个按钮在视觉上等权 —— 同意面读起来像一段裸文本加两颗一样的按钮。PIPL 要的
 * "单独同意"最忌的就是这个形状（默认路径与拒绝路径看不出差别）。所以：
 *
 * - **提示展开后是一块披露面**，不是几行 `·`：单独一格凹陷底色（`surface-sunken`），
 *   正文级字号。它是同意的**内容**，不该比说明文字小一档。
 * - **只有一颗按钮是强调的**：「确认共享」实心主蓝（`AuthForm` 的 `primary` 同一套
 *   token 与按压写法），「取消」走 `ghost` 文字按钮。等权的两个按钮会把"拒绝"
 *   画成"另一个主操作"。
 * - **勾选框必须看得见是个勾选框**（方框 + 选中态实色 + `Check` 图标），
 *   而且**不靠颜色单独表意**：`aria-checked` 与图标同时携带状态。默认不勾。
 * - **命中区吃 `touch-target.min`**，按钮、提示触发件与勾选行都不低于 44。
 *
 * `titleHidden`：宿主的对话框自己已经有同一句标题时（web 的分享/入群对话框在同意相位
 * 把 `<h2>` 换成同一颗语境键，见 `apps/web/src/features/share/ShareFeature.tsx`）
 * 由宿主置真，避免同屏出现两个同名标题。默认假 —— 没有外层标题的宿主（移动端弹层）
 * 仍然要这句。
 */

import { useId, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Check, Info } from 'lucide';

import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { SHARE_CONSENT_SCOPE_KEYS, applyShareConsent, type ShareConsentStore } from './share-consent-model';

export interface ShareConsentModalLabels {
  /** 语境键：分享侧 `…consent.title.share`／加入侧 `…consent.title.join`，不是同一句。 */
  title: string;
  /** 语境键，一句短话。条款不再写在这里。 */
  body: string;
  /** ⓘ 那枚触发件的文字（同时是它的无障碍名）。 */
  detailsLabel: string;
  /** 提示层里的逐行条款，顺序与 `SHARE_CONSENT_SCOPE_KEYS` 一致。 */
  details: readonly string[];
  dontAskAgain: string;
  accept: string;
  cancel: string;
}

export interface ShareConsentModalProps {
  labels: ShareConsentModalLabels;
  store: ShareConsentStore;
  /** 宿主的偏好落盘（本地）——模型算出的下一状态交回宿主持久化。 */
  onConsent: (next: ShareConsentStore) => void;
  /** 用户确认共享：宿主继续走"创建共享"的后续动作。 */
  onProceed: () => void;
  onCancel: () => void;
  /** 外层已经写着同一句标题时置真（见文件头）。省略 = 渲染这句。 */
  titleHidden?: boolean;
}

export function ShareConsentModal(props: ShareConsentModalProps) {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const detailsId = useId();
  const [dontAskAgain, setDontAskAgain] = useState(false);
  // 只有按压一条通道（键盘 Enter/Space 在 RN 里同样落到 `onPress`）。
  // 🔴 为什么没有悬停：见文件头那两种实测过的坏形状。
  const [detailsOpen, setDetailsOpen] = useState(false);
  const decide = (accepted: boolean) => {
    const result = applyShareConsent(props.store, {
      accepted,
      dontAskAgain,
      now: Date.now(),
    });
    props.onConsent(result.store);
    if (result.proceed) props.onProceed();
    else props.onCancel();
  };

  return (
    <View
      accessibilityRole="none"
      accessibilityLabel={props.titleHidden ? undefined : props.labels.title}
      testID="share-consent-modal"
      style={styles.root}
    >
      {props.titleHidden ? null : (
        <Text
          accessibilityRole="header"
          style={[text['headline'], { color: tokens['color.foreground'] }]}
        >
          {props.labels.title}
        </Text>
      )}

      <Text style={[text['row-title'], { color: tokens['color.foreground'] }]}>{props.labels.body}</Text>

      <Pressable
        onPress={() => setDontAskAgain((v) => !v)}
        aria-checked={dontAskAgain}
        accessibilityRole="checkbox"
        testID="share-consent-dont-ask"
        style={({ pressed: active }) => [styles.termsRow, active ? styles.pressed : null]}
      >
        <View style={[styles.checkbox, dontAskAgain ? styles.checkboxOn : null]}>
          {dontAskAgain ? (
            <HeytaIcon data={Check} size={tokens['icon.xs']} color={tokens['color.on-primary']} />
          ) : null}
        </View>
        <Text style={[text['caption'], styles.termsText]}>{props.labels.dontAskAgain}</Text>
      </Pressable>

      {/* 两个动作**不等权**：确认是实心主按钮，取消是文字按钮。 */}
      <View style={styles.actions}>
        <Pressable
          onPress={() => decide(false)}
          accessibilityRole="button"
          testID="share-consent-cancel"
          style={({ pressed: active }) => [styles.ghost, active ? styles.pressed : null]}
        >
          <Text style={[text['headline'], styles.ghostText]}>{props.labels.cancel}</Text>
        </Pressable>
        <Pressable
          onPress={() => decide(true)}
          accessibilityRole="button"
          testID="share-consent-accept"
          style={({ pressed: active }) => [styles.primary, active ? styles.primaryPressed : null]}
        >
          <Text style={[text['headline'], styles.primaryLabel]}>{props.labels.accept}</Text>
        </Pressable>
      </View>

      {/* 🔴 排在动作区**下面**：展开只往下长，卡片里没有任何一个控件会动（两条坏法
          都实测过，读数在文件头）。条款内容一条没少，只是不再常驻。 */}
      <Pressable
        onPress={() => setDetailsOpen((v) => !v)}
        accessibilityRole="button"
        aria-expanded={detailsOpen}
        aria-controls={detailsId}
        aria-describedby={detailsId}
        testID="share-consent-details-trigger"
        style={({ pressed: active }) => [styles.detailsRow, active ? styles.pressed : null]}
      >
        <HeytaIcon data={Info} size={tokens['icon.sm']} color={tokens['color.foreground-muted']} />
        <Text style={[text['caption'], styles.detailsRowText]}>{props.labels.detailsLabel}</Text>
      </Pressable>

      <View
        nativeID={detailsId}
        testID="share-consent-details"
        style={detailsOpen ? styles.details : styles.detailsHidden}
      >
        {SHARE_CONSENT_SCOPE_KEYS.map((scopeKey, index) => {
          const line = props.labels.details[index];
          if (line === undefined) return null;
          return (
            <View key={scopeKey} style={styles.detailRow}>
              <View style={styles.detailMarker} />
              <Text style={[text['row-title'], styles.detailText]}>{line}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** 取一份 token 表建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: ReturnType<typeof useHeytaTokens>) {
  return StyleSheet.create({
    root: {
      gap: tokens['space.3'],
    },
    detailsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
    },
    detailsRowText: {
      color: tokens['color.foreground-muted'],
    },
    details: {
      gap: tokens['space.2'],
      padding: tokens['space.4'],
      borderRadius: tokens['radius.md'],
      // 🔴 刻意**不描边**：`surface-sunken` 与它自己的描边候选（`border-subtle` = 同一个
      // slate-100、`border` = slate-200）实测对比只有 1.0–1.13，画上去是一道看不见的线，
      // 比不画更容易被读成"渲染坏了"。这块面靠**底色凹陷**与外部分隔。
      backgroundColor: tokens['color.surface-sunken'],
    },
    /** 收起态：留在树里但不出画。删掉这一条等于条款又变回常驻。 */
    detailsHidden: {
      display: 'none',
    },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: tokens['space.2'],
    },
    /** 项目符号用图形色（3:1 就够），文字一律走 `foreground`。 */
    detailMarker: {
      marginTop: tokens['space.2'],
      width: tokens['size.badge-dot'],
      height: tokens['size.badge-dot'],
      borderRadius: tokens['radius.full'],
      backgroundColor: tokens['color.foreground-subtle'],
    },
    detailText: {
      flex: 1,
      color: tokens['color.foreground'],
    },
    termsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
    },
    checkbox: {
      width: tokens['size.checkbox'],
      height: tokens['size.checkbox'],
      borderRadius: tokens['radius.sm'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: tokens['color.background'],
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: {
      backgroundColor: tokens['color.primary'],
      borderColor: tokens['color.primary'],
    },
    termsText: {
      flex: 1,
      color: tokens['color.foreground-muted'],
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: tokens['space.2'],
    },
    primary: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.4'],
      borderRadius: tokens['radius.md'],
      backgroundColor: tokens['color.primary'],
    },
    primaryPressed: {
      // 与 `AuthForm.primaryPressed` 同一个理由：实心主按钮用透明度按下去像"变淡了"，
      // 而实心感正是它的可点性提示。
      backgroundColor: tokens['color.primary-active'],
    },
    primaryLabel: {
      color: tokens['color.on-primary'],
    },
    ghost: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.3'],
      borderRadius: tokens['radius.md'],
    },
    ghostText: {
      color: tokens['color.foreground'],
    },
    pressed: {
      // 扁平风格用**底色**表达按压，不用阴影（AGENTS §5：阴影只给真正的浮层）。
      backgroundColor: tokens['color.surface-sunken'],
    },
  });
}
