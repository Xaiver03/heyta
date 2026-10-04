#!/usr/bin/env node
/**
 * `scripts/check-widgets.mjs` 那一条"黄金夹具"规则的档位装置。
 *
 * 为什么要它：这一条规则原来是 `try { pnpm … } catch { 报"夹具不一致" }` ——
 * "runner 没跑成"与"夹具真的坏了"**同形**，而后者报的是"四端解析器的锁坏了"。
 * 修法把它分成三档（0 通过 / 1 违规 / 2 没跑成=未判），但**分档本身必须能被证伪**：
 * 只加一档"未判"而不证明"真违规仍会红"，等于把一个假红换成一条永真的跳过。
 *
 * 🔴 臂只改门禁脚本里那一处命令串（换成打假汇总的 shim），跑完按 md5 复原 ——
 * 不改 `packages/widget-core` 那枚 spec、不碰夹具文件（夹具是四端共享资产）；
 * A1b 只是把那枚 spec **原样跑一遍**取真值（只读，不写任何产物）。
 *
 * 跑法：node research/tools/mutation-rigs/mutate-widgets-unjudged.mjs
 * 退出码：0 = 全部臂符合预期；1 = 有臂不符合（分档没牙或臂写错，都是这次改动的缺陷）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const GATE = 'scripts/check-widgets.mjs';
const ORIG = readFileSync(`${ROOT}/${GATE}`, 'utf8');
const BASE = createHash('md5').update(ORIG).digest('hex');
const scratch = mkdtempSync(join(tmpdir(), 'wdg-'));

/** 打一串"看起来像 vitest 汇总"的输出并按指定码退出 —— 用来伪造 runner 的三种结局。 */
const shim = (name, body, code) => {
  const p = join(scratch, name);
  writeFileSync(p, `#!/bin/sh\ncat <<'EOF'\n${body}\nEOF\nexit ${code}\n`, 'utf8');
  chmodSync(p, 0o755);
  return p;
};
const sPass = shim('pass.sh', ' RUN  v5.0.1\n Test Files  1 passed (1)\n      Tests  4 passed (4)\n   Duration 200ms', 0);
const sFail = shim('fail.sh', ' RUN  v5.0.1\n Test Files  1 failed (1)\n      Tests  1 failed | 3 passed (4)\n AssertionError: expected "x" to be "y"', 1);
const sZero = shim('zero.sh', ' RUN  v5.0.1\n Test Files  0 passed (0)\n      Tests  0 passed (0)', 0);
const sNoSummary = shim('nosum.sh', 'Scope: all 21 workspace projects\n[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY] Aborted removal of modules directory due to no TTY', 1);

const run = (src) => {
  writeFileSync(`${ROOT}/${GATE}`, src, 'utf8');
  const r = spawnSync(process.execPath, [`${ROOT}/${GATE}`], { encoding: 'utf8', cwd: ROOT });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
};
const restore = () => writeFileSync(`${ROOT}/${GATE}`, ORIG, 'utf8');

