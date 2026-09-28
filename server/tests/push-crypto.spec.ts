/**
 * RFC 8291 §5 + Appendix A 的**完整测试向量**。
 * =============================================
 *
 * 🔴 这个文件是自研加密的**唯一理由成立的地方**。
 *
 * "自己写加密"最危险的形态不是写错，是**写错还测不出来** ——
 * 自己生成密钥、自己加密、自己解密，往返一致就报绿。那样连
 * "AAD 传空了"这种错都发现不了（自己解自己当然对）。
 *
 * 所以这里一条自造数据都没有：输入、输出、以及**每一个中间值**
 * 都逐字抄自 RFC 8291。中间值那几条尤其重要 ——
 * 最终密文对不上只能告诉你"错了"，而 `ecdh_secret` / `IKM` / `CEK` / `NONCE`
 * 哪一步先错，只有逐个比对才知道。
 *
 * | 断言 | 挡住的错法 |
 * |---|---|
 * | `ecdh_secret` | 曲线不对（P-256 vs secp256k1）、公私钥搞反 |
 * | `IKM` | `key_info` 拼错（顺序、那个 0x00、ASCII 串） |
 * | `CEK` / `NONCE` | HKDF 的 info 串写错、长度取错 |
 * | `header` | `rs` 字节序写错、`idlen` 漏了 |
 * | `body` | 分隔符用成 0x01、AAD 传空、tag 位置错 |
 */

import { describe, expect, it } from 'vitest';

import {
  base64UrlDecode,
  base64UrlEncode,
  deriveCekAndNonce,
  deriveIkm,
  encryptPushPayload,
  generateServerKeyPair,
  padPrivateKey,
  hkdfExpand,
  hkdfExtract,
  PUSH_MAX_PLAINTEXT,
} from '../src/push/push-crypto';

// ─────────────────────────────────────────────────────────────
// RFC 8291 §5 / Appendix A 的固定输入
// ─────────────────────────────────────────────────────────────

/** "When I grow up, I want to be a watermelon" */
const PLAINTEXT = Buffer.from('When I grow up, I want to be a watermelon', 'utf8');

const UA_PUBLIC = base64UrlDecode(
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
);
const UA_PRIVATE = base64UrlDecode('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94');
const AUTH_SECRET = base64UrlDecode('BTBZMqHH6r4Tts7J_aSIgg');
const SALT = base64UrlDecode('DGv6ra1nlYgDCS1FRnbzlw');

const AS_PUBLIC = base64UrlDecode(
  'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
);
const AS_PRIVATE = base64UrlDecode('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw');

/** §5 给出的完整请求体（base64url）。 */
const EXPECTED_BODY =
  'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
  'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
  'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';

// ─────────────────────────────────────────────────────────────
// Appendix A 的中间值
// ─────────────────────────────────────────────────────────────

const ECDH_SECRET = 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs';
const PRK_KEY = 'Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k';
const IKM = 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg';
const PRK = '09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc';
const CEK = 'oIhVW04MRdy2XN9CiKLxTg';
const NONCE = '4h_95klXJ5E_qnoN';
const HEADER =
  'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
  'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const CIPHERTEXT =
  '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs' + 'bI_0LpXMuGvnzQ';

/** base64url 里偶尔有换行/空白，比对前统一去掉。 */
function b64url(text: string): string {
  return text.replace(/\s+/g, '');
}

