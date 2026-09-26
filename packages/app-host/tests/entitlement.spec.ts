/**
 * 权益探测的测试。
 *
 * 🔴 这一组的核心不是"解析对不对"，而是**E2EE 硬约束的机械保障**：
 * 为了判断该不该降级而发出的请求**一个任务字段都不许带**。
 * 这里不看注释，直接抓取真正传进 `fetch` 的 `RequestInit` 来断言。
 *
 * 另一半是 **fail-open**：未配置 / 没令牌 / 断网 / 非权益类响应，
 * 一律不许被解读成"没权益"。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  HOSTED_ENTITLEMENT_PATH,
  fetchHostedEntitlementReading,
  type HostedEntitlementProbeOptions,
} from '../src/entitlement.js';
import { decideHostedSyncAccess } from '@heyta/domain';

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** 造一个记录全部调用的 fetch，并按脚本回响应。 */
function recordingFetch(
  responder: (url: string) => { status: number; body?: unknown; jsonThrows?: boolean },
): { impl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const spec = responder(url);
    return Promise.resolve({
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      json: () =>
        spec.jsonThrows === true
          ? Promise.reject(new Error('not json'))
          : Promise.resolve(spec.body),
    } as unknown as Response);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const base = (over: Partial<HostedEntitlementProbeOptions> = {}): HostedEntitlementProbeOptions => ({
  baseUrl: 'https://sync.example.com',
  getToken: () => Promise.resolve('token-123'),
  ...over,
});

describe('fetchHostedEntitlementReading', () => {
  it('does not even send a request when no server is configured', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200 }));
    const reading = await fetchHostedEntitlementReading(base({ baseUrl: '', fetchImpl: impl }));
    expect(reading).toEqual({ kind: 'unconfigured' });
    expect(calls).toHaveLength(0);
  });

  it('does not send a request when there is no token', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200 }));
    const reading = await fetchHostedEntitlementReading(
      base({ getToken: () => Promise.resolve(undefined), fetchImpl: impl }),
    );
    expect(reading).toEqual({ kind: 'unavailable', cause: 'no-token' });
    expect(calls).toHaveLength(0);
  });

  it('reads a self-hosted server (gate closed) as entitled', async () => {
    const { impl, calls } = recordingFetch(() => ({
      status: 200,
      body: { latestSeq: 42, devicesOnline: 1 },
    }));
    const reading = await fetchHostedEntitlementReading(base({ fetchImpl: impl }));
    expect(reading).toEqual({ kind: 'entitled' });
    expect(calls).toHaveLength(1);
  });

  it('reads the server refusal verbatim', async () => {
    const { impl } = recordingFetch(() => ({
      status: 402,
      body: {
        error: 'A paid subscription is required to use this hosted service.',
        errorCode: 'SUBSCRIPTION_REQUIRED',
        reason: 'PERIOD_ENDED',
      },
    }));
    const reading = await fetchHostedEntitlementReading(base({ fetchImpl: impl }));
    expect(reading).toEqual({ kind: 'denied', reason: 'PERIOD_ENDED' });
  });

  it('fails open on a network failure', async () => {
    const impl = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    const reading = await fetchHostedEntitlementReading(base({ fetchImpl: impl }));
    expect(reading).toEqual({ kind: 'unavailable', cause: 'network' });
    expect(decideHostedSyncAccess(reading, Date.now()).kind).toBe('unrestricted');
  });

  it('fails open on an unexpected status', async () => {
    const { impl } = recordingFetch(() => ({ status: 401 }));
    const reading = await fetchHostedEntitlementReading(base({ fetchImpl: impl }));
    expect(reading).toEqual({ kind: 'unavailable', cause: 'unexpected-response' });
    expect(decideHostedSyncAccess(reading, Date.now()).kind).toBe('unrestricted');
  });

  it('keeps the status code when the body is not JSON', async () => {
    const { impl } = recordingFetch(() => ({ status: 402, jsonThrows: true }));
    const reading = await fetchHostedEntitlementReading(base({ fetchImpl: impl }));
    expect(reading).toEqual({ kind: 'unavailable', cause: 'unexpected-response' });
  });

  it('normalises a trailing slash on the root URL', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200 }));
    await fetchHostedEntitlementReading(
      base({ baseUrl: 'https://sync.example.com/', fetchImpl: impl }),
    );
    expect(calls[0]?.url).toBe(`https://sync.example.com${HOSTED_ENTITLEMENT_PATH}`);
  });
});

describe('🔴 E2EE: the entitlement probe carries zero task content', () => {
  /**
   * 这条测试要挡的是一个很自然的错误实现：把权益判断挂到**同步上传**上
   * （"反正同步的时候服务端会回 402"）。那样一来，用户每次打开设置页
   * 都会把自己的任务加密后发一遍 —— 这才是禁止的事。
   */
  it('issues a body-less GET that never touches the ops endpoint', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200 }));
    await fetchHostedEntitlementReading(base({ fetchImpl: impl }));

    expect(calls).toHaveLength(1);
    const call = calls[0]!;

    // ① 方法必须是 GET。
    expect(call.init?.method).toBe('GET');
    // ② 不能有 body —— 连空对象都不行，"有 body"这件事本身就说明它在上传。
    expect(call.init?.body).toBeUndefined();
    // ③ 不能声明 content-type：那意味着有载荷。
    const headers = (call.init?.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('content-type');
    // ④ 不许打到同步载荷端点。
    expect(call.url).not.toContain('/ops');
    // ⑤ 抓取到的整个请求描述里不含任何任务/op 形状的字段。
    const serialized = JSON.stringify({
      url: call.url,
      method: call.init?.method,
      headers,
      body: call.init?.body ?? null,
    });
    for (const forbidden of [
      'entityType',
      'entityId',
      'payload',
      '"ops"',
      'vectorClock',
      'task',
      'title',
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('the probe module never imports a task/op-log module', () => {
    // 类型/依赖层面的第二道锁：这个文件只依赖 @heyta/domain 的权益纯函数。
    const source = readFileSync(new URL('../src/entitlement.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+'@heyta\/(op-log|storage|sync-core)'/);
    expect(source).not.toMatch(/getLocalOps|markUploaded|applyRemote/);
  });
});

describe('probe + decision, end to end (no task content)', () => {
  it('a 402 from the status endpoint restricts; a 200 does not', async () => {
    const restricted = recordingFetch(() => ({
      status: 402,
      body: { errorCode: 'SUBSCRIPTION_REQUIRED', reason: 'PERIOD_ENDED' },
    }));
    const allowed = recordingFetch(() => ({ status: 200 }));

    const now = 1_700_000_000_000;
    const deniedReading = await fetchHostedEntitlementReading(
      base({ fetchImpl: restricted.impl }),
    );
    const allowedReading = await fetchHostedEntitlementReading(base({ fetchImpl: allowed.impl }));

    expect(decideHostedSyncAccess(deniedReading, now)).toEqual({
      kind: 'restricted',
      reason: 'PERIOD_ENDED',
      expired: true,
    });
    expect(decideHostedSyncAccess(allowedReading, now)).toEqual({
      kind: 'unrestricted',
      because: 'entitled',
    });
  });
});
