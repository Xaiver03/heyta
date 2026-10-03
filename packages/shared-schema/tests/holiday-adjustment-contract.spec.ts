import { describe, expect, it } from 'vitest';
import {
  HOLIDAY_ADJUSTMENT_MAX_DAYS_PER_YEAR,
  HOLIDAY_ADJUSTMENT_NOTE_MAX_CHARS,
  HOLIDAY_ADJUSTMENT_PATHS,
  HOLIDAY_ADJUSTMENT_YEAR_MAX,
  HOLIDAY_ADJUSTMENT_YEAR_MIN,
  PUBLIC_FACT_SHAPES,
  holidayAdjustmentAdminDeleteQuerySchema,
  holidayAdjustmentDaySchema,
  holidayAdjustmentYearSchema,
  holidayAdjustmentsResponseSchema,
  holidayYearPutSchema,
  isRealCalendarDay,
} from '../src/holiday-adjustment-contract';

/**
 * 调休/补班契约（W4b）。
 *
 * 这份文件保护的不是"校验写对了"，而是**判据③在两层里都真的会拒绝**：
 *
 * | 想塞进来的东西 | 谁拦 |
 * |---|---|
 * | `'2026-13-01'`（形状对但月份不存在） | 这里 `isRealCalendarDay` + 库层 `day DATE` |
 * | `'2026-02-30'`（正则放过的那一天） | 这里 `isRealCalendarDay` + 库层 `day DATE` |
 * | `isOffDay: 1` / `'true'` / `null` | 这里 `z.boolean()` + 库层 `is_off_day BOOLEAN NOT NULL` |
 * | `papers: []`（没有出处的数据） | 这里 `.min(1)`（与随包 `load.mjs:52` 同一条规矩） |
 * | 同一天两条（一条休一条班） | 这里 `.refine` + 库层 `PRIMARY KEY ("day")` |
 *
 * 🔴 两层各拦一次是**有意的重复**，不是没清理干净：
 * 只有 zod ⇒ 有人绕过路由直接写库（迁移、脚本、运维手滑）就没人拦；
 * 只有库 ⇒ 报错发生在 `INSERT` 那一刻，运营看到的是一句 `Failed to load`，
 * 而不是"2 月 30 日不存在"。
 *
 * 判据④「覆盖里日期非法就**整年拒绝**」也在这里成立：一次 PUT 就是一个年度，
 * 而年度 schema 是**一个整体** —— 它下面没有"先收能收的那几条"这条路。
 */

const YEAR_2027 = {
  year: 2027,
  papers: ['https://www.gov.cn/gongbao/content/2026/content_0000000.htm'],
  days: [
    { day: '2027-01-01', isOffDay: true },
    { day: '2027-01-02', isOffDay: false },
  ],
};

describe('isRealCalendarDay：正则拦不住的那一层', () => {
  it('真实存在的日子过', () => {
    for (const d of ['2027-01-01', '2028-02-29', '2026-12-31', '2100-02-28']) {
      expect(isRealCalendarDay(d), d).toBe(true);
    }
  });

  it('🔴 形状对但不存在的日子拒（这一条是 `DATE_RE` 单独拦不掉的）', () => {
    for (const d of ['2026-02-30', '2026-13-01', '2027-02-29', '2026-04-31', '2026-00-10']) {
      expect(isRealCalendarDay(d), d).toBe(false);
    }
  });

  it('形状不对的一律拒（不靠归一化）', () => {
    for (const d of ['2026-1-1', '26-01-01', '2026/01/01', '', '2026-01-01T00:00:00']) {
      expect(isRealCalendarDay(d), d).toBe(false);
    }
  });

  it('2 月 29 日只闰年过（这一条最容易写错成"永远过"）', () => {
    expect(isRealCalendarDay('2028-02-29')).toBe(true);
    expect(isRealCalendarDay('2027-02-29')).toBe(false);
    // 世纪年：能被 400 整除才闰。`%4` 那种近似会把 1900/2100 判错。
    expect(isRealCalendarDay('2000-02-29')).toBe(true);
  });
});

