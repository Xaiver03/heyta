/**
 * `/api/shares/*` 的 HTTP 客户端（ADR-0062；端点族见
 * `server/src/shares/share.routes.ts` 的路由总表）。
 * ================================================================
 *
 * 与 `SyncClient` 的分工：那份管个人 op-log 的同步；这份管共享域的
 * 成员/邀请/op 通道。形状照 `SyncClient` 的惯例：`fetchImpl` 可注入
 * （测试零 mock 网络——注入的是**真 fetch 的替身函数**，断言的是
 * URL/方法/头/体的形状）；JWT 走 Bearer 头。
 *
 * 🔴 错误码是服务端 `SHARE_ERROR_CODES` 的镜像（稳定值，客户端机器匹配）；
 * `error` 自由文本不进本文件。网络层错误统一归类 `network`——
 * 与 `SyncClient` 的失败分类同一条纪律。
 *
 * 密码学不在本层：`payload`（share op 密文信封）与 `keyEnvelope`
 * 的加解密在 `share-payload-cipher.ts` 与 `@heyta/sync-core`——
 * 本层是**纯传输**，看见的与服务器一样多（全是密文与元数据）。
 */

export const SHARE_ERROR_CODES = {
  NOT_FOUND: 'SHARE_NOT_FOUND',
  ROLE_FORBIDDEN: 'SHARE_ROLE_FORBIDDEN',
  ENTITY_TYPE_NOT_SHAREABLE: 'SHARE_ENTITY_TYPE_NOT_SHAREABLE',
  MEMBER_LIMIT: 'SHARE_MEMBER_LIMIT',
  INVITATION_INVALID: 'SHARE_INVITATION_INVALID',
  INVITATION_EXPIRED: 'SHARE_INVITATION_EXPIRED',
  INVITATION_REVOKED: 'SHARE_INVITATION_REVOKED',
  ALREADY_MEMBER: 'SHARE_ALREADY_MEMBER',
  OWNER_CANNOT_LEAVE: 'SHARE_OWNER_CANNOT_LEAVE',
  // B-10：转让的接收方手里没有当前世代的清单钥（信封为空或世代落后）。
  TRANSFER_TARGET_UNSEALED: 'SHARE_TRANSFER_TARGET_UNSEALED',
  // ADR-0069 裁决二：签名公钥已在册且不同 ⇒ 补发被拒（不换钥）。
  SIGNING_KEY_CONFLICT: 'SHARE_SIGNING_KEY_CONFLICT',
  // ADR-0069 裁决四：上传边界的逐 op 签名判定（三态各一枚，客户端据此决定"要不要再试"）。
  OP_UNSIGNED: 'SHARE_OP_UNSIGNED',
  OP_SIGNATURE_INVALID: 'SHARE_OP_SIGNATURE_INVALID',
  OP_SIGNING_KEY_UNREGISTERED: 'SHARE_OP_SIGNING_KEY_UNREGISTERED',
} as const;

export type ShareApiErrorCode =
  | keyof typeof SHARE_ERROR_CODES
  | 'INVALID_ENTITY_TYPE'
  | 'VALIDATION_FAILED'
  | 'DUPLICATE_OPERATION'
  | 'network';

export class ShareApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ShareApiErrorCode | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ShareApiError';
  }
}

export interface ShareApiClientOptions {
  /** 服务端根（如 `https://heyta.example`）；不带尾斜杠。 */
  baseUrl: string;
  /** 返回当前账号的访问令牌（JWT）；调用方负责令牌刷新。 */
  getToken: () => string;
  /** Official Web uses the host-only session cookie instead of a bearer token. */
  authTransport?: 'bearer' | 'cookie';
  /** 网络实现，便于测试注入。默认用 globalThis.fetch。 */
  fetchImpl?: typeof fetch;
}

export interface ShareInfo {
  shareId: string;
  ownerId: number;
  keyEpoch: number;
  role: string;
  memberKeyEpoch: number;
  hasEnvelope: boolean;
}

export interface RemovedMembership {
  shareId: string;
  removedAt: number | null;
}

export interface ShareMemberRow {
  memberId: string;
  userId: number;
  role: string;
  addedAt: number | null;
  hasEnvelope: boolean;
  memberKeyEpoch: number;
  identityPublicKey?: string | null;
  /**
   * Ed25519 签名公钥（ADR-0069 裁决二/三）—— 读侧用它把「这条 op 是谁写的」钉死。
   * `null`/缺省 = 这个人还没自证 ⇒ 他的 op 只能读成「未签名」，不许当成「已验证」。
   */
  signingPublicKey?: string | null;
  keyEnvelope?: unknown;
}

export interface ShareOpWire {
  id: string;
  clientId: string;
  serverSeq: number;
  actionType: string;
  opType: string;
  entityType: string;
  entityId?: string | null;
  entityIds?: string[];
  payload: unknown;
  vectorClock: unknown;
  schemaVersion: number;
  clientTimestamp: number | null;
  isPayloadEncrypted: boolean;
  /**
   * 写这条 op 的成员行 id（服务端按**认证上传者**写库，不是客户端声明）。
   * `null` = 这条比签名还早（存量，ADR-0069 裁决六"不追签"）⇒ 读侧只能读成"未签名"。
   */
  signerMemberId?: string | null;
  /** Ed25519 签名的 base64。`null`/缺省 = 未签名，**不等于**已验证。 */
  signature?: string | null;
}

export interface ShareOpUploadResult {
  accepted: Array<{ id: string; serverSeq: number }>;
  rejected: Array<{ id: string; code: string }>;
  latestServerSeq: number;
}