describe('RFC 8291 测试向量', () => {
  it('① ECDH 共享密钥与 Appendix A 逐字节一致', () => {
    // 这条挡的是"曲线不对"和"公私钥搞反" —— 两者都会让后面全错，
    // 而只看最终密文的话，报错会是"密钥看起来没错但解不开"。
    const { createECDH } = require('node:crypto') as typeof import('node:crypto');
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(AS_PRIVATE);
    const secret = ecdh.computeSecret(UA_PUBLIC);
    expect(base64UrlEncode(secret)).toBe(ECDH_SECRET);
  });

  it('② HKDF-Extract 给出 Appendix A 的 PRK_key', () => {
    const prkKey = hkdfExtract(AUTH_SECRET, base64UrlDecode(ECDH_SECRET));
    expect(base64UrlEncode(prkKey)).toBe(PRK_KEY);
  });

  it('③ IKM 与 Appendix A 一致（key_info 的拼接顺序在这里被钉住）', () => {
    const ikm = deriveIkm({
      ecdhSecret: base64UrlDecode(ECDH_SECRET),
      authSecret: AUTH_SECRET,
      uaPublic: UA_PUBLIC,
      asPublic: AS_PUBLIC,
    });
    expect(base64UrlEncode(ikm)).toBe(IKM);

    // ⚠️ 再单独验一次 HKDF-Expand 那一层：交换 ua/as 的顺序**必须**得到不同的值。
    //    没有这条，"拼接顺序无所谓"这种错会悄悄通过 —— 而它只在
    //    真实浏览器的解密端才暴露。
    const swapped = deriveIkm({
      ecdhSecret: base64UrlDecode(ECDH_SECRET),
      authSecret: AUTH_SECRET,
      uaPublic: AS_PUBLIC,
      asPublic: UA_PUBLIC,
    });
    expect(base64UrlEncode(swapped)).not.toBe(IKM);
  });

  it('④ 内容的 PRK / CEK / NONCE 与 Appendix A 一致', () => {
    expect(base64UrlEncode(hkdfExtract(SALT, base64UrlDecode(IKM)))).toBe(PRK);

    const { cek, nonce } = deriveCekAndNonce(SALT, base64UrlDecode(IKM));
    expect(base64UrlEncode(cek)).toBe(CEK);
    expect(base64UrlEncode(nonce)).toBe(NONCE);
  });

  it('⑤ 内容编码头与 Appendix A 一致（86 字节）', () => {
    const result = encryptPushPayload({
      plaintext: PLAINTEXT,
      uaPublic: UA_PUBLIC,
      authSecret: AUTH_SECRET,
      asPrivate: AS_PRIVATE,
      asPublic: AS_PUBLIC,
      salt: SALT,
    });

    expect(result.header.length).toBe(86);
    expect(base64UrlEncode(result.header)).toBe(b64url(HEADER));
  });

  it('⑥ 密文与 Appendix A 一致', () => {
    const result = encryptPushPayload({
      plaintext: PLAINTEXT,
      uaPublic: UA_PUBLIC,
      authSecret: AUTH_SECRET,
      asPrivate: AS_PRIVATE,
      asPublic: AS_PUBLIC,
      salt: SALT,
    });
    expect(base64UrlEncode(result.ciphertext)).toBe(b64url(CIPHERTEXT));
  });

  /**
   * 🔴 **这一条是整份文件的重点。**
   *
   * 前六条都是"对着中间值抄"；只有这一条断言的是**端到端产物** ——
   * 也就是真正会被塞进 HTTP 请求体、交给 Windows 推送服务的那些字节。
   * 它一条顶前面六条：中间值全对而这一条错，仍然是一个永远不会成功的推送。
   */
  it('🔴 ⑦ 完整请求体与 RFC §5 逐字节一致', () => {
    const result = encryptPushPayload({
      plaintext: PLAINTEXT,
      uaPublic: UA_PUBLIC,
      authSecret: AUTH_SECRET,
      asPrivate: AS_PRIVATE,
      asPublic: AS_PUBLIC,
      salt: SALT,
    });

    expect(base64UrlEncode(result.body)).toBe(b64url(EXPECTED_BODY));

    // 🔴 **长度是 144，不是 RFC §5 那个 `Content-Length: 145`。**
    //
    //    这不是实现错了 —— 是 **RFC 自己的示例前后不一致**：
    //    §5 的请求头写着 `Content-Length: 145`，而把它自己那段
    //    base64 body 解出来是 **144 字节**（192 个 base64url 字符 / 4 * 3）。
    //
    //    144 可以从别处**独立推出来**，而且三处都对得上：
    //      header 86（Appendix A 明写 "86-octet header"）
    //    + 明文   41（"When I grow up, I want to be a watermelon"）
    //    + 分隔符  1（0x02）
    //    + GCM tag 16
    //    = 144
    //    §4 那句 "4096 - 86 - 1 - 16 = 3993" 用的也是同一组数。
    //
    //    ⚠️ 这一条差点成为"一个永远失败的检查"：照 §5 抄 `145` 的话，
    //    它会对**完全正确**的实现永远报红 —— 而下一个人的第一反应会是
    //    去改实现（多加一个字节的填充），那才会真的把协议改坏。
    //    所以这里断言的是**能推导的那一侧**，把偏差记在同一行。
    expect(result.header.length).toBe(86);
    expect(result.body.length).toBe(86 + PLAINTEXT.length + 1 + 16);
    expect(result.body.length).toBe(144);
    /** 抄自 §5 的那一串也要能解出同样的字节 —— 两种写法互相印证。 */
    expect(base64UrlDecode(b64url(EXPECTED_BODY)).length).toBe(144);
  });

  it('返回的中间值与 Appendix A 一致（测试/排查用，不能记日志）', () => {
    const result = encryptPushPayload({
      plaintext: PLAINTEXT,
      uaPublic: UA_PUBLIC,
      authSecret: AUTH_SECRET,
      asPrivate: AS_PRIVATE,
      asPublic: AS_PUBLIC,
      salt: SALT,
    });
    expect(base64UrlEncode(result.intermediate.ecdhSecret)).toBe(ECDH_SECRET);
    expect(base64UrlEncode(result.intermediate.ikm)).toBe(IKM);
    expect(base64UrlEncode(result.intermediate.cek)).toBe(CEK);
    expect(base64UrlEncode(result.intermediate.nonce)).toBe(NONCE);
  });
});

