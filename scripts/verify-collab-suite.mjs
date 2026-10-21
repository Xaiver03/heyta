#!/usr/bin/env node
/**
 * verify:collab-suite —— 协作线五套验收的**串行载体**（计划 §9.3 M7）
 * ===================================================================
 *
 * ## 为什么要有它
 *
 * `verify:collab-{keys,sync,revoke,conflict,journey}` 五套脚本早就写好了，
 * 但**没有任何东西自动跑它们** —— 于是"这条线有验收"这件事的真实形状是
 * "上一次有人手动跑过，读数写在某个文档里"。判据不常驻，绿就会过期。
 *
 * 分工是照**成本**切的，不是照重要性：
 *
 * | 腿 | 需要什么 | 落在哪 |
 * |---|---|---|
 * | keys | 只要构建产物（真 WebCrypto，零服务端） | **直接进 `pnpm check` 链**（实测 0.3s） |
 * | sync / revoke / conflict / journey | 真 PostgreSQL + 真服务端（journey 还要真浏览器） | 由本脚本按序跑，登记在 `docs/agents/commands.md` |
 *
 * ⇒ keys 那一格进链；另外四格**在这里**有载具。谁"有没有载体"由
 * `check:collab-carrier` 钉，不靠这份注释。
 *
 * ## 三条形状约束（都是从本仓那族变异装置的纪律里来的）
 *
 * 1. **`ran` 必须落在读数里**：退出码 0 但**没打印 `RESULT=OK`** 的腿判 FAIL。
 *    一条没跑起来的腿和一条没牙的腿长得一模一样 —— 只看 rc 会把前者记成绿。
 * 2. **串行，一次一条**：这四套各自起服务端、各自占端口，并行会互相抢；
 *    本机还有测试内存闸门，并发套件会被拒。
 * 3. **期望值不写死**：腿的判据是"打印了 `RESULT=OK`"，步数只回显不比对 ——
 *    写死 `steps=9` 的那把尺会在别人合法加了一步之后报红，然后被人改松。
 *
 * 用法：
 *   node scripts/verify-collab-suite.mjs            # 跑全部四腿
 *   node scripts/verify-collab-suite.mjs revoke     # 只跑名字含 revoke 的腿
 *   node scripts/verify-collab-suite.mjs --self-test # 验这台装置自己能不能红
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 🔴 这张表就是 `check:collab-carrier` 读的**载具名册**：
 * 一枚 `verify:collab-*` 要么在 `pnpm check` 链里，要么在这里，否则那道门禁红。
 * 加验收而不加载具，正是这条线以前坏过的形状。
 */
const ROSTER = ['sync', 'revoke', 'conflict', 'journey'];

const GREEN = 'RESULT=OK';

/** 跑一条腿；返回 `{ verdict, detail }`。`script` 参数让自检能塞夹具进去。 */
function runLeg(name, script = join(ROOT, `scripts/verify-collab-${name}.mjs`)) {
  if (!existsSync(script)) {
    return { verdict: 'FAIL', detail: `脚本不存在：${script}` };
  }
  const r = spawnSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const okLine = out.split('\n').find((l) => l.startsWith('RESULT=')) ?? '(没有 RESULT= 行)';
  if (r.status !== 0) {
    return { verdict: 'FAIL', detail: `rc=${r.status} ｜ ${okLine}` };
  }
  if (!out.includes(GREEN)) {
    // 🔴 约束 1：退出 0 而没打印绿读数 = 没跑起来，不许记成绿。
    return { verdict: 'FAIL', detail: `rc=0 但没有 ${GREEN} —— 这条腿**没跑起来**，不是跑过了 ｜ ${okLine}` };
  }
  return { verdict: 'PASS', detail: okLine };
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-collab-suite-'));
  const write = (name, body) => {
    const p = join(dir, `${name}.mjs`);
    writeFileSync(p, body);
    return p;
  };
  let failures = 0;
  const cases = [
    ['打印绿读数的腿 ⇒ PASS', write('ok', 'console.log("RESULT=OK steps=1");\n'), 'PASS'],
    ['退出 0 却什么都不打印 ⇒ FAIL（约束 1）', write('silent', 'console.log("跑了但没读数");\n'), 'FAIL'],
    ['打印红读数的腿 ⇒ FAIL', write('red', 'console.log("RESULT=FAIL step=2 reason=boom");\nprocess.exit(1);\n'), 'FAIL'],
  ];
  try {
    for (const [label, script, expect] of cases) {
      const got = runLeg('fixture', script).verdict;
      const hit = got === expect;
      console.log(`${hit ? '✅' : '❌'} 臂 ${label}（期望 ${expect}，实得 ${got}）`);
      if (!hit) failures += 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n臂数 ${cases.length}（由本脚本自己打印），失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();

const filter = process.argv.slice(2).find((a) => !a.startsWith('-'));
const selected = filter ? ROSTER.filter((n) => n.includes(filter)) : ROSTER;
if (selected.length === 0) {
  // 过滤器打空也判红：否则"跑错了名字"长得像"全绿"。
  console.error(`SUITE=FAIL reason=没有腿被选中（${filter} 不在名册 ${ROSTER.join('/')} 里）`);
  process.exit(1);
}
const legs = selected.map((name) => {
  process.stdout.write(`\n── 腿 ${name} ${'─'.repeat(Math.max(0, 46 - name.length))}\n`);
  const { verdict, detail } = runLeg(name);
  console.log(`${verdict === 'PASS' ? '✅' : '❌'} verify:collab-${name} — ${detail}`);
  return { name, verdict };
});

const failed = legs.filter((l) => l.verdict !== 'PASS');
console.log(
  `\nSUITE=${failed.length === 0 ? 'OK' : 'FAIL'} legs=${legs.length} failed=${failed.length}` +
    (failed.length ? `（${failed.map((l) => l.name).join(' / ')}）` : ''),
);
process.exit(failed.length === 0 ? 0 : 1);
