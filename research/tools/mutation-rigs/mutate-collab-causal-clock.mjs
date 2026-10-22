#!/usr/bin/env node
/**
 * 变异装置：M2 因果时钟那五枚判据**到底能不能红**（ADR-0067 裁决二）
 * =================================================================
 *
 * 它不改产品行为，只回答一句质疑：「`share-causal-clock.spec.ts` 绿了，是因为
 * 因果边真的被盯着，还是因为那几条断言谁都拦不住？」
 *
 * 这一格尤其需要臂来证明，因为它的病灶**在行为上是隐形的**：`vectorClock` 写死
 * `{我:1}` 时同步照样跑、评论照样互见、e2e 照样全绿 —— 到今天为止没有任何一条链
 * 靠因果边定序。所以"测试通过"证明不了这条链存在，只有"摘掉它必须红"才行。
 *
 * 五臂各注一枚**真实会犯的**病灶（A 是 M2 之前工作树里真的那一行）：
 *
 *  A `dead-value`        `share-client.ts` 写回 `vectorClock: { [clientId]: 1 }`。
 *     这是本 ADR 点名要关掉的那一格的原样。
 *  B `ignore-share-id`   `baseClock` 忽略 shareId（抓死一份）。
 *     表现是"只在一份清单上写的人永远正常"，多清单用户才会看到顺序错。
 *  C `local-dims-only`   基准只留本地那一维 ⇒ 远端的钟不回流。
 *     这一枚最阴：本地自增看着是对的，但"我读到你的改动之后写的这条"会被判成并发。
 *  D `cache-only`        基准读内存缓存而不是落盘日志 ⇒ 冷启动后退回 `{我:1}`。
 *     重启一次就丢全部因果边，而界面上一个痕迹都没有。
 *  E `clock-before-auth` 未登录闸门挪到读基准之后 ⇒ 一条没发出去的 op 占掉一个序。
 *     单独看是"钟跳了一格"，配合重试就是同一个人两条 op 之间的空洞。
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：
 *   ① 基线对照必须先绿，且那两份 spec 真的跑到（分母 = 2 个文件）—— 否则 `PROBE_BROKEN` 退 2；
 *   ② 每臂要求**红集精确匹配**：条数 = `expect`、预期的那几条必须红、且**不许多红**；
 *   ③ 每臂还原后 md5 逐字节比对，还原前后各复跑一次基线。
 *
 * 🔴 它**原地改工作树**（两枚目标文件都归本线），所以动手前先验各自相对 HEAD 干净，
 *    脏就 `ARMS=ENV dirty-worktree` 退 3：本仓多会话共用一个检出，不能拿别人未提交的改动当实验台。
 *    还原用**内存副本**，不是 `git checkout`。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-causal-clock.mjs
 * 读数：`ARMS=pass (5/5)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');
const PKG = join(ROOT, 'packages/app-host');
const CLIENT = 'packages/app-host/src/share-client.ts';
const HOST = 'packages/app-host/src/share-comments.ts';
const SPECS = 'tests/share-causal-clock.spec.ts tests/share-client.spec.ts';

const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';

/** 两份 spec 里那六枚用例的名字（逐字取自 `it(...)` 的标题，不凭记忆写）。 */
const T = {
  localIncrement: '① 本地连写两条 ⇒ 第二条的本地维自增',
  perShare: '② 两份清单各走各的钟',
  reflow: '③ 拉回远端的时钟会回流成本地下一条的基准',
  coldStart: '④ 换新实例（冷启动）后钟从盘上续上',
  signedOut: '⑤ 未登录时连基准都不读',
  pureRule: '因果时钟 = 基准逐维带过',
};