describe('自检是承重的（不是"抄一遍再比一遍"）', () => {
  /**
   * 下面三条**故意改坏一个输入**，断言输出会变。
   *
   * 理由：上面那七条如果实现里藏着"把期望值硬编码"这类作弊，
   * 它们全都会绿。所以这里证明**这些向量真的走了计算路径**。
   */

  it('盐换一个字节，整个 body 就变（证明盐真的进了 HKDF）', () => {
    const other = Buffer.from(SALT);
    other[0] ^= 0x01;
    const result = encryptPushPayload({
      plaintext: PLAINTEXT,
      uaPublic: UA_PUBLIC,
      authSecret: AUTH_SECRET,
      asPrivate: AS_PRIVATE,
      asPublic: AS_PUBLIC,
      salt: other,
    });
    expect(base64UrlEncode(result.body)).not.toBe(b64url(EXPECTED_BODY));
  });

  it('明文换一个字，密文就变（证明 AES 真的在算）', () => {
    const result = encryptPushPayload({
      plaintext: Buffer.from('When I grow up, I want to be a watermeloX'),
      uaPublic: UA_PUBLIC,
      authSecret: AUTH_SECRET,
      asPrivate: AS_PRIVATE,
      asPublic: AS_PUBLIC,
      salt: SALT,
    });
    expect(base64UrlEncode(result.ciphertext)).not.toBe(b64url(CIPHERTEXT));
  });

  it('认证密钥换一个字节，密文就变（证明 auth_secret 真的混进了 IKM）', () => {
    const other = Buffer.from(AUTH_SECRET);
    other[0] ^= 0x01;
    const result = encryptPushPayload({
      plaintext: PLAINTEXT,
      uaPublic: UA_PUBLIC,
      authSecret: other,
      asPrivate: AS_PRIVATE,
      asPublic: AS_PUBLIC,
      salt: SALT,
    });
    expect(base64UrlEncode(result.body)).not.toBe(b64url(EXPECTED_BODY));
  });
});

