#!/usr/bin/env node
/**
 * 变异装置：`verify:collab-journey` 的 bob 入群那一腿**到底能不能红**
 * =================================================================
 *
 * 它不改产品行为，只回答一句质疑：「旅程里那句 `share-join-done` 变绿，是因为
 * owner 真的自动下发了信封，还是因为这条断言谁都拦不住？」
 *
 * 三件事按 `research/tools/mutation-rigs/README.md` 的口径做：
 *   ① 未变异对照 —— 必须先绿一次（`RESULT=OK steps=3`），否则后面的"红"没有基线；
 *   ② 注病灶 —— 把 owner 的 autoSeal 那一发调用摘掉（**信封不再自动下发**），
 *      跑同一条旅程，要求**恰好**红在 bob 等钥那一格：输出里必须同时出现
 *      `RESULT=FAIL` 与 `share-join-done`。只要求"红了"不算 —— 编译错也会红。
 *   ③ 还原 + 逐字节比对（md5 前后一致）。⚠️ 复跑绿是**可选**的（`--rerun-green`）：
 *      ① 已经证明"这一份内容会绿"，③ 的字节比对证明"文件就是那一份内容"，
 *      两件事合起来已经闭合；留这个开关是给不信还原的人（代价：多跑一趟约 2 分钟）。
 *
 * 🔴 为什么它敢原地改工作树：`apps/web/src/features/share/ShareFeature.tsx` **归本线**。
 *    但本仓是多会话共用一个检出 —— 所以动手前先验"这枚文件相对 HEAD 是干净的"，
 *    脏就**拒绝启动**（响亮退出 3），而不是把别人的未提交改动一起改坏或还原掉。
 *
 * 用法：
 *   node research/tools/mutation-rigs/mutate-collab-journey-autoseal.mjs [--rerun-green]
 * 读数：`ARMS=pass (2/2)` / `ARMS=FAIL …`；还原失败会以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');
const TARGET = 'apps/web/src/features/share/ShareFeature.tsx';
const ANCHOR = '    void autoSeal(phase.shareId, detail.keyEpoch);';
const LESION =
  '    // MUTATED-BY-RIG：这一发被故意摘掉，用来验旅程判据有没有牙（装置会还原）\n' +
  '    void phase;';

const md5 = (s) => createHash('md5').update(s).digest('hex');
const git = (args) =>
  spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).stdout ?? '';

const say = (line) => process.stdout.write(`${line}\n`);

function runJourney() {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/verify-collab-journey.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { text: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status };
}

/* ── 前置：目标文件必须干净（多会话共用一个检出） ─────────────────────── */
if (!existsSync(join(ROOT, TARGET))) {
  say(`ARMS=FAIL reason=target-missing ${TARGET}`);
  process.exit(1);
}
const original = readFileSync(join(ROOT, TARGET), 'utf8');
const dirty = git(['status', '--porcelain', '--', TARGET]).trim();
if (dirty !== '') {
  say(`ARMS=ENV dirty-worktree —— ${TARGET} 相对 HEAD 有未提交改动，装置不在别人的改动上动刀。\n   ${dirty}`);
  process.exit(3);
}
const hits = original.split(ANCHOR).length - 1;
if (hits !== 1) {
  say(`ARMS=FAIL reason=anchor-hits=${hits} —— 锚点必须**恰好一处**，否则注病灶的位置就不确定了`);
  process.exit(1);
}

const restore = () => {
  writeFileSync(join(ROOT, TARGET), original, 'utf8');
  const back = readFileSync(join(ROOT, TARGET), 'utf8');
  if (md5(back) !== md5(original)) {
    say(`ARMS=FAIL reason=RESTORE=DIRTY md5 ${md5(original)} -> ${md5(back)}`);
    process.exit(4);
  }
};
process.on('exit', () => {
  if (readFileSync(join(ROOT, TARGET), 'utf8') !== original) restore();
});

let failures = 0;

/* ── ① 未变异对照 ─────────────────────────────────────────────────── */
say('── ① 对照：原样跑一趟旅程');
const base = runJourney();
const baseOk = base.text.includes('RESULT=OK') && base.status === 0;
say(`${baseOk ? '✅' : '❌'} 对照 ${base.text.match(/RESULT=\S+/)?.[0] ?? '(没有 RESULT= 行)'} rc=${base.status}`);
if (!baseOk) {
  // 对照不绿就没必要注病灶 —— 但**必须响亮**说为什么停，而不是静默退 0。
  say('ARMS=ABORT reason=baseline-not-green（基线不绿，注病灶那一步问不到东西）');
  restore();
  process.exit(1);
}
failures += baseOk ? 0 : 1;

/* ── ② 注病灶：摘掉 autoSeal ──────────────────────────────────────── */
say('── ② 病灶：摘掉 owner 的 autoSeal 那一发调用');
writeFileSync(join(ROOT, TARGET), original.replace(ANCHOR, LESION), 'utf8');
let mut;
try {
  mut = runJourney();
} finally {
  restore();
}
const red = mut.text.includes('RESULT=FAIL') || mut.status !== 0;
const namedJoin = mut.text.includes('share-join-done');
const hit = red && namedJoin;
say(`${hit ? '✅' : '❌'} 变异臂 ${red ? '红' : '绿（🔴 判据没牙）'} 且${namedJoin ? '点名 share-join-done' : '**没**点名 bob 等钥那一格'}`);
if (!hit) say(`   实际输出尾部：${mut.text.trim().slice(-400)}`);
failures += hit ? 0 : 1;

/* ── ③ 还原确认 ───────────────────────────────────────────────────── */
const after = readFileSync(join(ROOT, TARGET), 'utf8');
say(`✅ 还原：md5 ${md5(original)} === ${md5(after)} → ${md5(original) === md5(after) ? 'byte-identical' : 'DIRTY'}`);
if (md5(original) !== md5(after)) failures += 1;

if (process.argv.includes('--rerun-green')) {
  say('── ③ 复跑绿（--rerun-green）');
  const again = runJourney();
  const ok = again.text.includes('RESULT=OK') && again.status === 0;
  say(`${ok ? '✅' : '❌'} 还原后复跑 ${again.text.match(/RESULT=\S+/)?.[0] ?? '(无 RESULT= 行)'}`);
  failures += ok ? 0 : 1;
}

const total = process.argv.includes('--rerun-green') ? 3 : 2;
say(`\nARMS=${failures === 0 ? 'pass' : 'FAIL'} (${total - failures}/${total})  载具 ${join(ROOT, 'scripts/verify-collab-journey.mjs')}`);
process.exit(failures === 0 ? 0 : 1);
