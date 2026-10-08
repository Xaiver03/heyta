import type { InboundAutomationField } from '@heyta/inbound-core';
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
  constructor(readonly code: 'authentication' | 'forbidden' | 'validation' | 'not-found' | 'transport') { super(`Inbound rules request failed: ${code}`); }
}
export function createInboundRulesRemote(options: { baseUrl: string; getToken: () => Promise<string | undefined>; fetchImpl?: typeof fetch }) {
  const request = async (path: string, method: string, body?: unknown): Promise<Response> => {
    const token = await options.getToken();
    if (!token) throw new InboundRulesRemoteError('authentication');
    try {
      const response = await (options.fetchImpl ?? globalThis.fetch)(new URL(`/api/automation${path}`, options.baseUrl), {
        method, redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status === 401) throw new InboundRulesRemoteError('authentication');
      if (response.status === 403) throw new InboundRulesRemoteError('forbidden');
      if (response.status === 404) throw new InboundRulesRemoteError('not-found');
      if (response.status === 400) throw new InboundRulesRemoteError('validation');
      if (!response.ok) throw new InboundRulesRemoteError('transport');
      return response;
    } catch (error) { if (error instanceof InboundRulesRemoteError) throw error; throw new InboundRulesRemoteError('transport'); }
  };
  const one = async (response: Response): Promise<InboundAutomationRule> => {
    try { const value = await response.json(); if (!valid(value)) throw new Error(); return value; }
    catch { throw new InboundRulesRemoteError('transport'); }
  };
  return {
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
      return one(await request(`/rules/${encodeURIComponent(ruleId)}/enabled`, 'PUT', { enabled }));
    },
    async remove(ruleId: string): Promise<InboundAutomationRule> {
      return one(await request(`/rules/${encodeURIComponent(ruleId)}`, 'DELETE'));
    },
  };
}
