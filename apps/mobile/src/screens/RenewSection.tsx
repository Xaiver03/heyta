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
import React, { useMemo, useState } from 'react';
import { Clipboard, Linking, Pressable, StyleSheet, View } from 'react-native';
import {
  CHECKOUT_TIER_PRICE_IDS,
  CHECKOUT_TIERS,
  DEFAULT_CHECKOUT_TIER_ID,
  startCheckout,
  type CheckoutFailureCode,
  type CheckoutFailureReason,
  type CheckoutOutcome,
  type CheckoutTierId,
} from '@heyta/app-host';
import { useI18n, type MessageKey } from '@heyta/i18n';

import { Button, Card, Stack, Text } from '../ui/kit';
import { useTokens, useText } from '../theme';
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
  PRICE_NOT_SELLABLE: 'mobile.entitlement.renew.fail.sellable',
  PRICE_TIER_LOSES_GRANTS: 'mobile.entitlement.renew.fail.downgrade',
  NETWORK_ERROR: 'mobile.entitlement.renew.fail.network',
};

/**
 * 拒单原因码 → 词条（与 Web 侧同一张语义表，见 `checkout.ts` 的 `CheckoutFailureReason`）。
 *
 * 🔴 `PRICE_NOT_SELLABLE` 一句话盖着两件事：这一档要交付的能力本机没有（换一档就能买），
 * 与这一档全局还没开卖。前者值得单独说 —— 用户有一条真的能走的路。
 * ⚠️ 移动端这一屏**只换文案、不换档**：档位选择器与"改买官方托管"那颗按钮还没做，
 * 这半条出路是 Web 先有的。不假装两端一样。
 */
const FAILURE_REASON_KEYS: Partial<Record<CheckoutFailureReason, MessageKey>> = {
  MANAGED_AI_NOT_CONFIGURED: 'mobile.entitlement.renew.fail.managedAi',
};

/**
 * 档位 → 词条。**不写金额**，也**不另抄一份档位说明**：
 * 名字与"这一档给什么"复用落地页那两条已被 `check-pricing-consistency` 钉住的词条。
 * `landing.pricing.hostedAi.body` 自带那句"这一步会把内容发到我们的服务器，
 * 它不受端到端加密保护" —— 说在按下下单按钮之前，正是 ADR-0054 §7 要的位置。
 */
const TIER_KEYS: Record<
  CheckoutTierId,
  {
    readonly name: MessageKey;
    readonly detail: MessageKey;
    /** 标价：与价格页**同一个词条**（`check:pricing` 钉着数值一致），不另写金额。 */
    readonly price: MessageKey;
    readonly features: readonly MessageKey[];
  }
> = {
  hosted: {
    name: 'landing.pricing.hosted.name',
    detail: 'landing.pricing.hosted.body',
    price: 'landing.pricing.hosted.priceCny',
    features: [
      'landing.pricing.hosted.feature1',
      'landing.pricing.hosted.feature2',
      'landing.pricing.hosted.feature3',
    ],
  },
  hostedAi: {
    name: 'landing.pricing.hostedAi.name',
    detail: 'landing.pricing.hostedAi.body',
    price: 'landing.pricing.hostedAi.priceCny',
    features: [
      'landing.pricing.hostedAi.feature1',
      'landing.pricing.hostedAi.feature2',
      'landing.pricing.hostedAi.feature3',
    ],
  },
};

