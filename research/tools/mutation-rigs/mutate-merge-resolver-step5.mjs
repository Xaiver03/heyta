#!/usr/bin/env node
/**
 * 合流执行器**第 5 步**的变异臂（`scripts/resolve-detail-pane-merge-mechanical.mjs`）。
 *
 * 第 5 步判的是：产物上断言 I 红了、且点名的路由**全在预审名单 `STANCE_ROSTER` 里**才补登记行。
 * 它最有价值的性质不是"会加"，而是"**名单外一律拒绝**" —— 一个只会加的登记器比没有更糟，
 * 因为它会把"没人想过这一面走哪一档"伪装成"合流已经处理过了"。
 * 所以这条臂量的正是那一面：把名单掏空 ⇒ 必须**拒绝**，而不是静默跳过、更不是照样加。
 *
 * 两趟一起看才算数（缺一趟就是"红可能另有成因"）：
 *   变异趟：`STANCE_ROSTER = {}` ⇒ 退出码 1 + 点名"不在预审名单里" + 拒绝数 ≥1
 *   对照趟：仓内真身（不带 --apply）⇒ **不许**出现那一句话，且第 5 步要给出预测行
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-merge-resolver-step5.mjs
 * 全程不写盘：两趟都是试运行，执行器自己铺的临时产物由它自己删。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const RESOLVER = 'scripts/resolve-detail-pane-merge-mechanical.mjs';
const DECL = 'const STANCE_ROSTER = {';

const src = readFileSync(path.join(ROOT, RESOLVER), 'utf8');
const start = src.indexOf(DECL);
if (start < 0) {
  console.log('ARM=SETUP ABORT=roster declaration not found');
  process.exit(2);
}
const end = src.indexOf('\n};', start);
if (end < 0) {
  console.log('ARM=SETUP ABORT=roster closing not found');
  process.exit(2);
}
// 分母：名单里到底有几枚。掏空之前先量，否则"恒 0 命中"和"名单本来就空"分不开。
const entries = [...src.slice(start, end).matchAll(/^\s{2}([A-Za-z0-9_]+):\s*`/gm)].map((m) => m[1]);
console.log(`ROSTER_ENTRIES=${entries.length} [${entries.join(' / ')}]`);
if (entries.length === 0) {
  console.log('ARM=SETUP ABORT=名单本来就是空的，这条臂没有可摘的东西（先给它补一枚再验）');
  process.exit(2);
}

const dir = mkdtempSync(path.join(tmpdir(), 'heyta-rig-step5-'));
const mutated = path.join(dir, 'resolver-no-roster.mjs');
writeFileSync(mutated, `${src.slice(0, start)}const STANCE_ROSTER = {};${src.slice(end + 3)}`, 'utf8');

const run = (cmd) => {
  const r = spawnSync('node', cmd, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return { rc: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
};

const results = [];

const arm = run([mutated]);
const refused = /第 5 步[^\n]*不在预审名单里/.test(arm.out);
const named = entries.every((v) => arm.out.includes(`不在预审名单里（${v}）`) || arm.out.includes(`${v}）⇒`));
const rejectCount = Number((/拒绝 (\d+) 条/.exec(arm.out) || [0, 0])[1]);
const armOk = arm.rc === 1 && refused && named && rejectCount >= 1;
console.log(`ARM=NO_ROSTER rc=${arm.rc} 拒绝=${rejectCount} 点名拒绝=${refused} 每个面都被点名=${named} VERDICT=${armOk ? 'OK' : 'NOT_AS_EXPECTED'}`);
results.push(armOk);

const ctl = run([RESOLVER]);
const ctlRefused = /第 5 步[^\n]*不在预审名单里/.test(ctl.out);
const ctlHasStep5 = ctl.out.includes('第 5 步');
// 对照趟允许 rc=0 或 1（产物里那两枚产品 marker 与台账同号本来就会让它非零），
// 但**不许**因为"名单外"而拒绝 —— 那是变异趟独有的症状。
const ctlOk = !ctlRefused && ctlHasStep5;
console.log(`ARM=CONTROL rc=${ctl.rc} 有第5步预测行=${ctlHasStep5} 误报名单外=${ctlRefused} VERDICT=${ctlOk ? 'OK' : 'NOT_AS_EXPECTED'}`);
results.push(ctlOk);

rmSync(dir, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`RIG_RESULT=${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
