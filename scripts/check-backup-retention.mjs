#!/usr/bin/env node
/**
 * 备份留存窗口三方对账（ADR-0055 §5 第 1 块板的落地件）
 * =============================================================
 *
 * 拍板值：**14 天**，唯一事实源是 `server/scripts/backup.sh` 里那个
 * `RETENTION_DAYS="${RETENTION_DAYS:-14}"`。另外两处必须跟着它：
 *
 *   - `server/docs/backup-and-recovery.md`：环境变量表格 + crontab 示例（示例原先写着 3，
 *     那是抄来的一句话把窗口悄悄改了 4.7 倍 —— 而运维照示例配 cron，没人会去对表格）；
 *   - `packages/legal/src/documents/*.ts`：对外那两句（中「N 天内的备份副本」/ 英
 *     "Kept locally for **N days** … snapshot"）。**这两句进同意指纹**，所以数字只能由代码侧
 *     向文档侧对齐，不许反过来为了文档去改默认值。
 *
 * 为什么要有这一道：这三个数字分别是**运维读的**、**部署照抄的**、**对用户承诺的**。
 * 任何一方单独改动都不会有测试失败 —— 因为没有任何一层同时看过两处。法务那句一旦和实际
 * 窗口不一致，我们对外承诺的就是一个代码兑现不了的数字（而这正是本轮反复在修的那一类缺陷：
 * 承诺住在文档、事实住在代码，中间没有对账）。
 *
 * 🔴 读不到输入 = 红，不是"跳过"。三档来源各自至少要命中一次，命中数会打印出来：
 *    一门门禁看不见它声称在看的东西时，它的"通过"就是装饰（许可证门禁坏掉那次是同一个形状）。
 *
 * 用法：
 *   node scripts/check-backup-retention.mjs              # 对账当前工作树
 *   node scripts/check-backup-retention.mjs --self-test   # 逐臂证明它真的会红（臂数由它自己打印）
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SCRIPT_FILE = 'server/scripts/backup.sh';
const RUNBOOK_FILE = 'server/docs/backup-and-recovery.md';
const LEGAL_DIR = 'packages/legal/src/documents';
const LEGAL_FILES = ['privacy.ts', 'data-rights.ts', 'third-parties.ts'];

const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

/** 从脚本里取那个默认值 —— 它是唯一事实源。 */
function scriptDefault(text) {
  const m = /RETENTION_DAYS="\$\{RETENTION_DAYS:-(\d+)\}"/.exec(text);
  return m ? { value: Number(m[1]), line: lineOf(text, m.index) } : null;
}

/** runbook：表格行与 `RETENTION_DAYS=N` 形式的示例都要读。 */
function runbookValues(text) {
  const found = [];
  const table = /\|\s*`RETENTION_DAYS`\s*\|\s*`(\d+)`/g;
  for (let m; (m = table.exec(text)); ) found.push({ value: Number(m[1]), line: lineOf(text, m.index), kind: '表格默认值' });
  const inline = /RETENTION_DAYS=(\d+)/g;
  for (let m; (m = inline.exec(text)); ) found.push({ value: Number(m[1]), line: lineOf(text, m.index), kind: 'cron 示例' });
  return found;
}

