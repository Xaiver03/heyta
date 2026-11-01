/**
 * "钥匙放在设备里"的**壳侧存储**（ADR-0080 §5.4 / §5.5）。
 *
 * ## 为什么不是 `vault-root-cache.ts` 的替代品，而是它前面的一层
 *
 * `vault-root-cache.ts` 那套是 **Web 的答案**：`sessionStorage`，活到标签页关闭。
 * 在浏览器里那是**故意**的（ADR 写死了不许进 `localStorage`）。
 *
 * 但 macOS 壳是 `WKWebView` 载 `web-dist` —— 它的"标签页"就是**进程**。
 * 于是"活到标签页关闭"在壳里等于"关掉 App 就要重新输口令"，而 S5 的判据是**冷启动免输**。
 *
 * OS 钥匙串只从原生侧够得着，所以壳注入一座桥（`ShellVaultKeychainBridge.swift`，
 * 页侧看到的是 `window.heytaVaultKeychain`）。这一层就是那座桥的页侧包装：
 *
 * - **桥不在** ⇒ 返回 `undefined` / 什么都不做，调用方继续走 `sessionStorage`（浏览器行为一个字没变）；
 * - **桥在** ⇒ 用钥匙串，且**不再碰** `sessionStorage`（两条腿同时写会让"锁屏降级"说不清）。
 *
 * ## 它保护的是服务器，不是这台机器
 *
 * 与 `vault-root-cache.ts` 同一句话：钥匙在这一层的意义是"云上那份是密文"。
 * 钥匙串能多给一半（本机被别的进程读到的门槛更高），但**不许**据此对用户承诺"本机绝对安全"。
 */

/** 与 `vault-root-cache.ts` 同一套作用域，也是桥的入参形状。 */
export interface DeviceVaultRootScope {
  accountId: string;
  serverOrigin: string;
}

/**
 * 壳注入的那座桥。
 *
 * ⚠️ 三个方法都返回 Promise（`WKScriptMessageHandlerWithReply` 的回法），
 * 而 `load` 的 `null` 表示"这台设备没记住" —— 与"读失败"在页侧是**同一处理**（都要口令），
 * 但**在证据里必须分开记**：一个是正常首次，一个是钥匙串出问题。
 */
export interface DeviceVaultKeychainBridge {
  load: (serverOrigin: string, accountId: string) => Promise<string | null>;
  save: (serverOrigin: string, accountId: string, value: string) => Promise<boolean>;
  clear: (serverOrigin: string, accountId: string) => Promise<boolean>;
}

/** 桥在不在。**只认形状完整的那一座** —— 半座桥（缺 save）会把钥匙写成"记得住却存不下"。 */
export function deviceVaultKeychain(): DeviceVaultKeychainBridge | undefined {
  const candidate = (globalThis as { heytaVaultKeychain?: Partial<DeviceVaultKeychainBridge> })
    .heytaVaultKeychain;
  if (candidate === undefined || candidate === null) return undefined;
  if (typeof candidate.load !== 'function' || typeof candidate.save !== 'function' ||
      typeof candidate.clear !== 'function') {
    return undefined;
  }
  return candidate as DeviceVaultKeychainBridge;
}

/**
 * 读这台设备记住的 root。
 *
 * 🔴 三种结果**必须能分开**（调用方据此决定说什么）：
 * - `undefined` —— 没有桥（普通浏览器）⇒ 调用方自己退 `sessionStorage`；
 * - `null` —— 有桥，但设备上没记住（首次 / 被锁屏策略藏起来 / 被清过）⇒ 要口令；
 * - `Uint8Array` —— 拿到了。
 *
 * 读失败（桥抛、值形状不对）一律回 `null`：**不猜**。长度不是 32 字节就当没有。
 */
export async function loadDeviceVaultRoot(
  scope: DeviceVaultRootScope,
): Promise<Uint8Array | null | undefined> {
  const bridge = deviceVaultKeychain();
  if (bridge === undefined) return undefined;
  try {
    const encoded = await bridge.load(scope.serverOrigin, scope.accountId);
    /*
     * `undefined` 也要当成"没记住"：壳那一侧如果哪天又回成 Swift 的 `nil`，
     * `WKScriptMessageHandlerWithReply` 会让页侧解出 `undefined` 而不是 `null`。
     * 契约写的是 `string | null`，但**判据不能只认一种空值** —— 认漏了的表现是
     * "读出一枚不存在的钥匙"，那是方向性最坏的错。
     */
    if (encoded === null || encoded === undefined || encoded === '') return null;
    const bytes = decodeBase64ToBytes(encoded);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * 记住这把 root。**写不进去不算失败** —— 功能降级成"下次要重新输"，不是错误。
 *
 * 返回是否真的写进去了（桥不在时返回 `false`，调用方据此继续走 `sessionStorage`）。
 */
export async function saveDeviceVaultRoot(
  scope: DeviceVaultRootScope,
  rootKey: Uint8Array,
): Promise<boolean> {
  const bridge = deviceVaultKeychain();
  if (bridge === undefined) return false;
  if (rootKey.length !== 32) return false;
  try {
    return await bridge.save(scope.serverOrigin, scope.accountId, encodeBytesToBase64(rootKey));
  } catch {
    return false;
  }
}

/** 显式清掉。登出 / 主动锁定 / 切到"每次都要输"都要真的清 —— 留着等下次不是"清"。 */
export async function clearDeviceVaultRoot(scope: DeviceVaultRootScope): Promise<boolean> {
  const bridge = deviceVaultKeychain();
  if (bridge === undefined) return false;
  try {
    return await bridge.clear(scope.serverOrigin, scope.accountId);
  } catch {
    return false;
  }
}

/*
 * base64 这两个小工具**故意写在这里**，不 import `@heyta/sync-core`：
 * 这个模块会被壳在 `atDocumentStart` 之后立刻用到，而把 sync-core 的
 * 整条依赖链拉进"读一枚钥匙"这件事里，只会多一个可能炸的地方。
 * Web 侧那一份仍走 `@heyta/sync-core`（`vault-root-cache.ts`），两边语义相同：
 * 标准字母表、每 3 字节 4 字符、带 `=` 填充。
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : ALPHABET[b2 & 0x3f];
  }
  return out;
}

function decodeBase64ToBytes(encoded: string): Uint8Array {
  const clean = encoded.replace(/=+$/u, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return new Uint8Array(0);
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}
