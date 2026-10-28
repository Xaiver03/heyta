#!/usr/bin/env node
/**
 * BLOCKED.md 的「同号开两节」探针（注册登录标准套件线，2026-10-28）
 * ================================================================
 *
 * 起因不是好奇，是被咬了一口：例外归属尺的打印正文原先写「见 BLOCKED.md 的 B238 那一节」，
 * 而那一号实际讲的是 macOS 窗口门；本线真正的登记正文在另一张表里。也就是说
 * **按 B 号引用这件事本身已经不可靠了** —— 而用户给的目标正文里就写着「修掉台账 B232」，
 * 那一号在文件里开着两节（10-18 的 macOS 窗 / 10-27 的落地页登录入口坏）。
 *
 * 判据只认「新开一节」那一形状：`B<数字>` 后面**紧跟全角括号**（`🔴 **B232（…` 或 `### B232（…`）。
 * 🔴 「追记」条**不算撞号**（`🔴 **B243 追记五（…`）—— 那是同一节的续写。
 *   本探针第一发就是栽在这一格上：粗数 `B243` 出现 7 次就差点写成"撞号 7 次"，
 *   实际 7 次里 6 次是追记。所以这一格必须有专门的臂盯着（A2）。
 *
 * 用法：node research/tools/audit-blocked-number-collisions.mjs [--strict] [--self-test]
 * 退出：0 = 只报读数（诊断型尺，默认不改任何东西、不判红）
 *       1 = --strict 且有撞号
 *       2 = 分母为空 / 自检不合 ⇒ "我今天没干活"，不许读成"没有撞号"
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const LEDGER = process.env.HEYTA_LEDGER || path.join(ROOT, 'BLOCKED.md');

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const wantSelfTest = argv.includes('--self-test');
const unknown = argv.filter((a) => !['--strict', '--self-test'].includes(a));

/** 一行的"新开一节"形状 ⇒ 编号；否则 null。追记条返回 null。 */
export function sectionNumber(line) {
  const t = line.trimStart();
  const isHeading = t.startsWith('🔴') || t.startsWith('🟡') || /^#{2,4} /.test(t) || t.startsWith('**B');
  if (!isHeading) return null;
  const m = /(?:\*\*)?(B\d+)（/.exec(t);
  return m ? m[1] : null;
}

/** 逐行收成 Map(编号 → [行号…])。 */
export function collect(lines) {
  const hits = new Map();
  lines.forEach((l, i) => {
    const n = sectionNumber(l);
    if (n === null) return;
    if (!hits.has(n)) hits.set(n, []);
    hits.get(n).push(i + 1);
  });
  return hits;
}

/** 撞号 = 同一编号开出 ≥2 节。 */
export function findCollisions(hits) {
  return [...hits.entries()].filter(([, v]) => v.length > 1).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}

const SELF_TEST_ARMS = () => {
  const arms = [];
  const push = (name, got, want) => arms.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

  push(
    'A1 同号开出两节（两种标题形状各一枚）⇒ 必须算撞号',
    findCollisions(collect(['🔴 **B7（2026-10-18 · 甲事）**：x', '### B7（2026-10-27 · 乙事）', '正文里提到 B7 的那行不算'])),
    [['B7', [1, 2]]],
  );
  push('A2 追记条不算撞号（B243 那族 7 次里 6 次是追记 —— 这一格是防假红的牙）', findCollisions(collect(['🔴 **B8（2026-10-20 · 甲）**：x', '🔴 **B8 追记五（2026-10-22 · 乙）**：y'])), []);
  push('A3 不同号 ⇒ 空', findCollisions(collect(['🔴 **B9（a）**', '🔴 **B10（b）**'])), []);
  push('A4 散文里提到 "B232" 的那行不进分母（只有"新开一节"的形状才算）', collect(['这一版和 B232 那一节是同一件事', '### B232（2026-10-27）']).get('B232'), [2]);
  push('A5 行号从 1 起算，不是 0（拿 0 起算的号回文件里找就指错行）', collect(['🔴 **B1（x）**', '🔴 **B2（y）**']).get('B2'), [2]);
  push('A6 分母自检：空文件 ⇒ 收成 0 枚（真跑时这一档要让探针退 2，不许说"没有撞号"）', collect([]).size, 0);
  push('A7 数字比较要按数值排（B10 不许排在 B2 前面）', findCollisions(collect(['🔴 **B2（a）**', '🔴 **B2（b）**', '### B10（c）', '### B10（d）'])).map(([k]) => k), ['B2', 'B10']);
  return arms;
};

const run = () => {
  if (unknown.length > 0) {
    console.error(`🔴 不认的旗标：${unknown.join(' ')} ｜ 只认 --strict / --self-test`);
    process.exit(1);
  }
  if (wantSelfTest) {
    const arms = SELF_TEST_ARMS();
    const bad = arms.filter((a) => !a.ok);
    for (const a of arms) console.log(`${a.ok ? '✅' : '🔴'} ${a.name}${a.ok ? '' : ` ｜ 得到 ${JSON.stringify(a.got)} ｜ 期望 ${JSON.stringify(a.want)}`}`);
    console.log(`臂数 ${arms.length} ｜ 不符 ${bad.length}`);
    process.exit(bad.length === 0 ? 0 : 1);
  }
  if (!existsSync(LEDGER)) {
    console.error(`🔴 账本读不到：${LEDGER}`);
    process.exit(2);
  }
  const lines = readFileSync(LEDGER, 'utf8').split('\n');
  const hits = collect(lines);
  if (hits.size === 0) {
    console.error('🔴 一枚"新开一节"的编号都没解析到 ⇒ 探针不合（标题形状变了？），今天不许报"没有撞号"');
    process.exit(2);
  }
  const dup = findCollisions(hits);
  console.log(`账本分母：编号 ${hits.size} 枚（去重后）｜ 同号开多节：${dup.length} 枚`);
  for (const [k, v] of dup) console.log(`   ${k} @行 ${v.join(' / ')}`);
  if (dup.length === 0) console.log('   ⇒ 按号引用当前可靠（这一条会随文件漂，别抄进正文，要用的时候现跑）。');
  else console.log('   ⇒ 凡是按 B 号写的引用都要逐枚读那两节的标题再下结论；引用正文一律改用形状定位（grep -n 某个稳定串）。');
  process.exit(strict && dup.length > 0 ? 1 : 0);
};

run();
