#!/usr/bin/env node
/**
 * 调研文档的**定性档与核阅日期**清点。
 * ================================================================
 *
 * ## 为什么需要它
 *
 * 2026-10-16 连查两轮（**B38 / B39**）发现：`docs/research/` 里的断言**会老化**，
 * 而"**这句是官方原文、还是律所口径、还是代办话术**"直接决定它能不能被引用。
 * 仓里其实**已经有一套自发的档位写法**（`【官方】`/`【律所】`/`【代办口径】`/`【未核实】`/`【官方实况】`），
 * 但**没有任何东西保证每句都有档位、每个档位都带核阅日期**。
 *
 * ⇒ 本工具把它变成一张清单：**哪些文件在用档位、哪些没有、哪些档位没带日期**。
 *
 * ## ⚠️ 它是**读数，不是判据**
 *
 * 它**不判断**"某个断言该属于哪一档"（那是语义判断）。它只数三种**可机械识别**的东西。
 *
 * ## 用法
 *
 *   node research/tools/doc-provenance-census.mjs            # 每份文件的档位分布
 *   node research/tools/doc-provenance-census.mjs --no-grade # 只列"一处档位都没有"的文件
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const RESEARCH = join(ROOT, 'docs/research');

/** 仓里**自发使用**的定性档。⚠️ 只认这些写死的形状，不猜变体。 */
const GRADES = ['【官方实况】', '【官方·厂商】', '【官方·转述】', '【官方】', '【律所】', '【代办口径】', '【未核实】', '【事实】'];

/**
 * 日期的写法。
 * 🔴 **第一版只认 `核阅于 YYYY-MM-DD`** ⇒ 把一批"其实写了日期"的文件报成"一个日期都没有"
 *    （仓里还写「2026-10-01 直查」「调研日期：2026-10-01」等）。⇒ 放宽成**任何日期字面量**，
 *    并**分开记**"规范写法"与"任意日期"，免得把"写了日期但写法不规范"读成"没写"。
 */
const CANONICAL_DATE = /核阅于\s*(\d{4}-\d{2}-\d{2})/g;
const ANY_DATE = /\d{4}-\d{2}-\d{2}/g;

/** @returns {{file: string, grades: Record<string, number>, dateCount: number, gradeCount: number}} */
export function censusOne(file) {
  const text = readFileSync(file, 'utf8');
  const grades = {};
  let gradeCount = 0;
  for (const g of GRADES) {
    const n = text.split(g).length - 1;
    if (n > 0) grades[g] = n;
    gradeCount += n;
  }
  return {
    file,
    grades,
    dateCount: [...text.matchAll(ANY_DATE)].length,
    canonicalDates: [...text.matchAll(CANONICAL_DATE)].length,
    gradeCount,
  };
}

function main() {
  const files = readdirSync(RESEARCH)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(RESEARCH, f))
    .sort();

  const rows = files.map(censusOne);

  // 🔴 **必须分域**（第一版把所有文件一起算，于是 59 份 UX/设计审计被报成"没有档位"——
  //    而档位制度对它们**本来就不适用**）。判据：这份文档**做不做外部法规断言**
  //    （文件名或正文提到备案/法规/合规/律所/工信部/网信办/许可）。
  // ⚠️ **只按文件名判**（第二版把正文里顺带出现的"规定/合规"也算，于是 30 份工程/UX 文档
  //    被误算成法规类 ⇒ 又一次过度报警）。正文命中改为**下面的提示**，不进分母。
  const isRegulatory = (file) => /legal|licens|compliance|filing|pipl|privacy|refund|ai-disclosure/.test(file);
  const regRows = rows.filter((r) => isRegulatory(r.file));
  const otherRows = rows.filter((r) => !isRegulatory(r.file));
  // 正文里出现法规词、但文件名看不出来的 —— **只提示**，让人去看它到底是不是法规类。
  const REGULATORY_HINT = /备案|法规|律所|工信部|网信办|法条|条例/;
  const hinted = otherRows.filter((r) => REGULATORY_HINT.test(readFileSync(r.file, 'utf8')));
  // 🔴 **第三版：分三档**（第二版把"没档位"一律报红，而抽查发现那 6 份用的是**另一种体例** ——
  //    `> **元信息**` + **日期** + 性质 + 出处链接，**不是没有出处**）。
  const hasMeta = (file) => /元信息|调研日期|生成日期|核阅于/.test(readFileSync(file, 'utf8'));
  // 🔴 **第四版：再分出一档"指针文件"** —— `legal-data-flow-inventory.md` 开头写着
  //    「**这份文件不含事实，只含指针**」⇒ 它**不需要档位**。第一版把它报成"缺档位"是错的。
  const isPointer = (file) => /不含事实.{0,4}只含指针|只含指针/.test(readFileSync(file, 'utf8'));
  const ungraded = regRows.filter((r) => r.gradeCount === 0 && !hasMeta(r.file) && !isPointer(r.file));
  const pointers = regRows.filter((r) => isPointer(r.file));
  const metaOnly = regRows.filter((r) => r.gradeCount === 0 && hasMeta(r.file));
  const undated = regRows.filter((r) => r.gradeCount > 0 && r.dateCount === 0);

  if (process.argv.includes('--no-grade')) {
    for (const r of ungraded) console.log(`  ${r.file.slice(r.file.indexOf('docs/'))}`);
  } else {
    console.log('| 文件 | 档位合计 | 日期（规范化）| 用了哪些档 |');
    console.log('|---|---|---|---|');
    for (const r of rows) {
      const name = r.file.slice(r.file.indexOf('docs/research/') + 'docs/research/'.length);
      const used = Object.entries(r.grades)
        .map(([k, v]) => `${k}×${v}`)
        .join(' ');
      console.log(`| ${name} | ${r.gradeCount} | ${r.dateCount}（${r.canonicalDates}）| ${used} |`);
    }
  }

  const totalGrades = rows.reduce((n, r) => n + r.gradeCount, 0);
  console.log(
    `\n共 **${rows.length}** 份调研；**${totalGrades}** 处定性档。` +
      `其中**做外部法规断言的 ${regRows.length} 份**（另 ${otherRows.length} 份是 UX/工程类，` +
      `**档位制度对它们不适用**，不参与下面两项）：` +
      `🔴 **既没档位、也没元信息日期的 ${ungraded.length} 份**；` +
      `🟡 **用「元信息 + 日期」而不用档位的 ${metaOnly.length} 份**（**不是缺陷，是另一种体例**）；` +
      `⚪ **自述"只含指针、不含事实"的 ${pointers.length} 份**（**也不需要档位**）；` +
      `🟡 **有档位但一个日期都没有的 ${undated.length} 份**（${undated
        .map((r) => r.file.slice(r.file.indexOf('docs/research/') + 'docs/research/'.length))
        .join(' · ') || '（无）'}）。`,
  );
  if (hinted.length > 0) {
    console.log(
      `📌 **另 ${hinted.length} 份文件名看不出、但正文提到法规词**（只是提示，**不进分母**）：` +
        hinted.map((r) => r.file.slice(r.file.indexOf('docs/research/') + 'docs/research/'.length)).join(' · '),
    );
  }
  console.log(
    '⚠️ 本工具**不判断**某句该属哪一档（语义判断），只数三种可机械识别的形状。' +
      '⚠️ 而且"**有档位**"不等于"**档位标对了**"—— 2026-10-16 那两轮（B38/B39）修的正是"标了【事实】却查无此公告"。',
  );
}

if (process.argv[1]?.endsWith('doc-provenance-census.mjs')) main();
