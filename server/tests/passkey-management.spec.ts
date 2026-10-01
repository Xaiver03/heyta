/**
 * 自助管理通行密钥（列 / 删）—— 服务层。
 *
 * 这一组钉住的是**安全边界本身**，不是"函数能不能跑"：
 *
 *   1. 列表**绝不**返回 `publicKey` / `credentialId`。测试把 mock 造成
 *      "数据库把敏感列也返回了"，再断言映射后它们**一个都不在** ——
 *      这样"改成 `...row` 直接摊平"就会变红。
 *   2. 删除谓词里必须带 `userId`：否则任何登录用户都能删别人的凭据。
 *   3. "不是你的 / 不存在"抛**同一个**码（接口层投影成 404），
 *      响应里没有东西能区分两者。
 *   4. 删最后一条 → `last_passkey_required`，且删除谓词里那个
 *      "还存在另一条"的条件必须真的在（否则自锁）。
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({ closeForUser: vi.fn() }),
}));

vi.mock('../src/email', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
  sendPasskeyRecoveryEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/db', () => {
  const mockPrisma = {
    user: { findUnique: vi.fn() },
    passkey: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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

import { prisma } from '../src/db';
import * as simplewebauthn from '@simplewebauthn/server';
import {
  listUserPasskeys,
  deleteUserPasskey,
  renameUserPasskey,
  PASSKEY_NAME_MAX_LENGTH,
  generateAuthenticationOptions,
  verifyAuthentication,
  PasskeyError,
} from '../src/passkey';

const mockPrisma = prisma as unknown as {
  user: { findUnique: Mock };
  passkey: {
    findMany: Mock;
    findFirst: Mock;
    findUnique: Mock;
    deleteMany: Mock;
    update: Mock;
    updateMany: Mock;
  };
  $transaction: Mock;
};

const mockGenerateAuthentication = simplewebauthn.generateAuthenticationOptions as Mock;
const mockVerifyAuthentication = simplewebauthn.verifyAuthenticationResponse as Mock;

/** 数据库行：**刻意带上敏感列**，用来证明映射是白名单而不是摊平。 */
const rowWithSecrets = {
  id: 'pk_row_1',
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  lastUsedAt: new Date('2026-02-03T04:05:06.000Z'),
  // 名字是**用户可见**的字段，故意和敏感列放在同一行里：映射必须是白名单，
  // 所以"漏掉 name"（界面永远看不到名字）与"摊平 row"（泄露公钥）都要变红。
  name: 'MacBook 的 Touch ID',
  credentialId: Buffer.from([1, 2, 3, 4]),
  publicKey: Buffer.from([5, 6, 7, 8]),
  counter: BigInt(3),
  transports: JSON.stringify(['internal']),
  userId: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
  );
  mockPrisma.passkey.deleteMany.mockResolvedValue({ count: 1 });
  mockPrisma.passkey.findFirst.mockResolvedValue(null);
  // 改名默认命中 1 行（成功）。需要失败形状的用例自己覆盖。
  mockPrisma.passkey.updateMany.mockResolvedValue({ count: 1 });
  mockGenerateAuthentication.mockResolvedValue({
    challenge: 'test-challenge',
    rpId: 'localhost',
  });
});

