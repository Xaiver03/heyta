import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  FESTIVAL_IDS,
  adjustmentOn,
  festivalsOn,
  holidayCoverage,
  holidayPapers,
  lunarRulesKnown,
  type FestivalId,
} from '../src/holidays.js';
import {
  HOLIDAY_COVERAGE_MAX,
  HOLIDAY_COVERAGE_MIN,
  HOLIDAY_OFF_DAYS,
  HOLIDAY_PAPERS,
  HOLIDAY_WORK_DAYS,
} from '../src/generated/holiday-cn.generated.js';

/**
 * 节假日查询层
 * ============
 *
 * 三条产品不变量，每条都对应计划 W4 的一条判据：
 *
 * 1. **生成物 == 源**（判据 ①）：随包数组必须逐日等于 `scripts/vendor/holiday-cn/`
 *    里公告的 `isOffDay` 分类。这条判据有牙齿：少打包一年、或把补班打成放假，都会红。
 * 2. **年份降级 = 有节无休，不空白不报错**（判据 ②）：2027 年公告还没发，
 *    `adjustmentOn` 必须返回 `undefined`（安静降级），而 `festivalsOn`
 *    必须照常给出元旦/春节 —— 因为那是可预测的。
 * 3. **补班日不是节日**（判据 ③）：`isOffDay: false` 那条只能表达"要上班"，
 *    它既不许进放假集合，也不许被当成节日标注。
 */

const VENDOR_DIR = '../../../scripts/vendor/holiday-cn';

function announcement(year: number) {
  return JSON.parse(
    readFileSync(new URL(`${VENDOR_DIR}/${year}.json`, import.meta.url), 'utf8'),
  ) as { year: number; papers: string[]; days: { name: string; date: string; isOffDay: boolean }[] };
}

describe('判据 ①：生成物逐日等于公告', () => {
  it('每一个公告里的放假日都在随包放假集合里，每一个补班日都在补班集合里', () => {
    const off = new Set(HOLIDAY_OFF_DAYS);
    const work = new Set(HOLIDAY_WORK_DAYS);
    let offChecked = 0;
    let workChecked = 0;
    for (let year = HOLIDAY_COVERAGE_MIN; year <= HOLIDAY_COVERAGE_MAX; year++) {
      for (const d of announcement(year).days) {
        if (d.isOffDay) {
          expect(off.has(d.date), `${year} 公告放假 ${d.date} 不在随包数据里`).toBe(true);
          offChecked++;
        } else {
          expect(work.has(d.date), `${year} 公告补班 ${d.date} 不在随包数据里`).toBe(true);
          workChecked++;
        }
      }
    }
    // 分母来自源本身：源一条不少，产物就一条不少。
    expect(offChecked).toBe(HOLIDAY_OFF_DAYS.length);
    expect(workChecked).toBe(HOLIDAY_WORK_DAYS.length);
    expect(offChecked).toBeGreaterThan(400);
    expect(workChecked).toBeGreaterThan(100);
  });

  it('放假与补班两个集合互不相交', () => {
    const off = new Set(HOLIDAY_OFF_DAYS);
    const both = HOLIDAY_WORK_DAYS.filter((d) => off.has(d));
    expect(both).toEqual([]);
  });

  it('两个集合都严格升序且无重复（二分查找的前提）', () => {
    for (const list of [HOLIDAY_OFF_DAYS, HOLIDAY_WORK_DAYS]) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i]! > list[i - 1]!, `下标 ${i} 处不再升序：${list[i - 1]} → ${list[i]}`).toBe(true);
      }
    }
  });

  it('papers 一年都不许丢，且指向 gov.cn', () => {
    expect(HOLIDAY_PAPERS.map((p) => p.year)).toEqual(
      Array.from({ length: HOLIDAY_COVERAGE_MAX - HOLIDAY_COVERAGE_MIN + 1 }, (_, i) => HOLIDAY_COVERAGE_MIN + i),
    );
    for (const p of HOLIDAY_PAPERS) {
      expect(p.urls.length).toBeGreaterThan(0);
      expect(p.urls.every((u) => u.includes('gov.cn'))).toBe(true);
      // 与源逐字相同：链接是举证材料，转抄一遍就会漂
      expect(p.urls).toEqual(announcement(p.year).papers);
    }
  });
});

describe('判据 ②：年份降级是"有节无休"，不是空白', () => {
  const covered = holidayCoverage();

  it('覆盖区间的两端都真的覆盖到了', () => {
    expect(covered).toEqual({ from: 2007, to: 2026 });
    expect(adjustmentOn(`${covered.from}-01-01`)).toBe('off');
    expect(adjustmentOn(`${covered.to}-10-01`)).toBe('off');
  });

  it('2027 元旦：休/班不知道，节照常有', () => {
    // 2027 的公告截至本批开工（2026-10-03）还没发布 —— 次年安排 11–12 月才公布。
    // 这就是 ADR-0044 §2.3 那条"调休不可预测"的现场形态，界面必须还能显示"元旦"。
    expect(adjustmentOn('2027-01-01')).toBeUndefined();
    expect(festivalsOn('2027-01-01')).toEqual(['new-year']);
  });

  it('2027 春节（农历算得出）：有节无休，且不抛错', () => {
    const spring = festivalsOn('2027-02-06').includes('spring-festival');
    expect(spring).toBe(true);
    expect(adjustmentOn('2027-02-06')).toBeUndefined();
    // 相邻的普通日子也不许抛 —— 降级路径上任何一次异常都会变成整块空白
    expect(() => adjustmentOn('2027-03-15')).not.toThrow();
    expect(() => festivalsOn('2027-03-15')).not.toThrow();
  });

  it('非法日期必须响亮失败，而不是安静返回"没有"', () => {
    expect(() => adjustmentOn('2026-13-40')).toThrow();
    expect(() => festivalsOn('not-a-date')).toThrow();
  });
});

