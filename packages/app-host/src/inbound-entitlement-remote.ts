const jsonHeaders = { 'content-type': 'application/json' } as const;

export interface AutomationEntitlementStatus {
  readonly state: 'active';
  readonly expiresAt: string;
}

/**
 * 消费票据这一步的失败，带**服务端给的那枚稳定码**。
 *
 * 消息文本与加这个类比之前逐字相同（既有判据读的是消息）。区别只在：宿主现在能按码分
 * "这台实例没资格"（`waiting-entitlement`）与"这一跳赶在边界之后，换一枚新票再来"
 * （`retrying`）—— 只看消息的话这两件事在界面上长得一样，而它们的处置相反。
 */
export class AutomationEntitlementVerifyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
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
    throw new AutomationEntitlementVerifyError('INVALID_LOCAL_ACCOUNT_UUID', 'Invalid local account UUID');
  }
  const response = await (options.fetchImpl ?? globalThis.fetch)(new URL('/api/automation/entitlement/verify', options.baseUrl), {
    method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${options.token}`, ...jsonHeaders },
    body: JSON.stringify({ ticket: options.ticket, localAccountUuid: options.localAccountUuid }),
  });
  if (!response.ok) {
    // 只取稳定码。响应里的 `error` 那句是给运营者看的自由文本，拼进宿主状态就等于把
    // 内部措辞渲染给用户 —— 与"验证失败页不回显服务端原始错误"是同一条纪律。
    const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
    const code = typeof raw.errorCode === 'string' ? raw.errorCode : `HTTP_${response.status}`;
    throw new AutomationEntitlementVerifyError(code, 'Automation entitlement verification failed');
  }
  const raw = await response.json() as Record<string, unknown>;
  if (raw.state !== 'active' || typeof raw.expiresAt !== 'string' || Number.isNaN(Date.parse(raw.expiresAt))) {
    throw new AutomationEntitlementVerifyError('INVALID_RESPONSE', 'Invalid automation entitlement response');
  }
  return { state: 'active', expiresAt: raw.expiresAt };
}
