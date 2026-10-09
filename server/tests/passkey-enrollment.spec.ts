/**
 * 已认证地给当前账号「再加一条」凭据 —— HTTP + 服务层。
 * ======================================================
 *
 * 这一组钉的是**语义本身**，不是"接口能跑"：
 *
 *   1. 🔴 正向：完成后 `Passkey` 表里该 `userId` 下**真的多了一条**
 *      （用内存 prisma 桩把写入落到数组上，再通过 `GET /api/passkeys` 读回来）。
 *   2. 🔴 未认证 → 401，且 `passkey.create` / `$transaction` 一次都没被调用。
 *   3. 🔴 请求体里塞 `userId` / `email` 指向别人 → 归属仍然只来自令牌。
 *   4. 🔴 这条路**不经过** `verifyRegistration` 的"已验证账号提前返回成功"分支：
 *      完成路径既不查 `user`，也不写 `pendingPasskeyRegistration`；
 *      而"返回成功"与"create 真的发生"是同一件事（create 抛错 → 不是 2xx）。
 *   5. 同一条凭据重复登记 → 409 + `passkey_already_registered`，绝不新增第二行。
 *
 * 与 `passkey-routes.spec.ts` 同一套做法：mock prisma / simplewebauthn，
 * `app.inject()` 走真实路由。`verifyToken` 由全局 `tests/setup.ts` 提供
 * （默认有效，userId = 1）。
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({ closeForUser: vi.fn() }),
}));

vi.mock('../src/email', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
  sendPasskeyRecoveryEmail: vi.fn().mockResolvedValue(true),
  // ADR-0063 §2.6：已登录新增认证器的那封告知信。不 mock 它就会让这 20 条用例
  // 依赖 SMTP（没凭据的机器上永远红），而"这封信到底发没发"又必须能被断言。
  sendAuthenticatorAddedEmail: vi.fn().mockResolvedValue(true),
}));

/**
 * 内存 prisma 桩。
 *
 * 🔴 不是"每个方法返回固定值"：`create` 会把行推进 `passkeys` 数组，
 * `findMany` 按 `userId` 过滤。正向用例才能断言"库里真的多了一条"，
 * 而不是只断言"create 被调用过"。
 */
const dbState = vi.hoisted(() => ({
  passkeys: [] as Array<{
    id: string;
    userId: number;
    credentialId: Buffer;
    publicKey: Buffer;
    counter: bigint;
    transports: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
  }>,
  nextId: 1,
  users: new Map<number, { id: number; email: string; locale?: string | null }>(),
}));

vi.mock('../src/db', () => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(async (args: { where?: { id?: number } }) => {
        const id = args?.where?.id;
        return id === undefined ? null : (dbState.users.get(id) ?? null);
      }),
    },
    passkey: {
      findMany: vi.fn(async (args: { where?: { userId?: number } }) => {
        // select 被忽略：`listUserPasskeys` 的映射只挑三个字段，
        // `generateUserPasskeyOptions` 只读 credentialId。
        return dbState.passkeys.filter((row) => row.userId === args?.where?.userId);
      }),
      create: vi.fn(
        async (args: {
          data: {
            credentialId: Buffer;
            publicKey: Buffer;
            counter: bigint;
            transports: string | null;
            userId: number;
          };
          select?: Record<string, boolean>;
        }) => {
          const data = args.data;
          const row = {
            id: `pk_${dbState.nextId++}`,
            userId: data.userId,
            credentialId: data.credentialId,
            publicKey: data.publicKey,
            counter: data.counter,
            transports: data.transports ?? null,
            createdAt: new Date('2026-03-04T05:06:07.000Z'),
            lastUsedAt: null,
          };
          dbState.passkeys.push(row);
          return args.select === undefined ? row : { id: row.id };
        },
      ),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    pendingPasskeyRegistration: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { prisma: mockPrisma };
});

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import { apiRoutes } from '../src/api';
import { prisma } from '../src/db';
import { sendAuthenticatorAddedEmail } from '../src/email';
import * as simplewebauthn from '@simplewebauthn/server';

const mockNotice = sendAuthenticatorAddedEmail as Mock;

const mockPrisma = prisma as unknown as {
  user: { findUnique: Mock };
  passkey: {
    findMany: Mock;
    create: Mock;
    findFirst: Mock;
    findUnique: Mock;
    deleteMany: Mock;
  };
  pendingPasskeyRegistration: { create: Mock };
  $transaction: Mock;
};

const mockGenerateRegistration = simplewebauthn.generateRegistrationOptions as Mock;
const mockVerifyRegistration = simplewebauthn.verifyRegistrationResponse as Mock;

const AUTH = { authorization: 'Bearer owner-token' };

