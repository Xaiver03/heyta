/**
 * 节假日查询层（B 类可预测 + C 类公告）
 * =====================================
 *
 * 🔴 **两类事实分成两个函数，绝不合并成一个"今天是不是节日"。** 这是本功能最容易做错的地方：
 *
 * | 想知道 | 用 | 来源 | 覆盖 |
 * |---|---|---|---|
 * | 这天是什么节 | {@link festivalsOn} | 公历固定日 / 清明按节气 / 春节端午中秋按农历 | 月表区间全区间 |
 * | 这天休不休、要不要补班 | {@link adjustmentOn} | 国务院公告（随包数据） | 只有公告覆盖的那些年 |
 *
 * 为什么不合成一个：调休是**行政决定**，次年 11–12 月才公布，不可预测（ADR-0044 §2.3）。
 * 合成一个布尔的代价是"2027 年的元旦要么整个不显示、要么显示成一个没有依据的休"——
 * 前者丢功能，后者是界面在说谎。分开之后，年份降级是**数据缺一年**而不是**一整块空白**
 * （计划 W4 判据 ②）。
 *
 * 界面文案不在这里（AGENTS §5：i18n 是唯一文案事实源）。本模块只返回**封闭词表的 id**，
 * `name` 那种公告措辞被刻意丢掉 —— 同一个中秋在公告里叫「中秋节」或「国庆节、中秋节」，
 * 2015 还有一条只出现一次的一次性假日，它当词表用一定会漂。
 */

import { type LocalDate, parseLocalDate } from './date.js';
import {
  HOLIDAY_COVERAGE_MAX,
  HOLIDAY_COVERAGE_MIN,
  HOLIDAY_OFF_DAYS,
  HOLIDAY_PAPERS,
  HOLIDAY_WORK_DAYS,
} from './generated/holiday-cn.generated.js';
import { qingming, solarToLunar } from './lunar.js';
import { QINGMING_YEAR_MAX, QINGMING_YEAR_MIN } from './generated/solar-term.generated.js';
import {
  HOLIDAY_ADJUSTMENT_YEAR_MAX,
  HOLIDAY_ADJUSTMENT_YEAR_MIN,
  HOLIDAY_DATE_RE,
  isRealCalendarDay,
} from '@heyta/shared-schema';

/**
 * 法定节日的封闭词表。
 *
 * 每一项都有**独立来源的反证**：公历固定那三条由公告的放假日直接对上，
 * 春节/端午/中秋由月表算出后落进公告放假集合，清明由节气表算出后同样落进去
 * （判据在 `scripts/gen-calendar-tables.mjs --verify`，137 条）。
 * 所以这里**不含**七夕/重阳/腊八/除夕：它们今天没有反证，也没有消费者。
 */
export type FestivalId =
  | 'new-year'
  | 'spring-festival'
  | 'qingming'
  | 'labour-day'
  | 'dragon-boat'
  | 'mid-autumn'
  | 'national-day';

export const FESTIVAL_IDS: readonly FestivalId[] = [
  'new-year',
  'spring-festival',
  'qingming',
  'labour-day',
  'dragon-boat',
  'mid-autumn',
  'national-day',
];

/** 公历固定日规则：`MM-DD` → 节日。 */
const SOLAR_FIXED: Record<string, FestivalId> = {
  '01-01': 'new-year',
  '05-01': 'labour-day',
  '10-01': 'national-day',
};

/** 农历日月规则。 */
const LUNAR_FIXED: { month: number; day: number; id: FestivalId }[] = [
  { month: 1, day: 1, id: 'spring-festival' },
  { month: 5, day: 5, id: 'dragon-boat' },
  { month: 8, day: 15, id: 'mid-autumn' },
];

/** 随包公告数据覆盖的年份区间。 */
export function holidayCoverage(): { from: number; to: number } {
  return { from: HOLIDAY_COVERAGE_MIN, to: HOLIDAY_COVERAGE_MAX };
}