/** 帮助器把非 2xx 归一成 ShareApiError；网络异常归 `network`。 */
async function request<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  token: string,
  authTransport: 'bearer' | 'cookie',
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(authTransport === 'bearer' ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(authTransport === 'cookie' ? { credentials: 'include' as const } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ShareApiError(0, 'network', 'Network error');
  }
  let json: unknown = null;
  try { json = await res.json(); } catch { /* 204 等 */ }
  if (!res.ok) {
    const err = (json ?? {}) as { code?: string; message?: string; error?: string };
    throw new ShareApiError(res.status, err.code as ShareApiErrorCode | undefined, err.message ?? err.error ?? `HTTP ${res.status}`);
  }
  return json as T;
}

/** `/api/shares/*` 的类型化客户端。一个实例 = 一个已登录账号。 */
export class ShareApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ShareApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    if (!options.baseUrl) throw new Error('ShareApiClient: baseUrl is required');
    if (!options.getToken) throw new Error('ShareApiClient: getToken is required');
  }

  private call<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    return request<T>(this.fetchImpl, this.options.baseUrl, this.options.getToken(), this.options.authTransport ?? 'bearer', method, path, body);
  }

  createShare(): Promise<{ shareId: string; keyEpoch: number; memberId: string; role: 'owner'; createdAt: number }> {
    return this.call('POST', '/api/shares', {});
  }

  listShares(): Promise<{
    shares: Array<ShareInfo & { addedAt?: number | null }>;
    removedMemberships: RemovedMembership[];
  }> {
    return this.call('GET', '/api/shares');
  }

  shareDetail(shareId: string): Promise<{ shareId: string; ownerId: number; keyEpoch: number; yourRole: string }> {
    return this.call('GET', `/api/shares/${shareId}`);
  }

  createInvitation(shareId: string, input: { invitedEmail?: string; ttlDays?: number } = {}):
    Promise<{ invitationId: string; token: string; expiresAt: number | null }> {
    return this.call('POST', `/api/shares/${shareId}/invitations`, input);
  }

  listInvitations(shareId: string): Promise<{
    invitations: Array<{
      invitationId: string; invitedByEmail: string | null; createdAt: number | null;
      expiresAt: number | null; revokedAt: number | null; acceptedAt: number | null;
    }>;
  }> {
    return this.call('GET', `/api/shares/${shareId}/invitations`);
  }

  revokeInvitation(shareId: string, invitationId: string): Promise<{ revoked: boolean }> {
    return this.call('DELETE', `/api/shares/${shareId}/invitations/${invitationId}`);
  }

  acceptInvitation(input: { token: string; identityPublicKey: string; signingPublicKey?: string }):
    Promise<{ shareId: string; memberId: string; role: string; keyEpoch: number }> {
    return this.call('POST', '/api/shares/invitations/accept', input);
  }

  listMembers(shareId: string): Promise<{ members: ShareMemberRow[] }> {
    return this.call('GET', `/api/shares/${shareId}/members`);
  }

  patchMemberRole(shareId: string, memberId: string, role: string): Promise<{ memberId: string; role: string }> {
    return this.call('PATCH', `/api/shares/${shareId}/members/${memberId}`, { role });
  }

  putMemberEnvelope(shareId: string, memberId: string, input: { keyEpoch: number; keyEnvelope: object }):
    Promise<{ memberId: string; memberKeyEpoch: number }> {
    return this.call('PUT', `/api/shares/${shareId}/members/${memberId}/envelope`, input);
  }

  /**
   * 发布/补发自己的 Ed25519 签名公钥（ADR-0069 裁决二）。
   *
   * 🔴 只有**本人**这一条腿：服务端把 `memberId` 不等于调用者成员行的请求一律打 404。
   * 信封可以由 owner 代填（他替别人持清单钥），签名公钥不行 —— 那一格代表
   * "这把私钥的主人是谁"，让第三人填得动就等于把判定权交出去。
   * 幂等：重发同一枚公钥是成功；发第二枚不同的公钥 ⇒ `SIGNING_KEY_CONFLICT`。
   */
  putMemberSigningKey(shareId: string, memberId: string, signingPublicKey: string):
    Promise<{ memberId: string; signingPublicKey: string }> {
    return this.call('PUT', `/api/shares/${shareId}/members/${memberId}/signing-key`, { signingPublicKey });
  }

  removeMember(shareId: string, memberId: string): Promise<{ removed: boolean }> {
    return this.call('DELETE', `/api/shares/${shareId}/members/${memberId}`);
  }

  /**
   * 转让所有权（owner 专属；W6）。语义：目标成员升 owner、**原 owner 降 editor**、
   * `share.ownerUserId` 同步换人 —— 三处由服务端在一个事务里完成。
   */
  transferOwnership(shareId: string, memberId: string): Promise<{
    shareId: string;
    ownerId: number;
    newOwnerMemberId: string;
    demotedMemberId: string;
    demotedRole: string;
  }> {
    return this.call('POST', `/api/shares/${shareId}/transfer`, { memberId });
  }

  leaveShare(shareId: string): Promise<{ left: boolean }> {
    return this.call('POST', `/api/shares/${shareId}/leave`);
  }

  uploadOps(shareId: string, ops: readonly unknown[]): Promise<ShareOpUploadResult> {
    return this.call('POST', `/api/shares/${shareId}/ops`, { ops });
  }

  downloadOps(shareId: string, after: number, limit = 200): Promise<{
    ops: ShareOpWire[];
    cursor: { latestServerSeq: number };
  }> {
    return this.call('GET', `/api/shares/${shareId}/ops/causal?after=${after}&limit=${limit}`);
  }
}
