#!/usr/bin/env node
/**
 * 变异装置：B-10 转让接收方资格门那几条判据**到底能不能红**
 * ==========================================================
 *
 * 它不改产品行为，只回答一句质疑：「`share-routes.spec.ts` / `share-model.spec.ts` /
 * `share-panel-transfer.spec.tsx` 绿了，是因为"接手人没钥就被挡"真的有人看着，
 * 还是因为那几条断言谁都拦不住？」
 *
 * 这道门由**两半**拼成（信封非空、世代对齐），四臂各注一枚真实会犯的病灶：
 *
 *  A `unsealed-ignored`（服务端只比世代）：症状正是 B-10 那一格 —— 刚接受邀请的成员
 *    `memberKeyEpoch` 与当前世代对齐、`keyEnvelope` 却是 `null`，放过去就得到一个
 *    解不开自己刚接手清单的 owner，而补发信封是 owner 专属写路径 ⇒ 客户端无人能修。
 *  B `epoch-ignored`（服务端只看看没信封）：症状是"手里有上一代钥"的成员被当成合格，
 *    接手后读不到换代之后的内容。A 挡不住 B，B 挡不住 A —— 所以两臂缺一不可。
 *  C `predicate-drops-envelope`（`memberCanHoldOwnership` 只比世代）：面板那枚谓词
 *    必须与服务端判据同形，它塌一半 ⇒ 界面给按钮、服务端回 409（一颗点了必报错的按钮）。
 *  D `panel-always-eligible`（面板不看资格）：整层前置判断没了，回到 B-10 修复前的形状。
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：
 *   ① 三份 spec 各自先跑一次基线（绿、且分母 = 1 个文件）—— 否则 `ARMS=ABORT` 退 2；
 *   ② 每臂要求**红集精确匹配**：条数 = `expect`、点名的那几条必须红、且**不许多红**；
 *   ③ 每臂还原后 md5 逐字节比对，全部跑完再复跑基线。
 *
 * ⚠️ 每臂的红集只看它那一枚 spec —— 病灶若还打疼了别的 spec，这台装置看不见，
 *    那一层由 `pnpm -r test` 兜。别把这台装置读成"整包回归"。
 *
 * 🔴 它**原地改工作树**（三枚文件都归本线），动手前先逐枚验相对 HEAD 干净，
 *    脏就 `ARMS=ENV dirty-worktree` 退 **3**：本仓多会话共用一个检出，不能拿别人
 *    未提交的改动当实验台。还原用**内存副本**，不是 `git checkout`。
 *    D 臂改的是 `packages/ui` 源码，而 `apps/web` 读 `@heyta/ui` 的 **dist**
 *    ⇒ 该臂变异后与还原后各重打一次（照 `mutate-p12-p06.mjs` 的做法）。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-transfer-gate.mjs
 * 读数：`ARMS=pass (4/4)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');

const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';

const SERVER = 'server/src/shares/share.routes.ts';
const MODEL = 'packages/ui/src/sync/share-model.ts';
const PANEL = 'packages/ui/src/sync/SharePanel.tsx';

/** 每臂：改哪枚文件、在哪枚包跑哪份 spec、预期红哪几条。 */
const ARMS = [
  {
    id: 'unsealed-ignored',
    file: SERVER,
    pkg: 'server',
    spec: 'tests/share-routes.spec.ts',
    why: '服务端只比世代 ⇒ 放过「世代对齐但信封为空」（新成员的默认态）',
    needle: '    if (target.keyEnvelope === null || target.memberKeyEpoch !== lookup.share.keyEpoch) {\n',
    rep: `    // ${MARK}\n    if (target.memberKeyEpoch !== lookup.share.keyEpoch) {\n`,
    mustInclude: ['世代对齐但手里没有信封'],
    expect: 1,
  },
  {
    id: 'epoch-ignored',
    file: SERVER,
    pkg: 'server',
    spec: 'tests/share-routes.spec.ts',
    why: '服务端只看看没信封 ⇒ 放过「手里是上一代钥」',
    needle: '    if (target.keyEnvelope === null || target.memberKeyEpoch !== lookup.share.keyEpoch) {\n',
    rep: `    // ${MARK}\n    if (target.keyEnvelope === null) {\n`,
    mustInclude: ['有信封但世代落后'],
    expect: 1,
  },
  {
    id: 'predicate-drops-envelope',
    file: MODEL,
    pkg: 'packages/ui',
    spec: 'tests/share-model.spec.ts',
    why: '面板那枚谓词塌掉信封那半 ⇒ 与服务端判据不同形',
    needle: '  m.hasEnvelope && m.keyEpochLag === 0;\n',
    rep: `  m.keyEpochLag === 0; // ${MARK}\n`,
    mustInclude: ['世代对齐但手里没信封'],
    expect: 1,
  },
  {
    id: 'panel-always-eligible',
    file: PANEL,
    pkg: 'apps/web',
    spec: 'tests/share-panel-transfer.spec.tsx',
    why: '面板完全不看资格 ⇒ 回到 B-10 修复前',
    needle: '        const canTransfer = memberCanHoldOwnership(view);\n',
    rep: `        // ${MARK}\n        const canTransfer = true || memberCanHoldOwnership(view);\n`,
    mustInclude: [
      '目标没有信封（刚接受邀请的默认形状）',
      '目标有信封但世代落后',
      'owner 自己的行不因这一层多出一句提示',
    ],
    expect: 3,
    rebuildUi: true,
  },
];

