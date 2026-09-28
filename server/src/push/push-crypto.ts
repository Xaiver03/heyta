/**
 * Web Push 载荷加密（RFC 8291 `aes128gcm`，内含 RFC 8188 的内容编码）。
 * ==================================================================
 *
 * ## 🔴 为什么是自研而不是 `web-push`
 *
 * 三个理由，按重要性排：
 *
 * 1. **许可证与依赖门槛**：仓库 §3.1/§3.2 要求每个依赖逐项登记 + 查维护状态。
 *    这一条链（VAPID JWT + P-256 ECDH + HKDF + AES-128-GCM）**全部在 Node 内建
 *    `crypto` 里**，引入一个包换来的是零能力。
 * 2. **这一份有外部判据**：RFC 8291 §5 附了**完整测试向量**（连 Appendix A 的
 *    每一个中间值都有）。自研最怕的是"自己验自己" —— 而这里不是，
 *    `push-crypto.spec.ts` 拿的是 RFC 的固定输入输出。
 * 3. **载荷不透明**：这里进去的是**已经加密好的快照信封**（E2EE），
 *    服务端多一个能读它的库就多一份说不清的东西。
 *
 * ## ⚠️ 这一层**不做**的事
 *
 * - **不碰密钥**：调用者给的是明文字节，返回值是密文字节。设备密钥、
 *   用户口令、Argon2id 全都不在这里，也永远不该进来。
 * - **不做分片**：RFC 8291 §4 规定推送**只能一条记录**。所以这里写死单记录，
 *   而且 `rs` 必须大于 `明文 + 1 + 16`。多记录是收端的事，我们不产生。
 */

import { createCipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';

/** RFC 8188 §2.1 固定 16 字节盐。 */
export const PUSH_SALT_BYTES = 16;

/**
 * 记录大小。
 *
 * ⚠️ **必须**大于 `明文长度 + 1（分隔符）+ 16（tag）`，否则接收端会认为
 * 还有后续记录而去读一个不存在的块。4096 是 RFC 8291 §4 里用的值，
 * 也是"推送服务只保证支持 4096 字节请求体"那个上限 —— 所以它同时是
 * **单条推送的实际上限**：明文超过约 3993 字节就必须自己分片，
 * 而分片之后就不再是 RFC 8291 保证能收的形态了。
 */
export const PUSH_RECORD_SIZE = 4096;

/**
 * 单条推送能带的**明文上限**（RFC 8291 §4 推出的 3993 的保守取值）。
 *
 * 🔴 超了**抛异常**，不截断、不分片。截断会让接收端拿到一段
 * 看起来合法、实际少了一半的 JSON —— 而它解不开时会以为是密钥问题。
 */
export const PUSH_MAX_PLAINTEXT = 3993;

/** 我们支持的唯一内容编码。写成常量是因为"只允许一个值"本身是 RFC 的规定。 */
export const PUSH_CONTENT_ENCODING = 'aes128gcm';

/** base64url（无填充）——Web Push / JWT 全程用这个，不是普通 base64。 */
export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function base64UrlDecode(text: string): Buffer {
  return Buffer.from(text, 'base64url');
}

/**
 * HKDF-Extract + HKDF-Expand（RFC 5869），SHA-256。
 *
 * ⚠️ 自己写而不是用 `crypto.hkdfSync` 是**故意的**：RFC 8291 的推导里有
 * **两次**取值（先 `PRK_key` 再由它出 `IKM`），而 Appendix A 把每一步的
 * 中间值都列了出来。分成两个函数之后，我可以**逐个中间值断言** ——
 * 一个黑盒的 `hkdfSync` 只能验最后的结果，中间错一步就定位不到。
 */
export function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return createHmac('sha256', salt).update(ikm).digest();
}

export function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  // RFC 5869 §2.3：T(1) = HMAC(PRK, info || 0x01)。这里只需要第一块
  // （所有取值都 <= 32 字节 = SHA-256 输出长度），所以不写多块循环 ——
  // 写一个永远只跑一轮的循环，只会让人以为它支持更长的输出。
  if (length > 32) {
    throw new Error(`hkdfExpand 只需要一块（<= 32 字节），收到 ${length}`);
  }
  return createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([0x01])]))
    .digest()
    .subarray(0, length);
}

