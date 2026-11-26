/**
 * TOTP（RFC 6238）—— 纯函数实现，用平台 `crypto.subtle`
 * ======================================================
 *
 * 补的是登录 2FA 格 #62 的 TOTP 一档。**不引第三方库**（AGENTS §3.1/§3.2）：
 * 只需要 HMAC-SHA1，而它由浏览器 / Node 内置的 WebCrypto 提供。
 *
 * 分层（AGENTS §3.5）：本文件只做**算法**，没有任何网络、状态或界面代码。
 * 绑定、校验与"是否对账号生效"最终应由服务端裁决 —— 当前这一步只做**本地验证性实现**，
 * 见 `features/settings/TotpPanel.tsx` 的面板说明。
 *
 * ## 算法
 *
 * RFC 6238 §1.2：`TOTP = HOTP(K, floor((now - T0) / X))`，`T0 = 0`、`X = 30s`；
 * HOTP（RFC 4226 §5.3）取 HMAC-SHA1 的最后 4 位做动态截断后 `mod 10^digits`。
 * 密钥以 **base32**（RFC 4648，无填充）承载 —— 这是 otpauth URI 的标准编码。
 */

/** base32 字母表（RFC 4648）。 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** base32 解码（忽略空格与 `=` 填充；大小写不敏感）。非法字符抛错。 */
export function decodeBase32(input: string): Uint8Array {
  const clean = input.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error(`base32: illegal char ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** base32 编码（无填充，便于展示给用户手动录入）。 */
export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** 生成随机 base32 密钥（默认 20 字节 = 160 bit，RFC 4226 推荐长度）。 */
export function generateSecret(byteLength = 20): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return encodeBase32(bytes);
}

/** 8 字节大端计数器（HOTP 的 `C`）。 */
function counterBytes(counter: number): Uint8Array {
  const out = new Uint8Array(8);
  let n = counter;
  for (let i = 7; i >= 0; i -= 1) {
    out[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return out;
}

/** 用 WebCrypto 算 HMAC（`hash` 只服务于 RFC 4226 的 SHA-1）。 */
async function hmac(hash: 'SHA-1', key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error('crypto.subtle unavailable');
  // TS 5.7 起 `Uint8Array` 的 buffer 类型是 `ArrayBufferLike`（可能 SharedArrayBuffer），
  // 而 WebCrypto 的 `BufferSource` 要求 `ArrayBuffer` —— 这里是运行时安全的窄化。
  const keyData = key as unknown as BufferSource;
  const messageData = message as unknown as BufferSource;
  const cryptoKey = await subtle.importKey('raw', keyData, { name: 'HMAC', hash }, false, ['sign']);
  const sig = await subtle.sign('HMAC', cryptoKey, messageData);
  return new Uint8Array(sig);
}

export interface TotpOptions {
  /** 位数，默认 6（otpauth 常见）。 */
  readonly digits?: number;
  /** 时间步长（秒），默认 30。 */
  readonly period?: number;
}

/**
 * 生成某一时刻的 TOTP 码。
 *
 * @param secretBase32 base32 密钥
 * @param timeMs       毫秒时间戳（`Date.now()`）
 */
export async function generateTotp(
  secretBase32: string,
  timeMs: number,
  options: TotpOptions = {},
): Promise<string> {
  const digits = options.digits ?? 6;
  const period = options.period ?? 30;
  const counter = Math.floor(timeMs / 1000 / period);
  const mac = await hmac('SHA-1', decodeBase32(secretBase32), counterBytes(counter));
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * 校验一个 TOTP 码是否匹配，允许 `window` 个时间步的时钟漂移（默认前后各 1 步 = ±30s）。
 * 比较用**常量时间**（逐字符异或），避免早退泄漏前缀是否匹配。
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  timeMs: number,
  options: TotpOptions & { readonly window?: number } = {},
): Promise<boolean> {
  const digits = options.digits ?? 6;
  const period = options.period ?? 30;
  const window = options.window ?? 1;
  const normalized = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return false;
  const step = Math.floor(timeMs / 1000 / period);
  let matched = 0;
  for (let delta = -window; delta <= window; delta += 1) {
    const candidate = await generateTotp(secretBase32, (step + delta) * period * 1000, { digits, period });
    matched |= constantTimeEqual(candidate, normalized) ? 1 : 0;
  }
  return matched === 1;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 距离当前码失效还剩多少秒（0..period）。给面板画倒计时用。 */
export function secondsRemaining(timeMs: number, period = 30): number {
  const elapsed = Math.floor(timeMs / 1000) % period;
  return period - elapsed;
}
