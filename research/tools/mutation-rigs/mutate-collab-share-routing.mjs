#!/usr/bin/env node
/**
 * 变异装置：M2 写路径路由那批判据**到底能不能红**（ADR-0067 裁决一 + 补一 + 补二 + 补三）
 * =================================================================
 *
 * 它不改产品行为，只回答一句质疑：「`share-routing.spec.ts` 34 枚全绿，是因为那五坏法
 * 真的各自被盯着，还是因为其中几条谁都拦不住？」
 *
 * 为什么这一份尤其需要臂：路由的病灶**只在"对面那台"显形**。本机写一条任务、本机看
 * 得到、构建也过 —— 全部绿的。要看见坏掉，必须跨账号跑一趟（那是 `verify:collab-sync`
 * 第 12 步与 `verify:collab-journey` 互见那一格的活），而它们一趟几分钟，不可能每次
 * 改路由都跑。所以"改错了必须有一条判据立刻红"这句话只能由变异来证。
 *
 * 六臂各注一枚**真实会犯的**病灶（A/B/E 都是这一趟真犯过或差点犯的形状）：
 *
 *  A `no-declared-fallback`  新建那一形不回退问载荷（= 补三落地**之前**的工作树原样）。
 *     症状：在共享清单里加一条任务，要么落进个人 log（对面永远看不见），要么当场
 *     抛"暂不支持跨清单移动"。
 *  B `fallback-for-all`      什么阻塞都回退去问载荷 ⇒ 载荷塞一个 `projectId` 就能
 *     绕过裁决一，把一条私人条目判成共享（交到别人的钥后面）。
 *  C `no-live-source`        "状态里没有"当成"从一个没有 shareId 的地方搬过来"
 *     ⇒ 新建被读成跨边界移动并当场拒绝。
 *  D `silent-personal`       通道没装上时悄悄退回个人 log（M2 之前的形状，普通派发器）。
 *  E `silent-personal-cas`   同一枚病灶在 CAS 派发器上（估时/追加清单那两枚动作走这条路）。
 *  F `move-never-rejected`   跨边界移动不再拒绝（补二退回"两本 log 各写一半历史"）。
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：
 *   ① 基线对照必须先绿，且那一份 spec 真的跑到（分母 = 1 个文件）—— 否则 `PROBE_BROKEN` 退 2；
 *   ② 每臂要求**红集精确匹配**：条数 = `expect`、预期的那几条必须红、且**不许多红**；
 *   ③ 每臂还原后 md5 逐字节比对，全部跑完再复跑一次基线。
 *
 * 🔴 它**原地改工作树**（目标文件归本线），所以动手前先验它相对 HEAD 干净，
 *    脏就 `ARMS=ENV dirty-worktree` 退 3：本仓多会话共用一个检出，不能拿别人未提交的改动当实验台。
 *    还原用**内存副本**，不是 `git checkout`。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-share-routing.mjs
 * 读数：`ARMS=pass (6/6)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');
const PKG = join(ROOT, 'packages/app-host');
const TARGET = 'packages/app-host/src/share-routing.ts';
const SPECS = 'tests/share-routing.spec.ts';

const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';

/** 逐字取自 `it(...)` 的标题，不凭记忆写。 */
const T = {
  createShared: '在共享清单里新建一条任务 ⇒ 进 share，个人侧零调用',
  createPersonal: '在个人清单里新建 ⇒ 进个人 log，且不抛（新建不是"从 undefined 搬过来"）',
  createInbox: '收集箱里新建（载荷根本没有 projectId）⇒ 走个人 log',
  createNoChannel: '在共享清单里新建、通道没装上 ⇒ 具名拒绝，绝不退回个人 log',
  noteCreate: '便签同形：在共享清单里新建 ⇒ 进 share',
  commentCreate: '评论同形：归属由它挂的那条任务决定（那条任务在共享清单里 ⇒ 进 share）',
  payloadOverride: '载荷里塞一个共享清单的 id **压不过**裁决一',
  moveSharedToPersonal: '共享 → 个人：抛 ShareCrossListMoveError，且两侧都零调用',
  movePersonalToShared: '个人 → 共享：同样拒绝（进共享要把内容交给别人的钥，属 M3/M4 那一族）',
  moveBetweenShares: '共享 → 另一份共享：也拒绝（两份 share 的密钥不同）',
  casMove: '跨边界移动 ⇒ 抛具名错误，**两侧都零**（不许悄悄只写一半）',
  reverseRegression: '反向防回归：实体**已存在**时把 projectId 从共享改成个人 ⇒ 仍然具名拒绝',
  noChannelSync: '共享清单里的任务、通道未装 ⇒ 抛 ShareChannelUnavailableError，个人侧零调用',
  noChannelAsync: 'provider 异步地给出 undefined ⇒ 照样具名拒绝（等一次不等于把"没有"读成"有"）',
  noChannelCas: '通道没装上 ⇒ 抛 ShareChannelUnavailable，个人侧零（绝不退回个人 log）',
};

