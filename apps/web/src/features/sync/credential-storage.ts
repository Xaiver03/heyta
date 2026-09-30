/**
 * web 的凭据持久化（W4）
 * =======================
 *
 * ## 它修的是什么
 *
 * 侦察实测：**所有端都不持久化凭据** —— `apps/web` 的令牌只在内存/sessionStorage。
 * ⇒ 刷新一次页面就要重新登录一次。**"登录后重开还在"在任何端都不成立**，
 * 而那是一条完整旅程的必要条件（否则每次冷启动都断在登录上）。
 *
 * ## 🔴 为什么令牌可以落盘、口令不可以
 *
 * | 值 | 落盘吗 | 理由 |
 * |---|---|---|
 * | `baseUrl`（服务端地址） | ✅ 落盘 | 它不是秘密，而且用户手输一次就该记住 |
 * | `token`（JWT 访问令牌） | ✅ 落盘 | 服务端可吊销；丢了等价于"需要重新登录"，**不泄露任何明文数据** |
 * | `password`（E2EE 口令） | ❌ **绝不落盘** | 它是**解密密钥**。落盘 = 把端到端加密的意义取消掉。这是本仓已有的承诺（`SyncBar` 的口令说明句），本文件**不改它** |
 *
 * ⚠️ 如实写出的代价：`localStorage` 对 XSS 是暴露的。**接受它的理由**：
 * 这个令牌只能存取**服务端已有的密文**（E2EE 载荷本体在口令那边），
 * 而口令仍然只在内存 —— XSS 拿到令牌也解不开数据。真正危险的是把口令一起落盘，
 * 所以我们**没有**那么做。
 *
 * ## 形状
 *
 * 与 `lib/theme.ts` / `lib/locale.ts` 一致：读/写两个纯函数，
 * 访问整体包 `try/catch`（隐私模式下 `localStorage` **访问本身会抛**），
 * 键名只在这里定义一次。**注入 storage** 是为了能测"写失败时不崩"。
 */

/** 与 `heyta.theme` / `heyta.locale` 并列。键名只在这里定义一次。 */
const STORAGE_KEY = 'heyta.sync.credentials';

/** 落盘的那部分凭据。**刻意没有 `password`** —— 见文件头。 */
export interface PersistedCredentials {
  readonly baseUrl: string;
  readonly token: string;
  /**
   * 账号邮箱 —— **只是标签，不是秘密**。
   *
   * 🔴 为什么需要落盘：左侧导航顶部的**头像**要用它算首字母，
   * 而刷新之后 `useAuthStore` 会回到 `signed-out`（它的 `signed-in` 状态没落盘），
   * 于是头像会退回一个通用图标 —— 而同一个用户"刚登录时是首字母、刷新后变成通用图标"
   * 是很明显的自相矛盾。`token` 都落盘了，标签没有理由不落。
   *
   * ⚠️ 它**不改变那条承诺**：口令（解密密钥）**绝不落盘**，本字段不是口令。
   */
  readonly email?: string;
}

/** 存储的最小接口（可注入，便于测隐私模式与写失败）。 */
export interface CredentialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): CredentialStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // 隐私模式 / 被策略禁用：访问本身抛。按"没有存储"处理，不把它变成启动故障。
    return null;
  }
}

/**
 * 读回已保存的凭据。
 *
 * 解析失败（旧版本留下的形状、被人手改过）一律返回 `null` 并**顺手清掉** ——
 * 留着一个读不懂的值，只会在每次启动时再失败一次。
 */
export function loadCredentials(
  storage: CredentialStorage | null = defaultStorage(),
): PersistedCredentials | null {
  if (storage === null) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null || raw === '') return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('不是对象');
    }
    const record = parsed as Record<string, unknown>;
    const baseUrl = record['baseUrl'];
    const token = record['token'];
    if (typeof baseUrl !== 'string' || baseUrl === '') throw new Error('baseUrl 无效');
    if (typeof token !== 'string' || token === '') throw new Error('token 无效');
    // 邮箱是**可选**的：老版本存下来的记录里没有它，不该因此被判成无效
    //（那会让所有老用户"莫名被登出"）。
    const email = record['email'];
    return typeof email === 'string' && email !== '' ? { baseUrl, token, email } : { baseUrl, token };
  } catch {
    // 读不懂就清掉，避免每次启动都再失败一次。
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // 清不掉也不是致命错误。
    }
    return null;
  }
}

/**
 * 保存凭据。**只保存 `baseUrl` 与 `token`。**
 *
 * @returns 真写进去了返回 `true`；存储不可用 / 写失败返回 `false`（**不抛**）。
 *   调用方不需要处理失败 —— 写不进去的后果只是"下次还要重新登录"，
 *   而那比"因为存不了凭据而让应用崩掉"轻得多。
 */
export function saveCredentials(
  credentials: PersistedCredentials,
  storage: CredentialStorage | null = defaultStorage(),
): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(credentials));
    return true;
  } catch {
    // 配额满 / 被策略拒绝 —— 明确返回 false，不假装成功。
    return false;
  }
}

/** 清除已保存的凭据（用户点「清除凭据」时）。 */
export function clearStoredCredentials(
  storage: CredentialStorage | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // 同上：不抛。
  }
}