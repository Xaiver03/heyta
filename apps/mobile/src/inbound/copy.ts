import type { InboundAutomationCycleState } from '@heyta/app-host';
import type { MessageKey } from '@heyta/i18n';
import type { InboundReadiness } from './status';

/**
 * 自动收集一趟的终态 → 词条。
 *
 * 🔴 **穷尽 `InboundAutomationCycleState`**：共享层加一档而这张表没登记 ⇒ 编译红。
 * 这里刻意不用 `Partial<Record<…>>`（web 那份是 Partial，因为它还要覆盖 `failed` 那一档本端不渲的态）：
 * 本端只渲这四档，写成可选就是把"漏一档"变成运行时的一句空正文。
 *
 * 词条**复用 web 那四颗 key**，不在本端另造一份文案 —— 同一件事在两壳说两种话是本仓反复登记过的漂移源。
 */
export const INBOUND_CYCLE_COPY_KEY: Record<InboundAutomationCycleState, MessageKey> = {
  empty: 'web.ai.inbound.process.empty',
  submitted: 'web.ai.inbound.process.submitted',
  'needs-confirmation': 'web.ai.inbound.process.needs-confirmation',
  'waiting-entitlement': 'web.ai.inbound.process.waiting-entitlement',
};

/**
 * 这台设备**能不能**开始接收 → 词条。
 *
 * 🔴 与上面那张表是分开的两格，不是它的第五种态：终态说的是"这一趟做了什么"，
 * 这里说的是"这台设备没资格跑那一趟"。合成一格就会把"还没建密钥"念成"没有待处理的内容"。
 * ⚠️ 只给"跑不了"那两档：`ready` 不是要向用户播报的一句话，它由界面照常显示终态来表达。
 */
export const INBOUND_READINESS_COPY_KEY: Record<Exclude<InboundReadiness, 'ready'>, MessageKey> = {
  signedOut: 'web.ai.inbound.status.signIn',
  noRecipientKey: 'web.ai.inbound.status.noKeyOnThisDevice',
};

/** 那句边界（哪台设备才处理、要常年接收该把 worker 放哪）——两壳同一条，键也同一颗。 */
export const INBOUND_BOUNDARY_COPY_KEY: MessageKey = 'web.ai.inbound.boundary.foregroundOnly';
