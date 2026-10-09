/**
 * `ShareConsentModal` —— PIPL 23 单独同意的模态（方案 a，见
 * `share-consent-model.ts`；条款清单 `SHARE_CONSENT_SCOPE_KEYS`）。
 *
 * 🔴 文案由宿主 `t()` 解析后传入（`labels`）；本包不 import `@heyta/i18n`。
 * 「确认」把 `accepted/dontAskAgain` 交回宿主落盘（模型 `applyShareConsent`
 * 负责状态）；「取消」原样返回 `accepted: false`——取消不是同意。
 *
 * 无障碍：模态角色 + 标题关联（`accessibilityLabelledBy` 平铺写法）；
 * 复选框是真 `Pressable` + 平铺 `aria-checked`（`rn-aria` 纪律，同 `AuthForm`）。
 */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SHARE_CONSENT_SCOPE_KEYS, applyShareConsent, type ShareConsentStore } from './share-consent-model';

export interface ShareConsentModalLabels {
  title: string;
  body: string;
  scopes: readonly string[];
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
}

export function ShareConsentModal(props: ShareConsentModalProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);
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
      accessibilityLabel={props.labels.title}
      testID="share-consent-modal"
    >
      <Text>{props.labels.title}</Text>
      <Text>{props.labels.body}</Text>
      {SHARE_CONSENT_SCOPE_KEYS.map((scopeKey) => {
        const line = props.labels.scopes[SHARE_CONSENT_SCOPE_KEYS.indexOf(scopeKey)];
        return <Text key={scopeKey}>{`· ${line ?? ''}`}</Text>;
      })}
      <Pressable
        onPress={() => setDontAskAgain((v) => !v)}
        aria-checked={dontAskAgain}
        accessibilityRole="checkbox"
        testID="share-consent-dont-ask"
      >
        <Text>{props.labels.dontAskAgain}</Text>
      </Pressable>
      <Pressable
        onPress={() => decide(true)}
        accessibilityRole="button"
        testID="share-consent-accept"
      >
        <Text>{props.labels.accept}</Text>
      </Pressable>
      <Pressable
        onPress={() => decide(false)}
        accessibilityRole="button"
        testID="share-consent-cancel"
      >
        <Text>{props.labels.cancel}</Text>
      </Pressable>
    </View>
  );
}
