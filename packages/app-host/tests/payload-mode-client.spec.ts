/**
 * ADR-0080 S6：宿主读服务端载荷模式。
 *
 * 这一层的判据几乎全是"读不到时怎么办"—— 因为**读错方向**的代价不对称：
 * 把 e2ee 读成 plain ⇒ 明文写上去（不可逆）；把 plain 读成 e2ee ⇒ 服务端 400（可见、可改）。
 * 所以除了明确的 `readable`，一切都按 `e2ee`。
 */
import { describe, expect, it, vi } from 'vitest';

import { payloadModeUrl, readRemotePayloadMode } from '../src/payload-mode-client.js';

const BASE = 'https://heyta.test';

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('readRemotePayloadMode', () => {
  it('readable ⇒ plain', async () => {
    const fetchImpl = vi.fn(async () => respond(200, { mode: 'readable' }));
    await expect(
      readRemotePayloadMode({ baseUrl: BASE, token: 't', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBe('plain');
  });

  it('e2ee ⇒ e2ee', async () => {
    const fetchImpl = vi.fn(async () => respond(200, { mode: 'e2ee' }));
    await expect(
      readRemotePayloadMode({ baseUrl: BASE, token: 't', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBe('e2ee');
  });

  it('404 / 500 / 坏 JSON / 形状不对 一律 fail-closed 到 e2ee', async () => {
    const cases: Array<() => Response> = [
      () => respond(404, { code: 'not_found' }),
      () => respond(500, { code: 'internal' }),
      () => new Response('not json', { status: 200 }),
      () => respond(200, { mode: 'readable', extra: 'nope' }),
      () => respond(200, { mode: 'someday-maybe' }),
    ];
    for (const make of cases) {
      const fetchImpl = vi.fn(async () => make());
      await expect(
        readRemotePayloadMode({ baseUrl: BASE, token: 't', fetchImpl: fetchImpl as unknown as typeof fetch }),
      ).resolves.toBe('e2ee');
    }
  });

  it('网络抛错也回 e2ee（不让一次读失败变成明文写入）', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    await expect(
      readRemotePayloadMode({ baseUrl: BASE, token: 't', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBe('e2ee');
  });

  it('请求的是契约里那条相对路径，且带 Bearer', async () => {
    const fetchImpl = vi.fn(async () => respond(200, { mode: 'e2ee' }));
    await readRemotePayloadMode({ baseUrl: `${BASE}/`, token: 'abc', fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/sync/payload-mode`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer abc');
  });

  it('payloadModeUrl 不产生双斜杠', () => {
    expect(payloadModeUrl('https://heyta.test///')).toBe('https://heyta.test/api/sync/payload-mode');
  });
});
