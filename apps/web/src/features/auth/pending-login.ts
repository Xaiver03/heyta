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
 * ## 令牌怎么从确认页走到应用（两版才对，第二版的教训是实测出来的）
 *
 * - **第一版：`sessionStorage`**（同源、同标签页、随跳转存活）。
 *   它在**大多数**跳转下成立，但 2026-09-30 的端到端判据
 *   （`scripts/verify-email-web-chain.mjs`）当场判红，仪器给出了确凿的读数：
 *
 *   ```
 *   确认页 pagehide 那一刻：sessionKeys = [sessionToken, loginEmail, loginBaseUrl]  ← 写进去了
 *   应用启动那一刻    ：sessionKeys = []                                            ← 没跟过来
 *   写入时间线        ：没有任何 removeItem 删过它们，也不是被谁清了
 *   ```
 *
 *   根因是**两个"文档所属 agent cluster"不同**：确认页由同步服务端渲染，
 *   带着 `@fastify/helmet` 的默认安全头 `Cross-Origin-Opener-Policy: same-origin`
 *   + `Origin-Agent-Cluster: ?1`；应用（`/app/`，静态产物）两个头都没有。
 *   ⇒ 从确认页跳到 `/app/` 会**切换 browsing instance**，`sessionStorage`
 *   不跟着回到原来那一份。**注入验证**：把这两个头从服务端响应里摘掉，
 *   同一条判据立刻全绿 —— 因果是钉住的，不是猜的。
 *
 *   ⚠️ 这条通路**依赖两个独立部署件（服务端 / 反代）的头配置保持一致**。
 *   自建部署换个反代就可能再坏一次。修法不能建立在那个默契上。
 *
 * - **第二版（现在）：URL 的 `fragment`。**
 *   fragment **不发给服务端**、**不进 `Referer`、不进任何一层访问日志**，
 *   而且它是 URL 的一部分 —— **跨 agent cluster 一定跟得过来**。
 *   消费方读完**立刻**用 `history.replaceState` 抹掉，所以它既不留历史、
 *   也不活在磁盘上（比 localStorage 严格更小：应用若启动失败，
 *   fragment 随标签页一起消失，不会跨重启留着）。
 *
 *   上游的"别把令牌放进 URL"讲的其实是 **query**（`?token=…` 会进日志与 `Referer`）。
 *   fragment 两类泄漏都没有，所以这条修法与那条原则不冲突。
 *
 * ⚠️ **桌面壳仍然走 `sessionStorage`**：它在**同一份文档里**写、再 `load()`，
 * 不存在 cluster 切换，那条路是绿的、不动它。两条投递、一套键名、一个消费点。
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

/**
 * **已经签发好的会话**令牌 —— 由**桌面壳的反向授权回跳**交进来（ADR-0039 §2.3）。
 *
 * 🔴 它和 `loginToken` 是**两种东西**，所以用**两个键**，不靠猜：
 *   · `loginToken`  = **一次性链接令牌** ⇒ 应用要拿它去服务端**换**会话（`verify()`）；
 *   · `sessionToken` = **会话本身**（壳从 `heyta://auth#token=…` 拿到的 JWT）
 *     ⇒ 直接落地，不再去换一次（去换必然 401 —— 服务端按链接令牌那一列查）。
 *
 * 两个键不用同一个名字是刻意的：一个"要么换要么直接用"的模糊值，
 * 迟早会被某一条路按错的方式解释。
 */
export const PENDING_SESSION_KEY = 'sessionToken';

/** 会话令牌那条路还要邮箱：头像要用它算首字母，而 `useAuthStore` 刷新后是 signed-out。 */
export const PENDING_EMAIL_KEY = 'loginEmail';

/**
 * 地址栏 fragment 这条投递通道（`/app/#sessionToken=…&loginBaseUrl=…&loginEmail=…`）。
 *
 * 🔴 **注入而不是直接用 `location`/`history`**，理由与存储那条同源：
 * "读到就抹掉"是本模块的核心行为，而它在真实浏览器里没法断言
 * （测试跑在 jsdom 里，改 `location.hash` 会真的动全局状态）。
 */
export interface PendingLoginFragment {
  /** 当前 URL 的 fragment，**不含** `#`；没有 fragment 时是空串。 */
  read(): string;
  /** 抹掉 fragment —— 必须发生在消费之后、渲染之前。 */
  clear(): void;
}

/**
 * 从 fragment 里取出并**立即抹掉**待消费的会话（ADR-0039 §2.3 的第二条投递通道）。
 *
 * 纪律与 `takePendingSession` 完全一致：**先抹再判** —— 即使值不完整，
 * 令牌也不许继续留在地址栏与历史里。
 *
 * ⚠️ **只在自己认得这个 fragment 时才抹**：将来若有人用 hash 存别的状态
 * （`apps/web` 今天没有 hash 路由，但那是事实不是保证），
 * 一个无差别清空会把人家的状态吃掉。
 *
 * @returns 有效则返回 `{baseUrl, token, email}`；没有 fragment、不是我们的、
 *   或缺 `sessionToken`/`loginBaseUrl` 则 `null`。
 */
