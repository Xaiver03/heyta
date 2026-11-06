#!/usr/bin/env node
/**
 * 环境陷阱「正文 ↔ 索引」覆盖门
 * ==============================================================================
 *
 * ## 判据（一句话）
 *
 * `docs/reference/environment-traps.md` 里每一枚条目编号，都必须能在
 * `docs/agents/environment-traps-index.md` 的号段表里**被读到** —— 要么落在某行
 * 第一列声明的号段区间里，要么被某行的「代表条目」点名（`#N`）。读不到就红。
 *
 * ## 为什么是可达性，不是条数
 *
 * `AGENTS.md` §5 与索引本节开头都明文**不许在索引里写条数**（写过一次"83 条"，
 * 六天后就漂了）。所以这道门不许拿"两边条数相等"当判据 —— 那会逼着文档去写一个
 * 它规定不能写的数。可达性判的是另一件事：**下一个人按索引找这一族坑时，够不够得着**。
 *
 * ## 为什么需要它（不是顺手加的）
 *
 * 正文是 append-only（编号只增不改），索引是一张人工维护的表，两者之间原来**没有任何
 * 一致性判据**。2026-11-06 第一次跑这把尺，量出 **33 枚**条目在索引里没有任何入口
 * （`#463–#466、#470、#495、#497–#504、#537–#541、#544–#548、#552–#557、#561–#563`），
 * 横跨 2026-10-18 到 10-26 八天、四条并行线 —— 每一趟追加时都没人回头看索引，
 * 而没有任何一道门会因此变红。同族先例：#540（改名/删除常驻门禁键 = 一次全仓散文改稿）、
 * §7 元规则 2（一条永远通过的判据比没有判据更糟）。
 *
 * ## 这把尺自己怎么被验（`--self-test`）
 *
 * 三臂，各自 spawn 自己：
 *   ① 真实两份文件 ⇒ 必须退 0；
 *   ② 索引副本里**删掉一行号段登记** ⇒ 必须退非 0，且读数里点名那一行盖住的那些号；
 *   ③ 索引副本里把某行的号段区间改成**不含它自己声明的那一枚** ⇒ 必须退非 0。
 * 另有一条前置：正文条目数与索引行数都必须 > 0 —— 空集合上的"全部可达"是假绿（#658）。
 *
 * ## 用法
 *
 * ```sh
 * pnpm check:traps-index-coverage            # 正常跑
 * node scripts/check-traps-index-coverage.mjs --self-test
 * node scripts/check-traps-index-coverage.mjs --traps <path> --index <path>   # 注入验证用
 * ```
 *
 * ⚠️ 红的时候**不要**用"补一行大区间"把它糊过去而不读条目：区间行只回答"这段有没有内容"，
 * 逐号摘要才是它的替代品（见索引里 `91–160` 与 `311–460` 那两行的原话）。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRAPS_DEFAULT = path.join(ROOT, 'docs/reference/environment-traps.md');
const INDEX_DEFAULT = path.join(ROOT, 'docs/agents/environment-traps-index.md');

const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
const SELF_TEST = argv.includes('--self-test');

/** 正文里的条目编号（`^<数字>. ` 那种行）。重复号按集合收敛。 */
function bodyNumbers(text) {
  const out = new Set();
  for (const m of text.matchAll(/^(\d+)\.\s/gm)) out.add(Number(m[1]));
  return out;
}

/**
 * 索引号段表覆盖到的编号。
 *
 * 一行算数的形状只有两种（都从**表格第一列**读，散文里的 `#N` 引用不算号段）：
 *   · 第一列的区间与枚举：`1–19`、`463–466、470`、`467、469、471、472`
 *   · 「代表条目」那一列点名的号：`#463 …`
 * 表头行与分隔行按"第一列不以数字开头"排除 —— ⚠️ 这里**不许**改成"排除含『号段』的行"：
 * 2026-11-06 那把临时探针就是这么写的，结果把正文里带"取号段现量"那句的 `311–460` 行
 * 一起排掉，读数从 33 枚虚报成 214 枚（同一族：探针坏与探针够不着，输出上长得一样）。
 */
function indexCoverage(text) {
  const covered = new Set();
  const rows = [];
  for (const line of text.split('\n')) {
    if (!/^\|\s/.test(line)) continue;
    const cells = line.split('|');
    const first = (cells[1] ?? '').trim();
    if (!/^\d/.test(first)) continue;
    rows.push(first);
    for (const m of first.matchAll(/(\d+)(?:[–-](\d+))?/g)) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (let n = Math.min(a, b); n <= Math.max(a, b); n += 1) covered.add(n);
    }
    for (const m of line.matchAll(/#(\d+)/g)) covered.add(Number(m[1]));
  }
  return { covered, rows };
}

/** 把不可达的号收成连续段，方便人一眼看完。 */
function spans(nums) {
  const out = [];
  for (const n of nums) {
    const last = out.at(-1);
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `#${a}` : `#${a}–#${b}`));
}

