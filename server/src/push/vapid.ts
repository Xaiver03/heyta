/**
 * VAPID（RFC 8292）—— 让推送服务相信"这条推送真的来自 heyta"。
 * =================================================================
 *
 * ## 为什么必须有它
 *
 * RFC 8030 的推送服务对**未认证**的请求基本都不接受：没有 VAPID，
 * `POST /push/...` 会得到 401/403，而错误信息不会提到"你缺了 VAPID 头"。
 * 所以这不是一个可选的安全加固，它是**能发出第一条推送的前提**。
 *
 * ## 结构（一句话）
 *
 * ```
 * Authorization: vapid t=<JWT>, k=<我们的公钥>
 * ```
 *
 * JWT 是 ES256（P-256 + SHA-256）签的，`aud` 必须是**推送服务端点的 origin**，
 * `sub` 是一个联系方式（`mailto:` 或 `https:`）。
 *
 * ## 🔴 三个只有真发过才知道的坑
 *
 * | 坑 | 症状 |
 * |---|---|
 * | `aud` 用了完整 endpoint 而不是 origin | 推送服务回 403，且不说为什么 |
 * | 签名输出是 DER 而不是 raw（r\\|\\|s 64 字节） | 推送服务回 401 "bad signature" —— 而 DER 对 ECDSA 来说是完全合法的编码 |
 * | `k` 用了 base64 而不是 base64url（或有 padding） | 同上，401 |
 *
 * 第二条是最阴的：Node 的 `crypto.sign('sha256', ...)` **默认输出 DER**，
 * 必须显式传 `dsaEncoding: 'ieee-p1363'` 才拿到 JOSE 要的 raw 形式。
 * 下面有测试直接断言签名长度是 **64 字节**（DER 形式是 70–72 字节）。
 */

import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

import { base64UrlEncode, padPrivateKey } from './push-crypto';

/** VAPID 的 JWT 有效期。RFC 8292 §2 要求**不得超过 24 小时**。 */
export const VAPID_JWT_TTL_SECONDS = 12 * 60 * 60;

/** 超过这个值就是违反 RFC，直接拒绝构造。 */
export const VAPID_JWT_MAX_TTL_SECONDS = 24 * 60 * 60;

export interface VapidKeys {
  /**
   * P-256 私钥，**原始的 32 字节**（不是 PKCS#8）。
   *
   * ⚠️ 与 `push-crypto` 保持一致用裸字节：PKCS#8/DER 会让"这对密钥
   * 是不是同一个"这件事变得需要额外解析才能回答。
   */
  privateKey: Buffer;
  /** 65 字节未压缩点。**同时**用于 `k=` 和推送载荷的 ECDH（是两件事）。 */
  publicKey: Buffer;
}

/**
 * 把裸私钥包成 Node 能签的 `KeyObject`。
 *
 * 🔴 Node 不接受"给我 32 字节签个名" —— 它要一个 ASN.1 结构。
 * 这里手工拼 PKCS#8 的固定前缀（这 16 字节对 P-256 是常数），
 * 而不是引入 `jose` 之类的包。
 *
 * ⚠️ 前缀里已经包含了曲线 OID（`prime256v1`）。用错曲线（比如 secp384r1）
 * 会得到一个**能签、但推送服务验不过**的签名。
 */
function privateKeyObject(input: Buffer): ReturnType<typeof createPrivateKey> {
  // 🔴 **这里必须先补零，不能直接要求 32 字节。**
  //
  // 调用方给的很可能是 `ecdh.getPrivateKey()` 的裸输出，而它是**最短大端表示**
  // —— 最高字节为 0 时只有 31 字节（概率约 1/256）。早先的版本直接
  // `if (raw.length !== 32) throw`，于是约 0.4% 的推送会失败。
  //
  // ⚠️ 补零必须在**这里**也做一次（而不是只依赖 `generateServerKeyPair`）：
  // 调用方可以直接传一个自己生成的裸私钥。放在这里，任何来源都安全。
  const raw = padPrivateKey(input);
  const pkcs8Prefix = Buffer.from('3041020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420', 'hex');
  return createPrivateKey({
    key: Buffer.concat([pkcs8Prefix, raw]),
    format: 'der',
    type: 'pkcs8',
  });
}

function publicKeyObject(raw: Buffer): ReturnType<typeof createPublicKey> {
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error(`VAPID 公钥必须是 65 字节未压缩点，收到 ${raw.length}`);
  }
  const spkiPrefix = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
  // 🔴 这里必须是 `createPublicKey` —— 写成 `createPrivateKey` 会报
  //    `The property 'options.type' is invalid. Received 'spki'`，
  //    而这行错只有真的去**验签**时才暴露（签名那一侧根本不碰它）。
  return createPublicKey({
    key: Buffer.concat([spkiPrefix, raw]),
    format: 'der',
    type: 'spki',
  });
}

/** VAPID 的 `aud`。**只取 origin**（scheme + host + port），丢掉路径。 */
export function vapidAudience(endpoint: string): string {
  const url = new URL(endpoint);
  return url.origin;
}

export interface BuildVapidHeaderInput {
  endpoint: string;
  keys: VapidKeys;
  /** `mailto:` 或 `https:`。RFC 8292 §2.1 要求它是一个联系方式。 */
  subject: string;
  /** 当前时间（秒）。**不传就用 `Date.now()`**；测试里必须传。 */
  nowSeconds?: number;
  /** 有效期（秒）。默认 12 小时，上限 24 小时。 */
  ttlSeconds?: number;
}

