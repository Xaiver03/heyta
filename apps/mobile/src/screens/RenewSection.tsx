/**
 * 「我的」里的托管同步续费入口（移动端）
 * ==========================================
 *
 * 与 web 的 `RenewPanel` 共用**同一份接线**（`@heyta/app-host#startCheckout`）：
 * 报价、冻结订单、拿支付串的流程没有第二份实现（AGENTS.md §3.5）。
 *
 * ## 为什么移动端反而**不需要**二维码
 *
 * 微信 Native 返回的 `code_url` 是一条两用串：编进二维码给人扫，
 * 或者**在装着微信的手机上直接打开**唤起收银台。手机正是后一种的载体，
 * 所以这里用 `Linking.openURL` —— 不需要引入任何 QR 编码器（§3.1/§3.2 两道门）。
 * 打不开（没装微信 / 被系统拦）就退到"复制链接"，界面上那句话如实说这件事。
 *
 * ## 🔴 三条与 web 同形的纪律
 *
 * 1. **没同意出境就一个请求都不发**（`privacyConsent.networkAllowed()`）——
 *    下单带 Bearer 令牌，本身就是出境。
 * 2. **界面不声称钱已经到账**。到账只有 webhook 知道；这里能说的只有"已为你打开付款页"。
 * 3. **失败必须可见**。503（这台实例没配收款通道）要说人话，不能静默。
 *
 * ⚠️ 独立成文件而不是写进 `ProfileScreen.tsx`：那里的两条冻结判据
 * （`profile-nickname-entry.spec.ts:144`、`profile-avatar-entry.spec.ts:172`）
 * 要求那个文件里连注释都不许出现 web 前缀的词条调用 —— 本文件用的全是 `mobile.` 词条，
 * 但挂载点仍留在独立组件里，避免下一次再复用同一句话时踩到那两条。
 */
import React, { useState } from 'react';
import { Clipboard, Linking } from 'react-native';
import { startCheckout, type CheckoutFailureCode, type CheckoutOutcome } from '@heyta/app-host';
import { useI18n, type MessageKey } from '@heyta/i18n';

import { Button, Card, Text } from '../ui/kit';
import { readSyncConfig } from '../sync/config';
import { privacyConsent } from '../privacy/consent-gate';

/**
 * 失败码 → 词条。`Record` 而不是动态拼 key（拼错没有类型兜底，门禁也按字面认）。
 *
 * 🔴 词表外的码一律落到 `unknown`，并把**原始码**附在后面：
 * 用一句中文解释一个我们没读过的服务端码，就是替服务端编造语义。
 */
const FAILURE_KEYS: Partial<Record<CheckoutFailureCode, MessageKey>> = {
  UNAUTHORIZED: 'mobile.entitlement.renew.fail.unauthorized',
  BILLING_PROVIDER_NOT_CONFIGURED: 'mobile.entitlement.renew.fail.provider',
  NETWORK_ERROR: 'mobile.entitlement.renew.fail.network',
};

export function RenewSection(): React.JSX.Element | null {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<CheckoutOutcome | null>(null);

  const payTarget =
    outcome?.kind === 'qr' ? outcome.codeUrl : outcome?.kind === 'redirect' ? outcome.redirectUrl : null;

  const onRenew = async (): Promise<void> => {
    if (!privacyConsent.networkAllowed()) return;
    const config = readSyncConfig();
    if (config === undefined) return;
    setPending(true);
    const next = await startCheckout({ baseUrl: config.serverUrl, getToken: async () => config.token });
    setOutcome(next);
    setPending(false);
    if (next.kind === 'qr' || next.kind === 'redirect') {
      const url = next.kind === 'qr' ? next.codeUrl : next.redirectUrl;
      // 唤起失败**不静默**：留着这一单的信息，界面退到"复制链接"那一句。
      Linking.openURL(url).catch(() => undefined);
    }
  };

  // 没同意出境 / 没配服务器时整块不出现 —— 与权益那块同一套"不猜、不难为用户"。
  if (!privacyConsent.networkAllowed()) return null;

  return (
    <Card>
      <Button
        label={t('mobile.entitlement.renew.action')}
        accessibilityLabel={t('mobile.entitlement.renew.action')}
        onPress={() => void onRenew()}
        loading={pending}
        tone="secondary"
      />
      {outcome?.kind === 'failed' ? (
        <Text variant="row-meta" tone="danger">
          {t(FAILURE_KEYS[outcome.code] ?? 'mobile.entitlement.renew.fail.unknown', { code: outcome.code })}
        </Text>
      ) : null}
      {payTarget !== null ? (
        <>
          <Text variant="row-meta">{t('mobile.entitlement.renew.opened')}</Text>
          <Text variant="row-meta" tone="subtle">
            {t('mobile.entitlement.renew.payHint')}
          </Text>
          <Button
            label={t('mobile.entitlement.renew.copy')}
            accessibilityLabel={t('mobile.entitlement.renew.copy')}
            onPress={() => Clipboard.setString(payTarget)}
            tone="ghost"
          />
        </>
      ) : null}
    </Card>
  );
}