// ─────────────────────────────────────────────────────────────────────
// 部署方下发的覆盖表（W4b 那条接缝）
// ─────────────────────────────────────────────────────────────────────

/**
 * 🔴 **为什么这一块必须存在，以及它保护的不是"功能"而是"界面对谎的能力"**
 *
 * 随包表只覆盖到 vendor 里实际有哪几年（`holidayCoverage()`，今天 2007–2026）。
 * 而调休是**次年 11–12 月才公布的行政决定**（ADR-0044 §2.3），所以随包表的结构
 * 决定了它**永远追不上下一个元旦**。没有这块，运营后台做得再完整，
 * `adjustmentOn()` 读的仍然是那张表 —— 判据①"缺数据不报错不留空块"根本没有载体，
 * 而"后台录入 → 客户端生效"这条链在代码上是**断的**（断得很安静：两边各自都绿）。
 *
 * ## 纯同步函数怎么接异步下发：**装进去，不是查出来**
 *
 * `adjustmentOn()` 的调用形态是「渲染一个月 = 42 格 × 每格一问」，全部在同步求值里。
 * 三条可选形状，选了第一条：
 *
 * | 形状 | 后果 |
 * |---|---|
 * | ✅ **推送**：异步层取到数据 → **整年校验** → `install…` 装进模块内的只读快照；同步函数只查快照 | 快照要么完整要么不存在，同步侧零分支、零 `await`、零 loading 态 |
 * | ❌ 拉取：`adjustmentOn` 变 async | 42 格全要变 Suspense 或"先画个不确定的格子"。**而"不确定"在日历上就是空白块** —— 正是判据①要防的那个东西 |
 * | ❌ 拉取 + 同步缓存但**不校验** | 半套数据进快照后无法区分"这天没安排"与"这天的数据没到"，界面会把"还不知道"画成"上班" |
 *
 * 关键在于：**异步的边界停在 install() 之前**。校验、拒绝、降级都发生在装之前，
 * 装进去的东西**类型上就不可能是半套**。这条不是风格问题 —— 它让
 * "有覆盖用覆盖 / 无覆盖退回随包 / 非法整年拒绝"三条分支各自都成得了一个断言
 * （判据④），而"当场从网络读"的写法三条里有一条根本无法观测。
 *
 * ## 🔴 覆盖是**整年替换**，不是合并
 *
 * 某一年一旦被覆盖，那一年**只**以下发的数据为准，随包表不再参与。
 * 合并会关掉一件必须能做的事：**撤销某天的安排**。国务院可以更正公告
 * （"原定 10 月 11 日上班，现调整为不上班"），合并语义下那条更正表达不出来 ——
 * 随包表里那个 `'work'` 会一直在。整年替换让"下发一份不含该日的 2027"就是撤销。
 * 代价要说清楚：下发某一年等于重发那一年**全部**安排，所以后台写入是
 * `PUT /years/:year`（整年替换），没有 `PATCH 一天`。
 */

/** 一年的下发内容。`offDays` / `workDays` 都是升序 `YYYY-MM-DD`。 */
export interface HolidayAdjustmentOverride {
  readonly year: number;
  readonly offDays: readonly string[];
  readonly workDays: readonly string[];
  /** 公告原文链接。随数据一起装进来，界面才可能在标注"休/班"的同时给出出处。 */
  readonly papers?: readonly string[] | undefined;
}

/** 整年被拒绝的原因。每一条都必须是**可显示**的 —— 静默拒绝等于运营以为录成功了。 */
export type HolidayOverrideRejectReason =
  | 'not-a-date'
  | 'date-in-wrong-year'
  | 'same-day-twice'
  | 'year-out-of-range'
  | 'both-lists-empty';

export type HolidayOverrideInstallResult =
  | { readonly kind: 'accepted'; readonly year: number }
  | {
      readonly kind: 'rejected';
      readonly year: number;
      readonly reason: HolidayOverrideRejectReason;
      /** 哪一天/哪一个值触发的（能显示给运营看，不含任何用户数据）。 */
      readonly detail: string;
    };

