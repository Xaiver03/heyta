/**
 * 鸿蒙小组件 · 设备密钥 + 一次 AES-GCM-256 解密。
 *
 * ## 🔴 密钥归属（与其它三端逐条一致）
 *
 * - **密钥由原生侧生成**，JS 永远看不到密钥字节。
 * - `getOrCreate` **只应被应用侧**调用；卡片是**只读**的。
 * - **Argon2id 绝不在小组件里跑**（决策 D1）—— 它慢到会撑爆卡片的渲染预算，
 *   而且卡片的生命周期不受我们控制。用户主密码派生的密钥属于**应用**，
 *   不属于卡片。卡片拿到的是一把**设备级**的对称密钥。
 *
 * ## ⚠️ 存储位置的诚实说明（这是一处**已知弱化**，不是遗漏）
 *
 * 本项目其它端把设备密钥放在平台的密钥库里（iOS Keychain / Android Keystore）。
 * 鸿蒙的对应物是 **HUKS**（`@kit.UniversalKeystoreKit`）。
 * 本轮**先落在 `preferences`**，理由与代价都写清楚：
 *
 * - `preferences` 是**应用沙箱内**的普通持久化，**不抗 root / 不抗越狱**；
 * - 它与"应用自己的本地库也是明文"是同一档暴露 —— 与 Windows 侧
 *   "Adaptive Card 只能吃明文"属于**同类**的能力边界；
 * - 但**它确实弱于** Keychain/Keystore，所以记为**待升级项**，不假装等价。
 *
 * 升级到 HUKS 的形状是确定的：把 `loadKey` / `storeKey` 换成
 * `huks.generateKeyItem` / `huks.exportKeyItem`，
 * `decrypt` 换成 `huks.initSession` + `huks.finishSession` 两段式。
 * **其它代码一行都不用动** —— 这正是把密钥访问收在这一个文件里的原因。
 */

import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { preferences } from '@kit.ArkData';
import { util } from '@kit.ArkTS';

/** `preferences` 文件名与键名。加前缀避免与应用的其它偏好撞名。 */
const STORE_NAME: string = 'heyta_widget';
const KEY_NAME: string = 'widget_device_key';

/** 契约里的算法标识。**故意没有"无加密"这一档**。 */
export const WIDGET_ALG: string = 'AES-GCM-256';

/** AES-GCM 的 nonce（12 字节）与认证标签（16 字节）。四端同值。 */
const NONCE_BYTES: number = 12;
const TAG_BYTES: number = 16;

/**
 * 解密结果。**不抛异常**：卡片路径上"抛出去"等于整张卡片白屏。
 *
 * ⚠️ 写成 `interface` 而**不是** `{ ok: true; plaintext: string } | …`：
 * ArkTS 严格模式禁止把**对象字面量当类型用**（`arkts-no-obj-literals-as-types`）。
 * 这是 Node/vitest 永远抓不到的一类错误 —— 它们只会在真编译器里出现。
 */
export interface DecryptResult {
  ok: boolean;
  plaintext?: string;
  reason?: string;
}

function base64Decode(text: string): Uint8Array {
  // ⚠️ 必须是 `new util.Base64Helper()`：它是**类**不是函数。
  //    直接调用会报 `Value of type 'typeof Base64Helper' is not callable`。
  return new Uint8Array(new util.Base64Helper().decodeSync(text).buffer);
}

function base64Encode(bytes: Uint8Array): string {
  return new util.Base64Helper().encodeToStringSync(bytes);
}

/**
 * 读设备密钥。**读不到就返回 `null`，绝不新建。**
 *
 * 🔴 这条区分很关键：卡片与商店的**首次运行**都可能读不到密钥。
 * 如果这里"顺手建一把新的"，那么**用新密钥解旧密文必然失败**，
 * 而且更糟 —— 新密钥会被写回，**把正确的密钥覆盖掉**，
 * 于是应用下次也解不开了。用户看到的是"组件突然永远显示占位态"，
 * 且**再也恢复不了**（除非重装）。
 */
export async function loadKey(context: Context): Promise<Uint8Array | null> {
  const store = await preferences.getPreferences(context, STORE_NAME);
  const stored = await store.get(KEY_NAME, '');
  if (typeof stored !== 'string' || stored.length === 0) return null;
  try {
    const bytes = base64Decode(stored);
    return bytes.length === 32 ? bytes : null;
  } catch (err) {
    return null;
  }
}

