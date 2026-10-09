/**
 * **换绑登录邮箱**的服务端核心（工单 W1，裁决在 ADR-0063 §2.1–§2.4）。
 *
 * ## 为什么这一步要**两边都点**
 *
 * 常见的做法是"确认新邮箱 + 给旧邮箱发一封通知"。在这里不够，理由是一条产品事实：
 * **旧邮箱是这个账号唯一的找回通道** —— 那句「邮箱是登录标识，也是找回账号的唯一凭据」
 * 是产品自己在 `packages/i18n` 的词条里写的（`common.profile.email.hint`）。
 * 只通知而不要求点击的时间窗里，一个**拿到有效会话、又控制着新邮箱**的人可以先把找回通道换走：
 * 从此「忘记密码」每一封都发到他自己的收件箱，而原主唯一的自救路径被一起换掉了。
 * 双确认把攻击条件从"控制一个新邮箱"抬到"**同时控制两个邮箱**"，代价只是多点一次。
 *
 * ## 三条形状是从仓里借来的，不是新发明的
 *
 * | 借用 | 从哪 |
 * |---|---|
 * | 一次性令牌**只存 SHA-256** | `auth-tokens.ts` 的 `hashToken`，与 `users` 上那四列同一立场 |
 * | 消费 = **一条带条件的 UPDATE**，不是"先查再改" | `password/recovery.ts:240` |
 * | 限流**用行本身当计数器**，不在内存里数 | `password/recovery.ts:15-22`（内存 Map 重启归零、多副本各数各的） |
 * | 发信失败**回滚令牌** | `recovery.ts:147` / `auth.ts:467` / `passkey.ts:757` |
 * | 生效时 `tokenVersion++` 且**不发会话** | `recovery.ts:246-272` 的 J13/J14 那一双；理由在 ADR-0063 §2.2 —— JWT 的 payload 里**就带着 email** |
 *
 * ## 🔴 为什么 `confirm` 不要求 Bearer
 *
 * 点那两封信的人**手上没有会话**：他可能在另一台电脑上、可能刚从旧邮箱里点。
 * 这与 `/password/reset` 完全同构 —— 一条邮件里的一次性令牌本身就是凭据。
 * 所以它**必须**是反枚举那一族的形状：查不到 / 过期 / 已用过 / 请求已被撤销，
 * 四种情况同一个码同一句话（`invalid_change_link`），处置也一模一样（回界面重新发起一次）。
 *
 * 反过来，`request` / `status` / `cancel` 三条都在 `preHandler: authenticate` 上，
 * 调用者手上已经有一枚有效令牌 —— 那三条**允许**给出区分性错误（`email_taken` 等），
 * 沿用仓里 `no_password_set` / `password_already_set` 已经确立并写进词表注释的那条论证。
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { EMAIL_CHANGE_PATHS, EMAIL_CHANGE_TOKEN_TTL_MS } from '@heyta/shared-schema';
import type {
  EmailChangeConfirmResponse,
  EmailChangeErrorCode,
  EmailChangeStatusResponse,
} from '@heyta/shared-schema';

import { prisma } from '../db';
import { Logger } from '../logger';
import { hashToken } from '../auth-tokens';
import { authCache } from '../auth-cache';
import { revokeAllDeviceSessions } from './access-sessions';
import {
  sendEmailChangeAuthorizeEmail,
  sendEmailChangeConfirmEmail,
  sendEmailChangedEmail,
} from '../email';
import type { ServerLocale } from '../copy.generated.js';
import { isSameNormalizedEmail, normalizeEmail } from './email-normalize';

/** 与 `EMAIL_CHANGE_TOKEN_TTL_MS` 同一个数（那才是跨端真源），这里只是别名。 */
export const EMAIL_CHANGE_TTL_MS = EMAIL_CHANGE_TOKEN_TTL_MS;

/**
 * 换绑**完成**之后给两个地址各发一封信。
 *
 * 🔴 为什么旧邮箱**已经点过授权了还要再发一封**：那次点击可能在几天前，而这一封说的是
 * "已经改成了"。它与 `passwordChanged` 那一封同一条理由 —— 那不是礼貌，是**如果那不是本人，
 * 他唯一能知道的方式**。区别在于换绑必须给**两边**都发：新地址也该知道自己变成了登录标识。
 */
