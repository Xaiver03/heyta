/**
 * 调休/补班（公共事实）的线协议契约 —— **唯一一份**。W4b。
 *
 * ## 为什么这个形状必须两端共用
 *
 * `server` 只依赖 `@heyta/domain` / `@heyta/shared-schema` / `@heyta/sync-core`
 *（实测 `server/package.json`），而 `@heyta/app-host` 依赖本包但**没有 zod**
 *（`packages/app-host/package.json`）—— 所以校验函数只能从本包导出，
 * 与 `account-profile-contract.ts` 文件头讲的是同一件事。
 * 两边各写一份的结局仓库里已经吃过：§3.5 那条「同一个判断抄三遍，漂移就从那里开始」。
 *
 * ## 🔴 这是 heyta 第一条**匿名只读**的服务端→客户端内容通道
 *
 * 定性见 [ADR-0050](../../docs/adr/0050-public-facts-are-deployer-supplied.md)：
 * 它下发的是**公共事实**（哪天上班、哪天放假 + 公告原文出处），不是用户数据，
 * 因此 AGENTS §1 那句「云端不是事实源」**不约束它** —— 那句话讲的是用户数据。
 *
 * ## 为什么形状被钉成 `days[]` 这一种
 *
 * 判据③（非法日期 / `isOffDay` 不是布尔）**必须**能拒绝录入，而 `Json` 列在库层
 * 拦不住这两件事。所以这份契约同时是三样东西：
 *
 * 1. 服务端 zod 校验的唯一规则来源（`server/src/admin` 的 POST 用它）；
 * 2. 公开 GET 响应体的唯一形状来源；
 * 3. `pnpm check:public-facts` 的**被检查对象** —— 那条门禁读的就是本文件的
 *    `PUBLIC_FACT_SHAPES`，往这里加第二种形状会让它红。
 *
 * ⚠️ `papers` 是**出处**不是可选项：没有 gov.cn 原文链接的节假日数据不能进库
 *（`scripts/vendor/holiday-cn/load.mjs:52` 对随包数据立的就是这条规矩，
 *  运营录入没有理由比抓取更宽松 —— 见下面 `holidayAdjustmentYearSchema`）。
 */

import { z } from 'zod';

/**
 * 相对服务端根的路径（与 `ACCOUNT_PROFILE_PATHS` 同形状，不带 `/api` 前缀）。
 *
 * 🔴 公开那条**没有** `:id` / `?userId=` 之类的形态 —— 它不带任何身份维度。
 * 「按用户下发不同的公共事实」一旦成为可能，"这不是用户数据"那句定性就作废了。
 */
export const HOLIDAY_ADJUSTMENT_PATHS = {
  /** `GET` 全量公共事实。匿名、只读、可缓存。注册在 `/api` 前缀下。 */
  public: 'holiday-adjustments',
  /** 后台读当前已录入的年度与逐日表（注册在 `/api/admin` 前缀下）。 */
  adminList: 'holiday-adjustments',
  /** 后台整年写入（PUT 一个年 = 该年逐日表被**整体替换**，见 `holidayYearPutSchema`）。 */
  adminPut: 'holiday-adjustments/years',
} as const;

/**
 * 日期的**形状**：`YYYY-MM-DD`。与随包数据唯一读取入口 `load.mjs:29` 的 `DATE_RE` 逐字相同。
 *
 * ⚠️ 它只拦形状。`2026-02-30` 匹配这条正则但不是那一天 ⇒ 还要过
 * {@link isRealCalendarDay}。两层都在本文件里，缺一层就会出现
 * "库里存着 2 月 30 日、界面永远不显示它"那种静默的错。
 */
export const HOLIDAY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 这个 `YYYY-MM-DD` 是不是**真实存在的那一天**。
 *
 * 做法是构造再回读：`new Date(2026, 1, 30)` 会被 JS 静默归一到 `2026-03-02`，
 * 所以判据是"归一之后的年月日还等于输入"。
 *
 * 🔴 为什么不用 `parseLocalDate`（`@heyta/domain`）：本包不依赖 domain
 *（依赖方向是 domain ← 上层，而 shared-schema 在最底下），而且这条校验
 * 要在服务端也用，服务端虽然依赖 domain，但把契约建立在查询层之上会绕一圈。
 * 代价就是这里有一份 4 行的实现 —— 它不含任何业务判断，只是一个历法事实。
 */
