#!/usr/bin/env node
/**
 * 变异装置：补二**界面那一半**的三枚判据能不能红（ADR-0067）
 * =================================================================
 *
 * 它不改产品行为，只回答一句质疑：「`share-move-affordance.spec.tsx` 绿了，是因为
 * "这个动作摆没摆出来"真的被盯着，还是因为那三句谁都拦不住？」
 *
 * 这一格尤其需要两臂**对着拉**，因为它的两种坏法方向相反，而单钉任何一侧都会让另一侧
 * 混过去：
 *
 *  A `guard-always-open`   装配那一行退成"什么都不挡"（= 补二界面那半句**没做**时的原样）。
 *     症状：三处菜单都把注定失败的目的地摆给用户，而单条那一支报的是一句假话
 *     （"你的改动还在本地，可以重试"）。
 *  B `guard-always-blocked` 反过来"什么都挡"。这一枚才是"整枚下拉永远灰掉"那种
 *     一眼看上去能过的实现 —— 只钉"共享的那条灰掉"就完全测不到它（A 也满足）。
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：① 基线必须先绿且那份 spec 真跑到
 * （否则退 2）；② 每臂**红集精确匹配**（条数 + 缺席 + 多红三条都过）；③ 还原后 md5
 * 逐字节比对 + 复跑基线。
 *
 * 🔴 原地改工作树（目标文件归本线），动手前验它相对 HEAD 干净，脏就退 **3**。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-move-affordance.mjs
 * 读数：`ARMS=pass (2/2)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');
const PKG = join(ROOT, 'apps/web');
const TARGET = 'apps/web/src/features/share/share-move-guards.ts';
const SPECS = 'tests/share-move-affordance.spec.tsx';

const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';
const NEEDLE = '  return isCrossListMoveBlocked(currentState(), \'TASK\', taskId, destinationProjectId);\n';

const ARMS = [
  {
    id: 'guard-always-open',
    why: '装配那一行退成"什么都不挡"（补二的界面那半句没做时的原样：动作摆出来，点了撞墙）',
    rep: `  // ${MARK}\n  return false;\n`,
    mustInclude: ['判据与派发器同源', '整枚下拉灰掉', '反向臂'],
    expect: 3,
  },
  {
    id: 'guard-always-blocked',
    why: '反过来什么都挡 —— 只钉"共享的那条灰掉"测不到这一枚（它同样满足那一句）',
    rep: `  // ${MARK}\n  return true;\n`,
    mustInclude: ['判据与派发器同源', '反向臂'],
    expect: 2,
  },
];

const md5 = (s) => createHash('md5').update(s).digest('hex');
const say = (line) => process.stdout.write(`${line}\n`);
const git = (args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).stdout ?? '';

const sh = (cmd) =>
  spawnSync(cmd, {
    cwd: PKG,
    shell: '/bin/sh',
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 1 << 28,
  });

function parseVitest(out) {
  const sum = /^\s*Tests\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  const failed = Number(/(\d+) failed/.exec(sum ?? '')?.[1] ?? NaN);
  const titles = [...out.matchAll(/^\s*×\s+(.+?)\s+\d+ms\s*$/gm)].map((m) => m[1]);
  const files = /^\s*Test Files\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  return { sum, failed, titles, files };
}

const abs = join(ROOT, TARGET);
if (!existsSync(abs)) {
  say(`ARMS=FAIL reason=target-missing ${TARGET}`);
  process.exit(1);
}
const dirty = git(['status', '--porcelain', '--', TARGET]).trim();
if (dirty !== '') {
  say(`ARMS=ENV dirty-worktree —— ${TARGET} 相对 HEAD 有未提交改动，装置不在别人的改动上动刀。\n   ${dirty}`);
  process.exit(3);
}
const original = readFileSync(abs, 'utf8');
for (const a of ARMS) {
  const hits = original.split(NEEDLE).length - 1;
  if (hits !== 1) {
    say(`ARMS=FAIL reason=needle-hits=${String(hits)} arm=${a.id} —— 锚点必须恰好一处，否则注病灶的位置不确定`);
    process.exit(1);
  }
}
say(`GUARD ✅ ${ARMS.length} 臂的 needle 各命中 1 次，且 ${TARGET} 相对 HEAD 干净`);

const restoreAll = () => {
  if (readFileSync(abs, 'utf8') === original) return;
  writeFileSync(abs, original, 'utf8');
  if (md5(readFileSync(abs, 'utf8')) !== md5(original)) {
    say(`ARMS=FAIL reason=RESTORE=DIRTY ${TARGET} md5=${md5(original)} -> ${md5(readFileSync(abs, 'utf8'))}`);
    process.exit(4);
  }
};
process.on('exit', restoreAll);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    say(`🔴 收到 ${sig} —— 先还原再退出`);
    restoreAll();
    process.exit(130);
  });
}

const base = sh(`./node_modules/.bin/vitest run ${SPECS}`);
const bp = parseVitest(`${base.stdout ?? ''}${base.stderr ?? ''}`);
say(`BASELINE RC=${String(base.status)} Tests=${bp.sum ?? '?'} TestFiles=${bp.files ?? '?'}`);
if (base.status !== 0 || !/^1 passed/.test(bp.files ?? '')) {
  say('ARMS=ABORT reason=baseline-not-green（基线红、或那份 spec 压根没跑到 ⇒ 台架自己坏了，拒绝读数）');
  process.exit(2);
}

let failures = 0;
for (const a of ARMS) {
  writeFileSync(abs, original.replace(NEEDLE, a.rep), 'utf8');
  const run = sh(`./node_modules/.bin/vitest run ${SPECS}`);
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const p = parseVitest(out);
  const survived = run.status === 0;
  const missing = a.mustInclude.filter((tag) => !p.titles.some((t) => t.includes(tag)));
  const extra = p.titles.filter((t) => !a.mustInclude.some((tag) => t.includes(tag)));
  const match = !survived && p.failed === a.expect && missing.length === 0 && extra.length === 0;
  say(`[${a.id}] ${a.why}\n      → RC=${String(run.status)} 红 ${String(p.failed)}/${String(a.expect)} ${
    survived ? '🔴 存活（判据没牙）' : match ? '红集精确匹配' : '⚠️ 红集漂移'
  }`);
  for (const t of p.titles.slice(0, 8)) say(`      · ${t}`);
  if (missing.length > 0) say(`      🔴 预期红的用例缺席: ${missing.join(' | ')}`);
  if (extra.length > 0) say(`      ⚠️ 额外红的用例: ${extra.map((t) => t.slice(0, 40)).join(' | ')}`);
  restoreAll();
  if (!match) failures += 1;
}

const recheck = sh(`./node_modules/.bin/vitest run ${SPECS}`);
const rp = parseVitest(`${recheck.stdout ?? ''}${recheck.stderr ?? ''}`);
say(`RECHECK RC=${String(recheck.status)} Tests=${rp.sum ?? '?'}`);
if (recheck.status !== 0) failures += 1;

say(
  `\nARMS=${failures === 0 ? 'pass' : 'FAIL'} (${String(ARMS.length - failures)}/${String(ARMS.length)})  ` +
    `载具 cd apps/web && npx vitest run ${SPECS}`,
);
process.exit(failures === 0 ? 0 : 1);
