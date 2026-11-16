/**
 * Web API clients use the same Bearer transport as sync and vault.
 *
 * 认证只有自建「邮箱+密码」一种：不再有官方中央 OIDC 的 cookie 会话传输，
 * 因此这里始终返回标准 `fetch`（凭据走 `Authorization: Bearer`）。
 * 保留第二参数只为兼容既有调用点（它们会传 `'bearer'`）。
 */
export function createWebAuthFetch(_baseUrl: string, _authTransport: 'bearer' | 'cookie' = 'bearer'): typeof fetch {
  return globalThis.fetch.bind(globalThis);
}