export const EMAIL_CHANGE_APPLIED_MESSAGE =
  'Your sign-in email address has been updated. Sign in with the new address.';

/** `confirm` 那一句：**不许**读成"你已经登录了"（J14 的反面就是这个措辞）。 */
export const EMAIL_CHANGE_CONFIRMED_MESSAGE =
  'This address has been confirmed for the email change.';

/** 发起那一句。中性、不承诺"已经改了"。 */
export const EMAIL_CHANGE_REQUESTED_MESSAGE =
  'We sent a link to both addresses. The change takes effect only after both have been confirmed.';

/** 撤销那一句。 */
export const EMAIL_CHANGE_CANCELLED_MESSAGE = 'The pending email change was cancelled.';

/** 换绑这条路上的错误（`code` 是稳定值，`message` 给人看）。 */
export class EmailChangeError extends Error {
  constructor(
    readonly code: EmailChangeErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'EmailChangeError';
  }
}

const INVALID_LINK = () =>
  new EmailChangeError(
    'invalid_change_link',
    'That link is not valid. Start the change again from the app.',
  );

interface RequestInput {
  userId: number;
  newEmail: string;
  locale?: ServerLocale;
}

/**
 * 发起一次换绑：**当前邮箱那一侧与新邮箱那一侧各发一封信**。
 *
 * 顺序是刻意的：先做三个**不写任何东西**的判断（同一个地址 / 已被别人占用 / 还没验证），
 * 再落库，再发信。任何一步不对，库里都还是干净的。
 *
 * 🔴 冷却不是"防骚扰"，是**限流落到行上**：上一张活请求还在冷却窗口里时这里抛
 * `email_change_cooldown`，库里那一行**一个字节都不动**（不轮换令牌）——
 * 否则"连着点两次"会把第一封信变成一枚永远点不通的死链接。
 */
