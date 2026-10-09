const jsonHeaders = { 'content-type': 'application/json' } as const;

export interface AutomationEntitlementStatus {
  readonly state: 'active';
  readonly expiresAt: string;
}

/** Consume one official online ticket without putting it in the op-log or logs. */
export async function verifyAutomationEntitlementTicket(options: {
  baseUrl: string;
  token: string;
  ticket: string;
  localAccountUuid: string;
  fetchImpl?: typeof fetch;
}): Promise<AutomationEntitlementStatus> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.localAccountUuid)) {
    throw new Error('Invalid local account UUID');
  }
  const response = await (options.fetchImpl ?? globalThis.fetch)(new URL('/api/automation/entitlement/verify', options.baseUrl), {
    method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${options.token}`, ...jsonHeaders },
    body: JSON.stringify({ ticket: options.ticket, localAccountUuid: options.localAccountUuid }),
  });
  if (!response.ok) throw new Error('Automation entitlement verification failed');
  const raw = await response.json() as Record<string, unknown>;
  if (raw.state !== 'active' || typeof raw.expiresAt !== 'string' || Number.isNaN(Date.parse(raw.expiresAt))) {
    throw new Error('Invalid automation entitlement response');
  }
  return { state: 'active', expiresAt: raw.expiresAt };
}
