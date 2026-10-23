#!/usr/bin/env node
/**
 * 变异装置：`verify:collab-journey` 的**两台真浏览器互见**那一格能不能红
 * =================================================================
 *
 * 它不改产品行为，只回答一句质疑：「旅程里那句"B 看得见 A 写的任务"变绿，是因为
 * 信号→拉取→合并→重读这条链真的被盯着，还是因为这条断言谁都拦不住？」
 *
 * 为什么这一格必须有臂：它是全仓**唯一**一条"用户互相看得见"的判据。宿主层那两腿
 * （`verify:collab-sync` 第 10/12 步）用两台 Node 就能绿，而这一腿中间隔着三层，
 * 每一层都能单独断掉：① 合并视图挂的是哪条本机清单行 ② `new_share_ops` 到不到这台
 * 浏览器（WS 是壳里接的）③ 界面到底重不重读状态。只跑一次绿证明不了这三层都在被盯。
 *
 * 病灶 `index-only` 不是设想出来的 —— **它就是这一趟界面腿亲手抓到的那个 bug**：
 * 信号闸门只认"这份日志在本机落过盘"，而刚入群那台设备一次都没拉过 ⇒ 索引是空的 ⇒
 * 第一份别人写的内容被当成"本机不认得"丢掉。修完之后必须留一臂钉住它，否则下一次
 * 有人"简化"那个布尔就会回到同一个症状，而界面上没有任何东西会红。
 *
 * 🔴 与 `mutate-collab-journey-autoseal.mjs` 的差别：那一副改的是 `apps/web/src/**`
 *    （vite 直接吃源码），这一副改的是 `packages/app-host/src/**` —— 浏览器吃的是
 *    **dist**，所以变异后与还原后**各重打一次包**，否则跑的是旧产物（同
 *    `mutate-collab-transfer-gate.mjs` 改 `packages/ui` 那两臂的口径）。
 *
 * 三件事按 `research/tools/mutation-rigs/README.md` 的口径做：
 *   ① 原样对照必须先绿（`RESULT=OK`），否则后面的"红"没有基线 —— 不绿就 `ARMS=ABORT` 退 2；
 *   ② 变异臂要求输出里**同时**出现 `RESULT=FAIL` 与 `B 那台看不见 A 写的`
 *      （只"红了"不算 —— 编译错也会红，而那不是判据的牙）；
 *   ③ 还原 + md5 逐字节比对 + 重打包。⚠️ 复跑绿是**可选**的（`--rerun-green`）。
 *
 * 用法：
 *   node research/tools/mutation-rigs/mutate-collab-journey-visible.mjs [--rerun-green]
 * 读数：`ARMS=pass (2/2)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');
const TARGET = 'packages/app-host/src/share-signals.ts';
const NEEDLE =
  '      const knownLocally = ports.knownShareIds().includes(shareId) || ports.storage.list().includes(shareId);\n';
const LESION =
  '      // MUTATED-BY-RIG：闸门退成只认落盘索引，用来验界面腿有没有牙（装置会还原）\n' +
  '      const knownLocally = ports.storage.list().includes(shareId);\n';

const md5 = (s) => createHash('md5').update(s).digest('hex');
const say = (line) => process.stdout.write(`${line}\n`);
const git = (args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).stdout ?? '';

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  return { text: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status };
}

const rebuild = () => {
  const r = run('pnpm', ['--filter', '@heyta/app-host', 'build']);
  if (r.status !== 0) {
    say(`ARMS=FAIL reason=build-failed\n${r.text.slice(-600)}`);
    process.exit(1);
  }
};

const runJourney = () => run(process.execPath, [join(ROOT, 'scripts/verify-collab-journey.mjs')]);

/* ── 前置：目标文件必须干净（多会话共用一个检出） ─────────────────────── */
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
const hits = original.split(NEEDLE).length - 1;
if (hits !== 1) {
  say(`ARMS=FAIL reason=needle-hits=${String(hits)} —— 锚点必须恰好一处，否则注病灶的位置不确定`);
  process.exit(1);
}

const restore = () => {
  if (readFileSync(abs, 'utf8') === original) return;
  writeFileSync(abs, original, 'utf8');
  if (md5(readFileSync(abs, 'utf8')) !== md5(original)) {
    say(`ARMS=FAIL reason=RESTORE=DIRTY md5 ${md5(original)} -> ${md5(readFileSync(abs, 'utf8'))}`);
    process.exit(4);
  }
};
process.on('exit', restore);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    say(`🔴 收到 ${sig} —— 先还原并重打包再退出`);
    restore();
    rebuild();
    process.exit(130);
  });
}

let failures = 0;

/* ── ① 原样对照 ─────────────────────────────────────────────────────── */
say('── ① 对照：原样重打包 + 跑一趟旅程');
rebuild();
const base = runJourney();
const baseOk = base.text.includes('RESULT=OK') && base.status === 0;
say(`${baseOk ? '✅' : '❌'} 对照 ${base.text.match(/RESULT=\S+/)?.[0] ?? '(没有 RESULT= 行)'} rc=${base.status}`);
if (!baseOk) {
  say('ARMS=ABORT reason=baseline-not-green（基线不绿，注病灶那一步问不到东西）');
  restore();
  rebuild();
  process.exit(2);
}

/* ── ② 病灶：信号闸门退成只认落盘索引 ───────────────────────────────── */
say('── ② 病灶：闸门只认"这份日志在本机落过盘"（刚入群那台设备收不到第一份内容）');
writeFileSync(abs, original.replace(NEEDLE, LESION), 'utf8');
let mut;
try {
  rebuild();
  mut = runJourney();
} finally {
  restore();
  rebuild();
}
const red = mut.text.includes('RESULT=FAIL') || mut.status !== 0;
const named = mut.text.includes('B 那台看不见 A 写的');
const hit = red && named;
say(`${hit ? '✅' : '❌'} 变异臂 ${red ? '红' : '🔴 存活（判据没牙）'} 且${named ? '点名"两台互见"那一格' : '**没**点名互见那一格'}`);
if (!hit) say(`   实际输出尾部：${mut.text.trim().slice(-600)}`);
failures += hit ? 0 : 1;

/* ── ③ 还原确认 ─────────────────────────────────────────────────────── */
const after = readFileSync(abs, 'utf8');
say(`✅ 还原：md5 ${md5(original)} === ${md5(after)} → ${md5(original) === md5(after) ? 'byte-identical' : 'DIRTY'}`);
if (md5(original) !== md5(after)) failures += 1;

if (process.argv.includes('--rerun-green')) {
  say('── 复跑绿（--rerun-green）');
  const again = runJourney();
  const ok = again.text.includes('RESULT=OK') && again.status === 0;
  say(`${ok ? '✅' : '❌'} 还原后复跑 ${again.text.match(/RESULT=\S+/)?.[0] ?? '(无 RESULT= 行)'}`);
  failures += ok ? 0 : 1;
}

const total = process.argv.includes('--rerun-green') ? 3 : 2;
say(`\nARMS=${failures === 0 ? 'pass' : 'FAIL'} (${total - failures}/${total})  载具 ${join(ROOT, 'scripts/verify-collab-journey.mjs')}`);
process.exit(failures === 0 ? 0 : 1);
