import { gcm } from '@noble/ciphers/aes.js';
import { WebCryptoNotAvailableError } from '../web-crypto-error';

export const ALGORITHM = 'AES-GCM' as const;
export const SALT_LENGTH = 16;
export const IV_LENGTH = 12;
export const KEY_LENGTH = 32;

/**
 * `TextEncoder` / `TextDecoder` 的**惰性**获取。
 *
 * 🔴 原来这里是模块顶层的 eager 求值：
 *
 *     export const TEXT_ENCODER = new TextEncoder();
 *     export const TEXT_DECODER = new TextDecoder();
 *
 * 后果是**只要 import 这个模块就崩**，哪怕当前流程根本不需要编解码。
 * 真机实测（小米 Android 16 / Hermes，点"添加任务"时）：
 *
 *     ReferenceError: Property 'TextDecoder' doesn't exist
 *     FATAL EXCEPTION: mqt_v_native
 *     崩溃位置: loadModuleImplementation ← 模块加载期，不是调用期
 *
 * Hermes 实测的全局量分布很不对称：
 *
 *     TextEncoder      function     ✅ 有
 *     TextDecoder      undefined    ❌ 没有
 *     crypto           undefined    ❌ 完全没有（getRandomValues / subtle / randomUUID 全无）
 *     atob / btoa      function     ✅ 有
 *
 * 所以 `new TextEncoder()` 能过、`new TextDecoder()` 立刻炸 —— 报错只提到后者。
 * 依赖运行时的全局量时，**"有没有"必须查过再说**，不能假定成对出现。
 *
 * 改成惰性有两个好处：
 * 1. 模块能被安全 import（`compression.ts` 早就是这个写法，这里只是对齐）；
 * 2. 真缺的时候报的是**清楚的错误**，而不是一个指向 import 语句的 ReferenceError。
 *
 * ⚠️ 惰性只是让失败可诊断，**不解决问题本身**。RN 宿主仍然必须装
 * `fast-text-encoding` 与 `react-native-get-random-values` 两个 polyfill
 * （见 `apps/mobile/index.js` 顶部）。
 */
/**
 * ⚠️ 返回类型用 **DOM 的 `TextEncoder` / `TextDecoder`**，不要自己写窄接口。
 * 我一开始写成 `{ decode(input: Uint8Array): string }`，结果调用方传的是
 * `ArrayBuffer`，`tsc` 立刻报了一串"缺少 24 个属性" —— 真实的 DOM 签名是
 * `decode(input?: BufferSource): string`，比手写的宽。
 * 手写窄接口 = 用自己的猜测替换标准定义，只会制造假错误。
 */
const getRequiredGlobal = <T>(name: string, value: T | undefined): T => {
  if (value === undefined) {
    throw new WebCryptoNotAvailableError(
      `${name} is not available in this runtime. ` +
        `React Native (Hermes) lacks it — install the platform polyfill in the host shell.`,
    );
  }
  return value;
};

/**
 * 惰性构造并**记住**实例。
 *
 * 返回实例（不是构造函数），所以调用点是 `getTextEncoder().encode(x)` ——
 * 与原先 `TEXT_ENCODER.encode(x)` 逐字相近。记忆化保证"惰性"不会退化成
 * "每次调用都新建一个"。
 */
let textEncoder: TextEncoder | undefined;
let textDecoder: TextDecoder | undefined;

export const getTextEncoder = (): TextEncoder => {
  textEncoder ??= new (getRequiredGlobal(
    'TextEncoder',
    (globalThis as { TextEncoder?: typeof TextEncoder }).TextEncoder,
  ))();
  return textEncoder;
};

export const getTextDecoder = (): TextDecoder => {
  textDecoder ??= new (getRequiredGlobal(
    'TextDecoder',
    (globalThis as { TextDecoder?: typeof TextDecoder }).TextDecoder,
  ))();
  return textDecoder;
};

// Minimum sizes for format detection
// Argon2: [SALT (16)][IV (12)][CIPHERTEXT + AUTH_TAG (min 16)] = 44 bytes
// Legacy: [IV (12)][CIPHERTEXT + AUTH_TAG (min 16)] = 28 bytes
const MIN_ARGON2_SIZE = SALT_LENGTH + IV_LENGTH + 16;
const MIN_LEGACY_SIZE = IV_LENGTH + 16;

const getRequiredCrypto = (): Crypto => {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi === undefined) {
    throw new WebCryptoNotAvailableError('Crypto API is not available');
  }
  return cryptoApi;
};

export const getRequiredSubtle = (): SubtleCrypto => {
  const subtle = getRequiredCrypto().subtle;
  if (subtle === undefined) {
    throw new WebCryptoNotAvailableError();
  }
  return subtle;
};