const ARMS = [
  {
    id: 'no-declared-fallback',
    why: '新建那一形不回退问载荷 ⇒ 共享清单里加的任务落进个人 log（补三落地之前工作树里真是这几行）',
    needle: '  if (known.blocked !== \'entity-not-found\') return known;\n',
    rep: `  // ${MARK}\n  return known;\n`,
    mustInclude: [T.createShared, T.createNoChannel, T.noteCreate, T.commentCreate],
    expect: 4,
  },
  {
    id: 'fallback-for-all',
    why: '任何阻塞都回退问载荷 ⇒ 带一个共享 projectId 就能把私人条目判成共享（绕过裁决一）',
    needle: '  if (known.blocked !== \'entity-not-found\') return known;\n',
    rep: `  // ${MARK}\n  // 守卫整条拿掉：阻塞原因不再看一眼\n`,
    mustInclude: [T.payloadOverride],
    expect: 1,
  },
  {
    id: 'no-live-source',
    why: '"状态里没有"当成"从没有 shareId 的地方搬过来" ⇒ 新建被判成跨边界移动并拒绝',
    needle: '  if (!live(source)) return false;\n',
    rep: `  // ${MARK}\n  // 不查源是否存在：undefined 也当一次移动\n`,
    mustInclude: [T.createShared, T.createNoChannel, T.noteCreate],
    expect: 3,
    // ⚠️ 第一趟预测的是 4 红（把 `T.createPersonal` 也算进去了），实测它不红 —— 逐条读后
    // **确认这是对的，不是判据漏网**：在**个人**清单里新建时，源（还不存在）与目的地
    // 两边都解析不出 shareId，`undefined !== undefined` 为假 ⇒ 不构成移动，照旧走个人 log。
    // 同一枚病灶下 `评论同形` 也不红：COMMENT 在 `crossesShareBoundary` 第一行就被挡掉。
    // 两条都写在这里，免得下一位再猜一遍。
  },
  {
    id: 'silent-personal',
    why: '通道没装上时悄悄退回个人 log（M2 之前那一格的形状：本机看着成功，对面永远看不见）',
    needle:
      '    const channel = await ports.channel();\n' +
      '    if (channel === undefined) {\n' +
      '      throw new ShareChannelUnavailableError(intent.entityType, intent.entityId, decision.shareId);\n' +
      '    }\n',
    rep:
      `    const channel = await ports.channel();\n    // ${MARK}\n` +
      '    if (channel === undefined) {\n      await ports.personalDispatch(intent);\n      return;\n    }\n',
    mustInclude: [T.noChannelSync, T.noChannelAsync, T.createNoChannel],
    expect: 3,
  },
  {
    id: 'silent-personal-cas',
    why: '同一枚病灶只漏在 CAS 派发器上（估时/追加清单那两枚动作走这一条路）',
    needle:
      '    if (channel === undefined) {\n' +
      '      // 抛出去，**不退回个人 log**：那条写会"成功"、界面会动，而对面的成员永远看不见。\n' +
      '      throw new ShareChannelUnavailableError(toShare.intent.entityType, toShare.intent.entityId, toShare.shareId);\n' +
      '    }\n',
    rep:
      `    if (channel === undefined) {\n    // ${MARK}\n` +
      '      await ports.personalDispatch(toShare.intent);\n      return value;\n    }\n',
    mustInclude: [T.noChannelCas],
    expect: 1,
  },
  {
    id: 'move-never-rejected',
    why: '跨边界移动不拒绝 ⇒ 实体历史裂成两本 log，任一侧单独回放都残缺（补二那一条理由）',
    needle:
      'export function crossesShareBoundary(state: MaterializedState, intent: OpIntent): boolean {\n',
    rep:
      `export function crossesShareBoundary(state: MaterializedState, intent: OpIntent): boolean {\n` +
      `  // ${MARK}\n  void state; void intent; return false;\n`,
    mustInclude: [
      T.moveSharedToPersonal,
      T.movePersonalToShared,
      T.moveBetweenShares,
      T.casMove,
      T.reverseRegression,
    ],
    expect: 5,
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
function parseVitest(out) {
  const sum = /^\s*Tests\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  const failed = Number(/(\d+) failed/.exec(sum ?? '')?.[1] ?? NaN);
  const titles = [...out.matchAll(/^\s*×\s+(.+?)\s+\d+ms\s*$/gm)].map((m) => m[1]);
  const files = /^\s*Test Files\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  return { sum, failed, titles, files };
}

/* ── 前置：目标文件在场 + 相对 HEAD 干净 + 每枚 needle 恰好命中一次 ─────── */
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
  const hits = original.split(a.needle).length - 1;
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

/* ── ① 基线对照 ─────────────────────────────────────────────────────── */
const base = sh(`./node_modules/.bin/vitest run ${SPECS}`);
const bp = parseVitest(`${base.stdout ?? ''}${base.stderr ?? ''}`);
say(`BASELINE RC=${String(base.status)} Tests=${bp.sum ?? '?'} TestFiles=${bp.files ?? '?'}`);
if (base.status !== 0 || !/^1 passed/.test(bp.files ?? '')) {
  say('ARMS=ABORT reason=baseline-not-green（基线红、或那份 spec 压根没跑到 ⇒ 台架自己坏了，拒绝读数）');
  process.exit(2);
}

/* ── ② 逐臂注病灶 ───────────────────────────────────────────────────── */
let failures = 0;
for (const a of ARMS) {
  writeFileSync(abs, original.replace(a.needle, a.rep), 'utf8');
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

/* ──  还原后复跑基线 ───────────────────────────────────────────────── */
const recheck = sh(`./node_modules/.bin/vitest run ${SPECS}`);
const rp = parseVitest(`${recheck.stdout ?? ''}${recheck.stderr ?? ''}`);
say(`RECHECK RC=${String(recheck.status)} Tests=${rp.sum ?? '?'}`);
if (recheck.status !== 0) failures += 1;

say(
  `\nARMS=${failures === 0 ? 'pass' : 'FAIL'} (${String(ARMS.length - failures)}/${String(ARMS.length)})  ` +
    `载具 cd packages/app-host && npx vitest run ${SPECS}`,
);
process.exit(failures === 0 ? 0 : 1);
