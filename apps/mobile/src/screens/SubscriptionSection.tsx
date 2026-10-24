/**
 * 「订阅」—— 移动端的**独立一节**（2026-10-24）
 * ==============================================
 *
 * 产品负责人要的是"单独的订阅界面"，而且"移动端和桌面端都要有"。
 * Web 侧已经把它做成设置里的一节（`SubscriptionPanel`，三段：状态 → 选档 → 关于收费）；
 * 移动端此前是把两块**塞在「我的」的滚动流里**：`EntitlementSection`（只读状态）
 * 和 `RenewSection`（收银台），中间夹着一串"清单 / 标签 / 便签"入口 ——
 * 想付钱的人得先滚过半个屏幕，而且看不到自己在买什么。
 *
 * ## 这一屏只做**编排**，一条业务判断都不写
 *
 * | 段 | 由谁画 | 为什么 |
 * |---|---|---|
 * | 状态 | `EntitlementSection` | 权益探测与"四种观察只显示两种"的裁决在它里面（现已唯一位于 `@heyta/app-host` 的探测 + `@heyta/domain` 的判定） |
 * | 选档 + 下单 | `RenewSection` | 收银台接线（`startCheckout`）与失败归类在 `@heyta/app-host`，**不**在这里重写 |
 * | 脚注 | 本文件 | 一句"到期不会删数据" —— 它不是判断，是把用户最怕的那件事说清 |
 *
 * ## 🔴 与 Web 的差别（如实留着，别读成"两端一样"）
 *
 * 1. Web 有「刷新」按钮（主动重问一次权益）；移动端的 `EntitlementSection` 只在挂载
 *    与凭据变化时探测，**没有**手动刷新 —— 这一版没加（要加就得把探测的 refresh 提上来，
 *    那是 `EntitlementSection` 的接口变更，单独一刀更安全）。
 * 2. Web 的脚注里有"打开价格页"的外链；移动端刻意**不放外链**：那会在应用里开一个
 *    浏览器（`check:legal-links` 也按站内路径对账）。要放就先决定"外链在移动端怎么开"。
 */
import React from 'react';
import { useI18n } from '@heyta/i18n';

import { Stack, Text } from '../ui/kit';
import { EntitlementSection } from './EntitlementSection';
import { RenewSection } from './RenewSection';

export function SubscriptionSection(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Stack gap="loose" testID="subscription-section">
      <Text variant="row-meta" tone="subtle">
        {t('mobile.subscription.lead')}
      </Text>
      {/* 状态：没有可说的状态时它自己返回 null（不占位、不说假话）。 */}
      <EntitlementSection />
      {/* 选档 + 下单：收银台机器在这一枚里，本屏不重复任何判断。 */}
      <RenewSection />
      <Text variant="row-meta" tone="subtle" testID="subscription-footnote">
        {t('mobile.subscription.footnote')}
      </Text>
    </Stack>
  );
}
