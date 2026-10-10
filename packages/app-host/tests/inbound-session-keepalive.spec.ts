import { describe, expect, it } from 'vitest';
import { requestAutomationSessionTicket, startAutomationSessionKeepalive, type AutomationSessionState } from '../src/inbound-session-keepalive.js';

const ISSUER = 'https://official.test';
const SELF = 'https://my-instance.test';
const installation = '11111111-1111-4111-8111-111111111111';
const account = '22222222-2222-4222-8222-222222222222';
/** 哨兵：断言它不出现在任何宿主可见的东西里。 */
const TICKET = 'opaque-session-ticket-do-not-log';
const NOW = 1_760_000_000_000;

type Call = { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } };

const json = (body: unknown, ok = true, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' }, ...(ok ? {} : {}) });

/** 一条正常往返：签发实例给票，客户实例把绑定续到 `expiresAt`。 */
const happyFetch = (calls: Call[], bindingExpiresAt = NOW + 30_000) =>
  async (input: URL | string, init?: Call['init']): Promise<Response> => {
    calls.push({ url: String(input), init });
    return new URL(String(input)).pathname.endsWith('/session')
      ? json({ ticket: TICKET, expiresAt: new Date(NOW + 30_000).toISOString() })
      : json({ state: 'active', expiresAt: new Date(bindingExpiresAt).toISOString() });
  };

const started = (options: Partial<Parameters<typeof startAutomationSessionKeepalive>[0]> = {}) => {
  const calls: Call[] = [];
  const states: AutomationSessionState[] = [];
  const scheduled: Array<{ fn: () => void; ms: number }> = [];
  const keepalive = startAutomationSessionKeepalive({
    issuerBaseUrl: ISSUER, selfBaseUrl: SELF, token: 'jwt', installationId: installation, localAccountUuid: account,
    fetchImpl: happyFetch(calls) as unknown as typeof fetch, now: () => NOW,
    setTimeoutImpl: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; },
    clearTimeoutImpl: () => undefined,
    onState: (state) => states.push(state),
    ...options,
  });
  return { calls, states, scheduled, keepalive };
};