describe('holidayAdjustmentDaySchema：一条逐日安排', () => {
  it('两个合法值', () => {
    expect(holidayAdjustmentDaySchema.safeParse({ day: '2027-01-01', isOffDay: true }).success).toBe(
      true,
    );
    expect(
      holidayAdjustmentDaySchema.safeParse({ day: '2027-01-01', isOffDay: false }).success,
    ).toBe(true);
  });

  it('🔴 `isOffDay` 不是布尔 ⇒ 拒（判据③的一半）', () => {
    for (const bad of [1, 0, 'true', 'false', null, undefined, {}, []]) {
      const res = holidayAdjustmentDaySchema.safeParse({ day: '2027-01-01', isOffDay: bad });
      expect(res.success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('🔴 日期非法 ⇒ 拒（判据③的另一半）', () => {
    for (const bad of ['2027-02-30', '2027-13-01', 'yesterday', '2027/01/01', '']) {
      expect(holidayAdjustmentDaySchema.safeParse({ day: bad, isOffDay: true }).success, bad).toBe(
        false,
      );
    }
  });

  it('多余字段被 zod **剥离**而不是拒绝 —— 所以"只有一种形状"不能靠 schema 拦', () => {
    // 这条不是在夸这个行为，是在**登记**它：往逐日里加 `name` 不会报错，
    // 它只是静悄悄地消失（实测 `success === true` 而输出里没有 `name`）。
    // 所以真正的守门人是下面那组 `PUBLIC_FACT_SHAPES` 的对账，不是这里。
    // 写成断言而不是注释，是因为有人会以为"schema 会拒多余字段"从而不去加门禁。
    const res = holidayAdjustmentDaySchema.safeParse({
      day: '2027-01-01',
      isOffDay: true,
      name: '元旦',
    });
    expect(res.success).toBe(true);
    if (res.success) expect(Object.keys(res.data).sort()).toEqual(['day', 'isOffDay']);
  });
});

describe('holidayAdjustmentYearSchema：一个年度 = 一个整体', () => {
  it('一份合法录入过', () => {
    expect(holidayAdjustmentYearSchema.safeParse(YEAR_2027).success).toBe(true);
  });

  it('🔴 `papers` 为空 ⇒ 拒（没有出处的节假日数据不能进库）', () => {
    expect(holidayAdjustmentYearSchema.safeParse({ ...YEAR_2027, papers: [] }).success).toBe(false);
  });

  it('🔴 `javascript:` / `data:` 这类"合法 URL 但不是网页"⇒ 拒（实测 `z.string().url()` 会放过前者）', () => {
    // `papers` 唯一的用途是在后台被渲染成 <a href>（判据②的举证入口）。
    // 放过 `javascript:` 等于"能录调休数据 = 能在管理后台执行脚本"。
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
    ]) {
      expect(
        holidayAdjustmentYearSchema.safeParse({ ...YEAR_2027, papers: [bad] }).success,
        bad,
      ).toBe(false);
    }
  });

  it('http 与 https 都收（自托管部署的公告可能就在内网 http 上）', () => {
    for (const good of [
      'https://www.gov.cn/zhengce/content/2026-11/01/content_0.htm',
      'http://192.168.1.10/gongbao/2027.html',
    ]) {
      expect(
        holidayAdjustmentYearSchema.safeParse({ ...YEAR_2027, papers: [good] }).success,
        good,
      ).toBe(true);
    }
  });

  it('papers 不是完整 URL ⇒ 拒', () => {
    for (const bad of ['gov.cn/xxx', 'javascript:alert(1)', 'www.gov.cn', '']) {
      expect(holidayAdjustmentYearSchema.safeParse({ ...YEAR_2027, papers: [bad] }).success, bad).toBe(
        false,
      );
    }
  });

  it('🔴 同一天出现两次 ⇒ 整年拒（不接受"后一条覆盖前一条"）', () => {
    const dup = {
      ...YEAR_2027,
      days: [
        { day: '2027-01-01', isOffDay: true },
        { day: '2027-01-01', isOffDay: false },
      ],
    };
    const res = holidayAdjustmentYearSchema.safeParse(dup);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]!.message).toContain('同一天');
  });

  it('🔴 日期跨年 ⇒ 整年拒（否则同一天会同时进两张年，谁覆盖谁说不清）', () => {
    expect(
      holidayAdjustmentYearSchema.safeParse({
        ...YEAR_2027,
        days: [{ day: '2026-12-31', isOffDay: true }],
      }).success,
    ).toBe(false);
  });

  it('days 空数组 ⇒ 拒（"这一年一条安排都没有"应当不录，而不是录一个空壳）', () => {
    expect(holidayAdjustmentYearSchema.safeParse({ ...YEAR_2027, days: [] }).success).toBe(false);
  });

  it('year 越界 ⇒ 拒，且边界值本身过', () => {
    expect(
      holidayAdjustmentYearSchema.safeParse({ ...YEAR_2027, year: 2006 }).success,
    ).toBe(false);
    expect(
      holidayAdjustmentYearSchema.safeParse({
        ...YEAR_2027,
        year: 2101,
        days: [{ day: '2101-01-01', isOffDay: true }],
      }).success,
    ).toBe(false);
    expect(
      holidayAdjustmentYearSchema.safeParse({
        ...YEAR_2027,
        year: HOLIDAY_ADJUSTMENT_YEAR_MIN,
        days: [{ day: `${String(HOLIDAY_ADJUSTMENT_YEAR_MIN)}-01-01`, isOffDay: true }],
      }).success,
    ).toBe(true);
    expect(
      holidayAdjustmentYearSchema.safeParse({
        ...YEAR_2027,
        year: HOLIDAY_ADJUSTMENT_YEAR_MAX,
        days: [{ day: `${String(HOLIDAY_ADJUSTMENT_YEAR_MAX)}-12-31`, isOffDay: false }],
      }).success,
    ).toBe(true);
  });

  it('year 不是整数 ⇒ 拒（`2027.5` 会同时进两张年）', () => {
    expect(holidayAdjustmentYearSchema.safeParse({ ...YEAR_2027, year: 2027.5 }).success).toBe(
      false,
    );
  });

  it('days 条数超过上限 ⇒ 拒', () => {
    const days = Array.from({ length: HOLIDAY_ADJUSTMENT_MAX_DAYS_PER_YEAR + 1 }, (_unused, i) => ({
      day: `2027-01-${String(i % 28 + 1).padStart(2, '0')}`,
      isOffDay: true,
    }));
    expect(holidayAdjustmentYearSchema.safeParse({ ...YEAR_2027, days }).success).toBe(false);
  });
});

