/**
 * 调休/补班（公共事实）的**读写层**：两张表 ⇄ `@heyta/shared-schema` 那份契约。
 * =============================================================================
 *
 * W4b。这是 `server/src/holidays/day-column.ts` 的**唯一 importer** ——
 * 那个文件写了一张"UTC+8 / UTC-5 才现形"的对照表，而一张没人读的抄表
 * 就是 AGENTS §3.5 记过的那个错（`ids.ts` 抽出来了、旧的那份从没删掉）。
 * 换算只许住在那一个文件里，本层的每一次读与写都从它走。
 *
 * ## 为什么校验要在这里**再跑一次**（库层已经有一张 CHECK 网了）
 *
 * 三层各有各拦得住的东西，实测矩阵在
 * `server/tests/holiday-adjustment-migration.pglite.spec.ts`：
 *
 * | 坏输入 | 契约（zod） | 库（`DATE` / `BOOLEAN` / CHECK） |
 * |---|---|---|
 * | `'tomorrow'` | 拒 | ⚠️ **收**（弹性日期解析，它按会话日期算出一个真日子） |
 * | `'yes'` 冒充布尔 | 拒 | ⚠️ **收**（Postgres 的 boolean 输入解析很宽） |
 * | `2027-02-30` | 拒 | 拒（22007 out of range） |
 * | `isOffDay: 1` | 拒 | 拒（expression is of type integer） |
 *
 * 所以写入路径**必须**过 `holidayYearPutSchema` —— 少了它，`'tomorrow'` 会带着
 * 一个错误的日期静默入库，而那条日期在界面上永远对不上任何人。
 *
 * ## 🔴 「一年不许零条安排」为什么在**这里**而不可能在库里
 *
 * 迁移文件末尾写了那条约束表达不了（Postgres 的 CHECK 不许含子查询，跨表计数要触发器）。
 * 它的载体就是 {@link replaceHolidayAdjustmentYear}：一个 `$transaction` 里
 * upsert 年度行 → 删该年逐日行 → 灌新逐日行，**任何一步失败整体回滚**
 * ⇒ 库里不可能出现"年度行存在但一条安排都没有"。
 * 判据在 `server/tests/holiday-admin-routes.spec.ts` 的「部分失败不留半成品」那条。
 */

import {
  HOLIDAY_ADJUSTMENT_PATHS,
  HOLIDAY_ADJUSTMENT_YEAR_MAX,
  HOLIDAY_ADJUSTMENT_YEAR_MIN,
  holidayYearPutSchema,
  type HolidayAdjustmentDay,
  type HolidayAdjustmentsResponse,
  type HolidayAdjustmentYear,
} from '@heyta/shared-schema';
import type { PrismaClient } from '@prisma/client';

import { prisma } from '../db';
import { dayColumnToIso, isoToDayColumn } from './day-column';

/**
 * 本层用到的那部分 Prisma 面。
 *
 * 做成一个类型别名而不是直接写 `PrismaClient`：测试要把 `prisma` 换成一份桩，
 * 而 `PrismaClient` 有上百个 model —— 用 `Pick<>` 之后"桩只需要这三样"是**编译器**
 * 告诉我的，不是我写在注释里的承诺（那份承诺会在下一次加 model 时悄悄过期）。
 */
export type HolidayDb = Pick<PrismaClient, 'holidayAdjustmentYear' | 'holidayAdjustmentDay'> &
  Pick<PrismaClient, '$transaction'>;

/**
 * 公开 GET 一次最多返回多少个年度。
 *
 * 🔴 **从被约束的常量推导，不是拍的**：录入区间是 `HOLIDAY_ADJUSTMENT_YEAR_MIN–MAX`
 *（契约与库里的 CHECK 各钉了一遍），所以库里物理上最多 `MAX - MIN + 1 = 94` 个年度。
 *
 * ⚠️ 因此这一项**不是**一个限流旋钮 —— 它是一个拦不住任何真实数据的上界。
 * 它存在的唯一意义是把最坏响应体积变成一次**可复算的乘法**（两个乘数都住在契约里：
 * `2100 − 2007 + 1 = 94` 年 × `HOLIDAY_ADJUSTMENT_MAX_DAYS_PER_YEAR = 400` 条/年
 * ≈ 37 600 条）。真正压住匿名面的是**每条请求的速率**
 *（见 `holiday-adjustment.routes.ts` 的 per-route limit）与 ETag 命中后的 304，
 * 不是这个数。它留在代码里，是为了让那本账有一个锚点，而不是"文档里说 94"。
 */