const OLD_CREDENTIAL_ID = 'b2xkLWNyZWRlbnRpYWwtaWQ'; // base64url of "old-credential-id"
const NEW_CREDENTIAL_ID = 'bmV3LWNyZWRlbnRpYWwtaWQ'; // base64url of "new-credential-id"

/** SimpleWebAuthn v13：`registrationInfo.credential.id` 是 base64url 字符串的 UTF-8 字节。 */
function registrationInfoFor(credentialIdBase64url: string) {
  return {
    verified: true,
    registrationInfo: {
      credential: {
        id: new TextEncoder().encode(credentialIdBase64url),
        publicKey: new Uint8Array([9, 9, 9]),
        counter: 0,
      },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    },
  };
}

function p2002(): Error {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`credential_id`)',
    { code: 'P2002', clientVersion: '5.22.0' },
  );
}

function seedPasskey(userId: number, credentialIdBase64url: string): void {
  dbState.passkeys.push({
    id: `pk_seed_${dbState.passkeys.length + 1}`,
    userId,
    credentialId: Buffer.from(credentialIdBase64url, 'base64url'),
    publicKey: Buffer.from([1, 2, 3]),
    counter: BigInt(0),
    transports: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastUsedAt: null,
  });
}

/** 先按已认证流程取一次 options（真实客户端也是两步）。 */
async function beginEnrollment(app: FastifyInstance): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/passkeys/registration/options',
    headers: AUTH,
  });
  expect(res.statusCode).toBe(200);
}

