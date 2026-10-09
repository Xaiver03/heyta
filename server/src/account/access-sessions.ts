/**
 * 登录会话（一枚已签发的访问令牌）的**库面**。
 *
 * 裁决在 [ADR-0063](../../../docs/adr/0063-email-rebinding-and-per-session-revocation.md) §2.5，
 * 形状与"为什么这张表存在"写在 `server/prisma/schema.prisma` 的 `AccessSession` 那段与
 * `packages/shared-schema/src/session-contract.ts` 文件头。这里只写**怎么做到而不把鉴权变成热写路径**。
 *
 * ## 三条不能各写一份的规则
 *
 * 1. **铸令牌 = 签 JWT + 落这一行**，两件事必须在同一个函数里，否则"库里没有这一行"的令牌
 *    会被自己的检查拒掉。所以 `auth.ts` 的 `issueSession()` 是**唯一**的出口，`jwt.sign` 不许出现在别处
 *    （本轮之前 `auth.ts:237` 与 `api.ts:1370` 各有一份裸 `jwt.sign`，注释还写着
 *    "same format as password login" —— 那是同一件事的第二份实现，AGENTS §3.5 的第四次复发）。
 * 2. **先插行、后签名**。插失败就抛，绝不返回一枚"自己验不过"的令牌。
 * 3. **这一行不存在 = 这枚令牌不能用**（撤销 = 删行，不是置标记）。但检查**只在鉴权缓存未命中时**
 *    发生，与 `tokenVersion` 完全同一档；任何撤销都当场 `authCache.invalidate(userId)`。
 *    🔴 这两句加起来只在**缓存按会话分格**之后才挡得住撤销：那一格按 `userId` 存的时候，
 *    同账号另一台的鉴权会把这一枚的会话检查替掉（撤 C 后只要 B 还在同步，C 仍 200，实测）。
 *    判据在 `tests/access-sessions.spec.ts` 最后那两条、`tests/auth-cache.spec.ts` 与
 *    真库集成 `链路 3b`；成因与三层读数见仓库 `docs/plans/account-standard-suite.md` §6.7。
 *
 * ## 为什么 `jti` 缺失时**跳过**检查（而不是拒绝）
 *
 * 本轮之前签出去的令牌没有 `jti`，它们**不可单独撤销**，只能走全局 `tokenVersion++`。
 * 攻击者伪造不出这种令牌（签名那一道就过不去），所以这一支只覆盖两类东西：
 * 变更之前真实签发的令牌，以及测试里手工造的 JWT。把它写成"跳过"而不是"允许无 jti 登录"，
 * 是因为铸造口现在**永远**带 `jti` —— 少一道判据的话，下一个人顺手去掉 `jti` 就等于
 * 关掉整层检查。判据在 `server/tests/access-sessions.spec.ts` 的"没有 jti 的令牌仍然过、
 * 但**这一层不因此失效**"那两条。
 */
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../db';
import { Logger } from '../logger';
import { getWsConnectionService } from '../sync/services/websocket-connection.service';

/** `last_seen_at` 的写入节流：距上次记录超过这个间隔才 UPDATE。 */
export const SESSION_LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * `jti` → 库里那一行的主键。
 *
 * 🔴 存哈希不存原值：`jti` 就在令牌里（JWT 的 payload 只是 base64url，**不是加密**），
 * 会话列表把哈希交给界面，别让它顺手变成一个可以照抄的凭据来源。
 * 与 `users` 上那四列同一条立场（`server/src/auth-tokens.ts`）。
 */
export function sessionIdOf(jti: string): string {
  return createHash('sha256').update(jti, 'utf8').digest('hex');
}

/** 一枚新令牌的身份。`mintAccessToken` 是唯一能造出它的地方。 */
export interface MintedToken {
  token: string;
  /** 写进 JWT payload 的那个值（`jti`）。 */
  jti: string;
  /** 库里那一行的主键，界面与撤销都用它。 */
  sessionId: string;
}

/**
 * 落一行会话。**必须**在签名之前调用。
 *
 * `deviceName` 今天**没有任何一条登录路由接收它** —— 列先建着、留空，等客户端上报。
 *
 * 🔴 `userAgent` 则是**每一条登录路都带**（2026-10-08 工单 W10）。在这笔之前只有
 * `POST /auth/passkey/verify` 那一条带，其余五条登录路（口令登录、魔法登录、邮箱链接注册、
 * 注册验证码激活、修改口令后换发的新令牌）签出的会话行两列皆空 —— 于是「登录设备」列表里
 * 大多数行没有任何可辨认的来源，"退出这一台"就退化成"退出所有"。收口点是
 * `sessionMetaFromRequest()`：六处各写一遍 `req.headers['user-agent']` 就是六份会各自漂的取法。
 * 写成"可选且不猜"是因为把 `User-Agent` 的解析结果当设备名会造出一句用户看不懂的话；
 * 那句要等真有客户端上报再写。
 */
