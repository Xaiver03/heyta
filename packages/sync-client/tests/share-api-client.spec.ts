import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShareApiClient, ShareApiError } from '../src/share-api-client';

/**
 * ShareApiClient 的契约测试：stub fetch 断言 URL/方法/头/体形状 +
 * 错误码镜像。密码学不在这层（载荷是密文信封，本层纯传输）。
 */

const TOKEN = 'jwt-token';
let lastRequest: { url: string; method: string; headers: Record<string, string>; body: string | undefined } | null = null;
let responder: () => { status: number; body: unknown } = () => ({ status: 200, body: {} });

const makeClient = () => new ShareApiClient({
  baseUrl: 'https://api.example',
  getToken: () => TOKEN,
  fetchImpl: (async (url: any, init: any) => {
    lastRequest = {
      url: String(url),
      method: init.method,
      headers: init.headers,
      body: init.body,
    };
    const { status, body } = responder();
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch,
});

afterEach(() => {
  lastRequest = null;
  responder = () => ({ status: 200, body: {} });
});

describe('ShareApiClient', () => {
  it('createShare: POST /api/shares，Bearer 头 + 空对象体', async () => {
    responder = () => ({ status: 201, body: { shareId: 's1', keyEpoch: 1, memberId: 'm1', role: 'owner', createdAt: 1 } });
    const client = makeClient();
    const created = await client.createShare();
    expect(created.shareId).toBe('s1');
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.url).toBe('https://api.example/api/shares');
    expect(lastRequest!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(lastRequest!.body!)).toEqual({});
  });

  it('没有 Authorization 头的场景不存在——每个调用都带令牌', async () => {
    responder = () => ({ status: 200, body: { shares: [], removedMemberships: [] } });
    const client = makeClient();
    await client.listShares();
    expect(lastRequest!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('非 2xx → ShareApiError 带稳定错误码', async () => {
    responder = () => ({ status: 403, body: { statusCode: 403, code: 'SHARE_MEMBER_LIMIT', error: 'full' } });
    const client = makeClient();
    const err = await client.acceptInvitation({ token: 't', identityPublicKey: 'k' })
      .then(() => null)
      .catch((e: unknown) => e as ShareApiError);
    expect(err).toBeInstanceOf(ShareApiError);
    expect(err!.status).toBe(403);
    expect(err!.code).toBe('SHARE_MEMBER_LIMIT');
  });

  it('网络异常 → code=network', async () => {
    const client = new ShareApiClient({
      baseUrl: 'https://api.example',
      getToken: () => TOKEN,
      fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch,
    });
    const err = await client.listShares().then(() => null).catch((e: unknown) => e as ShareApiError);
    expect(err!.code).toBe('network');
  });

  it('uploadOps：体是 {ops:[...]}，逐 op 的形状原样透传（密文不解释）', async () => {
    responder = () => ({
      status: 200,
      body: { accepted: [{ id: 'op-1', serverSeq: 6 }], rejected: [], latestServerSeq: 6 },
    });
    const client = makeClient();
    const op = { id: 'op-1', clientId: 'c1', payload: 'AQxxx', opType: 'CRT', entityType: 'TASK' };
    const result = await client.uploadOps('share-1', [op]);
    expect(result.accepted[0].serverSeq).toBe(6);
    const sent = JSON.parse(lastRequest!.body!);
    expect(sent.ops[0].payload).toBe('AQxxx');
    expect(lastRequest!.url).toContain('/api/shares/share-1/ops');
  });

  it('downloadOps：after/limit 进查询串', async () => {
    responder = () => ({ status: 200, body: { ops: [], cursor: { latestServerSeq: 0 } } });
    const client = makeClient();
    await client.downloadOps('share-1', 15, 50);
    expect(lastRequest!.url).toBe('https://api.example/api/shares/share-1/ops/causal?after=15&limit=50');
  });

  it('信封下发 PUT /members/:id/envelope：世代与信封原样上行', async () => {
    responder = () => ({ status: 200, body: { memberId: 'm2', memberKeyEpoch: 2 } });
    const client = makeClient();
    const result = await client.putMemberEnvelope('share-1', 'm2', {
      keyEpoch: 2, keyEnvelope: { recipientFingerprint: 'f', ciphertext: 'c' },
    });
    expect(result.memberKeyEpoch).toBe(2);
    const sent = JSON.parse(lastRequest!.body!);
    expect(sent.keyEnvelope).toEqual({ recipientFingerprint: 'f', ciphertext: 'c' });
  });

  it('移除成员：DELETE 到位', async () => {
    responder = () => ({ status: 200, body: { removed: true } });
    const client = makeClient();
    const result = await client.removeMember('share-1', 'm2');
    expect(result.removed).toBe(true);
    expect(lastRequest!.method).toBe('DELETE');
    expect(lastRequest!.url).toContain('/api/shares/share-1/members/m2');
  });
});
