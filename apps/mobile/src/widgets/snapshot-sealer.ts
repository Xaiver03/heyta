import {
  aesDecrypt,
  aesEncrypt,
  decodeBase64,
  encodeBase64,
  getRandomBytes,
} from '@heyta/sync-core';
import { envelopeAad, type SnapshotDecryptor, type SnapshotSealer, type WidgetEnvelope } from '@heyta/widget-core';

/**
 * 小组件快照在 **JS 侧**的加解密适配器 —— 把 `@heyta/widget-core` 的契约
 * 接到 `@heyta/sync-core` 的那**唯一一份** AES-GCM 上。
 *
 * ## 为什么只有这一层，而没有第二份 AES
 *
 * 契约把密码学做成**注入**的（`SnapshotSealer` / `SnapshotDecryptor`），
 * 于是很自然的诱惑是"在移动端引个 AES 库自己写一个"。那会在本仓出现**第二份
 * AES-GCM 实现**，而两份实现最难查的不是"哪份错了"，是
 * **它们对 AAD / tag 长度的默认值不一样** —— 症状是"iOS 能解、Android 解不开"，
 * 在组件上只表现为"没有数据"。所以这里复用 `sync-core` 已有的那一份。
 *
 * ## 为什么写在这里而不是 `packages/`
 *
 * 密钥的来源与生命周期是**壳的事**：Android 走 Keystore、iOS 走共享 Keychain、
 * 桌面走 OS keychain。本文件只负责"给我一把密钥，我把它变成一次 AES-GCM"，
 * 不决定密钥从哪来。
 */

/** GCM 的 nonce 长度。**12 字节是 GCM 的标准长度**，四端必须一致。 */
export const WIDGET_NONCE_BYTES = 12;

/** AES-256 的密钥长度。四端必须一致 —— 长度不对时**当场拒绝**，不要等解密失败。 */
export const WIDGET_KEY_BYTES = 32;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * 密钥长度不对时**立刻抛**。
 *
 * 不这么做的话，`aesEncrypt` 会拿着一个 16 字节的密钥当 AES-128 用、
 * 或者抛出一个看不出所以然的底层错误。症状会变成"组件没数据"，
 * 而真正的原因（密钥来源那一侧给错了长度）被埋在两层之下。
 */
function assertKeyLength(deviceKey: Uint8Array): void {
  if (deviceKey.length !== WIDGET_KEY_BYTES) {
    throw new Error(
      `小组件设备密钥必须是 ${WIDGET_KEY_BYTES} 字节（AES-256），收到 ${deviceKey.length} 字节`,
    );
  }
}

/**
 * 造一个封包器。
 *
 * ⚠️ **nonce 每次调用重新取**。这不是"顺手写上"：GCM 下 nonce 重用会让两段密文的
 * 异或泄露、并直接破坏认证 —— 是密码学上最经典的致命误用之一。
 * 所以 nonce 的生成放在**离 RNG 最近的这一层**，而不是让调用方传进来。
 */
export function createWidgetSealer(deviceKey: Uint8Array): SnapshotSealer {
  assertKeyLength(deviceKey);
  return async ({ aad, plaintext }) => {
    const nonce = getRandomBytes(WIDGET_NONCE_BYTES);
    const ciphertext = await aesEncrypt(
      deviceKey,
      nonce,
      textEncoder.encode(plaintext),
      textEncoder.encode(aad),
    );
    return { nonce: encodeBase64(nonce), ciphertext: encodeBase64(ciphertext) };
  };
}

/**
 * 造一个解包器。
 *
 * 🔴 AAD 必须**由信封的明文字段重新拼**（`envelopeAad`），而不是从别处传进来。
 * AAD 的全部意义就是"把信封的明文部分绑进密文"：如果解包时用了另一个来源的
 * `validUntil`，那绑定就是假的 —— 有人改了 `validUntil`（让过期快照看起来是新鲜的）
 * 照样能解开，而**没有任何东西会报错**。
 *
 * 失败**抛异常**（与 `SnapshotDecryptor` 的约定一致），由
 * `readSnapshotOrNull` 捕获并降级。
 */
export function createWidgetDecryptor(deviceKey: Uint8Array): SnapshotDecryptor {
  assertKeyLength(deviceKey);
  return async (envelope: WidgetEnvelope) => {
    const plaintext = await aesDecrypt(
      deviceKey,
      new Uint8Array(decodeBase64(envelope.nonce)),
      new Uint8Array(decodeBase64(envelope.ciphertext)),
      textEncoder.encode(
        envelopeAad({
          v: envelope.v,
          dayStr: envelope.dayStr,
          validUntil: envelope.validUntil,
        }),
      ),
    );
    return JSON.parse(textDecoder.decode(plaintext));
  };
}