/** 一条会话的来源元数据。**只有这两样**是登录路上能如实拿到的东西。 */
export type SessionMeta = {
  userAgent?: string | null;
  deviceName?: string | null;
};

/**
 * 从一条 Fastify 请求上取会话元数据 —— 各条登录路**共用这一份取法**。
 *
 * `user-agent` 在 Node 的类型里可能是数组（少数可重复的头），这里只认字符串：
 * 数组不是合法 UA，宁可为空也不要把 `['a','b']` 写进一列 `TEXT`。
 */
export const sessionMetaFromRequest = (req: {
  headers: Record<string, string | string[] | undefined>;
}): SessionMeta => {
  const ua = req.headers['user-agent'];
  return { userAgent: typeof ua === 'string' ? ua : null };
};

export const recordSession = async (input: {
  jti: string;
  userId: number;
  /** 铸这一枚时账号上那个**全局**计数器 —— 见 schema 上那段：它让"全设备登出"自动等于"列表空掉"。 */
  tokenVersion: number;
  userAgent?: string | null;
  deviceName?: string | null;
}): Promise<string> => {
  const now = BigInt(Date.now());
  const sessionId = sessionIdOf(input.jti);
  await prisma.accessSession.create({
    data: {
      jtiHash: sessionId,
      userId: input.userId,
      tokenVersion: input.tokenVersion,
      userAgent: input.userAgent ?? null,
      deviceName: input.deviceName ?? null,
      createdAt: now,
      lastSeenAt: now,
    },
  });
  return sessionId;
};

/** 生成一枚新的 `jti`（32 个 hex 字符；它不是秘密，秘密是签名）。 */
export const newJti = (): string => randomBytes(16).toString('hex');

/**
 * 这一枚会话还活着吗。
 *
 * 🔴 **行的存在**就是答案，所以这里只查存在性，不查标记位 —— 撤销是删行（GDPR 侧要的是
 * 最小留存，而"撤过的会话"没有任何产品用途；审计走 `Logger.audit`）。
 *
 * `userId` 进 `where` 不是防攻击（要伪造这一枚得先过签名那一道），是让"读到别人的行"
 * 这种形状**写不出来** —— 与本仓 `account-profile.routes.ts` 那句"查别人的资料在这里写不出来"
 * 同一条手法。
 */
export const sessionIsLive = async (userId: number, sessionId: string): Promise<boolean> => {
  const row = await prisma.accessSession.findFirst({
    where: { jtiHash: sessionId, userId },
    select: { lastSeenAt: true },
  });
  if (!row) return false;
  await touchSession(sessionId, row.lastSeenAt);
  return true;
};

/**
 * 更新"最后一次被用到"的时刻，**带节流**。
 *
 * 没有这道节流，每一次鉴权都会写一行 —— 而 `verifyToken` 的缓存未命中在活跃用户上是
 * 每 30 s 一次。5 分钟是刻意的粗粒度：这个字段是给"这台设备上次出现在什么时候"那句
 * 人话用的，不是给审计用的。
 *
 * ⚠️ 失败**不抛**：一次 `last_seen_at` 没写进去不该让一次合法请求变成 500。
 * 但它是**响亮**的 `Logger.error`，不是 `catch {}`。
 */