/** 法务：中文那句 + 英文那句。锚点写在代码里，命中几处就报几处。 */
function legalValues(textByFile) {
  const found = [];
  for (const [file, text] of Object.entries(textByFile)) {
    const zh = /(\d+)\s*天内的备份/g;
    for (let m; (m = zh.exec(text)); ) found.push({ value: Number(m[1]), line: lineOf(text, m.index), kind: '中文承诺', file });
    const en = /for \*\*(\d+) days?\*\*[^.]*?(?:snapshot|backup)/gi;
    for (let m; (m = en.exec(text)); ) found.push({ value: Number(m[1]), line: lineOf(text, m.index), kind: '英文承诺', file });
  }
  return found;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * 判断本身只有一个函数：给它三组读数，它返回不一致的清单。
 * 🔴 失败判据不许抄三遍（许可证门禁那次就是"同一个判断写三次、三次都漏了一档"）。
 */
function disagreements({ script, runbook, legal, legalFilesPresent }) {
  const problems = [];
  if (script === null) problems.push(`${SCRIPT_FILE} 里读不到 RETENTION_DAYS 的默认值 —— 唯一事实源不见了`);
  if (runbook.length === 0) problems.push(`${RUNBOOK_FILE} 里读不到任何 RETENTION_DAYS 读数（表格与示例都没命中）`);
  if (!legalFilesPresent.zh) problems.push('法务中文那句（"N 天内的备份"）一处都没命中 —— 门禁读不到它的输入');
  if (!legalFilesPresent.en) problems.push('法务英文那句（"Kept locally for **N days**"）一处都没命中 —— 中英成对的那一半消失了');
  if (script === null) return problems;
  for (const r of runbook) {
    if (r.value !== script) {
      problems.push(`${RUNBOOK_FILE}:${r.line} 的${r.kind}是 ${r.value}，脚本默认是 ${script}`);
    }
  }
  for (const l of legal) {
    if (l.value !== script) {
      problems.push(`${l.file}:${l.line} 的${l.kind}写的是 ${l.value} 天，脚本默认是 ${script} 天`);
    }
  }
  return problems;
}

function collect() {
  const script = scriptDefault(read(SCRIPT_FILE))?.value ?? null;
  const runbook = runbookValues(read(RUNBOOK_FILE));
  const legal = legalValues(
    Object.fromEntries(LEGAL_FILES.map((f) => [`packages/legal/src/documents/${f}`, safeRead(join(LEGAL_DIR, f))])),
  );
  return {
    script,
    runbook,
    legal,
    legalFilesPresent: {
      zh: legal.some((v) => v.kind === '中文承诺'),
      en: legal.some((v) => v.kind === '英文承诺'),
    },
  };
}

function safeRead(rel) {
  try {
    return read(rel);
  } catch {
    return '';
  }
}

/**
 * 阳性对照与逐臂自测：全部走 `disagreements()` 这个**同一个**判断，
 * 不另写一套"期望它红"的逻辑 —— 否则自测证明的是自测，不是门禁。
 */
function selfTest() {
  const base = { script: 14, runbook: [{ value: 14, line: 45, kind: '表格默认值' }], legal: [
    { value: 14, line: 429, kind: '中文承诺', file: 'privacy.ts' },
    { value: 14, line: 1019, kind: '英文承诺', file: 'privacy.ts' },
  ], legalFilesPresent: { zh: true, en: true } };
  const arms = [
    { name: '基线（三处一致）⇒ 必须不红', input: base, expectRed: false },
    { name: '脚本默认改成 3 ⇒ 必须红', input: { ...base, script: 3 }, expectRed: true },
    { name: 'runbook 的 cron 示例还是 3 ⇒ 必须红', input: { ...base, runbook: [...base.runbook, { value: 3, line: 35, kind: 'cron 示例' }] }, expectRed: true },
    { name: '法务中文改成 30 ⇒ 必须红', input: { ...base, legal: [{ ...base.legal[0], value: 30 }, base.legal[1]] }, expectRed: true },
    { name: '法务英文那句被删（成对的另一半消失）⇒ 必须红', input: { ...base, legal: [base.legal[0]], legalFilesPresent: { zh: true, en: false } }, expectRed: true },
    { name: '唯一事实源整行被改形（读不到默认值）⇒ 必须红', input: { ...base, script: null }, expectRed: true },
  ];
  let failed = 0;
  arms.forEach((arm, i) => {
    const problems = disagreements(arm.input);
    const red = problems.length > 0;
    const ok = red === arm.expectRed;
    if (!ok) failed += 1;
    console.log(`臂 ${i}（共 ${arms.length} 臂）${ok ? 'OK' : 'FAIL'} — ${arm.name}：读到 ${problems.length} 条不一致`);
  });
  console.log(`SELF_TEST=${failed === 0 ? 'OK' : 'FAIL'} arms=${arms.length}`);
  return failed === 0 ? 0 : 1;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
}

const readings = collect();
const problems = disagreements(readings);

const zhCount = readings.legal.filter((v) => v.kind === '中文承诺').length;
const enCount = readings.legal.filter((v) => v.kind === '英文承诺').length;
console.log(
  `RETENTION_SCRIPT=${readings.script ?? 'UNREADABLE'} RETENTION_RUNBOOK=${readings.runbook
    .map((r) => r.value)
    .join('/')} RETENTION_LEGAL_ZH=${zhCount} RETENTION_LEGAL_EN=${enCount}`,
);

if (problems.length > 0) {
  console.error('备份留存窗口三方不一致：');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('唯一事实源是 server/scripts/backup.sh 的默认值；要改窗口就同时改 runbook 与法务两句（法务改动进同意指纹，需产品负责人确认）。');
  console.error('RESULT=FAIL');
  process.exit(1);
}

console.log(`RESULT=OK days=${readings.script}`);