/**
 * 取或建设备密钥。**只有应用侧应该调用它**（见文件头"密钥归属"）。
 *
 * 🔴 卡片的 `EntryFormAbility` **不调用**这个函数 ——
 * 卡片读不到密钥时应当显示占位态，而不是自己造一把。
 */
export async function getOrCreate(context: Context): Promise<string> {
  const existing = await loadKey(context);
  if (existing !== null) return base64Encode(existing);

  const generator = cryptoFramework.createSymKeyGenerator('AES256');
  const blob = await generator.generateSymKey();
  // ⚠️ `SymKey.getEncoded()` 返回的是 **`DataBlob`**（`{ data: Uint8Array }`），
  //    不是 `Uint8Array` —— 直接取 `.buffer` 会报
  //    `Property 'buffer' does not exist on type 'DataBlob'`。
  const encoded = base64Encode(blob.getEncoded().data);

  const store = await preferences.getPreferences(context, STORE_NAME);
  await store.put(KEY_NAME, encoded);
  await store.flush();
  return encoded;
}

/**
 * 用设备密钥解密一份信封的密文。
 *
 * 🔴 **只做这一次 AES-GCM** —— 卡片里不做任何别的密码学。
 * 🔴 线上格式是 `ciphertext || tag`（**不是** `nonce || ciphertext || tag`）。
 *    这个差异坑过一次（Swift 的 `SealedBox(combined:)` 期望后者），
 *    所以这里把拆分写得显式且有断言。
 */
export async function decrypt(
  keyBytes: Uint8Array,
  ciphertextB64: string,
  nonceB64: string,
  aad: string,
): Promise<DecryptResult> {
  let combined: Uint8Array;
  let nonce: Uint8Array;
  try {
    combined = base64Decode(ciphertextB64);
    nonce = base64Decode(nonceB64);
  } catch (err) {
    return { ok: false, reason: 'base64 解码失败' };
  }

  if (nonce.length !== NONCE_BYTES) {
    return { ok: false, reason: `nonce 应为 ${NONCE_BYTES} 字节，实际 ${nonce.length}` };
  }
  if (combined.length <= TAG_BYTES) {
    return { ok: false, reason: `密文太短（${combined.length} 字节）` };
  }

  const body = combined.subarray(0, combined.length - TAG_BYTES);
  const tag = combined.subarray(combined.length - TAG_BYTES);

  try {
    const generator = cryptoFramework.createSymKeyGenerator('AES256');
    // ArkTS 要求对象字面量**对应一个显式声明的类型**，且不接受 `as` 强转：
    // 所以先声明成 `DataBlob` 再赋值（`arkts-no-untyped-obj-literals`）。
    const keyBlob: cryptoFramework.DataBlob = { data: keyBytes };
    const symKey = await generator.convertKey(keyBlob);

    // ⚠️ AAD 必须与四端算出的**逐字节相同**（`envelopeAad()`，形如 `1|2026-09-27|1790000000000`）。
    //    差一个字符 = GCM 认证失败 = 只有鸿蒙这一端解不开，而其它三端正常。
    const aadBytes: Uint8Array = new util.TextEncoder().encodeInto(aad);
    const ivBlob: cryptoFramework.DataBlob = { data: nonce };
    const aadBlob: cryptoFramework.DataBlob = { data: aadBytes };
    const tagBlob: cryptoFramework.DataBlob = { data: tag };
    const gcmParams: cryptoFramework.GcmParamsSpec = {
      algName: 'GcmParamsSpec',
      iv: ivBlob,
      aad: aadBlob,
      authTag: tagBlob,
    };

    const cipher = cryptoFramework.createCipher('AES256|GCM|NoPadding');
    await cipher.init(cryptoFramework.CryptoMode.DECRYPT_MODE, symKey, gcmParams);
    const bodyBlob: cryptoFramework.DataBlob = { data: body };
    const output = await cipher.doFinal(bodyBlob);

    const decoder = util.TextDecoder.create('utf-8');
    return { ok: true, plaintext: decoder.decodeToString(new Uint8Array(output.data)) };
  } catch (err) {
    // 🔴 解密失败**绝不能**把原因当成"没有数据" —— 那两者在卡片上显示的
    //    都是占位态，但**日志里必须可区分**（密钥错 / AAD 不一致 / 密文被改）。
    //    ArkTS 里 `catch` 的绑定没有确定的静态类型，所以这里显式收成 string，
    //    不用 `instanceof Error`（ArkTS 对它的支持不保证）。
    const message: string = err === null || err === undefined ? '未知错误' : JSON.stringify(err);
    return { ok: false, reason: `解密失败：${message}` };
  }
}