/**
 * 已安装的覆盖表。`Map<year, {off:Set, work:Set, papers}>`。
 *
 * 🔴 为什么是模块级可变状态而不是参数注入：`adjustmentOn()` 已经有一批调用方
 *（日历格子、将来的倒数日），把"覆盖表"做成第 2 个参数会让**每一个**中间层都要
 * 把它透传下去，而透传漏一处的表现是"那一处永远读随包表" —— 又一个静默的分歧。
 * 模块级快照 + 显式 `install/clear` 至少保证：**读的那一份和装的那一份是同一份**。
 * 同形状先例：`packages/app-host/src/native-bridge.ts:313` 的 `opLogStore = store`。
 *
 * ⚠️ 它是**进程级**的，不进 op-log、不进 `STATE`：公共事实不是用户数据，
 * 不该被同步到别的设备，也不该被回放（§3.4「被回放的 op 不得触发副作用」）。
 * 本地缓存的家在 `STORES.META`（见 app-host 的 holiday-adjustments.ts）。
 */
const overrides = new Map<number, { off: Set<string>; work: Set<string>; papers: readonly string[] }>();

/**
 * 校验并安装若干年度；**每个年度各自要么全收、要么全不收**（判据④第三条分支）。
 *
 * 返回逐年的结果而不是抛异常：一次下发通常含多个年度，
 * "2027 合法、2028 里有一天写错"的正确处置是**装 2027、拒 2028**，
 * 而不是让一个错数字把整批（包括已经对的那一年）都退回顾随包表。
 */
export function installHolidayAdjustmentOverrides(
  entries: readonly HolidayAdjustmentOverride[],
): HolidayOverrideInstallResult[] {
  const results: HolidayOverrideInstallResult[] = [];
  // 🔴 先在**局部副本**上做完全部校验，再一次性提交。
  // 提交循环里边校边装的话，一批里第 3 年第 7 年各错一处时，
  // 装进去的顺序会决定"哪些先可见"，而那不该影响结果。
  const staged = new Map<number, { off: Set<string>; work: Set<string>; papers: readonly string[] }>();

  for (const entry of entries) {
    const reject = (reason: HolidayOverrideRejectReason, detail: string): void => {
      results.push({ kind: 'rejected', year: entry.year, reason, detail });
    };

    if (!Number.isInteger(entry.year) || entry.year < HOLIDAY_ADJUSTMENT_YEAR_MIN || entry.year > HOLIDAY_ADJUSTMENT_YEAR_MAX) {
      reject('year-out-of-range', `year=${String(entry.year)}，允许区间 ${HOLIDAY_ADJUSTMENT_YEAR_MIN}–${HOLIDAY_ADJUSTMENT_YEAR_MAX}`);
      continue;
    }

    const off = new Set<string>();
    const work = new Set<string>();
    /** 第一条不合格就整年拒 —— 判据④「不接受半套数据」在这一层就没有那条路。 */
    let failed = false;

    // 两条列表**分别**校验，且同一天不得同时出现在两条里 ——
    // 那正是 `load.mjs` 对随包数据立的规矩（既休又补班的一天没有意义）。
    const buckets: readonly {
      readonly name: 'off' | 'work';
      readonly days: readonly string[];
      readonly set: Set<string>;
      /** 🔴 另一条列表。同一天出现在两条里 = 两个值，"谁生效"没有任何一层能决定。 */
      readonly opposite: Set<string>;
    }[] = [
      { name: 'off', days: entry.offDays, set: off, opposite: work },
      { name: 'work', days: entry.workDays, set: work, opposite: off },
    ];

    for (const bucket of buckets) {
      for (const raw of bucket.days) {
        if (!HOLIDAY_DATE_RE.test(raw) || !isRealCalendarDay(raw)) {
          reject('not-a-date', `${bucket.name} 里的 ${raw}`);
          failed = true;
          break;
        }
        if (Number(raw.slice(0, 4)) !== entry.year) {
          reject('date-in-wrong-year', `${raw} 不属于 year=${String(entry.year)}`);
          failed = true;
          break;
        }
        if (bucket.set.has(raw)) {
          reject('same-day-twice', `${bucket.name} 里 ${raw} 出现两次`);
          failed = true;
          break;
        }
        // ⚠️ 这条必须在 `add` **之前**判。写成"两条都灌完再回查交集"是错的：
        // 交集判据要在**添加自己**之后才非空，而那时已经装了半套。
        // 实测这条一开始写的是 `off.has(raw) && work.has(raw)` —— 同一天既休又补班
        // 会被**收下来**（work 那一轮时 `work.has` 还是 false），判据直接测出它。
        if (bucket.opposite.has(raw)) {
          reject('same-day-twice', `${raw} 既在放假又在补班`);
          failed = true;
          break;
        }
        bucket.set.add(raw);
      }
      if (failed) break;
    }
    if (failed) continue;

    if (off.size === 0 && work.size === 0) {
      // 空的一年**不收**：那等于"用一张空白覆盖掉随包表那一年"，
      // 而随包表里的安排是**已公布的事实**，把它清空是丢数据不是降级。
      reject('both-lists-empty', `year=${String(entry.year)} 的 offDays 与 workDays 都是空的`);
      continue;
    }

    staged.set(entry.year, {
      off,
      work,
      papers: entry.papers ?? overrides.get(entry.year)?.papers ?? [],
    });
    results.push({ kind: 'accepted', year: entry.year });
  }

  for (const [year, value] of staged) overrides.set(year, value);
  return results;
}

