#!/usr/bin/env node
/**
 * G6 那条"率格词条必须自带口径"的变异臂（工单 #39，落地在 §8.124）。
 *
 * 钉的东西：计数型习惯同屏会出现「本月完成率 0%」与「本月完成量 3 杯」，两个数都对、
 * 读起来像矛盾。拍板的处置是**让率格自己说清按天**，而这条处置唯一能被改没的方式就是改词。
 * 所以臂就改词：中文版摘掉"（按天）"、英文版摘掉"(by days)"，各自必须只让 G6 变红。
 *
 * ⚠️ 两趟都**不重建** `packages/i18n/dist`：G6 读的是词条**源文件**，其余 32 条读的是
 *    注入的桩 label ⇒ 红集应当恰好是 G6 一条。这不是偷工：界面真值由 dist 提供，
 *    那一层由 §8.124 的 e2e 截图 + 人看图负责，两件事各有各的载体。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-habit-rate-label.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const FILES = {
  zh: 'packages/i18n/src/locales/zh-CN.ts',
  en: 'packages/i18n/src/locales/en.ts',
};
const SPECS = ['tests/habits-board.spec.tsx'];

const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');
const orig = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, readFileSync(path.join(ROOT, rel), 'utf8')]));
const origMd5 = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, md5(path.join(ROOT, rel))]));

/** 摘掉一条 locale 里那两行的口径词。命中数先断言，不靠"replace 了就算"。 */
const stripUnit = (key, from, to, expectHits) => {
  const src = orig[key];
  const hits = src.split(from).length - 1;
  if (hits !== expectHits) throw new Error(`${FILES[key]} 里 ${JSON.stringify(from).slice(0, 40)} 命中 ${hits} 次（要 ${expectHits} 次）`);
  writeFileSync(path.join(ROOT, FILES[key]), src.replaceAll(from, to));
};

const runVitest = () => {
  const r = spawnSync('./node_modules/.bin/vitest', ['run', ...SPECS], {
    cwd: path.join(ROOT, 'apps/web'),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  // 🔴 汇总行有两个坑，都在这里踩过一次：
  //   ① default reporter 的那一行是**缩进**的（`      Tests  33 passed (33)`），`^Tests` 恒不匹配；
  //      症状是两趟都报"0 条"，看起来像"一条都没跑"。
  //   ② **词序随结果变**：全绿是 `Tests 33 passed (33)`，有失败是 `Tests 1 failed | 32 passed (33)`
  //      （失败在前）。照全绿那一版写顺序，变异趟就什么都读不到。
  //   所以两个数各自在这一行里找，不假设行首、也不假设谁在前。
  const sumLine = (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0];
  const passed = Number((/(\d+) passed/.exec(sumLine) || [0, 0])[1]);
  const failed = Number((/(\d+) failed/.exec(sumLine) || [0, 0])[1]);
  return { rc: r.status ?? 1, out, sumLine: sumLine.trim(), passed, failed };
};

const restore = () => {
  for (const [k, rel] of Object.entries(FILES)) writeFileSync(path.join(ROOT, rel), orig[k]);
  return Object.entries(FILES).every(([k, rel]) => md5(path.join(ROOT, rel)) === origMd5[k]);
};

const results = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'OK  ' : 'BAD '} ${name} —— ${detail}`);
  results.push(ok);
};

// 分母前提：真身必须先量一次，否则"恰好 1 条红"没有基数。
// 🔴 基数从这里**现取**，不写死 33 —— 写死就成了第二份抄件，别的用例增删会让这条臂自己烂掉。
const base = runVitest();
const BASE_PASSED = base.passed;
check(
  '对照趟 真身全绿且分母如实',
  base.rc === 0 && base.failed === 0 && BASE_PASSED > 0,
  `rc=${base.rc} 汇总行=[${base.sumLine}]`,
);

// 每臂的红集白名单：只许 G6 一条红，其余照旧全绿。
const onlyG6 = (t) => t.rc !== 0 && t.failed === 1 && t.passed === BASE_PASSED - 1 && /G6/.test(t.out);

// —— 臂 L1：中文摘口径
{
  stripUnit('zh', '本月完成率（按天）', '本月完成率', 2);
  const t = runVitest();
  check('L1 中文词条去掉"按天" ⇒ 只红 G6', onlyG6(t), `rc=${t.rc} 汇总行=[${t.sumLine}] 基数=${BASE_PASSED}`);
  check('L1 复原后逐字节回到原样', restore(), `md5 两边一致`);
}

// —— 臂 L2：英文摘口径
{
  // 两行的口径词是同一个字面片段，一次替换两处；命中数仍是断言。
  stripUnit('en', ' (by days)', '', 2);
  const t = runVitest();
  check('L2 英文词条去掉"by days" ⇒ 只红 G6', onlyG6(t), `rc=${t.rc} 汇总行=[${t.sumLine}] 基数=${BASE_PASSED}`);
  check('L2 复原后逐字节回到原样', restore(), `md5 两边一致`);
}

const passed = results.filter(Boolean).length;
console.log(`RIG_RESULT=${passed}/${results.length}（对照 1 + 两臂各"红一条 / 复原"2 条）`);
process.exit(passed === results.length ? 0 : 1);
