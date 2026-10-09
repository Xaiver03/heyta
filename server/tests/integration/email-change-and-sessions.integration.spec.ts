/**
 * 换绑邮箱 + 逐个撤销会话的**真服务端**证据（工单 W9）。
 *
 * Run with（本地验收库，与 `scripts/verify-p1-sync.mjs` 同一条建库/迁移路径）：
 *   cd server && DATABASE_URL=postgresql://<user>@127.0.0.1:5432/heyta_account_w9?schema=public \
 *     npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/email-change-and-sessions.integration.spec.ts
 *
 * ## 这一层存在的理由（前面三层都替不了它）
 *
 * | 层 | 它的"数据库"是什么 | 证到什么 |
 * |---|---|---|
 * | `email-change.spec.ts` / `access-sessions.spec.ts` | 手写的假 prisma | 代码按理解的语义走 |
 * | `account-security.routes.spec.ts` | 同上 + 真 Fastify/真鉴权 | 路由、状态码、投影、当场失效 |
 * | `email-change-sessions-schema.pglite.spec.ts` | PGlite 上的发布 SQL | 约束真的在那儿 |
 * | **本文件** | **真 PostgreSQL（迁移经 `scripts/migrate-deploy.sh` 应用）+ 真 Prisma + 真 Fastify** | 这条链**在真库上跑得通** |
 *
 * 🔴 只有这里能撞见的那类缺陷：`Prisma` 生成的客户端对 `BigInt` 列的读写、
 * `deleteMany` 在真唯一索引上的竞争、`ON DELETE CASCADE` 在真外键上的行为、
 * 以及"应用层测的是我模拟的那个 where，真库里那条 where 根本不成立"。
 * 唯一 mock 的是 SMTP（发信函数），因为真发信要一台邮件服务器；
 * 而这正是仓内既有判据的口径（`registration-otp.integration.spec.ts` 同形）。
 *
 * 没有 `DATABASE_URL` 时整组 `describe.skip` —— 与其它数据库集成套件一致。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ authorize: [] as unknown[][], confirm: [] as unknown[][], changed: [] as unknown[][] }));

vi.mock('../../src/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/email')>()),
  sendEmailChangeAuthorizeEmail: vi.fn(async (...args: unknown[]) => {
    sent.authorize.push(args);
    return true;
  }),
  sendEmailChangeConfirmEmail: vi.fn(async (...args: unknown[]) => {
    sent.confirm.push(args);
    return true;
  }),
  sendEmailChangedEmail: vi.fn(async (...args: unknown[]) => {
    sent.changed.push(args);
    return true;
  }),
}));

import { disconnectDb } from '../../src/db';
import { apiRoutes } from '../../src/api';
import { accountSecurityRoutes } from '../../src/account/account-security.routes';
import { issueSession } from '../../src/auth';
import { hashToken } from '../../src/auth-tokens';
import { hashFor } from '../../src/password/service';
import { AUTH_PASSWORD_PATHS, EMAIL_CHANGE_PATHS, SESSION_PATHS } from '@heyta/shared-schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'account-suite-integration-secret-at-least-32-characters';
  // 合成值，只为让 `password/hash.ts` 那道"至少要 32 字符"的前置成立（链路 7 要真加一次口令）。
  // 这一套的口径是"除 SMTP 之外零 mock"，所以这里给的是假值而不是把哈希函数 mock 掉。
  process.env.PASSWORD_PEPPER ??= 'account-suite-integration-pepper-not-a-real-secret';
  delete process.env.TEST_MODE;
  delete process.env.TEST_MODE_CONFIRM;
});

let app: FastifyInstance;
let observer: PrismaClient;
const createdUserIds: number[] = [];

const bearer = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

/** 造一个"已验证邮箱、设过口令"的账号；写库走真 Prisma，读库走另一条连接（观察者的裁决不靠被测方自报）。 */
const makeUser = async (email: string): Promise<number> => {
  const user = await observer.user.create({
    data: { email, isVerified: 1, tokenVersion: 0, passwordHash: 'not-used-in-this-suite' },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
};

const lastTokenOf = (box: unknown[][]): string => String(box.at(-1)?.[1]);

describeWithDb('换绑邮箱与会话撤销（真 PostgreSQL + 真 Prisma + 真 Fastify，只 mock SMTP）', () => {
  beforeAll(async () => {
    observer = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    app = Fastify();
    // 🔴 这一档组合**照 `src/server.ts:589-592`**：`accountSecurityRoutes` 与
    // `accountProfileRoutes` 都不在 `apiRoutes` 里（那一个文件已经 1868 行，而这几条
    // 路由与认证/同步没有共享状态）。本套件把这两件事一起装出来 —— 只装 `apiRoutes`
    // 会测到一个"生产里根本不存在的路由表"，症状是这里全绿而线上 404。
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
    await app.register(accountSecurityRoutes, { prefix: '/api' });
    await app.ready();
  });

  afterAll(async () => {
    // 删账号 ⇒ 两张新表的行应随真外键级联消失（这条在 pglite 那层是 SQL 层的，这里是 Prisma 路径）。
    for (const id of createdUserIds) await observer.user.delete({ where: { id } }).catch(() => undefined);
    await observer.$disconnect();
    await app.close();
    await disconnectDb();
  });

  afterEach(() => {
    sent.authorize.length = 0;
    sent.confirm.length = 0;
    sent.changed.length = 0;
  });

  it('前提：这条链在**生产的装载路径**上（`src/server.ts` 真的 register 了它）', () => {
    // 路由文件写了、单测里手工 register 过、测试全绿，而生产没人挂载 —— 症状是线上 404，
    // 而 `pnpm check` 与全部单测都不会失败。这一条读的是**生产入口的源码**，不是夹具。
    const serverSource = readFileSync(new URL('../../src/server.ts', import.meta.url), 'utf8');
    expect(serverSource).toMatch(/register\(accountSecurityRoutes,\s*\{\s*prefix:\s*'\/api'\s*\}/);
  });

  it('链路 1：发起 ⇒ 库里落的是**那两封信令牌的 SHA-256**，不是发出去的原文', async () => {
    const oldEmail = `w9-old-${Date.now()}@example.test`;
    const newEmail = `w9-new-${Date.now()}@example.test`;
    const userId = await makeUser(oldEmail);
    const token = await issueSession({ id: userId }, { deviceName: 'W9 发起端' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/${EMAIL_CHANGE_PATHS.request}`,
      headers: bearer(token),
      payload: { newEmail },
    });
    expect(res.statusCode, res.body).toBe(200);

    // 🔴 发信那一侧拿到的是**原文**（否则人点不动），库里那一侧必须是**摘要**。
    // 两个出口都断，缺一个就等于把"库里躺着可用凭据"这件事放过去。
    const authorizeToken = lastTokenOf(sent.authorize);
    const confirmToken = lastTokenOf(sent.confirm);
    expect(authorizeToken).not.toBe(confirmToken);
    expect(authorizeToken.length).toBeGreaterThan(20);

    const row = await observer.emailChangeRequest.findUnique({ where: { userId } });
    expect(row, '活请求行没写进真库').not.toBeNull();
    expect(String(row?.pendingEmail)).toBe(newEmail);
    for (const column of [row?.oldToken, row?.newToken] as (string | null)[]) {
      expect(column).toMatch(/^[0-9a-f]{64}$/);
    }
    expect([row?.oldToken, row?.newToken]).not.toContain(authorizeToken);
    expect([row?.oldToken, row?.newToken]).not.toContain(confirmToken);
  });

  it('链路 2：两边各点一次 ⇒ 真库换址、计数器 +1、请求行删除、手上那枚当场 401', async () => {
    const oldEmail = `w9-a-${Date.now()}@example.test`;
    const newEmail = `w9-b-${Date.now()}@example.test`;
    const userId = await makeUser(oldEmail);
    const token = await issueSession({ id: userId }, { deviceName: 'W9 双侧' });

    const before = await observer.user.findUniqueOrThrow({ where: { id: userId } });

    await app.inject({
      method: 'POST',
      url: `/api/${EMAIL_CHANGE_PATHS.request}`,
      headers: bearer(token),
      payload: { newEmail },
    });

    // 先点新邮箱那一侧 ⇒ 地址**一字不变**（顺序无关是这条链的承诺）。
    const first = await app.inject({
      method: 'POST',
      url: `/api/${EMAIL_CHANGE_PATHS.confirm}`,
      payload: { token: lastTokenOf(sent.confirm) },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(JSON.parse(first.body).applied).toBe(false);
    const mid = await observer.user.findUniqueOrThrow({ where: { id: userId } });
    expect(mid.email).toBe(oldEmail);
    expect(mid.tokenVersion).toBe(before.tokenVersion);

    // 再点旧邮箱那一侧 ⇒ 生效，且**恰好一次**。
    const second = await app.inject({
      method: 'POST',
      url: `/api/${EMAIL_CHANGE_PATHS.confirm}`,
      payload: { token: lastTokenOf(sent.authorize) },
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(JSON.parse(second.body).applied).toBe(true);

    const after = await observer.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.email).toBe(newEmail);
    expect(after.isVerified).toBe(1);
    expect(Number(after.tokenVersion)).toBe(Number(before.tokenVersion) + 1);
    await observer.emailChangeRequest.findUnique({ where: { userId } }).then((row) => expect(row).toBeNull());
    // 两个地址各一封完成通知 —— 旧地址那一封是安全通知，不是回执。
    expect(sent.changed).toHaveLength(2);

    // 🔴 生效即全设备登出：手上这枚的下一个请求必须是 401，而且是**当场**（认证缓存被踢掉，
    // 不是等 30 s 自然过期）。这一条只在真 HTTP 上现形。
    const probe = await app.inject({ method: 'GET', url: `/api/${SESSION_PATHS.list}`, headers: bearer(token) });
    expect(probe.statusCode).toBe(401);

    // 同一枚链接再点一次 ⇒ 与"从没点过"同一句，且计数器不再动。
    const replay = await app.inject({
      method: 'POST',
      url: `/api/${EMAIL_CHANGE_PATHS.confirm}`,
      payload: { token: lastTokenOf(sent.authorize) },
    });
    expect(replay.statusCode).toBe(400);
    expect(JSON.parse(replay.body).code).toBe('invalid_change_link');
    const replayed = await observer.user.findUniqueOrThrow({ where: { id: userId } });
    expect(Number(replayed.tokenVersion)).toBe(Number(before.tokenVersion) + 1);
  });

  it('链路 3：撤销一枚 ⇒ 那一枚 401 而另一枚照常 200（这是整套的本体）', async () => {
    const email = `w9-sessions-${Date.now()}@example.test`;
    const userId = await makeUser(email);
    const deviceA = await issueSession({ id: userId }, { deviceName: 'A 台' });
    const deviceB = await issueSession({ id: userId }, { deviceName: 'B 台' });

    const list = await app.inject({ method: 'GET', url: `/api/${SESSION_PATHS.list}`, headers: bearer(deviceA) });
    expect(list.statusCode, list.body).toBe(200);
    const body = JSON.parse(list.body) as {
      sessions: Array<{ sessionId: string; current: boolean; deviceName: string | null }>;
    };
    expect(body.sessions).toHaveLength(2);
    // 🔴 白名单投影在真库上的形状：没有 `jti` 原文、没有令牌、没有别人的行。
    expect(body.sessions.filter((s) => s.current)).toHaveLength(1);
    for (const session of body.sessions) {
      expect(session.sessionId).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(session)).not.toContain(deviceA.split('.')[0] ?? '');
    }

    const mine = body.sessions.find((s) => s.current)!;
    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/${SESSION_PATHS.list}/${mine.sessionId}`,
      headers: bearer(deviceA),
    });
    expect(revoke.statusCode, revoke.body).toBe(200);

    const afterA = await app.inject({ method: 'GET', url: `/api/${SESSION_PATHS.list}`, headers: bearer(deviceA) });
    expect(afterA.statusCode, '撤掉的那一枚还在用 —— 撤销没当场失效').toBe(401);
    const afterB = await app.inject({ method: 'GET', url: `/api/${SESSION_PATHS.list}`, headers: bearer(deviceB) });
    expect(afterB.statusCode, '撤一台把整账号踢下线（撤一台=全登出那个旧缺陷）').toBe(200);

    // 库面上那一行**不存在**（撤销=删行，不是置标志位）。
    await observer.accessSession
      .findUnique({ where: { jtiHash: mine.sessionId } })
      .then((row) => expect(row).toBeNull());
  });

  /**
   * 🔴 **判据的顺序决定它能不能红。**
   *
   * 上面那条「链路 3」是**先撤再探**：撤的那一枚第一次打库就被拒，缓存里从来没写过它的格。
   * 而真实形状是另一台设备一直在同步 —— 它每次请求都会把账号那一格焐热。
   * 2026-10-09 由 `research/tools/account-email-sessions-http-probe.mjs` 的判据 25 照出：
   * `authCache` 原来**按 `userId`** 存一格 `{tokenVersion, isVerified}`，命中就整段跳过
   * `sessionIsLive` ⇒ 撤掉 C 之后只要 B 还在动，C 的令牌照样回 **200**，
   * 而界面上那句"退出哪一台，它的下一次请求就要重新登录"是假的。
   *
   * 所以这一条把顺序反过来：**先用另一台把缓存焐热，再探被撤的那一枚**。
   * 变异（`server/src/auth-cache.ts` 的 `keyOf` 改回只按 `userId`）⇒ 这一条转红，
   * 而「链路 3」逐字照旧绿 —— 那正是这一格原来没人守着的证明。
   */
  it('链路 3b：另一台设备把缓存焐热之后，被撤那一枚**仍然**要 401（缓存的粒度=会话）', async () => {
    const email = `w9-cache-${Date.now()}@example.test`;
    const userId = await makeUser(email);
    const deviceA = await issueSession({ id: userId }, { deviceName: 'A 台（还活着）' });
    const deviceC = await issueSession({ id: userId }, { deviceName: 'C 台（要被撤）' });

    const list = await app.inject({ method: 'GET', url: `/api/${SESSION_PATHS.list}`, headers: bearer(deviceA) });
    expect(list.statusCode, list.body).toBe(200);
    const body = JSON.parse(list.body) as { sessions: Array<{ sessionId: string; current: boolean }> };
    const revoked = body.sessions.find((s) => s.current === false);
    expect(revoked, '要撤的那一枚得在列表里').toBeDefined();

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/${SESSION_PATHS.list}/${revoked!.sessionId}`,
      headers: bearer(deviceA),
    });
    expect(revoke.statusCode, revoke.body).toBe(200);

    // 🔴 这一步就是原来缺的那半：撤完之后，**先让还活着的那台再请求一次**，
    //    把这一账号的缓存格写回来。原来那一格按人存 ⇒ 下面探 C 时会命中它。
    const warm = await app.inject({ method: 'GET', url: `/api/${SESSION_PATHS.list}`, headers: bearer(deviceA) });
    expect(warm.statusCode, warm.body).toBe(200);

    const probeC = await app.inject({ method: 'GET', url: `/api/${SESSION_PATHS.list}`, headers: bearer(deviceC) });
    expect(probeC.statusCode, probeC.body).toBe(401);

    // 连探两次：第一次可能还在未命中那条路上，第二次才真正依赖"键里带着会话身份"。
    const probeCAgain = await app.inject({ method: 'GET', url: `/api/${SESSION_PATHS.list}`, headers: bearer(deviceC) });
    expect(probeCAgain.statusCode, probeCAgain.body).toBe(401);

    // 而 A 那台不受影响（这一条挡的是"撤一台=全登出"那种反向过度撤销）。
    const keepA = await app.inject({ method: 'GET', url: `/api/${SESSION_PATHS.list}`, headers: bearer(deviceA) });
    expect(keepA.statusCode, keepA.body).toBe(200);
  });

  it('链路 4：`logout` 只撤手上这一枚，不动计数器，也不碰另一枚', async () => {
    const email = `w9-logout-${Date.now()}@example.test`;
    const userId = await makeUser(email);
    const deviceA = await issueSession({ id: userId }, { deviceName: 'A' });
    const deviceB = await issueSession({ id: userId }, { deviceName: 'B' });
    const before = await observer.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } });

    const out = await app.inject({ method: 'POST', url: `/api/${SESSION_PATHS.logout}`, headers: bearer(deviceA) });
    expect(out.statusCode, out.body).toBe(200);

    const after = await observer.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } });
    // 🔴 「退出这一台」**不该** bump 计数器 —— 那是「退出所有设备」的语义。
    // 混用的症状是"在咖啡厅点了一下退出，家里的手机也被踢了"。
    expect(Number(after.tokenVersion)).toBe(Number(before.tokenVersion));
    const probeA = await app.inject({ method: 'GET', url: `/api/${SESSION_PATHS.list}`, headers: bearer(deviceA) });
    expect(probeA.statusCode).toBe(401);
    const probeB = await app.inject({ method: 'GET', url: `/api/${SESSION_PATHS.list}`, headers: bearer(deviceB) });
    expect(probeB.statusCode).toBe(200);
  });

  it('链路 5：撤销活请求之后，两边再点都不生效', async () => {
    const email = `w9-cancel-${Date.now()}@example.test`;
    const userId = await makeUser(email);
    const token = await issueSession({ id: userId });
    await app.inject({
      method: 'POST',
      url: `/api/${EMAIL_CHANGE_PATHS.request}`,
      headers: bearer(token),
      payload: { newEmail: `w9-cancel-target-${Date.now()}@example.test` },
    });
    const authorizeToken = lastTokenOf(sent.authorize);
    const confirmToken = lastTokenOf(sent.confirm);

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/${EMAIL_CHANGE_PATHS.cancel}`,
      headers: bearer(token),
      payload: {},
    });
    expect(cancel.statusCode, cancel.body).toBe(200);
    await observer.emailChangeRequest.findUnique({ where: { userId } }).then((row) => expect(row).toBeNull());

    for (const dead of [authorizeToken, confirmToken]) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/${EMAIL_CHANGE_PATHS.confirm}`,
        payload: { token: dead },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).code).toBe('invalid_change_link');
    }
    const still = await observer.user.findUniqueOrThrow({ where: { id: userId } });
    expect(still.email).toBe(email);
  });

  it('链路 6：账号删除 ⇒ 两张表的行随真外键级联消失（Prisma 路径，不是 SQL 文本）', async () => {
    const email = `w9-cascade-${Date.now()}@example.test`;
    const userId = await makeUser(email);
    await issueSession({ id: userId }, { deviceName: '要级联掉的那一枚' });
    await app.inject({
      method: 'POST',
      url: `/api/${EMAIL_CHANGE_PATHS.request}`,
      headers: bearer(await issueSession({ id: userId })),
      payload: { newEmail: `w9-cascade-target-${Date.now()}@example.test` },
    });
    expect(await observer.accessSession.count({ where: { userId } })).toBeGreaterThan(0);
    expect(await observer.emailChangeRequest.count({ where: { userId } })).toBe(1);

    await observer.user.delete({ where: { id: userId } });
    createdUserIds.splice(createdUserIds.indexOf(userId), 1);

    expect(await observer.accessSession.count({ where: { userId } })).toBe(0);
    expect(await observer.emailChangeRequest.count({ where: { userId } })).toBe(0);
  });

  /**
   * 🔴 **工单 W10 的运行时半边。**
   *
   * 上面那六条全都用 `issueSession()` **自己铸会话**，所以它们对"登录路由有没有把请求头的
   * 元数据交给铸造口"这句话**是瞎的** —— 10-10 那次本线漏入库的正是那一句（§6.66）：
   * helper、签名出口、单元判据都在仓库里，而 `api.ts` 里那一处调用点没在，
   * 于是这一整套真库判据逐字照旧绿。这一条走**真 HTTP 登录口**，读的是**观察者的库**，
   * 不是被测代码自报的形状。
   */
  it('链路 7：真 HTTP 口令登录 ⇒ `access_sessions` 那一行带着请求头原文，且这一枚可被单独撤销', async () => {
    const email = `w9-w10-${Date.now()}@example.test`;
    const userId = await makeUser(email);
    const password = 'W9-W10-Login-Password-2026!';
    await observer.user.update({ where: { id: userId }, data: { passwordHash: await hashFor(password) } });

    const login = await app.inject({
      method: 'POST',
      url: `/api${AUTH_PASSWORD_PATHS.login}`,
      headers: { 'user-agent': 'W9-W10-Agent/7.7' },
      payload: { email, password },
    });
    expect(login.statusCode, login.body).toBe(200);
    const issued = JSON.parse(login.body) as { token: string };

    const list = await app.inject({
      method: 'GET',
      url: `/api/${SESSION_PATHS.list}`,
      headers: bearer(issued.token),
    });
    expect(list.statusCode, list.body).toBe(200);
    const body = JSON.parse(list.body) as {
      sessions: Array<{ sessionId: string; current: boolean; userAgent: string | null }>;
    };
    expect(body.sessions).toHaveLength(1);
    // 🔴 这一行是本格的全部要点：`userAgent` 是**服务端从请求头取的**，客户端自报的 clientId 不算来源。
    // 摘掉登录路由那一处的 `sessionMetaFromRequest(req)` ⇒ 这里收到 `null`（变异读数在计划 §6.68）。
    expect(body.sessions[0]?.userAgent).toBe('W9-W10-Agent/7.7');

    const mine = body.sessions[0]!;
    const row = await observer.accessSession.findUnique({ where: { jtiHash: mine.sessionId } });
    expect(row?.userId, '列表里那一枚在库里对不上号').toBe(userId);
    expect(row?.userAgent).toBe('W9-W10-Agent/7.7');

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/${SESSION_PATHS.list}/${mine.sessionId}`,
      headers: bearer(issued.token),
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    const after = await app.inject({ method: 'GET', url: `/api/${SESSION_PATHS.list}`, headers: bearer(issued.token) });
    expect(after.statusCode, '撤掉的那一枚还在用 —— 撤销没当场失效').toBe(401);
  });

  // ── D1（工单 §1 量出来的那条"全仓零 HTTP 判据"）─────────────────────────
  // `POST /api/auth/email/verify` 是三类令牌的**唯一**分流口（ADR-0039 §2.1）。
  // 它此前只在 service 层被测：那里的"返回一枚会话"是假的，而线上症状是
  // "点完邮件链接、界面说成功了，下一个请求 401" —— 只有真 HTTP 才现形。
  it('D1 登录令牌那条分流 ⇒ 真库里换出一枚**能用**的会话，并落下 `access_sessions` 那一行', async () => {
    const email = `w9-d1-${Date.now()}@example.test`;
    const userId = await makeUser(email);
    const linkToken = `login-link-${Date.now()}-${process.pid}`;
    await observer.user.update({
      where: { id: userId },
      data: { loginToken: hashToken(linkToken), loginTokenExpiresAt: BigInt(Date.now() + 60_000) },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/email/verify',
      headers: { 'user-agent': 'W9-D1-probe' },
      payload: { token: linkToken },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { kind: string; token?: string };
    expect(body.kind).toBe('session');
    expect(typeof body.token).toBe('string');

    // 🔴 换回来的那枚令牌必须**真的能过鉴权** —— "200 但下一发 401"是这条链唯一没被
    // 任何一层守过的缺陷形状（`tokenVersion` 少带一格时症状与密码错一模一样）。
    const probe = await app.inject({
      method: 'GET',
      url: `/api/${SESSION_PATHS.list}`,
      headers: bearer(body.token ?? ''),
    });
    expect(probe.statusCode, probe.body).toBe(200);
    const sessions = (JSON.parse(probe.body) as { sessions: Array<{ current: boolean }> }).sessions;
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
  });

  it('D1 消费即失效：同一枚链接第二次点 ⇒ 401，且库里那两列被清空', async () => {
    const email = `w9-d1-replay-${Date.now()}@example.test`;
    const userId = await makeUser(email);
    const linkToken = `replay-${Date.now()}-${process.pid}`;
    await observer.user.update({
      where: { id: userId },
      data: { loginToken: hashToken(linkToken), loginTokenExpiresAt: BigInt(Date.now() + 60_000) },
    });

    const first = await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: linkToken } });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: linkToken } });
    expect(second.statusCode, '一枚链接可以反复换会话').toBe(401);
    const row = await observer.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.loginToken).toBeNull();
    expect(row.loginTokenExpiresAt).toBeNull();
  });

  it('D1 过期与"从没有过这枚链接"回**同一句**（否则它就是一个令牌探测器）', async () => {
    const email = `w9-d1-expired-${Date.now()}@example.test`;
    const userId = await makeUser(email);
    const dead = `expired-${Date.now()}-${process.pid}`;
    await observer.user.update({
      where: { id: userId },
      data: { loginToken: hashToken(dead), loginTokenExpiresAt: BigInt(Date.now() - 1000) },
    });

    const expired = await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: dead } });
    const never = await app.inject({
      method: 'POST',
      url: '/api/auth/email/verify',
      payload: { token: `never-existed-${Date.now()}-${process.pid}` },
    });
    expect(expired.statusCode).toBe(401);
    expect(never.statusCode).toBe(401);
    // 逐字相同：状态码与那句 error 都要一样（"这一枚过期了"本身是账号存在性证据）。
    expect(never.body).toBe(expired.body);
  });

  it('D1 空令牌在**校验层**就被拒，一个查询都不发', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('D1 邮箱注册那一格：验证成功**并换出会话**（`verifyEmailLink` 的第三种分流）', async () => {
    const email = `w9-d1-verify-${Date.now()}@example.test`;
    const userId = await makeUser(email);
    await observer.user.update({ where: { id: userId }, data: { isVerified: 0 } });
    const linkToken = `verify-${Date.now()}-${process.pid}`;
    await observer.user.update({
      where: { id: userId },
      data: { verificationToken: hashToken(linkToken), verificationTokenExpiresAt: BigInt(Date.now() + 60_000) },
    });

    const res = await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: linkToken } });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { kind: string; token?: string };
    expect(body.kind).toBe('session');
    expect(typeof body.token).toBe('string');
    const after = await observer.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.isVerified).toBe(1);
    // 令牌是一次性的：两列都清空（下一发同一枚必须 401）。
    expect(after.verificationToken).toBeNull();
    expect(after.verificationTokenExpiresAt).toBeNull();
  });

  it('D1 通行密钥注册那一格：验证成功但**不发会话**（那条路的语义是"验证完去用你的钥匙"）', async () => {
    const email = `w9-d1-passkey-${Date.now()}@example.test`;
    const userId = await makeUser(email);
    await observer.user.update({ where: { id: userId }, data: { isVerified: 0 } });
    const linkToken = `pk-verify-${Date.now()}-${process.pid}`;
    const hash = hashToken(linkToken);
    // 真实的注册流会把**同一枚**令牌同时写进那两张表（邮件里只有一个链接），
    // 而分流顺序是"先认得出这是通行密钥注册那一封"⇒ 走 `verified-only`。
    await observer.user.update({
      where: { id: userId },
      data: { verificationToken: hash, verificationTokenExpiresAt: BigInt(Date.now() + 60_000) },
    });
    await observer.pendingPasskeyRegistration.create({
      data: {
        verificationToken: hash,
        verificationTokenExpiresAt: BigInt(Date.now() + 60_000),
        credentialId: Buffer.from(`cred-${linkToken}`),
        publicKey: Buffer.from('pk-mock-material'),
        userId,
      },
    });

    const res = await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: linkToken } });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { kind: string; token?: string };
    expect(body.kind).toBe('verified-only');
    // 🔴 这一格不发会话：发了就等于"点开一封注册确认邮件"变成一次登录，
    // 而那封邮件只证明"有人能收到这个收件箱"。
    expect(body.token).toBeUndefined();
  });
});