describe('holidayAdjustmentsResponseSchema：公开 GET 的形状', () => {
  it('合法响应过', () => {
    expect(
      holidayAdjustmentsResponseSchema.safeParse({ version: 'W/1-1', years: [YEAR_2027] }).success,
    ).toBe(true);
  });

  it('空 years 过 —— 这是**自托管没录任何一年**的正常形态，不是错误', () => {
    expect(holidayAdjustmentsResponseSchema.safeParse({ version: 'W/0-0', years: [] }).success).toBe(
      true,
    );
  });

  it('缺 version ⇒ 拒（缓存语义的前提是每份数据都带版本）', () => {
    expect(holidayAdjustmentsResponseSchema.safeParse({ years: [] }).success).toBe(false);
  });

  it('years 不是数组 ⇒ 拒', () => {
    expect(holidayAdjustmentsResponseSchema.safeParse({ version: 'W/1', years: {} }).success).toBe(
      false,
    );
  });
});

/**
 * 🔴 这一组是 `scripts/check-public-facts.mjs` 那条门禁的**另一半年**。
 *
 * 门禁拿 `PUBLIC_FACT_SHAPES` 里的字面量与 zod schema 的实际 shape 对账；
 * 这里反过来钉"表里的每一项都能从契约里取出来，且取出来的键集合逐字相等"。
 * 两边都写死，是为了让"往公共事实加一个键"必须**同时改三处**才能变绿 ——
 * 而改三处的成本就是那条定性的守门人。
 */