/** RFC 8291 §3.3：把 ECDH 共享密钥与认证密钥合成 IKM。 */
export function deriveIkm(params: {
  ecdhSecret: Buffer;
  authSecret: Buffer;
  uaPublic: Buffer;
  asPublic: Buffer;
}): Buffer {
  const prkKey = hkdfExtract(params.authSecret, params.ecdhSecret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info', 'ascii'),
    Buffer.from([0x00]),
    params.uaPublic,
    params.asPublic,
  ]);
  return hkdfExpand(prkKey, keyInfo, 32);
}

/** RFC 8188 §2.2–2.3：从 IKM 导出 CEK 与 NONCE。 */
export function deriveCekAndNonce(salt: Buffer, ikm: Buffer): { cek: Buffer; nonce: Buffer } {
  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\u0000', 'ascii'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\u0000', 'ascii'), 12);
  return { cek, nonce };
}

/** 加密所需的全部输入。**全是字节**，所以这个函数不依赖任何 I/O，能直接测。 */
export interface EncryptInput {
  /** 明文（对 heyta 来说就是已经密封好的快照信封 JSON 的字节）。 */
  plaintext: Buffer;
  /** 用户代理（浏览器）的 P-256 公钥，65 字节未压缩点。 */
  uaPublic: Buffer;
  /** 用户代理给的 16 字节认证密钥。 */
  authSecret: Buffer;
  /** 应用服务器这一次用的 P-256 私钥，32 字节。 */
  asPrivate: Buffer;
  /** 对应的公钥，65 字节未压缩点。 */
  asPublic: Buffer;
  /** 16 字节盐。**不传就随机**；测试里必须传（RFC 向量是固定值）。 */
  salt?: Buffer;
  recordSize?: number;
}

/** 一次加密的完整产物。把中间值一起返回，是为了让测试能逐个比对 RFC 的 Appendix A。 */
export interface EncryptResult {
  /** RFC 8188 内容编码头：`salt || rs(4) || idlen(1) || keyid`。 */
  header: Buffer;
  /** 密文（含 GCM tag）。 */
  ciphertext: Buffer;
  /** `header || ciphertext` —— 这就是请求体的全部。 */
  body: Buffer;
  /** 中间值，**只为测试与排查**，绝不能记进日志（有密钥材料）。 */
  intermediate: {
    ecdhSecret: Buffer;
    ikm: Buffer;
    cek: Buffer;
    nonce: Buffer;
  };
}

/**
 * 加密一条推送（RFC 8291 单记录）。
 *
 * 抛出的两个错误都是**调用方写错了**，不是运行时故障：明文超限、公钥长度不对。
 * 所以这里抛异常而不是返回 `Result` —— 静默降级的形态（"那就截断吧"）比崩溃坏得多。
 */
