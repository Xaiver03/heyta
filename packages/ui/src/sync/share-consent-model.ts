/**
 * PIPL 23 单独同意的**纯逻辑**（ADR-0062 决策 8、third-parties 1.4 s4b 的承诺落点）。
 * ================================================================================
 *
 * 采纳的界面形态（方案 a，2026-10-09，待产品负责人在 W4 验收时追认）：
 * **首次「共享此清单」弹模态确认**——列明可见范围与元数据类别——
 * 附「不再提示」勾选（默认不勾）。
 *
 * 🔴 勾选的语义（exact）：勾了「不再提示」⇒ 永不再弹；
 * **没勾 ⇒ 下一次共享时还会弹一次**（这就是复选框的价值所在——
 * 否则它就是装饰）。没确认过 ⇒ 必弹。
 *
 * 状态存哪：**本地**（偏好存储，宿主注入读写）。`acceptedAt` 是那次确认的时刻，
 * 存本地即可；服务端在创建共享时自然会看到"有一个 share 被创建了"
 * （行为即同意的凭证），不需要为同意单开一张服务端表。
 *
 * 🔴 fail-closed 方向：`shouldShowConsent` 在**没有任何记录**时必须返回
 * `true`（宁可多问一次，不可不问就共享）；只有"确认过且勾了不再提示"
 * 这一种组合才免弹。
 */

export interface ShareConsentStore {
  /** 从未确认过 = 缺席 ⇒ 必须弹（fail-closed）。 */
  consentAcceptedAt?: number;
  dontAskAgain?: boolean;
}

export interface ShareConsentDecision {
  show: boolean;
  reason: 'first-time' | 'repeat' | 'opted-out';
}

export function shouldShowConsent(store: ShareConsentStore): ShareConsentDecision {
  if (store.dontAskAgain === true && store.consentAcceptedAt !== undefined) {
    return { show: false, reason: 'opted-out' };
  }
  return {
    show: true,
    reason: store.consentAcceptedAt !== undefined ? 'repeat' : 'first-time',
  };
}

export interface ShareConsentResult {
  store: ShareConsentStore;
  /** 界面据此决定是否继续走"创建共享"的后续动作。 */
  proceed: boolean;
}

/** 用户在模态上的两种处置。`accepted = false` = 取消 ⇒ 不创建共享、不留确认记录。 */
export function applyShareConsent(
  store: ShareConsentStore,
  input: { accepted: boolean; dontAskAgain: boolean; now: number },
): ShareConsentResult {
  if (!input.accepted) {
    return { store, proceed: false };
  }
  return {
    store: {
      consentAcceptedAt: input.now,
      dontAskAgain: input.dontAskAgain,
    },
    proceed: true,
  };
}

/** 模态正文的结构化内容（文案归 i18n，这里是**要展示哪些条款**的清单）。 */
export const SHARE_CONSENT_SCOPE_KEYS = [
  'common.share.consent.scope.content',
  'common.share.consent.scope.metadata',
  'common.share.consent.scope.notAffected',
] as const;