describe('通行密钥「已认证再加一条」', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    dbState.passkeys.length = 0;
    dbState.nextId = 1;
    dbState.users.clear();
    dbState.users.set(1, { id: 1, email: 'owner@example.com' });
    dbState.users.set(2, { id: 2, email: 'other@example.com' });

    // 🔴 必须**回显生产传进来的参数**，不能返回一个写死的常量对象。
    // 否则 `excludeCredentials` 那条断言检查的只是这个桩自己的返回值：
    // 生产即使把 `excludeCredentials` 整个删掉（退回公开注册的 `[]`），
    // 断言也照样绿 —— 那是同义反复，不是验收。
    mockGenerateRegistration.mockImplementation(async (args: Record<string, unknown>) => ({
      challenge: 'user-enrollment-challenge',
      rp: { name: 'Test', id: 'localhost' },
      user: { id: 'user-id', name: args.userName, displayName: args.userDisplayName },
      pubKeyCredParams: [],
      authenticatorSelection: args.authenticatorSelection,
      attestation: args.attestationType,
      // 把生产传的排除列表原样带出来，断言才有意义。
      excludeCredentials: args.excludeCredentials,
    }));
    mockVerifyRegistration.mockResolvedValue(registrationInfoFor(NEW_CREDENTIAL_ID));

    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('阶段一：POST /api/passkeys/registration/options', () => {
    it('未认证 → 401，且一个库读都没有', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/passkeys/registration/options',
      });

      expect(res.statusCode).toBe(401);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.passkey.findMany).not.toHaveBeenCalled();
    });

    it('已认证 → 200，且 excludeCredentials 填的是**当前用户已有**的 credential id', async () => {
      seedPasskey(1, OLD_CREDENTIAL_ID);
      // 别人的凭据：绝不能被排进"当前用户已有"里。
      seedPasskey(2, 'b3RoZXItdXNlci1jcmVk');

      const res = await app.inject({
        method: 'POST',
        url: '/api/passkeys/registration/options',
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const options = res.json();
      expect(options.challenge).toBe('user-enrollment-challenge');
      expect(options.excludeCredentials).toEqual([{ id: OLD_CREDENTIAL_ID }]);
      // 查当前用户的凭据时带上了 userId（归属来自令牌）。
      expect(mockPrisma.passkey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 1 } }),
      );
    });
  });

  describe('阶段二：POST /api/passkeys/registration/complete', () => {
    const credential = { id: NEW_CREDENTIAL_ID, response: { transports: ['internal'] } };

    it('🔴 正向：真的写进库，userId 名下多了一条（再 GET 读回来验证）', async () => {
      seedPasskey(1, OLD_CREDENTIAL_ID);
      await beginEnrollment(app);

      const res = await app.inject({
        method: 'POST',
        url: '/api/passkeys/registration/complete',
        headers: AUTH,
        payload: { credential },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe('pk_1');

      // 直接看内存"数据库"：user 1 现在有两条，新那条的 credentialId 正确。
      const owned = dbState.passkeys.filter((row) => row.userId === 1);
      expect(owned).toHaveLength(2);
      const added = owned.find(
        (row) => row.credentialId.toString('base64url') === NEW_CREDENTIAL_ID,
      );
      expect(added).toBeDefined();
      expect(added!.transports).toBe(JSON.stringify(['internal']));

      // 再从客户端唯一看得见的列表接口读回来 —— 行 id 出现在响应里。
      const list = await app.inject({
        method: 'GET',
        url: '/api/passkeys',
        headers: AUTH,
      });
      expect(list.statusCode).toBe(200);
      const ids = (list.json().passkeys as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain('pk_1');
      expect(ids).toHaveLength(2);
    });

    it('🔴 反向 A：未认证 → 401，且 passkey.create / $transaction 一次都没被调用', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/passkeys/registration/complete',
        payload: { credential },
      });

      expect(res.statusCode).toBe(401);
      expect(mockPrisma.passkey.create).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(dbState.passkeys).toHaveLength(0);
    });

    it('🔴 反向 B：请求体塞 userId / email 指向别人 → 归属仍然是令牌的主人', async () => {
      await beginEnrollment(app);

      const res = await app.inject({
        method: 'POST',
        url: '/api/passkeys/registration/complete',
        headers: AUTH, // 令牌属于 user 1
        payload: {
          credential,
          // 这些是**攻击载荷**：试图把凭据挂到 user 2 名下。
          userId: 2,
          email: 'other@example.com',
        },
      });

      expect(res.statusCode).toBe(200);

      // create 收到的必须是 1，不是 2。
      expect(mockPrisma.passkey.create).toHaveBeenCalledTimes(1);
      const dataArg = mockPrisma.passkey.create.mock.calls[0]![0].data as Record<
        string,
        unknown
      >;
      expect(dataArg.userId).toBe(1);
      expect(dataArg.userId).not.toBe(2);
      // 请求体里的 email 从未变成持久化字段。
      expect(Object.keys(dataArg)).not.toContain('email');
      // `data` 里有 BigInt 字段（counter），直接 JSON.stringify 会抛
      // "Do not know how to serialize a BigInt"；用 replacer 转成字符串，
      // 保住"攻击载荷没落库"这条断言。
      expect(
        JSON.stringify(dataArg, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
      ).not.toContain('other@example.com');

      // 数据库里的每一行都属于 user 1。
      expect(dbState.passkeys.map((row) => row.userId)).toEqual([1]);
    });

    it('🔴 反向 C：create 失败时**绝不**返回成功（成功 ⟺ 真的写进去了）', async () => {
      await beginEnrollment(app);
      mockPrisma.passkey.create.mockRejectedValueOnce(new Error('db exploded'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/passkeys/registration/complete',
        headers: AUTH,
        payload: { credential },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.json().id).toBeUndefined();
      expect(dbState.passkeys).toHaveLength(0);
    });

    it('🔴 反向 C：不经过 verifyRegistration 的"已验证账号提前返回成功"分支', async () => {
      await beginEnrollment(app);
      // 取 options 时查过一次 user（为了拿 email）；完成阶段不该再查。
      mockPrisma.user.findUnique.mockClear();

      const res = await app.inject({
        method: 'POST',
        url: '/api/passkeys/registration/complete',
        headers: AUTH,
        payload: { credential },
      });

      expect(res.statusCode).toBe(200);
      // 🔴 判据钉的是**那一次查询的形状**，不是"`user.findUnique` 有没有被调过"。
      // `verifyRegistration` 的特征是 `findUnique({ where: { email } })` 然后按
      // `isVerified` 提前返回成功（不写库）；完成阶段只要不出现"按 email 找账号"，
      // 那条分支在结构上就够不着。
      //
      // 为什么不能继续用"一次都没调"这条更粗的代理：ADR-0063 §2.6 那封"新增认证器"
      // 的告知信会在**写入之后**按 `id` 回读 `email`/`locale`。粗代理会把一个合法的
      // 读也判成"走了那条分支"，而它想防的那件事反而被后来的实现挤掉了。
      const emailLookups = mockPrisma.user.findUnique.mock.calls.filter(
        ([args]) =>
          'email' in ((args as { where?: Record<string, unknown> })?.where ?? {}),
      );
      expect(emailLookups).toEqual([]);
      expect(mockPrisma.pendingPasskeyRegistration.create).not.toHaveBeenCalled();
      // 而"返回成功"确实伴随真实写入。
      expect(mockPrisma.passkey.create).toHaveBeenCalledTimes(1);
      expect(dbState.passkeys).toHaveLength(1);
    });

    it('验签失败 → 400 + 可判别码，且**没有**写入', async () => {
      await beginEnrollment(app);
      mockVerifyRegistration.mockRejectedValueOnce(new Error('bad attestation'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/passkeys/registration/complete',
        headers: AUTH,
        payload: { credential },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('passkey_verification_failed');
      expect(mockPrisma.passkey.create).not.toHaveBeenCalled();
      expect(dbState.passkeys).toHaveLength(0);
    });

    it('同一条凭据重复登记 → 409 + passkey_already_registered，不新增第二行', async () => {
      await beginEnrollment(app);
      mockPrisma.passkey.create.mockRejectedValueOnce(p2002());

      const res = await app.inject({
        method: 'POST',
        url: '/api/passkeys/registration/complete',
        headers: AUTH,
        payload: { credential },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('passkey_already_registered');
      expect(res.json().success).not.toBe(true);
      expect(dbState.passkeys).toHaveLength(0);
    });

    /**
     * ADR-0063 §2.6：已登录新增认证器 = **多开一扇门**，必须发一封告知信。
     *
     * 这四条各挡一种真实的坏法：
     * - 不发 ⇒ 拿别人遗失会话的人可以静给自己加一条持久入口（缺口 13 的原始伤害）。
     * - 收件地址取请求体 ⇒ 同一处变成"指着别人的邮箱发信"的通道。
     * - 失败路径也发 ⇒ 该接口成了骚扰按钮，并顺带承认账号存在。
     * - 发信失败翻转成 5xx ⇒ 用户以为没加上，再点一次（比少一封信糟得多）。
     */
    describe('告知信（ADR-0063 §2.6）', () => {
      it('🔴 成功 ⇒ 发一封 passkey 信，收件地址是**令牌主人**的邮箱', async () => {
        await beginEnrollment(app);

        const res = await app.inject({
          method: 'POST',
          url: '/api/passkeys/registration/complete',
          headers: AUTH,
          // 攻击载荷：想把这封信发到别人的地址。
          payload: { credential, email: 'victim@example.com' },
        });

        expect(res.statusCode).toBe(200);
        expect(mockNotice).toHaveBeenCalledTimes(1);
        expect(mockNotice.mock.calls[0]![0]).toBe('owner@example.com');
        expect(mockNotice.mock.calls[0]![1]).toBe('passkey');
      });

      it('🔴 写入没发生（验签失败 / 重复登记）⇒ 一封都不发', async () => {
        await beginEnrollment(app);
        mockVerifyRegistration.mockRejectedValueOnce(new Error('bad attestation'));
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/api/passkeys/registration/complete',
              headers: AUTH,
              payload: { credential },
            })
          ).statusCode,
        ).toBe(400);

        await beginEnrollment(app);
        mockPrisma.passkey.create.mockRejectedValueOnce(p2002());
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/api/passkeys/registration/complete',
              headers: AUTH,
              payload: { credential },
            })
          ).statusCode,
        ).toBe(409);

        expect(mockNotice).not.toHaveBeenCalled();
      });

      it('未认证 ⇒ 401 且一封都不发（连账号那一行都不读）', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/passkeys/registration/complete',
          payload: { credential },
        });

        expect(res.statusCode).toBe(401);
        expect(mockNotice).not.toHaveBeenCalled();
      });

      it('🔴 信发不出去 ⇒ **仍然是 200**：添加已经成功了', async () => {
        await beginEnrollment(app);
        mockNotice.mockResolvedValueOnce(false);

        const res = await app.inject({
          method: 'POST',
          url: '/api/passkeys/registration/complete',
          headers: AUTH,
          payload: { credential },
        });

        expect(res.statusCode).toBe(200);
        expect(dbState.passkeys).toHaveLength(1);
      });

      it('🔴 发信那一步**抛错**（SMTP 崩、回读账号那一行也炸）⇒ 仍然 200', async () => {
        await beginEnrollment(app);
        mockNotice.mockRejectedValueOnce(new Error('smtp exploded'));

        const res = await app.inject({
          method: 'POST',
          url: '/api/passkeys/registration/complete',
          headers: AUTH,
          payload: { credential },
        });

        // 这条与上一条分开写，因为实现里的两个 swallow 不是同一个：
        // `deliver()` 返回 false（内部已 catch）与 `notifyAuthenticatorAdded` 自己抛出。
        // 只测前一条，摘掉外层 try 也照样绿。
        expect(res.statusCode).toBe(200);
        expect(dbState.passkeys).toHaveLength(1);
      });

      it('语言取**账号上的** locale；没有值时走默认中文，不跟着请求体的任何东西走', async () => {
        dbState.users.set(1, { id: 1, email: 'owner@example.com', locale: 'en' });
        await beginEnrollment(app);
        await app.inject({
          method: 'POST',
          url: '/api/passkeys/registration/complete',
          headers: AUTH,
          payload: { credential },
        });
        expect(mockNotice.mock.calls[0]![2]).toBe('en');

        mockNotice.mockClear();
        dbState.users.set(1, { id: 1, email: 'owner@example.com', locale: null });
        await beginEnrollment(app);
        await app.inject({
          method: 'POST',
          url: '/api/passkeys/registration/complete',
          headers: AUTH,
          payload: { credential, locale: 'en' },
        });
        expect(mockNotice.mock.calls[0]![2]).toBe('zh-CN');
      });
    });
  });
});
