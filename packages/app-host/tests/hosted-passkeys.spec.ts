/**
 * 自助管理通行密钥（列 / 删）的客户端契约，以及缺口 B 的判别信号。
 *
 * 🔴 与 `hosted-auth.spec.ts` 同一套判据：钉住**路径 / 方法 / 凭据怎么带 /
 * 响应怎么验 / 失败怎么归类**，以及 fail-safe（未配置不发请求、
 * 2xx 但形状不对**绝不当成功**）。
 *
 * 负向路径是重点：
 *   - 空令牌 → `unauthorized` 且**一个请求都不发**；
 *   - 服务端多返回 `publicKey` / `credentialId` 时，客户端**不把它们带出去**；
 *   - 404（不是自己的）与 409（最后一条）各自有**不同**的原因；
 *   - 缺口 B 的 401 `passkey_not_found` 不再是笼统的 `unauthorized`。
 *
 * ⚠️ 全程零联网：`fetch` 一律注入。
 */
import { describe, expect, it } from 'vitest';

import {
  HOSTED_AUTH_PATHS,
  beginPasskeyEnrollment,
  completePasskeyEnrollment,
  completePasskeyLogin,
  deletePasskey,
  listPasskeys,
  passkeyDeletePath,
  type HostedAuthOptions,
} from '../src/hosted-auth.js';

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly body: unknown;
}

function recordingFetch(responder: (url: string) => { status: number; body?: unknown }) {
  const calls: RecordedCall[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, init, body: rawBody === undefined ? undefined : JSON.parse(rawBody) });
    const spec = responder(url);
    return Promise.resolve({
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      json: () => Promise.resolve(spec.body),
    } as unknown as Response);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const opts = (over: Partial<HostedAuthOptions> = {}): HostedAuthOptions => ({
  baseUrl: 'https://sync.example.com',
  ...over,
});

const headerOf = (init: RequestInit | undefined): Record<string, string> =>
  (init?.headers ?? {}) as Record<string, string>;

describe('listPasskeys 契约', () => {
  it('GET /api/passkeys，带上 bearer 令牌，不带请求体', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200, body: { passkeys: [] } }));

    const outcome = await listPasskeys(opts({ fetchImpl: impl }), ' jwt-123 ');

    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://sync.example.com${HOSTED_AUTH_PATHS.passkeys}`);
    expect(calls[0]!.init?.method).toBe('GET');
    // 🔴 令牌只从参数来，归一空白后放进 Authorization（服务端发的是 Bearer，不是 cookie）。
    expect(headerOf(calls[0]!.init)['authorization']).toBe('Bearer jwt-123');
    expect(calls[0]!.init?.body).toBeUndefined();
  });

  it('解析出白名单字段，服务端多给的字段一个都不留', async () => {
    const { impl } = recordingFetch(() => ({
      status: 200,
      body: {
        passkeys: [
          {
            id: 'pk_row_1',
            createdAt: '2026-01-02T03:04:05.000Z',
            lastUsedAt: null,
            // 服务端**不该**返回这些；就算返回了，客户端也不许带出去。
            credentialId: 'BASE64URLSECRET',
            publicKey: 'PUBLICKEYBYTES',
            counter: 7,
          },
        ],
      },
    }));

    const outcome = await listPasskeys(opts({ fetchImpl: impl }), 'tok');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.passkeys).toEqual([
      { id: 'pk_row_1', createdAt: '2026-01-02T03:04:05.000Z', lastUsedAt: null },
    ]);
    expect(Object.keys(outcome.passkeys[0]!).sort()).toEqual(['createdAt', 'id', 'lastUsedAt']);
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('publicKey');
    expect(serialized).not.toContain('credentialId');
    expect(serialized).not.toContain('BASE64URLSECRET');
  });

  it('空令牌 → unauthorized，且一个请求都不发', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200, body: { passkeys: [] } }));

    const outcome = await listPasskeys(opts({ fetchImpl: impl }), '   ');

    expect(outcome).toEqual({ ok: false, reason: 'unauthorized' });
    expect(calls).toHaveLength(0);
  });

  it('未配置地址 → unconfigured，且一个请求都不发', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200, body: { passkeys: [] } }));

    const outcome = await listPasskeys(opts({ baseUrl: '', fetchImpl: impl }), 'tok');

    expect(outcome).toEqual({ ok: false, reason: 'unconfigured' });
    expect(calls).toHaveLength(0);
  });

  it('401 → unauthorized', async () => {
    const { impl } = recordingFetch(() => ({
      status: 401,
      body: { error: 'Missing or invalid Authorization header' },
    }));

    const outcome = await listPasskeys(opts({ fetchImpl: impl }), 'tok');

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('unauthorized');
      expect(outcome.status).toBe(401);
    }
  });

  it('🔴 200 但没有 passkeys 数组 → malformed-response（不是"没有凭据"）', async () => {
    const missing = recordingFetch(() => ({ status: 200, body: { items: [] } }));
    const asObject = recordingFetch(() => ({ status: 200, body: { passkeys: {} } }));

    const a = await listPasskeys(opts({ fetchImpl: missing.impl }), 'tok');
    const b = await listPasskeys(opts({ fetchImpl: asObject.impl }), 'tok');

    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe('malformed-response');
    if (!b.ok) expect(b.reason).toBe('malformed-response');
  });

  it('缺 id / createdAt / lastUsedAt 形状不对 → malformed-response', async () => {
    const { impl } = recordingFetch(() => ({
      status: 200,
      body: { passkeys: [{ id: 'pk', createdAt: '2026-01-02T03:04:05.000Z' }] },
    }));

    const outcome = await listPasskeys(opts({ fetchImpl: impl }), 'tok');

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('malformed-response');
  });
});

