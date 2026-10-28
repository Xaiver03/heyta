#!/usr/bin/env node
/**
 * `pnpm check:ux-coverage` —— 全局 UX 线的**四档覆盖矩阵**判据（P8）
 * =================================================================
 *
 * 计划 §P8 最后一条要的是"把 P0–P7 的可复用探针接入主链"，并且四档验收：
 *
 *   ① 源码约束（门禁脚本）② 语义测（契约/单测）③ 真实浏览器（e2e）④ 截图矩阵（人看过）
 *
 * 散文写"都齐了"不算数：**矩阵里的每一格都要指得到一个真东西**，而且那一格如果是门禁，
 * 它必须真的挂在 `pnpm check` 的链上 —— "写了个脚本但没人跑"与"没有这个脚本"对交付
 * 是一回事（本仓为此付过一次代价：九枚臂一条没跑、退出码 0）。
 *
 * 矩阵住在计划 §8 的一段**围栏块**里，行格式：
 *
 *     控件族 | gate:check:xxx（可多枚，逗号分隔） | file:路径 | spec:路径 | file:路径
 *
 * 四列分别是 ②③④ 的落点（① 是 `gate:` 那一列）。判据：
 *
 *   C1 围栏块存在，且行数 ≥ 下限（防"矩阵被删光所以全绿"）。
 *   C2 每个 `gate:` 都是 `package.json` 里的脚本，**并且在 `check` 链里**。
 *   C3 每个 `file:` / `spec:` 路径存在（相对仓库根）。
 *   C4 每一行四档都不许空 —— 缺哪一档就点名哪一档。
 *   C5 候选下限：`gate` 引用的枚数 ≥ 下限。
 *
 * 🔴 只读、零副作用；`--self-test` 用夹具跑，不碰真树。
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const here = dirname(fileURLToPath(import.meta.url));

const PLAN = 'docs/plans/global-ux-system-remediation.md';
const BEGIN = '<!-- ux-coverage:begin -->';
const END = '<!-- ux-coverage:end -->';

/** 今天矩阵里的行数/门禁枚数（2026-10-28 建矩阵时）——只当下限用。 */
const FLOORS = { rows: 9, gates: 8 };

export function parseMatrix(text) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1 || end < start) return null;
  const body = text.slice(start + BEGIN.length, end);
  const rows = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('控件族')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length !== 5) {
      rows.push({ family: line, cells, malformed: true });
      continue;
    }
    rows.push({
      family: cells[0],
      gates: cells[1] === '' ? [] : cells[1].split(',').map((g) => g.replace(/^gate:/u, '').trim()).filter(Boolean),
      files: cells.slice(2).map((cell) => cell.replace(/^(?:file|spec):/u, '').trim()),
      malformed: false,
    });
  }
  return rows;
}

/** 判决本体（纯函数）。`exists` 与 `scripts`/`chain` 由调用方注入，便于 self-test。 */
export function judge({ planText, exists, scripts, chain }) {
  const problems = [];
  const rows = parseMatrix(planText);
  if (rows === null) {
    return { problems: ['C1 计划里找不到四档覆盖矩阵（`<!-- ux-coverage:begin/end -->` 围栏块）'], rows: [] };
  }
  for (const row of rows) {
    if (row.malformed) {
      problems.push(`C4 矩阵这一行不是五格：${row.family}`);
      continue;
    }
    // C4 四档齐
    if (row.gates.length === 0) problems.push(`C4 「${row.family}」缺源码尺（gate: 那一列空着）`);
    row.files.forEach((value, index) => {
      const tier = ['语义测', '真实浏览器', '截图'][index];
      if (value === '') problems.push(`C4 「${row.family}」缺${tier}那一档`);
    });
    // C2 门禁必须真在链上
    for (const gate of row.gates) {
      if (scripts[gate] === undefined) problems.push(`C2 「${row.family}」引用的 ${gate} 不是 package.json 里的脚本`);
      else if (!chain.includes(`pnpm ${gate}`)) problems.push(`C2 ${gate} 存在但**不在** \`check\` 链里 ⇒ 没人跑它`);
    }
    // C3 落点必须存在
    for (const path of row.files.filter((p) => p !== '')) {
      if (!exists(path)) problems.push(`C3 「${row.family}」的落点不存在：${path}`);
    }
  }
  if (rows.length < FLOORS.rows) problems.push(`C5 矩阵只有 ${String(rows.length)} 行（< ${String(FLOORS.rows)}）—— 控件的覆盖面在缩，或者块被删了`);
  const gates = new Set(rows.flatMap((r) => (r.malformed ? [] : r.gates)));
  if (gates.size < FLOORS.gates) problems.push(`C5 矩阵只引用了 ${String(gates.size)} 枚门禁（< ${String(FLOORS.gates)}）`);
  return { problems, rows };
}

/* ── self-test ─────────────────────────────────────────────────── */

const ROW = (family, gate, sem, e2e, shot) => `${family} | gate:${gate} | file:${sem} | spec:${e2e} | file:${shot}`;
const GOOD_ROWS = Array.from({ length: FLOORS.rows }, (_, i) =>
  ROW(`族${String(i)}`, 'check:demo', 'a.ts', 'b.spec.ts', 'c.png'),
);
const wrap = (rows) => `${BEGIN}\n控件族 | 源码尺 | 语义测 | 真实浏览器 | 截图\n${rows.join('\n')}\n${END}`;
const SCRIPTS = Object.fromEntries(Array.from({ length: FLOORS.gates }, (_, i) => [`check:demo${i === 0 ? '' : String(i)}`, 'x']));
const chainOf = (names) => names.map((n) => `pnpm ${n}`).join(' && ');
const scriptNames = Object.keys(SCRIPTS);

