/**
 * 邮件登录链接的**回跳消费**（W1：修 A6 那个断点）
 * ================================================
 *
 * ## 它修的是什么
 *
 * 邮件 magic-link 的既有流程是**两跳**（这一步设计是对的，见下），但**第二跳之后没人接手**：
 *
 * ```
 * ① 用户点邮件里的链接
 *       → GET  /magic-login?token=…          （服务端渲染一个确认页，GET **不**消费令牌）
 * ② 用户在确认页点「Log In」
 *       → POST /api/login/magic-link/verify   （**这里才真正校验**，返回 {token, user}）
 *       → server/public/magic-login-confirm.js 把 JWT 写进 sessionStorage['loginToken']
 *       → location.href = '/'
 * ③ 应用启动……
 *       → 🔴 **全仓没有任何应用代码读 sessionStorage['loginToken']**
 *          （`grep -rn loginToken` 只命中 `magic-login-confirm.js` 自身与旧版
 *            `server/public/app.js`，而 `apps/web` 不读）
 * ```
 *
 * ⇒ **结果**：用户在邮件里"登录成功了"，回到应用还是未登录，而且**界面不会报任何错** ——
 * 这是本仓最危险的那类失效（"界面说成功、功能没接上"）。
 *
 * ## 为什么用 sessionStorage 而不是把令牌放进 URL
 *
 * 令牌放进 URL 会进浏览器历史、`Referer`、以及任何一层访问日志。
 * `sessionStorage` 是**同源、同标签页、随跳转存活**的 —— 服务端确认页与应用同源
 * （同一台主机：确认页在 `/magic-login`，应用在 `/app/`），所以这条通路成立，
 * 且令牌**不会离开浏览器**。
 *
 * ## 为什么这一步**不许阻塞首屏**
 *
 * heyta 是本地优先：没登录、没配服务器时，应用必须照常可用
 * （`packages/app-host/src/host.ts:91`；`e2e/tests/helpers.ts:117-121` 的 `openApp`
 * 断言了"未登录也能看到首屏"）。
 * ⇒ 消费令牌是**增强路径**，它在首屏渲染之后**异步**跑、**自己吞掉所有失败**。
 * 失败时用户看到的是"未登录"（与今天一致），而不是一个错误屏。
 *
 * ## 边界（如实写出来）
 *
 * - **只在 web 成立**：移动端/桌面壳与服务端确认页**不同源**，拿不到这个 sessionStorage。
 *   它们的通路是深链（`heyta://auth#token=…`），属于各自宿主的事，见
 *   `docs/plans/user-journey-and-auth.md` §3.2。
 * - **一次性**：读到就**立刻删**，无论后面成功与否 —— 令牌不该在存储里留第二遍。
 * - **不校验令牌内容**：那是服务端的事（`/api/login/magic-link/verify` 才是权威）。
 *   这里只负责"把令牌交到既有的登录路径上"。
 */

import { useAuthStore } from './store.js';

/** 服务端确认页写入的令牌键。与 `server/public/magic-login-confirm.js` **必须一致**。 */
export const PENDING_TOKEN_KEY = 'loginToken';

/**
 * 服务端确认页写入的**服务端地址**键。
 *
 * 🔴 它是必需的，不是锦上添花：应用要用它做 `baseUrl` 去校验令牌。
 * 不用 `window.location.origin` 顶替 —— 应用可能被部署在**与同步服务端不同的域**
 * （反代、自建、`VITE_SYNC_URL` 覆盖），那时猜出来的地址会把令牌发到错的地方。
 */
export const PENDING_BASE_URL_KEY = 'loginBaseUrl';

/** 读出来的待消费登录。`baseUrl` 为空即视为无效（见上）。 */
export interface PendingLogin {
  readonly baseUrl: string;
  readonly token: string;
}

/**
 * 存储的最小接口。
 *
 * 🔴 **注入而不是直接用 `sessionStorage`**，理由有两条：
 *   1. 隐私模式 / 被策略禁用时 `sessionStorage` 的**访问本身会抛**（不是返回 null）；
 *   2. 没有它就没法写"读到就删""失败也删"这两条的测试 —— 而那正是本模块的全部价值。
 */
export interface PendingLoginStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

/** 拿一个可用的存储；拿不到（隐私模式等）返回 `null` 而不是抛。 */
function defaultStorage(): PendingLoginStorage | null {
  try {
    // 访问本身就可能抛 —— 必须包住，且**不能**把异常漏给启动路径。
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 读出并**立即清除**待消费的登录。
 *
 * 🔴 **无论后面校验成不成功，令牌都不留在存储里**：
 * 一个已经被用过的（或明显无效的）令牌留在 `sessionStorage` 里，
 * 只会在下一次启动时再被消费一遍 —— 那会让"登录失败"变成"每次启动都失败一次"。
 *
 * @returns 有效则返回 `{baseUrl, token}`；缺任一、或存储不可用则 `null`。
 */
export function takePendingLogin(
  storage: PendingLoginStorage | null = defaultStorage(),
): PendingLogin | null {
  if (storage === null) return null;

  let token: string | null = null;
  let baseUrl: string | null = null;
  try {
    token = storage.getItem(PENDING_TOKEN_KEY);
    baseUrl = storage.getItem(PENDING_BASE_URL_KEY);
  } catch {
    // 读也可能抛（同上）；此时按"没有待消费登录"处理。
    return null;
  }

  // **先删再判**：即使值不完整也要清掉，避免它永远赖在那里。
  try {
    storage.removeItem(PENDING_TOKEN_KEY);
    storage.removeItem(PENDING_BASE_URL_KEY);
  } catch {
    // 删不掉不是致命错误（下一次会再读到、再试一次），但绝不能因此中断启动。
  }

  // `baseUrl` 为空串同样无效 —— 空 baseUrl 在 app-host 里是"纯本地模式"
  // （`host.ts:270`），拿它去登录必然失败，不如直接不试。
  if (token === null || token === '' || baseUrl === null || baseUrl === '') return null;

  return { baseUrl, token };
}

/**
 * 消费待登录：走**既有的** `useAuthStore.verify()`（不新写一条登录路径）。
 *
 * 🔴 复用而不新写，理由是可维护性：`verify()` 内部已经处理了
 * `extractAuthLinkToken`（同时接受完整 URL 与裸 token）、reason 白名单映射、
 * 失败时**不置成功**、以及成功时 `applyAuthToken` 写进同步配置
 * （`apps/web/src/features/auth/store.ts:149-150, 173-190`）。
 * 在这里再写一遍，就是第二份"登录成功后该做什么"。
 *
 * @returns 真的登录成功返回 `true`；没有待登录、或校验失败返回 `false`。
 *   **调用方不需要处理失败** —— 未登录本来就是合法状态。
 */
export async function consumePendingLogin(
  storage: PendingLoginStorage | null = defaultStorage(),
): Promise<boolean> {
  const pending = takePendingLogin(storage);
  if (pending === null) return false;

  try {
    const session = await useAuthStore.getState().verify(pending.baseUrl, pending.token);
    return session !== undefined;
  } catch {
    // 网络不可达、服务端 5xx、响应畸形 —— 全部按"这次没登上"处理。
    // **不抛、不渲染错误屏**：本地优先下，未登录是正常状态，不是故障。
    return false;
  }
}