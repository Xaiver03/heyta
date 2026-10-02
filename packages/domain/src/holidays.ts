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
 */
export function adjustmentOn(date: LocalDate): 'off' | 'work' | undefined {
  assertDate(date);
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