describe('PUBLIC_FACT_SHAPES 与契约必须逐字相等', () => {
  it('今天只有一种形状走这条通道', () => {
    expect(PUBLIC_FACT_SHAPES).toHaveLength(1);
    expect(PUBLIC_FACT_SHAPES[0]!.id).toBe('holiday-adjustments');
    expect(PUBLIC_FACT_SHAPES[0]!.path).toBe(`/api/${HOLIDAY_ADJUSTMENT_PATHS.public}`);
  });

  it('root / year / day 三层键集合与 schema 实际 shape 相等', () => {
    const rootKeys = Object.keys(holidayAdjustmentsResponseSchema.shape).sort();
    expect(rootKeys).toEqual([...PUBLIC_FACT_SHAPES[0]!.keys.root].sort());

    const yearKeys = Object.keys(holidayAdjustmentYearSchema.shape).sort();
    expect(yearKeys).toEqual([...PUBLIC_FACT_SHAPES[0]!.keys.year].sort());

    const dayKeys = Object.keys(holidayAdjustmentDaySchema.shape).sort();
    expect(dayKeys).toEqual([...PUBLIC_FACT_SHAPES[0]!.keys.day].sort());
  });

  it('公开路径与后台路径是**两条不同**的路径（公共事实那条不带身份维度）', () => {
    expect(HOLIDAY_ADJUSTMENT_PATHS.public).toBe('holiday-adjustments');
    expect(HOLIDAY_ADJUSTMENT_PATHS.adminPut).not.toBe(HOLIDAY_ADJUSTMENT_PATHS.public);
  });

  it('🔴 PUT 与 DELETE 都不许出现 `:id` / `:year` 这类**路径参数**形态', () => {
    // 理由在 `HOLIDAY_ADJUSTMENT_PATHS.adminDelete` 那段注释里：年份一旦同时住在
    // 路径与载荷两处，就得再写一条"两边必须一致"的守卫，而漏写那条守卫是**静默**的。
    // 这一条把"只有一个来源"钉成形状事实 —— 有人改成 `/years/:year` 时这里先红。
    for (const value of Object.values(HOLIDAY_ADJUSTMENT_PATHS)) {
      expect(value, `路径 ${value} 不该带路径参数`).not.toMatch(/:[A-Za-z]/);
    }
  });
});

/**
 * `holidayYearPutSchema`（后台写的那一份）。
 *
 * 🔴 这一组保护的是**"两份 schema 共用一套规则"这个决定本身**。
 * 它之所以被拆成两份（而不是 `.extend()`），是因为 `.refine()` 之后拿不到 `.shape`
 * 那种可组合的对象（实测 zod 4），于是两条年度级规则要靠具名谓词各调一次。
 * "各调一次"的正确性不是自明的：漏掉第二处调用，症状是
 * **PUT 能收下一份公开面形状不认的数据** —— 写进去了、GET 时 `safeParse` 拒掉、
 * 于是那条通道整个坏掉，而坏的位置离错的位置隔了两个包。
 * 所以下面那两条"PUT 也拦"的用例是这一拆分的**承重判据**。
 */
