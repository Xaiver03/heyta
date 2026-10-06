/**
 * 「我的」里的托管同步权益 —— 一条**读得到的**状态，不是一个按钮
 * ================================================================
 *
 * 移动端此前**没有任何一处**能让用户看到自己有没有托管同步权益。零件其实都在：
 * `@heyta/app-host#fetchHostedEntitlementReading`（`entitlement.ts`）是全仓唯一的
 * 权益探测，web 在订阅面板里用了它，移动壳一次都没调。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 四种观察，只显示其中两种（这是本文件的全部判断）
 *
 * `HostedEntitlementReading` 有四个分支，它的注释写得很清楚：**只有 `denied`
 * 才是"服务端明确说没权益"**，另外三种都不构成限制（fail-open）。所以：
 *
 * | 观察            | 显示 | 为什么 |
 * |---|---|---|
 * | `entitled`      | ✅ 一句"已开启" | 用户要看到自己有 |
 * | `denied` + `PERIOD_ENDED` | ✅ 到期那两句 | 唯一能叫"到期"的 |
 * | `denied` + 其它原因 | ✅ "暂不可用"那两句 | 见下 |
 * | `unconfigured`  | ❌ 整块不渲染 | 没配服务器就没有托管权益，写"未知"是噪音 |
 * | `unavailable`   | ❌ 整块不渲染 | 🔴 **探测失败 ≠ 没权益**；在这里显示红字会把"网络不通"伪装成"你被降级了" |
 *
 * "其它原因"这一桶**刻意不说"到期"也不说"请订阅"**：`ENTITLEMENT_DENIAL_REASONS`
 * 的文件头专门警告过，`GRANT_NOT_INCLUDED`（¥5 档不含云端 AI）与 `NO_SUBSCRIPTION`
 * /`PERIOD_ENDED` 混成一句会让付过钱的用户以为自己的订阅失效了。
 * `web.subscription.notice.refused.*` 那句是**与原因无关的真话**
 * （"服务端没有放行这台设备的托管同步"），所以未知原因落到它不会说谎；
 * 未知原因**不猜成过期**这条纪律由 `UNKNOWN_ENTITLEMENT_DENIAL_REASON` 定，本文件照抄。
 *
 * ⚠️ 文案**全部复用 web 那三条真词条**（"同一句话不复制第二份"），
 * 但**不能**写进 `ProfileScreen.tsx`：那里的两条冻结判据
 * （`profile-nickname-entry.spec.ts:144`、`profile-avatar-entry.spec.ts:172`）
 * 拿整份源码做正则，要求那个文件里连注释都不许出现 web 前缀的词条调用 ——
 * 所以权益这段独立成组件。
 */

import React, { useEffect, useState } from 'react';
import type { HostedEntitlementReading } from '@heyta/domain';
import { fetchHostedEntitlementReading } from '@heyta/app-host';
import { useI18n } from '@heyta/i18n';

import { Card, Text } from '../ui/kit';
import { readSyncConfig } from '../sync/config';
import { privacyConsent } from '../privacy/consent-gate';

/** 服务端明确拒绝时的两种措辞。到期是唯一能叫"到期"的那一种。 */
function noticeKeys(reading: Extract<HostedEntitlementReading, { kind: 'denied' }>) {
  return reading.reason === 'PERIOD_ENDED'
    ? {
        title: 'web.subscription.notice.expired.title' as const,
        body: 'web.subscription.notice.expired.body' as const,
      }
    : {
        title: 'web.subscription.notice.refused.title' as const,
        body: 'web.subscription.notice.refused.body' as const,
      };
}

export function EntitlementSection(): React.JSX.Element | null {
  const { t } = useI18n();
  const [reading, setReading] = useState<HostedEntitlementReading | null>(null);

  useEffect(() => {
    let alive = true;
    // 🔴 出境同意闸门与全仓同一条：不同意就**一个请求都不发**（不是"发了再丢弃"）。
    //    探测本身也是出境 —— 它带 Bearer 令牌。
    if (!privacyConsent.networkAllowed()) return;
    const config = readSyncConfig();
    if (config === undefined) return;
    fetchHostedEntitlementReading({
      baseUrl: config.serverUrl,
      getToken: async () => config.token,
    })
      .then((next) => {
        if (alive) setReading(next);
      })
      .catch(() => {
        // `fetchHostedEntitlementReading` 自己已经不抛（全部归一成 `unavailable`）。
        // 这里兜的是"读配置这一步抛"（磁盘状态坏了）—— 同样当"不知道"处理：不显示。
        if (alive) setReading({ kind: 'unavailable', cause: 'network' });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (reading === null) return null;

  if (reading.kind === 'entitled') {
    return (
      <Card>
        <Text variant="row-title">{t('mobile.profile.entitlement.entitled')}</Text>
        <Text variant="row-meta" tone="subtle">
          {t('web.subscription.notice.localData')}
        </Text>
      </Card>
    );
  }

  if (reading.kind === 'denied') {
    const keys = noticeKeys(reading);
    return (
      <Card>
        <Text variant="row-title">{t(keys.title)}</Text>
        <Text variant="row-meta">{t(keys.body)}</Text>
        <Text variant="row-meta" tone="subtle">
          {t('web.subscription.notice.localData')}
        </Text>
      </Card>
    );
  }

  // `unconfigured` / `unavailable`：什么都不显示（理由见文件头的表）。
  return null;
}
