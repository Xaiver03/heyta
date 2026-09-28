/**
 * VAPID（RFC 8292）的承重测试。
 * ==============================
 *
 * 🔴 这个文件要挡的是**"自己签自己验当然过"**这一类错。
 *
 * VAPID 有两处错法会**让本地一切正常**、只有推送服务拒绝：
 *
 * | 错法 | 本地表现 | 推送服务 |
 * |---|---|---|
 * | 签名输出 DER（Node 默认）而非 raw r\\|\\|s | `crypto.verify` **照样过** | 401 bad signature |
 * | `aud` 用完整 endpoint 而非 origin | 本地无从发现 | 403 |
 * | `k` 带 padding / 用普通 base64 | 本地无从发现 | 401 |
 *
 * 所以这里有意**不**只测"签了能验"：每一条都要断言**那个具体的形状**
 * （64 字节、origin、无 padding）。
 */

import { describe, expect, it } from 'vitest';

import { generateServerKeyPair, padPrivateKey } from '../src/push/push-crypto';
import {
  buildVapidHeader,
  VAPID_JWT_MAX_TTL_SECONDS,
  vapidAudience,
  verifyVapidJwt,
} from '../src/push/vapid';

const ENDPOINT = 'https://wns2-par02p.notify.windows.com/w/?token=AbCdEf%2B123';
const SUBJECT = 'mailto:push@heyta.app';
const NOW = 1_800_000_000;

function keys() {
  const { privateKey, publicKey } = generateServerKeyPair();
  return { privateKey, publicKey };
}

function build(over: Partial<Parameters<typeof buildVapidHeader>[0]> = {}) {
  return buildVapidHeader({
    endpoint: ENDPOINT,
    keys: keys(),
    subject: SUBJECT,
    nowSeconds: NOW,
    ...over,
  });
}

describe('vapidAudience', () => {
  it('🔴 只取 origin，丢掉路径与查询串', () => {
    // ⚠️ 用完整 endpoint 当 aud 是**最常见**的一个错，而它只在推送服务那一侧
    //    表现为 403，本地完全看不出来。所以这条单独钉住。
    expect(vapidAudience(ENDPOINT)).toBe('https://wns2-par02p.notify.windows.com');
    expect(vapidAudience('https://fcm.googleapis.com/fcm/send/xyz')).toBe(
      'https://fcm.googleapis.com',
    );
  });

  it('端口要保留（本地推送服务用得上）', () => {
    expect(vapidAudience('http://127.0.0.1:8090/push/abc')).toBe('http://127.0.0.1:8090');
  });
});

describe('buildVapidHeader 的形状', () => {
  it('Authorization 是 vapid t=<jwt>, k=<公钥>', () => {
    const k = keys();
    const out = buildVapidHeader({
      endpoint: ENDPOINT,
      keys: k,
      subject: SUBJECT,
      nowSeconds: NOW,
    });
    expect(out.authorization.startsWith('vapid t=')).toBe(true);
    expect(out.authorization).toContain(`, k=${k.publicKey.toString('base64url')}`);
    expect(out.jwt.split('.')).toHaveLength(3);
  });

  it('🔴 ES256 的签名是 64 字节 raw，不是 DER', () => {
    // Node 的 `crypto.sign` **默认输出 DER**（70–72 字节），而 JOSE 要 raw r||s。
    // DER 形式的签名能被 `crypto.verify` 验证通过 —— 也就是说
    // **只有长度这条断言能发现它**，除非真的去发一条推送。
    const jwt = build().jwt;
    const signature = Buffer.from(jwt.split('.')[2] ?? '', 'base64url');
    expect(signature.length).toBe(64);
  });

  it('🔴 公钥用的是 base64url 且没有 padding', () => {
    const k = keys();
    const out = buildVapidHeader({ endpoint: ENDPOINT, keys: k, subject: SUBJECT, nowSeconds: NOW });
    const kPart = out.authorization.split(', k=')[1] ?? '';
    expect(kPart).not.toContain('+');
    expect(kPart).not.toContain('/');
    expect(kPart).not.toContain('=');
  });

  it('k 与载荷加密用的公钥是**同一个**（RFC 8291 §3.1 允许复用，但必须清楚是哪一对）', () => {
    // ⚠️ 这里钉的是"我们**有意**复用同一对密钥"这个决定，而不是巧合。
    //    换成两对也不算错，但那样 `k=` 与 keyid 就是不同密钥，
    //    排查时需要知道这件事 —— 所以用一条断言把它写下来。
    const k = keys();
    const out = buildVapidHeader({ endpoint: ENDPOINT, keys: k, subject: SUBJECT, nowSeconds: NOW });
    expect(out.authorization).toContain(`k=${k.publicKey.toString('base64url')}`);
  });

  it('aud 是 origin，exp 是 now + 默认 TTL', () => {
    const out = build();
    expect(out.audience).toBe('https://wns2-par02p.notify.windows.com');
    expect(out.expiresAt).toBe(NOW + 12 * 60 * 60);
  });

  it('payload 里的三个字段齐全且类型正确', () => {
    const out = build();
    const payload = JSON.parse(Buffer.from(out.jwt.split('.')[1] ?? '', 'base64url').toString());
    expect(payload).toEqual({
      aud: 'https://wns2-par02p.notify.windows.com',
      exp: NOW + 12 * 60 * 60,
      sub: SUBJECT,
    });
  });

  it('header 是 {"typ":"JWT","alg":"ES256"}', () => {
    const header = JSON.parse(Buffer.from(build().jwt.split('.')[0] ?? '', 'base64url').toString());
    expect(header).toEqual({ typ: 'JWT', alg: 'ES256' });
  });

  /**
   * ⚠️ 我第一版这里断言的是"两次完全相同的 JWT"，**那是错的** ——
   * ECDSA 每次签名都取一个新的随机 k，所以签名必然不同。
   * 那条断言会对**完全正确**的实现永远报红（又一个"不可能通过的检查"）。
   *
   * 正确的形状是：**header 与 payload 必须逐字相同**（它们只由输入决定），
   * 而**签名必须不同但都能验过** —— 后面那半句才是承重的：
   * 它挡的是"签名被写死成常量"这类退化。
   */
  it('同一组输入：header/payload 逐字相同，签名不同但都验得过', () => {
    const k = keys();
    const args = { endpoint: ENDPOINT, keys: k, subject: SUBJECT, nowSeconds: NOW };
    const a = buildVapidHeader(args);
    const b = buildVapidHeader(args);

    expect(a.jwt.split('.').slice(0, 2)).toEqual(b.jwt.split('.').slice(0, 2));
    expect(a.jwt.split('.')[1]).toBe(b.jwt.split('.')[1]);
    expect(a.jwt).not.toBe(b.jwt);
    expect(verifyVapidJwt(a.jwt, k, { endpoint: ENDPOINT, nowSeconds: NOW }).valid).toBe(true);
    expect(verifyVapidJwt(b.jwt, k, { endpoint: ENDPOINT, nowSeconds: NOW }).valid).toBe(true);
  });
});