export function encryptPushPayload(input: EncryptInput): EncryptResult {
  const recordSize = input.recordSize ?? PUSH_RECORD_SIZE;

  if (input.uaPublic.length !== 65) {
    throw new Error(`uaPublic 必须是 65 字节未压缩点，收到 ${input.uaPublic.length}`);
  }
  if (input.asPublic.length !== 65) {
    throw new Error(`asPublic 必须是 65 字节未压缩点，收到 ${input.asPublic.length}`);
  }
  if (input.authSecret.length !== 16) {
    throw new Error(`authSecret 必须是 16 字节，收到 ${input.authSecret.length}`);
  }
  // 🔴 +1 是填充分隔符（0x02），+16 是 GCM tag。少算任何一个都会在**接收端**
  //    报"记录没结束"，而错误信息不会提到我们这里。
  if (recordSize <= input.plaintext.length + 1 + 16) {
    throw new Error(
      `recordSize(${recordSize}) 必须大于 明文(${input.plaintext.length}) + 分隔符(1) + tag(16)`,
    );
  }
  if (input.plaintext.length > PUSH_MAX_PLAINTEXT) {
    throw new Error(
      `明文 ${input.plaintext.length} 字节超过单条推送上限 ${PUSH_MAX_PLAINTEXT} —— ` +
        '这一层不做分片（RFC 8291 §4 只保证单记录）',
    );
  }

  const salt = input.salt ?? randomBytes(PUSH_SALT_BYTES);
  if (salt.length !== PUSH_SALT_BYTES) {
    throw new Error(`salt 必须是 ${PUSH_SALT_BYTES} 字节，收到 ${salt.length}`);
  }

  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(input.asPrivate);
  const ecdhSecret = ecdh.computeSecret(input.uaPublic);

  const ikm = deriveIkm({
    ecdhSecret,
    authSecret: input.authSecret,
    uaPublic: input.uaPublic,
    asPublic: input.asPublic,
  });
  const { cek, nonce } = deriveCekAndNonce(salt, ikm);

  // RFC 8188 §2.1：salt(16) || rs(4, 大端) || idlen(1) || keyid
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(recordSize, 0);
  const header = Buffer.concat([salt, rs, Buffer.from([input.asPublic.length]), input.asPublic]);

  // RFC 8188 §2：单记录的最后一块，填充分隔符是 0x02（不是 0x01）。
  const padded = Buffer.concat([input.plaintext, Buffer.from([0x02])]);

  // 🔴 **AAD 是空的** —— 这一条是拿 RFC 8291 的向量实测出来的，不是从文档推的。
  //
  //    我第一版按"内容编码头即附加数据"的直觉写了 `setAAD(header)`，结果：
  //    **密文前 42 字节逐字节相同，只有 16 字节 GCM tag 不同**。
  //    这个形状本身就说明了结论 —— GCM 是流密码，密文相同意味着明文与
  //    keystream 都对（也就是 CEK/NONCE 都对）；唯一能改变 tag 的输入只剩 AAD。
  //    于是把候选逐个跑了一遍：
  //
  //    | 候选 AAD | tag |
  //    |---|---|
  //    | **空** | ✅ 与 RFC 一致 |
  //    | 完整 header（86B） | ❌ |
  //    | rs\|\|idlen\|\|keyid | ❌ |
  //    | salt\|\|rs\|\|idlen | ❌ |
  //    | idlen\|\|keyid | ❌ |
  //
  //    header 的作用是**两个**：把 `salt` 送过去（密钥推导）和把服务器公钥送过去
  //    （ECDH）。它**不**参与完整性校验。
  //
  //    ⚠️ 这个错**唯一**能被发现的途径就是对着 RFC 的密文比对 ——
  //    自己加密自己解密时，收发两侧用同一个错 AAD，往返永远成功。
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  return {
    header,
    ciphertext,
    body: Buffer.concat([header, ciphertext]),
    intermediate: { ecdhSecret, ikm, cek, nonce },
  };
}

/**
 * 把裸私钥左补零到固定 32 字节。
 *
 * 🔴 **`ecdh.getPrivateKey()` 返回的是最短大端表示，不是定长 32 字节。**
 *
 * 这不是理论问题：P-256 的私钥是一个 256 位标量，当它的最高字节恰好是
 * `0x00` 时，Node 会**去掉那个前导零**并返回 **31 字节** —— 概率约 1/256。
 *
 * 不补零的后果有两个，而且第二个是**生产故障**（不只是测试会红）：
 *
 * 1. 补零前 `privateKeyObject` 会拒绝它（"必须是 32 字节，收到 31"），
 *    于是**约 0.4% 的真实推送直接抛错**；
 * 2. 更阴的是：如果不做长度校验而直接拼 PKCS#8 前缀，那 31 字节会**错位** ——
 *    得到的私钥是另一个数，签名能产出、但推送服务一律拒绝（401）。
 *
 * ⚠️ 这个 bug 在单元测试里的表现是**间歇性的**（每次运行生成十几个密钥对，
 * 于是几次运行才红一次），非常容易被当成 flake 忽略掉 ——
 * 而它的真实后果是"极少数用户随机地永远收不到刷新"。
 */
export function padPrivateKey(raw: Buffer): Buffer {
  if (raw.length > 32) {
    throw new Error(`P-256 私钥不应超过 32 字节，收到 ${raw.length}`);
  }
  if (raw.length === 32) return raw;
  // 左补零：大端表示下补在**前面**才是同一个数。
  return Buffer.concat([Buffer.alloc(32 - raw.length, 0), raw]);
}

/** 生成一次性的应用服务器密钥对。每次推送都换一对（RFC 8291 §3.1）。 */
export function generateServerKeyPair(): { privateKey: Buffer; publicKey: Buffer } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKey: padPrivateKey(ecdh.getPrivateKey()),
    publicKey: ecdh.getPublicKey(),
  };
}
