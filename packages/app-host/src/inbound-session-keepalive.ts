import {
  AUTOMATION_ENTITLEMENT_MAX_TICKET_LIFETIME_MS,
  isAutomationEntitlementWaitingDenial,
} from '@heyta/inbound-core';
import { AutomationEntitlementVerifyError, verifyAutomationEntitlementTicket } from './inbound-entitlement-remote.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const jsonHeaders = { 'content-type': 'application/json' } as const;

/**
 * `session` 绑定在宿主侧的四种状态。
 *
 * 🔴 里面**没有**票据正文，也没有 `localAccountUuid`：这个对象会被宿主原样放进界面状态、
 * 有时也进日志。`code` 只放稳定码。
 *
 * | kind | 含义 | 心跳 |
 * |---|---|---|
 * | `active` | 绑定在这一刻是活的，`expiresAt` 是**服务端报的**到期时刻 | 按剩余寿命排下一次 |
 * | `waiting-entitlement` | 这台实例此刻没有资格（没绑定 / 签发方没配 / 不在这台实例上） | 退避重试，订阅到账后用户不必重开应用 |
 * | `retrying` | 上一跳没落地（票据被自己实例判过期/已用、网络失败、响应形状不对） | 退避重试 |
 * | `error` | 请求本身写错了（作用域不符、绑定冲突、寿命越界…） | **停掉**：把 bug 说成订阅问题是说谎，对着签发器猛敲是二次伤害 |
 */
export type AutomationSessionState =
  | { readonly kind: 'active'; readonly expiresAt: number }
  | { readonly kind: 'waiting-entitlement'; readonly code: string }
  | { readonly kind: 'retrying'; readonly code: string }
  | { readonly kind: 'error'; readonly code: string };

export interface AutomationSessionKeepalive {
  /** 单飞：并发调用共用同一次往返、同一个结果。 */
  refresh(): Promise<AutomationSessionState>;
  /** 停定时器，并让**在途**那一次的结果落地时既不写状态也不排下一次。 */
  stop(): void;
  current(): AutomationSessionState | undefined;
}

/** 一次续期的失败：稳定码 + 是否属于等待族。消息里没有票据正文。 */
class AutomationSessionError extends Error {
  constructor(readonly code: string, readonly waiting: boolean) {
    super(`Automation session ticket denied: ${code}`);
  }
}

/**
 * 向**签发实例**要一枚 `session` 票据。
 *
 * 它与 `createAutomationTicketSource` 是两条通道而不是重复：那条只认逐次放行的动作，
 * 把 `session` 混进去等于一次登录换到一张通用通行证（`entitlement-contract.ts` 里那句
 * `Exclude<…, 'session'>` 就是为此）。`session` 的 claims 三个绑定字段全部来自服务端
 * 的绑定行，请求体一个字都不参与。
 */
