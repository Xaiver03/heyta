/**
 * 「退出这一台」必须当场断掉**那一台已经开着的页面**——真运行时那一层的证据。
 *
 * Run with（本地验收库，与 `email-change-and-sessions.integration.spec.ts` 同一套建库/迁移路径）：
 *   cd server && DATABASE_URL=postgresql://<user>@127.0.0.1:5432/heyta_account_w9?schema=public \
 *     npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/session-revoke-websocket.integration.spec.ts
 *
 * ## 为什么必须是这一层，而不是又一条断言
 *
 * 计划台账 §5 第 17 条记的正是这一格的形状：删行与失效缓存只管得住**下一句 HTTP 请求**，
 * 而实时通道只在 upgrade 时鉴权。单元层（假 prisma + mock 掉的 ws 服务）与 HTTP 层
 * （`app.inject`）都**看不见一条已经建立的连接** —— 把 `revokeSession` 里那句
 * `closeForSession(...)` 整行删掉，那两层照样全绿。这一趟会红的唯一理由是
 * **真的有一条 socket 挂着，而它真的该被关**。
 *
 * 🔴 凭据纪律：令牌、`jti` 原值都不许进断言消息或日志。下面只把**会话 id**（`jti` 的 SHA-256，
 * 本来就是给界面用的那个值）用在 URL 之外的地方，socket URL 里那枚令牌只在内存里活着。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

// `JWT_SECRET` 必须在模块图加载前就位（`auth.ts` 在 import 时读它），所以用 hoisted。
vi.hoisted(() => {
  process.env.JWT_SECRET ??= 'session-revoke-ws-integration-secret-at-least-32-chars';
  // 合成值，只为让 `password/hash.ts` 那道"至少要 32 字符"的前置成立（最后那条用例要真加一次口令）。
  process.env.PASSWORD_PEPPER ??= 'session-revoke-ws-integration-pepper-not-a-real-secret';
  delete process.env.TEST_MODE;
  delete process.env.TEST_MODE_CONFIRM;
});

// 这一套的口径与 `email-change-and-sessions.integration.spec.ts` 相同：**只 mock SMTP 发信函数**。
// 不 mock 它，改口令那一步会去 Ethereal 真建一个测试账号（实测 +1 s 起，而这一条用例的预算本来
// 就被 `checkNewPassword` 里那道 fail-open 的 HIBP 外发查询吃掉一大截 —— 见计划 §6.69 与 §5 第 13 条）。
vi.mock('../../src/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/email')>()),
  sendPasswordChangedEmail: vi.fn(async () => true),
}));

import { disconnectDb } from '../../src/db';
import { apiRoutes } from '../../src/api';
import { accountSecurityRoutes } from '../../src/account/account-security.routes';
import { wsRoutes } from '../../src/sync/websocket.routes';
import { issueSession } from '../../src/auth';
import { sessionIdOf } from '../../src/account/access-sessions';
import { hashToken } from '../../src/auth-tokens';
import { getWsConnectionService } from '../../src/sync/services/websocket-connection.service';
import { hashFor } from '../../src/password/service';
import { AUTH_PASSWORD_PATHS, SESSION_PATHS } from '@heyta/shared-schema';

/** 从自己刚铸出来的那枚令牌里取会话 id（= 库里那一行的主键）。只取，不打印。 */
const sessionIdOfToken = (token: string): string => {
  const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as {
    jti?: string;
  };
  if (typeof payload.jti !== 'string') {
    throw new Error('这一枚令牌没有 jti，本套件的判据不成立');
  }
  return sessionIdOf(payload.jti);
};

