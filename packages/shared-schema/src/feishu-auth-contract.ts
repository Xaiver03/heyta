/**
 * 飞书（Lark）网页应用登录的 **HTTP 契约**（服务端与宿主共用）
 * ============================================================
 *
 * 与 `auth-http-contract.ts` 同一档：**只放必须跨端逐字相同的东西** —— 路径、稳定机器码。
 * 飞书 OAuth 的授权码/令牌交换全在服务端（`server/src/feishu/feishu-oauth-client.ts`），
 * 宿主只做两件事：**跳**到 `/start`、以及把回调投递回来的会话采用掉。
 *
 * 为什么不搬 zod 请求体：与 `auth-http-contract.ts` 文件头同一条理由 —— 宿主不校验
 * 自己的请求，搬一半的契约比没有更危险。这里只有路径与错误码。
 *
 * 路径是**相对**形状（服务端挂在 `prefix: '/api'` 下，见 `server/src/server.ts`），
 * 拼接时补 `/api`。
 */

export const FEISHU_AUTH_PATHS = {
  /** 这台实例有没有配好飞书登录。宿主据此决定显示不显示入口。GET，匿名可读。 */
  status: '/auth/feishu/status',
  /** 发起授权：服务端种一次性 state cookie 后 302 到飞书授权页。**顶层跳转**，不是 fetch。 */
  start: '/auth/feishu/start',
  /** 飞书回调：校验 state，换令牌，落地账号，最后 302 回产物页并带上会话 fragment。 */
  callback: '/auth/feishu/callback',
} as const;

/**
 * 回传给前端 `feishu_error` query 的固定错误码（前端按白名单映射文案，
 * **绝不回显上游自由文本** —— 那会泄漏应用信息）。
 *
 * - `not_configured`：这台实例没配飞书登录。
 * - `invalid_state`：state 缺失/过期/与浏览器 cookie 不符（防登录 CSRF）。
 * - `access_denied`：用户在飞书授权页点了拒绝。
 * - `missing_code`：回调没带 code。
 * - `auth_failed`：用 code 换 token 或取用户信息失败。
 * - `login_failed`：落地成账号/签发会话时失败（未预期）。
 * - `not_bound`：管理面登录，但这枚飞书身份没绑到任何管理员账号（不自动提权）。
 * - `not_admin`：飞书身份绑到了账号，但那个账号不是管理员。
 * - `email_taken`：普通面首次登录时飞书邮箱命中一个已有账号 —— 不认领，提示改用邮箱登录后绑定。
 * - `tenant_denied`：这台实例只允许指定飞书租户登录。
 * - `too_many`：发起太频繁。
 */
export const FEISHU_AUTH_ERROR_CODES = [
  'not_configured',
  'invalid_state',
  'access_denied',
  'missing_code',
  'auth_failed',
  'login_failed',
  'not_bound',
  'not_admin',
  'email_taken',
  'tenant_denied',
  'too_many',
] as const;

export type FeishuAuthErrorCode = (typeof FEISHU_AUTH_ERROR_CODES)[number];

/** `/auth/feishu/status` 的响应体。 */
export interface FeishuAuthStatusResponse {
  enabled: boolean;
}

/** 登录面向：`app` 是普通用户面，`admin` 是管理后台面（只放行管理员）。 */
export type FeishuAuthScope = 'app' | 'admin';
