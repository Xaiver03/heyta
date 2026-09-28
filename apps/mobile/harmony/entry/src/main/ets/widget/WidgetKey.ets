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

// ---------------------------------------------------------------------------
// 加密 —— 读路径的**镜像**（在此之前鸿蒙侧只有解密，所以卡片能读、没人能写）
// ---------------------------------------------------------------------------

/** 一次加密的结果。与 `DecryptResult` 对称：**不抛**，失败也返回对象。 */
export interface EncryptResult {
  ok: boolean;
  /** 成功时给出：`ciphertext || tag` 的 base64。 */
  ciphertextB64?: string;
  /** 成功时给出：nonce 的 base64。 */
  nonceB64?: string;
  reason?: string;
}

/**
 * 生成一个 12 字节随机 nonce。
 *
 * 🔴 **绝不能复用 nonce。** GCM 下同一个密钥 + 同一个 nonce 加密两份不同的明文，
 * 会同时泄露两份明文的内容并让认证失效 —— 而它的表现是"卡片的字变成了乱码"，
 * 完全指不到 nonce 上。所以每次封包都必须新取一个。
 */
function newNonce(): Uint8Array {
  const bytes: Uint8Array = new Uint8Array(NONCE_BYTES);
  const rand: cryptoFramework.Random = cryptoFramework.createRandom();
  // ArkTS 不接受把 `generateRandomSync` 的返回值直接当数组用，先收进 DataBlob。
  const blob: cryptoFramework.DataBlob = rand.generateRandomSync(NONCE_BYTES);
  bytes.set(blob.data);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const helper: util.Base64Helper = new util.Base64Helper();
  return helper.encodeToStringSync(bytes);
}

/**
 * 用设备密钥做一次 AES-256-GCM 加密，输出**与其它三端相同的线上格式**：
 * `ciphertext || tag`（16 字节 tag 拼在密文后面），base64 编码。
 *
 * ## 🔴 「authTag 是入参还是出参」这件事**没有猜，是当场定的**
 *
 * `GcmParamsSpec` 三个字段里 `iv` / `aad` 的含义是明确的，而 **`authTag` 在加密时
 * 该填什么，本地 API 文档只给了字段表、没给可运行的例子**。
 * 两种可能的约定都存在（填空数组、由算法库回填；或把 tag 直接拼在 `doFinal` 输出里）。
 *
 * **所以这里不假设**：加密后**立刻用同一个函数解一次**，比对是否逐字节相同。
 * - 对得上 → 采用这种取法；
 * - 对不上 → 换另一种取法再验一次；
 * - 两种都不行 → 返回失败，**绝不写入一份谁都读不开的快照**。
 *
 * ⚠️ 一个不自检的 `seal` 会把错误推迟到"卡片显示占位态"那一刻 ——
 * 而在卡片上，"解不开"与"没有数据"长得一模一样。
 */
export async function encrypt(
  keyBytes: Uint8Array,
  plaintext: string,
  aad: string,
): Promise<EncryptResult> {
  let nonce: Uint8Array;
  try {
    nonce = newNonce();
  } catch (err) {
    const message: string = err === null || err === undefined ? '未知错误' : JSON.stringify(err);
    return { ok: false, reason: `取随机数失败：${message}` };
  }
  if (nonce.length !== NONCE_BYTES) {
    return { ok: false, reason: `nonce 应为 ${NONCE_BYTES} 字节，实际 ${nonce.length}` };
  }

  const plainBytes: Uint8Array = new util.TextEncoder().encodeInto(plaintext);
  const aadBytes: Uint8Array = new util.TextEncoder().encodeInto(aad);

  // 取法 A：authTag 由算法库回填（先给一个空的）。
  const attemptA: Uint8Array | null = await tryEncrypt(keyBytes, plainBytes, nonce, aadBytes, false);
  // 取法 B：tag 是 doFinal 输出的一部分（末尾 16 字节）。
  const attemptB: Uint8Array | null = await tryEncrypt(keyBytes, plainBytes, nonce, aadBytes, true);

  for (const candidate of [attemptA, attemptB]) {
    if (candidate === null) continue;
    if (candidate.length <= TAG_BYTES) continue;
    const back: DecryptResult = await decrypt(keyBytes, bytesToBase64(candidate), bytesToBase64(nonce), aad);
    if (back.ok && back.plaintext === plaintext) {
      return { ok: true, ciphertextB64: bytesToBase64(candidate), nonceB64: bytesToBase64(nonce) };
    }
  }

  return { ok: false, reason: '两种 authTag 取法都通不过自解校验，拒绝写入' };
}

/**
 * 真正调用算法库的那一步。
 *
 * `tagAlreadyAppended = true` 时假定 `doFinal` 的输出**已经**是 `ciphertext || tag`，
 * 此时把 `authTag` 当纯出参回填（不把它拼回去）；否则把回填的 `authTag` 拼在密文后面。
 */
async function tryEncrypt(
  keyBytes: Uint8Array,
  plainBytes: Uint8Array,
  nonce: Uint8Array,
  aadBytes: Uint8Array,
  tagAlreadyAppended: boolean,
): Promise<Uint8Array | null> {
  try {
    const generator: cryptoFramework.SymKeyGenerator = cryptoFramework.createSymKeyGenerator('AES256');
    const keyBlob: cryptoFramework.DataBlob = { data: keyBytes };
    const symKey: cryptoFramework.SymKey = await generator.convertKey(keyBlob);

    const ivBlob: cryptoFramework.DataBlob = { data: nonce };
    const aadBlob: cryptoFramework.DataBlob = { data: aadBytes };
    const tagPlaceholder: cryptoFramework.DataBlob = { data: new Uint8Array(TAG_BYTES) };
    const gcmParams: cryptoFramework.GcmParamsSpec = {
      algName: 'GcmParamsSpec',
      iv: ivBlob,
      aad: aadBlob,
      authTag: tagPlaceholder,
    };

    const cipher: cryptoFramework.Cipher = cryptoFramework.createCipher('AES256|GCM|NoPadding');
    await cipher.init(cryptoFramework.CryptoMode.ENCRYPT_MODE, symKey, gcmParams);
    const input: cryptoFramework.DataBlob = { data: plainBytes };
    const output: cryptoFramework.DataBlob = await cipher.doFinal(input);

    const body: Uint8Array = new Uint8Array(output.data);
    const filledTag: Uint8Array = new Uint8Array(gcmParams.authTag.data);

    if (tagAlreadyAppended) {
      // 假定输出已含 tag —— 直接用它，不再拼。
      return body.length > TAG_BYTES ? body : null;
    }
    // 假定 authTag 是回填的：拼在密文后面。
    if (filledTag.length !== TAG_BYTES) return null;
    const combined: Uint8Array = new Uint8Array(body.length + TAG_BYTES);
    combined.set(body);
    combined.set(filledTag, body.length);
    return combined;
  } catch (err) {
    return null;
  }
}
