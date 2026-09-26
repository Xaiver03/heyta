/**
 * 订阅提示的**本地词条**。
 *
 * ## 为什么不放进 `packages/i18n`
 *
 * `packages/i18n` 是**词条的唯一事实源**，而它当前正被另一条工作流修改。
 * 往那里加 key 会与该工作流冲突（交付约束里明确禁止改它）。
 * 所以本 feature 自带一份**同形状**的本地词条表：
 *
 *   - 读取方式与全局词条表**完全相同** —— 语言来自 `@heyta/i18n` 的 `useLocale()`，
 *     而不是自己解析 `navigator.language` 之类；
 *   - 形状是 `Record<Locale, ...>`，`satisfies` 保证**每种语言都有表**，
 *     新增语言时这里会编译不过（与全局表同一个保证）。
 *
 * 🔴 **这是一处需要收编的技术债**：一旦 `packages/i18n` 空出来，
 * 这里每一条都应当平移到全局词条表并按 `t('...')` 消费，本文件随之删除。
 * 交付报告里已如实列出。
 *
 * ## 文案纪律
 *
 * - **不许恐吓**。任何"数据将丢失 / 数据将被删除"都是**假的**：
 *   本地数据一个字都不动，服务端已有的数据也不删（边界文档 §2）。
 * - **说清楚限制的**唯一**一件事**：通过官方托管服务的同步
 *   —— **就是"通过官方托管服务的同步"这一件事，所有设备，不只是新设备**。
 *   ⚠️ 本文早先写过"超出免费额度的设备无法接入"，**那个免费额度已经废弃**
 *   （边界文档 §1：需要同步的人恰恰是有 ≥2 台设备的人，白送 2 台等于白送核心需求）。
 *   所以**不要**再提"免费额度"，也**不要**说成"只影响新设备"——
 *   闸门拒绝的是整条托管同步。
 * - 不给内部标识符（协议名、加密缩写等）。
 */

import type { Locale } from '@heyta/i18n';

/**
 * 提示的措辞变体。
 *
 * `expired` 与 `refused` 分开，是因为"到期了"和"服务端因其它原因拒绝"
 * 对用户来说是不同的信息 —— 把它们合并成一句会让其中一种说假话。
 */
export type SubscriptionNoticeVariant = 'expired' | 'refused';

export type SubscriptionMessageKey =
  | 'subscription.notice.expired.title'
  | 'subscription.notice.expired.body'
  | 'subscription.notice.refused.title'
  | 'subscription.notice.refused.body'
  | 'subscription.notice.localData'
  | 'subscription.notice.selfHost'
  | 'subscription.notice.a11y';

export const SUBSCRIPTION_MESSAGE_KEYS = [
  'subscription.notice.expired.title',
  'subscription.notice.expired.body',
  'subscription.notice.refused.title',
  'subscription.notice.refused.body',
  'subscription.notice.localData',
  'subscription.notice.selfHost',
  'subscription.notice.a11y',
] as const satisfies readonly SubscriptionMessageKey[];

const ZH_CN: Record<SubscriptionMessageKey, string> = {
  'subscription.notice.expired.title': '官方托管同步已到期',
  'subscription.notice.expired.body':
    '这台设备不再通过 heyta 官方托管服务同步。你的任务、清单和设置都还在，没有被改动 —— 你随时可以改用你自己的服务器，同步会立刻恢复。',
  'subscription.notice.refused.title': '官方托管同步暂不可用',
  'subscription.notice.refused.body':
    '服务端没有放行这台设备的托管同步。你的任务、清单和设置都还在，没有被改动。',
  'subscription.notice.localData':
    '这台设备上的全部数据仍然可以正常查看、编辑和导出，不需要续费。',
  'subscription.notice.selfHost': '改用你自己的服务器',
  'subscription.notice.a11y': '托管同步状态提示',
};

const EN: Record<SubscriptionMessageKey, string> = {
  'subscription.notice.expired.title': 'Hosted sync has expired',
  'subscription.notice.expired.body':
    'This device no longer syncs through heyta\u2019s hosted service. Your tasks, lists and settings are all still here and were not changed \u2014 you can point the app at your own server at any time and syncing resumes immediately.',
  'subscription.notice.refused.title': 'Hosted sync is unavailable',
  'subscription.notice.refused.body':
    'The server did not allow hosted sync for this device. Your tasks, lists and settings are all still here and were not changed.',
  'subscription.notice.localData':
    'Everything on this device can still be viewed, edited and exported \u2014 no renewal needed.',
  'subscription.notice.selfHost': 'Use your own server',
  'subscription.notice.a11y': 'Hosted sync status notice',
};

/**
 * 语言 → 词条表。`satisfies` 保证每种 `Locale` 都有表
 * （与 `packages/i18n` 的 `CATALOGS` 同一个保证）。
 */
export const SUBSCRIPTION_MESSAGES = {
  'zh-CN': ZH_CN,
  en: EN,
} as const satisfies Record<Locale, Record<SubscriptionMessageKey, string>>;

/** 取一条本地词条。查不到就抛错（与全局 `translate()` 同一取向，不给假绿）。 */
export function subscriptionMessage(
  locale: Locale,
  key: SubscriptionMessageKey,
): string {
  const catalog = SUBSCRIPTION_MESSAGES[locale];
  if (catalog === undefined) {
    throw new Error(`[subscription] 词条不存在：${locale} / ${key}`);
  }
  return catalog[key];
}
