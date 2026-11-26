/**
 * 本地应用锁（PIN）—— 纯客户端 gate，设备本地偏好（Web）
 * ========================================================
 *
 * 补的是覆盖图谱 #61「应用锁」。线上应用锁**不是**服务端能力，也不是一份会被同步的
 * 数据：它只回答"**这台设备上，谁现在能打开这个应用**"。所以：
 *
 * ## 🔴 四条纪律
 *
 * 1. **设备属性、零 op**（[ADR-0085](../../../../docs/adr/0085-appearance-is-device-local-and-never-an-op.md)
 *    同一族）：这里一行 `dispatch(` 都没有，只写 `localStorage`。改应用锁不产生任何一条 op。
 * 2. **不存明文 PIN，也不自造哈希**：PIN 用平台 `crypto.subtle` 的 **PBKDF2-HMAC-SHA256**
 *    逐档派生（随机盐），磁盘上只留 `{ 盐, 迭代数, 派生值 }`。**绝不**存 PIN 本身。
 * 3. **只做 gate、不做"找回"**：忘了 PIN 等于进不去（这是"锁"的性质）。数据真身仍在
 *    本地库里，锁屏只是入口上的一层遮挡 —— 它不加密数据，也不是 E2EE 的替代品。
 * 4. **诚实的强度边界**：4–8 位数字 PIN 的空间很小，离线下可暴力枚举。PBKDF2 只是
 *    抬高单次尝试的成本（纵深防御），**不是**"猜不出来的保证"。它拦的是"随手拿起
 *    这台设备的人"，不是拿到磁盘镜像的攻击者 —— 后者要的是数据加密，不是应用锁。
 *
 * ## 与主题 / 字号 / 强调色同一契约
 *
 * 读 `localStorage` 可能抛（隐私模式 / 存储禁用），所以读一份坏数据 / 读不到 / 写不上
 * 都**静默降级**为"未上锁"，绝不把用户挡在自己应用外面。
 */

/** 存储键。🔴 只导出给判据用；产品代码走下面的函数。 */
export const APP_LOCK_STORAGE_KEY = 'heyta.appLock';

/** PIN 的长度边界（纯数字）。 */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

/** PBKDF2 迭代数。改它会让旧记录仍可校验（迭代数存在记录里），但新记录用新值。 */
export const PBKDF2_ITERATIONS = 100_000;

/** 盐的字节数（16 = 128 bit）与派生值字节数（32 = 256 bit）。 */
const SALT_BYTES = 16;
const HASH_BITS = 256;

/** 落盘的记录形状。`v` 给未来迁移留口子。 */
interface AppLockRecord {
  readonly v: 1;
  /** base64 编码的随机盐。 */
  readonly salt: string;
  /** 派生时的 PBKDF2 迭代数。 */
  readonly iter: number;
  /** base64 编码的派生值（不是 PIN）。 */
  readonly hash: string;
}

/** `validatePin` 的结果。`reason` 是给面板翻译成文案用的判别式，不是文案本身。 */
export type PinValidation = { readonly ok: true } | { readonly ok: false; readonly reason: 'length' | 'nondigit' };

/**
 * 校验 PIN 形状：**只允许** 4–8 位 ASCII 数字。
 *
 * 纯函数、不碰存储与 DOM —— 面板在提交前先用它，测试里也直接打它。
 */
export function validatePin(pin: string): PinValidation {
  if (!/^\d+$/.test(pin)) return { ok: false, reason: 'nondigit' };
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) return { ok: false, reason: 'length' };
  return { ok: true };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** 常量时间比较两段 base64（避免早退泄漏前缀是否匹配）。 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 平台 PBKDF2-SHA256 派生。缺 `crypto.subtle` 时抛错（调用方会当成"校验不通过"）。 */
async function deriveHash(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error('crypto.subtle unavailable');
  const encoded = new TextEncoder().encode(pin);
  const keyMaterial = await subtle.importKey('raw', encoded as unknown as BufferSource, { name: 'PBKDF2' }, false, [
    'deriveBits',
  ]);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/** 读记录；不存在 / 形状不对 / 解析失败一律返回 `null`（= 没上锁）。 */
function readRecord(): AppLockRecord | null {
  try {
    const raw = localStorage.getItem(APP_LOCK_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (record['v'] !== 1) return null;
    if (typeof record['salt'] !== 'string' || record['salt'] === '') return null;
    if (typeof record['hash'] !== 'string' || record['hash'] === '') return null;
    if (typeof record['iter'] !== 'number' || !Number.isFinite(record['iter']) || record['iter'] <= 0) {
      return null;
    }
    return { v: 1, salt: record['salt'], iter: record['iter'], hash: record['hash'] };
  } catch {
    // 隐私模式读不到 / 坏 JSON —— 当成没上锁。
    return null;
  }
}

/** 这台设备是否已上锁（= 存在一条合法的派生记录）。 */
export function isAppLockEnabled(): boolean {
  return readRecord() !== null;
}

/**
 * 设置（或覆盖）PIN。
 *
 * PIN 非法时**抛错且不写盘** —— 调用方（面板）应先 `validatePin` 给出就地提示，
 * 这里的抛错是"别把一条非法记录写进存储"的最后一道保险。
 */
export async function setPin(pin: string): Promise<void> {
  if (!validatePin(pin).ok) throw new Error('invalid-pin');
  const salt = new Uint8Array(SALT_BYTES);
  globalThis.crypto.getRandomValues(salt);
  const hash = await deriveHash(pin, salt, PBKDF2_ITERATIONS);
  const record: AppLockRecord = {
    v: 1,
    salt: bytesToBase64(salt),
    iter: PBKDF2_ITERATIONS,
    hash: bytesToBase64(hash),
  };
  try {
    localStorage.setItem(APP_LOCK_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // 写不上就当没设上：不抛给界面（隐私模式下锁不生效，但不会崩）。
  }
}

/**
 * 校验 PIN。
 *
 * 没有记录 / 记录损坏 / 派生失败 / 不匹配 —— 一律 `false`（**不抛**：锁屏上抛异常
 * 等同于"按了解锁没反应"，用户无从判断）。
 */
export async function verifyPin(pin: string): Promise<boolean> {
  const record = readRecord();
  if (record === null) return false;
  if (!/^\d+$/.test(pin)) return false;
  try {
    const salt = base64ToBytes(record.salt);
    const derived = await deriveHash(pin, salt, record.iter);
    return constantTimeEqual(bytesToBase64(derived), record.hash);
  } catch {
    return false;
  }
}

/** 关闭应用锁：删掉那条记录（不存在也不报错）。 */
export function clearPin(): void {
  try {
    localStorage.removeItem(APP_LOCK_STORAGE_KEY);
  } catch {
    // 删不掉也不致命：最坏是这台设备继续要求解锁。
  }
}