describe('边界与拒绝', () => {
  const base = {
    plaintext: PLAINTEXT,
    uaPublic: UA_PUBLIC,
    authSecret: AUTH_SECRET,
    asPrivate: AS_PRIVATE,
    asPublic: AS_PUBLIC,
    salt: SALT,
  };

  it('不收 falsy 的 AuthSecret 长度（16 字节是 RFC 的硬要求）', () => {
    expect(() => encryptPushPayload({ ...base, authSecret: Buffer.alloc(15) })).toThrow(/16 字节/);
  });

  it('不收压缩点（33 字节）—— 只接受 65 字节未压缩点', () => {
    expect(() => encryptPushPayload({ ...base, uaPublic: Buffer.alloc(33) })).toThrow(/65 字节/);
  });

  /**
   * 🔴 `recordSize` 必须**严格大于** `明文 + 1 + 16`。
   *
   * 写 `>=` 的后果很隐蔽：正好相等时接收端会认为"还有下一块"，
   * 于是它等一个永远不来的记录 —— 症状是**推送超时**，而不是解密失败。
   */
  it('🔴 recordSize 恰好等于 明文+17 时拒绝（边界必须是严格大于）', () => {
    expect(() =>
      encryptPushPayload({ ...base, recordSize: PLAINTEXT.length + 1 + 16 }),
    ).toThrow(/必须大于/);
  });

  it('recordSize 比明文+17 大 1 就放行', () => {
    expect(() =>
      encryptPushPayload({ ...base, recordSize: PLAINTEXT.length + 1 + 16 + 1 }),
    ).not.toThrow();
  });

  /** 超限时**抛**，不截断 —— 截断出来的 JSON 解不开，而报错会指向密钥。 */
  it('🔴 明文超上限时抛，不静默截断', () => {
    expect(() =>
      encryptPushPayload({ ...base, plaintext: Buffer.alloc(PUSH_MAX_PLAINTEXT + 1) }),
    ).toThrow(/上限/);
  });

  it('恰好等于上限时放行（并自动把 recordSize 提到足够大）', () => {
    expect(() =>
      encryptPushPayload({
        ...base,
        plaintext: Buffer.alloc(PUSH_MAX_PLAINTEXT),
        recordSize: 8192,
      }),
    ).not.toThrow();
  });
});

describe('密钥与盐的生成', () => {
  it('每次生成的密钥对都不同，且公钥是 65 字节未压缩点', () => {
    const a = generateServerKeyPair();
    const b = generateServerKeyPair();
    expect(a.publicKey.length).toBe(65);
    expect(a.publicKey[0]).toBe(0x04);
    expect(a.privateKey.length).toBe(32);
    expect(base64UrlEncode(a.publicKey)).not.toBe(base64UrlEncode(b.publicKey));
  });

  it('不传盐时随机生成 16 字节，两次不同', () => {
    const opts = {
      plaintext: PLAINTEXT,
      uaPublic: UA_PUBLIC,
      authSecret: AUTH_SECRET,
      asPrivate: AS_PRIVATE,
      asPublic: AS_PUBLIC,
    };
    const a = encryptPushPayload(opts);
    const b = encryptPushPayload(opts);
    expect(a.header.subarray(0, 16)).toHaveLength(16);
    expect(base64UrlEncode(a.body)).not.toBe(base64UrlEncode(b.body));
  });
});

describe('收到的用户代理公钥必须能算出同一个 ECDH 密钥（反向验证）', () => {
  /**
   * 上面全是从**发送方**看。这一条从**接收方**算一次：
   * 用 ua_private 和 as_public 得出的共享密钥，必须与发送方用
   * as_private 与 ua_public 得出的那个**完全相同**。
   *
   * ⚠️ 这条不是重复 —— 它挡的是"把某一侧的密钥搞混了却仍然自洽"：
   * 只做发送方向量的话，一个把 asPublic 当成 uaPublic 用、
   * 又恰好能配上向量的实现，是可能存在的。
   */
  it('两个方向的 ECDH 结果相同', () => {
    const { createECDH } = require('node:crypto') as typeof import('node:crypto');
    const ua = createECDH('prime256v1');
    ua.setPrivateKey(UA_PRIVATE);
    const fromUa = ua.computeSecret(AS_PUBLIC);

    const as = createECDH('prime256v1');
    as.setPrivateKey(AS_PRIVATE);
    const fromAs = as.computeSecret(UA_PUBLIC);

    expect(base64UrlEncode(fromUa)).toBe(base64UrlEncode(fromAs));
    expect(base64UrlEncode(fromUa)).toBe(ECDH_SECRET);
  });
});