export function takePendingSessionFromFragment(
  fragment: PendingLoginFragment | null = defaultFragment(),
): PendingSession | null {
  if (fragment === null) return null;

  let raw = '';
  try {
    raw = fragment.read();
  } catch {
    // 读也可能抛（沙箱/策略）；按"没有待消费会话"处理，绝不带崩启动路径。
    return null;
  }
  if (raw === '') return null;

  const params = new URLSearchParams(raw);
  const ours =
    params.has(PENDING_SESSION_KEY) ||
    params.has(PENDING_BASE_URL_KEY) ||
    params.has(PENDING_EMAIL_KEY);
  if (!ours) return null;

  const token = params.get(PENDING_SESSION_KEY) ?? '';
  const baseUrl = params.get(PENDING_BASE_URL_KEY) ?? '';
  const email = params.get(PENDING_EMAIL_KEY) ?? '';

  // **先抹再判**（同上）：不完整的值也不许留在地址栏里。
  try {
    fragment.clear();
  } catch {
    /* 抹不掉不致命：下面仍会用读到的值，而它本来也是一次性的。 */
  }

  if (token === '' || baseUrl === '') return null;
  return { baseUrl, token, email };
}

/** 拿一个可用的 fragment 通道；拿不到（无 `location`、被策略禁用）返回 `null`。 */
function defaultFragment(): PendingLoginFragment | null {
  try {
    const loc = globalThis.location;
    if (loc === undefined || loc === null) return null;
    return {
      read: () => (loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash),
      clear: () => {
        /**
         * 🔴 **`replaceState` 而不是 `location.hash = ''`**：
         * 后者会**再压一条历史记录**，于是用户按"后退"又回到带令牌的 URL ——
         * 那正是要消除的东西。前者是原地改写当前这条。
         */
        globalThis.history.replaceState(null, '', `${loc.pathname}${loc.search}`);
      },
    };
  } catch {
    return null;
  }
}

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
/** 壳交付的会话（已签发），与链接令牌区分开。 */
export interface PendingSession {
  readonly baseUrl: string;
  readonly token: string;
  readonly email: string;
}

/**
 * 读出并立即清除**壳交付的会话**（ADR-0039 §2.3）。
 *
 * 与 `takePendingLogin` 同一套纪律：**先删再判**，无论后面成不成功都不留在存储里。
 */
export function takePendingSession(
  storage: PendingLoginStorage | null = defaultStorage(),
): PendingSession | null {
  if (storage === null) return null;

  let token: string | null = null;
  try {
    token = storage.getItem(PENDING_SESSION_KEY);
  } catch {
    return null;
  }

  /**
   * 🔴 **先判有没有会话，再决定动不动别的键。**
   *
   * `loginBaseUrl` 是**两条通道共用**的。第一版这里无条件把三个键全删了，
   * 于是链接那条路接着取 `loginBaseUrl` 时已经是空 ⇒ 整条登录静默变成
   * "没登上"（`apps/web/tests/pending-login.spec.ts` 的两条断言当场红 —— 2026-09-30）。
   * 没有会话时**一个键都不许动**。
   */
  if (token === null || token === '') return null;

  let baseUrl: string | null = null;
  let email: string | null = null;
  try {
    baseUrl = storage.getItem(PENDING_BASE_URL_KEY);
    email = storage.getItem(PENDING_EMAIL_KEY);
  } catch {
    return null;
  }
  try {
    storage.removeItem(PENDING_SESSION_KEY);
    storage.removeItem(PENDING_BASE_URL_KEY);
    storage.removeItem(PENDING_EMAIL_KEY);
  } catch {
    /* 删不掉也按"没有"处理 —— 但下面仍会用读到的值，所以这里什么都不做。 */
  }
  if (baseUrl === null || baseUrl === '') return null;
  return { baseUrl, token, email: email ?? '' };
}

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
  fragment: PendingLoginFragment | null = defaultFragment(),
): Promise<boolean> {
  /**
   * 🔴 **顺序：fragment → 存储里的会话 → 存储里的链接令牌。**
   *
   * fragment 排第一，因为它是**邮件确认页**的投递：那个页面刚刚 POST 出了会话，
   * 正在跳过来，是"最新鲜"的那一份（而且它一走完就会被抹掉，不会赖着）。
   *
   * 两条会话通道（fragment / 存储）是**投递方式不同、东西相同**：
   * fragment 跨 agent cluster（见文件头），存储那条只对桌面壳成立。
   * 它们后面是**同一条**落地路径 `adoptSession()` —— 不是两份"登录成功后做什么"。
   *
   * 链接令牌排最后：它还得再去服务端**换**一次，是三条里唯一有网络往返的。
   */
  const fromFragment = takePendingSessionFromFragment(fragment);
  if (fromFragment !== null) {
    useAuthStore.getState().adoptSession(fromFragment.baseUrl, {
      token: fromFragment.token,
      user: { id: 0, email: fromFragment.email },
    });
    return true;
  }

  /**
   * 🔴 **再看"壳交付的会话"那条**（ADR-0039 §2.3）。
   *
   * 它与链接令牌是两种东西：会话**已经签发**，直接采用即可；
   * 拿它去 `verify()` 会被服务端按链接令牌那一列查 ⇒ 401（实测）。
   */
  const session = takePendingSession(storage);
  if (session !== null) {
    useAuthStore.getState().adoptSession(session.baseUrl, {
      token: session.token,
      // 壳只知道会话令牌与邮箱（邮箱是它从回调 URL 里带回来的）。
      user: { id: 0, email: session.email },
    });
    return true;
  }

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