describe('holidayYearPutSchema：后台写入的那一份', () => {
  it('合法录入过（note 可给可不给 —— §3.3：新字段一律可选）', () => {
    expect(holidayYearPutSchema.safeParse(YEAR_2027).success).toBe(true);
    expect(holidayYearPutSchema.safeParse({ ...YEAR_2027, note: '据 11 月调整公告' }).success).toBe(
      true,
    );
    expect(holidayYearPutSchema.safeParse({ ...YEAR_2027, note: null }).success).toBe(true);
  });

  it('🔴 与公开那份的差别**只有** `note`（多一项就有人在往匿名面下发运营内部措辞）', () => {
    const putKeys = Object.keys(holidayYearPutSchema.shape).sort();
    const publicKeys = Object.keys(holidayAdjustmentYearSchema.shape).sort();
    expect(putKeys).toEqual([...publicKeys, 'note'].sort());
    expect(publicKeys).not.toContain('note');
  });

  it('🔴 年度级规则在 PUT 这一份里**同样**生效：同一天两条 ⇒ 拒', () => {
    expect(
      holidayYearPutSchema.safeParse({
        ...YEAR_2027,
        days: [
          { day: '2027-01-01', isOffDay: true },
          { day: '2027-01-01', isOffDay: false },
        ],
      }).success,
    ).toBe(false);
  });

  it('🔴 年度级规则在 PUT 这一份里**同样**生效：跨年 ⇒ 拒', () => {
    expect(
      holidayYearPutSchema.safeParse({
        ...YEAR_2027,
        days: [{ day: '2026-12-31', isOffDay: true }],
      }).success,
    ).toBe(false);
  });

  it('`note` 有上界（列类型是无长度 TEXT，而它会被后台渲染成文本）', () => {
    expect(
      holidayYearPutSchema.safeParse({ ...YEAR_2027, note: 'x'.repeat(HOLIDAY_ADJUSTMENT_NOTE_MAX_CHARS) })
        .success,
    ).toBe(true);
    expect(
      holidayYearPutSchema.safeParse({
        ...YEAR_2027,
        note: 'x'.repeat(HOLIDAY_ADJUSTMENT_NOTE_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
  });

  it('`note` 不许是对象/数组（`nullish` 不等于"什么都能收"）', () => {
    expect(holidayYearPutSchema.safeParse({ ...YEAR_2027, note: { a: 1 } }).success).toBe(false);
    expect(holidayYearPutSchema.safeParse({ ...YEAR_2027, note: ['a'] }).success).toBe(false);
    expect(holidayYearPutSchema.safeParse({ ...YEAR_2027, note: 42 }).success).toBe(false);
  });

  it('判据③那两条在 PUT 这一份里也拦得住（录入面才是它们真正的入口）', () => {
    expect(holidayYearPutSchema.safeParse({ ...YEAR_2027, days: [{ day: '2027-02-30', isOffDay: true }] }).success).toBe(false);
    expect(holidayYearPutSchema.safeParse({ ...YEAR_2027, days: [{ day: '2027-01-01', isOffDay: 1 }] }).success).toBe(false);
    expect(holidayYearPutSchema.safeParse({ ...YEAR_2027, papers: [] }).success).toBe(false);
    // `javascript:` 那条是后台 XSS 的入口：`papers` 唯一的用途就是被渲染成 `<a href>`。
    expect(
      holidayYearPutSchema.safeParse({ ...YEAR_2027, papers: ['javascript:alert(1)'] }).success,
    ).toBe(false);
  });
});

/**
 * `DELETE` 的查询串。
 *
 * 它只有 `year` 一项，所以这组断言看着像摆设 —— 它守的是**"不接受别的东西"**：
 * 有人后来给它加一个 `force: true` 或 `userId=` 时，这里会红，
 * 而那条通道今天全部的正当性就在于它不带身份维度（ADR-0052 §2.1）。
 */
describe('holidayAdjustmentAdminDeleteQuerySchema', () => {
  it('合法的年份过', () => {
    expect(holidayAdjustmentAdminDeleteQuerySchema.safeParse({ year: '2027' }).success).toBe(true);
    expect(holidayAdjustmentAdminDeleteQuerySchema.safeParse({ year: 2027 }).success).toBe(true);
  });

  it('缺 year / 非数字 ⇒ 拒', () => {
    expect(holidayAdjustmentAdminDeleteQuerySchema.safeParse({}).success).toBe(false);
    expect(holidayAdjustmentAdminDeleteQuerySchema.safeParse({ year: 'abc' }).success).toBe(false);
  });

  it('🔴 除 `year` 外**不接受任何键**（写操作里多一个可选键 = 多一个会被绕开的分支）', () => {
    // 这一条要求 schema 是 `z.strictObject`（默认 `z.object` 会**静默剥掉**未知键，
    // 于是"不接受"变成"收了但当作没看见" —— 后者在写路径上尤其糟：
    // 运营传了 `force: true` 收到 200，会以为真的强制了）。
    expect(
      holidayAdjustmentAdminDeleteQuerySchema.safeParse({ year: 2027, force: true }).success,
    ).toBe(false);
    const keys = Object.keys(holidayAdjustmentAdminDeleteQuerySchema.shape);
    expect(keys, '这一项是封闭清单：加键要先想清楚它是不是身份维度').toEqual(['year']);
  });
});
