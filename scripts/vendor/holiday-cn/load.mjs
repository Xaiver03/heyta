/**
 * holiday-cn 上游数据的唯一读取入口
 * ==================================
 *
 * 这里放的是 **NateScarlet/holiday-cn** 的年度文件逐字副本（国务院公告的机器可读版）：
 *
 *   https://github.com/NateScarlet/holiday-cn  (MIT)
 *   拉取地址 `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/<year>.json`
 *   本目录 2026-10-03 拉的是 master 分支，覆盖 2007–2026。
 *
 * 为什么单独一个 loader：两个生成器（历法表、节假日表）都要读同一份数据。
 * 解析规则写两遍必然漂 —— 而漂的那一处通常在"谁校验"上。
 *
 * 🔴 这些文件是**构建期输入**，不进产品包：运行时只消费 `packages/domain/src/generated/`
 *    里的生成物（AGENTS §1 —— 本地优先，产品不联网抓公告）。
 *
 * `days[].name` 是公告的**措辞**，不是稳定的节日标识：同一个中秋在不同年份的公告里
 * 叫「中秋节」或「国庆节、中秋节」，2015 还有一条只出现一次的
 * 「抗日战争暨世界反法西斯战争胜利70周年纪念日」。所以 name 只能用于对账与举证，
 * 不能当词表用 —— 界面文案走 i18n（AGENTS §5）。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VENDOR_DIR = dirname(fileURLToPath(import.meta.url));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 读全部年度文件并按年份升序返回。
 *
 * 校验失败一律 `throw`（不是 console.error 后继续）—— 这两个生成器是构建期的一环，
 * 静默产出一份"少了一年"的节假日表，界面上表现成"那天不是节日"，永远不会有人来修。
 */
export function readHolidayYears({ dir = VENDOR_DIR } = {}) {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .sort();
  if (files.length === 0) throw new Error(`没有年度文件：${dir}`);

  const years = files.map((f) => {
    const declaredYear = Number(f.slice(0, 4));
    const json = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (json.year !== declaredYear) {
      throw new Error(`${f} 文件名里的年份 ${declaredYear} ≠ 内容里的 year ${json.year}`);
    }
    if (!Array.isArray(json.days) || json.days.length === 0) {
      throw new Error(`${f} 的 days 是空的或缺失`);
    }
    if (!Array.isArray(json.papers) || json.papers.length === 0) {
      throw new Error(`${f} 缺 papers（gov.cn 原文链接）—— 没有出处的节假日数据不能进包`);
    }
    for (const d of json.days) {
      if (typeof d.date !== 'string' || !DATE_RE.test(d.date)) {
        throw new Error(`${f} 有非法日期：${JSON.stringify(d.date)}`);
      }
      if (typeof d.name !== 'string' || d.name.length === 0) {
        throw new Error(`${f} 在 ${d.date} 有非法名称`);
      }
      if (typeof d.isOffDay !== 'boolean') {
        throw new Error(`${f} 在 ${d.date} 的 isOffDay 不是布尔：${JSON.stringify(d.isOffDay)}`);
      }
    }
    return { year: declaredYear, papers: json.papers, days: json.days };
  });

  years.sort((a, b) => a.year - b.year);
  for (let i = 1; i < years.length; i++) {
    if (years[i].year !== years[i - 1].year + 1) {
      throw new Error(`年度不连续：${years[i - 1].year} 之后是 ${years[i].year}`);
    }
  }
  return years;
}

/**
 * 某条公告条目属于哪个节日 —— 按顿号拆段后与 aliases 求交。
 * 返回匹配到的 alias（没匹配到返回 undefined）。
 */
export function matchFestivalName(name, aliases) {
  return name
    .split('、')
    .map((part) => part.trim())
    .find((part) => aliases.includes(part));
}