describe('automation session keepalive', () => {
  it('先向签发实例取票、再在自己的实例上消费，两跳的路径与顺序逐字固定', async () => {
    const run = started();
    await run.keepalive.refresh();
    expect(run.calls.map((call) => `${new URL(call.url).origin}${new URL(call.url).pathname}`))
      .toEqual([`${ISSUER}/api/automation/entitlement/session`, `${SELF}/api/automation/entitlement/verify`]);
    const body = JSON.parse(run.calls[1]!.init!.body!) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['localAccountUuid', 'ticket']);
    expect(run.keepalive.current()).toEqual({ kind: 'active', expiresAt: NOW + 30_000 });
  });

  it('下一次排在服务端报的到期时刻之前，比例是剩余寿命的三分之一', async () => {
    const run = started();
    await run.keepalive.refresh();
    // 剩余 30 s ⇒ 30 - 10 = 20 s。排期读的是**响应里的**到期时刻，不是硬编码的 30 s。
    expect(run.scheduled.map((entry) => entry.ms)).toEqual([20_000]);
    // 签发侧把窗口调短 ⇒ 排期跟着走，不需要有人记得改常量。
    const short = started({ fetchImpl: happyFetch([], NOW + 12_000) as unknown as typeof fetch });
    await short.keepalive.refresh();
    expect(short.scheduled.map((entry) => entry.ms)).toEqual([8_000]);
  });

  it('并发续期只发一次网络往返，两路拿到同一个结果', async () => {
    const run = started();
    const [a, b] = await Promise.all([run.keepalive.refresh(), run.keepalive.refresh()]);
    expect(run.calls).toHaveLength(2);
    expect(a).toEqual(b);
  });

  it('定时器真到点会再走一跳，且 token 每次重读（换令牌之后不会拿旧的敲）', async () => {
    const calls: Call[] = [];
    let token = 'jwt-1';
    const run = started({ fetchImpl: happyFetch(calls) as unknown as typeof fetch, token: () => token });
    await run.keepalive.refresh();
    token = 'jwt-2';
    run.scheduled[0]!.fn();
    // 定时器回调里那条链是 fire-and-forget：排一个宏任务把它的全部微任务抽干。
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(calls).toHaveLength(4);
    const authorization = calls.slice(2).map((call) => call.init?.headers?.authorization);
    expect(authorization).toEqual(['Bearer jwt-2', 'Bearer jwt-2']);
    expect(run.states).toHaveLength(2);
  });

  it('等待族（没绑定 / 签发方没配 / 不在这台实例上）报 waiting-entitlement 并按退避继续', async () => {
    for (const code of ['AUTOMATION_LINK_NOT_BOUND', 'AUTOMATION_ISSUER_NOT_CONFIGURED', 'AUTOMATION_ISSUER_NOT_ON_THIS_INSTANCE']) {
      const calls: Call[] = [];
      const states: AutomationSessionState[] = [];
      const scheduled: number[] = [];
      const keepalive = startAutomationSessionKeepalive({
        issuerBaseUrl: ISSUER, selfBaseUrl: SELF, token: 'jwt', installationId: installation, localAccountUuid: account,
        fetchImpl: (async () => new Response(JSON.stringify({ code, message: code }), { status: 403 })) as unknown as typeof fetch,
        now: () => NOW, setTimeoutImpl: (_fn, ms) => { scheduled.push(ms); return scheduled.length; },
        clearTimeoutImpl: () => undefined, onState: (state) => states.push(state),
      });
      await keepalive.refresh();
      expect(states).toEqual([{ kind: 'waiting-entitlement', code }]);
      expect(scheduled).toEqual([30_000]);
      // 连败第二跳的退避必须比第一跳长（否则签发器不可达时就成了热循环）。
      await keepalive.refresh();
      expect(scheduled).toEqual([30_000, 60_000]);
    }
  });

  it('消费被自己实例拒但属等待族时同样报 waiting-entitlement', async () => {
    const states: AutomationSessionState[] = [];
    const scheduled: number[] = [];
    const keepalive = startAutomationSessionKeepalive({
      issuerBaseUrl: ISSUER, selfBaseUrl: SELF, token: 'jwt', installationId: installation, localAccountUuid: account,
      fetchImpl: (async (input: URL | string) => new URL(String(input)).pathname.endsWith('/session')
        ? new Response(JSON.stringify({ ticket: TICKET, expiresAt: new Date(NOW + 30_000).toISOString() }), { status: 200 })
        : new Response(JSON.stringify({ code: 'AUTOMATION_ISSUER_NOT_CONFIGURED', message: 'x' }), { status: 403 })) as unknown as typeof fetch,
      now: () => NOW, setTimeoutImpl: (_fn, ms) => { scheduled.push(ms); return 1; }, clearTimeoutImpl: () => undefined,
      onState: (state) => states.push(state),
    });
    await keepalive.refresh();
    expect(states).toEqual([{ kind: 'waiting-entitlement', code: 'AUTOMATION_ISSUER_NOT_CONFIGURED' }]);
  });

  it('票据被自己的实例判过期/已用时报 retrying 而不是永久停住', async () => {
    let verifyRejected = false;
    const scheduled: number[] = [];
    const states: AutomationSessionState[] = [];
    const keepalive = startAutomationSessionKeepalive({
      issuerBaseUrl: ISSUER, selfBaseUrl: SELF, token: 'jwt', installationId: installation, localAccountUuid: account,
      fetchImpl: (async (input: URL | string) => {
        if (new URL(String(input)).pathname.endsWith('/session')) {
          return new Response(JSON.stringify({ ticket: TICKET, expiresAt: new Date(NOW + 30_000).toISOString() }), { status: 200 });
        }
        verifyRejected = true;
        return new Response(JSON.stringify({ code: 'AUTOMATION_TICKET_EXPIRED', message: 'x' }), { status: 403 });
      }) as unknown as typeof fetch,
      now: () => NOW, setTimeoutImpl: (_fn, ms) => { scheduled.push(ms); return 1; }, clearTimeoutImpl: () => undefined,
      onState: (state) => states.push(state),
    });
    await keepalive.refresh();
    expect(verifyRejected).toBe(true);
    expect(states).toEqual([{ kind: 'retrying', code: 'AUTOMATION_TICKET_EXPIRED' }]);
    // 关键区别：还排了下一次。把这一族当缺陷停掉 ⇒ 一次网络抖动就永久失去公网接收。
    expect(scheduled).toEqual([30_000]);
  });

  it('签发侧的非等待族拒绝是缺陷：报 error 且不再排下一次', async () => {
    const scheduled: number[] = [];
    const states: AutomationSessionState[] = [];
    const keepalive = startAutomationSessionKeepalive({
      issuerBaseUrl: ISSUER, selfBaseUrl: SELF, token: 'jwt', installationId: installation, localAccountUuid: account,
      fetchImpl: (async () => new Response(JSON.stringify({ code: 'AUTOMATION_ISSUER_SCOPE_MISMATCH', message: 'x' }), { status: 403 })) as unknown as typeof fetch,
      now: () => NOW, setTimeoutImpl: (_fn, ms) => { scheduled.push(ms); return 1; }, clearTimeoutImpl: () => undefined,
      onState: (state) => states.push(state),
    });
    await keepalive.refresh();
    expect(states).toEqual([{ kind: 'error', code: 'AUTOMATION_ISSUER_SCOPE_MISMATCH' }]);
    expect(scheduled).toEqual([]);
  });

  it('票据正文不出现在状态、错误消息与宿主可见的序列化里', async () => {
    const run = started();
    await run.keepalive.refresh();
    const serialized = JSON.stringify({ state: run.keepalive.current(), states: run.states });
    expect(serialized.includes(TICKET)).toBe(false);
    // 也不许被拼进请求之外的地方：只有 verify 那一跳的 body 里该有它。
    const withTicket = run.calls.filter((call) => (call.init?.body ?? '').includes(TICKET));
    expect(withTicket.map((call) => new URL(call.url).pathname)).toEqual(['/api/automation/entitlement/verify']);
  });

  it('stop() 之后在途那次落地既不写状态也不复活定时器', async () => {
    let resolveMint: ((value: Response) => void) | undefined;
    const calls: Call[] = [];
    const scheduled: number[] = [];
    const states: AutomationSessionState[] = [];
    const keepalive = startAutomationSessionKeepalive({
      issuerBaseUrl: ISSUER, selfBaseUrl: SELF, token: 'jwt', installationId: installation, localAccountUuid: account,
      fetchImpl: (async (input: URL | string, init?: Call['init']) => {
        calls.push({ url: String(input), init });
        if (new URL(String(input)).pathname.endsWith('/session')) {
          return new Promise<Response>((resolve) => { resolveMint = resolve; });
        }
        return new Response(JSON.stringify({ state: 'active', expiresAt: new Date(NOW + 30_000).toISOString() }), { status: 200 });
      }) as unknown as typeof fetch,
      now: () => NOW, setTimeoutImpl: (_fn, ms) => { scheduled.push(ms); return 1; }, clearTimeoutImpl: () => undefined,
      onState: (state) => states.push(state),
    });
    const inFlight = keepalive.refresh();
    keepalive.stop();
    resolveMint!(new Response(JSON.stringify({ ticket: TICKET, expiresAt: new Date(NOW + 30_000).toISOString() }), { status: 200 }));
    await expect(inFlight).rejects.toThrow('STOPPED');
    expect(states).toEqual([]);
    expect(scheduled).toEqual([]);
    expect(keepalive.current()).toBeUndefined();
    await expect(keepalive.refresh()).rejects.toThrow('STOPPED');
  });

  it('寿命越界的响应按缺陷拒绝，不照单收下再排一个没人认过的窗口', async () => {
    const states: AutomationSessionState[] = [];
    const scheduled: number[] = [];
    const keepalive = startAutomationSessionKeepalive({
      issuerBaseUrl: ISSUER, selfBaseUrl: SELF, token: 'jwt', installationId: installation, localAccountUuid: account,
      fetchImpl: (async () => new Response(JSON.stringify({ ticket: TICKET, expiresAt: new Date(NOW + 31_000).toISOString() }), { status: 200 })) as unknown as typeof fetch,
      now: () => NOW, setTimeoutImpl: (_fn, ms) => { scheduled.push(ms); return 1; }, clearTimeoutImpl: () => undefined,
      onState: (state) => states.push(state),
    });
    await keepalive.refresh();
    expect(states).toEqual([{ kind: 'error', code: 'TICKET_LIFETIME_OUT_OF_BOUNDS' }]);
    expect(scheduled).toEqual([]);
  });

  it('身份不合法时一步都不发（错 installationId 不能变成一次注定被拒的往返）', async () => {
    const calls: Call[] = [];
    // 判在**起心跳**那一刻，而不是等第一跳打到签发器才发现 —— 宿主接线写错要当场响。
    expect(() => startAutomationSessionKeepalive({
      issuerBaseUrl: ISSUER, selfBaseUrl: SELF, token: 'jwt', installationId: 'not-a-uuid', localAccountUuid: account,
      fetchImpl: (async (input: URL | string) => { calls.push({ url: String(input) }); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch,
      now: () => NOW,
    })).toThrow('INVALID_INSTALLATION_ID');
    expect(calls).toEqual([]);
    expect(() => startAutomationSessionKeepalive({
      issuerBaseUrl: ISSUER, selfBaseUrl: SELF, token: 'jwt', installationId: installation, localAccountUuid: 'not-a-uuid',
      fetchImpl: (async (input: URL | string) => { calls.push({ url: String(input) }); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch,
      now: () => NOW,
    })).toThrow('INVALID_LOCAL_ACCOUNT_UUID');
    expect(calls).toEqual([]);
    await expect(requestAutomationSessionTicket({ issuerBaseUrl: ISSUER, token: 'jwt', installationId: 'nope' }))
      .rejects.toThrow('INVALID_INSTALLATION_ID');
  });
});
