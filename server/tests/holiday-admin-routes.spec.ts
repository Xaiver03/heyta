import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/admin/holiday-adjustments*` 的录入面（W4b 判据②③④的服务端那一半）。
 *
 * ## 这一组用例保护的是什么
 *
 * | 判据 | 这里的载体 |
 * |---|---|
 * | ② `papers` 随数据入库且**在后台回显** | 写入参数里必须带 `papers`；GET 列表与 PUT 响应都要回显它 |
 * | ③ 日期非法 / `isOffDay` 不是布尔 ⇒ **拒绝录入** | 一组逐条的 400 用例（不是"看起来会拒"，是"打了这一步就 400 且没写库"） |
 * | ④ 非法 ⇒ 整年拒绝、**不接受半套数据** | `$transaction` 失败 ⇒ 400 且库里一步没落 |
 *
 * 🔴 三条都配了"没写库"的那一半断言（`expect(mocks.…).not.toHaveBeenCalled()`）。
 * 只断言 400 是不够的：一个"先写库再校验"的实现也返回 400，而它已经留下了半成品。
 *
 * ## 为什么这里用桩 Prisma，而 `holiday-adjustment-migration.pglite.spec.ts` 用真库
 *
 * 两边判的是**不同的东西**：pglite 那份判的是"列类型与 CHECK 拦不拦得住"，
 * 那份性质只有真 Postgres 有回答资格。这一份判的是"路由在**写库之前**拒了没有、
 * 拒的时候回显了什么"，那是我们自己的代码，桩能判且判得准。
 * 边界写在报告里：**这一份证明不了 Prisma 的 `DATE` 序列化行为**，
 * 那一半由 `server/src/holidays/day-column.ts` 的往返用例担（见 store spec）。
 */

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
  // 只有这几条会被本文件用到；其余 admin 路由沿用既有 mock（见 `admin-routes.spec.ts`）。
  holidayAdjustmentYear: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  holidayAdjustmentDay: { deleteMany: vi.fn(), createMany: vi.fn() },
  subscription: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  checkoutOrder: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  coupon: { count: vi.fn(), findMany: vi.fn() },
  couponRedemption: { count: vi.fn() },
  inviteCode: { count: vi.fn(), findMany: vi.fn() },
  referral: { count: vi.fn(), findMany: vi.fn() },
  /**
   * `$transaction` 的实现**必须真的调那个回调**（并把自身当作 `tx` 传回去）。
   *
   * 🔴 一个 `mockResolvedValue(undefined)` 的假 `$transaction` 会让下面所有
   * "写库了吗"的断言变成 `not.toHaveBeenCalled()` 恒真 —— 于是这一整个文件
   * 变成一条永远通过的判据（§7 元规则 2）。这条桩自己也要有判据：
   * 见 `tx 确实被调用过` 那条用例。
   */
  $transaction: vi.fn(),
}));

vi.mock('../src/db', () => ({ prisma: mocks }));

import { adminRoutes } from '../src/admin/admin.routes';

let app: FastifyInstance;

const AUTH = { authorization: 'Bearer test-token' };

const GOV_PAPER = 'https://www.gov.cn/zhengce/content/2026-11/content_000000.htm';

/** 一份合法录入。下面的坏用例都在它基础上**改一处**，这样失败只能归因到那一处。 */
const YEAR_2027 = {
  year: 2027,
  papers: [GOV_PAPER],
  note: '据 2026 年 11 月调整公告',
  days: [
    { day: '2027-01-01', isOffDay: true },
    { day: '2027-01-02', isOffDay: false },
  ],
};

beforeEach(async () => {
  vi.clearAllMocks();

  // 🔴 见上面 `$transaction` 那段：回调必须被真的调用。
  mocks.$transaction.mockImplementation((fn: (tx: typeof mocks) => Promise<unknown>) =>
    fn(mocks),
  );
  mocks.user.findUnique.mockResolvedValue({ isAdmin: true, email: 'ops@example.test' });
  mocks.user.count.mockResolvedValue(0);
  mocks.user.findMany.mockResolvedValue([]);
  mocks.user.update.mockResolvedValue({ id: 1, email: 'a@example.test' });
  mocks.subscription.groupBy.mockResolvedValue([]);
  mocks.subscription.count.mockResolvedValue(0);
  mocks.subscription.findMany.mockResolvedValue([]);
  mocks.checkoutOrder.groupBy.mockResolvedValue([]);
  mocks.checkoutOrder.count.mockResolvedValue(0);
  mocks.checkoutOrder.findMany.mockResolvedValue([]);
  mocks.coupon.count.mockResolvedValue(0);
  mocks.coupon.findMany.mockResolvedValue([]);
  mocks.couponRedemption.count.mockResolvedValue(0);
  mocks.inviteCode.count.mockResolvedValue(0);
  mocks.inviteCode.findMany.mockResolvedValue([]);
  mocks.referral.count.mockResolvedValue(0);
  mocks.referral.findMany.mockResolvedValue([]);
  mocks.holidayAdjustmentYear.findMany.mockResolvedValue([]);
  mocks.holidayAdjustmentYear.upsert.mockResolvedValue({ year: 2027 });
  mocks.holidayAdjustmentYear.deleteMany.mockResolvedValue({ count: 1 });
  mocks.holidayAdjustmentDay.deleteMany.mockResolvedValue({ count: 0 });
  mocks.holidayAdjustmentDay.createMany.mockResolvedValue({ count: 2 });

  app = Fastify();
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const put = (body: unknown) =>
  app.inject({ method: 'PUT', url: '/api/admin/holiday-adjustments/years', headers: AUTH, payload: body });

describe('🔴 闸门：三条新路由继承插件级 preHandler', () => {
  const NEW: readonly (readonly [string, string])[] = [
    ['GET', '/api/admin/holiday-adjustments'],
    ['PUT', '/api/admin/holiday-adjustments/years'],
    ['DELETE', '/api/admin/holiday-adjustments/years?year=2027'],
  ];

  it('没有 Authorization 头 ⇒ 三条都是 401', async () => {
    for (const [method, url] of NEW) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('有令牌但不是管理员 ⇒ 三条都是 403，**且一次写库都没有**', async () => {
    mocks.user.findUnique.mockResolvedValue({ isAdmin: false });
    for (const [method, url] of NEW) {
      const res = await app.inject({
        method,
        url,
        headers: AUTH,
        ...(method === 'PUT' ? { payload: YEAR_2027 } : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    // 403 时 `replaceHolidayAdjustmentYear` 根本没被走到 —— 这条把"闸门在写之前"钉住。
    expect(mocks.holidayAdjustmentYear.upsert).not.toHaveBeenCalled();
    expect(mocks.holidayAdjustmentDay.createMany).not.toHaveBeenCalled();
  });

  it('🔴 桩 Prisma 的 `$transaction` 真的会调回调（否则上面所有"没写库"的断言都是空的）', async () => {
    await put(YEAR_2027);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.holidayAdjustmentYear.upsert).toHaveBeenCalled();
  });
});

describe('🔴 判据③：非法录入 ⇒ 400 且**没写库**', () => {
  /** 每条只改一处。断言 400 + `upsert`/`createMany` 都没被调用。 */
  const BAD: readonly (readonly [string, unknown])[] = [
    ['2 月 30 日（形状对，但不是那一天）', { ...YEAR_2027, days: [{ day: '2027-02-30', isOffDay: true }] }],
    ['13 月', { ...YEAR_2027, days: [{ day: '2027-13-01', isOffDay: true }] }],
    ['不是日期的字符串', { ...YEAR_2027, days: [{ day: 'tomorrow', isOffDay: true }] }],
    ['日期缺日', { ...YEAR_2027, days: [{ day: '2027-01', isOffDay: true }] }],
    ['🔴 isOffDay 是数字 1', { ...YEAR_2027, days: [{ day: '2027-01-01', isOffDay: 1 }] }],
    ['isOffDay 是字符串 "true"', { ...YEAR_2027, days: [{ day: '2027-01-01', isOffDay: 'true' }] }],
    ['isOffDay 是 null', { ...YEAR_2027, days: [{ day: '2027-01-01', isOffDay: null }] }],
    ['缺 isOffDay', { ...YEAR_2027, days: [{ day: '2027-01-01' }] }],
    ['papers 为空（没有出处）', { ...YEAR_2027, papers: [] }],
    ['papers 是空串', { ...YEAR_2027, papers: [''] }],
    ['🔴 papers 是 javascript: 链接（后台 XSS 的入口）', { ...YEAR_2027, papers: ['javascript:alert(1)'] }],
    ['papers 不是完整 URL', { ...YEAR_2027, papers: ['www.gov.cn/x.htm'] }],
    ['days 为空数组', { ...YEAR_2027, days: [] }],
    ['year 越界（2200 是历法层解释不了的年份）', { ...YEAR_2027, year: 2200 }],
    ['year 越界（2006 早于公告机器可读版）', { ...YEAR_2027, year: 2006 }],
    ['year 不是整数', { ...YEAR_2027, year: 2027.5 }],
    ['同一天出现两次', { ...YEAR_2027, days: [{ day: '2027-01-01', isOffDay: true }, { day: '2027-01-01', isOffDay: false }] }],
    ['days 里的日期跨年', { ...YEAR_2027, days: [{ day: '2026-12-31', isOffDay: true }] }],
    ['note 超长', { ...YEAR_2027, note: 'x'.repeat(501) }],
    ['note 是对象', { ...YEAR_2027, note: { a: 1 } }],
    ['整个 body 是数组', [YEAR_2027]],
    ['body 是 null', null],
  ];

  for (const [label, body] of BAD) {
    it(`${label} ⇒ 400`, async () => {
      const res = await put(body);
      expect(res.statusCode, label).toBe(400);
      // 🔴 400 的**同时**必须一步都没写。
      expect(mocks.$transaction, `${label}：校验失败不许开事务`).not.toHaveBeenCalled();
      expect(mocks.holidayAdjustmentYear.upsert, `${label}：校验失败不许写年度行`).not.toHaveBeenCalled();
      expect(mocks.holidayAdjustmentDay.createMany, `${label}：校验失败不许写逐日行`).not.toHaveBeenCalled();
    });
  }

  it('400 的响应体带**逐字段原因**（运营要能知道是哪一天错，不是"Invalid input"）', async () => {
    const res = await put({ ...YEAR_2027, days: [{ day: '2027-02-30', isOffDay: true }] });
    const body = res.json() as { error: string; issues: { path: string; message: string }[] };
    expect(body.message).toBe('Invalid holiday adjustment year.');
    expect(body.issues.length).toBeGreaterThan(0);
    // `path` 指到 `days.0.day` —— 没有它，运营面对的是"有一处错了"。
    expect(body.issues[0]!.path).toBe('days.0.day');
  });

  it('合法录入 ⇒ 200，并且 `papers` 在响应里**原样回显**（判据②）', async () => {
    const res = await put(YEAR_2027);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, year: 2027, papers: [GOV_PAPER], dayCount: 2 });
  });
});

describe('🔴 判据②：papers 随数据**入库**，不只是回显给客户端看', () => {
  it('写进库的年度行带 papers 数组与操作者邮箱', async () => {
    await put(YEAR_2027);
    expect(mocks.holidayAdjustmentYear.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { year: 2027 },
        create: expect.objectContaining({
          papers: [GOV_PAPER],
          note: YEAR_2027.note,
          // `updatedAt` 是 `Date.now()`，只断言它是 BigInt（Prisma 的 `BigInt` 列漏一次
          // 转换就是整条路由 500 —— 文件头那条纪律在写路径上同样成立）。
          updatedBy: 'ops@example.test',
        }),
      }),
    );
    const call = mocks.holidayAdjustmentYear.upsert.mock.calls[0]![0] as {
      create: { updatedAt: bigint };
    };
    expect(typeof call.create.updatedAt).toBe('bigint');
  });

  it('GET 列表回显 papers / note / updatedBy / dayCount', async () => {
    mocks.holidayAdjustmentYear.findMany.mockResolvedValue([
      {
        year: 2027,
        papers: [GOV_PAPER],
        note: '备注',
        updatedAt: 1_760_000_000_000n,
        updatedBy: 'ops@example.test',
        days: [
          { day: new Date(Date.UTC(2027, 0, 1)), isOffDay: true },
          { day: new Date(Date.UTC(2027, 0, 2)), isOffDay: false },
        ],
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/holiday-adjustments', headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      version: string;
      years: { year: number; papers: string[]; note: string | null; updatedBy: string | null; dayCount: number; days: { day: string }[] }[];
    };
    expect(body.years[0]).toMatchObject({
      year: 2027,
      papers: [GOV_PAPER],
      note: '备注',
      updatedBy: 'ops@example.test',
      dayCount: 2,
    });
    // 🔴 后台看到的日期字符串必须是**库里那一天**（`toISOString` 那条路）。
    expect(body.years[0]!.days.map((d) => d.day)).toEqual(['2027-01-01', '2027-01-02']);
    // `updatedAt` 出参是 number 不是 BigInt（BigInt 进 `JSON.stringify` 直接抛）。
    expect(typeof (body.years[0] as unknown as { updatedAt: unknown }).updatedAt).toBe('number');
  });

  it('空库 ⇒ `years: []` 而**不是** 404 / 报错（自托管的默认形态）', async () => {
    mocks.holidayAdjustmentYear.findMany.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/admin/holiday-adjustments', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: '0.0.0', years: [] });
  });
});

describe('🔴 判据④：库里写失败 ⇒ 不留半成品', () => {
  it('`createMany` 抛（库层 22007）⇒ 400 + 事务在回调里已开过，整体由 Prisma 回滚', async () => {
    // 桩：zod **放过了**（这模拟"有人把校验顺序写错"或"库比 zod 严"），库里炸。
    mocks.holidayAdjustmentDay.createMany.mockRejectedValue(
      Object.assign(new Error('date/time field value out of range')),
    );

    const res = await put(YEAR_2027);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ rejectedBy: 'database' });
    // 开过事务 = 回滚由 Prisma 负责。这一条把"我们是走事务写的，不是三条裸 SQL"钉住。
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
  });

  it('🔴 顺序：年度行先写（外键的父行），再删旧逐日行，最后灌新行', async () => {
    await put(YEAR_2027);
    const order = [
      mocks.holidayAdjustmentYear.upsert,
      mocks.holidayAdjustmentDay.deleteMany,
      mocks.holidayAdjustmentDay.createMany,
    ].map((m) => m.mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // 逐日行按**年**整体删：这是"整年替换"而不是"合并"的载体（撤销某天的安排只有这一条路）。
    expect(mocks.holidayAdjustmentDay.deleteMany).toHaveBeenCalledWith({ where: { year: 2027 } });
  });

  it('`isoToDayColumn` 真的被用上：写库的 day 是 **UTC 零点**的 Date', async () => {
    await put(YEAR_2027);
    const data = mocks.holidayAdjustmentDay.createMany.mock.calls[0]![0].data as {
      day: Date;
      isOffDay: boolean;
      year: number;
    }[];
    expect(data[0]!.day.getTime()).toBe(Date.UTC(2027, 0, 1));
    expect(data[1]!.day.getTime()).toBe(Date.UTC(2027, 0, 2));
    expect(data.map((d) => d.year)).toEqual([2027, 2027]);
  });
});

describe('DELETE 撤销某一年', () => {
  it('合法年份 ⇒ 200 + 按年 deleteMany（逐日行靠 CASCADE 一起走）', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/holiday-adjustments/years?year=2027',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.holidayAdjustmentYear.deleteMany).toHaveBeenCalledWith({ where: { year: 2027 } });
  });

  it('本来就没录过（deleted=0）⇒ **幂等成功**，不是 404', async () => {
    mocks.holidayAdjustmentYear.deleteMany.mockResolvedValue({ count: 0 });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/holiday-adjustments/years?year=2099',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, deleted: 0 });
  });

  it('缺 year / 非数字 ⇒ 400 且不删', async () => {
    for (const url of [
      '/api/admin/holiday-adjustments/years',
      '/api/admin/holiday-adjustments/years?year=abc',
    ]) {
      const res = await app.inject({ method: 'DELETE', url, headers: AUTH });
      expect(res.statusCode, url).toBe(400);
    }
    expect(mocks.holidayAdjustmentYear.deleteMany).not.toHaveBeenCalled();
  });

  it('🔴 多带一个键 ⇒ 400（`z.strictObject` 在守这条路：写请求里"收了但忽略"是最难查的）', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/holiday-adjustments/years?year=2027&force=true',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.holidayAdjustmentYear.deleteMany).not.toHaveBeenCalled();
  });
});