export function RenewSection({
  /**
   * 这个账号现在是不是**已经**订阅着（由订阅页从权益投影里读出来）。
   * 只影响主按钮那一个词（「订阅」/「续费」）—— 不影响任何请求：
   * 能不能买、买哪一档、收多少钱，全由服务端判（`checkout.routes.ts` 的 ①②′④）。
   */
  entitled = false,
}: {
  entitled?: boolean;
} = {}): React.JSX.Element | null {
  const { t } = useI18n();
  const tokens = useTokens();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        plan: {
          gap: tokens['space.2'],
          padding: tokens['space.3'],
          borderRadius: tokens['radius.md'],
          borderWidth: tokens['border-width.thin'],
          borderColor: tokens['color.border'],
          backgroundColor: tokens['color.surface'],
        },
        planSelected: {
          borderColor: tokens['color.primary'],
          backgroundColor: tokens['color.primary-subtle'],
        },
        planHead: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens['space.2'],
        },
      }),
    [tokens],
  );
  const [pending, setPending] = useState(false);
  const [tierId, setTierId] = useState<CheckoutTierId>(DEFAULT_CHECKOUT_TIER_ID);
  const [outcome, setOutcome] = useState<CheckoutOutcome | null>(null);

  const payTarget =
    outcome?.kind === 'qr' ? outcome.codeUrl : outcome?.kind === 'redirect' ? outcome.redirectUrl : null;

  const onRenew = async (): Promise<void> => {
    if (!privacyConsent.networkAllowed()) return;
    const config = readSyncConfig();
    if (config === undefined) {
      // 这台设备没指向任何服务端 ⇒ 对用户就是"还没登录"这一件事，说同一句话。
      setOutcome({ kind: 'failed', code: 'UNAUTHORIZED', status: null });
      return;
    }
    setPending(true);
    const next = await startCheckout({
      baseUrl: config.serverUrl,
      getToken: async () => config.token,
      priceId: CHECKOUT_TIER_PRICE_IDS[tierId],
    });
    setOutcome(next);
    setPending(false);
    if (next.kind === 'qr' || next.kind === 'redirect') {
      const url = next.kind === 'qr' ? next.codeUrl : next.redirectUrl;
      // 唤起失败**不静默**：留着这一单的信息，界面退到"复制链接"那一句。
      Linking.openURL(url).catch(() => undefined);
    }
  };

  // 只有"没同意出境"会让整块不出现；"没配服务器"不是渲染闸门，它由按下之后的那句
  // 「先登录你的 heyta 账号，才能下单。」来说（见 `onRenew` 里 config 那一支）。
  if (!privacyConsent.networkAllowed()) return null;

  return (
    <Card>
      <Text variant="row-title">{t('mobile.entitlement.renew.tierTitle')}</Text>
      <Text variant="row-meta" tone="subtle">
        {t('mobile.subscription.plans.hint')}
      </Text>
      {/*
        🔴 两档是**两张可选的卡**（名字 + 标价 + 给什么 + 三条要点），不是两颗无标签按钮：
        原来的形状只看得到档名，看不到价、也看不到买的是什么，与 Web 的订阅页也不一致。
        可访问性上仍是单选语义（`accessibilityRole="radio"` + `selected`）。
      */}
      {CHECKOUT_TIERS.map((id) => {
        const selected = tierId === id;
        return (
          <Pressable
            key={id}
            testID={`renew-tier-${id}`}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${t(TIER_KEYS[id].name)} ${t(TIER_KEYS[id].price)}`}
            onPress={() => {
              setTierId(id);
              // 换档之后上一张单不能继续挂着：那张卡写的是**旧档**冻的金额。
              setOutcome(null);
            }}
            style={[styles.plan, selected ? styles.planSelected : null]}
          >
            <View style={styles.planHead}>
              <Text variant="row-title">{t(TIER_KEYS[id].name)}</Text>
              <Text variant="row-meta">{t(TIER_KEYS[id].price)}</Text>
            </View>
            <Text variant="row-meta" tone="subtle">
              {t(TIER_KEYS[id].detail)}
            </Text>
            {TIER_KEYS[id].features.map((feature) => (
              <Text key={feature} variant="row-meta" tone="subtle">
                {`• ${t(feature)}`}
              </Text>
            ))}
          </Pressable>
        );
      })}
      <Button
        label={entitled ? t('mobile.entitlement.renew.action') : t('mobile.subscription.renew.subscribe')}
        accessibilityLabel={
          entitled ? t('mobile.entitlement.renew.action') : t('mobile.subscription.renew.subscribe')
        }
        onPress={() => void onRenew()}
        loading={pending}
        tone="secondary"
      />
      {outcome?.kind === 'failed' ? (
        <Text variant="row-meta" tone="danger">
          {t(
            (outcome.reason === undefined ? undefined : FAILURE_REASON_KEYS[outcome.reason])
              ?? FAILURE_KEYS[outcome.code]
              ?? 'mobile.entitlement.renew.fail.unknown',
            { code: outcome.code },
          )}
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
