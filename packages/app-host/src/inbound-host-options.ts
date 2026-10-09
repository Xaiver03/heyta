import type { AiRoutingConfig, EgressConsent, SecretStore } from '@heyta/ai';
import type { InboundAutomationField } from '@heyta/inbound-core';

/**
 * Configuration for one host-owned inbound automation cycle.
 *
 * 这枚契约住在 `inbound-*` 而不是 `host.ts`：每个壳（web / node / mobile）都从包的公开入口
 * 取它，而 `host.ts` 的注册表只是其中一处消费者。
 */
export interface InboundAutomationHostOptions {
  userId: string;
  keyEpoch: number;
  allowedFields: readonly InboundAutomationField[];
  targetProjectId?: string;
  maxItems?: number;
  routing: AiRoutingConfig;
  secretStore?: SecretStore;
  consents: readonly EgressConsent[];
  systemPrompt: string;
  parseVersion: number;
  timezone?: string;
  eventId?: string;
  /** A private key supplied by the host's secure-store bridge. */
  privateKey?: Uint8Array;
}