async function selfTest() {
  const arms = [];
  const push = (name, ok, detail) => arms.push({ name, ok, detail });
  const okExists = () => true;
  const chain = chainOf(scriptNames);

  // ① 干净矩阵 ⇒ 绿
  const clean = judge({ planText: wrap(GOOD_ROWS), exists: okExists, scripts: SCRIPTS, chain });
  push('① 四档齐 + 门禁在链上 ⇒ 绿', clean.problems.filter((p) => !p.startsWith('C5')).length === 0, clean.problems.join(' | '));

  // ② 门禁不在链上 ⇒ C2 红
  const offChain = judge({ planText: wrap(GOOD_ROWS), exists: okExists, scripts: SCRIPTS, chain: '' });
  push('② 脚本存在但不在 check 链上 ⇒ C2 红', offChain.problems.some((p) => p.startsWith('C2')), offChain.problems.join(' | '));

  // ③ 落点不存在 ⇒ C3 红
  const missing = judge({ planText: wrap(GOOD_ROWS), exists: (p) => p !== 'c.png', scripts: SCRIPTS, chain });
  push('③ 截图落点不存在 ⇒ C3 红', missing.problems.some((p) => p.startsWith('C3') && p.includes('c.png')), missing.problems.join(' | '));

  // ④ 某一档空着 ⇒ C4 红并点名那一档
  const rowsWithHole = [...GOOD_ROWS];
  rowsWithHole[1] = '族1 | gate:check:demo1 | file:a.ts | spec: | file:c.png';
  const holed = judge({ planText: wrap(rowsWithHole), exists: okExists, scripts: SCRIPTS, chain });
  push('④ 真实浏览器那一档空着 ⇒ C4 点名', holed.problems.some((p) => p.startsWith('C4') && p.includes('真实浏览器')), holed.problems.join(' | '));

  // ⑤ 块被删 ⇒ C1 红
  const noBlock = judge({ planText: '# 没有矩阵', exists: okExists, scripts: SCRIPTS, chain });
  push('⑤ 矩阵块不在 ⇒ C1 红', noBlock.problems.some((p) => p.startsWith('C1')), noBlock.problems.join(' | '));

  // ⑥ 只留一行 ⇒ C5 下限红
  const shrunk = judge({ planText: wrap([GOOD_ROWS[0]]), exists: okExists, scripts: SCRIPTS, chain });
  push('⑥ 矩阵缩到一行 ⇒ C5 红（覆盖面在缩）', shrunk.problems.some((p) => p.startsWith('C5')), shrunk.problems.join(' | '));

  // ⑦ 拼错旗标 ⇒ 非 0 退
  let flagErr = '';
  try {
    await run(process.execPath, [join(here, 'check-ux-coverage.mjs'), '--self-tset'], { encoding: 'utf8' });
  } catch (err) {
    flagErr = String(err?.stderr ?? err?.message ?? '');
  }
  push('⑦ 拼错的旗标 ⇒ 非 0 退', flagErr !== '', flagErr === '' ? '退出码 0' : '非 0');

  let bad = 0;
  for (const arm of arms) {
    if (!arm.ok) bad += 1;
    console.log(`${arm.ok ? '  ✓' : '  ✘'} ${arm.name}${arm.ok ? '' : `  实际：${arm.detail}`}`);
  }
  if (bad > 0) {
    console.error(`self-test：${String(bad)} 枚臂不过。`);
    return true;
  }
  console.log(`self-test：${String(arms.length)} 枚臂全过。`);
  return false;
}

/* ── 入口 ───────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
/*
 * 🔴 拼错的旗标不许被当成"没给旗标"：那样 `--self-tset` 会静默跑真树并退 0，
 * 而调用方以为自己跑的是自测（本仓九枚臂一条没跑却退 0 那个形状的近亲）。
 */
const UNKNOWN = args.filter((arg) => !['--self-test', '--verbose'].includes(arg));
if (UNKNOWN.length > 0) {
  console.error(`不认识的旗标：${UNKNOWN.join(' ')}（只支持 --self-test / --verbose）`);
  process.exit(2);
}
if (args.includes('--self-test')) {
  process.exitCode = (await selfTest()) ? 1 : 0;
} else {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const { problems, rows } = judge({
    planText: readFileSync(join(ROOT, PLAN), 'utf8'),
    exists: (path) => existsSync(join(ROOT, path)),
    scripts: pkg.scripts ?? {},
    chain: String(pkg.scripts?.check ?? ''),
  });
  if (args.includes('--verbose')) console.log(`   现量：矩阵 ${String(rows.length)} 行`);
  if (problems.length > 0) {
    for (const p of problems) console.log(`✘ ${p}`);
    console.error(`四档覆盖门禁：${String(problems.length)} 条不过。`);
    process.exitCode = 1;
  } else {
    console.log(`✅ 四档覆盖：${String(rows.length)} 个控件族都有源码尺/语义测/真浏览器/截图四档，门禁都在 \`check\` 链上。`);
  }
}