const abs = (rel) => join(ROOT, rel);
const md5 = (s) => createHash('md5').update(s).digest('hex');
const say = (line) => process.stdout.write(`${line}\n`);
const git = (args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).stdout ?? '';

// vitest 会上色：先剥 ANSI 再匹配，否则"永远绿"可能是解析器坏了而不是判据绿了。
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const stripAnsi = (s) => s.replace(ANSI, '');

const sh = (cmd, cwd) =>
  spawnSync(cmd, {
    cwd: join(ROOT, cwd),
    shell: '/bin/sh',
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 1 << 28,
  });

const buildUi = () => sh('pnpm --filter @heyta/ui build', '.');

/** 跑一臂对应的那份 spec；D 臂要先重打 @heyta/ui（apps/web 读 dist）。 */
function runSpec(a) {
  if (a.rebuildUi) {
    const b = buildUi();
    if (b.status !== 0) {
      say(`ARMS=ABORT reason=ui-build-failed arm=${a.id} rc=${String(b.status)}`);
      process.exit(2);
    }
  }
  return sh(`./node_modules/.bin/vitest run ${a.spec}`, a.pkg);
}

// vitest 默认 reporter 的失败行形状：`     × <title> 12ms`（从真实日志核对，不凭记忆写）。
function parseVitest(raw) {
  const out = stripAnsi(raw);
  const sum = /^\s*Tests\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  const failed = Number(/(\d+) failed/.exec(sum ?? '')?.[1] ?? NaN);
  const titles = [...out.matchAll(/^\s*×\s+(.+?)\s+\d+ms\s*$/gm)].map((m) => m[1]);
  const files = /^\s*Test Files\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  return { sum, failed, titles, files };
}

/* ── 前置：三枚文件在场 + 各自相对 HEAD 干净 + 每枚 needle 恰好命中一次 ─── */
const originals = new Map();
for (const rel of TARGETS) {
  const p = abs(rel);
  if (!existsSync(p)) {
    say(`ARMS=FAIL reason=target-missing ${rel}`);
    process.exit(1);
  }
  const text = readFileSync(p, 'utf8');
  const dirty = git(['status', '--porcelain', '--', rel]).trim();
  if (dirty !== '') {
    say(`ARMS=ENV dirty-worktree —— ${rel} 相对 HEAD 有未提交改动，装置不在别人的改动上动刀。\n   ${dirty}`);
    process.exit(3);
  }
  originals.set(rel, text);
}
for (const a of ARMS) {
  const hits = originals.get(a.file).split(a.needle).length - 1;
  if (hits !== 1) {
    say(`ARMS=FAIL reason=needle-hits=${String(hits)} arm=${a.id} —— 锚点必须恰好一处，否则注病灶的位置不确定`);
    process.exit(1);
  }
}
say(`GUARD ✅ ${ARMS.length} 臂的 needle 各命中 1 次，且 ${TARGETS.length} 枚目标文件相对 HEAD 干净`);

