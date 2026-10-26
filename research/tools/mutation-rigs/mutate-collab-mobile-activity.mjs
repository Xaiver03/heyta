#!/usr/bin/env node
/**
 * 变异装置：移动端「共享动态」那一档的四条判据各自有没有牙
 * ================================================================
 *
 * 它不改产品行为，只回答一句质疑：`apps/mobile/tests/share-ui-assembly.spec.ts` 的
 * ⑦⑧ 两组全绿，是因为**"信号 → 闸门 → 正文 → 那一档 → 入口徽标"这条链每一环都有人守**，
 * 还是因为"逻辑在 lib 里测过、装配在源码文本里扫过，而接起来的那几行没人测"。
 *
 * 四臂（载具都是移动端那份 spec；它跑的是真代码，只有 ⑦ 的第四枚读源码文本）：
 *  1 `name-never-read`   正文组装时永远不去读那一行的清单名 ⇒ 带名字那两档必须红
 *  2 `stale-labels`      把"重复装配早退"那枚旧缺陷注回去 ⇒ 只有换标签那一枚该红
 *  3 `body-empty`        投递时不拼正文（条目带着空句子进动态）⇒ 三条读 `body` 的都该红
 *  4 `badge-not-summed`  🔴 徽标那枚数改回只数 inbox，而三处引用照旧 ——
 *                        这一臂就是 #582 的牙齿：上一版判据只钉了"引用换了吗"
 *                        （`count: inboxBadge` / `{inboxBadge}`），这一臂当时**照样全绿**。
 *                        现在多钉了"相加这个形状"，它必须红。
 *
 * 口径按 `research/tools/mutation-rigs/README.md`：① 基线必须先绿且那份 spec 真跑到
 * （否则退 2）；② 每臂**红集精确匹配**（条数 + 缺席 + 多红三条都过）；③ 还原只从
 * `.mut-bak` 取并逐字节比对，最后复跑基线。
 *
 * 🔴 原地改工作树（目标文件全归本线），动手前逐枚验它相对 HEAD 干净，脏就退 **3**。
 *    本批实现已提交（`173f5110f`），所以 `OWNED` 是空表 —— 登记表外的文件一旦脏
 *    ⇒ 装置不跑（不在别人的改动上动刀）。
 *
 * 用法：node research/tools/mutation-rigs/mutate-collab-mobile-activity.mjs
 * 读数：`ARMS=pass (4/4)` / `ARMS=FAIL …`；还原失败以 `RESTORE=DIRTY` 退 4。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RIG = fileURLToPath(import.meta.url);
const ROOT = join(dirname(RIG), '..', '..', '..');
const MARK = 'MUTATED-BY-RIG：这一处是装置注入的病灶，跑完即还原';

const CARRIERS = {
  mobile: { pkg: 'apps/mobile', spec: 'tests/share-ui-assembly.spec.ts' },
};

/** 本批正在写、还没提交的文件 —— 脏着允许跑，登记表外一律退 3。 */
const OWNED = new Set([]);

