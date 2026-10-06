/**
 * 批次 E3 —— 注销账号的客户端调用点，以及那条不可反的顺序
 * =======================================================
 *
 * 全部判据用**注入的 fetch**，没有 mock `closeAccount` 本身：
 * 这里要证的恰恰是"协议结论 → 要不要清本机"这一段接线，把它 mock 掉就什么都没测。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeAccount } from '../src/hosted-auth.js';
import { closeAccountAndEraseLocal } from '../src/account-closure.js';
import { registerLocalEraser } from '../src/local-erasure.js';

const BASE = 'https://sync.test';
const TOKEN = 'bearer-token';

type Call = { method: string; url: string; auth: string | undefined };

function harness(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      method: String(init?.method ?? 'GET'),
      url: String(input),
      auth: (init?.headers as Record<string, string> | undefined)?.['authorization'],
    };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { calls, options: { baseUrl: BASE, fetchImpl } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// 🔴 `Response` 的 body 是**一次性**的：共享一个实例时，第二个用例读到的就是
// 已经消费过的流（`json()` 抛 ⇒ 响应形状不对 ⇒ 判成失败），症状长得像产品坏了。
// 所以这里给的是**工厂**，每次新建一个 Response。
const ok = () => json({ success: true });

/** 销毁器 + 调用序列：顺序判据读 `order`，不读时间戳。 */
function eraser(order: string[], label = 'erase') {
  return vi.fn(async () => {
    order.push(label);
    return [{ target: 'x', containerRemoved: true, storesCleared: 1 }];
  });
}

let order: string[];
let previousEraser: ReturnType<typeof registerLocalEraser>;

beforeEach(() => {
  order = [];
});

afterEach(() => {
  registerLocalEraser(previousEraser);
  vi.restoreAllMocks();
});

describe('closeAccount —— 协议本身', () => {
  it('DELETE /api/account，带 Bearer，且**只**带令牌', async () => {
    const { calls, options } = harness(ok);
    const result = await closeAccount(options, TOKEN);

    expect(result).toEqual({ ok: true, closed: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.url).toBe(`${BASE}/api/account`);
    expect(calls[0]!.auth).toBe(`Bearer ${TOKEN}`);
  });

  it('没配服务端地址 ⇒ **一个请求都不发**', async () => {
    const { calls, options } = harness(ok);
    const result = await closeAccount({ ...options, baseUrl: '   ' }, TOKEN);
    expect(calls).toHaveLength(0);
    if (result.ok) throw new Error('不该成功');
    expect(result.reason).toBe('unconfigured');
  });

  it('空令牌 ⇒ 不发请求（注销不许匿名打到服务端）', async () => {
    const { calls, options } = harness(ok);
    const result = await closeAccount(options, '   ');
    expect(calls).toHaveLength(0);
    if (result.ok) throw new Error('不该成功');
    expect(result.reason).toBe('unauthorized');
  });

  it('🔴 2xx 但响应不是 `{success:true}` ⇒ 不算成功', async () => {
    // 注销是唯一一个下游不可逆的调用：形状不对就宁可让用户重试一次，
    // 也不能拿着"可能其实没删"的结论去清本机。
    for (const body of [{}, { success: false }, null, 'ok']) {
      const { options } = harness(() => json(body));
      const result = await closeAccount(options, TOKEN);
      if (result.ok) throw new Error(`${JSON.stringify(body)} 被判成成功`);
      expect(result.reason, JSON.stringify(body)).toBe('malformed-response');
    }
  });
});

describe('closeAccountAndEraseLocal —— 🔴 顺序是这一组的全部', () => {
  it('服务端删成 ⇒ 才清本机，且**在这之后**', async () => {
    const { options } = harness(() => {
      order.push('delete');
      return ok();
    });
    previousEraser = registerLocalEraser(eraser(order));

    const result = await closeAccountAndEraseLocal(options, TOKEN);

    expect(result.disposition).toBe('closed-and-erased');
    expect(result.reports).toHaveLength(1);
    // 判据读的是序列里两个动作的**相对位置**，不是"看起来都跑了"。
    expect(order).toEqual(['delete', 'erase']);
  });

  it.each([
    ['5xx', () => json({ error: 'boom' }, 503), 'server-error'],
    ['401', () => json({ error: 'Token revoked', code: 'TOKEN_REVOKED' }, 401), 'unauthorized'],
    ['429', () => json({ error: 'too many' }, 429), 'rate-limited'],
    ['断网', () => { throw new TypeError('Failed to fetch'); }, 'network'],
    ['2xx 但形状不对', () => json({ success: false }), 'malformed-response'],
  ] as const)('🔴 服务端那一步没成（%s）⇒ 销毁器**一次都不许调用**', async (_label, respond, reason) => {
    const { options } = harness(respond);
    const spy = eraser(order);
    previousEraser = registerLocalEraser(spy);

    const result = await closeAccountAndEraseLocal(options, TOKEN);

    expect(result.disposition).toBe('not-closed');
    expect(result.failure).toBe(reason);
    // 这一句是整批工单里最贵的一条：反过来就是"账号还在、本机先没了"。
    expect(spy, `${reason} 之后仍然清了本机`).not.toHaveBeenCalled();
    expect(result.reports, '没跑销毁就不该有凭据（空数组也算说了谎）').toBeUndefined();
  });

  it('账号删了、销毁器抛错 ⇒ closed-erase-failed，且原因带出去', async () => {
    const { options } = harness(ok);
    previousEraser = registerLocalEraser(undefined);
    registerLocalEraser(async () => {
      throw new Error('OPFS 被别的标签页占着');
    });

    const result = await closeAccountAndEraseLocal(options, TOKEN);
    expect(result.disposition).toBe('closed-erase-failed');
    expect(result.erasureError).toContain('OPFS');
  });

  it('宿主没注册销毁器 ⇒ 也是 closed-erase-failed（不许静默"已清除"）', async () => {
    const { options } = harness(ok);
    previousEraser = registerLocalEraser(undefined);

    const result = await closeAccountAndEraseLocal(options, TOKEN);
    expect(result.disposition).toBe('closed-erase-failed');
    expect(result.erasureError).toContain('明文仍在');
  });

  it('某一类没清掉 ⇒ closed-erase-partial，与"全清"、"全没清"三者可分', async () => {
    const { options } = harness(ok);
    previousEraser = registerLocalEraser(async () => {
      order.push('erase');
      return [
        { target: 'IndexedDB:heyta', containerRemoved: true, storesCleared: 4 },
        { target: 'opfs:.heyta-web', containerRemoved: false, reason: '没有 getDirectory', storesCleared: 0 },
      ];
    });

    const result = await closeAccountAndEraseLocal(options, TOKEN);
    expect(result.disposition).toBe('closed-erase-partial');
    expect(result.reports).toHaveLength(2);
    expect(result.reports!.filter((r) => !r.containerRemoved).map((r) => r.target)).toEqual([
      'opfs:.heyta-web',
    ]);
  });

  it('四种结局两两不同名（界面必须能说对句子）', () => {
    expect(new Set(['closed-and-erased', 'closed-erase-failed', 'closed-erase-partial', 'not-closed']).size).toBe(4);
  });
});
