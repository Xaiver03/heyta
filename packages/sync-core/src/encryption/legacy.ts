import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  IV_LENGTH,
  KEY_LENGTH,
  aesDecrypt,
  getTextDecoder,
  getTextEncoder,
  decodeBase64,
  getRequiredSubtle,
  hashPasswordForCache,
  isCryptoSubtleAvailable,
} from './web-crypto';

// ============================================================================
// LEGACY KDF WARNING HANDLER
// ============================================================================
// PBKDF2-with-password-as-salt is cryptographically weak. When legacy
// ciphertext is decrypted, hosts can register a handler to surface a
// deprecation signal to users (e.g. "consider re-syncing to migrate").

type LegacyKdfWarningHandler = () => void;
let _legacyKdfWarningHandler: LegacyKdfWarningHandler | null = null;

/**
 * Registers a handler invoked after a successful legacy PBKDF2 decryption.
 * Pass `null` to unregister. The host is responsible for de-duplicating /
 * throttling user-facing messages — the handler may fire on every legacy
 * decrypt.
 */
export const setLegacyKdfWarningHandler = (
  handler: LegacyKdfWarningHandler | null,
): void => {
  _legacyKdfWarningHandler = handler;
};

// ============================================================================
// LEGACY PBKDF2 KEY CACHE
// ============================================================================

/** 参数是**线格式契约**的一部分，改了就读不懂历史密文。 */
const LEGACY_PBKDF2_ITERATIONS = 1000;

const sessionLegacyKeyCache = new Map<string, Uint8Array>();

/** Clears the legacy PBKDF2 key cache. Called by clearSessionKeyCache(). */
export const clearLegacyKeyCache = (): void => {
  sessionLegacyKeyCache.clear();
};

/**
 * 派生 legacy 格式的 32 字节密钥。
 *
 * 🔴 **这里必须有两条实现，理由与 `argon2.ts` 里的后端选择逐字相同。**
 *
 * 原来只有一条：`crypto.subtle` 的 PBKDF2。于是 **Hermes（RN 的 JS 引擎）
 * 没有 `crypto.subtle`** 时，这条路径直接抛 `WebCryptoNotAvailableError`，
 * 提示用户"请先在桌面浏览器上同步一次"。
 *
 * 实测（iPhone 17 Pro 模拟器，iOS 26.5）暴露了这个提示的真实代价：
 * **服务端上只要有一条历史 op 还是 legacy 格式，整次下载就会失败** ——
 * 不是那一条解不开，而是同步在那一条上抛异常、后面的 op 一条都应用不上。
 * 手机永远停在「同步失败」，而它自己的数据**是传得上去的**。
 * 用户看到的是"多端同步不工作"，方向会被带到同步协议上去。
 *
 * 而这条路径**完全可以纯 JS 实现**：PBKDF2-HMAC-SHA256 与 AES-GCM
 * `@noble/*` 两个包都提供了，而且它们**已经是本包的依赖**
 * （`argon2.ts` 与 `web-crypto.ts` 早就在用）。少的不能力，是那条兜底腿。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * **为什么纯 JS 是正确兜底，而不是"降级后可能算错"**
 *
 * 两种实现在生产参数（password-as-salt、1000 轮、SHA-256、dkLen 32）下
 * 比对过**逐字节相同**：
 *
 *     761616d73b9cbd8c8a2ec56c73ea613fe59661d0a6d11dca4018eb917a72c553
 *
 * 这条向量被 `tests/encryption.spec.ts` 的「legacy KDF backend」用例钉住，
 * **两种后端都要过它**。所以兜底换掉的是**速度**，不是**语义** ——
 * 与 Argon2 那边是同一条纪律。
 *
 * 速度上的代价很小：1000 轮 PBKDF2 在纯 JS 下是毫秒量级，
 * 与 Argon2id 的数十秒完全不是一个量级。
 */
const getOrDeriveLegacyKey = async (password: string): Promise<Uint8Array> => {
  const passwordHash = hashPasswordForCache(password);
  const cached = sessionLegacyKeyCache.get(passwordHash);
  if (cached) {
    return cached;
  }

  const passwordBytes = getTextEncoder().encode(password);

  let keyBytes: Uint8Array;
  if (isCryptoSubtleAvailable()) {
    const subtle = getRequiredSubtle();
    const keyMaterial = await subtle.importKey(
      'raw',
      passwordBytes,
      { name: 'PBKDF2' },
      false,
      ['deriveBits'],
    );
    const bits = await subtle.deriveBits(
      {
        name: 'PBKDF2',
        // Using password as salt is insecure but kept for backward compatibility.
        salt: passwordBytes,
        iterations: LEGACY_PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      KEY_LENGTH * 8,
    );
    keyBytes = new Uint8Array(bits);
  } else {
    // `c` 是轮数、`dkLen` 是密钥字节数 —— 与上面 WebCrypto 的参数逐一对应。
    // 这个映射不是猜的：它由上面的已知答案向量钉住。
    keyBytes = pbkdf2(sha256, passwordBytes, passwordBytes, {
      c: LEGACY_PBKDF2_ITERATIONS,
      dkLen: KEY_LENGTH,
    });
  }

  sessionLegacyKeyCache.set(passwordHash, keyBytes);
  return keyBytes;
};

/**
 * Decrypts data produced by the legacy PBKDF2 format (kept for backward
 * compatibility).
 *
 * AES-GCM 走 `aesDecrypt`，它本身就有 `@noble/ciphers` 的兜底 ——
 * 所以这个函数在**没有任何 WebCrypto 的运行时**里也能完整跑完。
 */
export const decryptLegacy = async (data: string, password: string): Promise<string> => {
  const dataBuffer = decodeBase64(data);
  const iv = new Uint8Array(dataBuffer, 0, IV_LENGTH);
  const encryptedData = new Uint8Array(dataBuffer, IV_LENGTH);
  const keyBytes = await getOrDeriveLegacyKey(password);
  const decryptedContent = await aesDecrypt(keyBytes, iv, encryptedData);

  _legacyKdfWarningHandler?.();
  return getTextDecoder().decode(decryptedContent);
};
