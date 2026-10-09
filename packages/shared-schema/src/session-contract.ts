/**
 * 登录会话（一枚已签发的令牌）的 **HTTP 契约**。
 *
 * 裁决在 [ADR-0063](../../../docs/adr/0063-email-rebinding-and-per-session-revocation.md) §2.5。
 *
 * ## 这一族存在的唯一理由
 *
 * 「退出登录」今天**不撤销任何东西**。`issueSession` 签的 JWT 有效期 365 天
 * （`JWT_EXPIRY`），而撤销只有**一档**：`tokenVersion++`，它是全局的。于是
 * `apps/web/src/App.tsx:2146` 那个 `onSignOut` 做的是 `clearCredentials()` —— 纯本机删除，
 * 而那枚令牌在服务端**仍然有效一整年**。在共享电脑上，"我已经退出了"是一句界面在说谎。
 *
 * ## 为什么不复用那张早已存在的"设备"表
 *
 * `sync_devices` 上有 `deviceName` / `userAgent` / `lastSeenAt`，长得就像会话列表，
 * 而 `DELETE /api/sync/devices/:clientId` 干的事是 `revokeDevice` **再跟一次
 * `revokeAllTokens(userId)`**（`server/src/sync/sync.routes.ts:391-392`）——
 * **撤销一台 = 全部登出**。它治的是同步面的信任关系（那台设备还进不进得来密文），
 * 不是"这一枚访问令牌还有效吗"。两件事各自都缺一半：
 *
 * | 想要的动作 | 今天有什么 | 缺什么 |
 * |---|---|---|
 * | 退出**这一台** | 只清本机凭据 | 令牌不失效（本契约补它） |
 * | 登出**所有**设备 | `/api/replace-token` 早就在（`api.ts:990`） | **客户端零调用点**，`app-host` 里连函数都没有 |
 * | 只踢掉某一**台** | 只有全量 bump | 按令牌逐个撤销（本契约补它） |
 *
 * ⚠️ 边界：本轮之前签出去的令牌**没有 `jti`**，因此不可单独撤销，只能走全局 bump。
 * 这是有意接受的过渡（heyta 在开发阶段，无存量用户），不是"已经解决"。
 */

/** 相对服务端根的路径（不带 `/api`），与 `ACCOUNT_PROFILE_PATHS` 同一形状。四条全部要 Bearer。 */
export const SESSION_PATHS = {
  /** `GET` 列出本人当前有效的会话，带"这是不是手上这一枚"的标记。 */
  list: 'auth/sessions',
  /**
   * `POST` 撤销**全部**会话，**包括手上这一枚**。
   *
   * 🔴 实现里做的是 `revokeAllSessions()` + `revokeAllTokens()`：只删库里的行会让
   * 本轮之前那些**没有 `jti`** 的令牌活得好好的，而"登出所有设备"说的那句话必须是真的。
   * ⇒ 调用方**必须**把本机凭据也清掉（这一台同样被登出了），
   * 判据在 `packages/app-host/src/account-security.ts` 的 `planSignOut`。
   */
  revokeAll: 'auth/sessions/revoke-all',
  /** `POST` 撤销**手上这一枚**（"退出登录"真正该做的事），随后客户端清本机凭据。 */
  logout: 'auth/logout',
} as const;

/**
 * `DELETE` 那一族的**相对**形状：`auth/sessions/<sessionId>`。
 *
 * 写成函数而不是模板字符串，理由与 `hosted-auth.ts` 的 `passkeyPath(id)` 同一条：
 * 路径里带变量时，"服务端注册的形状"与"客户端拼的形状"最容易各写一份。
 */
export const sessionRevokePath = (sessionId: string): string =>
  `${SESSION_PATHS.list}/${encodeURIComponent(sessionId)}`;

/** 会话这条路上的稳定机器码。 */
export const SESSION_ERROR_CODES = [
  /**
   * 这一枚会话不存在、不属于你、或**已经被撤销过**。🔴 三者同一句。
   *
   * 与 `invalid_change_link` / `invalid_reset_link` 同一条立场：区分"已经撤过"和"从来没有"
   * 不改变任何人的动作（都是"那就不用管它了"），却会给一个猜测性的枚举面。
   */
  'unknown_session',
] as const;

export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[number];

/**
 * 列表里的一行。**白名单投影** —— 没有 `jti` 明文、没有令牌、没有 IP、没有任何
 * 别人能拿来重放的东西。
 *
 * ⚠️ `deviceName` / `userAgent` 是**新增的元数据类别**，必须进
 *《个人信息收集清单》与隐私政策"端到端加密覆盖内容、不覆盖元数据"那一节的枚举，
 * 不能只在技术台账里记一笔。
 */
export interface SessionSummary {
  /** 库里那一行的主键（SHA-256 hex）。撤销时按它寻址，**不是**令牌本身。 */
  readonly sessionId: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly deviceName: string | null;
  readonly userAgent: string | null;
  /**
   * 这一行就是**当前这次调用所用的那枚令牌**。
   *
   * 🔴 由服务端比对自己验出来的 `jti`，不信客户端传来的任何标记。界面上
   * "这是本设备"那句话只能建立在这一个布尔上，否则用户会在别的设备上
   * 把"退出登录"点成撤销自己的。
   */
  readonly current: boolean;
}

export interface SessionListResponse {
  sessions: SessionSummary[];
}
