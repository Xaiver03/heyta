/**
 * 管理员的授予 / 撤销 —— 服务层不变量。
 *
 * 这一组钉的是**"后台会不会永远打不开"**，不是"函数能不能跑"：
 *
 *   1. 🔴 **拒绝撤销最后一个管理员。** 撤销错了不会报错 —— 它只是让后台对所有人
 *      关闭，而恢复要直连数据库改一行。所以"最后一个"这条判定必须真的在，
 *      而且必须在**写之前**（不是写完再检查）。
 *   2. 授权是**幂等**的：已经被授权的人再授予一次不该产生第二次 UPDATE，
 *      也不该报错（脚本会被重跑，而对幂等操作报错只会让人学会忽略输出）。
 *   3. 邮箱口径统一（trim + lowercase）：否则 CLI 会对着一个"看起来一样"的
 *      邮箱报"用户不存在"，而那个人其实在库里。
 *   4. 对外投影是**白名单**：`passwordHash` 之类的列即使被数据库返回，
 *      也不许出现在结果里。
 *
 * 变异验证（见交付说明）：把 `revokeAdmin` 里的 `countAdmins() <= 1` 判定拿掉，
 * 第 1 条转红。
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('../src/db', () => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

import { prisma } from '../src/db';
import {
  countAdmins,
  grantAdmin,
  listAdmins,
  normalizeAdminEmail,
  revokeAdmin,
} from '../src/admin/admins';

const mockPrisma = prisma as unknown as {
  user: {
    findUnique: Mock;
    findMany: Mock;
    update: Mock;
    count: Mock;
  };
};

/** 一个完整的用户行（含**敏感列** —— 用来证明投影真的在过滤）。 */
const userRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  email: 'ops@example.test',
  isVerified: 1,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  isAdmin: false,
  // 刻意塞进来：投影如果是 `...row` 摊平，这些就会漏出去。
  passwordHash: '$argon2id$should-never-leave-the-server',
  loginToken: 'token-should-never-leave-the-server',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('邮箱口径', () => {
  it('trim + lowercase（与登录查找同一口径）', () => {
    expect(normalizeAdminEmail('  Ops@Example.TEST ')).toBe('ops@example.test');
  });
});

describe('grantAdmin', () => {
  it('用户不存在 ⇒ user-not-found，且不写库', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await grantAdmin('nobody@example.test');

    expect(result).toEqual({ ok: false, reason: 'user-not-found' });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('查询用的是规范化后的邮箱', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(userRow());

    await grantAdmin('  Ops@Example.TEST  ');

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'ops@example.test' } }),
    );
  });

  it('把 isAdmin 置为 true', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(userRow());
    mockPrisma.user.update.mockResolvedValue(userRow({ isAdmin: true }));

    const result = await grantAdmin('ops@example.test');

    expect(result.ok).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { isAdmin: true },
    });
  });

  it('🔴 已经是管理员时**幂等**：不产生第二次 UPDATE，也不报错', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(userRow({ isAdmin: true }));

    const result = await grantAdmin('ops@example.test');

    expect(result.ok).toBe(true);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('🔴 结果里不许出现密码哈希与任何 token', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(userRow());
    mockPrisma.user.update.mockResolvedValue(userRow());

    const result = await grantAdmin('ops@example.test');

    expect(result.ok && result.admin).toBeTruthy();
    const keys = Object.keys(result.ok ? result.admin : {});
    expect(keys).not.toContain('passwordHash');
    expect(keys).not.toContain('loginToken');
    // 白名单本身也钉一下：字段只有这四个。
    expect(keys.sort()).toEqual(['createdAt', 'email', 'id', 'isVerified']);
  });
});

describe('🔴 revokeAdmin', () => {
  it('最后一个管理员：拒绝，且**不写库**', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(userRow({ isAdmin: true }));
    mockPrisma.user.count.mockResolvedValue(1);

    const result = await revokeAdmin('ops@example.test');

    expect(result).toEqual({ ok: false, reason: 'last-admin' });
    // 关键：判定必须在写之前。写完再发现"哦这是最后一个"是没法回滚的。
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('还有别的管理员时：允许撤销', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(userRow({ isAdmin: true }));
    mockPrisma.user.count.mockResolvedValue(2);
    mockPrisma.user.update.mockResolvedValue(userRow({ isAdmin: false }));

    const result = await revokeAdmin('ops@example.test');

    expect(result.ok).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { isAdmin: false },
    });
  });

  it('本来就不是管理员 ⇒ not-an-admin，且不写库', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(userRow({ isAdmin: false }));

    const result = await revokeAdmin('ops@example.test');

    expect(result).toEqual({ ok: false, reason: 'not-an-admin' });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    // 连数都不用数：这个人本来就不是管理员。
    expect(mockPrisma.user.count).not.toHaveBeenCalled();
  });

  it('用户不存在 ⇒ user-not-found，且不写库', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await revokeAdmin('nobody@example.test');

    expect(result).toEqual({ ok: false, reason: 'user-not-found' });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe('listAdmins / countAdmins', () => {
  it('只问 isAdmin = true，并按 id 升序（稳定输出）', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);

    await listAdmins();

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isAdmin: true }, orderBy: { id: 'asc' } }),
    );
  });

  it('库里的 0/1 投影成真正的 boolean（否则前端 `if (isVerified)` 会把 0 当假、把字符串当假）', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      userRow({ id: 1, isVerified: 1 }),
      userRow({ id: 2, isVerified: 0 }),
    ]);

    const admins = await listAdmins();

    expect(admins.map((a) => a.isVerified)).toEqual([true, false]);
    expect(typeof admins[0]!.isVerified).toBe('boolean');
  });

  it('countAdmins 数的是 isAdmin = true', async () => {
    mockPrisma.user.count.mockResolvedValue(3);
    await expect(countAdmins()).resolves.toBe(3);
    expect(mockPrisma.user.count).toHaveBeenCalledWith({ where: { isAdmin: true } });
  });
});