/** 清空覆盖表 —— 让"退回随包"这条分支在测试里可达，也让退出登录/换服务器后不留残值。 */
export function clearHolidayAdjustmentOverrides(): void {
  overrides.clear();
}

/** 当前装了覆盖的年份（升序）。观测用，不参与裁决。 */
export function installedHolidayAdjustmentYears(): number[] {
  return [...overrides.keys()].sort((a, b) => a - b);
}

/**
 * 这一天回答 `'off' | 'work' | undefined` 的那一份数据是**哪一个来源**。
 *
 * 🔴 为什么单独暴露：判据④要能分别断言三条分支，而 `adjustmentOn()` 的返回值
 * 区分不了"覆盖说这天上班"和"随包表说这天上班"。没有这个函数，
 * "有覆盖用覆盖"那条判据就只能靠挑一个随包表里没有的日期来间接推断 ——
 * 那种断言会在 vendor 数据多一年之后**悄悄变成恒真**。
 */
export function holidayAdjustmentSource(
  date: LocalDate,
): 'override' | 'bundled' | 'none' {
  assertDate(date);
  const year = Number(date.slice(0, 4));
  if (overrides.has(year)) return 'override';
  return year >= HOLIDAY_COVERAGE_MIN && year <= HOLIDAY_COVERAGE_MAX ? 'bundled' : 'none';
}

/** 该年公告的原文链接；**下发的那一年优先**（它才是标注"休/班"所依据的那一份）。 */
export function holidayPapersFor(year: number): readonly string[] | undefined {
  return overrides.get(year)?.papers ?? holidayPapers(year);
}

/**
 * 升序 `YYYY-MM-DD` 数组上的二分查找。
 *
 * 为什么不用 `Set`：随包产物要保持**纯数据**（可读、可 diff、可被门禁逐字节比对），
 * 而模块加载时建两个 Set 是每次冷启动都要付的一次性开销。日历一天最多查 42 格，
 * `log2(545) ≈ 10` 次字符串比较足够快，而且没有任何可变状态。
 */