export const HOLIDAY_ADJUSTMENT_MAX_YEARS_SERVED =
  HOLIDAY_ADJUSTMENT_YEAR_MAX - HOLIDAY_ADJUSTMENT_YEAR_MIN + 1;

/**
 * 「库里出现了本层认为不可能存在的状态」—— 与"数据太多"是两件事。
 *
 * 🔴 为什么不让它静默降级（截断、跳过越界年份）：那种做法的症状是
 * "运营后台显示 2027 已录入，客户端永远拿不到 2027"。一句 500 很难看，
 * 但它是唯一能被**发现**的结果。参见 §7 元规则 1（先怀疑探针）的反面：
 * 探针没问题时，别替它把结论改掉。
 */
export class HolidayAdjustmentInvariantError extends Error {
  readonly name = 'HolidayAdjustmentInvariantError';
}

/** 一次读取的结果：响应体 + 它的版本令牌。 */
export interface HolidayAdjustmentSnapshot {
  readonly body: HolidayAdjustmentsResponse;
  /**
   * 内容版本令牌：`<max(updated_at)>.<年度数>.<逐日行数>`。
   *
   * 三个量都是**数据自己的函数**，不含墙上时钟、不含随机数 ⇒ 同一份数据永远算出同一个串。
   * 形状照 `PriceVersion`（`schema.prisma:388`）那条既有立场：**版本号是数据的一部分**，
   * 不是响应头里现造的东西。为什么三个量都要 —— 见 {@link holidayVersionToken}。
   */
  readonly version: string;
}

/**
 * 版本令牌。
 *
 * 三个量缺一个就会出现"改了数据但令牌没变"的窗口：
 * - 只有 `max(updated_at)`：删掉**不是**最新的那一年（例如 2026 在 2027 之后录入），
 *   `max` 不变 ⇒ 客户端拿着旧 ETag 拿到 304，继续用已经过期的缓存。
 * - 只有年度数：整年替换（PUT 同一年）数量不变。
 * - 只有逐日行数：把一年从 3 条改成 3 条（改了**哪**三天）数量也不变。
 *
 * 三个量合起来仍然**不是**内容哈希 —— 它是"任何一次写入都会推进"的量。
 * 之所以不真去哈希内容：那要在每次 GET 时把整个逐日表读出来重算一遍，
 * 而这条通道的全部意义就是"别每次都把整份数据发出去"。
 * ADR-0052 §4 第 4 条钉的是「缓存不是正确性来源」（ETag 只为省流量）⇒ 别拿它当校验和用。
 */
function holidayVersionToken(input: {
  maxUpdatedAt: number;
  yearCount: number;
  dayCount: number;
}): string {
  return `${String(input.maxUpdatedAt)}.${String(input.yearCount)}.${String(input.dayCount)}`;
}

/** ETag（**强**校验符：`"` 包起来）。 */
export const holidayETag = (version: string): string => `"${version}"`;

/**
 * 弱校验前缀。它出现在**请求**侧（客户端/代理可以拿 `W/"x"` 来比），
 * 不出现在我们的响应侧 —— 理由见 {@link parseIfNoneMatch}。
 */
export const IF_NONE_MATCH_WEAK_PREFIX = 'W/';

/**
 * 把 `if-none-match` 归一成候选版本串的集合。
 *
 * 要处理四种真实写法：强 ETag `"x"`、弱 ETag `W/"x"`、逗号列表 `"a", "b"`、`*`。
 * `*` 表示"客户端已有任何缓存都算命中"，而这条通道**没有**"任意版本都可接受"的
 * 语义（我们的版本串就是内容本身）⇒ 按"不命中"处理，返回空集。
 *
 * ⚠️ 为什么响应侧用**强** ETag：客户端拿到的是同一份 JSON，字节级可比。
 * 弱校验留给"同一资源的不同表示（不同压缩等级/不同序列化）"那种场景，
 * 而这里只有一个 `reply.send(object)`。用弱符反而会让中间代理把
 * "换了表示"也当命中 —— 对一条**内容就是全部**的通道没有任何好处。
 */
export function parseIfNoneMatch(header: string | undefined): string[] {
  if (header === undefined) return [];
  return header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '*')
    .map((part) =>
      part.startsWith(IF_NONE_MATCH_WEAK_PREFIX) ? part.slice(IF_NONE_MATCH_WEAK_PREFIX.length) : part,
    )
    .map((part) =>
      part.length >= 2 && part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part,
    )
    .filter((part) => part !== '');
}