export const isRealCalendarDay = (value: string): boolean => {
  if (!HOLIDAY_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return (
    date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
  );
};

/**
 * 可录入的年份区间：**2007 – 2100**。
 *
 * 下界是随包数据的下界（国务院公告机器可读版从 2007 年开始），上界是
 * 历法层的上界（`packages/domain` 的月表只铺到农历 2100 年，见 `lunar.ts`）。
 *
 * 🔴 **不许写成一个更大的数"以防万一"**：区间外的年份被拒时界面是安静降级的，
 * 而如果放开区间，运营录进一条 2200 年的数据，客户端会拿到一个
 * 没有任何历法层能解释它的年份 —— 症状是日历上某天标了"班"而那天是星期几都算不出。
 */
export const HOLIDAY_ADJUSTMENT_YEAR_MIN = 2007;
export const HOLIDAY_ADJUSTMENT_YEAR_MAX = 2100;

/**
 * 一年的逐日安排最多几条。
 *
 * 由被约束的常量推导，不是拍的：法定假日 + 补班日一年最多三十几天，
 * 而 `2100 - 2007 = 93` 年 × 40 ≈ 3720 条是"一次把整个区间灌进来"的上限。
 * 400 比它小、比真实需要大一个数量级 ⇒ 超了就是录错了（或者有人在拿这个接口
 * 传别的东西）。**上限存在的意义是把"形状不对"变成一次拒绝，而不是一次截断。**
 */
export const HOLIDAY_ADJUSTMENT_MAX_DAYS_PER_YEAR = 400;

/** 公告原文链接的最少条数。**0 条 = 没有出处 = 不收**（见文件头）。 */
export const HOLIDAY_ADJUSTMENT_MIN_PAPERS = 1;
/** 最多几条：一年最多发两三次调整通知，32 是十几倍余量。 */
export const HOLIDAY_ADJUSTMENT_MAX_PAPERS = 32;

/**
 * 公告原文链接：**只允许 `http:` / `https:`**。
 *
 * 🔴 不是可选的加固，是实测逼出来的：`z.string().url()` **接受**
 * `javascript:alert(1)`（它是合法 URL scheme，实测 `safeParse().success === true`）。
 * 而 `papers` 这个字段的全部用途就是**在后台被渲染成可点的 `<a href>`**（判据②
 * 要的"举证入口"）—— 于是一个能录入调休数据的账号，只要把链接换成
 * `javascript:`，就在管理后台里拿到了执行上下文。
 * 后台是 `is_admin` 才进得来的面，但那正是它更不该被这样穿透的理由。
 *
 * 随包那份数据没有这个问题（`load.mjs` 只验非空，但它读的是我们自己 vendor 的文件），
 * 而运营录入读的是**人贴进来的字符串**。
 */
export const HOLIDAY_PAPER_PROTOCOLS = ['http:', 'https:'] as const;

export const isHttpPaperUrl = (value: string): boolean => {
  try {
    return (HOLIDAY_PAPER_PROTOCOLS as readonly string[]).includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** 一条逐日安排：这一天是**放假**（`isOffDay: true`）还是**补班**（`false`）。 */
export const holidayAdjustmentDaySchema = z.object({
  day: z
    .string()
    .refine(isRealCalendarDay, '不是真实存在的日期（形状必须是 YYYY-MM-DD，且那一天存在）'),
  /**
   * 🔴 **必须是布尔**，不接受 `0/1`、`"true"`、`null`。
   *
   * 这不是洁癖：`isOffDay` 就是"休还是班"这一个位，任何 truthy 值都会被
   * 服务端存成 `true` 而把补班日**变成放假日** —— 那是界面在说谎，
   * 而且是往用户日历上说"这天休息"的谎。`load.mjs:62` 对抓取来的数据立的
   * 是同一条规矩。
   */
  isOffDay: z.boolean(),
});

/** 一个年度的录入：出处 + 逐日表。 */
export const holidayAdjustmentYearSchema = z
  .object({
    year: z
      .number()
      .int('year 必须是整数')
      .min(HOLIDAY_ADJUSTMENT_YEAR_MIN, `year 不得早于 ${HOLIDAY_ADJUSTMENT_YEAR_MIN}`)
      .max(HOLIDAY_ADJUSTMENT_YEAR_MAX, `year 不得晚于 ${HOLIDAY_ADJUSTMENT_YEAR_MAX}`),
    papers: z
      .array(
        z
          .string()
          .min(1)
          .refine(isHttpPaperUrl, 'papers 必须是 http/https 的完整 URL（后台会把它们渲染成链接）'),
      )
      .min(HOLIDAY_ADJUSTMENT_MIN_PAPERS, 'papers 不能为空：没有出处的节假日数据不能进库')
      .max(HOLIDAY_ADJUSTMENT_MAX_PAPERS, `papers 最多 ${HOLIDAY_ADJUSTMENT_MAX_PAPERS} 条`),
    days: z
      .array(holidayAdjustmentDaySchema)
      .min(1, 'days 不能为空数组：一年都没有安排就不要录这一年')
      .max(HOLIDAY_ADJUSTMENT_MAX_DAYS_PER_YEAR, `days 最多 ${HOLIDAY_ADJUSTMENT_MAX_DAYS_PER_YEAR} 条`),
  })
  /**
   * 🔴 **同一天不许出现两次**。
   *
   * 逐日表的主键是 `day`，所以库里物理上装不下两条 —— 但**校验必须发生在写库之前**，
   * 否则症状是整年录入失败（或更糟：后一条覆盖前一条，运营看到的是"存成功了"，
   * 而客户端拿到的是被悄悄改掉的那一半）。
   * 判据④「覆盖里日期非法就**整年拒绝**、不接受半套数据」要求的正是这种
   * "要么全收、要么全不收"，它在契约层就得成立。
   */
  .refine(
    (value) => new Set(value.days.map((d) => d.day)).size === value.days.length,
    '同一天不许出现两次（既休又补班没有意义，而"两次里取哪一次"没有任何一层能替你决定）',
  )
  /** `year` 与 `days[]` 里的年份不许对不上（录入时把 2026 的行放进 2027 年那一条）。 */
  .refine(
    (value) => value.days.every((d) => Number(d.day.slice(0, 4)) === value.year),
    'days[] 里的日期必须都属于 year 那一年（跨年会同时进两张年，谁覆盖谁说不清）',
  );

/** `PUT /api/admin/holiday-adjustments/years` 的请求体：**一次一个年度，整年替换**。 */
export const holidayYearPutSchema = holidayAdjustmentYearSchema;

/** 公开 GET 的响应体，也是本地缓存落盘的形状。 */
export const holidayAdjustmentsResponseSchema = z.object({
  /**
   * 这份数据的版本令牌（`W/<max(updated_at)>-<年份数>`，服务端算）。
   * 客户端把它当 `If-None-Match` 回传，命中就 304、连 body 都不发。
   * 形状自己定的理由在 ADR-0050 §4（照 `PriceVersion` 那种"版本号是数据的一部分"的做法）。
   */
  version: z.string().min(1),
  /** 升序、无重复年份。服务端排好序 —— 两端各排一次就会有两种顺序。 */
  years: z.array(holidayAdjustmentYearSchema),
});

/** 后台 GET 的响应体：公开那份 + 运营要看的管理侧元信息。 */
export const holidayAdjustmentsAdminListSchema = z.object({
  version: holidayAdjustmentsResponseSchema.shape.version,
  years: z.array(
    holidayAdjustmentYearSchema.extend({
      /** 这一版是谁、什么时候写的（回显到后台表格里，追责与回滚都要它）。 */
      updatedAt: z.number(),
      updatedBy: z.string().nullable(),
      /** 库里实际行数，用来核对"界面显示的条数 == 存进去的条数"。 */
      dayCount: z.number().int(),
    }),
  ),
});

/**
 * 🔴 门禁（`scripts/check-public-facts.mjs`）的**被检查对象**：
 * 这条通道今天只允许一种形状 —— `days[]`。
 *
 * 写在这里而不是写在门禁的字符串里，是为了让它成为**类型上可读的事实**：
 * 后来人想往公共事实里塞第二种载荷（"顺便把节日名也下发吧"），
 * 就必须同时改这张表和 `holidayAdjustmentsResponseSchema`，
 * 而门禁会验"表里每一项都能在契约里找到、且契约里没有表外的项"。
 * 两边都对不上时它红 —— 见那条门禁的三条臂与变异清单。
 */
export const PUBLIC_FACT_SHAPES = [
  {
    id: 'holiday-adjustments',
    path: `/api/${HOLIDAY_ADJUSTMENT_PATHS.public}`,
    /** 逐字形状：外层键 → 年度键 → 逐日键。新增任何一个都必须过 ADR。 */
    keys: {
      root: ['version', 'years'],
      year: ['year', 'papers', 'days'],
      day: ['day', 'isOffDay'],
    },
  },
] as const;

export type HolidayAdjustmentDay = z.infer<typeof holidayAdjustmentDaySchema>;
export type HolidayAdjustmentYear = z.infer<typeof holidayAdjustmentYearSchema>;
export type HolidayAdjustmentsResponse = z.infer<typeof holidayAdjustmentsResponseSchema>;
