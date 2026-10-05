#!/usr/bin/env node
/**
 * 把 `pnpm check` 拆成逐段跑，产出一张"段名 → RC → 首行原因"的表。
 *
 * 为什么要拆：`scripts.check` 是 68 段 `&&` 串起来的，**第一段红就整体退出**，
 * 于是"完整 check 读数"只会得到一个失败点，看不出后面 67 段的状态 ——
 * 而收尾要的恰恰是"哪几段红、红在谁手里"。
 *
 * 用法（`HEYTA_REPO_ROOT` 是**必填**，见下面那条注释）：
 *   HEYTA_REPO_ROOT=$PWD node research/tools/check-segments.mjs
 *   HEYTA_REPO_ROOT=$PWD node research/tools/check-segments.mjs --only 名   # 可重复
 *   HEYTA_REPO_ROOT=$PWD node research/tools/check-segments.mjs --skip 名   # 可重复
 * 输出：终端摘要 + `/tmp/check-segments.tsv`（明细表；它是**读数**不是证据，
 * 所以落 `/tmp` 是有意的 —— 要留的读数请抄进计划文档并带日期与载体）。
 * 退出码 = 有红则 1。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = process.env.HEYTA_REPO_ROOT;
if (!repoRoot) {
  console.error('必须设 HEYTA_REPO_ROOT=<检出根目录>（本脚本可能从任何地方被调用，没有可信的默认值）');
  process.exit(2);
}
const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const chain = pkg.scripts.check;
if (typeof chain !== 'string' || chain.length === 0) {
  console.error('package.json 里没有 scripts.check');
  process.exit(2);
}
// 🔴 段的来源是** package.json 里那条真串**，不是抄一份名单 —— 抄件一定会漂。
const segments = chain.split('&&').map((s) => s.trim()).filter((s) => s.length > 0);

const args = process.argv.slice(2);
const only = [];
const skip = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--only') only.push(args[++i] ?? '');
  else if (args[i] === '--skip') skip.push(args[++i] ?? '');
}
const picked = segments.filter(
  (cmd) =>
    (only.length === 0 || only.some((o) => cmd.includes(o))) &&
    !skip.some((s) => cmd.includes(s)),
);
// 🔴 选择器必须报分母：`--only` 打错一个字母会挑出 0 段并"全绿"。
console.log(`check 共 ${segments.length} 段，本次跑 ${picked.length} 段`);
if (picked.length === 0) {
  console.error('挑出 0 段 —— 选择器写错了，拒跑。');
  process.exit(2);
}

const rows = [];
let reds = 0;
for (const cmd of picked) {
  const started = Date.now();
  const res = spawnSync(cmd, {
    cwd: repoRoot,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', CI: 'true' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const rc = res.status ?? -1;
  if (rc !== 0) reds += 1;
  // 首行原因：取输出里最后几条像结论的话（多数门禁把判断打在最后一行）。
  const tail = out.trim().split('\n').filter(Boolean).slice(-3).join(' ⏎ ');
  const secs = Math.round((Date.now() - started) / 1000);
  rows.push({ cmd, rc, secs, tail: tail.slice(0, 400) });
  console.log(`${rc === 0 ? '✅' : '❌'} rc=${rc} ${secs}s  ${cmd}`);
  if (rc !== 0) console.log(`   ↳ ${tail.slice(0, 400)}`);
}

writeFileSync(
  '/tmp/check-segments.tsv',
  rows.map((r) => `${r.rc}\t${r.secs}\t${r.cmd}\t${r.tail.replace(/\t/gu, ' ')}`).join('\n') + '\n',
  'utf8',
);
console.log(`\n判定 ${picked.length} 段：${picked.length - reds} 绿 / ${reds} 红；明细在 /tmp/check-segments.tsv`);
process.exit(reds === 0 ? 0 : 1);
