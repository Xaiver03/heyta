/**
 * #62 · TOTP（RFC 6238）纯函数自测
 * ===============================
 *
 * 用 **RFC 6238 附录 B 的官方测试向量**钉住算法（SHA-1 / 8 位）：
 * 密钥 ASCII `12345678901234567890`，其 base32 形式 `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`。
 *
 * 三件必须能红的事：
 *   1. 六个官方时间点的码逐字对上（改任何一步截断/计数都会红）；
 *   2. base32 编解码往返一致；
 *   3. 校验器接受当前码、拒绝错码，并接受 ±1 步的时钟漂移。
 */
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  decodeBase32,
  encodeBase32,
  generateSecret,
  generateTotp,
  secondsRemaining,
  verifyTotp,
} from '../src/lib/totp.js';

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"

beforeAll(() => {
  // jsdom 不实现 SubtleCrypto；用 Node 的 WebCrypto 顶上（模块只用标准 API）。
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

describe('#62 TOTP', () => {
  it('RFC 6238 附录 B：SHA-1 / 8 位，六个官方向量', async () => {
    const vectors: ReadonlyArray<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, expected] of vectors) {
      const code = await generateTotp(RFC_SECRET, seconds * 1000, { digits: 8 });
      expect(code, `T=${seconds}`).toBe(expected);
    }
  });

  it('6 位模式 = 8 位向量低 6 位', async () => {
    expect(await generateTotp(RFC_SECRET, 59_000, { digits: 6 })).toBe('287082');
    expect(await generateTotp(RFC_SECRET, 1111111109_000, { digits: 6 })).toBe('081804');
  });

  it('base32 编解码往返一致', () => {
    const bytes = decodeBase32('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(encodeBase32(bytes)).toBe(RFC_SECRET);
    // 带空格与填充也要能解（用户可能照屏幕抄 "GEZD GNBV …"）。
    expect(decodeBase32('gezd gnbv gy3t qojq')).toEqual(decodeBase32('GEZDGNBVGY3TQOJQ'));
    expect(() => decodeBase32('GEZD1')).toThrow();
  });

  it('随机密钥：长度正确且能被解回', () => {
    const secret = generateSecret();
    expect(secret.length).toBeGreaterThan(20);
    expect(decodeBase32(secret).length).toBe(20);
  });

  it('校验：当前码通过、错码拒绝、±1 步漂移通过', async () => {
    const now = 1_700_000_000_000;
    const code = await generateTotp(RFC_SECRET, now);
    expect(await verifyTotp(RFC_SECRET, code, now)).toBe(true);
    expect(await verifyTotp(RFC_SECRET, '000000', now)).toBe(false);
    expect(await verifyTotp(RFC_SECRET, 'abcdef', now)).toBe(false);

    // 上一个时间步的码：默认 window=1 内应通过；window=0 时必须拒绝。
    const prev = await generateTotp(RFC_SECRET, now - 30_000);
    expect(await verifyTotp(RFC_SECRET, prev, now)).toBe(true);
    expect(await verifyTotp(RFC_SECRET, prev, now, { window: 0 })).toBe(false);
  });

  it('倒计时落在 (0, period]', () => {
    expect(secondsRemaining(0)).toBe(30);
    expect(secondsRemaining(1000)).toBe(29);
  });
});