describe('listUserPasskeys', () => {
  it('返回形状是白名单：只有 id / createdAt / lastUsedAt / name', async () => {
    mockPrisma.passkey.findMany.mockResolvedValue([rowWithSecrets]);

    const summaries = await listUserPasskeys(1);

    // 🔴 必须显式写出 `name`，不能靠"没写就等于没有"：`toEqual` 认为
    // `{ name: undefined }` 与"根本没有 name 键"相等，所以**漏掉 name 的映射
    // 在旧写法下照样绿**。这里把名字给成真值，漏掉就一定会红。
    expect(summaries).toEqual([
      {
        id: 'pk_row_1',
        createdAt: '2026-01-02T03:04:05.000Z',
        lastUsedAt: '2026-02-03T04:05:06.000Z',
        name: 'MacBook 的 Touch ID',
      },
    ]);
  });

  it('🔴 响应里不出现 publicKey / credentialId —— 即使数据库把它们返回了', async () => {
    mockPrisma.passkey.findMany.mockResolvedValue([rowWithSecrets]);

    const summaries = await listUserPasskeys(1);
    const serialized = JSON.stringify(summaries);

    expect(serialized).not.toContain('publicKey');
    expect(serialized).not.toContain('credentialId');
    // 键的**集合**也钉住：多一个字段就说明白名单被改宽了。
    // `name` 是唯一新增的可展示字段 —— 它在这里出现，敏感列一个都不在。
    expect(Object.keys(summaries[0]!).sort()).toEqual([
      'createdAt',
      'id',
      'lastUsedAt',
      'name',
    ]);
  });

  it('查询本身就只 select 这四个字段（少读一次敏感列）', async () => {
    mockPrisma.passkey.findMany.mockResolvedValue([]);

    await listUserPasskeys(7);

    expect(mockPrisma.passkey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 7 },
        select: { id: true, createdAt: true, lastUsedAt: true, name: true },
      }),
    );
  });

  it('从未使用过的凭据 lastUsedAt 是 null（不是假的时间戳）', async () => {
    mockPrisma.passkey.findMany.mockResolvedValue([
      { ...rowWithSecrets, lastUsedAt: null },
    ]);

    const summaries = await listUserPasskeys(1);

    expect(summaries[0]!.lastUsedAt).toBeNull();
  });
});

describe('deleteUserPasskey — 归属', () => {
  it('删除谓词同时带 id 与 userId，并要求"还有另一条凭据 或 有能用的口令"', async () => {
    mockPrisma.passkey.deleteMany.mockResolvedValue({ count: 1 });

    const result = await deleteUserPasskey(1, 'pk_row_1');

    expect(result).toEqual({ deleted: true });
    expect(mockPrisma.passkey.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'pk_row_1',
        userId: 1,
        OR: [
          { user: { passkeys: { some: { id: { not: 'pk_row_1' } } } } },
          { user: { passwordHash: { not: null }, isVerified: 1 } },
        ],
      },
    });
    // 🔴 放行路径**不许多一次查询**：判据必须整体待在那条 DELETE 里。
    // 先查口令再删的写法在两次调用之间会漏（口令刚好被别的请求清掉），
    // 而那正是这条规则唯一要防的形态。
    expect(mockPrisma.passkey.findFirst).not.toHaveBeenCalled();
  });

  it('🔴 删别人的 / 不存在的 → 同一个码（调用方无法区分）', async () => {
    mockPrisma.passkey.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.passkey.findFirst.mockResolvedValue(null);

    const error = await deleteUserPasskey(1, 'someone-elses-row').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PasskeyError);
    expect((error as PasskeyError).code).toBe('passkey_not_found_for_user');
    // 追踪查询也必须在 userId 范围内 —— 否则"别人的 id"会被查到，
    // 而那次查询的结果决定了错误码，等于把存在性糊进了响应码里。
    expect(mockPrisma.passkey.findFirst).toHaveBeenCalledWith({
      where: { id: 'someone-elses-row', userId: 1 },
      select: { id: true },
    });
  });

  it('别人的凭据存在也照样不删：count 0 时绝不返回成功', async () => {
    // 模拟"那条 id 真的存在，只是属于 user 2"：追踪查询（限 userId: 1）查不到。
    mockPrisma.passkey.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.passkey.findFirst.mockResolvedValue(null);

    await expect(deleteUserPasskey(1, 'user-2-row')).rejects.toBeInstanceOf(PasskeyError);
    expect(mockPrisma.passkey.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-2-row', userId: 1 } }),
    );
  });

  it('🔴 删最后一条 → last_passkey_required（不许把用户锁在门外）', async () => {
    mockPrisma.passkey.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.passkey.findFirst.mockResolvedValue({ id: 'pk_row_1' });

    const error = await deleteUserPasskey(1, 'pk_row_1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PasskeyError);
    expect((error as PasskeyError).code).toBe('last_passkey_required');

    // 🔴 为什么这条用例里**再断言一次谓词**（上一节已经断言过同样的东西）。
    //
    // 这里的 `count: 0` 是**桩死的**，所以它只覆盖了"count 0 且 findFirst 命中
    // → 报 last"这个**分支**。真正让 count 变成 0 的，是 `where` 里那个
    // `user: { passkeys: { some: { id: { not: … } } } }` 原子守卫。
    // 把守卫整行删掉，这个桩仍然是 count 0，用例**照样绿** —— 守卫会静默消失。
    //
    // 那不是一条"少测了一点"的缺口，而是**唯一的 TOCTOU 防护**：
    // 两个标签页各自删一条时，两次 deleteMany 都可能命中（各自都还有"另一条"），
    // 结果两条都没了。所以这条用例必须自己钉住谓词，而不是依赖隔壁那条用例。
    // 重复是有意的：将来有人把这条用例单独搬走时，防护不会跟着掉队。
    expect(mockPrisma.passkey.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'pk_row_1',
        userId: 1,
        OR: [
          { user: { passkeys: { some: { id: { not: 'pk_row_1' } } } } },
          // 🔴 `isVerified: 1` 是承重的：`loginWithEmailPassword` 在口令**校验通过之后**
          // 还会因为 `isVerified === 0` 抛 `email_not_verified`（那个顺序是为了不泄露
          // 邮箱有没有注册过）。只看 `passwordHash` 就会放出一个**谁也进不去**的账号，
          // 而那正是这条规则唯一要防的东西。
          { user: { passwordHash: { not: null }, isVerified: 1 } },
        ],
      },
    });
  });

  it('失败路径下绝不谎报成功', async () => {
    mockPrisma.passkey.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.passkey.findFirst.mockResolvedValue({ id: 'pk_row_1' });

    let resolved: unknown = undefined;
    await deleteUserPasskey(1, 'pk_row_1').then((r) => {
      resolved = r;
    }).catch(() => undefined);

    expect(resolved).toBeUndefined();
  });
});