function evaluate(trapsPath, indexPath) {
  const body = bodyNumbers(fs.readFileSync(trapsPath, 'utf8'));
  const { covered, rows } = indexCoverage(fs.readFileSync(indexPath, 'utf8'));
  const all = [...body].sort((a, b) => a - b);
  const missing = all.filter((n) => !covered.has(n));
  return { total: all.length, rowCount: rows.length, missing };
}

function runCheck(trapsPath, indexPath) {
  const r = evaluate(trapsPath, indexPath);
  // 前置：空集合上的"全部可达"不算通过（#658 同族）。
  if (r.total === 0 || r.rowCount === 0) {
    console.log(
      `   ❌ 分母为空（正文条目 ${r.total} 枚 / 索引号段行 ${r.rowCount} 行）` +
        ` ⇒ 这把尺现在证明不了任何事`,
    );
    return 1;
  }
  if (r.missing.length === 0) {
    console.log(
      `   ✅ 陷阱索引覆盖：正文 ${r.total} 枚编号全部可达（索引号段行 ${r.rowCount} 行）`,
    );
    return 0;
  }
  console.log(
    `   ❌ 陷阱索引覆盖：正文 ${r.total} 枚里有 ${r.missing.length} 枚在索引里没有入口` +
      `（索引号段行 ${r.rowCount} 行）`,
  );
  const shown = spans(r.missing);
  console.log(`      不可达段：${shown.join(' ')}`);
  console.log(
    '      处置：到 docs/agents/environment-traps-index.md 补登记 —— 先读那几枚的条目原文，' +
      '再按族写一行；不要凭号猜主题，也不要只补一行大区间而不说明这段没逐号摘要。',
  );
  return 1;
}

if (SELF_TEST) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heyta-traps-index-'));
  const indexCopy = path.join(tmp, 'index.md');
  const src = fs.readFileSync(INDEX_DEFAULT, 'utf8');
  const lines = src.split('\n');
  // 挑一行"只盖自己那一段"的登记行做变异对象：删掉它，它盖住的那些号必须变成不可达。
  const base = evaluate(TRAPS_DEFAULT, INDEX_DEFAULT);
  if (base.missing.length !== 0) {
    console.log('   ❌ self-test 前置不成立：真实文件本身是红的，先修现状再谈牙');
    process.exit(1);
  }
  let mutated = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\|\s*\d/.test(lines[i])) continue;
    const without = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n');
    const body = bodyNumbers(fs.readFileSync(TRAPS_DEFAULT, 'utf8'));
    const missingNow = [...body].filter((n) => !indexCoverage(without).covered.has(n));
    if (missingNow.length > 0) {
      mutated = i;
      fs.writeFileSync(indexCopy, without);
      break;
    }
  }
  if (mutated === -1) {
    console.log('   ❌ self-test 挑不出可删的行（索引里每一行都是冗余的？）⇒ 判据未判定');
    process.exit(1);
  }
  const arm2 = runCheck(TRAPS_DEFAULT, indexCopy);
  const arm1 = runCheck(TRAPS_DEFAULT, INDEX_DEFAULT);
  // 臂 ③：把那一行的号段区间改成"不含它自己声明的那一枚"（区间收窄一格）。
  const narrowedLines = [...lines];
  const row = narrowedLines[mutated];
  const firstCell = (row.split('|')[1] ?? '').trim();
  const nums = [...firstCell.matchAll(/(\d+)(?:[–-](\d+))?/g)].map((m) => Number(m[1]));
  const narrowedCell = String(Math.max(...nums) + 1000);
  const parts = row.split('|');
  parts[1] = ` ${narrowedCell} `;
  narrowedLines[mutated] = parts.join('|');
  fs.writeFileSync(indexCopy, narrowedLines.join('\n'));
  const arm3 = runCheck(TRAPS_DEFAULT, indexCopy);
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = arm2 === 1 && arm1 === 0 && arm3 === 1;
  console.log(
    `   ${ok ? '✅' : '❌'} self-test 三臂：真实=退 ${arm1}（应 0）、` +
      `删一行=退 ${arm2}（应 1）、区间收窄=退 ${arm3}（应 1）` +
      ` —— 变异对象是索引第 ${mutated + 1} 行`,
  );
  process.exit(ok ? 0 : 1);
}

const trapsPath = flag('--traps') ?? TRAPS_DEFAULT;
const indexPath = flag('--index') ?? INDEX_DEFAULT;
process.exit(runCheck(trapsPath, indexPath));