export async function requestAutomationSessionTicket(options: {
  issuerBaseUrl: string;
  token: string | (() => string);
  installationId: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<{ readonly ticket: string; readonly expiresAt: number }> {
  if (!UUID.test(options.installationId)) throw new AutomationSessionError('INVALID_INSTALLATION_ID', false);
  const now = options.now ?? (() => Date.now());
  const token = typeof options.token === 'function' ? options.token() : options.token;
  const response = await (options.fetchImpl ?? globalThis.fetch)(
    new URL('/api/automation/entitlement/session', options.issuerBaseUrl), {
      method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}`, ...jsonHeaders },
      body: JSON.stringify({ installationId: options.installationId }),
    },
  );
  if (!response.ok) {
    const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
    const code = typeof raw.code === 'string' ? raw.code : `HTTP_${response.status}`;
    throw new AutomationSessionError(code, isAutomationEntitlementWaitingDenial(code));
  }
  const raw = await response.json() as Record<string, unknown>;
  if (typeof raw.ticket !== 'string' || raw.ticket.length === 0 ||
      typeof raw.expiresAt !== 'string' || Number.isNaN(Date.parse(raw.expiresAt))) {
    throw new AutomationSessionError('MALFORMED_SESSION_TICKET', false);
  }
  const expiresAt = Date.parse(raw.expiresAt);
  // 寿命越界 = 签发侧给的窗口比契约承诺的还宽（或已经过期）。照单收下会让下面的排期按一个
  // 没人认过的数字跑，所以判成缺陷并**不**续期。
  const lifetime = expiresAt - now();
  if (lifetime <= 0 || lifetime > AUTOMATION_ENTITLEMENT_MAX_TICKET_LIFETIME_MS) {
    throw new AutomationSessionError('TICKET_LIFETIME_OUT_OF_BOUNDS', false);
  }
  return { ticket: raw.ticket, expiresAt };
}

/**
 * 让 `session` 绑定**一直活着**的那条心跳。
 *
 * ## 它兑现的是哪句话
 *
 * 公网接收那一档读的是客户实例里的绑定行（`isAutomationEntitlementBindingUsable`），
 * 而绑定行只在 `session` 票据被消费时写；签发窗口 ≤30 秒。宿主不续期 ⇒ 一次收信之后最多
 * 30 秒，公网接收就静默变成"这台实例没有权益"。本文件之前
 * `verifyAutomationEntitlementTicket` 有实现、有测试，而**一个消费者都没有** ——
 * 这一格补的就是那个消费者。
 *
 * ## 排期看服务端的答复，不看墙上时钟
 *
 * 下一次 = `expiresAt - 剩余寿命 / 3`（夹到 ≥1 秒，防一个极小窗口把心跳变成热循环）。
 * 用 `1/3` 这个比例而不是某个"我以为够"的毫秒数，因为它直接说出含义：**一个窗口里最多还
 * 容得下两次失败续期**。取绑定自己的到期时刻而不是硬编码 30 秒，与计量那层"周期边界已在
 * 库里，不要在服务端猜"是同一条理由 —— 签发侧哪天调窗口，这里跟着它的答复走。
 *
 * 退避的档位同样从**这一窗口的寿命**推（`寿命 × 2^(连败-1)`，上限 `30 × 寿命`）。
 * 上限存在的唯一理由是"签发器不可达时别变成热循环"，它不是任何对外承诺的数字。
 */
export function startAutomationSessionKeepalive(options: {
  /** 官方实例：只有它签得出票。 */
  issuerBaseUrl: string;
  /** 客户自己的实例：票据在这一侧被消费、绑定行落在这里。 */
  selfBaseUrl: string;
  token: string | (() => string);
  installationId: string;
  localAccountUuid: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
  onState?: (state: AutomationSessionState) => void;
}): AutomationSessionKeepalive {
  if (!UUID.test(options.installationId)) throw new AutomationSessionError('INVALID_INSTALLATION_ID', false);
  if (!UUID.test(options.localAccountUuid)) throw new AutomationSessionError('INVALID_LOCAL_ACCOUNT_UUID', false);
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimeoutImpl ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer = options.clearTimeoutImpl ?? ((handle: unknown): void => { clearTimeout(handle as ReturnType<typeof setTimeout>); });
  const report = (state: AutomationSessionState): void => {
    // 回调里抛错不许把心跳变成未处理的 rejection。
    try { options.onState?.(state); } catch { /* 界面侧的错与续期本身分开 */ }
  };
  const currentToken = (): string => typeof options.token === 'function' ? options.token() : options.token;

  let stopped = false;
  let state: AutomationSessionState | undefined = undefined;
  let failures = 0;
  let timer: unknown = undefined;
  let inFlight: Promise<AutomationSessionState> | undefined = undefined;
  let inFlightGeneration = 0;
  // 在途那一次出发时的世代号。`stop()` 只加它、不等它；晚回来的结果读到不同的号就整块丢弃，
  // 于是"停了心跳却被一次迟到的续期复活"这一类不可能发生。
  let generation = 0;

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    if (timer !== undefined) clearTimer(timer);
    timer = setTimer(() => {
      timer = undefined;
      void refresh().catch(() => undefined);
    }, Math.max(1, Math.floor(delayMs)));
  };

  const backoffMs = (): number => Math.min(
    30 * AUTOMATION_ENTITLEMENT_MAX_TICKET_LIFETIME_MS,
    AUTOMATION_ENTITLEMENT_MAX_TICKET_LIFETIME_MS * 2 ** (failures - 1),
  );

  const doRefresh = async (): Promise<AutomationSessionState> => {
    const myGeneration = generation;
    const alive = (): boolean => !stopped && myGeneration === generation;
    const settle = (next: AutomationSessionState): AutomationSessionState => {
      // 🔴 已经 stop() 或已经换了世代：这次续期**作废**，既不写状态也不返回一个"看起来成功"的
      // 结果 —— 把它悄悄返回会让调用方以为心跳还活着。稳定码 `STOPPED` 与权益拒绝不是一族。
      if (!alive()) throw new AutomationSessionError('STOPPED', false);
      state = next;
      report(next);
      return next;
    };
    try {
      const minted = await requestAutomationSessionTicket({ issuerBaseUrl: options.issuerBaseUrl,
        token: currentToken(), installationId: options.installationId, fetchImpl: options.fetchImpl, now });
      // 票据只在这一次往返里活着：不写状态、不进日志、失败也不拼进消息。
      let bound: Awaited<ReturnType<typeof verifyAutomationEntitlementTicket>>;
      try {
        bound = await verifyAutomationEntitlementTicket({ baseUrl: options.selfBaseUrl, token: currentToken(),
          ticket: minted.ticket, localAccountUuid: options.localAccountUuid, fetchImpl: options.fetchImpl });
      } catch (error) {
        // 客户实例拒了这枚刚签出来的票。等待族 ⇒ 没资格；其余（多半是这一跳赶在边界之后，
        // 票据被判过期/已用，或传输与形状问题）⇒ 换一枚新票再来，**不**永久停掉心跳。
        const code = error instanceof AutomationEntitlementVerifyError ? error.code : 'VERIFY_TRANSPORT_FAILED';
        failures += 1;
        const waiting = isAutomationEntitlementWaitingDenial(code);
        const result = settle({ kind: waiting ? 'waiting-entitlement' : 'retrying', code });
        if (alive()) schedule(backoffMs());
        return result;
      }
      const expiresAt = Date.parse(bound.expiresAt);
      if (Number.isNaN(expiresAt)) {
        failures += 1;
        const result = settle({ kind: 'retrying', code: 'MALFORMED_BINDING_EXPIRY' });
        if (alive()) schedule(backoffMs());
        return result;
      }
      failures = 0;
      const result = settle({ kind: 'active', expiresAt });
      if (alive()) {
        const remaining = expiresAt - now();
        schedule(remaining > 0 ? remaining - Math.floor(remaining / 3) : 0);
      }
      return result;
    } catch (error) {
      const denial = error instanceof AutomationSessionError ? error : new AutomationSessionError('MINT_TRANSPORT_FAILED', false);
      if (denial.waiting) {
        failures += 1;
        const result = settle({ kind: 'waiting-entitlement', code: denial.code });
        if (alive()) schedule(backoffMs());
        return result;
      }
      // 签发侧说"这个请求本身不对"，或它给的寿命越界：这是缺陷，停住等宿主处理。
      const result = settle({ kind: 'error', code: denial.code });
      if (timer !== undefined) { clearTimer(timer); timer = undefined; }
      return result;
    } finally {
      if (inFlightGeneration === myGeneration) inFlight = undefined;
    }
  };

  const refresh = (): Promise<AutomationSessionState> => {
    if (stopped) return Promise.reject(new AutomationSessionError('STOPPED', false));
    if (inFlight !== undefined && inFlightGeneration === generation) return inFlight;
    inFlightGeneration = generation;
    inFlight = doRefresh();
    return inFlight;
  };

  return {
    refresh,
    stop: () => {
      stopped = true;
      generation += 1;
      inFlight = undefined;
      if (timer !== undefined) { clearTimer(timer); timer = undefined; }
    },
    current: () => state,
  };
}