describe('缺口 B：陈旧凭据与验签失败是两个不同的码', () => {
  const credential = {
    id: 'NdTCzq0G8dA8cObw41B8',
    rawId: 'raw',
    type: 'public-key',
    response: {
      clientDataJSON: 'x',
      authenticatorData: 'y',
      signature: 'z',
    },
    clientExtensionResults: {},
  };

  it('服务端不认得这条 credential ID → passkey_not_found', async () => {
    mockPrisma.passkey.findUnique.mockResolvedValue(null);
    await generateAuthenticationOptions('stale@example.com');

    const error = await verifyAuthentication('stale@example.com', credential as never).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(PasskeyError);
    expect((error as PasskeyError).code).toBe('passkey_not_found');
  });

  it('认得凭据但验签失败 → passkey_verification_failed', async () => {
    mockPrisma.passkey.findUnique.mockResolvedValue({
      id: 'pk_row_1',
      credentialId: Buffer.from(credential.id),
      publicKey: Buffer.from([1, 2, 3]),
      counter: BigInt(0),
      transports: null,
      user: { id: 1, email: 'live@example.com', isVerified: 1 },
    });
    mockVerifyAuthentication.mockRejectedValue(new Error('bad signature'));
    await generateAuthenticationOptions('live@example.com');

    const error = await verifyAuthentication('live@example.com', credential as never).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(PasskeyError);
    expect((error as PasskeyError).code).toBe('passkey_verification_failed');
  });

  it('两个码**不同** —— 客户端能据此说两句不同的话', async () => {
    mockPrisma.passkey.findUnique.mockResolvedValueOnce(null);
    await generateAuthenticationOptions('a@example.com');
    const notFound = await verifyAuthentication('a@example.com', credential as never).catch(
      (e: unknown) => e as PasskeyError,
    );

    mockPrisma.passkey.findUnique.mockResolvedValueOnce({
      id: 'pk_row_2',
      credentialId: Buffer.from(credential.id),
      publicKey: Buffer.from([1, 2, 3]),
      counter: BigInt(0),
      transports: null,
      user: { id: 1, email: 'b@example.com', isVerified: 1 },
    });
    mockVerifyAuthentication.mockRejectedValue(new Error('bad signature'));
    await generateAuthenticationOptions('b@example.com');
    const badSignature = await verifyAuthentication('b@example.com', credential as never).catch(
      (e: unknown) => e as PasskeyError,
    );

    expect(notFound.code).not.toBe(badSignature.code);
  });
});

/**
 * 改名 —— 服务层。
 *
 * 这里钉的是三件事，都不是"函数能不能跑"：
 *   1. **归属**：谓词里必须带 `userId`，否则任何登录用户都能改别人凭据的名字；
 *      "别人的 / 不存在的"抛**同一个**码（接口层投影成 404），响应里没有
 *      任何东西能区分两者。
 *   2. **归一化**：空串 / 纯空白 → `null`（去掉名字），首尾空白被 trim。
 *      库里绝不留 `''` —— 那是个既不是名字、又让 `name === null` 失效的值。
 *   3. **不谎报成功**：`count !== 1` 时抛错，绝不返回 `{ renamed: true }`。
 */
