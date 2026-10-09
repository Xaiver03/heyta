import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from './auth';

// User payload type
export interface AuthUser {
  userId: number;
  email: string;
  tokenVersion?: number;
  /**
   * 手上这一枚令牌在 `access_sessions` 里那一行的主键；`null` = 这一枚是本轮之前签的、没有 `jti`。
   *
   * 🔴 「退出登录」要撤销的就是**这一次调用所用的那枚**，所以它必须由服务端从**自己验过的**
   * payload 里带下来。信客户端传来的『我是哪一台』= 用户会在别的设备上把退出点成撤销自己的。
   */
  sessionId?: string | null;
}

// Extend FastifyRequest to include optional user (before auth)
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * Helper to get authenticated user from request.
 * Use this in route handlers protected by the authenticate preHandler hook.
 * Throws if user is not set (should never happen after authenticate hook).
 */
export const getAuthUser = (req: FastifyRequest): AuthUser => {
  if (!req.user) {
    throw new Error('User not authenticated - missing auth middleware?');
  }
  return req.user;
};

export const authenticate = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.split(' ')[1];

  const result = await verifyToken(token);
  if (!result.valid) {
    // `code` 是给客户端**机器匹配**的稳定值；`error` 是给人看的自由文本，会漂。
    // 注销后要不要销毁本机数据只认前者 —— 见 auth.ts 的 `TokenFailureCode`。
    //
    // 🔴 E1b：账号**注销**用 **410 Gone**，其余仍是 401。
    // 理由不是好看：`401` 的语义是"认证失败，**可以**带着新凭据重试"，
    // 而注销是"这个账号永远不会再有效"。任何按状态码做重试策略的中间层
    // （网关、旧客户端、监控）都会把前者当可重试，于是拿一枚永不复活的令牌
    // 一直敲 —— 那正是本仓库在 `'unauthorized'` 那条上写过的失败形状。
    //
    // ⚠️ 但**客户端的判定不许改成看状态码**（`isAccountClosedFailure` 只认稳定码）。
    // 一条只认 `410` 的判据会在同一个进程里毁掉另一种数据：`401` 的其它码
    // （`TOKEN_REVOKED` = 改口令 / 被踢下线）下正确的动作是**什么都不删**。
    // 410 是对外说的"别重试了"，码是对内说的"删不删"。
    return reply
      .code(result.code === 'ACCOUNT_CLOSED' ? 410 : 401)
      .send({ error: result.reason, code: result.code });
  }

  req.user = {
    userId: result.userId,
    email: result.email,
    tokenVersion: result.tokenVersion,
    sessionId: result.sessionId,
  };
};