export const requestEmailChange = async (
  input: RequestInput,
): Promise<{ message: string; expiresAt: number; resendAvailableAt: number }> => {
  const pendingEmail = normalizeEmail(input.newEmail);
  const now = Date.now();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { id: true, email: true, isVerified: true },
  });

  if (!user.isVerified) {
    // ⚠️ 今天这条路走不到这里（未验证的账号在 `verifyToken` 就被拒成 `ACCOUNT_UNVERIFIED`）。
    // 它仍然要写，是因为这条流程的**前提**是"旧收件箱可控"；哪天那个前提变了，
    // 这里必须响亮地拒绝，而不是让未验证的账号静默换掉标识。
    throw new EmailChangeError('email_not_verified', 'Verify your current email address first.');
  }

  if (isSameNormalizedEmail(pendingEmail, user.email)) {
    throw new EmailChangeError(
      'email_unchanged',
      'That is already the email address on this account.',
    );
  }

  const taken = await prisma.user.findUnique({
    where: { email: pendingEmail },
    select: { id: true },
  });
  if (taken) {
    throw new EmailChangeError(
      'email_taken',
      'Another account is already using that email address.',
    );
  }

  /**
   * 🔴 这一道**不是**上面那一道的重复，它挡的是另一种占用：那个地址此刻**还没有**属于
   * 任何账号，但另一个人的换绑正在途中、把它占在 `pending_email` 那列上。
   *
   * 实测的形状：`pending_email` 是 `@unique`（一个地址不能同时挂在两张活请求上，
   * 这是对的），而这里只查了 `users.email` ⇒ 那个人的 upsert 会抛 P2002，
   * 而这个请求以 **HTTP 500** 收尾。500 没有稳定码，客户端只能渲染成"未知错误"，
   * 用户看到的是一句谁也无法处置的话。
   */
  const claimedElsewhere = await prisma.emailChangeRequest.findUnique({
    where: { pendingEmail },
    select: { userId: true },
  });
  if (claimedElsewhere && claimedElsewhere.userId !== user.id) {
    throw new EmailChangeError(
      'email_taken',
      'Another account is already using that email address.',
    );
  }

  const outstanding = await prisma.emailChangeRequest.findUnique({
    where: { userId: user.id },
    select: { requestedAt: true, lastSentAt: true },
  });
  if (outstanding) {
    const resendAvailableAt = Number(outstanding.lastSentAt) + EMAIL_CHANGE_TTL_MS;
    // 与 `recovery.ts:128-140` 同一个立场："一张链接还在有效期内就不再发第二张"，
    // 按**行**判，不按内存计数器判。
    if (resendAvailableAt > now) {
      throw new EmailChangeError(
        'email_change_cooldown',
        'A change is already in progress. Check both inboxes, or start again later.',
        Math.ceil((resendAvailableAt - now) / 1000),
      );
    }
  }

  const oldToken = randomBytes(32).toString('hex');
  const newToken = randomBytes(32).toString('hex');
  const expiresAt = now + EMAIL_CHANGE_TTL_MS;
  const oldTokenHash = hashToken(oldToken);
  const newTokenHash = hashToken(newToken);

  // 一张活请求 = 一行（`user_id` 是主键，所以"两张互相抢先"这种状态在库里写不出来）。
  //
  // 🔴 上面那道"别人的在途请求占着这个地址"的检查是**读**，这一句才是那条唯一索引真正
  // 生效的地方 ⇒ 两者之间落进来一个请求时，这里必须翻成 `email_taken`，不能是 500。
  // 预检给的是友好与早退，`catch` 给的是正确性 —— 少任何一个都不成立（只留 catch 会让
  // 用户看到一句来自写失败的错；只留预检就是上面那个 TOCTOU）。
  try {
    await prisma.emailChangeRequest.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        pendingEmail,
        oldToken: oldTokenHash,
        newToken: newTokenHash,
        oldExpiresAt: BigInt(expiresAt),
        newExpiresAt: BigInt(expiresAt),
        requestedAt: BigInt(now),
        lastSentAt: BigInt(now),
      },
      update: {
        pendingEmail,
        oldToken: oldTokenHash,
        newToken: newTokenHash,
        oldExpiresAt: BigInt(expiresAt),
        newExpiresAt: BigInt(expiresAt),
        requestedAt: BigInt(now),
        lastSentAt: BigInt(now),
        oldConfirmedAt: null,
        newConfirmedAt: null,
        resendCount: { increment: 1 },
      },
    });
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new EmailChangeError(
        'email_taken',
        'Another account is already using that email address.',
      );
    }
    throw err;
  }

  const [authorized, confirmed] = await Promise.all([
    // 顺序**不并行发两封再一起看**是刻意的：两封都发出去才算"一次完整的换绑请求"，
    // 任何一封失败就把整张请求撤掉（见下面那个回滚）。
    sendEmailChangeAuthorizeEmail(user.email, oldToken, pendingEmail, input.locale),
    sendEmailChangeConfirmEmail(pendingEmail, newToken, input.locale),
  ]);

  if (!authorized || !confirmed) {
    // 🔴 回滚整张请求，不是只清失败那一侧的令牌。库里留一枚没有任何邮件携带的有效令牌 =
    // 用户看不到、点不了，而那张活请求会一直占着 `pending_email` 那条唯一索引，
    // 让他连"换一个地址再试"都做不到。
    await prisma.emailChangeRequest.deleteMany({
      where: { userId: user.id, oldToken: oldTokenHash, newToken: newTokenHash },
    });
    Logger.error(
      `Email change aborted because a confirmation mail could not be delivered (ID: ${user.id})`,
    );
    throw new EmailChangeError(
      'invalid_change_link',
      'We could not reach one of the two mailboxes. Try again.',
    );
  }

  Logger.info(
    `Email change requested (ID: ${user.id}); awaiting confirmation from both addresses`,
  );
  return {
    message: EMAIL_CHANGE_REQUESTED_MESSAGE,
    expiresAt,
    resendAvailableAt: now + EMAIL_CHANGE_TTL_MS,
  };
};