describe('renameUserPasskey', () => {
  it('谓词同时带 id 与 userId（否则能改别人的）', async () => {
    const result = await renameUserPasskey(1, 'pk_row_1', '我的备用密钥');

    expect(result).toEqual({ renamed: true });
    expect(mockPrisma.passkey.updateMany).toHaveBeenCalledWith({
      where: { id: 'pk_row_1', userId: 1 },
      data: { name: '我的备用密钥' },
    });
  });

  it('🔴 改别人的 / 不存在的 → 同一个码（调用方无法区分）', async () => {
    mockPrisma.passkey.updateMany.mockResolvedValue({ count: 0 });

    const error = await renameUserPasskey(1, 'someone-elses-row', 'x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PasskeyError);
    expect((error as PasskeyError).code).toBe('passkey_not_found_for_user');
    // 与删除同一个码：接口层因此能用**逐字节相同**的 404 回这两件事。
    expect(mockPrisma.passkey.updateMany).toHaveBeenCalledWith({
      where: { id: 'someone-elses-row', userId: 1 },
      data: { name: 'x' },
    });
  });

  it('count 0 时绝不谎报成功', async () => {
    mockPrisma.passkey.updateMany.mockResolvedValue({ count: 0 });

    let resolved: unknown = undefined;
    await renameUserPasskey(1, 'pk_row_1', 'x')
      .then((r) => {
        resolved = r;
      })
      .catch(() => undefined);

    expect(resolved).toBeUndefined();
  });

  it('空串 / 纯空白 → null（去掉名字，而不是存一个空字符串）', async () => {
    await renameUserPasskey(1, 'pk_row_1', '');
    expect(mockPrisma.passkey.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'pk_row_1', userId: 1 },
      data: { name: null },
    });

    await renameUserPasskey(1, 'pk_row_1', '   ');
    expect(mockPrisma.passkey.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'pk_row_1', userId: 1 },
      data: { name: null },
    });
  });

  it('显式 null 也是去掉名字', async () => {
    await renameUserPasskey(1, 'pk_row_1', null);
    expect(mockPrisma.passkey.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'pk_row_1', userId: 1 },
      data: { name: null },
    });
  });

  it('首尾空白被 trim 掉（" 名字 " 与 "名字" 是同一个名字）', async () => {
    await renameUserPasskey(1, 'pk_row_1', '  MacBook  ');
    expect(mockPrisma.passkey.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'pk_row_1', userId: 1 },
      data: { name: 'MacBook' },
    });
  });

  it('🔴 超长 → passkey_name_too_long，且**根本不写库**', async () => {
    const tooLong = 'x'.repeat(PASSKEY_NAME_MAX_LENGTH + 1);

    const error = await renameUserPasskey(1, 'pk_row_1', tooLong).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PasskeyError);
    expect((error as PasskeyError).code).toBe('passkey_name_too_long');
    // 关键：不是"写完再骂" —— 越长的输入越不该先落库。
    expect(mockPrisma.passkey.updateMany).not.toHaveBeenCalled();
  });

  it('恰好到上限是允许的（边界不小一）', async () => {
    const atLimit = 'x'.repeat(PASSKEY_NAME_MAX_LENGTH);

    await expect(renameUserPasskey(1, 'pk_row_1', atLimit)).resolves.toEqual({ renamed: true });
    expect(mockPrisma.passkey.updateMany).toHaveBeenCalledWith({
      where: { id: 'pk_row_1', userId: 1 },
      data: { name: atLimit },
    });
  });

  it('trim 之后才判长度（62 个空格不是"太长"，是"没名字"）', async () => {
    const spaces = ' '.repeat(PASSKEY_NAME_MAX_LENGTH + 2);

    await expect(renameUserPasskey(1, 'pk_row_1', spaces)).resolves.toEqual({ renamed: true });
    expect(mockPrisma.passkey.updateMany).toHaveBeenCalledWith({
      where: { id: 'pk_row_1', userId: 1 },
      data: { name: null },
    });
  });
});
