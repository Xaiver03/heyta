#!/usr/bin/env node
/**
 * 变异装置：M1 下行链路那四条游标判据**到底能不能红**
 * =================================================================
 *
 * 它不改产品行为，只回答一句质疑：「`pullShareOps` 那批测试绿了，是因为游标写错
 * 会被抓住，还是因为这几条断言谁都拦不住？」
 *
 * 三臂各注一枚**真实会犯的**病灶（前两枚是这个功能开发过程中真的犯过 / 差点犯的）：
 *
 *  A `cursor-not-persisted`：解耦掉 `setCursor` —— 每次 pull 都从 0 重拉。
 *     表现是"看起来没问题"：折函数会去重，评论不会翻倍，界面上永远是绿的，
 *     代价是每一次进入评论区都全量重下一遍日志。
 *  B `head-as-consumed`：把游标推到**服务端报的头**而不是"我已收下"的那条。
 *     🔴 这是第一版真实存在的 bug：页里只有 1、2 两条而头在 3 时，游标被推到 3，
 *     第 3 条永远不会再被拉 —— 静默丢 op。这一臂就是那件事故留下的牙。
 *  C `cursor-before-fold`：游标在解密/折叠**之前**就推上去。
 *     中途抛 ⇒ 日志没落、游标已经过去 ⇒ 那批 op 永久取不回来。
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：
 *   ① 基线对照必须先绿，且那份 spec 真的跑到（分母 = 1 个文件）—— 否则 `PROBE_BROKEN` 退 2；
 *   ② 每臂要求**红集精确匹配**：条数 = `expect`、预期的那几条必须红、且**不许多红**
 *     （多红说明病灶比预想的宽，那条臂就不再是"这一处写错"的证据）；
 *   ③ 每臂还原后 md5 逐字节比对，还原前后各复跑一次基线。
 *
 * 🔴 它**原地改工作树**（`packages/app-host/src/share-comments.ts` 归本线），所以动手前先验
 *    该文件相对 HEAD 干净，脏就 `ARMS=ENV dirty-worktree` 退 **3**：本仓多会话共用一个检出，
 *    不能拿别人未提交的改动当实验台。还原用**内存副本**，不是 `git checkout`。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-pull-cursor.mjs
 * 读数：`ARMS=pass (3/3)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');
const PKG = join(ROOT, 'packages/app-host');
const TARGET = join(PKG, 'src/share-comments.ts');
const REL = 'packages/app-host/src/share-comments.ts';
const SPEC = 'tests/share-comments-pull.spec.ts';

const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';

const ARMS = [
  {
    id: 'cursor-not-persisted',
    why: '游标不落盘 ⇒ 每次都从 0 全量重拉',
    needle: '    options.storage.setCursor(shareId, after);\n',
    rep: `    // ${MARK}\n    void after;\n`,
    mustInclude: [
      '第二次 pull 从上次的位置继续',
      '冷启动：同一份存储重建宿主',
      '服务端头超前于这一页给的内容',
      // 分页那条断言读的是 `pullShareOps` **返回的** `cursor`，所以游标不落盘也会红。
      // 它不是"额外红的"，是真依赖 —— 写进预期集里，红集才允许多一条都不过。
      '分页收敛：两页追平',
    ],
    expect: 4,
  },
  {
    id: 'head-as-consumed',
    why: '把服务端头当已消费位置 ⇒ 静默丢 op',
    needle: '      after = Math.max(after, consumed);\n',
    rep: `      // ${MARK}\n      after = head;\n`,
    mustInclude: ['服务端头超前于这一页给的内容', '分页收敛：两页追平'],
    expect: 2,
  },
  {
    id: 'cursor-before-fold',
    why: '游标在解密/落日志之前推上去 ⇒ 中途炸就永久丢这一批',
    needle: '    const decrypted: DecryptedShareOp[] = [];\n',
    rep: `    // ${MARK}\n    options.storage.setCursor(shareId, after);\n    const decrypted: DecryptedShareOp[] = [];\n`,
    mustInclude: ['先落日志再推游标'],
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

// vitest 默认 reporter 的失败行形状：`     × <title> 12ms`（从真实日志核对，不凭记忆写）。
// 与 mutate-habit-period-stats.mjs 同一份解析；取不到数字是 NaN，"没读到" ≠ "读到 0"。
function parseVitest(out) {
  const sum = /^\s*Tests\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  const failed = Number(/(\d+) failed/.exec(sum ?? '')?.[1] ?? NaN);
  const titles = [...out.matchAll(/^\s*×\s+(.+?)\s+\d+ms\s*$/gm)].map((m) => m[1]);
  const files = /^\s*Test Files\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  return { sum, failed, titles, files };
}

/* ── 前置：文件在场 + 相对 HEAD 干净 + 每枚 needle 恰好命中一次 ─────────── */
if (!existsSync(TARGET)) {
  say(`ARMS=FAIL reason=target-missing ${REL}`);
  process.exit(1);
}
const original = readFileSync(TARGET, 'utf8');
const dirty = git(['status', '--porcelain', '--', REL]).trim();
if (dirty !== '') {
  say(`ARMS=ENV dirty-worktree —— ${REL} 相对 HEAD 有未提交改动，装置不在别人的改动上动刀。\n   ${dirty}`);
  process.exit(3);
}
for (const a of ARMS) {
  const hits = original.split(a.needle).length - 1;
  if (hits !== 1) {
    say(`ARMS=FAIL reason=needle-hits=${String(hits)} arm=${a.id} —— 锚点必须恰好一处，否则注病灶的位置不确定`);
    process.exit(1);
  }
}
say(`GUARD ✅ ${ARMS.length} 臂的 needle 各命中 1 次，且 ${REL} 相对 HEAD 干净`);

