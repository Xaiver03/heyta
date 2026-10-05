#!/usr/bin/env node
/**
 * 合流执行器**回读验真那一档的尺子归属**的变异臂（`scripts/resolve-detail-pane-merge-mechanical.mjs`）。
 *
 * 要防的东西很小、也很难在输出里看出来：`.mjs` 那一支原来写 `errs = []`，
 * 于是它和 TS/CSS 两档打印**同一个形状**的"语法诊断 0 条"，而那一档根本没解析过任何东西。
 * "没看"被打印成"看了、没事"（工单 §8.120 给预检补第三/第四档是同一件事，§3.2 那条
 * "白名单外只打印不判定"是它的祖先）。现在它打的是"未静态解析（由下面那行真跑 RC 定性）"，
 * 并且有一行**分母**说这一趟里有几枚没被静态看过。
 *
 * 三趟一起看才算数：
 *   对照趟：仓内真身 `--apply` ⇒ 必须同时出现 ①"未静态解析=1 枚" ②真跑 RC 那行 ③**不许**再有"语法诊断 0 条"
 *   变异趟 A：把 `errs = null` 换回 `errs = []` ⇒ 分母行必须消失（证明它是**派生**的，不是写死的文案）
 *   变异趟 B：摘掉 `notJudged.push(rel)` ⇒ 分母行也必须消失（证明"未判"是被**计数**的一档，不是一句措辞）
 *
 * 全程不写仓库：执行器自己铺的临时产物由它自己删；两趟变异跑的都是 `research/` 之外的一次性副本。
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-merge-resolver-verify-legs.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const RESOLVER = 'scripts/resolve-detail-pane-merge-mechanical.mjs';
const src = readFileSync(path.join(ROOT, RESOLVER), 'utf8');

const sub1 = (label, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) {
    console.log(`ARM=${label} ABORT=锚点命中 ${n} 次（要 1 次）：${JSON.stringify(from).slice(0, 80)}`);
    process.exit(2);
  }
  return src.replace(from, to);
};

const dir = mkdtempSync(path.join(tmpdir(), 'heyta-rig-verify-legs-'));
const runCopy = (label, text) => {
  const p = path.join(dir, `${label}.mjs`);
  writeFileSync(p, text, 'utf8');
  const r = spawnSync('node', [p, '--apply'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { rc: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const runReal = () => {
  const r = spawnSync('node', [RESOLVER, '--apply'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { rc: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
};

// 分母前提：不写死枚数 —— 从**对照趟的输出**里取，将来射程里多一枚 .mjs 也不需要改这个臂台。
const DENOM_SEEN = /未静态解析=(\d+) 枚/;
console.log('PRECHECK 分母从对照趟那行现取（写死枚数就是第二份抄件）');
if (!/if \(rel\.endsWith\('\.mjs'\)\) errs = null;/.test(src)) {
  console.log('ARM=SETUP ABORT=射程里没有 .mjs 那一支，这三趟没有对象');
  process.exit(2);
}

const results = [];

// —— 对照趟
let baselineDenom = 0;
{
  const t = runReal();
  const m = DENOM_SEEN.exec(t.out);
  baselineDenom = m ? Number(m[1]) : 0;
  const hasDenom = !!m && baselineDenom > 0;
  const hasRunLine = /复跑 RC=\d+/.test(t.out);
  const fakeZero = /语法诊断 0 条/.test(t.out);
  const ok = hasDenom && hasRunLine && !fakeZero;
  console.log(
    `ARM=CONTROL rc=${t.rc} 分母=${baselineDenom} 真跑RC行=${hasRunLine} 残留伪0条=${fakeZero} VERDICT=${ok ? 'OK' : 'NOT_AS_EXPECTED'}`,
  );
  results.push(ok);
}
if (baselineDenom === 0) {
  console.log('ARM=SETUP ABORT=对照趟的分母是 0 ⇒ 后面两趟"分母消失"没有对象，先修对照趟');
  rmSync(dir, { recursive: true, force: true });
  process.exit(2);
}

// —— 变异趟 A：把 .mjs 那一档改回"伪装的 0 条"
{
  const t = runCopy('arm-a', sub1('A', 'if (rel.endsWith(\'.mjs\')) errs = null;', 'if (rel.endsWith(\'.mjs\')) errs = [];'));
  const hasDenom = /未静态解析=\d+ 枚/.test(t.out);
  const fakeZero = /语法诊断 0 条/.test(t.out) || /语法=0 条/.test(t.out);
  // 这一趟要的是"分母消失"：它证明那一行是被计数派生的，而不是谁手写死的一句漂亮话。
  const ok = !hasDenom && fakeZero;
  console.log(`ARM=A_FAKE_ZERO rc=${t.rc} 分母行仍在=${hasDenom} 出现0条形状=${fakeZero} VERDICT=${ok ? 'OK' : 'NOT_AS_EXPECTED'}`);
  results.push(ok);
}

// —— 变异趟 B：措辞留着，但不计数
{
  const t = runCopy('arm-b', sub1('B', 'if (unjudged) notJudged.push(rel);', 'if (false) notJudged.push(rel);'));
  const hasDenom = /未静态解析=\d+ 枚/.test(t.out);
  const stillSaysUnparsed = /未静态解析（/.test(t.out);
  // 症状只出现在逐文件那一行、分母行整条消失 ⇒ "未判"不再是一档可核对的量。
  const ok = !hasDenom && stillSaysUnparsed;
  console.log(`ARM=B_NO_COUNT rc=${t.rc} 分母行=${hasDenom} 措辞还在=${stillSaysUnparsed} VERDICT=${ok ? 'OK' : 'NOT_AS_EXPECTED'}`);
  results.push(ok);
}

rmSync(dir, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`RIG_RESULT=${passed}/${results.length} 期望=3/3（对照 + 两趟变异各自只在应该消失的那一栏上变化）`);
process.exit(passed === results.length ? 0 : 1);