/**
 * 点其中**一边**。
 *
 * 三件事按这个顺序，每一件都有它自己的坏症状：
 *
 * 1. **先判存在与过期**，再判是哪一边。反过来会让"过期的旧链接"被当成新链接处理。
 * 2. **带条件的 `updateMany`** 落这一边的确认时间（`where` 里同时有令牌哈希、未过期、
 *    该边还没确认过）。"先查再改"在两个请求同时点到同一边时会给出两次"成功"。
 * 3. 生效那一步在**一个事务**里：先按"两边都已确认"这个条件**删掉**请求行，
 *    `count === 1` 才是赢下这一次的人，然后才改 `users.email`。
 *    反过来的形状（先改 email 再删请求）会在并发点到最后一边时把换绑**做两遍**。
 */
export const confirmEmailChange = async (
  token: string,
  locale?: ServerLocale,
): Promise<EmailChangeConfirmResponse> => {
  const tokenHash = hashToken(token);
  const now = BigInt(Date.now());

  const request = await prisma.emailChangeRequest.findFirst({
    where: { OR: [{ oldToken: tokenHash }, { newToken: tokenHash }] },
  });
  if (!request) throw INVALID_LINK();

  const side = request.oldToken === tokenHash ? 'old' : 'new';
  const expiresAt = side === 'old' ? request.oldExpiresAt : request.newExpiresAt;
  if (expiresAt === null || expiresAt <= now) {
    // 当场清掉这一边（与 `recovery.ts:217-224` 同形）。清它**不是**判据的一部分 ——
    // 下面的 `where` 已经保证过期的行不会被改；只是别让一枚死令牌长期躺在库里。
    await prisma.emailChangeRequest.updateMany({
      where: { userId: request.userId },
      data:
        side === 'old'
          ? { oldToken: null, oldExpiresAt: null }
          : { newToken: null, newExpiresAt: null },
    });
    throw INVALID_LINK();
  }

  const stamped = await prisma.emailChangeRequest.updateMany({
    where: {
      userId: request.userId,
      // 🔴 哈希也要在 `where` 里：同一张请求被重新发起过（换了一对令牌）时，
      // 手上这枚**旧**链接不许去确认那张**新**请求。
      ...(side === 'old' ? { oldToken: tokenHash } : { newToken: tokenHash }),
      ...(side === 'old' ? { oldConfirmedAt: null } : { newConfirmedAt: null }),
    },
    data: side === 'old' ? { oldConfirmedAt: now } : { newConfirmedAt: now },
  });
  if (stamped.count !== 1) {
    // 这一边已经被点过了（同一个链接点第二次），或这一张请求刚刚被撤销/重发。
    // 🔴 与"从没有过"**同一句话**，见 `EMAIL_CHANGE_ERROR_CODES` 上那段。
    throw INVALID_LINK();
  }

  const after = await prisma.emailChangeRequest.findUnique({
    where: { userId: request.userId },
    select: {
      userId: true,
      pendingEmail: true,
      oldConfirmedAt: true,
      newConfirmedAt: true,
    },
  });
  if (!after || after.oldConfirmedAt === null || after.newConfirmedAt === null) {
    // 只点了一边。界面上那句"还等哪一边"由 `status` 负责说，这里只回"这一边收到了"。
    return { message: EMAIL_CHANGE_CONFIRMED_MESSAGE, applied: false };
  }

  // ── 两边齐 ⇒ 生效 ────────────────────────────────────────────────
  // 改之前先读一次当前地址：事务里那一行**会被改走**，之后就到处都拿不到旧地址了，
  // 而"给旧地址发一封已经完成"的那封信必须知道发给谁。
  const before = await prisma.user.findUnique({
    where: { id: after.userId },
    select: { email: true },
  });

  /** 赢下这一次生效的人拿到的账号 id；`null` = 另一个并发请求已经把它做完了。 */
  let appliedId: number | null = null;
  /** 那个地址在两步之间被别人注册走了 ⇒ 整体回滚，一次都没生效。 */
  let lostRaceToOtherAccount = false;
  try {
    appliedId = await prisma.$transaction(async (tx) => {
      const won = await tx.emailChangeRequest.deleteMany({
        where: {
          userId: after.userId,
          pendingEmail: after.pendingEmail,
          oldConfirmedAt: { not: null },
          newConfirmedAt: { not: null },
        },
      });
      if (won.count !== 1) return null;

      const updated = await tx.user.update({
        where: { id: after.userId },
        data: {
          email: after.pendingEmail,
          // 新地址是**被点开信的那个人**证明过归属的 ⇒ 它不需要再走一遍验证。
          // 留在 0 会让这个人"换绑成功但登不进来"。
          isVerified: 1,
          // 🔴 J13 同族：JWT 的 payload 里带着 `email`（`auth.ts` 的 `issueSession`），
          // 换绑之后每一枚在途令牌写的都是**上一个**地址。不发会话（J14）——
          // 点邮件链接不等于登录，理由与 `/password/reset` 逐字相同（ADR-0063 §2.2）。
          tokenVersion: { increment: 1 },
          // 在途的重置链接一并作废：这个人刚刚证明了两个收件箱都归他，
          // 那封"可能是别人申请的"邮件就该失效（同 `recovery.ts:374` 那条立场）。
          resetPasswordToken: null,
          resetPasswordTokenExpiresAt: null,
          loginToken: null,
          loginTokenExpiresAt: null,
        },
        select: { id: true },
      });
      return updated.id;
    });
  } catch (err: unknown) {
    // P2002：从发起到这一步之间，那个地址被**另一个账号**注册走了。
    // 事务已经整体回滚 ⇒ 两边的确认都还在、`users.email` 一个字没变。
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      lostRaceToOtherAccount = true;
    } else {
      throw err;
    }
  }

  if (lostRaceToOtherAccount) {
    // 🔴 这里是 `invalid_change_link`，**不是** `email_taken` —— 这一条路由不要 Bearer，
    // 而"那个地址已经被别的账号占着"是一句**账号存在性**的断言：把它说出来就等于给
    // 一个未认证的出口留了一道枚举通道（仓里对 `/password/forgot` 立的就是同一条规矩）。
    //
    // 用户并没有因此少知道任何事：这一句让他回界面，而界面里重新发起那一次**在 Bearer 之后**，
    // 那里照旧会给区分性的 `email_taken`（沿用 `no_password_set` 已确立的口径）。
    // 也就是说"可执行的实话"仍然说得出，只是**只在认证过的那一步说**。
    throw INVALID_LINK();
  }
  if (appliedId === null) {
    // 另一个并发请求赢下了这一次生效（两个人同时点了最后一边）。
    // 对这个人来说结果就是"已经改好了" ⇒ 仍然是 `applied: true`，**不能**报错。
    return { message: EMAIL_CHANGE_APPLIED_MESSAGE, applied: true };
  }

  // AUTH_CACHE_INVALIDATION: keep adjacent to tokenVersion writes.
  // 库里那一格已经 +1，而 `verifyToken` 命中缓存时**不查库**、用的就是缓存里那个号。
  // 不失效的症状是"换绑成功了，旧设备在 30 s 内还照样能用旧地址那枚令牌"，
  // 而它在界面上完全不可见。
  authCache.invalidate(after.userId);

  // 🔴 计数器 + 缓存只管得住下一次的 HTTP 请求；旧设备**已经开着的那个页面**走实时通道，
  // 而通道只在 upgrade 时鉴权。这一族里 JWT 的 payload 还带着 `email`（上面那条 J13 同族注释），
  // 所以不关掉时留下的不是"多活 30 秒"，是"旧地址那枚令牌继续实时收这个账号的 op"。
  // 会话行也一并删掉：这一批行是当场已知死掉的（版本号对不上），没理由按 365 天再留一年。
  await revokeAllDeviceSessions(after.userId);

  Logger.audit({ event: 'EMAIL_CHANGED', userId: after.userId });
  Logger.info(`Email address changed (ID: ${after.userId}); all previous sessions revoked`);

  // 🔴 完成通知发**两个**地址，且**失败不抛出**：换绑已经完成，因为一封通知发不出去
  // 把成功报成失败，会让人以为没改成而再发起一次（那会撞上冷却窗口，然后是一句"怎么又失败了"）。
  // 旧地址那一封是这一族里更要紧的：它与 `passwordChanged` 同一条理由 ——
  // **如果那不是本人，那是他唯一能知道的方式**（`email.ts` 里那句注释写得很清楚）。
  const noticeTargets = [after.pendingEmail, before?.email].filter(
    (address): address is string => typeof address === 'string' && address.length > 0,
  );
  const notices = await Promise.all(
    noticeTargets.map((address) => sendEmailChangedEmail(address, locale)),
  );
  if (notices.some((sent) => !sent)) {
    Logger.error(
      `A completion notice for the email change could not be delivered (ID: ${after.userId})`,
    );
  }

  return { message: EMAIL_CHANGE_APPLIED_MESSAGE, applied: true };
};