let dirtyTarget = false;
const restore = () => {
  writeFileSync(TARGET, original, 'utf8');
  dirtyTarget = false;
  if (md5(readFileSync(TARGET, 'utf8')) !== md5(original)) {
    say(`ARMS=FAIL reason=RESTORE=DIRTY md5 ${md5(original)} -> ${md5(readFileSync(TARGET, 'utf8'))}`);
    process.exit(4);
  }
};
process.on('exit', () => {
  if (readFileSync(TARGET, 'utf8') !== original) restore();
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    say(`🔴 收到 ${sig}${dirtyTarget ? '（正处在变异态）' : ''} —— 先还原再退出`);
    restore();
    process.exit(130);
  });
}

/* ── ① 基线对照 ─────────────────────────────────────────────────────── */
const base = sh(`./node_modules/.bin/vitest run ${SPEC}`);
const bp = parseVitest(base.stdout + (base.stderr ?? ''));
say(`BASELINE RC=${String(base.status)} Tests=${bp.sum ?? '?'} TestFiles=${bp.files ?? '?'}`);
if (base.status !== 0 || !/^1 passed/.test(bp.files ?? '')) {
  say('ARMS=ABORT reason=baseline-not-green（基线红、或那份 spec 压根没跑到 ⇒ 台架自己坏了，拒绝读数）');
  restore();
  process.exit(2);
}

/* ── ② 逐臂注病灶 ───────────────────────────────────────────────────── */
let failures = 0;
for (const a of ARMS) {
  dirtyTarget = true;
  writeFileSync(TARGET, original.replace(a.needle, a.rep), 'utf8');
  const run = sh(`./node_modules/.bin/vitest run ${SPEC}`);
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const p = parseVitest(out);
  const survived = run.status === 0;
  const missing = a.mustInclude.filter((tag) => !p.titles.some((t) => t.includes(tag)));
  const extra = p.titles.filter((t) => !a.mustInclude.some((tag) => t.includes(tag)));
  // 三条都过才算匹配：数量（分母没被悄悄改掉）、缺席、多红。
  const match = !survived && p.failed === a.expect && missing.length === 0 && extra.length === 0;
  say(`[${a.id}] ${a.why} → RC=${String(run.status)} 红 ${String(p.failed)}/${String(a.expect)} ${
    survived ? '🔴 存活（判据没牙）' : match ? '红集精确匹配' : '⚠️ 红集漂移'
  }`);
  for (const t of p.titles.slice(0, 8)) say(`      · ${t}`);
  if (missing.length > 0) say(`      🔴 预期红的用例缺席: ${missing.join(' | ')}`);
  if (extra.length > 0) say(`      ⚠️ 额外红的用例: ${extra.map((t) => t.slice(0, 30)).join(' | ')}`);
  restore();
  if (!match) failures += 1;
}

/* ── ③ 还原后复跑基线 ───────────────────────────────────────────────── */
const recheck = sh(`./node_modules/.bin/vitest run ${SPEC}`);
const rp = parseVitest(`${recheck.stdout ?? ''}${recheck.stderr ?? ''}`);
say(`RECHECK RC=${String(recheck.status)} Tests=${rp.sum ?? '?'} md5=${md5(original) === md5(readFileSync(TARGET, 'utf8')) ? 'byte-identical' : 'DIRTY'}`);
if (recheck.status !== 0) failures += 1;

say(`\nARMS=${failures === 0 ? 'pass' : 'FAIL'} (${String(ARMS.length - failures)}/${String(ARMS.length)})  载具 cd packages/app-host && npx vitest run ${SPEC}`);
process.exit(failures === 0 ? 0 : 1);