let mutated = false;
function restoreAll() {
  for (const [rel, text] of originals) writeFileSync(abs(rel), text, 'utf8');
  mutated = false;
  const bad = TARGETS.filter((rel) => md5(readFileSync(abs(rel), 'utf8')) !== md5(originals.get(rel)));
  if (bad.length > 0) {
    say(`ARMS=FAIL reason=RESTORE=DIRTY md5 ${bad.join(' , ')}`);
    process.exit(4);
  }
}
process.on('exit', () => {
  if (TARGETS.some((rel) => readFileSync(abs(rel), 'utf8') !== originals.get(rel))) restoreAll();
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    say(`🔴 收到 ${sig}${mutated ? '（正处在变异态）' : ''} —— 先还原再退出`);
    restoreAll();
    process.exit(130);
  });
}

/* ── ① 基线：每臂那份 spec 先各自跑一次绿，且真的跑到（分母 = 1 个文件）──── */
const seen = new Set();
for (const a of ARMS) {
  if (seen.has(a.spec)) continue;
  seen.add(a.spec);
  const r = runSpec(a);
  const p = parseVitest(`${r.stdout ?? ''}${r.stderr ?? ''}`);
  say(`BASELINE spec=${a.spec} RC=${String(r.status)} Tests=${p.sum ?? '?'} TestFiles=${p.files ?? '?'}`);
  if (r.status !== 0 || !/^1 passed/.test(p.files ?? '')) {
    say(`ARMS=ABORT reason=baseline-not-green spec=${a.spec}（基线红、或那份 spec 压根没跑到 ⇒ 台架自己坏了，拒绝读数）`);
    restoreAll();
    process.exit(2);
  }
}

/* ── ② 逐臂注病灶 ───────────────────────────────────────────────────── */
let failures = 0;
for (const a of ARMS) {
  mutated = true;
  writeFileSync(abs(a.file), originals.get(a.file).replace(a.needle, a.rep), 'utf8');
  const run = runSpec(a);
  const p = parseVitest(`${run.stdout ?? ''}${run.stderr ?? ''}`);
  const survived = run.status === 0;
  const missing = a.mustInclude.filter((tag) => !p.titles.some((t) => t.includes(tag)));
  const extra = p.titles.filter((t) => !a.mustInclude.some((tag) => t.includes(tag)));
  const match = !survived && p.failed === a.expect && missing.length === 0 && extra.length === 0;
  say(`[${a.id}] ${a.why} → RC=${String(run.status)} 红 ${String(p.failed)}/${String(a.expect)} ${
    survived ? '🔴 存活（判据没牙）' : match ? '红集精确匹配' : '⚠️ 红集漂移'
  }`);
  for (const t of p.titles.slice(0, 8)) say(`      · ${t}`);
  if (missing.length > 0) say(`      🔴 预期红的用例缺席: ${missing.join(' ｜ ')}`);
  if (extra.length > 0) say(`      ⚠️ 额外红的用例: ${extra.map((t) => t.slice(0, 34)).join(' ｜ ')}`);
  restoreAll();
  if (!match) failures += 1;
}

/* ── ③ 还原后复跑基线（D 臂要把 dist 也换回未变异那一份）───────────────── */
let recheckFail = false;
for (const a of ARMS) {
  if (!seen.has(a.spec)) continue;
  const r = runSpec(a);
  const p = parseVitest(`${r.stdout ?? ''}${r.stderr ?? ''}`);
  say(`RECHECK spec=${a.spec} RC=${String(r.status)} Tests=${p.sum ?? '?'} md5=${md5(originals.get(a.file)) === md5(readFileSync(abs(a.file), 'utf8')) ? 'byte-identical' : 'DIRTY'}`);
  if (r.status !== 0) recheckFail = true;
  seen.delete(a.spec);
}

say(`\nARMS=${failures === 0 && !recheckFail ? 'pass' : 'FAIL'} (${String(ARMS.length - failures)}/${String(ARMS.length)})  `
  + '载具：cd server / cd packages/ui / cd apps/web 各跑一份 spec，D 臂先 pnpm --filter @heyta/ui build');
process.exit(failures === 0 && !recheckFail ? 0 : 1);