/**
 * 已登录读到"这张活请求还等哪一边"。界面上那句实话来自这里。
 *
 * 🔴 响应里**必须带账号当前的邮箱**（`currentEmail`），理由不是"顺手多给一个字段"：
 * 换绑是在**邮件里的两个链接**上生效的，App 从头到尾没有被通知过一次，
 * 而它界面上那六处"当前账号"读的是**登录那一刻**记下的地址
 * （`apps/mobile/src/auth/session.ts` 里 `signedInEmail` 唯一的写入点就是登录）。
 * ⇒ 换绑成功后不刷新，界面会继续显示**旧**地址，也就是在用户刚做完这件事的那一刻
 * 说一句假话。这一趟真设备验收把它照出来了（`docs/plans/account-standard-suite.md` §6.16 步骤 10）。
 * 为什么挂在这个响应上而不是新端点：它是**这张界面本来就会读**的那一次请求，
 * 且 `pending: false` 那一支同样要回地址（生效之后活请求就没了）。
 */
export const getEmailChangeStatus = async (
  userId: number,
): Promise<EmailChangeStatusResponse> => {
  const [account, request] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.emailChangeRequest.findUnique({
      where: { userId },
      select: {
        pendingEmail: true,
        oldConfirmedAt: true,
        newConfirmedAt: true,
        oldExpiresAt: true,
        newExpiresAt: true,
        requestedAt: true,
      },
    }),
  ]);
  // 账号读不到 = 这枚令牌指向的主体已经没了；路由层的鉴权挡在前面，这里只兜形状。
  const currentEmail = account?.email;
  if (!request) return { pending: false, awaitingOld: false, awaitingNew: false, ...(currentEmail === undefined ? {} : { currentEmail }) };

  return {
    pending: true,
    awaitingOld: request.oldConfirmedAt === null,
    awaitingNew: request.newConfirmedAt === null,
    pendingEmail: request.pendingEmail,
    ...(currentEmail === undefined ? {} : { currentEmail }),
    expiresAt: Number(request.oldExpiresAt ?? request.newExpiresAt ?? 0),
    resendAvailableAt: Number(request.requestedAt) + EMAIL_CHANGE_TTL_MS,
  };
};