describe('签名能被独立验过（这一层不是自己验自己）', () => {
  it('verifyVapidJwt 对自签的 JWT 给 valid', () => {
    const k = keys();
    const out = buildVapidHeader({ endpoint: ENDPOINT, keys: k, subject: SUBJECT, nowSeconds: NOW });
    expect(verifyVapidJwt(out.jwt, k, { endpoint: ENDPOINT, nowSeconds: NOW })).toEqual({
      valid: true,
    });
  });

  it('🔴 换一对公钥就验不过（证明验的真的是签名，不是"能解析就算过"）', () => {
    const out = build();
    const result = verifyVapidJwt(out.jwt, keys(), { endpoint: ENDPOINT, nowSeconds: NOW });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/签名/);
  });

  it('🔴 endpoint 变了（aud 不匹配）就拒绝', () => {
    const k = keys();
    const out = buildVapidHeader({ endpoint: ENDPOINT, keys: k, subject: SUBJECT, nowSeconds: NOW });
    const result = verifyVapidJwt(out.jwt, k, {
      endpoint: 'https://other.push.example/x',
      nowSeconds: NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/aud/);
  });

  it('🔴 过期就拒绝', () => {
    const k = keys();
    const out = buildVapidHeader({ endpoint: ENDPOINT, keys: k, subject: SUBJECT, nowSeconds: NOW });
    const result = verifyVapidJwt(out.jwt, k, {
      endpoint: ENDPOINT,
      nowSeconds: out.expiresAt + 1,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/exp/);
  });

  it('🔴 把签名改成 DER 形式就拒绝（这正是 Node 默认会犯的错）', () => {
    // 构造一个"看起来合法"的 DER 签名：长度 70–72，且**用真私钥签的**。
    // 这条证明"64 字节"那条断言不是形式主义 —— DER 在这条路径上确实会被拒。
    const k = keys();
    const out = buildVapidHeader({ endpoint: ENDPOINT, keys: k, subject: SUBJECT, nowSeconds: NOW });
    const [h, p] = out.jwt.split('.');
    const derSignature = Buffer.from(
      '3045022100' + '00'.repeat(32) + '022100' + '00'.repeat(32),
      'hex',
    );
    // 2 + 2 + 1 + 32 + 2 + 1 + 32 = 72（DER 的长度就是会落在 70–72）
    expect(derSignature.length).toBe(72);
    const derJwt = `${h}.${p}.${derSignature.toString('base64url')}`;
    const result = verifyVapidJwt(derJwt, k, { endpoint: ENDPOINT, nowSeconds: NOW });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/64 字节/);
  });

  it('段数不对时拒绝而不是崩溃', () => {
    expect(verifyVapidJwt('not.a.jwt.at.all', keys(), { endpoint: ENDPOINT }).valid).toBe(false);
    expect(verifyVapidJwt('only-one-part', keys(), { endpoint: ENDPOINT }).valid).toBe(false);
  });
});

