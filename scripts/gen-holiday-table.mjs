#!/usr/bin/env node
/**
 * 构建期把 holiday-cn 公告打包成随包数据
 * → packages/domain/src/generated/holiday-cn.generated.ts
 * =============================================================================
 *
 * 源：`scripts/vendor/holiday-cn/<year>.json`（国务院公告的机器可读版，逐字副本）。
 * 运行时**不联网**：AGENTS §1 的本地优先意味着节假日必须随包交付，
 * 自托管部署拿不到公告也照样有日历（只是那几年没有"休/班"，见下）。
 *
 * 🔴 这份产物只表达 **C 类事实：哪天休、哪天补班**。
 *    它**不**是节日名单 —— 公告里的 `name` 是措辞不是标识（同一个中秋在不同年份
 *    叫「中秋节」「国庆节、中秋节」，2015 还有一条只出现一次的
 *    「抗日战争暨世界反法西斯战争胜利70周年纪念日」），所以 `name` 在这里被丢掉，
 *    节日名由 `packages/domain/src/holidays.ts` 的**可预测规则**给出（ADR-0044 §2.4）。
 *    界面文案一律走 i18n（AGENTS §5），产物里不许出现中文。
 *
 * `papers`（gov.cn 原文链接）**必须随包保留**：那是"哪天为什么休"的唯一可举证出处。
 *
 * 用法：
 *   node scripts/gen-holiday-table.mjs            # 生成
 *   node scripts/gen-holiday-table.mjs --check    # 门禁：产物是否与源一致
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readHolidayYears } from './vendor/holiday-cn/load.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/domain/src/generated/holiday-cn.generated.ts');
const SCRIPT_NAME = 'gen-holiday-table.mjs';

const years = readHolidayYears();

/** 日期必须是 `YYYY-MM-DD`，且跨年条目（公告把假期排到 12/30–1/2）要按日期而不是按年份存。 */
function collect(flag) {
  const set = new Set();
  for (const { days } of years) {
    for (const d of days) {
      if (d.isOffDay === flag) {
        if (set.has(d.date)) {
          throw new Error(
            `${d.date} 在同为 isOffDay=${flag} 的条目里出现两次 —— 公告数据自相矛盾，不能打包`,
          );
        }
        set.add(d.date);
      }
    }
  }
  return [...set].sort();
}

const offDays = collect(true);
const workDays = collect(false);

// 🔴 同一天既休又补班是**数据损坏**，不是可以二选一的表示法。
//    这里必须响亮失败：安静地让 off 覆盖 work，症状是"补班那天界面说是休息日"。
const both = offDays.filter((d) => workDays.includes(d));
if (both.length) {
  throw new Error(`同一天既是放假日又是补班日：${both.join('、')}`);
}

const render = () => `/* 生成物，请勿手改 —— 由 scripts/${SCRIPT_NAME} 产出（跑 --check 会验一致性）。 */
/* 源：scripts/vendor/holiday-cn/（国务院公告的机器可读版，MIT）。 */
/**
 * 🔴 这里只有**哪天休 / 哪天补班**（C 类：行政决定，不可预测），没有节日名。
 * 公告里的 \`name\` 是措辞不是标识，节日名走可预测规则 + i18n（AGENTS §5）。
 * 覆盖 ${years[0].year}–${years[years.length - 1].year}；区间外的年份**没有这份数据**，
 * 界面必须"显示节、不显示休/班"，不许空白也不许报错（计划 W4 判据 ②）。
 */
export const HOLIDAY_COVERAGE_MIN = ${years[0].year};
export const HOLIDAY_COVERAGE_MAX = ${years[years.length - 1].year};

/** 法定节假日放假日（升序 \`YYYY-MM-DD\`）。 */
export const HOLIDAY_OFF_DAYS: readonly string[] = [
${offDays.map((d) => `  '${d}',`).join('\n')}
];

/** 调休补班日（升序 \`YYYY-MM-DD\`）—— 它是"要上班的周末"，**不是**节日。 */
export const HOLIDAY_WORK_DAYS: readonly string[] = [
${workDays.map((d) => `  '${d}',`).join('\n')}
];

/** 每年对应的国务院公告原文链接（举证用）。 */
export const HOLIDAY_PAPERS: readonly { year: number; urls: readonly string[] }[] = [
${years.map((y) => `  { year: ${y.year}, urls: [${y.papers.map((u) => `'${u}'`).join(', ')}] },`).join('\n')}
];
`;

const args = process.argv.slice(2);

if (args.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error(`❌ 生成物不存在：${OUT}`);
    process.exit(1);
  }
  if (readFileSync(OUT, 'utf8') !== render()) {
    console.error(`❌ 生成物与源不一致。跑：node scripts/${SCRIPT_NAME}`);
    process.exit(1);
  }
  console.log(
    `✅ 节假日生成物与源一致（${years.length} 个公告年 · 放假 ${offDays.length} 天 · 补班 ${workDays.length} 天）`,
  );
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, render(), 'utf8');
console.log(
  `✅ 已生成 ${OUT}（${years.length} 年 · 放假 ${offDays.length} 天 · 补班 ${workDays.length} 天）`,
);