describe('hkdfExpand 的界', () => {
  it('超过 32 字节直接抛（不假装支持多块）', () => {
    expect(() => hkdfExpand(Buffer.alloc(32), Buffer.alloc(0), 33)).toThrow(/一块/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 一个真实的生产 bug：`ecdh.getPrivateKey()` 不是定长 32 字节
// ─────────────────────────────────────────────────────────────────────────────

describe('🔴 P-256 私钥的最短表示陷阱', () => {
  /**
   * 这个 bug 的现场是这样的：单元测试**间歇性**报红
   *（`VAPID 私钥必须是 32 字节，收到 31`），且每次挂的用例不同；
   * 单独重跑又全绿。非常容易被当成 flake 忽略。
   *
   * 但 `generateServerKeyPair()` 在**生产路径**上被 `sendWidgetPush` 用 ——
   * 忽略它等于让约 **0.4%** 的真实推送永远失败，而症状是
   * "极少数用户随机地收不到刷新"。
   *
   * 所以这一组测试**不靠随机撞上**：下面直接把那个条件**构造出来**。
   */
  it('构造出 31 字节的私钥：最高字节为 0 时 Node 会去掉前导零', () => {
    const { createECDH } = require('node:crypto') as typeof import('node:crypto');
    const ecdh = createECDH('prime256v1');

    // 一个合法但最高字节为 0 的 32 字节标量 —— 这正是概率 1/256 的那个分支。
    const full32 = Buffer.concat([Buffer.from([0x00]), Buffer.from(Array.from({ length: 31 }, (_, i) => i + 1))]);
    ecdh.setPrivateKey(full32);

    // ⚠️ 这一条是"陷阱确实存在"的证明：Node 返回的不是 32 字节。
    expect(ecdh.getPrivateKey()).toHaveLength(31);
    expect(ecdh.getPrivateKey().equals(full32)).toBe(false);
  });

  it('padPrivateKey 把它补回 32 字节，且补的是**前导零**', () => {
    const short31 = Buffer.from(Array.from({ length: 31 }, (_, i) => i + 1));
    const padded = padPrivateKey(short31);
    expect(padded).toHaveLength(32);
    expect(padded[0]).toBe(0x00);
    // 补在**前面**才是同一个数。补在后面会得到另一个标量 —— 而那个标量
    // 也能签名，只是推送服务一律拒绝（401），局部完全看不出来。
    expect(padded.subarray(1).equals(short31)).toBe(true);
  });

  it('🔴 补零后 setPrivateKey 得到的公钥与原始 32 字节完全一致', () => {
    const { createECDH } = require('node:crypto') as typeof import('node:crypto');
    const full32 = Buffer.concat([Buffer.from([0x00]), Buffer.from(Array.from({ length: 31 }, (_, i) => 200 - i))]);

    const a = createECDH('prime256v1');
    a.setPrivateKey(full32);

    const b = createECDH('prime256v1');
    // 模拟"从 Node 的裸输出恢复"：先拿到 31 字节，再补零。
    const short = (() => {
      const probe = createECDH('prime256v1');
      probe.setPrivateKey(full32);
      return probe.getPrivateKey();
    })();
    expect(short).toHaveLength(31);
    b.setPrivateKey(padPrivateKey(short));

    // 公钥相同 ⇒ 是同一个标量。补错方向的话这里会不同。
    expect(a.getPublicKey().equals(b.getPublicKey())).toBe(true);
  });

  it('已经是 32 字节时原样返回（不产生多余拷贝语义）', () => {
    const full32 = Buffer.alloc(32, 7);
    expect(padPrivateKey(full32).equals(full32)).toBe(true);
  });

  it('超过 32 字节时报错，而不是悄悄截断', () => {
    expect(() => padPrivateKey(Buffer.alloc(33))).toThrow(/超过 32 字节/);
  });

  it('🔴 generateServerKeyPair 跑 300 次，私钥**每次**都是 32 字节', () => {
    // 300 次覆盖"1/256 那个分支"的概率约 1-(255/256)^300 ≈ 69%。
    // ⚠️ 所以这一条**不是**主要防线（上面那几条构造式的才是）——
    //    它的作用是保证这个不变量在端到端路径上也成立。
    for (let i = 0; i < 300; i += 1) {
      const kp = generateServerKeyPair();
      expect(kp.privateKey).toHaveLength(32);
      expect(kp.publicKey).toHaveLength(65);
    }
  });
});