describe('deletePasskey 契约', () => {
  it('DELETE /api/passkeys/:id，带 bearer 令牌，不带请求体', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200, body: { success: true } }));

    const outcome = await deletePasskey(opts({ fetchImpl: impl }), { token: 'tok', id: 'pk_row_1' });

    expect(outcome).toEqual({ ok: true, deleted: true });
    expect(calls[0]!.url).toBe(
      `https://sync.example.com${HOSTED_AUTH_PATHS.passkeys}/pk_row_1`,
    );
    expect(calls[0]!.init?.method).toBe('DELETE');
    expect(headerOf(calls[0]!.init)['authorization']).toBe('Bearer tok');
    expect(calls[0]!.init?.body).toBeUndefined();
  });

  it('id 进路径前会转义（协议在 app-host 里只有一份）', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200, body: { success: true } }));

    await deletePasskey(opts({ fetchImpl: impl }), { token: 'tok', id: 'a/b?c' });

    expect(calls[0]!.url).toBe(`https://sync.example.com${passkeyDeletePath('a/b?c')}`);
    expect(calls[0]!.url).toContain('a%2Fb%3Fc');
  });

  it('🔴 404 + passkey_not_found_for_user → passkey-not-found（不是笼统的 request-rejected）', async () => {
    const { impl } = recordingFetch(() => ({
      status: 404,
      body: { error: 'Passkey not found', code: 'passkey_not_found_for_user' },
    }));

    const outcome = await deletePasskey(opts({ fetchImpl: impl }), { token: 'tok', id: 'x' });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('passkey-not-found');
      expect(outcome.status).toBe(404);
      expect(outcome.code).toBe('passkey_not_found_for_user');
    }
  });

  it('🔴 409 + last_passkey_required → last-passkey（不是 server-error / request-rejected）', async () => {
    const { impl } = recordingFetch(() => ({
      status: 409,
      body: { error: 'This is your only passkey, so it cannot be removed.', code: 'last_passkey_required' },
    }));

    const outcome = await deletePasskey(opts({ fetchImpl: impl }), { token: 'tok', id: 'x' });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('last-passkey');
      expect(outcome.status).toBe(409);
      expect(outcome.code).toBe('last_passkey_required');
    }
  });

  it('空令牌 / 空 id → 不发请求', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200, body: { success: true } }));

    const noToken = await deletePasskey(opts({ fetchImpl: impl }), { token: ' ', id: 'x' });
    const noId = await deletePasskey(opts({ fetchImpl: impl }), { token: 'tok', id: '  ' });

    expect(noToken).toEqual({ ok: false, reason: 'unauthorized' });
    expect(noId).toEqual({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });

  it('🔴 2xx 但主体不是 JSON 对象 → 不当成功', async () => {
    const impl = (() =>
      Promise.resolve({
        status: 200,
        ok: true,
        json: () => Promise.reject(new Error('not json')),
      } as unknown as Response)) as unknown as typeof fetch;

    const outcome = await deletePasskey(opts({ fetchImpl: impl }), { token: 'tok', id: 'x' });

    expect(outcome).toEqual({ ok: false, reason: 'malformed-response', status: 200 });
  });
});