const ARMS = [
  {
    id: 'name-never-read',
    carrier: 'mobile',
    file: 'apps/mobile/src/lib/share-activity-copy.ts',
    why: '组装正文时永远不读那一行的清单名 ⇒ 动态只会说匿名那句',
    needle: '  const listName = rowId === undefined ? undefined : state.projects[rowId]?.name;\n',
    rep: `  // ${MARK}\n  const listName: string | undefined = undefined;\n`,
    // ⚠️ 首跑预测 2 红、实测 **4**：多出来的两枚一枚是"重复装配说新语言"（它断言的
    // 就是那句带名字的正文），一枚是"插值变量只有 `name`"（名字永远取不到 ⇒ 有名那三句
    // 一次都不走 ⇒ `toHaveLength(3)` 恒假）。两枚都读过源码确认**该红** ⇒ 收紧的是预测，
    // 不是判据。
    mustInclude: ['动态多一条**带清单名**的正文', '重复装配换的是标签与端口', '三档种类各挑', '插值变量**只有**'],
    expect: 4,
  },
  {
    id: 'stale-labels',
    carrier: 'mobile',
    file: 'apps/mobile/src/share/share-activity-notify.ts',
    why: '把"装过就直接 return"那枚旧缺陷注回去 ⇒ 切语言后的新动态仍说旧语言',
    needle: '  unsubscribe?.();\n  unsubscribe = subscribeShareActivity(',
    rep: `  // ${MARK}\n  if (unsubscribe !== undefined) return;\n  unsubscribe?.();\n  unsubscribe = subscribeShareActivity(`,
    mustInclude: ['重复装配换的是标签与端口'],
    expect: 1,
  },
  {
    id: 'body-empty',
    carrier: 'mobile',
    file: 'apps/mobile/src/share/share-activity-notify.ts',
    why: '投递那一刻不拼正文 ⇒ 条目带着空句子进动态，界面上那一行是白的',
    needle: '      body: args.labels.body(args.shareId, kind),\n',
    rep: `      // ${MARK}\n      body: '',\n`,
    // ⚠️ 首跑预测 3 红、实测 **4**：多出来那枚是"开了 `added` ⇒ 只响 added 那一条"，
    // 它断言的 `toMatchObject` 里就躺着 `body: 'share-1:added'`（那句注释写着"投递那一刻
    // 正文就已经拼好了"）⇒ 该红。收紧的是预测，不是判据。
    mustInclude: ['开了 `added`', '动态多一条**带清单名**的正文', '那一行还没有名字', '重复装配换的是标签与端口'],
    expect: 4,
  },
  {
    id: 'badge-not-summed',
    carrier: 'mobile',
    file: 'apps/mobile/src/screens/ProfileScreen.tsx',
    why: '徽标改回只数 inbox，而三处引用照旧 ⇒ 共享动态来了入口不动（#582 那一档）',
    needle: '  const inboxBadge = inboxUnread + shareUnread;\n',
    rep: `  // ${MARK}\n  const inboxBadge = inboxUnread;\n`,
    mustInclude: ['那一档真有消费者'],
    expect: 1,
  },
];

const md5 = (s) => createHash('md5').update(s).digest('hex');
const say = (line) => process.stdout.write(`${line}\n`);
const git = (args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).stdout ?? '';