export interface VapidHeader {
  /** 直接放进 `Authorization` 请求头的完整值。 */
  authorization: string;
  /** 拆开，方便测试与排查。 */
  jwt: string;
  audience: string;
  expiresAt: number;
}

/**
 * 构造 `Authorization: vapid t=…, k=…`。
 *
 * ⚠️ 每次推送都要**重新构造**（JWT 里有 `exp`）。不要缓存这个字符串 ——
 * 缓存 12 小时之后开始收到 403，而那看起来像"推送服务抽风"。
 */
export function buildVapidHeader(input: BuildVapidHeaderInput): VapidHeader {
  const ttl = input.ttlSeconds ?? VAPID_JWT_TTL_SECONDS;
  if (ttl <= 0 || ttl > VAPID_JWT_MAX_TTL_SECONDS) {
    throw new Error(`VAPID 的 TTL 必须在 (0, ${VAPID_JWT_MAX_TTL_SECONDS}] 秒内，收到 ${ttl}`);
  }
  if (!input.subject.startsWith('mailto:') && !input.subject.startsWith('https:')) {
    // ⚠️ RFC 8292 §2.1 允许 `mailto:` 与 `https:`。推送服务**真的会校验**这一点
    //    （某些实现直接 403），所以这里宁可早失败。
    throw new Error(`VAPID 的 sub 必须是 mailto: 或 https: 开头，收到 ${input.subject}`);
  }

  // ⚠️ 公钥也要在这里校验，而不是等到 `verifyVapidJwt`（那只在测试里跑）。
  //    不校验的话，一个长度错的公钥会**原样**编进 `k=`，
  //    然后推送服务回 401 —— 而那时你手上只有一个看起来合法的 base64 串。
  if (input.keys.publicKey.length !== 65 || input.keys.publicKey[0] !== 0x04) {
    throw new Error(
      `VAPID 公钥必须是 65 字节未压缩点，收到 ${input.keys.publicKey.length} 字节`,
    );
  }

  const expiresAt = (input.nowSeconds ?? Math.floor(Date.now() / 1000)) + ttl;
  const audience = vapidAudience(input.endpoint);

  const header = base64UrlEncode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' }), 'utf8'));
  const payload = base64UrlEncode(
    Buffer.from(
      JSON.stringify({
        // ⚠️ 键的顺序不影响签名的有效性（JWT 签的是那段 base64 文本），
        //    但固定下来能让"同一个输入产生同一个输出"这条测试成立。
        aud: audience,
        exp: expiresAt,
        sub: input.subject,
      }),
      'utf8',
    ),
  );
  const signingInput = `${header}.${payload}`;

  // 🔴 `dsaEncoding: 'ieee-p1363'` **不能省**：默认是 DER，
  //    而 JOSE（ES256）要的是 raw 的 r||s。DER 也能被 `crypto.verify` 验过
  //    —— 所以"自己签自己验"永远发现不了它，只有推送服务会拒绝。
  const signature = cryptoSign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: privateKeyObject(input.keys.privateKey),
    dsaEncoding: 'ieee-p1363',
  });

  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;
  return {
    // ⚠️ `k=` 里是**公钥**，base64url 无填充。
    authorization: `vapid t=${jwt}, k=${base64UrlEncode(input.keys.publicKey)}`,
    jwt,
    audience,
    expiresAt,
  };
}

/**
 * 验证一个 VAPID JWT 的签名与 `aud`/`exp`。
 *
 * **只给测试与排查用** —— 服务端不会去验自己签的东西。
 * 存在的理由是：`buildVapidHeader` 的两条错法（DER 签名、错的 aud）
 * 都**不影响它自己能不能跑**，只影响推送服务认不认。
 * 有一个独立的验证函数，才能把"签名确实是用这把公钥、以 JOSE 形式签的"
 * 这件事钉成断言。
 */
export function verifyVapidJwt(
  jwt: string,
  keys: VapidKeys,
  opts: { endpoint: string; nowSeconds?: number },
): { valid: boolean; reason?: string } {
  const parts = jwt.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'JWT 必须有三段' };
  const [headerB64, payloadB64, signatureB64] = parts;

  // ES256 的签名**必须**是 64 字节（32 + 32）。DER 是 70–72，一眼能看出来。
  const signature = Buffer.from(signatureB64 ?? '', 'base64url');
  if (signature.length !== 64) {
    return { valid: false, reason: `ES256 签名必须是 64 字节，收到 ${signature.length}` };
  }

  let payload: { aud?: unknown; exp?: unknown; sub?: unknown };
  try {
    payload = JSON.parse(Buffer.from(payloadB64 ?? '', 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'payload 不是 JSON' };
  }

  const expectedAud = vapidAudience(opts.endpoint);
  if (payload.aud !== expectedAud) {
    return { valid: false, reason: `aud 必须是 ${expectedAud}，收到 ${String(payload.aud)}` };
  }
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return { valid: false, reason: 'exp 已过期' };
  }

  const ok = cryptoVerify(
    'sha256',
    Buffer.from(`${headerB64}.${payloadB64}`, 'utf8'),
    { key: publicKeyObject(keys.publicKey), dsaEncoding: 'ieee-p1363' },
    signature,
  );
  return ok ? { valid: true } : { valid: false, reason: '签名验不过' };
}