// 定位那处调用**本身**，不写死它的参数形状（形状变了要响亮失败，不能静默"没换"然后假装臂跑过了）。
const CALL_RE = /spawnSync\(\s*'pnpm',\s*\[[\s\S]*?\],/;
const withShim = (src, path) => {
  if (!CALL_RE.test(src)) throw new Error('找不到夹具规则里那处 spawnSync(pnpm, […]) —— 形状变了，臂没有对象');
  return src.replace(CALL_RE, `spawnSync(\n    ${JSON.stringify(path)},\n    [],`);
};
const ENV_LINE = "      env: { ...process.env, NO_COLOR: '1' },\n";
const STRIP = ".replace(/\\u001b\\[[0-9;]*m/g, '')";
const FLAG_LINE = "      '--config.verify-deps-before-run=false',\n";

let pass = 0;
let bad = 0;
const rows = [];
const check = (name, cond, detail) => {
  rows.push(`${cond ? '  ✅' : '  🔴'} ${name}${detail ? ` —— ${detail}` : ''}`);
  if (cond) pass += 1;
  else bad += 1;
};

// A0 —— 真载体（本检出：pnpm exec 跑得动）：必须**真跑出结果**，既不谎报违规也不停在"未判"
const a0 = run(ORIG);
check(
  'A0 真载体 → 真判：RC=0、绿句在场，且不报"没跑成"',
  a0.rc === 0 && /小组件边界完好/.test(a0.out) && !/没跑成 ⇒ 等于没验过/.test(a0.out),
  `RC=${a0.rc}｜首行 ${a0.out.split('\n')[0].slice(0, 56)}`,
);

// A1 —— 历史对照：喂"该文件历史里最新一版**没有**这一档"的代码
// 🔴 为什么不按 HEAD 取（第一版就是这么写的）：**这一档提交进 HEAD 的那一刻**，
//    `git show HEAD:<gate>` 就含未判档了，A1 立刻退化成一条永不成立的臂 ——
//    提交后实测 🔴，detail 印着 `含未判档=true`。这是本项目记过的那类"对照版按 blob 取、
//    而且不能按 HEAD 取"的又一次现身，只是这次的"被吸收"是**我自己那一笔提交**。
// 🔴 也不手搓脱牙：摘法是我编的，它坏得和真发生过的一不一样还得另外证。
// ⇒ 办法只有一个：沿该文件自己的历史往回走，取第一个"不含这一档且不等于当前版"的 blob。
const revs = execFileSync('git', ['-C', ROOT, 'log', '--format=%H', '--', GATE], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
let control = null;
for (const [i, rev] of revs.entries()) {
  const src = execFileSync('git', ['-C', ROOT, 'show', `${rev}:${GATE}`], { encoding: 'utf8' });
  if (!/fixturesUnjudged/.test(src) && src !== ORIG) {
    control = { rev, src, i };
    break;
  }
}
if (control === null) {
  restore();
  console.error(`🔴 历史里找不到"还没有未判档"的那一版（走了 ${String(revs.length)} 版）⇒ A1 没有对象，装置不算跑成`);
  process.exit(1);
}
const a1 = run(control.src);
check(
  'A1 同一棵树喂"还没有未判档"那一版（按该文件历史取 blob，不按 HEAD）→ RC=1 且谎报"黄金夹具不一致"，而它直接跑那枚 spec 是 4 passed',
  a1.rc === 1 && /黄金夹具与重建结果\*\*不一致\*\*/.test(a1.out),
  `对照版 ${control.rev.slice(0, 8)}｜往回第 ${String(control.i + 1)} 版｜RC=${a1.rc}｜它带出的"代码"首行 ${(a1.out.match(/代码：(\S{0,60})/) || ['', ''])[1]}`,
);
// A1p —— A1 的前置：当前版必须**有**这一档。没有它，A1 那次红说的是"有人把这一档拿掉了"，
//        而不是"这次补的是真发生过的假红"。
const currentHasUnjudged = /fixturesUnjudged/.test(ORIG);
check(
  'A1p 当前门禁含未判档（A1 那条红才是在证"历史假红"，不是在证"这一档被人拿掉了"）',
  currentHasUnjudged,
  `当前版含未判档=${String(currentHasUnjudged)}`,
);
// A1b —— 真值对照：同一棵树里**直接**跑那枚 spec，证明 A1 的红是假红
// ⚠️ 三条读数纪律都在这一臂上：① vitest 的汇总要 `NO_COLOR=1` 才拿得到纯文本
//    （带 ANSI 时 needle 恒 0 命中，看起来像"没跑"）；② 判绿只认 summary 行 **和** 退出码；
//    ③ 这一臂自己也要有"没跑成"那一档 —— 在没装依赖/没 build 过的裸检出里，vitest 打得开但
//    收不到用例（实测 `Test Files 1 failed (1) / Tests  no tests`）。那**不是臂不符合，是载体未判**：
//    让它计入"9 臂里红一臂"就是这个装置自己犯它抓的那个错。
const VITEST = join(ROOT, 'packages/widget-core/node_modules/.bin/vitest');
const direct = spawnSync(VITEST, ['run', 'tests/fixtures.spec.ts'], {
  cwd: join(ROOT, 'packages/widget-core'),
  encoding: 'utf8',
  env: { ...process.env, NO_COLOR: '1' },
});
const directOut = `${direct.stdout}${direct.stderr}`.replace(/\u001b\[[0-9;]*m/g, '');
if (!/^\s*Tests\s+\d+\s+(passed|failed)/m.test(directOut)) {
  restore();
  rmSync(scratch, { recursive: true, force: true });
  console.error('🔴 载体未判：直接跑那枚 spec 没有产出 `Tests N passed|failed` 汇总行 ⇒ A1b 这条真值臂没有对象，装置不算跑成（不是"臂不符合"）。');
  console.error(`   二进制=${existsSync(VITEST) ? '在' : '不在'}｜exit=${String(direct.status)}｜vitest 那两行=${(directOut.match(/(Test Files|Tests)[^\n]*/g) || ['<一行都没打>']).join(' / ').trim()}`);
  console.error('   要真跑这一臂：在装了依赖并 `pnpm -r build` 过的检出里跑（主检出或本仓 linked worktree）。');
  process.exit(2);
}
const a1b = direct.status === 0 && /Tests\s+4 passed/.test(directOut) && /Test Files\s+1 passed/.test(directOut);
check(
  'A1b 真值：用该包自己的 vitest 直接跑那枚 spec → 4 passed / RC=0 ⇒ A1 那句"夹具不一致"确证是假红',
  a1b,
  `RC=${direct.status}｜${(directOut.match(/Tests\s+\d+ passed[^\n]*/) || ['<剥色后仍没有汇总行>'])[0].trim()}`,
);

// A2 —— 真违规仍有牙：runner 打出 failed 汇总且退非零
const a2 = run(withShim(ORIG, sFail));
check(
  'A2 runner 报 Tests 1 failed → RC=1 且违规带着 vitest 自己那行汇总（不是只带退出码）',
  a2.rc === 1 && /黄金夹具与重建结果\*\*不一致\*\*/.test(a2.out) && /Tests\s+1 failed \| 3 passed/.test(a2.out),
  `RC=${a2.rc}`,
);

// A3 —— 跑到了但一条都没收集：那也是"没验过"，不许当绿
const a3 = run(withShim(ORIG, sZero));
check(
  'A3 runner 打出 Tests 0 passed → RC=2 未判并写明"spec 没被收集到"（0 条用例上的"通过"是永真）',
  a3.rc === 2 && /没被收集到/.test(a3.out),
  `RC=${a3.rc}`,
);

// A4 —— 正对照：runner 打出 4 passed 且退 0 → 这一条不报违规，整体回到各规则自己的读数
const a4 = run(withShim(ORIG, sPass));
check(
  'A4 对照：runner 真跑出 4 passed → 这一条不产违规（RC 由其余规则决定，不再是 2）',
  a4.rc !== 2 && !/黄金夹具与重建结果\*\*不一致\*\*/.test(a4.out) && !/没跑成/.test(a4.out),
  `RC=${a4.rc}｜${(a4.out.split('\n').find((l) => /小组件边界/.test(l)) || '（没打结论行）').slice(0, 70)}`,
);

// A5 —— 同形对照：shim 打出与 A6 那种真实故障逐字同形的文本（无汇总行），也必须走未判档
//        ⇒ 分档认的是"有没有被调方的汇总"，不是"日志里有没有 ERR 字样"。
const a5 = run(withShim(ORIG, sNoSummary));
check(
  'A5 shim 原样复现 pnpm 故障（无汇总行）→ RC=2 未判，证明分档认的是"跑成没跑成"而不是 grep 错误字样',
  a5.rc === 2 && /没跑成 ⇒ 等于没验过/.test(a5.out),
  `RC=${a5.rc}`,
);

// A6 —— 减掉"载体修复"那一半：不带 `--config.verify-deps-before-run=false` ⇒ 本检出退回未判。
//       没有这一臂，"给命令加个 flag"就只是一句读起来像改进的话；它到底有没有让判据真跑起来，只有减法能答。
const noFlag = ORIG.replace(FLAG_LINE, '');
const a6 = run(noFlag);
check(
  'A6 摘掉 `--config.verify-deps-before-run=false` → 本检出 RC=2 未判（那个 flag 是承重的：它决定这道门禁在本检出**能不能真判**）',
  noFlag !== ORIG && a6.rc === 2 && /没跑成 ⇒ 等于没验过/.test(a6.out),
  `替换生效=${noFlag !== ORIG}｜RC=${a6.rc}`,
);

// A7 / A8 —— 防色那一档的**两层各分量**：一层单独够，两层一起摘就瞎。
// 🔴 A8 是本装置里唯一"红的是判据自己的解析层"那一臂：汇总行带 ANSI 时 needle 恒 0 命中，
//    症状与"runner 没跑成"**逐字相同**（都走未判档）—— 也就是说一个能跑的判据会永久变成哑的，
//    而且哑得方向是"不产绿"，最容易被人当成"载体问题"放过去。
const noEnv = ORIG.replace(ENV_LINE, '');
const a7 = run(noEnv);
check(
  'A7 只摘 `NO_COLOR` → 仍 RC=0（剥色那一层单独就够 —— 两层不是冗余装饰）',
  noEnv !== ORIG && a7.rc === 0 && /小组件边界完好/.test(a7.out),
  `替换生效=${noEnv !== ORIG}｜RC=${a7.rc}`,
);
const noBoth = noEnv.replace(STRIP, '');
const a8 = run(noBoth);
check(
  'A8 两层一起摘 → RC=2 未判（带色的汇总行让 needle 恒 0 命中；这是"判据被 carrier 静默变哑"的形状）',
  noBoth !== noEnv && a8.rc === 2 && /没跑成 ⇒ 等于没验过/.test(a8.out),
  `两层都摘掉了=${noBoth !== noEnv}｜RC=${a8.rc}`,
);

restore();
const back = createHash('md5').update(readFileSync(`${ROOT}/${GATE}`, 'utf8')).digest('hex') === BASE;
const after = run(ORIG);
check('复原后复跑回到同一读数（RC=0 真判），且门禁文件逐字节回到原样', after.rc === 0 && back, `RC=${after.rc}｜BACK_TO_CLEAN=${back}`);

rmSync(scratch, { recursive: true, force: true });
for (const l of rows) console.log(l);
console.log(`\n结论：${pass}/${pass + bad} 臂符合预期${bad ? ' 🔴' : ' ✅'}`);
process.exit(bad ? 1 : 0);