/**
 * Checks if WebCrypto API (crypto.subtle) is available in the current context.
 * Returns false in insecure contexts (http://, some custom schemes like Android Capacitor).
 */
export const isCryptoSubtleAvailable = (): boolean => {
  return (globalThis as { crypto?: Crypto }).crypto?.subtle !== undefined;
};

export const getRandomBytes = (length: number): Uint8Array<ArrayBuffer> =>
  getRequiredCrypto().getRandomValues(new Uint8Array(length));

// ============================================================================
// AES-GCM PRIMITIVES
// ============================================================================
// One branch on isCryptoSubtleAvailable() per call. WebCrypto's importKey is
// ~10μs, dwarfed by the surrounding Argon2id derivation (~500ms+ on mobile).

/**
 * `aad` 是**可选**的追加认证数据（AEAD 的 "associated data"）。
 *
 * ## 为什么现在才加
 *
 * 本仓的同步加密不需要 AAD：它的密文自带盐与前缀、结构上已经自证。
 * 但**小组件快照契约需要** —— 信封里的 `v` / `dayStr` / `validUntil` 是
 * **明文传输**的（组件要在拿不到密钥时也能判断"过期了"），所以它们必须被
 * **密码学绑定**进去，否则有人把 `validUntil` 改成一年后，组件就会
 * 一直显示一份早已过期的"今天"。AAD 正是干这个的。
 *
 * 加默认参数而不是新函数：网上已经有太多"两套 AES 实现"的事故，
 * 本仓不该再添一套 —— 而且 `crypto.subtle` 分支与 `@noble` 分支的 AAD 语义
 * 必须**完全一致**，写在同一个函数里才有可能一眼看出不一致。
 */
export const aesEncrypt = async (
  keyBytes: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> => {
  if (isCryptoSubtleAvailable()) {
    const subtle = getRequiredSubtle();
    const key = await subtle.importKey(
      'raw',
      keyBytes.buffer as ArrayBuffer,
      { name: ALGORITHM },
      false,
      ['encrypt'],
    );
    const out = await subtle.encrypt(
      {
        name: ALGORITHM,
        iv: iv as Uint8Array<ArrayBuffer>,
        // ⚠️ 不传 `additionalData` 与传 `undefined` 在有些实现里不等价，
        // 所以这里显式分支，只在真的有 AAD 时才放进算法参数对象。
        ...(aad ? { additionalData: aad as Uint8Array<ArrayBuffer> } : {}),
      },
      key,
      data as Uint8Array<ArrayBuffer>,
    );
    return new Uint8Array(out);
  }
  return gcm(keyBytes, iv, aad).encrypt(data);
};

export const aesDecrypt = async (
  keyBytes: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> => {
  if (isCryptoSubtleAvailable()) {
    const subtle = getRequiredSubtle();
    const key = await subtle.importKey(
      'raw',
      keyBytes.buffer as ArrayBuffer,
      { name: ALGORITHM },
      false,
      ['decrypt'],
    );
    const out = await subtle.decrypt(
      {
        name: ALGORITHM,
        iv: iv as Uint8Array<ArrayBuffer>,
        ...(aad ? { additionalData: aad as Uint8Array<ArrayBuffer> } : {}),
      },
      key,
      data as Uint8Array<ArrayBuffer>,
    );
    return new Uint8Array(out);
  }
  return gcm(keyBytes, iv, aad).decrypt(data);
};

// ============================================================================
// BASE64 UTILITIES
// ============================================================================
// Chunked String.fromCharCode avoids the O(n) intermediate Array of single-char
// strings that .map(...).join('') produces. ~10x faster for large blobs.

const BASE64_CHUNK = 0x8000;

export const decodeBase64 = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

export const encodeBase64 = (buffer: ArrayBuffer | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
};

export const detectFormat = (
  dataBuffer: ArrayBuffer,
): 'argon2' | 'legacy' | 'invalid' => {
  if (dataBuffer.byteLength >= MIN_ARGON2_SIZE) {
    return 'argon2';
  } else if (dataBuffer.byteLength >= MIN_LEGACY_SIZE) {
    return 'legacy';
  }
  return 'invalid';
};

/**
 * Returns an injective string identifier for a password, used as a cache-map
 * key (and as a prefix in decrypt-cache keys like `${id}:${saltBase64}`).
 *
 * Length-prefixed so concatenation stays unambiguous even if the password
 * contains the `:` separator used downstream. Holding the password verbatim
 * is safe: these caches live in-memory in the same process that already holds
 * the plaintext password.
 *
 * Earlier versions used a 32-bit djb2 hash; collisions would silently return
 * a key derived from a different password, producing undecryptable ciphertext.
 */
export const hashPasswordForCache = (password: string): string => {
  return `${password.length}:${password}`;
};