const ARMS = [
  {
    id: 'dead-value',
    target: CLIENT,
    why: '时钟写回死值 ⇒ 同一台设备先后写的两条判成并发（M2 之前工作树里真是这行）',
    needle: '        vectorClock: { ...base, [options.clientId]: (base[options.clientId] ?? 0) + 1 },\n',
    rep: `        // ${MARK}\n        vectorClock: { [options.clientId]: 1 },\n`,
    mustInclude: [T.localIncrement, T.perShare, T.reflow, T.coldStart, T.pureRule],
    expect: 5,
  },
  {
    id: 'ignore-share-id',
    target: HOST,
    why: '基准忽略 shareId ⇒ 多份清单共用一条钟',
    needle: '      baseClock: (id) => entryFor(id).log.clock,\n',
    rep: `      // ${MARK}\n      baseClock: () => entryFor('share-1').log.clock,\n`,
    mustInclude: [T.perShare],
    expect: 1,
  },
  {
    id: 'local-dims-only',
    target: HOST,
    why: '基准只留本地那一维 ⇒ 远端的钟不回流（裁决二那句"缺的是让它回流"原样复活）',
    needle: '      baseClock: (id) => entryFor(id).log.clock,\n',
    rep: `      // ${MARK}\n      baseClock: (id) =>\n        Object.fromEntries(Object.entries(entryFor(id).log.clock).filter(([k]) => k === options.clientId)),\n`,
    mustInclude: [T.reflow],
    expect: 1,
  },
  {
    id: 'cache-only',
    target: HOST,
    why: '基准读内存缓存而不是落盘日志 ⇒ 冷启动之后因果边整条丢失',
    needle: '      baseClock: (id) => entryFor(id).log.clock,\n',
    rep: `      // ${MARK}\n      baseClock: (id) => cache.get(id)?.log.clock ?? {},\n`,
    mustInclude: [T.coldStart],
    expect: 1,
  },
  {
    id: 'clock-before-auth',
    target: HOST,
    why: '未登录闸门挪到读基准之后 ⇒ 没发出去的 op 也占掉一个时钟序',
    needle:
      '  const dispatchShareOp = async (shareId: string, intent: ShareOpIntent): Promise<void> => {\n    if (!options.isSignedIn()) throw new ShareNotSignedInError();\n',
    rep: `  const dispatchShareOp = async (shareId: string, intent: ShareOpIntent): Promise<void> => {\n    // ${MARK}\n    void entryFor(shareId);\n    if (!options.isSignedIn()) throw new ShareNotSignedInError();\n`,
    mustInclude: [T.signedOut],
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
function parseVitest(out) {
  const sum = /^\s*Tests\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  const failed = Number(/(\d+) failed/.exec(sum ?? '')?.[1] ?? NaN);
  const titles = [...out.matchAll(/^\s*×\s+(.+?)\s+\d+ms\s*$/gm)].map((m) => m[1]);
  const files = /^\s*Test Files\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  return { sum, failed, titles, files };
}

/* ── 前置：两枚目标文件在场 + 各自相对 HEAD 干净 + 每枚 needle 恰好命中一次 ── */
const originals = new Map();
for (const rel of [...new Set(ARMS.map((a) => a.target))]) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    say(`ARMS=FAIL reason=target-missing ${rel}`);
    process.exit(1);
  }
  const dirty = git(['status', '--porcelain', '--', rel]).trim();
  if (dirty !== '') {
    say(`ARMS=ENV dirty-worktree —— ${rel} 相对 HEAD 有未提交改动，装置不在别人的改动上动刀。\n   ${dirty}`);
    process.exit(3);
  }
  originals.set(rel, readFileSync(abs, 'utf8'));
}
for (const a of ARMS) {
  const text = originals.get(a.target);
  const hits = text.split(a.needle).length - 1;
  if (hits !== 1) {
    say(`ARMS=FAIL reason=needle-hits=${String(hits)} arm=${a.id} —— 锚点必须恰好一处，否则注病灶的位置不确定`);
    process.exit(1);
  }
}
say(`GUARD ✅ ${ARMS.length} 臂的 needle 各命中 1 次，且两枚目标文件相对 HEAD 干净`);

const restoreAll = () => {
  for (const [rel, text] of originals) {
    const abs = join(ROOT, rel);
    if (readFileSync(abs, 'utf8') !== text) writeFileSync(abs, text, 'utf8');
    if (md5(readFileSync(abs, 'utf8')) !== md5(text)) {
      say(`ARMS=FAIL reason=RESTORE=DIRTY ${rel} md5=${md5(text)} -> ${md5(readFileSync(abs, 'utf8'))}`);
      process.exit(4);
    }
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
if (base.status !== 0 || !/^2 passed/.test(bp.files ?? '')) {
  say('ARMS=ABORT reason=baseline-not-green（基线红、或那两份 spec 压根没跑到 ⇒ 台架自己坏了，拒绝读数）');
  process.exit(2);
}

/* ── ② 逐臂注病灶 ───────────────────────────────────────────────────── */
let failures = 0;
for (const a of ARMS) {
  const text = originals.get(a.target);
  writeFileSync(join(ROOT, a.target), text.replace(a.needle, a.rep), 'utf8');
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
  if (extra.length > 0) say(`      ⚠️ 额外红的用例: ${extra.map((t) => t.slice(0, 34)).join(' | ')}`);
  restoreAll();
  if (!match) failures += 1;
}

/* ── ③ 还原后复跑基线 ───────────────────────────────────────────────── */
const recheck = sh(`./node_modules/.bin/vitest run ${SPECS}`);
const rp = parseVitest(`${recheck.stdout ?? ''}${recheck.stderr ?? ''}`);
say(`RECHECK RC=${String(recheck.status)} Tests=${rp.sum ?? '?'}`);
if (recheck.status !== 0) failures += 1;

say(
  `\nARMS=${failures === 0 ? 'pass' : 'FAIL'} (${String(ARMS.length - failures)}/${String(ARMS.length)})  ` +
    `载具 cd packages/app-host && npx vitest run ${SPECS}`,
);
process.exit(failures === 0 ? 0 : 1);