function contains(sorted: readonly string[], date: LocalDate): boolean {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cur = sorted[mid]!;
    if (cur === date) return true;
    if (cur < date) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/**
 * 这天的调休安排：`'off'` 放假、`'work'` 补班（周末要上班）、`undefined` 不知道。
 *
 * 🔴 `undefined` 有两种含义，都必须原样返回而不是猜：
 * ① 年份在公告覆盖之外（2027 起）；② 在覆盖内但这天确实不在任何安排里（普通工作日）。
 * 界面区分不了它们，也不该区分 —— 两者都表现为"不标注休/班"。
 * ⚠️ 补班日**不是**节日：它是"要上班的周末"，把它当休息日显示就是界面在说谎
 *    （判据见 tests/holidays.spec.ts 的变异用例）。
 *
 * 读取顺序：**覆盖 → 随包**（{@link holidayAdjustmentSource} 解释为什么是这个顺序，
 * 以及为什么覆盖是整年替换而不是合并）。
 */
export function adjustmentOn(date: LocalDate): 'off' | 'work' | undefined {
  assertDate(date);
  const override = overrides.get(Number(date.slice(0, 4)));
  if (override !== undefined) {
    // 🔴 整年替换：这一年装了覆盖之后，随包表**不再参与**（含返回 undefined 那一支）。
    if (override.off.has(date)) return 'off';
    if (override.work.has(date)) return 'work';
    return undefined;
  }
  if (contains(HOLIDAY_OFF_DAYS, date)) return 'off';
  if (contains(HOLIDAY_WORK_DAYS, date)) return 'work';
  return undefined;
}

/**
 * 这天是什么节（可以不止一个：2020-10-01 既是中秋也是国庆）。
 *
 * 农历那三条规则在「歧义年份」（{@link lunarRulesKnown}）里**如实缺席** ——
 * 宁可不标注，也不给一个可能差一个历月的节日。公历与节气规则不受影响。
 */
export function festivalsOn(date: LocalDate): FestivalId[] {
  assertDate(date);
  const found = new Set<FestivalId>();
  const fixed = SOLAR_FIXED[date.slice(5)];
  if (fixed) found.add(fixed);
  const year = Number(date.slice(0, 4));
  if (year >= QINGMING_YEAR_MIN && year <= QINGMING_YEAR_MAX && date === qingming(year)) {
    found.add('qingming');
  }
  if (lunarRulesKnown(date)) {
    const lunar = solarToLunar(date);
    for (const rule of LUNAR_FIXED) {
      if (!lunar.leap && lunar.month === rule.month && lunar.day === rule.day) found.add(rule.id);
    }
  }
  return FESTIVAL_IDS.filter((id) => found.has(id));
}

/**
 * 这天的**农历**规则算不算得出。
 *
 * 判据是"月表能不能把它归进某个农历年"，不是"公历年份在不在区间内"：
 * 农历 2100 年的腊月一直铺到公历 2101 年 1–2 月，那段日子**算得出**；
 * 而 2101 年 3 月之后没有下一年的表了，**算不出**。
 *
 * 单独暴露它，是为了让"不知道"成为一个**可断言的事实**：调用方要区分
 * "那天没有农历节日"和"那天算不出农历"，只能靠这个函数。
 * 算不出时公历与节气规则照常回答（2101 年的元旦不需要农历也知道是元旦）。
 */
export function lunarRulesKnown(date: LocalDate): boolean {
  assertDate(date);
  try {
    solarToLunar(date);
    return true;
  } catch {
    return false;
  }
}

/** 该年公告的原文链接（举证用）；覆盖外的年份没有链接可给。 */
export function holidayPapers(year: number): readonly string[] | undefined {
  return HOLIDAY_PAPERS.find((p) => p.year === year)?.urls;
}

function assertDate(date: LocalDate): void {
  // 复用 date.ts 的解析校验：它会把 `2026-13-40` 这种"能进位但不是那天"的输入拒掉。
  // 不校验的话二分查找会安静返回 undefined，症状是"元旦那天没标注"。
  parseLocalDate(date);
}