describe('判据 ③：补班日不是节日', () => {
  const sampleWorkDays = ['2026-01-04', '2026-02-14', '2026-05-09', '2026-09-20'];

  it.each(sampleWorkDays)('%s 是补班，不是放假', (date) => {
    expect(adjustmentOn(date)).toBe('work');
    // 补班日不许同时是放假日（那是数据损坏，见生成器里的同一条断言）
    expect(HOLIDAY_OFF_DAYS).not.toContain(date);
  });

  it('补班日里最容易被误标的那天（2026-02-14，春节假期调开的周六）不当成休息日', () => {
    expect(adjustmentOn('2026-02-14')).toBe('work');
    expect(adjustmentOn('2026-02-17')).toBe('off');
  });

  it('全部补班日都不在放假集合里（整表，不是抽样）', () => {
    const off = new Set(HOLIDAY_OFF_DAYS);
    expect(HOLIDAY_WORK_DAYS.filter((d) => off.has(d))).toEqual([]);
    expect(HOLIDAY_WORK_DAYS.length).toBeGreaterThan(100);
  });
});

describe('节日词表：每个 id 都落在公告放假集合里', () => {
  /** 独立于本模块的第二份答案：直接从公告的放假集合反查。 */
  const offSetOf = (year: number) =>
    new Set(announcement(year).days.filter((d) => d.isOffDay).map((d) => d.date));

  const EXPECTED: Record<number, Record<FestivalId, string>> = {
    2024: {
      'new-year': '2024-01-01',
      'spring-festival': '2024-02-10',
      qingming: '2024-04-04',
      'labour-day': '2024-05-01',
      'dragon-boat': '2024-06-10',
      'mid-autumn': '2024-09-17',
      'national-day': '2024-10-01',
    },
    2025: {
      'new-year': '2025-01-01',
      'spring-festival': '2025-01-29',
      qingming: '2025-04-04',
      'labour-day': '2025-05-01',
      'dragon-boat': '2025-05-31',
      'mid-autumn': '2025-10-06',
      'national-day': '2025-10-01',
    },
  };

  for (const [yearStr, byId] of Object.entries(EXPECTED)) {
    const year = Number(yearStr);
    it(`${year} 年七个节日各在自己的日子，且只有那七天`, () => {
      for (const id of FESTIVAL_IDS) {
        const date = byId[id]!;
        expect(festivalsOn(date)).toContain(id);
        // 反证：这天必须在公告的放假集合里（两个独立来源对上）
        expect(offSetOf(year).has(date), `${year} ${id} = ${date} 不在公告放假集合`).toBe(true);
      }
      // 全年恰好 7 天有节日 —— 多一个说明规则错标，少一个说明漏了。
      const hits: string[] = [];
      for (let month = 1; month <= 12; month++) {
        for (let day = 1; day <= 31; day++) {
          const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          try {
            if (festivalsOn(date).length > 0) hits.push(date);
          } catch {
            /* 该月没有这天 */
          }
        }
      }
      expect(hits.sort()).toEqual(Object.values(byId).sort());
    });
  }

  it('一天可以有两个节日（2020-10-01 中秋撞国庆），顺序按词表', () => {
    expect(festivalsOn('2020-10-01')).toEqual(['mid-autumn', 'national-day']);
  });

  it('词表是封闭的，且不含公告措辞', () => {
    expect(FESTIVAL_IDS).toEqual([
      'new-year',
      'spring-festival',
      'qingming',
      'labour-day',
      'dragon-boat',
      'mid-autumn',
      'national-day',
    ]);
    expect(holidayPapers(2026)![0]).toContain('gov.cn');
    expect(holidayPapers(2027)).toBeUndefined();
  });
});

describe('农历规则的可知性：区间内全知，区间外如实缺席', () => {
  it('2033 年（曾有置闰歧义）现在按随包口径答得出正月初一', () => {
    expect(lunarRulesKnown('2033-01-31')).toBe(true);
    expect(festivalsOn('2033-01-31')).toEqual(['spring-festival']);
  });

  it('月表用尽之后农历规则缺席，但公历规则照常回答', () => {
    // 农历 2100 年的腊月铺到公历 2101 年 1–2 月 —— 那段**算得出**，
    // 用"公历年份 <= 2100"当判据会把它误判成算不出。
    expect(lunarRulesKnown('2101-01-15')).toBe(true);
    expect(lunarRulesKnown('2101-06-01')).toBe(false);
    expect(festivalsOn('2101-01-01')).toEqual(['new-year']);
    expect(() => festivalsOn('2101-06-01')).not.toThrow();
    expect(festivalsOn('2101-06-01')).toEqual([]);
  });

  it('两个登记过分歧的年份，消费侧看到的与公开日历一致', () => {
    expect(festivalsOn('1988-02-17')).toEqual(['spring-festival']);
    expect(festivalsOn('2030-02-03')).toEqual(['spring-festival']);
  });
});