/**
 * 撤销那张活请求（"我打错字了 / 我不想换了"）。
 *
 * 🔴 它必须存在：没有它，一个填错的新地址会占着 `pending_email` 那条**唯一索引**直到过期，
 * 而在这段时间里谁（包括另一个人）都用不了那个地址。
 * 撤销之后两边再点旧链接都判 `invalid_change_link` —— 行没了，这与"过期"刻意同一句话。
 */
export const cancelEmailChange = async (userId: number): Promise<{ message: string }> => {
  const deleted = await prisma.emailChangeRequest.deleteMany({ where: { userId } });
  Logger.info(`Pending email change cancelled (ID: ${userId}, rows: ${String(deleted.count)})`);
  return { message: EMAIL_CHANGE_CANCELLED_MESSAGE };
};

/** 路由层用它把 `code` 映射到状态码；词表封闭，不在这里放宽。 */
export const EMAIL_CHANGE_HTTP_STATUS_BY_CODE: Readonly<Record<EmailChangeErrorCode, number>> = {
  invalid_change_link: 400,
  email_not_verified: 403,
  email_unchanged: 400,
  email_taken: 409,
  email_change_cooldown: 429,
};

/** 导出给路由注册用，避免 `api.ts` 与新文件各写一份路径字面量。 */
export const EMAIL_CHANGE_ROUTE_PATHS = EMAIL_CHANGE_PATHS;