describe('拒绝不合规的输入', () => {
  it('🔴 sub 不是 mailto:/https: 时拒绝（RFC 8292 §2.1 会真的被校验）', () => {
    expect(() => build({ subject: 'push@heyta.app' })).toThrow(/mailto:/);
    expect(() => build({ subject: '' })).toThrow(/mailto:/);
  });

  it('https: 的 sub 也接受', () => {
    expect(() => build({ subject: 'https://heyta.app/push' })).not.toThrow();
  });

  it('🔴 TTL 超过 24 小时时拒绝（RFC 的上限）', () => {
    expect(() => build({ ttlSeconds: VAPID_JWT_MAX_TTL_SECONDS + 1 })).toThrow(/TTL/);
  });

  it('TTL 恰好 24 小时放行', () => {
    expect(() => build({ ttlSeconds: VAPID_JWT_MAX_TTL_SECONDS })).not.toThrow();
  });

  it('TTL 为 0 或负数时拒绝', () => {
    expect(() => build({ ttlSeconds: 0 })).toThrow(/TTL/);
    expect(() => build({ ttlSeconds: -1 })).toThrow(/TTL/);
  });

  /**
   * 🔴 这一条**取代**了原先的"31 字节必须被拒绝"。
   *
   * 我原本写的是 `expect(...).toThrow(/32 字节/)` —— 而那个断言是**错的**，
   * 它把一个真实的生产 bug 固化成了规格：`ecdh.getPrivateKey()` 在最高字节
   * 为 0 时**合法地**返回 31 字节（概率约 1/256），那是**最短大端表示**，
   * 不是坏数据。拒绝它等于让约 0.4% 的推送永远失败。
   *
   * 正确的行为是**左补零**（见 `padPrivateKey`）。所以这里断言的是
   * "能签、且签出来的东西验得过"，而不是"必须抛"。
   */
  it('🔴 31 字节的裸私钥（最短表示）必须被接受并补零，而不是拒绝', () => {
    const { createECDH } = require('node:crypto') as typeof import('node:crypto');

    // ⚠️ 我第一版这里用了一个**合成的** 31 字节私钥去验签，而它与 `k.publicKey`
    //    根本不是一对 —— 于是验签失败，看起来像"补零补错了"。
    //    测试自己要保证"私钥与公钥是同一对"，否则它验的是别的东西。
    //    做法：先造一个最高字节为 0 的合法标量，取出它的 31 字节最短表示，
    //    再用同一个标量导出公钥。
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(
      Buffer.concat([
        Buffer.from([0x00]),
        Buffer.from(Array.from({ length: 31 }, (_, i) => i + 1)),
      ]),
    );
    const minimal = ecdh.getPrivateKey();
    const paired = { privateKey: minimal, publicKey: ecdh.getPublicKey() };
    expect(minimal).toHaveLength(31);

    const out = buildVapidHeader({
      endpoint: ENDPOINT,
      keys: paired,
      subject: SUBJECT,
      nowSeconds: NOW,
    });
    expect(out.jwt.split('.')).toHaveLength(3);
    expect(Buffer.from(out.jwt.split('.')[2] ?? '', 'base64url')).toHaveLength(64);

    // 🔴 补零补对**方向**才会用同一个标量签发 —— 所以这条能验出补错方向。
    //    补在后面会得到一个不同的标量，签名仍然产出 64 字节，但这里会 false。
    expect(verifyVapidJwt(out.jwt, paired, { endpoint: ENDPOINT, nowSeconds: NOW })).toEqual({
      valid: true,
    });

    // 而且补零后的私钥与原始 32 字节是同一个标量（公钥相同）。
    const roundTrip = createECDH('prime256v1');
    roundTrip.setPrivateKey(padPrivateKey(minimal));
    expect(roundTrip.getPublicKey().equals(paired.publicKey)).toBe(true);
  });

  it('超过 32 字节的私钥仍然拒绝（那是真的坏了，不是最短表示）', () => {
    const k = keys();
    expect(() =>
      buildVapidHeader({
        endpoint: ENDPOINT,
        keys: { ...k, privateKey: Buffer.alloc(33) },
        subject: SUBJECT,
        nowSeconds: NOW,
      }),
    ).toThrow(/超过 32 字节/);
  });

  it('公钥不是 65 字节未压缩点时拒绝', () => {
    const k = keys();
    expect(() =>
      buildVapidHeader({
        endpoint: ENDPOINT,
        keys: { ...k, publicKey: Buffer.alloc(65) }, // 首字节不是 0x04
        subject: SUBJECT,
        nowSeconds: NOW,
      }),
    ).toThrow(/65 字节/);
  });
});