const sh = (pkgRel, cmd) =>
  spawnSync(cmd, {
    cwd: join(ROOT, pkgRel),
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

const run = (carrier) => {
  const c = CARRIERS[carrier];
  const r = sh(c.pkg, `./node_modules/.bin/vitest run ${c.spec}`);
  return { code: r.status, parsed: parseVitest(`${r.stdout ?? ''}${r.stderr ?? ''}`) };
};

// ── 前置守卫：目标存在 + 相对 HEAD 干净（登记自持的除外）+ 每臂 needle 恰好一处 ──
const targets = [...new Set(ARMS.map((a) => a.file))];
for (const t of targets) {
  if (!existsSync(join(ROOT, t))) {
    say(`ARMS=FAIL reason=target-missing ${t}`);
    process.exit(1);
  }
  const dirty = git(['status', '--porcelain', '--', t]).trim();
  if (dirty !== '' && !OWNED.has(t)) {
    say(`ARMS=ENV dirty-worktree —— ${t} 相对 HEAD 有未提交改动且不在本装置的自持登记表里，装置不在别人的改动上动刀。\n   ${dirty}`);
    process.exit(3);
  }
  if (dirty !== '') {
    say(`GUARD ⚠️ ${t} 脏着 —— 该文件已在 OWNED 登记表内，照跑（提交后请清空登记表）`);
  }
}

const originals = new Map(targets.map((t) => [t, readFileSync(join(ROOT, t), 'utf8')]));
const backups = new Map(targets.map((t) => [t, `${join(ROOT, t)}.mut-bak`]));

for (const a of ARMS) {
  const hits = originals.get(a.file).split(a.needle).length - 1;
  if (hits !== 1) {
    say(`ARMS=FAIL reason=needle-hits=${String(hits)} arm=${a.id} —— 锚点必须恰好一处，否则注病灶的位置不确定`);
    process.exit(1);
  }
}
say(`GUARD ✅ ${ARMS.length} 臂的 needle 各命中 1 次，${targets.length} 枚目标文件全部在本线名下`);

const headOf = (t) => git(['rev-parse', `HEAD:${t}`]).trim();
for (const t of targets) {
  writeFileSync(backups.get(t), originals.get(t), 'utf8');
  say(`  · ${t} HEAD=${headOf(t).slice(0, 9)} md5=${md5(originals.get(t) ?? '')}`);
}

function restoreAll() {
  for (const t of targets) {
    const abs = join(ROOT, t);
    const from = readFileSync(backups.get(t), 'utf8');
    if (readFileSync(abs, 'utf8') === from) continue;
    writeFileSync(abs, from, 'utf8');
    if (md5(readFileSync(abs, 'utf8')) !== md5(from)) {
      say(`ARMS=FAIL reason=RESTORE=DIRTY ${t}（只从 ${t}.mut-bak 还原，不拿 git 当变量）`);
      process.exit(4);
    }
  }
}
process.on('exit', () => {
  restoreAll();
  for (const t of targets) {
    const bak = backups.get(t);
    if (existsSync(bak)) unlinkSync(bak);
  }
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    say(`🔴 收到 ${sig} —— 先还原再退出`);
    process.exit(130);
  });
}

// ── 基线：那份 spec 必须真跑到且全绿 ───────────────────────────────────────
for (const carrier of Object.keys(CARRIERS)) {
  const b = run(carrier);
  say(`BASELINE[${carrier}] RC=${String(b.code)} Tests=${b.parsed.sum ?? '?'}`);
  if (b.code !== 0 || !/^1 passed/.test(b.parsed.files ?? '')) {
    say(`ARMS=ABORT reason=baseline-not-green/${carrier}（基线红、或那份 spec 压根没跑到 ⇒ 台架自己坏了，拒绝读数）`);
    process.exit(2);
  }
}

let failures = 0;
for (const a of ARMS) {
  const abs = join(ROOT, a.file);
  writeFileSync(abs, originals.get(a.file).replace(a.needle, a.rep), 'utf8');
  const r = run(a.carrier);
  const p = r.parsed;
  const survived = r.code === 0;
  const missing = a.mustInclude.filter((tag) => !p.titles.some((t) => t.includes(tag)));
  const extra = p.titles.filter((t) => !a.mustInclude.some((tag) => t.includes(tag)));
  const match = !survived && p.failed === a.expect && missing.length === 0 && extra.length === 0;
  say(`[${a.id}] ${a.why}\n      → RC=${String(r.code)} 红 ${String(p.failed)}/${String(a.expect)} ${
    survived ? '🔴 存活（判据没牙）' : match ? '红集精确匹配' : '⚠️ 红集漂移'
  }`);
  for (const t of p.titles.slice(0, 8)) say(`      · ${t}`);
  if (missing.length > 0) say(`      🔴 预期红的用例缺席: ${missing.join(' | ')}`);
  if (extra.length > 0) say(`      ⚠️ 额外红的用例: ${extra.map((t) => t.slice(0, 48)).join(' | ')}`);
  restoreAll();
  if (!match) failures += 1;
}

let recheckFailures = 0;
for (const carrier of Object.keys(CARRIERS)) {
  const recheck = run(carrier);
  say(`RECHECK[${carrier}] RC=${String(recheck.code)} Tests=${recheck.parsed.sum ?? '?'}`);
  if (recheck.code !== 0) recheckFailures += 1;
}
if (recheckFailures > 0) failures += 1;

say(
  `\nARMS=${failures === 0 ? 'pass' : 'FAIL'} (${String(ARMS.length - failures)}/${String(ARMS.length)})  ` +
    `载具=${Object.keys(CARRIERS).map((c) => `${c}:${CARRIERS[c].spec}`).join(' , ')}`,
);
process.exit(failures === 0 ? 0 : 1);
