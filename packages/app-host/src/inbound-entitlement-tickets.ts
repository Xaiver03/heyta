import {
  AUTOMATION_ACTION_TICKET_ACTIONS,
  AUTOMATION_ENTITLEMENT_MAX_TICKET_LIFETIME_MS,
  automationEntitlementScopeMismatch,
  isAutomationEntitlementWaitingDenial,
  type AutomationActionTicketAction,
} from '@heyta/inbound-core';
import { randomId } from './ids.js';

const jsonHeaders = { 'content-type': 'application/json' } as const;
const ticketPath = '/api/automation/entitlement/ticket';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

export type { AutomationActionTicketAction } from '@heyta/inbound-core';
export { AUTOMATION_ACTION_TICKET_ACTIONS, AUTOMATION_ENTITLEMENT_TICKET_HEADER } from '@heyta/inbound-core';

export interface AutomationTicketRequest {
  readonly action: AutomationActionTicketAction;
  readonly ruleId?: string;
  readonly eventId?: string;
}

/**
 * 安装身份。服务端把它当作**这个客户实例的持久标识**：`officialSubject ↔ installation ↔
 * 本地账号` 那条绑定就是按它建的，换掉它等于换掉一台设备（旧的 worker 会被 `databaseEpoch`
 * 一并作废）。所以它必须由宿主**存下来复用**，不能每次运行现生成。
 */
export interface AutomationInstallationStore {
  load(): Promise<string | undefined>;
  save(installationId: string): Promise<void>;
}

/**
 * 生成一枚 UUID v4。优先用平台的密码学随机源；Hermes 上没有 `crypto.randomUUID`，
 * 就退到 `ids.ts` 那份带非加密回退的实现（`installationId` 是**身份**不是秘密：拿到它
 * 也签不出票，取票要先过账号 JWT）。退到那一路时 `usingRandomIdFallback()` 会亮，
 * 宿主可以据此提示，不必假装两条路的强度一样。
 */
export function newAutomationInstallationId(): string {
  const crypto_ = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  if (crypto_?.randomUUID !== undefined) return crypto_.randomUUID();
  const bytes = new Uint8Array(16);
  if (crypto_?.getRandomValues !== undefined) {
    crypto_.getRandomValues(bytes);
  } else {
    const seed = randomId();
    for (let i = 0; i < 16; i += 1) bytes[i] = (seed.charCodeAt(i % seed.length) * (i + 37) + i * 251) & 0xff;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 读到就用，读不到就生成并落盘。落盘失败会抛 —— 没有持久身份就不该开始取票。 */
export async function loadOrCreateAutomationInstallationId(store: AutomationInstallationStore): Promise<string> {
  const existing = await store.load();
  if (existing !== undefined) {
    if (!UUID.test(existing)) throw new AutomationTicketError('STORED_INSTALLATION_ID_INVALID', false);
    return existing;
  }
  const created = newAutomationInstallationId();
  await store.save(created);
  return created;
}

/** 一次取票的失败。`waiting` 为真时宿主显示"等待权益"，否则是请求本身写错了。 */
export class AutomationTicketError extends Error {
  constructor(readonly code: string, readonly waiting: boolean) {
    // 消息里不带票据正文，也不带账号凭据 —— 这一族的错误会被宿主原样转成界面状态。
    super(`Automation entitlement ticket denied: ${code}`);
  }
}

/**
 * 向签发侧要一枚**只放行这一个动作**的一次性票据。
 *
 * 每张票用一次：作用域与动作都要在发请求之前判掉（服务端签不出矛盾的组合，客户端
 * 也不该发一次注定被拒的往返），响应回来还要证 `action` 回显一致 —— 拿到别的动作的票
 * 就等于拿到一张通用通行证。
 */
export function createAutomationTicketSource(options: {
  baseUrl: string;
  token: string | (() => string);
  installationId: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): (request: AutomationTicketRequest) => Promise<string> {
  if (!UUID.test(options.installationId)) throw new AutomationTicketError('INVALID_INSTALLATION_ID', false);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  return async (request: AutomationTicketRequest): Promise<string> => {
    if (!(AUTOMATION_ACTION_TICKET_ACTIONS as readonly string[]).includes(request.action)) throw new AutomationTicketError('UNKNOWN_ACTION', false);
    if (request.ruleId !== undefined && !UUID.test(request.ruleId)) throw new AutomationTicketError('INVALID_RULE_ID', false);
    if (request.eventId !== undefined && !EVENT_ID.test(request.eventId)) throw new AutomationTicketError('INVALID_EVENT_ID', false);
    // 码直接取作用域判出来的那一格：宿主排障时要能区分"该带的没带"和"不该带的多带了"。
    const mismatch = automationEntitlementScopeMismatch(request.action, request.ruleId, request.eventId);
    if (mismatch !== undefined) throw new AutomationTicketError(mismatch, false);
    const body: Record<string, string> = { installationId: options.installationId, action: request.action };
    if (request.ruleId !== undefined) body.ruleId = request.ruleId;
    if (request.eventId !== undefined) body.eventId = request.eventId;
    const token = typeof options.token === 'function' ? options.token() : options.token;
    const response = await fetchImpl(new URL(ticketPath, options.baseUrl), {
      method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}`, ...jsonHeaders },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
      const code = typeof raw.code === 'string' ? raw.code : `HTTP_${response.status}`;
      throw new AutomationTicketError(code, isAutomationEntitlementWaitingDenial(code));
    }
    const raw = await response.json() as Record<string, unknown>;
    if (typeof raw.ticket !== 'string' || raw.ticket.length === 0 || raw.action !== request.action ||
        typeof raw.expiresAt !== 'string' || Number.isNaN(Date.parse(raw.expiresAt))) {
      throw new AutomationTicketError('MALFORMED_TICKET_RESPONSE', false);
    }
    const lifetime = Date.parse(raw.expiresAt) - now();
    if (lifetime <= 0 || lifetime > AUTOMATION_ENTITLEMENT_MAX_TICKET_LIFETIME_MS) {
      throw new AutomationTicketError('TICKET_LIFETIME_OUT_OF_BOUNDS', false);
    }
    return raw.ticket;
  };
}