/** 库里读出来的一行（含逐日行）。两条对外路径共用同一个查询形状。 */
interface YearRow {
  readonly year: number;
  readonly papers: string[];
  readonly note: string | null;
  readonly updatedAt: bigint;
  readonly updatedBy: string | null;
  readonly days: readonly { readonly day: Date; readonly isOffDay: boolean }[];
}

/**
 * 唯一的查询处。
 *
 * 🔴 **没有** `where: { year: { gte/lte } }` 这一层过滤。年份区间是库里的 CHECK
 *（`holiday_adjustment_years_year_range`）钉住的，读取端再筛一次会得到一条
 * **永远通过的判据**（§7 元规则 2），而且会把"CHECK 被绕过"从一次报错
 * 变成一次静默丢数据 —— 后者的症状是"运营说录进去了，客户端说没有这一年"。
 */
async function fetchYearRows(client: HolidayDb): Promise<YearRow[]> {
  return (await client.holidayAdjustmentYear.findMany({
    orderBy: { year: 'asc' },
    select: {
      year: true,
      papers: true,
      note: true,
      updatedAt: true,
      updatedBy: true,
      // 逐日行按 day 升序：`days[]` 的顺序是**对外的**（客户端拿整个响应体做缓存比对），
      // 两种查询计划给出两种顺序 ⇒ 每次 GET 的 body 都在变，ETag 永远不命中。
      days: { select: { day: true, isOffDay: true }, orderBy: { day: 'asc' } },
    },
  })) as unknown as YearRow[];
}

/** 逐日行的唯一换算处（`DATE` → `YYYY-MM-DD`）。 */
const toContractDays = (row: YearRow): HolidayAdjustmentDay[] =>
  row.days.map(
    (d): HolidayAdjustmentDay => ({
      // 🔴 只能用 `dayColumnToIso`（UTC 访问器）。本地 getter 在 UTC-x 的部署上少一天。
      day: dayColumnToIso(d.day),
      isOffDay: d.isOffDay,
    }),
  );

/**
 * 读全量公共事实（公开 GET 用）。
 *
 * 🔴 后台回显走的是**同一份** {@link fetchYearRows} + {@link toContractDays}：
 * 分开写的话，"后台显示 2027 有 5 条、客户端只拿到 4 条"这种分歧没有任何一层能报错，
 * 而它俩读的是同一张表（§3.5 那个教训的第三种面目）。
 */
export async function loadHolidayAdjustments(
  client: HolidayDb = prisma,
): Promise<HolidayAdjustmentSnapshot> {
  const rows = await fetchYearRows(client);

  if (rows.length > HOLIDAY_ADJUSTMENT_MAX_YEARS_SERVED) {
    throw new HolidayAdjustmentInvariantError(
      `库里 ${String(rows.length)} 个年度，超过录入区间能装下的上限 ` +
        `${String(HOLIDAY_ADJUSTMENT_MAX_YEARS_SERVED)}（${String(HOLIDAY_ADJUSTMENT_YEAR_MIN)}–` +
        `${String(HOLIDAY_ADJUSTMENT_YEAR_MAX)}）。说明 ` +
        '`holiday_adjustment_years_year_range` 那条 CHECK 没有生效。',
    );
  }

  const years: HolidayAdjustmentYear[] = rows.map((row) => ({
    year: row.year,
    papers: row.papers,
    days: toContractDays(row),
  }));

  const version = holidayVersionToken({
    maxUpdatedAt: rows.reduce((acc, r) => Math.max(acc, Number(r.updatedAt)), 0),
    yearCount: years.length,
    dayCount: years.reduce((acc, y) => acc + y.days.length, 0),
  });

  return { version, body: { version, years } };
}

/** 后台回显的一行：契约那份 + 管理侧元信息。 */
export interface HolidayAdjustmentAdminYear extends HolidayAdjustmentYear {
  /** epoch 毫秒（`BigInt` 列过 `Number` —— 漏一次就是整个端点 500）。 */
  readonly updatedAt: number;
  readonly updatedBy: string | null;
  readonly note: string | null;
  /** 库里**实际**行数：判据「界面显示的条数 == 存进去的条数」看的就是它。 */
  readonly dayCount: number;
}

