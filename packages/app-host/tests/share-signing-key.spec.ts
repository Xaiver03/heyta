/**
 * M4 签名公钥补发：`publishShareSigningKey` 的判据
 * ==============================================
 *
 * 这一枚要钉的是「补发只补公钥那一格」——ADR-0069 裁决二里最容易做错的那件事：
 * 手一抖把"发布公钥"写成"重建身份"，就会连带动信封、动世代，
 * 于是全清单的人都被锁在门外，而面板上看不出来。
 *
 * | 判据 | 坏法 |
 * |---|---|
 * | 没在册 ⇒ 发**且只发**一次 PUT | 不发 ⇒ 服务端一开始验签，这台设备此后每条共享 op 都被永久拒 |
 * | 已在册且同值 ⇒ 零请求（`unchanged`） | 每 3 秒轮询各写一遍 ⇒ 面板开着就在刷服务端 |
 * | 已在册且不同值 ⇒ 零请求（`conflict`） | 覆盖 ⇒ 这个人此前的 op 全读成"验不过"，而协议上说不出他换过钥 |
 * | 三态是封闭词表 | 返回 `void` ⇒ 调用方把"没发出去"读成"发好了" |
 * | 端口抛错就抛 | 吞掉 ⇒ 用户以为在册，服务端根本没有那枚公钥 |
 */

import { describe, expect, it } from 'vitest';

import { publishShareSigningKey } from '../src/share-signing-key.js';

const KEY_A = 'a'.repeat(43);
const KEY_B = 'b'.repeat(43);

const harness = (registered?: string | null) => {
  const calls: Array<{ shareId: string; memberId: string; key: string }> = [];
  return {
    calls,
    api: {
      putMemberSigningKey: async (shareId: string, memberId: string, signingPublicKey: string) => {
        calls.push({ shareId, memberId, key: signingPublicKey });
        return { memberId, signingPublicKey };
      },
    },
    registered,
  };
};

describe('publishShareSigningKey', () => {
  it('not registered yet => exactly one PUT, carrying share/member/key verbatim', async () => {
    const h = harness();
    const outcome = await publishShareSigningKey({
      api: h.api, shareId: 'share-1', memberId: 'member-1', signingPublicKey: KEY_A, registeredPublicKey: h.registered,
    });
    expect(outcome).toBe('published');
    expect(h.calls).toEqual([{ shareId: 'share-1', memberId: 'member-1', key: KEY_A }]);
  });

  it('null and undefined are both "not registered" (the row exists, the column is empty)', async () => {
    for (const registered of [null, undefined]) {
      const h = harness(registered);
      await expect(publishShareSigningKey({
        api: h.api, shareId: 's', memberId: 'm', signingPublicKey: KEY_A, registeredPublicKey: registered,
      })).resolves.toBe('published');
      expect(h.calls).toHaveLength(1);
    }
  });

  it('same key already on file => no request at all', async () => {
    const h = harness(KEY_A);
    const outcome = await publishShareSigningKey({
      api: h.api, shareId: 's', memberId: 'm', signingPublicKey: KEY_A, registeredPublicKey: h.registered,
    });
    expect(outcome).toBe('unchanged');
    expect(h.calls).toEqual([]);
  });

  it('a different key already on file => refuse to overwrite, send nothing', async () => {
    const h = harness(KEY_A);
    const outcome = await publishShareSigningKey({
      api: h.api, shareId: 's', memberId: 'm', signingPublicKey: KEY_B, registeredPublicKey: h.registered,
    });
    expect(outcome).toBe('conflict');
    expect(h.calls).toEqual([]);
  });

  it('a transport failure is not swallowed into a quiet outcome', async () => {
    await expect(publishShareSigningKey({
      api: {
        putMemberSigningKey: async () => { throw new Error('offline'); },
      },
      shareId: 's',
      memberId: 'm',
      signingPublicKey: KEY_A,
    })).rejects.toThrow('offline');
  });
});