export const touchSession = async (sessionId: string, lastSeenAt: bigint): Promise<void> => {
  const now = Date.now();
  if (lastSeenAt >= BigInt(now - SESSION_LAST_SEEN_WRITE_INTERVAL_MS)) return;
  try {
    await prisma.accessSession.update({
      where: { jtiHash: sessionId },
      data: { lastSeenAt: BigInt(now) },
    });
  } catch (err) {
    Logger.error(
      `Could not record last-seen for a session: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
};

export interface SessionRow {
  sessionId: string;
  createdAt: number;
  lastSeenAt: number;
  deviceName: string | null;
  userAgent: string | null;
  current: boolean;
}

/**
 * 列出本人**当前仍然有效**的会话，并把**手上这一枚**标成 `current`。
 *
 * 🔴 `tokenVersion` 是这一句的**主语**的一部分：只列"版本号还等于账号上那个"的行。
 * 少了这个过滤，用户在设置里改完一次密码之后，「登录设备」会继续列出**那些其实早就
 * 登不进来的设备**，而"退出登录撤销不了它们"就变成一句界面上的谎 —— 那正是本轮整件事的起点。
 *
 * 🔴 `current` 由服务端比对自己验出来的 `jti`，**不信**客户端传来的任何标记 ——
 * 否则用户会在别的设备上把"退出登录"点成撤销自己的。
 * 输出是**白名单投影**：没有 `jti` 明文、没有令牌、没有 IP。
 */
export const listSessions = async (
  userId: number,
  tokenVersion: number,
  currentSessionId: string | null,
): Promise<SessionRow[]> => {
  const rows = await prisma.accessSession.findMany({
    where: { userId, tokenVersion },
    orderBy: { createdAt: 'desc' },
    select: {
      jtiHash: true,
      createdAt: true,
      lastSeenAt: true,
      deviceName: true,
      userAgent: true,
    },
  });
  return rows.map((row) => ({
    sessionId: row.jtiHash,
    createdAt: Number(row.createdAt),
    lastSeenAt: Number(row.lastSeenAt),
    deviceName: row.deviceName,
    userAgent: row.userAgent,
    current: currentSessionId !== null && row.jtiHash === currentSessionId,
  }));
};

/**
 * 撤销**一枚**会话 = 删掉那一行。
 *
 * @returns 是否真的删掉了一行。`false` = 不存在 / 不是他的 / 已经撤过 ——
 * 🔴 三者**故意同一句**（与 `invalid_reset_link`、`invalid_change_link` 同一条立场），
 * 所以调用方**不许**把 `false` 渲染成"这个会话不存在"。
 */
export const revokeSession = async (userId: number, sessionId: string): Promise<boolean> => {
  const deleted = await prisma.accessSession.deleteMany({
    where: { jtiHash: sessionId, userId },
  });
  if (deleted.count !== 1) {
    return false;
  }
  // 🔴 那一枚的实时通道也要当场断掉。删行与失效缓存只管得住**下一句 HTTP 请求**，
  // 而那一台**已经开着的页面**只在 upgrade 时鉴权 —— 不关它就继续收这个账号的 op，
  // 直到它自己重连。逐枚只关这一枚：`closeForUser` 是 `revoke-all` 的语义，会把别的设备一起退出。
  getWsConnectionService().closeForSession(userId, sessionId);
  return true;
};

/**
 * 撤销本人**全部**会话。
 *
 * ⚠️ 它**不**负责 bump `tokenVersion` —— 那一半是调用方的事（`revokeAllTokens`）。
 * 分开的理由：本轮之前签的没有 `jti` 的令牌**只能**靠计数器失效，
 * 所以"清库里的行"与"让旧计数器作废"是两件事，必须由同一条路各做一次。
 */
export const revokeAllSessions = async (userId: number): Promise<number> => {
  const deleted = await prisma.accessSession.deleteMany({ where: { userId } });
  return deleted.count;
};

/**
 * 「全设备登出」的**另一半**：删掉所有会话行 **并**关掉所有实时通道。
 *
 * 🔴 这两半必须一起写，因为漏掉的那一半**没有任何界面会报出来**：
 * 实时通道只在 upgrade 时鉴权（`websocket-connection.service.ts` 的 `closeForUser` 上那句
 * "without this a revoked device would keep receiving op notifications indefinitely"），
 * 所以只 bump 计数器 = 那个人的 HTTP 请求当场 401，而他**已经开着的那个页面**继续收
 * 后续的 op 通知。`auth.ts` 里 `TOKEN_REVOKED` 那句注释把"改密 / 换绑 / 管理员强制登出"
 * 都算作撤销事件，而这三条路当时只做了计数器那一半。
 *
 * ⚠️ 仍然**不**碰 `tokenVersion`（同上：那是调用方的事，而且改密/换绑的 bump 和它自己的
 * 那次 `user.update` 必须在同一条写里）。
 *
 * ⚠️ 调用顺序：需要保留当前设备会话的路（`changePassword`）**必须把这一句排在
 * `issueSession` 之前** —— 排后面会把刚铸出来的那一行删掉，界面上就变成"这台设备自己也
 * 不在登录设备列表里了"。
 */
export const revokeAllDeviceSessions = async (userId: number): Promise<number> => {
  const deleted = await revokeAllSessions(userId);
  getWsConnectionService().closeForUser(userId);
  return deleted;
};

/**
 * 清掉**早就过期的**会话行。
 *
 * JWT 的有效期是 365 天（`JWT_EXPIRY`），而令牌过期之后 `jwt.verify` 自己就会拒 ——
 * 那一行留在库里只是把身份元数据多存一段时间。与 `users` 上那四列过期令牌的清扫同一档，
 * 归工单 W8 的 D3。
 */
export const deleteSessionsOlderThan = async (beforeMs: number): Promise<number> => {
  const deleted = await prisma.accessSession.deleteMany({
    where: { createdAt: { lt: BigInt(beforeMs) } },
  });
  return deleted.count;
};