/** 后台列表。 */
export async function listHolidayAdjustmentYearsForAdmin(
  client: HolidayDb = prisma,
): Promise<{ version: string; years: HolidayAdjustmentAdminYear[] }> {
  const rows = await fetchYearRows(client);

  return {
    version: holidayVersionToken({
      maxUpdatedAt: rows.reduce((acc, r) => Math.max(acc, Number(r.updatedAt)), 0),
      yearCount: rows.length,
      dayCount: rows.reduce((acc, r) => acc + r.days.length, 0),
    }),
    years: rows.map((row) => {
      const days = toContractDays(row);
      return {
        year: row.year,
        papers: row.papers,
        days,
        updatedAt: Number(row.updatedAt),
        updatedBy: row.updatedBy,
        note: row.note,
        dayCount: days.length,
      };
    }),
  };
}

/** `PUT /years/:year` 的 body 校验入口（路由与测试共用**同一个**，不各写一份）。 */
export const parseHolidayYearPut = (body: unknown) => holidayYearPutSchema.safeParse(body);

/**
 * 整年替换：**要么全收、要么一条都不写**（判据④）。
 *
 * 事务里的顺序的真正理由是**外键**：逐日行的 `year` 指向年度行，
 * 所以必须先把年度行 upsert 出来，才能灌逐日行。
 * 而"半成品"靠的是**事务本身**（任何一步失败整体回滚），不是靠顺序 ——
 * 把这两件理由记混的下一种写法是"为了防半成品而把年度行放到最后写"，
 * 那会当场炸一个外键错误。注释按此写，不要照着直觉改顺序。
 *
 * `updatedAt` 由调用方给（不在层内取 `Date.now()`）：测试要能钉住写入时间，
 * 而"什么时候录入的"是审计事实、不是实现细节。
 */
export async function replaceHolidayAdjustmentYear(
  input: {
    year: number;
    papers: readonly string[];
    note: string | null;
    days: readonly HolidayAdjustmentDay[];
    updatedAt: number;
    updatedBy: string | null;
  },
  client: HolidayDb = prisma,
): Promise<void> {
  await client.$transaction(async (tx) => {
    // 1) 年度行（外键的父行）。
    await tx.holidayAdjustmentYear.upsert({
      where: { year: input.year },
      create: {
        year: input.year,
        papers: [...input.papers],
        note: input.note,
        updatedAt: BigInt(input.updatedAt),
        updatedBy: input.updatedBy,
      },
      update: {
        papers: [...input.papers],
        note: input.note,
        updatedAt: BigInt(input.updatedAt),
        updatedBy: input.updatedBy,
      },
    });

    // 2) 整年替换的"替换"。
    await tx.holidayAdjustmentDay.deleteMany({ where: { year: input.year } });

    // 3) 灌新行。`isoToDayColumn` 是这里的唯一入口 —— 它用的是 `Date.UTC`，
    //    而 `new Date(y, m-1, d)`（本地零点）在 UTC-x 的库上会写成**前一天**。
    await tx.holidayAdjustmentDay.createMany({
      data: input.days.map((d) => ({
        day: isoToDayColumn(d.day),
        isOffDay: d.isOffDay,
        year: input.year,
      })),
    });
  });
}

/**
 * 删除某一年（运营纠错）。
 *
 * ⚠️ 它**不是**"下发一份空的 2027"。domain 那层对空年是**拒收**的
 *（`installHolidayAdjustmentOverrides` 的 `both-lists-empty`），因为空数组会
 * 把随包表那一年清空掉 —— 而随包表里的安排是**已公布的事实**，清空它是丢数据。
 * 删掉年度行的表现是"覆盖里不再有 2027" ⇒ 客户端下一次拉取的响应不含 2027
 * ⇒ 退回随包表。那才是"撤销这次录入"的正确语义（ADR-0052 §2.2）。
 *
 * 逐日行靠 `ON DELETE CASCADE` 一起走；返回值是**年度行**的删除数（0 = 本来就没有）。
 */
export async function deleteHolidayAdjustmentYear(
  year: number,
  client: HolidayDb = prisma,
): Promise<number> {
  const res = await client.holidayAdjustmentYear.deleteMany({ where: { year } });
  return res.count;
}

/** 端点路径只有一个来源（契约），注册处拼前缀 —— 两边不许各写字面量。 */
export const HOLIDAY_ADJUSTMENT_PUBLIC_PATH = `/${HOLIDAY_ADJUSTMENT_PATHS.public}`;
