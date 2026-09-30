/**
 * 管理端点的准入闸门。
 * ====================
 *
 * 依据：[`docs/adr/0038-admin-console-scope.md`](../../../docs/adr/0038-admin-console-scope.md) §4.3。
 *
 * ## 🔴 服务端是唯一裁决者
 *
 * 前端把后台入口藏起来只是 UX。**授权只由这里决定** —— 一个拿着别人令牌的人
 * 手动请求 `/api/admin/*`，必须拿到 403。前端隐藏入口**不是**安全措施。
 *
 * ## 为什么认证与判权在**同一个** hook 里，而不是两个 `preHandler`
 *
 * 两个 hook 会引入一个**静默**的顺序依赖：`requireAdmin` 依赖 `req.user`，
 * 而 `req.user` 由 `authenticate` 填。排错了（或有人后来插了一个 hook 在中间）
 * 不会报错，只会让判权读到 `undefined`。
 *
 * 放进一个函数里，顺序变成**代码顺序**，不可能排错。
 * 认证失败时直接把 `authenticate` 的回复原样返回（401），不再往下走。
 *
 * ## 为什么每次请求都查库
 *
 * 因为**撤销必须立刻生效**。把 `isAdmin` 塞进 JWT 的 claim 会让撤销等到
 * 令牌过期才生效 —— 而"撤销一个管理员的权限"恰恰是发现异常时要做的事。
 * 一次按主键的 `findUnique` 是这条路径上最便宜的一步。
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import { prisma } from '../db';
import { authenticate, getAuthUser } from '../middleware';

export const requireAdmin = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> => {
  // 第一步：普通认证。失败时 `authenticate` 已经发好了 401，原样返回即终止。
  const denied = await authenticate(req, reply);
  if (denied !== undefined) return denied;

  // 走到这里 `req.user` 一定有；没有就是代码错误，让它响亮地抛（500），
  // 而不是退化成一个"看起来正常的 401"。
  const { userId } = getAuthUser(req);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });

  // 🔴 用户不存在与"不是管理员"返回**同一个**响应：不告诉调用方
  // "这个账号存在但没权限"。
  if (user === null || !user.isAdmin) {
    return reply.code(403).send({ error: 'Admin access required.' });
  }
};
