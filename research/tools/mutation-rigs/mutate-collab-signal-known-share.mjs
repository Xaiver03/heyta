#!/usr/bin/env node
/**
 * 变异装置：M5 信号闸门"这台设备认不认得这份 share"那两条判据能不能红
 * =================================================================
 *
 * 它不改产品行为，只回答一句质疑：「`share-signals.spec.ts` 绿了，是因为那两条
 * 方向相反的纪律真的各自被盯着，还是因为其中一条谁都拦不住？」
 *
 * 为什么这一格值得单独一副臂：闸门是**一个布尔的两半**，两半各挡一种坏法，
 * 而两种坏法在界面上的症状一模一样（"对面写了东西，我这台不动"）：
 *
 *  A `index-only`     只认"这份日志在本机落过盘"。这是 M2-d 界面腿**实测抓到**的病灶：
 *     刚入群那台设备一条 op 都没拉过 ⇒ 索引是空的 ⇒ 第一份别人写的内容被判"本机不认得"
 *     丢掉，而这个判据**自锁**（不拉就不进索引，进了索引才允许拉）。症状不是"少一条"，
 *     是新成员永远看不见任何改动。
 *  B `always-pull`    闸门整条拿掉。反向那一格：信号是按**账号**扇的，同一账号的别的设备
 *     在别的清单上写的东西也会引来一次 404 下载（而抛错被实时回调吞掉 ⇒ 一条永远不出读数的死路）。
 *
 * 两臂互不覆盖：A 挡不住 B、B 挡不住 A ⇒ 少任何一臂都不知道另一半有没有牙。
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：① 基线必须先绿且那份 spec 真跑到
 * （否则退 2）；② 每臂**红集精确匹配**（条数 + 缺席 + 多红三条都过）；③ 还原后 md5
 * 逐字节比对，最后复跑基线。
 *
 * 🔴 原地改工作树（目标文件归本线），动手前验它相对 HEAD 干净，脏就退 **3**。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-signal-known-share.mjs
 * 读数：`ARMS=pass (2/2)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');
const PKG = join(ROOT, 'packages/app-host');
const TARGET = 'packages/app-host/src/share-signals.ts';
const SPECS = 'tests/share-signals.spec.ts';

const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';
const NEEDLE =
  '      const knownLocally = ports.knownShareIds().includes(shareId) || ports.storage.list().includes(shareId);\n';

const ARMS = [
  {
    id: 'index-only',
    why: '只认落盘索引 ⇒ 刚入群那台设备收不到第一份内容（M2-d 界面腿实测到的那一形）',
    rep: `      // ${MARK}\n      const knownLocally = ports.storage.list().includes(shareId);\n`,
    mustInclude: ['刚入群那台设备'],
    expect: 1,
  },
  {
    id: 'always-pull',
    why: '闸门整条拿掉 ⇒ 为本机根本没有的 share 出网下载（404 被回调吞掉，成一条死路）',
    rep: `      // ${MARK}\n      const knownLocally = true;\n`,
    mustInclude: ['本机既不认得也没落盘'],
    expect: 1,
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
    `载具 cd packages/app-host && npx vitest run ${SPECS}`,
);
process.exit(failures === 0 ? 0 : 1);
