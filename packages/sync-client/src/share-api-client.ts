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

const SHARE_ERROR_CODES = {
  NOT_FOUND: 'SHARE_NOT_FOUND',
  ROLE_FORBIDDEN: 'SHARE_ROLE_FORBIDDEN',
  ENTITY_TYPE_NOT_SHAREABLE: 'SHARE_ENTITY_TYPE_NOT_SHAREABLE',
  MEMBER_LIMIT: 'SHARE_MEMBER_LIMIT',
  INVITATION_INVALID: 'SHARE_INVITATION_INVALID',
  INVITATION_EXPIRED: 'SHARE_INVITATION_EXPIRED',
  INVITATION_REVOKED: 'SHARE_INVITATION_REVOKED',
  ALREADY_MEMBER: 'SHARE_ALREADY_MEMBER',
  OWNER_CANNOT_LEAVE: 'SHARE_OWNER_CANNOT_LEAVE',
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
        authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ShareApiError(0, 'network', 'Network error');
  }
  let json: unknown = null;
  try { json = await res.json(); } catch { /* 204 等 */ }
  if (!res.ok) {
    const err = (json ?? {}) as { code?: string; error?: string };
    throw new ShareApiError(res.status, err.code as ShareApiErrorCode | undefined, err.error ?? `HTTP ${res.status}`);
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
    return request<T>(this.fetchImpl, this.options.baseUrl, this.options.getToken(), method, path, body);
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

  acceptInvitation(input: { token: string; identityPublicKey: string }):
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

  removeMember(shareId: string, memberId: string): Promise<{ removed: boolean }> {
    return this.call('DELETE', `/api/shares/${shareId}/members/${memberId}`);
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
