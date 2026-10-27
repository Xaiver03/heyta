import type { InboundAutomationCycleState } from '@heyta/app-host';
import type { MessageKey } from '@heyta/i18n';

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
