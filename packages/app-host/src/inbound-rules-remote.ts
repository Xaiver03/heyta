import type { InboundAutomationField } from '@heyta/inbound-core';
import { AUTOMATION_ENTITLEMENT_TICKET_HEADER, signWebhook } from '@heyta/inbound-core';
import { AutomationEntitlementRequiredError, automationRejectionReason } from './inbound-worker.js';
import type { AutomationTicketRequest } from './inbound-entitlement-tickets.js';
import { inboundDraftSnapshotSchema, inboundDraftEventIdSchema, inboundDraftDecisionSchema, inboundDraftDecisionResponseSchema,
  type InboundDraftSnapshot, type InboundDraftDecision, type InboundDraftDecisionResponse } from '@heyta/shared-schema';
export type { InboundAutomationField } from '@heyta/inbound-core';

export interface InboundAutomationRule {
  id: string; version: number; enabled: boolean; keyId: string; createdAt: string; deletedAt: string | null;
  allowedFields: readonly InboundAutomationField[]; targetProjectId: string | null; timezone: string | null;
  parseVersion: number; authorizationVersion: number; maxItems: number;
}
export interface InboundAutomationRuleConfig {
  allowedFields?: readonly InboundAutomationField[];
  targetProjectId?: string | null; timezone?: string | null; parseVersion?: number; maxItems?: number;
}
export interface InboundSenderCredential {
  credentialId: string; keyId: string; createdAt: string; revokedAt: string | null; rotatedAt: string | null;
}
const decodeSecret = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new InboundRulesRemoteError('validation');
  const binary = globalThis.atob(value.replace(/-/g, '+').replace(/_/g, '/') + '=');
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};
export interface InboundAutomationEventSummary {
  eventId: string; ruleId: string; ruleVersion: number; status: string;
  reasonCode: string | null; attempt: number; receivedAt: number;
}
const validEvent = (value: unknown): value is InboundAutomationEventSummary => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  return typeof e.eventId === 'string' && typeof e.ruleId === 'string' && typeof e.status === 'string' &&
    (e.reasonCode === null || typeof e.reasonCode === 'string') &&
    typeof e.ruleVersion === 'number' && Number.isSafeInteger(e.ruleVersion) && e.ruleVersion > 0 &&
    typeof e.attempt === 'number' && Number.isSafeInteger(e.attempt) && e.attempt >= 0 &&
    typeof e.receivedAt === 'number' && Number.isSafeInteger(e.receivedAt) && e.receivedAt >= 0;
};
const fields = new Set(['title', 'note', 'priority', 'projectId', 'dueDate', 'startDate', 'durationMinutes']);
const valid = (value: unknown): value is InboundAutomationRule => {
  if (value === null || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.version === 'number' && typeof r.enabled === 'boolean' &&
    typeof r.keyId === 'string' && typeof r.createdAt === 'string' && (r.deletedAt === null || typeof r.deletedAt === 'string') &&
    Array.isArray(r.allowedFields) && r.allowedFields.length > 0 && r.allowedFields.every((f) => typeof f === 'string' && fields.has(f)) &&
    (r.targetProjectId === null || typeof r.targetProjectId === 'string') && (r.timezone === null || typeof r.timezone === 'string') &&
    typeof r.parseVersion === 'number' && Number.isInteger(r.parseVersion) && typeof r.authorizationVersion === 'number' && Number.isInteger(r.authorizationVersion) &&
    typeof r.maxItems === 'number' && Number.isInteger(r.maxItems) && r.maxItems >= 1 && r.maxItems <= 50;
};
export class InboundRulesRemoteError extends Error {
  constructor(readonly code: 'authentication' | 'forbidden' | 'validation' | 'not-found' | 'conflict' | 'transport') { super(`Inbound rules request failed: ${code}`); }
}
export function createInboundRulesRemote(options: {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  /**
   * 两个受权益闸门的写（启用规则、签发发送凭据）各自在**发请求之前**取一枚只放行它自己的票。
   * 不给就等于这一路不带票 —— 服务端按部署模式决定是放行还是 402，宿主不许假装知道。
   */
  getEntitlementTicket?: (request: AutomationTicketRequest) => Promise<string>;
}) {
  const request = async (path: string, method: string, body?: unknown, ticketRequest?: AutomationTicketRequest): Promise<Response> => {
    const token = await options.getToken();
    if (!token) throw new InboundRulesRemoteError('authentication');
    // 取票排在 try 之前：票据源抛的错（作用域不符、签发方没配…）不能被下面那层
    // "任何异常都算传输失败"吞掉 —— 那正是宿主显示"等待权益"和"网络坏了"的分界。
    const ticketHeaders: Record<string, string> = options.getEntitlementTicket === undefined || ticketRequest === undefined
      ? {}
      : { [AUTOMATION_ENTITLEMENT_TICKET_HEADER]: await options.getEntitlementTicket(ticketRequest) };
    try {
      const response = await (options.fetchImpl ?? globalThis.fetch)(new URL(`/api/automation${path}`, options.baseUrl), {
        method, redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...ticketHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 402) throw new AutomationEntitlementRequiredError(await automationRejectionReason(response));
      if (response.status === 401) throw new InboundRulesRemoteError('authentication');
      if (response.status === 403) throw new InboundRulesRemoteError('forbidden');
      if (response.status === 404) throw new InboundRulesRemoteError('not-found');
      if (response.status === 400) throw new InboundRulesRemoteError('validation');
      if (response.status === 409) throw new InboundRulesRemoteError('conflict');
      if (!response.ok) throw new InboundRulesRemoteError('transport');
      return response;
    } catch (error) {
      if (error instanceof InboundRulesRemoteError || error instanceof AutomationEntitlementRequiredError) throw error;
      throw new InboundRulesRemoteError('transport');
    }
  };
  const one = async (response: Response): Promise<InboundAutomationRule> => {
    try { const value = await response.json(); if (!valid(value)) throw new Error(); return value; }
    catch { throw new InboundRulesRemoteError('transport'); }
  };
  return {
    async listSenderCredentials(ruleId: string): Promise<readonly InboundSenderCredential[]> {
      const body = await (await request(`/rules/${encodeURIComponent(ruleId)}/sender-credentials`, 'GET')).json() as { credentials?: unknown };
      if (!Array.isArray(body.credentials) || !body.credentials.every((value) => {
        if (value === null || typeof value !== 'object') return false;
        const row = value as Record<string, unknown>;
        return typeof row.credentialId === 'string' && typeof row.keyId === 'string' && typeof row.createdAt === 'string' &&
          (row.revokedAt === null || typeof row.revokedAt === 'string') && (row.rotatedAt === null || typeof row.rotatedAt === 'string');
      })) throw new InboundRulesRemoteError('transport');
      return body.credentials as InboundSenderCredential[];
    },
    async issueSenderCredential(ruleId: string, keyId: string): Promise<{ credentialId: string; keyId: string; secret: string; ruleId: string }> {
      const response = await request(`/rules/${encodeURIComponent(ruleId)}/sender-credentials`, 'POST', { keyId }, { action: 'sender-credential-issue', ruleId });
      const body = await response.json() as Record<string, unknown>;
      if (typeof body.credentialId !== 'string' || typeof body.keyId !== 'string' || typeof body.secret !== 'string' || body.ruleId !== ruleId) throw new InboundRulesRemoteError('transport');
      return body as { credentialId: string; keyId: string; secret: string; ruleId: string };
    },
    async revokeSenderCredential(credentialId: string): Promise<boolean> {
      const response = await request('/sender-credentials/revoke', 'POST', { credentialId });
      const body = await response.json() as { revoked?: unknown };
      if (typeof body.revoked !== 'boolean') throw new InboundRulesRemoteError('transport');
      return body.revoked;
    },
    async testSend(ruleId: string, keyId: string, secret: string): Promise<{ eventId: string; state: string }> {
      const eventId = `test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const body = new TextEncoder().encode(JSON.stringify({ title: 'heyta automatic capture test' }));
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const path = `/api/automation/v1/hooks/${encodeURIComponent(ruleId)}`;
      const signature = signWebhook(decodeSecret(secret), { method: 'POST', path, ruleId, keyId, timestamp, eventId, contentType: 'application/json', body });
      const response = await (options.fetchImpl ?? globalThis.fetch)(new URL(path, options.baseUrl), { method: 'POST', redirect: 'error', headers: {
        'content-type': 'application/json', 'x-heyta-key-id': keyId, 'x-heyta-timestamp': timestamp,
        'x-heyta-event-id': eventId, 'x-heyta-signature': signature,
      }, body });
      if (!response.ok) throw new InboundRulesRemoteError(response.status === 401 ? 'authentication' : response.status === 403 ? 'forbidden' : response.status === 409 ? 'conflict' : 'transport');
      const result = await response.json() as { eventId?: unknown; state?: unknown };
      if (result.eventId !== eventId || typeof result.state !== 'string' || result.state.length === 0 || Object.keys(result).some((key) => key !== 'eventId' && key !== 'state')) throw new InboundRulesRemoteError('transport');
      return { eventId, state: result.state };
    },
    async readDraft(eventId: string): Promise<InboundDraftSnapshot> {
      if (!inboundDraftEventIdSchema.safeParse(eventId).success) throw new InboundRulesRemoteError('validation');
      const response = await request(`/events/${encodeURIComponent(eventId)}/draft`, 'GET');
      try {
        const checked = inboundDraftSnapshotSchema.safeParse(await response.json());
        if (!checked.success || checked.data.eventId !== eventId) throw new Error();
        return checked.data;
      } catch { throw new InboundRulesRemoteError('transport'); }
    },
    async decideDraft(eventId: string, decision: InboundDraftDecision): Promise<InboundDraftDecisionResponse> {
      const checked = inboundDraftDecisionSchema.safeParse(decision);
      if (!inboundDraftEventIdSchema.safeParse(eventId).success || !checked.success) throw new InboundRulesRemoteError('validation');
      const response = await request(`/events/${encodeURIComponent(eventId)}/draft/decision`, 'POST', checked.data);
      try {
        const result = inboundDraftDecisionResponseSchema.safeParse(await response.json());
        const expected = checked.data.decision === 'confirm' ? 'prepared' : 'cancelled';
        if (!result.success || result.data.eventId !== eventId || result.data.state !== expected) throw new Error();
        return result.data;
      } catch { throw new InboundRulesRemoteError('transport'); }
    },
    async listEvents(): Promise<readonly InboundAutomationEventSummary[]> {
      const body = await (await request('/events', 'GET')).json() as { events?: unknown };
      if (!Array.isArray(body.events) || body.events.length > 50 || !body.events.every(validEvent)) throw new InboundRulesRemoteError('transport');
      return body.events;
    },
    async retryEvent(event: InboundAutomationEventSummary): Promise<void> {
      const response = await request(`/events/${encodeURIComponent(event.eventId)}/retry`, 'POST', {
        expectedAttempt: event.attempt, expectedRuleVersion: event.ruleVersion,
      });
      const body = await response.json() as { eventId?: unknown; state?: unknown };
      if (body.eventId !== event.eventId || body.state !== 'queued') throw new InboundRulesRemoteError('transport');
    },
    async list(): Promise<readonly InboundAutomationRule[]> {
      const body = await (await request('/rules', 'GET')).json() as { rules?: unknown };
      if (!Array.isArray(body.rules) || !body.rules.every(valid)) throw new InboundRulesRemoteError('transport');
      return body.rules;
    },
    async create(keyId: string, config: InboundAutomationRuleConfig = {}): Promise<InboundAutomationRule> {
      return one(await request('/rules', 'POST', { keyId, ...config }));
    },
    async update(ruleId: string, config: InboundAutomationRuleConfig): Promise<InboundAutomationRule> {
      return one(await request(`/rules/${encodeURIComponent(ruleId)}/config`, 'PUT', config));
    },
    async setEnabled(ruleId: string, enabled: boolean): Promise<InboundAutomationRule> {
      // 关掉一条规则不要求权益，只有启用才要票 —— 服务端那一格带 `when`，宿主这边不带第二份判断。
      return one(await request(`/rules/${encodeURIComponent(ruleId)}/enabled`, 'PUT', { enabled },
        enabled ? { action: 'rule-enable', ruleId } : undefined));
    },
    async remove(ruleId: string): Promise<InboundAutomationRule> {
      return one(await request(`/rules/${encodeURIComponent(ruleId)}`, 'DELETE'));
    },
  };
}