/** 开一条真 socket 并等到它真的 up（等到 `open` 才算"这条连接存在"）。 */
const openSocket = (wsBase: string, token: string, clientId: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/api/sync/ws?token=${encodeURIComponent(token)}&clientId=${clientId}`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('前提不成立：socket 没在 5s 内 up（upgrade 鉴权或路由装载有问题）'));
    }, 5000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

/** 有界地等一次 close，返回 close 的 code 与 reason；等不到就返回 null（不当成"已关"）。 */
const waitForClose = (ws: WebSocket, ms = 5000): Promise<{ code: number; reason: string } | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString('utf8') });
    });
  });

/**
 * 🔴 **等到服务端真的把这条连接登记进簿记，而不是只等到客户端的 `open`。**
 *
 * `websocket.routes.ts` 那一段是 `await verifyToken(token)` **之后**才 `addConnection`，
 * 而 `verifyToken` 里有一次库查（撤销的那一格就走在那条查上）。客户端的 `open` 在握手完成时
 * 就发了 ⇒ 只等 `open` 的"前提"可以在服务端一条都没登记时就成立，于是随后那句撤销
 * 找不到该关的连接，而那枚令牌自己的 `verifyToken` 晚一步回来时 socket 收到的是
 * `4003 / Invalid token`（升级期那条通用拒绝），本套件钉的那句 `Session revoked` 根本不会发生。
 * 10-10 04:1x 在这台机器上实测到这一型（读数与归因在计划 §6.72）：同一枚文件在 HEAD 上
 * 单独重跑也红，而 `git log 331f563c..HEAD -- server/src/sync` 为空 ⇒ 不是产品回归，是探针抢跑。
 */
const waitForConnectionCount = async (target: number, ms = 5000): Promise<void> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const now = getWsConnectionService().getConnectionCount();
    if (now >= target) return;
    if (Date.now() > deadline) {
      throw new Error(`前提不成立：服务端在 ${ms}ms 内没把连接登记到 ${target} 条（现在 ${now} 条）`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describeWithDb('逐枚撤销会话 ⇒ 那一枚的实时通道当场断（真 PostgreSQL + 真 Fastify + 真 WebSocket）', () => {
  let app: FastifyInstance;
  let observer: PrismaClient;
  let wsBase = '';
  let userId = 0;
  let tokenA = '';
  let tokenB = '';
  const sockets: WebSocket[] = [];

  const bearer = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    observer = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    const user = await observer.user.create({
      data: {
        email: `session-revoke-ws-${Date.now()}@example.test`,
        isVerified: 1,
        tokenVersion: 0,
        passwordHash: 'not-used-in-this-suite',
      },
      select: { id: true },
    });
    userId = user.id;

    app = Fastify();
    // 🔴 与生产同构：`wsRoutes` 挂在 `/api/sync` 下，且必须先注册 `@fastify/websocket`
    // （`src/server.ts:468` 与 `:571` 那两行的组合）。少装任何一半，这里都连不上 socket。
    await app.register(websocket, { options: { maxPayload: 8192 } });
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
    await app.register(accountSecurityRoutes, { prefix: '/api' });
    await app.register(wsRoutes, { prefix: '/api/sync' });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    wsBase = address.replace(/^http/, 'ws');

    tokenA = await issueSession({ id: userId }, { deviceName: 'device-a' });
    tokenB = await issueSession({ id: userId }, { deviceName: 'device-b' });
  });

  afterAll(async () => {
    for (const ws of sockets) {
      try {
        ws.terminate();
      } catch {
        // 已经关掉的那一条不需要再管
      }
    }
    await observer.user.delete({ where: { id: userId } }).catch(() => undefined);
    await observer.$disconnect();
    await app.close();
    await disconnectDb();
  });

  it('前提：同一个账号的两条连接都真的建立了（少了这一条，下面三条可以是空过）', async () => {
    sockets.push(await openSocket(wsBase, tokenA, 'client-a'));
    sockets.push(await openSocket(wsBase, tokenB, 'client-b'));
    // 🔴 只等 `open` 不够：服务端的登记排在 `await verifyToken` 之后（见上面那条注释）。
    await waitForConnectionCount(2);
    expect(sockets[0]!.readyState).toBe(WebSocket.OPEN);
    expect(sockets[1]!.readyState).toBe(WebSocket.OPEN);
  });

  it('🔴 撤销 A 那一枚 ⇒ A 的 socket 当场以"令牌已撤销"那一档关掉', async () => {
    // 🔴 监听必须排在请求**之前**：close 帧与 HTTP 响应是两条通道，谁先到没有保证。
    // 排在后面时这一条是抢跑读（关掉比挂上更早 ⇒ `waitForClose` 白等满预算再返回 null）。
    const closing = waitForClose(sockets[0]!);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${sessionIdOfToken(tokenA)}`,
      headers: bearer(tokenB),
    });
    expect(res.statusCode).toBe(200);

    const closed = await closing;
    // 4003 = 客户端按"鉴权失败/已撤销"处理的那一档（`websocket.routes.ts` 里的线契约）。
    // 🔴 reason 也必须逐字对上：只比 code 分不出"这一枚被精确关掉"和"整个账号的通道被一起关掉"
    // ——`closeForUser` 发的是 `Token revoked`，而它会让上面那条和下面"别的设备还活着"那条**一起绿**。
    expect(closed).toEqual({ code: 4003, reason: 'Session revoked' });
  });

  it('🔴 B 那一枚还活着：逐枚撤销不许把别的设备一起踢下线', async () => {
    // 这一条必须跑在上一条之后（同一条 describe 内共享那两条 socket）：
    // A 已被撤销，而 B 的连接**不该**因此断 —— 那正是 `closeForUser` 的错误实现形状。
    expect(sockets[1]!.readyState).toBe(WebSocket.OPEN);
    const code = await waitForClose(sockets[1]!, 1200);
    expect(code).toBeNull();
  });

  it('撤销一个不存在（且形状合法）的会话 id ⇒ 谁都不许多关', async () => {
    const before = getWsConnectionService().getConnectionCount();
    const third = await openSocket(wsBase, tokenB, 'client-c');
    sockets.push(third);
    await waitForConnectionCount(before + 1);
    const ghost = 'f'.repeat(64);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${ghost}`,
      headers: bearer(tokenB),
    });
    expect(res.json().code).toBe('unknown_session');
    expect(third.readyState).toBe(WebSocket.OPEN);
    expect(await waitForClose(third, 1200)).toBeNull();
  });

  /**
   * 🔴 **§5 第 16 条那一半取在"改口令"这条路上，而不是取在撤销接口上。**
   *
   * 上面三条走的是逐枚撤销；而用户说的"把别人踢下线"真正的入口是改口令 / 重置口令，
   * 它们共用 `revokeAllDeviceSessions()` —— 那里头 `closeForUser` 那一句才是
   * "已经开着的页面"那一半。只写 `tokenVersion` 那一半时，这几条 socket 会照常活着
   * 继续收 op 通知，而 HTTP 层的鉴权断言**全绿**（同一型缺陷在计划 §6.13 记过，
   * 那次的形状是"日志还在印 all revoked"）。
   *
   * 这一条**自带**两条连接，不读前面那几条留下的 socket —— 前面那几条共享状态是有意的
   * （逐枚那条必须看着另一枚还活着），而这一条要证的不是顺序，是"全部"。
   */
  it('🔴 真改口令 ⇒ 这个账号所有已经开着的页面当场断，换发给当前设备的那枚新令牌能重新连上', async () => {
    const oldPassword = `ws-suite-old-${Date.now()}-${process.pid}-Pass!`;
    const newPassword = `ws-suite-new-${Date.now()}-${process.pid}-Pass!`;
    await observer.user.update({ where: { id: userId }, data: { passwordHash: await hashFor(oldPassword) } });

    const tokenC = await issueSession({ id: userId }, { deviceName: 'device-c' });
    const tokenD = await issueSession({ id: userId }, { deviceName: 'device-d' });
    const registeredBefore = getWsConnectionService().getConnectionCount();
    const wsC = await openSocket(wsBase, tokenC, 'client-change-actor');
    const wsD = await openSocket(wsBase, tokenD, 'client-victim');
    sockets.push(wsC, wsD);
    // 🔴 服务端的登记排在 `await verifyToken` 之后，只等客户端 `open` 会抢跑（见上面那条注释）。
    await waitForConnectionCount(registeredBefore + 2);

    // 🔴 两条监听都排在请求之前（同一型抢跑，见上面那条注释）。
    const closingD = waitForClose(wsD);
    const closingC = waitForClose(wsC);
    const changed = await app.inject({
      method: 'POST',
      url: `/api${AUTH_PASSWORD_PATHS.change}`,
      headers: { ...bearer(tokenC), 'user-agent': 'WS-Suite-Actor' },
      payload: { currentPassword: oldPassword, newPassword },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const issued = JSON.parse(changed.body) as { token: string };

    // 🔴 两条都必须当场断，而 reason 是 `closeForUser` 那一档的 `Token revoked`：
    // 只比 code 4003 分不出走的是逐枚那条（`Session revoked`）还是全部那条。
    expect(await closingD).toEqual({ code: 4003, reason: 'Token revoked' });
    expect(await closingC).toEqual({ code: 4003, reason: 'Token revoked' });

    // 其余设备的会话行**当场**删掉（不是留满 365 天等 `credential-sweep`）：库里只剩换发给当前设备那一枚。
    expect(await observer.accessSession.count({ where: { userId } })).toBe(1);

    // 而当前设备**没被踢下线**：响应里那枚新令牌能重新连上
    // （"改个密码把自己的这个标签页也踢出去"就是这句话没兑现时的症状）。
    const revived = await openSocket(wsBase, issued.token, 'client-after-change');
    sockets.push(revived);
    await waitForConnectionCount(1);
    expect(revived.readyState).toBe(WebSocket.OPEN);
  });

  /**
   * 🔴 **三条撤销路径的最后一格**：重置口令（忘记密码）那一路的通道那一半。
   * 它与改密那条共用 `revokeAllDeviceSessions()`，但它**不换发会话**（J14），
   * 所以这一路要的是"两条全断 + 库里一条不剩"。
   * ⚠️ 这一路补上之后，§5 第 16 条那三条路里**改密与重置**两条有真 socket 读数了；
   * **换绑生效**那一路仍只有 spy 层那一条（`account-security.routes.spec.ts` 断的是"调用了 `closeForUser`"，
   * 不是"那条连接真的断了"）—— 要在这一层补它，得把那两封信的装置重铺进本套件，理由与取舍写在计划 §6.73。
   */
  it('🔴 真重置口令 ⇒ 已经开着的页面当场断，而库里一条会话都不剩（这条路不换发会话）', async () => {
    const newPassword = `ws-suite-reset-${Date.now()}-${process.pid}-Pass!`;
    const tokenE = await issueSession({ id: userId }, { deviceName: 'device-e' });
    const tokenF = await issueSession({ id: userId }, { deviceName: 'device-f' });
    const registeredBefore = getWsConnectionService().getConnectionCount();
    const wsE = await openSocket(wsBase, tokenE, 'client-reset-e');
    const wsF = await openSocket(wsBase, tokenF, 'client-reset-f');
    sockets.push(wsE, wsF);
    await waitForConnectionCount(registeredBefore + 2);

    // 🔴 监听排在请求之前（与上面两条同一型抢跑，见 `waitForClose` 上面那段）。
    const closingE = waitForClose(wsE);
    const closingF = waitForClose(wsF);

    const linkToken = `ws-reset-${Date.now()}-${process.pid}`;
    await observer.user.update({
      where: { id: userId },
      data: { resetPasswordToken: hashToken(linkToken), resetPasswordTokenExpiresAt: BigInt(Date.now() + 60_000) },
    });
    const reset = await app.inject({
      method: 'POST',
      url: `/api${AUTH_PASSWORD_PATHS.reset}`,
      payload: { token: linkToken, password: newPassword },
    });
    expect(reset.statusCode, reset.body).toBe(200);
    expect((JSON.parse(reset.body) as { token?: string }).token, '重置口令换出了一枚会话').toBeUndefined();

    expect(await closingE).toEqual({ code: 4003, reason: 'Token revoked' });
    expect(await closingF).toEqual({ code: 4003, reason: 'Token revoked' });
    // 这条路不换发新令牌 ⇒ 全部删干净，库里应当**零行**。
    expect(await observer.accessSession.count({ where: { userId } })).toBe(0);
  });

  /**
   * 🔴 **§6.73 那张表的第四格：注销账号。** 它比改密/重置更适合在这一层验 ——
   * 因为生产代码里那句 `closeForUser` 有它**自己的一条理由**（注释写的：删掉之后不关，
   * 那条还活着的连接会继续答 ping，于是"死连接"那支永远收不掉它，而它的心跳 touch
   * 会替一个已经不存在的账号重新 INSERT 一行 `sync_devices`，从此每个节流窗口撞一次外键）。
   * spy 层断的是"调用了 `closeForUser`"，这一层断的是"那条连接真的断了、而且没有再长出一行设备"。
   */
  it('🔴 真注销账号 ⇒ 所有已经开着的页面当场断，而库里既没有会话行也没有被心跳重新插出来的设备行', async () => {
    const tokenG = await issueSession({ id: userId }, { deviceName: 'device-g' });
    const tokenH = await issueSession({ id: userId }, { deviceName: 'device-h' });
    const registeredBefore = getWsConnectionService().getConnectionCount();
    const wsG = await openSocket(wsBase, tokenG, 'client-delete-g');
    const wsH = await openSocket(wsBase, tokenH, 'client-delete-h');
    sockets.push(wsG, wsH);
    await waitForConnectionCount(registeredBefore + 2);

    const closingG = waitForClose(wsG);
    const closingH = waitForClose(wsH);

    const deleted = await app.inject({ method: 'DELETE', url: '/api/account', headers: bearer(tokenG) });
    expect(deleted.statusCode, deleted.body).toBe(200);

    expect(await closingG).toEqual({ code: 4003, reason: 'Token revoked' });
    expect(await closingH).toEqual({ code: 4003, reason: 'Token revoked' });

    // 🔴 注销之后这个人**不存在**了：会话行与设备行都该随真外键级联消失。
    // 设备行那一格是这段注释要防的形状 —— 连接没关时它会被心跳重新插出来。
    expect(await observer.accessSession.count({ where: { userId } })).toBe(0);
    expect(await observer.syncDevice.count({ where: { userId } })).toBe(0);
    // 手上那枚令牌此后不能用（缓存里那一格也必须已经失效）。
    // 🔴 档位是 **410**，不是其余撤销路径那三条的 401：410 是注销独占的对外契约
    //（`account-closed-signal.spec.ts` 已钉死"其余三种失效各自仍是 401"），照抄姊妹
    // 用例的 401 会写成一条永远不可能红的判据 —— 台账 §6.70 那条"状态码不能照抄"的翻版。
    const after = await app.inject({ method: 'GET', url: `/api/${SESSION_PATHS.list}`, headers: bearer(tokenG) });
    expect(after.statusCode, '注销之后那枚令牌还在用').toBe(410);
    expect(after.json()).toMatchObject({ code: 'ACCOUNT_CLOSED' });
  });
});