describe('缺口 B：登录失败的两种 401 在客户端就分开了', () => {
  const credential = { id: 'NdTCzq0G8dA8cObw41B8' };

  it('陈旧凭据（passkey_not_found）→ passkey-not-found', async () => {
    const { impl } = recordingFetch(() => ({
      status: 401,
      body: { error: 'This passkey is no longer registered on this server.', code: 'passkey_not_found' },
    }));

    const outcome = await completePasskeyLogin(opts({ fetchImpl: impl }), {
      email: 'a@b.c',
      credential,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('passkey-not-found');
      expect(outcome.code).toBe('passkey_not_found');
    }
  });

  it('验签失败（passkey_verification_failed）→ passkey-rejected', async () => {
    const { impl } = recordingFetch(() => ({
      status: 401,
      body: { error: 'Passkey verification failed', code: 'passkey_verification_failed' },
    }));

    const outcome = await completePasskeyLogin(opts({ fetchImpl: impl }), {
      email: 'a@b.c',
      credential,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('passkey-rejected');
      expect(outcome.code).toBe('passkey_verification_failed');
    }
  });

  it('🔴 两者不是同一个原因，也都不是笼统的 unauthorized', async () => {
    const stale = recordingFetch(() => ({
      status: 401,
      body: { error: 'x', code: 'passkey_not_found' },
    }));
    const broken = recordingFetch(() => ({
      status: 401,
      body: { error: 'y', code: 'passkey_verification_failed' },
    }));

    const a = await completePasskeyLogin(opts({ fetchImpl: stale.impl }), {
      email: 'a@b.c',
      credential,
    });
    const b = await completePasskeyLogin(opts({ fetchImpl: broken.impl }), {
      email: 'a@b.c',
      credential,
    });

    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok && !b.ok) {
      expect(a.reason).toBe('passkey-not-found');
      expect(b.reason).toBe('passkey-rejected');
      expect(a.reason).not.toBe(b.reason);
      expect(a.reason).not.toBe('unauthorized');
      expect(b.reason).not.toBe('unauthorized');
    }
  });

  it('未识别的服务端 code 不猜：退回按状态码分类', async () => {
    const { impl } = recordingFetch(() => ({
      status: 401,
      body: { error: 'x', code: 'something_only_the_server_knows' },
    }));

    const outcome = await completePasskeyLogin(opts({ fetchImpl: impl }), {
      email: 'a@b.c',
      credential,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('unauthorized');
      // 码仍然原样带给调用方（可观测性），只是不用它选动作。
      expect(outcome.code).toBe('something_only_the_server_knows');
    }
  });
});

describe('已认证"再加一条"凭据的客户端契约', () => {
  const credential = { id: 'NEWCRED', response: { transports: ['internal'] } };

  it('begin：POST 已认证端点，带 bearer，**不带请求体**', async () => {
    const { impl, calls } = recordingFetch(() => ({
      status: 200,
      body: { challenge: 'Y2hhbGxlbmdl', rp: { id: 'localhost' } },
    }));

    const outcome = await beginPasskeyEnrollment(opts({ fetchImpl: impl }), ' jwt-1 ');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.options.challenge).toBe('Y2hhbGxlbmdl');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      `https://sync.example.com${HOSTED_AUTH_PATHS.passkeyEnrollOptions}`,
    );
    expect(calls[0]!.init?.method).toBe('POST');
    expect(headerOf(calls[0]!.init)['authorization']).toBe('Bearer jwt-1');
    // options 的生成完全由令牌决定，客户端没有输入要带。
    expect(calls[0]!.init?.body).toBeUndefined();
  });

  it('begin：空令牌 → unauthorized，且一个请求都不发', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200, body: {} }));

    const outcome = await beginPasskeyEnrollment(opts({ fetchImpl: impl }), '   ');

    expect(outcome).toEqual({ ok: false, reason: 'unauthorized' });
    expect(calls).toHaveLength(0);
  });

  it('begin：2xx 但不是 JSON 对象 → malformed-response，绝不当成功', async () => {
    const { impl } = recordingFetch(() => ({ status: 200, body: [1, 2, 3] }));

    const outcome = await beginPasskeyEnrollment(opts({ fetchImpl: impl }), 'tok');

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('malformed-response');
  });

  it('complete：POST 已认证端点，带 bearer，请求体**只有 credential**', async () => {
    const { impl, calls } = recordingFetch(() => ({
      status: 200,
      body: { message: 'Passkey added successfully.' },
    }));

    const outcome = await completePasskeyEnrollment(opts({ fetchImpl: impl }), {
      token: 'tok',
      credential,
    });

    expect(outcome).toEqual({ ok: true, message: 'Passkey added successfully.' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      `https://sync.example.com${HOSTED_AUTH_PATHS.passkeyEnrollComplete}`,
    );
    expect(calls[0]!.init?.method).toBe('POST');
    expect(headerOf(calls[0]!.init)['authorization']).toBe('Bearer tok');
    // 🔴 归属字段一个都不发：服务端从 JWT 取 userId。
    expect(calls[0]!.body).toEqual({ credential });
    expect(JSON.stringify(calls[0]!.body)).not.toContain('userId');
    expect(JSON.stringify(calls[0]!.body)).not.toContain('email');
  });

  it('complete：空令牌 → unauthorized，且一个请求都不发', async () => {
    const { impl, calls } = recordingFetch(() => ({ status: 200, body: {} }));

    const outcome = await completePasskeyEnrollment(opts({ fetchImpl: impl }), {
      token: ' ',
      credential,
    });

    expect(outcome).toEqual({ ok: false, reason: 'unauthorized' });
    expect(calls).toHaveLength(0);
  });

  it('🔴 409 + passkey_already_registered → passkey-already-registered（不是笼统失败）', async () => {
    const { impl } = recordingFetch(() => ({
      status: 409,
      body: {
        error: 'This passkey is already registered on this account.',
        code: 'passkey_already_registered',
      },
    }));

    const outcome = await completePasskeyEnrollment(opts({ fetchImpl: impl }), {
      token: 'tok',
      credential,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('passkey-already-registered');
      expect(outcome.status).toBe(409);
      expect(outcome.code).toBe('passkey_already_registered');
    }
  });

  it('complete：401 → unauthorized（而不是当成凭据已写入）', async () => {
    const { impl } = recordingFetch(() => ({
      status: 401,
      body: { error: 'Missing or invalid Authorization header' },
    }));

    const outcome = await completePasskeyEnrollment(opts({ fetchImpl: impl }), {
      token: 'tok',
      credential,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('unauthorized');
  });
});
